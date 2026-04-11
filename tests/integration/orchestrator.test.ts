import { describe, it, expect, beforeEach } from 'vitest';
import { runSprint, runEpic, collectCrossProjectEpicTasks } from '../../src/core/orchestrator.js';
import { FakeGraphMemory, FakePoller, FakeRunner, FakeCrossProjectResolver, FakeHookRunner } from '../fixtures/fakes.js';
import { silentLogger } from '../../src/infra/logger.js';
import { makeTask, makeEpic } from '../fixtures/factories.js';
import type { OrchestratorConfig, CrossProjectResolver, PostTaskHook } from '../../src/core/types.js';

const BASE_CONFIG: OrchestratorConfig = {
  projects: [{ baseUrl: 'http://localhost:3000', projectId: 'test' }],
  activeProjectId: 'test',
  concurrency: 1,
  timeoutMs: 5_000,
  pauseMs: 0,
  maxRetries: 1,
  claudeArgs: [],
  dryRun: false,
};

function makePorts(gm: FakeGraphMemory, poller: FakePoller, runner: FakeRunner, hookRunner?: FakeHookRunner) {
  return { gm, runner, poller, logger: silentLogger, ...(hookRunner ? { hookRunner } : {}) };
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

  it('passes a unique runId to the runner for idempotency', async () => {
    const t1 = makeTask({ id: 'idem-1' });
    const t2 = makeTask({ id: 'idem-2' });
    gm.addTask(t1);
    gm.addTask(t2);
    poller.setResult('idem-1', 'done');
    poller.setResult('idem-2', 'done');

    await runSprint(makePorts(gm, poller, runner), BASE_CONFIG);

    // Each task run should receive a unique runId (UUID)
    expect(runner.calls).toHaveLength(2);
    const runId1 = runner.calls[0]?.runId;
    const runId2 = runner.calls[1]?.runId;
    expect(runId1).toBeTruthy();
    expect(runId2).toBeTruthy();
    expect(runId1).not.toBe(runId2);
  });

  it('writes runId to task metadata via heartbeat before spawning runner', async () => {
    const task = makeTask({ id: 'idem-meta' });
    gm.addTask(task);
    poller.setResult('idem-meta', 'done');

    await runSprint(makePorts(gm, poller, runner), BASE_CONFIG);

    // Heartbeat should have written metadata.runId
    const metaCall = gm.calls.updateTask.find(
      (c) => c.taskId === 'idem-meta' && (c.fields.metadata as Record<string, unknown>)?.['runId'] != null,
    );
    expect(metaCall).toBeDefined();

    // The runId written to metadata should match the one passed to the runner
    const writtenRunId = (metaCall!.fields.metadata as Record<string, unknown>)?.['runId'];
    expect(writtenRunId).toBe(runner.calls[0]?.runId);
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

// ── Cross-Project Blockers ──────────────────────────────────────────────

describe('cross-project blocker resolution', () => {
  let gm: FakeGraphMemory;
  let poller: FakePoller;
  let runner: FakeRunner;

  beforeEach(() => {
    gm = new FakeGraphMemory();
    poller = makePoller(gm);
    runner = new FakeRunner();
  });

  it('runs task when cross-project blocker is done', async () => {
    const remoteGm = new FakeGraphMemory();
    remoteGm.addTask(makeTask({ id: 'remote-dep', status: 'done' }));

    const crossResolver = new FakeCrossProjectResolver();
    crossResolver.addProject('other-project', remoteGm);

    const task = makeTask({
      id: 'local-task',
      blockedBy: [{ id: 'remote-dep', title: 'Remote Dep', status: 'in_progress', projectId: 'other-project' }],
    });
    gm.addTask(task);
    poller.setResult('local-task', 'done');

    const ports = { ...makePorts(gm, poller, runner), crossProjectResolver: crossResolver.resolver };
    const stats = await runSprint(ports, BASE_CONFIG);

    expect(stats.done).toBe(1);
    expect(runner.calls.map((c) => c.taskId)).toContain('local-task');
  });

  it('blocks task when cross-project blocker is not done', async () => {
    const remoteGm = new FakeGraphMemory();
    remoteGm.addTask(makeTask({ id: 'remote-dep', status: 'in_progress' }));

    const crossResolver = new FakeCrossProjectResolver();
    crossResolver.addProject('other-project', remoteGm);

    const task = makeTask({
      id: 'local-task',
      blockedBy: [{ id: 'remote-dep', title: 'Remote Dep', status: 'in_progress', projectId: 'other-project' }],
    });
    gm.addTask(task);

    const ports = { ...makePorts(gm, poller, runner), crossProjectResolver: crossResolver.resolver };
    const stats = await runSprint(ports, BASE_CONFIG);

    expect(stats.done).toBe(0);
    expect(runner.calls).toHaveLength(0);
  });

  it('blocks task when cross-project is unreachable (conservative)', async () => {
    // No project added to the resolver — simulates unreachable project
    const crossResolver = new FakeCrossProjectResolver();

    const task = makeTask({
      id: 'local-task',
      blockedBy: [{ id: 'remote-dep', title: 'Remote Dep', status: 'done', projectId: 'unknown-project' }],
    });
    gm.addTask(task);

    const ports = { ...makePorts(gm, poller, runner), crossProjectResolver: crossResolver.resolver };
    const stats = await runSprint(ports, BASE_CONFIG);

    expect(stats.done).toBe(0);
    expect(runner.calls).toHaveLength(0);
  });

  it('runs unblocked task while cross-project blocked task waits', async () => {
    const remoteGm = new FakeGraphMemory();
    remoteGm.addTask(makeTask({ id: 'remote-dep', status: 'in_progress' }));

    const crossResolver = new FakeCrossProjectResolver();
    crossResolver.addProject('other-project', remoteGm);

    const blocked = makeTask({
      id: 'blocked-task',
      priority: 'critical',
      blockedBy: [{ id: 'remote-dep', title: 'Remote Dep', status: 'in_progress', projectId: 'other-project' }],
    });
    const free = makeTask({ id: 'free-task', priority: 'low' });
    gm.addTask(blocked);
    gm.addTask(free);
    poller.setResult('free-task', 'done');

    const ports = { ...makePorts(gm, poller, runner), crossProjectResolver: crossResolver.resolver };
    const stats = await runSprint(ports, BASE_CONFIG);

    expect(stats.done).toBe(1);
    expect(runner.calls.map((c) => c.taskId)).toContain('free-task');
    expect(runner.calls.map((c) => c.taskId)).not.toContain('blocked-task');
  });

  it('works without resolver — falls back to embedded status', async () => {
    const task = makeTask({
      id: 'local-task',
      blockedBy: [{ id: 'remote-dep', title: 'Remote Dep', status: 'done', projectId: 'other-project' }],
    });
    gm.addTask(task);
    poller.setResult('local-task', 'done');

    // No crossProjectResolver — uses embedded status
    const ports = makePorts(gm, poller, runner);
    const stats = await runSprint(ports, BASE_CONFIG);

    expect(stats.done).toBe(1);
  });
});

// ── Cross-Project Epic Tasks ────────────────────────────────────────────

describe('collectCrossProjectEpicTasks', () => {
  it('collects tasks from multiple projects', async () => {
    const homeGm = new FakeGraphMemory();
    const remoteGm = new FakeGraphMemory();

    const homeTask = makeTask({ id: 'home-t1', title: 'Home task' });
    const remoteTask = makeTask({ id: 'remote-t1', title: 'Remote task' });

    homeGm.addTask(homeTask);
    remoteGm.addTask(remoteTask);

    const epic = makeEpic({
      id: 'cross-epic',
      tasks: [
        { id: 'home-t1', title: 'Home task', status: 'todo' },
        { id: 'remote-t1', title: 'Remote task', status: 'todo', projectId: 'remote-project' },
      ],
    });
    homeGm.addEpic(epic);

    const resolveGm = (pid: string) => {
      if (pid === 'remote-project') return remoteGm;
      throw new Error(`Unknown project: ${pid}`);
    };

    const result = await collectCrossProjectEpicTasks(
      'cross-epic',
      { gm: homeGm, logger: silentLogger },
      resolveGm,
      'home-project',
    );

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.find((t) => t.id === 'home-t1')?.sourceProjectId).toBe('home-project');
    expect(result.tasks.find((t) => t.id === 'remote-t1')?.sourceProjectId).toBe('remote-project');
  });

  it('handles unreachable projects gracefully', async () => {
    const homeGm = new FakeGraphMemory();
    const homeTask = makeTask({ id: 'home-t1', title: 'Home task' });
    homeGm.addTask(homeTask);

    const epic = makeEpic({
      id: 'cross-epic',
      tasks: [
        { id: 'home-t1', title: 'Home task', status: 'todo' },
        { id: 'remote-t1', title: 'Remote task', status: 'todo', projectId: 'dead-project' },
      ],
    });
    homeGm.addEpic(epic);

    const resolveGm = (_pid: string) => {
      throw new Error('Unreachable');
    };

    const result = await collectCrossProjectEpicTasks(
      'cross-epic',
      { gm: homeGm, logger: silentLogger },
      resolveGm,
      'home-project',
    );

    // Only the home task should be collected
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.id).toBe('home-t1');
  });
});

// ── Post-Task Verification Hooks ──────────────────────────────────────────

describe('post-task verification hooks', () => {
  let gm: FakeGraphMemory;
  let poller: FakePoller;
  let runner: FakeRunner;
  let hookRunner: FakeHookRunner;

  const VERIFY_HOOK: PostTaskHook = {
    name: 'make-verify',
    command: 'make verify',
    onFailure: 'block',
  };

  beforeEach(() => {
    gm = new FakeGraphMemory();
    poller = makePoller(gm);
    runner = new FakeRunner();
    hookRunner = new FakeHookRunner();
  });

  it('accepts task completion when all hooks pass', async () => {
    gm.addTask(makeTask({ id: 'task-1' }));
    poller.setResult('task-1', 'done');

    const config = { ...BASE_CONFIG, postTaskHooks: [VERIFY_HOOK] };
    const stats = await runSprint(makePorts(gm, poller, runner, hookRunner), config);

    expect(stats.done).toBe(1);
    expect(stats.errors).toBe(0);
    expect(hookRunner.calls).toHaveLength(1);
    expect(hookRunner.calls[0]?.name).toBe('make-verify');
  });

  it('rejects task when blocking hook fails — marks verify_failed', async () => {
    gm.addTask(makeTask({ id: 'task-1' }));
    poller.setResult('task-1', 'done');
    hookRunner.setFailure('make-verify', 1, 'tests failed');

    const config = { ...BASE_CONFIG, postTaskHooks: [VERIFY_HOOK] };
    const stats = await runSprint(makePorts(gm, poller, runner, hookRunner), config);

    expect(stats.done).toBe(0);
    expect(stats.errors).toBe(1);
  });

  it('adds auto-verify-failed tag to task on hook failure', async () => {
    gm.addTask(makeTask({ id: 'task-1', tags: ['backend'] }));
    poller.setResult('task-1', 'done');
    hookRunner.setFailure('make-verify', 1, 'build error');

    const config = { ...BASE_CONFIG, postTaskHooks: [VERIFY_HOOK] };
    await runSprint(makePorts(gm, poller, runner, hookRunner), config);

    // Find the updateTask call that has tags (not the heartbeat metadata-only calls)
    const updateCall = gm.calls.updateTask.find(
      (c) => c.taskId === 'task-1' && c.fields.tags !== undefined,
    );
    expect(updateCall?.fields.tags).toContain('auto-verify-failed');
    expect(updateCall?.fields.tags).toContain('backend');
  });

  it('halts sprint when verify fails — does not run subsequent tasks', async () => {
    gm.addTask(makeTask({ id: 'task-1', priority: 'critical' }));
    gm.addTask(makeTask({ id: 'task-2', priority: 'low' }));
    poller.setResult('task-1', 'done');
    poller.setResult('task-2', 'done');
    hookRunner.setFailure('make-verify', 1, 'fail');

    const config = { ...BASE_CONFIG, postTaskHooks: [VERIFY_HOOK] };
    const stats = await runSprint(makePorts(gm, poller, runner, hookRunner), config);

    // task-1 fails verify, sprint should halt and not run task-2
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.taskId).toBe('task-1');
    expect(stats.errors).toBe(1);
    expect(stats.done).toBe(0);
  });

  it('does not retry verify_failed tasks', async () => {
    gm.addTask(makeTask({ id: 'task-1' }));
    poller.setResult('task-1', 'done');
    hookRunner.setFailure('make-verify', 1, 'fail');

    const config = { ...BASE_CONFIG, postTaskHooks: [VERIFY_HOOK], maxRetries: 3 };
    const stats = await runSprint(makePorts(gm, poller, runner, hookRunner), config);

    // Should NOT retry — verify_failed is not retryable
    expect(runner.calls).toHaveLength(1);
    expect(stats.retried).toBe(0);
    expect(stats.errors).toBe(1);
  });

  it('skips hooks when no hookRunner is provided', async () => {
    gm.addTask(makeTask({ id: 'task-1' }));
    poller.setResult('task-1', 'done');

    // Config has hooks but no hookRunner in ports
    const config = { ...BASE_CONFIG, postTaskHooks: [VERIFY_HOOK] };
    const stats = await runSprint(makePorts(gm, poller, runner), config);

    expect(stats.done).toBe(1); // hooks silently skipped
  });

  it('skips hooks when postTaskHooks is empty', async () => {
    gm.addTask(makeTask({ id: 'task-1' }));
    poller.setResult('task-1', 'done');

    const config = { ...BASE_CONFIG, postTaskHooks: [] };
    const stats = await runSprint(makePorts(gm, poller, runner, hookRunner), config);

    expect(stats.done).toBe(1);
    expect(hookRunner.calls).toHaveLength(0);
  });

  it('runs multiple hooks in order, stops on first block failure', async () => {
    const hooks: PostTaskHook[] = [
      { name: 'lint', command: 'npm run lint', onFailure: 'block' },
      { name: 'test', command: 'npm test', onFailure: 'block' },
      { name: 'build', command: 'npm run build', onFailure: 'block' },
    ];
    hookRunner.setFailure('test', 1, 'test failure');

    gm.addTask(makeTask({ id: 'task-1' }));
    poller.setResult('task-1', 'done');

    const config = { ...BASE_CONFIG, postTaskHooks: hooks };
    const stats = await runSprint(makePorts(gm, poller, runner, hookRunner), config);

    expect(stats.errors).toBe(1);
    // lint ran (passed), test ran (failed), build never ran
    expect(hookRunner.calls.map((c) => c.name)).toEqual(['lint', 'test']);
  });

  it('continues past warn-mode hook failures', async () => {
    const hooks: PostTaskHook[] = [
      { name: 'lint', command: 'npm run lint', onFailure: 'warn' },
      { name: 'test', command: 'npm test', onFailure: 'block' },
    ];
    hookRunner.setFailure('lint', 1, 'lint warnings');

    gm.addTask(makeTask({ id: 'task-1' }));
    poller.setResult('task-1', 'done');

    const config = { ...BASE_CONFIG, postTaskHooks: hooks };
    const stats = await runSprint(makePorts(gm, poller, runner, hookRunner), config);

    expect(stats.done).toBe(1); // warn failure doesn't block
    expect(hookRunner.calls).toHaveLength(2);
  });

  it('does not run hooks for cancelled tasks', async () => {
    gm.addTask(makeTask({ id: 'task-1' }));
    poller.setResult('task-1', 'cancelled');

    const config = { ...BASE_CONFIG, postTaskHooks: [VERIFY_HOOK] };
    await runSprint(makePorts(gm, poller, runner, hookRunner), config);

    expect(hookRunner.calls).toHaveLength(0);
  });

  it('does not run hooks for timed-out tasks', async () => {
    gm.addTask(makeTask({ id: 'task-1' }));
    poller.setResult('task-1', 'timeout');

    const config = { ...BASE_CONFIG, postTaskHooks: [VERIFY_HOOK] };
    await runSprint(makePorts(gm, poller, runner, hookRunner), config);

    expect(hookRunner.calls).toHaveLength(0);
  });
});
