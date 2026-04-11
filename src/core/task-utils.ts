import type { Task, TaskPriority, TaskRef, TaskStatus, CrossProjectResolver } from './types.js';

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const UNKNOWN_PRIORITY_SCORE = 4;

function priorityScore(task: Task): number {
  return PRIORITY_ORDER[task.priority] ?? UNKNOWN_PRIORITY_SCORE;
}

/**
 * Count how many `prefersAfter` refs are still unresolved
 * (i.e. not in a terminal state: done or cancelled).
 */
export function countUnresolvedSoftPrereqs(task: Task): number {
  if (!task.prefersAfter?.length) return 0;
  return task.prefersAfter.filter((ref: TaskRef) => !isTerminal(ref.status)).length;
}

/**
 * Sort order (strict axes, highest to lowest precedence):
 *   1. priority tier (critical < high < medium < low < unknown)
 *   2. fewer unresolved `prefersAfter` refs first (soft prereqs)
 *   3. earliest dueDate first (missing = last)
 *
 * Soft prereqs are a separate axis — they can reorder tasks within a priority
 * tier but never cross a priority boundary. A `high` task with ten unresolved
 * soft prereqs still runs before a `medium` with none.
 */
export function sortByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pa = priorityScore(a);
    const pb = priorityScore(b);
    if (pa !== pb) return pa - pb;

    const sa = countUnresolvedSoftPrereqs(a);
    const sb = countUnresolvedSoftPrereqs(b);
    if (sa !== sb) return sa - sb;

    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return da - db;
  });
}

export function isTerminal(status: string): boolean {
  return status === 'done' || status === 'cancelled';
}

/**
 * A blocker is resolved when it is `done`. By default `cancelled` upstream
 * tasks are NOT treated as resolved — a cancellation means the prerequisite
 * work was not completed, so dependents should not run. Pass
 * `allowCancelledBlockers: true` to opt back into the looser semantics
 * (useful when you intentionally want cancellations to unblock the chain).
 */
function isBlockerResolvedStatus(
  status: TaskStatus | string | undefined,
  allowCancelledBlockers: boolean,
): boolean {
  if (status === 'done') return true;
  if (allowCancelledBlockers && status === 'cancelled') return true;
  return false;
}

export function areBlockersResolved(task: Task, allowCancelledBlockers = false): boolean {
  if (!task.blockedBy?.length) return true;
  return task.blockedBy.every((b) => isBlockerResolvedStatus(b.status, allowCancelledBlockers));
}

/**
 * Async variant that resolves cross-project blockers on the fly.
 * Same-project blockers (no `projectId` on the ref) use the embedded status.
 * Cross-project blockers are resolved via the provided resolver.
 *
 * If the resolver returns undefined (unreachable project), the blocker
 * is treated as unresolved (conservative — don't run if we can't verify).
 */
export async function areBlockersResolvedAsync(
  task: Task,
  resolver?: CrossProjectResolver,
  allowCancelledBlockers = false,
): Promise<boolean> {
  if (!task.blockedBy?.length) return true;

  const results = await Promise.all(
    task.blockedBy.map(async (b) => {
      // Cross-project blocker: fetch live status
      if (b.projectId && resolver) {
        const status = await resolver(b.projectId, b.id).catch(() => undefined);
        return isBlockerResolvedStatus(status, allowCancelledBlockers);
      }
      // Same-project: use embedded status
      return isBlockerResolvedStatus(b.status, allowCancelledBlockers);
    }),
  );

  return results.every(Boolean);
}
