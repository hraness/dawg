/**
 * The modal percussion engine (0.6, lane f06-modal): renders a track whose
 * instrument is `"modal"` and that carries a `modal` field. Registered in
 * `src/audio/instruments.ts`; without the field the legacy tone voice plays.
 *
 * Per track: notes in onset order, at most `MAX_RESONATOR_VOICES` sounding
 * (the oldest onset is stolen with a 5 ms fade), each a `ModalBank` struck
 * once and rung for up to `MAX_RESONATOR_TAIL` seconds after note-off with
 * early stop on silence. Stealing depends only on earlier onsets, so a
 * render is prefix-stable: adding a later note never changes earlier audio
 * before that note starts.
 *
 * 0.5 hooks: tuning and note cents (`noteHz`), bends and glides
 * (`performance.cents`, faded per tick above 0.45 sr), articulation as
 * timbre only (accent and marcato harden the mallet; staccato damps sooner
 * through the shorter length), sustain pedal (longer lengths) and half
 * pedal (`performance.damp`), velocity curve and humanize (already in the
 * performed notes), and the tempo map (`context.warp`).
 */
import type { PerformedNote } from "../../core/expression.ts";
import {
  MAX_RESONATOR_TAIL,
  MAX_RESONATOR_VOICES,
  MODAL_LANE_PARAMS,
  modalSettings,
  modalTailSeconds,
  RESONATOR_TABLE_VERSION,
  type ModalSettings,
} from "../../core/resonators.ts";
import type { AutomationPoint, Track } from "../../core/score.ts";
import { noteHz } from "../../core/tuning.ts";
import { ModalBank, MODAL_BLOCK } from "./dsp/modal.ts";
import { logCosh } from "./dsp/shape.ts";
import { interpolateAutomation } from "./effects/common.ts";
import type { EngineContext, InstrumentEngine } from "./instruments.ts";
import { warpedSpan } from "./warp.ts";

/**
 * Raised-cosine fade applied to a stolen voice, seconds. At 80 ms the
 * largest per-sample gain step is pi/(2*fade samples): -61 dB at 22.05 kHz,
 * -68 dB at 48 kHz, so stealing a long gong or kempul does not click.
 */
const STEAL_FADE = 0.08;
/** Extra mallet hardness for accent and marcato. */
const ACCENT_HARDNESS = 0.2;
/**
 * Track-level safety knee: exactly linear up to KNEE, then a tanh shoulder
 * that never passes CEILING. Single notes (about 0.8 at velocity 0.8) and
 * dyads pass bit-exact; only dense velocity-1 chords reach the shoulder. A
 * six-note chord at velocity 1 sums to about 4-5 and lands under the
 * ceiling, which the centre pan and track gain keep below 0 dBFS (spec
 * test 13).
 */
export const MODAL_KNEE = 1;
const KNEE = MODAL_KNEE;
const CEILING = 1.38;
const SPAN = CEILING - KNEE;

function knee(x: number): number {
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  return Math.sign(x) * (KNEE + SPAN * Math.tanh((a - KNEE) / SPAN));
}

/** Antiderivative of `knee` (even), for first-order ADAA. */
function kneeF(x: number): number {
  const a = Math.abs(x);
  if (a <= KNEE) return 0.5 * x * x;
  return (
    0.5 * KNEE * KNEE +
    KNEE * (a - KNEE) +
    SPAN * SPAN * logCosh((a - KNEE) / SPAN)
  );
}

/**
 * The knee with first-order ADAA only inside the shoulder: while this and
 * the previous sample are both under KNEE the output is the input itself, so
 * the limiter adds no two-tap low-pass or half-sample delay to normal play.
 */
export function applyModalKnee(dry: Float64Array, samples: number): void {
  let x1 = 0;
  let F1 = 0;
  for (let index = 0; index < samples; index += 1) {
    const x = dry[index]!;
    const Fx = kneeF(x);
    if (Math.abs(x) > KNEE || Math.abs(x1) > KNEE) {
      const dx = x - x1;
      dry[index] = Math.abs(dx) < 1e-5 ? knee(0.5 * (x + x1)) : (Fx - F1) / dx;
    }
    x1 = x;
    F1 = Fx;
  }
}

type Planned = Readonly<{
  note: PerformedNote;
  start: number;
  length: number;
}>;

function span(
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

function laneOf(
  track: Track,
  param: string,
): readonly AutomationPoint[] | undefined {
  const lanes = track.fxAutomation as
    Readonly<Record<string, readonly AutomationPoint[]>> | undefined;
  const points = lanes?.[`modal-${param}`];
  return points && points.length > 0 ? points : undefined;
}

/** Renders a modal track's performed notes into `dry` (mono). */
export function renderResonatorTrack(
  dry: Float64Array,
  notes: readonly PerformedNote[],
  track: Track,
  context: EngineContext,
): void {
  const { sampleRate, samples } = context;
  const samplesPerTick = context.samplesPerTick;
  const tickAt = (index: number): number =>
    context.warp ? context.warp.tick(index) : index / samplesPerTick;
  const planned: Planned[] = notes
    .map((note) => ({ note, ...span(note, context) }))
    .filter((entry) => entry.start < samples)
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.note.pitch - b.note.pitch ||
        (a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0),
    );
  const lanes = new Map<string, readonly AutomationPoint[]>();
  for (const { param } of MODAL_LANE_PARAMS) {
    const points = laneOf(track, param);
    if (points) lanes.set(param, points);
  }
  const motorLane = lanes.get("motordepth");
  const volumeLane = track.volumeAutomation ?? [];
  const volume = Math.max(0, Math.min(1, track.volume ?? 1));
  const gainAt = (index: number): number =>
    volume *
    (volumeLane.length > 0
      ? interpolateAutomation(volumeLane, tickAt(index), 1)
      : 1);
  const seedTick = context.seedTick ?? 0;
  const base = modalSettings(track.modal);
  // An ombak pair (f061-gamelan-winds): the pengisep names its partner in
  // `pair` and sounds `ombak` Hz above the same note, single voice; the
  // partner (pengumbang) carries ombak 0. Each track renders from its own
  // field, so stems key per track.
  const paired = track.modal?.pair !== undefined;
  const banks: ModalBank[] = [];
  // Conservative end of each planned voice (its ring cap, or a steal).
  const ends: number[] = [];
  const steals: number[] = [];
  const sounding: number[] = [];
  for (let i = 0; i < planned.length; i += 1) {
    const { note, start, length } = planned[i]!;
    const onsetTick = note.startTick;
    const settings =
      lanes.size === 0
        ? base
        : clampLanes(
            modalSettings(track.modal, (param) => {
              const points = lanes.get(param);
              return points
                ? interpolateAutomation(
                    points,
                    onsetTick,
                    base[param as keyof typeof base] as number,
                  )
                : undefined;
            }),
          );
    const performance = note.performance;
    const accent =
      performance?.accent || note.articulation === "marcato"
        ? ACCENT_HARDNESS
        : 0;
    const hz = noteHz(note.pitch, note.cents, context.tuning);
    const bank = new ModalBank(
      paired ? { ...settings, ombak: 0 } : settings,
      {
        hz: paired ? hz + settings.ombak : hz,
        velocity: note.velocity,
        start: start / sampleRate,
        duration: length / sampleRate,
        seed: `${note.id}:${note.startTick + seedTick}:modal`,
        ...(accent ? { accent } : {}),
        ...(performance?.cents ? { cents: performance.cents } : {}),
        ...(motorLane
          ? {
              motordepth: (t: number) =>
                interpolateAutomation(
                  motorLane,
                  tickAt(start + t * sampleRate),
                  settings.motordepth,
                ),
            }
          : {}),
      },
      sampleRate,
      MAX_RESONATOR_TAIL,
    );
    banks.push(bank);
    ends.push(start + bank.endAt);
    steals.push(Infinity);
    // Voice stealing in onset order: drop finished voices, then steal the
    // oldest onset while the pool is full.
    for (let k = sounding.length - 1; k >= 0; k -= 1)
      if (ends[sounding[k]!]! <= start) sounding.splice(k, 1);
    while (sounding.length >= MAX_RESONATOR_VOICES) {
      const oldest = sounding.shift()!;
      steals[oldest] = start;
      ends[oldest] = Math.min(
        ends[oldest]!,
        start + Math.round(STEAL_FADE * sampleRate),
      );
    }
    sounding.push(i);
  }
  const scratch = new Float64Array(MODAL_BLOCK);
  const fade = Math.max(1, Math.round(STEAL_FADE * sampleRate));
  for (let i = 0; i < planned.length; i += 1) {
    const { note, start } = planned[i]!;
    const bank = banks[i]!;
    const stop = Math.min(samples, ends[i]!);
    const steal = steals[i]!;
    const damp = note.performance?.damp;
    const dampFrom = damp ? start + Math.round(damp.from * sampleRate) : 0;
    let at = start;
    while (at < stop) {
      const count = Math.min(MODAL_BLOCK, stop - at);
      scratch.fill(0, 0, count);
      const alive = bank.process(scratch, 0, count);
      const gain = gainAt(at);
      for (let j = 0; j < count; j += 1) {
        const index = at + j;
        let level = gain;
        if (index >= steal)
          level *=
            index - steal >= fade
              ? 0
              : 0.5 + 0.5 * Math.cos((Math.PI * (index - steal)) / fade);
        if (damp && index > dampFrom)
          level *= Math.exp(-(index - dampFrom) / (damp.tau * sampleRate));
        dry[index]! += scratch[j]! * level;
      }
      if (!alive) break;
      at += count;
    }
  }
  // Causal and stateless across renders, so the output stays prefix-stable.
  applyModalKnee(dry, samples);
}

/** Lane values land inside each parameter's range. */
function clampLanes(settings: ModalSettings): ModalSettings {
  const out: Record<string, number | string> = { ...settings };
  for (const { param, spec } of MODAL_LANE_PARAMS) {
    const value = out[param];
    if (typeof value === "number")
      out[param] = Math.max(spec.min, Math.min(spec.max, value));
  }
  return Object.freeze(out) as ModalSettings;
}

/** The modal engine as registered in `src/audio/instruments.ts`. */
export const MODAL_ENGINE: InstrumentEngine = Object.freeze({
  id: "modal",
  field: "modal",
  render(dry, _dryR, notes, track, context) {
    renderResonatorTrack(dry, notes, track, context);
  },
  tailSeconds: (track: Track, lowestPitch?: number) =>
    modalTailSeconds(track.modal, lowestPitch),
  // Undamped bars and gongs ring on after the key lifts, as struck metal does.
  ringOut: (track: Track) => modalSettings(track.modal).damp === 0,
  stereo: () => false,
  assetDigests: () => [`resonators:${RESONATOR_TABLE_VERSION}`],
});
