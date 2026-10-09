import { describe, expect, test } from "bun:test";
import { createScore } from "../../../core/score.ts";
import { note, song, track } from "../../../core/sdk/v1.ts";
import { measureLoudness, pcmChannels } from "../loudness.ts";
import { renderScorePcm } from "../wav.ts";
import { KEYS_TRIM_DB_1, KEYS_TRIM_KEYS, keysTrim } from "./calibration.ts";

const SR = 22_050;
const REFERENCE = -18;

function render(
  instrument: string,
  pitch: number,
  sampleRate: number,
  calibration?: number,
) {
  const score = createScore(
    song({
      tempo: 120,
      bars: 2,
      ...(calibration ? { calibration } : {}),
      tracks: [
        track({
          name: "t",
          instrument: instrument as never,
          notes: [note(pitch, 0, 4, 0.8)],
        }),
      ],
    } as never) as never,
  );
  const [l, r] = pcmChannels(renderScorePcm(score, { sampleRate }).pcm);
  let peak = 0;
  for (let i = 0; i < l.length; i += 1)
    peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
  return {
    lufs: measureLoudness(l, r, sampleRate, { truePeak: false }).momentaryMax,
    peak: 20 * Math.log10(peak),
  };
}

/** Loudness at 22.05 kHz; sample peak, the higher of 22.05 and 48 kHz. */
function level(instrument: string, pitch: number, calibration?: number) {
  const low = render(instrument, pitch, SR, calibration);
  if (!calibration) return low;
  const high = render(instrument, pitch, 48_000, calibration);
  return { lufs: low.lufs, peak: Math.max(low.peak, high.peak) };
}

// The preset words the table covers (prepared is excluded from the level band below: its
// preparations are deliberately uneven from key to key).
const PRESETS = Object.keys(KEYS_TRIM_DB_1);

describe("keys level matrix (calibration 1)", () => {
  test("the piano reference sits at -18 LUFS in the middle keys", () => {
    for (const pitch of [48, 60, 72])
      expect(Math.abs(level("piano", pitch).lufs - REFERENCE)).toBeLessThan(1);
  });

  for (const preset of PRESETS)
    test(`${preset} stays level with the piano from note 36 to 96`, () => {
      for (const pitch of [36, 48, 60, 72, 84, 96]) {
        const { lufs, peak } = level(preset, pitch, 1);
        expect(peak).toBeLessThanOrEqual(-3);
        if (preset === "prepared") continue;
        // Within 3 dB of the reference, unless the -4 dBFS peak cap holds
        // the note (the top keys' hammer click, the harpsichord's bass
        // pluck): then a few dB under, never over.
        const capped = peak > -4.5;
        const floor = capped ? REFERENCE - 8 : REFERENCE - 3;
        expect(lufs).toBeGreaterThan(floor);
        expect(lufs).toBeLessThan(REFERENCE + 3);
      }
    }, 30_000);

  test("legacy songs keep the unbalanced levels byte for byte", () => {
    // felt was ~20 dB under the piano before; calibration 0 must keep it.
    expect(level("felt", 60).lufs).toBeLessThan(REFERENCE - 15);
  });

  test("the trim is interpolated in dB and holds at the ends", () => {
    const row = KEYS_TRIM_DB_1.grand!;
    const db = (k: number) => 20 * Math.log10(keysTrim("grand", k));
    expect(db(KEYS_TRIM_KEYS[0])).toBeCloseTo(row[0]!, 6);
    expect(db(0)).toBeCloseTo(row[0]!, 6);
    expect(db(127)).toBeCloseTo(row[row.length - 1]!, 6);
    expect(db(42)).toBeCloseTo((row[1]! + row[2]!) / 2, 6);
    expect(keysTrim("no-such-preset", 60)).toBe(1);
  });
});
