import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { Check, X, Circle, Loader2, Square, ChevronDown, ChevronRight, Zap, Coins, RotateCw, Clock, AlertTriangle, XCircle, Rocket, StopCircle, Pause, Play } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
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
import type { Task, SprintStats, ServerEvent, Pipeline, PipelineRun, PipelineStageStatus } from "../types";
import { Badge } from "@/components/ui/badge";

// ─── Helpers ────────────────────────────────────────────────────────────

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

function PulseStat({ children, value }: { children: React.ReactNode; value: string | number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current !== value && ref.current) {
      ref.current.classList.remove("stat-pulse");
      void ref.current.offsetWidth;
      ref.current.classList.add("stat-pulse");
    }
    prevValue.current = value;
  }, [value]);

  return <span ref={ref} className="flex items-center gap-1 px-1.5 py-0.5">{children}</span>;
}

// ─── Types ──────────────────────────────────────────────────────────────

interface SprintTask {
  task: Task;
  startedAt?: number;
  finishedAt?: number;
}

interface RunEntry {
  projectId: string;
  status: "running" | "completed" | "stopped";
  startedAt: number;
  finishedAt?: number;
  stats?: SprintStats;
  tasks: Map<string, SprintTask>;
  agentState: AgentState;
  logLines: string[];
  currentTaskId: string | null;
  currentTaskTitle: string;
  warningCount: number;
  errorCount: number;
  eventIdCounter: number;
}

function createRunEntry(projectId: string): RunEntry {
  return {
    projectId,
    status: "running",
    startedAt: Date.now(),
    tasks: new Map(),
    agentState: EMPTY_AGENT_STATE,
    logLines: [],
    currentTaskId: null,
    currentTaskTitle: "",
    warningCount: 0,
    errorCount: 0,
    eventIdCounter: 0,
  };
}

// ─── SprintTaskRow ──────────────────────────────────────────────────────

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

// ─── Run sidebar card ───────────────────────────────────────────────────

function RunCard({
  run,
  isSelected,
  isPaused,
  onSelect,
  onStop,
  onPause,
  onResume,
}: {
  run: RunEntry;
  isSelected: boolean;
  isPaused: boolean;
  onSelect: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const taskList = Array.from(run.tasks.values());
  const doneCount = taskList.filter((t) => t.task.status === "done").length;
  const totalCount = taskList.length;
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (run.finishedAt) {
      setElapsed(formatElapsed(run.finishedAt - run.startedAt));
      return;
    }
    if (run.status !== "running") return;
    const update = () => setElapsed(formatElapsed(Date.now() - run.startedAt));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [run.startedAt, run.finishedAt, run.status]);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-lg border p-3 space-y-2 transition-all ${
        isSelected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border hover:border-primary/30"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {run.status === "running" && (
            <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0 animate-pulse" />
          )}
          {run.status === "completed" && (
            <Check className="w-3.5 h-3.5 text-[var(--color-done)] shrink-0" />
          )}
          {run.status === "stopped" && (
            <Square className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          )}
          <span className="text-sm font-medium truncate">{run.projectId}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {elapsed && (
            <span className="text-[10px] text-muted-foreground font-mono">{elapsed}</span>
          )}
          {run.status === "running" && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); isPaused ? onResume() : onPause(); }}
                className={`transition-colors p-0.5 ${isPaused ? "text-primary hover:text-primary/80" : "text-muted-foreground hover:text-foreground"}`}
                title={isPaused ? "Resume project" : "Pause project"}
              >
                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onStop(); }}
                className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
              >
                <StopCircle className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
      {totalCount > 0 && (
        <div className="flex items-center gap-2">
          <Progress value={totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0} className="flex-1 h-1" />
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
            {doneCount}/{totalCount}
          </span>
        </div>
      )}
    </button>
  );
}

// ─── Run detail panel ───────────────────────────────────────────────────

function RunDetail({ run }: { run: RunEntry }) {
  const [showRawLog, setShowRawLog] = useState(false);
  const taskList = useMemo(() => Array.from(run.tasks.values()), [run.tasks]);
  const doneCount = useMemo(() => taskList.filter((t) => t.task.status === "done").length, [taskList]);
  const totalCount = taskList.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (run.status !== "running") {
      setElapsed(run.finishedAt ? run.finishedAt - run.startedAt : 0);
      return;
    }
    const update = () => setElapsed(Date.now() - run.startedAt);
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [run.startedAt, run.finishedAt, run.status]);

  // Completion summary
  if (run.status === "completed" && run.stats) {
    const s = run.stats;
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 space-y-6">
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-full bg-[var(--color-done)]/20 flex items-center justify-center">
                <Check className="w-6 h-6 text-[var(--color-done)]" />
              </div>
              <h2 className="text-lg font-semibold">Run Complete — {run.projectId}</h2>
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
      </div>
    );
  }

  // Stopped
  if (run.status === "stopped") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
        <h2 className="text-lg font-semibold text-yellow-400">Run Stopped — {run.projectId}</h2>
        {taskList.length > 0 && (
          <Card className="w-full max-w-2xl">
            <CardContent className="py-2 divide-y divide-border">
              {taskList.map((item) => (
                <SprintTaskRow key={item.task.id} item={item} />
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Active run
  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="px-6 py-4 border-b border-border space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{run.projectId}</h1>
            <p className="text-xs text-muted-foreground">
              Running &middot; {formatElapsed(elapsed)} elapsed
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Progress value={progressPct} className="flex-1 h-2" />
          <span className="text-xs text-muted-foreground font-mono shrink-0">
            {doneCount} / {totalCount}
          </span>
        </div>
      </div>

      {/* Stats bar */}
      {(run.agentState.turn > 0 || run.agentState.costUsd > 0 || run.currentTaskId) && (
        <div className="shrink-0 px-6 py-2 border-b border-border bg-background/80 backdrop-blur-sm flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono">
          {run.currentTaskTitle && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger className="max-w-[200px] min-w-0 text-left">
                  <span className="block text-foreground/80 font-semibold truncate">
                    {run.currentTaskTitle}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-sm">
                  {run.currentTaskTitle}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <PulseStat value={elapsed}>
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="tabular-nums text-muted-foreground">{formatMMSS(elapsed)}</span>
          </PulseStat>

          <PulseStat value={run.agentState.turn}>
            <RotateCw className="w-3 h-3 text-muted-foreground" />
            <span className="tabular-nums text-muted-foreground">Turn {run.agentState.turn}</span>
          </PulseStat>

          {(run.agentState.inputTokens > 0 || run.agentState.outputTokens > 0) && (
            <PulseStat value={run.agentState.inputTokens + run.agentState.outputTokens}>
              <Zap className="w-3 h-3 text-muted-foreground" />
              <span className="tabular-nums text-muted-foreground">
                {formatTokens(run.agentState.inputTokens)}&#8593; {formatTokens(run.agentState.outputTokens)}&#8595;
              </span>
            </PulseStat>
          )}

          {run.warningCount > 0 && (
            <PulseStat value={run.warningCount}>
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              <span className="tabular-nums text-amber-400">{run.warningCount}</span>
            </PulseStat>
          )}

          {run.errorCount > 0 && (
            <PulseStat value={run.errorCount}>
              <XCircle className="w-3 h-3 text-red-400" />
              <span className="tabular-nums text-red-400">{run.errorCount}</span>
            </PulseStat>
          )}

          <span className="flex-1" />

          {run.agentState.costUsd > 0 && (
            <PulseStat value={run.agentState.costUsd.toFixed(2)}>
              <Coins className="w-3 h-3 text-muted-foreground" />
              <span className="tabular-nums text-muted-foreground">${run.agentState.costUsd.toFixed(2)}</span>
            </PulseStat>
          )}
        </div>
      )}

      {/* Task list */}
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

      {/* Agent activity + log stream */}
      <div className="flex-1 px-6 py-3 flex flex-col min-h-0 overflow-hidden gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {run.currentTaskTitle ? `Trace: ${run.currentTaskTitle}` : "Agent Activity"}
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
          <AgentActivity state={run.agentState} runStartTime={run.startedAt} />
        </div>

        <div className={`flex-1 min-h-0 ${showRawLog ? "" : "hidden"}`}>
          <LogStream lines={run.logLines} taskId={run.currentTaskId ?? ""} />
        </div>
      </div>
    </div>
  );
}

// ─── Pipeline Run sidebar card ──────────────────────────────────────────

const PIPE_STAGE_COLORS: Record<PipelineStageStatus, string> = {
  queued: "bg-muted",
  running: "bg-primary",
  done: "bg-[var(--color-done)]",
  failed: "bg-[var(--color-cancelled)]",
  cancelled: "bg-muted-foreground/40",
};

function PipelineRunCard({
  run,
  isSelected,
  onSelect,
  onStop,
  isPaused,
  onPause,
  onResume,
}: {
  run: PipelineRun;
  isSelected: boolean;
  onSelect: () => void;
  onStop: () => void;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  const doneCount = run.stages.filter((s) => s.status === "done").length;
  const failedCount = run.stages.filter((s) => s.status === "failed").length;
  const totalCount = run.stages.length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (run.completedAt) {
      setElapsed(formatElapsed(run.completedAt - run.startedAt));
      return;
    }
    if (run.status !== "running") return;
    const update = () => setElapsed(formatElapsed(Date.now() - run.startedAt));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [run.startedAt, run.completedAt, run.status]);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-lg border p-3 space-y-2 transition-all ${
        isSelected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border hover:border-primary/30"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {run.status === "running" && (
            <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0 animate-pulse" />
          )}
          {run.status === "done" && (
            <Check className="w-3.5 h-3.5 text-[var(--color-done)] shrink-0" />
          )}
          {run.status === "failed" && (
            <X className="w-3.5 h-3.5 text-[var(--color-cancelled)] shrink-0" />
          )}
          {run.status === "cancelled" && (
            <Square className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          )}
          <span className="text-sm font-medium truncate">{run.pipelineId}</span>
          <Badge variant="outline" className="text-[10px] shrink-0">pipeline</Badge>
        </div>
        <div className="flex items-center gap-1.5">
          {elapsed && (
            <span className="text-[10px] text-muted-foreground font-mono">{elapsed}</span>
          )}
          {run.status === "running" && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); isPaused ? onResume() : onPause(); }}
                className={`transition-colors p-0.5 ${isPaused ? "text-primary hover:text-primary/80" : "text-muted-foreground hover:text-foreground"}`}
                title={isPaused ? "Resume pipeline" : "Pause pipeline"}
              >
                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onStop(); }}
                className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
              >
                <StopCircle className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Paused indicator */}
      {isPaused && run.status === "running" && (
        <p className="text-[10px] text-primary font-medium">Paused</p>
      )}

      {/* Stage progress */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Progress value={pct} className="flex-1 h-1" />
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
            {doneCount}/{totalCount}
          </span>
        </div>
        {/* Stage status dots */}
        <div className="flex gap-1">
          {run.stages.map((stage) => (
            <TooltipProvider key={stage.stageId}>
              <Tooltip>
                <TooltipTrigger>
                  <div
                    className={`w-2 h-2 rounded-full ${PIPE_STAGE_COLORS[stage.status]} ${
                      stage.status === "running" ? "animate-pulse" : ""
                    }`}
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {stage.stageId}: {stage.status}
                  {stage.error && <span className="text-red-400 ml-1">({stage.error})</span>}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>
      </div>

      {failedCount > 0 && (
        <p className="text-[10px] text-[var(--color-cancelled)]">
          {failedCount} stage{failedCount !== 1 ? "s" : ""} failed
        </p>
      )}
    </button>
  );
}

// ─── Pipeline Run detail panel ──────────────────────────────────────────

function PipelineRunDetail({ run, pipelines, onSelectProject }: { run: PipelineRun; pipelines: Pipeline[]; onSelectProject: (projectId: string) => void }) {
  const doneCount = run.stages.filter((s) => s.status === "done").length;
  const totalCount = run.stages.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (run.status !== "running") {
      setElapsed(run.completedAt ? run.completedAt - run.startedAt : 0);
      return;
    }
    const update = () => setElapsed(Date.now() - run.startedAt);
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [run.startedAt, run.completedAt, run.status]);

  const pipelineDef = pipelines.find((p) => p.id === run.pipelineId);
  const stageProjectMap = new Map(pipelineDef?.stages.map((s) => [s.id, s.projectId]) ?? []);
  const statusLabel = run.status === "running" ? "Running" : run.status === "done" ? "Complete" : run.status === "failed" ? "Failed" : "Cancelled";

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{run.pipelineId}</h1>
            <p className="text-xs text-muted-foreground">
              {statusLabel} &middot; {formatElapsed(elapsed)} elapsed
            </p>
          </div>
          <Badge variant="outline">pipeline</Badge>
        </div>
        <div className="flex items-center gap-3">
          <Progress value={progressPct} className="flex-1 h-2" />
          <span className="text-xs text-muted-foreground font-mono shrink-0">
            {doneCount} / {totalCount} stages
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-2">
          {run.stages.map((stage) => {
            const duration = stage.startedAt && stage.completedAt
              ? formatElapsed(stage.completedAt - stage.startedAt)
              : stage.startedAt
              ? formatElapsed(Date.now() - stage.startedAt)
              : null;

            const projectId = stageProjectMap.get(stage.stageId);
            const isClickable = !!projectId && (stage.status === "running" || stage.status === "done" || stage.status === "failed");

            return (
              <Card
                key={stage.stageId}
                className={isClickable ? "cursor-pointer hover:border-primary/40 transition-colors" : ""}
                onClick={() => { if (isClickable && projectId) onSelectProject(projectId); }}
              >
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    {stage.status === "done" && <Check className="w-4 h-4 text-[var(--color-done)] shrink-0" />}
                    {stage.status === "running" && <div className="w-4 h-4 rounded-full bg-primary shrink-0 animate-pulse-dot" />}
                    {stage.status === "queued" && <Circle className="w-4 h-4 text-muted-foreground shrink-0" />}
                    {stage.status === "failed" && <X className="w-4 h-4 text-[var(--color-cancelled)] shrink-0" />}
                    {stage.status === "cancelled" && <Square className="w-4 h-4 text-muted-foreground shrink-0" />}

                    <span className="text-sm font-medium flex-1">{stage.stageId}</span>

                    {projectId && (
                      <span className="text-[10px] text-muted-foreground">{projectId}</span>
                    )}

                    {duration && (
                      <span className="text-xs text-muted-foreground font-mono">{duration}</span>
                    )}

                    <Badge variant="outline" className="text-[10px]">{stage.status}</Badge>
                  </div>
                  {stage.error && (
                    <p className="text-xs text-red-400 mt-1 ml-7">{stage.error}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Sprint/Runs page ──────────────────────────────────────────────

export default function Sprint() {
  const ws = useWebSocket();
  const orchestrator = useOrchestrator(ws);
  const [runs, setRuns] = useState<Map<string, RunEntry>>(new Map());
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedPipelineRunId, setSelectedPipelineRunId] = useState<string | null>(null);
  const [pausedPipelines, setPausedPipelines] = useState<Set<string>>(new Set());

  // Helper to update a run entry immutably
  const updateRun = useCallback((projectId: string, updater: (run: RunEntry) => RunEntry) => {
    setRuns((prev) => {
      const existing = prev.get(projectId);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(projectId, updater(existing));
      return next;
    });
  }, []);

  // Bootstrap from API on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/run/status");
        if (!res.ok) return;
        const data = (await res.json()) as {
          isRunning: boolean;
          runningProjectIds: string[];
          scheduler: {
            slots: Array<{
              id: number;
              status: string;
              projectId: string | null;
              activeTask: Task | null;
              completedTasks: Task[];
            }>;
          };
        };

        if (data.scheduler?.slots) {
          const newRuns = new Map<string, RunEntry>();
          for (const slot of data.scheduler.slots) {
            if (!slot.projectId) continue;
            const run = createRunEntry(slot.projectId);
            if (slot.status === "running") {
              run.status = "running";
            }
            for (const t of slot.completedTasks) {
              run.tasks.set(t.id, { task: t });
            }
            if (slot.activeTask) {
              run.tasks.set(slot.activeTask.id, {
                task: { ...slot.activeTask, status: "in_progress" },
                startedAt: Date.now(),
              });
              run.currentTaskId = slot.activeTask.id;
              run.currentTaskTitle = slot.activeTask.title;
            }
            newRuns.set(slot.projectId, run);
          }
          if (newRuns.size > 0) {
            setRuns(newRuns);
            setSelectedProjectId(newRuns.keys().next().value ?? null);
          }
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // Process WS events — dispatch to the correct run by projectId
  useEffect(() => {
    if (!ws.lastEvent) return;
    const evt = ws.lastEvent as ServerEvent;
    // Extract projectId from event payload
    const pid = (evt as { payload?: { projectId?: string } }).payload?.projectId;

    switch (evt.type) {
      case "run:started": {
        if (!pid) break;
        setRuns((prev) => {
          const next = new Map(prev);
          next.set(pid, createRunEntry(pid));
          return next;
        });
        if (!selectedProjectId) setSelectedProjectId(pid);
        break;
      }

      case "task:started": {
        if (!pid) break;
        const t = evt.payload.task;
        updateRun(pid, (run) => {
          const tasks = new Map(run.tasks);
          tasks.set(t.id, { task: { ...t, status: "in_progress" }, startedAt: Date.now() });
          // Preserve log history — add task separator instead of clearing
          const separator = run.logLines.length > 0
            ? [`\n──── Task: ${t.title} ────`]
            : [`──── Task: ${t.title} ────`];
          return {
            ...run,
            tasks,
            currentTaskId: t.id,
            currentTaskTitle: t.title,
            logLines: [...run.logLines, ...separator],
            agentState: EMPTY_AGENT_STATE,
            eventIdCounter: 0,
          };
        });
        break;
      }

      case "task:done":
      case "task:cancelled":
      case "task:timeout": {
        if (!pid) break;
        const t = evt.payload.task;
        updateRun(pid, (run) => {
          const tasks = new Map(run.tasks);
          const existing = tasks.get(t.id);
          tasks.set(t.id, { task: { ...t }, startedAt: existing?.startedAt, finishedAt: Date.now() });
          return {
            ...run,
            tasks,
            currentTaskId: run.currentTaskId === t.id ? null : run.currentTaskId,
          };
        });
        break;
      }

      case "task:retrying": {
        if (!pid) break;
        const t = evt.payload.task;
        updateRun(pid, (run) => {
          const tasks = new Map(run.tasks);
          tasks.set(t.id, { task: { ...t, status: "in_progress" }, startedAt: Date.now() });
          return {
            ...run,
            tasks,
            currentTaskId: t.id,
            currentTaskTitle: t.title,
            logLines: [...run.logLines, `\n──── Retry: ${t.title} (attempt ${evt.payload.attempt}) ────`],
          };
        });
        break;
      }

      case "log:line": {
        if (!pid) break;
        updateRun(pid, (run) => ({
          ...run,
          logLines: [...run.logLines, evt.payload.line],
        }));
        break;
      }

      case "agent:tool_start": {
        if (!pid) break;
        updateRun(pid, (run) => {
          const id = run.eventIdCounter + 1;
          const toolEvt: AgentToolEvent = {
            id,
            kind: "tool_start",
            tool: evt.payload.tool,
            detail: evt.payload.input,
            timestamp: Date.now(),
          };
          return {
            ...run,
            eventIdCounter: id,
            agentState: {
              ...run.agentState,
              thinking: false,
              events: [...run.agentState.events, toolEvt],
            },
          };
        });
        break;
      }

      case "agent:tool_end": {
        if (!pid) break;
        updateRun(pid, (run) => {
          const id = run.eventIdCounter + 1;
          const toolEvt: AgentToolEvent = {
            id,
            kind: "tool_end",
            tool: evt.payload.tool,
            detail: evt.payload.output,
            timestamp: Date.now(),
          };
          return {
            ...run,
            eventIdCounter: id,
            agentState: {
              ...run.agentState,
              events: [...run.agentState.events, toolEvt],
            },
          };
        });
        break;
      }

      case "agent:thinking": {
        if (!pid) break;
        updateRun(pid, (run) => ({
          ...run,
          agentState: { ...run.agentState, thinking: true, thinkingText: evt.payload.text },
        }));
        break;
      }

      case "agent:turn": {
        if (!pid) break;
        updateRun(pid, (run) => ({
          ...run,
          agentState: { ...run.agentState, turn: evt.payload.turn, thinking: false },
        }));
        break;
      }

      case "agent:cost": {
        if (!pid) break;
        updateRun(pid, (run) => ({
          ...run,
          agentState: {
            ...run.agentState,
            costUsd: evt.payload.costUsd,
            inputTokens: evt.payload.inputTokens,
            outputTokens: evt.payload.outputTokens,
          },
        }));
        break;
      }

      case "agent:warning": {
        if (!pid) break;
        updateRun(pid, (run) => ({
          ...run,
          warningCount: run.warningCount + 1,
          agentState: { ...run.agentState, warning: evt.payload.message },
        }));
        toast.warning(evt.payload.message);
        break;
      }

      case "run:complete": {
        if (!pid) break;
        updateRun(pid, (run) => ({
          ...run,
          status: "completed",
          finishedAt: Date.now(),
          stats: evt.payload,
        }));
        toast.success(`Run complete: ${pid}`);
        break;
      }

      case "run:stopped": {
        if (!pid) break;
        updateRun(pid, (run) => ({
          ...run,
          status: "stopped",
          finishedAt: Date.now(),
        }));
        break;
      }

      case "error": {
        if (!pid) break;
        updateRun(pid, (run) => ({
          ...run,
          errorCount: run.errorCount + 1,
          logLines: [...run.logLines, `[ERROR] ${evt.payload.message}`],
        }));
        toast.error(evt.payload.message);
        break;
      }
    }
  }, [ws.lastEvent, selectedProjectId, updateRun]);

  const runList = useMemo(() => {
    const list = Array.from(runs.values());
    // Running first, then by start time descending
    list.sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (b.status === "running" && a.status !== "running") return 1;
      return b.startedAt - a.startedAt;
    });
    return list;
  }, [runs]);

  const selectedRun = selectedProjectId && !selectedPipelineRunId ? runs.get(selectedProjectId) ?? null : null;
  const selectedPipelineRun = selectedPipelineRunId
    ? orchestrator.pipelineRuns.find((r) => r.id === selectedPipelineRunId) ?? null
    : null;
  const totalTaskCount = useMemo(
    () => runList.reduce((sum, r) => sum + r.tasks.size, 0),
    [runList],
  );

  const handleStopProject = useCallback(async (projectId: string) => {
    try {
      await orchestrator.stopProject(projectId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [orchestrator]);

  // Empty state — no runs at all
  if (runList.length === 0 && orchestrator.pipelineRuns.length === 0) {
    return (
      <Shell projectId={null} taskCount={0}>
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center">
              <Rocket className="w-7 h-7 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium text-foreground">No active runs</p>
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

  return (
    <Shell projectId={selectedProjectId} taskCount={totalTaskCount}>
      <div className="flex h-full">
        {/* Left sidebar — run list */}
        <div className="w-[240px] shrink-0 border-r border-border p-3 space-y-2 overflow-y-auto">
          {/* Pipeline runs */}
          {orchestrator.pipelineRuns.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium px-1 mb-2">
                Pipelines ({orchestrator.pipelineRuns.length})
              </p>
              {orchestrator.pipelineRuns.map((pRun) => (
                <PipelineRunCard
                  key={pRun.id}
                  run={pRun}
                  isSelected={selectedPipelineRunId === pRun.id}
                  isPaused={pausedPipelines.has(pRun.id)}
                  onSelect={() => {
                    setSelectedPipelineRunId(pRun.id);
                    setSelectedProjectId(null);
                  }}
                  onStop={() => {
                    orchestrator.stopPipeline(pRun.id).catch((err) => {
                      toast.error((err as Error).message);
                    });
                  }}
                  onPause={() => {
                    orchestrator.pausePipeline(pRun.id).then(() => {
                      setPausedPipelines((prev) => new Set([...prev, pRun.id]));
                    }).catch((err) => {
                      toast.error((err as Error).message);
                    });
                  }}
                  onResume={() => {
                    orchestrator.resumePipeline(pRun.id).then(() => {
                      setPausedPipelines((prev) => {
                        const next = new Set(prev);
                        next.delete(pRun.id);
                        return next;
                      });
                    }).catch((err) => {
                      toast.error((err as Error).message);
                    });
                  }}
                />
              ))}
            </>
          )}

          {/* Project runs */}
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium px-1 mb-2">
            Runs ({runList.length})
          </p>
          {runList.map((run) => (
            <RunCard
              key={run.projectId}
              run={run}
              isSelected={selectedProjectId === run.projectId && !selectedPipelineRunId}
              isPaused={orchestrator.isProjectPaused(run.projectId)}
              onSelect={() => {
                setSelectedProjectId(run.projectId);
                setSelectedPipelineRunId(null);
              }}
              onStop={() => handleStopProject(run.projectId)}
              onPause={() => {
                orchestrator.pauseProject(run.projectId).catch((err) => {
                  toast.error((err as Error).message);
                });
              }}
              onResume={() => {
                orchestrator.resumeProject(run.projectId).catch((err) => {
                  toast.error((err as Error).message);
                });
              }}
            />
          ))}
        </div>

        {/* Right panel — run detail */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedPipelineRun ? (
            <PipelineRunDetail
              run={selectedPipelineRun}
              pipelines={orchestrator.pipelines}
              onSelectProject={(projectId) => {
                setSelectedProjectId(projectId);
                setSelectedPipelineRunId(null);
              }}
            />
          ) : selectedRun ? (
            <RunDetail run={selectedRun} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a run to see details
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
