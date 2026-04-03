import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import type { Server } from 'http';
import type { Logger } from '../infra/logger.js';

export interface ServerDeps {
  logger: Logger;
  port?: number;
}

const FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>gm-orchestrator</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0">
<div style="text-align:center">
<h1>UI not built</h1>
<p>Run <code style="background:#2d2d44;padding:4px 8px;border-radius:4px">npm run build:ui</code> first.</p>
</div>
</body>
</html>`;

export function createServer(deps: ServerDeps): { app: express.Express; start: () => Promise<Server>; stop: (server: Server) => Promise<void>; mountStaticUI: () => void } {
  const { logger } = deps;
  const port = deps.port ?? (Number(process.env['GM_PORT']) || 4242);
  const app = express();
  app.use(express.json());

  // Call after mounting API routes so the catch-all doesn't shadow them
  function mountStaticUI(): void {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const uiDir = resolve(__dirname, '..', 'ui');
    if (existsSync(uiDir)) {
      app.use(express.static(uiDir));
      // SPA fallback — serve index.html for unmatched routes
      app.get('{*path}', (_req, res) => {
        res.sendFile(resolve(uiDir, 'index.html'));
      });
    } else {
      app.get('{*path}', (_req, res) => {
        res.type('html').send(FALLBACK_HTML);
      });
    }
  }

  async function start(): Promise<Server> {
    return new Promise((resolvePromise) => {
      const server = app.listen(port, () => {
        logger.info(`Server listening on http://localhost:${port}`);

        // Open browser (fire-and-forget, don't block on import failure)
        import('open').then((mod) => mod.default(`http://localhost:${port}`)).catch(() => {});

        resolvePromise(server);
      });
    });
  }

  async function stop(server: Server): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          logger.info('Server stopped');
          resolvePromise();
        }
      });
    });
  }

  return { app, start, stop, mountStaticUI };
}

export async function startServer(deps: ServerDeps): Promise<{ server: Server; stop: () => Promise<void> }> {
  const { start, stop, mountStaticUI } = createServer(deps);
  mountStaticUI();
  const server = await start();

  const shutdown = async () => {
    deps.logger.info('Shutting down...');
    await stop(server);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, stop: () => stop(server) };
}
