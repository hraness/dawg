import { describe, expect, test } from "bun:test";
import {
  createScore,
  scoreFromJSON,
  type TrackScore,
} from "../../core/score.ts";
import { findAgentTool } from "../agent/tools.ts";
import {
  applyGranularCommand,
  grainSrcHint,
  granularTrackPreset,
  parseGranularCommand,
} from "./granular.ts";
import { SYNTH_PRESETS } from "../../core/synth.ts";
import { resolveGranular } from "../../core/granular.ts";
import { applySynthCommand, parseSynthCommand } from "./synth.ts";

const score = () =>
  createScore({
    bars: 1,
    tracks: [
      { id: "pad", instrument: "bell" },
      {
        id: "vox",
        instrument: "sampler",
        sampler: {
          mode: "keyed",
          voices: {
            ah: { src: "tracks/x/samples/ah.wav", root: 60 },
            oh: { src: "tracks/x/samples/oh.wav" },
          },
        },
      },
    ],
  });

const run = (text: string, base: TrackScore = score(), trackId = "pad") => {
  const command = parseGranularCommand(text);
  if (!command) throw new Error(`did not parse: ${text}`);
  return applyGranularCommand(base, trackId, command);
};
const trackOf = (value: TrackScore | undefined, id = "pad") =>
  value!.tracks.find((track) => track.id === id)!;

describe("grain grammar", () => {
  test("parses list, presets, params, sources and voices", () => {
    expect(parseGranularCommand("grain")).toEqual({ type: "grain-list" });
    expect(parseGranularCommand("grain presets")).toEqual({
      type: "grain-presets",
    });
    expect(parseGranularCommand("grain cloud")).toEqual({
      type: "grain-preset",
      preset: "cloud",
      voice: undefined,
    });
    expect(parseGranularCommand("grain preset hold voice ah")).toEqual({
      type: "grain-preset",
      preset: "hold",
      voice: "ah",
    });
    expect(parseGranularCommand("grain scan 0.1 freeze on")).toEqual({
      type: "grain-set",
      values: { scan: 0.1, freeze: true },
    });
    expect(parseGranularCommand("grain window gauss pitch off")).toEqual({
      type: "grain-set",
      values: { window: "gauss", pitch: null },
    });
    expect(parseGranularCommand("grain src bell@72")).toEqual({
      type: "grain-src",
      synth: "synth:bell@72",
    });
    expect(parseGranularCommand("grain src voice oh")).toEqual({
      type: "grain-src",
      voice: "oh",
    });
  });

  test("rejects unknown params, values out of range and bad sources", () => {
    expect(parseGranularCommand("grain wobble 1")).toBeUndefined();
    expect(parseGranularCommand("grain grain 9")).toBeUndefined();
    expect(parseGranularCommand("grain window square")).toBeUndefined();
    expect(parseGranularCommand("grain src nothing")).toBeUndefined();
    expect(parseGranularCommand("grain scan")).toBeUndefined();
    expect(parseGranularCommand("grainy cloud")).toBeUndefined();
  });

  test("track names that create a granular track", () => {
    expect(granularTrackPreset("cloud")).toBe("cloud");
    expect(granularTrackPreset("hold-2")).toBe("hold");
    expect(granularTrackPreset("piano")).toBeUndefined();
    expect(granularTrackPreset("cloudy")).toBeUndefined();
  });
});

describe("grain command", () => {
  test("a preset on a synth track grains that synth", () => {
    const result = run("grain cloud");
    expect(result.ok).toBe(true);
    const track = trackOf(result.next);
    expect(track.instrument).toBe("granular");
    expect(track.granular).toEqual({
      src: "synth:bell",
      preset: "cloud",
      from: "bell",
    });
  });

  test("a sampler track grains its first or named voice, pinned as stored", () => {
    const first = trackOf(run("grain on", score(), "vox").next, "vox");
    expect(first.granular?.src).toEqual({
      src: "tracks/x/samples/ah.wav",
      root: 60,
    });
    expect(first.sampler).toBeDefined();
    const named = trackOf(
      run("grain hold voice oh", score(), "vox").next,
      "vox",
    );
    expect(named.granular).toEqual({
      src: { src: "tracks/x/samples/oh.wav" },
      preset: "hold",
    });
    expect(run("grain on voice zz", score(), "vox").ok).toBe(false);
  });

  test("params override, off unsets, reset keeps preset and source", () => {
    let value = run("grain cloud").next!;
    value = run("grain scan 0.1 shimmer 0.3", value).next!;
    expect(trackOf(value).granular).toEqual({
      src: "synth:bell",
      preset: "cloud",
      scan: 0.1,
      shimmer: 0.3,
      from: "bell",
    });
    value = run("grain scan off", value).next!;
    expect(trackOf(value).granular?.scan).toBeUndefined();
    value = run("grain reset", value).next!;
    expect(trackOf(value).granular).toEqual({
      src: "synth:bell",
      preset: "cloud",
      from: "bell",
    });
  });

  test("off returns to the source's voice and keeps the settings", () => {
    const on = run("grain swarm").next!;
    const off = run("grain off", on);
    expect(trackOf(off.next).instrument).toBe("bell");
    expect(trackOf(off.next).granular?.preset).toBe("swarm");
    // `grain on` restores them.
    const back = trackOf(run("grain on", off.next).next);
    expect(back.instrument).toBe("granular");
    expect(back.granular?.preset).toBe("swarm");
  });

  test("off restores the voice granular turned on from", () => {
    const base = createScore({
      bars: 1,
      tracks: [
        {
          id: "wt",
          instrument: "wavetable",
          wavetable: { table: { src: "builtin:basic" } },
        },
        { id: "saw", instrument: "supersaw" },
      ],
    } as never);
    let value = run("grain cloud", base, "wt").next!;
    value = run("grain off", value, "wt").next!;
    expect(trackOf(value, "wt").instrument).toBe("wavetable");
    expect(trackOf(value, "wt").wavetable).toBeDefined();
    value = run("grain src synth:bell", value, "saw").next!;
    value = run("grain off", value, "saw").next!;
    expect(trackOf(value, "saw").instrument).toBe("supersaw");
    // Without a remembered voice a preset source maps to its instrument.
    const stored = JSON.parse(JSON.stringify(value));
    stored.tracks[1].instrument = "granular";
    stored.tracks[1].granular = { src: "synth:acid" };
    const acid = scoreFromJSON(stored);
    const off = trackOf(run("grain off", acid, "saw").next, "saw");
    expect(off.instrument).not.toBe("acid");
    expect(off.instrument).toBe(SYNTH_PRESETS.acid!.instrument);
    expect(off.synth).toBeDefined();
  });

  test("grain on grains the track's synth preset, tuned params too", () => {
    const base = createScore({
      bars: 1,
      tracks: [{ id: "p", instrument: "sine" }],
    } as never);
    let value = applySynthCommand(
      base,
      "p",
      parseSynthCommand("synth preset pad")!,
    ).next!;
    value = run("grain on", value, "p").next!;
    // synth:pad is the default source, so it is stored as absent.
    expect(resolveGranular(trackOf(value, "p").granular).src).toBe("synth:pad");
    let acid = applySynthCommand(
      base,
      "p",
      parseSynthCommand("synth preset acid")!,
    ).next!;
    acid = run("grain on", acid, "p").next!;
    expect(trackOf(acid, "p").granular?.src).toBe("synth:acid");
  });

  test("hold is a parameter with a value and a preset alone", () => {
    expect(parseGranularCommand("grain hold 4")).toEqual({
      type: "grain-set",
      values: { hold: 4 },
    });
    expect(parseGranularCommand("grain hold off")).toEqual({
      type: "grain-set",
      values: { hold: null },
    });
    expect(parseGranularCommand("grain hold")).toMatchObject({
      type: "grain-preset",
      preset: "hold",
    });
    expect(parseGranularCommand("grain hold 4 scan 0")).toEqual({
      type: "grain-set",
      values: { hold: 4, scan: 0 },
    });
  });

  test("root and synth sources take note names", () => {
    expect(parseGranularCommand("grain root c4")).toEqual({
      type: "grain-set",
      values: { root: 60 },
    });
    expect(parseGranularCommand("grain root 57")).toEqual({
      type: "grain-set",
      values: { root: 57 },
    });
    const value = run("grain src synth:pad@c3").next!;
    expect(trackOf(value).granular?.src).toBe("synth:pad@48");
  });

  test("bare grain lists the basics with values", () => {
    const value = run("grain scan 0.1", run("grain cloud").next!).next!;
    const message = run("grain", value).message;
    expect(message).toContain("grain 0.12s");
    expect(message).toContain("scan 0.1x*");
    expect(message).toContain("overlap 6");
  });

  test("stored JSON round-trips and validation errors are messages", () => {
    const value = run("grain sparkle").next!;
    const again = scoreFromJSON(JSON.parse(JSON.stringify(value)));
    expect(trackOf(again).granular).toEqual(trackOf(value).granular);
    expect(run("grain begin 0.8 end 0.5").ok).toBe(false);
  });

  test("a drum track is refused", () => {
    const drums = createScore({
      bars: 1,
      tracks: [{ id: "drums", instrument: "kit" }],
    });
    const result = run("grain cloud", drums, "drums");
    expect(result.ok).toBe(false);
  });
});

describe("set_granular", () => {
  const tool = findAgentTool("set_granular")!;
  const context = (value = score()) => ({
    score: value,
    focusedTrackId: "pad",
    revision: 1,
    newNoteId: () => "n",
  });

  test("matches the grain command (four-ways object)", () => {
    const plan = tool.plan(
      { preset: "cloud", params: { scan: 0.1 } },
      context(),
    );
    const viaCommand = trackOf(
      run("grain scan 0.1", run("grain cloud").next!).next,
    );
    expect(plan.kind).toBe("score");
    if (plan.kind !== "score") return;
    expect(plan.operations[0]).toEqual({
      type: "updateTrack",
      trackId: "pad",
      patch: { instrument: "granular", granular: viaCommand.granular },
    });
  });

  test("refuses unknown params and presets", () => {
    expect(() => tool.plan({ params: { wobble: 1 } }, context())).toThrow(
      /no parameter wobble/,
    );
    expect(() => tool.plan({ preset: "nope" }, context())).toThrow(
      /granular presets/,
    );
  });
});

describe("grain src hint", () => {
  test("an unreadable source answers locally", () => {
    expect(grainSrcHint("grain src bus:guitars")).toContain("not a source yet");
    expect(grainSrcHint("grain src synth:pad")).toBeUndefined();
    expect(grainSrcHint("grain cloud")).toBeUndefined();
  });
});
