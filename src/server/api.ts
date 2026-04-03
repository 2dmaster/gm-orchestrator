import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { OrchestratorConfig, GraphMemoryPort } from '../core/types.js';
import type { Logger } from '../infra/logger.js';
import type { GMServer } from '../infra/gm-discovery.js';
import { probeServer } from '../infra/gm-discovery.js';

// ─── RunnerService interface ────────────────────────────────────────────
// Defined here to avoid circular dep — runner-service.ts will implement it.

export interface RunnerService {
  isRunning: boolean;
  startSprint(projectId: string, tag?: string): Promise<void>;
  startEpic(projectId: string, epicId: string): Promise<void>;
  stop(): Promise<void>;
}

// ─── Dependencies ───────────────────────────────────────────────────────

export interface ApiDeps {
  config: OrchestratorConfig;
  logger: Logger;
  gmDiscovery: { discoverServers(): Promise<GMServer[]> };
  gmClient: GraphMemoryPort & { reconfigure?: (opts: Partial<{ baseUrl: string; projectId: string; apiKey: string }>) => void };
  runner: RunnerService;
  saveConfig: (config: Partial<OrchestratorConfig>) => void;
  version?: string;
}

// ─── Router factory ─────────────────────────────────────────────────────

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();

  // GET /api/status
  router.get('/api/status', (_req: Request, res: Response) => {
    const { apiKey: _redacted, ...redactedConfig } = deps.config;
    res.json({
      version: deps.version ?? '2.0.0',
      config: redactedConfig,
      isRunning: deps.runner.isRunning,
      setupRequired: !deps.config.projectId,
    });
  });

  // GET /api/projects
  router.get('/api/projects', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const servers = await deps.gmDiscovery.discoverServers();
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

  // ── Setup-required guard ────────────────────────────────────────────
  // Routes below this middleware require a configured projectId.
  const requireSetup = (_req: Request, res: Response, next: NextFunction): void => {
    if (!deps.config.projectId) {
      res.status(503).json({ error: 'Setup required: projectId is not configured. Complete the setup wizard first.' });
      return;
    }
    next();
  };

  // GET /api/projects/:id/tasks
  router.get('/api/projects/:id/tasks', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const opts: { status?: string; tag?: string; limit?: number } = {};
      if (req.query['tag']) opts.tag = req.query['tag'] as string;
      if (req.query['status']) opts.status = req.query['status'] as string;
      if (req.query['limit']) opts.limit = Number(req.query['limit']);
      const tasks = await deps.gmClient.listTasks(opts as any);
      res.json({ tasks });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/projects/:id/epics
  router.get('/api/projects/:id/epics', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const opts: { status?: string; limit?: number } = {};
      if (req.query['status']) opts.status = req.query['status'] as string;
      if (req.query['limit']) opts.limit = Number(req.query['limit']);
      const epics = await deps.gmClient.listEpics(opts as any);
      res.json({ epics });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/run/sprint
  router.post('/api/run/sprint', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId, tag } = req.body as { projectId?: string; tag?: string };
      if (!projectId) {
        res.status(400).json({ error: 'projectId is required' });
        return;
      }
      if (deps.runner.isRunning) {
        res.status(409).json({ error: 'A run is already in progress' });
        return;
      }
      // Fire and forget — progress is streamed via WebSocket
      deps.runner.startSprint(projectId, tag).catch((err) => {
        deps.logger.error(`Sprint run failed: ${(err as Error).message}`);
      });
      res.json({ ok: true, mode: 'sprint', projectId, tag });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/run/epic
  router.post('/api/run/epic', requireSetup, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId, epicId } = req.body as { projectId?: string; epicId?: string };
      if (!projectId || !epicId) {
        res.status(400).json({ error: 'projectId and epicId are required' });
        return;
      }
      if (deps.runner.isRunning) {
        res.status(409).json({ error: 'A run is already in progress' });
        return;
      }
      deps.runner.startEpic(projectId, epicId).catch((err) => {
        deps.logger.error(`Epic run failed: ${(err as Error).message}`);
      });
      res.json({ ok: true, mode: 'epic', projectId, epicId });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/run/stop
  router.post('/api/run/stop', requireSetup, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (!deps.runner.isRunning) {
        res.status(409).json({ error: 'No run is in progress' });
        return;
      }
      await deps.runner.stop();
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/config
  router.get('/api/config', (_req: Request, res: Response) => {
    const { apiKey: _redacted, ...redactedConfig } = deps.config;
    res.json(redactedConfig);
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
      if (deps.gmClient.reconfigure && (body.baseUrl || body.projectId || body.apiKey)) {
        deps.gmClient.reconfigure({
          ...(body.baseUrl !== undefined && { baseUrl: body.baseUrl }),
          ...(body.projectId !== undefined && { projectId: body.projectId }),
          ...(body.apiKey !== undefined && { apiKey: body.apiKey }),
        });
      }

      const { apiKey: _redacted, ...redactedConfig } = deps.config;
      res.json(redactedConfig);
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
