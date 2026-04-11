import { randomUUID } from 'crypto';
import type {
  GraphMemoryPort,
  HeartbeatConfig,
  TaskHeartbeatMeta,
  Task,
  ZombiePolicy,
} from './types.js';
import type { Logger } from '../infra/logger.js';

// ─── Defaults ────────────────────────────────────────────────────────────

export const HEARTBEAT_DEFAULTS: HeartbeatConfig = {
  intervalMs: 30_000,
  staleThresholdMs: 60_000,
  zombiePolicy: 'reset-to-todo',
};

/**
 * Resolve heartbeat config by merging user overrides with defaults.
 */
export function resolveHeartbeatConfig(
  partial?: Partial<HeartbeatConfig>,
): HeartbeatConfig {
  return {
    intervalMs: partial?.intervalMs ?? HEARTBEAT_DEFAULTS.intervalMs,
    staleThresholdMs:
      partial?.staleThresholdMs ??
      (partial?.intervalMs ? partial.intervalMs * 2 : HEARTBEAT_DEFAULTS.staleThresholdMs),
    zombiePolicy: partial?.zombiePolicy ?? HEARTBEAT_DEFAULTS.zombiePolicy,
  };
}

// ─── Heartbeat lifecycle ─────────────────────────────────────────────────

export interface HeartbeatHandle {
  /** Unique run ID for this session. */
  runId: string;
  /** Stop the heartbeat interval and clear metadata from the task. */
  stop(): Promise<void>;
}

/**
 * Start a heartbeat for a running task.
 *
 * - Writes `metadata.runId` and `metadata.heartbeatAt` immediately.
 * - Updates `metadata.heartbeatAt` every `intervalMs`.
 * - `stop()` clears the interval and removes heartbeat metadata.
 */
export function startHeartbeat(
  taskId: string,
  gm: GraphMemoryPort,
  config: HeartbeatConfig,
  logger: Logger,
): HeartbeatHandle {
  const runId = randomUUID();
  let stopped = false;

  const writeMeta = async (): Promise<void> => {
    if (stopped) return;
    const meta: TaskHeartbeatMeta = { runId, heartbeatAt: Date.now() };
    try {
      await gm.updateTask(taskId, {
        metadata: { runId: meta.runId, heartbeatAt: meta.heartbeatAt },
      });
    } catch (err) {
      logger.warn(`Heartbeat write failed for ${taskId}: ${String(err)}`);
    }
  };

  // Initial write
  void writeMeta();

  const timer = setInterval(() => void writeMeta(), config.intervalMs);

  return {
    runId,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      // Clear heartbeat metadata so it's not mistaken for a zombie
      try {
        await gm.updateTask(taskId, {
          metadata: { runId: null, heartbeatAt: null },
        });
      } catch (err) {
        logger.warn(`Heartbeat clear failed for ${taskId}: ${String(err)}`);
      }
    },
  };
}

// ─── Zombie recovery ─────────────────────────────────────────────────────

/**
 * Detect and recover zombie tasks on startup.
 *
 * Scans all `in_progress` tasks. If a task has heartbeat metadata
 * and `heartbeatAt` is older than `staleThresholdMs`, it's a zombie.
 * Tasks with no heartbeat metadata but `in_progress` status are also
 * treated as zombies (pre-heartbeat era or metadata was lost).
 *
 * Returns the list of recovered task IDs.
 */
export async function recoverZombieTasks(
  gm: GraphMemoryPort,
  config: HeartbeatConfig,
  logger: Logger,
): Promise<string[]> {
  const now = Date.now();
  const recovered: string[] = [];

  let inProgressTasks: Task[];
  try {
    inProgressTasks = await gm.listTasks({ status: 'in_progress' });
  } catch (err) {
    logger.error(`Zombie recovery: failed to list in_progress tasks: ${String(err)}`);
    return [];
  }

  for (const task of inProgressTasks) {
    const heartbeatAt = task.metadata?.['heartbeatAt'];

    // If there's a recent heartbeat, it's alive — skip
    if (typeof heartbeatAt === 'number' && now - heartbeatAt < config.staleThresholdMs) {
      continue;
    }

    // This task is a zombie — either stale heartbeat or no heartbeat at all
    const age = typeof heartbeatAt === 'number'
      ? `${Math.round((now - heartbeatAt) / 1000)}s ago`
      : 'no heartbeat';

    logger.warn(`Zombie detected: "${task.title}" (${task.id}) — last heartbeat: ${age}`);

    try {
      await applyZombiePolicy(task, config.zombiePolicy, gm, logger);
      recovered.push(task.id);
    } catch (err) {
      logger.error(`Zombie recovery failed for ${task.id}: ${String(err)}`);
    }
  }

  if (recovered.length) {
    logger.info(`Zombie recovery: ${recovered.length} task(s) recovered with policy "${config.zombiePolicy}"`);
  } else if (inProgressTasks.length === 0) {
    logger.info('Zombie recovery: no in_progress tasks found');
  } else {
    logger.info(`Zombie recovery: ${inProgressTasks.length} in_progress task(s) are all alive`);
  }

  return recovered;
}

async function applyZombiePolicy(
  task: Task,
  policy: ZombiePolicy,
  gm: GraphMemoryPort,
  logger: Logger,
): Promise<void> {
  // Clear heartbeat metadata regardless of policy
  await gm.updateTask(task.id, {
    metadata: { runId: null, heartbeatAt: null },
  });

  switch (policy) {
    case 'reset-to-todo':
      logger.info(`  → resetting "${task.title}" to todo`);
      await gm.moveTask(task.id, 'todo');
      break;
    case 'cancel':
      logger.info(`  → cancelling "${task.title}"`);
      await gm.moveTask(task.id, 'cancelled');
      break;
    case 'move-to-review':
      // Move to cancelled with a note — there's no "review" status,
      // so we cancel + tag for human inspection
      logger.info(`  → cancelling "${task.title}" for review (zombie)`);
      await gm.moveTask(task.id, 'cancelled');
      break;
  }
}
