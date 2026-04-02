import type { Epic } from "../types";
import { Progress } from "@/components/ui/progress";

export default function EpicCard({ epic }: { epic: Epic }) {
  const total = epic.tasks?.length ?? 0;
  const done = epic.tasks?.filter((t) => t.status === "done").length ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="rounded-lg border border-border p-3 space-y-2 hover:border-primary/30 transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium truncate">{epic.title}</span>
        <span className="text-xs text-muted-foreground shrink-0 ml-2">
          {done}/{total}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}
