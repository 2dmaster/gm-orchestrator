import { describe, it, expect } from 'vitest';
import { sortByPriority, isTerminal, areBlockersResolved, areBlockersResolvedAsync, countUnresolvedSoftPrereqs } from '../../src/core/task-utils.js';
import { makeTask, makeBlockedTask } from '../fixtures/factories.js';
import type { CrossProjectResolver } from '../../src/core/types.js';

describe('sortByPriority', () => {
  it('sorts critical before high before medium before low', () => {
    const tasks = [
      makeTask({ priority: 'low' }),
      makeTask({ priority: 'critical' }),
      makeTask({ priority: 'medium' }),
      makeTask({ priority: 'high' }),
    ];
    const sorted = sortByPriority(tasks);
    expect(sorted.map((t) => t.priority)).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('sorts by dueDate within same priority', () => {
    const tasks = [
      makeTask({ priority: 'high', dueDate: '2025-03-01' }),
      makeTask({ priority: 'high', dueDate: '2025-01-01' }),
      makeTask({ priority: 'high', dueDate: '2025-02-01' }),
    ];
    const sorted = sortByPriority(tasks);
    expect(sorted.map((t) => t.dueDate)).toEqual([
      '2025-01-01',
      '2025-02-01',
      '2025-03-01',
    ]);
  });

  it('puts tasks without dueDate last within same priority', () => {
    const tasks = [
      makeTask({ priority: 'high' }),
      makeTask({ priority: 'high', dueDate: '2025-06-01' }),
    ];
    const sorted = sortByPriority(tasks);
    expect(sorted[0]?.dueDate).toBe('2025-06-01');
    expect(sorted[1]?.dueDate).toBeUndefined();
  });

  it('does not mutate the original array', () => {
    const tasks = [makeTask({ priority: 'low' }), makeTask({ priority: 'critical' })];
    const original = [...tasks];
    sortByPriority(tasks);
    expect(tasks).toEqual(original);
  });
});

describe('isTerminal', () => {
  it('returns true for done', () => expect(isTerminal('done')).toBe(true));
  it('returns true for cancelled', () => expect(isTerminal('cancelled')).toBe(true));
  it('returns false for todo', () => expect(isTerminal('todo')).toBe(false));
  it('returns false for in_progress', () => expect(isTerminal('in_progress')).toBe(false));
});

describe('areBlockersResolved', () => {
  it('returns true when no blockedBy', () => {
    expect(areBlockersResolved(makeTask())).toBe(true);
  });

  it('returns true when all blockers are done', () => {
    const task = makeTask({
      blockedBy: [
        { id: 'b1', title: 'B1', status: 'done' },
        { id: 'b2', title: 'B2', status: 'done' },
      ],
    });
    expect(areBlockersResolved(task)).toBe(true);
  });

  it('returns false when any blocker is not done', () => {
    expect(areBlockersResolved(makeBlockedTask('in_progress'))).toBe(false);
    expect(areBlockersResolved(makeBlockedTask('todo'))).toBe(false);
  });

  it('returns false when blocker is cancelled by default', () => {
    expect(areBlockersResolved(makeBlockedTask('cancelled'))).toBe(false);
  });

  it('returns false when blockers are a mix of done and cancelled (default)', () => {
    const task = makeTask({
      blockedBy: [
        { id: 'b1', title: 'B1', status: 'done' },
        { id: 'b2', title: 'B2', status: 'cancelled' },
      ],
    });
    expect(areBlockersResolved(task)).toBe(false);
  });

  it('treats cancelled blocker as resolved when allowCancelledBlockers=true', () => {
    expect(areBlockersResolved(makeBlockedTask('cancelled'), true)).toBe(true);
    const mixed = makeTask({
      blockedBy: [
        { id: 'b1', title: 'B1', status: 'done' },
        { id: 'b2', title: 'B2', status: 'cancelled' },
      ],
    });
    expect(areBlockersResolved(mixed, true)).toBe(true);
  });

  it('still blocks on non-terminal statuses even with allowCancelledBlockers=true', () => {
    expect(areBlockersResolved(makeBlockedTask('in_progress'), true)).toBe(false);
    expect(areBlockersResolved(makeBlockedTask('todo'), true)).toBe(false);
  });
});

describe('areBlockersResolvedAsync', () => {
  it('returns true when no blockedBy', async () => {
    expect(await areBlockersResolvedAsync(makeTask())).toBe(true);
  });

  it('returns true for same-project blockers that are done', async () => {
    const task = makeTask({
      blockedBy: [{ id: 'b1', title: 'B1', status: 'done' }],
    });
    expect(await areBlockersResolvedAsync(task)).toBe(true);
  });

  it('resolves cross-project blockers via resolver', async () => {
    const task = makeTask({
      blockedBy: [{ id: 'remote-1', title: 'Remote', status: 'in_progress', projectId: 'other-project' }],
    });

    const resolver: CrossProjectResolver = async (_pid, _tid) => 'done';
    expect(await areBlockersResolvedAsync(task, resolver)).toBe(true);
  });

  it('returns false when cross-project blocker is not done', async () => {
    const task = makeTask({
      blockedBy: [{ id: 'remote-1', title: 'Remote', status: 'in_progress', projectId: 'other-project' }],
    });

    const resolver: CrossProjectResolver = async (_pid, _tid) => 'in_progress';
    expect(await areBlockersResolvedAsync(task, resolver)).toBe(false);
  });

  it('treats unreachable cross-project blockers as unresolved', async () => {
    const task = makeTask({
      blockedBy: [{ id: 'remote-1', title: 'Remote', status: 'in_progress', projectId: 'other-project' }],
    });

    const resolver: CrossProjectResolver = async (_pid, _tid) => undefined;
    expect(await areBlockersResolvedAsync(task, resolver)).toBe(false);
  });

  it('handles mix of same-project and cross-project blockers', async () => {
    const task = makeTask({
      blockedBy: [
        { id: 'local-1', title: 'Local', status: 'done' },
        { id: 'remote-1', title: 'Remote', status: 'in_progress', projectId: 'other-project' },
      ],
    });

    const resolver: CrossProjectResolver = async (_pid, _tid) => 'done';
    expect(await areBlockersResolvedAsync(task, resolver)).toBe(true);
  });

  it('returns false if any blocker is not done (mixed)', async () => {
    const task = makeTask({
      blockedBy: [
        { id: 'local-1', title: 'Local', status: 'done' },
        { id: 'remote-1', title: 'Remote', status: 'in_progress', projectId: 'other-project' },
      ],
    });

    const resolver: CrossProjectResolver = async (_pid, _tid) => 'in_progress';
    expect(await areBlockersResolvedAsync(task, resolver)).toBe(false);
  });

  it('returns false when same-project blocker is cancelled by default', async () => {
    const task = makeTask({
      blockedBy: [{ id: 'b1', title: 'B1', status: 'cancelled' }],
    });
    expect(await areBlockersResolvedAsync(task)).toBe(false);
  });

  it('returns false when cross-project blocker is cancelled by default', async () => {
    const task = makeTask({
      blockedBy: [{ id: 'remote-1', title: 'Remote', status: 'in_progress', projectId: 'other-project' }],
    });

    const resolver: CrossProjectResolver = async (_pid, _tid) => 'cancelled';
    expect(await areBlockersResolvedAsync(task, resolver)).toBe(false);
  });

  it('treats cancelled blockers as resolved when allowCancelledBlockers=true (same-project)', async () => {
    const task = makeTask({
      blockedBy: [{ id: 'b1', title: 'B1', status: 'cancelled' }],
    });
    expect(await areBlockersResolvedAsync(task, undefined, true)).toBe(true);
  });

  it('treats cancelled blockers as resolved when allowCancelledBlockers=true (cross-project)', async () => {
    const task = makeTask({
      blockedBy: [{ id: 'remote-1', title: 'Remote', status: 'in_progress', projectId: 'other-project' }],
    });

    const resolver: CrossProjectResolver = async (_pid, _tid) => 'cancelled';
    expect(await areBlockersResolvedAsync(task, resolver, true)).toBe(true);
  });

  it('uses embedded status for cross-project refs when no resolver', async () => {
    const task = makeTask({
      blockedBy: [{ id: 'remote-1', title: 'Remote', status: 'done', projectId: 'other-project' }],
    });
    // No resolver: falls back to embedded status
    expect(await areBlockersResolvedAsync(task)).toBe(true);
  });

  it('handles resolver errors gracefully (treated as unresolved)', async () => {
    const task = makeTask({
      blockedBy: [{ id: 'remote-1', title: 'Remote', status: 'in_progress', projectId: 'other-project' }],
    });

    const resolver: CrossProjectResolver = async () => { throw new Error('network'); };
    expect(await areBlockersResolvedAsync(task, resolver)).toBe(false);
  });
});

describe('countUnresolvedSoftPrereqs', () => {
  it('returns 0 when no prefersAfter', () => {
    expect(countUnresolvedSoftPrereqs(makeTask())).toBe(0);
  });

  it('returns 0 when all prefersAfter are done', () => {
    const task = makeTask({
      prefersAfter: [
        { id: 'a', title: 'A', status: 'done' },
        { id: 'b', title: 'B', status: 'cancelled' },
      ],
    });
    expect(countUnresolvedSoftPrereqs(task)).toBe(0);
  });

  it('counts unresolved prefersAfter refs', () => {
    const task = makeTask({
      prefersAfter: [
        { id: 'a', title: 'A', status: 'todo' },
        { id: 'b', title: 'B', status: 'done' },
        { id: 'c', title: 'C', status: 'in_progress' },
      ],
    });
    expect(countUnresolvedSoftPrereqs(task)).toBe(2);
  });
});

describe('sortByPriority — soft prerequisites (prefers_after)', () => {
  it('demotes a task with unresolved soft prereqs within the same priority tier', () => {
    const taskA = makeTask({ id: 'A', priority: 'high', title: 'No soft deps' });
    const taskB = makeTask({
      id: 'B',
      priority: 'high',
      title: 'Has soft dep',
      prefersAfter: [{ id: 'A', title: 'A', status: 'todo' }],
    });
    const sorted = sortByPriority([taskB, taskA]);
    expect(sorted.map((t) => t.id)).toEqual(['A', 'B']);
  });

  it('does not demote when soft prereqs are all resolved', () => {
    const taskA = makeTask({ id: 'A', priority: 'high', title: 'No soft deps' });
    const taskB = makeTask({
      id: 'B',
      priority: 'high',
      title: 'Soft dep done',
      prefersAfter: [{ id: 'A', title: 'A', status: 'done' }],
    });
    // Same priority, no penalty — falls to dueDate / insertion order
    const sorted = sortByPriority([taskB, taskA]);
    // Both have same effective priority; stable relative to dueDate (both Infinity)
    expect(sorted.map((t) => t.priority)).toEqual(['high', 'high']);
  });

  it('soft prereqs never invert priority — high with many soft deps still beats medium with none', () => {
    const highWithManySoftDeps = makeTask({
      id: 'H',
      priority: 'high',
      title: 'High with ten soft deps',
      prefersAfter: Array.from({ length: 10 }, (_, i) => ({
        id: `X${i}`,
        title: `X${i}`,
        status: 'todo' as const,
      })),
    });
    const mediumClean = makeTask({ id: 'M', priority: 'medium', title: 'Medium clean' });
    const sorted = sortByPriority([mediumClean, highWithManySoftDeps]);
    expect(sorted.map((t) => t.id)).toEqual(['H', 'M']);
  });

  it('soft prereqs never invert priority — high with soft deps still beats low with none', () => {
    const highWithSoftDep = makeTask({
      id: 'H',
      priority: 'high',
      title: 'High with soft dep',
      prefersAfter: [{ id: 'X', title: 'X', status: 'todo' }],
    });
    const lowTask = makeTask({ id: 'L', priority: 'low', title: 'Low task' });
    const sorted = sortByPriority([lowTask, highWithSoftDep]);
    expect(sorted.map((t) => t.id)).toEqual(['H', 'L']);
  });

  it('within the same priority, fewer unresolved soft prereqs wins', () => {
    const taskA = makeTask({ id: 'A', priority: 'high', title: 'Clean' });
    const taskB = makeTask({
      id: 'B',
      priority: 'high',
      title: 'Two soft deps',
      prefersAfter: [
        { id: 'X', title: 'X', status: 'todo' },
        { id: 'Y', title: 'Y', status: 'in_progress' },
      ],
    });
    const sorted = sortByPriority([taskB, taskA]);
    expect(sorted.map((t) => t.id)).toEqual(['A', 'B']);
  });

  it('unknown priority falls after all known priorities regardless of soft prereqs', () => {
    const lowWithManySoftDeps = makeTask({
      id: 'L',
      priority: 'low',
      title: 'Low with soft deps',
      prefersAfter: [
        { id: 'X', title: 'X', status: 'todo' },
        { id: 'Y', title: 'Y', status: 'todo' },
      ],
    });
    const unknownClean = makeTask({
      id: 'U',
      title: 'Unknown priority',
    });
    // Force an unknown priority value past the type system to simulate stale data.
    (unknownClean as unknown as { priority: string }).priority = 'nonsense';
    const sorted = sortByPriority([unknownClean, lowWithManySoftDeps]);
    expect(sorted.map((t) => t.id)).toEqual(['L', 'U']);
  });

  it('areBlockersResolved ignores prefersAfter (soft deps are not hard blockers)', () => {
    const task = makeTask({
      prefersAfter: [{ id: 'X', title: 'X', status: 'todo' }],
    });
    // No blockedBy → task is runnable
    expect(areBlockersResolved(task)).toBe(true);
  });
});
