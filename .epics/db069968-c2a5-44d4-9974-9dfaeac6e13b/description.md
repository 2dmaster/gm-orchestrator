## Goal

Redesign the React UI (`ui/` directory) using shadcn/ui + Tailwind with dark theme and violet accent. Backend stays untouched — only `ui/` changes.

Based on **UI_REDESIGN_SPEC.md v0.3.0**.

## Scope

- Install shadcn/ui, cmdk, recharts, lucide-react
- Rewrite all 4 pages: Wizard, Dashboard, Sprint, Settings
- Add Command Palette (Cmd+K)
- Dark theme, violet accent, monospace for logs
- WebSocket events update UI in real time

## Definition of Done

- shadcn/ui installed and configured with dark theme
- All 4 pages implemented (Wizard, Dashboard, Sprint, Settings)
- Command Palette works with Cmd+K
- WebSocket events update UI in real time
- Log stream auto-scrolls with monospace font
- Priority colors applied consistently
- `npm run build` passes with no errors
- UI works end-to-end: open → wizard → dashboard → run sprint → see live log

## Constraints

- Do NOT change `ui/vite.config.ts` (proxy config)
- Do NOT change `ui/package.json` scripts
- Do NOT change backend WS event format
- Keep `ui/src/hooks/useWebSocket.ts` logic, only update event handlers