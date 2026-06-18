## Completed: Settings — project management UI (2026-04-04)

Epic `d33c70ea-c2f7-485a-ab57-485a2d112f39` — **done**.

Commit: `0676b4c feat: redesign Settings page with multi-project management UI`

### What was done
Completely rewrote `ui/src/pages/Settings.tsx` (197 → 960 lines). Old page was single-project only. New page has 4 tabs:

1. **Connections** — server list grouped by baseUrl, connection status probing (online/offline badges), add server with probe + project discovery, edit server URL (inline), remove server/project (with confirmation dialog), active project selector (radio), project labels (editable), task/epic counts from overview endpoint
2. **Config** — concurrency, timeoutMs, pauseMs, maxRetries, maxTurns, agentTimeoutMs, dryRun, app version
3. **Permissions** — unchanged from before
4. **Notifications** — unchanged from before

All 4 GM tasks marked done: `ab643e26`, `c86d6351`, `7b9e128b`, `8dd401a0`.

### No backend changes needed
The backend already had full multi-project support: `PUT /api/config`, `POST /api/projects/probe`, `GET /api/projects/overview`. The Settings page just wasn't using them.

---

## Next: Cross-project pipeline orchestration

Epic `e5851722-946e-4a29-bf06-9921dce7b8cc` — **open**, 0/6 tasks done.

### 6 tasks (all todo):
1. `684d6b6a` — **Pipeline types and config parsing** (high) — define `Pipeline`, `PipelineStage`, `PipelineRun` in `src/core/types.ts`, DAG validation (cycle detection), config parsing in `src/infra/config.ts`
2. `e5891e39` — **Scheduler stage dependency resolution** (high) — extend `RunRequest` with `pipelineRunId`/`stageId`, dependency-aware `pickNextRequest()` in scheduler
3. `107817b0` — **Pipeline runner service and API** (high) — `startPipeline()`, API routes (`GET /api/pipelines`, `POST /api/pipelines/run`, etc.), WS events
4. `6677e89d` — **Dashboard pipeline UI** (medium) — pipeline cards with DAG visualization, run button
5. `e226c998` — **Runs page pipeline entries** (medium) — grouped pipeline runs, expandable stages
6. `4aec7059` — **Pipeline tests and docs** (medium) — unit tests for DAG/scheduler, integration test, README

### Key files to modify:
- `src/core/types.ts` — add Pipeline/PipelineStage/PipelineRun types, extend OrchestratorConfig with `pipelines[]`
- `src/infra/config.ts` — parse and validate pipeline config
- `src/server/scheduler.ts` — extend RunRequest, dependency-aware picking
- `src/server/runner-service.ts` — add startPipeline()
- `src/server/api.ts` — pipeline API routes
- `ui/src/pages/Dashboard.tsx` — pipeline section
- `ui/src/pages/Sprint.tsx` — pipeline run entries
- `ui/src/types.ts` — frontend pipeline types