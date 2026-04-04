import type { Epic } from "../types";
import { Progress } from "@/components/ui/progress";

interface EpicCardProps {
  epic: Epic;
  projectId?: string;
  isSelected?: boolean;
  onSelect?: (epicId: string) => void;
}

export default function EpicCard({ epic, isSelected, onSelect }: EpicCardProps) {
  // Prefer the progress summary from the API; fall back to counting tasks
  const total = epic.progress?.total ?? epic.tasks?.length ?? 0;
  const done = epic.progress?.done ?? epic.tasks?.filter((t) => t.status === "done").length ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const handleClick = () => {
    onSelect?.(epic.id);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`w-full text-left rounded-lg border p-3 space-y-2 transition-colors ${
        isSelected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border hover:border-primary/30"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-medium truncate">{epic.title}</span>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 ml-2">
          {done}/{total}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </button>
  );
}
