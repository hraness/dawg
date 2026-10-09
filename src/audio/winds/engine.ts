/**
 * The wind engine (0.6.1): renders a `wind` track's performed notes through
 * `WindVoice` waveguides.
 *
 * - Lines: with no track `glide`, a note that starts while a single
 *   earlier note is still held, and that starts alone, slurs on from it
 *   (one breath, no re-attack) as a wind player tongues only at a new
 *   phrase; notes that start together stay separate voices, so one track
 *   can carry a horn-section chord. A track `glide` keeps its own meaning
 *   (`performNotes` has already chained or split the line).
 * - Players: `players` > 1 is a section. The players are dealt over the
 *   tones that start together, top voice first, and each extra player on a
 *   tone is a seeded few cents off, a few milliseconds late and a little
 *   softer, as real section doublings are; a tone's players share its level
 *   (1/sqrt(n)).
 * - At most `MAX_WIND_VOICES` sound at once; the oldest onset is stolen
 *   with an 80 ms raised-cosine fade (largest gain step -61 dB at 22.05 kHz).
 *
 * Deterministic: every random draw comes from `seededRandom`.
 */
import type { PerformedNote } from "../../../core/expression.ts";
import {
  MAX_WIND_VOICES,
  WIND_LANE_PARAMS,
  windPresetOf,
  windSettings,
  windTailSeconds,
  type WindSettings,
} from "../../../core/resonators.ts";
import type { AutomationPoint, Track } from "../../../core/score.ts";
import { noteHz } from "../../../core/tuning.ts";
import { seededRandom } from "../dsp/rng.ts";
import { interpolateAutomation } from "../effects/common.ts";
import type { EngineContext, InstrumentEngine } from "../instruments.ts";
import { applyModalKnee } from "../resonators.ts";
import { warpedSpan } from "../warp.ts";
import { windTrim } from "./trim.ts";
import { WIND_BLOCK, WindVoice, type WindSegment } from "./voice.ts";

/** A gap this short between a line's end and the next onset still slurs. */
const SLUR_GAP_SECONDS = 0.01;

/** Fade applied to a stolen voice, seconds. */
export const WIND_STEAL_FADE = 0.08;
/** Section doublings: the widest detune (cents) and latest entry (s). */
const SECTION_CENTS = 9;
const SECTION_LATE = 0.018;

/** Breath push per articulation (accent and marcato blow harder). */
const PUSH: Readonly<Record<string, number>> = Object.freeze({
  accent: 0.15,
  marcato: 0.25,
  ghost: -0.4,
});

type Line = {
  start: number;
  length: number;
  notes: PerformedNote[];
  segments: WindSegment[];
};

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
  const points = lanes?.[`wind-${param}`];
  return points && points.length > 0 ? points : undefined;
}

/**
 * Groups performed notes into breaths: chords stay separate voices, a lone
 * note entering under a lone held note slurs on (when `legato`).
 */
export function windLines(
  notes: readonly PerformedNote[],
  context: EngineContext,
  legato: boolean,
): Line[] {
  const planned = notes
    .map((note) => ({ note, ...span(note, context) }))
    .filter((entry) => entry.start < context.samples)
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.note.pitch - a.note.pitch ||
        (a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0),
    );
  const lines: Line[] = [];
  const slurGap = Math.round(SLUR_GAP_SECONDS * context.sampleRate);
  let index = 0;
  let previous: Line[] = [];
  while (index < planned.length) {
    const at = planned[index]!.start;
    const group: typeof planned = [];
    while (index < planned.length && planned[index]!.start === at)
      group.push(planned[index++]!);
    // A note that starts where the line ends (to within a few ms, so the
    // tick-to-sample rounding of abutting notes counts) is held through:
    // a typed line of back-to-back quarters slurs, a real rest re-tongues.
    const held = previous.filter(
      (line) => line.start + line.length + slurGap > at,
    );
    const only = group[0]!;
    if (
      legato &&
      group.length === 1 &&
      held.length === 1 &&
      previous.length === 1 &&
      !only.note.performance?.cents &&
      only.note.articulation !== "staccato"
    ) {
      const line = held[0]!;
      line.notes.push(only.note);
      line.segments.push({
        at: at - line.start,
        hz: noteHz(only.note.pitch, only.note.cents, context.tuning),
      });
      line.length = only.start + only.length - line.start;
      continue;
    }
    previous = group.map(({ note, start, length }) => ({
      start,
      length,
      notes: [note],
      segments: [{ at: 0, hz: noteHz(note.pitch, note.cents, context.tuning) }],
    }));
    lines.push(...previous);
  }
  return lines;
}

type Planned = {
  voice: WindVoice;
  start: number;
  end: number;
  steal: number;
  level: number;
};

/** Renders a wind track's performed notes into `dry` (mono). */
export function renderWindTrack(
  dry: Float64Array,
  notes: readonly PerformedNote[],
  track: Track,
  context: EngineContext,
): void {
  const { sampleRate, samples } = context;
  const tickAt = (index: number): number =>
    context.warp ? context.warp.tick(index) : index / context.samplesPerTick;
  const lanes = new Map<string, readonly AutomationPoint[]>();
  for (const { param } of WIND_LANE_PARAMS) {
    const points = laneOf(track, param);
    if (points) lanes.set(param, points);
  }
  const base = windSettings(track.wind);
  const trim = windTrim(
    windPresetOf(track.wind),
    sampleRate,
    context.score.calibration ?? 0,
  );
  const players = Math.max(1, Math.round(base.players));
  const seedTick = context.seedTick ?? 0;
  const volumeLane = track.volumeAutomation ?? [];
  const volume = Math.max(0, Math.min(1, track.volume ?? 1));
  const gainAt = (index: number): number =>
    volume *
    (volumeLane.length > 0
      ? interpolateAutomation(volumeLane, tickAt(index), 1)
      : 1);
  const lines = windLines(notes, context, track.glide === undefined);
  const planned: Planned[] = [];
  // Deal the section over each onset's tones, top voice first.
  let i = 0;
  while (i < lines.length) {
    let j = i;
    while (j < lines.length && lines[j]!.start === lines[i]!.start) j += 1;
    const tones = lines.slice(i, j);
    const counts = tones.map(() => 1);
    for (let k = tones.length; k < players; k += 1)
      counts[k % tones.length]! += 1;
    tones.forEach((line, t) => {
      const head = line.notes[0]!;
      const seed = `${head.id}:${head.startTick + seedTick}`;
      const push = PUSH[head.articulation ?? ""] ?? 0;
      const count = counts[t]!;
      const random = seededRandom(`${seed}:section`);
      for (let player = 0; player < count; player += 1) {
        const cents =
          player === 0 ? 0 : SECTION_CENTS * (2 * random() - 1) || 0.5;
        const late =
          player === 0 ? 0 : Math.round(SECTION_LATE * random() * sampleRate);
        const soft = player === 0 ? 1 : 0.8 + 0.15 * random();
        const start = line.start + late;
        if (start >= samples) continue;
        const ratio = 2 ** (cents / 1200);
        const bend = head.performance?.cents;
        const voice = new WindVoice(
          base,
          {
            segments: line.segments.map((s) => ({
              at: s.at,
              hz: s.hz * ratio,
            })),
            length: Math.max(1, line.length - late),
            velocity: head.velocity,
            seed: player === 0 ? seed : `${seed}:${player}`,
            ...(push ? { push } : {}),
            ...(bend ? { cents: bend } : {}),
            ...(lanes.size > 0
              ? {
                  lane: (param: string, t: number) => {
                    const points = lanes.get(param);
                    return points
                      ? interpolateAutomation(
                          points,
                          tickAt(start + t * sampleRate),
                          base[param as keyof WindSettings] as number,
                        )
                      : undefined;
                  },
                }
              : {}),
          },
          sampleRate,
          trim,
        );
        planned.push({
          voice,
          start,
          end: start + voice.endAt,
          steal: Infinity,
          level: soft / Math.sqrt(count),
        });
      }
    });
    i = j;
  }
  planned.sort((a, b) => a.start - b.start);
  const fade = Math.max(1, Math.round(WIND_STEAL_FADE * sampleRate));
  const sounding: Planned[] = [];
  for (const entry of planned) {
    for (let k = sounding.length - 1; k >= 0; k -= 1)
      if (sounding[k]!.end <= entry.start) sounding.splice(k, 1);
    while (sounding.length >= MAX_WIND_VOICES) {
      const oldest = sounding.shift()!;
      oldest.steal = entry.start;
      oldest.end = Math.min(oldest.end, entry.start + fade);
    }
    sounding.push(entry);
  }
  const scratch = new Float64Array(WIND_BLOCK);
  for (const { voice, start, end, steal, level } of planned) {
    const stop = Math.min(samples, end);
    let at = start;
    while (at < stop) {
      const count = Math.min(WIND_BLOCK, stop - at);
      scratch.fill(0, 0, count);
      const alive = voice.process(scratch, 0, count);
      const gain = gainAt(at) * level;
      for (let k = 0; k < count; k += 1) {
        const index = at + k;
        let g = gain;
        if (index >= steal)
          g *=
            index - steal >= fade
              ? 0
              : 0.5 + 0.5 * Math.cos((Math.PI * (index - steal)) / fade);
        dry[index]! += scratch[k]! * g;
      }
      if (!alive) break;
      at += count;
    }
  }
  // The modal engine's soft knee: transparent below -3 dBFS, so a chord or
  // section does not clip; causal and stateless, so renders stay prefix-stable.
  applyModalKnee(dry, samples);
}

/** The wind engine as registered in `src/audio/instruments.ts`. */
export const WIND_ENGINE: InstrumentEngine = Object.freeze({
  id: "wind",
  field: "wind",
  render(dry, _dryR, notes, track, context) {
    renderWindTrack(dry, notes, track, context);
  },
  tailSeconds: (track: Track) => windTailSeconds(track.wind),
  stereo: () => false,
  assetDigests: (track: Track) => [`winds:1:${windPresetOf(track.wind)}`],
});
