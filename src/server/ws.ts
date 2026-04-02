import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { ServerEvent } from '../core/types.js';

export interface WebSocketBus {
  broadcast(event: ServerEvent): void;
  readonly clientCount: number;
  close(): Promise<void>;
}

export function createWebSocketServer(httpServer: Server): WebSocketBus {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  function broadcast(event: ServerEvent): void {
    const data = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  function close(): Promise<void> {
    return new Promise((resolve, reject) => {
      wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  return {
    broadcast,
    get clientCount() {
      return wss.clients.size;
    },
    close,
  };
}
