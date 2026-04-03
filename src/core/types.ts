// ─── GraphMemory Domain Types ─────────────────────────────────────────────
// Mirrors the GraphMemory REST API response shapes.
// All orchestrator logic is typed against these.

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type EpicStatus = 'open' | 'todo' | 'in_progress' | 'done' | 'cancelled';

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
}

export interface Epic {
  id: string;
  title: string;
  description?: string;
  status: EpicStatus;
  priority: TaskPriority;
  tags?: string[];
  tasks?: TaskRef[];
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

  // Agent SDK safety
  maxTurns: number;           // max SDK turns per task (default 200)
  agentTimeoutMs: number;     // inactivity watchdog — abort if no events for this long (default 120_000)

  // Sprint/Epic scope
  tag?: string;

  // Server discovery
  discovery?: DiscoveryConfig;
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

// ─── Run Result Types ─────────────────────────────────────────────────────

export type TaskRunResult =
  | 'done'
  | 'cancelled'
  | 'timeout'
  | 'error'
  | 'dry_run'
  | 'blocked';

export interface SprintStats {
  done: number;
  cancelled: number;
  retried: number;
  errors: number;
  skipped: number;
  durationMs: number;
}

// ─── WebSocket Event Types ───────────────────────────────────────────────

export type ServerEvent =
  | { type: 'run:started';   payload: { mode: 'sprint' | 'epic'; epicId?: string; projectId?: string } }
  | { type: 'run:stopped' }
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
  | { type: 'scheduler:enqueued';  payload: { requestId: string; projectId: string; mode: 'sprint' | 'epic' } }
  | { type: 'scheduler:slot_started'; payload: { slotId: number; projectId: string; mode: 'sprint' | 'epic' } }
  | { type: 'scheduler:slot_completed'; payload: { slotId: number; projectId: string; stats: SprintStats } }
  | { type: 'scheduler:drained' }
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
}

/**
 * Abstracts spawning Claude Code.
 * Swap for a mock in tests.
 */
export interface ClaudeRunnerPort {
  run(task: Task, config: OrchestratorConfig): Promise<void>;
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
