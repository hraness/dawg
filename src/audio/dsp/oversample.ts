/**
 * Polyphase half-band oversampling for nonlinear stages (guitar rig, high
 * bowed notes). Kaiser-windowed half-band FIRs: 47 taps, beta 8 for 2x and
 * the inner stage of 4x; the 4x final stage (the one at the base rate, where
 * aliases land in the audible band) is 127 taps, beta 10. `Decimate2` is the
 * 47-tap downsampler alone (strings run some voices at 2x and decimate).
 */

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k += 1) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

/** Kaiser-windowed half-band lowpass taps (odd length, cutoff fs/4, DC gain 1). */
export function halfbandTaps(length = 47, beta = 8): Float64Array {
  const taps = new Float64Array(length);
  const mid = (length - 1) / 2;
  const i0b = besselI0(beta);
  for (let n = 0; n < length; n += 1) {
    const k = n - mid;
    const sinc = k === 0 ? 0.5 : Math.sin((Math.PI * k) / 2) / (Math.PI * k);
    const r = k / mid;
    const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b;
    // Even offsets are true zeros of a half-band filter; keep them exact.
    taps[n] = k !== 0 && k % 2 === 0 ? 0 : sinc * w;
  }
  return taps;
}

/** Nonzero taps of one polyphase branch: coefficients and their input offsets. */
type Phase = Readonly<{ taps: Float64Array; offsets: Int32Array }>;

function phaseOf(taps: Float64Array, parity: 0 | 1): Phase {
  const kept: number[] = [];
  const offsets: number[] = [];
  for (let n = parity; n < taps.length; n += 2) {
    if (taps[n] === 0) continue;
    kept.push(taps[n]!);
    offsets.push((n - parity) / 2);
  }
  return { taps: Float64Array.from(kept), offsets: Int32Array.from(offsets) };
}

function ringSize(length: number): number {
  let size = 4;
  while (size < length + 2) size *= 2;
  return size;
}

/** Half-band 2:1 decimator: two input samples in, one out. */
export class Decimate2 {
  private readonly taps: Float64Array;
  private readonly offsets: Int32Array;
  private readonly history: Float64Array;
  private readonly mask: number;
  private write = 0;

  constructor(taps = halfbandTaps(47, 8)) {
    const kept: number[] = [];
    const offsets: number[] = [];
    for (let n = 0; n < taps.length; n += 1) {
      if (taps[n] === 0) continue;
      kept.push(taps[n]!);
      offsets.push(n);
    }
    this.taps = Float64Array.from(kept);
    this.offsets = Int32Array.from(offsets);
    this.history = new Float64Array(ringSize(taps.length));
    this.mask = this.history.length - 1;
  }

  /** `a` then `b` at the high rate → one sample at the base rate. */
  process(a: number, b: number): number {
    const h = this.history;
    const m = this.mask;
    // Output is aligned to `a`, so a 2x round trip delays by whole samples.
    h[this.write] = a;
    const newest = this.write;
    this.write = (this.write + 1) & m;
    h[this.write] = b;
    this.write = (this.write + 1) & m;
    let acc = 0;
    for (let i = 0; i < this.taps.length; i += 1)
      acc += this.taps[i]! * h[(newest - this.offsets[i]!) & m]!;
    return acc;
  }

  reset(): void {
    this.history.fill(0);
  }
}

/** Half-band 1:2 interpolator: one input sample in, two out. */
export class Interpolate2 {
  private readonly even: Phase;
  private readonly odd: Phase;
  private readonly history: Float64Array;
  private readonly mask: number;
  private write = 0;

  constructor(taps = halfbandTaps(47, 8)) {
    this.even = phaseOf(taps, 0);
    this.odd = phaseOf(taps, 1);
    this.history = new Float64Array(ringSize((taps.length + 1) >> 1));
    this.mask = this.history.length - 1;
  }

  /** Writes the two high-rate samples for input `x` into out[0], out[1]. */
  process(x: number, out: Float64Array): void {
    const h = this.history;
    const m = this.mask;
    h[this.write] = x;
    const newest = this.write;
    this.write = (this.write + 1) & m;
    out[0] = 2 * branch(this.even, h, newest, m);
    out[1] = 2 * branch(this.odd, h, newest, m);
  }

  reset(): void {
    this.history.fill(0);
  }
}

function branch(
  phase: Phase,
  history: Float64Array,
  newest: number,
  mask: number,
): number {
  let acc = 0;
  const { taps, offsets } = phase;
  for (let i = 0; i < taps.length; i += 1)
    acc += taps[i]! * history[(newest - offsets[i]!) & mask]!;
  return acc;
}

/** Runs a per-sample function at twice the rate, band-limited both ways. */
export class Oversample2x {
  private readonly up: Interpolate2;
  private readonly down: Decimate2;
  private readonly pair = new Float64Array(2);

  constructor(taps = halfbandTaps(47, 8)) {
    this.up = new Interpolate2(taps);
    this.down = new Decimate2(taps);
  }

  /** Latency in base-rate samples (linear phase, up plus down). */
  static latency(taps = 47): number {
    return (taps - 1) / 2;
  }

  process(x: number, fn: (x: number) => number): number {
    const pair = this.pair;
    this.up.process(x, pair);
    return this.down.process(fn(pair[0]!), fn(pair[1]!));
  }

  reset(): void {
    this.up.reset();
    this.down.reset();
  }
}

/**
 * Runs a per-sample function at four times the rate: a 2x cascade whose
 * base-rate stage is the steep 127-tap, beta-10 half-band and whose inner
 * stage is the 47-tap, beta-8 one (its transition band is already above
 * the base Nyquist).
 */
export class Oversample4x {
  private readonly outerUp: Interpolate2;
  private readonly outerDown: Decimate2;
  private readonly inner: Oversample2x;
  private readonly pair = new Float64Array(2);

  constructor(outer = halfbandTaps(127, 10), inner = halfbandTaps(47, 8)) {
    this.outerUp = new Interpolate2(outer);
    this.outerDown = new Decimate2(outer);
    this.inner = new Oversample2x(inner);
  }

  process(x: number, fn: (x: number) => number): number {
    const pair = this.pair;
    this.outerUp.process(x, pair);
    const a = this.inner.process(pair[0]!, fn);
    const b = this.inner.process(pair[1]!, fn);
    return this.outerDown.process(a, b);
  }

  reset(): void {
    this.outerUp.reset();
    this.outerDown.reset();
    this.inner.reset();
  }
}
