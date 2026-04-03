## Goal

Redesign the Sprint page and AgentActivity component to provide clear, real-time visibility into Claude agent execution. Adopt industry-standard terminology and patterns from LangSmith/LangFuse/Claude Code.

## Motivation

Current agent activity display is minimal — flat list of truncated tool events, no expandable details, no timestamps, ambiguous "thinking vs working" states, and inconsistent naming. Users can't tell what the agent is doing, how long steps take, or drill into tool inputs/outputs.

## Key changes

### Terminology (align with industry)
- **Run** = one epic/sprint execution (was "sprint run")
- **Trace** = one task execution within a run
- **Step** = one agent action (tool call, thinking block, text output)
- **Turn** = one LLM request-response cycle

### AgentActivity redesign
- Collapsible step cards (click to expand input/output)
- Timestamps and duration badges per step
- Color-coded step types: blue=LLM, purple=thinking, orange=tool, green=success, red=error
- Tool icons mapped properly (file ops, terminal, search, MCP tools)
- Diff view for file edit tools

### Run header / stats bar
- Persistent top bar: running cost, tokens (in/out), turn count, elapsed time
- Live-updating with pulse animation on active step
- Warning/error count badges

### Sprint page improvements
- Better task list with progress context
- Tooltips on truncated content
- "Pin to bottom" auto-scroll toggle
- Empty states and loading skeletons

## Definition of Done
- All agent events render with correct icons, colors, timestamps
- Tool calls are expandable with full input/output
- Cost/token tracking visible at all times during a run
- Consistent terminology throughout UI
- No truncation without hover tooltip