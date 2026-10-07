import { describe, expect, test } from "bun:test";
import { createScore, scoreFromJSON } from "../../core/score.ts";
import { findAgentTool } from "../agent/tools.ts";
import { applyFxCommand, parseFxCommand } from "./fx.ts";

const score = () =>
  createScore({
    bars: 1,
    tracks: [{ id: "lead", instrument: "saw" }],
  });

const run = (text: string, base = score()) => {
  const command = parseFxCommand(text);
  if (!command) throw new Error(`did not parse: ${text}`);
  return applyFxCommand(base, "lead", command);
};

describe("fx grammar", () => {
  test("parses on/off, presets, params and Strudel names", () => {
    expect(parseFxCommand("fx")).toEqual({ type: "fx-list" });
    expect(parseFxCommand("fx tremolo off")).toEqual({
      type: "fx-off",
      effect: "tremolo",
    });
    expect(parseFxCommand("fx chorus preset wide")).toEqual({
      type: "fx-preset",
      effect: "chorus",
      preset: "wide",
    });
    expect(parseFxCommand("fx delay mix 0.3")).toEqual({
      type: "fx-set",
      effect: "delay",
      values: { mix: 0.3 },
    });
    expect(parseFxCommand("fx delay delayfeedback 0.4")).toEqual({
      type: "fx-set",
      effect: "delay",
      values: { feedback: 0.4 },
    });
    expect(parseFxCommand("fx hpf cutoff 300")).toEqual({
      type: "fx-set",
      effect: "filter",
      values: { type: "hpf", cutoff: 300 },
    });
    expect(parseFxCommand("fx dist drive 4")?.type).toBe("fx-set");
    expect(parseFxCommand("fx chorus preset nope")).toBeUndefined();
    expect(parseFxCommand("fx chorus rate")).toBeUndefined();
    expect(parseFxCommand("fx warp on")).toBeUndefined();
    expect(parseFxCommand("filter 800")).toBeUndefined();
  });

  test("on uses the documented defaults; delay is a ping-pong", () => {
    const result = run("fx delay on");
    expect(result.ok).toBe(true);
    const track = result.next!.tracks[0]!;
    expect(track.delay).toMatchObject({
      beats: 0.75,
      feedback: 0.35,
      mix: 0.25,
      pingpong: true,
      highcut: 5000,
    });
    expect(run("fx tremolo on").next!.tracks[0]!.fx?.tremolo).toMatchObject({
      depth: 0.5,
    });
  });

  test("set merges into current values and rejects out-of-range", () => {
    const on = run("fx distort on").next!;
    const set = run("fx distort drive 4 tone 5000", on).next!;
    expect(set.tracks[0]!.fx?.distort).toMatchObject({
      drive: 4,
      tone: 5000,
      mix: 1,
    });
    expect(parseFxCommand("fx distort drive 40")).toBeUndefined();
    const bad = applyFxCommand(on, "lead", {
      type: "fx-set",
      effect: "distort",
      values: { drive: 40 },
    });
    expect(bad.ok).toBe(false);
    expect(bad.next).toBeUndefined();
    const off = run("fx distort off", set);
    expect(off.next!.tracks[0]!.fx?.distort).toBeUndefined();
  });

  test("a preset round-trips through JSON", () => {
    const next = run("fx reverb preset hall").next!;
    const back = scoreFromJSON(JSON.parse(JSON.stringify(next)));
    expect(back.tracks[0]!.reverb).toEqual(next.tracks[0]!.reverb);
    expect(back.tracks[0]!.reverb).toMatchObject({ mix: 0.3, size: 0.8 });
  });
});

describe("legacy documents", () => {
  test("old filter/delay/reverb decode unchanged with no new fields", () => {
    const legacy = scoreFromJSON(
      JSON.parse(
        JSON.stringify(
          createScore({
            tracks: [
              {
                id: "pad",
                instrument: "sine",
                filter: { cutoff: 800, resonance: 0.2 },
                delay: { beats: 0.5, feedback: 0.4, mix: 0.3 },
                reverb: { mix: 0.3, size: 0.5 },
              },
            ],
          }),
        ),
      ),
    );
    const track = legacy.tracks[0]!;
    expect(track.filter).toEqual({ cutoff: 800, resonance: 0.2 });
    expect(track.delay).toEqual({ beats: 0.5, feedback: 0.4, mix: 0.3 });
    expect(track.reverb).toEqual({ mix: 0.3, size: 0.5 });
    expect(track.fx).toBeUndefined();
  });
});

describe("set_fx agent tool", () => {
  const tool = findAgentTool("set_fx")!;
  const context = {
    score: score(),
    focusedTrackId: "lead",
    revision: 1,
    newNoteId: (_trackId: string, index: number) => `n${index}`,
  };

  test("plans one updateTrack with Strudel-named params", () => {
    const plan = tool.plan(
      { effect: "autofilter", params: { lpq: 0.6, shape: "random" } },
      context,
    );
    expect(plan.kind).toBe("score");
    if (plan.kind !== "score") return;
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({
      type: "updateTrack",
      trackId: "lead",
      patch: { fx: { autofilter: { resonance: 0.6, shape: "random" } } },
    });
  });

  test("rejects unknown effects and empty requests", () => {
    expect(() => tool.plan({ effect: "warp", on: true }, context)).toThrow();
    expect(() => tool.plan({ effect: "chorus" }, context)).toThrow();
  });
});
