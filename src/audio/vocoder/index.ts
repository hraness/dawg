/**
 * The vocoder stage and its built-in carrier (0.7). `applyVocoder` runs
 * right after a carrier track's voice renders into `dry` (and `dryR`), before
 * its FX_CHAIN: the modulator (another track's tap) shapes the carrier
 * through a channel bank or an LPC talkbox. Output gain is fixed by the
 * layout times `gain`, then a stateless soft peak guard, then `mix`; nothing
 * is measured over the render span, so a window equals the full render.
 * `VOCODER_ENGINE` plays instrument `vocoder`: a saw, supersaw, pulse or
 * noise carrier following the track's notes, the song's chords or a drone.
 */
import type { PerformedNote } from "../../../core/expression.ts";
import type { AutomationPoint, Track } from "../../../core/score.ts";
import {
  resolveVocoder,
  vocoderTailSeconds,
  VOCODER_INSTRUMENT,
  VOCODER_LANE_PARAMS,
  type ResolvedVocoder,
} from "../../../core/vocoder.ts";
import { seedHash } from "../dsp/rng.ts";
import { interpolateAutomation } from "../effects/common.ts";
import { chordAt, chordTimeline } from "../granular.ts";
import type { EngineContext, InstrumentEngine } from "../instruments.ts";
import type { RenderContext } from "../wav.ts";
import { warpedSpan } from "../warp.ts";
import { channelVocode } from "./bank.ts";
import {
  chordSpans,
  noteSpans,
  renderCarrierSpan,
  type CarrierSpan,
} from "./carrier.ts";
import {
  blockCurve,
  type VocoderControl,
  type VocoderCurves,
} from "./control.ts";
import { talkboxVocode } from "./talkbox.ts";
import { quietHold } from "../dsp/follow.ts";

export { autoGateDb } from "../dsp/follow.ts";

/** Stateless soft knee: identity below 0.9, ceiling 1.0 (window-safe). */
export function peakGuard(x: Float64Array): void {
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i]!;
    const a = Math.abs(v);
    if (a > 0.9) x[i] = Math.sign(v) * (0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1));
  }
}

type LaneContext = Pick<
  RenderContext,
  "sampleRate" | "samplesPerTick" | "warp" | "seedSeconds"
>;

/** Absolute song sample of a render's index 0. */
export function originOf(
  context: Pick<RenderContext, "sampleRate" | "seedSeconds">,
): number {
  return Math.round((context.seedSeconds ?? 0) * context.sampleRate);
}

/** The noise seed: the stored one, else a hash of the track id. */
export function vocoderSeed(track: Track, settings: ResolvedVocoder): number {
  return settings.seed ?? seedHash(`vocoder:${track.id}`);
}

function laneOf(
  track: Track,
  param: string,
): readonly AutomationPoint[] | undefined {
  const lanes = track.fxAutomation as
    Readonly<Record<string, readonly AutomationPoint[]>> | undefined;
  const points = lanes?.[`vocoder-${param}`];
  return points && points.length > 0 ? points : undefined;
}

function tickAt(context: LaneContext, index: number): number {
  return context.warp
    ? context.warp.tick(Math.max(0, index))
    : index / context.samplesPerTick;
}

/** The control values for one render: settings, lane curves, hold. */
export function vocoderControl(
  track: Track,
  n: number,
  context: LaneContext,
  gateDb: number,
  mod?: Float64Array,
): VocoderControl {
  const settings = resolveVocoder(track.vocoder);
  const origin = originOf(context);
  const curves: Record<string, Float64Array> = {};
  let hold: Uint8Array | undefined;
  for (const { param } of VOCODER_LANE_PARAMS) {
    const points = laneOf(track, param);
    if (!points) continue;
    const fallback =
      param === "freeze"
        ? settings.freeze
          ? 1
          : 0
        : (settings as Record<string, unknown>)[param];
    const curve = blockCurve(n, origin, (index) =>
      interpolateAutomation(points, tickAt(context, index), fallback as number),
    );
    if (param === "freeze") {
      hold = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) hold[i] = curve[i]! >= 0.5 ? 1 : 0;
    } else curves[param] = curve;
  }
  // A static freeze holds the last sung vowel through every rest (a hold
  // from sample 0 would freeze the silence before the voice comes in).
  if (!hold && settings.freeze)
    hold = mod
      ? quietHold(mod, n, context.sampleRate, gateDb)
      : new Uint8Array(n).fill(1);
  return {
    settings,
    sampleRate: context.sampleRate,
    origin,
    seed: vocoderSeed(track, settings),
    gateDb,
    curves: curves as VocoderCurves,
    ...(hold ? { hold } : {}),
  };
}

/**
 * Vocodes `dry` (and `dryR`) in place with modulator `mod` (the source's
 * mono tap over the same span, plus any lookahead past it).
 */
export function applyVocoder(
  dry: Float64Array,
  dryR: Float64Array | undefined,
  mod: Float64Array,
  track: Track,
  context: LaneContext,
  gateDb: number,
): void {
  const n = dry.length;
  const cars = dryR ? [dry, dryR] : [dry];
  const padded =
    mod.length >= n
      ? mod
      : (() => {
          const out = new Float64Array(n);
          out.set(mod);
          return out;
        })();
  const control = vocoderControl(track, n, context, gateDb, padded);
  const outs =
    control.settings.mode === "talkbox"
      ? talkboxVocode(padded, cars, control)
      : channelVocode(padded, cars, control);
  const { curves, settings } = control;
  outs.forEach((out, c) => {
    const car = cars[c]!;
    const gain = curves.gain;
    if (gain || settings.gain !== 0) {
      const fixed = 10 ** (settings.gain / 20);
      for (let i = 0; i < n; i += 1)
        out[i] = out[i]! * (gain ? 10 ** (gain[i]! / 20) : fixed);
    }
    peakGuard(out);
    const mix = curves.mix;
    if (mix || settings.mix < 1)
      for (let i = 0; i < n; i += 1) {
        const m = mix ? mix[i]! : settings.mix;
        out[i] = out[i]! * m + car[i]! * (1 - m);
      }
    car.set(out.subarray(0, n));
  });
}

function noteSpanOf(
  note: PerformedNote,
  context: EngineContext,
): { start: number; length: number } {
  if (context.warp)
    return warpedSpan(context.warp, note.startTick, note.durationTicks);
  const perTick =
    (60 * context.sampleRate) / (context.tempoBpm * context.ticksPerBeat);
  return {
    start: Math.max(0, Math.floor(note.startTick * perTick)),
    length: Math.max(1, Math.floor(note.durationTicks * perTick)),
  };
}

function sampleAtTick(context: EngineContext, tick: number): number {
  if (context.warp) return warpedSpan(context.warp, tick, 0).start;
  return Math.max(0, Math.floor(tick * context.samplesPerTick));
}

type ChordChange = { start: number; end: number; pcs: readonly number[] };

const samePcs = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((pc, index) => pc === b[index]);

/**
 * Chord changes as the carrier holds them: neighbours with the same pitch
 * classes join (a staccato bass under a held chord never re-strikes the
 * pad), and a silence shorter than `hold` samples holds the chord before it.
 */
export function mergeChordChanges(
  changes: readonly ChordChange[],
  hold: number,
): ChordChange[] {
  const merged: ChordChange[] = [];
  for (const change of changes) {
    if (change.end <= change.start) continue;
    const last = merged[merged.length - 1];
    if (
      last &&
      (samePcs(last.pcs, change.pcs) ||
        (change.pcs.length === 0 &&
          last.pcs.length > 0 &&
          change.end - change.start < hold))
    ) {
      last.end = change.end;
      continue;
    }
    merged.push({ ...change });
  }
  return merged;
}

/** The built-in carrier's spans for a track. */
export function carrierSpans(
  notes: readonly PerformedNote[],
  track: Track,
  settings: ResolvedVocoder,
  context: EngineContext,
): CarrierSpan[] {
  const seed = vocoderSeed(track, settings);
  if (settings.follow === "drone")
    return [
      {
        start: 0,
        length: context.samples,
        pitches: [settings.root],
        velocity: 0.8,
        seed,
        absolute: true,
      },
    ];
  if (settings.follow === "chords") {
    const timeline = chordTimeline(context.score);
    const changes: { start: number; end: number; pcs: readonly number[] }[] =
      [];
    const ticks = [0, ...timeline.ticks.filter((tick) => tick > 0)];
    ticks.forEach((tick, index) => {
      const next = ticks[index + 1];
      changes.push({
        start: sampleAtTick(context, tick),
        end: next === undefined ? context.samples : sampleAtTick(context, next),
        pcs: chordAt(timeline, tick),
      });
    });
    return chordSpans(
      mergeChordChanges(changes, Math.round(0.05 * context.sampleRate)),
      settings.root,
      seed,
    );
  }
  return noteSpans(
    notes,
    (note) => noteSpanOf(note, context),
    (note) => seedHash(`${seed}:${note.id}`),
  ).map((span, index) => {
    const cents = notes[index]!.cents;
    if (!cents) return span;
    const curve = span.cents;
    return {
      ...span,
      cents: curve ? (t: number) => cents + curve(t) : () => cents,
    };
  });
}

/** Instrument `vocoder`: the built-in carrier (its field is `vocoder`). */
export const VOCODER_ENGINE: InstrumentEngine = {
  id: VOCODER_INSTRUMENT,
  field: "vocoder",
  render(dry, dryR, notes, track, context) {
    const settings = resolveVocoder(track.vocoder);
    const origin = originOf(context);
    for (const span of carrierSpans(notes, track, settings, context))
      renderCarrierSpan(dry, dryR, span, settings, {
        sampleRate: context.sampleRate,
        origin,
        seed: span.seed,
        ...(context.tuning ? { tuning: context.tuning } : {}),
      });
  },
  tailSeconds(track) {
    return vocoderTailSeconds(track.vocoder);
  },
  stereo(track) {
    return resolveVocoder(track.vocoder).carrier === "supersaw";
  },
};
