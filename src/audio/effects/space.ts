/**
 * Send effects on the stereo pair: delay and reverb. Without their
 * optional parameters both render exactly as the original renderer did.
 */
import type { Track } from "../../../core/score.ts";
import type { DecodedSample } from "../samples.ts";
import {
  addConvolved,
  builtinImpulse,
  convolveRaw,
  sampleImpulse,
  type Impulse,
} from "./convolution.ts";
import {
  CONTROL_SAMPLES,
  OnePole,
  Param,
  interpolateAutomation,
  tickAtSample,
  type EffectContext,
} from "./common.ts";

/** Delay length in seconds: `time` when set, otherwise `beats` at the tempo. */
export function delaySeconds(track: Track, tempoBpm: number): number {
  const delay = track.delay;
  if (!delay) return 0;
  return delay.time !== undefined && delay.time > 0
    ? delay.time
    : (delay.beats * 60) / tempoBpm;
}

/**
 * Stereo feedback delay. Absent `pingpong`, each side echoes its own input
 * and feeds back into the opposite side (the original sound). With
 * `pingpong`, the mono sum enters the left line only and every repeat
 * crosses over, so echoes alternate left, right, left. `highcut` runs a
 * one-pole low-pass on everything written into the lines, so each repeat
 * is darker than the last. Feedback and mix follow their lanes. `wetOnly`
 * (a shared orbit bus) replaces the input with the repeats alone.
 */
export function applyDelay(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  context: EffectContext,
  wetOnly = false,
): void {
  const delay = track.delay;
  if (!delay) return;
  const feedbackLane = track.delayFeedbackAutomation ?? [];
  const mixLane = track.delayMixAutomation ?? [];
  if (delay.mix <= 0 && mixLane.length === 0) return;
  const { sampleRate } = context;
  const synced = !(delay.time !== undefined && delay.time > 0);
  if (context.warp && synced) {
    applyWarpedDelay(left, right, track, context, wetOnly);
    return;
  }
  const length = Math.max(
    1,
    Math.round(delaySeconds(track, context.tempoBpm) * sampleRate),
  );
  const lineL = new Float64Array(length);
  const lineR = new Float64Array(length);
  let feedback = delay.feedback;
  let mix = delay.mix;
  const automated = feedbackLane.length > 0 || mixLane.length > 0;
  const pingpong = delay.pingpong === true;
  const highcut =
    delay.highcut === undefined
      ? undefined
      : [
          new OnePole(delay.highcut, sampleRate),
          new OnePole(delay.highcut, sampleRate),
        ];
  for (let index = 0; index < left.length; index += 1) {
    if (automated && index % CONTROL_SAMPLES === 0) {
      const tick = tickAtSample(context, index);
      feedback = interpolateAutomation(feedbackLane, tick, delay.feedback);
      mix = interpolateAutomation(mixLane, tick, delay.mix);
    }
    const slot = index % length;
    const wetL = lineL[slot]!;
    const wetR = lineR[slot]!;
    const dryL = left[index]!;
    const dryR = right[index]!;
    let writeL: number;
    let writeR: number;
    if (pingpong) {
      writeL = (dryL + dryR) * 0.5 + wetR * feedback;
      writeR = wetL * feedback;
    } else {
      writeL = dryL + wetR * feedback;
      writeR = dryR + wetL * feedback;
    }
    if (highcut) {
      writeL = highcut[0]!.process(writeL);
      writeR = highcut[1]!.process(writeR);
    }
    lineL[slot] = writeL;
    lineR[slot] = writeR;
    left[index] = (wetOnly ? 0 : dryL) + wetL * mix;
    right[index] = (wetOnly ? 0 : dryR) + wetR * mix;
  }
}

/**
 * The beat-synced delay under a tempo map: the read head trails the write
 * head by `beats` of score time at every control block, read with linear
 * interpolation, so each echo lands `beats` later on the grid through tempo
 * steps, ramps and fermatas. Same routing and lanes as `applyDelay`.
 */
function applyWarpedDelay(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  context: EffectContext,
  wetOnly: boolean,
): void {
  const delay = track.delay!;
  const warp = context.warp!;
  const { sampleRate } = context;
  const feedbackLane = track.delayFeedbackAutomation ?? [];
  const mixLane = track.delayMixAutomation ?? [];
  // Ticks per beat, recovered from the context's start-tempo sample rate.
  const ticksPerBeat = Math.round(
    (sampleRate * 60) / (context.tempoBpm * context.samplesPerTick),
  );
  const lag = delay.beats * ticksPerBeat;
  const lagAt = (index: number) =>
    Math.max(2, index - warp.sample(warp.tick(index) - lag));
  // Longest lag over the buffer sizes the lines.
  let longest = 1;
  for (let index = 0; index <= left.length; index += CONTROL_SAMPLES)
    longest = Math.max(longest, lagAt(index));
  const size = Math.ceil(longest) + 2;
  const lineL = new Float64Array(size);
  const lineR = new Float64Array(size);
  const pingpong = delay.pingpong === true;
  const highcut =
    delay.highcut === undefined
      ? undefined
      : [
          new OnePole(delay.highcut, sampleRate),
          new OnePole(delay.highcut, sampleRate),
        ];
  let feedback = delay.feedback;
  let mix = delay.mix;
  let lagNow = lagAt(0);
  let lagStep = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (index % CONTROL_SAMPLES === 0) {
      const tick = tickAtSample(context, index);
      feedback = interpolateAutomation(feedbackLane, tick, delay.feedback);
      mix = interpolateAutomation(mixLane, tick, delay.mix);
      lagNow = lagAt(index);
      lagStep = (lagAt(index + CONTROL_SAMPLES) - lagNow) / CONTROL_SAMPLES;
    } else lagNow += lagStep;
    const read = index - Math.min(size - 2, lagNow);
    const base = Math.floor(read);
    const fraction = read - base;
    const at = (line: Float64Array, position: number) =>
      position < 0 ? 0 : line[position % size]!;
    const wetL =
      at(lineL, base) * (1 - fraction) + at(lineL, base + 1) * fraction;
    const wetR =
      at(lineR, base) * (1 - fraction) + at(lineR, base + 1) * fraction;
    const dryL = left[index]!;
    const dryR = right[index]!;
    let writeL: number;
    let writeR: number;
    if (pingpong) {
      writeL = (dryL + dryR) * 0.5 + wetR * feedback;
      writeR = wetL * feedback;
    } else {
      writeL = dryL + wetR * feedback;
      writeR = dryR + wetL * feedback;
    }
    if (highcut) {
      writeL = highcut[0]!.process(writeL);
      writeR = highcut[1]!.process(writeR);
    }
    lineL[index % size] = writeL;
    lineR[index % size] = writeR;
    left[index] = (wetOnly ? 0 : dryL) + wetL * mix;
    right[index] = (wetOnly ? 0 : dryR) + wetR * mix;
  }
}

/** Seconds until the track's delay decays below -60 dB, bounded. */
export function delayTailFor(track: Track, tempoBpm: number): number {
  if (!track.delay) return 0;
  const feedback = Math.max(
    track.delay.feedback,
    ...(track.delayFeedbackAutomation ?? []).map((point) => point.value),
  );
  const repeats =
    feedback <= 0.001 ? 1 : Math.min(64, Math.log(0.001) / Math.log(feedback));
  return delaySeconds(track, tempoBpm) * (repeats + 1);
}

/** Freeverb comb and allpass tunings at 44.1 kHz; the right side is spread. */
const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617] as const;
const ALLPASS_TUNING = [556, 441, 341, 225] as const;
const STEREO_SPREAD = 23;
const REVERB_INPUT_GAIN = 0.015;
const REVERB_WET_SCALE = 3;

/**
 * Convolution wet level: an energy-normalized impulse on the summed pair,
 * scaled so `mix` sounds as loud as the algorithmic tail at the same mix.
 */
const IR_WET_SCALE = 2.1;

/** Impulses decoded from samples, by sha256 and rate (small: a few IRs). */
const SAMPLE_IMPULSES = new Map<string, Impulse>();
const MAX_SAMPLE_IMPULSES = 8;

/**
 * The impulse a track's `reverb.ir` names at this rate: a generated
 * built-in, or the decoded sample in `irs`. Undefined when the track has no
 * `ir` or its sample did not load (the algorithmic reverb then plays).
 */
export function reverbImpulse(
  track: Track,
  sampleRate: number,
  irs?: ReadonlyMap<string, DecodedSample>,
): Impulse | undefined {
  const ir = track.reverb?.ir;
  if (!ir) return undefined;
  if (ir.src.startsWith("builtin:"))
    return builtinImpulse(ir.src.slice("builtin:".length), sampleRate);
  const sample = irs?.get(track.id);
  if (!sample) return undefined;
  const key = `${sample.sha256}@${sampleRate}`;
  let impulse = SAMPLE_IMPULSES.get(key);
  if (!impulse) {
    impulse = sampleImpulse(
      `${ir.src}#${sample.sha256}`,
      sample.mono,
      sample.sampleRate,
      sampleRate,
    );
    if (SAMPLE_IMPULSES.size >= MAX_SAMPLE_IMPULSES)
      SAMPLE_IMPULSES.delete(SAMPLE_IMPULSES.keys().next().value!);
    SAMPLE_IMPULSES.set(key, impulse);
  }
  return impulse;
}

/** Seconds of reverb tail a render keeps for this track. */
export function reverbTailFor(
  track: Track,
  sampleRate = 44_100,
  irs?: ReadonlyMap<string, DecodedSample>,
): number {
  const reverb = track.reverb;
  const lane = track.fxAutomation?.["reverb-mix"] ?? [];
  if (!reverb || (reverb.mix <= 0 && lane.length === 0)) return 0;
  const impulse = reverbImpulse(track, sampleRate, irs);
  const decay = impulse
    ? impulse.left.length / sampleRate
    : (reverb.fade ?? 1 + 3 * reverb.size);
  return Math.min(20, decay + (reverb.predelay ?? 0));
}

/**
 * Schroeder–Moorer reverb in the Freeverb arrangement: eight damped
 * feedback combs then four allpasses per side, the right side detuned.
 * `size` sets comb feedback and damping; `fade` instead sets each comb's
 * feedback for an exact -60 dB decay time; `dim` sets the in-loop damping
 * frequency, `lowpass` filters the input and `predelay` delays it.
 * `wetOnly` (a shared orbit bus) replaces the input with the tail alone.
 *
 * It runs in two steps: `reverbWet` (the tail before its mix gain, which
 * does not depend on `mix`) and `addReverbWet`. The stem cache keeps the
 * first, so a mix-only edit skips the room entirely.
 */
export function applyReverb(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  context: EffectContext,
  wetOnly = false,
): void {
  const wet = reverbWet(left, right, track, context);
  if (wet) addReverbWet(left, right, wet, track, context, wetOnly);
}

/** A reverb's tail before its mix gain (`scale` for an impulse response). */
export type ReverbWet = Readonly<{
  left: Float64Array;
  right: Float64Array;
  /** The convolution's inverse-FFT scale; absent for the algorithmic room. */
  scale?: number;
}>;

function mixParamOf(track: Track, context: EffectContext): Param {
  return new Param(
    track.reverb?.mix ?? 0,
    track.fxAutomation?.["reverb-mix"],
    context.samplesPerTick,
    context.warp,
  );
}

/** Whether the track's reverb sounds at all (a mix above 0, or a lane). */
export function reverbActive(track: Track): boolean {
  const reverb = track.reverb;
  if (!reverb) return false;
  return (
    reverb.mix > 0 || (track.fxAutomation?.["reverb-mix"] ?? []).length > 0
  );
}

/**
 * The reverb tail of the pair, before the mix gain; `left`/`right` are
 * read, not changed. Undefined when the reverb is off.
 */
export function reverbWet(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  context: EffectContext,
): ReverbWet | undefined {
  const reverb = track.reverb;
  if (!reverb || !reverbActive(track)) return undefined;
  const { sampleRate } = context;
  const impulse = reverbImpulse(track, sampleRate, context.irs);
  if (impulse) return convolutionWet(left, right, track, context, impulse);
  const scale = sampleRate / 44_100;
  const sizeFeedback = 0.7 + 0.28 * reverb.size;
  const damp =
    reverb.dim === undefined
      ? 0.2 + 0.3 * reverb.size
      : Math.exp(
          (-2 * Math.PI * Math.min(reverb.dim, sampleRate * 0.45)) / sampleRate,
        );
  const channel = (spread: number) => ({
    combs: COMB_TUNING.map((tuning) => {
      const length = Math.max(1, Math.round((tuning + spread) * scale));
      return {
        buffer: new Float64Array(length),
        index: 0,
        store: 0,
        feedback:
          reverb.fade === undefined
            ? sizeFeedback
            : Math.min(0.995, 10 ** ((-3 * length) / sampleRate / reverb.fade)),
      };
    }),
    allpasses: ALLPASS_TUNING.map((tuning) => ({
      buffer: new Float64Array(
        Math.max(1, Math.round((tuning + spread) * scale)),
      ),
      index: 0,
    })),
  });
  const sides = [channel(0), channel(STEREO_SPREAD)] as const;
  const process = (side: (typeof sides)[number], input: number): number => {
    let output = 0;
    for (const comb of side.combs) {
      const delayed = comb.buffer[comb.index]!;
      comb.store = delayed * (1 - damp) + comb.store * damp;
      comb.buffer[comb.index] = input + comb.store * comb.feedback;
      comb.index = comb.index + 1 === comb.buffer.length ? 0 : comb.index + 1;
      output += delayed;
    }
    for (const allpass of side.allpasses) {
      const delayed = allpass.buffer[allpass.index]!;
      allpass.buffer[allpass.index] = output + delayed * 0.5;
      output = delayed - output;
      allpass.index =
        allpass.index + 1 === allpass.buffer.length ? 0 : allpass.index + 1;
    }
    return output;
  };
  const inputFilter =
    reverb.lowpass === undefined
      ? undefined
      : new OnePole(reverb.lowpass, sampleRate);
  const predelaySamples = Math.round((reverb.predelay ?? 0) * sampleRate);
  const predelay =
    predelaySamples > 0 ? new Float64Array(predelaySamples) : undefined;
  const wetL = new Float64Array(left.length);
  const wetR = new Float64Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    let input = (left[index]! + right[index]!) * REVERB_INPUT_GAIN;
    if (inputFilter) input = inputFilter.process(input);
    if (predelay) {
      const slot = index % predelaySamples;
      const delayed = predelay[slot]!;
      predelay[slot] = input;
      input = delayed;
    }
    wetL[index] = process(sides[0], input);
    wetR[index] = process(sides[1], input);
  }
  return { left: wetL, right: wetR };
}

/**
 * Add (or with `wetOnly`, write) a tail from `reverbWet` at the track's
 * mix and mix lane, in the order the one-pass reverb always used, so a
 * cached tail mixes to the same samples.
 */
export function addReverbWet(
  left: Float64Array,
  right: Float64Array,
  tail: ReverbWet,
  track: Track,
  context: EffectContext,
  wetOnly = false,
): void {
  const mixParam = mixParamOf(track, context);
  if (tail.scale !== undefined) {
    if (wetOnly) {
      left.fill(0);
      right.fill(0);
    }
    if (tail.scale === 0) return;
    let wet = mixParam.fallback * IR_WET_SCALE;
    addConvolved(
      tail.left,
      tail.right,
      tail.scale,
      left,
      right,
      wet,
      mixParam.automated
        ? (index) => {
            if (index % CONTROL_SAMPLES === 0)
              wet = mixParam.at(index) * IR_WET_SCALE;
            return wet;
          }
        : undefined,
    );
    return;
  }
  let wet = mixParam.fallback * REVERB_WET_SCALE;
  for (let index = 0; index < left.length; index += 1) {
    if (mixParam.automated && index % CONTROL_SAMPLES === 0)
      wet = mixParam.at(index) * REVERB_WET_SCALE;
    if (wetOnly) {
      left[index] = tail.left[index]! * wet;
      right[index] = tail.right[index]! * wet;
    } else {
      left[index]! += tail.left[index]! * wet;
      right[index]! += tail.right[index]! * wet;
    }
  }
}

/**
 * `reverb.ir`: the summed pair (through `lowpass` and `predelay`, as the
 * algorithmic reverb) convolved with the impulse and added at `mix`.
 * `size`, `fade` and `dim` describe the algorithmic tail and do nothing
 * here: the impulse is the room.
 */
function convolutionWet(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  context: EffectContext,
  impulse: Impulse,
): ReverbWet {
  const reverb = track.reverb!;
  const { sampleRate } = context;
  const input = new Float64Array(left.length);
  const inputFilter =
    reverb.lowpass === undefined
      ? undefined
      : new OnePole(reverb.lowpass, sampleRate);
  const offset = Math.round((reverb.predelay ?? 0) * sampleRate);
  for (let index = 0; index + offset < left.length; index += 1) {
    let value = (left[index]! + right[index]!) * 0.5;
    if (inputFilter) value = inputFilter.process(value);
    input[index + offset] = value;
  }
  const wetL = new Float64Array(left.length);
  const wetR = new Float64Array(left.length);
  const scale = convolveRaw(input, impulse, wetL, wetR);
  return { left: wetL, right: wetR, scale };
}
