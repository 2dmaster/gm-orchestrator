import type {
  GraphMemoryPort,
  Task,
  TaskStatus,
  Epic,
  EpicStatus,
  CrossProjectResolver,
} from '../core/types.js';

interface ClientOptions {
  baseUrl: string;
  projectId: string;
  apiKey?: string;
}

export class GraphMemoryClient implements GraphMemoryPort {
  private baseUrl: string;
  private projectId: string;
  private headers: Record<string, string>;

  constructor({ baseUrl, projectId, apiKey }: ClientOptions) {
    this.baseUrl = baseUrl;
    this.projectId = projectId;
    this.headers = {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
  }

  /** Returns true if the client has a projectId configured. */
  get isConfigured(): boolean {
    return this.projectId !== '';
  }

  /** Reconfigure the client with a new baseUrl, projectId, and/or apiKey. */
  reconfigure({ baseUrl, projectId, apiKey }: Partial<ClientOptions>): void {
    if (baseUrl !== undefined) this.baseUrl = baseUrl;
    if (projectId !== undefined) this.projectId = projectId;
    if (apiKey !== undefined) {
      this.headers = {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      };
    }
  }

  private get base(): string {
    return `${this.baseUrl}/api/projects/${this.projectId}`;
  }

  // ── Tasks ─────────────────────────────────────────────────────────────

  async listTasks({
    status,
    tag,
    limit = 100,
  }: { status?: TaskStatus; tag?: string; limit?: number } = {}): Promise<Task[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set('status', status);
    if (tag) params.set('tag', tag);
    const data = await this.get<{ results: Task[] }>(`/tasks?${params}`);
    return data.results ?? [];
  }

  async getTask(taskId: string): Promise<Task> {
    return this.get<Task>(`/tasks/${taskId}`);
  }

  async moveTask(taskId: string, status: TaskStatus): Promise<void> {
    await this.post(`/tasks/${taskId}/move`, { status });
  }

  async updateTask(taskId: string, fields: Partial<Task>): Promise<void> {
    await this.put(`/tasks/${taskId}`, fields);
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const task = await this.getTask(taskId);
    return task.status;
  }

  // ── Epics ─────────────────────────────────────────────────────────────

  async getEpic(epicId: string): Promise<Epic> {
    return this.get<Epic>(`/epics/${epicId}`);
  }

  async listEpicTasks(epicId: string): Promise<Task[]> {
    const data = await this.get<{ results: Task[] }>(`/epics/${epicId}/tasks`);
    return data.results ?? [];
  }

  async listEpics({
    status,
    limit = 50,
  }: { status?: EpicStatus; limit?: number } = {}): Promise<Epic[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set('status', status);
    const data = await this.get<{ results: Epic[] }>(`/epics?${params}`);
    return data.results ?? [];
  }

  async moveEpic(epicId: string, status: EpicStatus): Promise<void> {
    await this.put(`/epics/${epicId}`, { status });
  }

  // ── HTTP ──────────────────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    return this.req<T>('GET', path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.req<T>('POST', path, body);
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    return this.req<T>('PUT', path, body);
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    return this.req<T>('PATCH', path, body);
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : null,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GraphMemory ${method} ${path} → HTTP ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }
}
