# Changelog

All notable changes to this project will be documented in this file.

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
