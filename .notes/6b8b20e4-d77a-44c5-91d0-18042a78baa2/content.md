## Decision
`src/core/heartbeat.ts` uses a `mergeMetadata(gm, taskId, patch)` helper for ALL metadata writes (heartbeat ticks, `stop()`, zombie recovery's clear). The helper reads the current task, merges the patch on top of existing metadata (keys with `undefined` value are deleted), and PUTs the union back.

## Why
GraphMemory's REST `updateTask` is PUT semantics — sending `{metadata: {runId, heartbeatAt}}` replaces the whole metadata object, wiping any other fields (e.g. `verifyFailedAt`, `verifyFailures`). The previous v0.12.0 stop() unconditionally clobbered metadata in the `runOneTask` finally block, destroying the failure record `handleVerifyFailure` had just written.

## Why Option B (not A or C)
- **Option A** (server-side metadata_patch endpoint): cleanest, but requires GM server changes — out of scope for the orchestrator hotfix.
- **Option C** (move runId/heartbeatAt to top-level Task fields): cleanest long-term, but requires GM schema changes and migration.
- **Option B** (client-side merge): no GM changes, fixes the symptom now. Has a small race window between GET and PUT, but dramatically smaller than the previous unconditional overwrite. Acceptable as an interim fix; revisit when Option C becomes feasible.

## Behavior change
`stop()` now sends `{runId: undefined, heartbeatAt: undefined}` (omit semantics) merged with existing metadata, instead of `{runId: null, heartbeatAt: null}` as a wholesale replacement. The keys are removed from the object, not set to null. Zombie recovery checks `typeof heartbeatAt === 'number'` so undefined/missing both correctly indicate "no heartbeat".

## Tests
- `tests/unit/heartbeat.test.ts`:
  - `stop()` preserves `verifyFailedAt`/`verifyFailures` while clearing heartbeat keys.
  - Initial heartbeat write preserves pre-existing custom metadata.
  - Mid-run write from another writer survives the next heartbeat tick.
  - Zombie recovery preserves non-heartbeat metadata.