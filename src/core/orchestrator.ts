import type {
  GraphMemoryPort,
  ClaudeRunnerPort,
  TaskPollerPort,
  OrchestratorConfig,
  SprintStats,
  Task,
  TaskRunResult,
} from './types.js';
import { sortByPriority, areBlockersResolved } from './task-utils.js';
import type { Logger } from '../infra/logger.js';

interface Ports {
  gm: GraphMemoryPort;
  runner: ClaudeRunnerPort;
  poller: TaskPollerPort;
  logger: Logger;
}

/**
 * Orchestrates a full sprint: runs all todo/in_progress tasks in priority
 * order, respecting blockers, retrying on failure, until none remain.
 *
 * Pure orchestration logic — all side effects go through injected ports.
 * This makes the core fully testable without spawning Claude or hitting GM.
 */
export async function runSprint(
  ports: Ports,
  config: OrchestratorConfig
): Promise<SprintStats> {
  const { gm, logger } = ports;
  const startTime = Date.now();
  const stats: SprintStats = { done: 0, cancelled: 0, retried: 0, errors: 0, skipped: 0, durationMs: 0 };

  const failedIds = new Set<string>();
  const retryCounts = new Map<string, number>();

  logger.section(`Sprint — project: ${config.projectId}${config.tag ? `  tag: ${config.tag}` : ''}`);

  while (true) {
    const tagFilter = config.tag !== undefined ? { tag: config.tag } : {};
    const [inProgress, todo] = await Promise.all([
      gm.listTasks({ status: 'in_progress', ...tagFilter }),
      gm.listTasks({ status: 'todo', ...tagFilter }),
    ]);

    // in_progress first (resuming), then todo sorted by priority
    const queue = [
      ...sortByPriority(inProgress),
      ...sortByPriority(todo),
    ].filter((t) => !failedIds.has(t.id));

    if (!queue.length) {
      logger.section('Sprint complete');
      stats.durationMs = Date.now() - startTime;
      logStats(logger, stats);
      return stats;
    }

    const next = findNextRunnable(queue, logger);

    if (!next) {
      logger.warn(`${queue.length} tasks remain but all are blocked — stopping`);
      queue.forEach((t) => logger.skip(`  blocked: ${t.title} (${t.id})`));
      stats.durationMs = Date.now() - startTime;
      logStats(logger, stats);
      return stats;
    }

    const result = await runOneTask(next, ports, config);

    await handleResult(result, next, {
      gm, logger, stats, failedIds, retryCounts,
      maxRetries: config.maxRetries,
    });

    await sleep(config.pauseMs);
  }
}

/**
 * Runs all tasks belonging to an epic, in priority order with blocker checks.
 * Marks the epic done when all tasks complete.
 */
export async function runEpic(
  epicId: string,
  ports: Ports,
  config: OrchestratorConfig
): Promise<SprintStats> {
  const { gm, logger } = ports;
  const startTime = Date.now();
  const stats: SprintStats = { done: 0, cancelled: 0, retried: 0, errors: 0, skipped: 0, durationMs: 0 };

  const epic = await gm.getEpic(epicId);
  logger.section(`Epic: "${epic.title}" (${epicId})`);
  logger.info(`Priority: ${epic.priority}  Status: ${epic.status}`);

  const failedIds = new Set<string>();
  const retryCounts = new Map<string, number>();

  while (true) {
    // Fetch fresh task list from the epic's dedicated endpoint
    const allTasks = await gm.listEpicTasks(epicId);

    const queue = sortByPriority(
      allTasks.filter((t) =>
        !['done', 'cancelled'].includes(t.status) &&
        !failedIds.has(t.id)
      )
    );

    if (!queue.length) {
      const allDone = allTasks.length > 0 && allTasks.every((t) => t.status === 'done');
      if (allDone) {
        logger.success('All epic tasks done — marking epic complete');
        await gm.moveEpic(epicId, 'done');
      }
      logger.section('Epic complete');
      stats.durationMs = Date.now() - startTime;
      logStats(logger, stats);
      return stats;
    }

    const next = findNextRunnable(queue, logger);

    if (!next) {
      logger.warn('All remaining epic tasks are blocked — stopping');
      stats.durationMs = Date.now() - startTime;
      logStats(logger, stats);
      return stats;
    }

    const result = await runOneTask(next, ports, config);

    await handleResult(result, next, {
      gm, logger, stats, failedIds, retryCounts,
      maxRetries: config.maxRetries,
    });

    await sleep(config.pauseMs);
  }
}

// ── Internal ──────────────────────────────────────────────────────────────

function findNextRunnable(queue: Task[], logger: Logger): Task | null {
  for (const task of queue) {
    if (areBlockersResolved(task)) return task;
    logger.skip(`blocked: "${task.title}"`);
  }
  return null;
}

async function runOneTask(
  task: Task,
  { gm, runner, poller, logger }: Ports,
  config: OrchestratorConfig
): Promise<TaskRunResult> {
  logger.task(task);

  // Mark in_progress (idempotent)
  if (task.status !== 'in_progress') {
    await gm.moveTask(task.id, 'in_progress').catch((e: unknown) => {
      logger.warn(`Could not mark in_progress: ${String(e)}`);
    });
  }

  if (config.dryRun) {
    logger.warn('[DRY RUN] Would spawn claude --print <prompt>');
    await gm.moveTask(task.id, 'done').catch(() => {});
    return 'dry_run';
  }

  // Spawn Claude Code session (fire and forget — poller drives completion)
  const sessionPromise = runner.run(task, config).catch((e: unknown) => {
    logger.warn(`Claude session error: ${String(e)}`);
  });

  // Poll GraphMemory until task reaches terminal state
  const pollResult = await poller.waitForCompletion(task.id, {
    timeoutMs: config.timeoutMs,
  });

  await sessionPromise; // let process clean up

  if (pollResult === 'timeout') {
    logger.error(`Timeout: "${task.title}" (${task.id})`);
    return 'timeout';
  }

  if (pollResult === 'done') {
    logger.success(`Done: "${task.title}"`);
  } else {
    logger.warn(`Cancelled: "${task.title}"`);
  }

  return pollResult;
}

async function handleResult(
  result: TaskRunResult,
  task: Task,
  ctx: {
    gm: GraphMemoryPort;
    logger: Logger;
    stats: SprintStats;
    failedIds: Set<string>;
    retryCounts: Map<string, number>;
    maxRetries: number;
  }
): Promise<void> {
  const { gm, logger, stats, failedIds, retryCounts, maxRetries } = ctx;

  if (result === 'done' || result === 'dry_run') {
    stats.done++;
    return;
  }

  if (result === 'cancelled') {
    stats.cancelled++;
    failedIds.add(task.id);
    return;
  }

  // timeout | error
  const retries = retryCounts.get(task.id) ?? 0;
  if (retries < maxRetries) {
    retryCounts.set(task.id, retries + 1);
    stats.retried++;
    logger.warn(`Retrying (${retries + 1}/${maxRetries}): ${task.id}`);
    await gm.moveTask(task.id, 'todo').catch(() => {});
  } else {
    stats.errors++;
    failedIds.add(task.id);
    logger.error(`Giving up on: ${task.id}`);
    await gm.moveTask(task.id, 'cancelled').catch(() => {});
  }
}

function logStats(logger: Logger, stats: SprintStats): void {
  const secs = Math.round(stats.durationMs / 1000);
  logger.info(
    `✓ ${stats.done} done  ✗ ${stats.cancelled} cancelled  ` +
    `↺ ${stats.retried} retried  ⚠ ${stats.errors} errors  ` +
    `⏱ ${secs}s`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
