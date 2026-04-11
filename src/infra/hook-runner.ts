import { exec } from 'child_process';
import type { PostTaskHook, HookExecResult, HookRunnerPort } from '../core/types.js';

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

/**
 * Executes post-task hook commands as child processes.
 * Each hook is run in its own shell, capturing stdout/stderr.
 */
export class HookRunner implements HookRunnerPort {
  async exec(hook: PostTaskHook): Promise<HookExecResult> {
    const timeout = hook.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<HookExecResult>((resolve) => {
      exec(
        hook.command,
        {
          cwd: hook.cwd ?? process.cwd(),
          timeout,
          maxBuffer: MAX_BUFFER,
        },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              success: false,
              exitCode: typeof error.code === 'number' ? error.code : 1,
              stdout: typeof stdout === 'string' ? stdout : '',
              stderr: typeof stderr === 'string' ? stderr : String(error.message),
            });
          } else {
            resolve({
              success: true,
              exitCode: 0,
              stdout: typeof stdout === 'string' ? stdout : '',
              stderr: typeof stderr === 'string' ? stderr : '',
            });
          }
        },
      );
    });
  }
}
