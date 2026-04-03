import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import Shell from "../components/Shell";
import TaskRow from "../components/TaskRow";
import type { CrossProjectEpicResponse, CrossProjectEpicGroup, Epic } from "../types";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-muted text-muted-foreground",
  todo: "bg-blue-500/10 text-blue-600",
  in_progress: "bg-yellow-500/10 text-yellow-600",
  done: "bg-green-500/10 text-green-600",
  cancelled: "bg-red-500/10 text-red-600",
};

function EpicHeader({ epic, totalTasks, doneTasks }: { epic: Epic; totalTasks: number; doneTasks: number }) {
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{epic.title}</h1>
        <Badge className={STATUS_COLORS[epic.status] ?? ""}>{epic.status}</Badge>
        <Badge variant="outline" className="text-xs font-mono">{epic.priority}</Badge>
      </div>
      {epic.description && (
        <p className="text-sm text-muted-foreground max-w-2xl">{epic.description}</p>
      )}
      <div className="flex items-center gap-4">
        <Progress value={pct} className="h-2 flex-1 max-w-xs" />
        <span className="text-sm text-muted-foreground">
          {doneTasks}/{totalTasks} tasks ({pct}%)
        </span>
      </div>
    </div>
  );
}

function ProjectGroup({ group }: { group: CrossProjectEpicGroup }) {
  const doneTasks = group.tasks.filter((t) => t.status === "done").length;
  const pct = group.tasks.length > 0 ? Math.round((doneTasks / group.tasks.length) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Badge variant="secondary" className="text-xs font-mono">
              {group.projectId}
            </Badge>
            <span className="text-muted-foreground uppercase tracking-wider">
              {group.tasks.length} task{group.tasks.length !== 1 ? "s" : ""}
            </span>
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {doneTasks}/{group.tasks.length} done ({pct}%)
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {group.tasks.map((task) => (
          <div key={`${group.projectId}:${task.id}`} className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-mono shrink-0">
              {group.projectId}
            </Badge>
            <div className="flex-1 min-w-0">
              <TaskRow task={task} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function EpicDetail() {
  const { projectId, epicId } = useParams<{ projectId: string; epicId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<CrossProjectEpicResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEpicData = useCallback(async () => {
    if (!projectId || !epicId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(epicId)}/cross-project-tasks`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as CrossProjectEpicResponse;
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, epicId]);

  useEffect(() => {
    fetchEpicData();
  }, [fetchEpicData]);

  const stats = useMemo(() => {
    if (!data) return { total: 0, done: 0, projectCount: 0 };
    return {
      total: data.tasks.length,
      done: data.tasks.filter((t) => t.status === "done").length,
      projectCount: data.grouped.length,
    };
  }, [data]);

  return (
    <Shell projectId={projectId ?? null} taskCount={stats.total}>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Back button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/dashboard")}
          className="gap-1.5 -ml-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Button>

        {isLoading ? (
          <div className="flex items-center gap-3 text-muted-foreground text-sm py-12">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading epic...
          </div>
        ) : error ? (
          <div className="text-destructive text-sm py-12">
            Failed to load epic: {error}
          </div>
        ) : data ? (
          <>
            <EpicHeader epic={data.epic} totalTasks={stats.total} doneTasks={stats.done} />

            {/* Cross-project summary */}
            {stats.projectCount > 1 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Spans {stats.projectCount} projects:</span>
                {data.grouped.map((g) => (
                  <Badge key={g.projectId} variant="secondary" className="text-[10px] font-mono">
                    {g.projectId} ({g.tasks.length})
                  </Badge>
                ))}
              </div>
            )}

            {/* Task groups by project */}
            <div className="space-y-4">
              {data.grouped.map((group) => (
                <ProjectGroup key={group.projectId} group={group} />
              ))}
            </div>

            {data.grouped.length === 0 && (
              <p className="text-muted-foreground text-sm py-8">
                No tasks linked to this epic.
              </p>
            )}
          </>
        ) : null}
      </div>
    </Shell>
  );
}
