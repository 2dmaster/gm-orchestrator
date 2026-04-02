import { useEffect, useRef } from "react";

interface LogStreamProps {
  lines: string[];
  taskId: string;
}

const MAX_VISIBLE = 500;

export default function LogStream({ lines, taskId }: LogStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
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
    const el = viewportRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    isUserScrolled.current = !atBottom;
  }

  return (
    <div
      ref={viewportRef}
      onScroll={handleScroll}
      data-task-id={taskId}
      className="h-full bg-black/40 rounded-lg border border-border p-3 overflow-y-auto font-mono text-sm leading-relaxed"
    >
      {skipped > 0 && (
        <div className="text-muted-foreground text-xs mb-1">
          ... {skipped} lines hidden ...
        </div>
      )}
      {visible.map((line, i) => {
        const isToolCall = line.startsWith(">");
        return (
          <div
            key={skipped + i}
            className={`whitespace-pre-wrap break-all log-line ${
              isToolCall ? "text-primary" : "text-foreground/80"
            }`}
          >
            {line}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
