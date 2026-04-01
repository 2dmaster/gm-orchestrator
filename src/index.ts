// ─── Public API ──────────────────────────────────────────────────────────

// Core orchestration
export { runSprint, runEpic } from './core/orchestrator.js';
export { buildPrompt } from './core/prompt-builder.js';
export { sortByPriority, isTerminal, areBlockersResolved } from './core/task-utils.js';

// Types
export type {
  TaskStatus,
  TaskPriority,
  EpicStatus,
  TaskRef,
  Task,
  Epic,
  OrchestratorConfig,
  TaskRunResult,
  SprintStats,
  GraphMemoryPort,
  ClaudeRunnerPort,
  TaskPollerPort,
} from './core/types.js';

// Infrastructure
export { GraphMemoryClient } from './infra/gm-client.js';
export { ClaudeRunner } from './infra/claude-runner.js';
export { TaskPoller } from './infra/task-poller.js';
export { loadConfig, validateConfig } from './infra/config.js';
export { consoleLogger, silentLogger } from './infra/logger.js';
export type { Logger } from './infra/logger.js';
