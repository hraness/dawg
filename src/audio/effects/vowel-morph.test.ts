import { describe, expect, test } from "bun:test";
import {
  createScore,
  type Track,
  type TrackInput,
} from "../../../core/score.ts";
import { morphFormants, VOWEL_FORMANTS } from "../dsp/formant.ts";
import type { EffectContext } from "./common.ts";
import { applyVowel } from "./filter.ts";

const RATE = 48_000;
const context: EffectContext = {
  sampleRate: RATE,
  tempoBpm: 120,
  samplesPerTick: (RATE * 0.5) / 480,
};

function track(input: Omit<TrackInput, "id">): Track {
  return createScore({ tracks: [{ id: "t", ...input }] }).tracks[0]!;
}

function saw(seconds: number): Float64Array {
  const out = new Float64Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i += 1)
    out[i] = 0.4 * (((i * 110) / RATE) % 1) - 0.2;
  return out;
}

function vowel(fx: Record<string, unknown>): Float64Array {
  const t = track({ fx: { vowel: fx } as never });
  const out = saw(0.5);
  applyVowel(out, t, t.fx!.vowel!, context);
  return out;
}

const bytes = (x: Float64Array) => Buffer.from(x.buffer);

describe("vowel morph (fx.vowel to, morph)", () => {
  test("morph 0 with `to` set equals the static bank byte for byte", () => {
    expect(bytes(vowel({ vowel: "a", to: "o", morph: 0 }))).toEqual(
      bytes(vowel({ vowel: "a" })),
    );
    expect(bytes(vowel({ vowel: "a", to: "o" }))).toEqual(
      bytes(vowel({ vowel: "a" })),
    );
  });

  test("morph 1 equals the static `to` bank byte for byte", () => {
    expect(bytes(vowel({ vowel: "a", to: "u", morph: 1 }))).toEqual(
      bytes(vowel({ vowel: "u" })),
    );
  });

  test("morph 0.5 lies between the two vowels", () => {
    const half = vowel({ vowel: "a", to: "i", morph: 0.5 });
    expect(bytes(half)).not.toEqual(bytes(vowel({ vowel: "a" })));
    expect(bytes(half)).not.toEqual(bytes(vowel({ vowel: "i" })));
    const [f1] = morphFormants(VOWEL_FORMANTS.a!, VOWEL_FORMANTS.i!, 0.5)[0]!;
    // Log-frequency midpoint: the geometric mean of the two F1s.
    expect(f1).toBeCloseTo(Math.sqrt(650 * VOWEL_FORMANTS.i![0]![0]), 6);
  });

  test("a project without to/morph normalizes without them", () => {
    const t = track({ fx: { vowel: { vowel: "o" } } });
    expect(t.fx!.vowel).toEqual({ vowel: "o", mix: 1 });
  });
});
