import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useWebSocket } from "../hooks/useWebSocket";
import { useTasks } from "../hooks/useTasks";
import { useOrchestrator } from "../hooks/useOrchestrator";
import Shell from "../components/Shell";
import TaskRow from "../components/TaskRow";
import EpicCard from "../components/EpicCard";
import type { Epic } from "../types";

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const MAX_VISIBLE_TASKS = 5;

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
      // non-critical
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchEpics();
  }, [fetchEpics]);

  return { epics, isLoading };
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning.";
  if (h < 18) return "Good afternoon.";
  return "Good evening.";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const ws = useWebSocket();
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
  const [showAllTasks, setShowAllTasks] = useState(false);

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3)
      ),
    [tasks]
  );

  const todayStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }, []);

  const stats = useMemo(() => {
    const todo = tasks.filter((t) => t.status === "todo").length;
    const done = tasks.filter((t) => t.status === "done").length;
    const doneToday = tasks.filter((t) => t.status === "done" && t.completedAt && t.completedAt >= todayStart).length;
    const cancelledToday = tasks.filter((t) => t.status === "cancelled" && t.completedAt && t.completedAt >= todayStart).length;
    return { total: tasks.length, todo, done, doneToday, cancelledToday };
  }, [tasks, todayStart]);

  const todayTotal = stats.doneToday + stats.cancelledToday;
  const todayPct = todayTotal > 0 ? Math.round((stats.doneToday / todayTotal) * 100) : 0;

  const handleRunSprint = useCallback(async () => {
    if (!projectId) return;
    try {
      await orchestrator.startSprint(projectId);
      navigate("/sprint");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [projectId, orchestrator, navigate]);

  const handleRunEpic = useCallback(async () => {
    if (!projectId || !selectedEpicId) return;
    try {
      await orchestrator.startEpic(projectId, selectedEpicId);
      navigate("/sprint");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [projectId, selectedEpicId, orchestrator, navigate]);

  if (!projectId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const visibleTasks = showAllTasks ? sortedTasks : sortedTasks.slice(0, MAX_VISIBLE_TASKS);
  const hiddenCount = sortedTasks.length - MAX_VISIBLE_TASKS;

  return (
    <Shell projectId={projectId} taskCount={stats.total}>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{getGreeting()}</h1>
            <p className="text-sm text-muted-foreground">
              {stats.todo} tasks waiting in {projectId}
            </p>
          </div>
          <Button
            onClick={handleRunSprint}
            disabled={orchestrator.isRunning}
            className="gap-2"
          >
            {orchestrator.isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {orchestrator.isRunning ? "Running..." : "Run Sprint"}
          </Button>
        </div>

        {/* Cards grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Tasks */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Tasks
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {tasksLoading && tasks.length === 0 ? (
                <div className="flex items-center gap-3 text-muted-foreground text-sm py-8">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading tasks...
                </div>
              ) : sortedTasks.length === 0 ? (
                <p className="text-muted-foreground text-sm py-8">No tasks found.</p>
              ) : (
                <>
                  {visibleTasks.map((task) => (
                    <TaskRow key={task.id} task={task} />
                  ))}
                  {!showAllTasks && hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllTasks(true)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
                    >
                      + {hiddenCount} more
                    </button>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Epics */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Epics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {epicsLoading && epics.length === 0 ? (
                <div className="flex items-center gap-3 text-muted-foreground text-sm py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              ) : epics.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4">No epics found.</p>
              ) : (
                <>
                  {epics.map((epic) => (
                    <EpicCard key={epic.id} epic={epic} />
                  ))}
                  <div className="flex items-center gap-2 pt-2">
                    <select
                      value={selectedEpicId}
                      onChange={(e) => setSelectedEpicId(e.target.value)}
                      disabled={orchestrator.isRunning || epicsLoading}
                      className="flex-1 h-8 px-2 rounded-md border border-input bg-background text-xs font-mono disabled:opacity-50"
                    >
                      <option value="">Select epic...</option>
                      {epics.map((e) => (
                        <option key={e.id} value={e.id}>{e.title}</option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleRunEpic}
                      disabled={!selectedEpicId || orchestrator.isRunning}
                      className="text-xs"
                    >
                      Run Epic
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Today bar */}
        {todayTotal > 0 && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Today</span>
                <span className="text-xs text-muted-foreground">
                  <span className="text-[var(--color-done)]">{stats.doneToday} done</span>
                  {stats.cancelledToday > 0 && (
                    <> &middot; <span className="text-[var(--color-cancelled)]">{stats.cancelledToday} cancelled</span></>
                  )}
                </span>
              </div>
              <Progress value={todayPct} className="h-2" />
            </CardContent>
          </Card>
        )}
      </div>
    </Shell>
  );
}
