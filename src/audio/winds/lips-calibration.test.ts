import { describe, expect, test } from "bun:test";
import { createScore } from "../../../core/score.ts";
import { note, song, track } from "../../../core/sdk/v1.ts";
import { WIND_PRESETS, type WindPresetName } from "../../../core/winds.ts";
import { pcmChannels } from "../loudness.ts";
import { median, yin } from "../sing/analysis.ts";
import { renderScorePcm } from "../wav.ts";
import { measurePitch } from "./pitch.ts";
import { WIND_TRIM_TABLE } from "./trims.ts";
import { WIND_TRIM_TABLE_1 } from "./trims1.ts";

const BRASS = (Object.keys(WIND_PRESETS) as WindPresetName[]).filter(
  (name) => WIND_PRESETS[name].settings.model === "lips",
);

/** One held note (2 s at 60 bpm), left channel, through the song path. */
function held(
  preset: string,
  pitch: number,
  sampleRate: number,
  calibration?: number,
): Float64Array {
  const score = createScore(
    song({
      tempo: 60,
      bars: 1,
      ...(calibration ? { calibration } : {}),
      tracks: [
        track({
          name: "t",
          instrument: preset as never,
          notes: [note(pitch, 0, 2, 0.8)],
        }),
      ],
    } as never) as never,
  );
  return pcmChannels(renderScorePcm(score, { sampleRate }).pcm)[0]!;
}

/** Coefficient of variation of per-period peaks from 0.6 to 1.8 s, %. */
function periodPeakVariation(x: Float64Array, sr: number, hz: number) {
  const period = sr / hz;
  const peaks: number[] = [];
  for (let at = 0.6 * sr; at + period < 1.8 * sr; at += period) {
    let peak = 0;
    for (let i = Math.floor(at); i < Math.floor(at + period); i += 1)
      peak = Math.max(peak, Math.abs(x[i]!));
    peaks.push(peak);
  }
  const mean = peaks.reduce((a, b) => a + b, 0) / peaks.length;
  const sd = Math.sqrt(
    peaks.reduce((a, b) => a + (b - mean) ** 2, 0) / peaks.length,
  );
  return (100 * sd) / mean;
}

/** YIN median over 0.2-1.8 s, in cents from `hz`. */
function yinCents(x: Float64Array, sr: number, hz: number): number {
  const hop = 256;
  const track = [...yin(x, sr, hop, 25, 1500)]
    .slice(Math.floor((0.2 * sr) / hop), Math.floor((1.8 * sr) / hop))
    .filter((v) => v > 0);
  return 1200 * Math.log2(median(track) / hz);
}

const hzOf = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);

describe("calibrated lip brass (calibration 1)", () => {
  test("every lip-model preset has a calibration 1 row at every rate", () => {
    expect(BRASS.length).toBeGreaterThanOrEqual(6);
    for (const rate of Object.keys(WIND_TRIM_TABLE))
      for (const preset of BRASS)
        expect(WIND_TRIM_TABLE_1[Number(rate)]?.[preset]).toBeDefined();
  });

  for (const preset of BRASS)
    for (const sampleRate of [22_050, 48_000])
      test(`${preset} at ${sampleRate} Hz: steady, and in tune by YIN`, () => {
        const [low, high] = WIND_PRESETS[preset].range;
        const pitches = [low, Math.round((low + high) / 2), high];
        for (const pitch of pitches) {
          const hz = hzOf(pitch);
          const x = held(preset, pitch, sampleRate, 1);
          expect(periodPeakVariation(x, sampleRate, hz)).toBeLessThan(5);
          expect(Math.abs(yinCents(x, sampleRate, hz))).toBeLessThan(5);
          const fft = measurePitch(x, sampleRate, hz, 0.6, 1.8, 300);
          expect(Math.abs(1200 * Math.log2(fft.hz / hz))).toBeLessThan(5);
        }
      }, 30_000);

  test("legacy songs keep the warbling lips (render identity)", () => {
    const x = held("trumpet", 60, 22_050);
    expect(periodPeakVariation(x, 22_050, hzOf(60))).toBeGreaterThan(15);
  });

  test("non-brass winds ignore calibration", () => {
    for (const preset of ["clarinet", "flute", "sax"]) {
      const a = held(preset, 64, 22_050);
      const b = held(preset, 64, 22_050, 1);
      expect(b).toEqual(a);
    }
  });
});
