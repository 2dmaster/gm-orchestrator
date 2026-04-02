import { useEffect, useState } from "react";
import type { Task } from "../types";

const statusConfig: Record<
  string,
  { label: string; bg: string; text: string; pulse?: boolean }
> = {
  done: { label: "DONE", bg: "bg-green-900/40", text: "text-green-400" },
  in_progress: {
    label: "RUNNING",
    bg: "bg-green-900/30",
    text: "text-accent",
    pulse: true,
  },
  todo: { label: "QUEUED", bg: "bg-gray-800", text: "text-gray-400" },
  cancelled: { label: "CANCELLED", bg: "bg-red-900/40", text: "text-red-400" },
};

const priorityConfig: Record<string, { color: string; label: string }> = {
  critical: { color: "bg-red-500", label: "Critical" },
  high: { color: "bg-orange-500", label: "High" },
  medium: { color: "bg-yellow-500", label: "Medium" },
  low: { color: "bg-gray-500", label: "Low" },
};

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
    const update = () =>
      setElapsed(formatDuration(Date.now() - start));
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

interface TaskCardProps {
  task: Task;
  onClick?: (task: Task) => void;
}

export default function TaskCard({ task, onClick }: TaskCardProps) {
  const status = statusConfig[task.status] ?? statusConfig.todo;
  const priority = priorityConfig[task.priority] ?? priorityConfig.low;
  const isRunning = task.status === "in_progress";
  const elapsed = useElapsed(task.updatedAt, isRunning);

  return (
    <div
      onClick={() => onClick?.(task)}
      className={`border border-gray-800 rounded-md p-3 bg-gray-900/50 hover:border-gray-700 transition-colors font-mono text-sm ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${priority.color}`}
            title={priority.label}
          />
          <span className="truncate text-text">{task.title}</span>
        </div>
        <span
          className={`shrink-0 px-2 py-0.5 rounded text-xs font-bold ${status.bg} ${status.text} ${
            status.pulse ? "animate-pulse" : ""
          }`}
        >
          {status.label}
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
        {task.assignee && <span>@{task.assignee}</span>}
        {elapsed && <span>{elapsed}</span>}
        {task.tags && task.tags.length > 0 && (
          <span className="truncate">
            {task.tags.map((t) => `#${t}`).join(" ")}
          </span>
        )}
      </div>
    </div>
  );
}
