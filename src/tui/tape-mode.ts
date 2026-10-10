/**
 * TAPE's keys (op1-ux §6.2): each gesture becomes the typed command a person
 * or the agent would write, so every key echoes and runs through `submit`
 * (one receipt, one undo step, the same path as typing). Like play-mode.ts
 * COMMAND_KEYS, this module only maps keys; src/main.ts runs the result.
 *
 * The range a gesture acts on is core/range.ts `rangeOf`: the loop, else
 * the section under the playhead, else that bar. The four knobs are the
 * screen-independent tui/knobs.ts strip on the `tape` page of KNOB_MAPS.
 */
import {
  barsWord,
  rangeOf,
  type BarRange,
  type ResolvedRange,
} from "../../core/range.ts";
import {
  findSection,
  formSegments,
  sectionAtBar,
} from "../../core/sections.ts";
import { TrackScore } from "../../core/score.ts";
import { barAt, barStartTick } from "../../core/tempo.ts";
import type { KnobSlot, KnobSlots } from "../../tui/knobs.ts";
import { knobMap } from "./knob-map.ts";

/** What TAPE knows when a key arrives. */
export type TapeContext = Readonly<{
  score: TrackScore;
  /** The focused track id. */
  trackId: string;
  /** Score beat under the playhead (score time, not transport time). */
  beat: number;
  /** This pane's clipboard: its source track (or `all`) and range. */
  clipboard?: Readonly<{ source: string; range: BarRange }> | undefined;
  /** The clipboard came from a cut whose clear is still the last edit. */
  cut?: boolean | undefined;
  /** The clipboard's source bars changed since the copy. */
  stale?: boolean | undefined;
}>;

export type TapeAction =
  /** Run these typed commands in order (each echoes, as if typed). */
  | Readonly<{ type: "run"; commands: readonly string[]; cut?: boolean }>
  /**
   * Paste: run `command`, then move the playhead to bar `end` (tiling).
   * `fold`: the first paste after a cut, whose `move` reads the bars from
   * the score before the cut's clear, so cut and paste land as one move.
   */
  | Readonly<{ type: "paste"; command: string; end: number; fold?: boolean }>
  /** A note that runs nothing (`no section under the playhead`). */
  | Readonly<{ type: "note"; message: string }>
  | Readonly<{ type: "zoom"; direction: 1 | -1 }>
  | Readonly<{ type: "focus"; row: number }>
  | Readonly<{ type: "transport" }>
  | Readonly<{ type: "keys" }>
  | Readonly<{ type: "exit" }>
  /** Not a TAPE key: the prompt, arrows for the knobs, ctrl keys. */
  | Readonly<{ type: "pass" }>;

/** The hint row: six gestures, the rest are in `?` (KEYS.tape). */
export const TAPE_HINT =
  "c copy · x cut · v paste · \\ loop · s split · 1-9 track · ? keys";

/** `5-6` or `5`, as typed (1-based, ASCII hyphen). */
export function typedRange(range: BarRange): string {
  const first = range.startBar + 1;
  const last = range.startBar + range.bars;
  return first === last ? `${first}` : `${first}-${last}`;
}

/** The bar (0-based) under a score beat. */
export function barOfBeat(score: TrackScore, beat: number): number {
  const tick = Math.max(0, Math.round(beat * score.ticksPerBeat));
  return Math.min(score.bars - 1, barAt(score, tick).bar);
}

/** `5.3` for a score beat (1-based bar.beat). */
export function barBeatOf(score: TrackScore, beat: number): string {
  const tick = Math.max(0, Math.round(beat * score.ticksPerBeat));
  const at = barAt(score, tick);
  const beatTicks = (at.barTicks / at.beatsPerBar) | 0;
  return `${at.bar + 1}.${Math.floor(at.offset / Math.max(1, beatTicks)) + 1}`;
}

/** The loop as bars: `score.loop`, else the looped section, else none. */
export function loopRange(score: TrackScore): BarRange | undefined {
  if (score.loop) return score.loop;
  if (score.loopSection === undefined) return undefined;
  const section = findSection(score, score.loopSection);
  return section
    ? { startBar: section.startBar, bars: section.bars }
    : undefined;
}

/** The range a gesture acts on now. */
export function tapeRange(context: TapeContext): ResolvedRange {
  return rangeOf(context.score, barOfBeat(context.score, context.beat));
}

function trackName(score: TrackScore, id: string): string {
  return score.tracks.find((track) => track.id === id)?.name ?? id;
}

/** The status line: `range: bass · bars 5–6 (loop)`. */
export function rangeLine(context: TapeContext): string {
  const resolved = tapeRange(context);
  const from =
    resolved.source === "loop"
      ? "loop"
      : resolved.source === "section"
        ? resolved.section
        : "playhead";
  const line = `range: ${trackName(context.score, context.trackId)} · ${barsWord(resolved.range)} (${from})`;
  const repeat = formRepeat(context.score, resolved.range.startBar);
  return repeat ? `${line} · ${repeat}` : line;
}

/** How many times the form plays each section; empty without a form. */
export function formPasses(score: TrackScore): Map<string, number> {
  const passes = new Map<string, number>();
  for (const segment of formSegments(score))
    passes.set(
      segment.section.name,
      (passes.get(segment.section.name) ?? 0) + 1,
    );
  return passes;
}

/**
 * `edits chorus (plays 2×)` when `bar` is in a section the form plays more
 * than once (op1-ux §4): an edit there lands on every pass.
 */
export function formRepeat(score: TrackScore, bar: number): string | undefined {
  if (score.form.length === 0) return undefined;
  const section = sectionAtBar(score, bar);
  if (!section) return undefined;
  const times = formPasses(score).get(section.name) ?? 0;
  return times > 1 ? `edits ${section.name} (plays ${times}×)` : undefined;
}

/** `clipboard: drums · 2 bars`, for the chip. */
export function clipboardLabel(
  score: TrackScore,
  clipboard: Readonly<{ source: string; range: BarRange }> | undefined,
): string | undefined {
  if (!clipboard) return undefined;
  const who =
    clipboard.source === "all"
      ? "all tracks"
      : trackName(score, clipboard.source);
  const bars = clipboard.range.bars;
  return `clipboard: ${who} · ${bars} ${bars === 1 ? "bar" : "bars"}`;
}

function sectionsInOrder(score: TrackScore) {
  return [...score.sections].sort((a, b) => a.startBar - b.startBar);
}

function loopCommand(score: TrackScore, range: BarRange): string | undefined {
  const startBar = Math.max(0, range.startBar);
  const bars = Math.min(range.bars, score.bars - startBar);
  if (bars < 1 || startBar >= score.bars) return undefined;
  return `loop ${typedRange({ startBar, bars })}`;
}

/** The loop a `[ ] { } < >` key starts from: the loop, else the range. */
function loopOrRange(context: TapeContext): BarRange {
  return loopRange(context.score) ?? tapeRange(context).range;
}

/** Keys that run one fixed typed command (with the range filled in). */
function rangeVerb(
  context: TapeContext,
  verb: "copy" | "clear" | "reverse",
  all: boolean,
): string {
  const who = all ? "all" : context.trackId;
  return `${verb} ${who} ${typedRange(tapeRange(context).range)}`;
}

function paste(context: TapeContext, insert: boolean): TapeAction {
  const board = context.clipboard;
  if (!board)
    return {
      type: "note",
      message: "paste · the clipboard is empty · c copies the range",
    };
  const score = context.score;
  const at = barOfBeat(score, context.beat);
  const tail = insert ? " insert" : "";
  const end = at + board.range.bars;
  // A one-track clipboard lands on the focused track: the typed form names
  // its source, so it only echoes `copy`/`move` when they mean the same.
  const sameTrack = board.source === "all" || board.source === context.trackId;
  if (context.stale || !sameTrack)
    return { type: "paste", command: `paste at ${at + 1}${tail}`, end };
  // The first paste after a cut folds into `move` (§6.2): one revision.
  const verb = context.cut ? "move" : "copy";
  return {
    type: "paste",
    command: `${verb} ${board.source} ${typedRange(board.range)} to ${at + 1}${tail}`,
    ...(context.cut ? { fold: true } : {}),
    end,
  };
}

/** One key on TAPE (the prompt is empty and no overlay is up). */
export function tapeKey(context: TapeContext, value: string): TapeAction {
  const score = context.score;
  const bar = barOfBeat(score, context.beat);
  const track = score.tracks.find((item) => item.id === context.trackId);
  switch (value) {
    case "\u001b":
    case "\u0014":
      return { type: "exit" };
    case " ":
      return { type: "transport" };
    case "?":
      return { type: "keys" };
    case "-":
      return { type: "zoom", direction: -1 };
    case "=":
    case "+":
      return { type: "zoom", direction: 1 };
    case "\t": {
      const index = score.tracks.findIndex(
        (item) => item.id === context.trackId,
      );
      return { type: "focus", row: (index + 1) % score.tracks.length };
    }
    case "c":
    case "C":
      return {
        type: "run",
        commands: [rangeVerb(context, "copy", value === "C")],
      };
    case "x":
    case "X": {
      const all = value === "X";
      return {
        type: "run",
        commands: [
          rangeVerb(context, "copy", all),
          rangeVerb(context, "clear", all),
        ],
        cut: true,
      };
    }
    case "v":
    case "V":
      return paste(context, value === "V");
    case "\u001b[3~":
    case "\u007f":
      return { type: "run", commands: [rangeVerb(context, "clear", false)] };
    case "~":
      return { type: "run", commands: [rangeVerb(context, "reverse", false)] };
    case "s":
    case "S": {
      const section = sectionAtBar(score, bar);
      if (!section)
        return {
          type: "note",
          message: "no section under the playhead · section add verse 1-4",
        };
      return {
        type: "run",
        commands: [
          value === "s"
            ? `section split ${section.name} at ${bar + 1}`
            : `section join ${joinTarget(score, section).name}`,
        ],
      };
    }
    case "h":
      if (!track) return { type: "pass" };
      return {
        type: "run",
        commands: [`${track.muted ? "unmute" : "mute"} ${track.id}`],
      };
    case "H":
      if (!track) return { type: "pass" };
      return {
        type: "run",
        // `solo` acts on the focused track, which is this row.
        commands: [track.solo ? "unsolo" : "solo"],
      };
    case "m":
      return { type: "run", commands: ["/click"] };
    case "b":
      return { type: "run", commands: ["stop"] };
    case ",":
    case ".": {
      // `.` the next section start after the playhead; `,` the last one
      // before it (the current section's start when inside it).
      const starts = sectionsInOrder(score).map((section) => ({
        section,
        beat: beatOfBar(score, section.startBar),
      }));
      const found =
        value === "."
          ? starts.find((item) => item.beat > context.beat + 1e-6)
          : [...starts]
              .reverse()
              .find((item) => item.beat < context.beat - 1e-6);
      const target = found?.section;
      if (!target)
        return {
          type: "note",
          message: `no ${value === "." ? "next" : "previous"} section`,
        };
      return { type: "run", commands: [`jump ${target.name}`] };
    }
    case "<":
    case ">": {
      const loop = loopOrRange(context);
      const direction = value === ">" ? 1 : -1;
      const command = loopCommand(score, {
        startBar: loop.startBar + direction * loop.bars,
        bars: loop.bars,
      });
      return command
        ? { type: "run", commands: [command] }
        : { type: "note", message: "loop · at the edge of the song" };
    }
    case "[":
    case "]": {
      const loop = loopOrRange(context);
      const bars = loop.bars + (value === "]" ? 1 : -1);
      const command =
        bars >= 1 && loop.startBar + bars <= score.bars
          ? loopCommand(score, { startBar: loop.startBar, bars })
          : undefined;
      return command
        ? { type: "run", commands: [command] }
        : { type: "note", message: "loop · cannot size it further" };
    }
    case "{":
    case "}": {
      const loop = loopOrRange(context);
      const shift = value === "}" ? 1 : -1;
      const command =
        loop.bars - shift >= 1 && loop.startBar + shift >= 0
          ? loopCommand(score, {
              startBar: loop.startBar + shift,
              bars: loop.bars - shift,
            })
          : undefined;
      return command
        ? { type: "run", commands: [command] }
        : { type: "note", message: "loop · cannot move its start further" };
    }
    case "\\": {
      if (loopRange(score)) return { type: "run", commands: ["loop off"] };
      const section = sectionAtBar(score, bar);
      return {
        type: "run",
        commands: [section ? `loop ${section.name}` : `loop ${bar + 1}`],
      };
    }
    default:
      break;
  }
  if (/^[1-9]$/.test(value)) {
    const row = Number(value) - 1;
    if (row >= score.tracks.length)
      return {
        type: "note",
        message: `no track ${value} · ${score.tracks.length} tracks`,
      };
    return { type: "focus", row };
  }
  return { type: "pass" };
}

/** `track drums`: the command a row focus runs. */
export function focusCommand(
  score: TrackScore,
  row: number,
): string | undefined {
  const track = score.tracks[row];
  return track ? `track ${track.id}` : undefined;
}

/** The score beat where `bar` starts (meter-aware). */
export function beatOfBar(score: TrackScore, bar: number): number {
  return barStartTick(score, bar) / score.ticksPerBeat;
}

/** Beats in `bar` (meter-aware). */
function beatsIn(score: TrackScore, bar: number): number {
  return (
    (barStartTick(score, bar + 1) - barStartTick(score, bar)) /
    score.ticksPerBeat
  );
}

/** `jump 5` / `jump 5.3` for a 0-based bar and beat. */
function jumpCommand(bar: number, beat: number): string {
  return beat > 0 ? `jump ${bar + 1}.${beat + 1}` : `jump ${bar + 1}`;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** `−4.9 dB` for a linear volume. */
export function decibels(volume: number): string {
  if (volume <= 0) return "-inf dB";
  const db = 20 * Math.log10(volume);
  return `${db < 0 ? "−" : ""}${Math.abs(db).toFixed(1)} dB`;
}

/** The tempo segment under a tick: its bar (undefined = the start tempo). */
function tempoSegment(
  score: TrackScore,
  tick: number,
): { bar?: number; bpm: number } {
  const events = [...(score.time?.tempo ?? [])]
    .filter((event) => event.tick <= tick && event.tick > 0)
    .sort((a, b) => a.tick - b.tick);
  const last = events.at(-1);
  if (!last) return { bpm: score.tempoBpm };
  return { bar: barAt(score, last.tick).bar, bpm: last.bpm };
}

/** Labels of the `tape` knob page (KNOB_MAPS.tape). */
function knobLabel(index: number, fallback: string): string {
  return knobMap("tape")?.[index] ?? fallback;
}

/**
 * TAPE's four knobs (§7.3): blue the playhead (a beat; ⇧ a bar), green the
 * loop length in bars, white the tempo of the segment under the playhead,
 * orange the focused track's volume. Each turn is a typed command.
 */
export function tapeKnobs(context: TapeContext): KnobSlots {
  const score = context.score;
  const bar = barOfBeat(score, context.beat);
  const tick = Math.max(0, Math.round(context.beat * score.ticksPerBeat));
  const beatInBar = Math.floor(context.beat - beatOfBar(score, bar) + 1e-6);
  const totalBeats = beatOfBar(score, score.bars);
  const playhead: KnobSlot = {
    label: knobLabel(0, "playhead"),
    text: barBeatOf(score, context.beat),
    position: totalBeats > 0 ? Math.min(1, context.beat / totalBeats) : 0,
    turn: (direction, coarse) => {
      if (coarse) {
        const next = bar + direction;
        return next < 0 || next >= score.bars
          ? undefined
          : jumpCommand(next, 0);
      }
      let nextBar = bar;
      let nextBeat = beatInBar + direction;
      if (nextBeat < 0) {
        nextBar -= 1;
        if (nextBar < 0) return undefined;
        nextBeat = beatsIn(score, nextBar) - 1;
      } else if (nextBeat >= beatsIn(score, bar)) {
        nextBar += 1;
        nextBeat = 0;
        if (nextBar >= score.bars) return undefined;
      }
      return jumpCommand(nextBar, nextBeat);
    },
  };
  const loop = loopRange(score);
  const loopSlot: KnobSlot = {
    label: knobLabel(1, "loop"),
    text: loop ? `${loop.bars} ${loop.bars === 1 ? "bar" : "bars"}` : "off",
    position: loop ? loop.bars / Math.max(1, score.bars) : 0,
    turn: (direction, coarse) => {
      const from = loop ?? { startBar: bar, bars: 0 };
      const step = coarse ? 4 : 1;
      const bars = Math.max(
        1,
        Math.min(score.bars - from.startBar, from.bars + direction * step),
      );
      if (loop && bars === loop.bars) return undefined;
      return loopCommand(score, { startBar: from.startBar, bars });
    },
  };
  const segment = tempoSegment(score, tick);
  const tempo: KnobSlot = {
    label: knobLabel(2, "tempo"),
    text: `${round(segment.bpm, 1)} BPM`,
    position: (segment.bpm - 20) / 280,
    turn: (direction, coarse) => {
      const next = Math.round(segment.bpm) + direction * (coarse ? 10 : 1);
      if (next < 20 || next > 300) return undefined;
      return segment.bar === undefined
        ? `tempo ${next}`
        : `tempo ${next} at bar ${segment.bar + 1}`;
    },
  };
  const track = score.tracks.find((item) => item.id === context.trackId);
  const level: KnobSlot | undefined = track
    ? {
        label: knobLabel(3, "volume"),
        text: decibels(track.volume),
        position: track.volume,
        turn: (direction, coarse) => {
          const next = round(
            Math.max(
              0,
              Math.min(1, track.volume + direction * (coarse ? 0.1 : 0.05)),
            ),
            2,
          );
          return next === track.volume
            ? undefined
            : `volume ${track.id} ${next}`;
        },
      }
    : undefined;
  return [playhead, loopSlot, tempo, level];
}

/** What enter opens for each knob: its noun, as typed. */
export function knobNoun(context: TapeContext, index: number): string {
  switch (index) {
    case 0:
      return "jump";
    case 1:
      return "loop";
    case 2:
      return "tempo";
    default:
      return `volume ${context.trackId}`;
  }
}

function withoutLoop(score: TrackScore): string {
  const { loop: _loop, loopSection: _section, ...rest } = score.toJSON();
  return JSON.stringify(rest);
}

/**
 * Whether a cut is still waiting for its paste: nothing but the loop has
 * changed since (a `jump` that carries the loop along keeps it armed).
 */
export function cutArmed(
  after: TrackScore | undefined,
  now: TrackScore,
): boolean {
  if (!after) return false;
  return after === now || withoutLoop(after) === withoutLoop(now);
}

/** The score a folded `move` reads: before the cut, with today's loop. */
export function foldBase(before: TrackScore, now: TrackScore): TrackScore {
  return new TrackScore({
    ...before.toJSON(),
    loop: now.loop ?? null,
    loopSection: now.loop ? null : (now.loopSection ?? null),
  });
}

/**
 * `S` joins the section under the playhead with its neighbour: the one
 * that ends where it starts (undoing an `s`), else the one after it.
 * `section join <name>` joins a section with the next.
 */
function joinTarget(
  score: TrackScore,
  section: NonNullable<ReturnType<typeof sectionAtBar>>,
) {
  const before = score.sections.find(
    (item) =>
      item !== section && item.startBar + item.bars === section.startBar,
  );
  return before ?? section;
}
