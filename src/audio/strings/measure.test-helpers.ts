/**
 * Measurement helpers for the string engine's tests (ported from the 0.6
 * design prototype): FFT pitch with parabolic interpolation, a partial's
 * T60 by regression and the spectral centroid.
 */
import { createScore, type Track } from "../../../core/score.ts";
import type { PerformedNote } from "../../../core/expression.ts";
import type { TuningTable } from "../../../core/tuning.ts";
import { fft } from "../wavetable.ts";
import type { EngineContext } from "../instruments.ts";
import { renderStrings } from "./engine.ts";

/** 12-TET Hz of a MIDI key. */
export const tetHz = (pitch: number): number => 440 * 2 ** ((pitch - 69) / 12);

export const SR = 22050;
const TPB = 480;
const BPM = 120;
const SPT = (SR * 60) / (BPM * TPB);

export type TestNote = {
  pitch: number;
  start?: number;
  seconds?: number;
  velocity?: number;
  performance?: PerformedNote["performance"];
  articulation?: PerformedNote["articulation"];
};

/** Renders notes on a string track (mono, before effects). */
export function render(
  string: Record<string, number | string>,
  notes: readonly TestNote[],
  seconds: number,
  tuning?: TuningTable,
): Float64Array {
  const track = {
    id: "s",
    name: "s",
    instrument: "string",
    volume: 1,
    string,
  } as unknown as Track;
  const samples = Math.round(seconds * SR);
  const context: EngineContext = {
    score: createScore({ bars: 1, tracks: [] }),
    sampleRate: SR,
    samples,
    samplesPerTick: SPT,
    tempoBpm: BPM,
    ticksPerBeat: TPB,
    ...(tuning ? { tuning } : {}),
  };
  const performed = notes.map((n, i) => ({
    id: `n${i}`,
    trackId: "s",
    pitch: n.pitch,
    velocity: n.velocity ?? 0.8,
    startTick: Math.round(((n.start ?? 0) * SR) / SPT),
    durationTicks: Math.round(((n.seconds ?? seconds) * SR) / SPT),
    ...(n.performance ? { performance: n.performance } : {}),
    ...(n.articulation ? { articulation: n.articulation } : {}),
  })) as unknown as PerformedNote[];
  const dry = new Float64Array(samples);
  renderStrings(dry, undefined, performed, track, context);
  return dry;
}

function spectrum(x: Float64Array, start: number, len: number, pad: number) {
  let n = 1;
  while (n < len * pad) n *= 2;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < len && start + i < x.length; i += 1)
    re[i] =
      x[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)));
  fft(re, im);
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) mag[i] = Math.hypot(re[i]!, im[i]!);
  return mag;
}

function peakNear(mag: Float64Array, binHz: number, hz: number, cents = 60) {
  const lo = Math.max(1, Math.floor((hz * 2 ** (-cents / 1200)) / binHz));
  const hi = Math.min(
    mag.length - 2,
    Math.ceil((hz * 2 ** (cents / 1200)) / binHz),
  );
  let best = lo;
  for (let i = lo; i <= hi; i += 1) if (mag[i]! > mag[best]!) best = i;
  const a = Math.log(mag[best - 1]! + 1e-30);
  const b = Math.log(mag[best]! + 1e-30);
  const c = Math.log(mag[best + 1]! + 1e-30);
  const off = (a - c) / (2 * (a - 2 * b + c));
  return (best + (Number.isFinite(off) ? off : 0)) * binHz;
}

export const centsOff = (hz: number, ref: number): number =>
  1200 * Math.log2(hz / ref);

/**
 * Measured frequency (Hz) of the partial near hz: Hann window over
 * [t0, t0 + 1 s) as in the design spec, zero-padded at least 8x.
 */
export function measurePitch(
  x: Float64Array,
  hz: number,
  t0 = 0.3,
  cents = 60,
): number {
  const start = Math.round(t0 * SR);
  const len = Math.min(x.length - start, SR);
  const mag = spectrum(x, start, len, 8);
  let n = 1;
  while (n < len * 8) n *= 2;
  return peakNear(mag, SR / n, hz, cents);
}

function partialEnvelope(
  x: Float64Array,
  hz: number,
  frame: number,
  hop: number,
) {
  const frames = Math.max(0, Math.floor((x.length - frame) / hop));
  const out = new Float64Array(frames);
  const w = (2 * Math.PI * hz) / SR;
  const cos = new Float64Array(frame);
  const sin = new Float64Array(frame);
  for (let i = 0; i < frame; i += 1) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1));
    cos[i] = win * Math.cos(w * i);
    sin[i] = win * Math.sin(w * i);
  }
  for (let f = 0; f < frames; f += 1) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < frame; i += 1) {
      const v = x[f * hop + i]!;
      re += v * cos[i]!;
      im -= v * sin[i]!;
    }
    out[f] = Math.hypot(re, im);
  }
  return out;
}

/** T60 of a partial: regression of dB from -5 to -40 below its peak. */
export function partialT60(x: Float64Array, hz: number): number {
  const frame = Math.max(
    256,
    Math.min(4096, 2 ** Math.ceil(Math.log2((SR / hz) * 6))),
  );
  const hop = frame >> 1;
  const env = partialEnvelope(x, hz, frame, hop);
  let peak = 0;
  let pi = 0;
  for (let i = 0; i < env.length; i += 1)
    if (env[i]! > peak) {
      peak = env[i]!;
      pi = i;
    }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = pi; i < env.length; i += 1) {
    const db = 20 * Math.log10(env[i]! / peak + 1e-30);
    if (db > -5) continue;
    if (db < -40) break;
    xs.push((i * hop) / SR);
    ys.push(db);
  }
  if (xs.length < 3) return NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i += 1) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  return -60 / (sxy / sxx);
}

/** Magnitude-weighted spectral centroid (Hz) of x[start, start+len). */
export function centroid(x: Float64Array, start: number, len: number): number {
  const mag = spectrum(x, start, len, 1);
  let num = 0;
  let den = 0;
  for (let i = 1; i < mag.length; i += 1) {
    num += ((i * SR) / len) * mag[i]!;
    den += mag[i]!;
  }
  return num / den;
}

export function peakOf(x: Float64Array): number {
  let p = 0;
  for (const v of x) p = Math.max(p, Math.abs(v));
  return p;
}
