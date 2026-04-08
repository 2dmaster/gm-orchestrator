import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { OrchestratorConfig, DiscoveryConfig, GraphMemoryPort, Task, CrossProjectTask, PipelineRun } from '../core/types.js';
import { getActiveProject } from '../core/types.js';
import { collectCrossProjectEpicTasks } from '../core/orchestrator.js';
import type { RunSnapshot, MultiRunSnapshot } from './runner-service.js';
import type { Logger } from '../infra/logger.js';
import type { GMServer } from '../infra/gm-discovery.js';
import { probeServer } from '../infra/gm-discovery.js';
import type { GraphMemoryClientPool } from '../infra/gm-client-pool.js';

// ─── RunnerService interface ────────────────────────────────────────────
// Defined here to avoid circular dep — runner-service.ts will implement it.

export interface RunnerService {
  isRunning: boolean;
  isPaused: boolean;
  getRunningProjectIds(): string[];
  isProjectRunning(projectId: string): boolean;
  getRunSnapshot(): RunSnapshot;
  getMultiRunSnapshot(): MultiRunSnapshot;
  startSprint(projectId: string, tag?: string, model?: string): Promise<void>;
  startEpic(projectId: string, epicId: string, model?: string): Promise<void>;
  startTasks(projectId: string, taskIds: string[], model?: string): Promise<void>;
  startMultiSprint(projectIds: string[], tag?: string, priority?: string): Promise<string[]>;
  cancelQueued(requestId: string): boolean;
  stopProject(projectId: string): Promise<void>;
  stop(): Promise<void>;
  pause(): void;
  resume(): void;
  pauseProject(projectId: string): void;
  resumeProject(projectId: string): void;
  isProjectPaused(projectId: string): boolean;
  restart(): Promise<void>;
  hasLastRun(): boolean;
  getLastRun(): import('../core/types.js').LastRunState | undefined;
  // Pipeline
  startPipeline(pipelineId: string): PipelineRun;
  getPipelineRun(pipelineRunId: string): PipelineRun | undefined;
  getActivePipelineRuns(): PipelineRun[];
  stopPipelineRun(pipelineRunId: string): Promise<void>;
  pausePipelineRun(pipelineRunId: string): void;
  resumePipelineRun(pipelineRunId: string): void;
}

// ─── Dependencies ───────────────────────────────────────────────────────

/** Pool-like interface for resolving per-project GM clients. */
export interface GMClientPool {
  getClient(projectId: string): GraphMemoryPort;
  has(projectId: string): boolean;
  rebuild(projects: import('../core/types.js').ProjectEntry[]): void;
}

export interface ApiDeps {
  config: OrchestratorConfig;
  logger: Logger;
  gmDiscovery: { discoverServers(config?: DiscoveryConfig): Promise<GMServer[]> };
  gmClient: GraphMemoryPort & { reconfigure?: (opts: Partial<{ baseUrl: string; projectId: string; apiKey: string }>) => void };
  gmPool?: GMClientPool;
  runner: RunnerService;
  saveConfig: (config: Partial<OrchestratorConfig>) => void;
  version?: string;
}

// ─── Router factory ─────────────────────────────────────────────────────

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();

  /**
   * Resolve the GM client for a given projectId.
   * Uses the pool if available, otherwise falls back to the single gmClient.
   */
  function resolveClient(projectId: string): GraphMemoryPort {
    if (deps.gmPool && deps.gmPool.has(projectId)) {
      return deps.gmPool.getClient(projectId);
    }
    return deps.gmClient;
  }

  // GET /api/status
  router.get('/api/status', (_req: Request, res: Response) => {
    const active = getActiveProject(deps.config);
    const redactedProjects = deps.config.projects.map(({ apiKey: _k, ...rest }) => rest);
    const redactedConfig = { ...deps.config, projects: redactedProjects };
    const snapshot = deps.runner.isRunning ? deps.runner.getRunSnapshot() : null;
    res.json({
      version: deps.version ?? '2.0.0',
      config: redactedConfig,
      isRunning: deps.runner.isRunning,
      isPaused: deps.runner.isPaused,
      runningProjectIds: deps.runner.getRunningProjectIds(),
      setupRequired: !active?.projectId,
      lastRun: deps.runner.getLastRun() ?? null,
      ...(snapshot ? { run: snapshot } : {}),
    });
  });

  // GET /api/projects
  router.get('/api/projects', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const servers = await deps.gmDiscovery.discoverServers(deps.config.discovery);
      res.json({ servers });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/projects/probe — probe a specific URL for a GraphMemory server
  router.post('/api/projects/probe', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { url } = req.body as { url?: string };
      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'url is required' });
        return;
      }
      try {
        new URL(url);
      } catch {
        res.status(400).json({ error: 'Invalid URL' });
        return;
      }
      const server = await probeServer(url);
      if (server) {
        res.json({ server });
      } else {
        res.status(404).json({ error: 'No GraphMemory server found at this URL' });
      }
    } catch (err) {
      next(err);
    }
  });

  // GET /api/projects/overview — multi-project overview with task counts
  router.get('/api/projects/overview', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const projects = deps.config.projects;
      if (projects.length === 0) {
        res.json({ projects: [] });
        return;
      }

      // Fetch task counts + epic counts from each configured project in parallel
      const overviews = await Promise.all(
        projects.map(async (proj) => {
          const base = `${proj.baseUrl}/api/projects/${proj.projectId}`;
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (proj.apiKey) headers['Authorization'] = `Bearer ${proj.apiKey}`;

          try {
            const [tasksRes, epicsRes] = await Promise.all([
              fetch(`${base}/tasks?limit=500`, { headers }),
              fetch(`${base}/epics?limit=500`, { headers }),
            ]);

            let taskCounts = { todo: 0, in_progress: 0, done: 0, total: 0 };
            if (tasksRes.ok) {
              const data = (await tasksRes.json()) as { results?: Task[] };
              const tasks = data.results ?? [];
              taskCounts = {
                todo: tasks.filter((t: Task) => t.status === 'todo').length,
                in_progress: tasks.filter((t: Task) => t.status === 'in_progress').length,
                done: tasks.filter((t: Task) => t.status === 'done').length,
                total: tasks.length,
              };
            }

            let epicCount = 0;
            if (epicsRes.ok) {
              const data = (await epicsRes.json()) as { results?: unknown[] };
              epicCount = (data.results ?? []).length;
            }

            return {
              projectId: proj.projectId,
              label: proj.label,
              baseUrl: proj.baseUrl,
              taskCounts,
              epicCount,
            };
          } catch (err) {
            return {
              projectId: proj.projectId,
              label: proj.label,
              baseUrl: proj.baseUrl,
              taskCounts: { todo: 0, in_progress: 0, done: 0, total: 0 },
              epicCount: 0,
              error: (err as Error).message,
            };
          }
        })
      );

      res.json({ projects: overviews });
    } catch (err) {
      next(err);
    }
  });

  // ── Setup-required guard ────────────────────────────────────────────
  // Routes below this middleware require a configured projectId.
  const requireSetup = (_req: Request, res: Response, next: NextFunction): void => {
    const active = getActiveProject(deps.config);
    if (!active?.projectId) {
      res.status(503).json({ error: 'Setup required: projectId is not configured. Complete the setup wizard first.' });
      return;
    }
    next();
  };

  // GET /api/projects/:id/tasks
  router.get('/api/projects/:id/tasks', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = Array.isArray(req.params['id']) ? req.params['id'][0]! : req.params['id']!;
      const client = resolveClient(projectId);
      const opts: { status?: string; tag?: string; limit?: number } = {};
      if (req.query['tag']) opts.tag = req.query['tag'] as string;
      if (req.query['status']) opts.status = req.query['status'] as string;
      if (req.query['limit']) opts.limit = Number(req.query['limit']);
      const tasks = await client.listTasks(opts as Parameters<GraphMemoryPort['listTasks']>[0]);
      res.json({ tasks });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/projects/:id/epics
  router.get('/api/projects/:id/epics', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = Array.isArray(req.params['id']) ? req.params['id'][0]! : req.params['id']!;
      const client = resolveClient(projectId);
      const opts: { status?: string; limit?: number } = {};
      if (req.query['status']) opts.status = req.query['status'] as string;
      if (req.query['limit']) opts.limit = Number(req.query['limit']);
      const epics = await client.listEpics(opts as Parameters<GraphMemoryPort['listEpics']>[0]);
      res.json({ epics });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/projects/:id/epics/:epicId/tasks
  router.get('/api/projects/:id/epics/:epicId/tasks', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = Array.isArray(req.params['id']) ? req.params['id'][0]! : req.params['id']!;
      const client = resolveClient(projectId);
      const epicId = Array.isArray(req.params['epicId']) ? req.params['epicId'][0]! : req.params['epicId']!;
      const tasks = await client.listEpicTasks(epicId);
      res.json({ tasks });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/projects/:id/epics/:epicId/cross-project-tasks
  // Returns all tasks in an epic, including tasks from other projects, grouped by project
  router.get('/api/projects/:id/epics/:epicId/cross-project-tasks', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = Array.isArray(req.params['id']) ? req.params['id'][0]! : req.params['id']!;
      const epicId = Array.isArray(req.params['epicId']) ? req.params['epicId'][0]! : req.params['epicId']!;
      const client = resolveClient(projectId);

      const resolveGm = (pid: string): GraphMemoryPort => resolveClient(pid);

      const { epic, tasks } = await collectCrossProjectEpicTasks(
        epicId,
        { gm: client, logger: deps.logger },
        resolveGm,
        projectId,
      );

      // Group tasks by project for the UI
      const byProject = new Map<string, CrossProjectTask[]>();
      for (const t of tasks) {
        const group = byProject.get(t.sourceProjectId) ?? [];
        group.push(t);
        byProject.set(t.sourceProjectId, group);
      }

      const grouped = [...byProject.entries()].map(([pid, projectTasks]) => ({
        projectId: pid,
        tasks: projectTasks,
      }));

      res.json({ epic, grouped, tasks });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/run/sprint
  router.post('/api/run/sprint', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId, tag, model } = req.body as { projectId?: string; tag?: string; model?: string };
      if (!projectId) {
        res.status(400).json({ error: 'projectId is required' });
        return;
      }
      if (deps.runner.isProjectRunning(projectId)) {
        res.status(409).json({ error: `A run is already in progress for project "${projectId}"` });
        return;
      }
      deps.runner.startSprint(projectId, tag, model).catch((err) => {
        deps.logger.error(`Sprint run failed: ${(err as Error).message}`);
      });
      res.json({ ok: true, mode: 'sprint', projectId, tag, model });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/run/multi-sprint — run sprints on multiple projects with scheduler
  router.post('/api/run/multi-sprint', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectIds, tag, priority } = req.body as {
        projectIds?: string[];
        tag?: string;
        priority?: string;
      };
      if (!projectIds || !Array.isArray(projectIds) || projectIds.length === 0) {
        res.status(400).json({ error: 'projectIds[] is required and must be a non-empty array' });
        return;
      }
      // Validate all project IDs are strings
      if (!projectIds.every((id) => typeof id === 'string' && id.length > 0)) {
        res.status(400).json({ error: 'All projectIds must be non-empty strings' });
        return;
      }

      const requestIds = await deps.runner.startMultiSprint(projectIds, tag, priority);
      res.json({ ok: true, mode: 'multi-sprint', projectIds, requestIds, tag });
    } catch (err) {
      if ((err as Error).message.includes('already in progress')) {
        res.status(409).json({ error: (err as Error).message });
        return;
      }
      next(err);
    }
  });

  // DELETE /api/run/queue/:requestId — cancel a queued request
  router.delete('/api/run/queue/:requestId', requireSetup, (req: Request, res: Response) => {
    const requestId = Array.isArray(req.params['requestId'])
      ? req.params['requestId'][0]!
      : req.params['requestId']!;
    const removed = deps.runner.cancelQueued(requestId);
    if (removed) {
      res.json({ ok: true, requestId });
    } else {
      res.status(404).json({ error: 'Request not found in queue (may already be running)' });
    }
  });

  // GET /api/run/status — get scheduler status (multi-run snapshot)
  router.get('/api/run/status', requireSetup, (_req: Request, res: Response) => {
    const snapshot = deps.runner.getMultiRunSnapshot();
    res.json({
      isRunning: deps.runner.isRunning,
      runningProjectIds: deps.runner.getRunningProjectIds(),
      scheduler: snapshot,
    });
  });

  // POST /api/run/epic
  router.post('/api/run/epic', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId, epicId, model } = req.body as { projectId?: string; epicId?: string; model?: string };
      if (!projectId || !epicId) {
        res.status(400).json({ error: 'projectId and epicId are required' });
        return;
      }
      if (deps.runner.isProjectRunning(projectId)) {
        res.status(409).json({ error: `A run is already in progress for project "${projectId}"` });
        return;
      }
      deps.runner.startEpic(projectId, epicId, model).catch((err) => {
        deps.logger.error(`Epic run failed: ${(err as Error).message}`);
      });
      res.json({ ok: true, mode: 'epic', projectId, epicId, model });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/projects/:projectId/run-tasks — start a run for specific task IDs
  router.post('/api/projects/:projectId/run-tasks', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = Array.isArray(req.params['projectId']) ? req.params['projectId'][0]! : req.params['projectId']!;
      const { taskIds, model } = req.body as { taskIds?: string[]; model?: string };
      if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
        res.status(400).json({ error: 'taskIds[] is required and must be a non-empty array' });
        return;
      }
      if (!taskIds.every((id) => typeof id === 'string' && id.length > 0)) {
        res.status(400).json({ error: 'All taskIds must be non-empty strings' });
        return;
      }
      if (deps.runner.isProjectRunning(projectId)) {
        res.status(409).json({ error: `A run is already in progress for project "${projectId}"` });
        return;
      }
      deps.runner.startTasks(projectId, taskIds, model).catch((err) => {
        deps.logger.error(`Task run failed: ${(err as Error).message}`);
      });
      res.json({ ok: true, mode: 'tasks', projectId, taskIds, model });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/run/stop
  router.post('/api/run/stop', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.body as { projectId?: string };
      if (projectId) {
        if (!deps.runner.isProjectRunning(projectId)) {
          res.status(409).json({ error: `No run is in progress for project "${projectId}"` });
          return;
        }
        await deps.runner.stopProject(projectId);
      } else {
        if (!deps.runner.isRunning) {
          res.status(409).json({ error: 'No run is in progress' });
          return;
        }
        await deps.runner.stop();
      }
      res.json({ ok: true, projectId: projectId ?? null });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/run/pause
  router.post('/api/run/pause', requireSetup, (_req: Request, res: Response) => {
    if (!deps.runner.isRunning) {
      res.status(409).json({ error: 'No run is in progress' });
      return;
    }
    if (deps.runner.isPaused) {
      res.status(409).json({ error: 'Already paused' });
      return;
    }
    deps.runner.pause();
    res.json({ ok: true });
  });

  // POST /api/run/resume
  router.post('/api/run/resume', requireSetup, (_req: Request, res: Response) => {
    if (!deps.runner.isPaused) {
      res.status(409).json({ error: 'Not paused' });
      return;
    }
    deps.runner.resume();
    res.json({ ok: true });
  });

  // POST /api/run/pause-project
  router.post('/api/run/pause-project', requireSetup, (req: Request, res: Response) => {
    const { projectId } = req.body as { projectId?: string };
    if (!projectId || typeof projectId !== 'string') {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }
    if (deps.runner.isProjectPaused(projectId)) {
      res.status(409).json({ error: `Project "${projectId}" is already paused` });
      return;
    }
    deps.runner.pauseProject(projectId);
    res.json({ ok: true, projectId });
  });

  // POST /api/run/resume-project
  router.post('/api/run/resume-project', requireSetup, (req: Request, res: Response) => {
    const { projectId } = req.body as { projectId?: string };
    if (!projectId || typeof projectId !== 'string') {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }
    if (!deps.runner.isProjectPaused(projectId)) {
      res.status(409).json({ error: `Project "${projectId}" is not paused` });
      return;
    }
    deps.runner.resumeProject(projectId);
    res.json({ ok: true, projectId });
  });

  // POST /api/run/restart — restart the last stopped/completed run
  router.post('/api/run/restart', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deps.runner.restart();
      res.json({ ok: true });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Nothing to restart') || msg.includes('already in progress')) {
        res.status(409).json({ error: msg });
        return;
      }
      next(err);
    }
  });

  // ── Pipeline endpoints ──────────────────────────────────────────────

  // GET /api/pipelines — list configured pipelines
  router.get('/api/pipelines', requireSetup, (_req: Request, res: Response) => {
    const pipelines = deps.config.pipelines ?? [];
    res.json({ pipelines });
  });

  // POST /api/pipelines/run — start a pipeline run
  router.post('/api/pipelines/run', requireSetup, (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pipelineId } = req.body as { pipelineId?: string };
      if (!pipelineId || typeof pipelineId !== 'string') {
        res.status(400).json({ error: 'pipelineId is required' });
        return;
      }
      const pipeline = (deps.config.pipelines ?? []).find((p) => p.id === pipelineId);
      if (!pipeline) {
        res.status(404).json({ error: `Pipeline "${pipelineId}" not found` });
        return;
      }
      const run = deps.runner.startPipeline(pipelineId);
      res.json({ ok: true, pipelineRunId: run.id, pipelineId, stages: run.stages.length });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/pipelines/run/status — get pipeline run status
  router.get('/api/pipelines/run/status', requireSetup, (req: Request, res: Response) => {
    const pipelineRunId = req.query['pipelineRunId'] as string | undefined;
    if (pipelineRunId) {
      const run = deps.runner.getPipelineRun(pipelineRunId);
      if (!run) {
        res.status(404).json({ error: `Pipeline run "${pipelineRunId}" not found` });
        return;
      }
      res.json({ run });
      return;
    }
    // Return all active pipeline runs
    const runs = deps.runner.getActivePipelineRuns();
    res.json({ runs });
  });

  // POST /api/pipelines/run/stop — stop a pipeline run
  router.post('/api/pipelines/run/stop', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pipelineRunId } = req.body as { pipelineRunId?: string };
      if (!pipelineRunId || typeof pipelineRunId !== 'string') {
        res.status(400).json({ error: 'pipelineRunId is required' });
        return;
      }
      const run = deps.runner.getPipelineRun(pipelineRunId);
      if (!run) {
        res.status(404).json({ error: `Pipeline run "${pipelineRunId}" not found` });
        return;
      }
      if (run.status !== 'running') {
        res.status(409).json({ error: `Pipeline run is not running (status: ${run.status})` });
        return;
      }
      await deps.runner.stopPipelineRun(pipelineRunId);
      res.json({ ok: true, pipelineRunId });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/pipelines/run/pause — pause a pipeline run
  router.post('/api/pipelines/run/pause', requireSetup, (req: Request, res: Response) => {
    const { pipelineRunId } = req.body as { pipelineRunId?: string };
    if (!pipelineRunId || typeof pipelineRunId !== 'string') {
      res.status(400).json({ error: 'pipelineRunId is required' });
      return;
    }
    const run = deps.runner.getPipelineRun(pipelineRunId);
    if (!run) {
      res.status(404).json({ error: `Pipeline run "${pipelineRunId}" not found` });
      return;
    }
    if (run.status !== 'running') {
      res.status(409).json({ error: `Pipeline run is not running (status: ${run.status})` });
      return;
    }
    deps.runner.pausePipelineRun(pipelineRunId);
    res.json({ ok: true, pipelineRunId });
  });

  // POST /api/pipelines/run/resume — resume a paused pipeline run
  router.post('/api/pipelines/run/resume', requireSetup, (req: Request, res: Response) => {
    const { pipelineRunId } = req.body as { pipelineRunId?: string };
    if (!pipelineRunId || typeof pipelineRunId !== 'string') {
      res.status(400).json({ error: 'pipelineRunId is required' });
      return;
    }
    const run = deps.runner.getPipelineRun(pipelineRunId);
    if (!run) {
      res.status(404).json({ error: `Pipeline run "${pipelineRunId}" not found` });
      return;
    }
    if (run.status !== 'running') {
      res.status(409).json({ error: `Pipeline run is not running (status: ${run.status})` });
      return;
    }
    deps.runner.resumePipelineRun(pipelineRunId);
    res.json({ ok: true, pipelineRunId });
  });

  // GET /api/config
  router.get('/api/config', (_req: Request, res: Response) => {
    const redactedProjects = deps.config.projects.map(({ apiKey: _k, ...rest }) => rest);
    res.json({ ...deps.config, projects: redactedProjects });
  });

  // PUT /api/config
  router.put('/api/config', (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Partial<OrchestratorConfig>;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Request body must be a JSON object' });
        return;
      }
      // Merge into current config
      Object.assign(deps.config, body);
      deps.saveConfig(deps.config);

      // Reconfigure the GM client if connection params changed
      const active = getActiveProject(deps.config);
      if (deps.gmClient.reconfigure && (body.projects || body.activeProjectId)) {
        if (active) {
          deps.gmClient.reconfigure({
            baseUrl: active.baseUrl,
            projectId: active.projectId,
            ...(active.apiKey !== undefined && { apiKey: active.apiKey }),
          });
        }
      }

      // Rebuild the pool if projects changed
      if (deps.gmPool && body.projects) {
        deps.gmPool.rebuild(deps.config.projects);
      }

      const redactedProjects = deps.config.projects.map(({ apiKey: _k, ...rest }) => rest);
      res.json({ ...deps.config, projects: redactedProjects });
    } catch (err) {
      next(err);
    }
  });

  // ── Error handling middleware ────────────────────────────────────────
  router.use('/api', (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    deps.logger.error(`API error: ${err.message}`);
    res.status(500).json({ error: err.message });
  });

  return router;
}
