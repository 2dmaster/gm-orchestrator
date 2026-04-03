import { describe, it, expect } from 'vitest';
import { sortByPriority, isTerminal, areBlockersResolved, areBlockersResolvedAsync } from '../../src/core/task-utils.js';
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

  it('returns false when blocker is cancelled (not done)', () => {
    expect(areBlockersResolved(makeBlockedTask('cancelled'))).toBe(false);
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
