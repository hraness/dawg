import { describe, expect, test } from "bun:test";
import { createScore } from "../../../core/score.ts";
import { note, sing, song, track } from "../../../core/sdk/v1.ts";
import { SING_PRESET_NAMES } from "../../../core/sing.ts";
import { measureLoudness, pcmChannels } from "../loudness.ts";
import { renderScorePcm } from "../wav.ts";

/** Integrated LUFS and sample peak of one held note on one instrument. */
function level(
  instrument: unknown,
  pitch: number,
  velocity = 0.8,
): { lufs: number; peak: number } {
  const s = song({
    tempo: 120,
    bars: 2,
    tracks: [
      track({
        name: "t",
        instrument: instrument as never,
        notes: [note(pitch, 0, 4, velocity)],
      }),
    ],
  });
  const audio = renderScorePcm(createScore(s as never), { sampleRate: 22_050 });
  const [l, r] = pcmChannels(audio.pcm);
  const m = measureLoudness(l, r, audio.sampleRate, { truePeak: false });
  return { lufs: m.integrated, peak: m.samplePeak };
}

const THROAT = new Set(["khoomei", "sygyt", "kargyraa", "drone"]);

describe("sing level parity", () => {
  const piano = level("piano", 60).lufs;

  test("piano reference is about -19 LUFS", () => {
    expect(piano).toBeGreaterThan(-21);
    expect(piano).toBeLessThan(-17);
  });

  // The reviewer measured sing and choir at about -3 LUFS against piano's
  // -19, which hard-clipped every mix they joined.
  for (const preset of SING_PRESET_NAMES) {
    test(`${preset} sits beside piano across the range`, () => {
      const band = THROAT.has(preset) ? 6.5 : 3;
      for (const pitch of [48, 60, 72]) {
        const { lufs, peak } = level(sing(preset), pitch);
        expect(Math.abs(lufs - piano)).toBeLessThanOrEqual(band);
        expect(peak).toBeLessThan(-6);
      }
    });
  }

  // A legato line that changes vowel on every note (lyrics la li la li)
  // clicked at each change, peaking at -0.2 dBFS on a -19 LUFS part.
  test("a legato line that changes vowel leaves headroom", () => {
    for (const preset of ["aah", "chorale"]) {
      const s = song({
        tempo: 72,
        bars: 2,
        tracks: [
          track({
            name: "t",
            instrument: sing(preset) as never,
            notes: [59, 59, 60, 55, 57, 55, 57, 55].map((pitch, i) => ({
              ...note(pitch, i, 1, 0.8),
              lyric: i % 2 ? "li" : "la",
            })) as never,
          }),
        ],
      });
      const audio = renderScorePcm(createScore(s as never), {
        sampleRate: 22_050,
      });
      const [l, r] = pcmChannels(audio.pcm);
      const m = measureLoudness(l, r, audio.sampleRate, { truePeak: false });
      expect({ preset, peak: m.samplePeak < -6 }).toEqual({
        preset,
        peak: true,
      });
    }
  });

  test("velocity still scales the sung level", () => {
    const loud = level(sing("aah"), 60, 0.8).lufs;
    const soft = level(sing("aah"), 60, 0.3).lufs;
    expect(loud - soft).toBeGreaterThan(5);
  });

  test("piano, choir and sing together leave headroom", () => {
    const s = song({
      tempo: 120,
      bars: 2,
      tracks: ["piano", "choir", "aah"].map((instrument, i) =>
        track({
          name: `t${i}`,
          instrument: instrument as never,
          notes: [
            note(60, 0, 4, 0.8),
            note(64, 0, 4, 0.8),
            note(67, 0, 4, 0.8),
          ],
        }),
      ),
    });
    const audio = renderScorePcm(createScore(s as never), {
      sampleRate: 22_050,
    });
    const [l, r] = pcmChannels(audio.pcm);
    let clipped = 0;
    for (const ch of [l, r])
      for (let i = 0; i < ch.length; i += 1)
        if (Math.abs(ch[i]!) >= 0.998) clipped += 1;
    expect(clipped).toBe(0);
  });
});
