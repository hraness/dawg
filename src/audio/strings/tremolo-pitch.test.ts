/**
 * q08: tremolo bowing reverses the bow; it must not move the pitch. A
 * frame-wise autocorrelation pitch (30 ms frames, 0.6 to 1.6 s) of one
 * string with `tremhz` 13 stays near the plain bow's 0 cents through the
 * cello's range, and so does the `trem` preset.
 */
import { describe, expect, test } from "bun:test";
import { resolveString } from "../../../core/strings.ts";
import { BowedString, type BowSpec } from "./bow.ts";

const SR = 44_100;

function specOf(preset: string, tremhz?: number): BowSpec {
  const v = resolveString({ preset }) as unknown as Record<string, number>;
  return {
    decay: v.ring!,
    track: v.track!,
    damp: v.damp!,
    pos: v.pos!,
    pressure: v.pressure!,
    speed: v.speed!,
    attack: v.attack!,
    release: v.release!,
    tremhz: tremhz ?? v.tremhz!,
    sord: v.sord!,
  };
}

function play(spec: BowSpec, hz: number, seed: number): Float64Array {
  const voice = new BowedString(spec, { hz, velocity: 0.8, hold: 2, seed }, SR);
  const x = new Float64Array(2 * SR);
  for (let at = 0; at < x.length; at += 128)
    voice.process(x, at, Math.min(128, x.length - at));
  return x;
}

/** Cents from `hz` of the autocorrelation peak near its period. */
function acfCents(x: Float64Array, start: number, n: number, hz: number) {
  const T = SR / hz;
  const lo = Math.floor(T * 0.94);
  const hi = Math.ceil(T * 1.06);
  const r = (lag: number) => {
    let s = 0;
    let e0 = 0;
    let e1 = 0;
    for (let i = 0; i < n; i += 1) {
      const a = x[start + i]!;
      const b = x[start + i + lag]!;
      s += a * b;
      e0 += a * a;
      e1 += b * b;
    }
    return s / Math.sqrt(e0 * e1 + 1e-30);
  };
  let best = lo;
  let bv = -Infinity;
  const vals: number[] = [];
  for (let lag = lo - 1; lag <= hi + 1; lag += 1) vals.push(r(lag));
  for (let lag = lo; lag <= hi; lag += 1) {
    const v = vals[lag - lo + 1]!;
    if (v > bv) {
      bv = v;
      best = lag;
    }
  }
  const a = vals[best - lo]!;
  const b = vals[best - lo + 1]!;
  const c = vals[best - lo + 2]!;
  const d = a - 2 * b + c;
  const period = best + (d !== 0 ? (0.5 * (a - c)) / d : 0);
  return 1200 * Math.log2(T / period);
}

function pitchStats(x: Float64Array, hz: number) {
  const frame = Math.round(0.03 * SR);
  const c: number[] = [];
  for (let t = 0.6; t < 1.6; t += 0.01)
    c.push(acfCents(x, Math.round(t * SR), frame, hz));
  c.sort((a, b) => a - b);
  const q = (p: number) => c[Math.floor(c.length * p)]!;
  return { median: q(0.5), spread: q(0.9) - q(0.1) };
}

const PITCHES = [36, 40, 45, 48, 52, 57, 64, 69, 76];
const hzOf = (p: number) => 440 * 2 ** ((p - 69) / 12);

describe("bowed tremolo keeps its pitch (q08)", () => {
  for (const [preset, tremhz] of [
    ["cello", 13],
    ["trem", undefined],
  ] as const) {
    test(`${preset}${tremhz ? ` tremhz ${tremhz}` : ""}: median within 8 cents, spread under 25`, () => {
      const out: string[] = [];
      for (const p of PITCHES) {
        const { median, spread } = pitchStats(
          play(specOf(preset, tremhz), hzOf(p), 1),
          hzOf(p),
        );
        if (Math.abs(median) > 8 || spread > 25)
          out.push(`${p}: ${median.toFixed(1)} c, spread ${spread.toFixed(1)}`);
      }
      expect(out).toEqual([]);
    });
  }

  test("the plain bow is untouched: tremhz 0 still reads 0 cents", () => {
    for (const p of [36, 48, 64]) {
      const { median } = pitchStats(
        play(specOf("cello", 0), hzOf(p), 1),
        hzOf(p),
      );
      expect(Math.abs(median)).toBeLessThan(1);
    }
  });
});
