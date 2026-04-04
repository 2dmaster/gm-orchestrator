# Agent Rules — gm-orchestrator

## MCP First

Always prefer GraphMemory MCP tools over reading files directly.
Follow this order before touching any file:

1. `skills_recall("<topic>")` — check for saved patterns and recipes
2. `docs_search("<query>")` — search project documentation
3. `code_search("<query>")` — search codebase by meaning
4. `tasks_get("<taskId>")` — get full task context, links, subtasks
5. Only use the `Read` file tool if MCP returns no relevant results

This keeps context lean and leverages existing knowledge.

## Task Protocol

Every session is assigned exactly one task from GraphMemory.

**Start:**
- Call `tasks_get("<taskId>")` to get full context before doing anything
- Check `blockedBy` — if blockers exist and aren't done, call `tasks_move("cancelled")` immediately

**During:**
- Use `skills_recall` before implementing anything non-trivial
- Create notes via `notes_create` for important decisions or discoveries
- If a subtask exists, call `tasks_move(subtaskId, "done")` as each one completes

**End — always signal completion, never skip this:**
- Success: `tasks_move("<taskId>", "done")`
- Blocked or impossible: `tasks_move("<taskId>", "cancelled")` + update task description with exact reason

## Code Rules

- TypeScript strict mode — no `any`, no `@ts-ignore`
- Port/adapter architecture — core logic never imports from infra directly
- New behaviour = new test in `tests/`
- Run `npm test` before marking task done — if tests fail, fix them first
- Run `npm run build` for any UI changes — if build fails, fix it first

## Project Structure

```
src/core/      — pure business logic, no I/O (orchestrator, prompt-builder, types)
src/infra/     — I/O implementations (gm-client, claude-runner, notifications)
src/server/    — Express + WebSocket server
src/cli/       — CLI entrypoint
ui/            — React frontend (Vite + shadcn/ui + Tailwind)
tests/         — Vitest tests (unit + integration)
```

## What NOT to touch without explicit instruction

- `src/core/` — tested and stable, changes need test coverage
- `tests/fixtures/fakes.ts` — fake implementations used across tests
- `ui/vite.config.ts` — proxy config to :4242 must stay intact
- `.gm-orchestrator.json` — user config, never overwrite

## Release Checklist

Every release MUST follow these steps in order:

1. **Bump version** in `package.json` (semver: breaking=major, feature=minor, fix=patch)
2. **Commit** version bump: `chore: release vX.Y.Z`
3. **Create git tag**: `git tag vX.Y.Z`
4. **Push commit AND tag**: `git push origin main && git push origin vX.Y.Z`
   - The tag push triggers `.github/workflows/publish.yml` → npm publish
5. **Create GitHub Release** via `gh release create vX.Y.Z`:
   - Title format: `vX.Y.Z — Short summary`
   - Body: changelog in Keep a Changelog format (`### Added`, `### Fixed`, `### Changed`)
   - End with `**Full Changelog**: https://github.com/2dmaster/gm-orchestrator/compare/vPREV...vX.Y.Z`
6. **Verify** npm publish succeeded: `gh run list --workflow=publish.yml --limit 1`

**Never skip steps 3-5.** A version bump without tag+release = invisible to users.

## GraphMemory connection

- Server: check `baseUrl` in `.gm-orchestrator.json`
- MCP endpoint: `http://localhost:3000/mcp/<projectId>`
- REST API: `http://localhost:3000/api/<projectId>`
- If GraphMemory is unreachable, note it in task description and cancel
