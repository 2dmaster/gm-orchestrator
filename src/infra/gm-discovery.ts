// ─── GraphMemory Server Discovery ─────────────────────────────────────────
// Scans localhost ports 3000–3010 to find running GraphMemory instances.

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

const PORT_START = 3000;
const PORT_END = 3010;
const TIMEOUT_MS = 500;

/**
 * Probe a single port for a running GraphMemory server.
 * Tries GET /api/projects first; falls back to GET /api/health.
 */
async function probePort(port: number): Promise<GMServer | null> {
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${base}/api/projects`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
 * Auto-discover GraphMemory servers on localhost ports 3000–3010.
 * Scans all ports in parallel and returns responding servers.
 */
export async function discoverServers(): Promise<GMServer[]> {
  const ports = Array.from(
    { length: PORT_END - PORT_START + 1 },
    (_, i) => PORT_START + i,
  );

  const results = await Promise.allSettled(ports.map(probePort));

  return results
    .filter(
      (r): r is PromiseFulfilledResult<GMServer | null> =>
        r.status === 'fulfilled',
    )
    .map((r) => r.value)
    .filter((server): server is GMServer => server !== null);
}
