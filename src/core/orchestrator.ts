import type {
  GraphMemoryPort,
  ClaudeRunnerPort,
  TaskPollerPort,
  OrchestratorConfig,
  SprintStats,
  Task,
  TaskRunResult,
  CrossProjectResolver,
  CrossProjectTask,
} from './types.js';
import { getActiveProject } from './types.js';
import { sortByPriority, areBlockersResolved, areBlockersResolvedAsync } from './task-utils.js';
import type { Logger } from '../infra/logger.js';

interface Ports {
  gm: GraphMemoryPort;
  runner: ClaudeRunnerPort;
  poller: TaskPollerPort;
  logger: Logger;
  signal?: AbortSignal;
  /**
   * Optional resolver for cross-project blockers.
   * When provided, `findNextRunnable` will check blockers in other projects.
   */
  crossProjectResolver?: CrossProjectResolver;
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

  const activeProject = getActiveProject(config);
  const projectLabel = activeProject?.projectId ?? '(none)';
  logger.section(`Sprint — project: ${projectLabel}${config.tag ? `  tag: ${config.tag}` : ''}`);

  while (true) {
    if (ports.signal?.aborted) {
      logger.warn('Sprint aborted');
      stats.durationMs = Date.now() - startTime;
      return stats;
    }

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

    const next = await findNextRunnable(queue, logger, ports.crossProjectResolver);

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
 * Supports cross-project blockers when a CrossProjectResolver is injected.
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
    if (ports.signal?.aborted) {
      logger.warn('Epic aborted');
      stats.durationMs = Date.now() - startTime;
      return stats;
    }

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

    const next = await findNextRunnable(queue, logger, ports.crossProjectResolver);

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

/**
 * Runs a specific set of tasks by ID, in priority order.
 * Fetches each task, validates it is runnable (todo/in_progress),
 * then executes them sequentially using the standard runOneTask logic.
 */
export async function runTasks(
  taskIds: string[],
  ports: Ports,
  config: OrchestratorConfig
): Promise<SprintStats> {
  const { gm, logger } = ports;
  const startTime = Date.now();
  const stats: SprintStats = { done: 0, cancelled: 0, retried: 0, errors: 0, skipped: 0, durationMs: 0 };

  const failedIds = new Set<string>();
  const retryCounts = new Map<string, number>();

  logger.section(`Running ${taskIds.length} selected task(s)`);

  // Fetch all tasks and validate
  const tasks: Task[] = [];
  for (const taskId of taskIds) {
    if (ports.signal?.aborted) break;
    try {
      const task = await gm.getTask(taskId);
      if (task.status === 'todo' || task.status === 'in_progress') {
        tasks.push(task);
      } else {
        logger.skip(`Skipping "${task.title}" — status is "${task.status}"`);
        stats.skipped++;
      }
    } catch (err) {
      logger.error(`Failed to fetch task ${taskId}: ${String(err)}`);
      stats.errors++;
    }
  }

  // Sort by priority
  const queue = sortByPriority(tasks);

  for (const task of queue) {
    if (ports.signal?.aborted) {
      logger.warn('Run aborted');
      break;
    }

    if (failedIds.has(task.id)) continue;

    const result = await runOneTask(task, ports, config);

    await handleResult(result, task, {
      gm, logger, stats, failedIds, retryCounts,
      maxRetries: config.maxRetries,
    });

    await sleep(config.pauseMs);
  }

  stats.durationMs = Date.now() - startTime;
  logStats(logger, stats);
  return stats;
}

// ── Internal ──────────────────────────────────────────────────────────────

/**
 * Finds the next runnable task in the queue, respecting both same-project
 * and cross-project blockers. If a CrossProjectResolver is provided,
 * blockers with a `projectId` field are resolved asynchronously against
 * the remote project.
 */
async function findNextRunnable(
  queue: Task[],
  logger: Logger,
  resolver?: CrossProjectResolver,
): Promise<Task | null> {
  for (const task of queue) {
    // Fast path: no cross-project blockers or no resolver
    const hasCrossProjectBlockers = task.blockedBy?.some((b) => b.projectId);
    if (!hasCrossProjectBlockers || !resolver) {
      if (areBlockersResolved(task)) return task;
    } else {
      // Slow path: resolve cross-project blockers
      const resolved = await areBlockersResolvedAsync(task, resolver);
      if (resolved) return task;
    }
    logger.skip(`blocked: "${task.title}"`);
  }
  return null;
}

async function runOneTask(
  task: Task,
  { gm, runner, poller, logger, signal }: Ports,
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
    ...(signal ? { signal } : {}),
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
    logger.taskResult(task, 'done');
    return;
  }

  if (result === 'cancelled') {
    stats.cancelled++;
    failedIds.add(task.id);
    logger.taskResult(task, 'cancelled');
    return;
  }

  // timeout | error
  const retries = retryCounts.get(task.id) ?? 0;
  if (retries < maxRetries) {
    retryCounts.set(task.id, retries + 1);
    stats.retried++;
    logger.taskResult(task, 'timeout', { attempt: retries + 1, maxRetries });
    logger.warn(`Retrying (${retries + 1}/${maxRetries}): ${task.id}`);
    await gm.moveTask(task.id, 'todo').catch(() => {});
  } else {
    stats.errors++;
    failedIds.add(task.id);
    logger.taskResult(task, 'timeout');
    logger.error(`Giving up on: ${task.id}`);
    await gm.moveTask(task.id, 'cancelled').catch(() => {});
  }
}

/**
 * Collect tasks for a cross-project epic.
 * Fetches the epic from the "home" project, then gathers tasks from all
 * referenced projects. Each task is annotated with `sourceProjectId`.
 */
export async function collectCrossProjectEpicTasks(
  epicId: string,
  homePorts: Pick<Ports, 'gm' | 'logger'>,
  resolveGm: (projectId: string) => GraphMemoryPort,
  homeProjectId: string,
): Promise<{ epic: Awaited<ReturnType<GraphMemoryPort['getEpic']>>; tasks: CrossProjectTask[] }> {
  const { gm, logger } = homePorts;

  const epic = await gm.getEpic(epicId);
  const taskRefs = epic.tasks ?? [];

  // Group task refs by project — refs without projectId belong to the home project
  const byProject = new Map<string, string[]>();
  for (const ref of taskRefs) {
    const pid = ref.projectId ?? homeProjectId;
    const ids = byProject.get(pid) ?? [];
    ids.push(ref.id);
    byProject.set(pid, ids);
  }

  // Fetch tasks from each project in parallel
  const allTasks: CrossProjectTask[] = [];
  await Promise.all(
    [...byProject.entries()].map(async ([projectId, taskIds]) => {
      try {
        const client = projectId === homeProjectId ? gm : resolveGm(projectId);
        const taskIdSet = new Set(taskIds);
        const tasks = await client.listTasks({ limit: 500 });
        for (const t of tasks) {
          if (taskIdSet.has(t.id)) {
            allTasks.push({ ...t, sourceProjectId: projectId });
          }
        }
      } catch (err) {
        logger.warn(`Failed to fetch tasks from project "${projectId}": ${String(err)}`);
      }
    }),
  );

  return { epic, tasks: allTasks };
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
