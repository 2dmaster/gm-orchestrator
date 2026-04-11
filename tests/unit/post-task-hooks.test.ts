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
});

// ── handleVerifyFailure ──────────────────────────────────────────────────

describe('handleVerifyFailure', () => {
  let gm: FakeGraphMemory;

  beforeEach(() => {
    gm = new FakeGraphMemory();
  });

  it('moves task to in_progress', async () => {
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
      (c) => c.taskId === 'task-1' && c.status === 'in_progress',
    );
    expect(moveCall).toBeDefined();
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
