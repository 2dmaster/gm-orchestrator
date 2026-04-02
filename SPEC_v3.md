# gm-orchestrator — Product Spec v3
_Written: 2026-04-02. Status: draft. Author: vachick (with Claude)_

---

## Vision

A standalone CLI tool + optional UI that lets anyone run autonomous AI sprints
on their projects with zero babysitting. Install once, configure once, run forever.

```
npm install -g gm-orchestrator
gm-orchestrator
```

---

## Current state (v2 — proof of concept ✓)

- TypeScript, zero production dependencies
- Port/Adapter architecture (fully testable)
- 41 tests, all green
- Sprint + Epic execution via GraphMemory MCP
- bootstrap.sh for one-click setup
- Self-hosted: the project prepared itself for npm publishing autonomously

**What's missing for a real product:**
- Proper onboarding (right now: edit a JSON file)
- UI for selecting projects / epics / tasks
- Notifications when work is done
- Configurable permissions / allowed actions
- Cross-platform (bootstrap.sh is bash-only)

---

## v3 — What we're building

### 1. CLI onboarding wizard

First run experience — no config file editing:

```
$ gm-orchestrator

  Welcome to gm-orchestrator
  ──────────────────────────
  Scanning for GraphMemory servers...

  Found:
  ● localhost:3000  →  my-api (3 tasks), docs-site (0 tasks)
  ● localhost:3001  →  gm-orchestrator-ts (13 tasks done, 0 todo)

  ? Select a project:  › my-api
  ? What do you want to run?
    ○ Sprint (all todo tasks)
    ● Epic
    ○ Single task

  ? Select epic:  › [high] Q2 Backend Refactor (8 tasks)

  ? Allowed actions (Claude can do these without asking):
    ✓ Read files
    ✓ Write files
    ✓ Run tests
    ✓ Git commit
    ✗ Git push         ← user unchecked this
    ✗ npm publish      ← user unchecked this

  Ready. Press Enter to start.
```

Built with **Ink** (React in terminal) — cross-platform, no Electron needed for CLI.

---

### 2. Web UI (optional, local)

Lightweight local web app served by the orchestrator itself.

```
gm-orchestrator serve
→ open http://localhost:4242
```

Features:
- Project/epic/task browser (reads from GraphMemory)
- Live sprint progress (WebSocket)
- Task log viewer (what Claude did in each session)
- Permissions configurator
- Notification settings

Stack: **Vite + React + TailwindCSS**. Served statically from the npm package.
No cloud, no accounts, fully local.

---

### 3. Permissions model

Every session Claude runs gets a permissions profile. Configurable per project.

```json
{
  "permissions": {
    "readFiles": true,
    "writeFiles": true,
    "runCommands": ["npm test", "npm run build", "git commit"],
    "blockedCommands": ["git push", "npm publish", "rm -rf"],
    "mcpTools": "all"
  }
}
```

Translates to `--allowedTools` flags passed to `claude --print`.
Blocked commands are enforced via a wrapper that intercepts shell calls.

---

### 4. Notifications

Pluggable notification system. Configure once, fires on task/epic/sprint completion.

**Supported channels:**
- **Telegram** — bot token + chat ID (easiest to set up)
- **Slack** — incoming webhook
- **Email** — SMTP (for corporate users)
- **ntfy.sh** — self-hosted push to any device
- **Webhook** — generic POST to any URL (covers WhatsApp via Twilio etc.)
- **Desktop** — native OS notification (node-notifier)

**Notification triggers:**
- Task done / cancelled / failed
- Epic complete
- Sprint complete
- Orchestrator error (requires attention)

**Config:**
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

---

### 5. GraphMemory discovery

Auto-scan for running GraphMemory instances on common ports (3000-3010).
Also support manual URL entry and saved connections.

```typescript
// src/infra/gm-discovery.ts
async function discoverServers(): Promise<GMServer[]>
```

---

### 6. Cross-platform

Replace `bootstrap.sh` with a proper Node.js setup flow that works on:
- Linux ✓
- macOS ✓  
- Windows (WSL2 or native) — needs testing

GraphMemory startup handled in Node.js (child_process), not bash.

---

## Tech stack decisions

| Layer | Choice | Why |
|---|---|---|
| CLI UI | **Ink** (React in terminal) | Cross-platform, composable, testable |
| Web UI | **Vite + React + Tailwind** | Already familiar, fast, simple |
| Desktop app | **Tauri** (if needed) | 10x lighter than Electron, Rust backend |
| Notifications | **ntfy.sh** + direct integrations | Self-hosted option + easy setup |
| Package | **npm** global install | Already set up |

---

## Roadmap

### v2.1 — npm publish (this week)
- [ ] `npm login` + `npm publish`
- [ ] GitHub repo + README
- [ ] Basic CI (GitHub Actions: test on push)

### v2.2 — Cross-platform bootstrap
- [ ] Replace bootstrap.sh with `src/setup.ts`
- [ ] Works on Windows without WSL
- [ ] `gm-orchestrator init` command

### v3.0 — Onboarding + UI
- [ ] Ink-based interactive CLI wizard
- [ ] GraphMemory server discovery
- [ ] Permissions configurator
- [ ] Web UI (serve command)
- [ ] Live progress via WebSocket

### v3.1 — Notifications
- [ ] Telegram integration
- [ ] Webhook (generic)
- [ ] Desktop notifications
- [ ] ntfy.sh support

### v3.2 — Polish
- [ ] Slack, Email
- [ ] Tauri desktop app (if demand exists)
- [ ] Plugin system for custom notification channels

---

## Key insight

The orchestrator already develops itself.
Each version milestone = a goal fed to bootstrap.sh.
The tool eats its own dog food — that's the best demo.

---

## Tomorrow morning — first thing to do

```bash
cd /home/vachick/PhpstormProjects/gm-orchestrator-ts

# 1. Check what got built yesterday
git log --oneline
cat README.md

# 2. Publish to npm
npm login
npm publish --access public

# 3. Start v2.1
./bootstrap.sh "set up GitHub repo and CI with GitHub Actions"
```

---

_Go sleep. It works._ 🍺
