import { describe, expect, test } from "bun:test";
import {
  DEMO_SOURCES,
  extractSheet,
} from "../../core/distill/hyperpop/index.ts";
import { createScore } from "../../core/score.ts";
import { SONG_TOOLS } from "./song-tools.ts";
import {
  AGENT_TOOLS,
  type ActionContext,
  type AgentTool,
  type ToolContext,
} from "./tools.ts";

const tool = (name: string) =>
  SONG_TOOLS.find((entry) => entry.name === name)! as AgentTool;
const context = (): ToolContext => ({
  score: createScore(),
  focusedTrackId: "lead",
  revision: 1,
  newNoteId: (track, index) => `${track}-${index}`,
});

describe("agent song sheets", () => {
  test("the guide is read-only and carries the playbook and an example", async () => {
    for (const name of ["song_guide", "write_song"])
      expect(AGENT_TOOLS.some((entry) => entry.name === name)).toBe(true);
    const plan = tool("song_guide").plan({}, context());
    if (plan.kind !== "action") throw new Error("expected a read-only guide");
    const guide = JSON.parse((await plan.run({} as ActionContext)).content);
    expect(guide.playbook).toContain("song sheets");
    expect(guide.example.sections.length).toBeGreaterThan(8);
    expect(() => tool("song_guide").plan({ x: 1 }, context())).toThrow();
  });

  test("write_song replaces the song with the compiled sheet and reports the critic", () => {
    const sheet = JSON.parse(
      JSON.stringify(extractSheet(DEMO_SOURCES[0]!).sheet),
    );
    const plan = tool("write_song").plan({ sheet }, context());
    if (plan.kind !== "replace") throw new Error("expected one replacement");
    expect(plan.next.bars).toBeGreaterThan(60);
    expect(plan.summary).toContain("critic 100");
    expect(() =>
      tool("write_song").plan({ sheet: { bpm: 1 } }, context()),
    ).toThrow("needs fixes");
    expect(() =>
      tool("write_song").plan({ sheet, extra: 1 }, context()),
    ).toThrow();
  });
});
