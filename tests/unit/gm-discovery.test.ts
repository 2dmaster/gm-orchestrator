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

    const servers = await discoverServers();

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

    const servers = await discoverServers();

    expect(servers).toHaveLength(1);
    expect(servers[0]).toEqual({
      url: 'http://127.0.0.1:3002',
      port: 3002,
      projects: [],
    });
  });

  it('handles timeout gracefully', async () => {
    mockFetch.mockImplementation(() => {
      // Simulate timeout — AbortSignal.timeout will abort, but in tests
      // we simulate with a never-resolving promise that gets rejected
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('AbortError: signal timed out')), 10);
      });
    });

    const servers = await discoverServers();

    expect(servers).toHaveLength(0);
  });

  it('returns empty array when no servers found', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const servers = await discoverServers();

    expect(servers).toEqual([]);
  });

  it('ignores rejected promises from Promise.allSettled', async () => {
    // Even if probePort somehow throws, allSettled catches it
    mockFetch.mockImplementation((url: string) => {
      if (url === 'http://127.0.0.1:3000/api/projects') {
        return Promise.resolve(jsonResponse({ results: [] }));
      }
      return Promise.reject(new Error('ECONNREFUSED'));
    });

    const servers = await discoverServers();

    expect(servers).toHaveLength(1);
    expect(servers[0]!.port).toBe(3000);
  });
});
