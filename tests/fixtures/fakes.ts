import type {
  GraphMemoryPort,
  Task,
  TaskStatus,
  Epic,
  EpicStatus,
} from '../../src/core/types.js';

/**
 * In-memory fake that implements GraphMemoryPort.
 * Tests manipulate `.tasks` and `.epics` directly to set up state,
 * and read `.calls` to assert what the orchestrator did.
 */
export class FakeGraphMemory implements GraphMemoryPort {
  tasks: Map<string, Task> = new Map();
  epics: Map<string, Epic> = new Map();

  calls: {
    moveTask: Array<{ taskId: string; status: TaskStatus }>;
    moveEpic: Array<{ epicId: string; status: EpicStatus }>;
    updateTask: Array<{ taskId: string; fields: Partial<Task> }>;
  } = {
    moveTask: [],
    moveEpic: [],
    updateTask: [],
  };

  addTask(task: Task): this {
    this.tasks.set(task.id, task);
    return this;
  }

  addEpic(epic: Epic): this {
    this.epics.set(epic.id, epic);
    return this;
  }

  async listTasks({
    status,
    tag,
    limit = 100,
  }: { status?: TaskStatus; tag?: string; limit?: number } = {}): Promise<Task[]> {
    return [...this.tasks.values()]
      .filter((t) => (!status || t.status === status) && (!tag || t.tags?.includes(tag)))
      .slice(0, limit);
  }

  async getTask(taskId: string): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  async moveTask(taskId: string, status: TaskStatus): Promise<void> {
    this.calls.moveTask.push({ taskId, status });
    const task = this.tasks.get(taskId);
    if (task) this.tasks.set(taskId, { ...task, status });
  }

  async updateTask(taskId: string, fields: Partial<Task>): Promise<void> {
    this.calls.updateTask.push({ taskId, fields });
    const task = this.tasks.get(taskId);
    if (task) this.tasks.set(taskId, { ...task, ...fields });
  }

  async getEpic(epicId: string): Promise<Epic> {
    const epic = this.epics.get(epicId);
    if (!epic) throw new Error(`Epic not found: ${epicId}`);
    return epic;
  }

  async listEpicTasks(epicId: string): Promise<Task[]> {
    const epic = this.epics.get(epicId);
    if (!epic) throw new Error(`Epic not found: ${epicId}`);
    const taskIds = new Set((epic.tasks ?? []).map((t) => t.id));
    return [...this.tasks.values()].filter((t) => taskIds.has(t.id));
  }

  async listEpics({
    status,
  }: { status?: EpicStatus; limit?: number } = {}): Promise<Epic[]> {
    return [...this.epics.values()].filter(
      (e) => !status || e.status === status
    );
  }

  async moveEpic(epicId: string, status: EpicStatus): Promise<void> {
    this.calls.moveEpic.push({ epicId, status });
    const epic = this.epics.get(epicId);
    if (epic) this.epics.set(epicId, { ...epic, status });
  }
}

/**
 * Fake poller that resolves instantly with a preset result.
 * IMPORTANT: also syncs the task status in the provided FakeGraphMemory,
 * so the orchestrator's "list todo tasks" loop terminates correctly.
 */
export class FakePoller {
  private results: Map<string, 'done' | 'cancelled' | 'timeout'> = new Map();
  calls: string[] = [];

  constructor(private readonly gm: FakeGraphMemory) {}

  setResult(taskId: string, result: 'done' | 'cancelled' | 'timeout'): this {
    this.results.set(taskId, result);
    return this;
  }

  async waitForCompletion(
    taskId: string,
    _opts: { timeoutMs: number }
  ): Promise<'done' | 'cancelled' | 'timeout'> {
    this.calls.push(taskId);
    const result = this.results.get(taskId) ?? 'done';

    // Sync GM state so the orchestrator's next listTasks() sees the right status.
    // In production, Claude calls tasks_move() which does this; here we simulate it.
    if (result === 'done' || result === 'cancelled') {
      const task = this.gm.tasks.get(taskId);
      if (task) this.gm.tasks.set(taskId, { ...task, status: result });
    }

    return result;
  }
}

/**
 * Fake runner — records what it was asked to run.
 */
export class FakeRunner {
  calls: Array<{ taskId: string }> = [];

  async run(task: { id: string }): Promise<void> {
    this.calls.push({ taskId: task.id });
  }
}
