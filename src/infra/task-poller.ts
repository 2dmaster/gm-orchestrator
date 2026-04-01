import type { TaskPollerPort, GraphMemoryPort } from '../core/types.js';

const POLL_INTERVAL_MS = 3_000;

export class TaskPoller implements TaskPollerPort {
  constructor(private readonly gm: GraphMemoryPort) {}

  async waitForCompletion(
    taskId: string,
    { timeoutMs }: { timeoutMs: number }
  ): Promise<'done' | 'cancelled' | 'timeout'> {
    const deadline = Date.now() + timeoutMs;
    let tick = 0;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);

      let task;
      try {
        task = await this.gm.getTask(taskId);
      } catch {
        // Transient network error — keep polling
        continue;
      }

      if (task.status === 'done') {
        clearProgress();
        return 'done';
      }
      if (task.status === 'cancelled') {
        clearProgress();
        return 'cancelled';
      }

      // Progress dots
      tick = (tick + 1) % 4;
      process.stdout.write(`\r  ⏳ ${taskId} ${'·'.repeat(tick + 1)}   `);
    }

    clearProgress();
    return 'timeout';
  }
}

function clearProgress(): void {
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
