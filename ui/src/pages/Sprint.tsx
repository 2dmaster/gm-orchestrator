import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { Check, X, Circle, Loader2, Square, ArrowLeft, ChevronDown, ChevronRight, Zap, Coins, RotateCw, Clock, AlertTriangle, XCircle, Rocket } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useWebSocket } from "../hooks/useWebSocket";
import { useOrchestrator } from "../hooks/useOrchestrator";
import Shell from "../components/Shell";
import LogStream from "../components/LogStream";
import AgentActivity, { EMPTY_AGENT_STATE, type AgentState, type AgentToolEvent } from "../components/AgentActivity";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import type { Task, SprintStats, ServerEvent, StatusResponse } from "../types";

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${String(rem).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatMMSS(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Wraps a stat value and triggers a CSS pulse animation on change */
function PulseStat({ children, value }: { children: React.ReactNode; value: string | number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current !== value && ref.current) {
      ref.current.classList.remove("stat-pulse");
      // Force reflow to restart animation
      void ref.current.offsetWidth;
      ref.current.classList.add("stat-pulse");
    }
    prevValue.current = value;
  }, [value]);

  return <span ref={ref} className="flex items-center gap-1 px-1.5 py-0.5">{children}</span>;
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

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger className="flex-1 min-w-0 text-left">
            <span className={`block truncate ${task.status === "cancelled" ? "line-through text-muted-foreground" : ""}`}>
              {task.title}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm">
            {task.title}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

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
  const [agentState, setAgentState] = useState<AgentState>(EMPTY_AGENT_STATE);
  const [showRawLog, setShowRawLog] = useState(false);
  const [runStartTime, setRunStartTime] = useState<number>(Date.now());
  const [warningCount, setWarningCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const eventIdRef = useRef(0);

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
        setRunStartTime(Date.now());
        setCompletionStats(null);
        setStopped(false);
        setSprintTasks(new Map());
        setLogLines([]);
        setCurrentTaskId(null);
        setCurrentTaskTitle("");
        setWarningCount(0);
        setErrorCount(0);
        break;

      case "task:started": {
        const t = evt.payload.task;
        setCurrentTaskId(t.id);
        setCurrentTaskTitle(t.title);
        setLogLines([]);
        setAgentState(EMPTY_AGENT_STATE);
        eventIdRef.current = 0;
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

      case "agent:tool_start": {
        const toolEvt: AgentToolEvent = {
          id: ++eventIdRef.current,
          kind: "tool_start",
          tool: evt.payload.tool,
          detail: evt.payload.input,
          timestamp: Date.now(),
        };
        setAgentState((prev) => ({
          ...prev,
          thinking: false,
          events: [...prev.events, toolEvt],
        }));
        break;
      }

      case "agent:tool_end": {
        const toolEvt: AgentToolEvent = {
          id: ++eventIdRef.current,
          kind: "tool_end",
          tool: evt.payload.tool,
          detail: evt.payload.output,
          timestamp: Date.now(),
        };
        setAgentState((prev) => ({
          ...prev,
          events: [...prev.events, toolEvt],
        }));
        break;
      }

      case "agent:thinking":
        setAgentState((prev) => ({ ...prev, thinking: true, thinkingText: evt.payload.text }));
        break;

      case "agent:turn":
        setAgentState((prev) => ({ ...prev, turn: evt.payload.turn, thinking: false }));
        break;

      case "agent:cost":
        setAgentState((prev) => ({
          ...prev,
          costUsd: evt.payload.costUsd,
          inputTokens: evt.payload.inputTokens,
          outputTokens: evt.payload.outputTokens,
        }));
        break;

      case "agent:warning":
        setAgentState((prev) => ({ ...prev, warning: evt.payload.message }));
        setWarningCount((c) => c + 1);
        toast.warning(evt.payload.message);
        break;

      case "run:complete":
        setCompletionStats(evt.payload);
        setRunActive(false);
        setCurrentTaskId(null);
        toast.success("Run complete!");
        break;

      case "run:stopped":
        setStopped(true);
        setRunActive(false);
        setCurrentTaskId(null);
        break;

      case "error":
        setLogLines((prev) => [...prev, `[ERROR] ${evt.payload.message}`]);
        setErrorCount((c) => c + 1);
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
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center">
              <Rocket className="w-7 h-7 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium text-foreground">No active run</p>
              <p className="text-sm text-muted-foreground mt-1">
                Start a sprint from the Dashboard to see progress here.
              </p>
            </div>
          </div>
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
                <h2 className="text-lg font-semibold">Run Complete</h2>
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
        <div className="px-6 py-4 border-b border-border space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">Run</h1>
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

        {/* Sticky stats bar — always visible during active run */}
        {(agentState.turn > 0 || agentState.costUsd > 0 || currentTaskId) && (
          <div className="shrink-0 px-6 py-2 border-b border-border bg-background/80 backdrop-blur-sm flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono">
            {currentTaskTitle && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger className="max-w-[200px] min-w-0 text-left">
                    <span className="block text-foreground/80 font-semibold truncate">
                      {currentTaskTitle}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-sm">
                    {currentTaskTitle}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            <PulseStat value={elapsedMs}>
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="tabular-nums text-muted-foreground">{formatMMSS(elapsedMs)}</span>
            </PulseStat>

            <PulseStat value={agentState.turn}>
              <RotateCw className="w-3 h-3 text-muted-foreground" />
              <span className="tabular-nums text-muted-foreground">Turn {agentState.turn}</span>
            </PulseStat>

            {(agentState.inputTokens > 0 || agentState.outputTokens > 0) && (
              <PulseStat value={agentState.inputTokens + agentState.outputTokens}>
                <Zap className="w-3 h-3 text-muted-foreground" />
                <span className="tabular-nums text-muted-foreground">
                  {formatTokens(agentState.inputTokens)}&#8593; {formatTokens(agentState.outputTokens)}&#8595;
                </span>
              </PulseStat>
            )}

            {warningCount > 0 && (
              <PulseStat value={warningCount}>
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <span className="tabular-nums text-amber-400">{warningCount}</span>
              </PulseStat>
            )}

            {errorCount > 0 && (
              <PulseStat value={errorCount}>
                <XCircle className="w-3 h-3 text-red-400" />
                <span className="tabular-nums text-red-400">{errorCount}</span>
              </PulseStat>
            )}

            <span className="flex-1" />

            {agentState.costUsd > 0 && (
              <PulseStat value={agentState.costUsd.toFixed(2)}>
                <Coins className="w-3 h-3 text-muted-foreground" />
                <span className="tabular-nums text-muted-foreground">${agentState.costUsd.toFixed(2)}</span>
              </PulseStat>
            )}
          </div>
        )}

        {/* Task list — capped height, scrolls independently */}
        <div className="border-b border-border max-h-[150px] overflow-y-auto divide-y divide-border/50 shrink-0">
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

        {/* Agent activity + log stream — fills remaining viewport, scrolls internally */}
        <div className="flex-1 px-6 py-3 flex flex-col min-h-0 overflow-hidden gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {currentTaskTitle ? `Trace: ${currentTaskTitle}` : "Agent Activity"}
            </p>
            <button
              onClick={() => setShowRawLog((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors uppercase tracking-wider"
            >
              {showRawLog ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Raw log
            </button>
          </div>

          <div className={`flex-1 min-h-0 ${showRawLog ? "hidden" : "flex flex-col"}`}>
            <AgentActivity state={agentState} runStartTime={runStartTime} />
          </div>

          <div className={`flex-1 min-h-0 ${showRawLog ? "" : "hidden"}`}>
            <LogStream lines={logLines} taskId={currentTaskId ?? ""} />
          </div>
        </div>
      </div>
    </Shell>
  );
}
