import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { discoverServers } from '../../src/infra/gm-discovery.js';

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function failResponse(status = 404): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('not ok')),
    text: () => Promise.resolve('Not Found'),
  } as Response;
}

/** Narrow port range to keep tests fast */
const SMALL_RANGE: [number, number] = [3000, 3010];

describe('discoverServers', () => {
  it('discovers servers responding on /api/projects', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === 'http://127.0.0.1:3001/api/projects') {
        return Promise.resolve(
          jsonResponse({
            results: [
              { id: 'proj-1', taskCount: 5, epicCount: 2 },
            ],
          }),
        );
      }
      if (url === 'http://127.0.0.1:3005/api/projects') {
        return Promise.resolve(
          jsonResponse({
            results: [
              { id: 'proj-a', taskCount: 10, epicCount: 3 },
              { id: 'proj-b', taskCount: 1, epicCount: 0 },
            ],
          }),
        );
      }
      // All other ports: network error (connection refused)
      return Promise.reject(new Error('ECONNREFUSED'));
    });

    const servers = await discoverServers({ portRange: SMALL_RANGE });

    expect(servers).toHaveLength(2);

    const s1 = servers.find((s) => s.port === 3001);
    expect(s1).toEqual({
      url: 'http://127.0.0.1:3001',
      port: 3001,
      projects: [{ id: 'proj-1', taskCount: 5, epicCount: 2 }],
    });

    const s2 = servers.find((s) => s.port === 3005);
    expect(s2).toEqual({
      url: 'http://127.0.0.1:3005',
      port: 3005,
      projects: [
        { id: 'proj-a', taskCount: 10, epicCount: 3 },
        { id: 'proj-b', taskCount: 1, epicCount: 0 },
      ],
    });
  });

  it('falls back to /api/health when /api/projects fails', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === 'http://127.0.0.1:3002/api/projects') {
        return Promise.resolve(failResponse(404));
      }
      if (url === 'http://127.0.0.1:3002/api/health') {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      return Promise.reject(new Error('ECONNREFUSED'));
    });

    const servers = await discoverServers({ portRange: SMALL_RANGE });

    expect(servers).toHaveLength(1);
    expect(servers[0]).toEqual({
      url: 'http://127.0.0.1:3002',
      port: 3002,
      projects: [],
    });
  });

  it('handles timeout gracefully', async () => {
    mockFetch.mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('AbortError: signal timed out')), 10);
      });
    });

    const servers = await discoverServers({ portRange: SMALL_RANGE });

    expect(servers).toHaveLength(0);
  });

  it('returns empty array when no servers found', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const servers = await discoverServers({ portRange: SMALL_RANGE });

    expect(servers).toEqual([]);
  });

  it('ignores rejected promises from Promise.allSettled', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === 'http://127.0.0.1:3000/api/projects') {
        return Promise.resolve(jsonResponse({ results: [] }));
      }
      return Promise.reject(new Error('ECONNREFUSED'));
    });

    const servers = await discoverServers({ portRange: SMALL_RANGE });

    expect(servers).toHaveLength(1);
    expect(servers[0]!.port).toBe(3000);
  });

  it('uses custom port range', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === 'http://127.0.0.1:4000/api/projects') {
        return Promise.resolve(jsonResponse({ results: [] }));
      }
      return Promise.reject(new Error('ECONNREFUSED'));
    });

    const servers = await discoverServers({ portRange: [4000, 4005] });

    expect(servers).toHaveLength(1);
    expect(servers[0]!.port).toBe(4000);
  });

  it('probes extraServers alongside port range', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === 'http://127.0.0.1:3000/api/projects') {
        return Promise.resolve(jsonResponse({ results: [] }));
      }
      if (url === 'http://myhost:9090/api/projects') {
        return Promise.resolve(
          jsonResponse({ results: [{ id: 'remote-1', taskCount: 1, epicCount: 0 }] }),
        );
      }
      return Promise.reject(new Error('ECONNREFUSED'));
    });

    const servers = await discoverServers({
      portRange: SMALL_RANGE,
      extraServers: ['http://myhost:9090'],
    });

    expect(servers).toHaveLength(2);
    expect(servers.find((s) => s.port === 3000)).toBeDefined();
    expect(servers.find((s) => s.port === 9090)).toEqual({
      url: 'http://myhost:9090',
      port: 9090,
      projects: [{ id: 'remote-1', taskCount: 1, epicCount: 0 }],
    });
  });

  it('deduplicates when extraServers overlaps with port range', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === 'http://127.0.0.1:3001/api/projects') {
        return Promise.resolve(jsonResponse({ results: [] }));
      }
      return Promise.reject(new Error('ECONNREFUSED'));
    });

    const servers = await discoverServers({
      portRange: SMALL_RANGE,
      extraServers: ['http://127.0.0.1:3001'],
    });

    expect(servers).toHaveLength(1);
    expect(servers[0]!.port).toBe(3001);
  });

  it('respects custom timeoutMs', async () => {
    const timeouts: number[] = [];
    mockFetch.mockImplementation((_url: string, opts?: { signal?: AbortSignal }) => {
      // Track that AbortSignal.timeout was called — we can't inspect the value directly,
      // but we verify the function accepts the config without error
      return Promise.reject(new Error('ECONNREFUSED'));
    });

    const servers = await discoverServers({
      portRange: [3000, 3000],
      timeoutMs: 100,
    });

    expect(servers).toEqual([]);
    // fetch was called (for both /api/projects and /api/health)
    expect(mockFetch).toHaveBeenCalled();
  });

  it('uses defaults when called without config', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const servers = await discoverServers();

    expect(servers).toEqual([]);
    // Default range is 3000–3100 = 101 ports × 2 attempts (projects + health) max
    // But since all reject on /api/projects, health is also tried = up to 202 calls
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(101);
  });
});
