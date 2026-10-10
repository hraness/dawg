/**
 * The TAPE view model: a score, the playhead and this pane's state become
 * the cells tui/tape.ts paints. Density per cell is the notes starting in
 * it, weighted by velocity (` ▁▂▃▄▅▆▇█`); a held note shows `▁` across the
 * cells it sustains through, and an audio clip `▃` where it plays.
 *
 * With a form the tape is drawn unrolled (op1-ux §4): every pass in play
 * order, the first pass of each section solid and every later one ghosted
 * `░`. Each cell keeps the score bar it shows, so a click, a drag or a
 * gesture on a ghost acts on the source section.
 */
import { formPositionAt, formSegments } from "../../core/sections.ts";
import type { TrackScore } from "../../core/score.ts";
import { barStartTick, bpmAtTick } from "../../core/tempo.ts";
import type { KnobIndex } from "../../tui/knobs.ts";
import type {
  TapeRow,
  TapeSection,
  TapeView,
  TapeZoom,
} from "../../tui/tape.ts";
import {
  barOfBeat,
  clipboardLabel,
  formPasses,
  loopRange,
  rangeLine,
  tapeKnobs,
  TAPE_HINT,
  type TapeContext,
} from "./tape-mode.ts";

export type TapeViewInput = TapeContext &
  Readonly<{
    zoom: TapeZoom;
    selected: KnobIndex;
    /** Other panes on a track (§12.7): `B`, `C●`. */
    marks: (trackId: string) => string;
    /**
     * Transport beat (arranged time), for the playhead on an unrolled form:
     * which pass it is in. Absent, the playhead sits on the first pass.
     */
    transportBeat?: number | undefined;
  }>;

/** One drawn cell on an unrolled form: a score cell, its pass, a ghost. */
type Unrolled = Readonly<{ cell: number; segment: number; ghost: boolean }>;

/** The form in play order as score cells; undefined without a form. */
function unroll(
  score: TrackScore,
  bars: readonly number[],
): Unrolled[] | undefined {
  const segments = formSegments(score);
  if (segments.length === 0) return undefined;
  const firstCellOf = new Map<number, number>();
  bars.forEach((bar, index) => {
    if (!firstCellOf.has(bar)) firstCellOf.set(bar, index);
  });
  const seen = new Set<string>();
  const cells: Unrolled[] = [];
  segments.forEach((segment, index) => {
    const ghost = seen.has(segment.section.name);
    seen.add(segment.section.name);
    const from = firstCellOf.get(segment.section.startBar);
    if (from === undefined) return;
    const end = segment.section.startBar + segment.section.bars;
    for (let cell = from; cell < bars.length && bars[cell]! < end; cell += 1)
      cells.push({ cell, segment: index, ghost });
  });
  // Bars the form never plays stay reachable, after it, in score order.
  const played = new Set(cells.map((item) => item.cell));
  bars.forEach((_, cell) => {
    if (!played.has(cell)) cells.push({ cell, segment: -1, ghost: false });
  });
  return cells;
}

/** Cell start ticks and the bar each cell is in, for a zoom. */
export function tapeCells(
  score: TrackScore,
  zoom: TapeZoom,
): { starts: number[]; bars: number[] } {
  const starts: number[] = [];
  const bars: number[] = [];
  for (let bar = 0; bar < score.bars; bar += 1) {
    const from = barStartTick(score, bar);
    const to = barStartTick(score, bar + 1);
    const step =
      zoom === "bar"
        ? to - from
        : zoom === "beat"
          ? score.ticksPerBeat
          : score.ticksPerBeat / 2;
    for (let tick = from; tick < to - 1e-6; tick += step) {
      starts.push(tick);
      bars.push(bar);
    }
  }
  return { starts, bars };
}

function cellAt(starts: readonly number[], tick: number): number {
  let low = 0;
  let high = starts.length - 1;
  if (high < 0 || tick < starts[0]!) return -1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= tick) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Density levels (0…8) per cell for one track. */
export function trackLevels(
  score: TrackScore,
  trackId: string,
  starts: readonly number[],
  end: number,
): number[] {
  const weight = starts.map(() => 0);
  const held = starts.map(() => false);
  for (const note of score.notes) {
    if (note.trackId !== trackId || note.startTick >= end) continue;
    const cell = cellAt(starts, note.startTick);
    if (cell < 0) continue;
    weight[cell]! += Math.max(0.15, note.velocity);
    const last = cellAt(
      starts,
      Math.min(end - 1, note.startTick + note.durationTicks - 1),
    );
    for (let index = cell + 1; index <= last; index += 1) held[index] = true;
  }
  const track = score.tracks.find((item) => item.id === trackId);
  for (const clip of track?.clips ?? []) {
    const first = cellAt(starts, clip.startTick);
    if (first < 0) continue;
    const length =
      clip.dur !== undefined
        ? clip.dur *
          (bpmAtTick(score, clip.startTick) / 60) *
          score.ticksPerBeat
        : starts.length > first + 1
          ? starts[first + 1]! - starts[first]!
          : 0;
    const last = cellAt(starts, Math.min(end - 1, clip.startTick + length - 1));
    for (let index = first; index <= last; index += 1)
      weight[index] = Math.max(weight[index]!, 1);
  }
  return weight.map((value, index) =>
    value > 0
      ? Math.max(1, Math.min(8, Math.ceil(value * 3)))
      : held[index]
        ? 1
        : 0,
  );
}

export function tapeView(input: TapeViewInput): TapeView {
  const score = input.score;
  const { starts, bars } = tapeCells(score, input.zoom);
  const end = barStartTick(score, score.bars);
  const tick = Math.max(0, Math.round(input.beat * score.ticksPerBeat));
  const scoreHead = Math.max(0, cellAt(starts, Math.min(end - 1, tick)));
  const unrolled = unroll(score, bars);
  // The pass under the transport, so the playhead walks through ghosts.
  const pass =
    unrolled && input.transportBeat !== undefined
      ? formPositionAt(score, input.transportBeat).index
      : undefined;
  const inPass = unrolled?.findIndex(
    (item) =>
      item.cell === scoreHead && (pass === undefined || item.segment === pass),
  );
  const playheadCell = unrolled
    ? Math.max(
        0,
        inPass !== undefined && inPass >= 0
          ? inPass
          : unrolled.findIndex((item) => item.cell === scoreHead),
      )
    : scoreHead;
  // A section the form plays more than once shows `×N` after its name.
  const passes = formPasses(score);
  const named = (name: string): string => {
    const times = passes.get(name) ?? 1;
    return times > 1 ? `${name} ×${times}` : name;
  };
  const sections: TapeSection[] = score.sections.map((section) => ({
    name: named(section.name),
    startBar: section.startBar,
    bars: section.bars,
  }));
  const loopSection =
    score.loop === undefined && score.loopSection !== undefined
      ? sections.find((section) => section.name.startsWith(score.loopSection!))
          ?.name
      : undefined;
  const tempo = [...(score.time?.tempo ?? [])]
    .filter((event) => event.tick > 0 && event.tick < end)
    .sort((a, b) => a.tick - b.tick);
  const pick = <T>(values: readonly T[]): T[] =>
    unrolled ? unrolled.map((item) => values[item.cell]!) : [...values];
  const rows: TapeRow[] = score.tracks.map((track) => ({
    id: track.id,
    name: track.name,
    muted: track.muted,
    levels: pick(trackLevels(score, track.id, starts, end)),
    marks: input.marks(track.id).trim(),
  }));
  // Tempo marks land on the cell their tick starts (the first pass).
  const tempoCell = (at: number): number => {
    const cell = Math.max(0, cellAt(starts, at));
    return unrolled
      ? Math.max(
          0,
          unrolled.findIndex((item) => item.cell === cell),
        )
      : cell;
  };
  const focused = Math.max(
    0,
    score.tracks.findIndex((track) => track.id === input.trackId),
  );
  return {
    bars: score.bars,
    cellBars: pick(bars),
    ...(unrolled
      ? {
          ghosts: unrolled.map((item) => item.ghost),
          passes: unrolled.map((item) => item.segment),
          passNames: formSegments(score).map((segment) =>
            named(segment.section.name),
          ),
        }
      : {}),
    playheadCell,
    loop: loopRange(score),
    sections,
    loopSection,
    tempo:
      tempo.length > 0
        ? [
            { cell: 0, bpm: Math.round(score.tempoBpm) },
            ...tempo.map((event) => ({
              cell: tempoCell(event.tick),
              bpm: Math.round(event.bpm),
            })),
          ]
        : [],
    rows,
    focused,
    range: rangeLine(input),
    clipboard: clipboardLabel(score, input.clipboard),
    knobs: tapeKnobs(input),
    selected: input.selected,
    hint: TAPE_HINT,
  };
}

/** The playhead's bar, for the header (`5.3`) callers. */
export { barOfBeat };
