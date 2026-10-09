/**
 * Sympathetic resonance for the modelled pianos (0.6.1, keys-electric
 * lane): a per-track bank of 36 tuned feedback combs (C2..B4), fed by the
 * dry sum, ringing with T60 4 s while the sustain pedal is down (all
 * dampers up) and 0.06 s when it is up. Ported from the design prototype
 * (proto/keys/keys.ts `Sympathetic`).
 *
 * Gating (zero cost otherwise): it runs only on a piano track with `sym`
 * above 0 and at least one sustain pedal `down` or `half` event; between
 * pedal-down spans it stops processing once its energy is below -90 dB.
 * At 44.1 kHz and above it runs at half rate (pairs averaged in, output
 * linearly interpolated), which keeps 48 kHz near the 22.05 kHz cost; the
 * combs top out at B4 (494 Hz), far below the halved Nyquist.
 */

import { hermite4 } from "../dsp/interp.ts";

const TAU = 2 * Math.PI;
const LOW = 36;
const HIGH = 71;
/** Energy below which the bank goes quiet while the pedal is up. */
const QUIET = 1e-9;

export class Sympathetic {
  private readonly lines: Float64Array[] = [];
  private readonly delay: number[] = [];
  private readonly lp: number[] = [];
  private readonly ws: number[] = [];
  private readonly gUp: number[] = [];
  private readonly gDown: number[] = [];
  private readonly a: number;
  /** Internal decimation: 1 at 22.05 kHz, 2 at 44.1/48 kHz. */
  readonly factor: number;

  constructor(
    hzOf: (pitch: number) => number,
    readonly amount: number,
    sr: number,
  ) {
    this.factor = sr >= 40_000 ? 2 : 1;
    const rate = sr / this.factor;
    this.a = Math.exp((-TAU * 4000) / rate);
    const lpDelay = this.a / (1 - this.a);
    for (let q = LOW; q <= HIGH; q += 1) {
      const hz = hzOf(q);
      // An unmapped tuning degree has no string to ring.
      if (!(hz > 0) || !Number.isFinite(hz)) continue;
      const d = Math.max(2, rate / hz - lpDelay);
      this.lines.push(new Float64Array(Math.ceil(d) + 8));
      this.delay.push(d);
      this.lp.push(0);
      this.ws.push(0);
      this.gDown.push(10 ** ((-3 * d) / (rate * 4)));
      this.gUp.push(10 ** ((-3 * d) / (rate * 0.06)));
    }
  }

  /** One internal-rate step: input `x`, returns [left, right] resonance. */
  private step(x: number, pedal: boolean, out: [number, number]): void {
    let yl = 0;
    let yr = 0;
    const a = this.a;
    for (let k = 0; k < this.lines.length; k += 1) {
      const line = this.lines[k]!;
      const size = line.length;
      const w = this.ws[k]!;
      const pos = w - this.delay[k]!;
      const i = Math.floor(pos);
      const at = (j: number) => line[((j % size) + size) % size]!;
      const y = hermite4(at(i - 1), at(i), at(i + 1), at(i + 2), pos - i);
      const f = (this.lp[k] = y + a * (this.lp[k]! - y));
      line[w % size] = x + (pedal ? this.gDown[k]! : this.gUp[k]!) * f;
      this.ws[k] = (w + 1) % size;
      if (k & 1) yr += f;
      else yl += f;
    }
    out[0] = yl * 0.5;
    out[1] = yr * 0.5;
  }

  /**
   * In place: adds resonance to `left`/`right`. `down(i)` says whether the
   * sustain pedal is down at sample `i` (read per sample pair at most).
   */
  process(
    left: Float64Array,
    right: Float64Array,
    down: (sample: number) => boolean,
  ): void {
    const c = 0.02 * this.amount;
    const out: [number, number] = [0, 0];
    const f = this.factor;
    let prevL = 0;
    let prevR = 0;
    let energy = 0;
    for (let i = 0; i < left.length; i += f) {
      const pedal = down(i);
      let x = 0;
      for (let j = 0; j < f && i + j < left.length; j += 1)
        x += left[i + j]! + right[i + j]!;
      x = (x / (2 * f)) * c;
      // Dampers down and the combs quiet: skip them entirely.
      if (!pedal && energy < QUIET) {
        prevL = 0;
        prevR = 0;
        continue;
      }
      this.step(x, pedal, out);
      energy = 0.999 * energy + 0.001 * (out[0] * out[0] + out[1] * out[1]);
      if (f === 1) {
        left[i]! += out[0];
        right[i]! += out[1];
      } else {
        // Linear interpolation back to the full rate (one sample latency
        // at half rate, inaudible on a 4 s resonance).
        left[i]! += 0.5 * (prevL + out[0]);
        right[i]! += 0.5 * (prevR + out[1]);
        if (i + 1 < left.length) {
          left[i + 1]! += out[0];
          right[i + 1]! += out[1];
        }
      }
      prevL = out[0];
      prevR = out[1];
    }
  }
}
