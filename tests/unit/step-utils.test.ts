import { describe, it, expect } from "vitest";
import {
  pairEventsToSteps,
  formatDuration,
  durationColorClass,
  formatRelativeTime,
  type AgentToolEvent,
} from "../../ui/src/lib/step-utils.js";

// ─── formatDuration ──────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("shows milliseconds for < 1s", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("shows seconds with one decimal for 1s–59s", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(2300)).toBe("2.3s");
    expect(formatDuration(14700)).toBe("14.7s");
    expect(formatDuration(59999)).toBe("60.0s");
  });

  it("shows minutes + seconds for >= 60s", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });
});

// ─── durationColorClass ─────────────────────────────────────────────────

describe("durationColorClass", () => {
  it("returns green (emerald) for < 2s", () => {
    expect(durationColorClass(0)).toContain("emerald");
    expect(durationColorClass(1999)).toContain("emerald");
  });

  it("returns yellow for 2s–10s", () => {
    expect(durationColorClass(2000)).toContain("yellow");
    expect(durationColorClass(9999)).toContain("yellow");
  });

  it("returns orange (amber) for 10s–30s", () => {
    expect(durationColorClass(10_000)).toContain("amber");
    expect(durationColorClass(29_999)).toContain("amber");
  });

  it("returns red for >= 30s", () => {
    expect(durationColorClass(30_000)).toContain("red");
    expect(durationColorClass(120_000)).toContain("red");
  });
});

// ─── formatRelativeTime ─────────────────────────────────────────────────

describe("formatRelativeTime", () => {
  it("formats relative time from run start", () => {
    expect(formatRelativeTime(1000, 0)).toBe("+1.0s");
    expect(formatRelativeTime(2300, 0)).toBe("+2.3s");
    expect(formatRelativeTime(14700, 0)).toBe("+14.7s");
  });

  it("handles non-zero run start", () => {
    const runStart = 1700000000000;
    expect(formatRelativeTime(runStart + 5000, runStart)).toBe("+5.0s");
  });
});

// ─── pairEventsToSteps ──────────────────────────────────────────────────

describe("pairEventsToSteps", () => {
  const base = 1700000000000;

  function evt(
    id: number,
    kind: "tool_start" | "tool_end",
    tool: string,
    ts: number,
    detail = "",
  ): AgentToolEvent {
    return { id, kind, tool, detail, timestamp: base + ts };
  }

  it("pairs a tool_start and tool_end into one step", () => {
    const events = [
      evt(1, "tool_start", "Read", 0, "file.ts"),
      evt(2, "tool_end", "Read", 1200, "contents"),
    ];
    const steps = pairEventsToSteps(events);
    expect(steps).toHaveLength(1);
    expect(steps[0].tool).toBe("Read");
    expect(steps[0].status).toBe("done");
    expect(steps[0].input).toBe("file.ts");
    expect(steps[0].output).toBe("contents");
    expect(steps[0].endTime! - steps[0].startTime).toBe(1200);
  });

  it("marks unpaired tool_start as running", () => {
    const events = [evt(1, "tool_start", "Bash", 0, "npm test")];
    const steps = pairEventsToSteps(events);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("running");
    expect(steps[0].endTime).toBeUndefined();
  });

  it("handles orphan tool_end gracefully", () => {
    const events = [evt(1, "tool_end", "Bash", 500, "output")];
    const steps = pairEventsToSteps(events);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("done");
    expect(steps[0].output).toBe("output");
    expect(steps[0].input).toBe("");
  });

  it("pairs multiple different tools correctly", () => {
    const events = [
      evt(1, "tool_start", "Read", 0, "a.ts"),
      evt(2, "tool_start", "Grep", 100, "pattern"),
      evt(3, "tool_end", "Read", 500, "a-content"),
      evt(4, "tool_end", "Grep", 800, "grep-result"),
    ];
    const steps = pairEventsToSteps(events);
    expect(steps).toHaveLength(2);
    expect(steps[0].tool).toBe("Read");
    expect(steps[0].output).toBe("a-content");
    expect(steps[1].tool).toBe("Grep");
    expect(steps[1].output).toBe("grep-result");
  });

  it("closes previous pending step when same tool starts again", () => {
    const events = [
      evt(1, "tool_start", "Read", 0, "a.ts"),
      evt(2, "tool_start", "Read", 1000, "b.ts"),
      evt(3, "tool_end", "Read", 1500, "b-content"),
    ];
    const steps = pairEventsToSteps(events);
    expect(steps).toHaveLength(2);
    // First step auto-closed
    expect(steps[0].status).toBe("done");
    expect(steps[0].endTime).toBe(base + 1000);
    // Second step paired normally
    expect(steps[1].status).toBe("done");
    expect(steps[1].output).toBe("b-content");
  });

  it("returns empty array for no events", () => {
    expect(pairEventsToSteps([])).toEqual([]);
  });

  it("marks step as error when output contains error keywords", () => {
    const events = [
      evt(1, "tool_start", "Bash", 0, "npm test"),
      evt(2, "tool_end", "Bash", 2000, "ENOENT: no such file or directory"),
    ];
    const steps = pairEventsToSteps(events);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("error");
  });

  it("marks step as error for 'failed' output", () => {
    const events = [
      evt(1, "tool_start", "Bash", 0, "npm run build"),
      evt(2, "tool_end", "Bash", 5000, "Build failed with 3 errors"),
    ];
    const steps = pairEventsToSteps(events);
    expect(steps[0].status).toBe("error");
  });

  it("marks orphan tool_end as error when output has error keyword", () => {
    const events = [evt(1, "tool_end", "Read", 500, "Error: file not found")];
    const steps = pairEventsToSteps(events);
    expect(steps[0].status).toBe("error");
  });

  it("marks step as done when output has no error keywords", () => {
    const events = [
      evt(1, "tool_start", "Read", 0, "file.ts"),
      evt(2, "tool_end", "Read", 500, "function hello() { return 42; }"),
    ];
    const steps = pairEventsToSteps(events);
    expect(steps[0].status).toBe("done");
  });
});
