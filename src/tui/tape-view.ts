/**
 * The TAPE view model: a score, the playhead and this pane's state become
 * the cells tui/tape.ts paints. Density per cell is the notes starting in
 * it, weighted by velocity (` ▁▂▃▄▅▆▇█`); a held note shows `▁` across the
 * cells it sustains through, and an audio clip `▃` where it plays.
 */
import { formSegments } from "../../core/sections.ts";
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
  }>;

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
  const playheadCell = Math.max(0, cellAt(starts, Math.min(end - 1, tick)));
  // A section the form plays more than once shows `×N` after its name.
  const passes = new Map<string, number>();
  if (score.form.length > 0)
    for (const segment of formSegments(score))
      passes.set(
        segment.section.name,
        (passes.get(segment.section.name) ?? 0) + 1,
      );
  const sections: TapeSection[] = score.sections.map((section) => {
    const times = passes.get(section.name) ?? 1;
    return {
      name: times > 1 ? `${section.name} ×${times}` : section.name,
      startBar: section.startBar,
      bars: section.bars,
    };
  });
  const loopSection =
    score.loop === undefined && score.loopSection !== undefined
      ? sections.find((section) => section.name.startsWith(score.loopSection!))
          ?.name
      : undefined;
  const tempo = [...(score.time?.tempo ?? [])]
    .filter((event) => event.tick > 0 && event.tick < end)
    .sort((a, b) => a.tick - b.tick);
  const rows: TapeRow[] = score.tracks.map((track) => ({
    id: track.id,
    name: track.name,
    muted: track.muted,
    levels: trackLevels(score, track.id, starts, end),
    marks: input.marks(track.id).trim(),
  }));
  const focused = Math.max(
    0,
    score.tracks.findIndex((track) => track.id === input.trackId),
  );
  return {
    bars: score.bars,
    cellBars: bars,
    playheadCell,
    loop: loopRange(score),
    sections,
    loopSection,
    tempo:
      tempo.length > 0
        ? [
            { cell: 0, bpm: Math.round(score.tempoBpm) },
            ...tempo.map((event) => ({
              cell: Math.max(0, cellAt(starts, event.tick)),
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
