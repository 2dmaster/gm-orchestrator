# gm-orchestrator v1.0.0 — Product Spec
_Status: approved. Author: vachick + Claude. Date: 2026-04-02_

---

## Context

gm-orchestrator is a CLI tool that autonomously runs Claude Code sessions to complete
tasks stored in GraphMemory. It spawns `claude --print` for each task, monitors
completion via GraphMemory REST API, and moves to the next task — no human in the loop.

**v0.2 (proof of concept) is done and works:**
- TypeScript, port/adapter architecture, 41 tests
- Sprint + Epic execution
- bootstrap.sh ran autonomously and prepared the project for npm publishing

**v1.0.0 goal:** turn the proof of concept into a real product with a browser-based UI,
onboarding wizard, permissions model, and notifications.

---

## How it works (core, unchanged from v0.2)

```
gm-orchestrator
      ↓
Node.js process:
  1. Start HTTP server on :4242
  2. Open browser → http://localhost:4242
  3. Serve React UI (built into npm package)
  4. Accept commands from UI via REST + WebSocket
      ↓
User selects project + epic/sprint + permissions
      ↓
For each task (priority order, blockers respected):
  - GET /api/{project}/tasks — fetch queue
  - PATCH task → in_progress
  - spawn: claude --print "<prompt>" --allowedTools <permissions>
  - Poll GET /api/{project}/tasks/{id} every 3s
  - Wait for tasks_move("done") signal from Claude
  - Kill session, start next task
      ↓
Notify user when done (Telegram / webhook / desktop)
```

---

## Project structure (target)

```
gm-orchestrator/
├── src/
│   ├── core/                  # pure business logic (no I/O)
│   │   ├── types.ts           # all domain types + port interfaces
│   │   ├── orchestrator.ts    # runSprint / runEpic
│   │   ├── prompt-builder.ts  # builds Claude prompts
│   │   └── task-utils.ts      # sort, filter, blocker check
│   │
│   ├── infra/                 # I/O implementations
│   │   ├── gm-client.ts       # GraphMemory REST client
│   │   ├── gm-discovery.ts    # auto-scan ports 3000-3010
│   │   ├── claude-runner.ts   # spawns claude --print
│   │   ├── task-poller.ts     # polls task status
│   │   ├── config.ts          # load/save/validate config
│   │   ├── logger.ts          # console + silent logger
│   │   └── notifications/
│   │       ├── types.ts       # NotificationPort interface
│   │       ├── telegram.ts
│   │       ├── webhook.ts
│   │       ├── desktop.ts
│   │       └── index.ts       # dispatcher
│   │
│   ├── server/                # Express + WebSocket backend
│   │   ├── index.ts           # starts server, opens browser
│   │   ├── api.ts             # REST routes
│   │   ├── ws.ts              # WebSocket event bus
│   │   └── runner-service.ts  # orchestrator ↔ server bridge
│   │
│   └── cli/
│       └── index.ts           # entrypoint: node → server → browser
│
├── ui/                        # React frontend (separate Vite project)
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Wizard.tsx     # onboarding (first run)
│   │   │   ├── Dashboard.tsx  # project overview
│   │   │   ├── Sprint.tsx     # sprint runner + live log
│   │   │   ├── Epic.tsx       # epic task list + runner
│   │   │   └── Settings.tsx   # config, permissions, notifications
│   │   ├── components/
│   │   │   ├── TaskCard.tsx
│   │   │   ├── LogStream.tsx  # live Claude output
│   │   │   ├── ProgressBar.tsx
│   │   │   └── PermissionToggle.tsx
│   │   └── hooks/
│   │       ├── useWebSocket.ts
│   │       ├── useTasks.ts
│   │       └── useOrchestrator.ts
│   ├── package.json
│   └── vite.config.ts
│
├── tests/
│   ├── unit/
│   │   ├── task-utils.test.ts
│   │   ├── prompt-builder.test.ts
│   │   └── notifications.test.ts
│   ├── integration/
│   │   └── orchestrator.test.ts
│   └── fixtures/
│       ├── factories.ts
│       └── fakes.ts
│
├── scripts/
│   └── build.ts               # builds UI then copies to dist/ui/
│
├── package.json
├── tsconfig.json
├── vite.config.ts             # for ui build
└── .gm-orchestrator.json      # user config (gitignored)
```

---

## Milestone 1 — Server + WebSocket backbone
_Goal: `gm-orchestrator` starts a server, opens browser, shows placeholder UI_

### Tasks

**TASK-1: Express server (src/server/index.ts)**
- Start Express on port 4242 (configurable via GM_PORT env)
- Serve static files from `dist/ui/` (built UI)
- If `dist/ui/` doesn't exist, serve a "UI not built" message with build instructions
- On start: open browser with `open` package (cross-platform)
- Graceful shutdown on SIGINT/SIGTERM

**TASK-2: REST API routes (src/server/api.ts)**

```
GET  /api/status              → { version, config, isRunning }
GET  /api/projects            → discovered GM projects
GET  /api/projects/:id/tasks  → task list (proxied from GM)
GET  /api/projects/:id/epics  → epic list (proxied from GM)
POST /api/run/sprint          → { projectId, tag? } → starts sprint
POST /api/run/epic            → { projectId, epicId } → starts epic
POST /api/run/stop            → stop current run
GET  /api/config              → current config (apiKey redacted)
PUT  /api/config              → update + save config
```

**TASK-3: WebSocket event bus (src/server/ws.ts)**

Events the server sends to UI:

```typescript
type ServerEvent =
  | { type: 'run:started';   payload: { mode: 'sprint' | 'epic'; epicId?: string } }
  | { type: 'run:stopped' }
  | { type: 'run:complete';  payload: SprintStats }
  | { type: 'task:started';  payload: { task: Task } }
  | { type: 'task:done';     payload: { task: Task } }
  | { type: 'task:cancelled';payload: { task: Task; reason?: string } }
  | { type: 'task:timeout';  payload: { task: Task } }
  | { type: 'task:retrying'; payload: { task: Task; attempt: number } }
  | { type: 'log:line';      payload: { taskId: string; line: string } }
  | { type: 'error';         payload: { message: string } }
```

**TASK-4: Runner service (src/server/runner-service.ts)**
- Bridge between REST API and core orchestrator
- Manages run state (idle / running / stopping)
- Pipes Claude stdout line by line → `log:line` WS events
- Emits task lifecycle events to WS
- Prevents concurrent runs (returns 409 if already running)

**TASK-5: GraphMemory discovery (src/infra/gm-discovery.ts)**

```typescript
interface GMServer {
  url: string;
  port: number;
  projects: Array<{ id: string; taskCount: number; epicCount: number }>
}

async function discoverServers(): Promise<GMServer[]>
```

- Scan ports 3000–3010 in parallel
- Hit `GET /api/health` or `GET /api/projects` to check if GM is running
- Return all responding servers with their project list
- Timeout per port: 500ms

---

## Milestone 2 — React UI
_Goal: full interactive UI served from the browser_

### Design principles
- Dark theme, terminal aesthetic (fits the tool's nature)
- Monospace font for log streams
- Minimal but not ugly — think: Vercel dashboard meets terminal
- Colors: dark background (#0d1117), accent green (#00ff88), text (#e6edf3)
- No UI component library — custom components with Tailwind

### Pages

**Wizard (/ — first run only)**

Shown when no `.gm-orchestrator.json` exists or `projectId` is empty.

Steps:
1. **Welcome** — brief explanation of what the tool does
2. **Discover** — auto-scan for GraphMemory servers, show found projects
   - If none found: manual URL input
3. **Select project** — dropdown of discovered projects
4. **Permissions** — toggle list of what Claude is allowed to do:
   - Read files ✓ (always on, can't disable)
   - Write files ✓
   - Run tests (npm test, pytest, etc.) ✓
   - Git commit ✓
   - Git push ✗
   - npm/pip publish ✗
   - Custom command whitelist (text input)
5. **Notifications** (optional, skippable):
   - Telegram: bot token + chat ID
   - Webhook URL
   - Desktop notifications
6. **Done** — save config, redirect to Dashboard

**Dashboard (/dashboard)**

```
┌─────────────────────────────────────────────────┐
│ gm-orchestrator          my-api  ●  3 tasks todo │
├─────────────────────────────────────────────────┤
│                                                  │
│  [▶ Run Sprint]  [Select Epic ▾]                 │
│                                                  │
│  Tasks                          Epics            │
│  ● critical  Fix auth bug       ○ Q2 Backend (8) │
│  ● high      Add rate limiting  ○ Docs update(3) │
│  ○ medium    Refactor DB layer                   │
│                                                  │
│  Done today: 4   Cancelled: 1                    │
└─────────────────────────────────────────────────┘
```

**Sprint Runner (/sprint)**

Live view while sprint is running:

```
┌─────────────────────────────────────────────────┐
│ Sprint  ████████░░░░░░░  3/7 tasks               │
│                                          [Stop]  │
├─────────────────────────────────────────────────┤
│ ✓ Fix auth bug              done    2m 14s       │
│ ▶ Add rate limiting         running  0m 43s  ●   │
│ ○ Refactor DB layer         queued               │
│ ○ Update API docs           queued               │
├─────────────────────────────────────────────────┤
│ Claude log — Add rate limiting                   │
│ > tasks_get("task-042")                          │
│ > Reading src/middleware/rateLimit.ts...         │
│ > Writing implementation...                      │
│ > Running npm test...                            │
│ > tasks_move("task-042", "done")                 │
└─────────────────────────────────────────────────┘
```

**Settings (/settings)**

- GraphMemory URL + project ID
- API key
- Timeout + retry config
- Permissions (same toggles as wizard)
- Notifications config
- "Test connection" button

---

## Milestone 3 — Permissions model
_Goal: Claude only does what the user allows_

### Implementation

Config:
```json
{
  "permissions": {
    "writeFiles": true,
    "runCommands": ["npm test", "npm run build", "git add", "git commit"],
    "blockedCommands": ["git push", "npm publish", "rm -rf"],
    "mcpTools": "all"
  }
}
```

Translates to `claude --print` flags:
```bash
claude --print \
  --allowedTools "Read,Write,Edit,Bash(npm test),Bash(git commit)" \
  "<prompt>"
```

Rules:
- `readFiles` always true (can't disable — Claude needs to read to work)
- `writeFiles: false` → no Write/Edit tools
- Each `runCommands` entry → `Bash(<command>)` in allowedTools
- `blockedCommands` → validated before spawning, error if Claude tries to use them

**src/core/permissions.ts:**
```typescript
function buildAllowedTools(permissions: Permissions): string[]
function validateCommand(cmd: string, permissions: Permissions): boolean
```

---

## Milestone 4 — Notifications
_Goal: user gets notified when work is done (especially useful for long sprints)_

### Interface

```typescript
// src/infra/notifications/types.ts
interface NotificationPayload {
  event: 'task_done' | 'task_failed' | 'sprint_complete' | 'epic_complete' | 'error';
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface NotificationPort {
  send(payload: NotificationPayload): Promise<void>;
  test(): Promise<void>; // send test notification
}
```

### Channels

**Telegram (src/infra/notifications/telegram.ts)**
```
POST https://api.telegram.org/bot{token}/sendMessage
{ chat_id, text, parse_mode: "Markdown" }
```

Message format:
```
✅ *Sprint Complete* — my-api
4 done · 1 cancelled · 23m 14s

Failed: Add rate limiting
```

**Webhook (src/infra/notifications/webhook.ts)**
- POST JSON payload to configured URL
- Configurable headers (for auth)
- Retry once on failure

**Desktop (src/infra/notifications/desktop.ts)**
- Use `node-notifier` package
- Cross-platform: macOS, Linux (libnotify), Windows
- Click → focus browser window

### Dispatcher (src/infra/notifications/index.ts)
- Reads config, instantiates enabled channels
- Calls all enabled channels in parallel on each event
- Logs failures without crashing

---

## Milestone 5 — Build + packaging
_Goal: `npm install -g gm-orchestrator` works, UI is bundled_

### Build process (scripts/build.ts)

```
1. cd ui && npm run build       → ui/dist/
2. cp -r ui/dist dist/ui/       → included in npm package
3. tsc                          → compile src/ → dist/
```

### package.json

```json
{
  "name": "gm-orchestrator",
  "version": "1.0.0",
  "bin": { "gm-orchestrator": "dist/cli/index.js" },
  "files": ["dist/", "README.md"],
  "scripts": {
    "build": "tsx scripts/build.ts",
    "build:ui": "cd ui && npm run build",
    "build:ts": "tsc",
    "dev": "tsx src/cli/index.ts",
    "dev:ui": "cd ui && npm run dev",
    "test": "vitest run",
    "prepublishOnly": "npm run build && npm test"
  }
}
```

### Dev mode

```bash
# Terminal 1: backend with hot reload
npm run dev

# Terminal 2: UI with hot reload (Vite proxy → :4242)
npm run dev:ui
```

Vite proxies `/api` and `/ws` to `:4242` in dev mode so UI hot-reloads independently.

---

## Milestone 6 — CI/CD
_Goal: tests run on every push, npm publish on tag_

### GitHub Actions

**.github/workflows/ci.yml**
- Trigger: push to main, PRs
- Node 20, 22
- `npm ci && npm test`

**.github/workflows/publish.yml**
- Trigger: `v*` tag push
- `npm run build && npm publish`
- Requires `NPM_TOKEN` secret

---

## What Claude Code should NOT change

- Core orchestrator logic in `src/core/` (tested, working)
- Port/adapter architecture (GraphMemoryPort, ClaudeRunnerPort, TaskPollerPort)
- Test fixtures and fakes in `tests/fixtures/`
- The fundamental signal mechanism: Claude calls `tasks_move("done")` → poller detects it

---

## Definition of Done for v1.0.0

- [ ] `npm install -g gm-orchestrator && gm-orchestrator` works on Linux, macOS, Windows
- [ ] Browser opens automatically with working UI
- [ ] Wizard completes and saves config on first run
- [ ] Sprint and Epic modes run correctly through UI
- [ ] Live log streams Claude output in real time
- [ ] At least one notification channel works (Telegram)
- [ ] All existing tests pass + new tests for server/notifications
- [ ] Published to npm as `gm-orchestrator@1.0.0`
- [ ] README covers installation + quick start

---

## How to feed this to Claude Code

```bash
cd /home/vachick/PhpstormProjects/gm-orchestrator-ts

# Option A: one big sprint (recommended)
./bootstrap.sh "implement gm-orchestrator v1.0.0 according to SPEC_v4.md"

# Option B: milestone by milestone
./bootstrap.sh "implement Milestone 1: Express server + WebSocket backbone from SPEC_v4.md"
# review, then:
./bootstrap.sh "implement Milestone 2: React UI from SPEC_v4.md"
# etc.
```

Claude Code has access to:
- This spec (SPEC_v4.md)
- GraphMemory MCP (for task management)
- All existing src/ code as reference
- npm, git, file system

Each bootstrap.sh run creates tasks in GraphMemory and runs them autonomously.
