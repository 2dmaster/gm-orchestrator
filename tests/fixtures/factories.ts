import type { Task, Epic, TaskStatus, TaskPriority } from '../../src/core/types.js';

let _id = 0;
function nextId(): string {
  return `task-${String(++_id).padStart(3, '0')}`;
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: nextId(),
    title: 'Test task',
    status: 'todo',
    priority: 'medium',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

export function makeEpic(overrides: Partial<Epic> = {}): Epic {
  return {
    id: `epic-${String(++_id).padStart(3, '0')}`,
    title: 'Test epic',
    status: 'todo',
    priority: 'medium',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    tasks: [],
    ...overrides,
  };
}

export function makeBlockedTask(blockerStatus: TaskStatus = 'in_progress'): Task {
  return makeTask({
    title: 'Blocked task',
    blockedBy: [{ id: 'blocker-1', title: 'Blocker', status: blockerStatus }],
  });
}

export function makeTasks(
  count: number,
  priority: TaskPriority = 'medium',
  status: TaskStatus = 'todo'
): Task[] {
  return Array.from({ length: count }, () => makeTask({ priority, status }));
}
