/**
 * Shared DSP building blocks for the track effects chain. Everything is
 * plain float64 arithmetic in a fixed order with no clocks or ambient
 * randomness, so a render is byte-identical on every run, cold or cached.
 *
 * The DSP in `src/audio/effects/` is dawg's own, written from standard
 * literature (RBJ Audio EQ Cookbook biquads, Schroeder/Freeverb reverb,
 * Giannoulis–Massberg–Reiss compressor design, Zölzer DAFX modulation
 * effects). Parameter names follow Strudel's documentation; no Strudel
 * source is used.
 */
import type { AutomationPoint, Track } from "../../../core/score.ts";
import type { FxLane, FxValues } from "../../../core/fx.ts";
import type { DecodedSample } from "../samples.ts";

/** Effect parameters are refreshed at this sample interval. */
export const CONTROL_SAMPLES = 32;

export type EffectContext = Readonly<{
  sampleRate: number;
  samplesPerTick: number;
  tempoBpm: number;
  /** Decoded `reverb.ir` samples by track id (built-in impulses need none). */
  irs?: ReadonlyMap<string, DecodedSample>;
}>;

/** Resolve a piecewise-linear automation lane, holding the static value before its first point. */
export function interpolateAutomation(
  points: readonly AutomationPoint[],
  tick: number,
  fallback: number,
): number {
  if (points.length === 0 || !Number.isFinite(tick)) return fallback;
  const first = points[0]!;
  if (tick < first.tick) return fallback;
  const last = points[points.length - 1]!;
  if (tick >= last.tick) return last.value;
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index]!;
    if (tick > right.tick) continue;
    const left = points[index - 1]!;
    const span = right.tick - left.tick;
    const ratio = span <= 0 ? 1 : (tick - left.tick) / span;
    return left.value + (right.value - left.value) * ratio;
  }
  return last.value;
}

/**
 * One numeric effect parameter: its static value plus its automation lane
 * (`<effect>-<param>` in `track.fxAutomation`), read at control rate.
 */
export class Param {
  readonly automated: boolean;
  private readonly points: readonly AutomationPoint[];

  constructor(
    readonly fallback: number,
    points: readonly AutomationPoint[] | undefined,
    private readonly samplesPerTick: number,
  ) {
    this.points = points ?? [];
    this.automated = this.points.length > 0;
  }

  at(index: number): number {
    return this.automated
      ? interpolateAutomation(
          this.points,
          index / this.samplesPerTick,
          this.fallback,
        )
      : this.fallback;
  }
}

/** Reader for one `track.fx` effect's numbers, enums and lanes. */
export function fxReader(
  track: Track,
  effect: string,
  values: FxValues,
  context: EffectContext,
) {
  return {
    number(name: string): number {
      return values[name] as number;
    },
    text(name: string): string {
      return values[name] as string;
    },
    param(name: string): Param {
      return new Param(
        values[name] as number,
        track.fxAutomation?.[`${effect}-${name}` as FxLane],
        context.samplesPerTick,
      );
    },
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Resonance 0..1 → biquad Q 0.707..8 (the original filter's mapping). */
export function resonanceQ(resonance: number): number {
  return 0.707 + clamp(resonance, 0, 1) * 7.293;
}

export type FilterType = "lpf" | "hpf" | "bpf";

/** Transposed direct form II biquad with RBJ cookbook coefficients. */
export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  z1 = 0;
  z2 = 0;

  set(type: FilterType, cutoff: number, q: number, sampleRate: number): void {
    const frequency = clamp(cutoff, 20, sampleRate * 0.45);
    const omega = (2 * Math.PI * frequency) / sampleRate;
    const alpha = Math.sin(omega) / (2 * q);
    const cos = Math.cos(omega);
    const a0 = 1 + alpha;
    if (type === "lpf") {
      this.b0 = (1 - cos) / 2 / a0;
      this.b1 = (1 - cos) / a0;
      this.b2 = this.b0;
    } else if (type === "hpf") {
      this.b0 = (1 + cos) / 2 / a0;
      this.b1 = -(1 + cos) / a0;
      this.b2 = this.b0;
    } else {
      // Constant 0 dB peak gain band-pass.
      this.b0 = alpha / a0;
      this.b1 = 0;
      this.b2 = -alpha / a0;
    }
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(input: number): number {
    const output = this.b0 * input + this.z1;
    this.z1 = this.b1 * input - this.a1 * output + this.z2;
    this.z2 = this.b2 * input - this.a2 * output;
    return output;
  }
}

/** One-pole low-pass; `set` takes a cutoff in Hz. */
export class OnePole {
  private coefficient = 0;
  state = 0;

  constructor(cutoff: number, sampleRate: number) {
    this.set(cutoff, sampleRate);
  }

  set(cutoff: number, sampleRate: number): void {
    this.coefficient =
      1 -
      Math.exp(
        (-2 * Math.PI * clamp(cutoff, 1, sampleRate * 0.49)) / sampleRate,
      );
  }

  process(input: number): number {
    this.state += this.coefficient * (input - this.state);
    return this.state;
  }
}

export type LfoShape = "sine" | "tri" | "square" | "saw" | "ramp" | "random";

/** Integer hash → 0..1, for sample-and-hold steps keyed by cycle number. */
export function hashUnit(value: number, seed = 0): number {
  let state = (Math.floor(value) ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x85ebca6b) >>> 0;
  state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35) >>> 0;
  return ((state ^ (state >>> 16)) >>> 0) / 4_294_967_296;
}

/**
 * Bipolar LFO, -1..1, at `phase` cycles (any real). `saw` falls, `ramp`
 * rises; `random` holds one seeded value per cycle.
 */
export function lfo(shape: string, phase: number, seed = 0): number {
  const cycle = phase - Math.floor(phase);
  switch (shape) {
    case "tri":
      return 1 - 4 * Math.abs(cycle - 0.5);
    case "square":
      return cycle < 0.5 ? 1 : -1;
    case "saw":
      return 1 - 2 * cycle;
    case "ramp":
      return 2 * cycle - 1;
    case "random":
      return hashUnit(phase, seed) * 2 - 1;
    default:
      return Math.sin(2 * Math.PI * phase);
  }
}

/** LFO frequency in Hz: tempo-synced when `sync` (beats per cycle) > 0. */
export function lfoHz(sync: number, rate: number, tempoBpm: number): number {
  return sync > 0 ? tempoBpm / 60 / sync : rate;
}

/** Sample-accurate LFO phase (cycles) with control-rate frequency changes. */
export class Phasor {
  phase: number;
  private increment = 0;

  constructor(start: number) {
    this.phase = start;
  }

  setHz(hz: number, sampleRate: number): void {
    this.increment = hz / sampleRate;
  }

  next(): number {
    const value = this.phase;
    this.phase += this.increment;
    return value;
  }
}

/** Read with linear interpolation `delay` samples behind `write` in a ring. */
export function readFractional(
  buffer: Float64Array,
  write: number,
  delay: number,
): number {
  const length = buffer.length;
  const position = write - delay;
  const base = Math.floor(position);
  const fraction = position - base;
  const a = buffer[((base % length) + length) % length]!;
  const b = buffer[(((base + 1) % length) + length) % length]!;
  return a + (b - a) * fraction;
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
