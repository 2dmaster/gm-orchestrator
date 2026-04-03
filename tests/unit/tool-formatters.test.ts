import { describe, it, expect } from "vitest";
import { parseToolOutput } from "../../ui/src/lib/tool-formatters";

describe("parseToolOutput", () => {
  describe("Read tool", () => {
    it("parses read output with file path and line range from cat -n format", () => {
      const input = '{"file_path": "/home/user/src/index.ts", "offset": 0, "limit": 50}';
      const output = "     1\timport { foo } from 'bar';\n     2\tconst x = 42;\n    50\t// end";
      const result = parseToolOutput("Read", input, output, false);

      expect(result.kind).toBe("read");
      if (result.kind === "read") {
        expect(result.filePath).toContain("index.ts");
        expect(result.lineRange).toBe("1–50");
        expect(result.content).toBe(output);
      }
    });

    it("handles read without line numbers in output", () => {
      const input = '{"file_path": "/src/app.ts"}';
      const output = "some file content";
      const result = parseToolOutput("Read", input, output, false);

      expect(result.kind).toBe("read");
      if (result.kind === "read") {
        expect(result.filePath).toContain("app.ts");
        expect(result.content).toBe("some file content");
      }
    });
  });

  describe("Edit tool", () => {
    it("parses edit with old and new strings", () => {
      const input = '{"file_path": "/src/lib/utils.ts", "old_string": "const a = 1;", "new_string": "const a = 2;"}';
      const output = "File edited successfully";
      const result = parseToolOutput("Edit", input, output, false);

      expect(result.kind).toBe("edit");
      if (result.kind === "edit") {
        expect(result.filePath).toContain("utils.ts");
        expect(result.oldText).toBe("const a = 1;");
        expect(result.newText).toBe("const a = 2;");
        expect(result.summary).toContain("1 line");
      }
    });

    it("generates summary for multi-line changes", () => {
      const input = '{"file_path": "/src/foo.ts", "old_string": "line1\\nline2\\nline3", "new_string": "newline1\\nnewline2"}';
      const output = "ok";
      const result = parseToolOutput("Edit", input, output, false);

      expect(result.kind).toBe("edit");
      if (result.kind === "edit") {
        expect(result.summary).toMatch(/3 → 2 lines/);
      }
    });

    it("detects file creation", () => {
      const input = '{"file_path": "/src/new-file.ts"}';
      const output = "Created new file";
      const result = parseToolOutput("Write", input, output, false);

      expect(result.kind).toBe("edit");
      if (result.kind === "edit") {
        expect(result.summary).toContain("Created");
      }
    });
  });

  describe("Bash tool", () => {
    it("parses bash command and output", () => {
      const input = '{"command": "npm test"}';
      const output = "All tests passed\n5 passing (2s)";
      const result = parseToolOutput("Bash", input, output, false);

      expect(result.kind).toBe("bash");
      if (result.kind === "bash") {
        expect(result.command).toBe("npm test");
        expect(result.stdout).toContain("All tests passed");
        expect(result.exitCode).toBeNull();
      }
    });

    it("extracts exit code from output", () => {
      const input = '{"command": "make build"}';
      const output = "Build failed\nexit code: 1";
      const result = parseToolOutput("Bash", input, output, false);

      expect(result.kind).toBe("bash");
      if (result.kind === "bash") {
        expect(result.exitCode).toBe(1);
      }
    });

    it("handles plain string input (not JSON)", () => {
      const input = "ls -la";
      const output = "total 42\ndrwxr-xr-x  5 user user 4096 Jan  1 00:00 .";
      const result = parseToolOutput("Bash", input, output, false);

      expect(result.kind).toBe("bash");
      if (result.kind === "bash") {
        expect(result.command).toBe("ls -la");
      }
    });
  });

  describe("Grep tool", () => {
    it("parses grep output with file:line:content format", () => {
      const input = '{"pattern": "TODO"}';
      const output = "src/index.ts:10:// TODO: fix this\nsrc/index.ts:25:// TODO: refactor\nsrc/lib.ts:3:// TODO: test";
      const result = parseToolOutput("Grep", input, output, false);

      expect(result.kind).toBe("grep");
      if (result.kind === "grep") {
        expect(result.pattern).toBe("TODO");
        expect(result.matchCount).toBe(3);
        expect(result.matches).toHaveLength(2); // 2 unique files
        expect(result.matches[0].file).toContain("index.ts");
        expect(result.matches[0].lines).toHaveLength(2);
      }
    });

    it("handles empty grep results as generic (no output to parse)", () => {
      const input = '{"pattern": "nonexistent"}';
      const output = "";
      const result = parseToolOutput("Grep", input, output, false);
      // Empty output returns generic early (nothing to format)
      expect(result.kind).toBe("generic");
    });

    it("handles grep with no file matches in output", () => {
      const input = '{"pattern": "nonexistent"}';
      const output = "No matches found";
      const result = parseToolOutput("Grep", input, output, false);

      expect(result.kind).toBe("grep");
      if (result.kind === "grep") {
        expect(result.matchCount).toBe(0);
        expect(result.matches).toHaveLength(0);
      }
    });
  });

  describe("Glob tool", () => {
    it("parses glob output as file list", () => {
      const input = '{"pattern": "**/*.ts"}';
      const output = "/home/user/src/index.ts\n/home/user/src/lib.ts\n/home/user/tests/test.ts";
      const result = parseToolOutput("Glob", input, output, false);

      expect(result.kind).toBe("glob");
      if (result.kind === "glob") {
        expect(result.totalCount).toBe(3);
        expect(result.pattern).toBe("**/*.ts");
      }
    });
  });

  describe("MCP tools", () => {
    it("parses tasks_get response", () => {
      const input = '{"taskId": "fix-auth-bug"}';
      const output = '{"id": "abc123", "title": "Fix auth bug", "status": "in_progress", "priority": "high", "tags": ["bug"]}';
      const result = parseToolOutput("mcp__graph-memory__tasks_get", input, output, false);

      expect(result.kind).toBe("mcp");
      if (result.kind === "mcp") {
        expect(result.action).toBe("Loaded task");
        expect(result.title).toBe("Fix auth bug");
        expect(result.fields.length).toBeGreaterThan(0);
        // Should show status, priority, etc. but not description
        const fieldLabels = result.fields.map((f) => f.label);
        expect(fieldLabels).toContain("Status");
        expect(fieldLabels).toContain("Priority");
      }
    });

    it("parses tasks_move response", () => {
      const input = '{"taskId": "fix-auth-bug", "status": "done"}';
      const output = '{"id": "abc123", "title": "Fix auth bug", "status": "done"}';
      const result = parseToolOutput("mcp__graph-memory__tasks_move", input, output, false);

      expect(result.kind).toBe("mcp");
      if (result.kind === "mcp") {
        expect(result.action).toBe("Moved task");
        expect(result.title).toBe("Fix auth bug");
      }
    });

    it("parses skills_recall response", () => {
      const input = '{"context": "formatting output"}';
      const output = '[{"id": "1", "title": "Debug Workflow", "score": 0.9}, {"id": "2", "title": "Dev Workflow", "score": 0.8}]';
      const result = parseToolOutput("mcp__graph-memory__skills_recall", input, output, false);

      expect(result.kind).toBe("mcp");
      if (result.kind === "mcp") {
        expect(result.action).toBe("Recalled skills");
      }
    });

    it("handles non-JSON MCP output", () => {
      const input = '{"query": "test"}';
      const output = "No results found";
      const result = parseToolOutput("mcp__graph-memory__docs_search", input, output, false);

      expect(result.kind).toBe("mcp");
      if (result.kind === "mcp") {
        expect(result.action).toBe("Searched docs");
        expect(result.fields[0].value).toBe("No results found");
      }
    });
  });

  describe("Error handling", () => {
    it("formats errors with stack traces", () => {
      const output = "TypeError: Cannot read property 'foo' of undefined\n    at Object.<anonymous> (/src/index.ts:10:5)\n    at Module._compile (internal/modules/cjs/loader.js:999:30)";
      const result = parseToolOutput("Bash", "", output, true);

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.message).toContain("TypeError");
        expect(result.detail).toContain("at Object");
      }
    });

    it("formats errors without stack traces", () => {
      const output = "ENOENT: no such file or directory";
      const result = parseToolOutput("Read", "", output, true);

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.message).toContain("ENOENT");
      }
    });

    it("always returns error kind when isError is true", () => {
      const output = '{"status": "ok"}';
      const result = parseToolOutput("mcp__graph-memory__tasks_get", "", output, true);
      expect(result.kind).toBe("error");
    });
  });

  describe("Generic fallback", () => {
    it("returns generic for unknown tools", () => {
      const result = parseToolOutput("SomeUnknownTool", "", "output text", false);
      expect(result.kind).toBe("generic");
      if (result.kind === "generic") {
        expect(result.text).toBe("output text");
      }
    });

    it("returns generic for empty output", () => {
      const result = parseToolOutput("Read", "", "", false);
      expect(result.kind).toBe("generic");
    });
  });
});
