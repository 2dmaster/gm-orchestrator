import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, saveConfig } from '../../src/infra/config.js';

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

  it('ignores cwd config file when it has no projectId', () => {
    // Write a cwd config WITHOUT projectId
    writeFileSync(
      join(cwdDir, '.gm-orchestrator.json'),
      JSON.stringify({ baseUrl: 'http://cwd:3000', pauseMs: 500 })
    );

    // Write a user-level config WITH projectId
    writeFileSync(
      join(userConfigDir, 'config.json'),
      JSON.stringify({ baseUrl: 'http://user:3000', projectId: 'user-project' })
    );

    process.chdir(cwdDir);

    const config = loadConfig();
    // Should fall through to user-level config since cwd has no projectId
    expect(config.projectId).toBe('user-project');
    expect(config.baseUrl).toBe('http://user:3000');
  });

  it('uses cwd config when it has a projectId', () => {
    writeFileSync(
      join(cwdDir, '.gm-orchestrator.json'),
      JSON.stringify({ baseUrl: 'http://cwd:3000', projectId: 'cwd-project' })
    );

    process.chdir(cwdDir);

    const config = loadConfig();
    expect(config.projectId).toBe('cwd-project');
    expect(config.baseUrl).toBe('http://cwd:3000');
  });

  it('uses explicit configPath when provided', () => {
    const explicitPath = join(tempDir, 'explicit.json');
    writeFileSync(
      explicitPath,
      JSON.stringify({ baseUrl: 'http://explicit:3000', projectId: 'explicit-project' })
    );

    process.chdir(cwdDir);

    const config = loadConfig({ configPath: explicitPath });
    expect(config.projectId).toBe('explicit-project');
    expect(config.baseUrl).toBe('http://explicit:3000');
  });

  it('returns defaults when no config files exist', () => {
    process.chdir(cwdDir);

    const config = loadConfig();
    expect(config.projectId).toBe('');
    expect(config.baseUrl).toBe('http://localhost:3000');
  });

  it('saves config to specified path', () => {
    const savePath = join(userConfigDir, 'config.json');

    saveConfig({ projectId: 'saved-project', baseUrl: 'http://saved:3000' }, savePath);

    const saved = JSON.parse(readFileSync(savePath, 'utf8'));
    expect(saved.projectId).toBe('saved-project');
  });
});
