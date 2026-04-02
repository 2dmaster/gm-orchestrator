import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useWebSocket } from "../hooks/useWebSocket";
import { useTasks } from "../hooks/useTasks";
import { useOrchestrator } from "../hooks/useOrchestrator";
import TaskCard from "../components/TaskCard";
import type { Epic } from "../types";

// ─── Priority ordering ─────────────────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ─── Epics hook ─────────────────────────────────────────────────────────

function useEpics(projectId: string | null) {
  const [epics, setEpics] = useState<Epic[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchEpics = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/epics`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { epics: Epic[] };
      setEpics(data.epics);
    } catch {
      // Epics fetch failed — non-critical
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchEpics();
  }, [fetchEpics]);

  return { epics, isLoading, refetch: fetchEpics };
}

// ─── Dashboard ──────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const ws = useWebSocket();

  // Get project ID from server status
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) return;
        const data = await res.json();
        if (data.config?.projectId) {
          setProjectId(data.config.projectId);
        } else {
          navigate("/", { replace: true });
        }
      } catch {
        // Server not ready
      }
    })();
  }, [navigate]);

  const { tasks, isLoading: tasksLoading } = useTasks(projectId, ws);
  const orchestrator = useOrchestrator(ws);
  const { epics, isLoading: epicsLoading } = useEpics(projectId);

  const [selectedEpicId, setSelectedEpicId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Sort tasks by priority
  const sortedTasks = useMemo(
    () =>
      [...tasks].sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3)
      ),
    [tasks]
  );

  // Stats
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const doneToday = useMemo(
    () => tasks.filter((t) => t.status === "done" && t.completedAt && t.completedAt >= todayStart).length,
    [tasks, todayStart]
  );

  const cancelledToday = useMemo(
    () => tasks.filter((t) => t.status === "cancelled" && t.completedAt && t.completedAt >= todayStart).length,
    [tasks, todayStart]
  );

  const totalTasks = tasks.length;

  // Actions
  const handleRunSprint = useCallback(async () => {
    if (!projectId) return;
    setActionError(null);
    try {
      await orchestrator.startSprint(projectId);
      navigate("/sprint");
    } catch (err) {
      setActionError((err as Error).message);
    }
  }, [projectId, orchestrator, navigate]);

  const handleRunEpic = useCallback(async () => {
    if (!projectId || !selectedEpicId) return;
    setActionError(null);
    try {
      await orchestrator.startEpic(projectId, selectedEpicId);
      navigate("/sprint");
    } catch (err) {
      setActionError((err as Error).message);
    }
  }, [projectId, selectedEpicId, orchestrator, navigate]);

  if (!projectId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-mono text-accent">gm-orchestrator</h1>
          <span className="text-text/60 font-mono text-sm">{projectId}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm text-text/60">
            <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${orchestrator.isRunning ? "bg-green-400 animate-pulse" : "bg-gray-500"}`} />
            {totalTasks} tasks
          </span>
          <Link
            to="/settings"
            className="text-text/40 hover:text-text/80 font-mono text-sm transition-colors"
          >
            Settings
          </Link>
        </div>
      </header>

      {/* Action bar */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-3 flex-wrap">
        <button
          onClick={handleRunSprint}
          disabled={orchestrator.isRunning}
          className="px-4 py-2 bg-accent text-bg font-mono text-sm rounded hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {orchestrator.isRunning ? (
            <>
              <div className="w-3 h-3 border-2 border-bg border-t-transparent rounded-full animate-spin" />
              Running...
            </>
          ) : (
            <>&#9654; Run Sprint</>
          )}
        </button>

        <div className="flex items-center gap-2">
          <select
            value={selectedEpicId}
            onChange={(e) => setSelectedEpicId(e.target.value)}
            disabled={orchestrator.isRunning || epicsLoading}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded font-mono text-sm text-text focus:border-accent focus:outline-none disabled:opacity-50"
          >
            <option value="">Select Epic...</option>
            {epics.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <button
            onClick={handleRunEpic}
            disabled={!selectedEpicId || orchestrator.isRunning}
            className="px-4 py-2 bg-accent/20 border border-accent text-accent font-mono text-sm rounded hover:bg-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Run Epic
          </button>
        </div>

        {actionError && (
          <span className="text-red-400 font-mono text-xs">{actionError}</span>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Tasks column */}
          <div className="lg:col-span-2 space-y-3">
            <h2 className="text-sm font-mono text-text/60 uppercase tracking-wider mb-2">
              Tasks
            </h2>

            {tasksLoading && tasks.length === 0 ? (
              <div className="flex items-center gap-3 text-text/40 font-mono text-sm py-8">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                Loading tasks...
              </div>
            ) : sortedTasks.length === 0 ? (
              <p className="text-text/40 font-mono text-sm py-8">No tasks found.</p>
            ) : (
              <div className="space-y-2">
                {sortedTasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            )}
          </div>

          {/* Epics column */}
          <div className="space-y-3">
            <h2 className="text-sm font-mono text-text/60 uppercase tracking-wider mb-2">
              Epics
            </h2>

            {epicsLoading && epics.length === 0 ? (
              <div className="flex items-center gap-3 text-text/40 font-mono text-sm py-4">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                Loading...
              </div>
            ) : epics.length === 0 ? (
              <p className="text-text/40 font-mono text-sm py-4">No epics found.</p>
            ) : (
              <div className="space-y-2">
                {epics.map((epic) => (
                  <div
                    key={epic.id}
                    className="flex items-center justify-between px-3 py-2.5 bg-gray-900/50 border border-gray-800 rounded-md font-mono text-sm hover:border-gray-700 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          epic.status === "done"
                            ? "bg-green-500"
                            : epic.status === "in_progress"
                              ? "bg-accent animate-pulse"
                              : "bg-gray-600"
                        }`}
                      />
                      <span className="truncate text-text">{epic.title}</span>
                    </div>
                    <span className="text-text/40 text-xs shrink-0 ml-2">
                      {epic.tasks?.length ?? 0}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer stats */}
      <footer className="border-t border-gray-800 px-6 py-3 flex items-center gap-6">
        <span className="font-mono text-xs text-text/40">
          Done today: <span className="text-green-400">{doneToday}</span>
        </span>
        <span className="font-mono text-xs text-text/40">
          Cancelled: <span className="text-red-400">{cancelledToday}</span>
        </span>
        <span className="flex-1" />
        <span className={`font-mono text-xs ${ws.isConnected ? "text-green-400" : "text-red-400"}`}>
          {ws.isConnected ? "WS connected" : "WS disconnected"}
        </span>
      </footer>
    </div>
  );
}
