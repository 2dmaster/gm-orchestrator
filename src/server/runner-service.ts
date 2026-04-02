import { spawn } from 'child_process';
import type {
  OrchestratorConfig,
  GraphMemoryPort,
  ClaudeRunnerPort,
  TaskPollerPort,
  SprintStats,
  Task,
  ServerEvent,
} from '../core/types.js';
import { buildPrompt } from '../core/prompt-builder.js';
import type { Logger } from '../infra/logger.js';
import type { WebSocketBus } from './ws.js';
import type { RunnerService } from './api.js';
import { runSprint, runEpic } from '../core/orchestrator.js';

// ─── Types ───────────────────────────────────────────────────────────────

export type RunState = 'idle' | 'running' | 'stopping';

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

  const { logger, wsBus } = deps;

  function emit(event: ServerEvent): void {
    wsBus.broadcast(event);
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
        emit({ type: 'task:started', payload: { task } });
      },
    };
  }

  // Wraps the injected runner to intercept stdout and emit log:line events.
  // In dry-run mode the orchestrator skips runner.run(), so this is safe.
  function createStreamingRunner(): ClaudeRunnerPort {
    return {
      async run(task: Task, config: OrchestratorConfig): Promise<void> {
        const prompt = buildPrompt(task, { projectId: config.projectId });
        const args = ['--print', '--dangerously-skip-permissions', ...config.claudeArgs, prompt];

        return new Promise((resolve, reject) => {
          const proc = spawn('claude', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
          });

          // Stream stdout line by line
          if (proc.stdout) {
            let buffer = '';
            proc.stdout.on('data', (chunk: Buffer) => {
              buffer += chunk.toString();
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                emit({ type: 'log:line', payload: { taskId: task.id, line } });
              }
            });
            proc.stdout.on('end', () => {
              if (buffer) {
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
                emit({ type: 'log:line', payload: { taskId: task.id, line: `[stderr] ${line}` } });
              }
            });
          }

          // Handle abort
          if (activeAbort) {
            activeAbort.signal.addEventListener('abort', () => {
              proc.kill('SIGTERM');
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
      projectId,
      ...(tag !== undefined ? { tag } : {}),
    };

    emit({ type: 'run:started', payload: { mode: 'sprint' } });
    logger.section(`Runner: starting sprint (project=${projectId}${tag ? `, tag=${tag}` : ''})`);

    const runner = config.dryRun ? deps.runner : createStreamingRunner();
    runPromise = runSprint(
      {
        gm: deps.gm,
        runner,
        poller: deps.poller,
        logger: createWsLogger(),
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
    const config: OrchestratorConfig = { ...deps.config, projectId };

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
    startSprint,
    startEpic,
    stop,
  };
}
