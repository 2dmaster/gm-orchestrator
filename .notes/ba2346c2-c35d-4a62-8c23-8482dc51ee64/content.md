## Decision

The multi-runner scheduler (`src/core/scheduler.ts`) uses a slot-based concurrency model:

- **Slots**: Fixed pool of `concurrency` slots, each can run one sprint/epic at a time
- **Queue**: Priority-sorted FIFO queue of run requests across all projects
- **Strategies**: `round-robin` (default) prefers projects without active slots; `priority` always picks highest priority
- **Each project gets its own RunnerService instance** via the `resolveGm`, `createRunner`, `createPoller` port resolvers

## Key APIs

- `POST /api/run/multi-sprint` — accepts `projectIds[]`, optional `tag`, `priority`
- `DELETE /api/run/queue/:requestId` — cancel a queued (not-yet-running) request
- `GET /api/run/status` — returns scheduler slot states + queue + aggregate stats
- WS events: `scheduler:enqueued`, `scheduler:slot_started`, `scheduler:slot_completed`, `scheduler:drained`
- All existing WS events now include optional `projectId` field

## Config

- `concurrency` (default 1): max parallel claude sessions
- `schedulerStrategy` (default 'round-robin'): `round-robin` | `priority`