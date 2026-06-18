## Decision
`areBlockersResolved` / `areBlockersResolvedAsync` in `src/core/task-utils.ts` require an upstream blocker to be `done` to be considered resolved. A `cancelled` upstream is NOT resolved by default — dependents stay blocked.

## Why
The v0.12.0 release used `isTerminal(status)` (which returns true for both `done` and `cancelled`), causing dependents to silently run when their prerequisite work had failed/been-given-up. Observed in MixPlaces feedback as "tasks ran when they shouldn't".

## Opt-in
`OrchestratorConfig.allowCancelledBlockers: boolean` (default `false`). When `true`, cancelled blockers are treated as resolved — useful when cancellation is intentional and you don't want a dead chain. The flag is plumbed through `findNextRunnable` to both `runSprint` and `runEpic`.

## Notes
- `isTerminal()` is unchanged — it's still used by the epic queue filter to drop terminal tasks from the runnable queue.
- Tests live in `tests/unit/task-utils.test.ts` (default + opt-in unit) and `tests/integration/orchestrator.test.ts` (`runEpic` integration both modes).