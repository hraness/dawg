import { describe, expect, test } from "bun:test";
import { applyScoreOperations } from "../../core/diff.ts";
import { createScore, type TrackScore } from "../../core/score.ts";
import { compositionBrief } from "./brief.ts";
import { MASTER_TOOLS, measurementJSON } from "./master-tools.ts";
import { AGENT_TOOLS, type ActionContext, type ToolContext } from "./tools.ts";

const song = () =>
  createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [{ id: "a", name: "a", instrument: "saw" }],
    notes: [0, 1, 2, 3].map((beat) => ({
      id: `n${beat}`,
      trackId: "a",
      pitch: 45 + beat * 3,
      startTick: beat * 480,
      durationTicks: 400,
      velocity: 0.8,
    })),
  });

const tool = (name: string) =>
  MASTER_TOOLS.find((entry) => entry.name === name)!;

function context(score: TrackScore): ToolContext {
  return {
    score,
    focusedTrackId: "a",
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

function apply(score: TrackScore, args: Record<string, unknown>): TrackScore {
  const plan = tool("set_master").plan(args, context(score));
  if (plan.kind !== "score") throw new Error("expected a score plan");
  return applyScoreOperations(score, plan.operations);
}

describe("set_master", () => {
  test("is registered with the agent tools", () => {
    const names = AGENT_TOOLS.map((entry) => entry.name);
    expect(names).toContain("set_master");
    expect(names).toContain("measure_mix");
  });

  test("units take true, a preset or params; a named target sets the limiter", () => {
    let score = apply(song(), { eq: "air", width: { mono: 120 } });
    expect(score.master?.eq?.high).toBe(2);
    expect(score.master?.width?.mono).toBe(120);
    // A positive number means the negative LUFS, as `master target 14` does.
    expect(apply(score, { target: 14 }).master?.target).toBe(-14);
    score = apply(score, { target: "loud" });
    expect(score.master?.target).toBe(-6);
    expect(score.master?.limiter?.ceiling).toBe(-2);
    expect(score.master?.limiter?.release).toBe(20);
    // Omitted units stay; false removes one.
    score = apply(score, { eq: false, glue: true });
    expect(score.master?.eq).toBeUndefined();
    expect(score.master?.width).toBeDefined();
    expect(score.master?.glue).toBeDefined();
    score = apply(score, { target: null });
    expect(score.master?.target).toBeUndefined();
    score = apply(score, { off: true });
    expect(score.master).toBeUndefined();
    expect(JSON.stringify(score.toJSON())).toBe(
      JSON.stringify(song().toJSON()),
    );
  });

  test("rejects bad arguments with a diagnostic", () => {
    const plan = (args: Record<string, unknown>) =>
      tool("set_master").plan(args, context(song()));
    expect(() => plan({})).toThrow("pass a unit");
    expect(() => plan({ eq: "nope" })).toThrow("eq preset must be one of");
    expect(() => plan({ target: "loudest" })).toThrow("target must be LUFS");
    expect(() => plan({ target: -1 })).toThrow();
    expect(() => plan({ limiter: { ceiling: 3 } })).toThrow();
    expect(() => plan({ bogus: true })).toThrow("unknown argument bogus");
  });

  test("the brief shows the master only when there is one", () => {
    const plain = JSON.parse(
      compositionBrief({ score: song(), revision: 1, focusedTrackId: "a" }),
    );
    expect(plain.master).toBeUndefined();
    const mastered = apply(song(), { target: "streaming" });
    const brief = JSON.parse(
      compositionBrief({ score: mastered, revision: 2, focusedTrackId: "a" }),
    );
    expect(brief.master).toContain("target -14 LUFS");
  });
});

describe("measure_mix", () => {
  async function measure(
    score: TrackScore,
    args: Record<string, unknown> = {},
    action: ActionContext = {},
  ) {
    const plan = tool("measure_mix").plan(args, context(score));
    if (plan.kind !== "action") throw new Error("expected an action plan");
    const result = await plan.run(action);
    return { result, json: JSON.parse(result.content) };
  }

  test("reports loudness, peaks, bands and correlation; never edits", async () => {
    const { result, json } = await measure(song());
    expect(json.integrated).toBeLessThan(-6);
    expect(json.integrated).toBeGreaterThan(-40);
    expect(json.truePeak).toBeGreaterThanOrEqual(json.samplePeak);
    expect(Object.keys(json.bands)).toEqual([
      "sub",
      "bass",
      "low-mid",
      "high-mid",
      "high",
    ]);
    expect(json.correlation).toBeCloseTo(1, 1);
    expect(json.master).toBeNull();
    expect(json.loop).toBe(true);
    expect(result.summary).toMatch(/^measured · -?\d+(\.\d)? LUFS/);
    expect("mutated" in result).toBe(false);
  });

  test("measures after the master, or before it with bypass_master", async () => {
    const mastered = apply(song(), { target: "streaming" });
    const after = (await measure(mastered)).json;
    expect(after.integrated).toBeCloseTo(-14, 0);
    expect(after.master.target).toBe(-14);
    expect(after.master.reached).toBe(true);
    const before = (await measure(mastered, { bypass_master: true })).json;
    expect(before.master).toBeNull();
    expect(before.integrated).not.toBeCloseTo(-14, 0);
    // Both readings at the mastered song's rate.
    expect(before.sampleRate).toBe(48_000);
    expect(after.sampleRate).toBe(before.sampleRate);
    expect(() =>
      tool("measure_mix").plan({ bypass_master: "yes" }, context(song())),
    ).toThrow("bypass_master must be a boolean");
  });

  test("uses the host's measure hook when it has one", async () => {
    let called = 0;
    const { json } = await measure(
      song(),
      {},
      {
        preview: {
          measure: async (score) => {
            called += 1;
            const { measureScore } = await import("../audio/measure.ts");
            return measureScore(score);
          },
        },
      },
    );
    expect(called).toBe(1);
    expect(json.integrated).not.toBeNull();
  });

  test("silence reports null loudness and a note", () => {
    const json = measurementJSON(
      {
        mix: {
          loudness: {
            integrated: -Infinity,
            momentaryMax: -Infinity,
            shortTermMax: -Infinity,
            range: 0,
            truePeak: -Infinity,
            samplePeak: -Infinity,
            momentary: new Float64Array(),
            shortTerm: new Float64Array(),
            step: 0.1,
            seconds: 2,
          },
          bands: {
            sub: -Infinity,
            bass: -Infinity,
            "low-mid": -Infinity,
            "high-mid": -Infinity,
            high: -Infinity,
          },
          correlation: 0,
          sideDb: -Infinity,
          plr: NaN,
        },
        sampleRate: 48_000,
        seconds: 2,
        loop: true,
      },
      undefined,
    );
    expect(json.integrated).toBeNull();
    expect(json.notes).toEqual(["silent: nothing to measure"]);
  });
});
