import type {
  GraphMemoryPort,
  HookRunnerPort,
  PostTaskHook,
  HookExecResult,
  Task,
  TaskStatus,
  TaskLinkKind,
  Epic,
  EpicStatus,
  CrossProjectResolver,
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
    linkTask: Array<{ fromId: string; toId: string; kind: TaskLinkKind; targetProjectId?: string }>;
  } = {
    moveTask: [],
    moveEpic: [],
    updateTask: [],
    linkTask: [],
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

  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task.status;
  }

  async linkTask(opts: {
    fromId: string;
    toId: string;
    kind: TaskLinkKind;
    targetProjectId?: string;
  }): Promise<void> {
    this.calls.linkTask.push(opts);

    // Simulate link creation: add to blockedBy/blocks/related on the source task
    const fromTask = this.tasks.get(opts.fromId);
    if (!fromTask) throw new Error(`Task not found: ${opts.fromId}`);

    const ref = {
      id: opts.toId,
      title: opts.toId,
      status: 'todo' as TaskStatus,
      ...(opts.targetProjectId ? { projectId: opts.targetProjectId } : {}),
    };

    if (opts.kind === 'blocks') {
      // fromTask blocks toId → add toId to fromTask.blocks
      const blocks = fromTask.blocks ?? [];
      this.tasks.set(opts.fromId, { ...fromTask, blocks: [...blocks, ref] });
    } else if (opts.kind === 'related_to') {
      const related = fromTask.related ?? [];
      this.tasks.set(opts.fromId, { ...fromTask, related: [...related, ref] });
    } else if (opts.kind === 'prefers_after') {
      // toId prefers to run after fromId → add fromId as soft prereq on toId
      const toTask = this.tasks.get(opts.toId);
      if (toTask) {
        const prefersAfter = toTask.prefersAfter ?? [];
        const fromRef = { id: opts.fromId, title: opts.fromId, status: fromTask.status };
        this.tasks.set(opts.toId, { ...toTask, prefersAfter: [...prefersAfter, fromRef] });
      }
    }
    // subtask_of: structural, less common to track on from side
  }
}

/**
 * Fake cross-project resolver backed by a map of project → FakeGraphMemory.
 * Useful for testing cross-project blocker resolution without real HTTP calls.
 */
export class FakeCrossProjectResolver {
  private projects = new Map<string, FakeGraphMemory>();

  addProject(projectId: string, gm: FakeGraphMemory): this {
    this.projects.set(projectId, gm);
    return this;
  }

  get resolver(): CrossProjectResolver {
    return async (projectId: string, taskId: string) => {
      const gm = this.projects.get(projectId);
      if (!gm) return undefined;
      try {
        return await gm.getTaskStatus(taskId);
      } catch {
        return undefined;
      }
    };
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
  calls: Array<{ taskId: string; runId?: string }> = [];

  async run(task: { id: string }, _config: unknown, runId?: string): Promise<void> {
    this.calls.push({ taskId: task.id, runId });
  }
}

/**
 * Fake hook runner — returns preset results for post-task verification hooks.
 * Defaults to success for all hooks unless configured otherwise.
 */
export class FakeHookRunner implements HookRunnerPort {
  /** Preset results by hook name. Missing names default to success. */
  private results = new Map<string, HookExecResult>();
  /** Record of all hook executions for assertions. */
  calls: PostTaskHook[] = [];

  /** Configure a specific hook name to return a given result. */
  setResult(hookName: string, result: HookExecResult): this {
    this.results.set(hookName, result);
    return this;
  }

  /** Convenience: configure a hook name to fail. */
  setFailure(hookName: string, exitCode = 1, stderr = 'hook failed'): this {
    this.results.set(hookName, { success: false, exitCode, stdout: '', stderr });
    return this;
  }

  async exec(hook: PostTaskHook): Promise<HookExecResult> {
    this.calls.push(hook);
    return this.results.get(hook.name) ?? { success: true, exitCode: 0, stdout: '', stderr: '' };
  }
}
