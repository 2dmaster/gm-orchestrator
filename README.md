# gm-orchestrator

Autonomous AI sprint runner for [GraphMemory](https://github.com/graph-memory/graphmemory).

Spawns Claude Code sessions to work through your tasks automatically — one task at a time,
fresh context each session, no token bleed. You define the work in GraphMemory, hit Run, go do something else.

```bash
npm install -g gm-orchestrator
gm-orchestrator
```

→ Opens `http://localhost:4242` in your browser. That's it.

---

## How it works

```
gm-orchestrator
      ↓
Reads tasks from GraphMemory (priority order, blockers respected)
      ↓
For each task:
  spawn → claude --print "<task prompt>"
  wait  → Claude calls tasks_move("done") when finished
  next  → kill session, start fresh, repeat
      ↓
Notify you when sprint/epic is complete
```

Each Claude Code session gets a clean context window. No accumulation, no drift.

---

## Prerequisites

- **Node.js** >= 18
- **[GraphMemory](https://github.com/graph-memory/graphmemory)** running locally (`graphmemory serve`)
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** installed (`npm install -g @anthropic-ai/claude-code`)
- Claude Code connected to your GraphMemory instance via MCP

---

## Installation

```bash
npm install -g gm-orchestrator
```

---

## Quick Start

```bash
# 1. Start GraphMemory in your project
cd /path/to/your-project
graphmemory serve

# 2. Start gm-orchestrator
gm-orchestrator
# → opens http://localhost:4242
```

On first run, the wizard walks you through selecting a project and configuring permissions.

---

## Browser UI

The primary interface. Opens automatically at `http://localhost:4242`.

### Dashboard
Overview of your project: task queue sorted by priority, epics, done count for today.
One click to start a sprint or select an epic. Choose the Claude model (Sonnet, Opus, Haiku) from the dropdown before starting.

### Sprint Runner
Live view while work is in progress:
- Task queue with status (queued / running / done / cancelled)
- Real-time Claude log stream — see exactly what Claude is doing
- Progress bar and elapsed time per task
- Stop button

### Settings
- GraphMemory connection (URL, project ID, API key)
- Permissions — what Claude is allowed to do per session
- Notifications — Telegram, webhook, desktop
- Timeout and retry configuration

---

## Permissions

Control what Claude Code can do in each session:

```json
{
  "permissions": {
    "writeFiles": true,
    "runCommands": ["npm test", "npm run build", "git add", "git commit"],
    "blockedCommands": ["git push", "npm publish"]
  }
}
```

Translates directly to `--allowedTools` flags passed to `claude --print`.
Claude cannot run blocked commands even if it tries.

---

## Notifications

Get notified when work is done — useful for long sprints.

**Telegram:**
```json
{
  "notifications": {
    "telegram": {
      "botToken": "...",
      "chatId": "..."
    },
    "on": ["sprint_complete", "task_failed"]
  }
}
```

**Webhook** (generic POST — works with Slack, Discord, custom endpoints):
```json
{
  "notifications": {
    "webhook": {
      "url": "https://your-endpoint.com/notify",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}
```

**Desktop** — native OS notification (macOS, Linux, Windows).

---

## Configuration

Resolved in order — later sources override earlier:

1. Defaults
2. `.gm-orchestrator.json` in current directory
3. Environment variables
4. CLI flags

### Config file

```json
{
  "baseUrl": "http://localhost:3000",
  "projectId": "my-app",
  "apiKey": "",
  "timeoutMs": 900000,
  "pauseMs": 2000,
  "maxRetries": 1,
  "claudeArgs": [],
  "permissions": {
    "writeFiles": true,
    "runCommands": ["npm test", "git commit"],
    "blockedCommands": ["git push", "npm publish"]
  },
  "notifications": {
    "telegram": {
      "botToken": "",
      "chatId": ""
    }
  }
}
```

### Environment variables

| Variable        | Maps to      |
|-----------------|--------------|
| `GM_BASE_URL`   | `baseUrl`    |
| `GM_PROJECT_ID` | `projectId`  |
| `GM_API_KEY`    | `apiKey`     |
| `GM_TIMEOUT_MS` | `timeoutMs`  |
| `GM_PORT`       | server port (default: 4242) |

### All config options

| Option       | Type       | Default           | Description                      |
|--------------|------------|-------------------|----------------------------------|
| `baseUrl`    | `string`   | `http://localhost:3000` | GraphMemory server URL     |
| `projectId`  | `string`   | *(required)*      | GraphMemory project ID           |
| `apiKey`     | `string`   |                   | API key (if GM auth is enabled)  |
| `timeoutMs`  | `number`   | `900000` (15 min) | Per-task timeout in ms           |
| `pauseMs`    | `number`   | `2000`            | Pause between tasks              |
| `maxRetries` | `number`   | `1`               | Retries on timeout/error         |
| `claudeArgs` | `string[]` | `[]`              | Extra args for `claude --print`  |
| `model`      | `string`   |                   | Claude model override (e.g. `claude-sonnet-4-6`) |
| `dryRun`     | `boolean`  | `false`           | Preview prompts, don't run       |

---

## Pipelines (cross-project orchestration)

Pipelines orchestrate epics across multiple projects with dependency ordering. A pipeline is a DAG of stages — each stage runs an epic in a specific project, and declares `after` dependencies on other stages. Independent stages run in parallel.

### Configuration

Add a `pipelines` array to `.gm-orchestrator.json`:

```json
{
  "projects": [
    { "baseUrl": "http://localhost:3000", "projectId": "backend-api" },
    { "baseUrl": "http://localhost:3000", "projectId": "frontend-app" },
    { "baseUrl": "http://localhost:3000", "projectId": "e2e-tests" }
  ],
  "pipelines": [
    {
      "id": "full-stack-release",
      "name": "Full-stack release",
      "stages": [
        { "id": "backend", "projectId": "backend-api", "epicId": "api-v2" },
        { "id": "frontend", "projectId": "frontend-app", "epicId": "ui-update", "after": ["backend"] },
        { "id": "e2e", "projectId": "e2e-tests", "epicId": "smoke-tests", "after": ["backend", "frontend"] }
      ]
    }
  ]
}
```

In this example:
- **backend** runs first (no dependencies)
- **frontend** waits for backend to complete
- **e2e** waits for both backend and frontend

### API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pipelines` | GET | List configured pipelines |
| `/api/pipelines/run` | POST | Start a pipeline run (`{ pipelineId }`) |
| `/api/pipelines/run/status` | GET | Pipeline run state (stages + statuses) |
| `/api/pipelines/run/stop` | POST | Stop a pipeline run (`{ pipelineRunId }`) |

### UI

Pipelines appear on the Dashboard above the project cards. Each pipeline card shows:
- Stage count and dependency visualization
- **Run** button to start the pipeline
- Live stage status (queued / running / done / failed) when a run is active

On the Runs page, pipeline runs appear as grouped entries with a progress bar showing stages done / total.

### Validation

Pipeline configs are validated on load:
- Stage IDs must be unique within a pipeline
- `after` references must point to existing stage IDs
- No cycles allowed (DAG validation via topological sort)
- Each stage must have `projectId` and `epicId`

---

## CLI (advanced)

The browser UI is the primary interface. CLI commands are available for scripting and CI.

```bash
# Start UI (default)
gm-orchestrator

# Run sprint headless (no browser)
gm-orchestrator sprint --project my-app

# Run specific epic headless
gm-orchestrator epic <epicId> --project my-app

# Check task counts
gm-orchestrator status --project my-app

# Preview prompts without spawning Claude
gm-orchestrator sprint --project my-app --dry-run
```

| Flag | Description | Default |
|------|-------------|---------|
| `--project`, `-p` | GraphMemory project ID | env / config |
| `--tag`, `-t` | Filter tasks by tag | |
| `--timeout <min>` | Per-task timeout in minutes | 15 |
| `--retries <n>` | Retries on timeout/error | 1 |
| `--dry-run` | Preview prompts, don't spawn Claude | |
| `--config` | Print resolved config and exit | |

---

## Programmatic API

```ts
import {
  runSprint,
  runEpic,
  GraphMemoryClient,
  ClaudeRunner,
  TaskPoller,
  consoleLogger,
  loadConfig,
} from 'gm-orchestrator';

const config = loadConfig({ projectId: 'my-app' });
const gm = new GraphMemoryClient({ baseUrl: config.baseUrl, projectId: config.projectId });

const ports = {
  gm,
  runner: new ClaudeRunner(),
  poller: new TaskPoller(gm),
  logger: consoleLogger,
};

await runSprint(ports, config);
await runEpic('epic-id', ports, config);
```

### Core functions
- **`runSprint(ports, config)`** — run all todo/in_progress tasks by priority
- **`runEpic(epicId, ports, config)`** — run all tasks in an epic
- **`buildPrompt(task)`** — generate autonomous-execution prompt for a task

### Utilities
- **`sortByPriority(tasks)`** — sort by priority order
- **`isTerminal(status)`** — check if status is done/cancelled
- **`areBlockersResolved(task)`** — check all blockers are done
- **`loadConfig(overrides?)`** — load and merge config
- **`validateConfig(config)`** — validate (throws on missing projectId)

### Infrastructure
- **`GraphMemoryClient`** — GraphMemory REST client
- **`ClaudeRunner`** — spawns claude --print sessions
- **`TaskPoller`** — polls task status until completion
- **`consoleLogger` / `silentLogger`** — logger implementations

### Types
`Task`, `Epic`, `TaskStatus`, `TaskPriority`, `EpicStatus`, `TaskRef`,
`OrchestratorConfig`, `TaskRunResult`, `SprintStats`,
`GraphMemoryPort`, `ClaudeRunnerPort`, `TaskPollerPort`, `Logger`

---

## License

MIT
