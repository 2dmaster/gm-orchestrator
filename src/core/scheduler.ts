import type {
  GraphMemoryPort,
  ClaudeRunnerPort,
  TaskPollerPort,
  OrchestratorConfig,
  SprintStats,
  Task,
  ProjectEntry,
  CrossProjectResolver,
} from './types.js';
import { getActiveProject } from './types.js';
import { runSprint, runEpic, runTasks } from './orchestrator.js';
import type { Logger } from '../infra/logger.js';

// ─── Types ──────────────────────────────────────────────────────────────

export type SchedulerStrategy = 'round-robin' | 'priority';

export interface RunRequest {
  id: string;
  projectId: string;
  mode: 'sprint' | 'epic' | 'tasks';
  epicId?: string | undefined;
  taskIds?: string[] | undefined;
  tag?: string | undefined;
  model?: string | undefined;   // Claude model override
  priority: number;        // lower = higher priority (0 = critical)
  enqueuedAt: number;
  /** Pipeline run ID — groups related stage requests. */
  pipelineRunId?: string | undefined;
  /** Stage ID within the pipeline — used for dependency resolution. */
  stageId?: string | undefined;
  /** Stage IDs that must complete before this request can be picked. */
  afterStages?: string[] | undefined;
}

export type SlotStatus = 'idle' | 'running' | 'stopping';

export interface RunSlot {
  id: number;
  status: SlotStatus;
  projectId: string | null;
  abort: AbortController | null;
  runPromise: Promise<SprintStats> | null;
  activeTask: Task | null;
  completedTasks: Task[];
  recentLines: string[];
}

export interface SchedulerPorts {
  resolveGm: (projectId: string) => GraphMemoryPort;
  createRunner: (projectId: string) => ClaudeRunnerPort;
  createPoller: (projectId: string) => TaskPollerPort;
  logger: Logger;
  /** Per-slot logger factory. When provided, each slot gets its own logger scoped to a projectId. */
  createLogger?: (projectId: string) => Logger;
  /** Optional resolver for cross-project blocker dependencies. */
  crossProjectResolver?: CrossProjectResolver;
}

export interface SchedulerEvents {
  onSlotStarted?: (slotId: number, request: RunRequest) => void;
  onSlotCompleted?: (slotId: number, request: RunRequest, stats: SprintStats) => void;
  onSlotError?: (slotId: number, request: RunRequest, error: Error) => void;
  onQueueDrained?: () => void;
}

export interface Scheduler {
  /** Enqueue a run request. Returns the request ID. */
  enqueue(request: Omit<RunRequest, 'id' | 'enqueuedAt'>): string;

  /** Start processing the queue with configured concurrency. */
  start(): void;

  /** Stop all running slots and drain the queue. */
  stop(): Promise<void>;

  /** Pause: stop picking new requests from the queue but let running tasks finish. */
  pause(): void;

  /** Resume after pause: start picking from the queue again. */
  resume(): void;

  /** Cancel a specific queued request (not yet running). Returns true if removed. */
  cancel(requestId: string): boolean;

  /** Stop a specific project's running slot and remove its queued requests. */
  stopProject(projectId: string): Promise<void>;

  /** Get current queue state. */
  readonly queue: ReadonlyArray<RunRequest>;

  /** Get slot states. */
  readonly slots: ReadonlyArray<Readonly<RunSlot>>;

  /** True if any slot is running or queue is non-empty. */
  readonly isActive: boolean;

  /** True if the scheduler is paused (running tasks continue, queue is frozen). */
  readonly isPaused: boolean;

  /** Get aggregate stats across all completed runs. */
  readonly aggregateStats: SprintStats;

  /** Get completed stages per pipeline run (for dependency tracking). */
  readonly completedStages: ReadonlyMap<string, ReadonlySet<string>>;

  /** Pause a specific pipeline run — its queued stages won't be picked. */
  pausePipeline(pipelineRunId: string): void;

  /** Resume a paused pipeline run — its stages become eligible again. */
  resumePipeline(pipelineRunId: string): void;

  /** Check if a pipeline run is paused. */
  isPipelinePaused(pipelineRunId: string): boolean;

  /** Pause a specific project — its queued requests won't be picked. Running task continues. */
  pauseProject(projectId: string): void;

  /** Resume a paused project — its requests become eligible again. */
  resumeProject(projectId: string): void;

  /** Check if a project is paused. */
  isProjectPaused(projectId: string): boolean;

  /** Get all paused project IDs. */
  readonly pausedProjectIds: ReadonlySet<string>;
}

// ─── Implementation ─────────────────────────────────────────────────────

let _requestCounter = 0;

function generateRequestId(): string {
  return `req-${Date.now()}-${++_requestCounter}`;
}

function createEmptyStats(): SprintStats {
  return { done: 0, cancelled: 0, retried: 0, errors: 0, skipped: 0, durationMs: 0 };
}

function mergeStats(a: SprintStats, b: SprintStats): SprintStats {
  return {
    done: a.done + b.done,
    cancelled: a.cancelled + b.cancelled,
    retried: a.retried + b.retried,
    errors: a.errors + b.errors,
    skipped: a.skipped + b.skipped,
    durationMs: a.durationMs + b.durationMs,
  };
}

export function createScheduler(
  config: OrchestratorConfig,
  ports: SchedulerPorts,
  events: SchedulerEvents = {},
): Scheduler {
  const concurrency = Math.max(1, config.concurrency);
  const strategy: SchedulerStrategy =
    (config as OrchestratorConfig & { schedulerStrategy?: SchedulerStrategy }).schedulerStrategy ?? 'round-robin';

  const requestQueue: RunRequest[] = [];
  const slots: RunSlot[] = Array.from({ length: concurrency }, (_, i) => ({
    id: i,
    status: 'idle' as SlotStatus,
    projectId: null,
    abort: null,
    runPromise: null,
    activeTask: null,
    completedTasks: [],
    recentLines: [],
  }));

  let running = false;
  let paused = false;
  let totalStats: SprintStats = createEmptyStats();
  const pausedPipelines = new Set<string>();
  const pausedProjects = new Set<string>();

  // Track which projects have active slots for round-robin fairness
  let lastProjectIndex = -1;

  // Track completed stages per pipeline run for dependency resolution
  const completedStages = new Map<string, Set<string>>(); // pipelineRunId → Set<stageId>

  function enqueue(request: Omit<RunRequest, 'id' | 'enqueuedAt'>): string {
    const id = generateRequestId();
    const full: RunRequest = {
      ...request,
      id,
      enqueuedAt: Date.now(),
    };
    requestQueue.push(full);

    // Ensure pipeline run has a tracking set
    if (full.pipelineRunId && !completedStages.has(full.pipelineRunId)) {
      completedStages.set(full.pipelineRunId, new Set());
    }

    // Sort queue by priority (lower number = higher priority)
    requestQueue.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);

    ports.logger.info(`Scheduler: enqueued ${request.mode} for project "${request.projectId}" (id=${id})`);

    // If running, try to fill idle slots
    if (running) {
      scheduleNext();
    }

    return id;
  }

  /**
   * Check if a pipeline stage request has all its dependencies satisfied.
   * Non-pipeline requests are always ready.
   */
  function isStageReady(request: RunRequest): boolean {
    if (pausedProjects.has(request.projectId)) return false;
    if (request.pipelineRunId && pausedPipelines.has(request.pipelineRunId)) return false;
    if (!request.pipelineRunId || !request.afterStages?.length) return true;
    const done = completedStages.get(request.pipelineRunId);
    if (!done) return false;
    return request.afterStages.every((dep) => done.has(dep));
  }

  function pickNextRequest(): RunRequest | undefined {
    if (!requestQueue.length) return undefined;

    if (strategy === 'priority') {
      // Strict priority: take the first ready request (already sorted by priority)
      const idx = requestQueue.findIndex(isStageReady);
      if (idx === -1) return undefined;
      return requestQueue.splice(idx, 1)[0];
    }

    // Round-robin: cycle through projects fairly
    const activeProjectIds = new Set(
      slots.filter((s) => s.status === 'running' && s.projectId).map((s) => s.projectId)
    );

    // Try to find a ready request from a project that doesn't have an active slot
    const nonActiveIdx = requestQueue.findIndex(
      (r) => !activeProjectIds.has(r.projectId) && isStageReady(r)
    );
    if (nonActiveIdx !== -1) {
      return requestQueue.splice(nonActiveIdx, 1)[0];
    }

    // All queued projects already have active slots — take the highest priority ready request
    const readyIdx = requestQueue.findIndex(isStageReady);
    if (readyIdx === -1) return undefined;
    return requestQueue.splice(readyIdx, 1)[0];
  }

  function findIdleSlot(): RunSlot | undefined {
    return slots.find((s) => s.status === 'idle');
  }

  function scheduleNext(): void {
    if (!running || paused) return;

    let idleSlot = findIdleSlot();
    while (idleSlot && requestQueue.length) {
      const request = pickNextRequest();
      if (!request) break;
      runInSlot(idleSlot, request);
      idleSlot = findIdleSlot();
    }
  }

  function runInSlot(slot: RunSlot, request: RunRequest): void {
    slot.status = 'running';
    slot.projectId = request.projectId;
    slot.abort = new AbortController();
    slot.activeTask = null;
    slot.completedTasks = [];
    slot.recentLines = [];

    events.onSlotStarted?.(slot.id, request);

    const gm = ports.resolveGm(request.projectId);
    const runner = ports.createRunner(request.projectId);
    const poller = ports.createPoller(request.projectId);

    // Build a per-slot config with the right activeProjectId
    const slotConfig: OrchestratorConfig = {
      ...config,
      activeProjectId: request.projectId,
      ...(request.tag !== undefined ? { tag: request.tag } : {}),
      ...(request.model !== undefined ? { model: request.model } : {}),
    };

    // Ensure project is in the projects list
    if (!slotConfig.projects.some((p) => p.projectId === request.projectId)) {
      const base = getActiveProject(config);
      slotConfig.projects = [
        ...slotConfig.projects,
        { baseUrl: base?.baseUrl ?? 'http://localhost:3000', projectId: request.projectId },
      ];
    }

    const slotLogger = ports.createLogger ? ports.createLogger(request.projectId) : ports.logger;
    const orchestratorPorts = {
      gm,
      runner,
      poller,
      logger: slotLogger,
      signal: slot.abort.signal,
      ...(ports.crossProjectResolver ? { crossProjectResolver: ports.crossProjectResolver } : {}),
    };

    let promise: Promise<SprintStats>;
    if (request.mode === 'tasks' && request.taskIds) {
      promise = runTasks(request.taskIds, orchestratorPorts, slotConfig);
    } else if (request.mode === 'epic' && request.epicId) {
      promise = runEpic(request.epicId, orchestratorPorts, slotConfig);
    } else {
      promise = runSprint(orchestratorPorts, slotConfig);
    }

    slot.runPromise = promise;

    promise
      .then((stats) => {
        totalStats = mergeStats(totalStats, stats);

        // Track completed pipeline stage
        if (request.pipelineRunId && request.stageId) {
          let done = completedStages.get(request.pipelineRunId);
          if (!done) {
            done = new Set();
            completedStages.set(request.pipelineRunId, done);
          }
          done.add(request.stageId);
        }

        events.onSlotCompleted?.(slot.id, request, stats);
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        ports.logger.error(`Scheduler slot ${slot.id}: ${error.message}`);
        events.onSlotError?.(slot.id, request, error);
      })
      .finally(() => {
        slot.status = 'idle';
        slot.projectId = null;
        slot.abort = null;
        slot.runPromise = null;
        slot.activeTask = null;

        // Try to fill this slot with the next request
        if (running) {
          scheduleNext();
          // Check if everything is done
          if (!requestQueue.length && slots.every((s) => s.status === 'idle')) {
            events.onQueueDrained?.();
          }
        }
      });
  }

  function start(): void {
    if (running) return;
    running = true;
    ports.logger.info(`Scheduler: started (concurrency=${concurrency}, strategy=${strategy})`);
    scheduleNext();
  }

  function pause(): void {
    if (!running || paused) return;
    paused = true;
    ports.logger.info('Scheduler: paused — running tasks continue, queue frozen');
  }

  function resume(): void {
    if (!paused) return;
    paused = false;
    ports.logger.info('Scheduler: resumed');
    scheduleNext();
  }

  async function stop(): Promise<void> {
    running = false;
    paused = false;

    // Abort all running slots
    for (const slot of slots) {
      if (slot.status === 'running' && slot.abort) {
        slot.status = 'stopping';
        slot.abort.abort();
      }
    }

    // Wait for all running promises to settle
    const promises = slots
      .map((s) => s.runPromise)
      .filter((p): p is Promise<SprintStats> => p !== null);

    await Promise.allSettled(promises);

    // Clear the queue
    requestQueue.length = 0;

    ports.logger.info('Scheduler: stopped');
  }

  function cancel(requestId: string): boolean {
    const idx = requestQueue.findIndex((r) => r.id === requestId);
    if (idx === -1) return false;
    requestQueue.splice(idx, 1);
    return true;
  }

  async function stopProject(projectId: string): Promise<void> {
    // Remove queued requests for this project
    for (let i = requestQueue.length - 1; i >= 0; i--) {
      if (requestQueue[i]!.projectId === projectId) {
        requestQueue.splice(i, 1);
      }
    }

    // Abort running slots for this project
    const runningSlots = slots.filter(
      (s) => s.status === 'running' && s.projectId === projectId,
    );
    for (const slot of runningSlots) {
      slot.status = 'stopping';
      slot.abort?.abort();
    }

    // Wait for those slots to settle
    const promises = runningSlots
      .map((s) => s.runPromise)
      .filter((p): p is Promise<SprintStats> => p !== null);
    await Promise.allSettled(promises);
  }

  return {
    enqueue,
    start,
    stop,
    pause,
    resume,
    cancel,
    stopProject,
    get queue(): ReadonlyArray<RunRequest> {
      return requestQueue;
    },
    get slots(): ReadonlyArray<Readonly<RunSlot>> {
      return slots;
    },
    get isActive(): boolean {
      return running && (requestQueue.length > 0 || slots.some((s) => s.status !== 'idle'));
    },
    get isPaused(): boolean {
      return paused;
    },
    get aggregateStats(): SprintStats {
      return { ...totalStats };
    },
    get completedStages(): ReadonlyMap<string, ReadonlySet<string>> {
      return completedStages;
    },
    pausePipeline(pipelineRunId: string) {
      pausedPipelines.add(pipelineRunId);
    },
    resumePipeline(pipelineRunId: string) {
      pausedPipelines.delete(pipelineRunId);
      // Trigger scheduling to pick newly eligible stages
      if (running && !paused) scheduleNext();
    },
    isPipelinePaused(pipelineRunId: string): boolean {
      return pausedPipelines.has(pipelineRunId);
    },
    pauseProject(projectId: string) {
      pausedProjects.add(projectId);
      ports.logger.info(`Scheduler: project "${projectId}" paused — queued requests frozen`);
    },
    resumeProject(projectId: string) {
      pausedProjects.delete(projectId);
      ports.logger.info(`Scheduler: project "${projectId}" resumed`);
      if (running && !paused) scheduleNext();
    },
    isProjectPaused(projectId: string): boolean {
      return pausedProjects.has(projectId);
    },
    get pausedProjectIds(): ReadonlySet<string> {
      return pausedProjects;
    },
  };
}
