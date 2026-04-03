import type { Task, TaskPriority, CrossProjectResolver } from './types.js';

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function sortByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 4;
    const pb = PRIORITY_ORDER[b.priority] ?? 4;
    if (pa !== pb) return pa - pb;
    // Secondary: earliest dueDate
    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return da - db;
  });
}

export function isTerminal(status: string): boolean {
  return status === 'done' || status === 'cancelled';
}

export function areBlockersResolved(task: Task): boolean {
  if (!task.blockedBy?.length) return true;
  return task.blockedBy.every((b) => b.status === 'done');
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
): Promise<boolean> {
  if (!task.blockedBy?.length) return true;

  const results = await Promise.all(
    task.blockedBy.map(async (b) => {
      // Cross-project blocker: fetch live status
      if (b.projectId && resolver) {
        const status = await resolver(b.projectId, b.id).catch(() => undefined);
        return status === 'done';
      }
      // Same-project: use embedded status
      return b.status === 'done';
    }),
  );

  return results.every(Boolean);
}
