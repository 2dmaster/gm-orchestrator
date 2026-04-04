import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createScheduler } from '../../src/core/scheduler.js';
import type { Scheduler, SchedulerEvents } from '../../src/core/scheduler.js';
import { FakeGraphMemory, FakePoller, FakeRunner } from '../fixtures/fakes.js';
import { makeTask, makeTasks } from '../fixtures/factories.js';
import { silentLogger } from '../../src/infra/logger.js';
import type { OrchestratorConfig, GraphMemoryPort, ClaudeRunnerPort, TaskPollerPort } from '../../src/core/types.js';

function makeConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    projects: [
      { baseUrl: 'http://localhost:3000', projectId: 'project-a' },
      { baseUrl: 'http://localhost:3000', projectId: 'project-b' },
    ],
    concurrency: 2,
    schedulerStrategy: 'round-robin',
    timeoutMs: 60_000,
    pauseMs: 0,
    maxRetries: 0,
    claudeArgs: [],
    dryRun: true,
    maxTurns: 10,
    agentTimeoutMs: 60_000,
    ...overrides,
  };
}

describe('Scheduler', () => {
  let gmA: FakeGraphMemory;
  let gmB: FakeGraphMemory;
  let pollerA: FakePoller;
  let pollerB: FakePoller;

  beforeEach(() => {
    gmA = new FakeGraphMemory();
    gmB = new FakeGraphMemory();
    pollerA = new FakePoller(gmA);
    pollerB = new FakePoller(gmB);
  });

  function makePorts() {
    return {
      resolveGm: (projectId: string): GraphMemoryPort => {
        if (projectId === 'project-a') return gmA;
        return gmB;
      },
      createRunner: (_projectId: string): ClaudeRunnerPort => new FakeRunner(),
      createPoller: (projectId: string): TaskPollerPort => {
        if (projectId === 'project-a') return pollerA;
        return pollerB;
      },
      logger: silentLogger,
    };
  }

  it('enqueues requests and returns IDs', () => {
    const scheduler = createScheduler(makeConfig(), makePorts());

    const id1 = scheduler.enqueue({ projectId: 'project-a', mode: 'sprint', priority: 2 });
    const id2 = scheduler.enqueue({ projectId: 'project-b', mode: 'sprint', priority: 1 });

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
    expect(scheduler.queue).toHaveLength(2);
  });

  it('sorts queue by priority', () => {
    const scheduler = createScheduler(makeConfig(), makePorts());

    scheduler.enqueue({ projectId: 'project-a', mode: 'sprint', priority: 3 });
    scheduler.enqueue({ projectId: 'project-b', mode: 'sprint', priority: 0 });
    scheduler.enqueue({ projectId: 'project-a', mode: 'sprint', priority: 1 });

    expect(scheduler.queue[0]!.priority).toBe(0);
    expect(scheduler.queue[1]!.priority).toBe(1);
    expect(scheduler.queue[2]!.priority).toBe(3);
  });

  it('cancels a queued request', () => {
    const scheduler = createScheduler(makeConfig(), makePorts());

    const id1 = scheduler.enqueue({ projectId: 'project-a', mode: 'sprint', priority: 2 });
    const id2 = scheduler.enqueue({ projectId: 'project-b', mode: 'sprint', priority: 2 });

    expect(scheduler.cancel(id1)).toBe(true);
    expect(scheduler.queue).toHaveLength(1);
    expect(scheduler.queue[0]!.id).toBe(id2);
  });

  it('returns false when cancelling a non-existent request', () => {
    const scheduler = createScheduler(makeConfig(), makePorts());
    expect(scheduler.cancel('nonexistent')).toBe(false);
  });

  it('creates the correct number of slots based on concurrency', () => {
    const scheduler = createScheduler(makeConfig({ concurrency: 3 }), makePorts());
    expect(scheduler.slots).toHaveLength(3);
    expect(scheduler.slots.every((s) => s.status === 'idle')).toBe(true);
  });

  it('starts processing and fills slots', async () => {
    // Set up tasks so the sprint has work to do
    const taskA = makeTask({ id: 'a-1', title: 'Task A', status: 'todo' });
    const taskB = makeTask({ id: 'b-1', title: 'Task B', status: 'todo' });
    gmA.addTask(taskA);
    gmB.addTask(taskB);
    pollerA.setResult('a-1', 'done');
    pollerB.setResult('b-1', 'done');

    const onSlotStarted = vi.fn();
    const onSlotCompleted = vi.fn();
    const onQueueDrained = vi.fn();

    const scheduler = createScheduler(
      makeConfig({ concurrency: 2 }),
      makePorts(),
      { onSlotStarted, onSlotCompleted, onQueueDrained },
    );

    scheduler.enqueue({ projectId: 'project-a', mode: 'sprint', priority: 2 });
    scheduler.enqueue({ projectId: 'project-b', mode: 'sprint', priority: 2 });

    scheduler.start();

    // Wait for completion
    await vi.waitFor(() => {
      expect(onQueueDrained).toHaveBeenCalled();
    }, { timeout: 5000 });

    expect(onSlotStarted).toHaveBeenCalledTimes(2);
    expect(onSlotCompleted).toHaveBeenCalledTimes(2);
  });

  it('respects concurrency=1 — runs sequentially', async () => {
    const taskA = makeTask({ id: 'seq-a', title: 'Task A', status: 'todo' });
    const taskB = makeTask({ id: 'seq-b', title: 'Task B', status: 'todo' });
    gmA.addTask(taskA);
    gmB.addTask(taskB);
    pollerA.setResult('seq-a', 'done');
    pollerB.setResult('seq-b', 'done');

    const startOrder: string[] = [];
    const onSlotStarted = vi.fn((_slotId, request) => {
      startOrder.push(request.projectId);
    });
    const onQueueDrained = vi.fn();

    const scheduler = createScheduler(
      makeConfig({ concurrency: 1 }),
      makePorts(),
      { onSlotStarted, onQueueDrained },
    );

    scheduler.enqueue({ projectId: 'project-a', mode: 'sprint', priority: 2 });
    scheduler.enqueue({ projectId: 'project-b', mode: 'sprint', priority: 2 });

    expect(scheduler.slots).toHaveLength(1);

    scheduler.start();

    await vi.waitFor(() => {
      expect(onQueueDrained).toHaveBeenCalled();
    }, { timeout: 5000 });

    // Both ran, but sequentially (one slot)
    expect(onSlotStarted).toHaveBeenCalledTimes(2);
    expect(startOrder).toEqual(['project-a', 'project-b']);
  });

  it('stop aborts running slots and clears queue', async () => {
    // Add a task that will keep the sprint busy
    const task = makeTask({ id: 'stop-1', title: 'Long Task', status: 'todo' });
    gmA.addTask(task);
    // Don't set a poller result — it'll timeout, but we'll abort before that
    pollerA.setResult('stop-1', 'timeout');

    const scheduler = createScheduler(
      makeConfig({ concurrency: 1 }),
      makePorts(),
    );

    scheduler.enqueue({ projectId: 'project-a', mode: 'sprint', priority: 2 });
    scheduler.enqueue({ projectId: 'project-b', mode: 'sprint', priority: 2 });

    scheduler.start();

    // Give it a moment to start
    await new Promise((r) => setTimeout(r, 50));

    await scheduler.stop();

    expect(scheduler.queue).toHaveLength(0);
    expect(scheduler.isActive).toBe(false);
  });

  it('round-robin distributes across projects fairly', async () => {
    // With concurrency 1, round-robin should prefer a project without active slots
    const taskA1 = makeTask({ id: 'rr-a1', title: 'A1', status: 'todo' });
    const taskB1 = makeTask({ id: 'rr-b1', title: 'B1', status: 'todo' });
    gmA.addTask(taskA1);
    gmB.addTask(taskB1);
    pollerA.setResult('rr-a1', 'done');
    pollerB.setResult('rr-b1', 'done');

    const startOrder: string[] = [];
    const onSlotStarted = vi.fn((_slotId, request) => {
      startOrder.push(request.projectId);
    });
    const onQueueDrained = vi.fn();

    const scheduler = createScheduler(
      makeConfig({ concurrency: 1, schedulerStrategy: 'round-robin' }),
      makePorts(),
      { onSlotStarted, onQueueDrained },
    );

    // Enqueue B first (lower priority number = higher priority) but A with higher
    scheduler.enqueue({ projectId: 'project-b', mode: 'sprint', priority: 2 });
    scheduler.enqueue({ projectId: 'project-a', mode: 'sprint', priority: 2 });

    scheduler.start();

    await vi.waitFor(() => {
      expect(onQueueDrained).toHaveBeenCalled();
    }, { timeout: 5000 });

    // Since both have same priority and concurrency=1, first enqueued goes first
    expect(startOrder[0]).toBe('project-b');
    expect(startOrder[1]).toBe('project-a');
  });

  it('priority strategy always picks highest priority first', async () => {
    const taskA = makeTask({ id: 'pr-a', title: 'Low', status: 'todo' });
    const taskB = makeTask({ id: 'pr-b', title: 'High', status: 'todo' });
    gmA.addTask(taskA);
    gmB.addTask(taskB);
    pollerA.setResult('pr-a', 'done');
    pollerB.setResult('pr-b', 'done');

    const startOrder: string[] = [];
    const onSlotStarted = vi.fn((_slotId, request) => {
      startOrder.push(request.projectId);
    });
    const onQueueDrained = vi.fn();

    const scheduler = createScheduler(
      makeConfig({ concurrency: 1, schedulerStrategy: 'priority' }),
      makePorts(),
      { onSlotStarted, onQueueDrained },
    );

    // Enqueue low-priority first, then high-priority
    scheduler.enqueue({ projectId: 'project-a', mode: 'sprint', priority: 3 });
    scheduler.enqueue({ projectId: 'project-b', mode: 'sprint', priority: 0 });

    scheduler.start();

    await vi.waitFor(() => {
      expect(onQueueDrained).toHaveBeenCalled();
    }, { timeout: 5000 });

    // High priority (project-b, priority=0) should run first
    expect(startOrder[0]).toBe('project-b');
    expect(startOrder[1]).toBe('project-a');
  });

  it('aggregates stats from all completed runs', async () => {
    const taskA = makeTask({ id: 'agg-a', title: 'A', status: 'todo' });
    const taskB = makeTask({ id: 'agg-b', title: 'B', status: 'todo' });
    gmA.addTask(taskA);
    gmB.addTask(taskB);
    pollerA.setResult('agg-a', 'done');
    pollerB.setResult('agg-b', 'done');

    const onQueueDrained = vi.fn();

    const scheduler = createScheduler(
      makeConfig({ concurrency: 2 }),
      makePorts(),
      { onQueueDrained },
    );

    scheduler.enqueue({ projectId: 'project-a', mode: 'sprint', priority: 2 });
    scheduler.enqueue({ projectId: 'project-b', mode: 'sprint', priority: 2 });

    scheduler.start();

    await vi.waitFor(() => {
      expect(onQueueDrained).toHaveBeenCalled();
    }, { timeout: 5000 });

    const stats = scheduler.aggregateStats;
    expect(stats.done).toBe(2); // one task from each project
  });

  it('blocks pipeline stages until dependencies complete', async () => {
    // Stage A has no deps, stage B depends on A
    const taskA = makeTask({ id: 'pipe-a', title: 'A', status: 'todo' });
    const taskB = makeTask({ id: 'pipe-b', title: 'B', status: 'todo' });
    gmA.addTask(taskA);
    gmB.addTask(taskB);
    pollerA.setResult('pipe-a', 'done');
    pollerB.setResult('pipe-b', 'done');

    const epicA = {
      id: 'epic-a', title: 'EA', status: 'todo' as const, priority: 'medium' as const,
      tasks: [{ id: 'pipe-a', title: 'A', status: 'todo' as const }],
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    };
    const epicB = {
      id: 'epic-b', title: 'EB', status: 'todo' as const, priority: 'medium' as const,
      tasks: [{ id: 'pipe-b', title: 'B', status: 'todo' as const }],
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    };
    gmA.addEpic(epicA);
    gmB.addEpic(epicB);

    const startOrder: string[] = [];
    const onSlotStarted = vi.fn((_slotId, request) => {
      startOrder.push(request.stageId);
    });
    const onQueueDrained = vi.fn();

    const scheduler = createScheduler(
      makeConfig({ concurrency: 2 }),
      makePorts(),
      { onSlotStarted, onQueueDrained },
    );

    const pipelineRunId = 'run-1';

    // Enqueue B first (has dep on A), then A (no deps)
    scheduler.enqueue({
      projectId: 'project-b', mode: 'epic', epicId: 'epic-b', priority: 0,
      pipelineRunId, stageId: 'stage-b', afterStages: ['stage-a'],
    });
    scheduler.enqueue({
      projectId: 'project-a', mode: 'epic', epicId: 'epic-a', priority: 1,
      pipelineRunId, stageId: 'stage-a', afterStages: [],
    });

    scheduler.start();

    await vi.waitFor(() => {
      expect(onQueueDrained).toHaveBeenCalled();
    }, { timeout: 5000 });

    // A should have started first despite B having higher priority, because B was blocked
    expect(startOrder[0]).toBe('stage-a');
    expect(startOrder[1]).toBe('stage-b');
  });

  it('runs independent pipeline stages in parallel', async () => {
    const taskA = makeTask({ id: 'par-a', title: 'A', status: 'todo' });
    const taskB = makeTask({ id: 'par-b', title: 'B', status: 'todo' });
    gmA.addTask(taskA);
    gmB.addTask(taskB);
    pollerA.setResult('par-a', 'done');
    pollerB.setResult('par-b', 'done');

    const epicA = {
      id: 'epic-pa', title: 'EA', status: 'todo' as const, priority: 'medium' as const,
      tasks: [{ id: 'par-a', title: 'A', status: 'todo' as const }],
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    };
    const epicB = {
      id: 'epic-pb', title: 'EB', status: 'todo' as const, priority: 'medium' as const,
      tasks: [{ id: 'par-b', title: 'B', status: 'todo' as const }],
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    };
    gmA.addEpic(epicA);
    gmB.addEpic(epicB);

    const onSlotStarted = vi.fn();
    const onQueueDrained = vi.fn();

    const scheduler = createScheduler(
      makeConfig({ concurrency: 2 }),
      makePorts(),
      { onSlotStarted, onQueueDrained },
    );

    const pipelineRunId = 'run-parallel';

    // Both stages have no deps — should run in parallel
    scheduler.enqueue({
      projectId: 'project-a', mode: 'epic', epicId: 'epic-pa', priority: 1,
      pipelineRunId, stageId: 'stage-a', afterStages: [],
    });
    scheduler.enqueue({
      projectId: 'project-b', mode: 'epic', epicId: 'epic-pb', priority: 1,
      pipelineRunId, stageId: 'stage-b', afterStages: [],
    });

    scheduler.start();

    await vi.waitFor(() => {
      expect(onQueueDrained).toHaveBeenCalled();
    }, { timeout: 5000 });

    // Both should have started (both slots filled)
    expect(onSlotStarted).toHaveBeenCalledTimes(2);
  });

  it('tracks completed stages per pipeline run', async () => {
    const taskA = makeTask({ id: 'track-a', title: 'A', status: 'todo' });
    gmA.addTask(taskA);
    pollerA.setResult('track-a', 'done');

    const epicA = {
      id: 'epic-ta', title: 'EA', status: 'todo' as const, priority: 'medium' as const,
      tasks: [{ id: 'track-a', title: 'A', status: 'todo' as const }],
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    };
    gmA.addEpic(epicA);

    const onQueueDrained = vi.fn();

    const scheduler = createScheduler(
      makeConfig({ concurrency: 1 }),
      makePorts(),
      { onQueueDrained },
    );

    scheduler.enqueue({
      projectId: 'project-a', mode: 'epic', epicId: 'epic-ta', priority: 1,
      pipelineRunId: 'run-track', stageId: 'stage-a',
    });

    scheduler.start();

    await vi.waitFor(() => {
      expect(onQueueDrained).toHaveBeenCalled();
    }, { timeout: 5000 });

    const done = scheduler.completedStages.get('run-track');
    expect(done).toBeDefined();
    expect(done!.has('stage-a')).toBe(true);
  });

  it('full 3-stage pipeline: A -> B, A -> C (B and C run in parallel after A)', async () => {
    // Set up 3 projects with tasks
    const gmC = new FakeGraphMemory();
    const pollerC = new FakePoller(gmC);

    const taskA = makeTask({ id: 'full-a', title: 'A', status: 'todo' });
    const taskB = makeTask({ id: 'full-b', title: 'B', status: 'todo' });
    const taskC = makeTask({ id: 'full-c', title: 'C', status: 'todo' });
    gmA.addTask(taskA);
    gmB.addTask(taskB);
    gmC.addTask(taskC);
    pollerA.setResult('full-a', 'done');
    pollerB.setResult('full-b', 'done');
    pollerC.setResult('full-c', 'done');

    const epicA = {
      id: 'epic-fa', title: 'EA', status: 'todo' as const, priority: 'medium' as const,
      tasks: [{ id: 'full-a', title: 'A', status: 'todo' as const }],
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    };
    const epicB = {
      id: 'epic-fb', title: 'EB', status: 'todo' as const, priority: 'medium' as const,
      tasks: [{ id: 'full-b', title: 'B', status: 'todo' as const }],
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    };
    const epicC = {
      id: 'epic-fc', title: 'EC', status: 'todo' as const, priority: 'medium' as const,
      tasks: [{ id: 'full-c', title: 'C', status: 'todo' as const }],
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    };
    gmA.addEpic(epicA);
    gmB.addEpic(epicB);
    gmC.addEpic(epicC);

    const startOrder: string[] = [];
    const completeOrder: string[] = [];
    const onSlotStarted = vi.fn((_slotId, request) => {
      startOrder.push(request.stageId);
    });
    const onSlotCompleted = vi.fn((_slotId, request) => {
      completeOrder.push(request.stageId);
    });
    const onQueueDrained = vi.fn();

    const config = makeConfig({
      concurrency: 3,
      projects: [
        { baseUrl: 'http://localhost:3000', projectId: 'project-a' },
        { baseUrl: 'http://localhost:3000', projectId: 'project-b' },
        { baseUrl: 'http://localhost:3000', projectId: 'project-c' },
      ],
    });

    const scheduler = createScheduler(config, {
      resolveGm: (pid) => {
        if (pid === 'project-a') return gmA;
        if (pid === 'project-b') return gmB;
        return gmC;
      },
      createRunner: () => new FakeRunner(),
      createPoller: (pid) => {
        if (pid === 'project-a') return pollerA;
        if (pid === 'project-b') return pollerB;
        return pollerC;
      },
      logger: silentLogger,
    }, { onSlotStarted, onSlotCompleted, onQueueDrained });

    const pipelineRunId = 'full-pipeline-run';

    // Enqueue: A (no deps), B (after A), C (after A)
    scheduler.enqueue({
      projectId: 'project-a', mode: 'epic', epicId: 'epic-fa', priority: 1,
      pipelineRunId, stageId: 'stage-a', afterStages: [],
    });
    scheduler.enqueue({
      projectId: 'project-b', mode: 'epic', epicId: 'epic-fb', priority: 1,
      pipelineRunId, stageId: 'stage-b', afterStages: ['stage-a'],
    });
    scheduler.enqueue({
      projectId: 'project-c', mode: 'epic', epicId: 'epic-fc', priority: 1,
      pipelineRunId, stageId: 'stage-c', afterStages: ['stage-a'],
    });

    scheduler.start();

    await vi.waitFor(() => {
      expect(onQueueDrained).toHaveBeenCalled();
    }, { timeout: 5000 });

    // All 3 stages should have run
    expect(onSlotStarted).toHaveBeenCalledTimes(3);
    expect(onSlotCompleted).toHaveBeenCalledTimes(3);

    // A must start first (B and C depend on it)
    expect(startOrder[0]).toBe('stage-a');

    // B and C should both start after A completes (order between B/C is non-deterministic)
    expect(startOrder.slice(1).sort()).toEqual(['stage-b', 'stage-c']);

    // All stages should be tracked as completed
    const done = scheduler.completedStages.get(pipelineRunId);
    expect(done).toBeDefined();
    expect(done!.has('stage-a')).toBe(true);
    expect(done!.has('stage-b')).toBe(true);
    expect(done!.has('stage-c')).toBe(true);
  });

  it('handles epic mode requests', async () => {
    const epic = {
      id: 'epic-1',
      title: 'Test Epic',
      status: 'todo' as const,
      priority: 'medium' as const,
      tasks: [{ id: 'ep-task-1', title: 'ET', status: 'todo' as const }],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };
    const task = makeTask({ id: 'ep-task-1', title: 'ET', status: 'todo' });
    gmA.addEpic(epic);
    gmA.addTask(task);
    pollerA.setResult('ep-task-1', 'done');

    const onSlotCompleted = vi.fn();
    const onQueueDrained = vi.fn();

    const scheduler = createScheduler(
      makeConfig({ concurrency: 1 }),
      makePorts(),
      { onSlotCompleted, onQueueDrained },
    );

    scheduler.enqueue({ projectId: 'project-a', mode: 'epic', epicId: 'epic-1', priority: 2 });

    scheduler.start();

    await vi.waitFor(() => {
      expect(onQueueDrained).toHaveBeenCalled();
    }, { timeout: 5000 });

    expect(onSlotCompleted).toHaveBeenCalledTimes(1);
  });
});
