import type { TaskStatus } from "../types";
import { Badge } from "@/components/ui/badge";

const config: Record<TaskStatus, { label: string; className: string }> = {
  done: {
    label: "Done",
    className: "bg-[var(--color-done)]/15 text-[var(--color-done)] border-[var(--color-done)]/30",
  },
  in_progress: {
    label: "Running",
    className: "bg-[var(--color-running)]/15 text-[var(--color-running)] border-[var(--color-running)]/30 animate-pulse-dot",
  },
  backlog: {
    label: "Backlog",
    className: "bg-muted/50 text-muted-foreground border-muted-foreground/30",
  },
  todo: {
    label: "Queued",
    className: "bg-[var(--color-queued)]/15 text-[var(--color-queued)] border-[var(--color-queued)]/30",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-[var(--color-cancelled)]/15 text-[var(--color-cancelled)] border-[var(--color-cancelled)]/30",
  },
};

export default function StatusBadge({ status }: { status: TaskStatus }) {
  const c = config[status] ?? config.todo;
  return (
    <Badge variant="outline" className={`text-[10px] font-medium ${c.className}`}>
      {c.label}
    </Badge>
  );
}
