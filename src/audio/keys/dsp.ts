/**
 * Keys-local DSP (0.6 keys lane), ported from the reviewed prototype
 * (`.plans/dawg-06/proto/keys/dsp.ts`, round 2): a modal resonator bank, an
 * RBJ biquad with shelves and peaks (the contract `Biquad` has only
 * lpf/hpf/bpf), and a seeded filtered noise burst. Randomness comes only
 * from `src/audio/dsp/rng.ts`.
 */
import { seededRandom } from "../dsp/rng.ts";

export const TAU = 2 * Math.PI;
/** ln(1000): 60 dB in nepers. */
export const LN1000 = 6.907755278982137;
/** Samples per control step (bend, vibrato, damper and lane reads). */
export const CONTROL = 32;
/** Highest mode frequency kept, as a share of the sample rate. */
export const MODE_CEILING = 0.45;

export const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));
export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

/** Per-sample pole radius for a 60 dB decay in `t60` seconds. */
export const radiusFor = (t60: number, sampleRate: number): number =>
  Math.exp(-LN1000 / (Math.max(1e-4, t60) * sampleRate));

/**
 * A bank of complex one-pole resonators (z' = p z + u x, output Im z * g).
 * Struct-of-arrays; modes can be retuned (bend) and re-damped (dampers).
 * A retune that would lift a mode above `MODE_CEILING` mutes it, so a bend
 * never folds partials back below Nyquist.
 */
export class ModeBank {
  n = 0;
  readonly re: Float64Array;
  readonly im: Float64Array;
  readonly cr: Float64Array;
  readonly ci: Float64Array;
  /** Base angle per sample. */
  readonly w: Float64Array;
  readonly r: Float64Array;
  readonly u: Float64Array;
  /** Output gain in use (zero while muted by a bend). */
  readonly g: Float64Array;
  /** Output gain as created. */
  readonly g0: Float64Array;
  private ratio = 1;

  constructor(capacity: number) {
    this.re = new Float64Array(capacity);
    this.im = new Float64Array(capacity);
    this.cr = new Float64Array(capacity);
    this.ci = new Float64Array(capacity);
    this.w = new Float64Array(capacity);
    this.r = new Float64Array(capacity);
    this.u = new Float64Array(capacity);
    this.g = new Float64Array(capacity);
    this.g0 = new Float64Array(capacity);
  }

  add(
    hz: number,
    t60: number,
    input: number,
    output: number,
    sampleRate: number,
  ): void {
    if (!(hz > 0) || hz >= sampleRate * MODE_CEILING) return;
    if (this.n >= this.re.length) return;
    const k = this.n++;
    this.w[k] = (TAU * hz) / sampleRate;
    this.r[k] = radiusFor(t60, sampleRate);
    this.u[k] = input;
    this.g[k] = output;
    this.g0[k] = output;
    this.cr[k] = this.r[k]! * Math.cos(this.w[k]!);
    this.ci[k] = this.r[k]! * Math.sin(this.w[k]!);
  }

  /** Shortens every mode's decay to at most `t60For(hz)` (damper, key-off). */
  damp(t60For: (hz: number) => number, sampleRate: number): void {
    for (let k = 0; k < this.n; k += 1) {
      const hz = (this.w[k]! * sampleRate) / TAU;
      const r = radiusFor(t60For(hz), sampleRate);
      if (r < this.r[k]!) {
        this.r[k] = r;
        this.setAngle(k);
      }
    }
  }

  /** Retunes every mode by a frequency ratio (bend, vibrato). */
  retune(ratio: number): void {
    if (ratio === this.ratio) return;
    this.ratio = ratio;
    for (let k = 0; k < this.n; k += 1) this.setAngle(k);
  }

  private setAngle(k: number): void {
    const angle = this.w[k]! * this.ratio;
    const muted = angle >= TAU * MODE_CEILING;
    this.g[k] = muted ? 0 : this.g0[k]!;
    const a = muted ? this.w[k]! : angle;
    this.cr[k] = this.r[k]! * Math.cos(a);
    this.ci[k] = this.r[k]! * Math.sin(a);
  }

  /** Drops modes below `floor` (absolute output amplitude), deterministically. */
  cull(floor: number): void {
    let k = 0;
    while (k < this.n) {
      const amp = Math.hypot(this.re[k]!, this.im[k]!) * Math.abs(this.g0[k]!);
      if (amp < floor) {
        const last = --this.n;
        this.re[k] = this.re[last]!;
        this.im[k] = this.im[last]!;
        this.cr[k] = this.cr[last]!;
        this.ci[k] = this.ci[last]!;
        this.w[k] = this.w[last]!;
        this.r[k] = this.r[last]!;
        this.u[k] = this.u[last]!;
        this.g[k] = this.g[last]!;
        this.g0[k] = this.g0[last]!;
      } else k += 1;
    }
  }

  /** Runs `count` samples, adding Im(z)*g into out[offset..]; x is the input or null. */
  run(
    out: Float64Array,
    offset: number,
    count: number,
    x: Float64Array | null,
    xOffset: number,
  ): void {
    const { re, im, cr, ci, u, g } = this;
    const n = this.n;
    for (let s = 0; s < count; s += 1) {
      const input = x ? (x[xOffset + s] ?? 0) : 0;
      let acc = 0;
      if (input !== 0) {
        for (let k = 0; k < n; k += 1) {
          const a = re[k]!;
          const b = im[k]!;
          const nr = cr[k]! * a - ci[k]! * b + u[k]! * input;
          const ni = ci[k]! * a + cr[k]! * b;
          re[k] = nr;
          im[k] = ni;
          acc += g[k]! * ni;
        }
      } else {
        for (let k = 0; k < n; k += 1) {
          const a = re[k]!;
          const b = im[k]!;
          const ni = ci[k]! * a + cr[k]! * b;
          re[k] = cr[k]! * a - ci[k]! * b;
          im[k] = ni;
          acc += g[k]! * ni;
        }
      }
      out[offset + s]! += acc;
    }
  }
}

export type BiquadKind =
  "lpf" | "hpf" | "bpf" | "peak" | "lowshelf" | "highshelf";

/** RBJ cookbook biquad, transposed direct form II. */
export class Biquad2 {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  z1 = 0;
  z2 = 0;

  set(
    type: BiquadKind,
    hz: number,
    q: number,
    gainDb: number,
    sampleRate: number,
  ): this {
    const w = (TAU * clamp(hz, 10, sampleRate * 0.45)) / sampleRate;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const alpha = sw / (2 * q);
    const A = 10 ** (gainDb / 40);
    let b0 = 1;
    let b1 = 0;
    let b2 = 0;
    let a0 = 1;
    let a1 = 0;
    let a2 = 0;
    if (type === "lpf") {
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else if (type === "hpf") {
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else if (type === "bpf") {
      b0 = alpha;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else if (type === "peak") {
      b0 = 1 + alpha * A;
      b1 = -2 * cw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cw;
      a2 = 1 - alpha / A;
    } else {
      const s = 2 * Math.sqrt(A) * alpha;
      if (type === "lowshelf") {
        b0 = A * (A + 1 - (A - 1) * cw + s);
        b1 = 2 * A * (A - 1 - (A + 1) * cw);
        b2 = A * (A + 1 - (A - 1) * cw - s);
        a0 = A + 1 + (A - 1) * cw + s;
        a1 = -2 * (A - 1 + (A + 1) * cw);
        a2 = A + 1 + (A - 1) * cw - s;
      } else {
        b0 = A * (A + 1 + (A - 1) * cw + s);
        b1 = -2 * A * (A - 1 + (A + 1) * cw);
        b2 = A * (A + 1 + (A - 1) * cw - s);
        a0 = A + 1 - (A - 1) * cw + s;
        a1 = 2 * (A - 1 - (A + 1) * cw);
        a2 = A + 1 - (A - 1) * cw - s;
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

/** A seeded band-passed noise burst: knock, click, thud and key-off. */
export class Burst {
  private readonly filter = new Biquad2();
  private readonly random: () => number;
  private n = 0;
  readonly length: number;
  private readonly attack: number;
  private readonly k: number;
  private env = 1;

  constructor(
    seed: string,
    hz: number,
    q: number,
    tau: number,
    readonly gain: number,
    sampleRate: number,
    attack = 0.0005,
  ) {
    this.random = seededRandom(seed);
    this.filter.set("bpf", hz, q, 0, sampleRate);
    this.attack = Math.max(1, Math.round(attack * sampleRate));
    this.k = Math.exp(-1 / (tau * sampleRate));
    this.length = this.attack + Math.ceil(tau * 7 * sampleRate);
  }

  next(): number {
    const i = this.n++;
    if (i >= this.length) return 0;
    const e = i < this.attack ? i / this.attack : (this.env *= this.k);
    return this.filter.process(this.random() * 2 - 1) * e * this.gain;
  }

  get done(): boolean {
    return this.n >= this.length;
  }
}

/** Equal-power pan gains for -1..1. */
export function panGains(pan: number): [number, number] {
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/** Normalised hammer force pulse: half-sine^sharp over `length` samples, sum 1. */
export function hammerPulse(length: number, sharp: number): Float64Array {
  const pulse = new Float64Array(length);
  let sum = 0;
  for (let m = 0; m < length; m += 1) {
    pulse[m] = Math.sin((Math.PI * (m + 0.5)) / length) ** sharp;
    sum += pulse[m]!;
  }
  for (let m = 0; m < length; m += 1) pulse[m]! /= sum;
  return pulse;
}

/** |DTFT| of the pulse at angle `w` (rad/sample). */
export function pulseMag(pulse: Float64Array, w: number): number {
  let re = 0;
  let im = 0;
  for (let m = 0; m < pulse.length; m += 1) {
    re += pulse[m]! * Math.cos(w * m);
    im -= pulse[m]! * Math.sin(w * m);
  }
  return Math.hypot(re, im);
}
