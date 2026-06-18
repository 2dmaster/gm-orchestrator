`OrchestratorConfig.haltOnVerifyFailure: boolean` (default `false`). When a `verify_failed` result comes back from `handleResult`, the loop now continues to the next task instead of bailing out. The failed task is already moved to a stable state by `handleVerifyFailure`, so the loop is safe.

New `SprintStats.verifyFailed` counter tracks these occurrences. It is separate from `stats.errors` so a run summary can show verify failures distinct from hard errors/timeouts.

Set `haltOnVerifyFailure: true` to restore the old fail-fast behavior (useful when the verify hook is load-bearing and one failure invalidates the rest of the batch).

Wired through `runSprint`, `runEpic`, `runTasks`, scheduler `mergeStats`, `runner-service` aggregate snapshot, UI `SprintStats` type, and config merge in `loadConfig`.