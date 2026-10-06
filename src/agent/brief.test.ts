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
