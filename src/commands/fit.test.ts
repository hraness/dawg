import { describe, expect, test } from "bun:test";
import { createScore, normalizeSampleRef } from "../../core/score.ts";
import { printTrack } from "../../core/sdk/print.ts";
import { parsePrompt } from "../agent/ops.ts";
import { applyFitCommand, parseFitCommand } from "./fit.ts";

const score = (voices: Record<string, object>) =>
  createScore({
    tempoBpm: 128,
    bars: 4,
    tracks: [
      {
        id: "s",
        instrument: "sampler",
        sampler: { mode: "oneshot", voices: voices as never },
      },
    ],
  });

describe("fit commands", () => {
  test("parse fitmode, bpm and len with optional voice and off", () => {
    expect(parseFitCommand("/fitmode beats")).toEqual({
      control: "fitmode",
      value: "beats",
    });
    // fitmode and len also work bare; a bare bpm stays the song tempo word.
    expect(parseFitCommand("fitmode tones pad")).toEqual({
      control: "fitmode",
      value: "tones",
      voice: "pad",
    });
    expect(parseFitCommand("len 8")).toEqual({ control: "len", value: 8 });
    expect(parseFitCommand("bpm 120")).toBeUndefined();
    expect(parseFitCommand("/bpm 120")).toEqual({ control: "bpm", value: 120 });
    expect(parseFitCommand("/fitmode")).toEqual({
      control: "fitmode",
      value: undefined,
    });
    expect(parseFitCommand("/fitmode auto brk")).toEqual({
      control: "fitmode",
      value: undefined,
      voice: "brk",
    });
    expect(parseFitCommand("/fitmode off brk")).toEqual({
      control: "fitmode",
      value: null,
      voice: "brk",
    });
    expect(parseFitCommand("/bpm 174")).toEqual({ control: "bpm", value: 174 });
    expect(parseFitCommand("/len 16 pad")).toEqual({
      control: "len",
      value: 16,
      voice: "pad",
    });
    expect(parseFitCommand("/bpm")).toBeUndefined();
    expect(parseFitCommand("/fitmode warp")).toBeUndefined();
    expect(parseFitCommand("/sample set a bpm 1")).toBeUndefined();
  });

  test("set bpm then fitmode on the only voice, printed in track.ts", () => {
    let next = score({ brk: { src: "tracks/s/samples/brk.wav" } });
    const early = applyFitCommand(next, "s", {
      control: "fitmode",
      value: "beats",
    });
    expect(early.ok).toBe(false);
    expect(early.message).toContain("/bpm");
    for (const command of [
      parseFitCommand("/bpm 174")!,
      parseFitCommand("/fitmode beats")!,
    ]) {
      const result = applyFitCommand(next, "s", command);
      if (!result.ok) throw new Error(result.message);
      next = result.next;
    }
    expect(next.tracks[0]!.sampler!.voices.brk).toEqual({
      src: "tracks/s/samples/brk.wav",
      bpm: 174,
      fitmode: "beats",
    });
    const printed = printTrack(next, next.tracks[0]!);
    expect(printed).toContain("bpm: 174");
    expect(printed).toContain('fitmode: "beats"');
    // Unsetting the tempo also drops the fit mode it needed.
    const off = applyFitCommand(next, "s", parseFitCommand("/bpm off")!);
    if (!off.ok) throw new Error(off.message);
    expect(off.next.tracks[0]!.sampler!.voices.brk).toEqual({
      src: "tracks/s/samples/brk.wav",
    });
  });

  test("several voices need a name; non-samplers point at the tempo word", () => {
    const two = score({
      a: { src: "tracks/s/samples/a.wav" },
      b: { src: "tracks/s/samples/b.wav" },
    });
    const bare = applyFitCommand(two, "s", { control: "len", value: 8 });
    expect(bare.ok).toBe(false);
    expect(bare.message).toContain("a b");
    const named = applyFitCommand(two, "s", {
      control: "len",
      value: 8,
      voice: "b",
    });
    expect(named.ok && named.next.tracks[0]!.sampler!.voices.b!.len).toBe(8);
    const synth = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [{ id: "s" }],
    });
    const result = applyFitCommand(synth, "s", { control: "bpm", value: 90 });
    expect(result.message).toContain("song tempo is tempo <bpm>");
    // The hint's command is the one that parses (bare word, no slash).
    expect(parsePrompt("tempo 90")).toEqual({
      type: "set-tempo",
      tempoBpm: 90,
    });
  });

  test("validation: bounds and fitmode without a tempo", () => {
    expect(() => normalizeSampleRef({ src: "a.wav", bpm: 10 }, "a")).toThrow(
      /bpm/,
    );
    expect(() => normalizeSampleRef({ src: "a.wav", len: 0 }, "a")).toThrow(
      /len/,
    );
    expect(() =>
      normalizeSampleRef({ src: "a.wav", fitmode: "tones" }, "a"),
    ).toThrow(/needs bpm, len or fit/);
    expect(
      normalizeSampleRef({ src: "a.wav", fit: true, fitmode: "tones" }, "a")
        .fitmode,
    ).toBe("tones");
    expect(() =>
      normalizeSampleRef({ src: "a.wav", bpm: 120, fitmode: "warp" }, "a"),
    ).toThrow(/fitmode/);
  });
});
