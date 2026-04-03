import { describe, it, expect } from "vitest";
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

describe("Agent SDK", () => {
  it("exports query function", () => {
    expect(typeof query).toBe("function");
  });

  it("exports createSdkMcpServer function", () => {
    expect(typeof createSdkMcpServer).toBe("function");
  });

  it("exports tool helper function", () => {
    expect(typeof tool).toBe("function");
  });
});
