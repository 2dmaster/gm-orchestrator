## Feature: Per-run Claude model selection

Added the ability to choose which Claude model to use when starting a task/sprint/epic from the Dashboard UI.

### Models available
- Default (CLI default)
- Sonnet 4.6 (`claude-sonnet-4-6`)
- Opus 4.6 (`claude-opus-4-6`)
- Haiku 4.5 (`claude-haiku-4-5-20251001`)

### Data flow
1. **UI** — `Dashboard.tsx` has a `<Select>` dropdown with `MODEL_OPTIONS` next to start buttons
2. **Hook** — `useOrchestrator` passes `model` param via `startSprint/startEpic/startTasks`
3. **API** — `/api/run/sprint`, `/api/run/epic`, `/api/projects/:id/run-tasks` accept `model` in body
4. **RunnerService** — `startSprint/startEpic/startTasks` forward `model` to scheduler
5. **Scheduler** — `RunRequest.model` flows into per-slot `OrchestratorConfig.model`
6. **StreamingRunner** — passes `model` to Agent SDK `query({ options: { model } })`

### Files changed
- `src/core/types.ts` — `OrchestratorConfig.model?: string`
- `src/core/scheduler.ts` — `RunRequest.model`, propagated to `slotConfig`
- `src/server/api.ts` — `RunnerService` interface + route handlers
- `src/server/runner-service.ts` — accepts & passes model through
- `ui/src/types.ts` — UI config type
- `ui/src/hooks/useOrchestrator.ts` — hook methods accept model
- `ui/src/pages/Dashboard.tsx` — model dropdown with Cpu icon

### Stop/Pause analysis (same release)
- **Stop** works correctly — `abortSignal` propagates through scheduler → streaming runner → Agent SDK
- **Pause** only freezes the scheduler queue; running agent continues (SDK has no pause mechanism)