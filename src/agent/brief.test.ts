import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { compositionBrief, MAX_BRIEF_BYTES } from "./brief.ts";
import { AGENT_TOOLS, chatTools } from "./tools.ts";

const score = createScore({
  tempoBpm: 92,
  tracks: [
    { id: "main", instrument: "piano" },
    { id: "bass", instrument: "bass", muted: true },
  ],
  notes: [
    {
      id: "n2",
      trackId: "main",
      startTick: 480,
      durationTicks: 240,
      pitch: 64,
      velocity: 0.7,
    },
    {
      id: "n1",
      trackId: "main",
      startTick: 0,
      durationTicks: 480,
      pitch: 60,
      velocity: 0.9,
    },
    {
      id: "b1",
      trackId: "bass",
      startTick: 0,
      durationTicks: 960,
      pitch: 36,
      velocity: 1,
    },
  ],
});

describe("composition brief", () => {
  test("is compact, deterministic, and summarizes every track", () => {
    const options = {
      score,
      revision: 7,
      focusedTrackId: "main",
      recentOperations: ["agent.tool: +2 main notes"],
    };
    const brief = compositionBrief(options);
    expect(compositionBrief(options)).toBe(brief);
    const parsed = JSON.parse(brief) as Record<string, unknown> & {
      tracks: Array<Record<string, unknown>>;
      focusedNotes: { rows: unknown[][] };
    };
    expect(parsed).toMatchObject({
      revision: 7,
      tempoBpm: 92,
      focusedTrack: "main",
      loopBeats: 16,
    });
    expect(parsed.tracks).toEqual([
      expect.objectContaining({
        id: "main",
        instrument: "piano",
        notes: 2,
        range: "C4..E4",
      }),
      expect.objectContaining({
        id: "bass",
        muted: true,
        notes: 1,
        range: "C2..C2",
      }),
    ]);
    expect(parsed.focusedNotes.rows.map((row) => row[0])).toEqual(["n1", "n2"]);
    expect(parsed.instruments).toContain("bass");
    expect(JSON.stringify(parsed.effects)).toContain("reverb");
  });

  test("stays within the byte budget and never includes the environment key", () => {
    const notes = Array.from({ length: 2000 }, (_, i) => ({
      id: `note-with-a-long-identifier-${i}`,
      trackId: "main",
      startTick: i * 10,
      durationTicks: 10,
      pitch: 40 + (i % 40),
      velocity: 0.5,
    }));
    const big = createScore({ tracks: [{ id: "main" }], notes });
    const saved = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "sk-brief-secret-123";
    try {
      const brief = compositionBrief({
        score: big,
        revision: 1,
        focusedTrackId: "main",
      });
      expect(new TextEncoder().encode(brief).byteLength).toBeLessThanOrEqual(
        MAX_BRIEF_BYTES,
      );
      expect(brief).not.toContain("sk-brief-secret-123");
      expect(JSON.parse(brief).focusedNotes.omitted).toBeGreaterThan(0);
    } finally {
      if (saved === undefined) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = saved;
    }
  });
});

describe("tool registry", () => {
  test("exposes one schema-described tool per operation family", () => {
    const names = chatTools().map((tool) => tool.function.name);
    for (const name of [
      "add_notes",
      "remove_notes",
      "set_instrument",
      "set_mix",
      "set_automation",
      "extend_loop",
      "set_tempo",
      "create_track",
      "transport",
      "explain",
    ])
      expect(names).toContain(name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of AGENT_TOOLS) {
      expect(tool.parameters.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });
});

describe("project outline in the brief", () => {
  test("carries the tree and notes head, and sheds them before track summaries under pressure", () => {
    const tree = Array.from(
      { length: 30 },
      (_, i) => `tracks/t${i}/ 2 files 1.2 KiB`,
    );
    const notes = "n".repeat(1024) + "…";
    const score = createScore({ tracks: [{ id: "main" }, { id: "t1" }] });
    const brief = compositionBrief({
      score,
      revision: 1,
      focusedTrackId: "main",
      project: { tree, notes },
    });
    const parsed = JSON.parse(brief) as {
      project?: { tree: string[]; notes?: string };
    };
    expect(parsed.project).toEqual({ tree, notes });
    expect(new TextEncoder().encode(brief).byteLength).toBeLessThanOrEqual(
      MAX_BRIEF_BYTES,
    );
    const cramped = JSON.parse(
      compositionBrief({
        score,
        revision: 1,
        focusedTrackId: "main",
        project: { tree, notes },
        maxBytes: 1500,
      }),
    ) as { project?: { tree: string[]; notes?: string }; tracks: unknown[] };
    expect(cramped.project?.notes).toBeUndefined();
    expect(cramped.tracks).toHaveLength(2);
    const tiny = JSON.parse(
      compositionBrief({
        score,
        revision: 1,
        focusedTrackId: "main",
        project: { tree, notes },
        maxBytes: 600,
      }),
    ) as { project?: unknown; tracks: unknown[] };
    expect(tiny.project).toBeUndefined();
    expect(tiny.tracks.length).toBeGreaterThan(0);
    const without = JSON.parse(
      compositionBrief({ score, revision: 1, focusedTrackId: "main" }),
    ) as { project?: unknown };
    expect(without.project).toBeUndefined();
  });
});

describe("workspace and web tools", () => {
  test("are registered with bounded schemas", () => {
    const names = chatTools().map((tool) => tool.function.name);
    for (const name of [
      "list_files",
      "read_file",
      "write_file",
      "edit_file",
      "web_search",
      "fetch_url",
    ])
      expect(names).toContain(name);
    const byName = new Map(AGENT_TOOLS.map((tool) => [tool.name, tool]));
    expect(byName.get("read_file")!.parameters.required).toEqual(["path"]);
    expect(byName.get("edit_file")!.parameters.required).toEqual([
      "path",
      "old",
      "new",
    ]);
    expect(byName.get("write_file")!.parameters.required).toEqual([
      "path",
      "content",
    ]);
    expect(byName.get("web_search")!.parameters.required).toEqual(["query"]);
    expect(byName.get("fetch_url")!.parameters.required).toEqual(["url"]);
  });
});
