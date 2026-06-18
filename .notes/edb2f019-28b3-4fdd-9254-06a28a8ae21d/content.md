# Model selector: server-served list instead of UI hardcode

## Problem
The per-run model dropdown in `Dashboard.tsx` hardcoded `MODEL_OPTIONS` with stale IDs (`claude-opus-4-6`, `claude-haiku-4-5-20251001`) — missing current models (Opus 4.8 is current; 4.7 / Sonnet 4.6 / Haiku 4.5 / Fable 5 exist). Updating models required a UI rebuild.

## Fix
- **New endpoint `GET /api/models`** in `src/server/api.ts`. Returns `{ models: [{id, label}], source }`.
  - Serves a curated, current list (`DEFAULT_MODELS`: opus-4-8, opus-4-7, sonnet-4-6, haiku-4-5) — the single source of truth, editable without a UI rebuild.
  - When `ANTHROPIC_API_KEY` is set in the server env, queries the live Anthropic Models API (`GET https://api.anthropic.com/v1/models`) and returns that (`source: "live"`); falls back to curated on any failure (`source: "curated"`).
- **New `ui/src/hooks/useModels.ts`** fetches `/api/models` and returns a value→label map led by the "default" option; falls back to `{default}` while loading / on error.
- Removed the hardcoded `MODEL_OPTIONS` constant from `Dashboard.tsx`.

## Why not always live
The orchestrator is tokenless by default (drives Claude via the Agent SDK / CLI, OAuth — no API key), so the live Anthropic Models API usually isn't reachable. The curated server list is the reliable path; live is a best-effort upgrade when a key happens to be present.

## Maintenance note
Keep `DEFAULT_MODELS` in `src/server/api.ts` current. Current Claude model IDs (no date suffixes): `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`, `claude-fable-5`.