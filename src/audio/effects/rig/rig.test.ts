import { describe, expect, test } from "bun:test";
import { FX_SPECS, type FxValues } from "../../../../core/fx.ts";
import { normalizeParams } from "../../../../core/params.ts";
import type { Track } from "../../../../core/score.ts";
import { fftInPlace } from "../../dsp/fft.ts";
import { Biquad } from "../common.ts";
import { CALIBRATION_DBFS, CALIBRATION_HZ, HEAD_TYPES } from "./head.ts";
import { STOMP_CALIBRATION_DBFS, STOMP_TYPES } from "./stomp.ts";
import { CAB_TYPES } from "./cab.ts";
import { applyCab, applyHead, applyStomp } from "./index.ts";

const track = { id: "gtr", instrument: "pluck" } as unknown as Track;
const context = (sampleRate: number) => ({
  sampleRate,
  samplesPerTick: sampleRate / 960,
  tempoBpm: 120,
});
const values = (stage: "stomp" | "head" | "cab", input: object): FxValues =>
  normalizeParams(FX_SPECS[stage].params, input, stage);

const sine = (hz: number, dbfs: number, sampleRate: number, length: number) => {
  const amplitude = 10 ** (dbfs / 20) * Math.SQRT2;
  return Float64Array.from(
    { length },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate),
  );
};

const rmsDb = (buffer: Float64Array, from = 0): number => {
  let sum = 0;
  for (let i = from; i < buffer.length; i += 1) sum += buffer[i]! ** 2;
  return 10 * Math.log10(sum / (buffer.length - from));
};

/**
 * Largest non-harmonic bin relative to the 1 kHz fundamental, in dB
 * (Blackman-Harris, the contract's dsp.test.ts method) over the audible
 * band up to 20 kHz. Harmonics of 1 kHz are skipped; anything else is
 * aliasing. (At 44.1 kHz the 23rd harmonic folds to 21.1 kHz from the
 * half-band's transition band at about -54 dB: above hearing, not counted.)
 */
function aliasDb(buffer: Float64Array, sampleRate: number): number {
  const size = 16384;
  const skip = buffer.length - size;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    const w =
      0.35875 -
      0.48829 * Math.cos((2 * Math.PI * i) / size) +
      0.14128 * Math.cos((4 * Math.PI * i) / size) -
      0.01168 * Math.cos((6 * Math.PI * i) / size);
    re[i] = buffer[skip + i]! * w;
  }
  fftInPlace(re, im);
  const mag = (k: number) => Math.hypot(re[k]!, im[k]!);
  const bin = (hz: number) => (hz * size) / sampleRate;
  const f0 = Math.round(bin(1000));
  let peak = 0;
  for (let k = f0 - 6; k <= f0 + 6; k += 1) peak = Math.max(peak, mag(k));
  let worst = 0;
  const top = Math.min(size / 2, bin(20_000));
  for (let k = 10; k < top; k += 1) {
    const harmonic = Math.round((k * sampleRate) / size / 1000) * 1000;
    if (harmonic > 0 && Math.abs(k - bin(harmonic)) <= 8) continue;
    worst = Math.max(worst, mag(k));
  }
  return 20 * Math.log10(worst / peak);
}

describe("guitar rig DSP", () => {
  test("a 1 kHz fuzz keeps its aliases at or below -60 dB at every rate", () => {
    for (const sampleRate of [22050, 44100, 48000]) {
      const buffer = sine(1000, -9, sampleRate, sampleRate);
      applyStomp(
        buffer,
        track,
        values("stomp", { type: "fuzz", gain: 8 }),
        context(sampleRate),
      );
      expect(aliasDb(buffer, sampleRate)).toBeLessThanOrEqual(-60);
    }
  });

  test("every stomp type stays finite and below full scale", () => {
    for (const type of STOMP_TYPES) {
      const buffer = sine(220, -6, 44100, 22050);
      applyStomp(
        buffer,
        track,
        values("stomp", { type, gain: 10 }),
        context(44100),
      );
      for (const x of buffer) expect(Number.isFinite(x)).toBe(true);
      expect(Math.max(...buffer.map(Math.abs))).toBeLessThan(4);
    }
  });

  for (const sampleRate of [22050, 44100, 48000])
    test(`heads play the -30 dBFS calibration sine back within 1 dB (${sampleRate} Hz)`, () => {
      const settle = (buffer: Float64Array) =>
        Math.abs(rmsDb(buffer, buffer.length / 2) - CALIBRATION_DBFS);
      for (const type of HEAD_TYPES) {
        for (const tone of [{}, { bass: 10, mid: 0, treble: 10 }])
          for (const gain of [0, 5, 10]) {
            const buffer = sine(
              CALIBRATION_HZ,
              CALIBRATION_DBFS,
              sampleRate,
              sampleRate,
            );
            applyHead(
              buffer,
              track,
              values("head", { type, gain, ...tone }),
              context(sampleRate),
            );
            expect(settle(buffer)).toBeLessThan(1);
          }
        // Automated: a gain lane held flat at an off-grid value.
        const held = {
          ...track,
          fxAutomation: {
            "head-gain": [
              { tick: 0, value: 6.3 },
              { tick: 960 * 4, value: 6.3 },
            ],
          },
        } as unknown as Track;
        const buffer = sine(
          CALIBRATION_HZ,
          CALIBRATION_DBFS,
          sampleRate,
          sampleRate,
        );
        applyHead(buffer, held, values("head", { type }), context(sampleRate));
        expect(settle(buffer)).toBeLessThan(1);
        // No block-boundary step: against the same head unautomated, the
        // gain ratio is one constant across every 32-sample block.
        const fixed = sine(
          CALIBRATION_HZ,
          CALIBRATION_DBFS,
          sampleRate,
          sampleRate,
        );
        applyHead(
          fixed,
          track,
          values("head", { type, gain: 6.3 }),
          context(sampleRate),
        );
        const ratios: number[] = [];
        for (let i = sampleRate / 2; i < sampleRate; i += 1)
          if (Math.abs(fixed[i]!) > 1e-3) ratios.push(buffer[i]! / fixed[i]!);
        const spread = Math.max(...ratios) / Math.min(...ratios);
        expect(20 * Math.log10(spread)).toBeLessThan(0.01);
        expect(Math.abs(20 * Math.log10(ratios[0]!))).toBeLessThan(0.5);
      }
    });

  test("stomps are level-matched to bypass at guitar level", () => {
    for (const sampleRate of [22050, 44100])
      for (const type of STOMP_TYPES)
        for (const gain of [2, 5, 9]) {
          const buffer = sine(
            196,
            STOMP_CALIBRATION_DBFS,
            sampleRate,
            sampleRate,
          );
          applyStomp(
            buffer,
            track,
            values("stomp", { type, gain }),
            context(sampleRate),
          );
          expect(
            Math.abs(rmsDb(buffer, sampleRate / 2) - STOMP_CALIBRATION_DBFS),
          ).toBeLessThan(1);
        }
    // `level` stays a trim on top of the match.
    const trimmed = sine(196, STOMP_CALIBRATION_DBFS, 44100, 44100);
    applyStomp(
      trimmed,
      track,
      values("stomp", { type: "fuzz", level: 6 }),
      context(44100),
    );
    expect(
      Math.abs(rmsDb(trimmed, 22050) - STOMP_CALIBRATION_DBFS - 6),
    ).toBeLessThan(1);
  });

  test("the noise gate closes on hiss and opens on a note", () => {
    const sampleRate = 44100;
    const buffer = new Float64Array(sampleRate);
    let seed = 1;
    for (let i = 0; i < buffer.length; i += 1) {
      // Deterministic LCG hiss at about -70 dBFS; a -12 dBFS note after 0.5 s.
      seed = (seed * 1664525 + 1013904223) >>> 0;
      buffer[i] = (seed / 2 ** 32 - 0.5) * 0.001;
      if (i >= sampleRate / 2)
        buffer[i]! += 0.35 * Math.sin((2 * Math.PI * 196 * i) / sampleRate);
    }
    applyHead(
      buffer,
      track,
      values("head", { type: "clean", gain: 3, gate: -50 }),
      context(sampleRate),
    );
    const hiss = rmsDb(buffer.subarray(sampleRate / 8, sampleRate / 2 - 2000));
    const note = rmsDb(buffer.subarray(sampleRate / 2 + 4410));
    expect(hiss).toBeLessThan(-100);
    expect(note).toBeGreaterThan(-30);
  });

  test("without gate, hiss passes through the head", () => {
    const sampleRate = 44100;
    const buffer = new Float64Array(sampleRate / 2);
    let seed = 1;
    for (let i = 0; i < buffer.length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      buffer[i] = (seed / 2 ** 32 - 0.5) * 0.001;
    }
    applyHead(
      buffer,
      track,
      values("head", { type: "clean", gain: 3 }),
      context(sampleRate),
    );
    expect(rmsDb(buffer, 4410)).toBeGreaterThan(-90);
  });

  test("cabs roll off highs; di passes the band", () => {
    const sampleRate = 44100;
    const level = (type: string, hz: number) => {
      const buffer = sine(hz, -20, sampleRate, sampleRate / 2);
      applyCab(buffer, track, values("cab", { type }), context(sampleRate));
      return rmsDb(buffer, 4410);
    };
    for (const type of CAB_TYPES) {
      if (type === "di") continue;
      // Guitar and bass speakers roll off well above the 1 kHz band.
      expect(level(type, 8000)).toBeLessThan(level(type, 1000) - 9);
    }
    expect(Math.abs(level("di", 1000) + 20)).toBeLessThan(1);
  });

  test("renders are deterministic", () => {
    const run = () => {
      const buffer = sine(147, -12, 44100, 44100);
      applyStomp(
        buffer,
        track,
        values("stomp", { type: "rat", gain: 7 }),
        context(44100),
      );
      applyHead(
        buffer,
        track,
        values("head", { type: "high", gain: 8, gate: -60 }),
        context(44100),
      );
      applyCab(buffer, track, values("cab", { type: "4x12" }), context(44100));
      return buffer;
    };
    expect(run()).toEqual(run());
  });

  /**
   * The brief's 15-25 ms per track-second, measured against a fixed
   * reference workload timed in the same process (32 biquads at the base
   * rate, about 2.4 ms per track-second on the reference Mac), so a slow
   * shared CI host scales both. DAWG_PERF=1 also asserts the absolute
   * 25 ms figure.
   */
  const REFERENCE_MS = 2.4;
  const reference = (sampleRate: number, seconds: number): number => {
    const buffer = sine(196, -12, sampleRate, sampleRate * seconds);
    const filters = Array.from({ length: 32 }, (_, k) => {
      const filter = new Biquad();
      filter.set("lpf", 500 + k * 300, 0.7, sampleRate);
      return filter;
    });
    const started = performance.now();
    for (let i = 0; i < buffer.length; i += 1) {
      let x = buffer[i]!;
      for (const filter of filters) x = filter.process(x);
      buffer[i] = x;
    }
    return (performance.now() - started) / seconds;
  };
  const budget = (rig: () => number, sampleRate: number) => {
    rig();
    reference(44100, 4);
    let cost = Infinity;
    let ref = Infinity;
    // Best of three, interleaved: a loaded host stalls both alike.
    for (let k = 0; k < 3; k += 1) {
      cost = Math.min(cost, rig());
      ref = Math.min(ref, reference(44100, 4));
    }
    const scaled = (cost / ref) * REFERENCE_MS;
    if (process.env.DAWG_PERF_LOG)
      console.log({ sampleRate, cost, ref, scaled });
    expect(scaled).toBeLessThanOrEqual(25);
    if (process.env.DAWG_PERF === "1") expect(cost).toBeLessThanOrEqual(25);
  };

  for (const sampleRate of [22050, 44100])
    test(`a full rig costs at most 25 ms per track-second (${sampleRate} Hz)`, () => {
      const seconds = 4;
      budget(() => {
        const buffer = sine(196, -12, sampleRate, sampleRate * seconds);
        const started = performance.now();
        applyStomp(
          buffer,
          track,
          values("stomp", { type: "fuzz" }),
          context(sampleRate),
        );
        applyHead(
          buffer,
          track,
          values("head", { type: "high", gain: 7, gate: -60 }),
          context(sampleRate),
        );
        applyCab(
          buffer,
          track,
          values("cab", { type: "4x12" }),
          context(sampleRate),
        );
        return (performance.now() - started) / seconds;
      }, sampleRate);
    });

  test("an automated head stays in budget (gain and master ramps)", () => {
    const sampleRate = 22050;
    const seconds = 8;
    const ticks = 960 * 2 * seconds; // 120 BPM: two beats a second
    const automated = {
      ...track,
      fxAutomation: {
        "head-gain": [
          { tick: 0, value: 0 },
          { tick: ticks, value: 10 },
        ],
        "head-master": [
          { tick: 0, value: 10 },
          { tick: ticks, value: 0 },
        ],
      },
    } as unknown as Track;
    let sweep = 0;
    budget(() => {
      // A fresh settings object each run so nothing is warm but the grid.
      sweep += 1;
      const buffer = sine(196, -12, sampleRate, sampleRate * seconds);
      const started = performance.now();
      applyHead(
        buffer,
        automated,
        values("head", { type: "lead", gain: 5, bass: 5 + sweep * 0.01 }),
        context(sampleRate),
      );
      return (performance.now() - started) / seconds;
    }, sampleRate);
  });
});
