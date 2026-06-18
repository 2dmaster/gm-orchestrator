## Implementation Summary (O4)

### Files changed
- `src/core/types.ts` — Added `HeartbeatConfig`, `ZombiePolicy`, `TaskHeartbeatMeta` types; added `metadata` field to `Task`; added `heartbeat` config to `OrchestratorConfig`
- `src/core/heartbeat.ts` — **New file**: `startHeartbeat()`, `recoverZombieTasks()`, `resolveHeartbeatConfig()`, `HEARTBEAT_DEFAULTS`
- `src/core/orchestrator.ts` — `runOneTask()` now starts/stops heartbeat around task execution (try/finally)
- `src/infra/config.ts` — `mergeConfigs()` handles `heartbeat` field
- `src/index.ts` — Exports heartbeat API and types
- `tests/unit/heartbeat.test.ts` — **New file**: 16 tests covering config resolution, heartbeat lifecycle, zombie recovery policies

### Design decisions
- Heartbeat uses `task.metadata` (supported by GraphMemory `tasks_update`) — no schema changes needed
- `startHeartbeat()` returns a `HeartbeatHandle` with `runId` and `stop()` — stop is always called in `finally` block
- `recoverZombieTasks()` is a standalone function — caller (CLI/server) invokes it on startup before entering the sprint loop
- Tasks with no heartbeat metadata but `in_progress` status are treated as zombies (backward compat with pre-heartbeat tasks)
- `staleThresholdMs` defaults to `2 × intervalMs` — configurable for custom setups
- Three zombie policies: `reset-to-todo` (safe default), `cancel`, `move-to-review`

### Config example
```json
{
  "heartbeat": {
    "intervalMs": 30000,
    "staleThresholdMs": 60000,
    "zombiePolicy": "reset-to-todo"
  }
}
```