import type { PostTaskHook, HookExecResult, HookRunnerPort, Task, GraphMemoryPort } from './types.js';
import type { Logger } from '../infra/logger.js';

/** Aggregate result of running all post-task hooks for a single task. */
export interface PostTaskHookReport {
  passed: boolean;
  results: Array<{ hook: PostTaskHook; result: HookExecResult }>;
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
): Promise<PostTaskHookReport> {
  const results: PostTaskHookReport['results'] = [];

  for (const hook of hooks) {
    logger.info(`Running post-task hook: "${hook.name}"`);
    const result = await hookRunner.exec(hook);
    results.push({ hook, result });

    if (result.success) {
      logger.success(`Hook "${hook.name}" passed`);
      continue;
    }

    if (hook.onFailure === 'warn') {
      logger.warn(`Hook "${hook.name}" failed (exit ${result.exitCode}) — onFailure=warn, continuing`);
      continue;
    }

    // onFailure === 'block'
    logger.error(`Hook "${hook.name}" failed (exit ${result.exitCode}) — blocking`);
    return { passed: false, results };
  }

  return { passed: true, results };
}

/**
 * Handles a verify-failed result: moves task to 'review', attaches failure
 * metadata, and adds the 'auto-verify-failed' tag.
 */
export async function handleVerifyFailure(
  task: Task,
  report: PostTaskHookReport,
  gm: GraphMemoryPort,
  logger: Logger,
): Promise<void> {
  // Move task back to review (not todo — work might be mostly correct)
  await gm.moveTask(task.id, 'in_progress').catch(() => {});

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
    `moved to in_progress, tagged auto-verify-failed. ` +
    `${failures.length} hook(s) failed: ${failures.map((f) => f.hook.name).join(', ')}`
  );
}
