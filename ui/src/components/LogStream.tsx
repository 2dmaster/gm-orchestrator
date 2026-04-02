import { useEffect, useRef } from "react";

interface LogStreamProps {
  lines: string[];
  taskId: string;
}

const MAX_VISIBLE = 500;

export default function LogStream({ lines, taskId }: LogStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolled = useRef(false);

  const visible = lines.length > MAX_VISIBLE
    ? lines.slice(lines.length - MAX_VISIBLE)
    : lines;
  const skipped = lines.length - visible.length;

  useEffect(() => {
    if (!isUserScrolled.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines.length]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    isUserScrolled.current = !atBottom;
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      data-task-id={taskId}
      className="bg-[#0d1117] rounded-md border border-gray-800 p-3 overflow-y-auto max-h-[32rem] font-mono text-sm leading-relaxed"
    >
      {skipped > 0 && (
        <div className="text-gray-600 text-xs mb-1">
          ... {skipped} lines hidden ...
        </div>
      )}
      {visible.map((line, i) => (
        <div key={skipped + i} className="text-[#00ff88] whitespace-pre-wrap break-all">
          {line}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
