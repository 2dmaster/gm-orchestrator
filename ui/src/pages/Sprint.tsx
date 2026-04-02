import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useWebSocket } from "../hooks/useWebSocket";
import { useOrchestrator } from "../hooks/useOrchestrator";
import ProgressBar from "../components/ProgressBar";
import LogStream from "../components/LogStream";
import type { Task, SprintStats, ServerEvent } from "../types";

// ─── Status indicators ─────────────────────────────────────────────────

const statusIcon: Record<string, { icon: string; cls: string }> = {
  done:        { icon: "✓", cls: "text-green-400" },
  in_progress: { icon: "▶", cls: "text-accent animate-pulse" },
  todo:        { icon: "○", cls: "text-gray-500" },
  cancelled:   { icon: "✗", cls: "text-red-400" },
};

// ─── Elapsed time formatting ────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${String(rem).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ─── Task row with live timer ───────────────────────────────────────────

interface SprintTask {
  task: Task;
  startedAt?: number; // epoch ms
  finishedAt?: number;
}

function TaskRow({ item }: { item: SprintTask }) {
  const { task, startedAt, finishedAt } = item;
  const si = statusIcon[task.status] ?? statusIcon.todo;
  const isRunning = task.status === "in_progress";

  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!startedAt) { setElapsed(""); return; }
    if (finishedAt) { setElapsed(formatElapsed(finishedAt - startedAt)); return; }
    if (!isRunning) { setElapsed(formatElapsed(Date.now() - startedAt)); return; }

    const update = () => setElapsed(formatElapsed(Date.now() - startedAt));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt, finishedAt, isRunning]);

  return (
    <div className="flex items-center gap-3 px-3 py-2 font-mono text-sm border-b border-gray-800/60 last:border-b-0">
      <span className={`w-5 text-center ${si.cls}`}>{si.icon}</span>
      <span className="flex-1 truncate text-text">{task.title}</span>
      <span className="text-gray-500 text-xs w-20 text-right">
        {task.status === "done" ? "done" : task.status === "in_progress" ? "running" : task.status === "cancelled" ? "cancelled" : "queued"}
      </span>
      <span className="text-gray-500 text-xs w-20 text-right">{elapsed}</span>
      {isRunning && (
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
      )}
    </div>
  );
}

// ─── Sprint page ────────────────────────────────────────────────────────

export default function Sprint() {
  const ws = useWebSocket();
  const orchestrator = useOrchestrator(ws);

  const [sprintTasks, setSprintTasks] = useState<Map<string, SprintTask>>(new Map());
  const [logLines, setLogLines] = useState<string[]>([]);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [currentTaskTitle, setCurrentTaskTitle] = useState<string>("");
  const [completionStats, setCompletionStats] = useState<SprintStats | null>(null);
  const [stopped, setStopped] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [runActive, setRunActive] = useState(false);

  // Track whether we've seen a run:started event (or server says isRunning)
  const initializedRef = useRef(false);

  useEffect(() => {
    if (orchestrator.isRunning && !initializedRef.current) {
      setRunActive(true);
      initializedRef.current = true;
    }
  }, [orchestrator.isRunning]);

  // Process WebSocket events
  useEffect(() => {
    if (!ws.lastEvent) return;
    const evt = ws.lastEvent as ServerEvent;

    switch (evt.type) {
      case "run:started": {
        initializedRef.current = true;
        setRunActive(true);
        setCompletionStats(null);
        setStopped(false);
        setSprintTasks(new Map());
        setLogLines([]);
        setCurrentTaskId(null);
        setCurrentTaskTitle("");
        break;
      }

      case "task:started": {
        const t = evt.payload.task;
        setCurrentTaskId(t.id);
        setCurrentTaskTitle(t.title);
        setLogLines([]);
        setSprintTasks((prev) => {
          const next = new Map(prev);
          next.set(t.id, { task: { ...t, status: "in_progress" }, startedAt: Date.now() });
          return next;
        });
        break;
      }

      case "task:done":
      case "task:cancelled":
      case "task:timeout": {
        const t = evt.payload.task;
        const now = Date.now();
        setSprintTasks((prev) => {
          const next = new Map(prev);
          const existing = next.get(t.id);
          next.set(t.id, {
            task: { ...t },
            startedAt: existing?.startedAt,
            finishedAt: now,
          });
          return next;
        });
        if (currentTaskId === t.id) {
          setCurrentTaskId(null);
        }
        break;
      }

      case "task:retrying": {
        const t = evt.payload.task;
        setSprintTasks((prev) => {
          const next = new Map(prev);
          next.set(t.id, { task: { ...t, status: "in_progress" }, startedAt: Date.now() });
          return next;
        });
        setCurrentTaskId(t.id);
        setCurrentTaskTitle(t.title);
        setLogLines([]);
        break;
      }

      case "log:line": {
        setLogLines((prev) => [...prev, evt.payload.line]);
        break;
      }

      case "run:complete": {
        setCompletionStats(evt.payload);
        setRunActive(false);
        setCurrentTaskId(null);
        break;
      }

      case "run:stopped": {
        setStopped(true);
        setRunActive(false);
        setCurrentTaskId(null);
        break;
      }

      case "error": {
        setLogLines((prev) => [...prev, `[ERROR] ${evt.payload.message}`]);
        break;
      }
    }
  }, [ws.lastEvent, currentTaskId]);

  // Derived stats
  const taskList = useMemo(() => Array.from(sprintTasks.values()), [sprintTasks]);
  const doneCount = useMemo(() => taskList.filter((t) => t.task.status === "done").length, [taskList]);
  const totalCount = taskList.length;

  const handleStop = useCallback(async () => {
    setStopError(null);
    try {
      await orchestrator.stop();
    } catch (err) {
      setStopError((err as Error).message);
    }
  }, [orchestrator]);

  // ─── No active run ────────────────────────────────────────────────────
  if (!runActive && !completionStats && !stopped) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="font-mono text-text/60 text-lg">No active run</p>
        <Link
          to="/dashboard"
          className="px-4 py-2 bg-accent text-bg font-mono text-sm rounded hover:bg-accent/90 transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    );
  }

  // ─── Completion summary ───────────────────────────────────────────────
  if (completionStats) {
    const stats = completionStats;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6">
        <h1 className="text-2xl font-mono text-accent">Run Complete</h1>
        <div className="grid grid-cols-2 gap-4 font-mono text-sm">
          <span className="text-text/60">Done:</span>
          <span className="text-green-400">{stats.done}</span>
          <span className="text-text/60">Cancelled:</span>
          <span className="text-red-400">{stats.cancelled}</span>
          <span className="text-text/60">Retried:</span>
          <span className="text-yellow-400">{stats.retried}</span>
          <span className="text-text/60">Errors:</span>
          <span className="text-red-400">{stats.errors}</span>
          <span className="text-text/60">Skipped:</span>
          <span className="text-gray-400">{stats.skipped}</span>
          <span className="text-text/60">Duration:</span>
          <span className="text-text">{formatElapsed(stats.durationMs)}</span>
        </div>

        {taskList.length > 0 && (
          <div className="w-full max-w-2xl border border-gray-800 rounded-md mt-4">
            {taskList.map((item) => (
              <TaskRow key={item.task.id} item={item} />
            ))}
          </div>
        )}

        <Link
          to="/dashboard"
          className="mt-4 px-4 py-2 bg-accent text-bg font-mono text-sm rounded hover:bg-accent/90 transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  // ─── Stopped state ────────────────────────────────────────────────────
  if (stopped && !runActive) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-xl font-mono text-yellow-400">Run Stopped</h1>

        {taskList.length > 0 && (
          <div className="w-full max-w-2xl border border-gray-800 rounded-md mt-2">
            {taskList.map((item) => (
              <TaskRow key={item.task.id} item={item} />
            ))}
          </div>
        )}

        <Link
          to="/dashboard"
          className="mt-4 px-4 py-2 bg-accent text-bg font-mono text-sm rounded hover:bg-accent/90 transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  // ─── Active run ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header with progress and stop */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h1 className="text-lg font-mono text-accent">Sprint</h1>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-text/60">
              {doneCount}/{totalCount} tasks
            </span>
            <button
              onClick={handleStop}
              className="px-4 py-1.5 bg-red-900/40 border border-red-700 text-red-400 font-mono text-sm rounded hover:bg-red-900/60 transition-colors"
            >
              Stop
            </button>
          </div>
        </div>
        <ProgressBar completed={doneCount} total={totalCount} />
        {stopError && (
          <p className="text-red-400 font-mono text-xs mt-2">{stopError}</p>
        )}
      </header>

      {/* Task list */}
      <div className="border-b border-gray-800 max-h-[40vh] overflow-y-auto">
        {taskList.length === 0 ? (
          <div className="px-6 py-4 font-mono text-sm text-text/40 flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            Waiting for tasks...
          </div>
        ) : (
          taskList.map((item) => (
            <TaskRow key={item.task.id} item={item} />
          ))
        )}
      </div>

      {/* Log stream */}
      <div className="flex-1 px-6 py-4 flex flex-col min-h-0">
        <h2 className="font-mono text-sm text-text/60 mb-2">
          Claude log{currentTaskTitle ? ` — ${currentTaskTitle}` : ""}
        </h2>
        <div className="flex-1 min-h-0">
          <LogStream lines={logLines} taskId={currentTaskId ?? ""} />
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-6 py-3 flex items-center">
        <Link to="/dashboard" className="font-mono text-xs text-text/40 hover:text-text/60 transition-colors">
          ← Dashboard
        </Link>
        <span className="flex-1" />
        <span className={`font-mono text-xs ${ws.isConnected ? "text-green-400" : "text-red-400"}`}>
          {ws.isConnected ? "WS connected" : "WS disconnected"}
        </span>
      </footer>
    </div>
  );
}
