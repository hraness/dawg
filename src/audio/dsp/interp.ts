/**
 * Interpolation and fractional delay for 0.6 instruments: 4-point Hermite
 * reads (grains, modulated delays) and a first-order Thiran allpass
 * fractional delay (string loops: flat magnitude, exact phase delay).
 */

/** 4-point, 3rd-order Hermite (Catmull-Rom) through xm1 x0 x1 x2 at t in [0, 1). */
export function hermite4(
  xm1: number,
  x0: number,
  x1: number,
  x2: number,
  t: number,
): number {
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * t + c2) * t + c1) * t + x0;
}

/** Hermite read of `x` at fractional position `pos`; zero outside the buffer. */
export function hermiteAt(x: Float64Array, pos: number): number {
  const i = Math.floor(pos);
  const n = x.length;
  const at = (k: number): number => (k >= 0 && k < n ? x[k]! : 0);
  return hermite4(at(i - 1), at(i), at(i + 1), at(i + 2), pos - i);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Phase delay (samples) at `w` rad/sample of the allpass (a + z^-1)/(1 + a z^-1). */
export function allpassDelay(a: number, w: number): number {
  if (w < 1e-9) return (1 - a) / (1 + a);
  const s = Math.sin(w);
  const c = Math.cos(w);
  const num = Math.atan2(-s, a + c);
  const den = Math.atan2(-a * s, 1 + a * c);
  let phase = num - den;
  while (phase > 0) phase -= 2 * Math.PI;
  while (phase <= -2 * Math.PI) phase += 2 * Math.PI;
  return -phase / w;
}

/**
 * First-order Thiran allpass coefficient whose phase delay at `w` is exactly
 * `d` samples (d in [0.5, 1.5)): Thiran's closed form, then Newton steps.
 * With w = 0 this is (1 - d) / (1 + d), exact at DC.
 */
export function thiranFor(d: number, w = 0): number {
  let a = (1 - d) / (1 + d);
  if (w < 1e-9) return a;
  const s = Math.sin(w);
  const c = Math.cos(w);
  for (let i = 0; i < 4; i += 1) {
    const f = allpassDelay(a, w) - d;
    if (Math.abs(f) < 1e-10) break;
    // d(delay)/da in closed form: the phase is atan2(-s, a + c) -
    // atan2(-a s, 1 + a c), so no extra atan2 pair per step.
    const p = a + c;
    const q = 1 + a * c;
    const df = -(s / (p * p + s * s) + s / (q * q + a * a * s * s)) / w;
    if (df === 0) break;
    a = clamp(a - f / df, -0.9, 0.9);
  }
  return a;
}

/**
 * A delay of `delay` samples (>= 0.5): an integer delay line plus a Thiran
 * allpass for the fraction in [0.5, 1.5), so the pole stays well inside the
 * unit circle. `set` may be called between samples (string pitch moves);
 * the allpass state carries over, which is the usual small transient.
 */
export class FracDelay {
  private readonly buffer: Float64Array;
  private readonly mask: number;
  private write = 0;
  private whole = 0;
  private a = 0;
  private u1 = 0;
  private y1 = 0;

  constructor(maxDelay: number, delay = 1, w = 0) {
    let size = 4;
    while (size < Math.ceil(maxDelay) + 4) size *= 2;
    this.buffer = new Float64Array(size);
    this.mask = size - 1;
    this.set(delay, w);
  }

  /** Total delay in samples; `w` is where the phase delay is exact (rad/sample). */
  set(delay: number, w = 0): void {
    const total = clamp(delay, 0.5, this.mask - 2);
    const whole = Math.max(0, Math.floor(total - 0.5));
    this.whole = whole;
    this.a = thiranFor(total - whole, w);
  }

  process(x: number): number {
    const b = this.buffer;
    b[this.write] = x;
    const u = b[(this.write - this.whole) & this.mask]!;
    this.write = (this.write + 1) & this.mask;
    const y = this.a * u + this.u1 - this.a * this.y1;
    this.u1 = u;
    this.y1 = y;
    return y;
  }

  reset(): void {
    this.buffer.fill(0);
    this.u1 = 0;
    this.y1 = 0;
  }
}
