// ─── GraphMemory Domain Types ─────────────────────────────────────────────
// Mirrors the GraphMemory REST API response shapes.
// All orchestrator logic is typed against these.

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type EpicStatus = 'open' | 'todo' | 'in_progress' | 'done' | 'cancelled';
export type TaskLinkKind = 'blocks' | 'subtask_of' | 'related_to' | 'prefers_after';

export interface TaskRef {
  id: string;
  title: string;
  status: TaskStatus;
  /** When present, indicates the task lives in a different project (cross-project blocker). */
  projectId?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags?: string[];
  dueDate?: string;
  estimate?: string;
  assignee?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  // Enriched fields from tasks_get
  subtasks?: TaskRef[];
  blockedBy?: TaskRef[];
  blocks?: TaskRef[];
  related?: TaskRef[];
  prefersAfter?: TaskRef[];
  // Arbitrary metadata (heartbeat, run tracking, etc.)
  metadata?: Record<string, unknown>;
}

export interface Epic {
  id: string;
  title: string;
  description?: string;
  status: EpicStatus;
  priority: TaskPriority;
  tags?: string[];
  tasks?: TaskRef[];
  progress?: { done: number; total: number };
  createdAt: string;
  updatedAt: string;
}

// ─── Cross-Project Types ────────────────────────────────────────────────

/**
 * Resolves the current status of a task in another project.
 * Used by the orchestrator to check cross-project blockers.
 * Returns undefined if the task/project is unreachable.
 */
export type CrossProjectResolver = (
  projectId: string,
  taskId: string,
) => Promise<TaskStatus | undefined>;

/**
 * A task enriched with its source project ID, used in cross-project epic views
 * where tasks from multiple projects are merged into a single list.
 */
export interface CrossProjectTask extends Task {
  sourceProjectId: string;
}

// ─── Permissions ─────────────────────────────────────────────────────────

export interface Permissions {
  writeFiles: boolean;
  runCommands: string[];
  blockedCommands: string[];
  mcpTools: 'all' | 'none' | string[];
}

// ─── Discovery Config ────────────────────────────────────────────────────

export interface DiscoveryConfig {
  portRange?: [number, number];   // default [3000, 3100]
  extraServers?: string[];        // explicit URLs, e.g. ["http://localhost:3030"]
  timeoutMs?: number;             // per-port timeout, default 500
}

// ─── Project Entry ───────────────────────────────────────────────────────

export interface ProjectEntry {
  baseUrl: string;
  projectId: string;
  apiKey?: string;
  label?: string; // human-friendly name for UI
}

// ─── Orchestrator Config ──────────────────────────────────────────────────

export type SchedulerStrategy = 'round-robin' | 'priority';

export interface OrchestratorConfig {
  // Multi-project support
  projects: ProjectEntry[];
  activeProjectId?: string; // last selected, for quick resume

  // Execution
  concurrency: number;     // max parallel claude sessions (default 1)
  schedulerStrategy: SchedulerStrategy; // how to distribute work across projects (default 'round-robin')
  timeoutMs: number;       // per-task timeout
  pauseMs: number;         // delay between tasks
  maxRetries: number;

  // Claude Code
  claudeArgs: string[];
  dryRun: boolean;
  model?: string;            // Claude model override (e.g. 'claude-sonnet-4-6', 'claude-opus-4-6')

  // Agent SDK safety
  maxTurns: number;           // max SDK turns per task (default 200)
  agentTimeoutMs: number;     // inactivity watchdog — abort if no events for this long (default 120_000)

  // Sprint/Epic scope
  tag?: string;

  // Server discovery
  discovery?: DiscoveryConfig;

  // Heartbeat / crash recovery
  heartbeat?: HeartbeatConfig;

  // Persisted last run — allows restart/continue after process restart
  lastRun?: LastRunState | undefined;

  // Pipeline definitions for cross-project orchestration
  pipelines?: Pipeline[];

  // Post-task verification hooks
  postTaskHooks?: PostTaskHook[];

  /**
   * Default timeout in ms for a single post-task hook when the hook itself
   * does not specify `timeoutMs`. Applied per-hook, not across all hooks.
   * Default 300_000 (5 minutes).
   */
  postTaskHookTimeoutMs?: number;

  /**
   * When true, an upstream task in `cancelled` state is treated as a resolved
   * blocker (dependents may run). Default false — cancelled prereqs block,
   * because a cancellation means the prerequisite work was not actually done.
   */
  allowCancelledBlockers?: boolean;

  /**
   * When true, a `verify_failed` result halts the entire sprint/epic loop.
   * Default false — the failed task is already moved to a stable state and
   * tagged, so the loop continues to the next task. Opt-in for the old
   * fail-fast behavior.
   */
  haltOnVerifyFailure?: boolean;
}

/** Persisted in config so restart survives process restarts. */
export interface LastRunState {
  projectId: string;
  mode: 'sprint' | 'epic' | 'tasks';
  epicId?: string | undefined;
  taskIds?: string[] | undefined;
  tag?: string | undefined;
  stoppedAt: number; // timestamp
}

/**
 * Legacy config shape for backward compatibility.
 * Old config files may have top-level baseUrl/projectId instead of projects[].
 */
export interface LegacyOrchestratorConfig {
  baseUrl?: string;
  projectId?: string;
  apiKey?: string;
  timeoutMs?: number;
  pauseMs?: number;
  maxRetries?: number;
  claudeArgs?: string[];
  dryRun?: boolean;
  tag?: string;
  discovery?: DiscoveryConfig;
}

/**
 * Returns the active project entry from the config.
 * Looks up by activeProjectId first, falls back to first project.
 */
export function getActiveProject(config: OrchestratorConfig): ProjectEntry | undefined {
  if (!config.projects.length) return undefined;
  if (config.activeProjectId) {
    const found = config.projects.find((p) => p.projectId === config.activeProjectId);
    if (found) return found;
  }
  return config.projects[0];
}

// ─── Pipeline Types ──────────────────────────────────────────────────────

export interface PipelineStage {
  id: string;
  projectId: string;
  epicId: string;
  /** Stage IDs that must complete before this stage can start. */
  after?: string[];
}

export interface Pipeline {
  id: string;
  name: string;
  stages: PipelineStage[];
}

export type PipelineStageStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface PipelineStageRun {
  stageId: string;
  status: PipelineStageStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  stages: PipelineStageRun[];
  startedAt: number;
  completedAt?: number;
}

// ─── Post-Task Hook Types ────────────────────────────────────────────────

/**
 * A verification command that runs after a task is marked done.
 * Executes in the orchestrator process, not inside the spawned Claude session.
 */
export interface PostTaskHook {
  /** Human-readable name for logging (e.g. "make-verify"). */
  name: string;
  /** Shell command to execute (e.g. "make verify", "npm test"). */
  command: string;
  /** Working directory for the command. Defaults to process.cwd(). */
  cwd?: string;
  /** Timeout in ms. Default 600_000 (10 minutes). */
  timeoutMs?: number;
  /** What to do when the hook fails: 'block' halts the sprint, 'warn' logs and continues. */
  onFailure: 'block' | 'warn';
}

/** Why a hook failed, if it did not exit cleanly with a non-zero code. */
export type HookFailureReason = 'timeout' | 'aborted';

/** Result of executing a single post-task hook command. */
export interface HookExecResult {
  success: boolean;
  exitCode: number;
  /** Last N lines of stdout. */
  stdout: string;
  /** Last N lines of stderr. */
  stderr: string;
  /** Set when the hook did not run to completion (e.g. timed out or aborted). */
  failureReason?: HookFailureReason;
}

/** Options passed to hook execution — allows callers to cap runtime and cancel. */
export interface HookExecOptions {
  /** Abort the running hook process when this signal fires. */
  signal?: AbortSignal;
  /** Effective timeout in ms. Overrides hook.timeoutMs when provided. */
  timeoutMs?: number;
}

/**
 * Abstracts executing shell commands for post-task hooks.
 * Swap for a fake in tests.
 */
export interface HookRunnerPort {
  exec(hook: PostTaskHook, opts?: HookExecOptions): Promise<HookExecResult>;
}

// ─── Heartbeat / Crash Recovery Types ─────────────────────────────────────

export type ZombiePolicy = 'reset-to-todo' | 'move-to-review' | 'cancel';

export interface HeartbeatConfig {
  /** How often to update heartbeat_at (ms). Default 30_000 (30s). */
  intervalMs: number;
  /** How long since last heartbeat before a task is considered zombie (ms). Default 2× intervalMs. */
  staleThresholdMs: number;
  /** What to do with zombie tasks on startup. Default 'reset-to-todo'. */
  zombiePolicy: ZombiePolicy;
}

/**
 * Metadata stored on a task to track the active run.
 * Written to task description metadata section (JSON block).
 */
export interface TaskHeartbeatMeta {
  runId: string;
  heartbeatAt: number;
}

// ─── Run Result Types ─────────────────────────────────────────────────────

export type TaskRunResult =
  | 'done'
  | 'cancelled'
  | 'timeout'
  | 'error'
  | 'dry_run'
  | 'blocked'
  | 'verify_failed';

export interface SprintStats {
  done: number;
  cancelled: number;
  retried: number;
  errors: number;
  skipped: number;
  verifyFailed: number;
  durationMs: number;
}

// ─── WebSocket Event Types ───────────────────────────────────────────────

export type ServerEvent =
  | { type: 'run:started';   payload: { mode: 'sprint' | 'epic' | 'tasks'; epicId?: string; projectId?: string } }
  | { type: 'run:stopped';   payload?: { projectId?: string } }
  | { type: 'run:complete';  payload: SprintStats & { projectId?: string } }
  | { type: 'task:started';  payload: { task: Task; projectId?: string } }
  | { type: 'task:done';     payload: { task: Task; projectId?: string } }
  | { type: 'task:cancelled'; payload: { task: Task; reason?: string; projectId?: string } }
  | { type: 'task:timeout';  payload: { task: Task; projectId?: string } }
  | { type: 'task:retrying'; payload: { task: Task; attempt: number; projectId?: string } }
  | { type: 'log:line';      payload: { taskId: string; line: string; projectId?: string } }
  | { type: 'agent:tool_start'; payload: { taskId: string; tool: string; input: string; projectId?: string } }
  | { type: 'agent:tool_end';   payload: { taskId: string; tool: string; output: string; projectId?: string } }
  | { type: 'agent:thinking';   payload: { taskId: string; text: string; projectId?: string } }
  | { type: 'agent:turn';       payload: { taskId: string; turn: number; projectId?: string } }
  | { type: 'agent:cost';       payload: { taskId: string; costUsd: number; inputTokens: number; outputTokens: number; projectId?: string } }
  | { type: 'agent:warning';    payload: { taskId: string; message: string; projectId?: string } }
  | { type: 'scheduler:enqueued';  payload: { requestId: string; projectId: string; mode: 'sprint' | 'epic' | 'tasks' } }
  | { type: 'scheduler:slot_started'; payload: { slotId: number; projectId: string; mode: 'sprint' | 'epic' | 'tasks' } }
  | { type: 'scheduler:slot_completed'; payload: { slotId: number; projectId: string; stats: SprintStats } }
  | { type: 'scheduler:drained' }
  | { type: 'pipeline:started';         payload: { pipelineRunId: string; pipelineId: string } }
  | { type: 'pipeline:stage_started';   payload: { pipelineRunId: string; stageId: string } }
  | { type: 'pipeline:stage_completed'; payload: { pipelineRunId: string; stageId: string; status: PipelineStageStatus } }
  | { type: 'pipeline:complete';        payload: { pipelineRunId: string; status: 'done' | 'failed' | 'cancelled' } }
  | { type: 'run:paused' }
  | { type: 'run:resumed' }
  | { type: 'run:project_paused';  payload: { projectId: string } }
  | { type: 'run:project_resumed'; payload: { projectId: string } }
  | { type: 'error';         payload: { message: string; projectId?: string } };

// ─── Ports (interfaces for dependency injection + testability) ────────────

/**
 * Everything the orchestrator needs from GraphMemory.
 * Mock this in tests — never import gm-client directly in core logic.
 */
export interface GraphMemoryPort {
  listTasks(opts?: { status?: TaskStatus; tag?: string; limit?: number }): Promise<Task[]>;
  getTask(taskId: string): Promise<Task>;
  moveTask(taskId: string, status: TaskStatus): Promise<void>;
  updateTask(taskId: string, fields: Partial<Task>): Promise<void>;
  getEpic(epicId: string): Promise<Epic>;
  listEpicTasks(epicId: string): Promise<Task[]>;
  listEpics(opts?: { status?: EpicStatus; limit?: number }): Promise<Epic[]>;
  moveEpic(epicId: string, status: EpicStatus): Promise<void>;

  /**
   * Fetch the current status of a single task.
   * Used for cross-project blocker resolution — the caller provides
   * a task ID and receives its status without loading the full task.
   * Optional: implementations that don't support cross-project resolution
   * can leave this undefined.
   */
  getTaskStatus?(taskId: string): Promise<TaskStatus>;

  /**
   * Create a link between two tasks. When `targetProjectId` is provided,
   * the `toId` task lives in a different project (cross-project link).
   * Optional: implementations that don't support link creation can leave
   * this undefined.
   */
  linkTask?(opts: {
    fromId: string;
    toId: string;
    kind: TaskLinkKind;
    targetProjectId?: string;
  }): Promise<void>;
}

/**
 * Abstracts spawning Claude Code.
 * Swap for a mock in tests.
 */
export interface ClaudeRunnerPort {
  run(task: Task, config: OrchestratorConfig, runId: string): Promise<void>;
}

/**
 * Abstracts polling for task completion.
 * Lets tests inject instant-resolve fakes.
 */
export interface TaskPollerPort {
  waitForCompletion(
    taskId: string,
    opts: { timeoutMs: number; signal?: AbortSignal }
  ): Promise<'done' | 'cancelled' | 'timeout'>;
}
