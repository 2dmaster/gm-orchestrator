# Epics list: pagination + active-status filter + auto-refresh

## Problem
The orchestrator Dashboard "froze" the epics list at the value loaded when the page first opened. New epics (e.g. created externally via MCP) never appeared without a full page reload, and projects with many epics silently hid newer ones.

## Root causes (two layers)
1. **UI never refetched.** The old inline `useEpics` hook in `Dashboard.tsx` fetched once on mount and had no WS refresh, no polling, and no manual refresh — unlike `useTasks`, which auto-refreshes on WebSocket events.
2. **Server-side cap.** `GraphMemoryClient.listEpics` defaulted to `limit=50` and the UI never passed a limit. In a project with 67 epics, only the first 50 returned, so newer epics fell outside the response entirely. Worse, the client-side "hide closed" filter ran over only those 50, so the visible active list could be tiny (3 of 6) and miss active epics.

## Fix
- **Real pagination end-to-end.** `GraphMemoryPort.listEpics` now accepts `offset` and returns `{ results, total }` (was `Epic[]`). `gm-client`, the `/api/projects/:id/epics` endpoint (returns `{ epics, total }`), the CLI `status` command, the test fake, and the runner-service mock were all updated.
- **New `ui/src/hooks/useEpics.ts`** (mirrors `useTasks`): exposes `refetch`, `loadMore`, `total`, `hasMore`; page size `EPICS_PAGE_SIZE = 20`; auto-refresh on run-lifecycle WS events + 20s polling + window-focus refetch (externally-created epics emit no WS event, so polling/focus is the only way to surface them without reload). Dashboard got a "Load more" button + a manual refresh icon.
- **Active-only filtering server-side.** When "Show closed" is off (default), the UI requests `status=open,in_progress`. GraphMemory accepts only one status per request, so `gm-client.listEpics` fetches each status in parallel, merges, and paginates locally; `total` is the sum. The endpoint parses comma-separated `?status=`. The client-side "closed" filter for epics was removed.

## Key constraint to remember
The orchestrator is NOT subscribed to GraphMemory changes — it only learns about externally-created epics by polling. WS events only cover the orchestrator's own run lifecycle (`task:done`, `run:complete`, etc.). A truly live list would require GraphMemory to push (SSE/WS) from the GM server side.

## Files
`src/core/types.ts`, `src/infra/gm-client.ts`, `src/server/api.ts`, `src/cli/index.ts`, `tests/fixtures/fakes.ts`, `tests/unit/runner-service.test.ts`, `tests/unit/api.test.ts`, `ui/src/hooks/useEpics.ts`, `ui/src/pages/Dashboard.tsx`.