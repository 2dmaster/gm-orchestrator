import { describe, it, expect } from 'vitest';
import { sortByPriority, isTerminal, areBlockersResolved } from '../../src/core/task-utils.js';
import { makeTask, makeBlockedTask } from '../fixtures/factories.js';

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
