import type { PostTaskHook, HookExecResult, HookRunnerPort, Task, GraphMemoryPort } from './types.js';
import type { Logger } from '../infra/logger.js';

/** Default per-hook timeout applied when neither hook nor config sets one. */
export const DEFAULT_POST_TASK_HOOK_TIMEOUT_MS = 300_000; // 5 minutes

/** Aggregate result of running all post-task hooks for a single task. */
export interface PostTaskHookReport {
  passed: boolean;
  results: Array<{ hook: PostTaskHook; result: HookExecResult }>;
  /** Set when the run was cut short by an external abort (not a hook failure). */
  aborted?: boolean;
}

/** Options for running the post-task hook batch. */
export interface RunPostTaskHooksOptions {
  /** Cancels any in-flight hook and stops the batch. */
  signal?: AbortSignal;
  /** Default per-hook timeout if the hook does not specify its own. */
  defaultTimeoutMs?: number;
}

/** Maximum output to attach to task metadata (prevents bloating). */
const MAX_OUTPUT_LINES = 50;

function tailLines(text: string, max: number): string {
  const lines = text.split('\n');
  if (lines.length <= max) return text;
  return lines.slice(-max).join('\n');
}

/**
 * Runs all configured post-task hooks sequentially.
 * Stops on the first 'block' failure. 'warn' failures are logged but don't stop.
 */
export async function runPostTaskHooks(
  hooks: PostTaskHook[],
  hookRunner: HookRunnerPort,
  logger: Logger,
  opts: RunPostTaskHooksOptions = {},
): Promise<PostTaskHookReport> {
  const results: PostTaskHookReport['results'] = [];
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_POST_TASK_HOOK_TIMEOUT_MS;

  for (const hook of hooks) {
    if (opts.signal?.aborted) {
      logger.warn(`Post-task hooks aborted before "${hook.name}" — stopping`);
      return { passed: false, results, aborted: true };
    }

    const timeoutMs = hook.timeoutMs ?? defaultTimeoutMs;
    logger.info(`Running post-task hook: "${hook.name}" (timeout ${timeoutMs}ms)`);
    const result = await hookRunner.exec(hook, {
      ...(opts.signal ? { signal: opts.signal } : {}),
      timeoutMs,
    });
    results.push({ hook, result });

    if (result.success) {
      logger.success(`Hook "${hook.name}" passed`);
      continue;
    }

    if (result.failureReason === 'aborted') {
      logger.warn(`Hook "${hook.name}" aborted — stopping post-task hooks`);
      return { passed: false, results, aborted: true };
    }

    if (result.failureReason === 'timeout') {
      logger.error(`Hook "${hook.name}" timed out after ${timeoutMs}ms — failing`);
      return { passed: false, results };
    }

    if (hook.onFailure === 'warn') {
      logger.warn(`Hook "${hook.name}" failed (exit ${result.exitCode}) — onFailure=warn, continuing`);
      continue;
    }

    logger.error(`Hook "${hook.name}" failed (exit ${result.exitCode}) — blocking`);
    return { passed: false, results };
  }

  return { passed: true, results };
}

/**
 * Handles a verify-failed result: moves the task to a stable terminal state
 * (`cancelled` + `auto-verify-failed` tag) and attaches failure metadata so
 * a human can review without the orchestrator re-picking it forever.
 *
 * NOTE: GraphMemory has no `review` status — we use `cancelled` + tag as
 * the convention (same approach as the `move-to-review` zombie policy).
 * The previous v0.12.0 implementation moved to `in_progress`, which made
 * the task look like a zombie on next startup; the `reset-to-todo` recovery
 * policy then re-ran it forever.
 */
export async function handleVerifyFailure(
  task: Task,
  report: PostTaskHookReport,
  gm: GraphMemoryPort,
  logger: Logger,
): Promise<void> {
  // Move to a stable terminal state so the orchestrator stops re-picking it.
  await gm.moveTask(task.id, 'cancelled').catch(() => {});

  // Build failure summary for metadata
  const failures = report.results.filter((r) => !r.result.success);
  const failureSummary = failures.map((f) => ({
    hook: f.hook.name,
    exitCode: f.result.exitCode,
    stdout: tailLines(f.result.stdout, MAX_OUTPUT_LINES),
    stderr: tailLines(f.result.stderr, MAX_OUTPUT_LINES),
  }));

  // Update task with failure metadata and tag
  const existingTags = task.tags ?? [];
  const newTags = existingTags.includes('auto-verify-failed')
    ? existingTags
    : [...existingTags, 'auto-verify-failed'];

  await gm.updateTask(task.id, {
    tags: newTags,
    metadata: {
      ...(task.metadata ?? {}),
      verifyFailedAt: Date.now(),
      verifyFailures: failureSummary,
    },
  }).catch((e: unknown) => {
    logger.warn(`Could not update task with verify failure metadata: ${String(e)}`);
  });

  logger.error(
    `Task "${task.title}" (${task.id}) failed post-task verification — ` +
    `moved to cancelled (for review), tagged auto-verify-failed. ` +
    `${failures.length} hook(s) failed: ${failures.map((f) => f.hook.name).join(', ')}`
  );
}
