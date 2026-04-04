import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  OrchestratorConfig,
  GraphMemoryPort,
  ClaudeRunnerPort,
  TaskPollerPort,
  SprintStats,
  Task,
  ServerEvent,
  ProjectEntry,
} from '../core/types.js';
import { getActiveProject } from '../core/types.js';
import { buildPrompt } from '../core/prompt-builder.js';
import type { Logger, TaskResultMeta } from '../infra/logger.js';
import type { WebSocketBus } from './ws.js';
import type { RunnerService } from './api.js';
import { runSprint, runEpic, runTasks } from '../core/orchestrator.js';
import { createScheduler } from '../core/scheduler.js';
import type { Scheduler, RunRequest } from '../core/scheduler.js';

// ─── Types ───────────────────────────────────────────────────────────────

export type RunState = 'idle' | 'running' | 'stopping';

const MAX_LOG_BUFFER = 200;

export interface RunSnapshot {
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
  let state: RunState = 'idle';
  let activeAbort: AbortController | null = null;
  let activeTaskId: string | null = null;
  let runPromise: Promise<SprintStats> | null = null;

  // Run state for late-connecting clients
  let activeTask: Task | null = null;
  let completedTasks: Task[] = [];
  let recentLines: string[] = [];

  const { logger, wsBus } = deps;

  function emit(event: ServerEvent): void {
    wsBus.broadcast(event);
  }

  function resetRunState(): void {
    activeTask = null;
    completedTasks = [];
    recentLines = [];
  }

  function pushLogLine(line: string): void {
    recentLines.push(line);
    if (recentLines.length > MAX_LOG_BUFFER) {
      recentLines = recentLines.slice(-MAX_LOG_BUFFER);
    }
  }

  // Wrap the orchestrator logger to intercept events and forward to WS
  function createWsLogger(): Logger {
    return {
      info: (msg) => logger.info(msg),
      success: (msg) => logger.success(msg),
      warn: (msg) => logger.warn(msg),
      error: (msg) => {
        logger.error(msg);
        emit({ type: 'error', payload: { message: msg } });
      },
      skip: (msg) => logger.skip(msg),
      section: (msg) => logger.section(msg),
      task: (task) => {
        logger.task(task);
        activeTaskId = task.id;
        activeTask = task;
        recentLines = [];
        emit({ type: 'task:started', payload: { task } });
      },
      taskResult: (task: Task, result, meta?: TaskResultMeta) => {
        logger.taskResult(task, result, meta);
        // Retrying — task will be picked up again
        if (meta?.attempt) {
          emit({ type: 'task:retrying', payload: { task, attempt: meta.attempt } });
          return;
        }
        // Terminal states
        const finishedTask = { ...task };
        activeTask = null;
        switch (result) {
          case 'done':
          case 'dry_run':
            finishedTask.status = 'done';
            completedTasks.push(finishedTask);
            emit({ type: 'task:done', payload: { task: finishedTask } });
            break;
          case 'cancelled':
            finishedTask.status = 'cancelled';
            completedTasks.push(finishedTask);
            emit({ type: 'task:cancelled', payload: { task: finishedTask } });
            break;
          case 'timeout':
            completedTasks.push(finishedTask);
            emit({ type: 'task:timeout', payload: { task: finishedTask } });
            break;
        }
      },
    };
  }

  // Wraps the Agent SDK to stream structured events and emit log:line for backward compat.
  // In dry-run mode the orchestrator skips runner.run(), so this is safe.
  function createStreamingRunner(): ClaudeRunnerPort {
    return {
      async run(task: Task, config: OrchestratorConfig): Promise<void> {
        const active = getActiveProject(config);
        const projectId = active?.projectId ?? '';
        const prompt = buildPrompt(task, { projectId });

        // Build MCP server config for GraphMemory access
        const mcpBaseUrl = active?.baseUrl ?? 'http://localhost:3000';
        const mcpServers: Record<string, { command: string; args: string[] }> = {
          'graph-memory': {
            command: 'npx',
            args: ['-y', 'mcp-remote', `${mcpBaseUrl}/mcp/${projectId}`],
          },
        };

        const abortSignal = activeAbort?.signal;
        let turnCount = 0;

        // Inactivity watchdog: abort if no SDK events for agentTimeoutMs
        let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
        let watchdogWarned = false;
        const watchdogMs = config.agentTimeoutMs;
        const warningMs = Math.max(Math.floor(watchdogMs * 0.6), 30_000);

        function resetWatchdog(): void {
          watchdogWarned = false;
          if (watchdogTimer) clearTimeout(watchdogTimer);
          // First fire a warning at 60% of timeout, then abort at 100%
          watchdogTimer = setTimeout(() => {
            if (!watchdogWarned) {
              watchdogWarned = true;
              emit({
                type: 'agent:warning',
                payload: {
                  taskId: task.id,
                  message: `No agent activity for ${Math.round(warningMs / 1000)}s — may be stuck`,
                },
              });
              // Set final abort timer for the remaining time
              watchdogTimer = setTimeout(() => {
                emit({
                  type: 'agent:warning',
                  payload: {
                    taskId: task.id,
                    message: `Agent inactive for ${Math.round(watchdogMs / 1000)}s — aborting task`,
                  },
                });
                activeAbort?.abort();
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
            ...(abortSignal ? { abortSignal } : {}),
          },
        })) {
          resetWatchdog();
          const msg = message as Record<string, unknown>;
          const msgType = msg.type as string | undefined;

          // ── Result (final message) ──
          if (msgType === 'result') {
            const line = msg.result as string;
            if (line) {
              pushLogLine(line);
              emit({ type: 'log:line', payload: { taskId: task.id, line } });
            }
            const numTurns = msg.num_turns as number | undefined;
            if (numTurns) {
              emit({ type: 'agent:turn', payload: { taskId: task.id, turn: numTurns } });
            }
            const usage = msg.usage as Record<string, number> | undefined;
            emit({
              type: 'agent:cost',
              payload: {
                taskId: task.id,
                costUsd: (msg.total_cost_usd as number) ?? 0,
                inputTokens: usage?.input_tokens ?? 0,
                outputTokens: usage?.output_tokens ?? 0,
              },
            });
            continue;
          }

          // ── Assistant message (tool calls, text, thinking) ──
          if (msgType === 'assistant') {
            const assistantMsg = msg.message as Record<string, unknown> | undefined;
            const content = assistantMsg?.content as Array<Record<string, unknown>> | undefined;
            if (!content) continue;

            turnCount++;
            emit({ type: 'agent:turn', payload: { taskId: task.id, turn: turnCount } });

            for (const block of content) {
              const blockType = block.type as string;

              if (blockType === 'tool_use') {
                const toolName = (block.name as string) ?? 'unknown';
                const toolInput = truncate(JSON.stringify(block.input ?? ''), 500);
                emit({ type: 'agent:tool_start', payload: { taskId: task.id, tool: toolName, input: toolInput } });
                pushLogLine(`[tool] ${toolName}: ${toolInput}`);
                emit({ type: 'log:line', payload: { taskId: task.id, line: `[tool] ${toolName}: ${toolInput}` } });
              } else if (blockType === 'text') {
                const text = (block.text as string) ?? '';
                if (text) {
                  pushLogLine(text);
                  emit({ type: 'log:line', payload: { taskId: task.id, line: text } });
                }
              } else if (blockType === 'thinking') {
                const text = (block.thinking as string) ?? '';
                if (text) {
                  emit({ type: 'agent:thinking', payload: { taskId: task.id, text: truncate(text, 300) } });
                }
              }
            }
            continue;
          }

          // ── User message (tool results) ──
          if (msgType === 'user') {
            const userMsg = msg.message as Record<string, unknown> | undefined;
            const content = userMsg?.content as Array<Record<string, unknown>> | undefined;
            if (!content) continue;

            for (const block of content) {
              if (block.type === 'tool_result') {
                const toolOutput = truncate(JSON.stringify(block.content ?? ''), 500);
                emit({ type: 'agent:tool_end', payload: { taskId: task.id, tool: 'result', output: toolOutput } });
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

  async function startSprint(projectId: string, tag?: string): Promise<void> {
    if (state !== 'idle') {
      throw new Error('A run is already in progress');
    }

    state = 'running';
    activeAbort = new AbortController();
    const config: OrchestratorConfig = {
      ...deps.config,
      activeProjectId: projectId,
      ...(tag !== undefined ? { tag } : {}),
    };
    // Ensure the project is in the projects array
    if (!config.projects.some((p) => p.projectId === projectId)) {
      const base = getActiveProject(deps.config);
      config.projects = [...config.projects, { baseUrl: base?.baseUrl ?? 'http://localhost:3000', projectId }];
    }

    resetRunState();
    emit({ type: 'run:started', payload: { mode: 'sprint' } });
    logger.section(`Runner: starting sprint (project=${projectId}${tag ? `, tag=${tag}` : ''})`);

    const runner = config.dryRun ? deps.runner : createStreamingRunner();
    runPromise = runSprint(
      {
        gm: deps.gm,
        runner,
        poller: deps.poller,
        logger: createWsLogger(),
        signal: activeAbort.signal,
      },
      config,
    );

    try {
      const stats = await runPromise;
      if ((state as RunState) !== 'stopping') {
        emit({ type: 'run:complete', payload: stats });
      }
    } catch (err) {
      emit({ type: 'error', payload: { message: (err as Error).message } });
      throw err;
    } finally {
      state = 'idle';
      activeAbort = null;
      activeTaskId = null;
      runPromise = null;
    }
  }

  async function startEpic(projectId: string, epicId: string): Promise<void> {
    if (state !== 'idle') {
      throw new Error('A run is already in progress');
    }

    state = 'running';
    activeAbort = new AbortController();
    const config: OrchestratorConfig = { ...deps.config, activeProjectId: projectId };
    // Ensure the project is in the projects array
    if (!config.projects.some((p) => p.projectId === projectId)) {
      const base = getActiveProject(deps.config);
      config.projects = [...config.projects, { baseUrl: base?.baseUrl ?? 'http://localhost:3000', projectId }];
    }

    resetRunState();
    emit({ type: 'run:started', payload: { mode: 'epic', epicId } });
    logger.section(`Runner: starting epic ${epicId} (project=${projectId})`);

    const runner = config.dryRun ? deps.runner : createStreamingRunner();
    runPromise = runEpic(
      epicId,
      {
        gm: deps.gm,
        runner,
        poller: deps.poller,
        logger: createWsLogger(),
        signal: activeAbort.signal,
      },
      config,
    );

    try {
      const stats = await runPromise;
      if ((state as RunState) !== 'stopping') {
        emit({ type: 'run:complete', payload: stats });
      }
    } catch (err) {
      emit({ type: 'error', payload: { message: (err as Error).message } });
      throw err;
    } finally {
      state = 'idle';
      activeAbort = null;
      activeTaskId = null;
      runPromise = null;
    }
  }

  async function startTasks(projectId: string, taskIds: string[]): Promise<void> {
    if (state !== 'idle') {
      throw new Error('A run is already in progress');
    }

    state = 'running';
    activeAbort = new AbortController();
    const config: OrchestratorConfig = { ...deps.config, activeProjectId: projectId };
    // Ensure the project is in the projects array
    if (!config.projects.some((p) => p.projectId === projectId)) {
      const base = getActiveProject(deps.config);
      config.projects = [...config.projects, { baseUrl: base?.baseUrl ?? 'http://localhost:3000', projectId }];
    }

    resetRunState();
    emit({ type: 'run:started', payload: { mode: 'sprint', projectId } });
    logger.section(`Runner: starting task run (project=${projectId}, tasks=${taskIds.length})`);

    const runner = config.dryRun ? deps.runner : createStreamingRunner();
    runPromise = runTasks(
      taskIds,
      {
        gm: deps.gm,
        runner,
        poller: deps.poller,
        logger: createWsLogger(),
        signal: activeAbort.signal,
      },
      config,
    );

    try {
      const stats = await runPromise;
      if ((state as RunState) !== 'stopping') {
        emit({ type: 'run:complete', payload: stats });
      }
    } catch (err) {
      emit({ type: 'error', payload: { message: (err as Error).message } });
      throw err;
    } finally {
      state = 'idle';
      activeAbort = null;
      activeTaskId = null;
      runPromise = null;
    }
  }

  async function stop(): Promise<void> {
    if (state !== 'running') {
      return;
    }

    state = 'stopping';
    logger.warn('Runner: stop requested');

    if (activeAbort) {
      activeAbort.abort();
    }

    // Wait for the current run to wind down
    if (runPromise) {
      try {
        await runPromise;
      } catch {
        // Expected — run may throw when aborted
      }
    }

    emit({ type: 'run:stopped' });
    logger.info('Runner: stopped');
  }

  // ─── Multi-project scheduler ───────────────────────────────────────────

  let scheduler: Scheduler | null = null;

  const PRIORITY_MAP: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  function ensureScheduler(): Scheduler {
    if (scheduler) return scheduler;

    scheduler = createScheduler(deps.config, {
      resolveGm: (projectId) => deps.resolveGm ? deps.resolveGm(projectId) : deps.gm,
      createRunner: (_projectId) => deps.config.dryRun ? deps.runner : createStreamingRunner(),
      createPoller: (projectId) => deps.resolvePoller ? deps.resolvePoller(projectId) : deps.poller,
      logger: createWsLogger(),
    }, {
      onSlotStarted: (slotId, request) => {
        logger.info(`Scheduler: slot ${slotId} started ${request.mode} for project "${request.projectId}"`);
        emit({
          type: 'scheduler:slot_started',
          payload: { slotId, projectId: request.projectId, mode: request.mode },
        });
      },
      onSlotCompleted: (slotId, request, stats) => {
        logger.info(`Scheduler: slot ${slotId} completed for project "${request.projectId}"`);
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
        state = 'idle';
        scheduler = null;
      },
    });

    return scheduler;
  }

  async function startMultiSprint(
    projectIds: string[],
    tag?: string,
    priority?: string,
  ): Promise<string[]> {
    if (state !== 'idle' && !scheduler) {
      throw new Error('A run is already in progress');
    }

    state = 'running';
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

  function cancelQueued(requestId: string): boolean {
    if (!scheduler) return false;
    return scheduler.cancel(requestId);
  }

  return {
    get isRunning() {
      return state !== 'idle';
    },
    getRunSnapshot(): RunSnapshot {
      return {
        activeTask,
        completedTasks: [...completedTasks],
        recentLines: [...recentLines],
      };
    },
    getMultiRunSnapshot,
    startSprint,
    startEpic,
    startTasks,
    startMultiSprint,
    cancelQueued,
    stop: async () => {
      // Stop scheduler if active
      if (scheduler) {
        await scheduler.stop();
        scheduler = null;
      }
      await stop();
    },
  };
}
