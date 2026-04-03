import { useNavigate } from "react-router-dom";
import type { Epic } from "../types";
import { Progress } from "@/components/ui/progress";

interface EpicCardProps {
  epic: Epic;
  projectId?: string;
}

export default function EpicCard({ epic, projectId }: EpicCardProps) {
  const navigate = useNavigate();
  const total = epic.tasks?.length ?? 0;
  const done = epic.tasks?.filter((t) => t.status === "done").length ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Check if epic has cross-project tasks
  const hasCrossProjectTasks = epic.tasks?.some((t) => t.projectId) ?? false;

  const handleClick = () => {
    if (projectId) {
      navigate(`/epics/${encodeURIComponent(projectId)}/${encodeURIComponent(epic.id)}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!projectId}
      className="w-full text-left rounded-lg border border-border p-3 space-y-2 hover:border-primary/30 transition-colors disabled:cursor-default"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-medium truncate">{epic.title}</span>
          {hasCrossProjectTasks && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
              multi-project
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0 ml-2">
          {done}/{total}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </button>
  );
}
