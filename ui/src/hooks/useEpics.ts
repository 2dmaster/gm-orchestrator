import { useState, useEffect, useCallback, useRef } from 'react';
import type { Epic } from '../types';
import type { UseWebSocketReturn } from './useWebSocket';

export interface UseEpicsReturn {
  epics: Epic[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  loadMore: () => void;
  refetch: () => void;
}

export const EPICS_PAGE_SIZE = 20;

// Run lifecycle events that may change epic progress/status.
const EPIC_EVENT_TYPES = new Set([
  'task:done',
  'task:cancelled',
  'epic:done',
  'run:complete',
]);

// Epics can be created/edited externally (e.g. via MCP) without emitting any
// WebSocket event to the orchestrator. Poll so those changes surface on their
// own instead of requiring a full page reload.
const POLL_INTERVAL_MS = 20_000;

async function fetchEpicsPage(
  projectId: string,
  offset: number,
  limit: number,
  status?: string
): Promise<{ epics: Epic[]; total: number }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) params.set('status', status);
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/epics?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { epics: Epic[]; total: number };
}

/**
 * @param status optional comma-separated status filter (e.g. "open,in_progress").
 *   Changing it resets pagination and refetches from the first page.
 */
export function useEpics(
  projectId: string | null,
  ws: UseWebSocketReturn,
  status?: string
): UseEpicsReturn {
  const [epics, setEpics] = useState<Epic[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // How many epics are currently loaded — used so refetch (poll/ws/focus)
  // refreshes the whole loaded range from the top instead of resetting to page 1.
  const loadedCountRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const count = Math.max(EPICS_PAGE_SIZE, loadedCountRef.current);
      const data = await fetchEpicsPage(projectId, 0, count, status);
      setEpics(data.epics);
      setTotal(data.total);
      loadedCountRef.current = data.epics.length;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, status]);

  const loadMore = useCallback(async () => {
    if (!projectId) return;
    setIsLoadingMore(true);
    setError(null);
    try {
      const data = await fetchEpicsPage(projectId, loadedCountRef.current, EPICS_PAGE_SIZE, status);
      setEpics((prev) => {
        const next = [...prev, ...data.epics];
        loadedCountRef.current = next.length;
        return next;
      });
      setTotal(data.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoadingMore(false);
    }
  }, [projectId, status]);

  // Reset + initial fetch whenever the project changes
  useEffect(() => {
    loadedCountRef.current = 0;
    setEpics([]);
    setTotal(0);
    refetch();
  }, [projectId, refetch]);

  // Auto-refresh on relevant WebSocket events
  useEffect(() => {
    if (!ws.lastEvent) return;
    if (EPIC_EVENT_TYPES.has(ws.lastEvent.type)) {
      refetch();
    }
  }, [ws.lastEvent, refetch]);

  // Poll + refetch on window focus to catch externally-created epics (MCP, etc.)
  useEffect(() => {
    if (!projectId) return;
    const interval = setInterval(refetch, POLL_INTERVAL_MS);
    const onFocus = () => refetch();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [projectId, refetch]);

  return {
    epics,
    total,
    hasMore: epics.length < total,
    isLoading,
    isLoadingMore,
    error,
    loadMore,
    refetch,
  };
}
