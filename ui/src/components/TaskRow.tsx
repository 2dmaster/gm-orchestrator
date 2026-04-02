import { useEffect, useState } from "react";
import type { Task } from "../types";
import PriorityBadge from "./PriorityBadge";
import StatusBadge from "./StatusBadge";

function useElapsed(startTime: string | undefined, isRunning: boolean) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!startTime || !isRunning) {
      if (startTime && !isRunning) {
        setElapsed(formatDuration(Date.now() - new Date(startTime).getTime()));
      }
      return;
    }

    const start = new Date(startTime).getTime();
    const update = () => setElapsed(formatDuration(Date.now() - start));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startTime, isRunning]);

  return elapsed;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function TaskRow({ task }: { task: Task }) {
  const isRunning = task.status === "in_progress";
  const elapsed = useElapsed(task.updatedAt, isRunning);

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
        task.status === "done"
          ? "border-border/50 opacity-70 task-done"
          : task.status === "cancelled"
            ? "border-border/50 opacity-50"
            : "border-border hover:border-primary/30"
      }`}
      style={{ borderLeftWidth: "3px", borderLeftColor: `var(--priority-${task.priority})` }}
    >
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${task.status === "cancelled" ? "line-through text-muted-foreground" : ""}`}>
          {task.title}
        </span>
        {task.tags && task.tags.length > 0 && (
          <span className="ml-2 text-xs text-muted-foreground">
            {task.tags.map((t) => `#${t}`).join(" ")}
          </span>
        )}
      </div>
      {elapsed && <span className="text-xs text-muted-foreground font-mono shrink-0">{elapsed}</span>}
      <StatusBadge status={task.status} />
    </div>
  );
}

export { PriorityBadge, formatDuration, useElapsed };
