import { spawn } from 'child_process';
import type {
  PostTaskHook,
  HookExecResult,
  HookRunnerPort,
  HookExecOptions,
} from '../core/types.js';

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB per stream

/**
 * Executes post-task hook commands as child processes.
 * Each hook runs in its own shell and is killable via AbortSignal or timeout.
 */
export class HookRunner implements HookRunnerPort {
  async exec(hook: PostTaskHook, opts: HookExecOptions = {}): Promise<HookExecResult> {
    const timeout = opts.timeoutMs ?? hook.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<HookExecResult>((resolve) => {
      const child = spawn(hook.command, {
        cwd: hook.cwd ?? process.cwd(),
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let timedOut = false;
      let aborted = false;

      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeout);

      const onAbort = () => {
        aborted = true;
        kill();
      };

      if (opts.signal) {
        if (opts.signal.aborted) {
          aborted = true;
          // schedule kill after spawn; child may not be listening yet
          queueMicrotask(kill);
        } else {
          opts.signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      function kill(): void {
        if (child.exitCode !== null || child.signalCode !== null) return;
        try {
          child.kill('SIGTERM');
          // Escalate if the process doesn't exit promptly.
          setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              try { child.kill('SIGKILL'); } catch { /* ignore */ }
            }
          }, 5_000).unref();
        } catch { /* ignore */ }
      }

      function cleanup(): void {
        clearTimeout(timer);
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdoutBytes >= MAX_OUTPUT_BYTES) return;
        stdoutBytes += chunk.length;
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrBytes >= MAX_OUTPUT_BYTES) return;
        stderrBytes += chunk.length;
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          success: false,
          exitCode: 1,
          stdout,
          stderr: stderr || String(err.message),
        });
      });

      child.on('close', (code, signalName) => {
        if (settled) return;
        settled = true;
        cleanup();

        if (aborted) {
          resolve({
            success: false,
            exitCode: typeof code === 'number' ? code : 1,
            stdout,
            stderr: stderr || `hook aborted (${signalName ?? 'signal'})`,
            failureReason: 'aborted',
          });
          return;
        }

        if (timedOut) {
          resolve({
            success: false,
            exitCode: typeof code === 'number' ? code : 1,
            stdout,
            stderr: stderr || `hook timed out after ${timeout}ms`,
            failureReason: 'timeout',
          });
          return;
        }

        const exitCode = typeof code === 'number' ? code : 1;
        resolve({
          success: exitCode === 0,
          exitCode,
          stdout,
          stderr,
        });
      });
    });
  }
}
