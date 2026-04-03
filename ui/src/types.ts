// ─── Frontend types (mirrored from backend core/types.ts) ──────────────

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
  tag?: string;
}

export type ServerEvent =
  | { type: 'run:started';    payload: { mode: 'sprint' | 'epic'; epicId?: string } }
  | { type: 'run:stopped' }
  | { type: 'run:complete';   payload: SprintStats }
  | { type: 'task:started';   payload: { task: Task } }
  | { type: 'task:done';      payload: { task: Task } }
  | { type: 'task:cancelled'; payload: { task: Task; reason?: string } }
  | { type: 'task:timeout';   payload: { task: Task } }
  | { type: 'task:retrying';  payload: { task: Task; attempt: number } }
  | { type: 'log:line';       payload: { taskId: string; line: string } }
  | { type: 'error';          payload: { message: string } };

export type ServerEventType = ServerEvent['type'];

export interface RunSnapshot {
  activeTask: Task | null;
  completedTasks: Task[];
  recentLines: string[];
}

export interface StatusResponse {
  version: string;
  config: OrchestratorConfig;
  isRunning: boolean;
  setupRequired: boolean;
  run?: RunSnapshot;
}
