import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  melody,
  steady,
  synthVoice,
  VOICE_FIXTURE_VERSION,
  vowels,
} from "./voice.ts";

function digest(...arrays: readonly Float64Array[]): string {
  const hash = createHash("sha256");
  for (const array of arrays)
    hash.update(
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
    );
  return hash.digest("hex");
}

/**
 * Platform-stable pin: audio as 16-bit PCM (what a WAV holds) and truth
 * curves at 1e-6 Hz / cents, so libm last-bit differences cannot flip it.
 */
function pinned(...arrays: readonly Float64Array[]): string {
  const hash = createHash("sha256");
  const [audio, ...curves] = arrays;
  const pcm = Int16Array.from(audio!, (value) =>
    Math.max(-32768, Math.min(32767, Math.round(value * 32767))),
  );
  hash.update(new Uint8Array(pcm.buffer));
  for (const curve of curves)
    hash.update(
      Array.from(curve, (value) =>
        Number.isNaN(value) ? "n" : value.toFixed(6),
      ).join(","),
    );
  return hash.digest("hex");
}

describe("synthetic voice fixture", () => {
  const signal = synthVoice(melody(60), { sr: 48_000, seed: 7 });

  test("outputs are pinned (existing outputs never change)", () => {
    expect(VOICE_FIXTURE_VERSION).toBe(1);
    expect(signal.x.length).toBe(PINNED_LENGTH);
    expect(pinned(signal.x, signal.f0, signal.target)).toBe(PINNED_SHA);
  });

  test("is deterministic for a seed and changes with it", () => {
    const again = synthVoice(melody(60), { sr: 48_000, seed: 7 });
    expect(digest(again.x)).toBe(digest(signal.x));
    const other = synthVoice(melody(60), { sr: 48_000, seed: 8 });
    expect(digest(other.x)).not.toBe(digest(signal.x));
  });

  test("truth f0 follows the sung note within its cents offset and drift", () => {
    const notes = steady(57, 30);
    const voice = synthVoice(notes, { sr: 48_000, seed: 3, drift: 0 });
    for (const [index, note] of notes.entries()) {
      const mid = Math.round((note.start + note.dur / 2) * voice.sr);
      const cents =
        1200 * Math.log2(voice.f0[mid]! / 440) - (note.midi - 69) * 100;
      expect(Math.abs(cents - (note.off ?? 0))).toBeLessThan(0.5);
      expect(voice.onsets[index]).toBeCloseTo(note.start, 6);
    }
  });

  test("returns one syllable per note with its vowel and onset", () => {
    const notes = vowels(64);
    const voice = synthVoice(notes, { sr: 48_000, seed: 1 });
    expect(voice.syllables.map((syllable) => syllable.vowel)).toEqual([
      "a",
      "e",
      "i",
      "o",
      "u",
    ]);
    for (const [index, syllable] of voice.syllables.entries()) {
      expect(syllable.onset).toBe(voice.onsets[index]!);
      expect(syllable.end).toBeCloseTo(
        notes[index]!.start + notes[index]!.dur,
        9,
      );
    }
    const peak = voice.x.reduce(
      (max, value) => Math.max(max, Math.abs(value)),
      0,
    );
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(1);
  });
});

const PINNED_LENGTH = 424_801;
const PINNED_SHA =
  "89b094160b5d2f0ca95f621039f038fd3e8d3acd2f7db9d3716567689a37e9f9";
