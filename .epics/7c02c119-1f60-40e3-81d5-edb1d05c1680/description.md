Replace subprocess-based Claude runner (`spawn('claude', ['--print', ...])`) with the Claude Agent SDK (`@anthropic-ai/claude-code`).

## Motivation
Current approach spawns `claude --print` as a child process and streams raw stdout. This gives no structured visibility into what the agent is doing — the UI shows a dumb loader for minutes with no indication whether the agent is working, stuck, or what tools it's calling.

The Agent SDK provides:
- Structured streaming events (tool calls, text deltas, message lifecycle)
- Token/cost tracking per task
- Programmatic abort (no process group kill hacks)
- MCP server support (can pass GraphMemory MCP directly)
- Resumable sessions
- Max turns control

## Scope
- Replace `createStreamingRunner()` in `src/server/runner-service.ts`
- Emit structured events to UI via WebSocket (tool calls, thinking, file edits, etc.)
- Update Sprint UI to show real-time agent activity (not just raw text)
- Remove `detached` process spawn and `process.kill(-pid)` workaround
- Keep `ClaudeRunnerPort` interface compatible or evolve it

## Key files
- `src/server/runner-service.ts` — streaming runner
- `src/core/types.ts` — ClaudeRunnerPort, ServerEvent types
- `ui/src/pages/Sprint.tsx` — log stream display
- `ui/src/components/LogStream.tsx` — log rendering