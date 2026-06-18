## Decision
`handleVerifyFailure` in `src/core/post-task-hooks.ts` moves a verify-failed task to `cancelled` (not `in_progress`), keeps the `auto-verify-failed` tag, and writes failure metadata. This is the stable terminal state for human review.

## Why
The v0.12.0 implementation moved verify-failed tasks to `in_progress` (with a code comment that incorrectly said "review"). On next orchestrator startup `recoverZombieTasks` (default policy `reset-to-todo`) flipped them back to `todo`, causing infinite re-runs of verification-failing tasks.

## Why `cancelled` (not a new `review` status)
- TaskStatus type and the GraphMemory REST server only support `backlog | todo | in_progress | done | cancelled` — there is no `review`.
- The codebase already uses the convention `cancelled + tag = review` (see `move-to-review` zombie policy).
- Sprint/epic loops filter out `cancelled` from their queues, so the task is naturally not re-picked.
- `recoverZombieTasks` only operates on `in_progress`, so cancelled tasks are not touched on restart.

## Side benefit
Combined with the heartbeat metadata-merge fix (`cabd7ce8`), the `verifyFailedAt`/`verifyFailures` records survive the run's `finally` block — humans can inspect the cancelled task and see exactly which hook failed and the captured stdout/stderr tails.

## Tests
- `tests/unit/post-task-hooks.test.ts`: asserts move to `cancelled`, never to `in_progress`.
- `tests/unit/heartbeat.test.ts`: explicit zombie-recovery test confirming cancelled+verify-failed tasks are ignored.
- `tests/integration/orchestrator.test.ts`: restart-simulation test — second sprint run after a verify failure runs nothing.