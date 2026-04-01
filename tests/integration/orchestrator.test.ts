import { describe, it, expect, beforeEach } from 'vitest';
import { runSprint, runEpic } from '../../src/core/orchestrator.js';
import { FakeGraphMemory, FakePoller, FakeRunner } from '../fixtures/fakes.js';
import { silentLogger } from '../../src/infra/logger.js';
import { makeTask, makeEpic } from '../fixtures/factories.js';
import type { OrchestratorConfig } from '../../src/core/types.js';

const BASE_CONFIG: OrchestratorConfig = {
  baseUrl: 'http://localhost:3000',
  projectId: 'test',
  timeoutMs: 5_000,
  pauseMs: 0,
  maxRetries: 1,
  claudeArgs: [],
  dryRun: false,
};

function makePorts(gm: FakeGraphMemory, poller: FakePoller, runner: FakeRunner) {
  return { gm, runner, poller, logger: silentLogger };
}

/** Helper: create a pre-wired poller that knows about the gm instance */
function makePoller(gm: FakeGraphMemory): FakePoller {
  return new FakePoller(gm);
}

// ── Sprint ────────────────────────────────────────────────────────────────

describe('runSprint', () => {
  let gm: FakeGraphMemory;
  let poller: FakePoller;
  let runner: FakeRunner;

  beforeEach(() => {
    gm = new FakeGraphMemory();
    poller = makePoller(gm);
    runner = new FakeRunner();
  });

  it('returns immediately when no tasks', async () => {
    const stats = await runSprint(makePorts(gm, poller, runner), BASE_CONFIG);
    expect(stats.done).toBe(0);
    expect(runner.calls).toHaveLength(0);
  });

  it('runs a single task and marks it done', async () => {
    const task = makeTask({ id: 'task-1' });
    gm.addTask(task);
    poller.setResult('task-1', 'done');

    const stats = await runSprint(makePorts(gm, poller, runner), BASE_CONFIG);

    expect(stats.done).toBe(1);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.taskId).toBe('task-1');
  });

  it('marks task in_progress before running', async () => {
    const task = makeTask({ id: 'task-1', status: 'todo' });
    gm.addTask(task);
    poller.setResult('task-1', 'done');

    await runSprint(makePorts(gm, poller, runner), BASE_CONFIG);

    const inProgressCall = gm.calls.moveTask.find(
      (c) => c.taskId === 'task-1' && c.status === 'in_progress'
    );
    expect(inProgressCall).toBeDefined();
  });

  it('runs tasks in priority order: critical before high before medium', async () => {
    const t1 = makeTask({ id: 'low-1', priority: 'low' });
    const t2 = makeTask({ id: 'high-1', priority: 'high' });
    const t3 = makeTask({ id: 'crit-1', priority: 'critical' });
    gm.addTask(t1);
    gm.addTask(t2);
    gm.addTask(t3);
    poller.setResult('low-1', 'done');
    poller.setResult('high-1', 'done');
    poller.setResult('crit-1', 'done');

    await runSprint(makePorts(gm, poller, runner), BASE_CONFIG);

    const order = runner.calls.map((c) => c.taskId);
    expect(order.indexOf('crit-1')).toBeLessThan(order.indexOf('high-1'));
    expect(order.indexOf('high-1')).toBeLessThan(order.indexOf('low-1'));
  });

  it('skips blocked tasks and runs unblocked ones', async () => {
    const blocked = makeTask({
      id: 'blocked-1',
      blockedBy: [{ id: 'dep', title: 'Dep', status: 'in_progress' }],
    });
    const free = makeTask({ id: 'free-1' });
    gm.addTask(blocked);
    gm.addTask(free);
    poller.setResult('free-1', 'done');

    const stats = await runSprint(makePorts(gm, poller, runner), BASE_CONFIG);

    expect(stats.done).toBe(1);
    expect(stats.skipped).toBe(0); // blocked, not skipped by filter
    expect(runner.calls.map((c) => c.taskId)).not.toContain('blocked-1');
  });

  it('handles cancelled task — does not retry', async () => {
    const task = makeTask({ id: 'task-x' });
    gm.addTask(task);
    poller.setResult('task-x', 'cancelled');

    const stats = await runSprint(makePorts(gm, poller, runner), BASE_CONFIG);

    expect(stats.cancelled).toBe(1);
    expect(stats.retried).toBe(0);
    expect(runner.calls).toHaveLength(1);
  });

  it('retries timed-out task up to maxRetries, then cancels', async () => {
    const task = makeTask({ id: 'slow-1' });
    gm.addTask(task);

    // Always returns timeout
    poller.setResult('slow-1', 'timeout');

    const stats = await runSprint(
      makePorts(gm, poller, runner),
      { ...BASE_CONFIG, maxRetries: 2 }
    );

    expect(stats.retried).toBe(2);
    expect(stats.errors).toBe(1);
    // Should have been moved to cancelled eventually
    const cancelCall = gm.calls.moveTask.find(
      (c) => c.taskId === 'slow-1' && c.status === 'cancelled'
    );
    expect(cancelCall).toBeDefined();
  });

  it('resumes in_progress tasks first', async () => {
    const inProgress = makeTask({ id: 'wip-1', status: 'in_progress', priority: 'low' });
    const todo = makeTask({ id: 'todo-1', status: 'todo', priority: 'critical' });
    gm.addTask(inProgress);
    gm.addTask(todo);
    poller.setResult('wip-1', 'done');
    poller.setResult('todo-1', 'done');

    await runSprint(makePorts(gm, poller, runner), BASE_CONFIG);

    // in_progress should run before critical todo
    expect(runner.calls[0]?.taskId).toBe('wip-1');
  });

  it('dry run does not spawn runner', async () => {
    gm.addTask(makeTask({ id: 'task-1' }));

    const stats = await runSprint(
      makePorts(gm, poller, runner),
      { ...BASE_CONFIG, dryRun: true }
    );

    expect(runner.calls).toHaveLength(0);
    expect(stats.done).toBeGreaterThanOrEqual(0);
  });

  it('filters tasks by tag when configured', async () => {
    const tagged = makeTask({ id: 'be-1', tags: ['backend'] });
    const untagged = makeTask({ id: 'fe-1', tags: ['frontend'] });
    gm.addTask(tagged);
    gm.addTask(untagged);
    poller.setResult('be-1', 'done');

    await runSprint(
      makePorts(gm, poller, runner),
      { ...BASE_CONFIG, tag: 'backend' }
    );

    expect(runner.calls.map((c) => c.taskId)).toContain('be-1');
    expect(runner.calls.map((c) => c.taskId)).not.toContain('fe-1');
  });

  it('returns duration in stats', async () => {
    const stats = await runSprint(makePorts(gm, poller, runner), BASE_CONFIG);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ── Epic ──────────────────────────────────────────────────────────────────

describe('runEpic', () => {
  let gm: FakeGraphMemory;
  let poller: FakePoller;
  let runner: FakeRunner;

  beforeEach(() => {
    gm = new FakeGraphMemory();
    poller = makePoller(gm);
    runner = new FakeRunner();
  });

  it('throws when epic not found', async () => {
    await expect(
      runEpic('nonexistent', makePorts(gm, poller, runner), BASE_CONFIG)
    ).rejects.toThrow('Epic not found');
  });

  it('runs all tasks in an epic', async () => {
    const t1 = makeTask({ id: 't1' });
    const t2 = makeTask({ id: 't2' });
    const epic = makeEpic({
      id: 'epic-1',
      tasks: [{ id: 't1', title: t1.title, status: 'todo' }, { id: 't2', title: t2.title, status: 'todo' }],
    });
    gm.addTask(t1);
    gm.addTask(t2);
    gm.addEpic(epic);
    poller.setResult('t1', 'done');
    poller.setResult('t2', 'done');

    const stats = await runEpic('epic-1', makePorts(gm, poller, runner), BASE_CONFIG);

    expect(stats.done).toBe(2);
  });

  it('marks epic done when all tasks complete', async () => {
    const t1 = makeTask({ id: 't1' });
    const epic = makeEpic({
      id: 'epic-1',
      tasks: [{ id: 't1', title: t1.title, status: 'todo' }],
    });
    gm.addTask(t1);
    gm.addEpic(epic);
    poller.setResult('t1', 'done');

    await runEpic('epic-1', makePorts(gm, poller, runner), BASE_CONFIG);

    const epicDoneCall = gm.calls.moveEpic.find(
      (c) => c.epicId === 'epic-1' && c.status === 'done'
    );
    expect(epicDoneCall).toBeDefined();
  });

  it('does not mark epic done if some tasks cancelled', async () => {
    const t1 = makeTask({ id: 't1' });
    const t2 = makeTask({ id: 't2' });
    const epic = makeEpic({
      id: 'epic-1',
      tasks: [
        { id: 't1', title: t1.title, status: 'todo' },
        { id: 't2', title: t2.title, status: 'todo' },
      ],
    });
    gm.addTask(t1);
    gm.addTask(t2);
    gm.addEpic(epic);
    poller.setResult('t1', 'done');
    poller.setResult('t2', 'cancelled');

    await runEpic('epic-1', makePorts(gm, poller, runner), BASE_CONFIG);

    const epicDoneCall = gm.calls.moveEpic.find((c) => c.status === 'done');
    expect(epicDoneCall).toBeUndefined();
  });

  it('skips already-done tasks in epic', async () => {
    const t1 = makeTask({ id: 't1', status: 'done' });
    const epic = makeEpic({
      id: 'epic-1',
      tasks: [{ id: 't1', title: t1.title, status: 'done' }],
    });
    gm.addTask(t1);
    gm.addEpic(epic);

    const stats = await runEpic('epic-1', makePorts(gm, poller, runner), BASE_CONFIG);

    expect(runner.calls).toHaveLength(0);
    expect(stats.done).toBe(0);
  });
});
