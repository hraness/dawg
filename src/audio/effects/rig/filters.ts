/**
 * Filters for the guitar rig: the full RBJ cookbook biquad (peaks and
 * shelves, which the effects chain's `Biquad` does not offer) and a
 * one-pole high-pass. Ported from the 0.6 guitar prototype; a new class so
 * the shared `Biquad` is never retuned.
 */

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export type RbjType = "lpf" | "hpf" | "peak" | "lowshelf" | "highshelf";

/** RBJ Audio EQ Cookbook biquad, transposed direct form II. */
export class Rbj {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  z1 = 0;
  z2 = 0;

  constructor(type: RbjType, hz: number, q: number, sr: number, db = 0) {
    this.set(type, hz, q, sr, db);
  }

  set(type: RbjType, hz: number, q: number, sr: number, db = 0): void {
    const w = (2 * Math.PI * clamp(hz, 10, sr * 0.49)) / sr;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const A = 10 ** (db / 40);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (type) {
      case "lpf":
        b0 = (1 - cw) / 2;
        b1 = 1 - cw;
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case "hpf":
        b0 = (1 + cw) / 2;
        b1 = -(1 + cw);
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case "peak":
        b0 = 1 + alpha * A;
        b1 = -2 * cw;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cw;
        a2 = 1 - alpha / A;
        break;
      case "lowshelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cw + s);
        b1 = 2 * A * (A - 1 - (A + 1) * cw);
        b2 = A * (A + 1 - (A - 1) * cw - s);
        a0 = A + 1 + (A - 1) * cw + s;
        a1 = -2 * (A - 1 + (A + 1) * cw);
        a2 = A + 1 + (A - 1) * cw - s;
        break;
      }
      case "highshelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cw + s);
        b1 = -2 * A * (A - 1 + (A + 1) * cw);
        b2 = A * (A + 1 + (A - 1) * cw - s);
        a0 = A + 1 - (A - 1) * cw + s;
        a1 = 2 * (A - 1 - (A + 1) * cw);
        a2 = A + 1 - (A - 1) * cw - s;
        break;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** One-pole low-pass y = x + p (y - x). */
export class Lp1 {
  p = 0;
  y = 0;

  constructor(hz: number, sr: number) {
    this.set(hz, sr);
  }

  set(hz: number, sr: number): void {
    this.p = Math.exp((-2 * Math.PI * clamp(hz, 1, sr * 0.49)) / sr);
  }

  process(x: number): number {
    this.y = x + this.p * (this.y - x);
    return this.y;
  }
}

/** One-pole high-pass (leaky differentiator). */
export class Hp1 {
  p = 0;
  x1 = 0;
  y1 = 0;

  constructor(hz: number, sr: number) {
    this.p = Math.exp((-2 * Math.PI * clamp(hz, 1, sr * 0.49)) / sr);
  }

  process(x: number): number {
    const y = ((1 + this.p) / 2) * (x - this.x1) + this.p * this.y1;
    this.x1 = x;
    this.y1 = y;
    return y;
  }
}

/** DC blocker y = x - x1 + R y1. */
export class Dc {
  r: number;
  x1 = 0;
  y1 = 0;

  constructor(sr: number, hz: number) {
    this.r = Math.exp((-2 * Math.PI * hz) / sr);
  }

  process(x: number): number {
    const y = x - this.x1 + this.r * this.y1;
    this.x1 = x;
    this.y1 = y;
    return y;
  }
}
