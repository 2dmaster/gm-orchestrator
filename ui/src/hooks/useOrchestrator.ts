import { useState, useEffect, useCallback } from 'react';
import type { StatusResponse } from '../types';
import type { UseWebSocketReturn } from './useWebSocket';

export interface UseOrchestratorReturn {
  startSprint: (projectId: string, tag?: string) => Promise<void>;
  startEpic: (projectId: string, epicId: string) => Promise<void>;
  stop: () => Promise<void>;
  isRunning: boolean;
  status: StatusResponse | null;
}

async function post(url: string, body?: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
}

export function useOrchestrator(ws: UseWebSocketReturn): UseOrchestratorReturn {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
      setIsRunning(data.isRunning);
    } catch {
      // Ignore fetch errors — server may not be ready yet
    }
  }, []);

  // Initial status fetch
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Update isRunning based on WebSocket events
  useEffect(() => {
    if (!ws.lastEvent) return;
    switch (ws.lastEvent.type) {
      case 'run:started':
        setIsRunning(true);
        break;
      case 'run:stopped':
      case 'run:complete':
        setIsRunning(false);
        fetchStatus(); // refresh full status
        break;
    }
  }, [ws.lastEvent, fetchStatus]);

  const startSprint = useCallback(async (projectId: string, tag?: string) => {
    await post('/api/run/sprint', { projectId, tag });
    setIsRunning(true);
  }, []);

  const startEpic = useCallback(async (projectId: string, epicId: string) => {
    await post('/api/run/epic', { projectId, epicId });
    setIsRunning(true);
  }, []);

  const stop = useCallback(async () => {
    await post('/api/run/stop');
  }, []);

  return { startSprint, startEpic, stop, isRunning, status };
}
