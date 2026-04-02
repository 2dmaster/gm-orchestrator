import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer } from '../../src/server/index.js';
import { silentLogger } from '../../src/infra/logger.js';
import type { Server } from 'http';

function getPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

describe('server', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((err) => (err ? reject(err) : resolve()))
      );
      server = undefined;
    }
  });

  it('starts on the configured port', async () => {
    const port = getPort();
    const { start } = createServer({ logger: silentLogger, port });
    server = await start();
    const addr = server.address();
    expect(addr).not.toBeNull();
    if (typeof addr === 'object' && addr !== null) {
      expect(addr.port).toBe(port);
    }
  });

  it('returns fallback HTML when dist/ui/ does not exist', async () => {
    // Point cwd to a temp dir so dist/ui/ won't be found
    const originalCwd = process.cwd();
    const tmpDir = await import('os').then(os => os.tmpdir());
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

    const port = getPort();
    const { start, mountStaticUI } = createServer({ logger: silentLogger, port });
    mountStaticUI();

    vi.restoreAllMocks();

    server = await start();

    const res = await fetch(`http://localhost:${port}/`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('UI not built');
    expect(body).toContain('npm run build:ui');
  });

  it('gracefully stops the server', async () => {
    const port = getPort();
    const { start, stop } = createServer({ logger: silentLogger, port });
    server = await start();

    await stop(server);
    // After stop, server should no longer accept connections
    await expect(fetch(`http://localhost:${port}/`)).rejects.toThrow();
    server = undefined; // already closed
  });
});
