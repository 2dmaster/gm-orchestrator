import { describe, it, expect } from 'vitest';
import { buildAllowedTools, validateCommand } from '../../src/core/permissions.js';
import type { Permissions } from '../../src/core/types.js';

function makePermissions(overrides: Partial<Permissions> = {}): Permissions {
  return {
    writeFiles: true,
    runCommands: ['npm test', 'npm run build'],
    blockedCommands: ['git push', 'npm publish', 'rm -rf'],
    mcpTools: 'all',
    ...overrides,
  };
}

describe('buildAllowedTools', () => {
  it('always includes Read', () => {
    const tools = buildAllowedTools(makePermissions({ writeFiles: false, runCommands: [], mcpTools: 'none' }));
    expect(tools).toContain('Read');
  });

  it('includes Write and Edit when writeFiles is true', () => {
    const tools = buildAllowedTools(makePermissions({ writeFiles: true }));
    expect(tools).toContain('Write');
    expect(tools).toContain('Edit');
  });

  it('excludes Write and Edit when writeFiles is false', () => {
    const tools = buildAllowedTools(makePermissions({ writeFiles: false }));
    expect(tools).not.toContain('Write');
    expect(tools).not.toContain('Edit');
  });

  it('creates Bash() entries for each runCommand', () => {
    const tools = buildAllowedTools(makePermissions({ runCommands: ['npm test', 'git commit'] }));
    expect(tools).toContain('Bash(npm test)');
    expect(tools).toContain('Bash(git commit)');
  });

  it('includes mcp__* wildcard when mcpTools is "all"', () => {
    const tools = buildAllowedTools(makePermissions({ mcpTools: 'all' }));
    expect(tools).toContain('mcp__*');
  });

  it('excludes MCP tools when mcpTools is "none"', () => {
    const tools = buildAllowedTools(makePermissions({ mcpTools: 'none' }));
    expect(tools.some((t) => t.startsWith('mcp__'))).toBe(false);
  });

  it('includes specific MCP tools when mcpTools is an array', () => {
    const tools = buildAllowedTools(makePermissions({
      mcpTools: ['mcp__graph-memory__tasks_get', 'mcp__graph-memory__tasks_move'],
    }));
    expect(tools).toContain('mcp__graph-memory__tasks_get');
    expect(tools).toContain('mcp__graph-memory__tasks_move');
    expect(tools).not.toContain('mcp__*');
  });

  it('throws on conflict between runCommands and blockedCommands', () => {
    expect(() =>
      buildAllowedTools(makePermissions({
        runCommands: ['git push'],
        blockedCommands: ['git push'],
      }))
    ).toThrow(/permission conflict/i);
  });

  it('throws on substring conflict between runCommands and blockedCommands', () => {
    expect(() =>
      buildAllowedTools(makePermissions({
        runCommands: ['rm -rf /tmp'],
        blockedCommands: ['rm -rf'],
      }))
    ).toThrow(/permission conflict/i);
  });

  it('returns correct full set for default permissions', () => {
    const tools = buildAllowedTools(makePermissions());
    expect(tools).toEqual([
      'Read',
      'Write',
      'Edit',
      'Bash(npm test)',
      'Bash(npm run build)',
      'mcp__*',
    ]);
  });
});

describe('validateCommand', () => {
  const perms = makePermissions();

  it('returns true for allowed commands', () => {
    expect(validateCommand('npm test', perms)).toBe(true);
    expect(validateCommand('npm run build', perms)).toBe(true);
  });

  it('returns false for blocked commands', () => {
    expect(validateCommand('git push origin main', perms)).toBe(false);
    expect(validateCommand('npm publish', perms)).toBe(false);
  });

  it('blocks commands containing blocked substring', () => {
    expect(validateCommand('rm -rf /', perms)).toBe(false);
  });

  it('allows commands not in blocked list', () => {
    expect(validateCommand('ls -la', perms)).toBe(true);
    expect(validateCommand('git status', perms)).toBe(true);
  });
});
