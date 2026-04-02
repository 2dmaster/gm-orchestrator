interface ProgressBarProps {
  completed: number;
  total: number;
  label?: string;
}

export default function ProgressBar({ completed, total, label }: ProgressBarProps) {
  const pct = total > 0 ? Math.min((completed / total) * 100, 100) : 0;

  return (
    <div className="font-mono text-sm">
      {label && <div className="text-gray-400 mb-1">{label}</div>}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-text text-xs shrink-0">
          {completed}/{total}
        </span>
      </div>
    </div>
  );
}
