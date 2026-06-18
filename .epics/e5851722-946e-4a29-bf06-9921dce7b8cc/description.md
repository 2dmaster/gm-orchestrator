## Goal

Add pipeline definitions that orchestrate epics across projects with dependency ordering. A pipeline is a DAG of stages — each stage runs an epic in a specific project, and declares `after` dependencies on other stages. The scheduler executes stages in topological order, running independent stages in parallel.

## Motivation

Projects are often interdependent: backend API changes must land before frontend can update, and E2E tests should run after both. Currently users must manually start epics one by one and watch for completion. Pipelines automate this as a single "Run pipeline" action.

## Design

### Pipeline config (stored in `.gm-orchestrator.json`)

```json
{
  "pipelines": [{
    "id": "full-stack-release",
    "name": "Full-stack release",
    "stages": [
      { "id": "backend", "projectId": "backend-api", "epicId": "api-v2" },
      { "id": "frontend", "projectId": "frontend-app", "epicId": "ui-update", "after": ["backend"] },
      { "id": "e2e", "projectId": "e2e-tests", "epicId": "smoke-tests", "after": ["backend", "frontend"] }
    ]
  }]
}
```

### Core types

- `Pipeline` — id, name, stages[]
- `PipelineStage` — id, projectId, epicId, after[] (stage IDs), status
- `PipelineRun` — runtime state tracking stage execution

### Scheduler integration

Extend `RunRequest` with optional `pipelineId` and `stageId`. In `pickNextRequest()`, check that all `after` stages are completed before allowing a stage to run. Re-use existing scheduler slots for parallel stage execution.

### API

- `GET /api/pipelines` — list configured pipelines
- `POST /api/pipelines/run` — start a pipeline run `{ pipelineId }`
- `GET /api/pipelines/run/status` — pipeline run state (stages + statuses)
- `POST /api/pipelines/run/stop` — stop a pipeline run

### UI

- Pipeline section in Dashboard: list pipelines, "Run" button, stage dependency visualization (horizontal DAG)
- Runs page: pipeline runs appear as grouped entries (expand to see stages)
- Pipeline status: color-coded stages (queued → running → done/failed)

## Definition of Done

- Pipeline config parsing and validation
- Scheduler respects stage dependencies (topological ordering)
- Parallel execution of independent stages
- Pipeline run tracking with WS events
- Dashboard UI: list pipelines, run button, stage visualization
- Runs page: pipeline run entries with stage detail
- Tests for pipeline scheduling logic
- Documentation in README