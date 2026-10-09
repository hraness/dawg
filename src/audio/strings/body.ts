/**
 * Per-track string bodies and sympathetic strings (0.6 strings prototype,
 * proto/strings/strings.ts). A body is a direct path plus a bank of 0 dB
 * band-pass modes, run once per track over the summed strings; `size`
 * scales the body (mode frequencies x 1/size). Sympathetic strings are
 * one-way coupled loops tuned to the song key, open strings or a drone.
 */
import { thiranFor } from "../dsp/interp.ts";
import { C4 } from "./pluck.ts";
import { designLoss, onePoleDelay } from "./loop.ts";

/** [frequency Hz, Q, gain] */
export type BodyMode = readonly [number, number, number];
export type Body = Readonly<{ direct: number; modes: readonly BodyMode[] }>;

export const BODIES: Readonly<Record<string, Body>> = Object.freeze({
  none: { direct: 1, modes: [] },
  guitar: {
    direct: 0.55,
    modes: [
      [98, 10, 1.2],
      [204, 14, 0.9],
      [390, 18, 0.5],
      [560, 20, 0.35],
      [960, 12, 0.3],
      [2300, 5, 0.35],
    ],
  },
  steel: {
    direct: 0.6,
    modes: [
      [110, 10, 1.0],
      [220, 14, 0.9],
      [420, 16, 0.6],
      [700, 14, 0.4],
      [1600, 6, 0.4],
      [3200, 4, 0.3],
    ],
  },
  small: {
    direct: 0.6,
    modes: [
      [140, 10, 1.0],
      [270, 14, 0.8],
      [520, 16, 0.5],
      [900, 12, 0.4],
      [2200, 5, 0.35],
      [3600, 4, 0.3],
    ],
  },
  bowl: {
    direct: 0.55,
    modes: [
      [120, 10, 1.0],
      [250, 12, 0.8],
      [480, 14, 0.5],
      [900, 10, 0.35],
      [1800, 6, 0.3],
    ],
  },
  gourd: {
    direct: 0.5,
    modes: [
      [180, 8, 0.9],
      [360, 10, 0.5],
      [720, 8, 0.4],
      [1500, 5, 0.35],
      [3000, 4, 0.3],
    ],
  },
  skin: {
    direct: 0.45,
    modes: [
      [300, 6, 1.2],
      [650, 6, 0.8],
      [1300, 5, 0.6],
      [2600, 4, 0.5],
    ],
  },
  board: {
    direct: 0.6,
    modes: [
      [95, 6, 0.8],
      [180, 8, 0.7],
      [350, 8, 0.6],
      [700, 8, 0.45],
      [1400, 6, 0.35],
      [2800, 5, 0.25],
    ],
  },
  violin: {
    direct: 0.3,
    modes: [
      [275, 14, 1.0],
      [460, 18, 0.9],
      [540, 18, 1.1],
      [700, 12, 0.5],
      [1100, 8, 0.4],
      [2500, 3, 0.9],
      [3400, 4, 0.4],
    ],
  },
});

/**
 * The body for a name and size: modes x 1/size. `bass` is the violin body
 * at 0.3 (a double bass is about 3.3 times the size).
 */
export function bodyFor(name: string, size: number): Body {
  const base =
    name === "bass" ? BODIES.violin! : (BODIES[name] ?? BODIES.none!);
  const k = (name === "bass" ? 0.3 : 1) / Math.max(0.05, size);
  if (k === 1) return base;
  return {
    direct: base.direct,
    modes: base.modes.map(([f, q, g]) => [f * k, q, g] as const),
  };
}

/** Body over `x` in place: direct + modes, then a 10 Hz DC blocker. */
export function applyBody(x: Float64Array, body: Body, sr: number): void {
  if (body.modes.length === 0 && body.direct === 1) return;
  const input = Float64Array.from(x);
  for (let i = 0; i < x.length; i += 1) x[i] = body.direct * input[i]!;
  for (const [f, q, g] of body.modes) {
    if (f >= 0.45 * sr) continue;
    const w = (2 * Math.PI * f) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = alpha / a0;
    const b2 = -alpha / a0;
    const a1 = (-2 * Math.cos(w)) / a0;
    const a2 = (1 - alpha) / a0;
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < x.length; i += 1) {
      const xi = input[i]!;
      const y = b0 * xi + z1;
      z1 = -a1 * y + z2;
      z2 = b2 * xi - a2 * y;
      x[i] = x[i]! + g * y;
    }
  }
  const R = Math.exp((-2 * Math.PI * 10) / sr);
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const xi = x[i]!;
    const y = xi - x1 + R * y1;
    x1 = xi;
    y1 = y;
    x[i] = y;
  }
}

export type SymTune = "scale" | "open" | "drone";

/** A sympathetic string: a MIDI key plus cents (quarter tones). */
export interface SymKey {
  key: number;
  cents: number;
}

/**
 * Sympathetic string keys per tuning mode. `steps` is the song key's scale
 * in semitones above the tonic (fractional for quarter tones). `scale`
 * tunes up to 13 strings to it; `drone` is Sa-Pa-Sa, or Sa-Ma-Sa (else
 * Sa-Ni-Sa) when the scale has no Pa; `open` is guitar EADGBE.
 */
export function symKeys(
  mode: string,
  root: number,
  steps: readonly number[],
): SymKey[] {
  const at = (step: number): SymKey => {
    const whole = Math.round(step);
    return { key: root + whole, cents: Math.round((step - whole) * 1000) / 10 };
  };
  if (mode === "open")
    return [40, 45, 50, 55, 59, 64].map((key) => ({ key, cents: 0 }));
  if (mode === "drone") {
    const has = (n: number) => steps.some((s) => Math.abs(s - n) < 0.01);
    const second = has(7)
      ? at(-5)
      : has(5)
        ? at(-7)
        : has(6)
          ? at(-6)
          : has(11)
            ? at(-1)
            : at(-5);
    return [at(-12), second, at(0)];
  }
  const sorted = [...steps]
    .map((s) => ((s % 12) + 12) % 12)
    .sort((a, b) => a - b);
  const keys: SymKey[] = [];
  for (let octave = 0; octave <= 12 && keys.length < 13; octave += 12)
    for (const step of sorted)
      if (step + octave <= 19 && keys.length < 13) keys.push(at(step + octave));
  return keys;
}

/**
 * Sympathetic strings: one-way coupled loops excited by `x`; returns only
 * what they add (the coupled input is subtracted back out).
 */
export function sympathetic(
  x: Float64Array,
  hzs: readonly number[],
  couple: number,
  decay: number,
  damp: number,
  sr: number,
): Float64Array {
  const out = new Float64Array(x.length);
  for (const hz of hzs) {
    if (!(hz > 20) || hz > 0.4 * sr) continue;
    const t0 = decay * (hz / C4) ** -0.3;
    const { g, p } = designLoss(
      hz,
      t0,
      Math.max(3000, 3 * hz),
      t0 / (1 + 99 * damp * damp),
      sr,
    );
    const w0 = (2 * Math.PI * hz) / sr;
    const rest = sr / hz - onePoleDelay(p, w0);
    const N = Math.max(1, Math.floor(rest - 0.5));
    const a = thiranFor(rest - N, w0);
    let size = 16;
    while (size < N + 4) size <<= 1;
    const buf = new Float64Array(size);
    const m = size - 1;
    let tx = 0;
    let ty = 0;
    let ly = 0;
    const lgain = g * (1 - p);
    for (let i = 0; i < x.length; i += 1) {
      const d = buf[(i - N) & m]!;
      const t = a * d + tx - a * ty;
      tx = d;
      ty = t;
      ly = lgain * t + p * ly;
      buf[i & m] = couple * x[i]! + ly;
      out[i] = out[i]! + ly;
    }
  }
  return out;
}
