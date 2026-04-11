// ─── Public API ──────────────────────────────────────────────────────────

// Core orchestration
export { runSprint, runEpic } from './core/orchestrator.js';
export { buildPrompt } from './core/prompt-builder.js';
export { sortByPriority, isTerminal, areBlockersResolved, countUnresolvedSoftPrereqs } from './core/task-utils.js';
export { startHeartbeat, recoverZombieTasks, resolveHeartbeatConfig, HEARTBEAT_DEFAULTS } from './core/heartbeat.js';
export { runPostTaskHooks, handleVerifyFailure } from './core/post-task-hooks.js';

// Types
export type {
  TaskStatus,
  TaskPriority,
  EpicStatus,
  TaskRef,
  Task,
  Epic,
  ProjectEntry,
  OrchestratorConfig,
  LegacyOrchestratorConfig,
  TaskRunResult,
  SprintStats,
  GraphMemoryPort,
  ClaudeRunnerPort,
  TaskPollerPort,
  HeartbeatConfig,
  ZombiePolicy,
  TaskHeartbeatMeta,
  PostTaskHook,
  HookExecResult,
  HookRunnerPort,
} from './core/types.js';
export { getActiveProject } from './core/types.js';

// Infrastructure
export { GraphMemoryClient } from './infra/gm-client.js';
export { ClaudeRunner } from './infra/claude-runner.js';
export { TaskPoller } from './infra/task-poller.js';
export { loadConfig, validateConfig } from './infra/config.js';
export { HookRunner } from './infra/hook-runner.js';
export { consoleLogger, silentLogger } from './infra/logger.js';
export type { Logger } from './infra/logger.js';
