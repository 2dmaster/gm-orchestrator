## Goal

Redesign the Settings page to show all configured GraphMemory connections and projects, allow adding/removing/editing them, and selecting the active project — all without requiring manual config file editing.

## Motivation

Currently the Settings page doesn't display connected projects or allow managing GraphMemory connections. Users have to edit `.gm-orchestrator.json` manually to add servers or switch projects. The Wizard handles initial setup but there's no way to manage connections after that.

## Scope

### Connection management
- List all configured GM servers (baseUrl + projects) with connection status (online/offline indicator)
- Add new GM server: input baseUrl, probe it, show discovered projects
- Remove a GM server and its projects
- Edit server baseUrl (re-probe on change)

### Project management
- Show all projects across all servers with their status (task counts, epic counts)
- Add/remove projects from a server (checkbox list from discovered projects)
- Set active project (radio/select)
- Project labels — editable display names

### Config display
- Show current orchestrator settings (timeoutMs, pauseMs, maxRetries, concurrency, dryRun, etc.)
- Editable inline or via form
- Show app version

### Validation & feedback
- Probe server on add/edit — show success/failure immediately
- Prevent removing the last project
- Toast notifications for save success/errors

## Definition of Done

- Settings page shows all GM connections and projects
- Can add new GM server by URL with auto-discovery
- Can remove servers and projects
- Can edit server URLs and project labels
- Can set active project
- Config changes persist to `.gm-orchestrator.json` via PUT /api/config
- Connection status indicators (online/offline)
- Tests for settings-related API interactions
- Build passes