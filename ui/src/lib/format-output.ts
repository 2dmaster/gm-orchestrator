// ─── Smart output formatting for tool results ──────────────────────────

/** Maximum lines to show before collapsing with "show more" */
export const COLLAPSED_LINE_LIMIT = 8;
export const FULL_SHOW_LIMIT = 10;

export type OutputFormat = "json" | "code" | "filepath" | "text";

/** Try to parse as JSON, return pretty-printed if valid */
function tryPrettyJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return null;
    }
  }
  return null;
}

/** Detect if the output looks like a file path listing */
const FILE_PATH_RE = /^(\/[\w.\-/]+|\w:\\[\w.\-\\]+)$/;

function looksLikeFilePaths(raw: string): boolean {
  const lines = raw.trim().split("\n");
  if (lines.length === 0) return false;
  // At least 60% of lines should match file path pattern
  const matching = lines.filter((l) => FILE_PATH_RE.test(l.trim())).length;
  return matching / lines.length >= 0.6;
}

/** Detect if output looks like a code block (common heuristics) */
const CODE_INDICATORS = [
  /^(import |export |const |let |var |function |class |interface |type |enum )/m,
  /^(def |async def |from .+ import)/m,
  /^\s*(if|for|while|return|try|catch|switch)\s*[\({]/m,
  /[{};]\s*$/m,
  /=>\s*[{(]/m,
];

function looksLikeCode(raw: string): boolean {
  return CODE_INDICATORS.filter((re) => re.test(raw)).length >= 2;
}

/** Detect the format of a tool output string */
export function detectFormat(raw: string): OutputFormat {
  if (!raw || raw.trim().length === 0) return "text";
  if (tryPrettyJson(raw) !== null) return "json";
  if (looksLikeFilePaths(raw)) return "filepath";
  if (looksLikeCode(raw)) return "code";
  return "text";
}

/** Format the output string for display. Returns { formatted, format } */
export function formatOutput(raw: string): { formatted: string; format: OutputFormat } {
  if (!raw) return { formatted: raw, format: "text" };

  const jsonFormatted = tryPrettyJson(raw);
  if (jsonFormatted !== null) {
    return { formatted: jsonFormatted, format: "json" };
  }
  if (looksLikeFilePaths(raw)) {
    return { formatted: raw.trim(), format: "filepath" };
  }
  if (looksLikeCode(raw)) {
    return { formatted: raw, format: "code" };
  }
  return { formatted: raw, format: "text" };
}

/** Split text into lines and determine if it needs collapsing */
export function splitForCollapse(text: string): {
  lines: string[];
  needsCollapse: boolean;
  previewLines: string[];
} {
  const lines = text.split("\n");
  const needsCollapse = lines.length > FULL_SHOW_LIMIT;
  const previewLines = needsCollapse ? lines.slice(0, COLLAPSED_LINE_LIMIT) : lines;
  return { lines, needsCollapse, previewLines };
}
