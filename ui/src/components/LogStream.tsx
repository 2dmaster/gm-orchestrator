import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, Terminal, AlertCircle, MessageSquare } from "lucide-react";

interface LogStreamProps {
  lines: string[];
  taskId: string;
}

const MAX_VISIBLE = 500;

// ─── Block types ───────────────────────────────────────────────────────

interface LogBlock {
  id: number;
  type: "tool" | "error" | "text" | "separator";
  toolName?: string;
  lines: string[];
}

function parseBlocks(lines: string[]): LogBlock[] {
  const blocks: LogBlock[] = [];
  let currentBlock: LogBlock | null = null;
  let idCounter = 0;

  for (const line of lines) {
    if (line.startsWith("──── ") || line.startsWith("\n──── ")) {
      // Task separator
      currentBlock = null;
      blocks.push({ id: idCounter++, type: "separator", lines: [line.replace(/^\n/, "")] });
    } else if (line.startsWith("[tool] ")) {
      const toolMatch = line.match(/^\[tool\] ([^:]+):/);
      const toolName = toolMatch?.[1] ?? "unknown";
      currentBlock = { id: idCounter++, type: "tool", toolName, lines: [line.slice(7)] };
      blocks.push(currentBlock);
    } else if (line.startsWith("[ERROR]") || line.startsWith("Error:")) {
      currentBlock = { id: idCounter++, type: "error", lines: [line] };
      blocks.push(currentBlock);
    } else {
      if (currentBlock?.type === "text") {
        currentBlock.lines.push(line);
      } else {
        currentBlock = { id: idCounter++, type: "text", lines: [line] };
        blocks.push(currentBlock);
      }
    }
  }

  return blocks;
}

// ─── Block renderer ────────────────────────────────────────────────────

function SeparatorBlock({ block }: { block: LogBlock }) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs text-muted-foreground/60">
      <div className="flex-1 h-px bg-border/50" />
      <span className="shrink-0 font-medium">{block.lines[0]?.replace(/^─+ /, "").replace(/ ─+$/, "")}</span>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}

function CollapsibleBlock({ block, defaultExpanded }: { block: LogBlock; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Small text blocks don't need collapsing
  if (block.type === "text" && block.lines.length <= 3) {
    return (
      <div className="py-0.5">
        {block.lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all text-foreground/80 leading-relaxed">{line}</div>
        ))}
      </div>
    );
  }

  const isError = block.type === "error";
  const isTool = block.type === "tool";

  const Icon = isTool ? Terminal : isError ? AlertCircle : MessageSquare;
  const headerColor = isTool ? "text-primary" : isError ? "text-red-400" : "text-foreground/60";
  const headerText = isTool
    ? block.toolName
    : isError
    ? "Error"
    : `${block.lines.length} lines`;

  return (
    <div className={`rounded border ${isError ? "border-red-500/30 bg-red-500/5" : "border-border/50 bg-white/[0.02]"}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs ${headerColor} hover:bg-white/5 transition-colors`}
      >
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <Icon className="w-3 h-3 shrink-0" />
        <span className="truncate font-medium">{headerText}</span>
        {block.lines.length > 1 && (
          <span className="text-muted-foreground/50 ml-auto shrink-0">{block.lines.length}</span>
        )}
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-border/30 text-foreground/70 text-xs">
          {block.lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all log-line leading-relaxed">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────

export default function LogStream({ lines, taskId }: LogStreamProps) {
  const visible = lines.length > MAX_VISIBLE
    ? lines.slice(lines.length - MAX_VISIBLE)
    : lines;
  const skipped = lines.length - visible.length;

  const blocks = useMemo(() => {
    const parsed = parseBlocks(visible);
    // Newest first
    parsed.reverse();
    return parsed;
  }, [visible]);

  return (
    <div
      data-task-id={taskId}
      className="h-full bg-black/40 rounded-lg border border-border p-3 overflow-y-auto font-mono text-sm leading-relaxed space-y-1"
    >
      {skipped > 0 && (
        <div className="text-muted-foreground text-xs mb-1">
          ... {skipped} older entries hidden ...
        </div>
      )}
      {blocks.map((block) =>
        block.type === "separator" ? (
          <SeparatorBlock key={block.id} block={block} />
        ) : (
          <CollapsibleBlock
            key={block.id}
            block={block}
            defaultExpanded={block.type === "error" || (block.type === "text" && block.lines.length <= 5)}
          />
        )
      )}
      {blocks.length === 0 && (
        <div className="text-muted-foreground/40 text-xs text-center py-4">
          Waiting for log output...
        </div>
      )}
    </div>
  );
}
