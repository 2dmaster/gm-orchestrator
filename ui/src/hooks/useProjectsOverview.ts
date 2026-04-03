import { useState, useEffect, useCallback } from 'react';
import type { ProjectOverview } from '../types';
import type { UseWebSocketReturn } from './useWebSocket';

export interface UseProjectsOverviewReturn {
  projects: ProjectOverview[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const REFRESH_EVENT_TYPES = new Set([
  'task:done',
  'task:cancelled',
  'run:complete',
]);

export function useProjectsOverview(ws: UseWebSocketReturn): UseProjectsOverviewReturn {
  const [projects, setProjects] = useState<ProjectOverview[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/projects/overview');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { projects: ProjectOverview[] };
      setProjects(data.projects);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // Auto-refresh on relevant WebSocket events
  useEffect(() => {
    if (!ws.lastEvent) return;
    if (REFRESH_EVENT_TYPES.has(ws.lastEvent.type)) {
      fetchOverview();
    }
  }, [ws.lastEvent, fetchOverview]);

  return { projects, isLoading, error, refetch: fetchOverview };
}
