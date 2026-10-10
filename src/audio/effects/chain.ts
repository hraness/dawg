/**
 * The fixed per-track effects chain (`FX_CHAIN` in core/fx.ts):
 *
 *   filter → djf → autofilter → formant → vowel → crush → distort → stomp → head →
 *   cab → wobble → bloom → swell → tremolo →
 *   compressor → pan → double → phaser → chorus → leslie → postgain →
 *   delay → reverb
 *
 * Stages before pan run on the mono voice sum; pan spreads it to stereo;
 * the rest run on the stereo pair. Disabled stages cost nothing.
 */
import { FX_CHAIN, type FxName, type FxValues } from "../../../core/fx.ts";
import type { Track } from "../../../core/score.ts";
import type { EffectContext } from "./common.ts";
import { applyCrush, applyDistort } from "./drive.ts";
import { applyBloom, applyDouble, applySwell, applyWobble } from "./gaze.ts";
import { applyCompressor, applyPostgain, applyTremolo } from "./dynamics.ts";
import {
  applyAutoFilter,
  applyDjFilter,
  applyTrackFilter,
  applyVowel,
} from "./filter.ts";
import { applyFormant } from "./formant.ts";
import { applyChorus, applyLeslie, applyPhaser } from "./modulation.ts";
import { applyCab, applyHead, applyStomp } from "./rig/index.ts";
import { applyDelay, applyReverb } from "./space.ts";

export {
  addReverbWet,
  delayTailFor,
  reverbActive,
  reverbImpulse,
  reverbTailFor,
  reverbWet,
  type ReverbWet,
} from "./space.ts";
export {
  interpolateAutomation,
  type EffectContext,
  type EffectNote,
} from "./common.ts";

/** Whether `track` has a stage that reads `EffectContext.notes`. */
export function needsEffectNotes(track: Track | undefined): boolean {
  return Boolean(track?.fx?.bloom || track?.fx?.swell);
}

type MonoStage = (
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
) => void;
type StereoStage = (
  left: Float64Array,
  right: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
) => void;

const MONO: Readonly<Partial<Record<FxName, MonoStage>>> = Object.freeze({
  djf: applyDjFilter,
  autofilter: applyAutoFilter,
  formant: applyFormant,
  vowel: applyVowel,
  crush: applyCrush,
  distort: applyDistort,
  stomp: applyStomp,
  head: applyHead,
  cab: applyCab,
  wobble: applyWobble,
  bloom: applyBloom,
  swell: applySwell,
  tremolo: applyTremolo,
  compressor: applyCompressor,
});

const STEREO: Readonly<Partial<Record<FxName, StereoStage>>> = Object.freeze({
  double: applyDouble,
  phaser: applyPhaser,
  chorus: applyChorus,
  leslie: applyLeslie,
  postgain: applyPostgain,
});

const PAN_INDEX = FX_CHAIN.indexOf("pan");

/** Mono stages, in chain order, on the track's dry voice sum. */
export function applyMonoChain(
  buffer: Float64Array,
  track: Track,
  context: EffectContext,
): void {
  for (const stage of FX_CHAIN.slice(0, PAN_INDEX)) {
    if (stage === "filter") {
      applyTrackFilter(buffer, track, context);
      continue;
    }
    const values = track.fx?.[stage as FxName];
    const apply = MONO[stage as FxName];
    if (values && apply) apply(buffer, track, values, context);
    // The patch stage: the track's effect patches (`fxPatch`) after distort.
    if (stage === "distort") context.patchStage?.(buffer);
  }
}

/**
 * Stereo stages, in chain order, after pan. A track on a shared orbit bus
 * (`sends: false`) skips delay and reverb: the bus applies them to the sum.
 * `reverb: false` stops before the reverb (the stem cache runs it apart).
 */
export function applyStereoChain(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  context: EffectContext,
  sends = true,
  reverb = sends,
): void {
  for (const stage of FX_CHAIN.slice(PAN_INDEX + 1)) {
    if (stage === "delay") {
      if (sends) applyDelay(left, right, track, context);
    } else if (stage === "reverb") {
      if (reverb) applyReverb(left, right, track, context);
    } else {
      const values = track.fx?.[stage as FxName];
      const apply = STEREO[stage as FxName];
      if (values && apply) apply(left, right, track, values, context);
    }
  }
}
