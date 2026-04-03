import { describe, it, expect } from "vitest";
import {
  detectFormat,
  formatOutput,
  splitForCollapse,
  COLLAPSED_LINE_LIMIT,
  FULL_SHOW_LIMIT,
} from "../../ui/src/lib/format-output";

describe("detectFormat", () => {
  it("detects JSON objects", () => {
    expect(detectFormat('{"key":"value"}')).toBe("json");
  });

  it("detects JSON arrays", () => {
    expect(detectFormat('[1,2,3]')).toBe("json");
  });

  it("returns text for invalid JSON-like strings", () => {
    expect(detectFormat("{not json}")).toBe("text");
  });

  it("detects file paths", () => {
    const input = "/home/user/file.ts\n/home/user/other.ts\n/usr/lib/node.js";
    expect(detectFormat(input)).toBe("filepath");
  });

  it("detects code patterns", () => {
    const input = `import { foo } from "bar";
const x = 42;
if (x > 0) {
  return x;
}`;
    expect(detectFormat(input)).toBe("code");
  });

  it("returns text for plain strings", () => {
    expect(detectFormat("Hello world")).toBe("text");
  });

  it("returns text for empty string", () => {
    expect(detectFormat("")).toBe("text");
  });
});

describe("formatOutput", () => {
  it("pretty-prints JSON", () => {
    const { formatted, format } = formatOutput('{"a":1,"b":2}');
    expect(format).toBe("json");
    expect(formatted).toContain('"a": 1');
    expect(formatted).toContain('"b": 2');
  });

  it("preserves file path text", () => {
    const input = "/src/index.ts\n/src/lib.ts";
    const { formatted, format } = formatOutput(input);
    expect(format).toBe("filepath");
    expect(formatted).toBe(input.trim());
  });

  it("passes through plain text", () => {
    const { formatted, format } = formatOutput("plain text");
    expect(format).toBe("text");
    expect(formatted).toBe("plain text");
  });
});

describe("splitForCollapse", () => {
  it("does not collapse short content", () => {
    const text = "line1\nline2\nline3";
    const result = splitForCollapse(text);
    expect(result.needsCollapse).toBe(false);
    expect(result.lines).toHaveLength(3);
    expect(result.previewLines).toHaveLength(3);
  });

  it("collapses content over FULL_SHOW_LIMIT lines", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const text = lines.join("\n");
    const result = splitForCollapse(text);
    expect(result.needsCollapse).toBe(true);
    expect(result.lines).toHaveLength(20);
    expect(result.previewLines).toHaveLength(COLLAPSED_LINE_LIMIT);
  });

  it("does not collapse exactly FULL_SHOW_LIMIT lines", () => {
    const lines = Array.from({ length: FULL_SHOW_LIMIT }, (_, i) => `line ${i}`);
    const text = lines.join("\n");
    const result = splitForCollapse(text);
    expect(result.needsCollapse).toBe(false);
  });
});
