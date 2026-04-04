import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  OrchestratorConfig,
  GraphMemoryPort,
  ClaudeRunnerPort,
  TaskPollerPort,
  SprintStats,
  Task,
  ServerEvent,
} from '../core/types.js';
import { getActiveProject } from '../core/types.js';
import { buildPrompt } from '../core/prompt-builder.js';
import type { Logger, TaskResultMeta } from '../infra/logger.js';
import type { WebSocketBus } from './ws.js';
import type { RunnerService } from './api.js';
import { createScheduler } from '../core/scheduler.js';
import type { Scheduler } from '../core/scheduler.js';

// ─── Types ───────────────────────────────────────────────────────────────

const MAX_LOG_BUFFER = 200;

export interface RunSnapshot {
  projectId: string | null;
  activeTask: Task | null;
  completedTasks: Task[];
  recentLines: string[];
}

export interface MultiRunSnapshot {
  slots: Array<{
    id: number;
    status: string;
    projectId: string | null;
    activeTask: Task | null;
    completedTasks: Task[];
  }>;
  queue: Array<{ id: string; projectId: string; mode: string }>;
  aggregateStats: SprintStats;
}

export interface RunnerServiceDeps {
  config: OrchestratorConfig;
  gm: GraphMemoryPort;
  runner: ClaudeRunnerPort;
  poller: TaskPollerPort;
  logger: Logger;
  wsBus: WebSocketBus;
  resolveGm?: (projectId: string) => GraphMemoryPort;
  resolvePoller?: (projectId: string) => TaskPollerPort;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

// ─── Implementation ──────────────────────────────────────────────────────

export function createRunnerService(deps: RunnerServiceDeps): RunnerService {
  const { logger, wsBus } = deps;

  function emit(event: ServerEvent): void {
    wsBus.broadcast(event);
  }

  // Wrap the orchestrator logger to intercept events and forward to WS.
  // Each logger is scoped to a projectId so concurrent runs emit correctly tagged events.
  function createWsLogger(projectId: string): Logger {
    return {
      info: (msg) => logger.info(msg),
      success: (msg) => logger.success(msg),
      warn: (msg) => logger.warn(msg),
      error: (msg) => {
        logger.error(msg);
        emit({ type: 'error', payload: { message: msg, projectId } });
      },
      skip: (msg) => logger.skip(msg),
      section: (msg) => logger.section(msg),
      task: (task) => {
        logger.task(task);
        emit({ type: 'task:started', payload: { task, projectId } });
      },
      taskResult: (task: Task, result, meta?: TaskResultMeta) => {
        logger.taskResult(task, result, meta);
        if (meta?.attempt) {
          emit({ type: 'task:retrying', payload: { task, attempt: meta.attempt, projectId } });
          return;
        }
        const finishedTask = { ...task };
        switch (result) {
          case 'done':
          case 'dry_run':
            finishedTask.status = 'done';
            emit({ type: 'task:done', payload: { task: finishedTask, projectId } });
            break;
          case 'cancelled':
            finishedTask.status = 'cancelled';
            emit({ type: 'task:cancelled', payload: { task: finishedTask, projectId } });
            break;
          case 'timeout':
            emit({ type: 'task:timeout', payload: { task: finishedTask, projectId } });
            break;
        }
      },
    };
  }

  // Wraps the Agent SDK to stream structured events.
  // Scoped to a projectId for correct event tagging.
  function createStreamingRunner(projectId: string): ClaudeRunnerPort {
    return {
      async run(task: Task, config: OrchestratorConfig): Promise<void> {
        const active = getActiveProject(config);
        const pid = active?.projectId ?? projectId;
        const prompt = buildPrompt(task, { projectId: pid });

        const mcpBaseUrl = active?.baseUrl ?? 'http://localhost:3000';
        const mcpServers: Record<string, { command: string; args: string[] }> = {
          'graph-memory': {
            command: 'npx',
            args: ['-y', 'mcp-remote', `${mcpBaseUrl}/mcp/${pid}`],
          },
        };

        let turnCount = 0;

        // Inactivity watchdog
        let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
        let watchdogWarned = false;
        const watchdogMs = config.agentTimeoutMs;
        const warningMs = Math.max(Math.floor(watchdogMs * 0.6), 30_000);

        // Find the abort controller for this project's slot
        const slotAbort = scheduler?.slots.find(
          (s) => s.status === 'running' && s.projectId === pid,
        )?.abort;

        function resetWatchdog(): void {
          watchdogWarned = false;
          if (watchdogTimer) clearTimeout(watchdogTimer);
          watchdogTimer = setTimeout(() => {
            if (!watchdogWarned) {
              watchdogWarned = true;
              emit({
                type: 'agent:warning',
                payload: {
                  taskId: task.id,
                  message: `No agent activity for ${Math.round(warningMs / 1000)}s — may be stuck`,
                  projectId: pid,
                },
              });
              watchdogTimer = setTimeout(() => {
                emit({
                  type: 'agent:warning',
                  payload: {
                    taskId: task.id,
                    message: `Agent inactive for ${Math.round(watchdogMs / 1000)}s — aborting task`,
                    projectId: pid,
                  },
                });
                slotAbort?.abort();
              }, watchdogMs - warningMs);
            }
          }, warningMs);
        }

        resetWatchdog();

        try {
        for await (const message of query({
          prompt,
          options: {
            cwd: process.cwd(),
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            maxTurns: config.maxTurns,
            mcpServers,
            settingSources: ['project'],
            ...(slotAbort?.signal ? { abortSignal: slotAbort.signal } : {}),
          },
        })) {
          resetWatchdog();
          const msg = message as Record<string, unknown>;
          const msgType = msg.type as string | undefined;

          if (msgType === 'result') {
            const line = msg.result as string;
            if (line) {
              emit({ type: 'log:line', payload: { taskId: task.id, line, projectId: pid } });
            }
            const numTurns = msg.num_turns as number | undefined;
            if (numTurns) {
              emit({ type: 'agent:turn', payload: { taskId: task.id, turn: numTurns, projectId: pid } });
            }
            const usage = msg.usage as Record<string, number> | undefined;
            emit({
              type: 'agent:cost',
              payload: {
                taskId: task.id,
                costUsd: (msg.total_cost_usd as number) ?? 0,
                inputTokens: usage?.input_tokens ?? 0,
                outputTokens: usage?.output_tokens ?? 0,
                projectId: pid,
              },
            });
            continue;
          }

          if (msgType === 'assistant') {
            const assistantMsg = msg.message as Record<string, unknown> | undefined;
            const content = assistantMsg?.content as Array<Record<string, unknown>> | undefined;
            if (!content) continue;

            turnCount++;
            emit({ type: 'agent:turn', payload: { taskId: task.id, turn: turnCount, projectId: pid } });

            for (const block of content) {
              const blockType = block.type as string;

              if (blockType === 'tool_use') {
                const toolName = (block.name as string) ?? 'unknown';
                const toolInput = truncate(JSON.stringify(block.input ?? ''), 500);
                emit({ type: 'agent:tool_start', payload: { taskId: task.id, tool: toolName, input: toolInput, projectId: pid } });
                emit({ type: 'log:line', payload: { taskId: task.id, line: `[tool] ${toolName}: ${toolInput}`, projectId: pid } });
              } else if (blockType === 'text') {
                const text = (block.text as string) ?? '';
                if (text) {
                  emit({ type: 'log:line', payload: { taskId: task.id, line: text, projectId: pid } });
                }
              } else if (blockType === 'thinking') {
                const text = (block.thinking as string) ?? '';
                if (text) {
                  emit({ type: 'agent:thinking', payload: { taskId: task.id, text: truncate(text, 300), projectId: pid } });
                }
              }
            }
            continue;
          }

          if (msgType === 'user') {
            const userMsg = msg.message as Record<string, unknown> | undefined;
            const content = userMsg?.content as Array<Record<string, unknown>> | undefined;
            if (!content) continue;

            for (const block of content) {
              if (block.type === 'tool_result') {
                const toolOutput = truncate(JSON.stringify(block.content ?? ''), 500);
                emit({ type: 'agent:tool_end', payload: { taskId: task.id, tool: 'result', output: toolOutput, projectId: pid } });
              }
            }
            continue;
          }
        }
        } finally {
          if (watchdogTimer) clearTimeout(watchdogTimer);
        }
      },
    };
  }

  // ─── Scheduler (unified run engine) ────────────────────────────────────

  let scheduler: Scheduler | null = null;

  const PRIORITY_MAP: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  function ensureScheduler(): Scheduler {
    if (scheduler) return scheduler;

    // Ensure at least as many slots as configured projects so each can run in parallel
    const effectiveConfig = {
      ...deps.config,
      concurrency: Math.max(deps.config.concurrency, deps.config.projects.length, 1),
    };

    scheduler = createScheduler(effectiveConfig, {
      resolveGm: (projectId) => deps.resolveGm ? deps.resolveGm(projectId) : deps.gm,
      createRunner: (projectId) => deps.config.dryRun ? deps.runner : createStreamingRunner(projectId),
      createPoller: (projectId) => deps.resolvePoller ? deps.resolvePoller(projectId) : deps.poller,
      logger: createWsLogger(''),
      createLogger: (projectId) => createWsLogger(projectId),
    }, {
      onSlotStarted: (slotId, request) => {
        logger.info(`Scheduler: slot ${slotId} started ${request.mode} for project "${request.projectId}"`);
        emit({
          type: 'run:started',
          payload: { mode: request.mode, projectId: request.projectId, ...(request.epicId ? { epicId: request.epicId } : {}) },
        });
        emit({
          type: 'scheduler:slot_started',
          payload: { slotId, projectId: request.projectId, mode: request.mode },
        });
      },
      onSlotCompleted: (slotId, request, stats) => {
        logger.info(`Scheduler: slot ${slotId} completed for project "${request.projectId}"`);
        emit({
          type: 'run:complete',
          payload: { ...stats, projectId: request.projectId },
        });
        emit({
          type: 'scheduler:slot_completed',
          payload: { slotId, projectId: request.projectId, stats },
        });
      },
      onSlotError: (slotId, request, error) => {
        logger.error(`Scheduler: slot ${slotId} error for project "${request.projectId}": ${error.message}`);
        emit({ type: 'error', payload: { message: error.message, projectId: request.projectId } });
      },
      onQueueDrained: () => {
        logger.info('Scheduler: all runs complete');
        emit({ type: 'scheduler:drained' });
      },
    });

    return scheduler;
  }

  // ─── Public API ────────────────────────────────────────────────────────

  function getRunningProjectIds(): string[] {
    if (!scheduler) return [];
    return scheduler.slots
      .filter((s) => s.status === 'running' && s.projectId)
      .map((s) => s.projectId!);
  }

  function isProjectRunning(projectId: string): boolean {
    if (!scheduler) return false;
    return scheduler.slots.some(
      (s) => s.status === 'running' && s.projectId === projectId,
    );
  }

  async function startSprint(projectId: string, tag?: string): Promise<void> {
    if (isProjectRunning(projectId)) {
      throw new Error(`A run is already in progress for project "${projectId}"`);
    }

    logger.section(`Runner: starting sprint (project=${projectId}${tag ? `, tag=${tag}` : ''})`);
    const sched = ensureScheduler();
    sched.enqueue({ projectId, mode: 'sprint', tag, priority: PRIORITY_MAP['medium']! });
    sched.start();
  }

  async function startEpic(projectId: string, epicId: string): Promise<void> {
    if (isProjectRunning(projectId)) {
      throw new Error(`A run is already in progress for project "${projectId}"`);
    }

    logger.section(`Runner: starting epic ${epicId} (project=${projectId})`);
    const sched = ensureScheduler();
    sched.enqueue({ projectId, mode: 'epic', epicId, priority: PRIORITY_MAP['medium']! });
    sched.start();
  }

  async function startTasks(projectId: string, taskIds: string[]): Promise<void> {
    if (isProjectRunning(projectId)) {
      throw new Error(`A run is already in progress for project "${projectId}"`);
    }

    logger.section(`Runner: starting task run (project=${projectId}, tasks=${taskIds.length})`);
    const sched = ensureScheduler();
    sched.enqueue({ projectId, mode: 'tasks', taskIds, priority: PRIORITY_MAP['medium']! });
    sched.start();
  }

  async function startMultiSprint(
    projectIds: string[],
    tag?: string,
    priority?: string,
  ): Promise<string[]> {
    const sched = ensureScheduler();
    const priorityNum = PRIORITY_MAP[priority ?? 'medium'] ?? 2;

    const requestIds = projectIds.map((projectId) => {
      const reqId = sched.enqueue({
        projectId,
        mode: 'sprint',
        tag,
        priority: priorityNum,
      });
      emit({
        type: 'scheduler:enqueued',
        payload: { requestId: reqId, projectId, mode: 'sprint' },
      });
      return reqId;
    });

    sched.start();
    return requestIds;
  }

  function getMultiRunSnapshot(): MultiRunSnapshot {
    if (!scheduler) {
      return {
        slots: [],
        queue: [],
        aggregateStats: { done: 0, cancelled: 0, retried: 0, errors: 0, skipped: 0, durationMs: 0 },
      };
    }

    return {
      slots: scheduler.slots.map((s) => ({
        id: s.id,
        status: s.status,
        projectId: s.projectId,
        activeTask: s.activeTask,
        completedTasks: [...s.completedTasks],
      })),
      queue: scheduler.queue.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        mode: r.mode,
      })),
      aggregateStats: scheduler.aggregateStats,
    };
  }

  // Backward-compat snapshot: returns the first active slot's data
  function getRunSnapshot(): RunSnapshot {
    if (!scheduler) {
      return { projectId: null, activeTask: null, completedTasks: [], recentLines: [] };
    }
    const activeSlot = scheduler.slots.find((s) => s.status === 'running');
    if (!activeSlot) {
      return { projectId: null, activeTask: null, completedTasks: [], recentLines: [] };
    }
    return {
      projectId: activeSlot.projectId,
      activeTask: activeSlot.activeTask,
      completedTasks: [...activeSlot.completedTasks],
      recentLines: [...activeSlot.recentLines],
    };
  }

  function cancelQueued(requestId: string): boolean {
    if (!scheduler) return false;
    return scheduler.cancel(requestId);
  }

  async function stopProject(projectId: string): Promise<void> {
    if (!scheduler) return;
    await scheduler.stopProject(projectId);
    emit({ type: 'run:stopped', payload: { projectId } });
    logger.info(`Runner: stopped project "${projectId}"`);
  }

  // ─── Last-run tracking for restart ─────────────────────────────────────

  interface LastRun {
    projectId: string;
    mode: 'sprint' | 'epic' | 'tasks';
    epicId?: string | undefined;
    taskIds?: string[] | undefined;
    tag?: string | undefined;
  }
  let lastRun: LastRun | null = null;

  function trackLastRun(r: LastRun): void {
    lastRun = { ...r };
  }

  // Patch the existing start* functions to track lastRun
  const _origStartSprint = startSprint;
  async function wrappedStartSprint(projectId: string, tag?: string): Promise<void> {
    trackLastRun({ projectId, mode: 'sprint', tag });
    return _origStartSprint(projectId, tag);
  }

  const _origStartEpic = startEpic;
  async function wrappedStartEpic(projectId: string, epicId: string): Promise<void> {
    trackLastRun({ projectId, mode: 'epic', epicId });
    return _origStartEpic(projectId, epicId);
  }

  const _origStartTasks = startTasks;
  async function wrappedStartTasks(projectId: string, taskIds: string[]): Promise<void> {
    trackLastRun({ projectId, mode: 'tasks', taskIds });
    return _origStartTasks(projectId, taskIds);
  }

  // ─── Pause / Resume / Restart ─────────────────────────────────────────

  function pause(): void {
    if (!scheduler) return;
    scheduler.pause();
    emit({ type: 'run:paused' });
    logger.info('Runner: paused');
  }

  function resume(): void {
    if (!scheduler) return;
    scheduler.resume();
    emit({ type: 'run:resumed' });
    logger.info('Runner: resumed');
  }

  async function restart(): Promise<void> {
    if (!lastRun) {
      throw new Error('Nothing to restart — no previous run recorded');
    }
    const r = lastRun;
    logger.info(`Runner: restarting last run (${r.mode} project=${r.projectId})`);
    if (r.mode === 'epic' && r.epicId) {
      await wrappedStartEpic(r.projectId, r.epicId);
    } else if (r.mode === 'tasks' && r.taskIds) {
      await wrappedStartTasks(r.projectId, r.taskIds);
    } else {
      await wrappedStartSprint(r.projectId, r.tag);
    }
  }

  async function stopAll(): Promise<void> {
    if (!scheduler) return;
    const runningIds = getRunningProjectIds();
    await scheduler.stop();
    for (const pid of runningIds) {
      emit({ type: 'run:stopped', payload: { projectId: pid } });
    }
    scheduler = null;
    logger.info('Runner: all runs stopped');
  }

  return {
    get isRunning() {
      return getRunningProjectIds().length > 0;
    },
    get isPaused() {
      return scheduler?.isPaused ?? false;
    },
    getRunningProjectIds,
    isProjectRunning,
    getRunSnapshot,
    getMultiRunSnapshot,
    startSprint: wrappedStartSprint,
    startEpic: wrappedStartEpic,
    startTasks: wrappedStartTasks,
    startMultiSprint,
    cancelQueued,
    stopProject,
    stop: stopAll,
    pause,
    resume,
    restart,
  };
}
