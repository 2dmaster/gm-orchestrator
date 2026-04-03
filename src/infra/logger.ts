import type { Task, TaskRunResult } from '../core/types.js';

// ── Interface ─────────────────────────────────────────────────────────────
// Defined here so core/orchestrator.ts can import the type.
// Swap for a silent mock in tests.

export interface TaskResultMeta {
  attempt?: number;
  maxRetries?: number;
}

export interface Logger {
  info(msg: string): void;
  success(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  skip(msg: string): void;
  section(msg: string): void;
  task(task: Task): void;
  taskResult(task: Task, result: TaskRunResult, meta?: TaskResultMeta): void;
}

// ── Console implementation ────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
} as const;

function ts(): string {
  return `${C.dim}${new Date().toTimeString().slice(0, 8)}${C.reset}`;
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: C.red,
  high: C.yellow,
  medium: C.cyan,
  low: C.dim,
};

export const consoleLogger: Logger = {
  info: (msg) => console.log(`${ts()} ${C.cyan}●${C.reset} ${msg}`),
  success: (msg) => console.log(`${ts()} ${C.green}✓${C.reset} ${msg}`),
  warn: (msg) => console.log(`${ts()} ${C.yellow}⚠${C.reset} ${msg}`),
  error: (msg) => console.log(`${ts()} ${C.red}✗${C.reset} ${msg}`),
  skip: (msg) => console.log(`${ts()} ${C.dim}→ ${msg}${C.reset}`),
  section: (msg) =>
    console.log(`\n${C.bold}${C.magenta}━━ ${msg} ━━${C.reset}`),
  task: (task) => {
    const pc = PRIORITY_COLOR[task.priority] ?? C.reset;
    console.log(
      `${ts()} ${pc}▶${C.reset} [${task.priority.padEnd(8)}] ${task.title}`
    );
    console.log(`${C.dim}        id: ${task.id}${C.reset}`);
  },
  taskResult: () => {},
};

// ── Silent logger for tests ───────────────────────────────────────────────

export const silentLogger: Logger = {
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  skip: () => {},
  section: () => {},
  task: () => {},
  taskResult: () => {},
};
