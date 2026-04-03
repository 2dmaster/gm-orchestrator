import { spawn } from 'child_process';
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
import { runSprint, runEpic } from '../core/orchestrator.js';

// ─── Types ───────────────────────────────────────────────────────────────

export type RunState = 'idle' | 'running' | 'stopping';

const MAX_LOG_BUFFER = 200;

export interface RunSnapshot {
  activeTask: Task | null;
  completedTasks: Task[];
  recentLines: string[];
}

export interface RunnerServiceDeps {
  config: OrchestratorConfig;
  gm: GraphMemoryPort;
  runner: ClaudeRunnerPort;
  poller: TaskPollerPort;
  logger: Logger;
  wsBus: WebSocketBus;
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

  // Wraps the injected runner to intercept stdout and emit log:line events.
  // In dry-run mode the orchestrator skips runner.run(), so this is safe.
  function createStreamingRunner(): ClaudeRunnerPort {
    return {
      async run(task: Task, config: OrchestratorConfig): Promise<void> {
        const active = getActiveProject(config);
        const prompt = buildPrompt(task, { projectId: active?.projectId ?? '' });
        const args = ['--print', '--dangerously-skip-permissions', ...config.claudeArgs, prompt];

        return new Promise((resolve, reject) => {
          const proc = spawn('claude', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
            detached: true,
          });

          // Stream stdout line by line
          if (proc.stdout) {
            let buffer = '';
            proc.stdout.on('data', (chunk: Buffer) => {
              buffer += chunk.toString();
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                pushLogLine(line);
                emit({ type: 'log:line', payload: { taskId: task.id, line } });
              }
            });
            proc.stdout.on('end', () => {
              if (buffer) {
                pushLogLine(buffer);
                emit({ type: 'log:line', payload: { taskId: task.id, line: buffer } });
              }
            });
          }

          // Also stream stderr
          if (proc.stderr) {
            let buffer = '';
            proc.stderr.on('data', (chunk: Buffer) => {
              buffer += chunk.toString();
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                pushLogLine(`[stderr] ${line}`);
                emit({ type: 'log:line', payload: { taskId: task.id, line: `[stderr] ${line}` } });
              }
            });
          }

          // Handle abort — kill entire process group
          if (activeAbort) {
            activeAbort.signal.addEventListener('abort', () => {
              if (proc.pid) {
                try {
                  process.kill(-proc.pid, 'SIGTERM');
                } catch {
                  proc.kill('SIGTERM');
                }
              } else {
                proc.kill('SIGTERM');
              }
            });
          }

          proc.on('close', () => resolve());
          proc.on('error', (err) => {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              reject(new Error('claude not found in PATH'));
            } else {
              reject(err);
            }
          });
        });
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
    startSprint,
    startEpic,
    stop,
  };
}
