import type { TaskPriority } from "../types";

const config: Record<TaskPriority, { color: string; label: string }> = {
  critical: { color: "var(--priority-critical)", label: "Critical" },
  high: { color: "var(--priority-high)", label: "High" },
  medium: { color: "var(--priority-medium)", label: "Medium" },
  low: { color: "var(--priority-low)", label: "Low" },
};

export default function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const c = config[priority] ?? config.low;
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: c.color }}
      title={c.label}
    />
  );
}
