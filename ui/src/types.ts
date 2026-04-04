// ─── Frontend types (mirrored from backend core/types.ts) ──────────────

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type EpicStatus = 'open' | 'todo' | 'in_progress' | 'done' | 'cancelled';

export interface TaskRef {
  id: string;
  title: string;
  status: TaskStatus;
  /** Present when the task lives in a different project (cross-project blocker). */
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
  progress?: { done: number; total: number };
  createdAt: string;
  updatedAt: string;
}

export interface SprintStats {
  done: number;
  cancelled: number;
  retried: number;
  errors: number;
  skipped: number;
  durationMs: number;
}

export interface ProjectEntry {
  baseUrl: string;
  projectId: string;
  label?: string; // human-friendly name for UI
}

export interface OrchestratorConfig {
  projects: ProjectEntry[];
  activeProjectId?: string; // last selected, for quick resume
  concurrency: number;      // max parallel claude sessions (default 1)
  timeoutMs: number;
  pauseMs: number;
  maxRetries: number;
  claudeArgs: string[];
  dryRun: boolean;
  maxTurns: number;
  agentTimeoutMs: number;
  tag?: string;
}

export type ServerEvent =
  | { type: 'run:started';    payload: { mode: 'sprint' | 'epic' | 'tasks'; epicId?: string; projectId?: string } }
  | { type: 'run:stopped';    payload?: { projectId?: string } }
  | { type: 'run:complete';   payload: SprintStats & { projectId?: string } }
  | { type: 'task:started';   payload: { task: Task; projectId?: string } }
  | { type: 'task:done';      payload: { task: Task; projectId?: string } }
  | { type: 'task:cancelled'; payload: { task: Task; reason?: string; projectId?: string } }
  | { type: 'task:timeout';   payload: { task: Task; projectId?: string } }
  | { type: 'task:retrying';  payload: { task: Task; attempt: number; projectId?: string } }
  | { type: 'log:line';       payload: { taskId: string; line: string; projectId?: string } }
  | { type: 'agent:tool_start'; payload: { taskId: string; tool: string; input: string; projectId?: string } }
  | { type: 'agent:tool_end';   payload: { taskId: string; tool: string; output: string; projectId?: string } }
  | { type: 'agent:thinking';   payload: { taskId: string; text: string; projectId?: string } }
  | { type: 'agent:turn';       payload: { taskId: string; turn: number; projectId?: string } }
  | { type: 'agent:cost';       payload: { taskId: string; costUsd: number; inputTokens: number; outputTokens: number; projectId?: string } }
  | { type: 'agent:warning';    payload: { taskId: string; message: string; projectId?: string } }
  | { type: 'scheduler:slot_started'; payload: { slotId: number; projectId: string; mode: string } }
  | { type: 'scheduler:slot_completed'; payload: { slotId: number; projectId: string; stats: SprintStats } }
  | { type: 'scheduler:drained' }
  | { type: 'error';          payload: { message: string; projectId?: string } };

export type ServerEventType = ServerEvent['type'];

/** Per-project overview returned by GET /api/projects/overview */
export interface ProjectOverview {
  projectId: string;
  label?: string;
  baseUrl: string;
  taskCounts: { todo: number; in_progress: number; done: number; total: number };
  epicCount: number;
  error?: string; // set if the project's GM server was unreachable
}

export interface RunSnapshot {
  projectId: string | null;
  activeTask: Task | null;
  completedTasks: Task[];
  recentLines: string[];
}

export interface StatusResponse {
  version: string;
  config: OrchestratorConfig;
  isRunning: boolean;
  runningProjectIds: string[];
  setupRequired: boolean;
  run?: RunSnapshot;
}

/** Task enriched with its source project ID, used in cross-project epic views. */
export interface CrossProjectTask extends Task {
  sourceProjectId: string;
}

/** Grouped tasks for a cross-project epic, keyed by project. */
export interface CrossProjectEpicGroup {
  projectId: string;
  tasks: CrossProjectTask[];
}

/** Response from GET /api/projects/:id/epics/:epicId/cross-project-tasks */
export interface CrossProjectEpicResponse {
  epic: Epic;
  grouped: CrossProjectEpicGroup[];
  tasks: CrossProjectTask[];
}
