// ─── GraphMemory Server Discovery ─────────────────────────────────────────
// Scans localhost ports to find running GraphMemory instances.
// Supports configurable port ranges, explicit server URLs, and per-port timeout.

import type { DiscoveryConfig } from '../core/types.js';

export interface GMServerProject {
  id: string;
  taskCount: number;
  epicCount: number;
}

export interface GMServer {
  url: string;
  port: number;
  projects: GMServerProject[];
}

const DEFAULT_PORT_START = 3000;
const DEFAULT_PORT_END = 3100;
const DEFAULT_TIMEOUT_MS = 500;

/**
 * Probe a single port for a running GraphMemory server.
 * Tries GET /api/projects first; falls back to GET /api/health.
 */
async function probePort(port: number, timeoutMs: number): Promise<GMServer | null> {
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${base}/api/projects`, {
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.ok) {
      const data = (await res.json()) as { results?: GMServerProject[] };
      return {
        url: base,
        port,
        projects: data.results ?? [],
      };
    }
  } catch {
    // /api/projects failed — try health endpoint
  }

  try {
    const res = await fetch(`${base}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.ok) {
      return { url: base, port, projects: [] };
    }
  } catch {
    // not a GM server on this port
  }

  return null;
}

/**
 * Probe a single URL for a running GraphMemory server.
 * Public wrapper around the internal probePort — accepts any URL, not just localhost.
 */
export async function probeServer(url: string, timeoutMs?: number): Promise<GMServer | null> {
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const parsed = new URL(url);
  const port = parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);
  const base = `${parsed.protocol}//${parsed.host}`;

  try {
    const res = await fetch(`${base}/api/projects`, {
      signal: AbortSignal.timeout(timeout),
    });
    if (res.ok) {
      const data = (await res.json()) as { results?: GMServerProject[] };
      return { url: base, port, projects: data.results ?? [] };
    }
  } catch { /* not reachable */ }

  try {
    const res = await fetch(`${base}/api/health`, {
      signal: AbortSignal.timeout(timeout),
    });
    if (res.ok) {
      return { url: base, port, projects: [] };
    }
  } catch { /* not a GM server */ }

  return null;
}

/**
 * Auto-discover GraphMemory servers.
 * Scans localhost ports in the configured range and probes any explicit server URLs.
 * All probes run in parallel.
 */
export async function discoverServers(config?: DiscoveryConfig): Promise<GMServer[]> {
  const portStart = config?.portRange?.[0] ?? DEFAULT_PORT_START;
  const portEnd = config?.portRange?.[1] ?? DEFAULT_PORT_END;
  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const extraServers = config?.extraServers ?? [];

  const ports = Array.from(
    { length: portEnd - portStart + 1 },
    (_, i) => portStart + i,
  );

  // Probe port range + explicit URLs in parallel
  const portProbes = ports.map((p) => probePort(p, timeoutMs));
  const urlProbes = extraServers.map((url) => probeServer(url, timeoutMs));

  const results = await Promise.allSettled([...portProbes, ...urlProbes]);

  const servers = results
    .filter(
      (r): r is PromiseFulfilledResult<GMServer | null> =>
        r.status === 'fulfilled',
    )
    .map((r) => r.value)
    .filter((server): server is GMServer => server !== null);

  // Deduplicate by URL (explicit URLs may overlap with port range)
  const seen = new Set<string>();
  return servers.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}
