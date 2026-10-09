import { describe, expect, test } from "bun:test";

import { createScore, type TrackScore } from "../../core/score.ts";
import { previewScore } from "../audio/preview.ts";
import { renderScorePcm, type RenderedAudio } from "../audio/wav.ts";
import { compareSounds } from "./preview-tool.ts";
import { AGENT_TOOLS, isActionDiagnostic, type ToolContext } from "./tools.ts";

const tool = AGENT_TOOLS.find((t) => t.name === "preview_sound")!;

function context(score: TrackScore): ToolContext {
  return {
    score,
    focusedTrackId: "lead",
    revision: 3,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

const song = createScore({
  bars: 2,
  tracks: [
    { id: "lead", instrument: "saw" },
    { id: "pad", instrument: "pad" },
  ],
  notes: [
    {
      id: "n0",
      trackId: "lead",
      pitch: 64,
      startTick: 0,
      durationTicks: 480,
      velocity: 0.8,
    },
    {
      id: "n1",
      trackId: "lead",
      pitch: 67,
      startTick: 960,
      durationTicks: 480,
      velocity: 0.8,
    },
    {
      id: "p0",
      trackId: "pad",
      pitch: 52,
      startTick: 0,
      durationTicks: 1920,
      velocity: 0.8,
    },
  ],
} as never);

async function run(
  args: Record<string, unknown>,
  score: TrackScore = song,
  preview?: Parameters<
    Extract<ReturnType<typeof tool.plan>, { kind: "action" }>["run"]
  >[0]["preview"],
) {
  const plan = tool.plan(args, context(score));
  expect(plan.kind).toBe("action");
  if (plan.kind !== "action") throw new Error("not an action");
  const result = await plan.run(preview ? { preview } : {});
  return { ...result, json: JSON.parse(result.content) };
}

describe("preview_sound", () => {
  test("is registered and listed with the sound tools", () => {
    expect(tool).toBeDefined();
    expect(JSON.stringify(tool.parameters)).toContain("set_wavetable");
  });

  test("measures the current sound without committing", async () => {
    const { json, summary } = await run({});
    expect(json.committed).toBe(false);
    expect(json.trackId).toBe("lead");
    expect(json.source).toBe("notes");
    expect(json.mode).toBe("solo");
    expect(json.sound.rmsDb).toBeGreaterThan(-60);
    expect(json.sound.peakDb).toBeLessThanOrEqual(0);
    expect(json.sound.centroidHz).toBeGreaterThan(100);
    expect(json.sound.description).toMatch(/RMS .* dBFS/);
    expect(json.current).toBeUndefined();
    expect(json.played).toBe(false);
    expect(summary).toContain("preview lead");
  });

  test("a candidate is planned by the real tools; the score is untouched", async () => {
    const before = JSON.stringify(song.toJSON());
    const { json } = await run({
      changes: [
        { tool: "set_fx", args: { effect: "filter", params: { cutoff: 300 } } },
      ],
    });
    expect(JSON.stringify(song.toJSON())).toBe(before);
    expect(json.candidate).toHaveLength(1);
    // A 300 Hz low-pass on a saw is darker than the open saw.
    expect(json.sound.centroidHz).toBeLessThan(json.current.centroidHz);
    expect(json.comparison).toContain("darker");
  });

  test("renders exactly the audition loop's score, through the host", async () => {
    const seen: TrackScore[] = [];
    const played: RenderedAudio[] = [];
    const { json, summary } = await run({ context: true }, song, {
      render: (score) => {
        seen.push(score);
        return renderScorePcm(score);
      },
      play: (audio) => {
        played.push(audio);
        return true;
      },
    });
    expect(seen).toHaveLength(1);
    const expected = previewScore(song, "lead", { context: true })!.score;
    expect(JSON.stringify(seen[0]!.toJSON())).toBe(
      JSON.stringify(expected.toJSON()),
    );
    expect(played).toHaveLength(1);
    expect(json.played).toBe(true);
    expect(json.mode).toBe("in context");
    expect(summary.startsWith("♪ ")).toBe(true);
  });

  test("play: false never reaches the host's player", async () => {
    let plays = 0;
    const { json } = await run({ play: false }, song, {
      play: () => {
        plays += 1;
        return true;
      },
    });
    expect(plays).toBe(0);
    expect(json.played).toBe(false);
  });

  test("an empty track plays the default phrase for its role", async () => {
    const empty = createScore({
      bars: 2,
      tracks: [{ id: "keys", instrument: "pad" }],
    });
    const { json } = await run({ trackId: "keys" }, empty);
    expect(json.source).toBe("phrase");
    expect(json.phrase).toBe("chord");
    expect(json.sound.rmsDb).toBeGreaterThan(-60);
  });

  test("refuses tools that are not sound changes, and unknown tracks", () => {
    let error: unknown;
    try {
      tool.plan({ changes: [{ tool: "add_notes", args: {} }] }, context(song));
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).toContain("cannot be previewed");
    expect(isActionDiagnostic(error)).toBe(true);
    expect(() => tool.plan({ trackId: "nope" }, context(song))).toThrow(
      "unknown track",
    );
  });

  test("compareSounds names level and brightness changes", () => {
    const base = {
      rmsDb: -20,
      peakDb: -6,
      centroidHz: 1000,
      clipped: 0,
      seconds: 1,
    };
    expect(compareSounds(base, { ...base, rmsDb: -17, centroidHz: 2000 })).toBe(
      "3.0 dB louder, brighter (×2.00 centroid)",
    );
    expect(compareSounds(base, base)).toBe("about the same level and tone");
    expect(compareSounds(base, { ...base, clipped: 4 })).toBe("now clips");
  });
});

describe("preview_sound with a vocoder", () => {
  test("a set_vocoder candidate is heard through its muted source", async () => {
    const { json } = await run({
      trackId: "pad",
      changes: [
        {
          tool: "set_vocoder",
          args: { src: "lead", params: { follow: "drone" } },
        },
      ],
    });
    expect(json.mode).toBe("solo");
    expect(json.candidate).toHaveLength(1);
    // The pad is vocoded by the lead: a different sound, not the dry pad.
    expect(json.sound.rmsDb).not.toBe(json.current.rmsDb);
  });
});
