import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createApiRouter, type ApiDeps, type RunnerService } from '../../src/server/api.js';
import { silentLogger } from '../../src/infra/logger.js';
import { FakeGraphMemory } from '../fixtures/fakes.js';
import { makeTask, makeEpic } from '../fixtures/factories.js';
import type { OrchestratorConfig } from '../../src/core/types.js';

function makeConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    projects: [{ baseUrl: 'http://localhost:3000', projectId: 'test-project', apiKey: 'secret-key' }],
    activeProjectId: 'test-project',
    concurrency: 1,
    timeoutMs: 60_000,
    pauseMs: 1_000,
    maxRetries: 1,
    claudeArgs: [],
    dryRun: false,
    ...overrides,
  };
}

function makeRunner(overrides: Partial<RunnerService> = {}): RunnerService {
  return {
    isRunning: false,
    getRunSnapshot: () => ({ activeTask: null, completedTasks: [], recentLines: [] }),
    startSprint: async () => {},
    startEpic: async () => {},
    stop: async () => {},
    ...overrides,
  };
}

function createTestApp(depsOverrides: Partial<ApiDeps> = {}) {
  const gm = new FakeGraphMemory();
  const config = makeConfig();
  const runner = makeRunner();
  const savedConfigs: Partial<OrchestratorConfig>[] = [];

  const deps: ApiDeps = {
    config,
    logger: silentLogger,
    gmDiscovery: { discoverServers: async () => [] },
    gmClient: gm,
    runner,
    saveConfig: (c) => savedConfigs.push(c),
    version: '2.0.0',
    ...depsOverrides,
  };

  const app = express();
  app.use(express.json());
  app.use(createApiRouter(deps));

  return { app, gm, config, runner, deps, savedConfigs };
}

describe('API routes', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let testApp: ReturnType<typeof createTestApp>;

  function startApp(depsOverrides: Partial<ApiDeps> = {}): Promise<void> {
    testApp = createTestApp(depsOverrides);
    return new Promise((resolve) => {
      server = testApp.app.listen(0, () => {
        const addr = server!.address() as import('net').AddressInfo;
        baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  }

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((err) => (err ? reject(err) : resolve()))
      );
      server = undefined;
    }
  });

  // ── GET /api/status ─────────────────────────────────────────────────

  describe('GET /api/status', () => {
    it('returns version, redacted config, and isRunning', async () => {
      await startApp();
      const res = await fetch(`${baseUrl}/api/status`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.version).toBe('2.0.0');
      expect(body.isRunning).toBe(false);
      expect(body.config).toBeDefined();
      // apiKey should be redacted from project entries
      for (const p of body.config.projects) {
        expect(p.apiKey).toBeUndefined();
      }
      expect(body.setupRequired).toBe(false);
    });

    it('returns setupRequired=true when projectId is empty', async () => {
      await startApp({ config: makeConfig({ projects: [], activeProjectId: undefined }) });
      const res = await fetch(`${baseUrl}/api/status`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.setupRequired).toBe(true);
    });
  });

  // ── GET /api/projects ───────────────────────────────────────────────

  describe('GET /api/projects', () => {
    it('returns discovered servers', async () => {
      const mockServers = [{ url: 'http://localhost:3000', port: 3000, projects: [] }];
      await startApp({
        gmDiscovery: { discoverServers: async () => mockServers },
      });
      const res = await fetch(`${baseUrl}/api/projects`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.servers).toEqual(mockServers);
    });
  });

  // ── GET /api/projects/overview ───────────────────────────────────────

  describe('GET /api/projects/overview', () => {
    it('returns empty array when no projects configured', async () => {
      await startApp({ config: makeConfig({ projects: [], activeProjectId: undefined }) });
      const res = await fetch(`${baseUrl}/api/projects/overview`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.projects).toEqual([]);
    });

    it('returns project overviews with task counts', async () => {
      // The endpoint fetches directly from GM servers, not through the local gmClient.
      // We need to set up a mini GM server to respond to the overview endpoint's fetch calls.
      // For a unit test, we'll test with the configured project pointing at our test server.
      // Since the endpoint makes direct HTTP calls to project baseUrls, we create a mock.
      const gmApp = express();
      gmApp.use(express.json());
      gmApp.get('/api/projects/test-project/tasks', (_req, res) => {
        res.json({
          results: [
            { id: 't1', title: 'A', status: 'todo', priority: 'high', createdAt: '', updatedAt: '' },
            { id: 't2', title: 'B', status: 'done', priority: 'low', createdAt: '', updatedAt: '' },
            { id: 't3', title: 'C', status: 'in_progress', priority: 'medium', createdAt: '', updatedAt: '' },
          ],
        });
      });
      gmApp.get('/api/projects/test-project/epics', (_req, res) => {
        res.json({ results: [{ id: 'e1' }, { id: 'e2' }] });
      });

      // Start the mock GM server
      const gmServer = await new Promise<Server>((resolve) => {
        const s = gmApp.listen(0, () => resolve(s));
      });
      const gmPort = (gmServer.address() as import('net').AddressInfo).port;

      try {
        const config = makeConfig({
          projects: [{ baseUrl: `http://localhost:${gmPort}`, projectId: 'test-project' }],
          activeProjectId: 'test-project',
        });
        await startApp({ config });

        const res = await fetch(`${baseUrl}/api/projects/overview`);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.projects).toHaveLength(1);

        const proj = body.projects[0];
        expect(proj.projectId).toBe('test-project');
        expect(proj.taskCounts.todo).toBe(1);
        expect(proj.taskCounts.in_progress).toBe(1);
        expect(proj.taskCounts.done).toBe(1);
        expect(proj.taskCounts.total).toBe(3);
        expect(proj.epicCount).toBe(2);
        expect(proj.error).toBeUndefined();
      } finally {
        await new Promise<void>((resolve, reject) =>
          gmServer.close((err) => (err ? reject(err) : resolve()))
        );
      }
    });

    it('returns error field when project GM server is unreachable', async () => {
      const config = makeConfig({
        projects: [{ baseUrl: 'http://localhost:59999', projectId: 'dead-project' }],
        activeProjectId: 'dead-project',
      });
      await startApp({ config });

      const res = await fetch(`${baseUrl}/api/projects/overview`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.projects).toHaveLength(1);
      expect(body.projects[0].error).toBeDefined();
      expect(body.projects[0].taskCounts.total).toBe(0);
    });
  });

  // ── GET /api/projects/:id/tasks ─────────────────────────────────────

  describe('GET /api/projects/:id/tasks', () => {
    it('returns tasks from gmClient', async () => {
      await startApp();
      testApp.gm.addTask(makeTask({ title: 'Task A' }));
      testApp.gm.addTask(makeTask({ title: 'Task B' }));

      const res = await fetch(`${baseUrl}/api/projects/test-project/tasks`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.tasks).toHaveLength(2);
    });
  });

  // ── GET /api/projects/:id/epics ─────────────────────────────────────

  describe('GET /api/projects/:id/epics', () => {
    it('returns epics from gmClient', async () => {
      await startApp();
      testApp.gm.addEpic(makeEpic({ title: 'Epic A' }));

      const res = await fetch(`${baseUrl}/api/projects/test-project/epics`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.epics).toHaveLength(1);
    });
  });

  // ── POST /api/run/sprint ────────────────────────────────────────────

  describe('POST /api/run/sprint', () => {
    it('starts a sprint run', async () => {
      let startedWith: { projectId: string; tag?: string } | undefined;
      const runner = makeRunner({
        startSprint: async (projectId, tag) => {
          startedWith = { projectId, tag };
        },
      });
      await startApp({ runner });

      const res = await fetch(`${baseUrl}/api/run/sprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p1', tag: 'v1' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.mode).toBe('sprint');
    });

    it('returns 400 if projectId is missing', async () => {
      await startApp();
      const res = await fetch(`${baseUrl}/api/run/sprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 409 if already running', async () => {
      const runner = makeRunner({ isRunning: true });
      await startApp({ runner });
      const res = await fetch(`${baseUrl}/api/run/sprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p1' }),
      });
      expect(res.status).toBe(409);
    });
  });

  // ── POST /api/run/epic ──────────────────────────────────────────────

  describe('POST /api/run/epic', () => {
    it('starts an epic run', async () => {
      await startApp();
      const res = await fetch(`${baseUrl}/api/run/epic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p1', epicId: 'e1' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.mode).toBe('epic');
    });

    it('returns 400 if epicId is missing', async () => {
      await startApp();
      const res = await fetch(`${baseUrl}/api/run/epic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p1' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/run/stop ──────────────────────────────────────────────

  describe('POST /api/run/stop', () => {
    it('stops a running run', async () => {
      let stopped = false;
      const runner = makeRunner({
        isRunning: true,
        stop: async () => { stopped = true; },
      });
      await startApp({ runner });

      const res = await fetch(`${baseUrl}/api/run/stop`, { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(stopped).toBe(true);
    });

    it('returns 409 if nothing is running', async () => {
      await startApp();
      const res = await fetch(`${baseUrl}/api/run/stop`, { method: 'POST' });
      expect(res.status).toBe(409);
    });
  });

  // ── GET /api/config ─────────────────────────────────────────────────

  describe('GET /api/config', () => {
    it('returns config without apiKey in project entries', async () => {
      await startApp();
      const res = await fetch(`${baseUrl}/api/config`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.activeProjectId).toBe('test-project');
      expect(body.projects).toHaveLength(1);
      expect(body.projects[0].apiKey).toBeUndefined();
    });
  });

  // ── PUT /api/config ─────────────────────────────────────────────────

  describe('PUT /api/config', () => {
    it('updates and saves config', async () => {
      await startApp();
      const res = await fetch(`${baseUrl}/api/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pauseMs: 5000 }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.pauseMs).toBe(5000);
      expect(testApp.savedConfigs).toHaveLength(1);
    });
  });

  // ── Setup-required guard ────────────────────────────────────────────

  describe('setup-required guard', () => {
    it('returns 503 for task routes when projectId is empty', async () => {
      await startApp({ config: makeConfig({ projects: [], activeProjectId: undefined }) });
      const res = await fetch(`${baseUrl}/api/projects/test/tasks`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.error).toContain('Setup required');
    });

    it('returns 503 for epic routes when projectId is empty', async () => {
      await startApp({ config: makeConfig({ projects: [], activeProjectId: undefined }) });
      const res = await fetch(`${baseUrl}/api/projects/test/epics`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.error).toContain('Setup required');
    });

    it('returns 503 for sprint run when projectId is empty', async () => {
      await startApp({ config: makeConfig({ projects: [], activeProjectId: undefined }) });
      const res = await fetch(`${baseUrl}/api/run/sprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p1' }),
      });
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.error).toContain('Setup required');
    });

    it('allows status and config routes when projectId is empty', async () => {
      await startApp({ config: makeConfig({ projects: [], activeProjectId: undefined }) });

      const statusRes = await fetch(`${baseUrl}/api/status`);
      expect(statusRes.status).toBe(200);

      const configRes = await fetch(`${baseUrl}/api/config`);
      expect(configRes.status).toBe(200);

      const projectsRes = await fetch(`${baseUrl}/api/projects`);
      expect(projectsRes.status).toBe(200);
    });
  });

  // ── Error handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns 500 with error message on internal error', async () => {
      await startApp({
        gmDiscovery: {
          discoverServers: async () => { throw new Error('discovery failed'); },
        },
      });
      const res = await fetch(`${baseUrl}/api/projects`);
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe('discovery failed');
    });
  });
});
