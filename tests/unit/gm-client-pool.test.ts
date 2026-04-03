import { describe, it, expect } from 'vitest';
import { GraphMemoryClientPool } from '../../src/infra/gm-client-pool.js';
import type { ProjectEntry } from '../../src/core/types.js';

function makeProjects(...ids: string[]): ProjectEntry[] {
  return ids.map((id) => ({
    baseUrl: 'http://localhost:3000',
    projectId: id,
  }));
}

describe('GraphMemoryClientPool', () => {
  it('creates and caches a client for a configured project', () => {
    const pool = new GraphMemoryClientPool(makeProjects('proj-a', 'proj-b'));
    const clientA = pool.getClient('proj-a');
    const clientA2 = pool.getClient('proj-a');
    expect(clientA).toBe(clientA2); // same instance
  });

  it('throws for an unknown projectId', () => {
    const pool = new GraphMemoryClientPool(makeProjects('proj-a'));
    expect(() => pool.getClient('unknown')).toThrowError(/not configured/);
  });

  it('has() returns true for configured projects', () => {
    const pool = new GraphMemoryClientPool(makeProjects('proj-a'));
    expect(pool.has('proj-a')).toBe(true);
    expect(pool.has('proj-b')).toBe(false);
  });

  it('getProjectIds() returns all configured IDs', () => {
    const pool = new GraphMemoryClientPool(makeProjects('a', 'b', 'c'));
    expect(pool.getProjectIds()).toEqual(['a', 'b', 'c']);
  });

  it('getAllClients() returns only instantiated clients', () => {
    const pool = new GraphMemoryClientPool(makeProjects('a', 'b'));
    expect(pool.getAllClients().size).toBe(0);
    pool.getClient('a');
    expect(pool.getAllClients().size).toBe(1);
    expect(pool.getAllClients().has('a')).toBe(true);
  });

  describe('rebuild()', () => {
    it('keeps clients for projects that still exist', () => {
      const pool = new GraphMemoryClientPool(makeProjects('a', 'b'));
      const clientA = pool.getClient('a');
      pool.rebuild(makeProjects('a', 'c'));
      expect(pool.getClient('a')).toBe(clientA);
    });

    it('removes clients for projects that were deleted', () => {
      const pool = new GraphMemoryClientPool(makeProjects('a', 'b'));
      pool.getClient('a');
      pool.getClient('b');
      pool.rebuild(makeProjects('a'));
      expect(pool.getAllClients().has('b')).toBe(false);
      expect(() => pool.getClient('b')).toThrowError(/not configured/);
    });

    it('allows creating clients for newly added projects', () => {
      const pool = new GraphMemoryClientPool(makeProjects('a'));
      pool.rebuild(makeProjects('a', 'new-proj'));
      expect(pool.has('new-proj')).toBe(true);
      const client = pool.getClient('new-proj');
      expect(client).toBeDefined();
    });

    it('updates getProjectIds after rebuild', () => {
      const pool = new GraphMemoryClientPool(makeProjects('a', 'b'));
      pool.rebuild(makeProjects('x', 'y'));
      expect(pool.getProjectIds()).toEqual(['x', 'y']);
    });
  });
});
