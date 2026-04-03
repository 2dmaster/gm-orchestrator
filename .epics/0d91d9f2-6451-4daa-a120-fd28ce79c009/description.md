## Goal

Redesign the agent activity section to feel like a familiar chat interface — tool results are shown inline with informative formatting, no expand/collapse needed for output. The activity area is scrollable within a fixed-height layout so the page itself never scrolls.

## Motivation

Current UI shows tool results as collapsed "result" cards with a wrench icon — user has to click to expand each one. This feels like a terminal/debug tool, not a modern chat. Users want to see what the agent is doing at a glance, like a conversation feed, without extra clicks.

## Key changes

### Chat-style output
- Tool results render inline — no "result" row with wrench icon
- Tool call cards show the tool name + input summary in the header, output renders directly below (always visible, not collapsed)
- Format output intelligently: code blocks for code, readable text for text, file paths as links
- Keep it scannable — no wall of raw JSON

### Fixed scroll layout
- Page layout: header + stats bar + task list are fixed/sticky
- Agent activity section fills remaining viewport height
- Only the activity section scrolls internally
- No page-level scroll at all

## Definition of Done
- Tool results visible without clicking anything
- Agent activity area scrolls independently
- Page never scrolls — only the activity feed does
- Non-developer-friendly: readable, clean, no raw JSON dumps