import { describe, expect, test } from "bun:test";
import type { PerformedNote } from "../../../core/expression.ts";
import { resolvedKeys, type ElectricFamily } from "../../../core/keys.ts";
import { createScore, type TrackScore } from "../../../core/score.ts";
import { fftInPlace } from "../dsp/fft.ts";
import { engineFor } from "../instruments.ts";
import { Biquad2 } from "./dsp.ts";
import { ClavVoice, clavPositions, TineVoice } from "./electric.ts";
import { electricParamsAt, renderKeysTrack } from "./engine.ts";

const SR = 44100;

function song(
  instrument: string,
  keys: Record<string, number | string>,
  notes: { pitch: number; start?: number; dur?: number; vel?: number }[],
  id = "e",
  bars = 2,
): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars,
    tracks: [{ id, name: id, instrument, keys }],
    notes: notes.map((n, i) => ({
      id: `n${i}`,
      trackId: id,
      pitch: n.pitch,
      startTick: n.start ?? 0,
      durationTicks: n.dur ?? 96,
      velocity: n.vel ?? 0.8,
    })),
  } as Parameters<typeof createScore>[0]);
}

function render(s: TrackScore, seconds: number): [Float64Array, Float64Array] {
  const left = new Float64Array(Math.round(seconds * SR));
  const right = new Float64Array(left.length);
  renderKeysTrack(left, right, s.notes as PerformedNote[], s.tracks[0]!, {
    score: s,
    sampleRate: SR,
    samples: left.length,
    samplesPerTick: (SR * 60) / (s.tempoBpm * s.ticksPerBeat),
    tempoBpm: s.tempoBpm,
    ticksPerBeat: s.ticksPerBeat,
  });
  return [left, right];
}

function spectrum(signal: Float64Array, from: number, n: number): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const length = Math.min(n, signal.length - from);
  for (let i = 0; i < length; i += 1)
    re[i] =
      signal[from + i]! *
      (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1)));
  fftInPlace(re, im);
  const mag = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k += 1) mag[k] = Math.hypot(re[k]!, im[k]!);
  return mag;
}

function peakNear(signal: Float64Array, hz: number, from = 0): number {
  const n = 1 << 18;
  const mag = spectrum(signal, from, n);
  const lo = Math.floor(((hz * 0.97) / SR) * n);
  const hi = Math.ceil(((hz * 1.03) / SR) * n);
  let best = lo;
  for (let k = lo; k <= hi; k += 1) if (mag[k]! > mag[best]!) best = k;
  const a = Math.log(mag[best - 1]!);
  const b = Math.log(mag[best]!);
  const c = Math.log(mag[best + 1]!);
  return ((best + (0.5 * (a - c)) / (a - 2 * b + c)) * SR) / n;
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
const hzOf = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);

function params(kind: ElectricFamily, keys: Record<string, number | string>) {
  const s = song(kind, keys, []);
  const track = s.tracks[0]!;
  return electricParamsAt(track, resolvedKeys(kind, track.keys), 0, kind);
}

describe("electric keys: registry and pitch", () => {
  test("epiano, wurli and clav have engines on Track.keys", () => {
    for (const kind of ["epiano", "wurli", "clav"]) {
      const s = song(kind, {}, []);
      expect(engineFor(s.tracks[0]!)?.id).toBe(kind);
    }
    // Without keys the instrument id alone plays no engine.
    const bare = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [{ id: "x", name: "x", instrument: "epiano" }],
      notes: [],
    } as Parameters<typeof createScore>[0]);
    expect(engineFor(bare.tracks[0]!)).toBeUndefined();
  });

  for (const kind of ["epiano", "wurli", "clav"] as const)
    test(`${kind} key 84 is within 1 cent of its pitch`, () => {
      const [left, right] = render(
        song(kind, {}, [{ pitch: 84, dur: 480 * 4 }]),
        3,
      );
      const mono = left.map((x, i) => x + right[i]!);
      expect(
        Math.abs(cents(peakNear(mono, hzOf(84), 2205), hzOf(84))),
      ).toBeLessThan(1);
    });

  test("renders are deterministic and finite", () => {
    for (const kind of ["epiano", "wurli", "clav"]) {
      const s = song(kind, {}, [
        { pitch: 48 },
        { pitch: 60, start: 48, vel: 1 },
        { pitch: 72, start: 96, vel: 0.3 },
      ]);
      const [a] = render(s, 2);
      const [b] = render(s, 2);
      expect(a).toEqual(b);
      let peak = 0;
      for (const x of a) peak = Math.max(peak, Math.abs(x));
      expect(Number.isFinite(peak)).toBe(true);
      expect(peak).toBeGreaterThan(0.01);
      expect(peak).toBeLessThan(2);
    }
  });
});

describe("electric keys: character", () => {
  test("suitcase vibe: L/R envelopes are anticorrelated (<= -0.9)", () => {
    const s = song("epiano", { preset: "suitcase" }, [
      { pitch: 60, dur: 480 * 8 },
    ]);
    const [left, right] = render(s, 4);
    // RMS envelopes over 10 ms frames from 0.5 s to 3.5 s, detrended by a
    // 250 ms moving average (the note's own decay is common to both sides).
    const frame = Math.round(0.01 * SR);
    const env = (x: Float64Array) => {
      const out: number[] = [];
      for (let i = Math.round(0.5 * SR); i + frame < 3.5 * SR; i += frame) {
        let sum = 0;
        for (let j = i; j < i + frame; j += 1) sum += x[j]! * x[j]!;
        out.push(Math.sqrt(sum / frame));
      }
      return out;
    };
    const detrend = (x: number[]) =>
      x.map((v, i) => {
        let sum = 0;
        let count = 0;
        for (
          let j = Math.max(0, i - 12);
          j <= Math.min(x.length - 1, i + 12);
          j += 1
        ) {
          sum += x[j]!;
          count += 1;
        }
        return v / (sum / count) - 1;
      });
    const l = detrend(env(left));
    const r = detrend(env(right));
    let lr = 0;
    let ll = 0;
    let rr = 0;
    for (let i = 0; i < l.length; i += 1) {
      lr += l[i]! * r[i]!;
      ll += l[i]! * l[i]!;
      rr += r[i]! * r[i]!;
    }
    expect(lr / Math.sqrt(ll * rr)).toBeLessThanOrEqual(-0.9);
  });

  test("vibe 0 leaves the epiano's channels moving together", () => {
    const [left, right] = render(
      song("epiano", {}, [{ pitch: 60, dur: 480 * 4 }]),
      2,
    );
    // Key 60 sits at the centre of the keyboard spread: equal channels.
    for (let i = 0; i < left.length; i += 997)
      expect(left[i]!).toBeCloseTo(right[i]!, 12);
  });

  test("wurli trem modulates the level at 5.6 Hz", () => {
    const flat = render(song("wurli", {}, [{ pitch: 60, dur: 480 * 4 }]), 2)[0];
    const trem = render(
      song("wurli", { trem: 1 }, [{ pitch: 60, dur: 480 * 4 }]),
      2,
    )[0];
    // The ratio of the two (same voice) is the tremolo gain.
    const frame = Math.round(0.005 * SR);
    let lo = Infinity;
    let hi = 0;
    for (let i = Math.round(0.3 * SR); i + frame < 1.5 * SR; i += frame) {
      let a = 0;
      let b = 0;
      for (let j = i; j < i + frame; j += 1) {
        a += flat[j]! ** 2;
        b += trem[j]! ** 2;
      }
      const g = Math.sqrt(b / a);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    expect(hi).toBeGreaterThan(0.95);
    expect(lo).toBeLessThan(0.1);
  });

  test("clav pickups differ per track seed; out is thinner than both", () => {
    expect(clavPositions(1)).not.toEqual(clavPositions(2));
    const a = render(song("clav", {}, [{ pitch: 48, dur: 480 }], "a"), 1)[0];
    const b = render(song("clav", {}, [{ pitch: 48, dur: 480 }], "b"), 1)[0];
    expect(a).not.toEqual(b);
    const both = render(song("clav", {}, [{ pitch: 48, dur: 480 }]), 1)[0];
    const out = render(
      song("clav", { pickup: "out" }, [{ pitch: 48, dur: 480 }]),
      1,
    )[0];
    // Fundamental share of the energy: out of phase cancels the low modes.
    const share = (x: Float64Array) => {
      const mag = spectrum(x, 441, 1 << 15);
      const bin = Math.round((hzOf(48) / SR) * (1 << 15));
      let total = 0;
      for (const m of mag) total += m * m;
      let low = 0;
      for (let k = bin - 3; k <= bin + 3; k += 1) low += mag[k]! ** 2;
      return low / total;
    };
    expect(share(out)).toBeLessThan(share(both));
  });

  test("clav release: the yarn damper stops a note within 0.3 s", () => {
    const [left] = render(song("clav", {}, [{ pitch: 48, dur: 48 }]), 1.5);
    const rms = (from: number, to: number) => {
      let sum = 0;
      for (let i = Math.round(from * SR); i < Math.round(to * SR); i += 1)
        sum += left[i]! ** 2;
      return Math.sqrt(sum / ((to - from) * SR));
    };
    // The note is 0.25 s; 0.3 s later it is 60 dB under its start.
    expect(20 * Math.log10(rms(0.55, 0.6) / rms(0.02, 0.07))).toBeLessThan(-60);
  });
});

describe("electric keys: levels", () => {
  const peakDb = ([left, right]: [Float64Array, Float64Array]) => {
    let top = 0;
    for (const channel of [left, right])
      for (const x of channel) top = Math.max(top, Math.abs(x));
    return 20 * Math.log10(top);
  };

  test("a C-major triad at velocity 0.8 peaks between -8 and -4 dBFS", () => {
    for (const [instrument, preset] of [
      ["epiano", "epiano"],
      ["epiano", "suitcase"],
      ["epiano", "dyno"],
      ["wurli", "wurli"],
      ["clav", "clav"],
      ["clav", "funkclav"],
    ] as const) {
      const db = peakDb(
        render(
          song(
            instrument,
            { preset },
            [60, 64, 67].map((pitch) => ({ pitch, dur: 480, vel: 0.8 })),
          ),
          1.5,
        ),
      );
      expect({ preset, ok: db > -8 && db < -4 }).toEqual({ preset, ok: true });
    }
  });

  test("clav pickups peak within 1.5 dB of each other at C3", () => {
    const levels = (["neck", "bridge", "both", "out"] as const).map((pickup) =>
      peakDb(
        render(
          song("clav", { pickup }, [{ pitch: 48, dur: 480, vel: 0.8 }]),
          1.5,
        ),
      ),
    );
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(1.5);
  });
});

describe("electric keys: alias and cost", () => {
  test("a hard-driven tine (bark 1, velocity 1, key 96) aliases < -50 dB", () => {
    const p = params("epiano", { bark: 1, bell: 0, tone: 0 });
    const f = hzOf(96);
    const voice = new TineVoice(
      { pitch: 96, hz: f, velocity: 1, trackSeed: 1, noteSeed: "alias" },
      p,
      SR,
    );
    const out = new Float64Array(SR);
    voice.process(out, 0, out.length);
    const n = 1 << 14;
    const mag = spectrum(out, 2205, n);
    let peak = 0;
    let alias = 0;
    for (let k = 4; k < n / 2; k += 1) {
      const hz = (k * SR) / n;
      peak = Math.max(peak, mag[k]!);
      // Away from every harmonic of f (and the tone bar beside it).
      const h = hz / f;
      if (Math.abs(h - Math.round(h)) * f > 60 && hz > 200)
        alias = Math.max(alias, mag[k]!);
    }
    expect(20 * Math.log10(alias / peak)).toBeLessThan(-50);
  });

  const time = (fn: () => void) => {
    fn();
    let best = Infinity;
    for (let i = 0; i < 7; i += 1) {
      const t0 = performance.now();
      fn();
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };
  const sawCost = (rate: number, out: Float64Array) =>
    time(() => {
      const f = new Biquad2().set("lpf", 4000, 0.7, 0, rate);
      const dt = 55 / rate;
      let phase = 0;
      let env = 0;
      for (let i = 0; i < out.length; i += 1) {
        phase += dt;
        if (phase >= 1) phase -= 1;
        let y = 2 * phase - 1;
        if (phase < dt) {
          const t = phase / dt;
          y -= t + t - t * t - 1;
        } else if (phase > 1 - dt) {
          const t = (phase - 1) / dt;
          y -= t * t + t + t + 1;
        }
        env += (0.8 - env) * 0.003;
        out[i] = f.process(y) * env * 0.3;
      }
    });

  test("cost: epiano <= 15x and wurli <= 28x a saw voice", () => {
    // keys.review.md: costs as a ratio to a polyBLEP saw voice in the same
    // process, a voice-second at 22.05 kHz.
    const rate = 22050;
    const out = new Float64Array(rate);
    const saw = sawCost(rate, out);
    const voiceCost = (kind: "epiano" | "wurli") => {
      const p = params(kind, {});
      return time(() => {
        const voice = new TineVoice(
          { pitch: 45, hz: 110, velocity: 0.8, trackSeed: 1, noteSeed: "c" },
          p,
          rate,
        );
        out.fill(0);
        voice.process(out, 0, rate);
      });
    };
    expect(voiceCost("epiano")).toBeLessThanOrEqual(15 * saw);
    expect(voiceCost("wurli")).toBeLessThanOrEqual(28 * saw);
    const clav = params("clav", {});
    const clavCost = time(() => {
      const voice = new ClavVoice(
        { pitch: 33, hz: 55, velocity: 0.8, trackSeed: 1, noteSeed: "c" },
        clav,
        rate,
      );
      out.fill(0);
      voice.process(out, 0, rate);
    });
    expect(clavCost).toBeLessThanOrEqual(16 * saw);
  });
});
