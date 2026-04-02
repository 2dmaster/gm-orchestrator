import { describe, it, expect, afterEach } from 'vitest';
import { createServer as createHttpServer } from 'http';
import WebSocket from 'ws';
import { createWebSocketServer } from '../../src/server/ws.js';
import type { WebSocketBus } from '../../src/server/ws.js';
import type { ServerEvent } from '../../src/core/types.js';

function listenOnRandomPort(server: ReturnType<typeof createHttpServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : 0);
    });
  });
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<ServerEvent> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

function closeClient(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    ws.on('close', () => resolve());
    ws.close();
  });
}

describe('WebSocket event bus', () => {
  let httpServer: ReturnType<typeof createHttpServer> | undefined;
  let bus: WebSocketBus | undefined;
  const clients: WebSocket[] = [];

  afterEach(async () => {
    // Close clients first, then bus, then HTTP server
    await Promise.all(clients.map(closeClient));
    clients.length = 0;
    if (bus) {
      await bus.close();
      bus = undefined;
    }
    if (httpServer) {
      await new Promise<void>((resolve, reject) =>
        httpServer!.close((err) => (err ? reject(err) : resolve()))
      );
      httpServer = undefined;
    }
  });

  it('accepts connections and tracks client count', async () => {
    httpServer = createHttpServer();
    const port = await listenOnRandomPort(httpServer);
    bus = createWebSocketServer(httpServer);

    expect(bus.clientCount).toBe(0);

    const ws = await connectWs(port);
    clients.push(ws);
    expect(bus.clientCount).toBe(1);

    const ws2 = await connectWs(port);
    clients.push(ws2);
    expect(bus.clientCount).toBe(2);
  });

  it('broadcasts events to all connected clients', async () => {
    httpServer = createHttpServer();
    const port = await listenOnRandomPort(httpServer);
    bus = createWebSocketServer(httpServer);

    const ws1 = await connectWs(port);
    const ws2 = await connectWs(port);
    clients.push(ws1, ws2);

    const event: ServerEvent = { type: 'run:started', payload: { mode: 'sprint' } };

    const p1 = waitForMessage(ws1);
    const p2 = waitForMessage(ws2);
    bus.broadcast(event);

    const [msg1, msg2] = await Promise.all([p1, p2]);
    expect(msg1).toEqual(event);
    expect(msg2).toEqual(event);
  });

  it('cleans up disconnected clients', async () => {
    httpServer = createHttpServer();
    const port = await listenOnRandomPort(httpServer);
    bus = createWebSocketServer(httpServer);

    const ws = await connectWs(port);
    expect(bus.clientCount).toBe(1);

    await closeClient(ws);
    expect(bus.clientCount).toBe(0);
  });
});
