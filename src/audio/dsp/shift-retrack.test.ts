import { describe, expect, test } from "bun:test";
import { synthVoice } from "../fixtures/voice.ts";
import { centsOfHz, trackPitch } from "./pitch.ts";
import { pitchShift } from "./shift.ts";

const SR = 48_000;
const BASE = 165;

/** A held vowel at 165 Hz, the case pitch.md 3.5 measured. */
function heldVowel(): Float32Array {
  const v = synthVoice(
    [
      {
        start: 0.1,
        dur: 1.4,
        midi: 69 + 12 * Math.log2(BASE / 440),
        vowel: "a",
      },
    ],
    { sr: SR, seed: 3, drift: 0 },
  );
  return Float32Array.from(v.x);
}

/** Median tracked pitch in cents (re 440) over the middle of the note. */
function medianCents(x: Float32Array): number {
  const curve = trackPitch(Float64Array.from(x), SR);
  const cents: number[] = [];
  for (let f = 0; f < curve.f0.length; f++) {
    const t = curve.t0 + f * curve.hop;
    if (t < 0.4 || t > 1.3 || !(curve.f0[f]! > 0)) continue;
    cents.push(centsOfHz(curve.f0[f]!));
  }
  cents.sort((a, b) => a - b);
  return cents[cents.length >> 1]!;
}

describe("SampleRef.shift with formant 0 moves the pitch (pitch.md 3.5)", () => {
  const x = heldVowel();
  const source = medianCents(x);
  for (const st of [-7, 5, 12])
    test(`${st > 0 ? "+" : ""}${st} st re-tracks within 10 cents`, () => {
      const y = pitchShift(x, SR, st, { formant: 0 });
      expect(Math.abs(medianCents(y) - (source + st * 100))).toBeLessThan(10);
    });
});
