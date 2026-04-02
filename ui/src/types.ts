// ─── Frontend types (mirrored from backend core/types.ts) ──────────────

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

export interface OrchestratorConfig {
  baseUrl: string;
  projectId: string;
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

export interface StatusResponse {
  version: string;
  config: Omit<OrchestratorConfig, 'apiKey'>;
  isRunning: boolean;
}
