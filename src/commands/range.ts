/**
 * Range commands (op1-ux §6.4): copy, move, clear, paste and reverse bars,
 * bars insert and remove, loop next and prev, and jump. Bars are numbered
 * from 1 here, as the ruler shows them; core/range.ts stores them from 0.
 *
 *   copy [<track>|all] [<range>] [to <bar>] [x<N>] [insert|merge]
 *   move [<track>|all] [<range>] to <bar> [insert]
 *   clear [<track>|all] [<range>]   (bare `clear` empties this track, as before)
 *   paste [at <bar>] [x<N>] [insert|merge]
 *   reverse [<track>|all] [<range>]
 *   bars insert <n> at <bar> | bars remove <range>
 *   loop next | loop prev
 *   jump <bar>[.<beat>] | <section>
 *
 * A `<range>` is `5-6`, `5` or a section name. Without one a command acts
 * on the loop range, else the section under the playhead, else that bar
 * (`rangeOf`), so the typed and keyed forms behave the same. `copy` without
 * `to` fills the clipboard that `paste` lays down.
 */
import {
  ScoreValidationError,
  type TrackScore,
} from "../../core/score.ts";
import { resolveTrackRef } from "../../core/routing.ts";
import {
  deleteBars,
  findSection,
  formSegments,
  insertBars,
} from "../../core/sections.ts";
import { barStartTick } from "../../core/tempo.ts";
import {
  barsWord,
  clearRange,
  clipNoteCount,
  copyRange,
  extractRange,
  moveRange,
  notesInRange,
  placeRange,
  rangeLabel,
  rangeOf,
  reverseRange,
  steppedLoop,
  type BarRange,
  type PasteMode,
  type RangeClip,
} from "../../core/range.ts";

/** Which tracks: one id, every track, or the focused one. */
export type RangeTracks =
  | Readonly<{ kind: "track"; id: string }>
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "focused" }>;

/** A typed range: bars (0-based), a section, or the gesture range. */
export type RangeRef =
  | Readonly<{ kind: "bars"; range: BarRange }>
  | Readonly<{ kind: "section"; name: string }>
  | Readonly<{ kind: "implicit" }>;

export type RangeCommand =
  | Readonly<{
      type: "range-copy";
      tracks: RangeTracks;
      range: RangeRef;
      /** 0-based; absent copies to the clipboard. */
      to?: number;
      times: number;
      mode: PasteMode;
    }>
  | Readonly<{
      type: "range-move";
      tracks: RangeTracks;
      range: RangeRef;
      to: number;
      insert: boolean;
    }>
  | Readonly<{ type: "range-clear"; tracks: RangeTracks; range: RangeRef }>
  | Readonly<{ type: "range-reverse"; tracks: RangeTracks; range: RangeRef }>
  | Readonly<{ type: "range-paste"; at?: number; times: number; mode: PasteMode }>
  | Readonly<{ type: "bars-insert"; count: number; at: number }>
  | Readonly<{ type: "bars-remove"; range: RangeRef }>
  | Readonly<{ type: "loop-step"; direction: 1 | -1 }>
  | Readonly<{ type: "jump-bar"; bar: number; beat: number }>
  | Readonly<{ type: "jump-section"; name: string }>
  /** A range verb whose words do not parse: answered locally. */
  | Readonly<{ type: "range-usage"; verb: string; message: string }>;

export const RANGE_USAGE: Readonly<Record<string, string>> = {
  copy: "copy [<track>|all] [<a>-<b>|<section>] [to <bar>] [x<N>] [insert|merge] · copy bass 5-6 to 7 x2",
  move: "move [<track>|all] [<a>-<b>|<section>] to <bar> [insert] · move bass 5-6 to 9",
  clear:
    "clear [<track>|all] [<a>-<b>|<section>] · clear bass 5-6 · bare clear empties this track",
  paste: "paste [at <bar>] [x<N>] [insert|merge] · paste at 9 · copy fills the clipboard",
  reverse: "reverse [<track>|all] [<a>-<b>|<section>] · reverse bass 5-6",
  bars: "bars <count> | bars insert <n> at <bar> | bars remove <a>-<b> · bars insert 2 at 3",
  jump: "jump <bar>[.<beat>] | <section> · jump 5 · jump 5.3 · jump chorus",
};

/** The clipboard: what was copied and where from (per window, not saved). */
export type RangeClipboard = Readonly<{
  clip: RangeClip;
  /** The source, for receipts: a track id or `all`, and the range. */
  source: string;
  range: BarRange;
}>;

export type RangeContext = Readonly<{
  /** The focused track. */
  trackId: string;
  /** The bar under the playhead, 0-based on the score. */
  playheadBar: number;
  clipboard?: RangeClipboard;
}>;

export type RangeResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
  /** A new clipboard (copy without `to`). */
  clipboard?: RangeClipboard;
  /** Transport beat to seek to (`jump`). */
  seekBeat?: number;
  /** Run this command instead (`jump chorus` is `section jump chorus`). */
  delegate?: string;
}>;

const VERBS = new Set(["copy", "move", "clear", "paste", "reverse", "bars", "jump", "loop"]);

const BARS = /^(\d{1,4})(?:(?:-|\.\.|–)(\d{1,4}))?$/u;

function stripSlash(line: string): string {
  return line.trim().replace(/^\//u, "");
}

/** `5-6` or `5` → a 0-based range, else undefined. */
function parseBarsWord(word: string): BarRange | undefined {
  const match = BARS.exec(word);
  if (!match) return undefined;
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  if (from < 1 || to < from) return undefined;
  return { startBar: from - 1, bars: to - from + 1 };
}

/** A section named by the leading words (longest match), with the rest. */
function leadingSection(
  score: TrackScore,
  words: readonly string[],
): { name: string; rest: readonly string[] } | undefined {
  for (let count = Math.min(words.length, 4); count >= 1; count -= 1) {
    const section = findSection(score, words.slice(0, count).join(" "));
    if (section) return { name: section.name, rest: words.slice(count) };
  }
  return undefined;
}

function leadingTracks(
  score: TrackScore,
  words: readonly string[],
): { tracks: RangeTracks; rest: readonly string[]; shadowed?: string } {
  const first = words[0];
  if (first === undefined) return { tracks: { kind: "focused" }, rest: words };
  if (first.toLowerCase() === "all")
    return { tracks: { kind: "all" }, rest: words.slice(1) };
  if (BARS.test(first)) return { tracks: { kind: "focused" }, rest: words };
  const track = resolveTrackRef(score, first);
  if (track) {
    return {
      tracks: { kind: "track", id: track.id },
      rest: words.slice(1),
      // A name that is both resolves to the track; the receipt says so.
      ...(findSection(score, first) ? { shadowed: first } : {}),
    };
  }
  return { tracks: { kind: "focused" }, rest: words };
}

/** The range words up to the first keyword, then the rest. */
function leadingRange(
  score: TrackScore,
  words: readonly string[],
): { range: RangeRef; rest: readonly string[] } | undefined {
  const first = words[0];
  if (first === undefined || isKeyword(first))
    return { range: { kind: "implicit" }, rest: words };
  const bars = parseBarsWord(first);
  if (bars) return { range: { kind: "bars", range: bars }, rest: words.slice(1) };
  const section = leadingSection(score, words);
  if (section)
    return { range: { kind: "section", name: section.name }, rest: section.rest };
  return undefined;
}

function isKeyword(word: string): boolean {
  return /^(to|at|insert|merge|x\d{1,2}|×\d{1,2})$/iu.test(word);
}

/** `to 7` / `to chorus` / `at 7`: a 0-based bar. */
function barTarget(score: TrackScore, words: readonly string[]): number | undefined {
  if (words.length === 0) return undefined;
  if (words.length === 1 && /^\d{1,4}$/u.test(words[0]!)) {
    const bar = Number(words[0]);
    return bar >= 1 ? bar - 1 : undefined;
  }
  const section = findSection(score, words.join(" "));
  return section?.startBar;
}

type Tail = { to?: number; times: number; mode: PasteMode; bad: boolean };

/** `to <bar>`, `x<N>`, `insert`, `merge` in any order. */
function parseTail(
  score: TrackScore,
  words: readonly string[],
  word = "to",
): Tail {
  const tail: Tail = { times: 1, mode: "overwrite", bad: false };
  for (let index = 0; index < words.length; index += 1) {
    const lower = words[index]!.toLowerCase();
    if (lower === word) {
      // The target runs to the next keyword.
      let end = index + 1;
      while (end < words.length && !isKeyword(words[end]!)) end += 1;
      const to = barTarget(score, words.slice(index + 1, end));
      if (to === undefined || tail.to !== undefined) tail.bad = true;
      else tail.to = to;
      index = end - 1;
    } else if (/^[x×]\d{1,2}$/u.test(lower)) {
      tail.times = Number(lower.slice(1));
      if (tail.times < 1) tail.bad = true;
    } else if (lower === "insert") tail.mode = "insert";
    else if (lower === "merge") tail.mode = "merge";
    else tail.bad = true;
  }
  return tail;
}

function usage(verb: string): RangeCommand {
  return { type: "range-usage", verb, message: `${verb} · ${RANGE_USAGE[verb]}` };
}

/**
 * Parse one range command, or undefined when the line is another
 * command's (bare `clear`, `clear hat`, `move n1 to 2`, `bars 8`,
 * `loop 5-6`) or prose for the agent.
 */
export function parseRangeCommand(
  line: string,
  score: TrackScore,
): RangeCommand | undefined {
  const text = stripSlash(line);
  if (text.length > 512) return undefined;
  const words = text.split(/\s+/u).filter(Boolean);
  const verb = words[0]?.toLowerCase();
  if (!verb || !VERBS.has(verb)) return undefined;
  const args = words.slice(1);
  switch (verb) {
    case "copy":
    case "move":
    case "clear":
    case "reverse":
      return parseTrackRange(score, verb, args);
    case "paste": {
      const tail = parseTail(score, args, "at");
      if (tail.bad || tail.mode === "insert" && tail.times > 64) return usage("paste");
      return {
        type: "range-paste",
        ...(tail.to !== undefined ? { at: tail.to } : {}),
        times: tail.times,
        mode: tail.mode,
      };
    }
    case "bars":
      return parseBars(score, args);
    case "loop": {
      const word = args.length === 1 ? args[0]!.toLowerCase() : "";
      if (word === "next") return { type: "loop-step", direction: 1 };
      if (word === "prev" || word === "previous")
        return { type: "loop-step", direction: -1 };
      return undefined;
    }
    case "jump":
      return parseJump(score, args);
    default:
      return undefined;
  }
}

function parseTrackRange(
  score: TrackScore,
  verb: "copy" | "move" | "clear" | "reverse",
  args: readonly string[],
): RangeCommand | undefined {
  // Bare `clear` and `clear automation` belong to the note commands;
  // `clear hat` is the drum-voice clear unless a track has that name.
  if (verb === "clear" && args.length === 0) return undefined;
  if (args.length === 0 && verb !== "reverse") return usage(verb);
  const { tracks, rest } = leadingTracks(score, args);
  if (
    tracks.kind === "focused" &&
    args.length > 0 &&
    !BARS.test(args[0]!) &&
    !isKeyword(args[0]!) &&
    !leadingSection(score, args)
  ) {
    // Not a track, a range or a section: another command's words
    // (`move n1 to 2`, `clear hat`, `clear volume automation`) or prose.
    return undefined;
  }
  const ranged = leadingRange(score, rest);
  if (!ranged) return usage(verb);
  if (verb === "clear" || verb === "reverse") {
    if (ranged.rest.length > 0) return usage(verb);
    return { type: verb === "clear" ? "range-clear" : "range-reverse", tracks, range: ranged.range };
  }
  const tail = parseTail(score, ranged.rest);
  if (tail.bad) return usage(verb);
  if (verb === "move") {
    if (tail.to === undefined || tail.times !== 1 || tail.mode === "merge")
      return usage("move");
    return {
      type: "range-move",
      tracks,
      range: ranged.range,
      to: tail.to,
      insert: tail.mode === "insert",
    };
  }
  if (tail.to === undefined && (tail.times !== 1 || tail.mode !== "overwrite"))
    return usage("copy");
  return {
    type: "range-copy",
    tracks,
    range: ranged.range,
    ...(tail.to !== undefined ? { to: tail.to } : {}),
    times: tail.times,
    mode: tail.mode,
  };
}

function parseBars(
  score: TrackScore,
  args: readonly string[],
): RangeCommand | undefined {
  const sub = args[0]?.toLowerCase();
  if (sub === "insert" || sub === "add") {
    // bars insert 2 at 3 · bars insert 2 (at the playhead's range start is
    // too implicit to be safe, so `at` is required)
    const count = Number(args[1]);
    const at = args[2]?.toLowerCase() === "at" ? barTarget(score, args.slice(3)) : undefined;
    if (!Number.isInteger(count) || count < 1 || count > 256 || at === undefined)
      return usage("bars");
    return { type: "bars-insert", count, at };
  }
  if (sub === "remove" || sub === "delete" || sub === "rm") {
    const ranged = leadingRange(score, args.slice(1));
    if (!ranged || ranged.rest.length > 0) return usage("bars");
    return { type: "bars-remove", range: ranged.range };
  }
  return undefined;
}

function parseJump(
  score: TrackScore,
  args: readonly string[],
): RangeCommand | undefined {
  const words = [...(args[0]?.toLowerCase() === "to" ? args.slice(1) : args)];
  if (words.length === 0) return usage("jump");
  if (words.length === 2 && words[0]!.toLowerCase() === "bar") words.shift();
  const position = /^(\d{1,4})(?:\.(\d{1,2}(?:\.\d+)?))?$/u.exec(words.join(" "));
  if (position) {
    const bar = Number(position[1]);
    const beat = position[2] === undefined ? 1 : Number(position[2]);
    if (bar < 1 || beat < 1) return usage("jump");
    return { type: "jump-bar", bar: bar - 1, beat: beat - 1 };
  }
  const section = findSection(score, words.join(" "));
  return section ? { type: "jump-section", name: section.name } : usage("jump");
}

// ---------------------------------------------------------------------------
// Apply

function trackIdsOf(tracks: RangeTracks, focused: string): readonly string[] | undefined {
  if (tracks.kind === "all") return undefined;
  return [tracks.kind === "track" ? tracks.id : focused];
}

function whoLabel(score: TrackScore, ids: readonly string[] | undefined): string {
  if (!ids) return "all tracks";
  const track = score.tracks.find((candidate) => candidate.id === ids[0]);
  return track?.name ?? ids[0]!;
}

function resolveRange(
  score: TrackScore,
  ref: RangeRef,
  playheadBar: number,
): { range: BarRange; from: string } {
  if (ref.kind === "bars") return { range: ref.range, from: "" };
  if (ref.kind === "section") {
    const section = findSection(score, ref.name)!;
    return {
      range: { startBar: section.startBar, bars: section.bars },
      from: ` (${section.name})`,
    };
  }
  const resolved = rangeOf(score, playheadBar);
  const from =
    resolved.source === "loop"
      ? " (loop)"
      : resolved.source === "section"
        ? ` (${resolved.section})`
        : " (playhead)";
  return { range: resolved.range, from };
}

function notesWord(count: number): string {
  return `${count} ${count === 1 ? "note" : "notes"}`;
}

function edited(
  next: TrackScore,
  message: string,
  payload: Record<string, unknown>,
): RangeResult {
  return { ok: true, message, next, kind: "score.range", payload };
}

/** Apply a parsed command; validation errors become refusals. */
export function applyRangeCommand(
  score: TrackScore,
  context: RangeContext,
  command: RangeCommand,
): RangeResult {
  try {
    return applyUnchecked(score, context, command);
  } catch (error) {
    if (error instanceof ScoreValidationError)
      return {
        ok: false,
        message: `${verbOf(command)} · ${error.message}`,
      };
    throw error;
  }
}

function verbOf(command: RangeCommand): string {
  switch (command.type) {
    case "bars-insert":
    case "bars-remove":
      return "bars";
    case "loop-step":
      return "loop";
    case "jump-bar":
    case "jump-section":
      return "jump";
    case "range-usage":
      return command.verb;
    default:
      return command.type.slice("range-".length);
  }
}

function applyUnchecked(
  score: TrackScore,
  context: RangeContext,
  command: RangeCommand,
): RangeResult {
  switch (command.type) {
    case "range-usage":
      return { ok: false, message: command.message };
    case "range-copy": {
      const ids = trackIdsOf(command.tracks, context.trackId);
      const { range, from } = resolveRange(score, command.range, context.playheadBar);
      const who = whoLabel(score, ids);
      if (command.to === undefined) {
        const clip = extractRange(score, ids, range);
        return {
          ok: true,
          message: `copied · ${who} ${barsWord(range)}${from} · ${notesWord(clipNoteCount(clip))} · paste at <bar>`,
          clipboard: { clip, source: ids?.[0] ?? "all", range },
        };
      }
      const next = copyRange(score, ids, range, command.to, {
        times: command.times,
        mode: command.mode,
      });
      const landed: BarRange = {
        startBar: command.to,
        bars: range.bars * command.times,
      };
      const count = notesInRange(score, ids, range) * command.times;
      return edited(
        next,
        `copy · ${who} ${barsWord(range)}${from} → ${rangeLabel(landed)}${command.times > 1 ? ` ×${command.times}` : ""}${command.mode === "overwrite" ? "" : ` ${command.mode}`} · ${notesWord(count)}${next.bars !== score.bars ? ` · ${next.bars} bars` : ""}`,
        { range, to: command.to, times: command.times, mode: command.mode, tracks: ids ?? "all" },
      );
    }
    case "range-move": {
      const ids = trackIdsOf(command.tracks, context.trackId);
      const { range, from } = resolveRange(score, command.range, context.playheadBar);
      const next = moveRange(score, ids, range, command.to, { insert: command.insert });
      const count = notesInRange(score, ids, range);
      return edited(
        next,
        `move · ${whoLabel(score, ids)} ${barsWord(range)}${from} → ${rangeLabel({ startBar: command.to, bars: range.bars })}${command.insert ? " insert" : ""} · ${notesWord(count)}`,
        { range, to: command.to, insert: command.insert, tracks: ids ?? "all" },
      );
    }
    case "range-clear": {
      const ids = trackIdsOf(command.tracks, context.trackId);
      const { range, from } = resolveRange(score, command.range, context.playheadBar);
      const count = notesInRange(score, ids, range);
      const next = clearRange(score, ids, range);
      if (next === score || (count === 0 && sameMusic(score, next)))
        return {
          ok: true,
          message: `clear · ${whoLabel(score, ids)} ${barsWord(range)}${from} · already silent`,
        };
      return edited(
        next,
        `clear · ${whoLabel(score, ids)} ${barsWord(range)}${from} · −${notesWord(count)} · the bars stay`,
        { range, tracks: ids ?? "all" },
      );
    }
    case "range-reverse": {
      const ids = trackIdsOf(command.tracks, context.trackId);
      const { range, from } = resolveRange(score, command.range, context.playheadBar);
      const next = reverseRange(score, ids, range);
      return edited(
        next,
        `reverse · ${whoLabel(score, ids)} ${barsWord(range)}${from} · ${notesWord(notesInRange(score, ids, range))}`,
        { range, tracks: ids ?? "all" },
      );
    }
    case "range-paste": {
      const board = context.clipboard;
      if (!board)
        return {
          ok: false,
          message: "paste · the clipboard is empty · copy bass 5-6 fills it",
        };
      const at = command.at ?? Math.max(0, Math.min(score.bars, Math.floor(context.playheadBar)));
      const target = board.clip.all ? undefined : context.trackId;
      if (target && !score.tracks.some((track) => track.id === target))
        return { ok: false, message: `paste · no track ${target}` };
      const next = placeRange(score, board.clip, at, {
        times: command.times,
        mode: command.mode,
        ...(target ? { target } : {}),
      });
      const landed: BarRange = { startBar: at, bars: board.clip.bars * command.times };
      return edited(
        next,
        `paste · ${board.clip.all ? "all tracks" : whoLabel(score, [target!])} → ${barsWord(landed)}${command.times > 1 ? ` ×${command.times}` : ""}${command.mode === "overwrite" ? "" : ` ${command.mode}`} · ${notesWord(clipNoteCount(board.clip) * command.times)}`,
        { at, times: command.times, mode: command.mode },
      );
    }
    case "bars-insert": {
      if (command.at > score.bars)
        return {
          ok: false,
          message: `bars · bar ${command.at + 1} is past the song's ${score.bars} bars`,
        };
      const next = insertBars(score, command.at, command.count);
      return edited(
        next,
        `bars · +${command.count} at bar ${command.at + 1} · later music moves right · ${next.bars} bars`,
        { insert: command.count, at: command.at, bars: next.bars },
      );
    }
    case "bars-remove": {
      const { range, from } = resolveRange(score, command.range, context.playheadBar);
      if (range.startBar >= score.bars)
        return {
          ok: false,
          message: `bars · bar ${range.startBar + 1} is past the song's ${score.bars} bars`,
        };
      const bars = Math.min(range.bars, score.bars - range.startBar);
      if (bars >= score.bars)
        return { ok: false, message: "bars · the song keeps at least one bar" };
      const next = deleteBars(score, range.startBar, bars);
      return edited(
        next,
        `bars · removed ${barsWord({ startBar: range.startBar, bars })}${from} · later music moves left · ${next.bars} bars`,
        { remove: { startBar: range.startBar, bars }, bars: next.bars },
      );
    }
    case "loop-step": {
      const current = score.loop ?? loopedRange(score);
      if (!current)
        return { ok: false, message: "loop · nothing loops · loop 5-6 first" };
      const stepped = steppedLoop(score, current, command.direction);
      if (!stepped)
        return {
          ok: false,
          message: `loop · ${rangeLabel(current)} is at the ${command.direction > 0 ? "end" : "start"} of the song`,
        };
      return {
        ...edited(score.withLoop(stepped), `loop · bars ${rangeLabel(stepped)}`, {
          loop: stepped,
        }),
        kind: "score.loop",
      };
    }
    case "jump-section":
      return { ok: true, message: "", delegate: `section jump ${command.name}` };
    case "jump-bar":
      return jumpTo(score, command.bar, command.beat);
  }
}

function sameMusic(a: TrackScore, b: TrackScore): boolean {
  return JSON.stringify(a.toJSON()) === JSON.stringify(b.toJSON());
}

function loopedRange(score: TrackScore): BarRange | undefined {
  if (score.loopSection === undefined) return undefined;
  const section = findSection(score, score.loopSection);
  return section ? { startBar: section.startBar, bars: section.bars } : undefined;
}

/** The transport beat for bar.beat (both 0-based) on the score. */
function jumpTo(score: TrackScore, bar: number, beat: number): RangeResult {
  if (bar >= score.bars)
    return {
      ok: false,
      message: `jump · bar ${bar + 1} is past the song's ${score.bars} bars`,
    };
  const perBar =
    (barStartTick(score, bar + 1) - barStartTick(score, bar)) / score.ticksPerBeat;
  if (beat >= perBar)
    return { ok: false, message: `jump · bar ${bar + 1} has ${perBar} beats` };
  const label = `bar ${bar + 1}${beat > 0 ? `.${beat + 1}` : ""}`;
  const looped = score.loop ?? loopedRange(score);
  const at = barStartTick(score, bar) / score.ticksPerBeat + beat;
  if (looped) {
    const start = barStartTick(score, looped.startBar) / score.ticksPerBeat;
    const end =
      barStartTick(score, looped.startBar + looped.bars) / score.ticksPerBeat;
    if (at < start || at >= end)
      return {
        ok: false,
        message: `jump · ${label} is outside the loop ${rangeLabel(looped)} · loop off first`,
      };
    return { ok: true, message: `jump · ${label}`, seekBeat: at - start };
  }
  if (score.form.length > 0) {
    // The first pass of the form that plays this bar.
    const segment = formSegments(score).find(
      (candidate) =>
        bar >= candidate.section.startBar &&
        bar < candidate.section.startBar + candidate.section.bars,
    );
    if (!segment)
      return {
        ok: false,
        message: `jump · the form never plays ${label} · form off plays every bar`,
      };
    const perScoreBar = score.beatsPerBar;
    const arranged =
      (segment.startBar + bar - segment.section.startBar) * perScoreBar + beat;
    return { ok: true, message: `jump · ${label} (${segment.section.name})`, seekBeat: arranged };
  }
  return { ok: true, message: `jump · ${label}`, seekBeat: at };
}
