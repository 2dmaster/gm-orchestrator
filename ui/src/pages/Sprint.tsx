import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { Check, X, Circle, Loader2, Square, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useWebSocket } from "../hooks/useWebSocket";
import { useOrchestrator } from "../hooks/useOrchestrator";
import Shell from "../components/Shell";
import LogStream from "../components/LogStream";
import type { Task, SprintStats, ServerEvent, StatusResponse } from "../types";

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${String(rem).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

interface SprintTask {
  task: Task;
  startedAt?: number;
  finishedAt?: number;
}

function SprintTaskRow({ item }: { item: SprintTask }) {
  const { task, startedAt, finishedAt } = item;
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
    <div className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
      task.status === "done" ? "opacity-60 task-done" : ""
    } ${task.status === "cancelled" ? "opacity-50" : ""}`}>
      {task.status === "done" && <Check className="w-4 h-4 text-[var(--color-done)] shrink-0" />}
      {task.status === "in_progress" && (
        <div className="w-4 h-4 rounded-full bg-primary shrink-0 animate-pulse-dot" />
      )}
      {task.status === "todo" && <Circle className="w-4 h-4 text-muted-foreground shrink-0" />}
      {task.status === "cancelled" && <X className="w-4 h-4 text-[var(--color-cancelled)] shrink-0" />}

      <span className={`flex-1 truncate ${task.status === "cancelled" ? "line-through text-muted-foreground" : ""}`}>
        {task.title}
      </span>

      {elapsed && (
        <span className="text-xs text-muted-foreground font-mono shrink-0">{elapsed}</span>
      )}

      {task.status === "done" && (
        <span className="text-[10px] text-[var(--color-done)]">done</span>
      )}
    </div>
  );
}

function useElapsedTimer(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (!active) return;
    startRef.current = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 1000);
    return () => clearInterval(id);
  }, [active]);

  return elapsed;
}

export default function Sprint() {
  const ws = useWebSocket();
  const orchestrator = useOrchestrator(ws);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [sprintTasks, setSprintTasks] = useState<Map<string, SprintTask>>(new Map());
  const [logLines, setLogLines] = useState<string[]>([]);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [currentTaskTitle, setCurrentTaskTitle] = useState<string>("");
  const [completionStats, setCompletionStats] = useState<SprintStats | null>(null);
  const [stopped, setStopped] = useState(false);
  const [runActive, setRunActive] = useState(false);

  const initializedRef = useRef(false);
  const elapsedMs = useElapsedTimer(runActive);

  // Fetch status + bootstrap run state for late connections
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) return;
        const data = (await res.json()) as StatusResponse;
        if (data.config?.activeProjectId) setProjectId(data.config.activeProjectId);

        // Bootstrap from existing run snapshot
        if (data.isRunning && data.run) {
          initializedRef.current = true;
          setRunActive(true);
          const tasks = new Map<string, SprintTask>();
          for (const t of data.run.completedTasks) {
            tasks.set(t.id, { task: t });
          }
          if (data.run.activeTask) {
            const t = data.run.activeTask;
            tasks.set(t.id, { task: { ...t, status: "in_progress" }, startedAt: Date.now() });
            setCurrentTaskId(t.id);
            setCurrentTaskTitle(t.title);
          }
          setSprintTasks(tasks);
          setLogLines(data.run.recentLines);
        }
      } catch { /* ignore */ }
    })();
  }, []);

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
      case "run:started":
        initializedRef.current = true;
        setRunActive(true);
        setCompletionStats(null);
        setStopped(false);
        setSprintTasks(new Map());
        setLogLines([]);
        setCurrentTaskId(null);
        setCurrentTaskTitle("");
        break;

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
          next.set(t.id, { task: { ...t }, startedAt: existing?.startedAt, finishedAt: now });
          return next;
        });
        if (currentTaskId === t.id) setCurrentTaskId(null);
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

      case "log:line":
        setLogLines((prev) => [...prev, evt.payload.line]);
        break;

      case "run:complete":
        setCompletionStats(evt.payload);
        setRunActive(false);
        setCurrentTaskId(null);
        toast.success("Sprint complete!");
        break;

      case "run:stopped":
        setStopped(true);
        setRunActive(false);
        setCurrentTaskId(null);
        break;

      case "error":
        setLogLines((prev) => [...prev, `[ERROR] ${evt.payload.message}`]);
        toast.error(evt.payload.message);
        break;
    }
  }, [ws.lastEvent, currentTaskId]);

  const taskList = useMemo(() => Array.from(sprintTasks.values()), [sprintTasks]);
  const doneCount = useMemo(() => taskList.filter((t) => t.task.status === "done").length, [taskList]);
  const totalCount = taskList.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const handleStop = useCallback(async () => {
    try {
      await orchestrator.stop();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [orchestrator]);

  const taskCount = taskList.length;

  // No active run
  if (!runActive && !completionStats && !stopped) {
    return (
      <Shell projectId={projectId} taskCount={0}>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-lg text-muted-foreground">No active run</p>
          <Link to="/dashboard" className={buttonVariants()}>Go to Dashboard</Link>
        </div>
      </Shell>
    );
  }

  // Completion summary
  if (completionStats) {
    const s = completionStats;
    return (
      <Shell projectId={projectId} taskCount={taskCount}>
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          <Card className="w-full max-w-md">
            <CardContent className="py-8 space-y-6">
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-full bg-[var(--color-done)]/20 flex items-center justify-center">
                  <Check className="w-6 h-6 text-[var(--color-done)]" />
                </div>
                <h2 className="text-lg font-semibold">Sprint Complete</h2>
                <p className="text-sm text-muted-foreground">{formatElapsed(s.durationMs)}</p>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-2xl font-semibold text-[var(--color-done)]">{s.done}</p>
                  <p className="text-[10px] text-muted-foreground">Done</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-[var(--color-cancelled)]">{s.cancelled}</p>
                  <p className="text-[10px] text-muted-foreground">Cancelled</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-muted-foreground">{s.skipped}</p>
                  <p className="text-[10px] text-muted-foreground">Skipped</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {taskList.length > 0 && (
            <Card className="w-full max-w-2xl">
              <CardContent className="py-2 divide-y divide-border">
                {taskList.map((item) => (
                  <SprintTaskRow key={item.task.id} item={item} />
                ))}
              </CardContent>
            </Card>
          )}

          <Link to="/dashboard" className={buttonVariants({ className: "gap-2" })}>
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </Link>
        </div>
      </Shell>
    );
  }

  // Stopped
  if (stopped && !runActive) {
    return (
      <Shell projectId={projectId} taskCount={taskCount}>
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
          <h2 className="text-lg font-semibold text-yellow-400">Run Stopped</h2>
          {taskList.length > 0 && (
            <Card className="w-full max-w-2xl">
              <CardContent className="py-2 divide-y divide-border">
                {taskList.map((item) => (
                  <SprintTaskRow key={item.task.id} item={item} />
                ))}
              </CardContent>
            </Card>
          )}
          <Link to="/dashboard" className={buttonVariants()}>Back to Dashboard</Link>
        </div>
      </Shell>
    );
  }

  // Active run
  return (
    <Shell projectId={projectId} taskCount={taskCount}>
      <div className="flex flex-col h-full">
        {/* Top bar: progress + stop */}
        <div className="px-6 py-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">Sprint</h1>
              <p className="text-xs text-muted-foreground">
                {runActive ? "Running" : "Idle"} &middot; {formatElapsed(elapsedMs)} elapsed
              </p>
            </div>
            <Button variant="destructive" size="sm" onClick={handleStop} className="gap-1.5">
              <Square className="w-3.5 h-3.5" /> Stop
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Progress value={progressPct} className="flex-1 h-2" />
            <span className="text-xs text-muted-foreground font-mono shrink-0">
              {doneCount} / {totalCount}
            </span>
          </div>
        </div>

        {/* Task list */}
        <div className="border-b border-border max-h-[40vh] overflow-y-auto divide-y divide-border/50">
          {taskList.length === 0 ? (
            <div className="px-6 py-4 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Waiting for tasks...
            </div>
          ) : (
            taskList.map((item) => (
              <SprintTaskRow key={item.task.id} item={item} />
            ))
          )}
        </div>

        {/* Log stream */}
        <div className="flex-1 px-6 py-4 flex flex-col min-h-0">
          <p className="text-xs text-muted-foreground mb-2 font-mono">
            Claude{currentTaskTitle ? ` — ${currentTaskTitle}` : ""}
          </p>
          <div className="flex-1 min-h-0">
            <LogStream lines={logLines} taskId={currentTaskId ?? ""} />
          </div>
        </div>
      </div>
    </Shell>
  );
}
