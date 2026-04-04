# Changelog

All notable changes to this project will be documented in this file.

## [0.5.1] — 2026-04-04

### Fixed
- Multi-project run: starting epic/sprint/tasks for the second project now works correctly (GM client and poller are resolved per project instead of always using the first project's client)
- Sprint page shows the correct project context for the running project (reads `projectId` from run snapshot and `run:started` event, not from stale global config)
- Epic progress bar in Dashboard now shows actual done/total counts (uses `progress` field from GM API instead of empty `tasks` array)

### Changed
- Clicking an epic card in the Dashboard right panel now filters the task list to that epic's tasks (toggle selection; click again to deselect and show all)
- `EpicCard` component accepts `onSelect`/`isSelected` props for interactive selection
- `RunSnapshot` now includes `projectId` field to track which project a run belongs to

## [0.5.0] — 2026-04-04

### Added
- Version display in sidebar footer
- Selective task runner: select individual tasks via checkboxes and run only the selected ones
- `/api/version` endpoint

## [0.4.0] — 2026-04-03

### Added
- Multi-project support: `projects[]` config array, project discovery, and UI project switcher
- Per-project GM client pool with lazy initialization
- Cross-project epic tasks and blocker resolution
- Multi-sprint scheduler with priority queue and concurrent slots
- Unified view: merged priority queue across all projects
- Project overview cards with task/epic counts

## [0.3.0] — 2026-04-02

### Added
- shadcn/ui component library with dark violet theme
- Command Palette (Cmd+K) with navigation, actions, and task search
- recharts-based dashboard charts (task status breakdown, priority distribution)
- Geist monospace font for log streams
- Priority color system: critical (red), high (orange), medium (yellow), low (gray)

### Changed
- Full redesign of all 4 pages: Wizard, Dashboard, Sprint Runner, Settings
- Wizard rewritten as multi-step card flow with shadcn inputs, checkboxes, switches
- Dashboard rewritten with stat cards, charts, and task table
- Sprint Runner rewritten with live progress bar, animated task status, log stream panel
- Settings rewritten with tabbed layout (Connection, Permissions, Notifications)

### Dependencies
- Added: `cmdk`, `lucide-react`, `recharts`, `tailwind-merge`, `clsx`, `class-variance-authority`
- Added: `@fontsource-variable/geist`, `@base-ui/react`

## [0.2.0] — 2025-06-30

### Added
- Browser UI with Express server, WebSocket notifications, and permissions system
- React frontend with Wizard, Dashboard, Sprint, and Settings pages
- CLI `serve` command for launching the web interface
- REST API for config, tasks, projects, and sprint control
- WebSocket event bus for real-time UI updates

## [0.1.0] — 2025-06-28

### Added
- Initial release: CLI orchestrator for GraphMemory
- Speck v4 task protocol with automatic task lifecycle management
- Claude Code runner with permission flags
- Prompt builder with context assembly
- Notification system (Telegram, webhooks, desktop)
