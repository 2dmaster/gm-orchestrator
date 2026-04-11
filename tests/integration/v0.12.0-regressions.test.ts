/**
 * v0.12.0 regression audit — integration tests.
 *
 * One test per user-visible symptom reported in the v0.12.0 audit. These are
 * deliberately grouped in a single file (tagged in the describe name) so they
 * are easy to locate, and so future refactors can quickly confirm the symptom
 * still does not regress. Individual unit tests covering the underlying
 * helpers live next to the code they exercise; these tests drive the real
 * orchestrator loop end-to-end against in-memory fakes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runSprint, runEpic } from '../../src/core/orchestrator.js';
import { startHeartbeat } from '../../src/core/heartbeat.js';
import {
  FakeGraphMemory,
  FakePoller,
  FakeRunner,
  FakeHookRunner,
} from '../fixtures/fakes.js';
import { makeTask, makeEpic } from '../fixtures/factories.js';
import { silentLogger } from '../../src/infra/logger.js';
import type {
  OrchestratorConfig,
  PostTaskHook,
  HeartbeatConfig,
} from '../../src/core/types.js';

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

const VERIFY_HOOK: PostTaskHook = {
  name: 'make-verify',
  command: 'make verify',
  onFailure: 'block',
};

function makePorts(
  gm: FakeGraphMemory,
  poller: FakePoller,
  runner: FakeRunner,
  hookRunner?: FakeHookRunner,
) {
  return {
    gm,
    runner,
    poller,
    logger: silentLogger,
    ...(hookRunner ? { hookRunner } : {}),
  };
}

describe('v0.12.0 regression audit', () => {
  let gm: FakeGraphMemory;
  let poller: FakePoller;
  let runner: FakeRunner;
  let hookRunner: FakeHookRunner;

  beforeEach(() => {
    gm = new FakeGraphMemory();
    poller = new FakePoller(gm);
    runner = new FakeRunner();
    hookRunner = new FakeHookRunner();
  });

  // #1 ─────────────────────────────────────────────────────────────────────
  it('#1 upstream cancelled → dependent does not run (default config)', async () => {
    const upstream = makeTask({ id: 'up', status: 'cancelled' });
    const downstream = makeTask({
      id: 'down',
      blockedBy: [{ id: 'up', title: 'upstream', status: 'cancelled' }],
    });
    const epic = makeEpic({
      id: 'epic-1',
      tasks: [
        { id: 'up', title: 'upstream', status: 'cancelled' },
        { id: 'down', title: 'downstream', status: 'todo' },
      ],
    });
    gm.addTask(upstream);
    gm.addTask(downstream);
    gm.addEpic(epic);
    poller.setResult('down', 'done');

    await runEpic('epic-1', makePorts(gm, poller, runner), BASE_CONFIG);

    expect(runner.calls.find((c) => c.taskId === 'down')).toBeUndefined();
  });

  // #2 ─────────────────────────────────────────────────────────────────────
  it('#2 verify-failed task is not re-picked on simulated orchestrator restart', async () => {
    gm.addTask(makeTask({ id: 'task-1' }));
    poller.setResult('task-1', 'done');
    hookRunner.setFailure('make-verify', 1, 'fail');

    const config = { ...BASE_CONFIG, postTaskHooks: [VERIFY_HOOK] };

    // First sprint: verification fails and the task is moved to a terminal
    // state with the auto-verify-failed tag.
    await runSprint(makePorts(gm, poller, runner, hookRunner), config);
    expect(runner.calls).toHaveLength(1);

    const after = await gm.getTask('task-1');
    expect(after.status).toBe('cancelled');
    expect(after.tags).toContain('auto-verify-failed');

    // Simulate restart: a fresh sprint must not re-pick the task, and the
    // failure metadata must still be on the task (not clobbered by heartbeat
    // stop or zombie recovery).
    runner.calls.length = 0;
    hookRunner.calls.length = 0;
    await runSprint(makePorts(gm, poller, runner, hookRunner), config);

    expect(runner.calls).toHaveLength(0);
    expect(hookRunner.calls).toHaveLength(0);

    const stillAfter = await gm.getTask('task-1');
    const meta = stillAfter.metadata as Record<string, unknown> | undefined;
    expect(meta?.['verifyFailedAt']).toBeTypeOf('number');
    expect(meta?.['verifyFailures']).toBeDefined();
  });

  // #3 ─────────────────────────────────────────────────────────────────────
  it('#3 epic with a cancelled task transitions to done, not stuck open', async () => {
    const t1 = makeTask({ id: 't1' });
    const t2 = makeTask({ id: 't2' });
    const epic = makeEpic({
      id: 'epic-1',
      tasks: [
        { id: 't1', title: 't1', status: 'todo' },
        { id: 't2', title: 't2', status: 'todo' },
      ],
    });
    gm.addTask(t1);
    gm.addTask(t2);
    gm.addEpic(epic);
    poller.setResult('t1', 'done');
    poller.setResult('t2', 'cancelled');

    await runEpic('epic-1', makePorts(gm, poller, runner), BASE_CONFIG);

    // Epic must be explicitly moved to a terminal state — not left open.
    const terminalMove = gm.calls.moveEpic.find(
      (c) => c.epicId === 'epic-1' && (c.status === 'done' || c.status === 'cancelled'),
    );
    expect(terminalMove).toBeDefined();
    expect(terminalMove?.status).toBe('done');

    const epicAfter = await gm.getEpic('epic-1');
    expect(epicAfter.status).toBe('done');
  });

  // #4 ─────────────────────────────────────────────────────────────────────
  describe('#4 heartbeat stop preserves existing metadata', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const fastHeartbeat: HeartbeatConfig = {
      intervalMs: 50,
      staleThresholdMs: 100,
      zombiePolicy: 'reset-to-todo',
    };

    it('stop() does not clobber verifyFailedAt / verifyFailures written during the run', async () => {
      const gmLocal = new FakeGraphMemory();
      gmLocal.addTask(
        makeTask({
          id: 'hb-regression',
          metadata: {
            verifyFailedAt: 99999,
            verifyFailures: [{ hook: 'tests', exitCode: 1 }],
            customField: 'preserved',
          },
        }),
      );

      const handle = startHeartbeat('hb-regression', gmLocal, fastHeartbeat, silentLogger);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(fastHeartbeat.intervalMs);
      await handle.stop();

      const finalTask = await gmLocal.getTask('hb-regression');
      const meta = finalTask.metadata as Record<string, unknown>;
      expect(meta['verifyFailedAt']).toBe(99999);
      expect(meta['verifyFailures']).toEqual([{ hook: 'tests', exitCode: 1 }]);
      expect(meta['customField']).toBe('preserved');
      // Heartbeat-owned keys are cleared.
      expect(meta['runId']).toBeUndefined();
      expect(meta['heartbeatAt']).toBeUndefined();
    });
  });

  // #5 ─────────────────────────────────────────────────────────────────────
  it('#5 hanging post-task hook is time-bounded — orchestrator moves on to the next task', async () => {
    gm.addTask(makeTask({ id: 'task-hang', priority: 'critical' }));
    gm.addTask(makeTask({ id: 'task-next', priority: 'high' }));
    poller.setResult('task-hang', 'done');
    poller.setResult('task-next', 'done');

    // The first hook stalls for 10s; the orchestrator-level default timeout
    // is 20ms. Without the fix, the slot is pinned forever — with the fix
    // the hook times out and the loop proceeds to task-next.
    hookRunner.setDelay('make-verify', 10_000);

    const config = {
      ...BASE_CONFIG,
      postTaskHooks: [VERIFY_HOOK],
      postTaskHookTimeoutMs: 20,
    };

    const stats = await runSprint(
      makePorts(gm, poller, runner, hookRunner),
      config,
    );

    // Both tasks were attempted: the hang did not pin the slot. The hook
    // delay applies to every run, so each task records a verify_failed —
    // the exact count is not what we're asserting, only that the loop made
    // progress past the stall.
    expect(runner.calls.map((c) => c.taskId)).toEqual(['task-hang', 'task-next']);
    expect(stats.verifyFailed).toBeGreaterThanOrEqual(1);
  });

  // #6 ─────────────────────────────────────────────────────────────────────
  it('#6 single verify_failed does not halt the rest of the sprint (default)', async () => {
    gm.addTask(makeTask({ id: 'flaky', priority: 'critical' }));
    gm.addTask(makeTask({ id: 'after-1', priority: 'high' }));
    gm.addTask(makeTask({ id: 'after-2', priority: 'medium' }));
    poller.setResult('flaky', 'done');
    poller.setResult('after-1', 'done');
    poller.setResult('after-2', 'done');

    // Only the first task's verification fails.
    hookRunner.setResult('make-verify', { success: true, exitCode: 0, stdout: '', stderr: '' });
    let firstHookCall = true;
    const origExec = hookRunner.exec.bind(hookRunner);
    hookRunner.exec = async (hook, opts) => {
      if (firstHookCall) {
        firstHookCall = false;
        hookRunner.calls.push(hook);
        hookRunner.execOpts.push(opts);
        return { success: false, exitCode: 1, stdout: '', stderr: 'flaky failure' };
      }
      return origExec(hook, opts);
    };

    const config = { ...BASE_CONFIG, postTaskHooks: [VERIFY_HOOK] };
    const stats = await runSprint(
      makePorts(gm, poller, runner, hookRunner),
      config,
    );

    expect(runner.calls.map((c) => c.taskId)).toEqual(['flaky', 'after-1', 'after-2']);
    expect(stats.verifyFailed).toBe(1);
    expect(stats.done).toBe(2);
  });
});
