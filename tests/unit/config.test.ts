import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, saveConfig, migrateConfig, validatePipelines } from '../../src/infra/config.js';
import type { Pipeline } from '../../src/core/types.js';

describe('config loading', () => {
  const originalCwd = process.cwd();
  const originalXdg = process.env['XDG_CONFIG_HOME'];
  let tempDir: string;
  let cwdDir: string;
  let xdgDir: string;
  let userConfigDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `gm-orch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    cwdDir = join(tempDir, 'cwd');
    xdgDir = join(tempDir, 'xdg-config');
    userConfigDir = join(xdgDir, 'gm-orchestrator');
    mkdirSync(cwdDir, { recursive: true });
    mkdirSync(userConfigDir, { recursive: true });
    // Point XDG_CONFIG_HOME to our temp dir so getUserConfigDir() picks it up
    process.env['XDG_CONFIG_HOME'] = xdgDir;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalXdg !== undefined) {
      process.env['XDG_CONFIG_HOME'] = originalXdg;
    } else {
      delete process.env['XDG_CONFIG_HOME'];
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('migrates legacy config with baseUrl/projectId to projects array', () => {
    writeFileSync(
      join(cwdDir, '.gm-orchestrator.json'),
      JSON.stringify({ baseUrl: 'http://cwd:3000', projectId: 'cwd-project', apiKey: 'key123' })
    );

    process.chdir(cwdDir);

    const config = loadConfig();
    expect(config.projects).toHaveLength(1);
    expect(config.projects[0]!.baseUrl).toBe('http://cwd:3000');
    expect(config.projects[0]!.projectId).toBe('cwd-project');
    expect(config.projects[0]!.apiKey).toBe('key123');
    expect(config.activeProjectId).toBe('cwd-project');
  });

  it('uses new-format config with projects array directly', () => {
    writeFileSync(
      join(cwdDir, '.gm-orchestrator.json'),
      JSON.stringify({
        projects: [
          { baseUrl: 'http://a:3000', projectId: 'proj-a' },
          { baseUrl: 'http://b:3000', projectId: 'proj-b', label: 'Project B' },
        ],
        activeProjectId: 'proj-b',
        concurrency: 2,
      })
    );

    process.chdir(cwdDir);

    const config = loadConfig();
    expect(config.projects).toHaveLength(2);
    expect(config.activeProjectId).toBe('proj-b');
    expect(config.concurrency).toBe(2);
    expect(config.projects[1]!.label).toBe('Project B');
  });

  it('ignores cwd config file when it has no projects', () => {
    // Write a cwd config WITHOUT projectId (legacy) or projects (new)
    writeFileSync(
      join(cwdDir, '.gm-orchestrator.json'),
      JSON.stringify({ pauseMs: 500 })
    );

    // Write a user-level config WITH projects
    writeFileSync(
      join(userConfigDir, 'config.json'),
      JSON.stringify({
        projects: [{ baseUrl: 'http://user:3000', projectId: 'user-project' }],
        activeProjectId: 'user-project',
      })
    );

    process.chdir(cwdDir);

    const config = loadConfig();
    // Should fall through to user-level config since cwd has no projects
    expect(config.activeProjectId).toBe('user-project');
    expect(config.projects[0]!.baseUrl).toBe('http://user:3000');
  });

  it('uses explicit configPath when provided', () => {
    const explicitPath = join(tempDir, 'explicit.json');
    writeFileSync(
      explicitPath,
      JSON.stringify({ baseUrl: 'http://explicit:3000', projectId: 'explicit-project' })
    );

    process.chdir(cwdDir);

    const config = loadConfig({ configPath: explicitPath });
    expect(config.activeProjectId).toBe('explicit-project');
    expect(config.projects[0]!.baseUrl).toBe('http://explicit:3000');
  });

  it('returns defaults when no config files exist', () => {
    process.chdir(cwdDir);

    const config = loadConfig();
    expect(config.projects).toHaveLength(0);
    expect(config.concurrency).toBe(1);
    expect(config.timeoutMs).toBe(15 * 60 * 1000);
  });

  it('saves config to specified path', () => {
    const savePath = join(userConfigDir, 'config.json');

    saveConfig({
      projects: [{ baseUrl: 'http://saved:3000', projectId: 'saved-project' }],
      activeProjectId: 'saved-project',
    }, savePath);

    const saved = JSON.parse(readFileSync(savePath, 'utf8'));
    expect(saved.activeProjectId).toBe('saved-project');
    expect(saved.projects[0].projectId).toBe('saved-project');
  });
});

describe('migrateConfig', () => {
  it('passes through new-format config unchanged', () => {
    const raw = {
      projects: [{ baseUrl: 'http://a:3000', projectId: 'a' }],
      activeProjectId: 'a',
      concurrency: 2,
    };
    const result = migrateConfig(raw);
    expect(result).toEqual(raw);
  });

  it('converts legacy baseUrl/projectId to projects array', () => {
    const raw = { baseUrl: 'http://legacy:3000', projectId: 'legacy-proj', apiKey: 'key' };
    const result = migrateConfig(raw);
    expect(result.projects).toHaveLength(1);
    expect(result.projects![0]!.baseUrl).toBe('http://legacy:3000');
    expect(result.projects![0]!.projectId).toBe('legacy-proj');
    expect(result.projects![0]!.apiKey).toBe('key');
    expect(result.activeProjectId).toBe('legacy-proj');
  });

  it('carries over non-connection fields from legacy config', () => {
    const raw = { baseUrl: 'http://x:3000', projectId: 'x', timeoutMs: 30000, dryRun: true };
    const result = migrateConfig(raw);
    expect(result.timeoutMs).toBe(30000);
    expect(result.dryRun).toBe(true);
  });

  it('handles legacy config with no projectId', () => {
    const raw = { baseUrl: 'http://x:3000' };
    const result = migrateConfig(raw);
    expect(result.projects).toHaveLength(1);
    expect(result.projects![0]!.projectId).toBe('');
    expect(result.activeProjectId).toBeUndefined();
  });
});

describe('validatePipelines', () => {
  const validPipeline: Pipeline = {
    id: 'release',
    name: 'Full-stack release',
    stages: [
      { id: 'backend', projectId: 'backend-api', epicId: 'api-v2' },
      { id: 'frontend', projectId: 'frontend-app', epicId: 'ui-update', after: ['backend'] },
      { id: 'e2e', projectId: 'e2e-tests', epicId: 'smoke-tests', after: ['backend', 'frontend'] },
    ],
  };

  it('accepts a valid pipeline with no errors', () => {
    expect(validatePipelines([validPipeline])).toEqual([]);
  });

  it('accepts a pipeline with no dependencies (all stages independent)', () => {
    const pipeline: Pipeline = {
      id: 'parallel',
      name: 'Parallel jobs',
      stages: [
        { id: 'a', projectId: 'p1', epicId: 'e1' },
        { id: 'b', projectId: 'p2', epicId: 'e2' },
      ],
    };
    expect(validatePipelines([pipeline])).toEqual([]);
  });

  it('rejects duplicate pipeline IDs', () => {
    const errors = validatePipelines([validPipeline, { ...validPipeline }]);
    expect(errors).toContainEqual(expect.stringContaining('Duplicate pipeline ID'));
  });

  it('rejects duplicate stage IDs within a pipeline', () => {
    const pipeline: Pipeline = {
      id: 'dup-stage',
      name: 'Bad',
      stages: [
        { id: 'a', projectId: 'p1', epicId: 'e1' },
        { id: 'a', projectId: 'p2', epicId: 'e2' },
      ],
    };
    const errors = validatePipelines([pipeline]);
    expect(errors).toContainEqual(expect.stringContaining('duplicate stage ID "a"'));
  });

  it('rejects stages with unknown "after" references', () => {
    const pipeline: Pipeline = {
      id: 'bad-ref',
      name: 'Bad',
      stages: [
        { id: 'a', projectId: 'p1', epicId: 'e1', after: ['nonexistent'] },
      ],
    };
    const errors = validatePipelines([pipeline]);
    expect(errors).toContainEqual(expect.stringContaining('unknown stage "nonexistent"'));
  });

  it('rejects self-referencing stages', () => {
    const pipeline: Pipeline = {
      id: 'self-ref',
      name: 'Bad',
      stages: [
        { id: 'a', projectId: 'p1', epicId: 'e1', after: ['a'] },
      ],
    };
    const errors = validatePipelines([pipeline]);
    expect(errors).toContainEqual(expect.stringContaining('cannot depend on itself'));
  });

  it('detects cycles in stage dependencies', () => {
    const pipeline: Pipeline = {
      id: 'cyclic',
      name: 'Cyclic',
      stages: [
        { id: 'a', projectId: 'p1', epicId: 'e1', after: ['c'] },
        { id: 'b', projectId: 'p2', epicId: 'e2', after: ['a'] },
        { id: 'c', projectId: 'p3', epicId: 'e3', after: ['b'] },
      ],
    };
    const errors = validatePipelines([pipeline]);
    expect(errors).toContainEqual(expect.stringContaining('cycle detected'));
  });

  it('rejects pipelines with no stages', () => {
    const pipeline: Pipeline = { id: 'empty', name: 'Empty', stages: [] };
    const errors = validatePipelines([pipeline]);
    expect(errors).toContainEqual(expect.stringContaining('at least one stage'));
  });

  it('rejects stages missing projectId or epicId', () => {
    const pipeline: Pipeline = {
      id: 'missing-fields',
      name: 'Bad',
      stages: [
        { id: 'a', projectId: '', epicId: '' },
      ],
    };
    const errors = validatePipelines([pipeline]);
    expect(errors).toContainEqual(expect.stringContaining('missing "projectId"'));
    expect(errors).toContainEqual(expect.stringContaining('missing "epicId"'));
  });
});
