import { describe, it, expect, beforeEach } from 'vitest';
import { runPostTaskHooks, handleVerifyFailure } from '../../src/core/post-task-hooks.js';
import { FakeGraphMemory, FakeHookRunner } from '../fixtures/fakes.js';
import { silentLogger } from '../../src/infra/logger.js';
import { makeTask } from '../fixtures/factories.js';
import type { PostTaskHook } from '../../src/core/types.js';

// ── runPostTaskHooks ──────────────────────────────────────────────────────

describe('runPostTaskHooks', () => {
  let hookRunner: FakeHookRunner;

  beforeEach(() => {
    hookRunner = new FakeHookRunner();
  });

  it('returns passed=true when no hooks are provided', async () => {
    const report = await runPostTaskHooks([], hookRunner, silentLogger);
    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(0);
  });

  it('runs all hooks and returns passed=true when all succeed', async () => {
    const hooks: PostTaskHook[] = [
      { name: 'lint', command: 'npm run lint', onFailure: 'block' },
      { name: 'test', command: 'npm test', onFailure: 'block' },
    ];

    const report = await runPostTaskHooks(hooks, hookRunner, silentLogger);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(2);
    expect(hookRunner.calls).toHaveLength(2);
    expect(hookRunner.calls[0]?.name).toBe('lint');
    expect(hookRunner.calls[1]?.name).toBe('test');
  });

  it('stops on first block failure and returns passed=false', async () => {
    const hooks: PostTaskHook[] = [
      { name: 'lint', command: 'npm run lint', onFailure: 'block' },
      { name: 'test', command: 'npm test', onFailure: 'block' },
    ];

    hookRunner.setFailure('lint', 1, 'lint errors found');

    const report = await runPostTaskHooks(hooks, hookRunner, silentLogger);

    expect(report.passed).toBe(false);
    expect(report.results).toHaveLength(1); // stopped after first failure
    expect(hookRunner.calls).toHaveLength(1); // second hook never ran
  });

  it('continues past warn failures', async () => {
    const hooks: PostTaskHook[] = [
      { name: 'lint', command: 'npm run lint', onFailure: 'warn' },
      { name: 'test', command: 'npm test', onFailure: 'block' },
    ];

    hookRunner.setFailure('lint', 1, 'minor issues');

    const report = await runPostTaskHooks(hooks, hookRunner, silentLogger);

    expect(report.passed).toBe(true); // warn doesn't block
    expect(report.results).toHaveLength(2);
    expect(hookRunner.calls).toHaveLength(2);
  });

  it('returns passed=false when block failure follows warn failure', async () => {
    const hooks: PostTaskHook[] = [
      { name: 'lint', command: 'npm run lint', onFailure: 'warn' },
      { name: 'test', command: 'npm test', onFailure: 'block' },
    ];

    hookRunner.setFailure('lint', 1, 'warnings');
    hookRunner.setFailure('test', 2, 'test failures');

    const report = await runPostTaskHooks(hooks, hookRunner, silentLogger);

    expect(report.passed).toBe(false);
    expect(report.results).toHaveLength(2);
  });

  it('passes hook config (cwd, timeoutMs) through to runner', async () => {
    const hooks: PostTaskHook[] = [
      { name: 'verify', command: 'make verify', cwd: '/app', timeoutMs: 30_000, onFailure: 'block' },
    ];

    await runPostTaskHooks(hooks, hookRunner, silentLogger);

    expect(hookRunner.calls[0]?.cwd).toBe('/app');
    expect(hookRunner.calls[0]?.timeoutMs).toBe(30_000);
  });

  it('passes the per-hook timeoutMs to the runner via options', async () => {
    const hooks: PostTaskHook[] = [
      { name: 'verify', command: 'make verify', timeoutMs: 15_000, onFailure: 'block' },
    ];

    await runPostTaskHooks(hooks, hookRunner, silentLogger, { defaultTimeoutMs: 999_000 });

    // Per-hook timeout wins over the batch default.
    expect(hookRunner.execOpts[0]?.timeoutMs).toBe(15_000);
  });

  it('falls back to defaultTimeoutMs when hook has no timeoutMs', async () => {
    const hooks: PostTaskHook[] = [
      { name: 'verify', command: 'make verify', onFailure: 'block' },
    ];

    await runPostTaskHooks(hooks, hookRunner, silentLogger, { defaultTimeoutMs: 60_000 });

    expect(hookRunner.execOpts[0]?.timeoutMs).toBe(60_000);
  });

  it('fails with timeout reason when hook exceeds its timeout', async () => {
    const hooks: PostTaskHook[] = [
      { name: 'slow', command: 'sleep 60', timeoutMs: 10, onFailure: 'block' },
      { name: 'next', command: 'echo never', onFailure: 'block' },
    ];

    hookRunner.setDelay('slow', 50);

    const report = await runPostTaskHooks(hooks, hookRunner, silentLogger);

    expect(report.passed).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.result.failureReason).toBe('timeout');
    // subsequent hooks must not run after a timeout
    expect(hookRunner.calls.map((c) => c.name)).toEqual(['slow']);
  });

  it('stops and marks aborted when signal fires mid-batch', async () => {
    const hooks: PostTaskHook[] = [
      { name: 'one', command: 'echo', onFailure: 'block' },
      { name: 'two', command: 'sleep 30', onFailure: 'block' },
    ];
    hookRunner.setDelay('two', 500);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    const report = await runPostTaskHooks(hooks, hookRunner, silentLogger, {
      signal: controller.signal,
    });

    expect(report.passed).toBe(false);
    expect(report.aborted).toBe(true);
    // 'one' completed, 'two' was aborted
    expect(hookRunner.calls[0]?.name).toBe('one');
    expect(hookRunner.calls[1]?.name).toBe('two');
    expect(report.results[1]?.result.failureReason).toBe('aborted');
  });

  it('does not start hooks when signal is already aborted', async () => {
    const hooks: PostTaskHook[] = [
      { name: 'one', command: 'echo', onFailure: 'block' },
    ];
    const controller = new AbortController();
    controller.abort();

    const report = await runPostTaskHooks(hooks, hookRunner, silentLogger, {
      signal: controller.signal,
    });

    expect(report.passed).toBe(false);
    expect(report.aborted).toBe(true);
    expect(hookRunner.calls).toHaveLength(0);
  });
});

// ── handleVerifyFailure ──────────────────────────────────────────────────

describe('handleVerifyFailure', () => {
  let gm: FakeGraphMemory;

  beforeEach(() => {
    gm = new FakeGraphMemory();
  });

  it('moves task to cancelled (stable terminal state for review)', async () => {
    const task = makeTask({ id: 'task-1', status: 'done' });
    gm.addTask(task);

    await handleVerifyFailure(
      task,
      {
        passed: false,
        results: [
          {
            hook: { name: 'test', command: 'npm test', onFailure: 'block' },
            result: { success: false, exitCode: 1, stdout: '', stderr: 'fail' },
          },
        ],
      },
      gm,
      silentLogger,
    );

    const moveCall = gm.calls.moveTask.find(
      (c) => c.taskId === 'task-1' && c.status === 'cancelled',
    );
    expect(moveCall).toBeDefined();
    // Must NOT move back to in_progress (would be re-run on next startup).
    expect(gm.calls.moveTask.find((c) => c.status === 'in_progress')).toBeUndefined();
  });

  it('adds auto-verify-failed tag', async () => {
    const task = makeTask({ id: 'task-1', tags: ['backend'] });
    gm.addTask(task);

    await handleVerifyFailure(
      task,
      {
        passed: false,
        results: [
          {
            hook: { name: 'test', command: 'npm test', onFailure: 'block' },
            result: { success: false, exitCode: 1, stdout: '', stderr: 'fail' },
          },
        ],
      },
      gm,
      silentLogger,
    );

    const updateCall = gm.calls.updateTask.find((c) => c.taskId === 'task-1');
    expect(updateCall).toBeDefined();
    expect(updateCall?.fields.tags).toContain('auto-verify-failed');
    expect(updateCall?.fields.tags).toContain('backend'); // preserves existing tags
  });

  it('does not duplicate auto-verify-failed tag', async () => {
    const task = makeTask({ id: 'task-1', tags: ['auto-verify-failed'] });
    gm.addTask(task);

    await handleVerifyFailure(
      task,
      {
        passed: false,
        results: [
          {
            hook: { name: 'test', command: 'npm test', onFailure: 'block' },
            result: { success: false, exitCode: 1, stdout: '', stderr: 'fail' },
          },
        ],
      },
      gm,
      silentLogger,
    );

    const updateCall = gm.calls.updateTask.find((c) => c.taskId === 'task-1');
    const tagCount = updateCall?.fields.tags?.filter((t) => t === 'auto-verify-failed').length;
    expect(tagCount).toBe(1);
  });

  it('attaches failure metadata with hook details', async () => {
    const task = makeTask({ id: 'task-1' });
    gm.addTask(task);

    await handleVerifyFailure(
      task,
      {
        passed: false,
        results: [
          {
            hook: { name: 'test', command: 'npm test', onFailure: 'block' },
            result: { success: false, exitCode: 2, stdout: 'running tests...', stderr: '3 tests failed' },
          },
        ],
      },
      gm,
      silentLogger,
    );

    const updateCall = gm.calls.updateTask.find((c) => c.taskId === 'task-1');
    const metadata = updateCall?.fields.metadata as Record<string, unknown>;
    expect(metadata).toBeDefined();
    expect(metadata['verifyFailedAt']).toBeTypeOf('number');

    const failures = metadata['verifyFailures'] as Array<Record<string, unknown>>;
    expect(failures).toHaveLength(1);
    expect(failures[0]?.hook).toBe('test');
    expect(failures[0]?.exitCode).toBe(2);
    expect(failures[0]?.stderr).toBe('3 tests failed');
  });
});
