import { describe, expect, test } from "bun:test";
import {
  createScore,
  type Track,
  type TrackInput,
} from "../../../core/score.ts";
import { applyCrush, applyDistort } from "./drive.ts";
import { applyCompressor, applyTremolo } from "./dynamics.ts";
import {
  applyAutoFilter,
  applyDjFilter,
  applyTrackFilter,
  applyVowel,
} from "./filter.ts";
import { applyChorus, applyLeslie, applyPhaser } from "./modulation.ts";
import { applyDelay, applyReverb } from "./space.ts";
import type { EffectContext } from "./common.ts";

const RATE = 48_000;
const BPM = 120;
const context: EffectContext = {
  sampleRate: RATE,
  tempoBpm: BPM,
  // 480 ticks per beat at 120 bpm → 0.5 s per beat.
  samplesPerTick: (RATE * 0.5) / 480,
};

function track(input: Omit<TrackInput, "id">): Track {
  return createScore({ tracks: [{ id: "t", ...input }] }).tracks[0]!;
}

function sine(hz: number, seconds: number, amplitude = 0.5): Float64Array {
  const out = new Float64Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i += 1)
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

function noise(seconds: number, seed = 1): Float64Array {
  let state = seed >>> 0;
  const out = new Float64Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = (state / 0x1_0000_0000 - 0.5) * 0.5;
  }
  return out;
}

function rms(buffer: Float64Array, from = 0, to = buffer.length): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += buffer[i]! ** 2;
  return Math.sqrt(sum / Math.max(1, to - from));
}

function peak(buffer: Float64Array, from = 0, to = buffer.length): number {
  let max = 0;
  for (let i = from; i < to; i += 1) max = Math.max(max, Math.abs(buffer[i]!));
  return max;
}

const db = (ratio: number) => 20 * Math.log10(ratio);

/** Magnitude of one frequency (Goertzel-style DFT bin) over the buffer. */
function magnitude(buffer: Float64Array, hz: number, from = 0): number {
  let re = 0;
  let im = 0;
  for (let i = from; i < buffer.length; i += 1) {
    const phase = (2 * Math.PI * hz * i) / RATE;
    re += buffer[i]! * Math.cos(phase);
    im -= buffer[i]! * Math.sin(phase);
  }
  return Math.hypot(re, im) / (buffer.length - from);
}

function mono(
  apply: (b: Float64Array, t: Track, v: never, c: EffectContext) => void,
  t: Track,
  name: string,
  input: Float64Array,
): Float64Array {
  const out = input.slice();
  apply(out, t, t.fx![name as keyof typeof t.fx] as never, context);
  return out;
}

describe("filter", () => {
  test("hpf removes low content and keeps highs", () => {
    const t = track({ filter: { cutoff: 1000, resonance: 0, type: "hpf" } });
    const low = sine(60, 0.5);
    const high = sine(5000, 0.5);
    applyTrackFilter(low, t, context);
    applyTrackFilter(high, t, context);
    const skip = RATE / 10;
    expect(db(rms(low, skip) / rms(sine(60, 0.5), skip))).toBeLessThan(-40);
    expect(db(rms(high, skip) / rms(sine(5000, 0.5), skip))).toBeGreaterThan(
      -1,
    );
  });

  test("lpf (legacy data) and bpf keep their bands", () => {
    const lp = track({ filter: { cutoff: 500, resonance: 0 } });
    const bp = track({ filter: { cutoff: 1000, resonance: 0.5, type: "bpf" } });
    const ref = rms(sine(1000, 0.5));
    const at = (t: Track, hz: number) => {
      const b = sine(hz, 0.5);
      applyTrackFilter(b, t, context);
      return db(rms(b, RATE / 10) / ref);
    };
    expect(at(lp, 100)).toBeGreaterThan(-1);
    expect(at(lp, 8000)).toBeLessThan(-30);
    expect(at(bp, 1000)).toBeGreaterThan(-3);
    expect(at(bp, 100)).toBeLessThan(-15);
    expect(at(bp, 10000)).toBeLessThan(-15);
  });

  test("24db slope is steeper than 12db", () => {
    const at = (ftype: "12db" | "24db") => {
      const b = sine(4000, 0.5);
      applyTrackFilter(
        b,
        track({ filter: { cutoff: 1000, resonance: 0, ftype } }),
        context,
      );
      return rms(b, RATE / 10);
    };
    expect(db(at("24db") / at("12db"))).toBeLessThan(-15);
  });

  test("djf: below 0.5 darkens, above 0.5 thins, 0.5 is transparent", () => {
    const run = (value: number, hz: number) => {
      const t = track({ fx: { djf: { value } } });
      const b = mono(applyDjFilter, t, "djf", sine(hz, 0.5));
      return db(rms(b, RATE / 10) / rms(sine(hz, 0.5)));
    };
    expect(Math.abs(run(0.5, 200))).toBeLessThan(0.5);
    expect(run(0.1, 4000)).toBeLessThan(-12);
    expect(run(0.9, 100)).toBeLessThan(-12);
  });

  test("djf 1 is thin, not silent: the high-pass stops at 10 kHz (q08)", () => {
    const run = (value: number, hz: number) => {
      const t = track({ fx: { djf: { value } } });
      const b = mono(applyDjFilter, t, "djf", sine(hz, 0.5));
      return db(rms(b, RATE / 10) / rms(sine(hz, 0.5)));
    };
    // Bright content still passes at the end of the sweep...
    expect(run(1, 14_000)).toBeGreaterThan(-6);
    // ...while the body is gone, and the sweep below the cap is unchanged.
    expect(run(1, 1000)).toBeLessThan(-30);
    expect(run(0.94, 9000)).toBeLessThan(run(1, 14_000));
    // The sweep is monotonic (within the Q 0.8 peak): a higher position never
    // lets noticeably more 2 kHz through.
    let last = Infinity;
    for (let v = 0.5; v <= 1.0001; v += 0.05) {
      const level = run(Math.min(1, v), 2000);
      expect(level).toBeLessThanOrEqual(last + 1);
      last = level;
    }
  });
});

describe("autofilter", () => {
  test("sweeps the cutoff at the synced rate", () => {
    // One cycle per beat (0.5 s), deep sweep on bright noise.
    const t = track({
      fx: { autofilter: { sync: 1, depth: 4, cutoff: 800, shape: "sine" } },
    });
    const out = mono(applyAutoFilter, t, "autofilter", noise(2));
    const windows = Array.from({ length: 40 }, (_, k) =>
      rms(out, k * 2400, (k + 1) * 2400),
    );
    const max = Math.max(...windows);
    const min = Math.min(...windows);
    expect(db(max / min)).toBeGreaterThan(6);
    // Period: the loudest window repeats every 10 windows (0.5 s).
    const first = windows.indexOf(Math.max(...windows.slice(0, 10)));
    const second = windows.indexOf(Math.max(...windows.slice(10, 20)));
    expect(Math.abs(second - first - 10)).toBeLessThanOrEqual(1);
  });

  test("every shape renders finite and differs", () => {
    const outs = (
      ["sine", "tri", "square", "saw", "ramp", "random"] as const
    ).map((shape) => {
      const t = track({ fx: { autofilter: { shape, sync: 0.5 } } });
      const out = mono(applyAutoFilter, t, "autofilter", noise(0.5));
      expect(out.every(Number.isFinite)).toBe(true);
      return rms(out);
    });
    expect(new Set(outs.map((v) => v.toFixed(6))).size).toBe(outs.length);
  });

  test("envelope follow opens the filter on loud input", () => {
    const t = track({
      fx: { autofilter: { depth: 0, follow: 4, cutoff: 300 } },
    });
    const quiet = mono(
      applyAutoFilter,
      t,
      "autofilter",
      noise(0.5).map((v) => v * 0.05),
    );
    const loud = mono(applyAutoFilter, t, "autofilter", noise(0.5));
    // Normalized by input level, the loud input passes more energy.
    expect(rms(loud) / 1).toBeGreaterThan((rms(quiet) / 0.05) * 1.5);
  });
});

describe("drive", () => {
  test("distort adds harmonics with compensated level", () => {
    const input = sine(200, 0.5, 0.3);
    for (const type of [
      "soft",
      "hard",
      "cubic",
      "diode",
      "asym",
      "fold",
      "sinefold",
      "chebyshev",
      "scurve",
    ]) {
      const t = track({ fx: { distort: { drive: 5, type, tone: 20000 } } });
      const out = mono(applyDistort, t, "distort", input);
      const h3 = magnitude(out, 600, 4800) + magnitude(out, 400, 4800);
      const ref = magnitude(input, 600, 4800) + magnitude(input, 400, 4800);
      expect(h3).toBeGreaterThan(ref + 0.005);
      expect(Math.abs(db(rms(out) / rms(input)))).toBeLessThan(3);
    }
  });

  test("distort mix 0 is transparent", () => {
    const input = sine(200, 0.2);
    const t = track({ fx: { distort: { drive: 8, mix: 0 } } });
    const out = mono(applyDistort, t, "distort", input);
    expect(peak(out.map((v, i) => v - input[i]!))).toBeLessThan(1e-12);
  });

  test("crush quantizes to 2^bits levels and coarse holds samples", () => {
    const input = sine(100, 0.2, 0.9);
    const t = track({ fx: { crush: { bits: 3, coarse: 4 } } });
    const out = mono(applyCrush, t, "crush", input);
    expect(
      new Set(Array.from(out, (v) => v.toFixed(9))).size,
    ).toBeLessThanOrEqual(9);
    let held = 0;
    for (let i = 1; i < out.length; i += 1)
      if (out[i] === out[i - 1]) held += 1;
    expect(held / out.length).toBeGreaterThan(0.7);
  });
});

describe("dynamics", () => {
  test("tremolo modulates RMS at its rate", () => {
    // 4 Hz free-running, full depth.
    const t = track({
      fx: { tremolo: { sync: 0, rate: 4, depth: 1, shape: "sine" } },
    });
    const out = mono(applyTremolo, t, "tremolo", sine(1000, 1));
    const win = RATE / 40; // 25 ms
    const env = Array.from({ length: 40 }, (_, k) =>
      rms(out, k * win, (k + 1) * win),
    );
    expect(db(Math.max(...env) / Math.min(...env))).toBeGreaterThan(20);
    // Count dips: 4 per second.
    let dips = 0;
    for (let k = 1; k < env.length - 1; k += 1)
      if (env[k]! < env[k - 1]! && env[k]! <= env[k + 1]! && env[k]! < 0.1)
        dips += 1;
    expect(dips).toBe(4);
  });

  test("tremolo depth 0 is transparent", () => {
    const input = sine(300, 0.2);
    const t = track({ fx: { tremolo: { depth: 0 } } });
    const out = mono(applyTremolo, t, "tremolo", input);
    expect(peak(out.map((v, i) => v - input[i]!))).toBeLessThan(1e-12);
  });

  test("compressor narrows the loud/quiet range", () => {
    const input = new Float64Array(RATE);
    for (let i = 0; i < RATE; i += 1)
      input[i] =
        (i < RATE / 2 ? 0.9 : 0.05) * Math.sin((2 * Math.PI * 220 * i) / RATE);
    const t = track({
      fx: { compressor: { threshold: -24, ratio: 8, makeup: 0 } },
    });
    const out = mono(applyCompressor, t, "compressor", input);
    const before = db(rms(input, 4800, 24000) / rms(input, 28800, 48000));
    const after = db(rms(out, 4800, 24000) / rms(out, 28800, 48000));
    expect(before - after).toBeGreaterThan(10);
    expect(peak(out, 4800, 24000)).toBeLessThan(peak(input, 4800, 24000));
  });
});

describe("modulation", () => {
  const stereo = (seconds: number) =>
    [sine(440, seconds), sine(440, seconds)] as const;

  test("chorus mixes in a moving copy and widens the image", () => {
    const [l, r] = stereo(1);
    const t = track({ fx: { chorus: {} } });
    applyChorus(l, r, t, t.fx!.chorus!, context);
    expect(l.every(Number.isFinite)).toBe(true);
    let diff = 0;
    for (let i = 0; i < l.length; i += 1) diff += (l[i]! - r[i]!) ** 2;
    expect(Math.sqrt(diff / l.length)).toBeGreaterThan(0.01);
    expect(Math.abs(db(rms(l) / rms(sine(440, 1))))).toBeLessThan(6);
  });

  test("phaser notches move over time", () => {
    const n = noise(1);
    const l = n.slice();
    const r = n.slice();
    const t = track({ fx: { phaser: { rate: 2, depth: 1 } } });
    applyPhaser(l, r, t, t.fx!.phaser!, context);
    const a = magnitude(l, 1000, 0);
    const windows = [0, 1, 2, 3].map((k) => {
      const w = l.slice(k * 12000, (k + 1) * 12000);
      return magnitude(w, 1000);
    });
    expect(Number.isFinite(a)).toBe(true);
    expect(Math.max(...windows) / Math.min(...windows)).toBeGreaterThan(1.3);
  });

  test("leslie modulates amplitude and pitch", () => {
    const [l, r] = stereo(1);
    const t = track({ fx: { leslie: {} } });
    applyLeslie(l, r, t, t.fx!.leslie!, context);
    const env = Array.from({ length: 50 }, (_, k) =>
      rms(l, k * 960, (k + 1) * 960),
    );
    expect(db(Math.max(...env) / Math.min(...env))).toBeGreaterThan(1);
  });

  test("vowel formants differ by vowel", () => {
    const n = noise(0.5);
    const a = mono(
      applyVowel,
      track({ fx: { vowel: { vowel: "a" } } }),
      "vowel",
      n,
    );
    const i = mono(
      applyVowel,
      track({ fx: { vowel: { vowel: "i" } } }),
      "vowel",
      n,
    );
    // "i" has a high second formant (~2.2 kHz) and a low first one.
    expect(magnitude(i, 2300) / magnitude(i, 700)).toBeGreaterThan(
      magnitude(a, 2300) / magnitude(a, 700),
    );
  });
});

describe("space", () => {
  test("ping-pong delay alternates channels", () => {
    // 1/8 note at 120 bpm = 0.25 s; impulse at 0.
    const t = track({
      delay: { beats: 0.5, feedback: 0.5, mix: 1, pingpong: true },
    });
    const l = new Float64Array(RATE * 2);
    const r = new Float64Array(RATE * 2);
    l[0] = 1;
    r[0] = 1;
    applyDelay(l, r, t, context);
    const echo = (k: number) => {
      const at = k * 12000;
      return [peak(l, at - 10, at + 10), peak(r, at - 10, at + 10)] as const;
    };
    const [l1, r1] = echo(1);
    const [l2, r2] = echo(2);
    const [l3, r3] = echo(3);
    expect(l1).toBeGreaterThan(0.5);
    expect(r1).toBeLessThan(1e-9);
    expect(r2).toBeGreaterThan(0.2);
    expect(l2).toBeLessThan(1e-9);
    expect(l3).toBeGreaterThan(0.1);
    expect(r3).toBeLessThan(1e-9);
  });

  test("delay highcut darkens each repeat", () => {
    const run = (highcut?: number) => {
      const t = track({
        delay: {
          beats: 0.5,
          feedback: 0.6,
          mix: 1,
          ...(highcut ? { highcut } : {}),
        },
      });
      const l = noise(0.05).slice();
      const left = new Float64Array(RATE * 2);
      left.set(l);
      const right = left.slice();
      applyDelay(left, right, t, context);
      return magnitude(left.slice(36000, 38400), 8000);
    };
    expect(run(2000)).toBeLessThan(run() * 0.5);
  });

  test("reverb leaves a tail; predelay holds it back; fade lengthens it", () => {
    const run = (reverb: TrackInput["reverb"]) => {
      const t = track({ reverb });
      const l = new Float64Array(RATE * 3);
      const r = new Float64Array(RATE * 3);
      l[0] = 1;
      r[0] = 1;
      applyReverb(l, r, t, context);
      return l;
    };
    const plain = run({ mix: 0.5, size: 0.5 });
    expect(rms(plain, 4800, 24000)).toBeGreaterThan(1e-4);
    const delayed = run({ mix: 0.5, size: 0.5, predelay: 0.1 });
    expect(peak(delayed, 1, 4000)).toBeLessThan(peak(plain, 1, 4000) * 0.1);
    const short = run({ mix: 0.5, size: 0.5, fade: 0.5 });
    const long = run({ mix: 0.5, size: 0.5, fade: 4 });
    expect(rms(long, RATE, 2 * RATE)).toBeGreaterThan(
      rms(short, RATE, 2 * RATE) * 10,
    );
  });
});

describe("determinism", () => {
  test("every effect renders the same bytes twice", () => {
    const t = track({
      filter: { cutoff: 1500, resonance: 0.4, type: "bpf", ftype: "ladder" },
      fx: {
        djf: { value: 0.3 },
        autofilter: { shape: "random" },
        vowel: {},
        crush: {},
        distort: {},
        tremolo: {},
        compressor: {},
        phaser: {},
        chorus: {},
        leslie: {},
        postgain: {},
      },
    });
    const run = () => {
      const m = noise(0.3);
      applyTrackFilter(m, t, context);
      for (const [name, apply] of [
        ["djf", applyDjFilter],
        ["autofilter", applyAutoFilter],
        ["vowel", applyVowel],
        ["crush", applyCrush],
        ["distort", applyDistort],
        ["tremolo", applyTremolo],
        ["compressor", applyCompressor],
      ] as const)
        apply(m, t, t.fx![name]!, context);
      const r = m.slice();
      applyPhaser(m, r, t, t.fx!.phaser!, context);
      applyChorus(m, r, t, t.fx!.chorus!, context);
      applyLeslie(m, r, t, t.fx!.leslie!, context);
      return [m, r];
    };
    const [a, b] = run();
    const [c, d] = run();
    expect(a!.every(Number.isFinite)).toBe(true);
    expect(Buffer.from(a!.buffer).equals(Buffer.from(c!.buffer))).toBe(true);
    expect(Buffer.from(b!.buffer).equals(Buffer.from(d!.buffer))).toBe(true);
  });
});
