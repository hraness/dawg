/**
 * Filters the wind voice needs beyond dawg's `Biquad` (lpf, hpf, bpf):
 * the RBJ cookbook peak and high shelf for mutes and the dynamics shelf
 * (Robert Bristow-Johnson, "Cookbook formulae for audio EQ biquad filter
 * coefficients"). A new class so the shared `Biquad` stays untouched.
 */
import { thiranFor } from "../dsp/interp.ts";

export type WindFilterType = "lpf" | "hpf" | "bpf" | "peak" | "highshelf";

export class WindBiquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  set(
    type: WindFilterType,
    hz: number,
    q: number,
    gainDb: number,
    sampleRate: number,
  ): this {
    const f = Math.min(Math.max(hz, 10), 0.45 * sampleRate);
    const w = (2 * Math.PI * f) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * Math.max(0.05, q));
    const A = 10 ** (gainDb / 40);
    let b0 = 1;
    let b1 = 0;
    let b2 = 0;
    let a0 = 1;
    let a1 = 0;
    let a2 = 0;
    switch (type) {
      case "lpf":
        b0 = (1 - cos) / 2;
        b1 = 1 - cos;
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case "hpf":
        b0 = (1 + cos) / 2;
        b1 = -(1 + cos);
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case "bpf":
        b0 = alpha;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case "peak":
        b0 = 1 + alpha * A;
        b1 = -2 * cos;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cos;
        a2 = 1 - alpha / A;
        break;
      case "highshelf": {
        const sq = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cos + sq);
        b1 = -2 * A * (A - 1 + (A + 1) * cos);
        b2 = A * (A + 1 + (A - 1) * cos - sq);
        a0 = A + 1 - (A - 1) * cos + sq;
        a1 = 2 * (A - 1 - (A + 1) * cos);
        a2 = A + 1 - (A - 1) * cos - sq;
        break;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/**
 * A delay line read before it is written (waveguide loops read the bore
 * output, then push the new input): an integer ring plus a first-order
 * Thiran allpass for the fraction in [0.5, 1.5), its phase delay exact at
 * the loop's fundamental (`thiranFor` in src/audio/dsp/interp.ts).
 */
export class LoopDelay {
  private readonly buffer: Float64Array;
  private readonly mask: number;
  private write = 0;
  private whole = 1;
  private a = 0;
  private u1 = 0;
  private y1 = 0;

  constructor(maxDelay: number) {
    let size = 8;
    while (size < Math.ceil(maxDelay) + 8) size *= 2;
    this.buffer = new Float64Array(size);
    this.mask = size - 1;
  }

  /** Total delay in samples (at least 1.5); `w` rad/sample where it is exact. */
  set(delay: number, w = 0): void {
    const total = Math.min(Math.max(delay, 1.5), this.mask - 3);
    const whole = Math.floor(total - 0.5);
    this.whole = whole;
    this.a = thiranFor(total - whole, w);
  }

  read(): number {
    const u = this.buffer[(this.write - this.whole) & this.mask]!;
    const y = this.a * u + this.u1 - this.a * this.y1;
    this.u1 = u;
    this.y1 = y;
    return y;
  }

  push(value: number): void {
    this.buffer[this.write] = value;
    this.write = (this.write + 1) & this.mask;
  }
}

/** Phase delay in samples of the one-pole lowpass y += (1 - p)(x - y). */
export function onePoleDelay(p: number, w: number): number {
  if (w < 1e-9) return p / (1 - p);
  return Math.atan2(p * Math.sin(w), 1 - p * Math.cos(w)) / w;
}

/** Phase delay of the DC blocker y = x - x1 + R y1 at `w` (negative: it leads). */
export function dcBlockDelay(r: number, w: number): number {
  // H = (1 - z^-1) / (1 - R z^-1)
  const num = Math.atan2(Math.sin(w), 1 - Math.cos(w));
  const den = Math.atan2(r * Math.sin(w), 1 - r * Math.cos(w));
  return -(num - den) / w;
}
