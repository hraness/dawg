import { describe, expect, test } from "bun:test";
import { normalizeFx, type FxValues } from "../../../core/fx.ts";
import type { EffectContext, EffectNote } from "./common.ts";
import {
  applyBloom,
  applyDouble,
  applySwell,
  applyWobble,
  wobbleShape,
} from "./gaze.ts";
import { seededRandom } from "../dsp/rng.ts";
import { builtinImpulse } from "./convolution.ts";
import { normalizeReverbIr, type Track } from "../../../core/score.ts";

const SR = 44_100;
const context: EffectContext = {
  sampleRate: SR,
  samplesPerTick: (SR * 60) / (120 * 96),
  tempoBpm: 120,
};
const track = { id: "gtr", instrument: "pluck" } as unknown as Track;

function values(effect: string, input: Record<string, unknown> = {}): FxValues {
  return normalizeFx({ [effect]: input })![effect as "wobble"]!;
}

function sine(hz: number, seconds: number): Float64Array {
  const out = new Float64Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i += 1)
    out[i] = Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

/** Instantaneous frequency in cents vs `hz`, from upward zero crossings. */
function crossingsCents(x: Float64Array, hz: number): number[] {
  const at: number[] = [];
  for (let i = 1; i < x.length; i += 1)
    if (x[i - 1]! < 0 && x[i]! >= 0)
      at.push(i - 1 + x[i - 1]! / (x[i - 1]! - x[i]!));
  const cents: number[] = [];
  for (let k = 1; k < at.length; k += 1)
    cents.push(1200 * Math.log2(SR / (at[k]! - at[k - 1]!) / hz));
  return cents;
}

function correlation(a: Float64Array, b: Float64Array): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    ab += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  return ab / Math.sqrt(aa * bb);
}

describe("wobble", () => {
  test("a held A3 swings ±35 cents at depth 35", () => {
    const x = sine(220, 6);
    applyWobble(
      x,
      track,
      values("wobble", { depth: 35, rate: 0.5, drift: 0 }),
      context,
    );
    const cents = crossingsCents(x.subarray(SR), 220);
    const max = Math.max(...cents);
    const min = Math.min(...cents);
    expect(Math.abs(max - 35)).toBeLessThan(3);
    expect(Math.abs(min + 35)).toBeLessThan(3);
  });

  test("the measured pitch follows the analytic curve", () => {
    const shape = wobbleShape(35, 0.5, 0.4, "gtr");
    let peak = 0;
    for (let t = 0; t < 20; t += 0.01)
      peak = Math.max(peak, Math.abs(shape.cents(t)));
    expect(peak).toBeLessThanOrEqual(35.01);
    expect(peak).toBeGreaterThan(20);
  });

  test("is deterministic and depth 0 is a no-op", () => {
    const a = sine(220, 1);
    const b = sine(220, 1);
    const v = values("wobble", { depth: 20 });
    applyWobble(a, track, v, context);
    applyWobble(b, track, v, context);
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    const c = sine(220, 1);
    applyWobble(c, track, values("wobble", { depth: 0 }), context);
    expect(c).toEqual(sine(220, 1));
  });
});

describe("double", () => {
  test("left and right correlate between 0.3 and 0.8", () => {
    const r = seededRandom("noise");
    const mono = new Float64Array(SR * 2);
    let y = 0;
    for (let i = 0; i < mono.length; i += 1) {
      y = 0.9 * y + 0.1 * (r() * 2 - 1);
      mono[i] = y;
    }
    const left = mono.slice();
    const right = mono.slice();
    applyDouble(left, right, track, values("double"), context);
    const rho = correlation(left.subarray(SR / 10), right.subarray(SR / 10));
    expect(rho).toBeGreaterThan(0.3);
    expect(rho).toBeLessThan(0.8);
  });
});

describe("note-aware stages", () => {
  const note = (
    id: string,
    start: number,
    seconds: number,
    hz: number,
  ): EffectNote => ({
    id,
    start: Math.round(start * SR),
    length: Math.round(seconds * SR),
    hz,
    velocity: 1,
  });

  test("swell starts each onset silent and rises", () => {
    const x = new Float64Array(SR).fill(1);
    applySwell(x, track, values("swell", { time: 0.4 }), {
      ...context,
      notes: [note("a", 0, 1, 220)],
    });
    expect(x[0]).toBe(0);
    expect(x[Math.round(0.1 * SR)]!).toBeLessThan(0.4);
    expect(x[Math.round(0.4 * SR)]!).toBeGreaterThan(0.9);
  });

  /** A held two-note chord (110 + 220 Hz) at `level` for `seconds`. */
  function held(level: number, seconds: number): Float64Array {
    const a = sine(110, seconds);
    const b = sine(220, seconds);
    return a.map((v, i) => level * 0.5 * (v + b[i]!));
  }
  const chord = [note("low", 0, 3, 110), note("high", 0, 3, 220)];

  /** What bloom added to `dry`. */
  function bloomOf(dry: Float64Array, input = {}): Float64Array {
    const x = dry.slice();
    applyBloom(x, track, values("bloom", { delay: 0.5, harm: 2, ...input }), {
      ...context,
      notes: chord,
    });
    return x.map((v, i) => v - dry[i]!);
  }

  function rms(x: Float64Array): number {
    let sum = 0;
    for (const v of x) sum += v * v;
    return Math.sqrt(sum / Math.max(1, x.length));
  }

  test("bloom grows a partial only on the top held note", () => {
    const added = bloomOf(held(0.5, 3));
    expect(added.subarray(0, Math.round(0.5 * SR)).every((v) => v === 0)).toBe(
      true,
    );
    const tail = added.subarray(2 * SR, 2 * SR + 4410);
    const cents = crossingsCents(tail, 440);
    const mean = cents.reduce((a, b) => a + b, 0) / cents.length;
    expect(Math.abs(mean)).toBeLessThan(5);
  });

  test("bloom follows the input: silence stays silent, half is -6 dB", () => {
    const silent = new Float64Array(SR * 3);
    applyBloom(silent, track, values("bloom", { delay: 0.5 }), {
      ...context,
      notes: chord,
    });
    expect(silent.every((v) => v === 0)).toBe(true);
    const full = rms(bloomOf(held(0.5, 3)).subarray(2 * SR));
    const half = rms(bloomOf(held(0.25, 3)).subarray(2 * SR));
    expect(full).toBeGreaterThan(0);
    expect(20 * Math.log10(half / full)).toBeCloseTo(-6.02, 1);
    // Never more than about -6 dB under the input, even at amount 1.
    const loud = bloomOf(held(0.5, 3), { amount: 1, harm: 1 });
    const input = rms(held(0.5, 3).subarray(2 * SR));
    expect(rms(loud.subarray(2 * SR))).toBeLessThan(input * 0.75);
  });

  test("swell ducks a ringing chord at a new onset instead of clicking", () => {
    const x = sine(220, 1.5).map((v) => 0.5 * v);
    applySwell(x, track, values("swell", { time: 0.3 }), {
      ...context,
      notes: [note("a", 0, 1.5, 220), note("b", 0.5, 1, 220)],
    });
    let step = 0;
    for (let i = Math.round(0.45 * SR); i < Math.round(0.6 * SR); i += 1)
      step = Math.max(step, Math.abs(x[i]! - x[i - 1]!));
    expect(step).toBeLessThan(0.02);
    // It still dips to silence and rises again.
    const at = Math.round(0.5 * SR + 0.006 * SR);
    expect(Math.abs(x[at]!)).toBeLessThan(0.02);
    let late = 0;
    for (let i = Math.round(1.3 * SR); i < Math.round(1.4 * SR); i += 1)
      late = Math.max(late, Math.abs(x[i]!));
    expect(late).toBeGreaterThan(0.45);
  });
});

describe("wobble timing", () => {
  test("never moves a note more than 20 ms across the depth/rate range", () => {
    for (const [depth, rate] of [
      [20, 0.5],
      [35, 0.4],
      [60, 0.25],
      [100, 0.05],
    ] as const) {
      // A click every 0.5 s; find where each lands after the wobble.
      const x = new Float64Array(SR * 20);
      const clicks: number[] = [];
      for (let at = SR / 2; at < x.length - SR / 2; at += SR / 2) {
        x[at] = 1;
        clicks.push(at);
      }
      applyWobble(x, track, values("wobble", { depth, rate, drift: 0.5 }), {
        ...context,
      });
      let worst = 0;
      const reach = Math.round(0.1 * SR);
      for (const at of clicks) {
        let best = at;
        for (let i = at - reach; i <= at + reach; i += 1)
          if (Math.abs(x[i]!) > Math.abs(x[best]!)) best = i;
        worst = Math.max(worst, Math.abs(best - at) / SR);
      }
      expect(worst).toBeLessThan(0.02);
    }
  });
});

describe("shaped built-in impulses", () => {
  test("reverse energy rises monotonically to its end", () => {
    const ir = builtinImpulse("reverse", SR)!;
    const win = Math.round(0.05 * SR);
    const energy: number[] = [];
    for (let at = 0; at + win <= ir.left.length; at += win) {
      let e = 0;
      for (let i = at; i < at + win; i += 1)
        e += ir.left[i]! ** 2 + ir.right[i]! ** 2;
      energy.push(e);
    }
    expect(energy.length).toBeGreaterThan(20);
    for (let k = 1; k < energy.length; k += 1)
      expect(energy[k]!).toBeGreaterThan(energy[k - 1]!);
  });

  test("gate is cut hard and spring rings for seconds; all are seeded", () => {
    const gate = builtinImpulse("gate", SR)!;
    expect(gate.left.length).toBe(Math.round(0.45 * SR));
    expect(Math.abs(gate.left[gate.left.length - 1]!)).toBeLessThan(0.01);
    const spring = builtinImpulse("spring", SR)!;
    expect(spring.left.length / SR).toBeCloseTo(2.2, 2);
    expect(spring.left).not.toEqual(spring.right);
    expect(builtinImpulse("spring", 48_000)!.left).toEqual(
      builtinImpulse("spring", 48_000)!.left,
    );
  });

  test("the reverb ir accepts the new names", () => {
    expect(normalizeReverbIr("builtin:reverse")).toEqual({
      src: "builtin:reverse",
    });
    expect(normalizeReverbIr("spring")).toEqual({ src: "builtin:spring" });
  });
});

describe("bloom in a render", () => {
  /** A held E minor on the shoegaze guitar voice through rig `rig`. */
  async function heldChord(
    rig: string,
    volume: number,
    bloom = true,
    wash = false,
  ) {
    const { applyRigPreset, rigReverb } = await import("../../../core/fx.ts");
    const { rigTrackFields } = await import("../../commands/rig.ts");
    const { TrackScore } = await import("../../../core/score.ts");
    const { renderScorePcm } = await import("../wav.ts");
    const voice = rigTrackFields("shoegaze");
    const fx: Record<string, unknown> = { ...applyRigPreset(undefined, rig) };
    if (!bloom) delete fx.bloom;
    const score = new TrackScore({
      version: 2,
      tempoBpm: 120,
      bars: 2,
      beatsPerBar: 4,
      ticksPerBeat: 480,
      tracks: [
        {
          id: "g",
          name: "g",
          instrument: voice.instrument,
          string: voice.string,
          muted: false,
          volume,
          pan: 0,
          fx,
          ...(wash && rigReverb(rig) ? { reverb: rigReverb(rig) } : {}),
        },
      ],
      notes: [52, 59, 64, 67, 71].map((pitch, i) => ({
        id: `n${i}`,
        trackId: "g",
        startTick: 0,
        durationTicks: 3840,
        pitch,
        velocity: 0.8,
      })),
    } as never);
    const pcm = renderScorePcm(score, { sampleRate: 22_050 }).pcm;
    // The held section, after the bloom has grown.
    const from = Math.floor(pcm.length / 2);
    const to = Math.floor(pcm.length * 0.95);
    let sum = 0;
    for (let i = from; i < to; i += 1) sum += pcm[i]! * pcm[i]!;
    return { pcm, rms: Math.sqrt(sum / (to - from)) };
  }

  test("a volume-0 track with bloom renders silence", async () => {
    for (const rig of ["ebow", "shoegaze"]) {
      const { pcm } = await heldChord(rig, 0);
      expect(pcm.every((v) => v === 0)).toBe(true);
    }
  });

  test("the bloom scales with the track's own level", async () => {
    // What bloom adds, relative to the same track without it, is the
    // same at volume 0.25 as at 1: it never drones over a quiet track.
    const ratio = async (volume: number) =>
      (await heldChord("ebow", volume)).rms /
      (await heldChord("ebow", volume, false)).rms;
    const loud = await ratio(1);
    const quiet = await ratio(0.25);
    expect(loud).toBeGreaterThan(1);
    expect(Math.abs(quiet / loud - 1)).toBeLessThan(0.1);
  });

  test("the shoegaze rigs land within 2.5 dB of the clean rig", async () => {
    const level = async (rig: string) => {
      const { pcm } = await heldChord(rig, 0.8, true, true);
      let sum = 0;
      for (const v of pcm) sum += v * v;
      return 10 * Math.log10(sum / pcm.length);
    };
    const reference = await level("clean");
    for (const rig of ["shoegaze", "glide", "swell", "ebow", "dreampop"]) {
      const db = (await level(rig)) - reference;
      if (Math.abs(db) > 2.5) throw new Error(`${rig}: ${db.toFixed(2)} dB`);
    }
  });

  test("whole doubled rigs stay positively correlated (mono-safe)", async () => {
    // Interleaved stereo: L/R correlation of the whole rig, wash included.
    const corr = async (rig: string) => {
      const { pcm } = await heldChord(rig, 0.8, true, true);
      let ab = 0;
      let aa = 0;
      let bb = 0;
      for (let i = 0; i + 1 < pcm.length; i += 2) {
        ab += pcm[i]! * pcm[i + 1]!;
        aa += pcm[i]! * pcm[i]!;
        bb += pcm[i + 1]! * pcm[i + 1]!;
      }
      return ab / Math.sqrt(aa * bb);
    };
    expect(await corr("shoegaze")).toBeGreaterThanOrEqual(0.3);
    expect(await corr("dreampop")).toBeGreaterThan(0.1);
  });
});

describe("cost and legacy", () => {
  test("bloom on a dense 32-bar 16th strum stays linear", () => {
    // 32 bars of 16ths at 120 BPM, six strings per stroke: 3072 notes.
    const sixteenth = 0.125;
    const notes: EffectNote[] = [];
    for (let step = 0; step < 32 * 16; step += 1)
      for (let s = 0; s < 6; s += 1)
        notes.push({
          id: `n${step}.${s}`,
          start: Math.round((step * sixteenth + s * 0.004) * SR),
          length: Math.round(0.9 * SR),
          hz: 82.4 * 2 ** ((s * 5) / 12),
          velocity: 0.8,
        });
    const seconds = 32 * 2;
    const x = new Float64Array(seconds * SR);
    const t0 = performance.now();
    applyBloom(x, track, values("bloom", { delay: 0.1 }), {
      ...context,
      notes,
    });
    const msPerSecond = (performance.now() - t0) / seconds;
    expect(msPerSecond).toBeLessThan(25);
  });

  test("the whole shoegaze rig costs under 25 ms per track-second", async () => {
    const { applyRigPreset } = await import("../../../core/fx.ts");
    const { applyMonoChain } = await import("./chain.ts");
    const fx = applyRigPreset(undefined, "shoegaze")!;
    const rigged = { ...track, fx } as unknown as Track;
    // Warm the JIT on a short buffer first; the budget is the steady cost.
    const notes = [{ id: "a", start: 0, length: SR, hz: 220, velocity: 1 }];
    applyMonoChain(sine(220, 1), rigged, { ...context, notes });
    const x = sine(220, 4);
    const t0 = performance.now();
    applyMonoChain(x, rigged, {
      ...context,
      notes: [{ id: "a", start: 0, length: x.length, hz: 220, velocity: 1 }],
    });
    expect((performance.now() - t0) / 4).toBeLessThan(25);
    expect(x.every(Number.isFinite)).toBe(true);
  });
});
