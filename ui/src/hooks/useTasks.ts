import { useState, useEffect, useCallback } from 'react';
import type { Task } from '../types';
import type { UseWebSocketReturn } from './useWebSocket';

export interface UseTasksReturn {
  tasks: Task[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const TASK_EVENT_TYPES = new Set([
  'task:started',
  'task:done',
  'task:cancelled',
  'task:timeout',
  'run:complete',
]);

export function useTasks(projectId: string | null, ws: UseWebSocketReturn): UseTasksReturn {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tasks: Task[] };
      setTasks(data.tasks);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Initial fetch
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Auto-refresh on relevant WebSocket events
  useEffect(() => {
    if (!ws.lastEvent) return;
    if (TASK_EVENT_TYPES.has(ws.lastEvent.type)) {
      fetchTasks();
    }
  }, [ws.lastEvent, fetchTasks]);

  return { tasks, isLoading, error, refetch: fetchTasks };
}
