import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRunnerService, type RunnerServiceDeps } from '../../src/server/runner-service.js';
import type {
  OrchestratorConfig,
  GraphMemoryPort,
  ClaudeRunnerPort,
  TaskPollerPort,
  Task,
  ServerEvent,
} from '../../src/core/types.js';
import type { Logger } from '../../src/infra/logger.js';
import type { WebSocketBus } from '../../src/server/ws.js';

// ─── Helpers ────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task',
    status: 'todo',
    priority: 'medium',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<RunnerServiceDeps> = {}): RunnerServiceDeps {
  const config: OrchestratorConfig = {
    baseUrl: 'http://localhost:3000',
    projectId: 'test-project',
    timeoutMs: 60_000,
    pauseMs: 0,
    maxRetries: 0,
    claudeArgs: [],
    dryRun: true, // Always dry run in tests
  };

  const task = makeTask();

  const gm: GraphMemoryPort = {
    listTasks: vi.fn().mockResolvedValue([task]),
    getTask: vi.fn().mockResolvedValue(task),
    moveTask: vi.fn().mockResolvedValue(undefined),
    updateTask: vi.fn().mockResolvedValue(undefined),
    getEpic: vi.fn().mockResolvedValue({
      id: 'epic-1',
      title: 'Test Epic',
      status: 'todo',
      priority: 'high',
      tasks: [{ id: 'task-1', title: 'Test task', status: 'todo' }],
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    }),
    listEpics: vi.fn().mockResolvedValue([]),
    moveEpic: vi.fn().mockResolvedValue(undefined),
  };

  const runner: ClaudeRunnerPort = {
    run: vi.fn().mockResolvedValue(undefined),
  };

  const poller: TaskPollerPort = {
    waitForCompletion: vi.fn().mockResolvedValue('done'),
  };

  const logger: Logger = {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    skip: vi.fn(),
    section: vi.fn(),
    task: vi.fn(),
  };

  const wsBus: WebSocketBus = {
    broadcast: vi.fn(),
    clientCount: 0,
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { config, gm, runner, poller, logger, wsBus, ...overrides };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('RunnerService', () => {
  let deps: RunnerServiceDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  describe('lifecycle', () => {
    it('starts idle and isRunning is false', () => {
      const svc = createRunnerService(deps);
      expect(svc.isRunning).toBe(false);
    });

    it('isRunning becomes true during a sprint', async () => {
      // Block inside listTasks so we can observe isRunning=true
      let resolveBlock: () => void;
      const blockPromise = new Promise<void>((r) => { resolveBlock = r; });
      let sawRunning = false;

      const gm = deps.gm as { listTasks: ReturnType<typeof vi.fn> };
      let callCount = 0;
      gm.listTasks.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: block so we can check isRunning
          await blockPromise;
        }
        return [];
      });

      const svc = createRunnerService(deps);
      const promise = svc.startSprint('test-project');

      // Give it a tick to enter the listTasks call
      await new Promise((r) => setTimeout(r, 10));
      sawRunning = svc.isRunning;

      resolveBlock!();
      await promise;

      expect(sawRunning).toBe(true);
      expect(svc.isRunning).toBe(false);
    });

    it('returns to idle after sprint completes', async () => {
      // Empty task list → immediate completion
      (deps.gm.listTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const svc = createRunnerService(deps);
      await svc.startSprint('test-project');
      expect(svc.isRunning).toBe(false);
    });
  });

  describe('concurrent run prevention', () => {
    it('throws when starting a sprint while already running', async () => {
      // Make the sprint hang so we can try a second start
      let resolveHang: () => void;
      const hangPromise = new Promise<void>((r) => { resolveHang = r; });
      const gm = deps.gm as { listTasks: ReturnType<typeof vi.fn> };
      let callCount = 0;
      gm.listTasks.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) return [makeTask()];
        await hangPromise;
        return [];
      });

      const svc = createRunnerService(deps);
      const first = svc.startSprint('test-project');

      // Wait for it to start
      await new Promise((r) => setTimeout(r, 10));

      await expect(svc.startSprint('test-project')).rejects.toThrow(
        'A run is already in progress'
      );

      resolveHang!();
      await first;
    });

    it('throws when starting an epic while a sprint is running', async () => {
      let resolveHang: () => void;
      const hangPromise = new Promise<void>((r) => { resolveHang = r; });
      const gm = deps.gm as { listTasks: ReturnType<typeof vi.fn> };
      let callCount = 0;
      gm.listTasks.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) return [makeTask()];
        await hangPromise;
        return [];
      });

      const svc = createRunnerService(deps);
      const first = svc.startSprint('test-project');
      await new Promise((r) => setTimeout(r, 10));

      await expect(svc.startEpic('test-project', 'epic-1')).rejects.toThrow(
        'A run is already in progress'
      );

      resolveHang!();
      await first;
    });
  });

  describe('WebSocket event emission', () => {
    it('emits run:started on sprint start', async () => {
      (deps.gm.listTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const svc = createRunnerService(deps);
      await svc.startSprint('test-project');

      const broadcast = deps.wsBus.broadcast as ReturnType<typeof vi.fn>;
      const events = broadcast.mock.calls.map((c) => (c[0] as ServerEvent).type);
      expect(events).toContain('run:started');
    });

    it('emits run:complete when sprint finishes', async () => {
      (deps.gm.listTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const svc = createRunnerService(deps);
      await svc.startSprint('test-project');

      const broadcast = deps.wsBus.broadcast as ReturnType<typeof vi.fn>;
      const events = broadcast.mock.calls.map((c) => (c[0] as ServerEvent).type);
      expect(events).toContain('run:complete');
    });

    it('emits run:started with mode epic and epicId', async () => {
      // Make getTask return done so epic finishes immediately
      (deps.gm.getTask as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTask({ status: 'done' })
      );

      const svc = createRunnerService(deps);
      await svc.startEpic('test-project', 'epic-1');

      const broadcast = deps.wsBus.broadcast as ReturnType<typeof vi.fn>;
      const startEvent = broadcast.mock.calls.find(
        (c) => (c[0] as ServerEvent).type === 'run:started'
      );
      expect(startEvent).toBeDefined();
      const payload = (startEvent![0] as Extract<ServerEvent, { type: 'run:started' }>).payload;
      expect(payload.mode).toBe('epic');
      expect(payload.epicId).toBe('epic-1');
    });

    it('emits run:stopped when stop() is called', async () => {
      let resolveHang: () => void;
      const hangPromise = new Promise<void>((r) => { resolveHang = r; });
      const gm = deps.gm as { listTasks: ReturnType<typeof vi.fn> };
      let callCount = 0;
      gm.listTasks.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) return [makeTask()];
        await hangPromise;
        return [];
      });

      const svc = createRunnerService(deps);
      const runP = svc.startSprint('test-project');

      await new Promise((r) => setTimeout(r, 10));
      resolveHang!();
      await svc.stop();
      await runP;

      const broadcast = deps.wsBus.broadcast as ReturnType<typeof vi.fn>;
      const events = broadcast.mock.calls.map((c) => (c[0] as ServerEvent).type);
      expect(events).toContain('run:stopped');
    });
  });

  describe('stop()', () => {
    it('is a no-op when not running', async () => {
      const svc = createRunnerService(deps);
      await svc.stop(); // should not throw
      expect(svc.isRunning).toBe(false);
    });
  });
});
