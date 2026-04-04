import { useState, useEffect, useCallback } from 'react';
import type { StatusResponse } from '../types';
import type { UseWebSocketReturn } from './useWebSocket';

export interface UseOrchestratorReturn {
  startSprint: (projectId: string, tag?: string) => Promise<void>;
  startEpic: (projectId: string, epicId: string) => Promise<void>;
  startTasks: (projectId: string, taskIds: string[]) => Promise<void>;
  stop: () => Promise<void>;
  stopProject: (projectId: string) => Promise<void>;
  isRunning: boolean;
  isProjectRunning: (projectId: string) => boolean;
  runningProjectIds: string[];
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
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
      setRunningIds(new Set(data.runningProjectIds ?? []));
    } catch {
      // Ignore fetch errors — server may not be ready yet
    }
  }, []);

  // Initial status fetch
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Update running state based on WebSocket events
  useEffect(() => {
    if (!ws.lastEvent) return;
    const evt = ws.lastEvent;
    switch (evt.type) {
      case 'run:started': {
        const pid = evt.payload?.projectId;
        if (pid) {
          setRunningIds((prev) => new Set([...prev, pid]));
        }
        break;
      }
      case 'run:stopped': {
        const pid = (evt as { payload?: { projectId?: string } }).payload?.projectId;
        if (pid) {
          setRunningIds((prev) => {
            const next = new Set(prev);
            next.delete(pid);
            return next;
          });
        } else {
          setRunningIds(new Set());
        }
        fetchStatus();
        break;
      }
      case 'run:complete': {
        const pid = evt.payload?.projectId;
        if (pid) {
          setRunningIds((prev) => {
            const next = new Set(prev);
            next.delete(pid);
            return next;
          });
        }
        fetchStatus();
        break;
      }
      case 'scheduler:drained':
        setRunningIds(new Set());
        fetchStatus();
        break;
    }
  }, [ws.lastEvent, fetchStatus]);

  const startSprint = useCallback(async (projectId: string, tag?: string) => {
    await post('/api/run/sprint', { projectId, tag });
    setRunningIds((prev) => new Set([...prev, projectId]));
  }, []);

  const startEpic = useCallback(async (projectId: string, epicId: string) => {
    await post('/api/run/epic', { projectId, epicId });
    setRunningIds((prev) => new Set([...prev, projectId]));
  }, []);

  const startTasks = useCallback(async (projectId: string, taskIds: string[]) => {
    await post(`/api/projects/${encodeURIComponent(projectId)}/run-tasks`, { taskIds });
    setRunningIds((prev) => new Set([...prev, projectId]));
  }, []);

  const stop = useCallback(async () => {
    await post('/api/run/stop');
  }, []);

  const stopProject = useCallback(async (projectId: string) => {
    await post('/api/run/stop', { projectId });
  }, []);

  const isProjectRunning = useCallback(
    (projectId: string) => runningIds.has(projectId),
    [runningIds],
  );

  return {
    startSprint,
    startEpic,
    startTasks,
    stop,
    stopProject,
    isRunning: runningIds.size > 0,
    isProjectRunning,
    runningProjectIds: [...runningIds],
    status,
  };
}
