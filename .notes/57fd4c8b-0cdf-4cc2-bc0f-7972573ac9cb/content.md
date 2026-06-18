## What was done (O3 task)

### Already existed before this task
The orchestrator already had full **resolution** support for cross-project blockers:
- `TaskRef.projectId` field for identifying remote tasks
- `CrossProjectResolver` type + `GraphMemoryClientPool.createCrossProjectResolver()`
- `areBlockersResolvedAsync()` with cross-project support
- `findNextRunnable()` using the resolver in the orchestrator loop
- Full test coverage (unit + integration)

### Added in this task — link creation side
The missing piece was the ability to **create** cross-project task links from the orchestrator:

1. **`TaskLinkKind` type** (`src/core/types.ts`, `ui/src/types.ts`) — `'blocks' | 'subtask_of' | 'related_to'`
2. **`GraphMemoryPort.linkTask()`** — optional method for creating task links with `targetProjectId`
3. **`GraphMemoryClient.linkTask()`** — REST client implementation calling `POST /tasks/link`
4. **`POST /api/projects/:id/tasks/link`** REST endpoint — validates params, proxies to GM server, supports `targetProjectId` for cross-project links
5. **`FakeGraphMemory.linkTask()`** — test fake that records calls and simulates link creation
6. **6 new API tests** — same-project links, cross-project links, validation (missing fromId/toId/kind, invalid kind), all link kinds

### How cross-project links work end-to-end
1. UI/agent calls `POST /api/projects/:projectId/tasks/link` with `{ fromId, toId, kind, targetProjectId }`
2. Orchestrator validates and proxies to GraphMemory server
3. GraphMemory stores the edge with `targetProjectId` field
4. When scheduling, `findNextRunnable` → `areBlockersResolvedAsync` → `CrossProjectResolver` fetches live status from the target project
5. Task only runs when all blockers (including cross-project) are terminal

### Test results
247 tests passing, clean TypeScript compilation, UI build succeeds.