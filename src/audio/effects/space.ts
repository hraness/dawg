/**
 * Send effects on the stereo pair: delay and reverb. Without their
 * optional parameters both render exactly as the original renderer did.
 */
import type { Track } from "../../../core/score.ts";
import {
  CONTROL_SAMPLES,
  OnePole,
  Param,
  interpolateAutomation,
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
 * is darker than the last. Feedback and mix follow their lanes.
 */
export function applyDelay(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  context: EffectContext,
): void {
  const delay = track.delay;
  if (!delay) return;
  const feedbackLane = track.delayFeedbackAutomation ?? [];
  const mixLane = track.delayMixAutomation ?? [];
  if (delay.mix <= 0 && mixLane.length === 0) return;
  const { sampleRate, samplesPerTick } = context;
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
      const tick = index / samplesPerTick;
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
    left[index] = dryL + wetL * mix;
    right[index] = dryR + wetR * mix;
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

/** Seconds of reverb tail a render keeps for this track. */
export function reverbTailFor(track: Track): number {
  const reverb = track.reverb;
  const lane = track.fxAutomation?.["reverb-mix"] ?? [];
  if (!reverb || (reverb.mix <= 0 && lane.length === 0)) return 0;
  const decay = reverb.fade ?? 1 + 3 * reverb.size;
  return Math.min(20, decay + (reverb.predelay ?? 0));
}

/**
 * Schroeder–Moorer reverb in the Freeverb arrangement: eight damped
 * feedback combs then four allpasses per side, the right side detuned.
 * `size` sets comb feedback and damping; `fade` instead sets each comb's
 * feedback for an exact -60 dB decay time; `dim` sets the in-loop damping
 * frequency, `lowpass` filters the input and `predelay` delays it.
 */
export function applyReverb(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  context: EffectContext,
): void {
  const reverb = track.reverb;
  if (!reverb) return;
  const mixParam = new Param(
    reverb.mix,
    track.fxAutomation?.["reverb-mix"],
    context.samplesPerTick,
  );
  if (reverb.mix <= 0 && !mixParam.automated) return;
  const { sampleRate } = context;
  const scale = sampleRate / 44_100;
  const sizeFeedback = 0.7 + 0.28 * reverb.size;
  const damp =
    reverb.dim === undefined
      ? 0.2 + 0.3 * reverb.size
      : Math.exp(
          (-2 * Math.PI * Math.min(reverb.dim, sampleRate * 0.45)) / sampleRate,
        );
  let wet = reverb.mix * REVERB_WET_SCALE;
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
  for (let index = 0; index < left.length; index += 1) {
    if (mixParam.automated && index % CONTROL_SAMPLES === 0)
      wet = mixParam.at(index) * REVERB_WET_SCALE;
    let input = (left[index]! + right[index]!) * REVERB_INPUT_GAIN;
    if (inputFilter) input = inputFilter.process(input);
    if (predelay) {
      const slot = index % predelaySamples;
      const delayed = predelay[slot]!;
      predelay[slot] = input;
      input = delayed;
    }
    left[index]! += process(sides[0], input) * wet;
    right[index]! += process(sides[1], input) * wet;
  }
}
