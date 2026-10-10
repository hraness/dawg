/**
 * Range edits (op1-ux §6): copy, move, clear, paste and reverse bars of one
 * track or of all of them, plus the rule for which bars a gesture acts on.
 * Everything is pure: it reads a `TrackScore` and returns a new one, so the
 * prompt, the menu, the agent (typing the commands) and the SDK share one
 * behaviour.
 *
 * - A range is whole bars, 0-based like sections (`{ startBar, bars }`).
 * - The range a gesture acts on is the loop range, else the section under
 *   the playhead, else the bar under it (`rangeOf`).
 * - Copy and paste overwrite the destination; `merge` overdubs it and
 *   `insert` opens new bars first (sections, clips, automation and tempo
 *   points after it move right). Copy never touches tempo.
 * - Clear leaves silence; the bars stay. Closing a gap is `deleteBars`.
 * - A paste into bars of a different meter is refused.
 */
import { newId } from "./ids.ts";
import { barStartTick, meterSegments, meterLabel } from "./tempo.ts";
import {
  checkBars,
  deleteBars,
  findSection,
  insertBars,
  mapAutomation,
  sectionAtBar,
  sortPoints,
  TRACK_LANES,
  valueAt,
  type Points,
} from "./sections.ts";
import {
  SCORE_LIMITS,
  ScoreValidationError,
  TrackScore,
  type AudioClip,
  type AutomationPoint,
  type Note,
  type Track,
} from "./score.ts";

/** Whole bars from `startBar` (0-based). */
export type BarRange = Readonly<{ startBar: number; bars: number }>;

/** Where a resolved range came from (the status line names it). */
export type RangeSource = "loop" | "section" | "bar" | "typed";

export type ResolvedRange = Readonly<{
  range: BarRange;
  source: RangeSource;
  /** The section, when the range is one. */
  section?: string;
}>;

/** What a gesture acts on: the loop range, the section under the playhead, the bar. */
export function rangeOf(score: TrackScore, playheadBar: number): ResolvedRange {
  if (score.loop) return { range: score.loop, source: "loop" };
  const bar = Math.max(0, Math.min(score.bars - 1, Math.floor(playheadBar)));
  if (score.loopSection) {
    const looped = findSection(score, score.loopSection);
    if (looped)
      return {
        range: { startBar: looped.startBar, bars: looped.bars },
        source: "loop",
        section: looped.name,
      };
  }
  const section = sectionAtBar(score, bar);
  if (section)
    return {
      range: { startBar: section.startBar, bars: section.bars },
      source: "section",
      section: section.name,
    };
  return { range: { startBar: bar, bars: 1 }, source: "bar" };
}

/** `5–6`, or `5` for one bar (1-based, as typed). */
export function rangeLabel(range: BarRange): string {
  const first = range.startBar + 1;
  const last = range.startBar + range.bars;
  return first === last ? `${first}` : `${first}–${last}`;
}

/** `bars 5–6` / `bar 5`. */
export function barsWord(range: BarRange): string {
  return `${range.bars === 1 ? "bar" : "bars"} ${rangeLabel(range)}`;
}

// ---------------------------------------------------------------------------
// The clipboard: tracks × bars, re-based to 0

export type ClipTrack = Readonly<{
  trackId: string;
  notes: readonly Note[];
  clips: readonly AudioClip[];
  /** Lane field (`volumeAutomation`, …) to points. */
  automation: Readonly<Record<string, Points>>;
  fxAutomation: Readonly<Record<string, Points>>;
}>;

/** A lifted range (per pane; never in the score file). */
export type RangeClip = Readonly<{
  /** True when it holds every track (it pastes onto its own tracks). */
  all: boolean;
  bars: number;
  /** Tick length of each bar, for the meter check. */
  barTicks: readonly number[];
  /** Meter label of its first bar, such as `4/4`. */
  meter: string;
  source: BarRange;
  tracks: readonly ClipTrack[];
}>;

function rangeTicks(score: TrackScore, range: BarRange): [number, number] {
  return [
    barStartTick(score, range.startBar),
    barStartTick(score, range.startBar + range.bars),
  ];
}

function barLength(score: TrackScore, bar: number): number {
  return barStartTick(score, bar + 1) - barStartTick(score, bar);
}

function meterAt(score: TrackScore, bar: number): string {
  let found = meterSegments(score)[0]!;
  for (const segment of meterSegments(score)) {
    if (segment.bar > bar) break;
    found = segment;
  }
  return meterLabel(found);
}

/** The curve over `from..to`, re-based to 0 (a value at each edge it has one). */
function cropCurve(points: Points, from: number, to: number): Points {
  const out: AutomationPoint[] = [];
  const start = valueAt(points, from);
  if (start !== undefined) out.push({ tick: 0, value: start });
  for (const point of points)
    if (point.tick > from && point.tick < to)
      out.push({ tick: point.tick - from, value: point.value });
  const end = valueAt(points, to - 1);
  if (end !== undefined && to - from > 1)
    out.push({ tick: to - 1 - from, value: end });
  return sortPoints(out);
}

function requireTrack(score: TrackScore, trackId: string): Track {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new ScoreValidationError(`no track ${trackId}`);
  return track;
}

function checkRange(score: TrackScore, range: BarRange): void {
  if (
    !Number.isInteger(range.startBar) ||
    !Number.isInteger(range.bars) ||
    range.startBar < 0 ||
    range.bars < 1
  )
    throw new ScoreValidationError("a range is whole bars from 1");
  if (range.startBar >= score.bars)
    throw new ScoreValidationError(
      `bar ${range.startBar + 1} is past the song's ${score.bars} bars`,
    );
}

/** Lift `range` of `trackIds` (undefined: every track) into a clipboard. */
export function extractRange(
  score: TrackScore,
  trackIds: readonly string[] | undefined,
  range: BarRange,
): RangeClip {
  checkRange(score, range);
  const ids = trackIds ?? score.tracks.map((track) => track.id);
  const [from, to] = rangeTicks(score, range);
  const tracks = ids.map((trackId): ClipTrack => {
    const track = requireTrack(score, trackId);
    const notes = score.notes
      .filter(
        (note) =>
          note.trackId === trackId &&
          note.startTick >= from &&
          note.startTick < to,
      )
      .map((note) => ({
        ...note,
        startTick: note.startTick - from,
        durationTicks: Math.max(
          1,
          Math.min(note.durationTicks, to - note.startTick),
        ),
      }));
    const clips = (track.clips ?? [])
      .filter((clip) => clip.startTick >= from && clip.startTick < to)
      .map((clip) => ({ ...clip, startTick: clip.startTick - from }));
    const automation: Record<string, Points> = {};
    for (const field of TRACK_LANES) {
      const points = track[field];
      if (points && points.length > 0)
        automation[field] = cropCurve(points, from, to);
    }
    const fxAutomation: Record<string, Points> = {};
    for (const [lane, points] of Object.entries(track.fxAutomation ?? {}))
      if (points && points.length > 0)
        fxAutomation[lane] = cropCurve(points, from, to);
    return { trackId, notes, clips, automation, fxAutomation };
  });
  return {
    all: trackIds === undefined,
    bars: range.bars,
    barTicks: Array.from({ length: range.bars }, (_, index) =>
      barLength(score, range.startBar + index),
    ),
    meter: meterAt(score, range.startBar),
    source: range,
    tracks,
  };
}

/** Notes in a clipboard. */
export function clipNoteCount(clip: RangeClip): number {
  return clip.tracks.reduce((sum, track) => sum + track.notes.length, 0);
}

export type PasteMode = "overwrite" | "merge" | "insert";

export type PlaceOptions = Readonly<{
  /** Tiles laid end to end (default 1). */
  times?: number;
  mode?: PasteMode;
  /** A one-track clipboard lands here (default its own track). */
  target?: string;
}>;

/**
 * Fresh ids that the score does not use yet, collision-free across actors
 * (core/ids.ts): two windows copying the same bars at once never clash.
 */
function freshIds(used: Set<string>, prefix: string): (stem: string) => string {
  return (stem) => {
    for (;;) {
      const id = newId(prefix);
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
}

/** Remove points in `from..to` and hold the old values at its edges. */
function blankCurve(
  points: Points,
  from: number,
  to: number,
): AutomationPoint[] {
  const out = points.filter((point) => point.tick < from || point.tick >= to);
  const after = valueAt(points, to);
  if (after !== undefined && !points.some((point) => point.tick === to))
    out.push({ tick: to, value: after });
  return out;
}

/**
 * Lay `clip` down at `toBar`, `times` over. Overwrite (default) replaces the
 * music there; merge overdubs it; insert opens the bars first. The song
 * grows when the paste runs past its end.
 */
export function placeRange(
  score: TrackScore,
  clip: RangeClip,
  toBar: number,
  options: PlaceOptions = {},
): TrackScore {
  const times = options.times ?? 1;
  const mode = options.mode ?? "overwrite";
  if (!Number.isInteger(times) || times < 1 || times > 64)
    throw new ScoreValidationError("tile 1 to 64 times (x3)");
  if (!Number.isInteger(toBar) || toBar < 0)
    throw new ScoreValidationError("paste at a bar from 1");
  if (toBar > score.bars)
    throw new ScoreValidationError(
      `bar ${toBar + 1} is past the song's ${score.bars} bars`,
    );
  const total = clip.bars * times;
  let next = score;
  if (mode === "insert") next = insertBars(next, toBar, total);
  if (toBar + total > next.bars) {
    checkBars(toBar + total);
    next = next.withBars(toBar + total);
  }
  for (let bar = 0; bar < total; bar += 1) {
    const want = clip.barTicks[bar % clip.bars]!;
    if (barLength(next, toBar + bar) !== want)
      throw new ScoreValidationError(
        `clipboard is ${clip.meter} · bar ${toBar + bar + 1} is ${meterAt(next, toBar + bar)}`,
      );
  }
  // Which track each clipboard row lands on.
  const landing = clip.tracks.map((row) => ({
    row,
    trackId:
      !clip.all && clip.tracks.length === 1 && options.target
        ? options.target
        : row.trackId,
  }));
  for (const { trackId } of landing) requireTrack(next, trackId);
  const from = barStartTick(next, toBar);
  const to = barStartTick(next, toBar + total);
  const tiles = Array.from({ length: times }, (_, index) =>
    barStartTick(next, toBar + index * clip.bars),
  );
  const targets = new Set(landing.map((entry) => entry.trackId));
  const usedNotes = new Set(next.notes.map((note) => note.id));
  const noteId = freshIds(usedNotes, "n");
  const kept = next.notes.filter(
    (note) =>
      mode === "merge" ||
      !targets.has(note.trackId) ||
      note.startTick < from ||
      note.startTick >= to,
  );
  const added: Note[] = [];
  for (const { row, trackId } of landing)
    for (const at of tiles)
      for (const note of row.notes)
        added.push({
          ...note,
          id: noteId(note.id),
          trackId,
          startTick: note.startTick + at,
        });
  const tracks = next.tracks.map((track) => {
    const rows = landing.filter((entry) => entry.trackId === track.id);
    if (rows.length === 0) return track;
    const usedClips = new Set((track.clips ?? []).map((clip) => clip.id));
    const clipId = freshIds(usedClips, "clip");
    const overwrite = mode !== "merge";
    let clips = (track.clips ?? []).filter(
      (clip) => !overwrite || clip.startTick < from || clip.startTick >= to,
    );
    let out: Track = overwrite
      ? mapAutomation(track, (points) => blankCurve(points, from, to))
      : track;
    for (const { row } of rows) {
      for (const at of tiles)
        clips = [
          ...clips,
          ...row.clips.map((piece) => ({
            ...piece,
            id: clipId(piece.id),
            startTick: piece.startTick + at,
          })),
        ];
      const lanes: Record<string, unknown> = { ...out };
      for (const [field, points] of Object.entries(row.automation)) {
        const base = (lanes[field] as Points | undefined) ?? [];
        lanes[field] = sortPoints([
          ...base,
          ...tiles.flatMap((at) =>
            points.map((point) => ({
              tick: point.tick + at,
              value: point.value,
            })),
          ),
        ]);
      }
      const fxRows = Object.entries(row.fxAutomation);
      if (fxRows.length > 0) {
        const fx: Record<string, Points> = {
          ...((out.fxAutomation as Record<string, Points> | undefined) ?? {}),
        };
        for (const [lane, points] of fxRows)
          fx[lane] = sortPoints([
            ...(fx[lane] ?? []),
            ...tiles.flatMap((at) =>
              points.map((point) => ({
                tick: point.tick + at,
                value: point.value,
              })),
            ),
          ]);
        lanes.fxAutomation = fx;
      }
      out = lanes as Track;
    }
    return {
      ...out,
      ...(clips.length > 0 || track.clips ? { clips } : {}),
    } as Track;
  });
  return new TrackScore({
    ...next.toJSON(),
    tracks,
    notes: [...kept, ...added],
  });
}

export type CopyOptions = Readonly<{
  times?: number;
  mode?: PasteMode;
}>;

/** Copy `range` of `trackIds` (undefined: every track) to `toBar`. */
export function copyRange(
  score: TrackScore,
  trackIds: readonly string[] | undefined,
  range: BarRange,
  toBar: number,
  options: CopyOptions = {},
): TrackScore {
  const clip = extractRange(score, trackIds, range);
  const times = options.times ?? 1;
  const end = range.startBar + range.bars;
  if (options.mode === "insert" && toBar > range.startBar && toBar < end)
    throw new ScoreValidationError(
      `bar ${toBar + 1} is inside ${barsWord(range)} · insert before or after them`,
    );
  if (
    times > 1 &&
    options.mode !== "insert" &&
    toBar < end &&
    toBar + range.bars * times > range.startBar
  )
    throw new ScoreValidationError(
      `the tiles would cover ${barsWord(range)} · copy them past bar ${end}`,
    );
  return placeRange(score, clip, toBar, {
    times,
    mode: options.mode ?? "overwrite",
  });
}

/** Silence `range` of `trackIds` (undefined: every track); the bars stay. */
export function clearRange(
  score: TrackScore,
  trackIds: readonly string[] | undefined,
  range: BarRange,
): TrackScore {
  checkRange(score, range);
  const ids = new Set(trackIds ?? score.tracks.map((track) => track.id));
  for (const id of ids) requireTrack(score, id);
  const [from, to] = rangeTicks(score, range);
  const notes: Note[] = [];
  for (const note of score.notes) {
    if (!ids.has(note.trackId)) {
      notes.push(note);
      continue;
    }
    if (note.startTick >= from && note.startTick < to) continue;
    // A note held into the range stops where it starts.
    if (note.startTick < from && note.startTick + note.durationTicks > from)
      notes.push({ ...note, durationTicks: from - note.startTick });
    else notes.push(note);
  }
  const tracks = score.tracks.map((track) => {
    if (!ids.has(track.id)) return track;
    const held = mapAutomation(track, (points) => {
      const start = valueAt(points, from);
      const out = blankCurve(points, from, to);
      if (start !== undefined && !out.some((point) => point.tick === from))
        out.push({ tick: from, value: start });
      return sortPoints(out);
    });
    if (!track.clips) return held;
    return {
      ...held,
      clips: track.clips.filter(
        (clip) => clip.startTick < from || clip.startTick >= to,
      ),
    };
  });
  return new TrackScore({ ...score.toJSON(), tracks, notes });
}

export type MoveOptions = Readonly<{ insert?: boolean }>;

/**
 * Move `range` of `trackIds` to `toBar`: the source goes silent and the
 * destination is overwritten. With `insert`, bars open at the destination;
 * moving every track then closes the source gap too (a ripple move).
 */
export function moveRange(
  score: TrackScore,
  trackIds: readonly string[] | undefined,
  range: BarRange,
  toBar: number,
  options: MoveOptions = {},
): TrackScore {
  const clip = extractRange(score, trackIds, range);
  const end = range.startBar + range.bars;
  if (toBar === range.startBar)
    throw new ScoreValidationError(`${barsWord(range)} already start there`);
  if (!options.insert)
    return placeRange(clearRange(score, trackIds, range), clip, toBar);
  if (toBar > range.startBar && toBar < end)
    throw new ScoreValidationError(
      `bar ${toBar + 1} is inside ${barsWord(range)} · move before or after them`,
    );
  const opened = placeRange(score, clip, toBar, { mode: "insert" });
  const source =
    toBar <= range.startBar
      ? { startBar: range.startBar + range.bars, bars: range.bars }
      : range;
  return trackIds === undefined
    ? deleteBars(opened, source.startBar, source.bars)
    : clearRange(opened, trackIds, source);
}

/** Play `range` of `trackIds` backwards: notes and automation mirror. */
export function reverseRange(
  score: TrackScore,
  trackIds: readonly string[] | undefined,
  range: BarRange,
): TrackScore {
  checkRange(score, range);
  const ids = new Set(trackIds ?? score.tracks.map((track) => track.id));
  for (const id of ids) requireTrack(score, id);
  const [from, to] = rangeTicks(score, range);
  const notes = score.notes.map((note) => {
    if (!ids.has(note.trackId) || note.startTick < from || note.startTick >= to)
      return note;
    const duration = Math.min(note.durationTicks, to - note.startTick);
    return {
      ...note,
      startTick: from + to - (note.startTick + duration),
      durationTicks: duration,
    };
  });
  const tracks = score.tracks.map((track) =>
    ids.has(track.id)
      ? mapAutomation(track, (points) => {
          const piece = cropCurve(points, from, to);
          if (piece.length === 0) return points;
          const last = to - from - 1;
          const outside = points.filter(
            (point) => point.tick < from || point.tick >= to,
          );
          return sortPoints([
            ...outside,
            ...piece.map((point) => ({
              tick: from + last - point.tick,
              value: point.value,
            })),
          ]);
        })
      : track,
  );
  return new TrackScore({ ...score.toJSON(), tracks, notes });
}

/** Notes of `trackIds` that start inside `range`. */
export function notesInRange(
  score: TrackScore,
  trackIds: readonly string[] | undefined,
  range: BarRange,
): number {
  const ids = trackIds ? new Set(trackIds) : undefined;
  const [from, to] = rangeTicks(score, range);
  return score.notes.filter(
    (note) =>
      (!ids || ids.has(note.trackId)) &&
      note.startTick >= from &&
      note.startTick < to,
  ).length;
}

/**
 * The loop range moved by its own length (`loop next` / `loop prev`),
 * kept inside the song; undefined when it cannot move that way.
 */
export function steppedLoop(
  score: TrackScore,
  loop: BarRange,
  direction: 1 | -1,
): BarRange | undefined {
  const startBar = loop.startBar + direction * loop.bars;
  if (startBar < 0 || startBar >= score.bars) return undefined;
  return { startBar, bars: Math.min(loop.bars, score.bars - startBar) };
}
