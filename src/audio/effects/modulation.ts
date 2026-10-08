/**
 * Stereo modulation stages after pan: phaser, chorus and leslie.
 */
import type { Track } from "../../../core/score.ts";
import type { FxValues } from "../../../core/fx.ts";
import {
  CONTROL_SAMPLES,
  Phasor,
  clamp,
  fxReader,
  lfoHz,
  tempoAtSample,
  readFractional,
  type EffectContext,
} from "./common.ts";

const PHASER_STAGES = 4;
const PHASER_FEEDBACK = 0.3;

/**
 * Four first-order all-pass stages whose break frequency an LFO sweeps
 * `sweep` Hz around `center`; summing with the dry signal cuts moving
 * notches. Both channels share the LFO so the pan image holds.
 */
export function applyPhaser(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "phaser", values, context);
  const rate = read.param("rate");
  const depth = read.param("depth");
  const sync = read.number("sync");
  const center = read.number("center");
  const sweep = read.number("sweep");
  const { sampleRate } = context;
  const states = [
    new Float64Array(PHASER_STAGES),
    new Float64Array(PHASER_STAGES),
  ];
  const feedback = [0, 0];
  const phasor = new Phasor(0);
  let coefficient = 0;
  let amount = depth.at(0);
  const channel = (side: 0 | 1, input: number): number => {
    const state = states[side]!;
    let signal = input + feedback[side]! * PHASER_FEEDBACK;
    for (let stage = 0; stage < PHASER_STAGES; stage += 1) {
      // y = a·x + x[n-1] − a·y[n-1], kept as one state per stage.
      const output = coefficient * signal + state[stage]!;
      state[stage] = signal - coefficient * output;
      signal = output;
    }
    feedback[side] = signal;
    return input * (1 - amount / 2) + signal * (amount / 2);
  };
  for (let index = 0; index < left.length; index += 1) {
    if (index % CONTROL_SAMPLES === 0) {
      phasor.setHz(
        lfoHz(sync, rate.at(index), tempoAtSample(context, index)),
        sampleRate,
      );
      if (depth.automated) amount = depth.at(index);
      const frequency = clamp(
        center + (sweep / 2) * Math.sin(2 * Math.PI * phasor.phase),
        20,
        sampleRate * 0.45,
      );
      const t = Math.tan((Math.PI * frequency) / sampleRate);
      coefficient = (t - 1) / (t + 1);
    }
    phasor.next();
    left[index] = channel(0, left[index]!);
    right[index] = channel(1, right[index]!);
  }
}

const CHORUS_BASE_MS = 12;
const CHORUS_SWING_MS = 6;

/**
 * Stereo chorus: each side reads a delay line modulated by a sine LFO, the
 * right a quarter cycle behind the left, blended with the dry signal.
 */
export function applyChorus(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "chorus", values, context);
  const rate = read.param("rate");
  const depth = read.param("depth");
  const mix = read.param("mix");
  const { sampleRate } = context;
  const size =
    Math.ceil(((CHORUS_BASE_MS + CHORUS_SWING_MS) / 1000) * sampleRate) + 4;
  const lines = [new Float64Array(size), new Float64Array(size)];
  const phasor = new Phasor(0);
  const base = (CHORUS_BASE_MS / 1000) * sampleRate;
  const swing = (CHORUS_SWING_MS / 1000) * sampleRate;
  let amount = depth.at(0);
  let wet = mix.at(0);
  for (let index = 0; index < left.length; index += 1) {
    if (index % CONTROL_SAMPLES === 0) {
      phasor.setHz(rate.at(index), sampleRate);
      if (depth.automated) amount = depth.at(index);
      if (mix.automated) wet = mix.at(index);
    }
    const phase = phasor.next();
    const write = index % size;
    for (let side = 0; side < 2; side += 1) {
      const buffer = side === 0 ? left : right;
      const line = lines[side]!;
      const input = buffer[index]!;
      line[write] = input;
      const delay =
        base +
        swing *
          amount *
          0.5 *
          (1 + Math.sin(2 * Math.PI * (phase + side * 0.25)));
      const delayed = readFractional(line, write, delay);
      buffer[index] = input * (1 - wet) + delayed * wet;
    }
  }
}

const LESLIE_BASE_MS = 3;
const LESLIE_DOPPLER_MS = 1.5;
const LESLIE_AM = 0.35;

/**
 * Rotary speaker: the mono sum feeds a horn whose distance from two
 * microphones (left, right) swings with the rotation, giving opposed
 * Doppler pitch warble and amplitude rotation; `size` scales the Doppler.
 */
export function applyLeslie(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "leslie", values, context);
  const rate = read.param("rate");
  const mix = read.param("mix");
  const size = read.number("size");
  const { sampleRate } = context;
  const base = (LESLIE_BASE_MS / 1000) * sampleRate;
  const doppler = (LESLIE_DOPPLER_MS / 1000) * sampleRate * size;
  const length = Math.ceil(base + doppler) + 4;
  const line = new Float64Array(length);
  const phasor = new Phasor(0);
  let wet = mix.at(0);
  for (let index = 0; index < left.length; index += 1) {
    if (index % CONTROL_SAMPLES === 0) {
      phasor.setHz(rate.at(index), sampleRate);
      if (mix.automated) wet = mix.at(index);
    }
    const angle = 2 * Math.PI * phasor.next();
    const write = index % length;
    const dryL = left[index]!;
    const dryR = right[index]!;
    line[write] = (dryL + dryR) / 2;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const hornL = readFractional(line, write, base + doppler * 0.5 * (1 + sin));
    const hornR = readFractional(line, write, base + doppler * 0.5 * (1 - sin));
    const wetL = hornL * (1 + LESLIE_AM * cos);
    const wetR = hornR * (1 - LESLIE_AM * cos);
    left[index] = dryL * (1 - wet) + wetL * wet;
    right[index] = dryR * (1 - wet) + wetR * wet;
  }
}
