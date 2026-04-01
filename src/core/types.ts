// ─── GraphMemory Domain Types ─────────────────────────────────────────────
// Mirrors the GraphMemory REST API response shapes.
// All orchestrator logic is typed against these.

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type EpicStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

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

// ─── Orchestrator Config ──────────────────────────────────────────────────

export interface OrchestratorConfig {
  // GraphMemory connection
  baseUrl: string;
  projectId: string;
  apiKey?: string;

  // Execution
  timeoutMs: number;   // per-task timeout
  pauseMs: number;     // delay between tasks
  maxRetries: number;

  // Claude Code
  claudeArgs: string[];
  dryRun: boolean;

  // Sprint/Epic scope
  tag?: string;
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
    opts: { timeoutMs: number }
  ): Promise<'done' | 'cancelled' | 'timeout'>;
}
