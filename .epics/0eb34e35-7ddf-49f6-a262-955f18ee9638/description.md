## Context

Audit of epic `7cae6b34-7bab-4b05-b7ea-330b5224cbdd` ("Orchestrator improvements — feedback from MixPlaces usage 2026-04-10", shipped as v0.12.0 in commit `a3b693c`) found several regressions. After the release the orchestrator started skipping tasks, producing ambiguous done/cancelled states, and hanging more often.

All items below were introduced in the single squashed commit `a3b693c` on 2026-04-11.

## User-visible symptoms
- Tasks get run when they shouldn't (upstream was cancelled).
- Logs say "cancelled" but the task is `done` in graph-memory, or vice versa.
- Epics report "complete" but stay `open` in the graph.
- Runs hang on individual tasks more frequently.
- A single bad task halts the entire sprint/epic.

## Root causes (ranked by impact)
1. `isTerminal` change makes `areBlockersResolved` treat `cancelled` upstream as "resolved" — dependents now run with failed prereqs.
2. `handleVerifyFailure` moves a `done` task to `in_progress`, then heartbeat zombie-recovery (`reset-to-todo`) re-runs it forever.
3. `runEpic` completion check (`every === 'done'`) is inconsistent with the queue filter (excludes `done`+`cancelled`) — epic never marked done if any task was cancelled.
4. Heartbeat `stop()` overwrites `task.metadata` with only `{runId:null, heartbeatAt:null}`, clobbering `verifyFailedAt`/`verifyFailures` and any other metadata Claude wrote.
5. Post-task hooks run inside `runOneTask` with no timeout/signal plumbing. A hanging hook pins the slot.
6. `verify_failed` halts the entire sprint/epic via `handleResult` → one flaky hook stops all remaining tasks.
7. Heartbeat interval writes race with Claude's own `tasks_update` — metadata churn.
8. `sortByPriority` soft-prereq penalty of 0.5 collides with the default "unknown priority" score of 4.

## Non-goals
- Reverting v0.12.0 wholesale. The epic's features are valuable; fix the bugs surgically.
- Rewriting the scheduler or heartbeat from scratch.
- UI changes beyond what's needed to surface verify-failed state correctly.

## Exit criteria
- Cancelled blockers no longer silently unblock dependents (opt-in if needed).
- Epic completion state in the graph matches what the orchestrator logs.
- A verify-failed task produces a stable, non-looping state with preserved failure metadata.
- Post-task hooks are time-bounded and abort-aware.
- `verify_failed` on one task does not halt unrelated tasks by default.
- All regression scenarios covered by tests before merging.
