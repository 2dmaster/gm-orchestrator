import { useState, useEffect, useCallback } from 'react';
import type { StatusResponse, Pipeline, PipelineRun } from '../types';
import type { UseWebSocketReturn } from './useWebSocket';

export interface UseOrchestratorReturn {
  startSprint: (projectId: string, tag?: string) => Promise<void>;
  startEpic: (projectId: string, epicId: string) => Promise<void>;
  startTasks: (projectId: string, taskIds: string[]) => Promise<void>;
  stop: () => Promise<void>;
  stopProject: (projectId: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  pauseProject: (projectId: string) => Promise<void>;
  resumeProject: (projectId: string) => Promise<void>;
  isProjectPaused: (projectId: string) => boolean;
  isRunning: boolean;
  isPaused: boolean;
  isProjectRunning: (projectId: string) => boolean;
  runningProjectIds: string[];
  pausedProjectIds: string[];
  status: StatusResponse | null;
  // Pipeline
  pipelines: Pipeline[];
  pipelineRuns: PipelineRun[];
  startPipeline: (pipelineId: string) => Promise<void>;
  stopPipeline: (pipelineRunId: string) => Promise<void>;
  pausePipeline: (pipelineRunId: string) => Promise<void>;
  resumePipeline: (pipelineRunId: string) => Promise<void>;
  fetchPipelines: () => Promise<void>;
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
  const [paused, setPaused] = useState(false);
  const [pausedProjects, setPausedProjects] = useState<Set<string>>(new Set());
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRun[]>([]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
      setRunningIds(new Set(data.runningProjectIds ?? []));
      setPaused(data.isPaused ?? false);
    } catch {
      // Ignore fetch errors — server may not be ready yet
    }
  }, []);

  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetch('/api/pipelines');
      if (!res.ok) return;
      const data = await res.json() as { pipelines: Pipeline[] };
      setPipelines(data.pipelines);
    } catch {
      // non-critical
    }
  }, []);

  const fetchPipelineRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/pipelines/run/status');
      if (!res.ok) return;
      const data = await res.json() as { runs: PipelineRun[] };
      setPipelineRuns(data.runs);
    } catch {
      // non-critical
    }
  }, []);

  // Initial status fetch
  useEffect(() => {
    fetchStatus();
    fetchPipelines();
    fetchPipelineRuns();
  }, [fetchStatus, fetchPipelines, fetchPipelineRuns]);

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
      case 'run:paused':
        setPaused(true);
        break;
      case 'run:resumed':
        setPaused(false);
        break;
      case 'run:project_paused': {
        const ppid = (evt as { payload?: { projectId?: string } }).payload?.projectId;
        if (ppid) {
          setPausedProjects((prev) => new Set([...prev, ppid]));
        }
        break;
      }
      case 'run:project_resumed': {
        const rpid = (evt as { payload?: { projectId?: string } }).payload?.projectId;
        if (rpid) {
          setPausedProjects((prev) => {
            const next = new Set(prev);
            next.delete(rpid);
            return next;
          });
        }
        break;
      }
      case 'pipeline:started':
      case 'pipeline:stage_started':
      case 'pipeline:stage_completed':
      case 'pipeline:complete':
        fetchPipelineRuns();
        break;
    }
  }, [ws.lastEvent, fetchStatus, fetchPipelineRuns]);

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

  const pause = useCallback(async () => {
    await post('/api/run/pause');
    setPaused(true);
  }, []);

  const resume = useCallback(async () => {
    await post('/api/run/resume');
    setPaused(false);
  }, []);

  const pauseProject = useCallback(async (projectId: string) => {
    await post('/api/run/pause-project', { projectId });
    setPausedProjects((prev) => new Set([...prev, projectId]));
  }, []);

  const resumeProject = useCallback(async (projectId: string) => {
    await post('/api/run/resume-project', { projectId });
    setPausedProjects((prev) => {
      const next = new Set(prev);
      next.delete(projectId);
      return next;
    });
  }, []);

  const isProjectPaused = useCallback(
    (projectId: string) => pausedProjects.has(projectId),
    [pausedProjects],
  );

  const startPipeline = useCallback(async (pipelineId: string) => {
    await post('/api/pipelines/run', { pipelineId });
    fetchPipelineRuns();
  }, [fetchPipelineRuns]);

  const stopPipeline = useCallback(async (pipelineRunId: string) => {
    await post('/api/pipelines/run/stop', { pipelineRunId });
    fetchPipelineRuns();
  }, [fetchPipelineRuns]);

  const pausePipeline = useCallback(async (pipelineRunId: string) => {
    await post('/api/pipelines/run/pause', { pipelineRunId });
  }, []);

  const resumePipeline = useCallback(async (pipelineRunId: string) => {
    await post('/api/pipelines/run/resume', { pipelineRunId });
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
    pause,
    resume,
    pauseProject,
    resumeProject,
    isProjectPaused,
    isRunning: runningIds.size > 0,
    isPaused: paused,
    isProjectRunning,
    runningProjectIds: [...runningIds],
    pausedProjectIds: [...pausedProjects],
    status,
    pipelines,
    pipelineRuns,
    startPipeline,
    stopPipeline,
    pausePipeline,
    resumePipeline,
    fetchPipelines,
  };
}
