import { describe, expect, test } from "bun:test";
import { AGENT_TOOLS, chatTools } from "./tools.ts";

describe("tool schemas fit provider limits", () => {
  test("every tool description is at most 1024 characters and names are valid", () => {
    const tools = chatTools(AGENT_TOOLS);
    expect(tools.length).toBeGreaterThan(0);
    const over = tools
      .filter((tool) => tool.function.description.length > 1024)
      .map(
        (tool) => `${tool.function.name} (${tool.function.description.length})`,
      );
    expect(over).toEqual([]);
    for (const tool of tools)
      expect(tool.function.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(new Set(tools.map((tool) => tool.function.name)).size).toBe(
      tools.length,
    );
  });

  test("the serialized tool list is deterministic, so the cached prefix stays stable", () => {
    expect(JSON.stringify(chatTools(AGENT_TOOLS))).toBe(
      JSON.stringify(chatTools(AGENT_TOOLS)),
    );
  });
});
