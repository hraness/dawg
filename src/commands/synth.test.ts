import { describe, expect, test } from "bun:test";
import { diffScores } from "../../core/diff.ts";
import { createScore, scoreFromJSON } from "../../core/score.ts";
import {
  SYNTH_PARAMS,
  SYNTH_PRESETS,
  normalizeSynth,
  synthParamName,
  zzfxArraySynth,
} from "../../core/synth.ts";
import { zzfx } from "../../core/sdk/v1.ts";
import { findAgentTool } from "../agent/tools.ts";
import { applySynthCommand, parseSynthCommand } from "./synth.ts";

const score = () =>
  createScore({
    bars: 1,
    tracks: [{ id: "lead", instrument: "saw" }],
  });

const run = (text: string, base = score()) => {
  const command = parseSynthCommand(text);
  if (!command) throw new Error(`did not parse: ${text}`);
  return applySynthCommand(base, "lead", command);
};

describe("synth grammar", () => {
  test("parses list, reset, presets, params, aliases and adsr", () => {
    expect(parseSynthCommand("synth")).toEqual({ type: "synth-list" });
    expect(parseSynthCommand("synth reset")).toEqual({ type: "synth-reset" });
    expect(parseSynthCommand("synth preset pad")).toEqual({
      type: "synth-preset",
      preset: "pad",
    });
    expect(parseSynthCommand("synth lpf 800 lpenv 3")).toEqual({
      type: "synth-set",
      values: { lpf: 800, lpenv: 3 },
    });
    // Strudel aliases resolve to the canonical name.
    expect(parseSynthCommand("synth cutoff 900 att 0.1 vmod 1")).toEqual({
      type: "synth-set",
      values: { lpf: 900, attack: 0.1, vibmod: 1 },
    });
    expect(parseSynthCommand("synth adsr 0.01:0.2:0.5:0.3")).toEqual({
      type: "synth-set",
      values: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
    });
    expect(parseSynthCommand("synth partials 1 0.5 0.25")).toEqual({
      type: "synth-set",
      values: { partials: [1, 0.5, 0.25] },
    });
    expect(parseSynthCommand("synth fm off")).toEqual({
      type: "synth-set",
      values: { fm: null },
    });
    expect(parseSynthCommand("synth preset nope")).toBeUndefined();
    expect(parseSynthCommand("synth warp 3")).toBeUndefined();
    expect(parseSynthCommand("synth lpf")).toBeUndefined();
    expect(parseSynthCommand("synthesize")).toBeUndefined();
  });

  test("set merges, off unsets, reset clears", () => {
    const a = run("synth attack 0.2 lpf 1200").next!;
    expect(a.tracks[0]!.synth).toEqual({ attack: 0.2, lpf: 1200 });
    const b = run("synth fm 2 lpf off", a).next!;
    expect(b.tracks[0]!.synth).toEqual({ attack: 0.2, fm: 2 });
    const c = run("synth reset", b).next!;
    expect(c.tracks[0]!.synth).toBeUndefined();
  });

  test("a preset sets the instrument and its params", () => {
    const next = run("synth preset bell").next!;
    const preset = SYNTH_PRESETS.bell!;
    expect(next.tracks[0]!.instrument).toBe(preset.instrument);
    expect(next.tracks[0]!.synth).toEqual(normalizeSynth(preset.synth));
  });

  test("the acid preset adds a legato glide unless the track has one", () => {
    const result = run("synth preset acid");
    expect(result.next!.tracks[0]!.glide).toEqual({
      time: 0.06,
      mode: "legato",
    });
    expect(result.message).toContain("glide 60ms legato");
    expect(run("synth preset bell").next!.tracks[0]!.glide).toBeUndefined();
  });

  test("out-of-range values are rejected without a revision", () => {
    const bad = applySynthCommand(score(), "lead", {
      type: "synth-set",
      values: { sustain: 4 },
    });
    expect(bad.ok).toBe(false);
    expect(bad.next).toBeUndefined();
  });

  test("sampler tracks refuse synth params", () => {
    const sampled = createScore({
      tracks: [
        {
          id: "lead",
          instrument: "sampler",
          sampler: { mode: "oneshot", voices: { a: { src: "samples/a.wav" } } },
        },
      ],
    });
    expect(run("synth attack 0.1", sampled).ok).toBe(false);
  });
});

describe("synth schema", () => {
  test("every param has Strudel names that resolve back to it", () => {
    for (const [name, spec] of Object.entries(SYNTH_PARAMS)) {
      expect(synthParamName(name)).toBe(name);
      for (const alias of spec.strudel ?? [])
        expect({ alias, to: synthParamName(alias) }).toEqual({
          alias,
          to: name,
        });
    }
  });

  test("normalize orders keys, drops empties and rejects unknowns", () => {
    expect(normalizeSynth({})).toBeUndefined();
    expect(normalizeSynth(null)).toBeUndefined();
    expect(Object.keys(normalizeSynth({ lpf: 900, attack: 0.1 })!)).toEqual([
      "attack",
      "lpf",
    ]);
    expect(() => normalizeSynth({ warp: 1 })).toThrow();
    expect(() => normalizeSynth({ partials: new Array(65).fill(1) })).toThrow();
  });

  test("synth round-trips through JSON and old documents decode unchanged", () => {
    const next = run("synth preset pad").next!;
    const back = scoreFromJSON(JSON.parse(JSON.stringify(next)));
    expect(back.tracks[0]!.synth).toEqual(next.tracks[0]!.synth);
    const legacy = scoreFromJSON(JSON.parse(JSON.stringify(score())));
    expect(legacy.tracks[0]!.synth).toBeUndefined();
    expect("synth" in legacy.tracks[0]!).toBe(false);
  });

  test("diff reports a synth change on the track", () => {
    const before = score();
    const after = run("synth lpf 800").next!;
    const diff = diffScores(before, after);
    expect(JSON.stringify(diff)).toContain("synth");
  });
});

describe("set_synth agent tool", () => {
  const tool = findAgentTool("set_synth")!;
  const context = {
    score: score(),
    focusedTrackId: "lead",
    revision: 1,
    newNoteId: (_trackId: string, index: number) => `n${index}`,
  };

  test("plans one updateTrack with Strudel-named params", () => {
    const plan = tool.plan(
      { params: { cutoff: 700, lpenv: 2, fmi: 3 } },
      context,
    );
    expect(plan.kind).toBe("score");
    if (plan.kind !== "score") return;
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({
      type: "updateTrack",
      trackId: "lead",
      patch: { synth: { lpf: 700, lpenv: 2, fm: 3 } },
    });
  });

  test("presets and unknown params", () => {
    const plan = tool.plan({ preset: "lead" }, context);
    expect(plan.kind).toBe("score");
    expect(() => tool.plan({ params: { warp: 1 } }, context)).toThrow();
    expect(() => tool.plan({}, context)).toThrow();
  });
});

describe("raw zzfx arrays", () => {
  test("ZzFX's positional layout maps to the named controls", () => {
    const sound = zzfxArraySynth([
      0.8, 0, 220, 0.01, 0.1, 0.2, 5, 1.5, -2, 0.5, 300, 0.05, 0.2, 0.3, 4,
      0.25, 0.1, 0.6, 0.05, 0.4, -1200,
    ]);
    expect(sound.instrument).toBe("z_square");
    expect(sound.synth).toEqual({
      gain: 0.8,
      zrand: 0,
      attack: 0.01,
      release: 0.2,
      curve: 1.5,
      slide: -2,
      deltaSlide: 0.5,
      pitchJump: 300,
      pitchJumpTime: 0.05,
      lfo: 0.2,
      noise: 0.3,
      zmod: 4,
      zcrush: 0.25,
      zdelay: 0.1,
      sustain: 0.6,
      decay: 0.05,
      tremolo: 0.4,
      lpf: 1200,
    } as never);
  });

  test("empty slots take ZzFX defaults; positive filter is a high-pass", () => {
    const sound = zzfxArraySynth([
      ,
      ,
      129,
      0.01,
      ,
      0.15,
      2,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      300,
    ]);
    expect(sound.instrument).toBe("z_sawtooth");
    expect(sound.synth).toMatchObject({
      zrand: 0.05,
      attack: 0.01,
      release: 0.15,
      hpf: 300,
    });
  });

  test("the SDK helper and the core mapping agree", () => {
    const values = [
      1, 0.05, 220, 0, 0, 0.1, 3, 2, 1, 0, 0, 0, 0, 0.1, 0, 0.5, 0, 1, 0, 0, 0,
    ];
    const core = zzfxArraySynth(values);
    const sdk = zzfx(values);
    expect(sdk.instrument).toBe(core.instrument);
    expect(normalizeSynth(sdk.synth)).toEqual(core.synth);
  });

  test("synth zzfx parses the pasted call and comma lists", () => {
    expect(parseSynthCommand("synth zzfx zzfx(...[,,129,.01,,.15])")).toEqual({
      type: "synth-zzfx",
      values: [null, null, 129, 0.01, null, 0.15],
    });
    expect(parseSynthCommand("synth zzfx 1 .05 220")).toEqual({
      type: "synth-zzfx",
      values: [1, 0.05, 220],
    });
    expect(parseSynthCommand("synth zzfx 1,x")).toBeUndefined();
    const result = run("synth zzfx 1,0,,0.01,,0.2,5,,-3");
    expect(result.ok).toBe(true);
    const track = result.next!.tracks[0]!;
    expect(track.instrument).toBe("z_square");
    expect(track.synth).toMatchObject({ slide: -3, release: 0.2 });
    expect(run("synth zzfx 1,0,,99").ok).toBe(false);
  });

  test("set_synth takes a zzfx array", () => {
    const tool = findAgentTool("set_synth")!;
    const plan = tool.plan(
      { zzfx: [null, null, 300, null, null, 0.1, 1] },
      {
        score: score(),
        focusedTrackId: "lead",
        revision: 1,
        newNoteId: (_trackId: string, index: number) => `n${index}`,
      },
    );
    expect(plan.kind === "score" && plan.operations[0]).toMatchObject({
      patch: { instrument: "z_triangle" },
    });
    expect(() =>
      tool.plan(
        { zzfx: ["a"] },
        {
          score: score(),
          focusedTrackId: "lead",
          revision: 1,
          newNoteId: () => "n",
        },
      ),
    ).toThrow();
  });
});
