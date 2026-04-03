import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  FileText,
  Pencil,
  Terminal,
  Search,
  FolderSearch,
  Globe,
  Brain,
  Wrench,
  Database,
  ChevronRight,
  ChevronDown,
  ChevronsUpDown,
  ArrowDownToLine,
  AlertTriangle,
  MessageSquare,
  Loader2,
  CheckCircle2,
  XCircle,
  File as FileIcon,
  Plus,
  Minus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  pairEventsToSteps,
  formatDuration,
  durationColorClass,
  formatTime,
  formatRelativeTime,
  type AgentToolEvent,
  type Step,
} from "@/lib/step-utils";
import {
  splitForCollapse,
} from "@/lib/format-output";
import {
  parseToolOutput,
  type ParsedToolOutput,
} from "@/lib/tool-formatters";

// ─── Types ────────────────────────────────────────────────────────────────

export type { AgentToolEvent } from "@/lib/step-utils";

export interface AgentState {
  events: AgentToolEvent[];
  thinking: boolean;
  thinkingText?: string;
  turn: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  warning?: string;
}

export const EMPTY_AGENT_STATE: AgentState = {
  events: [],
  thinking: false,
  turn: 0,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
};

// ─── Tool icon + color mapping ───────────────────────────────────────────

type ToolCategory = "file" | "edit" | "terminal" | "search" | "glob" | "web" | "mcp" | "thinking" | "text" | "unknown";

interface ToolStyle {
  icon: typeof FileText;
  color: string;       // text color class
  bgColor: string;     // background accent class
  borderColor: string; // left border class
}

const TOOL_STYLES: Record<ToolCategory, ToolStyle> = {
  file:     { icon: FileText,     color: "text-blue-400",    bgColor: "bg-blue-500/5",    borderColor: "border-l-blue-500/40" },
  edit:     { icon: Pencil,       color: "text-emerald-400", bgColor: "bg-emerald-500/5",  borderColor: "border-l-emerald-500/40" },
  terminal: { icon: Terminal,     color: "text-amber-400",   bgColor: "bg-amber-500/5",    borderColor: "border-l-amber-500/40" },
  search:  { icon: Search,       color: "text-cyan-400",    bgColor: "bg-cyan-500/5",     borderColor: "border-l-cyan-500/40" },
  glob:    { icon: FolderSearch,  color: "text-cyan-400",    bgColor: "bg-cyan-500/5",     borderColor: "border-l-cyan-500/40" },
  web:     { icon: Globe,         color: "text-indigo-400",  bgColor: "bg-indigo-500/5",   borderColor: "border-l-indigo-500/40" },
  mcp:     { icon: Database,      color: "text-violet-400",  bgColor: "bg-violet-500/5",   borderColor: "border-l-violet-500/40" },
  thinking: { icon: Brain,        color: "text-purple-400",  bgColor: "bg-purple-500/5",   borderColor: "border-l-purple-500/40" },
  text:    { icon: MessageSquare, color: "text-foreground/60", bgColor: "bg-muted/30",     borderColor: "border-l-muted-foreground/20" },
  unknown: { icon: Wrench,        color: "text-muted-foreground", bgColor: "bg-muted/20",  borderColor: "border-l-muted-foreground/20" },
};

/** Error step override — red accent */
const ERROR_STYLE: Pick<ToolStyle, "bgColor" | "borderColor"> = {
  bgColor: "bg-red-500/5",
  borderColor: "border-l-red-500/50",
};

/** Robust tool-name → category mapping. Handles raw names and mcp__server__action formats. */
function categorize(toolName: string): ToolCategory {
  // For MCP tools, check prefix first — then fall through to action segment
  const isMcp = toolName.startsWith("mcp__");
  const actionSegment = toolName.includes("__") ? toolName.split("__").pop()! : toolName;
  const lower = actionSegment.toLowerCase();

  // File reading
  if (lower === "read" || lower === "cat" || lower === "head" || lower === "tail") return "file";
  // File editing / writing
  if (lower === "edit" || lower === "write" || lower === "notebookedit" || lower === "notebook_edit") return "edit";
  // Shell / terminal
  if (lower === "bash" || lower === "terminal" || lower === "shell") return "terminal";
  // Glob / find (folder search)
  if (lower === "glob" || lower === "find" || lower === "list_files" || lower === "ls") return "glob";
  // Grep / search
  if (lower === "grep" || lower === "search" || lower === "rg") return "search";
  // Web
  if (lower === "webfetch" || lower === "websearch" || lower === "web_fetch" || lower === "web_search" || lower === "fetch") return "web";
  // MCP graph-memory tools (broad match on known prefixes)
  if (isMcp || lower.startsWith("tasks_") || lower.startsWith("epics_") || lower.startsWith("docs_") || lower.startsWith("skills_") || lower.startsWith("notes_") || lower.startsWith("code_") || lower.startsWith("files_") || lower.startsWith("get_context")) return "mcp";
  // Catch-all search for tools whose name contains "search"
  if (lower.includes("search")) return "search";

  return "unknown";
}

function getToolStyle(toolName: string): ToolStyle {
  return TOOL_STYLES[categorize(toolName)];
}

function getToolDisplayName(toolName: string): string {
  if (!toolName.includes("__")) return toolName;
  const parts = toolName.split("__");
  // mcp__graph-memory__tasks_get → tasks_get
  return parts[parts.length - 1] ?? toolName;
}

// ─── Collapsible text block ─────────────────────────────────────────────

function CollapsibleText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [showFull, setShowFull] = useState(false);
  const { lines, needsCollapse, previewLines } = useMemo(
    () => splitForCollapse(text),
    [text],
  );

  const displayText = needsCollapse && !showFull ? previewLines.join("\n") : text;

  return (
    <div className="space-y-1">
      <pre className={className ?? "text-xs font-mono whitespace-pre-wrap break-all rounded px-2 py-1.5 text-foreground/70 bg-black/20"}>
        {displayText}
      </pre>
      {needsCollapse && (
        <button
          onClick={() => setShowFull((v) => !v)}
          className="text-[10px] text-primary/70 hover:text-primary font-medium cursor-pointer ml-2"
        >
          {showFull ? "Show less" : `Show ${lines.length - previewLines.length} more lines…`}
        </button>
      )}
    </div>
  );
}

// ─── Tool-aware Output Renderers ────────────────────────────────────────

function ReadOutputView({ parsed }: { parsed: Extract<ParsedToolOutput, { kind: "read" }> }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] text-blue-400/70">
        <FileText className="w-3 h-3" />
        <span className="font-mono font-medium">{parsed.filePath}</span>
        {parsed.lineRange && (
          <span className="text-blue-400/50">lines {parsed.lineRange}</span>
        )}
      </div>
      <CollapsibleText
        text={parsed.content}
        className="text-xs font-mono whitespace-pre-wrap break-all rounded px-2 py-1.5 text-foreground/70 bg-black/20 border-l border-l-blue-500/20"
      />
    </div>
  );
}

function EditOutputView({ parsed }: { parsed: Extract<ParsedToolOutput, { kind: "edit" }> }) {
  const [showDiff, setShowDiff] = useState(false);
  const hasDiff = parsed.oldText !== null && parsed.newText !== null;

  return (
    <div className="space-y-1">
      {/* Summary header */}
      <div className="flex items-center gap-1.5 text-[10px]">
        <Pencil className="w-3 h-3 text-emerald-400/70" />
        <span className="text-emerald-400/80 font-medium">{parsed.summary}</span>
        {hasDiff && (
          <button
            onClick={() => setShowDiff((v) => !v)}
            className="text-[10px] text-muted-foreground hover:text-foreground/70 cursor-pointer ml-1 underline underline-offset-2"
          >
            {showDiff ? "hide diff" : "show diff"}
          </button>
        )}
      </div>

      {/* Diff view */}
      {showDiff && hasDiff && (
        <div className="rounded bg-black/20 border-l border-l-emerald-500/20 overflow-hidden">
          {parsed.oldText && (
            <div className="px-2 py-1 border-b border-red-500/10">
              <div className="flex items-center gap-1 text-[10px] text-red-400/60 mb-0.5">
                <Minus className="w-2.5 h-2.5" />
                <span>Removed</span>
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all text-red-300/60 bg-red-950/20 rounded px-1.5 py-1">
                {parsed.oldText}
              </pre>
            </div>
          )}
          {parsed.newText && (
            <div className="px-2 py-1">
              <div className="flex items-center gap-1 text-[10px] text-emerald-400/60 mb-0.5">
                <Plus className="w-2.5 h-2.5" />
                <span>Added</span>
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all text-emerald-300/60 bg-emerald-950/20 rounded px-1.5 py-1">
                {parsed.newText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BashOutputView({ parsed }: { parsed: Extract<ParsedToolOutput, { kind: "bash" }> }) {
  return (
    <div className="space-y-1">
      {/* Command line */}
      <div className="flex items-center gap-1.5 rounded bg-black/30 px-2 py-1 border-l border-l-amber-500/30">
        <span className="text-amber-400/60 text-xs font-mono select-none">$</span>
        <code className="text-xs font-mono text-amber-300/80 break-all">{parsed.command}</code>
        {parsed.exitCode !== null && parsed.exitCode !== 0 && (
          <Badge variant="outline" className="ml-auto text-[9px] px-1 py-0 h-3.5 border-red-500/30 text-red-400">
            exit {parsed.exitCode}
          </Badge>
        )}
      </div>
      {/* Output */}
      {parsed.stdout && (
        <CollapsibleText
          text={parsed.stdout}
          className="text-xs font-mono whitespace-pre-wrap break-all rounded px-2 py-1.5 text-foreground/60 bg-black/20"
        />
      )}
    </div>
  );
}

function GrepOutputView({ parsed }: { parsed: Extract<ParsedToolOutput, { kind: "grep" }> }) {
  const [showFull, setShowFull] = useState(false);
  const displayMatches = showFull ? parsed.matches : parsed.matches.slice(0, 5);
  const hasMore = parsed.matches.length > 5;

  return (
    <div className="space-y-1">
      {/* Summary header */}
      <div className="flex items-center gap-1.5 text-[10px] text-cyan-400/70">
        <Search className="w-3 h-3" />
        <span className="font-medium">
          Found {parsed.matchCount} match{parsed.matchCount !== 1 ? "es" : ""} in {parsed.matches.length} file{parsed.matches.length !== 1 ? "s" : ""}
        </span>
        {parsed.pattern && (
          <code className="text-cyan-400/50 font-mono">/{parsed.pattern}/</code>
        )}
      </div>

      {/* Match list */}
      <div className="rounded bg-black/20 border-l border-l-cyan-500/20 px-2 py-1 space-y-1.5">
        {displayMatches.map((m, i) => (
          <div key={i}>
            <span className="text-[10px] font-mono text-cyan-400/60">{m.file}</span>
            {m.lines.length > 0 && (
              <div className="mt-0.5 space-y-0.5">
                {m.lines.slice(0, 3).map((line, j) => (
                  <div key={j} className="text-xs font-mono text-foreground/50 truncate pl-2 border-l border-l-cyan-500/10">
                    {line}
                  </div>
                ))}
                {m.lines.length > 3 && (
                  <span className="text-[10px] text-muted-foreground pl-2">+{m.lines.length - 3} more</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setShowFull((v) => !v)}
          className="text-[10px] text-primary/70 hover:text-primary font-medium cursor-pointer ml-2"
        >
          {showFull ? "Show less" : `Show ${parsed.matches.length - 5} more files…`}
        </button>
      )}
    </div>
  );
}

function GlobOutputView({ parsed }: { parsed: Extract<ParsedToolOutput, { kind: "glob" }> }) {
  const [showFull, setShowFull] = useState(false);
  const displayFiles = showFull ? parsed.files : parsed.files.slice(0, 8);
  const hasMore = parsed.files.length > 8;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] text-cyan-400/70">
        <FolderSearch className="w-3 h-3" />
        <span className="font-medium">
          {parsed.totalCount} file{parsed.totalCount !== 1 ? "s" : ""} matching
        </span>
        {parsed.pattern && (
          <code className="text-cyan-400/50 font-mono">{parsed.pattern}</code>
        )}
      </div>
      <div className="rounded bg-black/20 border-l border-l-cyan-500/20 px-2 py-1 space-y-0.5">
        {displayFiles.map((file, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <FileIcon className="w-3 h-3 text-blue-400/40 shrink-0" />
            <span className="text-xs font-mono text-foreground/60">{file}</span>
          </div>
        ))}
      </div>
      {hasMore && (
        <button
          onClick={() => setShowFull((v) => !v)}
          className="text-[10px] text-primary/70 hover:text-primary font-medium cursor-pointer ml-2"
        >
          {showFull ? "Show less" : `Show ${parsed.files.length - 8} more…`}
        </button>
      )}
    </div>
  );
}

function McpOutputView({ parsed }: { parsed: Extract<ParsedToolOutput, { kind: "mcp" }> }) {
  return (
    <div className="space-y-1">
      {/* Action header */}
      <div className="flex items-center gap-1.5 text-[10px]">
        <Database className="w-3 h-3 text-violet-400/70" />
        <span className="text-violet-400/80 font-medium">{parsed.action}</span>
        {parsed.title && (
          <span className="font-semibold text-foreground/70 text-xs truncate">
            {parsed.title}
          </span>
        )}
      </div>
      {/* Key fields */}
      {parsed.fields.length > 0 && (
        <div className="rounded bg-black/20 border-l border-l-violet-500/20 px-2 py-1 space-y-0.5">
          {parsed.fields.map((f, i) => (
            <div key={i} className="flex items-baseline gap-2 text-xs">
              <span className="text-violet-400/50 font-mono text-[10px] shrink-0 min-w-[60px]">{f.label}</span>
              <span className="text-foreground/60 font-mono truncate">{f.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorOutputView({ parsed }: { parsed: Extract<ParsedToolOutput, { kind: "error" }> }) {
  const [showTrace, setShowTrace] = useState(false);

  return (
    <div className="space-y-1">
      {/* Error banner */}
      <div className="flex items-start gap-1.5 rounded bg-red-950/30 border border-red-500/20 px-2 py-1.5">
        <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
        <span className="text-xs text-red-300/80 break-words">{parsed.message}</span>
      </div>
      {/* Collapsed stack trace */}
      {parsed.detail && (
        <div>
          <button
            onClick={() => setShowTrace((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-red-400/50 hover:text-red-400/80 cursor-pointer ml-1"
          >
            {showTrace ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
            {showTrace ? "Hide details" : "Show details"}
          </button>
          {showTrace && (
            <pre className="text-[10px] font-mono whitespace-pre-wrap break-all text-red-300/40 bg-red-950/15 rounded px-2 py-1 mt-0.5 max-h-32 overflow-y-auto">
              {parsed.detail}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** Renders tool output with tool-aware formatting */
function ToolAwareOutput({
  toolName,
  input,
  raw,
  isError,
}: {
  toolName: string;
  input: string;
  raw: string;
  isError: boolean;
}) {
  const parsed = useMemo(
    () => parseToolOutput(toolName, input, raw, isError),
    [toolName, input, raw, isError],
  );

  switch (parsed.kind) {
    case "read":
      return <ReadOutputView parsed={parsed} />;
    case "edit":
      return <EditOutputView parsed={parsed} />;
    case "bash":
      return <BashOutputView parsed={parsed} />;
    case "grep":
      return <GrepOutputView parsed={parsed} />;
    case "glob":
      return <GlobOutputView parsed={parsed} />;
    case "mcp":
      return <McpOutputView parsed={parsed} />;
    case "error":
      return <ErrorOutputView parsed={parsed} />;
    case "generic":
      return (
        <CollapsibleText
          text={parsed.text}
          className="text-xs font-mono whitespace-pre-wrap break-all rounded px-2 py-1.5 text-foreground/70 bg-black/20"
        />
      );
  }
}

// ─── Step Card ───────────────────────────────────────────────────────────

/** Status pill shown on each step card */
function StatusPill({ status }: { status: Step["status"] }) {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0 h-4 rounded-full bg-blue-500/15 text-blue-400 text-[10px] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          running
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0 h-4 rounded-full bg-red-500/15 text-red-400 text-[10px] font-medium">
          <XCircle className="w-2.5 h-2.5" />
          error
        </span>
      );
    case "done":
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0 h-4 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-medium">
          <CheckCircle2 className="w-2.5 h-2.5" />
          done
        </span>
      );
  }
}

function StepCard({
  step,
  runStartTime,
  forceExpanded,
}: {
  step: Step;
  runStartTime: number;
  forceExpanded: boolean | null; // null = use local state
}) {
  // Input section is the only expandable part now
  const [inputExpanded, setInputExpanded] = useState(false);
  const showInput = forceExpanded ?? inputExpanded;
  const toggleInput = () => setInputExpanded((v) => !v);
  const baseStyle = getToolStyle(step.tool);
  const isError = step.status === "error";
  // Override border/bg for error steps
  const borderColor = isError ? ERROR_STYLE.borderColor : baseStyle.borderColor;
  const bgColor = isError ? ERROR_STYLE.bgColor : baseStyle.bgColor;
  const Icon = baseStyle.icon;
  const iconColor = isError ? "text-red-400" : baseStyle.color;
  const displayName = getToolDisplayName(step.tool);
  const category = categorize(step.tool);
  const isMcp = category === "mcp";
  const duration = step.endTime ? step.endTime - step.startTime : null;
  const relativeTime = formatRelativeTime(step.startTime, runStartTime);

  return (
    <div
      className={`border-l-2 ${borderColor} ${bgColor} rounded-r-md transition-colors`}
    >
      {/* Header — always visible: icon + name + input summary + duration */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${iconColor}`} />
        <span className={`font-semibold text-xs ${iconColor}`}>
          {displayName}
        </span>
        {isMcp && (
          <span className="text-[10px] text-violet-400/60 font-mono">mcp</span>
        )}

        {/* Status pill */}
        <StatusPill status={step.status} />

        {/* Input summary — clickable to expand input details */}
        {step.input && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-1 flex-1 min-w-0 text-left cursor-pointer hover:bg-white/[0.03] rounded px-1 -mx-1 transition-colors" onClick={toggleInput}>
                  <ChevronRight
                    className={`w-2.5 h-2.5 text-muted-foreground/50 shrink-0 transition-transform duration-150 ${showInput ? "rotate-90" : ""}`}
                  />
                  <span className="block truncate text-xs text-foreground/40 font-mono">
                    {step.input.slice(0, 80)}
                  </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm font-mono text-[11px] whitespace-pre-wrap break-all">
                {step.input.slice(0, 200)}{step.input.length > 200 ? "…" : ""}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        <span className="ml-auto flex items-center gap-2 shrink-0">
          {/* Duration badge */}
          {duration !== null && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-mono px-1.5 py-0 h-4 border ${durationColorClass(duration)}`}
                  >
                    {formatDuration(duration)}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  {formatTime(step.startTime)} — {step.endTime ? formatTime(step.endTime) : "..."}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Relative timestamp */}
          <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums w-12 text-right">
            {relativeTime}
          </span>
        </span>
      </div>

      {/* Collapsible input detail */}
      {showInput && step.input && (
        <div className="px-3 pb-1.5 pl-9">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Input</p>
          <pre className="text-xs text-foreground/70 font-mono whitespace-pre-wrap break-all bg-black/20 rounded px-2 py-1.5 max-h-40 overflow-y-auto">
            {step.input}
          </pre>
        </div>
      )}

      {/* Output — always visible, tool-aware formatting */}
      {step.output && (
        <div className="px-3 pb-2 pl-9">
          <ToolAwareOutput toolName={step.tool} input={step.input} raw={step.output} isError={isError} />
        </div>
      )}
    </div>
  );
}

// ─── Thinking indicator — chat bubble style ─────────────────────────────

function ThinkingBlock({
  text,
  forceExpanded: _forceExpanded,
}: {
  text?: string;
  forceExpanded: boolean | null;
}) {
  const [showFull, setShowFull] = useState(false);

  // Always-visible chat bubble style
  const lines = text ? text.split("\n") : [];
  const needsCollapse = lines.length > 10;
  const displayText =
    needsCollapse && !showFull ? lines.slice(0, 8).join("\n") : (text ?? "");

  return (
    <div className="border-l-2 border-l-purple-500/40 bg-purple-500/[0.07] rounded-r-md transition-colors">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Brain className="w-3.5 h-3.5 text-purple-400 animate-pulse shrink-0" />
        <span className="text-xs font-semibold text-purple-400">Thinking</span>
      </div>

      {/* Content — always visible */}
      {text && (
        <div className="px-3 pb-2 pl-9">
          <div className="text-xs text-purple-300/70 font-mono whitespace-pre-wrap break-words bg-purple-950/20 rounded-lg px-3 py-2 leading-relaxed">
            {displayText}
          </div>
          {needsCollapse && (
            <button
              onClick={() => setShowFull((v) => !v)}
              className="text-[10px] text-purple-400/70 hover:text-purple-400 font-medium cursor-pointer ml-2 mt-1"
            >
              {showFull
                ? "Show less"
                : `Show ${lines.length - 8} more lines…`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────

const MAX_STEPS = 150;

export default function AgentActivity({
  state,
  runStartTime,
}: {
  state: AgentState;
  runStartTime?: number;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const prevStepCount = useRef(0);
  // null = each card manages its own state; true/false = force all
  const [expandAll, setExpandAll] = useState<boolean | null>(null);

  const toggleExpandAll = useCallback(() => {
    setExpandAll((prev) => (prev === true ? false : true));
  }, []);

  const startTime = runStartTime ?? (state.events[0]?.timestamp ?? Date.now());

  const steps = useMemo(() => {
    const all = pairEventsToSteps(state.events);
    return all.length > MAX_STEPS ? all.slice(-MAX_STEPS) : all;
  }, [state.events]);

  // Auto-scroll when pinned
  useEffect(() => {
    if (pinned) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setNewCount(0);
    } else if (steps.length > prevStepCount.current) {
      setNewCount((c) => c + (steps.length - prevStepCount.current));
    }
    prevStepCount.current = steps.length;
  }, [steps.length, pinned, state.thinking]);

  const handleScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom) {
      setPinned(true);
      setNewCount(0);
    } else {
      setPinned(false);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    setPinned(true);
    setNewCount(0);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const hasActivity = state.turn > 0 || steps.length > 0 || state.thinking;

  return (
    <div className="flex flex-col h-full gap-2 relative">
      {/* Warning banner */}
      {state.warning && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs font-mono">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {state.warning}
        </div>
      )}

      {/* Section header with expand/collapse toggle */}
      {hasActivity && steps.length > 0 && (
        <div className="flex items-center justify-end px-1">
          <button
            onClick={toggleExpandAll}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground/70 transition-colors cursor-pointer"
          >
            <ChevronsUpDown className="w-3 h-3" />
            {expandAll === true ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}

      {/* Step stream */}
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        className="flex-1 rounded-lg border border-border bg-black/30 p-2 overflow-y-auto space-y-1"
      >
        {!hasActivity && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-xs">
            <Loader2 className="w-4 h-4 animate-spin" />
            Waiting for agent activity...
          </div>
        )}

        {steps.map((step) => (
          <StepCard key={step.id} step={step} runStartTime={startTime} forceExpanded={expandAll} />
        ))}

        {state.thinking && <ThinkingBlock text={state.thinkingText} forceExpanded={expandAll} />}

        <div ref={bottomRef} />
      </div>

      {/* New steps indicator + pin button */}
      {(!pinned || newCount > 0) && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/90 text-primary-foreground text-xs font-medium shadow-lg hover:bg-primary transition-colors cursor-pointer"
        >
          <ArrowDownToLine className="w-3 h-3" />
          {newCount > 0 ? `${newCount} new` : "Jump to bottom"}
        </button>
      )}
    </div>
  );
}
