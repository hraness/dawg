import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { DRUM_VOICES } from "../../core/drums.ts";
import { SYNTH_KITS, synthKit } from "../../core/kits.ts";
import { createScore, ScoreValidationError } from "../../core/score.ts";
import {
  kitCatalog,
  kitDrumSample,
  kitHatWave,
  newKitVoiceState,
} from "./kits.ts";
import { DEFAULT_KITS } from "./packs.ts";
import { renderScorePcm, renderScoreWav } from "./wav.ts";

/** Every drum voice twice (soft, loud) on one bar at 120 BPM. */
function drumScore(kit?: string) {
  const notes = DRUM_VOICES.flatMap((voice, index) =>
    [0, 1].map((k) => ({
      id: `n${index}-${k}`,
      trackId: "drums",
      pitch: voice.pitch,
      startTick: (index * 2 + k) * 240,
      durationTicks: 120,
      velocity: 0.5 + k * 0.4,
    })),
  );
  return createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      {
        id: "drums",
        name: "drums",
        instrument: "kit",
        ...(kit ? { kit } : {}),
      },
    ],
    notes,
  });
}

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("synth kits", () => {
  test("a track without a kit renders byte-identical to the original voices", () => {
    // Hash of this score rendered before kits existed (origin/main 6cb7a18).
    expect(sha(renderScoreWav(drumScore(), { sampleRate: 22_050 }))).toBe(
      "998cfe0b610491b14ff1e4f9ee1d729000eda54cbed6bfc197a79062263340b5",
    );
  });

  test("every kit renders finite, audible, deterministic and distinct audio", () => {
    const seen = new Set<string>([
      sha(renderScoreWav(drumScore(), { sampleRate: 22_050 })),
    ]);
    for (const kit of SYNTH_KITS) {
      const first = renderScorePcm(drumScore(kit.name), { sampleRate: 22_050 });
      let peak = 0;
      for (const value of first.pcm) {
        expect(Number.isFinite(value)).toBe(true);
        peak = Math.max(peak, Math.abs(value));
      }
      // 16-bit PCM: clearly audible, and no voice slams into the rails.
      expect(peak).toBeGreaterThan(1_000);
      expect(peak).toBeLessThan(32_767);
      const wav = renderScoreWav(drumScore(kit.name), { sampleRate: 22_050 });
      expect(
        sha(renderScoreWav(drumScore(kit.name), { sampleRate: 22_050 })),
      ).toBe(sha(wav));
      expect(seen.has(sha(wav))).toBe(false);
      seen.add(sha(wav));
    }
  });

  test("the score validates kit names and keeps them on drum tracks only", () => {
    expect(drumScore("SYN808").tracks[0]!.kit).toBe("syn808");
    expect(drumScore("dusty").tracks[0]!.kit).toBe("lofi");
    expect(() => drumScore("nope")).toThrow(ScoreValidationError);
    expect(() =>
      createScore({
        tracks: [{ id: "bass", name: "bass", instrument: "bass", kit: "trap" }],
      }),
    ).toThrow(/has a kit/);
    expect(synthKit("808")).toBeUndefined(); // the 808 sample bank keeps its name
  });

  test("the catalog lists synth kits first, then every pack kit", () => {
    const catalog = kitCatalog();
    expect(catalog[0]!.name).toBe("default");
    const synth = catalog.filter((entry) => entry.kind === "synth");
    const sample = catalog.filter((entry) => entry.kind === "sample");
    expect(synth.map((entry) => entry.name).slice(1)).toEqual(
      SYNTH_KITS.map((kit) => kit.name),
    );
    expect(sample.map((entry) => entry.name)).toEqual(
      Object.keys(DEFAULT_KITS),
    );
    expect(new Set(catalog.map((entry) => entry.name)).size).toBe(
      catalog.length,
    );
  });
});

describe("shared hi-hat oscillator", () => {
  test("cached hats preserve the exact sample sequence and independent hit state", () => {
    // The cache may be evicted between voices or while a previous note still
    // owns its buffer. Both calibration modes and supported render rates must
    // agree with the uncached oscillator, including mixed metal/noise kits.
    for (const sampleRate of [8_000, 22_050, 48_000]) {
      for (const calibrated of [false, true]) {
        const count = Math.ceil(sampleRate * 0.08);
        const wave = kitHatWave(sampleRate, calibrated, count)!;
        for (const kit of SYNTH_KITS) {
          for (const voice of ["hat", "openhat"] as const) {
            const reference = new Float64Array(count);
            const cached = new Float64Array(count);
            const plainState = newKitVoiceState();
            const cachedState = newKitVoiceState();
            for (let index = 0; index < count; index += 1) {
              const noise = (((index * 17) % 101) - 50) / 50;
              const bright = (((index * 31) % 83) - 41) / 41;
              const args = [
                kit,
                voice,
                index / sampleRate,
                noise,
                bright,
              ] as const;
              const calibration = calibrated ? { tomRatio: 1 } : undefined;
              reference[index] = kitDrumSample(
                ...args,
                plainState,
                sampleRate,
                calibration,
              );
              cached[index] = kitDrumSample(
                ...args,
                cachedState,
                sampleRate,
                calibration,
                wave[index],
              );
            }
            expect(cached).toEqual(reference);
            expect(cachedState).toEqual(plainState);
          }
        }
      }
    }
  });

  test("short prefixes grow without changing earlier audio, and eviction is safe", () => {
    const initial = kitHatWave(8_000, false, 96)!;
    const prefix = initial.slice(0, 96);
    const grown = kitHatWave(8_000, false, 1_200)!;
    expect(grown).toBe(initial);
    expect(grown.slice(0, 96)).toEqual(prefix);
    expect(grown.slice(96, 1_200).some((sample) => sample !== 0)).toBe(true);
    const expected = grown.slice(0, 1_200);
    kitHatWave(22_050, true, 96);
    kitHatWave(48_000, true, 96);
    const restored = kitHatWave(8_000, false, 1_200)!;
    expect(restored).not.toBe(initial);
    expect(restored.slice(0, 1_200)).toEqual(expected);
    expect(initial.slice(0, 1_200)).toEqual(expected);
  });

  test("cache allocation is bounded and unsupported rates fall back to synthesis", () => {
    const longest = Math.max(...SYNTH_KITS.map((kit) => kit.seconds));
    expect(kitHatWave(48_000, true, Infinity)!.length).toBe(
      Math.ceil(longest * 48_000),
    );
    for (const rate of [0, -1, NaN, Infinity, 44_100.5, 96_000])
      expect(kitHatWave(rate, true, 100)).toBeUndefined();
  });
});
