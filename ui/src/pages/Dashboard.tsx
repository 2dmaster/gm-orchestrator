import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Loader2, Globe, ChevronDown, ChevronRight, Server, AlertCircle, Inbox, FolderOpen, CheckSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useWebSocket } from "../hooks/useWebSocket";
import { useTasks } from "../hooks/useTasks";
import { useOrchestrator } from "../hooks/useOrchestrator";
import { useProjectsOverview } from "../hooks/useProjectsOverview";
import Shell from "../components/Shell";
import TaskRow from "../components/TaskRow";
import EpicCard from "../components/EpicCard";
import PipelineSection from "../components/PipelineSection";
import type { Epic, Task, ProjectOverview } from "../types";

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const MAX_VISIBLE_TASKS = 5;
const CLOSED_STATUSES = ["done", "cancelled"];

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

// ─── Project Overview Card ─────────────────────────────────────────────

interface ProjectCardProps {
  project: ProjectOverview;
  isSelected: boolean;
  isExpanded: boolean;
  isRunning: boolean;
  onSelect: () => void;
}

function ProjectCard({ project, isSelected, isExpanded, isRunning, onSelect }: ProjectCardProps) {
  const { taskCounts, epicCount } = project;
  const label = project.label || project.projectId;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-lg border p-4 transition-all ${
        isSelected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border hover:border-primary/30 hover:bg-muted/30"
      } ${project.error ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{label}</p>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {project.baseUrl}
            </p>
          </div>
        </div>
        {isRunning && (
          <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0 ml-2 animate-pulse" />
        )}
        {project.error && (
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 ml-2" />
        )}
      </div>
      <div className="flex items-center gap-3 mt-3">
        <Badge variant="outline" className="text-[10px] font-mono">
          {taskCounts.todo} todo
        </Badge>
        <Badge variant="outline" className="text-[10px] font-mono">
          {taskCounts.in_progress} active
        </Badge>
        <Badge variant="outline" className="text-[10px] font-mono">
          {taskCounts.done} done
        </Badge>
        {epicCount > 0 && (
          <Badge variant="secondary" className="text-[10px] font-mono">
            {epicCount} epics
          </Badge>
        )}
      </div>
      {project.error && (
        <p className="text-xs text-destructive mt-2 truncate">
          {project.error}
        </p>
      )}
    </button>
  );
}

// ─── Project Detail Panel (tasks + epics) ──────────────────────────────

interface ProjectDetailProps {
  projectId: string;
  orchestrator: ReturnType<typeof useOrchestrator>;
  navigate: ReturnType<typeof useNavigate>;
}

function ProjectDetail({ projectId, orchestrator, navigate }: ProjectDetailProps) {
  const ws = useWebSocket();
  const { tasks, isLoading: tasksLoading } = useTasks(projectId, ws);
  const { epics, isLoading: epicsLoading } = useEpics(projectId);
  const [selectedEpicId, setSelectedEpicId] = useState("");
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [showClosedEpics, setShowClosedEpics] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  const visibleEpics = useMemo(
    () =>
      showClosedEpics
        ? epics
        : epics.filter((e) => !CLOSED_STATUSES.includes(e.status)),
    [epics, showClosedEpics]
  );

  // items map for base-ui Select — maps value (id) → display label (title)
  const epicItems = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of visibleEpics) map[e.id] = e.title;
    return map;
  }, [visibleEpics]);

  const closedEpicCount = useMemo(
    () => epics.filter((e) => CLOSED_STATUSES.includes(e.status)).length,
    [epics]
  );

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3)
      ),
    [tasks]
  );

  // Fetch epic tasks when an epic is selected
  const [epicTaskIds, setEpicTaskIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!selectedEpicId || !projectId) {
      setEpicTaskIds(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(selectedEpicId)}/tasks`
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { tasks: Task[] };
        if (!cancelled) {
          setEpicTaskIds(new Set(data.tasks.map((t) => t.id)));
        }
      } catch {
        if (!cancelled) setEpicTaskIds(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [selectedEpicId, projectId]);

  const filteredTasks = useMemo(() => {
    if (!selectedEpicId || !epicTaskIds) return sortedTasks;
    return sortedTasks.filter((t) => epicTaskIds.has(t.id));
  }, [sortedTasks, selectedEpicId, epicTaskIds]);

  const visibleTasks = showAllTasks ? filteredTasks : filteredTasks.slice(0, MAX_VISIBLE_TASKS);
  const hiddenCount = filteredTasks.length - MAX_VISIBLE_TASKS;

  const handleRunSprint = useCallback(async () => {
    try {
      await orchestrator.startSprint(projectId);
      navigate("/sprint");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [projectId, orchestrator, navigate]);

  const handleRunEpic = useCallback(async () => {
    if (!selectedEpicId) return;
    try {
      await orchestrator.startEpic(projectId, selectedEpicId);
      navigate("/sprint");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [projectId, selectedEpicId, orchestrator, navigate]);

  // Runnable tasks: only todo or in_progress
  const runnableTasks = useMemo(
    () => filteredTasks.filter((t) => t.status === "todo" || t.status === "in_progress"),
    [filteredTasks]
  );

  const toggleTaskSelect = useCallback((taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedTaskIds((prev) => {
      if (prev.size === runnableTasks.length && runnableTasks.length > 0) {
        return new Set();
      }
      return new Set(runnableTasks.map((t) => t.id));
    });
  }, [runnableTasks]);

  const handleRunSelected = useCallback(async () => {
    if (selectedTaskIds.size === 0) return;
    try {
      await orchestrator.startTasks(projectId, [...selectedTaskIds]);
      setSelectedTaskIds(new Set());
      navigate("/sprint");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [projectId, selectedTaskIds, orchestrator, navigate]);

  return (
    <div className="space-y-4 pt-2">
      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleRunSprint}
          disabled={orchestrator.isProjectRunning(projectId)}
          className="gap-1.5"
        >
          {orchestrator.isProjectRunning(projectId) ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          Run All Tasks
        </Button>
        {selectedTaskIds.size > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRunSelected}
            disabled={orchestrator.isProjectRunning(projectId)}
            className="gap-1.5"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            Run Selected ({selectedTaskIds.size})
          </Button>
        )}
        {visibleEpics.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Select
              items={epicItems}
              value={selectedEpicId || null}
              onValueChange={(val: string | null) => {
                setSelectedEpicId(val ?? "");
                setShowAllTasks(false);
              }}
              disabled={orchestrator.isProjectRunning(projectId) || epicsLoading}
            >
              <SelectTrigger size="sm" className="text-xs font-mono min-w-[140px]">
                <SelectValue placeholder="Select epic..." />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {visibleEpics.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleRunEpic}
              disabled={!selectedEpicId || orchestrator.isProjectRunning(projectId)}
              className="text-xs"
            >
              Run Epic
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tasks */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              {runnableTasks.length > 0 && (
                <Checkbox
                  checked={selectedTaskIds.size === runnableTasks.length && runnableTasks.length > 0}
                  indeterminate={selectedTaskIds.size > 0 && selectedTaskIds.size < runnableTasks.length}
                  onCheckedChange={toggleSelectAll}
                />
              )}
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Tasks
                {selectedEpicId && (
                  <span className="ml-2 text-xs font-normal normal-case tracking-normal">
                    ({filteredTasks.length} of {tasks.length})
                  </span>
                )}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {selectedTaskIds.size > 0 && (
                <span className="text-xs text-muted-foreground">
                  {selectedTaskIds.size} selected
                </span>
              )}
              {selectedEpicId && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEpicId("");
                    setShowAllTasks(false);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Clear filter
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {tasksLoading && tasks.length === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border">
                    <Skeleton className="h-4 w-4 rounded-full shrink-0" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-5 w-14 rounded" />
                  </div>
                ))}
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Inbox className="w-8 h-8 text-muted-foreground/50" />
                <p className="text-muted-foreground text-sm">
                  {selectedEpicId ? "No tasks linked to this epic." : "No tasks found."}
                </p>
              </div>
            ) : (
              <>
                {visibleTasks.map((task) => {
                  const isRunnable = task.status === "todo" || task.status === "in_progress";
                  return (
                    <TaskRow
                      key={task.id}
                      task={task}
                      selectable={isRunnable}
                      selected={selectedTaskIds.has(task.id)}
                      onToggleSelect={toggleTaskSelect}
                    />
                  );
                })}
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
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Epics
            </CardTitle>
            {closedEpicCount > 0 && (
              <div className="flex items-center gap-2">
                <Switch
                  size="sm"
                  checked={showClosedEpics}
                  onCheckedChange={(checked: boolean) => setShowClosedEpics(checked)}
                />
                <Label className="text-xs text-muted-foreground cursor-pointer" onClick={() => setShowClosedEpics((prev) => !prev)}>
                  Show closed ({closedEpicCount})
                </Label>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {epicsLoading && epics.length === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-8" />
                    </div>
                    <Skeleton className="h-1.5 w-full rounded-full" />
                  </div>
                ))}
              </div>
            ) : visibleEpics.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <FolderOpen className="w-7 h-7 text-muted-foreground/50" />
                <p className="text-muted-foreground text-sm">No epics in this project.</p>
              </div>
            ) : (
              visibleEpics.map((epic) => (
                <EpicCard
                  key={epic.id}
                  epic={epic}
                  projectId={projectId}
                  isSelected={selectedEpicId === epic.id}
                  onSelect={(id) => {
                    setSelectedEpicId((prev) => (prev === id ? "" : id));
                    setShowAllTasks(false);
                  }}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Unified View: merged priority queue across all projects ────────────

interface UnifiedViewProps {
  projectOverviews: ProjectOverview[];
}

function UnifiedView({ projectOverviews }: UnifiedViewProps) {
  const ws = useWebSocket();
  const [allTasks, setAllTasks] = useState<(Task & { _projectId: string })[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchAllTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      const results = await Promise.all(
        projectOverviews
          .filter((p) => !p.error)
          .map(async (p) => {
            try {
              const res = await fetch(`/api/projects/${encodeURIComponent(p.projectId)}/tasks`);
              if (!res.ok) return [];
              const data = (await res.json()) as { tasks: Task[] };
              return data.tasks.map((t) => ({ ...t, _projectId: p.projectId }));
            } catch {
              return [];
            }
          })
      );
      setAllTasks(results.flat());
    } finally {
      setIsLoading(false);
    }
  }, [projectOverviews]);

  useEffect(() => {
    fetchAllTasks();
  }, [fetchAllTasks]);

  // Refresh on WS events
  useEffect(() => {
    if (!ws.lastEvent) return;
    if (["task:done", "task:cancelled", "run:complete"].includes(ws.lastEvent.type)) {
      fetchAllTasks();
    }
  }, [ws.lastEvent, fetchAllTasks]);

  const sortedTasks = useMemo(
    () =>
      [...allTasks]
        .filter((t) => !CLOSED_STATUSES.includes(t.status))
        .sort(
          (a, b) =>
            (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3)
        ),
    [allTasks]
  );

  const globalStats = useMemo(() => {
    const todo = allTasks.filter((t) => t.status === "todo").length;
    const inProgress = allTasks.filter((t) => t.status === "in_progress").length;
    const done = allTasks.filter((t) => t.status === "done").length;
    return { todo, inProgress, done, total: allTasks.length };
  }, [allTasks]);

  return (
    <div className="space-y-4">
      {/* Global stats */}
      <div className="flex items-center gap-4">
        <Badge variant="outline" className="font-mono text-xs">
          {globalStats.todo} todo
        </Badge>
        <Badge variant="outline" className="font-mono text-xs">
          {globalStats.inProgress} active
        </Badge>
        <Badge variant="outline" className="font-mono text-xs">
          {globalStats.done} done
        </Badge>
        <span className="text-xs text-muted-foreground">
          across {projectOverviews.length} projects
        </span>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Global Priority Queue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="h-5 w-24 rounded shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border">
                      <Skeleton className="h-4 w-4 rounded-full shrink-0" />
                      <Skeleton className="h-4 flex-1" />
                      <Skeleton className="h-5 w-14 rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : sortedTasks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Inbox className="w-8 h-8 text-muted-foreground/50" />
              <p className="text-muted-foreground text-sm">No tasks found across projects.</p>
            </div>
          ) : (
            sortedTasks.map((task) => (
              <div key={`${task._projectId}:${task.id}`} className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] font-mono shrink-0">
                  {task._projectId}
                </Badge>
                <div className="flex-1 min-w-0">
                  <TaskRow task={task} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const ws = useWebSocket();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"projects" | "unified">("projects");

  const { projects: projectOverviews, isLoading: overviewLoading } = useProjectsOverview(ws);
  const orchestrator = useOrchestrator(ws);

  // Fetch initial active project
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) return;
        const data = await res.json();
        if (data.config?.activeProjectId) {
          setActiveProjectId(data.config.activeProjectId);
          setExpandedProjectId(data.config.activeProjectId);
        } else if (data.setupRequired) {
          navigate("/", { replace: true });
        }
      } catch {
        // Server not ready
      }
    })();
  }, [navigate]);

  // Total task count for Shell
  const totalTaskCount = useMemo(
    () => projectOverviews.reduce((sum, p) => sum + p.taskCounts.total, 0),
    [projectOverviews]
  );

  const handleSelectProject = useCallback((projectId: string) => {
    setExpandedProjectId((prev) => (prev === projectId ? null : projectId));
  }, []);

  if (!activeProjectId && !overviewLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Shell projectId={activeProjectId} taskCount={totalTaskCount}>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{getGreeting()}</h1>
            <p className="text-sm text-muted-foreground">
              {projectOverviews.length} project{projectOverviews.length !== 1 ? "s" : ""} configured
            </p>
          </div>
        </div>

        {/* View mode tabs */}
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "projects" | "unified")}>
          <TabsList variant="line">
            <TabsTrigger value="projects">
              <Server className="w-3.5 h-3.5" />
              Projects
            </TabsTrigger>
            <TabsTrigger value="unified">
              <Globe className="w-3.5 h-3.5" />
              Unified
            </TabsTrigger>
          </TabsList>

          {/* Per-project view */}
          <TabsContent value="projects">
            {overviewLoading && projectOverviews.length === 0 ? (
              <div className="flex items-center gap-3 text-muted-foreground text-sm py-8">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading projects...
              </div>
            ) : projectOverviews.length === 0 ? (
              <div className="text-center py-12">
                <Server className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No projects configured.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => navigate("/settings")}
                >
                  Go to Settings
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Pipelines */}
                <PipelineSection
                  pipelines={orchestrator.pipelines}
                  pipelineRuns={orchestrator.pipelineRuns}
                  onStart={orchestrator.startPipeline}
                  onStop={orchestrator.stopPipeline}
                />

                {/* Project cards grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {projectOverviews.map((project) => (
                    <ProjectCard
                      key={project.projectId}
                      project={project}
                      isSelected={expandedProjectId === project.projectId}
                      isExpanded={expandedProjectId === project.projectId}
                      isRunning={orchestrator.isProjectRunning(project.projectId)}
                      onSelect={() => handleSelectProject(project.projectId)}
                    />
                  ))}
                </div>

                {/* Expanded project detail */}
                {expandedProjectId && (
                  <ProjectDetail
                    projectId={expandedProjectId}
                    orchestrator={orchestrator}
                    navigate={navigate}
                  />
                )}
              </div>
            )}
          </TabsContent>

          {/* Unified view */}
          <TabsContent value="unified">
            <UnifiedView
              projectOverviews={projectOverviews}
            />
          </TabsContent>
        </Tabs>
      </div>
    </Shell>
  );
}
