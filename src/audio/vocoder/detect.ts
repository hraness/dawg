/**
 * The vocoder's detectors (0.7): the unvoiced curve (fricatives and
 * breaths get a noise carrier). A sample counts as unvoiced when its share
 * of energy above 4 kHz passes a `sens`-scaled threshold AND the modulator
 * is aperiodic (low normalised autocorrelation), and only while the gate is
 * open: either cue alone misfires on bright vowels or on reverb tails.
 */
import { highpass, runBiquad } from "../dsp/bandbank.ts";
import { follow, followCoef } from "../dsp/follow.ts";
import { periodicityCurve } from "../dsp/periodicity.ts";

export function unvoicedCurve(
  mod: Float64Array,
  sampleRate: number,
  sens: number,
  origin = 0,
  gate?: Float64Array,
): Float64Array {
  const hp = Float64Array.from(mod);
  const filter = highpass(4000, sampleRate);
  runBiquad(filter, hp);
  runBiquad(filter, hp);
  const high = follow(hp, 0.002, 0.02, sampleRate);
  const full = follow(mod, 0.002, 0.02, sampleRate);
  const periodic = periodicityCurve(mod, sampleRate, origin);
  const threshold = 0.5 - 0.35 * sens;
  const out = new Float64Array(mod.length);
  const c = followCoef(0.004, sampleRate);
  let s = 0;
  for (let i = 0; i < mod.length; i += 1) {
    const ratio = full[i]! > 1e-4 ? high[i]! / full[i]! : 0;
    const share = Math.min(1, Math.max(0, (ratio - threshold) / 0.15));
    const aperiodic = Math.min(1, Math.max(0, (0.75 - periodic[i]!) / 0.2));
    const t = share * aperiodic * (gate ? gate[i]! : 1);
    s = c * s + (1 - c) * t;
    out[i] = s;
  }
  return out;
}

/** The modulator above 5 kHz, gated: the `hiss` path that keeps "s" crisp. */
export function hissPath(
  mod: Float64Array,
  n: number,
  sampleRate: number,
): Float64Array {
  const hp = mod.slice(0, n);
  runBiquad(highpass(5000, sampleRate), hp);
  return hp;
}
