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

export interface OrchestratorConfig {
  // Multi-project support
  projects: ProjectEntry[];
  activeProjectId?: string; // last selected, for quick resume

  // Execution
  concurrency: number;     // max parallel claude sessions (default 1)
  timeoutMs: number;       // per-task timeout
  pauseMs: number;         // delay between tasks
  maxRetries: number;

  // Claude Code
  claudeArgs: string[];
  dryRun: boolean;

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
  | { type: 'run:started';   payload: { mode: 'sprint' | 'epic'; epicId?: string } }
  | { type: 'run:stopped' }
  | { type: 'run:complete';  payload: SprintStats }
  | { type: 'task:started';  payload: { task: Task } }
  | { type: 'task:done';     payload: { task: Task } }
  | { type: 'task:cancelled'; payload: { task: Task; reason?: string } }
  | { type: 'task:timeout';  payload: { task: Task } }
  | { type: 'task:retrying'; payload: { task: Task; attempt: number } }
  | { type: 'log:line';      payload: { taskId: string; line: string } }
  | { type: 'error';         payload: { message: string } };

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
