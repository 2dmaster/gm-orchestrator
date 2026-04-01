import type { Task, TaskPriority } from './types.js';

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
