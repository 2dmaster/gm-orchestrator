# gm-orchestrator UI Redesign Spec
_Version: 0.3.0. Status: approved. Date: 2026-04-02_

---

## Goal

Redesign the React UI (`ui/` directory) using shadcn/ui + Tailwind.
The backend (`src/server/`, `src/core/`, `src/infra/`) stays untouched.
Only `ui/` changes.

---

## Tech stack

- **React 18** (already in project)
- **Vite** (already in project)
- **shadcn/ui** — component library (install fresh)
- **Tailwind CSS v3** (already in project)
- **cmdk** — command palette (via shadcn)
- **lucide-react** — icons (comes with shadcn)
- **recharts** — for task completion chart on dashboard (via shadcn)

---

## Setup instructions for Claude Code

```bash
cd ui/

# Init shadcn (choose: dark style, slate base color, CSS variables yes)
npx shadcn@latest init

# Install components needed
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add badge
npx shadcn@latest add progress
npx shadcn@latest add separator
npx shadcn@latest add scroll-area
npx shadcn@latest add toast
npx shadcn@latest add command
npx shadcn@latest add dialog
npx shadcn@latest add switch
npx shadcn@latest add input
npx shadcn@latest add label
npx shadcn@latest add select
npx shadcn@latest add tabs
npx shadcn@latest add tooltip
npx shadcn@latest add sonner
```

---

## Design tokens

Override in `ui/src/index.css` after shadcn init:

```css
:root {
  --background: 240 10% 4%;        /* #0a0a0f */
  --foreground: 214 32% 91%;       /* #e2e8f0 */
  --card: 240 10% 6%;              /* #111118 */
  --card-foreground: 214 32% 91%;
  --border: 240 8% 12%;            /* #1e1e2e */
  --input: 240 8% 12%;
  --primary: 262 83% 58%;          /* #7c3aed violet */
  --primary-foreground: 0 0% 100%;
  --muted: 240 8% 16%;
  --muted-foreground: 215 16% 47%; /* #64748b */
  --accent: 262 83% 58%;
  --accent-foreground: 0 0% 100%;
  --destructive: 348 100% 65%;     /* #ff4d6d */
  --ring: 262 83% 58%;
  --radius: 0.5rem;

  /* Custom semantic colors */
  --color-done: #00d084;
  --color-cancelled: #ff4d6d;
  --color-running: #7c3aed;
  --color-queued: #64748b;

  /* Priority colors */
  --priority-critical: #ff4d6d;
  --priority-high: #f97316;
  --priority-medium: #7c3aed;
  --priority-low: #64748b;
}
```

---

## Typography

```css
/* ui/src/index.css */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

body {
  font-family: 'Inter', sans-serif;
}

code, pre, .font-mono {
  font-family: 'JetBrains Mono', monospace;
}
```

---

## Layout

### Shell (ui/src/components/Shell.tsx)

```
┌─────────────────────────────────────────────────────────┐
│ Sidebar (240px)  │  Main content (flex-1)               │
│                  │                                       │
│ ● gm-orchestrator│                                       │
│                  │                                       │
│ ○ Dashboard      │                                       │
│ ○ Sprint         │                                       │
│ ○ Settings       │                                       │
│                  │                                       │
│ ──────────────── │                                       │
│ ● project-name   │                                       │
│   3 tasks todo   │                                       │
│                  │                                       │
│ [Cmd+K]          │                                       │
└─────────────────────────────────────────────────────────┘
```

Sidebar:
- Fixed left, full height, `bg-card border-r border-border`
- Logo top: `gm-orchestrator` in monospace, small violet dot
- Nav items: icon + label, active state with violet left border + bg-muted
- Bottom: current project name + task count + Cmd+K hint
- Icons: `lucide-react` — LayoutDashboard, Play, Settings

---

## Pages

### 1. Wizard (`/wizard`)

Shown when no config or projectId is empty.
Use shadcn `Card` + step indicator.

**Step 1 — Welcome**
```
┌────────────────────────────────┐
│                                │
│  ⬡  gm-orchestrator           │
│                                │
│  Autonomous AI sprint runner   │
│  for GraphMemory.              │
│                                │
│  Set up takes 60 seconds.      │
│                                │
│  [Get started →]               │
│                                │
└────────────────────────────────┘
```
- Centered card, max-w-md
- Logo mark: hexagon SVG in violet
- Single CTA button (shadcn Button variant="default")

**Step 2 — Connect**
```
┌────────────────────────────────┐
│  Connect GraphMemory           │
│  ─────────────────────────     │
│  Scanning localhost...  ⠋      │
│                                │
│  Found:                        │
│  ● localhost:3000  my-app      │
│    3 tasks · 1 epic            │
│                                │
│  Or enter URL manually:        │
│  [http://localhost:3000      ] │
│                                │
│  [← Back]  [Continue →]        │
└────────────────────────────────┘
```
- Auto-scan ports 3000-3010 on mount via `GET /api/discover`
- Found servers as clickable cards with subtle border
- Manual URL input as fallback (shadcn Input)
- Loading: animated spinner from lucide

**Step 3 — Select Project**
```
┌────────────────────────────────┐
│  Select project                │
│  ─────────────────────────     │
│                                │
│  ┌──────────────────────────┐  │
│  │ ● my-api          3 tasks│  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │ ○ docs-site       0 tasks│  │
│  └──────────────────────────┘  │
│                                │
│  [← Back]  [Continue →]        │
└────────────────────────────────┘
```
- Selectable cards, selected = violet border
- Show task count + epic count per project

**Step 4 — Permissions**
```
┌────────────────────────────────┐
│  What can Claude do?           │
│  ─────────────────────────     │
│                                │
│  Read files          ● (locked)│
│  Write files         ●         │
│  Run tests           ●         │
│  Git commit          ●         │
│  Git push            ○         │
│  npm publish         ○         │
│                                │
│  [← Back]  [Finish →]          │
└────────────────────────────────┘
```
- shadcn Switch components
- Read files locked on (can't disable)
- Tooltip on each explaining what it allows

**Step 5 — Done**
```
┌────────────────────────────────┐
│                                │
│  ✓  You're ready               │
│                                │
│  my-api · localhost:3000       │
│  3 tasks waiting               │
│                                │
│  [Go to Dashboard →]           │
│                                │
└────────────────────────────────┘
```
- Green checkmark animation (CSS)
- Summary of what was configured
- Redirect to dashboard on click

---

### 2. Dashboard (`/dashboard`)

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Good morning.                    [▶ Run Sprint]        │
│  3 tasks waiting in my-api                              │
│                                                         │
│  ┌─────────────────────────┐  ┌──────────────────────┐  │
│  │ TASKS                   │  │ EPICS                │  │
│  │                         │  │                      │  │
│  │ ▌Fix auth bug    done   │  │ Q2 Backend      8/12 │  │
│  │ ▌Add rate limit  todo   │  │ Docs update      0/3 │  │
│  │ ▌Refactor DB     todo   │  │                      │  │
│  │ ▌Update docs     todo   │  │ [Run Epic ▾]         │  │
│  │                         │  │                      │  │
│  │  + 2 more               │  │                      │  │
│  └─────────────────────────┘  └──────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Today                                           │   │
│  │ ████████████░░░░░░░░  4 done · 1 cancelled      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Details:
- Greeting based on time of day
- Task list: left colored border = priority color, max 5 shown + "X more"
- Priority border colors: critical=#ff4d6d, high=#f97316, medium=#7c3aed, low=#64748b
- Status badge: shadcn Badge with custom variants
- Epic cards: title + progress fraction + progress bar
- Today bar: recharts BarChart or simple CSS progress
- Run Sprint button: top right, prominent, violet

---

### 3. Sprint Runner (`/sprint`)

```
┌─────────────────────────────────────────────────────────┐
│  Sprint                                        [■ Stop]  │
│  ████████████████░░░░░░░░░░░  4 / 7                     │
│  Running · 14m 22s elapsed                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ✓  Fix auth bug                           2m 14s  done │
│  ✓  Add rate limiting                      8m 03s  done │
│  ▶  Refactor DB layer              ████░░  0m 43s  ···  │
│  ○  Update API docs                                     │
│  ○  Write migration guide                               │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Claude — Refactor DB layer                             │
│                                                         │
│  > tasks_get("task-042")                                │
│  > Reading src/db/connection.ts...                      │
│  > Writing refactored version...                        │
│  > npm test -- --testPathPattern=db                     │
│  > All tests passed ✓                                   │
│  > tasks_move("task-042", "done")                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Details:
- Top: overall progress bar (shadcn Progress) + elapsed timer
- Task list:
  - ✓ done = muted, green checkmark
  - ▶ running = violet, animated pulse dot, inline mini progress bar
  - ○ queued = muted
  - ✗ cancelled = red strikethrough
- Log stream panel (bottom half):
  - `bg-black/40 rounded-lg font-mono text-sm`
  - Lines starting with `>` = violet color (tool calls)
  - Auto-scroll to bottom
  - shadcn ScrollArea
- Stop button: top right, destructive variant
- When complete: show SprintStats card with animation

---

### 4. Settings (`/settings`)

shadcn Tabs: Connection · Permissions · Notifications

**Connection tab:**
- GraphMemory URL (Input)
- Project ID (Input)  
- API Key (Input type=password)
- [Test Connection] button → green toast on success, red on fail

**Permissions tab:**
- Same switches as wizard step 4
- Custom commands whitelist: tags-style input
- Blocked commands: same

**Notifications tab:**
- Telegram section: bot token + chat ID inputs + [Send test] button
- Webhook section: URL + headers
- Desktop: toggle + [Send test]
- Triggers: checkboxes for sprint_complete, task_failed, epic_complete

All tabs: [Save] button at bottom, shadcn Sonner toast on save.

---

## Command Palette (global)

Trigger: `Cmd+K` / `Ctrl+K`

```
┌────────────────────────────────────┐
│ 🔍 Type a command...               │
├────────────────────────────────────┤
│ ▶  Run Sprint                      │
│ ▶  Run Epic...                     │
│ ○  View Dashboard                  │
│ ⚙  Open Settings                  │
│ ■  Stop current run                │
└────────────────────────────────────┘
```

- shadcn Command component (cmdk)
- Opens as Dialog overlay
- Keyboard navigation with arrows
- "Run Epic..." → shows sub-list of available epics

---

## WebSocket integration

All real-time updates via existing WS connection.
Hook: `ui/src/hooks/useWebSocket.ts` (already exists, keep interface).

Events to handle in UI:
```typescript
'run:started'   → navigate to /sprint, show progress
'run:complete'  → show completion card + sonner toast
'task:started'  → update task status in list, start timer
'task:done'     → green checkmark animation
'task:cancelled'→ red, show reason in tooltip
'task:timeout'  → orange, show retry count
'log:line'      → append to log stream, auto-scroll
'error'         → red sonner toast
```

---

## Animations

Keep them subtle and purposeful:

```css
/* Task status transition */
.task-done {
  transition: opacity 0.3s ease, background 0.3s ease;
}

/* Running pulse dot */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* Log line appear */
@keyframes slide-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.log-line {
  animation: slide-in 0.15s ease;
}
```

No page transition animations — keep it snappy.

---

## File structure (ui/src/)

```
ui/src/
├── main.tsx
├── App.tsx                    # router: wizard / dashboard / sprint / settings
├── index.css                  # design tokens + base styles
├── components/
│   ├── Shell.tsx              # sidebar + layout wrapper
│   ├── CommandPalette.tsx     # Cmd+K dialog
│   ├── TaskRow.tsx            # single task in list
│   ├── EpicCard.tsx           # epic with progress
│   ├── LogStream.tsx          # Claude output panel
│   ├── PriorityBadge.tsx      # colored priority indicator
│   ├── StatusBadge.tsx        # done/running/queued/cancelled
│   └── ui/                    # shadcn generated components (don't edit)
├── pages/
│   ├── Wizard.tsx
│   ├── Dashboard.tsx
│   ├── Sprint.tsx
│   └── Settings.tsx
└── hooks/
    ├── useWebSocket.ts        # WS connection + event dispatch
    ├── useTasks.ts            # fetch + subscribe to task updates
    ├── useOrchestrator.ts     # run/stop sprint/epic
    └── useCommandPalette.ts   # Cmd+K state
```

---

## What NOT to change

- `ui/vite.config.ts` — proxy config to :4242 must stay
- `ui/package.json` scripts — build/dev commands must stay
- All hooks interfaces — backend WS events format is fixed
- `ui/src/hooks/useWebSocket.ts` — keep existing WS logic, only update event handlers

---

## How to feed this to Claude Code

```bash
cd /home/vachick/PhpstormProjects/gm-orchestrator-ts

./bootstrap.sh "redesign the UI according to UI_REDESIGN_SPEC.md.
Use shadcn/ui + Tailwind. Install shadcn components first.
Keep vite.config.ts and all hooks interfaces unchanged.
Dark theme, violet accent, monospace for logs.
Implement all 4 pages: Wizard, Dashboard, Sprint, Settings.
Add Command Palette (Cmd+K).
After implementation: npm run build from ui/ and verify no errors."
```

---

## Definition of Done

- [ ] shadcn/ui installed and configured with dark theme
- [ ] All 4 pages implemented (Wizard, Dashboard, Sprint, Settings)
- [ ] Command Palette works with Cmd+K
- [ ] WebSocket events update UI in real time
- [ ] Log stream auto-scrolls with monospace font
- [ ] Priority colors applied consistently
- [ ] `npm run build` passes with no errors
- [ ] UI works end-to-end: open → wizard → dashboard → run sprint → see live log
