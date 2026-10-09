/**
 * One oversampler per nonlinear rig section (stomp, head): 4x at 22.05 kHz
 * and below, 2x at 44.1/48 kHz, from the shared half-band primitives in
 * src/audio/dsp/oversample.ts. The section's linear-phase delay is removed
 * so a rigged track stays on the grid.
 */
import { Adaa1, logCosh } from "../../dsp/shape.ts";
import { Oversample2x, Oversample4x } from "../../dsp/oversample.ts";

/** Oversampling factor of a nonlinear section at `sampleRate`. */
export function sectionFactor(sampleRate: number): 2 | 4 {
  return sampleRate <= 32_000 ? 4 : 2;
}

type Oversampler = { process(x: number, fn: (x: number) => number): number };

function oversampler(factor: 2 | 4): Oversampler {
  return factor === 4 ? new Oversample4x() : new Oversample2x();
}

const latencies = new Map<number, number>();

/** Base-rate delay of the up/down pair (impulse peak), measured once. */
export function sectionLatency(factor: 2 | 4): number {
  const known = latencies.get(factor);
  if (known !== undefined) return known;
  const os = oversampler(factor);
  let peak = 0;
  let at = 0;
  for (let i = 0; i < 256; i += 1) {
    const y = Math.abs(os.process(i === 0 ? 1 : 0, (x) => x));
    if (y > peak) {
      peak = y;
      at = i;
    }
  }
  latencies.set(factor, at);
  return at;
}

/**
 * Runs `fn` over `buffer` at the oversampled rate, in place and latency
 * compensated. `control(i)` runs at the base rate before sample i.
 */
export function runSection(
  buffer: Float64Array,
  factor: 2 | 4,
  fn: (x: number) => number,
  control?: (index: number) => void,
): void {
  const os = oversampler(factor);
  const latency = sectionLatency(factor);
  const n = buffer.length;
  for (let i = 0; i < n + latency; i += 1) {
    if (control && i < n) control(i);
    const y = os.process(i < n ? buffer[i]! : 0, fn);
    if (i >= latency) buffer[i - latency] = y;
  }
}

// Static curves with closed-form antiderivatives for first-order ADAA.

/** Triode-like asymmetry: the positive half clips harder (grid current). */
const ASYM_B = 0.35;
const ASYM_T = Math.tanh(ASYM_B);
const asymF = (x: number) => Math.tanh(x + ASYM_B) - ASYM_T;
const asymAF = (x: number) => logCosh(x + ASYM_B) - ASYM_T * x;

export const adaaTanh = () => new Adaa1(Math.tanh, logCosh);
export const adaaTriode = () => new Adaa1(asymF, asymAF);
/** Full-wave rectifier (octave up): |x|, antiderivative x|x|/2. */
export const adaaRectify = () =>
  new Adaa1(
    (x) => Math.abs(x),
    (x) => 0.5 * x * Math.abs(x),
  );
/** RAT diode pair: tanh of a cubic-boosted input (no closed-form F). */
export const ratClip = (x: number) => Math.tanh(x + 0.18 * x * x * x);
