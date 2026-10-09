/**
 * Stomp boxes (`fx.stomp`): fuzz (Big Muff family), face (Fuzz Face), od
 * (Tube Screamer), rat (RAT) and octave (Octavia). Circuit-inspired
 * per-sample models ported from the 0.6 guitar prototype, run inside one
 * oversampler with ADAA shapers.
 */
import type { Adaa1 } from "../../dsp/shape.ts";
import { Dc, Hp1, Lp1, clamp, dbToGain } from "./filters.ts";
import {
  adaaRectify,
  adaaTanh,
  adaaTriode,
  ratClip,
  runSection,
} from "./section.ts";

export const STOMP_TYPES = ["fuzz", "face", "od", "rat", "octave"] as const;
export type StompType = (typeof STOMP_TYPES)[number];

export type StompSettings = {
  gain: number;
  tone: number;
  level: number;
  octave: number;
};

/** A stomp circuit at the oversampled rate `sr`. */
export type StompCircuit = {
  process(x: number): number;
  /** Re-reads gain, tone and level (control rate, automated only). */
  set(settings: StompSettings): void;
};

export function stompCircuit(
  type: string,
  initial: StompSettings,
  sr: number,
): StompCircuit {
  switch (type) {
    case "fuzz":
      return fuzz(initial, sr);
    case "face":
      return face(initial, sr);
    case "rat":
      return rat(initial, sr);
    case "octave":
      return octave(initial, sr);
    default:
      return od(initial, sr);
  }
}

function fuzz(initial: StompSettings, sr: number): StompCircuit {
  // Input HPF, two cascaded clipping stages with interstage lowpass, then
  // the passive LP/HP tone blend (the Muff's mid scoop).
  const hp = new Hp1(90, sr);
  const s1 = adaaTanh();
  const s2 = adaaTanh();
  const lpA = new Lp1(3200, sr);
  const hpB = new Hp1(60, sr);
  const lpB = new Lp1(2600, sr);
  const toneLp = new Lp1(800, sr);
  const toneHp = new Hp1(1600, sr);
  let pre = 1;
  let tone = 0.5;
  let out = 1;
  const set = (p: StompSettings) => {
    pre = 2 ** (0.5 + 0.55 * p.gain);
    tone = clamp(p.tone, 0, 1);
    out = dbToGain(p.level) * 0.7;
  };
  set(initial);
  return {
    set,
    process(input) {
      let x = hp.process(input) * pre;
      x = lpA.process(s1.process(x)) * 6;
      x = lpB.process(s2.process(hpB.process(x)));
      const y = (1 - tone) * toneLp.process(x) + tone * toneHp.process(x) * 1.6;
      return y * out;
    },
  };
}

function face(initial: StompSettings, sr: number): StompCircuit {
  // Asymmetric and round; cleans up as the input drops.
  const hp = new Hp1(40, sr);
  const s = adaaTriode();
  const dc = new Dc(sr, 12);
  const lp = new Lp1(2500, sr);
  let pre = 1;
  let out = 1;
  const set = (p: StompSettings) => {
    pre = 2 ** (0.3 + 0.5 * p.gain);
    lp.set(2500 + 4000 * clamp(p.tone, 0, 1), sr);
    out = dbToGain(p.level) * 0.8;
  };
  set(initial);
  return {
    set,
    process(input) {
      return lp.process(dc.process(s.process(hp.process(input) * pre))) * out;
    },
  };
}

function od(initial: StompSettings, sr: number): StompCircuit {
  // Clean path plus a soft-clipped 720 Hz high-passed gain path (diodes in
  // the op-amp feedback), then the tone lowpass.
  const hp = new Hp1(720, sr);
  const lpGain = new Lp1(5600, sr);
  const s = adaaTanh();
  const tone = new Lp1(700, sr);
  let pre = 1;
  let out = 1;
  const set = (p: StompSettings) => {
    pre = 1 + 10 ** (p.gain / 5);
    tone.set(700 * 2 ** (3 * clamp(p.tone, 0, 1)), sr);
    out = dbToGain(p.level) * 0.6;
  };
  set(initial);
  return {
    set,
    process(x) {
      const y = x + s.process(lpGain.process(hp.process(x) * pre)) * 0.5;
      return tone.process(y) * out;
    },
  };
}

function rat(initial: StompSettings, sr: number): StompCircuit {
  // Op-amp gain whose bandwidth shrinks with gain (LM308 GBW), hard diode
  // clip to ground, then the passive filter.
  const hp = new Hp1(60, sr);
  const lpOp = new Lp1(20_000, sr);
  const filter = new Lp1(475, sr);
  let gain = 1;
  let out = 1;
  const set = (p: StompSettings) => {
    gain = Math.min(1 + 2 ** (0.67 * p.gain + 1.5), 2000);
    lpOp.set(clamp(1.0e6 / 3 / gain, 900, 20_000), sr);
    filter.set(475 * 2 ** (6 * clamp(p.tone, 0, 1)), sr);
    out = dbToGain(p.level) * 0.55;
  };
  set(initial);
  return {
    set,
    process(input) {
      const x = lpOp.process(hp.process(input) * gain * 0.02);
      return filter.process(ratClip(x)) * out;
    },
  };
}

function octave(initial: StompSettings, sr: number): StompCircuit {
  // Rectified (octave-up) path blended into a fuzz.
  const hp = new Hp1(120, sr);
  const rect: Adaa1 = adaaRectify();
  const dc = new Dc(sr, 20);
  const s = adaaTanh();
  const lp = new Lp1(3000, sr);
  let pre = 1;
  let mix = 0.7;
  let out = 1;
  const set = (p: StompSettings) => {
    pre = 2 ** (0.5 + 0.5 * p.gain);
    lp.set(3000 + 4000 * clamp(p.tone, 0, 1), sr);
    mix = clamp(p.octave, 0, 1);
    out = dbToGain(p.level) * 0.7;
  };
  set(initial);
  return {
    set,
    process(input) {
      const x = hp.process(input);
      const o = dc.process(rect.process(x * 2)) * 2;
      return lp.process(s.process(((1 - mix) * x + mix * o) * pre)) * out;
    },
  };
}

/** Stomp calibration input: a 196 Hz (G3) sine at guitar level. */
export const STOMP_CALIBRATION_DBFS = -18;

const stompMakeups = new Map<string, number>();

/**
 * Linear gain that brings a pedal at `settings` (level taken as 0 dB) back
 * to the calibration sine's level, so switching or kicking on a stomp does
 * not jump the track by 15-25 dB; `level` stays a trim on top. Measured on
 * the circuit itself, deterministic, cached per settings and rate.
 */
export function stompMakeup(
  type: string,
  settings: StompSettings,
  sampleRate: number,
  factor: 2 | 4,
): number {
  const key = `${sampleRate}|${factor}|${type}|${settings.gain}|${settings.tone}|${settings.octave}`;
  const known = stompMakeups.get(key);
  if (known !== undefined) return known;
  const amplitude = 10 ** (STOMP_CALIBRATION_DBFS / 20) * Math.SQRT2;
  const settle = Math.round(sampleRate * 0.1);
  const length = settle + Math.round(sampleRate * 0.1);
  const buffer = new Float64Array(length);
  const w = (2 * Math.PI * 196) / sampleRate;
  for (let i = 0; i < length; i += 1) buffer[i] = amplitude * Math.sin(w * i);
  const circuit = stompCircuit(
    type,
    { ...settings, level: 0 },
    sampleRate * factor,
  );
  runSection(buffer, factor, (x) => circuit.process(x));
  let sum = 0;
  for (let i = settle; i < length; i += 1) sum += buffer[i]! * buffer[i]!;
  const rms = Math.sqrt(sum / (length - settle));
  const target = 10 ** (STOMP_CALIBRATION_DBFS / 20);
  const makeup = rms > 1e-12 ? target / rms : 1;
  stompMakeups.set(key, makeup);
  if (stompMakeups.size > 4096)
    stompMakeups.delete(stompMakeups.keys().next().value!);
  return makeup;
}

/** Makeup for an automated gain: linear between whole steps. */
export function stompMakeupAt(
  type: string,
  settings: StompSettings,
  sampleRate: number,
  factor: 2 | 4,
): number {
  const g = clamp(settings.gain, 0, 10);
  const g0 = Math.min(9, Math.floor(g));
  const at = (gain: number) =>
    stompMakeup(type, { ...settings, gain }, sampleRate, factor);
  const a = at(g0);
  return a + (at(g0 + 1) - a) * (g - g0);
}
