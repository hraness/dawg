/**
 * Small per-sample filters for 0.6 instruments. `Biquad` is the existing
 * RBJ biquad (src/audio/effects/common.ts), re-exported unchanged.
 */
export { Biquad, type FilterType } from "../effects/common.ts";

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** One-pole lowpass y += (1 - p)(x - y), corner `hz`. */
export class OnePole {
  p = 0;
  y = 0;

  constructor(hz: number, sampleRate: number) {
    this.set(hz, sampleRate);
  }

  set(hz: number, sampleRate: number): void {
    this.p = Math.exp(
      (-2 * Math.PI * clamp(hz, 1, sampleRate * 0.49)) / sampleRate,
    );
  }

  process(x: number): number {
    this.y = x + this.p * (this.y - x);
    return this.y;
  }

  reset(): void {
    this.y = 0;
  }
}

/** DC blocker y = x - x1 + R y1 (R ≈ 0.996 at 22.05 kHz for a 15 Hz corner). */
export class DcBlock {
  r: number;
  x1 = 0;
  y1 = 0;

  constructor(sampleRate: number, hz = 15) {
    this.r = Math.exp((-2 * Math.PI * hz) / sampleRate);
  }

  process(x: number): number {
    const y = x - this.x1 + this.r * this.y1;
    this.x1 = x;
    this.y1 = y;
    return y;
  }

  reset(): void {
    this.x1 = 0;
    this.y1 = 0;
  }
}
