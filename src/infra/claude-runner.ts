import { spawn } from 'child_process';
import type { ClaudeRunnerPort, Task, OrchestratorConfig } from '../core/types.js';
import { getActiveProject } from '../core/types.js';
import { buildPrompt } from '../core/prompt-builder.js';

export class ClaudeRunner implements ClaudeRunnerPort {
  /**
   * Spawns `claude --print <prompt>` as a child process.
   * Streams stdout/stderr to the parent terminal.
   * Resolves when the process exits (for any reason).
   *
   * Note: the orchestrator does NOT rely on process exit for completion
   * detection — it polls GraphMemory task status instead. The session
   * promise is awaited only for cleanup after the poller signals done.
   */
  async run(task: Task, config: OrchestratorConfig): Promise<void> {
    const active = getActiveProject(config);
    const prompt = buildPrompt(task, { projectId: active?.projectId ?? '' });
    const args = ['--print', '--dangerously-skip-permissions', ...config.claudeArgs, prompt];

    return new Promise((resolve, reject) => {
      const proc = spawn('claude', args, {
        stdio: 'inherit',
        env: process.env,
      });

      proc.on('close', (code) => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          // Non-zero exit is logged but not fatal — task status drives decisions
          resolve();
        }
      });

      proc.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(
            'claude not found in PATH.\n' +
            'Install Claude Code: npm install -g @anthropic-ai/claude-code'
          ));
        } else {
          reject(err);
        }
      });
    });
  }
}
