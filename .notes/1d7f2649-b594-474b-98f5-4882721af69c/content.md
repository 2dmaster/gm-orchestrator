## Implementation

Idempotency keys for task runs prevent double-spawn conflicts.

### How it works

1. **Heartbeat already generates `runId`** — `startHeartbeat()` creates a `randomUUID()` and writes it to `task.metadata.runId`. This is the source of truth for which session owns the task.

2. **`runId` flows to the runner** — `runOneTask()` passes `heartbeat.runId` to `runner.run(task, config, runId)`. The `ClaudeRunnerPort` interface now requires a `runId` parameter.

3. **Environment variable** — `ClaudeRunner` passes `ORCHESTRATOR_RUN_ID=<runId>` as an env var to the spawned Claude process, so the agent can read it without parsing the prompt.

4. **Prompt-level guard** — `buildPrompt()` accepts an optional `runId` and emits an "Idempotency Guard" section instructing the Claude agent to:
   - Call `tasks_get()` and compare `metadata.runId` to its own `ORCHESTRATOR_RUN_ID`
   - If mismatch → exit immediately without touching anything

### Double-spawn scenario

If two orchestrator instances pick the same task:
- Both call `startHeartbeat()` → each writes a different `runId` to metadata
- The second write wins (last-writer-wins)
- The first session's Claude agent, when it next checks `metadata.runId`, sees a mismatch and bails out
- Only the authoritative (latest) session continues

### Files changed

- `src/core/types.ts` — `ClaudeRunnerPort.run()` now takes `runId: string`
- `src/infra/claude-runner.ts` — passes `ORCHESTRATOR_RUN_ID` env var and `runId` to prompt builder
- `src/core/orchestrator.ts` — passes `heartbeat.runId` to `runner.run()`
- `src/core/prompt-builder.ts` — accepts optional `runId`, emits idempotency guard section
- `tests/fixtures/fakes.ts` — `FakeRunner` records `runId`
- `tests/unit/prompt-builder.test.ts` — 3 new tests for idempotency guard
- `tests/integration/orchestrator.test.ts` — 2 new tests for runId flow