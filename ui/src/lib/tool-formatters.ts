// ─── Tool-aware output formatting ─────────────────────────────────────
// Parses tool inputs/outputs and produces human-friendly structured data
// that the UI can render with tool-specific templates.

export type ToolOutputKind =
  | "read"
  | "edit"
  | "bash"
  | "grep"
  | "glob"
  | "mcp"
  | "error"
  | "generic";

// ─── Parsed output shapes ────────────────────────────────────────────

export interface ReadOutput {
  kind: "read";
  filePath: string;
  lineRange: string | null; // e.g. "1–50"
  content: string;
}

export interface EditOutput {
  kind: "edit";
  filePath: string;
  oldText: string | null;
  newText: string | null;
  summary: string; // e.g. "Replaced 3 lines"
}

export interface BashOutput {
  kind: "bash";
  command: string;
  exitCode: number | null;
  stdout: string;
}

export interface GrepOutput {
  kind: "grep";
  pattern: string;
  matchCount: number;
  /** file → matching lines */
  matches: { file: string; lines: string[] }[];
}

export interface GlobOutput {
  kind: "glob";
  pattern: string;
  files: string[];
  totalCount: number;
}

export interface McpOutput {
  kind: "mcp";
  action: string; // human-readable action, e.g. "Created task"
  title: string | null; // primary entity name
  fields: { label: string; value: string }[];
}

export interface ErrorOutput {
  kind: "error";
  message: string;
  detail: string | null; // stack trace or full text
}

export interface GenericOutput {
  kind: "generic";
  text: string;
}

export type ParsedToolOutput =
  | ReadOutput
  | EditOutput
  | BashOutput
  | GrepOutput
  | GlobOutput
  | McpOutput
  | ErrorOutput
  | GenericOutput;

// ─── Input parsing helpers ───────────────────────────────────────────

/** Try to parse a JSON-ish input string */
function tryParseJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extract file_path from input string (JSON or key: value format) */
function extractFilePath(input: string): string | null {
  const json = tryParseJson(input);
  if (json) {
    return (json["file_path"] as string) ?? (json["filePath"] as string) ?? null;
  }
  // Try key: value format
  const match = input.match(/file_path:\s*(.+?)(?:,|\n|$)/);
  return match?.[1]?.trim() ?? null;
}

/** Extract a short filename from a full path */
function shortPath(filePath: string): string {
  const parts = filePath.split("/");
  // Show last 2-3 segments for context
  return parts.length > 3 ? "…/" + parts.slice(-3).join("/") : filePath;
}

// ─── Tool-specific parsers ───────────────────────────────────────────

function parseReadOutput(input: string, output: string): ReadOutput {
  const filePath = extractFilePath(input) ?? "unknown file";
  const json = tryParseJson(input);

  let lineRange: string | null = null;
  if (json) {
    const offset = json["offset"] as number | undefined;
    const limit = json["limit"] as number | undefined;
    if (offset !== undefined || limit !== undefined) {
      const start = (offset ?? 0) + 1;
      const end = limit ? start + limit - 1 : null;
      lineRange = end ? `${start}–${end}` : `from line ${start}`;
    }
  }

  // Try to detect line range from output (cat -n format: "  1\t...")
  if (!lineRange && output) {
    const lines = output.split("\n").filter((l) => l.trim());
    const firstMatch = lines[0]?.match(/^\s*(\d+)\t/);
    const lastMatch = lines[lines.length - 1]?.match(/^\s*(\d+)\t/);
    if (firstMatch && lastMatch) {
      lineRange = `${firstMatch[1]}–${lastMatch[1]}`;
    }
  }

  return {
    kind: "read",
    filePath: shortPath(filePath),
    lineRange,
    content: output,
  };
}

function parseEditOutput(input: string, output: string): EditOutput {
  const filePath = extractFilePath(input) ?? "unknown file";
  const json = tryParseJson(input);

  let oldText: string | null = null;
  let newText: string | null = null;

  if (json) {
    oldText = (json["old_string"] as string) ?? (json["oldString"] as string) ?? null;
    newText = (json["new_string"] as string) ?? (json["newString"] as string) ?? null;
  }

  // Build summary
  let summary = `Edited ${shortPath(filePath)}`;
  if (oldText && newText) {
    const oldLines = oldText.split("\n").length;
    const newLines = newText.split("\n").length;
    if (oldLines === newLines) {
      summary = `Changed ${oldLines} line${oldLines > 1 ? "s" : ""} in ${shortPath(filePath)}`;
    } else {
      summary = `Replaced ${oldLines} → ${newLines} lines in ${shortPath(filePath)}`;
    }
  } else if (output.toLowerCase().includes("created")) {
    summary = `Created ${shortPath(filePath)}`;
  }

  return {
    kind: "edit",
    filePath: shortPath(filePath),
    oldText,
    newText,
    summary,
  };
}

function parseBashOutput(input: string, output: string): BashOutput {
  const json = tryParseJson(input);
  const command = json
    ? (json["command"] as string) ?? input
    : input;

  // Try to detect exit code from output
  let exitCode: number | null = null;
  const exitMatch = output.match(/exit code[:\s]*(\d+)/i);
  if (exitMatch) exitCode = parseInt(exitMatch[1], 10);

  return {
    kind: "bash",
    command: command.trim(),
    exitCode,
    stdout: output,
  };
}

function parseGrepOutput(input: string, output: string): GrepOutput {
  const json = tryParseJson(input);
  const pattern = json
    ? (json["pattern"] as string) ?? ""
    : input.match(/pattern:\s*(.+?)(?:,|\n|$)/)?.[1]?.trim() ?? "";

  const matches: { file: string; lines: string[] }[] = [];
  let currentFile: string | null = null;
  let currentLines: string[] = [];

  for (const line of output.split("\n")) {
    // ripgrep format: "file:line:content" or just file paths
    const fileMatch = line.match(/^(.+?\.\w+):(\d+):(.*)$/);
    if (fileMatch) {
      const [, file, , content] = fileMatch;
      if (file !== currentFile) {
        if (currentFile && currentLines.length > 0) {
          matches.push({ file: shortPath(currentFile), lines: currentLines });
        }
        currentFile = file!;
        currentLines = [];
      }
      currentLines.push(content!.trim());
    } else if (line.trim()) {
      // Could be a file-only listing
      if (line.match(/^[\w./\\-]+\.\w+$/)) {
        matches.push({ file: shortPath(line.trim()), lines: [] });
      }
    }
  }
  if (currentFile && currentLines.length > 0) {
    matches.push({ file: shortPath(currentFile), lines: currentLines });
  }

  const matchCount = matches.reduce((sum, m) => sum + Math.max(m.lines.length, 1), 0);

  return {
    kind: "grep",
    pattern,
    matchCount,
    matches,
  };
}

function parseGlobOutput(input: string, output: string): GlobOutput {
  const json = tryParseJson(input);
  const pattern = json
    ? (json["pattern"] as string) ?? ""
    : input.match(/pattern:\s*(.+?)(?:,|\n|$)/)?.[1]?.trim() ?? "";

  const files = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map(shortPath);

  return {
    kind: "glob",
    pattern,
    files,
    totalCount: files.length,
  };
}

/** Known MCP action verbs from tool names */
const MCP_ACTION_MAP: Record<string, string> = {
  tasks_get: "Loaded task",
  tasks_create: "Created task",
  tasks_update: "Updated task",
  tasks_move: "Moved task",
  tasks_delete: "Deleted task",
  tasks_list: "Listed tasks",
  tasks_search: "Searched tasks",
  tasks_link: "Linked task",
  tasks_bulk_delete: "Bulk deleted tasks",
  tasks_bulk_move: "Bulk moved tasks",
  tasks_bulk_priority: "Bulk set priority",
  tasks_reorder: "Reordered tasks",
  epics_get: "Loaded epic",
  epics_create: "Created epic",
  epics_update: "Updated epic",
  epics_list: "Listed epics",
  epics_search: "Searched epics",
  epics_delete: "Deleted epic",
  epics_link_task: "Linked task to epic",
  epics_unlink_task: "Unlinked task from epic",
  notes_create: "Created note",
  notes_get: "Loaded note",
  notes_update: "Updated note",
  notes_delete: "Deleted note",
  notes_search: "Searched notes",
  notes_list: "Listed notes",
  skills_recall: "Recalled skills",
  skills_create: "Created skill",
  skills_get: "Loaded skill",
  skills_search: "Searched skills",
  skills_list: "Listed skills",
  skills_bump_usage: "Bumped skill usage",
  docs_search: "Searched docs",
  docs_get_node: "Loaded doc section",
  docs_get_toc: "Loaded table of contents",
  docs_explain_symbol: "Explained symbol",
  docs_find_examples: "Found examples",
  code_search: "Searched code",
  code_get_symbol: "Loaded symbol",
  code_get_file_symbols: "Listed file symbols",
  code_list_files: "Listed code files",
  code_search_files: "Searched code files",
  files_get_info: "Got file info",
  files_list: "Listed files",
  files_search: "Searched files",
  get_context: "Loaded project context",
};

function parseMcpOutput(toolName: string, input: string, output: string): McpOutput {
  const actionSegment = toolName.includes("__")
    ? toolName.split("__").pop()!
    : toolName;
  const action = MCP_ACTION_MAP[actionSegment] ?? humanizeAction(actionSegment);

  const outputJson = tryParseJson(output);
  const inputJson = tryParseJson(input);

  let title: string | null = null;
  const fields: { label: string; value: string }[] = [];

  if (outputJson) {
    // Extract common title fields
    title =
      (outputJson["title"] as string) ??
      (outputJson["name"] as string) ??
      null;

    // Extract key fields, skip verbose ones
    const skipKeys = new Set(["description", "body", "content", "steps", "attachments", "crossLinks"]);
    const maxFields = 6;

    for (const [key, val] of Object.entries(outputJson)) {
      if (fields.length >= maxFields) break;
      if (skipKeys.has(key)) continue;
      if (val === null || val === undefined) continue;
      if (key === "title" || key === "name") continue; // already shown as title

      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
        fields.push({ label: humanizeLabel(key), value: String(val) });
      } else if (Array.isArray(val)) {
        fields.push({ label: humanizeLabel(key), value: `${val.length} items` });
      }
    }

    // If no title from output, try input
    if (!title && inputJson) {
      title =
        (inputJson["title"] as string) ??
        (inputJson["taskId"] as string) ??
        (inputJson["query"] as string) ??
        (inputJson["context"] as string) ??
        null;
      if (title && title.length > 60) {
        title = title.slice(0, 57) + "…";
      }
    }
  } else if (output) {
    // Non-JSON MCP output — show as text
    fields.push({ label: "Result", value: output.slice(0, 200) });
  }

  // For list/search results that return arrays
  if (outputJson && Array.isArray(outputJson)) {
    title = `${(outputJson as unknown[]).length} results`;
    for (const item of (outputJson as Record<string, unknown>[]).slice(0, 3)) {
      const itemTitle = (item["title"] as string) ?? (item["name"] as string) ?? (item["id"] as string);
      if (itemTitle) {
        fields.push({ label: "•", value: itemTitle });
      }
    }
  }

  return { kind: "mcp", action, title, fields };
}

function humanizeAction(actionName: string): string {
  return actionName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// ─── Error detection & formatting ────────────────────────────────────

const STACK_TRACE_RE = /(\s+at\s+.+\(.+:\d+:\d+\)[\s\S]*)/;

function parseErrorOutput(output: string): ErrorOutput {
  // Try to extract a human-readable message before the stack trace
  const stackMatch = output.match(STACK_TRACE_RE);
  let message: string;
  let detail: string | null = null;

  if (stackMatch) {
    message = output.slice(0, stackMatch.index).trim();
    detail = stackMatch[1].trim();
  } else {
    // Take first meaningful line as message
    const lines = output.split("\n").filter((l) => l.trim());
    message = lines[0] ?? output;
    detail = lines.length > 1 ? lines.slice(1).join("\n") : null;
  }

  // Clean up message — remove "Error:" prefix redundancy
  message = message.replace(/^(Error:\s*)+/i, "Error: ");
  if (message.length > 200) {
    message = message.slice(0, 197) + "…";
  }

  return { kind: "error", message, detail };
}

// ─── Main dispatcher ─────────────────────────────────────────────────

export function parseToolOutput(
  toolName: string,
  input: string,
  output: string,
  isError: boolean,
): ParsedToolOutput {
  if (!output) return { kind: "generic", text: "" };

  // Error handling first — wrap any tool output as error if flagged
  if (isError) {
    return parseErrorOutput(output);
  }

  // Categorize by tool
  const isMcp = toolName.startsWith("mcp__");
  const actionSegment = toolName.includes("__")
    ? toolName.split("__").pop()!
    : toolName;
  const lower = actionSegment.toLowerCase();

  // Read tool
  if (lower === "read" || lower === "cat" || lower === "head" || lower === "tail") {
    return parseReadOutput(input, output);
  }

  // Edit / Write tool
  if (lower === "edit" || lower === "write" || lower === "notebookedit" || lower === "notebook_edit") {
    return parseEditOutput(input, output);
  }

  // Bash / Terminal
  if (lower === "bash" || lower === "terminal" || lower === "shell") {
    return parseBashOutput(input, output);
  }

  // Grep / Search
  if (lower === "grep" || lower === "rg" || lower === "search") {
    return parseGrepOutput(input, output);
  }

  // Glob / Find
  if (lower === "glob" || lower === "find" || lower === "list_files" || lower === "ls") {
    return parseGlobOutput(input, output);
  }

  // MCP tools
  if (
    isMcp ||
    lower.startsWith("tasks_") ||
    lower.startsWith("epics_") ||
    lower.startsWith("docs_") ||
    lower.startsWith("skills_") ||
    lower.startsWith("notes_") ||
    lower.startsWith("code_") ||
    lower.startsWith("files_") ||
    lower === "get_context"
  ) {
    return parseMcpOutput(toolName, input, output);
  }

  return { kind: "generic", text: output };
}
