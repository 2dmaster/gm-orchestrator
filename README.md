# gm-orchestrator

Tokenless Claude Code orchestrator for GraphMemory — AI-first, TypeScript.

Spawns Claude Code sessions to work through tasks stored in GraphMemory, coordinating priorities, retries, and epic workflows automatically.

## Installation

```bash
npm install gm-orchestrator
```

Requires Node.js >= 18.

## Quick Start

### CLI

```bash
# Run all todo/in_progress tasks by priority
npx gm-orchestrator sprint --project my-app

# Run all tasks in an epic
npx gm-orchestrator epic my-epic-id --project my-app

# Check task counts without spawning Claude
npx gm-orchestrator status --project my-app

# Preview prompts without running Claude
npx gm-orchestrator sprint --project my-app --dry-run
```

### Programmatic

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
const gm = new GraphMemoryClient({
  baseUrl: config.baseUrl,
  projectId: config.projectId,
});

const ports = {
  gm,
  runner: new ClaudeRunner(),
  poller: new TaskPoller(gm),
  logger: consoleLogger,
};

// Run a sprint
await runSprint(ports, config);

// Or run a specific epic
await runEpic('my-epic-id', ports, config);
```

## CLI Reference

```
gm-orchestrator <command> [options]
```

### Commands

| Command            | Description                                    |
| ------------------ | ---------------------------------------------- |
| `sprint`           | Run all todo/in_progress tasks by priority     |
| `epic <epicId>`    | Run all tasks linked to an epic                |
| `status`           | Show task counts (no Claude sessions spawned)  |

### Options

| Flag                  | Description                                      | Default     |
| --------------------- | ------------------------------------------------ | ----------- |
| `--project`, `-p`     | GraphMemory project ID                           | env / config|
| `--tag`, `-t`         | Filter tasks by tag                              |             |
| `--timeout <min>`     | Per-task timeout in minutes                      | 15          |
| `--retries <n>`       | Retries on timeout/error                         | 1           |
| `--dry-run`           | Preview prompts without spawning Claude           |             |
| `--config`            | Print resolved config and exit                   |             |

## Configuration

Configuration is resolved in order (later sources override earlier):

1. **Defaults**
2. **Config file** (`.gm-orchestrator.json` in the current directory)
3. **Environment variables**
4. **CLI flags**

### Config file

Create `.gm-orchestrator.json` in your project root:

```json
{
  "baseUrl": "http://localhost:3000",
  "projectId": "my-app",
  "apiKey": "mgm-key-...",
  "timeoutMs": 900000,
  "maxRetries": 1,
  "claudeArgs": []
}
```

### Environment variables

| Variable          | Maps to       |
| ----------------- | ------------- |
| `GM_BASE_URL`     | `baseUrl`     |
| `GM_PROJECT_ID`   | `projectId`   |
| `GM_API_KEY`      | `apiKey`      |
| `GM_TIMEOUT_MS`   | `timeoutMs`   |

### All config options

| Option       | Type       | Default                  | Description                        |
| ------------ | ---------- | ------------------------ | ---------------------------------- |
| `baseUrl`    | `string`   | `http://localhost:3000`  | GraphMemory server URL             |
| `projectId`  | `string`   | *(required)*             | GraphMemory project ID             |
| `apiKey`     | `string`   |                          | API key for authenticated servers  |
| `timeoutMs`  | `number`   | `900000` (15 min)        | Per-task timeout in milliseconds   |
| `pauseMs`    | `number`   | `2000`                   | Pause between task runs            |
| `maxRetries` | `number`   | `1`                      | Retries on timeout/error           |
| `claudeArgs` | `string[]` | `[]`                     | Extra args passed to Claude Code   |
| `dryRun`     | `boolean`  | `false`                  | Preview prompts without running    |

## Programmatic API

### Core

- **`runSprint(ports, config)`** — Execute all todo/in_progress tasks sorted by priority
- **`runEpic(epicId, ports, config)`** — Execute all tasks linked to an epic
- **`buildPrompt(task)`** — Generate the autonomous-execution prompt for a task

### Utilities

- **`sortByPriority(tasks)`** — Sort tasks by priority order
- **`isTerminal(status)`** — Check if a task status is terminal (done/cancelled)
- **`areBlockersResolved(task)`** — Check if all blockers are resolved
- **`loadConfig(overrides?)`** — Load and merge configuration
- **`validateConfig(config)`** — Validate config (throws on missing projectId)

### Infrastructure

- **`GraphMemoryClient`** — HTTP client for the GraphMemory API
- **`ClaudeRunner`** — Spawns and manages Claude Code processes
- **`TaskPoller`** — Polls task status until completion
- **`consoleLogger` / `silentLogger`** — Logger implementations

### Types

`Task`, `Epic`, `TaskStatus`, `TaskPriority`, `EpicStatus`, `TaskRef`, `OrchestratorConfig`, `TaskRunResult`, `SprintStats`, `GraphMemoryPort`, `ClaudeRunnerPort`, `TaskPollerPort`, `Logger`

## License

MIT
