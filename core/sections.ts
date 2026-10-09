/**
 * Song structure (0.5). Sections are named bar ranges of the score and the
 * form is the order they play in, with repeats (`A A B A`). Everything here
 * is pure: it reads a `TrackScore` and returns a new one, so the renderer,
 * the TUI, prompt commands, agent tools and the SDK share one behaviour.
 *
 * Arrangement semantics follow the arranger tracks of Logic Pro and
 * Studio One: a section owns the music inside its bars, so duplicating,
 * moving or deleting a section moves that music and ripples what follows,
 * while renaming or unmarking only touches the marker. Playback follows
 * the form when one exists; otherwise the score plays straight through and
 * each bar takes the mutes and variations of the section covering it.
 */
import { DRUM_VOICES, isDrumInstrument } from "./drums.ts";
import { FX_LANES } from "./fx.ts";
import { synthKit } from "./kits.ts";
import { resolveString } from "./strings.ts";
import { modalSettings, windSettings } from "./resonators.ts";
import { resolveSing } from "./sing.ts";
import { slicePedals, type PedalEvent, type PedalState } from "./expression.ts";
import {
  bakeClipTime,
  copyClipBars,
  deleteClipBars,
  insertClipBars,
  sliceClips,
  type ClipPiece,
} from "./clips.ts";
import {
  SCORE_LIMITS,
  withNoteCap,
  ScoreValidationError,
  TrackScore,
  isSamplerInstrument,
  wavetableOf,
  type AudioClip,
  type AutomationPoint,
  type FormEntry,
  type Note,
  type Section,
  type SectionVariation,
  type Track,
} from "./score.ts";
import {
  barStartTick,
  hasTrackTime,
  normalizeSongTime,
  performedNotes,
  timeMapFor,
  type Fermata,
  type SongTime,
  type TempoEvent,
} from "./tempo.ts";

/**
 * The song tempo map for `pieces` of the score laid end to end: each piece
 * starts at the tempo sounding at its source tick, keeps the tempo events
 * and fermatas inside it (a ramp cut by the piece glides on from that
 * tempo, and one running past its end glides to the tempo reached there),
 * and the cut score starts at the first piece's tempo. Sections need one
 * meter, so a bar-1 meter is kept as it is. Scores without a tempo map come
 * back unchanged.
 */
export function sliceSongTime(
  score: TrackScore,
  pieces: readonly { from: number; to: number; offset: number }[],
): Readonly<{ tempoBpm: number; time?: SongTime }> {
  if (!score.time?.tempo && !score.time?.fermatas)
    return {
      tempoBpm: score.tempoBpm,
      ...(score.time ? { time: score.time } : {}),
    };
  const clampBpm = (bpm: number) =>
    Math.min(SCORE_LIMITS.maxTempoBpm, Math.max(SCORE_LIMITS.minTempoBpm, bpm));
  // The written tempo: a fermata's hold belongs to its own beat and moves
  // with it, so it must not leak into the tempo restated at a seam.
  const map = timeMapFor(score);
  const bpmAtTick = (_score: TrackScore, tick: number) =>
    map ? map.tempoAt(tick) : score.tempoBpm;
  const sorted = [...pieces].sort((a, b) => a.offset - b.offset);
  const first = sorted[0];
  const tempoBpm = clampBpm(
    first && first.offset === 0 ? bpmAtTick(score, first.from) : score.tempoBpm,
  );
  const tempo: TempoEvent[] = [];
  const fermatas: Fermata[] = [];
  let current = tempoBpm;
  for (const piece of sorted) {
    const shift = piece.offset - piece.from;
    const inner = (score.time.tempo ?? []).filter(
      (event) => event.tick >= piece.from && event.tick < piece.to,
    );
    const startBpm = clampBpm(bpmAtTick(score, piece.from));
    if (
      piece.offset > 0 &&
      Math.abs(startBpm - current) > 1e-9 &&
      !inner.some((event) => event.tick === piece.from)
    )
      tempo.push({ tick: piece.offset, bpm: startBpm });
    current = startBpm;
    for (const event of inner) {
      const tick = event.tick + shift;
      if (tick < 1) {
        current = event.bpm;
        continue;
      }
      tempo.push({ ...event, tick });
      current = event.bpm;
    }
    // A ramp running on past the piece's end: glide to the tempo it has
    // reached a tick before the end, so the piece follows the curve (a
    // sub-span of a linear or exponential ramp is the same kind of ramp).
    const crossing = (score.time.tempo ?? []).find(
      (event) => event.tick >= piece.to,
    );
    const lastTick = inner.at(-1)?.tick ?? piece.from;
    if (crossing?.ramp && piece.to - 1 > lastTick) {
      const bpm = clampBpm(bpmAtTick(score, piece.to - 1));
      const tick = piece.to - 1 + shift;
      if (tick >= 1 && Math.abs(bpm - current) > 1e-9)
        tempo.push({ tick, bpm, ramp: crossing.ramp });
    }
    // The tempo at the piece's end, for the next piece's step.
    current = clampBpm(bpmAtTick(score, Math.max(piece.from, piece.to - 1)));
    for (const fermata of score.time.fermatas ?? [])
      if (fermata.tick >= piece.from && fermata.tick < piece.to)
        fermatas.push({ ...fermata, tick: fermata.tick + shift });
  }
  const time = normalizeSongTime({
    ...(tempo.length > 0 ? { tempo } : {}),
    ...(fermatas.length > 0 ? { fermatas } : {}),
    // The one meter sections allow (a compound meter held from bar 1).
    ...(score.time.meter ? { meter: score.time.meter } : {}),
  });
  return { tempoBpm, ...(time ? { time } : {}) };
}

/**
 * Tracks with their own `time` (rate, phase, cycle) placed into song ticks,
 * so sections and forms cut and repeat what those tracks actually play.
 * Later repetitions get `~p2`, `~p3` ids. Without timed tracks, or without
 * sections, the score comes back unchanged.
 */
export function bakeTrackTime(
  score: TrackScore,
  options: { always?: boolean } = {},
): TrackScore {
  if (!hasTrackTime(score)) return score;
  if (score.sections.length === 0 && !options.always) return score;
  const seen = new Map<string, number>();
  const notes = performedNotes(score).map((note) => {
    const count = (seen.get(note.id) ?? 0) + 1;
    seen.set(note.id, count);
    return {
      ...note,
      id: count === 1 ? note.id : `${note.id}~p${count}`,
      startTick: Math.round(note.startTick),
      durationTicks: Math.max(1, Math.round(note.durationTicks)),
    };
  });
  return withNoteCap(
    BAKED_NOTE_CAP,
    () =>
      new TrackScore({
        ...score.toJSON(),
        tracks: score.tracks.map((track) => {
          const { time: _time, ...rest } = bakeClipTime(track);
          return rest;
        }),
        notes,
      }),
  );
}

/**
 * Most notes a baked or arranged score may hold while it renders: a cycled
 * or phasing track repeats its notes across the song, past the stored
 * score's limit.
 */
export const BAKED_NOTE_CAP = SCORE_LIMITS.maxNotes * 64;

/** Conventional section names, offered first by `nextSectionName`. */
export const SECTION_KINDS = Object.freeze([
  "intro",
  "verse",
  "pre",
  "chorus",
  "build",
  "drop",
  "breakdown",
  "bridge",
  "outro",
] as const);

/** Longest song the arranged renderer produces, in seconds. */
export const MAX_SONG_SECONDS = 900;

/** One played pass of a form entry. */
export type FormSegment = Readonly<{
  section: Section;
  /** Index of the form entry this pass belongs to. */
  entry: number;
  /** 0-based repeat of that entry. */
  pass: number;
  /** First bar on the arranged (playback) timeline. */
  startBar: number;
  bars: number;
}>;

/**
 * Ticks per bar. Sections need one meter, which may be a compound one held
 * from bar 1 (`time.meter` bar 0, such as 6/8).
 */
export function barTicks(score: TrackScore): number {
  return score.time?.meter
    ? barStartTick(score, 1)
    : score.beatsPerBar * score.ticksPerBeat;
}

/** Beats (quarter notes) per bar in the sections' meter. */
export function barBeats(score: TrackScore): number {
  return barTicks(score) / score.ticksPerBeat;
}

/** The section called `name`, ignoring case and extra spaces. */
export function findSection(
  score: TrackScore,
  name: string,
): Section | undefined {
  const key = foldName(name);
  return score.sections.find((section) => foldName(section.name) === key);
}

function foldName(name: string): string {
  return name.trim().replace(/\s+/gu, " ").toLowerCase();
}

function requireSection(score: TrackScore, name: string): Section {
  const section = findSection(score, name);
  if (!section)
    throw new ScoreValidationError(
      `no section named ${name}${score.sections.length > 0 ? ` (sections: ${score.sections.map((s) => s.name).join(", ")})` : ""}`,
    );
  return section;
}

/** Every pass of the form in order; empty when the song has no form. */
export function formSegments(score: TrackScore): readonly FormSegment[] {
  const segments: FormSegment[] = [];
  let bar = 0;
  score.form.forEach((entry, index) => {
    const section = findSection(score, entry.section);
    if (!section) return;
    for (let pass = 0; pass < (entry.repeat ?? 1); pass += 1) {
      segments.push({
        section,
        entry: index,
        pass,
        startBar: bar,
        bars: section.bars,
      });
      bar += section.bars;
    }
  });
  return segments;
}

/** Bars playback runs through: the form's length, or the score's. */
export function arrangedBars(score: TrackScore): number {
  const segments = formSegments(score);
  if (segments.length === 0) return score.bars;
  const last = segments[segments.length - 1]!;
  return last.startBar + last.bars;
}

/** Seconds at the score tempo. */
export function barsToSeconds(score: TrackScore, bars: number): number {
  return (bars * barBeats(score) * 60) / score.tempoBpm;
}

/** Where arranged (playback) `beat` falls: the form pass and score beat. */
export function formPositionAt(
  score: TrackScore,
  beat: number,
): Readonly<{ segment?: FormSegment; index: number; scoreBeat: number }> {
  const segments = formSegments(score);
  const bpb = barBeats(score);
  if (segments.length === 0) {
    const total = score.bars * bpb;
    return { index: -1, scoreBeat: wrap(beat, total) };
  }
  const total = arrangedBars(score) * bpb;
  const at = wrap(beat, total);
  let index = segments.findIndex(
    (segment) => at < (segment.startBar + segment.bars) * bpb,
  );
  if (index < 0) index = segments.length - 1;
  const segment = segments[index]!;
  return {
    segment,
    index,
    scoreBeat: segment.section.startBar * bpb + (at - segment.startBar * bpb),
  };
}

function wrap(value: number, length: number): number {
  if (!Number.isFinite(value) || length <= 0) return 0;
  return ((value % length) + length) % length;
}

/** First arranged bar where `section` plays (its score bar without a form). */
export function arrangedStartBar(score: TrackScore, section: Section): number {
  const segment = formSegments(score).find(
    (candidate) => candidate.section.name === section.name,
  );
  return segment ? segment.startBar : section.startBar;
}

/**
 * The section governing `bar` when the score plays straight through: of the
 * sections covering it, the one that starts last (the first listed on a tie).
 */
export function sectionAtBar(
  score: TrackScore,
  bar: number,
): Section | undefined {
  let found: Section | undefined;
  for (const section of score.sections) {
    if (bar < section.startBar || bar >= section.startBar + section.bars)
      continue;
    if (!found || section.startBar > found.startBar) found = section;
  }
  return found;
}

/** True when playback differs from plain straight-through rendering. */
export function hasArrangement(score: TrackScore): boolean {
  return (
    score.form.length > 0 ||
    score.sections.some(
      (section) => section.mute !== undefined || section.vary !== undefined,
    )
  );
}

// ---------------------------------------------------------------------------
// Rendering helpers

/** Pitched tracks transpose; drum kits and one-shot samplers do not. */
function transposes(track: Track | undefined): boolean {
  if (!track) return false;
  if (isDrumInstrument(track.instrument)) return false;
  if (isSamplerInstrument(track.instrument))
    return track.sampler?.mode === "keyed";
  return true;
}

function varyNote(
  note: Note,
  variation: SectionVariation | undefined,
  track: Track | undefined,
): Note {
  if (!variation) return note;
  let { pitch, velocity } = note;
  if (variation.transpose !== undefined && transposes(track))
    pitch = Math.max(0, Math.min(127, pitch + variation.transpose));
  if (variation.gain !== undefined)
    velocity = Math.max(0, Math.min(1, velocity * variation.gain));
  return pitch === note.pitch && velocity === note.velocity
    ? note
    : { ...note, pitch, velocity };
}

/**
 * The score as it sounds straight through: notes in a section's bars take
 * its mutes and variations. Returns `score` itself when nothing changes, so
 * songs without section mutes or variations render byte-identically.
 */
export function applySectionChanges(score: TrackScore): TrackScore {
  if (
    !score.sections.some(
      (section) => section.mute !== undefined || section.vary !== undefined,
    )
  )
    return score;
  const ticks = barTicks(score);
  const tracks = new Map(score.tracks.map((track) => [track.id, track]));
  let changed = false;
  const notes: Note[] = [];
  for (const note of score.notes) {
    const section = sectionAtBar(score, Math.floor(note.startTick / ticks));
    if (section?.mute?.includes(note.trackId)) {
      changed = true;
      continue;
    }
    const varied = varyNote(
      note,
      section?.vary?.[note.trackId],
      tracks.get(note.trackId),
    );
    if (varied !== note) changed = true;
    // A held note stops where a later section mutes its track, the way a
    // form pass cuts it at the section edge.
    const startBar = Math.floor(note.startTick / ticks);
    const endTick = note.startTick + varied.durationTicks;
    let cut = varied;
    for (let bar = startBar + 1; bar * ticks < endTick; bar += 1) {
      if (sectionAtBar(score, bar)?.mute?.includes(note.trackId)) {
        cut = { ...varied, durationTicks: bar * ticks - note.startTick };
        changed = true;
        break;
      }
    }
    notes.push(cut);
  }
  // Clips (0.7): a section that mutes a track silences its clips there, its
  // variation gain scales them; a clip crossing such an edge is cut.
  const total = Math.max(
    score.bars,
    ...score.sections.map((s) => s.startBar + s.bars),
  );
  const clipTracks = score.tracks.map((track) => {
    if (!track.clips) return track;
    const pieces: ClipPiece[] = [];
    for (let bar = 0; bar < total; bar += 1) {
      const section = sectionAtBar(score, bar);
      pieces.push({
        from: bar * ticks,
        to: (bar + 1) * ticks,
        offset: bar * ticks,
        ...clipPieceState(section, track.id),
      });
    }
    // The last bar runs on, so a clip sounding past the end is not cut.
    if (pieces.length > 0)
      pieces[pieces.length - 1] = {
        ...pieces[pieces.length - 1]!,
        to: SCORE_LIMITS.maxTick + 1,
      };
    const next = withClips(track, sliceClips(track.clips, pieces, score));
    if (JSON.stringify(next.clips) !== JSON.stringify(track.clips))
      changed = true;
    return next;
  });
  if (!changed) return score;
  return new TrackScore({
    ...score.toJSON(),
    tracks: clipTracks,
    notes,
    sections: [],
    form: [],
  });
}

/** A section's mute and variation gain for one track's clips. */
function clipPieceState(
  section: Section | undefined,
  trackId: string,
): Pick<ClipPiece, "mute" | "gain"> {
  if (!section) return {};
  if (section.mute?.includes(trackId)) return { mute: true };
  const gain = section.vary?.[trackId]?.gain;
  return gain === undefined || gain === 1 ? {} : { gain };
}

/** `track` with `clips` (absent when empty). */
function withClips(
  track: Track,
  clips: readonly AudioClip[] | undefined,
): Track {
  const { clips: _clips, ...rest } = track;
  return clips && clips.length > 0 ? { ...rest, clips } : rest;
}

/** A track's clips cut to `pieces` (sections, forms, windows). */
function sliceTrackClips(
  track: Track,
  pieces: readonly ClipPiece[],
  time: TrackScore,
): Track {
  if (!track.clips) return track;
  return withClips(track, sliceClips(track.clips, pieces, time));
}

/**
 * One section as a standalone score: its bars only, notes clipped at its
 * end, automation carried across the cut, with its mutes and variations.
 * This is what a section loop plays and what each form pass renders.
 */
export function sectionScore(score: TrackScore, section: Section): TrackScore {
  const ticks = barTicks(score);
  const from = section.startBar * ticks;
  const to = from + section.bars * ticks;
  const tracks = new Map(score.tracks.map((track) => [track.id, track]));
  const notes: Note[] = [];
  for (const note of score.notes) {
    if (note.startTick < from || note.startTick >= to) continue;
    if (section.mute?.includes(note.trackId)) continue;
    const varied = varyNote(
      note,
      section.vary?.[note.trackId],
      tracks.get(note.trackId),
    );
    notes.push({
      ...varied,
      startTick: note.startTick - from,
      durationTicks: Math.max(
        1,
        Math.min(note.durationTicks, to - note.startTick),
      ),
    });
  }
  const timed = sliceSongTime(score, [{ from, to, offset: 0 }]);
  return new TrackScore({
    ...score.toJSON(),
    tempoBpm: timed.tempoBpm,
    time: timed.time ?? null,
    bars: section.bars,
    tracks: score.tracks.map((track) =>
      sliceTrackClips(
        slicePedals(
          mapAutomation(track, (points) => cropPoints(points, from, to)),
          [{ from, to, offset: 0 }],
        ),
        [{ from, to, offset: 0, ...clipPieceState(section, track.id) }],
        score,
      ),
    ),
    notes,
    sections: [],
    form: [],
  });
}

// ---------------------------------------------------------------------------
// Automation over time edits

type Points = readonly AutomationPoint[];

const TRACK_LANES = [
  "volumeAutomation",
  "panAutomation",
  "filterAutomation",
  "resonanceAutomation",
  "delayFeedbackAutomation",
  "delayMixAutomation",
  "wtAutomation",
] as const;

/** Applies `edit` to every automation lane of `track`. */
function mapAutomation(track: Track, edit: (points: Points) => Points): Track {
  const out: Record<string, unknown> = { ...track };
  let changed = false;
  for (const field of TRACK_LANES) {
    const points = track[field];
    if (!points || points.length === 0) continue;
    const next = edit(points);
    if (next !== points) {
      out[field] = next;
      changed = true;
    }
  }
  if (track.fxAutomation) {
    const lanes: Record<string, Points> = {};
    let lanesChanged = false;
    for (const [lane, points] of Object.entries(track.fxAutomation)) {
      if (!points) continue;
      const next = points.length === 0 ? points : edit(points);
      if (next !== points) lanesChanged = true;
      lanes[lane] = next;
    }
    if (lanesChanged) {
      out.fxAutomation = lanes;
      changed = true;
    }
  }
  return changed ? (out as Track) : track;
}

/** The lane value at `tick` (undefined before the first point). */
function valueAt(points: Points, tick: number): number | undefined {
  const first = points[0];
  if (!first || tick < first.tick) return undefined;
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index]!;
    if (tick > right.tick) continue;
    const left = points[index - 1]!;
    const span = right.tick - left.tick;
    return span <= 0
      ? right.value
      : left.value + ((right.value - left.value) * (tick - left.tick)) / span;
  }
  return points[points.length - 1]!.value;
}

function sortPoints(points: AutomationPoint[]): Points {
  const byTick = new Map<number, AutomationPoint>();
  for (const point of points) byTick.set(point.tick, point);
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

/** The curve over `from..to`, re-based to 0 (before the first point stays static). */
function cropPoints(points: Points, from: number, to: number): Points {
  const out: AutomationPoint[] = [];
  const start = valueAt(points, from);
  if (start !== undefined) out.push({ tick: 0, value: start });
  for (const point of points)
    if (point.tick > from && point.tick < to)
      out.push({ tick: point.tick - from, value: point.value });
  const last = points[points.length - 1];
  if (last && last.tick >= to && points[0]!.tick < to) {
    const end = valueAt(points, to);
    if (end !== undefined) out.push({ tick: to - from, value: end });
  }
  return sortPoints(out);
}

/** Remove `count` ticks at `at`: f'(t) = f(t) before `at`, f(t + count) after. */
function deletePoints(points: Points, at: number, count: number): Points {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || last.tick < at) return points;
  const out: AutomationPoint[] = points.filter((point) => point.tick < at);
  const before = out[out.length - 1];
  if (before && before.tick < at - 1)
    out.push({ tick: at - 1, value: valueAt(points, at - 1)! });
  if (first.tick < at + count) {
    const right = valueAt(points, at + count);
    if (right !== undefined) out.push({ tick: at, value: right });
  }
  for (const point of points)
    if (point.tick > at + count)
      out.push({ tick: point.tick - count, value: point.value });
  return sortPoints(out);
}

/** Open `count` ticks at `at`; the gap holds the value the curve had at `at`. */
function insertPoints(points: Points, at: number, count: number): Points {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || last.tick < at) return points;
  const out: AutomationPoint[] = [];
  const held = valueAt(points, at);
  for (const point of points)
    out.push(
      point.tick < at
        ? point
        : { tick: point.tick + count, value: point.value },
    );
  if (held !== undefined) {
    out.push({ tick: at, value: held });
    if (!points.some((point) => point.tick === at))
      out.push({ tick: at + count, value: held });
  }
  return sortPoints(out);
}

/** Copy the curve over `from..from+count` onto `to..to+count` (a blank gap). */
function copyPoints(
  points: Points,
  from: number,
  count: number,
  to: number,
): Points {
  if (points.length === 0) return points;
  const piece: AutomationPoint[] = [];
  const start = valueAt(points, from);
  if (start !== undefined) piece.push({ tick: to, value: start });
  for (const point of points)
    if (point.tick > from && point.tick < from + count)
      piece.push({ tick: point.tick - from + to, value: point.value });
  const end = valueAt(points, from + count - 1);
  if (end !== undefined && count > 1)
    piece.push({ tick: to + count - 1, value: end });
  if (piece.length === 0) return points;
  const kept = points.filter(
    (point) => point.tick < to || point.tick >= to + count,
  );
  return sortPoints([...kept, ...piece]);
}

// ---------------------------------------------------------------------------
// Ripple edits

function checkBars(bars: number): void {
  if (bars > SCORE_LIMITS.maxBars)
    throw new ScoreValidationError(
      `the song would be ${bars} bars; the limit is ${SCORE_LIMITS.maxBars}`,
      "score-limit",
    );
}

/**
 * The song tempo map, fermatas and pedal lanes for a ripple edit that lays
 * `pieces` of the score end to end: they move with the music they belong
 * to, as notes and automation do.
 */
function rippleTime(
  score: TrackScore,
  pieces: readonly { from: number; to: number; offset: number }[],
): Readonly<{
  tempoBpm: number;
  time: SongTime | null;
  pedals: (track: Track) => Track;
}> {
  const kept = pieces.filter((piece) => piece.to > piece.from);
  const timed = sliceSongTime(
    score,
    kept.map((piece) => ({
      ...piece,
      to: Math.min(piece.to, SCORE_LIMITS.maxTick + 1),
    })),
  );
  return {
    tempoBpm: timed.tempoBpm,
    time: timed.time ?? null,
    pedals: (track) => {
      if (!track.pedal && !track.softPedal && !track.sostenuto) return track;
      const out: Record<string, unknown> = { ...track };
      for (const field of ["pedal", "softPedal", "sostenuto"] as const) {
        const events = track[field];
        if (!events) continue;
        const next = ripplePedal(events, kept);
        if (next) out[field] = next;
        else delete out[field];
      }
      return out as Track;
    },
  };
}

/**
 * A pedal lane for `pieces` laid end to end with no lift at the seams (unlike
 * a render slice): each piece starts in the state its source was in, and a
 * gap left between pieces (inserted bars) holds the state before it.
 */
function ripplePedal(
  events: readonly PedalEvent[],
  pieces: readonly { from: number; to: number; offset: number }[],
): readonly PedalEvent[] | undefined {
  const byTick = new Map<number, PedalState>();
  for (const { from, to, offset } of pieces) {
    let state: PedalState = "up";
    for (const event of events) {
      if (event.tick > from) break;
      state = event.state;
    }
    byTick.set(offset, state);
    for (const event of events)
      if (event.tick > from && event.tick < to)
        byTick.set(event.tick - from + offset, event.state);
  }
  const out: PedalEvent[] = [];
  let last: PedalState = "up";
  for (const tick of [...byTick.keys()].sort((a, b) => a - b)) {
    const state = byTick.get(tick)!;
    if (state === last) continue;
    out.push({ tick, state });
    last = state;
  }
  return out.length > 0 ? out : undefined;
}

/** Insert `count` empty bars at `atBar`, shifting later music and sections. */
export function insertBars(
  score: TrackScore,
  atBar: number,
  count: number,
): TrackScore {
  if (count <= 0) return score;
  checkBars(score.bars + count);
  const ticks = barTicks(score);
  const at = atBar * ticks;
  const shift = count * ticks;
  const ripple = rippleTime(score, [
    { from: 0, to: at, offset: 0 },
    { from: at, to: Infinity, offset: at + shift },
  ]);
  return new TrackScore({
    ...score.toJSON(),
    tempoBpm: ripple.tempoBpm,
    time: ripple.time,
    bars: score.bars + count,
    tracks: score.tracks.map((track) =>
      insertClipBars(
        mapAutomation(ripple.pedals(track), (points) =>
          insertPoints(points, at, shift),
        ),
        at,
        shift,
      ),
    ),
    // A note's start and end stay with the music they sit in, so one held
    // across the insertion point sounds on through the new bars.
    notes: score.notes.map((note) =>
      note.startTick >= at
        ? { ...note, startTick: note.startTick + shift }
        : note.startTick + note.durationTicks > at
          ? { ...note, durationTicks: note.durationTicks + shift }
          : note,
    ),
    sections: score.sections.map((section) =>
      section.startBar >= atBar
        ? { ...section, startBar: section.startBar + count }
        : section.startBar + section.bars > atBar
          ? { ...section, bars: section.bars + count }
          : section,
    ),
  });
}

/** Delete bars `atBar..atBar+count`, closing the gap (sections inside go). */
export function deleteBars(
  score: TrackScore,
  atBar: number,
  count: number,
): TrackScore {
  if (!Number.isInteger(atBar) || atBar < 0 || !Number.isInteger(count))
    throw new ScoreValidationError(
      `bars to delete must start at a whole bar inside the song`,
    );
  // Only bars inside the song can go (a section may sit past its end).
  count = Math.min(atBar + count, score.bars) - atBar;
  if (count <= 0) return score;
  if (count >= score.bars)
    throw new ScoreValidationError("a song keeps at least one bar");
  const ticks = barTicks(score);
  const at = atBar * ticks;
  const end = (atBar + count) * ticks;
  const shift = count * ticks;
  // Each note's start and end stay with the music they sit in; the part
  // inside the deleted bars goes, so a note running out of them keeps its
  // tail and one running into them is cut where they start.
  const place = (tick: number) =>
    tick < at ? tick : tick < end ? at : tick - shift;
  const notes: Note[] = [];
  for (const note of score.notes) {
    const startTick = place(note.startTick);
    const stop = place(note.startTick + note.durationTicks);
    if (stop <= startTick) continue;
    notes.push(
      startTick === note.startTick && stop - startTick === note.durationTicks
        ? note
        : { ...note, startTick, durationTicks: stop - startTick },
    );
  }
  const sections: Section[] = [];
  for (const section of score.sections) {
    const from = section.startBar;
    const until = from + section.bars;
    if (until <= atBar) sections.push(section);
    else if (from >= atBar + count)
      sections.push({ ...section, startBar: from - count });
    else {
      const left = Math.max(0, atBar - from);
      const right = Math.max(0, until - (atBar + count));
      if (left + right > 0)
        sections.push({
          ...section,
          startBar: Math.min(from, atBar),
          bars: left + right,
        });
    }
  }
  const names = new Set(sections.map((section) => foldName(section.name)));
  const ripple = rippleTime(score, [
    { from: 0, to: at, offset: 0 },
    { from: end, to: Infinity, offset: at },
  ]);
  return new TrackScore({
    ...score.toJSON(),
    tempoBpm: ripple.tempoBpm,
    time: ripple.time,
    bars: score.bars - count,
    tracks: score.tracks.map((track) =>
      deleteClipBars(
        mapAutomation(ripple.pedals(track), (points) =>
          deletePoints(points, at, shift),
        ),
        at,
        end,
      ),
    ),
    notes,
    sections,
    form: score.form.filter((entry) => names.has(foldName(entry.section))),
  });
}

/** Unused note ids `prefix1`, `prefix2`, ... */
function idMaker(score: TrackScore, prefix: string): () => string {
  const used = new Set(score.notes.map((note) => note.id));
  const base = prefix.slice(0, SCORE_LIMITS.maxIdLength - 6);
  let next = 1;
  return () => {
    let id = `${base}${next}`;
    while (used.has(id)) {
      next += 1;
      id = `${base}${next}`;
    }
    used.add(id);
    next += 1;
    return id;
  };
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 24) || "s"
  );
}

/** An unused section name: `base`, `base 2`, `base 3`, ... */
export function uniqueSectionName(score: TrackScore, base: string): string {
  const clean = base.trim().replace(/\s+/gu, " ").slice(0, 28) || "section";
  if (!findSection(score, clean)) return clean;
  const stem = clean.replace(/ \d+$/u, "");
  for (let n = 2; ; n += 1) {
    const name = `${stem} ${n}`.slice(0, SCORE_LIMITS.maxSectionNameLength);
    if (!findSection(score, name)) return name;
  }
}

/** The next conventional name the song does not use yet. */
export function nextSectionName(score: TrackScore): string {
  for (const kind of SECTION_KINDS) if (!findSection(score, kind)) return kind;
  return uniqueSectionName(score, "section");
}

export type SectionInput = Readonly<{
  name?: string;
  startBar?: number;
  bars?: number;
}>;

/**
 * Mark bars as a section. Without a start it begins where the last section
 * ends; the song grows when the section runs past its end.
 */
export function addSection(
  score: TrackScore,
  input: SectionInput = {},
): TrackScore {
  const name = uniqueSectionName(score, input.name ?? nextSectionName(score));
  if (input.name !== undefined && findSection(score, input.name))
    throw new ScoreValidationError(`a section named ${input.name} exists`);
  const lastEnd = Math.max(
    0,
    ...score.sections.map((section) => section.startBar + section.bars),
  );
  const startBar = Math.max(0, input.startBar ?? lastEnd);
  // Logic's arrangement markers default to 8 bars; past the end of the
  // song a new section appends that many empty bars.
  const remaining = score.bars - startBar;
  const length = Math.max(
    1,
    input.bars ?? (remaining > 0 ? Math.min(remaining, 8) : 8),
  );
  checkBars(startBar + length);
  const grown =
    startBar + length > score.bars
      ? new TrackScore({ ...score.toJSON(), bars: startBar + length })
      : score;
  return grown.withSections(
    [...grown.sections, { name, startBar, bars: length }],
    grown.form,
  );
}

/** Rename a section; the form follows. */
export function renameSection(
  score: TrackScore,
  from: string,
  to: string,
): TrackScore {
  const section = requireSection(score, from);
  const clash = findSection(score, to);
  if (clash && clash !== section)
    throw new ScoreValidationError(`a section named ${to} exists`);
  const name = to.trim().replace(/\s+/gu, " ");
  return score.withSections(
    score.sections.map((candidate) =>
      candidate === section ? { ...candidate, name } : candidate,
    ),
    score.form.map((entry) =>
      foldName(entry.section) === foldName(section.name)
        ? { ...entry, section: name }
        : entry,
    ),
    score.loopSection === section.name ? name : score.loopSection,
  );
}

/**
 * Loop `name` in playback (the DAW loop brace over a section), or play the
 * song again with `undefined`. Export ignores it.
 */
export function loopSection(
  score: TrackScore,
  name: string | undefined,
): TrackScore {
  const section = name === undefined ? undefined : requireSection(score, name);
  return score.withSections(score.sections, score.form, section?.name ?? null);
}

/** Change a section's bars (the marker only; the music stays put). */
export function resizeSection(
  score: TrackScore,
  name: string,
  range: Readonly<{ startBar?: number; bars?: number }>,
): TrackScore {
  const section = requireSection(score, name);
  const startBar = Math.max(0, range.startBar ?? section.startBar);
  const bars = Math.max(1, range.bars ?? section.bars);
  checkBars(startBar + bars);
  const grown =
    startBar + bars > score.bars
      ? new TrackScore({ ...score.toJSON(), bars: startBar + bars })
      : score;
  return grown.withSections(
    grown.sections.map((candidate) =>
      candidate.name === section.name
        ? { ...candidate, startBar, bars }
        : candidate,
    ),
    grown.form,
  );
}

/** Remove the marker only (and its form entries); the music stays. */
export function unmarkSection(score: TrackScore, name: string): TrackScore {
  const section = requireSection(score, name);
  return score.withSections(
    score.sections.filter((candidate) => candidate !== section),
    score.form.filter(
      (entry) => foldName(entry.section) !== foldName(section.name),
    ),
  );
}

/** Delete a section with its music; later bars move up to close the gap. */
export function deleteSection(score: TrackScore, name: string): TrackScore {
  const section = requireSection(score, name);
  const marked = unmarkSection(score, section.name);
  return deleteBars(marked, section.startBar, section.bars);
}

/**
 * Duplicate a section with its music right after it (or at `toBar`),
 * shifting later bars; the copy keeps the mutes and variations.
 */
export function duplicateSection(
  score: TrackScore,
  name: string,
  options: Readonly<{ as?: string; toBar?: number }> = {},
): TrackScore {
  const section = requireSection(score, name);
  const copyName = uniqueSectionName(score, options.as ?? section.name);
  if (options.as !== undefined && findSection(score, options.as))
    throw new ScoreValidationError(`a section named ${options.as} exists`);
  const at = options.toBar ?? section.startBar + section.bars;
  if (
    !Number.isInteger(at) ||
    at < 0 ||
    at > score.bars ||
    (at > section.startBar && at < section.startBar + section.bars)
  )
    throw new ScoreValidationError(
      `a copy of ${section.name} goes at a bar 1..${score.bars + 1} outside it`,
    );
  const opened = insertBars(score, at, section.bars);
  const source =
    section.startBar >= at ? section.startBar + section.bars : section.startBar;
  const copied = copyBars(
    opened,
    source,
    section.bars,
    at,
    `${slug(copyName)}-`,
  );
  return copied.withSections(
    [...copied.sections, { ...section, name: copyName, startBar: at }],
    copied.form,
  );
}

/** Copy the music of bars `from..from+count` onto bars `to..` (replacing it). */
export function copyBars(
  score: TrackScore,
  fromBar: number,
  count: number,
  toBar: number,
  idPrefix = "copy-",
): TrackScore {
  const ticks = barTicks(score);
  const from = fromBar * ticks;
  const length = count * ticks;
  const to = toBar * ticks;
  const nextId = idMaker(score, idPrefix);
  const kept = score.notes.filter(
    (note) => note.startTick < to || note.startTick >= to + length,
  );
  const copies = score.notes
    .filter((note) => note.startTick >= from && note.startTick < from + length)
    .map((note) => ({
      ...note,
      id: nextId(),
      startTick: note.startTick - from + to,
      durationTicks: Math.max(
        1,
        Math.min(note.durationTicks, from + length - note.startTick),
      ),
    }));
  // The copied bars bring their tempo, fermatas and pedal; the music after
  // them goes on as it was.
  const ripple = rippleTime(score, [
    { from: 0, to, offset: 0 },
    { from, to: from + length, offset: to },
    { from: to + length, to: Infinity, offset: to + length },
  ]);
  return new TrackScore({
    ...score.toJSON(),
    tempoBpm: ripple.tempoBpm,
    time: ripple.time,
    tracks: score.tracks.map((track) =>
      copyClipBars(
        mapAutomation(ripple.pedals(track), (points) =>
          copyPoints(points, from, length, to),
        ),
        from,
        length,
        to,
      ),
    ),
    notes: [...kept, ...copies],
  });
}

/**
 * Move a section and its music so it starts at `toBar` (a bar of the song
 * as it is now), rippling the bars in between.
 */
export function moveSection(
  score: TrackScore,
  name: string,
  toBar: number,
): TrackScore {
  const section = requireSection(score, name);
  const start = section.startBar;
  const length = section.bars;
  if (toBar >= start && toBar <= start + length) return score;
  if (toBar < 0 || toBar > score.bars)
    throw new ScoreValidationError(`bar ${toBar + 1} is outside the song`);
  // Open a gap at the destination, copy the section into it, then delete
  // the original (which sits further right when moving earlier).
  const opened = insertBars(score, toBar, length);
  const source = toBar <= start ? start + length : start;
  const copied = copyBars(
    opened,
    source,
    length,
    toBar,
    `${slug(section.name)}-`,
  );
  const others = copied.sections.filter(
    (candidate) => candidate.name !== section.name,
  );
  const placed = copied.withSections(
    [...others, { ...section, startBar: toBar }],
    copied.form,
  );
  // Remove the original bars: its marker moved, so only the music goes.
  return deleteBars(placed, source, length);
}

/** Move a section one slot earlier (-1) or later (+1) in bar order. */
export function shiftSection(
  score: TrackScore,
  name: string,
  direction: -1 | 1,
): TrackScore {
  const section = requireSection(score, name);
  const ordered = score.sections;
  const index = ordered.indexOf(section);
  if (direction < 0) {
    const previous = ordered
      .slice(0, index)
      .reverse()
      .find((candidate) => candidate.startBar < section.startBar);
    if (!previous) return score;
    return moveSection(score, section.name, previous.startBar);
  }
  const next = ordered
    .slice(index + 1)
    .find((candidate) => candidate.startBar >= section.startBar + section.bars);
  if (!next) return score;
  return moveSection(score, section.name, next.startBar + next.bars);
}

/** Mute or unmute `trackId` inside a section. */
export function setSectionMute(
  score: TrackScore,
  name: string,
  trackId: string,
  muted: boolean,
): TrackScore {
  const section = requireSection(score, name);
  const current = new Set(section.mute ?? []);
  if (muted) current.add(trackId);
  else current.delete(trackId);
  const mute = [...current];
  return replaceSection(score, section, {
    ...omit(section, "mute"),
    ...(mute.length > 0 ? { mute } : {}),
  });
}

/** Set (or with `undefined`, clear) a track's variation inside a section. */
export function setSectionVariation(
  score: TrackScore,
  name: string,
  trackId: string,
  variation: SectionVariation | undefined,
): TrackScore {
  const section = requireSection(score, name);
  const vary: Record<string, SectionVariation> = { ...section.vary };
  if (
    variation &&
    ((variation.transpose ?? 0) !== 0 || (variation.gain ?? 1) !== 1)
  )
    vary[trackId] = variation;
  else delete vary[trackId];
  return replaceSection(score, section, {
    ...omit(section, "vary"),
    ...(Object.keys(vary).length > 0 ? { vary } : {}),
  });
}

/** Clear a section's mutes and variations. */
export function resetSection(score: TrackScore, name: string): TrackScore {
  const section = requireSection(score, name);
  return replaceSection(score, section, {
    name: section.name,
    startBar: section.startBar,
    bars: section.bars,
  });
}

function omit<T extends object, K extends keyof T>(
  value: T,
  key: K,
): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function replaceSection(
  score: TrackScore,
  section: Section,
  next: Section,
): TrackScore {
  return score.withSections(
    score.sections.map((candidate) =>
      candidate === section ? next : candidate,
    ),
    score.form,
  );
}

// ---------------------------------------------------------------------------
// Form

/**
 * Parse a form: `intro verse chorus*2 outro`, `A A B A`, or comma separated
 * when names hold spaces (`verse, chorus 2 x2`). `*n`/`xn` repeats an entry.
 */
export function parseForm(
  score: TrackScore,
  text: string,
): readonly FormEntry[] {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "none" || trimmed === "clear") return [];
  const items = trimmed.includes(",")
    ? trimmed.split(",")
    : trimmed.split(/\s+/u);
  const entries: FormEntry[] = [];
  for (const raw of items) {
    const item = raw.trim();
    if (item === "") continue;
    const match = /^(.*?)\s*(?:\*|\bx|×)\s*(\d+)$/iu.exec(item);
    let name = item;
    let repeat = 1;
    if (match && match[1]!.length > 0 && findSection(score, match[1]!)) {
      name = match[1]!;
      repeat = Number(match[2]);
    }
    const section = findSection(score, name);
    if (!section)
      throw new ScoreValidationError(
        `no section named ${name}${score.sections.length > 0 ? ` (sections: ${score.sections.map((s) => s.name).join(", ")})` : ""}`,
      );
    entries.push(
      repeat === 1
        ? { section: section.name }
        : { section: section.name, repeat },
    );
  }
  return entries;
}

/** `intro verse chorus×2 outro` (comma separated when a name has a space). */
export function formatForm(form: readonly FormEntry[]): string {
  const spaced = form.some((entry) => entry.section.includes(" "));
  return form
    .map(
      (entry) =>
        `${entry.section}${(entry.repeat ?? 1) > 1 ? `×${entry.repeat}` : ""}`,
    )
    .join(spaced ? ", " : " ");
}

/** Set the form (validated against the sections and the song length cap). */
export function withForm(
  score: TrackScore,
  form: readonly FormEntry[],
): TrackScore {
  const next = score.withSections(score.sections, form);
  const seconds = barsToSeconds(next, arrangedBars(next));
  if (seconds > MAX_SONG_SECONDS)
    throw new ScoreValidationError(
      `the form plays ${Math.round(seconds)} s; the limit is ${MAX_SONG_SECONDS} s`,
      "score-limit",
    );
  return next;
}

/** Bake the form into plain bars: the score as it plays, sections in order. */
export function flattenForm(score: TrackScore): TrackScore {
  const segments = formSegments(score);
  if (segments.length === 0) return applySectionChanges(score);
  const total = arrangedBars(score);
  checkBars(total);
  const sections: Section[] = [];
  const named = new Set<string>();
  for (const segment of segments) {
    let name = segment.section.name;
    if (named.has(foldName(name)))
      name = uniqueName(named, segment.section.name);
    named.add(foldName(name));
    sections.push({ name, startBar: segment.startBar, bars: segment.bars });
  }
  const flat = arrangedSlice(score, 0, total);
  return new TrackScore({ ...flat.toJSON(), sections });
}

/**
 * The notes the form plays from arranged bar `fromBar` up to `toBar`, at
 * arranged ticks. A note keeps its id on its first pass and gets `~2`, `~3`
 * on later ones, so every pass has a stable id however a render is windowed.
 * A note held over a section edge keeps sounding when the form plays the
 * next bars of the score straight on (verse into chorus as written); it is
 * cut at the edge only when the form jumps elsewhere, or when the next
 * section mutes its track.
 */
export function arrangedNotes(
  score: TrackScore,
  fromBar: number,
  toBar: number,
): Note[] {
  const ticks = barTicks(score);
  const tracks = new Map(score.tracks.map((track) => [track.id, track]));
  const segments = formSegments(score);
  const passes = new Map<string, number>();
  const taken = new Set<string>();
  const notes: Note[] = [];
  segments.forEach((segment, index) => {
    if (segment.startBar >= toBar) return;
    const section = segment.section;
    const sectionFrom = section.startBar * ticks;
    const sectionTo = sectionFrom + section.bars * ticks;
    const start = Math.max(segment.startBar, fromBar);
    const stop = Math.min(segment.startBar + segment.bars, toBar);
    const from = (section.startBar + start - segment.startBar) * ticks;
    const to = stop > start ? from + (stop - start) * ticks : from;
    const origin = (segment.startBar - section.startBar) * ticks;
    for (const note of score.notes) {
      if (note.startTick < sectionFrom || note.startTick >= sectionTo) continue;
      if (section.mute?.includes(note.trackId)) continue;
      const pass = (passes.get(note.id) ?? 0) + 1;
      passes.set(note.id, pass);
      if (note.startTick < from || note.startTick >= to) continue;
      const varied = varyNote(
        note,
        section.vary?.[note.trackId],
        tracks.get(note.trackId),
      );
      const hold = holdEnd(segments, index, note.trackId) * ticks;
      notes.push({
        ...varied,
        id: passId(note.id, pass, taken),
        startTick: note.startTick + origin,
        durationTicks: Math.max(
          1,
          Math.min(note.durationTicks, hold - note.startTick),
        ),
      });
    }
  });
  return notes;
}

/** Score bar where a note from pass `index` must stop: its run's end. */
function holdEnd(
  segments: readonly FormSegment[],
  index: number,
  trackId: string,
): number {
  let end = segments[index]!.section.startBar + segments[index]!.bars;
  for (let next = index + 1; next < segments.length; next += 1) {
    const section = segments[next]!.section;
    if (section.startBar !== end || section.mute?.includes(trackId)) break;
    end = section.startBar + section.bars;
  }
  return end;
}

/** `id` on a note's first pass, `id~n` on its nth. */
function passId(id: string, pass: number, taken: Set<string>): string {
  const suffix = pass > 1 ? `~${pass}` : "";
  let out = `${id.slice(0, SCORE_LIMITS.maxIdLength - suffix.length)}${suffix}`;
  // Ids near the length limit could collide once shortened.
  for (let extra = 2; taken.has(out); extra += 1) {
    const tail = `~${pass}.${extra}`;
    out = `${id.slice(0, SCORE_LIMITS.maxIdLength - tail.length)}${tail}`;
  }
  taken.add(out);
  return out;
}

/**
 * Arranged bars `fromBar..fromBar+bars` of the form as a standalone score.
 * Notes start in the first `noteBars` bars only (a render window's ring-out
 * keeps the automation that follows but no new notes); see `arrangedNotes`
 * for ids and held notes. Every pass starts its automation from the value
 * the lane has at that point of the section (or the track's static value),
 * so one section's curve never carries into the next.
 */
export function arrangedSlice(
  score: TrackScore,
  fromBar: number,
  bars: number,
  noteBars = bars,
): TrackScore {
  const ticks = barTicks(score);
  const pieces: { from: number; to: number; offset: number }[] = [];
  // Clips (0.7) are cut per section pass; a window's own edges inside a
  // pass (or where the form plays straight on) are seams, never cuts, so a
  // windowed render plays them as one pass does.
  const clipPieces: (ClipPiece & { section: Section })[] = [];
  const end = fromBar + bars;
  let previous: FormSegment | undefined;
  for (const segment of formSegments(score)) {
    const segEnd = segment.startBar + segment.bars;
    const before = previous;
    previous = segment;
    if (segEnd <= fromBar || segment.startBar >= end) continue;
    const start = Math.max(segment.startBar, fromBar);
    const stop = Math.min(segEnd, end);
    const from = (segment.section.startBar + start - segment.startBar) * ticks;
    const piece = {
      from,
      to: from + (stop - start) * ticks,
      offset: (start - fromBar) * ticks,
    };
    pieces.push(piece);
    const straight =
      before !== undefined &&
      before.section.startBar + before.bars === segment.section.startBar;
    clipPieces.push({
      ...piece,
      section: segment.section,
      ...(stop < segEnd ? { to: from + (segEnd - start) * ticks } : {}),
      ...(clipPieces.length === 0 &&
      fromBar > 0 &&
      (start > segment.startBar || straight)
        ? { seam: true }
        : {}),
    });
  }
  const shift = fromBar * ticks;
  const timed = sliceSongTime(score, pieces);
  return new TrackScore({
    ...score.toJSON(),
    tempoBpm: timed.tempoBpm,
    time: timed.time ?? null,
    bars,
    tracks: score.tracks.map((track) =>
      sliceTrackClips(
        slicePedals(sliceLanes(track, pieces), pieces),
        clipPieces.map(({ section, ...piece }) => ({
          ...piece,
          ...clipPieceState(section, track.id),
        })),
        score,
      ),
    ),
    notes: arrangedNotes(score, fromBar, fromBar + noteBars).map((note) => ({
      ...note,
      startTick: note.startTick - shift,
    })),
    sections: [],
    form: [],
  });
}

/** Each lane rebuilt from `pieces` of the original, anchored at both ends. */
function sliceLanes(
  track: Track,
  pieces: readonly { from: number; to: number; offset: number }[],
): Track {
  const slice = (points: Points, fallback: number | undefined): Points => {
    const out: AutomationPoint[] = [];
    for (const { from, to, offset } of pieces) {
      const start = valueAt(points, from) ?? fallback;
      if (start !== undefined) out.push({ tick: offset, value: start });
      for (const point of points)
        if (point.tick > from && point.tick < to)
          out.push({ tick: point.tick - from + offset, value: point.value });
      // Hold the pass's last value up to the seam so the next pass does not
      // ramp from it.
      const last = valueAt(points, to - 1) ?? fallback;
      if (last !== undefined && to - from > 1)
        out.push({ tick: offset + to - from - 1, value: last });
    }
    return sortPoints(out);
  };
  const out: Record<string, unknown> = { ...track };
  for (const field of TRACK_LANES) {
    const points = track[field];
    if (!points || points.length === 0) continue;
    out[field] = slice(points, laneFallback(track, field));
  }
  if (track.fxAutomation) {
    const lanes: Record<string, Points> = {};
    for (const [lane, points] of Object.entries(track.fxAutomation)) {
      if (!points) continue;
      lanes[lane] =
        points.length === 0 ? points : slice(points, laneFallback(track, lane));
    }
    out.fxAutomation = lanes;
  }
  return out as Track;
}

/** What the renderer plays for a lane where it has no points (its static value). */
function laneFallback(track: Track, lane: string): number | undefined {
  switch (lane) {
    case "volumeAutomation":
      return 1;
    case "panAutomation":
      return track.pan ?? 0;
    case "filterAutomation":
      return track.filter?.cutoff ?? SCORE_LIMITS.maxFilterCutoff;
    case "resonanceAutomation":
      return track.filter?.resonance ?? 0;
    case "delayFeedbackAutomation":
      return track.delay?.feedback;
    case "delayMixAutomation":
      return track.delay?.mix;
    case "wtAutomation":
      return wavetableOf(track).wt ?? 0;
  }
  const spec = FX_LANES.find((candidate) => candidate.lane === lane);
  if (!spec) return undefined;
  if (spec.effect === "string") {
    const value = resolveString(track.string)[spec.param];
    return typeof value === "number" ? value : spec.spec.default;
  }
  const source = (
    spec.effect === "reverb"
      ? track.reverb
      : spec.effect === "synth"
        ? track.synth
        : spec.effect === "keys"
          ? track.keys
          : spec.effect === "modal"
            ? track.modal && modalSettings(track.modal)
            : spec.effect === "wind"
              ? track.wind && windSettings(track.wind)
              : spec.effect === "sing"
                ? track.sing && resolveSing(track.sing)
                : (track.fx as Record<string, unknown> | undefined)?.[
                    spec.effect
                  ]
  ) as Record<string, unknown> | undefined;
  const stored = source?.[spec.param];
  return typeof stored === "number" ? stored : spec.spec.default;
}

function uniqueName(taken: ReadonlySet<string>, base: string): string {
  const stem = base.replace(/ \d+$/u, "").slice(0, 28);
  for (let n = 2; ; n += 1) {
    const name = `${stem} ${n}`;
    if (!taken.has(foldName(name))) return name;
  }
}

// ---------------------------------------------------------------------------
// Generators: builds, drops and fills, written as ordinary tracks, notes
// and automation so they show in the editor and print to song.ts.

const SNARE = DRUM_VOICES.find((voice) => voice.voice === "snare")!.pitch;
const TOM = DRUM_VOICES.find((voice) => voice.voice === "tom")!.pitch;
const TOMS = [50, 47, TOM] as const;
const KICK = DRUM_VOICES.find((voice) => voice.voice === "kick")!.pitch;
const OPEN_HAT = DRUM_VOICES.find((voice) => voice.voice === "openhat")!.pitch;
/** GM crash 1, which calibration 1+ renders as a cymbal. */
const CRASH = 49;

/** Generator tracks, reused by later builds and drops. */
export const GENERATOR_TRACKS = Object.freeze({
  riser: "riser",
  uplifter: "uplifter",
  impact: "impact",
  roll: "roll",
  fills: "fills",
} as const);

const GENERATOR_IDS: ReadonlySet<string> = new Set(
  Object.values(GENERATOR_TRACKS),
);

/** Generator tracks, including per-length uplifters (`uplifter-2`, ...). */
function isGeneratorTrack(id: string): boolean {
  return GENERATOR_IDS.has(id) || /^uplifter-\d+$/u.test(id);
}

/** Drop cut limits, in beats: 0 (none) to two bars. */
export const DROP_CUT_MIN = 0;
export function dropCutMax(score: Pick<TrackScore, "beatsPerBar">): number {
  return score.beatsPerBar * 2;
}
/** Fill length limits, in beats: half a beat to two bars. */
export const FILL_BEATS_MIN = 0.5;
export function fillBeatsMax(score: Pick<TrackScore, "beatsPerBar">): number {
  return score.beatsPerBar * 2;
}

function clampNote(
  value: number,
  min: number,
  max: number,
  what: string,
  notes: string[],
): number {
  const clamped = Math.max(min, Math.min(max, value));
  if (clamped !== value) notes.push(`${what} clamped to ${clamped}`);
  return clamped;
}

export type BarRange = Readonly<{ startBar: number; bars: number }>;

export type RangeInput = Readonly<{
  /**
   * A section name; the range is its bars, or its last `bars` bars when
   * `bars` is given.
   */
  section?: string;
  /**
   * A section to lead into: the range is the `bars` bars (default 4) just
   * before its first bar.
   */
  into?: string;
  startBar?: number;
  bars?: number;
}>;

function resolveRange(
  score: TrackScore,
  input: RangeInput,
  fallbackBars: number,
): BarRange {
  if (input.into !== undefined) {
    const section = requireSection(score, input.into);
    if (section.startBar === 0)
      throw new ScoreValidationError(
        `${section.name} starts at bar 1; nothing comes before it to build over`,
      );
    const bars = Math.max(1, Math.min(section.startBar, input.bars ?? 4));
    return { startBar: section.startBar - bars, bars };
  }
  if (input.section !== undefined) {
    const section = requireSection(score, input.section);
    if (input.bars === undefined)
      return { startBar: section.startBar, bars: section.bars };
    const bars = Math.max(1, Math.min(section.bars, input.bars));
    return { startBar: section.startBar + section.bars - bars, bars };
  }
  const bars = Math.max(1, Math.min(score.bars, input.bars ?? fallbackBars));
  const startBar = Math.max(
    0,
    Math.min(score.bars - bars, input.startBar ?? score.bars - bars),
  );
  return { startBar, bars };
}

export type BuildOptions = RangeInput &
  Readonly<{
    /** Noise riser: filtered white noise opening up and getting louder. */
    riser?: boolean;
    /** Accelerating snare roll on the kit: quarters, 8ths, 16ths, 32nds. */
    roll?: boolean;
    /** Filter sweep automation on the playing pitched tracks. */
    sweep?: boolean;
    /** Tempo-synced uplifter: a pitch-rising supersaw that lands on the drop. */
    uplifter?: boolean;
  }>;

export type GeneratorResult = Readonly<{
  score: TrackScore;
  /** What was added, for the activity line and agent replies. */
  summary: string;
}>;

function ensureTrack(
  score: TrackScore,
  id: string,
  make: () => Track | Record<string, unknown>,
): TrackScore {
  if (score.tracks.some((track) => track.id === id)) return score;
  return new TrackScore({
    ...score.toJSON(),
    tracks: [...score.tracks, make() as Track],
  });
}

function drumTrackId(score: TrackScore): string | undefined {
  return score.tracks.find(
    (track) =>
      isDrumInstrument(track.instrument) && !isGeneratorTrack(track.id),
  )?.id;
}

function withNotes(score: TrackScore, notes: readonly Note[]): TrackScore {
  if (notes.length === 0) return score;
  return new TrackScore({
    ...score.toJSON(),
    notes: [...score.notes, ...notes],
  });
}

function updateTrackFields(
  score: TrackScore,
  id: string,
  edit: (track: Track) => Track,
): TrackScore {
  return new TrackScore({
    ...score.toJSON(),
    tracks: score.tracks.map((track) =>
      track.id === id ? edit(track) : track,
    ),
  });
}

/** Replace the lane points inside `from..to` with `ramp`, keeping the curve after. */
function rampPoints(
  points: Points,
  from: number,
  to: number,
  ramp: readonly AutomationPoint[],
  after: number,
): Points {
  const resume = valueAt(points, to) ?? after;
  const kept = points.filter((point) => point.tick < from || point.tick > to);
  const out = [...kept, ...ramp];
  if (!ramp.some((point) => point.tick === to))
    out.push({ tick: to, value: resume });
  return sortPoints(out);
}

/**
 * A cutoff ramp on the octave scale (how a producer sweeps a filter):
 * `a` at `from`, `b` just before `to`, several points per beat so the
 * linear interpolation between points stays close to the curve.
 */
function expRamp(
  score: TrackScore,
  from: number,
  to: number,
  a: number,
  b: number,
): AutomationPoint[] {
  const last = to - 1;
  const steps = Math.max(
    2,
    Math.min(64, Math.round(((last - from) / score.ticksPerBeat) * 2)),
  );
  const out: AutomationPoint[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    out.push({
      tick: Math.round(from + (last - from) * t),
      value: Math.round(a * (b / a) ** t * 10) / 10,
    });
  }
  return out.filter(
    (point, index) => index === 0 || point.tick !== out[index - 1]!.tick,
  );
}

/** Seconds of `ticks` at the score tempo. */
function ticksToSeconds(score: TrackScore, ticks: number): number {
  return (ticks / score.ticksPerBeat) * (60 / score.tempoBpm);
}

/**
 * A build over a section (or bars): noise riser, accelerating snare roll,
 * filter sweep and uplifter, all landing on the bar after the range.
 */
export function generateBuild(
  score: TrackScore,
  options: BuildOptions = {},
): GeneratorResult {
  const range = resolveRange(score, options, Math.min(4, score.bars));
  const ticks = barTicks(score);
  const from = range.startBar * ticks;
  const to = (range.startBar + range.bars) * ticks;
  const length = to - from;
  const parts: string[] = [];
  let next = score;
  const nextId = idMaker(score, `build${range.startBar + 1}-`);

  if (options.riser ?? true) {
    next = ensureTrack(next, GENERATOR_TRACKS.riser, () => ({
      id: GENERATOR_TRACKS.riser,
      name: "riser",
      instrument: "white",
      volume: 0.55,
      pan: 0,
      muted: false,
      volumeAutomation: [],
      panAutomation: [],
      filter: { cutoff: 300, resonance: 0.35 },
      synth: { attack: 0.01, release: 0.25 },
    }));
    next = updateTrackFields(next, GENERATOR_TRACKS.riser, (track) => ({
      ...track,
      filterAutomation: rampPoints(
        track.filterAutomation ?? [],
        from,
        to,
        expRamp(score, from, to, 300, 12_000),
        300,
      ),
      volumeAutomation: rampPoints(
        track.volumeAutomation,
        from,
        to,
        [
          { tick: from, value: 0.08 },
          { tick: to - 1, value: 0.8 },
        ],
        0.08,
      ),
    }));
    next = withNotes(next, [
      {
        id: nextId(),
        trackId: GENERATOR_TRACKS.riser,
        startTick: from,
        durationTicks: length,
        pitch: 60,
        velocity: 0.9,
      },
    ]);
    parts.push("noise riser");
  }

  if (options.roll ?? true) {
    let drums = drumTrackId(next);
    if (!drums) {
      next = ensureTrack(next, GENERATOR_TRACKS.roll, () => ({
        id: GENERATOR_TRACKS.roll,
        name: "roll",
        instrument: "kit",
        volume: 0.8,
        pan: 0,
        muted: false,
        volumeAutomation: [],
        panAutomation: [],
      }));
      drums = GENERATOR_TRACKS.roll;
    }
    const taken = new Set(
      next.notes
        .filter((note) => note.trackId === drums && note.pitch === SNARE)
        .map((note) => note.startTick),
    );
    const roll: Note[] = [];
    const stage = length / 4;
    for (let index = 0; index < 4; index += 1) {
      const step = Math.max(1, Math.round(score.ticksPerBeat / 2 ** index));
      const start = Math.round(from + index * stage);
      const end = Math.round(from + (index + 1) * stage);
      for (let tick = start; tick < end; tick += step) {
        if (taken.has(tick)) continue;
        taken.add(tick);
        const progress = (tick - from) / length;
        roll.push({
          id: nextId(),
          trackId: drums,
          startTick: tick,
          durationTicks: Math.max(1, Math.floor(step / 2)),
          pitch: SNARE,
          velocity: Math.round((0.3 + 0.7 * progress) * 1000) / 1000,
        });
      }
    }
    next = withNotes(next, roll);
    parts.push(`snare roll (${roll.length} hits)`);
  }

  if (options.sweep ?? true) {
    const playing = new Set(
      next.notes
        .filter((note) => note.startTick >= from && note.startTick < to)
        .map((note) => note.trackId),
    );
    const swept: string[] = [];
    for (const track of next.tracks) {
      if (isGeneratorTrack(track.id) || !playing.has(track.id)) continue;
      if (isDrumInstrument(track.instrument)) continue;
      if (track.filter?.type === "bpf") continue;
      const highPass = !track.filter || track.filter.type === "hpf";
      const cutoff = track.filter?.cutoff ?? 20;
      const ramp = highPass
        ? expRamp(score, from, to, cutoff, Math.max(cutoff, 1_200))
        : expRamp(
            score,
            from,
            to,
            Math.max(20, Math.round(cutoff / 10)),
            cutoff,
          );
      next = updateTrackFields(next, track.id, (current) => ({
        ...current,
        filter: current.filter ?? { cutoff: 20, resonance: 0.1, type: "hpf" },
        filterAutomation: rampPoints(
          current.filterAutomation ?? [],
          from,
          to,
          ramp,
          cutoff,
        ),
      }));
      swept.push(track.name);
    }
    if (swept.length > 0) parts.push(`filter sweep on ${swept.join(", ")}`);
  }

  if (options.uplifter ?? true) {
    // A pitch envelope rises over the uplifter, so its length is real time:
    // the last whole bars of the range that fit in 10 s (synth pattack max).
    const barSeconds = ticksToSeconds(score, ticks);
    const fit = Math.max(1, Math.min(range.bars, Math.floor(10 / barSeconds)));
    const duration =
      barSeconds > 10 ? Math.floor((10 / barSeconds) * ticks) : fit * ticks;
    const seconds = Math.min(10, ticksToSeconds(score, duration));
    // The rise lives in the track's synth envelope, so each length gets
    // its own uplifter track; builds of the same length share one.
    const placed = uplifterTrack(next, seconds);
    next = placed.score;
    const uplifterId = placed.id;
    next = withNotes(next, [
      {
        id: nextId(),
        trackId: uplifterId,
        startTick: to - duration,
        durationTicks: duration,
        pitch: 60,
        velocity: 0.7,
      },
    ]);
    parts.push(`uplifter (${round3(seconds)} s)`);
  }

  return {
    score: next,
    summary: `build over bars ${range.startBar + 1}–${range.startBar + range.bars}: ${parts.join(", ") || "nothing"}`,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The uplifter track whose pitch rise lasts `seconds` (the rise lives in the
 * track's synth envelope, so each length gets its own track and builds of
 * the same length share one), created when missing.
 */
function uplifterTrack(
  score: TrackScore,
  seconds: number,
): { score: TrackScore; id: string } {
  const pattack = round3(seconds);
  const existing = score.tracks.find(
    (track) =>
      (track.id === GENERATOR_TRACKS.uplifter ||
        /^uplifter-\d+$/u.test(track.id)) &&
      track.synth?.pattack === pattack,
  );
  let id = existing?.id ?? GENERATOR_TRACKS.uplifter;
  if (!existing && score.tracks.some((track) => track.id === id)) {
    let n = 2;
    while (score.tracks.some((track) => track.id === `uplifter-${n}`)) n += 1;
    id = `uplifter-${n}`;
  }
  const next = ensureTrack(score, id, () => ({
    id,
    name: id === GENERATOR_TRACKS.uplifter ? "uplifter" : id,
    instrument: "supersaw",
    volume: 0.3,
    pan: 0,
    muted: false,
    volumeAutomation: [],
    panAutomation: [],
    filter: { cutoff: 5_000, resonance: 0.2 },
    synth: {
      penv: 24,
      pattack,
      psustain: 1,
      attack: round3(seconds / 2),
      release: 0.1,
    },
  }));
  return { score: next, id };
}

function isUplifter(id: string): boolean {
  return id === GENERATOR_TRACKS.uplifter || /^uplifter-\d+$/u.test(id);
}

export type DropOptions = Readonly<{
  /** The section the drop lands on (its first bar). */
  section?: string;
  /** Or the bar it lands on, 0-based. */
  bar?: number;
  /** Beats of silence before the drop (0 disables), default 1. */
  cut?: number;
  /** Impact hit on the downbeat, default on. */
  impact?: boolean;
}>;

/** A drop: a pre-drop cut (silence) and an impact hit on the downbeat. */
export function generateDrop(
  score: TrackScore,
  options: DropOptions = {},
): GeneratorResult {
  const parts: string[] = [];
  let bar: number;
  if (options.section !== undefined)
    bar = requireSection(score, options.section).startBar;
  else if (options.bar !== undefined)
    bar = Math.max(0, Math.min(score.bars - 1, options.bar));
  else {
    // Default: the section named drop, else chorus, that has bars before it.
    const target =
      score.sections.find(
        (s) => foldName(s.name) === "drop" && s.startBar > 0,
      ) ??
      score.sections.find(
        (s) => foldName(s.name) === "chorus" && s.startBar > 0,
      );
    // Else the bar after the last build (its layers land on that bar).
    const built = Math.max(
      0,
      ...score.notes
        .filter((note) => /^build\d+-/u.test(note.id))
        .map((note) => note.startTick + note.durationTicks),
    );
    const after = Math.ceil(built / barTicks(score));
    if (target) bar = target.startBar;
    else if (built > 0 && after <= SCORE_LIMITS.maxBars - 1) {
      bar = after;
      // A build at the song's end: add the bar the drop lands on.
      if (bar >= score.bars) {
        score = new TrackScore({ ...score.toJSON(), bars: bar + 1 });
        parts.push(`added bar ${bar + 1}`);
      }
    } else
      throw new ScoreValidationError(
        "drop needs a section or a bar: drop chorus, or drop at 17",
      );
  }
  const ticks = barTicks(score);
  const at = bar * ticks;
  const cutBeats = clampNote(
    options.cut ?? 1,
    DROP_CUT_MIN,
    dropCutMax(score),
    "cut",
    parts,
  );
  const cut = Math.round(cutBeats * score.ticksPerBeat);
  let next = score;
  if (cut > 0 && at > 0) {
    const from = Math.max(0, at - cut);
    const notes: Note[] = [];
    const clipped: Note[] = [];
    for (const note of next.notes) {
      if (note.startTick >= from && note.startTick < at) continue;
      if (note.startTick < from && note.startTick + note.durationTicks > from) {
        const cut = { ...note, durationTicks: from - note.startTick };
        notes.push(cut);
        if (isUplifter(note.trackId)) clipped.push(cut);
      } else notes.push(note);
    }
    next = new TrackScore({ ...next.toJSON(), notes });
    // A clipped uplifter moves to a track whose rise ends at the cut, so it
    // still peaks right where the silence starts.
    for (const note of clipped) {
      const seconds = Math.min(10, ticksToSeconds(next, note.durationTicks));
      const placed = uplifterTrack(next, seconds);
      next = new TrackScore({
        ...placed.score.toJSON(),
        notes: placed.score.notes.map((candidate) =>
          candidate.id === note.id
            ? { ...candidate, trackId: placed.id }
            : candidate,
        ),
      });
    }
    if (clipped.length > 0) {
      const used = new Set(next.notes.map((note) => note.trackId));
      next = new TrackScore({
        ...next.toJSON(),
        tracks: next.tracks.filter(
          (track) => !isUplifter(track.id) || used.has(track.id),
        ),
      });
    }
    parts.push(`${cutBeats}-beat cut`);
  }
  if (options.impact ?? true) {
    next = ensureTrack(next, GENERATOR_TRACKS.impact, () => ({
      id: GENERATOR_TRACKS.impact,
      name: "impact",
      instrument: "sine",
      volume: 0.9,
      pan: 0,
      muted: false,
      volumeAutomation: [],
      panAutomation: [],
      synth: {
        penv: 24,
        pattack: 0,
        pdecay: 0.25,
        psustain: 0,
        attack: 0.001,
        decay: 1.8,
        sustain: 0,
        release: 0.6,
        noise: 0.4,
      },
    }));
    const nextId = idMaker(next, `drop${bar + 1}-`);
    const exists = next.notes.some(
      (note) =>
        note.trackId === GENERATOR_TRACKS.impact && note.startTick === at,
    );
    if (!exists)
      next = withNotes(next, [
        {
          id: nextId(),
          trackId: GENERATOR_TRACKS.impact,
          startTick: at,
          durationTicks: Math.min(ticks, Math.max(1, next.bars * ticks - at)),
          pitch: 33,
          velocity: 1,
        },
      ]);
    parts.push("impact");
  }
  return {
    score: next,
    summary: `drop at bar ${bar + 1}: ${parts.join(", ") || "nothing"}`,
  };
}

export type FillStyle = "toms" | "roll" | "kick";

export const FILL_STYLES: readonly FillStyle[] = Object.freeze([
  "toms",
  "roll",
  "kick",
]);

export type FillOptions = Readonly<{
  /**
   * Fill leading into this section (on the bars before its first bar);
   * without it, at every section boundary.
   */
  section?: string;
  /** Or fill leading into this bar, 0-based. */
  bar?: number;
  /** Beats the fill lasts, default 1. */
  beats?: number;
  style?: FillStyle;
  /**
   * Crash with kick on the next downbeat, default on: GM 49 on a
   * calibrated song's synth kit, else an open hat.
   */
  crash?: boolean;
}>;

/** Drum fills at section boundaries: 16ths that replace the groove there. */
export function generateFill(
  score: TrackScore,
  options: FillOptions = {},
): GeneratorResult {
  const ticks = barTicks(score);
  let ends: number[];
  if (options.section !== undefined) {
    const section = requireSection(score, options.section);
    if (section.startBar === 0)
      throw new ScoreValidationError(
        `${section.name} starts at bar 1; a fill leads into a later section`,
      );
    ends = [section.startBar];
  } else if (options.bar !== undefined) {
    ends = [Math.max(1, Math.min(score.bars, options.bar))];
  } else {
    const boundaries = new Set<number>();
    for (const section of score.sections) {
      const end = section.startBar + section.bars;
      if (end < score.bars || score.form.length > 0) boundaries.add(end);
    }
    ends = [...boundaries].sort((a, b) => a - b);
    if (ends.length === 0) ends = [score.bars];
  }
  let next = score;
  let drums = drumTrackId(next);
  if (!drums) {
    next = ensureTrack(next, GENERATOR_TRACKS.fills, () => ({
      id: GENERATOR_TRACKS.fills,
      name: "fills",
      instrument: "kit",
      volume: 0.8,
      pan: 0,
      muted: false,
      volumeAutomation: [],
      panAutomation: [],
    }));
    drums = GENERATOR_TRACKS.fills;
  }
  const style = options.style ?? "toms";
  // Sample kits and legacy songs have no cymbal voice: keep the open hat.
  const kit = next.tracks.find((track) => track.id === drums)?.kit;
  const crash =
    (next.calibration ?? 0) >= 1 && (kit === undefined || synthKit(kit))
      ? CRASH
      : OPEN_HAT;
  const clamped: string[] = [];
  const beats = clampNote(
    options.beats ?? 1,
    FILL_BEATS_MIN,
    fillBeatsMax(score),
    "beats",
    clamped,
  );
  const span = Math.round(beats * score.ticksPerBeat);
  const step = Math.max(1, Math.round(score.ticksPerBeat / 4));
  const nextId = idMaker(next, "fill-");
  const fill: Note[] = [];
  const clear: Array<[number, number]> = [];
  for (const endBar of ends) {
    const end = endBar * ticks;
    const from = Math.max(0, end - span);
    clear.push([from, end]);
    let index = 0;
    const hits = Math.max(1, Math.round((end - from) / step));
    for (let tick = from; tick < end; tick += step, index += 1) {
      const progress = hits <= 1 ? 1 : index / (hits - 1);
      const pitch =
        style === "roll"
          ? SNARE
          : style === "kick"
            ? index % 2 === 0
              ? KICK
              : SNARE
            : progress < 0.25
              ? SNARE
              : // High, mid, low tom down the fill (GM 50/47/45); a
                // calibrated song pitches them, older songs fold them.
                TOMS[Math.min(2, Math.floor(((progress - 0.25) / 0.75) * 3))]!;
      fill.push({
        id: nextId(),
        trackId: drums,
        startTick: tick,
        durationTicks: Math.max(1, Math.floor(step / 2)),
        pitch,
        velocity: Math.round((0.55 + 0.45 * progress) * 1000) / 1000,
      });
    }
    if ((options.crash ?? true) && end < next.bars * ticks)
      for (const pitch of [crash, KICK])
        fill.push({
          id: nextId(),
          trackId: drums,
          startTick: end,
          durationTicks: step,
          pitch,
          velocity: 1,
        });
  }
  const crashTicks = new Set(
    fill
      .filter((note) =>
        clear.every(
          ([from, end]) => note.startTick < from || note.startTick >= end,
        ),
      )
      .map((note) => `${note.startTick}:${note.pitch}`),
  );
  const notes = next.notes.filter((note) => {
    if (note.trackId !== drums) return true;
    if (
      clear.some(
        ([from, end]) => note.startTick >= from && note.startTick < end,
      )
    )
      return false;
    return !crashTicks.has(`${note.startTick}:${note.pitch}`);
  });
  next = new TrackScore({ ...next.toJSON(), notes: [...notes, ...fill] });
  return {
    score: next,
    summary: `${style} fill${ends.length > 1 ? "s" : ""} into bar${ends.length > 1 ? "s" : ""} ${ends.map((bar) => bar + 1).join(", ")}${clamped.length ? ` (${clamped.join(", ")})` : ""}`,
  };
}
