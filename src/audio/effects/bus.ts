/**
 * Shared orbit buses (Strudel orbits): tracks whose `fx.orbit` sets
 * `shared` send into one delay and one reverb per orbit instead of running
 * their own.
 *
 * Each member's finished stem (its chain up to, not including, delay and
 * reverb) is sent to the bus delay at its `delay.mix` and to the bus reverb
 * at its `reverb.mix`, both following their mix lanes. The bus delay takes
 * its time, feedback, ping-pong and highcut from the first member in score
 * order that has a delay; the bus reverb takes its settings (size, fade,
 * impulse...) from the first member with a reverb. The two run in parallel
 * and their wet outputs join the mix after every stem, in orbit order. Both
 * are linear, so a bus with one member sounds like that track's own delay
 * and reverb run in parallel.
 */
import type { Track } from "../../../core/score.ts";
import {
  CONTROL_SAMPLES,
  interpolateAutomation,
  tickAtSample,
  type EffectContext,
} from "./common.ts";
import { applyDelay, applyReverb } from "./space.ts";

/** The orbit whose shared bus a track sends to, if any. */
export function sharedOrbitOf(track: Track | undefined): number | undefined {
  const orbit = track?.fx?.orbit;
  return orbit?.shared === true ? Number(orbit.orbit) : undefined;
}

export type OrbitBus = {
  readonly orbit: number;
  delayLead?: Track;
  reverbLead?: Track;
  readonly delayL: Float64Array;
  readonly delayR: Float64Array;
  readonly reverbL: Float64Array;
  readonly reverbR: Float64Array;
  /** Member stem keys in send order: the bus output's cache key. */
  readonly keys: string[];
};

export function createOrbitBus(orbit: number, samples: number): OrbitBus {
  return {
    orbit,
    delayL: new Float64Array(samples),
    delayR: new Float64Array(samples),
    reverbL: new Float64Array(samples),
    reverbR: new Float64Array(samples),
    keys: [],
  };
}

/** Adds `level(t)·stem` into a send pair; the level steps per control block. */
function send(
  outL: Float64Array,
  outR: Float64Array,
  stemL: Float64Array,
  stemR: Float64Array,
  base: number,
  lane: readonly Readonly<{ tick: number; value: number }>[],
  context: Pick<EffectContext, "samplesPerTick" | "warp">,
): void {
  if (base <= 0 && lane.length === 0) return;
  let level = base;
  for (let index = 0; index < outL.length; index += 1) {
    if (lane.length > 0 && index % CONTROL_SAMPLES === 0)
      level = interpolateAutomation(lane, tickAtSample(context, index), base);
    outL[index]! += stemL[index]! * level;
    outR[index]! += stemR[index]! * level;
  }
}

/** Sends one member's stem to its bus. */
export function sendToBus(
  bus: OrbitBus,
  track: Track,
  stemL: Float64Array,
  stemR: Float64Array,
  context: EffectContext,
  key: string,
): void {
  bus.keys.push(key);
  if (track.delay) {
    bus.delayLead ??= track;
    send(
      bus.delayL,
      bus.delayR,
      stemL,
      stemR,
      track.delay.mix,
      track.delayMixAutomation ?? [],
      context,
    );
  }
  if (track.reverb) {
    bus.reverbLead ??= track;
    send(
      bus.reverbL,
      bus.reverbR,
      stemL,
      stemR,
      track.reverb.mix,
      track.fxAutomation?.["reverb-mix"] ?? [],
      context,
    );
  }
}

/**
 * Runs the bus delay and reverb on their sends, wet only, into a fresh
 * stereo pair (the send buffers are consumed).
 */
export function renderOrbitBus(
  bus: OrbitBus,
  context: EffectContext,
): { left: Float64Array; right: Float64Array } {
  const left = new Float64Array(bus.delayL.length);
  const right = new Float64Array(bus.delayL.length);
  const lead = bus.delayLead;
  if (lead?.delay) {
    const unity: Track = {
      ...lead,
      delay: { ...lead.delay, mix: 1 },
      delayMixAutomation: [],
    };
    applyDelay(bus.delayL, bus.delayR, unity, context, true);
    for (let index = 0; index < left.length; index += 1) {
      left[index]! += bus.delayL[index]!;
      right[index]! += bus.delayR[index]!;
    }
  }
  const room = bus.reverbLead;
  if (room?.reverb) {
    const { "reverb-mix": _lane, ...fxAutomation } = room.fxAutomation ?? {};
    const unity: Track = {
      ...room,
      reverb: { ...room.reverb, mix: 1 },
      fxAutomation,
    };
    applyReverb(bus.reverbL, bus.reverbR, unity, context, true);
    for (let index = 0; index < left.length; index += 1) {
      left[index]! += bus.reverbL[index]!;
      right[index]! += bus.reverbR[index]!;
    }
  }
  return { left, right };
}
