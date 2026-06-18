## Decision
`runEpic` in `src/core/orchestrator.ts` marks the epic in graph-memory based on the *terminal mix* of its tasks once the runnable queue is empty:
- Any task `done` (mixed `done`/`cancelled`) → `gm.moveEpic('done')`
- Every task `cancelled` → `gm.moveEpic('cancelled')`
- Empty epic (no tasks) → epic untouched
- Queue empty because remaining tasks are blocked → epic untouched (handled by separate "all blocked" branch)

## Why
The v0.12.0 check used `allTasks.every(t => t.status === 'done')`, but the queue filter excluded both `done` and `cancelled`. Result: any epic that ended with at least one cancelled task drained its queue, logged "Epic complete", but never called `moveEpic`. The graph stayed `open` while the orchestrator and UI showed "finished" — the source of the "не понимаю done или cancelled" confusion in the audit.

## Why mixed→done (not "partially_done")
GM has no `partially_done` epic status. Adding one would require GM schema and UI changes. Using `done` + a log line that surfaces the cancelled count keeps the fix surgical and matches user intent: an epic where most work shipped is done, even if some tasks were skipped.

## Tests
- `tests/integration/orchestrator.test.ts`:
  - mixed done/cancelled → epic done (replaces the old test that asserted the bug).
  - all cancelled → epic cancelled, never done.
  - blocked-only remainder → epic stays open.