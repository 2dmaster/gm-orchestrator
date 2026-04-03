// ─── Step model (paired start/end) ───────────────────────────────────────

export interface AgentToolEvent {
  id: number;
  kind: "tool_start" | "tool_end";
  tool: string;
  detail: string;
  timestamp: number;
}

export interface Step {
  id: number;
  tool: string;
  input: string;
  output?: string;
  startTime: number;
  endTime?: number;
  status: "running" | "done" | "error";
}

/** Heuristic: output text that signals an error result */
const ERROR_PATTERNS = /\b(error|failed|exception|ENOENT|EACCES|EPERM|fatal|panic|denied)\b/i;

function detectStatus(output: string): "done" | "error" {
  return ERROR_PATTERNS.test(output) ? "error" : "done";
}

export function pairEventsToSteps(events: AgentToolEvent[]): Step[] {
  const steps: Step[] = [];
  const pending = new Map<string, Step>();

  for (const evt of events) {
    if (evt.kind === "tool_start") {
      // Close any previous pending step for this tool
      const prev = pending.get(evt.tool);
      if (prev && prev.status === "running") {
        prev.status = "done";
        prev.endTime = evt.timestamp;
      }
      const step: Step = {
        id: evt.id,
        tool: evt.tool,
        input: evt.detail,
        startTime: evt.timestamp,
        status: "running",
      };
      steps.push(step);
      pending.set(evt.tool, step);
    } else {
      // tool_end — pair with the last pending start for this tool
      const step = pending.get(evt.tool);
      if (step && step.status === "running") {
        step.output = evt.detail;
        step.endTime = evt.timestamp;
        step.status = detectStatus(evt.detail);
        pending.delete(evt.tool);
      } else {
        // Orphan tool_end — show as standalone result
        steps.push({
          id: evt.id,
          tool: evt.tool,
          input: "",
          output: evt.detail,
          startTime: evt.timestamp,
          endTime: evt.timestamp,
          status: detectStatus(evt.detail),
        });
      }
    }
  }
  return steps;
}

// ─── Duration / time formatting helpers ─────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function durationColorClass(ms: number): string {
  if (ms < 2000) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/20";
  if (ms < 10_000) return "bg-yellow-500/15 text-yellow-400 border-yellow-500/20";
  if (ms < 30_000) return "bg-amber-500/15 text-amber-400 border-amber-500/20";
  return "bg-red-500/15 text-red-400 border-red-500/20";
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatRelativeTime(stepStart: number, runStart: number): string {
  return `+${((stepStart - runStart) / 1000).toFixed(1)}s`;
}
