import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createApiRouter, type ApiDeps, type RunnerService } from '../../src/server/api.js';
import { silentLogger } from '../../src/infra/logger.js';
import { FakeGraphMemory } from '../fixtures/fakes.js';
import { makeTask, makeEpic } from '../fixtures/factories.js';
import type { OrchestratorConfig } from '../../src/core/types.js';

function getPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

function makeConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    baseUrl: 'http://localhost:3000',
    projectId: 'test-project',
    timeoutMs: 60_000,
    pauseMs: 1_000,
    maxRetries: 1,
    claudeArgs: [],
    dryRun: false,
    apiKey: 'secret-key',
    ...overrides,
  };
}

function makeRunner(overrides: Partial<RunnerService> = {}): RunnerService {
  return {
    isRunning: false,
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
    const port = getPort();
    baseUrl = `http://localhost:${port}`;
    return new Promise((resolve) => {
      server = testApp.app.listen(port, () => resolve());
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
      expect(body.config.apiKey).toBeUndefined();
      expect(body.setupRequired).toBe(false);
    });

    it('returns setupRequired=true when projectId is empty', async () => {
      await startApp({ config: makeConfig({ projectId: '' }) });
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
    it('returns config without apiKey', async () => {
      await startApp();
      const res = await fetch(`${baseUrl}/api/config`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.projectId).toBe('test-project');
      expect(body.apiKey).toBeUndefined();
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
      expect(body.apiKey).toBeUndefined();
      expect(testApp.savedConfigs).toHaveLength(1);
    });
  });

  // ── Setup-required guard ────────────────────────────────────────────

  describe('setup-required guard', () => {
    it('returns 503 for task routes when projectId is empty', async () => {
      await startApp({ config: makeConfig({ projectId: '' }) });
      const res = await fetch(`${baseUrl}/api/projects/test/tasks`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.error).toContain('Setup required');
    });

    it('returns 503 for epic routes when projectId is empty', async () => {
      await startApp({ config: makeConfig({ projectId: '' }) });
      const res = await fetch(`${baseUrl}/api/projects/test/epics`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.error).toContain('Setup required');
    });

    it('returns 503 for sprint run when projectId is empty', async () => {
      await startApp({ config: makeConfig({ projectId: '' }) });
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
      await startApp({ config: makeConfig({ projectId: '' }) });

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
