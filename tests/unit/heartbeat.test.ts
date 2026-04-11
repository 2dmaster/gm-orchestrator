import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startHeartbeat,
  recoverZombieTasks,
  resolveHeartbeatConfig,
  HEARTBEAT_DEFAULTS,
} from '../../src/core/heartbeat.js';
import type { HeartbeatConfig } from '../../src/core/types.js';
import { FakeGraphMemory } from '../fixtures/fakes.js';
import { makeTask } from '../fixtures/factories.js';
import { silentLogger } from '../../src/infra/logger.js';

// ── resolveHeartbeatConfig ──────────────────────────────────────────────

describe('resolveHeartbeatConfig', () => {
  it('returns defaults when no overrides', () => {
    const cfg = resolveHeartbeatConfig();
    expect(cfg).toEqual(HEARTBEAT_DEFAULTS);
  });

  it('overrides intervalMs and auto-derives staleThresholdMs', () => {
    const cfg = resolveHeartbeatConfig({ intervalMs: 10_000 });
    expect(cfg.intervalMs).toBe(10_000);
    expect(cfg.staleThresholdMs).toBe(20_000); // 2x
  });

  it('respects explicit staleThresholdMs', () => {
    const cfg = resolveHeartbeatConfig({ intervalMs: 10_000, staleThresholdMs: 50_000 });
    expect(cfg.staleThresholdMs).toBe(50_000);
  });

  it('overrides zombiePolicy', () => {
    const cfg = resolveHeartbeatConfig({ zombiePolicy: 'cancel' });
    expect(cfg.zombiePolicy).toBe('cancel');
  });
});

// ── startHeartbeat ──────────────────────────────────────────────────────

describe('startHeartbeat', () => {
  let gm: FakeGraphMemory;
  const fastConfig: HeartbeatConfig = {
    intervalMs: 50,
    staleThresholdMs: 100,
    zombiePolicy: 'reset-to-todo',
  };

  beforeEach(() => {
    gm = new FakeGraphMemory();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes initial heartbeat metadata', async () => {
    const task = makeTask({ id: 'hb-1' });
    gm.addTask(task);

    const handle = startHeartbeat('hb-1', gm, fastConfig, silentLogger);

    // Let the initial async write settle
    await vi.advanceTimersByTimeAsync(0);

    expect(handle.runId).toBeTruthy();
    expect(gm.calls.updateTask.length).toBeGreaterThanOrEqual(1);
    const firstCall = gm.calls.updateTask[0]!;
    expect(firstCall.taskId).toBe('hb-1');
    expect((firstCall.fields.metadata as Record<string, unknown>)?.['runId']).toBe(handle.runId);
    expect(typeof (firstCall.fields.metadata as Record<string, unknown>)?.['heartbeatAt']).toBe('number');

    await handle.stop();
  });

  it('updates heartbeat periodically', async () => {
    const task = makeTask({ id: 'hb-2' });
    gm.addTask(task);

    const handle = startHeartbeat('hb-2', gm, fastConfig, silentLogger);

    await vi.advanceTimersByTimeAsync(0); // initial
    const countAfterInit = gm.calls.updateTask.length;

    await vi.advanceTimersByTimeAsync(fastConfig.intervalMs);
    expect(gm.calls.updateTask.length).toBeGreaterThan(countAfterInit);

    await handle.stop();
  });

  it('stop() clears metadata', async () => {
    const task = makeTask({ id: 'hb-3' });
    gm.addTask(task);

    const handle = startHeartbeat('hb-3', gm, fastConfig, silentLogger);
    await vi.advanceTimersByTimeAsync(0);

    await handle.stop();

    const lastCall = gm.calls.updateTask[gm.calls.updateTask.length - 1]!;
    expect(lastCall.taskId).toBe('hb-3');
    expect((lastCall.fields.metadata as Record<string, unknown>)?.['runId']).toBeNull();
    expect((lastCall.fields.metadata as Record<string, unknown>)?.['heartbeatAt']).toBeNull();
  });

  it('stop() is idempotent', async () => {
    const task = makeTask({ id: 'hb-4' });
    gm.addTask(task);

    const handle = startHeartbeat('hb-4', gm, fastConfig, silentLogger);
    await vi.advanceTimersByTimeAsync(0);

    await handle.stop();
    const countAfterStop = gm.calls.updateTask.length;

    await handle.stop();
    expect(gm.calls.updateTask.length).toBe(countAfterStop);
  });
});

// ── recoverZombieTasks ──────────────────────────────────────────────────

describe('recoverZombieTasks', () => {
  let gm: FakeGraphMemory;
  const config: HeartbeatConfig = {
    intervalMs: 30_000,
    staleThresholdMs: 60_000,
    zombiePolicy: 'reset-to-todo',
  };

  beforeEach(() => {
    gm = new FakeGraphMemory();
  });

  it('returns empty when no in_progress tasks', async () => {
    const result = await recoverZombieTasks(gm, config, silentLogger);
    expect(result).toEqual([]);
  });

  it('recovers task with stale heartbeat', async () => {
    const staleTime = Date.now() - 120_000; // 2 minutes ago
    const task = makeTask({
      id: 'zombie-1',
      status: 'in_progress',
      metadata: { runId: 'old-run', heartbeatAt: staleTime },
    });
    gm.addTask(task);

    const result = await recoverZombieTasks(gm, config, silentLogger);

    expect(result).toEqual(['zombie-1']);
    // Should have moved to todo
    const moveCall = gm.calls.moveTask.find(
      (c) => c.taskId === 'zombie-1' && c.status === 'todo',
    );
    expect(moveCall).toBeDefined();
  });

  it('recovers task with no heartbeat metadata', async () => {
    const task = makeTask({ id: 'no-hb', status: 'in_progress' });
    gm.addTask(task);

    const result = await recoverZombieTasks(gm, config, silentLogger);

    expect(result).toEqual(['no-hb']);
    const moveCall = gm.calls.moveTask.find(
      (c) => c.taskId === 'no-hb' && c.status === 'todo',
    );
    expect(moveCall).toBeDefined();
  });

  it('skips task with fresh heartbeat', async () => {
    const freshTime = Date.now() - 10_000; // 10 seconds ago
    const task = makeTask({
      id: 'alive-1',
      status: 'in_progress',
      metadata: { runId: 'current-run', heartbeatAt: freshTime },
    });
    gm.addTask(task);

    const result = await recoverZombieTasks(gm, config, silentLogger);

    expect(result).toEqual([]);
    expect(gm.calls.moveTask).toHaveLength(0);
  });

  it('uses cancel policy', async () => {
    const staleTime = Date.now() - 120_000;
    const task = makeTask({
      id: 'zombie-cancel',
      status: 'in_progress',
      metadata: { runId: 'old-run', heartbeatAt: staleTime },
    });
    gm.addTask(task);

    const cancelConfig = { ...config, zombiePolicy: 'cancel' as const };
    const result = await recoverZombieTasks(gm, cancelConfig, silentLogger);

    expect(result).toEqual(['zombie-cancel']);
    const moveCall = gm.calls.moveTask.find(
      (c) => c.taskId === 'zombie-cancel' && c.status === 'cancelled',
    );
    expect(moveCall).toBeDefined();
  });

  it('uses move-to-review policy', async () => {
    const staleTime = Date.now() - 120_000;
    const task = makeTask({
      id: 'zombie-review',
      status: 'in_progress',
      metadata: { runId: 'old-run', heartbeatAt: staleTime },
    });
    gm.addTask(task);

    const reviewConfig = { ...config, zombiePolicy: 'move-to-review' as const };
    const result = await recoverZombieTasks(gm, reviewConfig, silentLogger);

    expect(result).toEqual(['zombie-review']);
    const moveCall = gm.calls.moveTask.find(
      (c) => c.taskId === 'zombie-review' && c.status === 'cancelled',
    );
    expect(moveCall).toBeDefined();
  });

  it('handles multiple zombies and alive tasks together', async () => {
    const staleTime = Date.now() - 120_000;
    const freshTime = Date.now() - 5_000;

    gm.addTask(makeTask({
      id: 'zombie-a',
      status: 'in_progress',
      metadata: { runId: 'old', heartbeatAt: staleTime },
    }));
    gm.addTask(makeTask({
      id: 'alive-b',
      status: 'in_progress',
      metadata: { runId: 'current', heartbeatAt: freshTime },
    }));
    gm.addTask(makeTask({
      id: 'zombie-c',
      status: 'in_progress',
      // no metadata at all
    }));

    const result = await recoverZombieTasks(gm, config, silentLogger);

    expect(result).toHaveLength(2);
    expect(result).toContain('zombie-a');
    expect(result).toContain('zombie-c');
    expect(result).not.toContain('alive-b');
  });

  it('clears heartbeat metadata on recovered tasks', async () => {
    const staleTime = Date.now() - 120_000;
    gm.addTask(makeTask({
      id: 'zombie-clear',
      status: 'in_progress',
      metadata: { runId: 'old-run', heartbeatAt: staleTime },
    }));

    await recoverZombieTasks(gm, config, silentLogger);

    const updateCall = gm.calls.updateTask.find(
      (c) => c.taskId === 'zombie-clear',
    );
    expect(updateCall).toBeDefined();
    expect((updateCall!.fields.metadata as Record<string, unknown>)?.['runId']).toBeNull();
    expect((updateCall!.fields.metadata as Record<string, unknown>)?.['heartbeatAt']).toBeNull();
  });
});
