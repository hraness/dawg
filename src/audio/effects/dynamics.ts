/**
 * Level stages: tremolo, compressor and post gain.
 */
import type { Track } from "../../../core/score.ts";
import type { FxValues } from "../../../core/fx.ts";
import {
  CONTROL_SAMPLES,
  Phasor,
  dbToGain,
  fxReader,
  lfo,
  lfoHz,
  tempoAtSample,
  type EffectContext,
} from "./common.ts";

/** Warp a cycle so its midpoint lands at `skew` (0.5 leaves it unchanged). */
function skewCycle(phase: number, skew: number): number {
  const cycle = phase - Math.floor(phase);
  const s = Math.min(0.99, Math.max(0.01, skew));
  return cycle < s ? (0.5 * cycle) / s : 0.5 + (0.5 * (cycle - s)) / (1 - s);
}

/**
 * Tremolo: gain = 1 − depth·(1 − u) where u is the 0..1 LFO, so depth 0 is
 * transparent and depth 1 dips to silence once per cycle.
 */
export function applyTremolo(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "tremolo", values, context);
  const rate = read.param("rate");
  const depth = read.param("depth");
  const sync = read.number("sync");
  const shape = read.text("shape");
  const skew = read.number("skew");
  // Start at the LFO peak, so phase 0 begins at full level.
  const phasor = new Phasor(read.number("phase"));
  let amount = depth.at(0);
  for (let index = 0; index < buffer.length; index += 1) {
    if (index % CONTROL_SAMPLES === 0) {
      phasor.setHz(
        lfoHz(sync, rate.at(index), tempoAtSample(context, index)),
        context.sampleRate,
      );
      if (depth.automated) amount = depth.at(index);
    }
    const u = (lfo(shape, skewCycle(phasor.next(), skew) + 0.25) + 1) / 2;
    buffer[index] = buffer[index]! * (1 - amount * (1 - u));
  }
}

/**
 * Feed-forward compressor after Giannoulis, Massberg & Reiss (JAES 2012):
 * a 5 ms RMS level detector, a soft-knee gain computer in dB, and
 * attack/release smoothing of the gain reduction, then make-up gain.
 */
export function applyCompressor(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "compressor", values, context);
  const threshold = read.param("threshold");
  const makeup = read.param("makeup");
  const ratio = read.number("ratio");
  const knee = read.number("knee");
  const { sampleRate } = context;
  const coefficient = (seconds: number) =>
    Math.exp(-1 / Math.max(1, seconds * sampleRate));
  const attack = coefficient(read.number("attack"));
  const release = coefficient(read.number("release"));
  const detector = coefficient(0.005);
  const slope = 1 - 1 / ratio;
  let thresholdDb = threshold.at(0);
  let makeupGain = dbToGain(makeup.at(0));
  let power = 0;
  let reduction = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (index % CONTROL_SAMPLES === 0) {
      if (threshold.automated) thresholdDb = threshold.at(index);
      if (makeup.automated) makeupGain = dbToGain(makeup.at(index));
    }
    const input = buffer[index]!;
    // Peak detector: instant rise, 5 ms fall, so onsets are seen at once
    // and the attack time alone sets how much of a transient passes.
    const magnitude = Math.abs(input);
    power = magnitude > power ? magnitude : detector * power;
    const level = 20 * Math.log10(power + 1e-12);
    const over = level - thresholdDb;
    let target = 0;
    if (2 * over >= knee) target = slope * over;
    else if (knee > 0 && 2 * over > -knee)
      target = (slope * (over + knee / 2) ** 2) / (2 * knee);
    reduction =
      target > reduction
        ? attack * reduction + (1 - attack) * target
        : release * reduction + (1 - release) * target;
    buffer[index] = input * dbToGain(-reduction) * makeupGain;
  }
}

/** Linear post gain on the stereo pair (Strudel `postgain`). */
export function applyPostgain(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const gain = fxReader(track, "postgain", values, context).param("gain");
  let value = gain.at(0);
  for (let index = 0; index < left.length; index += 1) {
    if (gain.automated && index % CONTROL_SAMPLES === 0) value = gain.at(index);
    left[index]! *= value;
    right[index]! *= value;
  }
}
