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
    projects: [{ baseUrl: 'http://localhost:3000', projectId: 'test-project' }],
    activeProjectId: 'test-project',
    concurrency: 1,
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
    listEpicTasks: vi.fn().mockResolvedValue([task]),
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
    taskResult: vi.fn(),
  };

  const wsBus: WebSocketBus = {
    broadcast: vi.fn(),
    clientCount: 0,
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { config, gm, runner, poller, logger, wsBus, ...overrides };
}

/** Wait for a condition to become true (with timeout). */
async function waitFor(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
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
      expect(svc.getRunningProjectIds()).toEqual([]);
    });

    it('isRunning becomes true during a sprint', async () => {
      let resolveBlock: () => void;
      const blockPromise = new Promise<void>((r) => { resolveBlock = r; });

      const gm = deps.gm as { listTasks: ReturnType<typeof vi.fn> };
      let callCount = 0;
      gm.listTasks.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          await blockPromise;
        }
        return [];
      });

      const svc = createRunnerService(deps);
      await svc.startSprint('test-project');

      // Wait for scheduler to pick up the request
      await waitFor(() => svc.isProjectRunning('test-project'));
      expect(svc.isRunning).toBe(true);
      expect(svc.getRunningProjectIds()).toContain('test-project');

      resolveBlock!();
      await waitFor(() => !svc.isRunning);
      expect(svc.isRunning).toBe(false);
    });

    it('returns to idle after sprint completes', async () => {
      (deps.gm.listTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const svc = createRunnerService(deps);
      await svc.startSprint('test-project');

      // Wait for scheduler to complete
      await waitFor(() => !svc.isRunning, 3000);
      expect(svc.isRunning).toBe(false);
    });
  });

  describe('per-project blocking', () => {
    it('throws when starting a sprint for the same project', async () => {
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
      await svc.startSprint('test-project');
      await waitFor(() => svc.isProjectRunning('test-project'));

      await expect(svc.startSprint('test-project')).rejects.toThrow(
        'already in progress'
      );

      resolveHang!();
      await waitFor(() => !svc.isRunning);
    });

    it('allows starting a sprint for a different project', async () => {
      // Configure two projects
      deps.config.projects.push({ baseUrl: 'http://localhost:3000', projectId: 'project-2' });
      deps.config.concurrency = 2;

      let resolveHang: () => void;
      const hangPromise = new Promise<void>((r) => { resolveHang = r; });
      const gm = deps.gm as { listTasks: ReturnType<typeof vi.fn> };
      let callCount = 0;
      gm.listTasks.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          await hangPromise;
        }
        return [];
      });

      const svc = createRunnerService(deps);
      await svc.startSprint('test-project');
      await waitFor(() => svc.isProjectRunning('test-project'));

      // Should NOT throw — different project
      await expect(svc.startSprint('project-2')).resolves.not.toThrow();

      resolveHang!();
      await waitFor(() => !svc.isRunning);
    });
  });

  describe('WebSocket event emission', () => {
    it('emits run:started on sprint start', async () => {
      (deps.gm.listTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const svc = createRunnerService(deps);
      await svc.startSprint('test-project');
      await waitFor(() => !svc.isRunning, 3000);

      const broadcast = deps.wsBus.broadcast as ReturnType<typeof vi.fn>;
      const events = broadcast.mock.calls.map((c) => (c[0] as ServerEvent).type);
      expect(events).toContain('run:started');
    });

    it('emits run:complete when sprint finishes', async () => {
      (deps.gm.listTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const svc = createRunnerService(deps);
      await svc.startSprint('test-project');
      await waitFor(() => !svc.isRunning, 3000);

      const broadcast = deps.wsBus.broadcast as ReturnType<typeof vi.fn>;
      const events = broadcast.mock.calls.map((c) => (c[0] as ServerEvent).type);
      expect(events).toContain('run:complete');
    });

    it('emits run:started with mode epic', async () => {
      (deps.gm.listEpicTasks as ReturnType<typeof vi.fn>).mockResolvedValue(
        [makeTask({ status: 'done' })]
      );

      const svc = createRunnerService(deps);
      await svc.startEpic('test-project', 'epic-1');
      await waitFor(() => !svc.isRunning, 3000);

      const broadcast = deps.wsBus.broadcast as ReturnType<typeof vi.fn>;
      const startEvent = broadcast.mock.calls.find(
        (c) => (c[0] as ServerEvent).type === 'run:started'
      );
      expect(startEvent).toBeDefined();
      const payload = (startEvent![0] as Extract<ServerEvent, { type: 'run:started' }>).payload;
      expect(payload.mode).toBe('epic');
      expect(payload.projectId).toBe('test-project');
    });

    it('emits run:stopped when stopProject() is called', async () => {
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
      await svc.startSprint('test-project');
      await waitFor(() => svc.isProjectRunning('test-project'));

      resolveHang!();
      await svc.stopProject('test-project');

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
