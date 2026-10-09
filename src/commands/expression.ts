/**
 * Expression and performance commands. Note settings apply to a target on
 * the focused track; track settings shape every note it plays.
 *
 *   art <articulation>|off [target]          staccato legato accent tenuto marcato ghost
 *   bend <cents>|scoop|fall|doit|<at:cents>…|off [target]
 *   vibrato <rate> <depth> [<delay>]|off [target]
 *   glide <ms>|off <target>                  portamento into each note
 *   glide <ms>|0|off [legato|mono|poly]      the track's glide (`glide mono`)
 *   pedal <beat>-<beat>…|bars [<bar>-<bar>]|down|half|up <beat>|off
 *   pedal soft|sost <same forms>             una corda and sostenuto (0.6.1)
 *   velcurve linear|soft|hard|fixed [<v>]
 *   humanize <ms> [<vel%> [<len%>]] [seed <n>]|on|off|reseed|seed <n>
 *   humanize <ms> [<vel%> [<len%>]]|exact|off <target>   per-note amounts
 *   expression                               what the track does
 *
 * A target is `all` (the default), `bar <n>`, `bars <a>-<b>` (1-based, notes
 * that start there) or note ids. Beats are 0-based like `automate`. Times
 * are milliseconds when bare (`glide 60`) or take a unit (`glide 60ms`,
 * `glide 0.06s`); a bare fraction like `glide 0.06` is rejected as a unit
 * slip. Parsing is pure; applying returns the next score and the session
 * event.
 */
import {
  ARTICULATIONS,
  ARTICULATION_EFFECTS,
  DEFAULT_GLIDE_SECONDS,
  EXPRESSION_LIMITS,
  ExpressionValidationError,
  GLIDE_MODES,
  VELOCITY_CURVES,
  normalizeArticulation,
  normalizeBend,
  normalizeHumanize,
  normalizePedal,
  SOSTENUTO_STATES,
  normalizeTrackGlide,
  normalizeVelocityCurve,
  normalizeVibrato,
  type Articulation,
  type BendPoint,
  type GlideMode,
  type Humanize,
  type NoteExpressionPatch,
  type NoteHumanize,
  type NoteVibrato,
  type PedalEvent,
  type PedalState,
  type VelocityCurveName,
} from "../../core/expression.ts";
import {
  ScoreValidationError,
  TrackScore,
  updateTrack,
  type Note,
  type Track,
} from "../../core/score.ts";
import { barStartTick, loopTicksOf } from "../../core/tempo.ts";

export type NoteTarget =
  | { type: "all" }
  /** The note added most recently on the track. */
  | { type: "last" }
  /** 1-based, inclusive. */
  | { type: "bars"; from: number; to: number }
  | { type: "ids"; ids: readonly string[] };

export type ExpressionCommand =
  | {
      type: "articulation";
      articulation: Articulation | null;
      target: NoteTarget;
    }
  | { type: "bend"; bend: readonly BendPoint[] | null; target: NoteTarget }
  | { type: "vibrato"; vibrato: NoteVibrato | null; target: NoteTarget }
  | { type: "note-glide"; glide: number | null; target: NoteTarget }
  | { type: "track-glide"; time?: number | null; mode?: GlideMode }
  | {
      type: "pedal-spans";
      spans: readonly { from: number; to: number }[];
      lane?: PedalLane;
    }
  | { type: "pedal-bars"; from?: number; to?: number; lane?: PedalLane }
  | { type: "pedal-list"; lane?: PedalLane }
  | { type: "pedal-event"; state: PedalState; beat: number; lane?: PedalLane }
  | { type: "pedal-off"; lane?: PedalLane }
  | { type: "velcurve"; curve: VelocityCurveName; fixed?: number }
  | {
      type: "humanize";
      timing: number;
      velocity: number;
      length: number;
      seed?: number;
    }
  /** Per-note humanize: amounts replace the track's; `{}` keeps notes exact. */
  | {
      type: "note-humanize";
      humanize: NoteHumanize | null;
      target: NoteTarget;
    }
  | { type: "humanize-off" }
  | { type: "humanize-seed"; seed?: number }
  | { type: "show" }
  /** Recognised but unusable (`glide 0.06`): fail with `message`. */
  | { type: "invalid"; message: string };

/** Named bend shapes (jazz brass and vocal idioms), in cents. */
export const BEND_SHAPES: Readonly<Record<string, readonly BendPoint[]>> =
  Object.freeze({
    /** Scoop up into the note from a semitone below. */
    scoop: [
      { at: 0, cents: -100 },
      { at: 0.2, cents: 0 },
    ],
    /** Fall off the end of the note. */
    fall: [
      { at: 0.6, cents: 0 },
      { at: 1, cents: -500 },
    ],
    /** Rip up off the end of the note. */
    doit: [
      { at: 0.6, cents: 0 },
      { at: 1, cents: 500 },
    ],
  });

/** Turned on without amounts: a light, audible feel. */
export const DEFAULT_HUMANIZE = Object.freeze({ timing: 8, velocity: 8 });

const ARTICULATION_ALIASES: Readonly<Record<string, Articulation>> = {
  stac: "staccato",
  stacc: "staccato",
  leg: "legato",
  acc: "accent",
  ten: "tenuto",
  marc: "marcato",
};

const NUMBER = /^[+-]?\d+(?:\.\d+)?$/;
const NOTE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const OFF = /^(off|none|clear|reset)$/i;

/** `60ms` → 0.06, `0.06`/`0.06s` → 0.06; undefined when not a time. */
export function parseSeconds(text: string): number | undefined {
  const match = text.match(/^(\d+(?:\.\d+)?)(ms|s)?$/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return match[2]?.toLowerCase() === "ms" ? value / 1000 : value;
}

/** Note target words; undefined when they are not a target. */
export function parseNoteTarget(
  words: readonly string[],
): NoteTarget | undefined {
  if (words.length === 0) return { type: "all" };
  const [first, second, ...rest] = words.map((word) => word.toLowerCase());
  if (first === "all" && words.length === 1) return { type: "all" };
  if (first === "last" && words.length === 1) return { type: "last" };
  if ((first === "bar" || first === "bars") && second && rest.length === 0) {
    const range = second.match(/^(\d+)(?:-(\d+))?$/);
    if (!range) return undefined;
    const from = Number(range[1]);
    const to = Number(range[2] ?? range[1]);
    return from >= 1 && to >= from ? { type: "bars", from, to } : undefined;
  }
  return words.every((word) => NOTE_ID.test(word))
    ? { type: "ids", ids: [...new Set(words)] }
    : undefined;
}

function articulationWord(word: string): Articulation | undefined {
  const lower = word.toLowerCase();
  const alias = ARTICULATION_ALIASES[lower];
  if (alias) return alias;
  try {
    return normalizeArticulation(lower);
  } catch {
    return undefined;
  }
}

function parseBend(words: string[]): ExpressionCommand | undefined {
  const [first] = words;
  if (!first) return undefined;
  if (OFF.test(first)) {
    const target = parseNoteTarget(words.slice(1));
    return target ? { type: "bend", bend: null, target } : undefined;
  }
  const shape = BEND_SHAPES[first.toLowerCase()];
  if (shape) {
    const target = parseNoteTarget(words.slice(1));
    return target ? { type: "bend", bend: shape, target } : undefined;
  }
  if (NUMBER.test(first)) {
    const cents = Number(first);
    if (Math.abs(cents) > EXPRESSION_LIMITS.maxBendCents) return undefined;
    const target = parseNoteTarget(words.slice(1));
    return target
      ? {
          type: "bend",
          bend: [
            { at: 0, cents: 0 },
            { at: 1, cents },
          ],
          target,
        }
      : undefined;
  }
  const points: BendPoint[] = [];
  let index = 0;
  for (; index < words.length; index += 1) {
    const pair = words[index]!.split(":");
    if (pair.length !== 2 || !NUMBER.test(pair[0]!) || !NUMBER.test(pair[1]!))
      break;
    points.push({ at: Number(pair[0]), cents: Number(pair[1]) });
  }
  if (points.length === 0) return undefined;
  const target = parseNoteTarget(words.slice(index));
  if (!target) return undefined;
  try {
    return { type: "bend", bend: normalizeBend(points)!, target };
  } catch {
    return undefined;
  }
}

function parseVibrato(words: string[]): ExpressionCommand | undefined {
  const [first] = words;
  if (!first) return undefined;
  if (OFF.test(first)) {
    const target = parseNoteTarget(words.slice(1));
    return target ? { type: "vibrato", vibrato: null, target } : undefined;
  }
  const numbers: number[] = [];
  let index = 0;
  for (; index < words.length && numbers.length < 3; index += 1) {
    const word = words[index]!.replace(/(hz|c|ct|cents|s)$/i, "");
    if (!NUMBER.test(word)) break;
    numbers.push(Number(word));
  }
  if (numbers.length === 0) return undefined;
  const target = parseNoteTarget(words.slice(index));
  if (!target) return undefined;
  try {
    const vibrato = normalizeVibrato({
      rate: numbers[0],
      ...(numbers[1] !== undefined ? { depth: numbers[1] } : {}),
      ...(numbers[2] !== undefined ? { delay: numbers[2] } : {}),
    });
    return vibrato ? { type: "vibrato", vibrato, target } : undefined;
  } catch {
    return undefined;
  }
}

function parseGlide(words: string[]): ExpressionCommand | undefined {
  const [first, ...rest] = words;
  if (!first) return undefined;
  const mode = GLIDE_MODES.find((candidate) => candidate === first);
  if (mode && rest.length === 0) return { type: "track-glide", mode };
  // A bare number is milliseconds here (`glide 60`); `0.06s` is seconds. A
  // bare fraction of a millisecond is a unit slip, not a glide.
  if (NUMBER.test(first) && Number(first) > 0 && Number(first) < 1)
    return {
      type: "invalid",
      message: `glide · a bare number is ms · write glide ${Math.round(Number(first) * 1000)}ms or glide ${first}s`,
    };
  const time = OFF.test(first)
    ? null
    : NUMBER.test(first)
      ? Number(first) / 1000
      : parseSeconds(first);
  if (time === undefined || (time !== null && time < 0)) return undefined;
  if (time !== null && time > EXPRESSION_LIMITS.maxGlideSeconds)
    return undefined;
  // `glide 0` on the track turns glide off; on a target it means never.
  if (rest.length === 0)
    return { type: "track-glide", time: time === 0 ? null : time };
  const restMode = GLIDE_MODES.find((candidate) => candidate === rest[0]);
  if (restMode && rest.length === 1)
    return time === null
      ? undefined
      : { type: "track-glide", time, mode: restMode };
  // A misspelt mode (`legatoo`) is a typo, not a note id.
  if (rest.length === 1 && GLIDE_MODES.some((mode) => nearWord(rest[0]!, mode)))
    return undefined;
  const target = parseNoteTarget(rest);
  return target ? { type: "note-glide", glide: time, target } : undefined;
}

/** Within two edits of `word` (a likely typo of it). */
function nearWord(text: string, word: string): boolean {
  if (Math.abs(text.length - word.length) > 2) return false;
  let previous = Array.from({ length: word.length + 1 }, (_, index) => index);
  for (let i = 1; i <= text.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= word.length; j += 1)
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (text[i - 1] === word[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[word.length]! <= 2;
}

/**
 * Which pedal a `pedal` command edits (0.6.1): absent is the sustain
 * pedal, `soft` the una corda (Track.softPedal), `sost` the sostenuto.
 */
export type PedalLane = "soft" | "sost";

const PEDAL_LANES: Readonly<Record<string, PedalLane>> = {
  soft: "soft",
  unacorda: "soft",
  sost: "sost",
  sostenuto: "sost",
};

function parsePedal(words: string[]): ExpressionCommand | undefined {
  const lane = words[0] ? PEDAL_LANES[words[0]] : undefined;
  if (lane) {
    const command = parsePedalLane(words.slice(1));
    return command && command.type.startsWith("pedal-")
      ? ({ ...command, lane } as ExpressionCommand)
      : undefined;
  }
  return parsePedalLane(words);
}

function parsePedalLane(words: string[]): ExpressionCommand | undefined {
  const [first, ...rest] = words;
  if (!first) return { type: "pedal-list" };
  if (OFF.test(first) && rest.length === 0) return { type: "pedal-off" };
  if (first === "bars" || first === "bar") {
    if (rest.length === 0) return { type: "pedal-bars" };
    const range =
      rest.length === 1 ? rest[0]!.match(/^(\d+)(?:-(\d+))?$/) : null;
    if (!range) return undefined;
    const from = Number(range[1]);
    const to = Number(range[2] ?? range[1]);
    return from >= 1 && to >= from
      ? { type: "pedal-bars", from, to }
      : undefined;
  }
  if (first === "down" || first === "half" || first === "up") {
    const beat = rest.length === 1 ? rest[0]!.replace(/^at$/, "") : "";
    const value = rest.length === 2 && rest[0] === "at" ? rest[1]! : beat;
    return NUMBER.test(value) && Number(value) >= 0
      ? { type: "pedal-event", state: first, beat: Number(value) }
      : undefined;
  }
  const spans: { from: number; to: number }[] = [];
  for (const word of words) {
    const span = word.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if (!span) return undefined;
    const from = Number(span[1]);
    const to = Number(span[2]);
    if (!(to > from)) return undefined;
    spans.push({ from, to });
  }
  return { type: "pedal-spans", spans };
}

function parseHumanize(words: string[]): ExpressionCommand | undefined {
  const [first, ...rest] = words;
  if (!first) return { type: "show" };
  if (OFF.test(first) && rest.length === 0) return { type: "humanize-off" };
  // `humanize off|exact <target>`: clear the notes' own humanize, or keep
  // them exact (`{}`) whatever the track does.
  if ((OFF.test(first) || first === "exact") && rest.length > 0) {
    const target = parseNoteTarget(rest);
    return target
      ? {
          type: "note-humanize",
          humanize: OFF.test(first) ? null : {},
          target,
        }
      : undefined;
  }
  if (first === "on" && rest.length === 0)
    return { type: "humanize", ...DEFAULT_HUMANIZE, length: 0 };
  if (first === "reseed" && rest.length === 0) return { type: "humanize-seed" };
  if (first === "seed")
    return rest.length === 1 && /^\d+$/.test(rest[0]!)
      ? { type: "humanize-seed", seed: Number(rest[0]) }
      : undefined;
  const amounts: number[] = [];
  let seed: number | undefined;
  let target: NoteTarget | undefined;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (word === "seed") {
      const value = words[index + 1];
      if (!value || !/^\d+$/.test(value) || index + 2 !== words.length)
        return undefined;
      seed = Number(value);
      break;
    }
    const amount = word.replace(/(ms|%)$/i, "");
    if (NUMBER.test(amount) && amounts.length < 3) {
      if (Number(amount) < 0) return undefined;
      amounts.push(Number(amount));
      continue;
    }
    // Anything after the amounts is a note target (`humanize 10 8 bars 2-3`).
    if (amounts.length === 0) return undefined;
    target = parseNoteTarget(words.slice(index));
    if (!target) return undefined;
    break;
  }
  if (amounts.length === 0) return undefined;
  const [timing = 0, velocity = 0, length = 0] = amounts;
  if (
    timing > EXPRESSION_LIMITS.maxHumanizeTimingMs ||
    velocity > EXPRESSION_LIMITS.maxHumanizePercent ||
    length > EXPRESSION_LIMITS.maxHumanizePercent ||
    (seed !== undefined && seed > EXPRESSION_LIMITS.maxSeed)
  )
    return undefined;
  if (target)
    return {
      type: "note-humanize",
      humanize: {
        ...(timing > 0 ? { timing } : {}),
        ...(velocity > 0 ? { velocity } : {}),
        ...(length > 0 ? { length } : {}),
      },
      target,
    };
  return {
    type: "humanize",
    timing,
    velocity,
    length,
    ...(seed !== undefined ? { seed } : {}),
  };
}

export function parseExpressionCommand(
  prompt: string,
): ExpressionCommand | undefined {
  const text = prompt.trim().replace(/\s+/g, " ");
  if (text.length > 1_024) return undefined;
  const [verb, ...words] = text.replace(/^\//, "").split(" ");
  switch (verb?.toLowerCase()) {
    case "art":
    case "articulation": {
      const [first, ...rest] = words;
      if (!first) return undefined;
      const articulation = OFF.test(first) ? null : articulationWord(first);
      if (articulation === undefined) return undefined;
      const target = parseNoteTarget(rest);
      return target
        ? { type: "articulation", articulation, target }
        : undefined;
    }
    case "bend":
      return parseBend(words);
    case "vibrato":
      return parseVibrato(words);
    case "glide":
    case "portamento":
      return parseGlide(words.map((word) => word.toLowerCase()));
    case "pedal":
    case "sustain":
      return parsePedal(words.map((word) => word.toLowerCase()));
    case "velcurve":
    case "vel-curve": {
      const [first, value, extra] = words.map((word) => word.toLowerCase());
      const curve = VELOCITY_CURVES.find((candidate) => candidate === first);
      if (!curve || extra !== undefined) return undefined;
      if (value === undefined) return { type: "velcurve", curve };
      if (curve !== "fixed" || !NUMBER.test(value)) return undefined;
      // 0..1, like note velocity everywhere else in dawg.
      const fixed = Number(value);
      return fixed >= 0 && fixed <= 1
        ? { type: "velcurve", curve, fixed }
        : undefined;
    }
    case "humanize":
      return parseHumanize(words.map((word) => word.toLowerCase()));
    case "expression":
    case "performance":
      return words.length === 0 ? { type: "show" } : undefined;
    default:
      return undefined;
  }
}

export type ExpressionResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

/** The notes `target` names: ids anywhere, otherwise notes on `trackId`. */
export function targetNotes(
  score: TrackScore,
  trackId: string,
  target: NoteTarget,
): Note[] {
  if (target.type === "ids") {
    const ids = new Set(target.ids);
    return score.notes.filter((note) => ids.has(note.id));
  }
  const notes = score.notes.filter((note) => note.trackId === trackId);
  if (target.type === "all") return notes;
  if (target.type === "last") return notes.slice(-1);
  // Bars follow the meter map: bar n runs from the start of bar n to n + 1.
  const from = barStartTick(score, target.from - 1);
  const to = barStartTick(score, target.to);
  return notes.filter((note) => note.startTick >= from && note.startTick < to);
}

export function describeTarget(target: NoteTarget): string {
  if (target.type === "all") return "all notes";
  if (target.type === "last") return "last note";
  if (target.type === "ids")
    return target.ids.length === 1
      ? target.ids[0]!
      : `${target.ids.length} ids`;
  return target.from === target.to
    ? `bar ${target.from}`
    : `bars ${target.from}-${target.to}`;
}

/**
 * Apply `patch` to every note in `noteIds` as one new score (one revision).
 * Throws ScoreValidationError when a value is out of range.
 */
export function patchNotes(
  score: TrackScore,
  noteIds: ReadonlySet<string>,
  patch: NoteExpressionPatch,
): TrackScore {
  if (noteIds.size === 0) return score;
  return new TrackScore({
    ...score.toJSON(),
    notes: score.notes.map((note) => {
      if (!noteIds.has(note.id)) return note;
      const next: Record<string, unknown> = { ...note };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete next[key];
        else if (value !== undefined) next[key] = value;
      }
      return next as Note;
    }),
  });
}

function cents(value: number): string {
  return `${value > 0 ? "+" : ""}${Math.round(value)}c`;
}

function ms(seconds: number): string {
  return `${Math.round(seconds * 1000)} ms`;
}

export function describeBend(bend: readonly BendPoint[]): string {
  const shape = Object.entries(BEND_SHAPES).find(
    ([, points]) =>
      points.length === bend.length &&
      points.every(
        (point, index) =>
          point.at === bend[index]!.at && point.cents === bend[index]!.cents,
      ),
  );
  if (shape) return shape[0];
  return bend.map((point) => `${point.at}:${cents(point.cents)}`).join(" ");
}

export function describeVibrato(vibrato: NoteVibrato): string {
  return `${vibrato.rate} Hz ±${vibrato.depth}c${vibrato.delay ? ` after ${ms(vibrato.delay)}` : ""}`;
}

export function describeHumanize(humanize: Humanize | undefined): string {
  if (!humanize) return "off";
  return `±${humanize.timing ?? 0} ms · vel ±${humanize.velocity ?? 0}% · len ±${humanize.length ?? 0}% · seed ${humanize.seed}`;
}

function describeNoteHumanize(humanize: NoteHumanize): string {
  return `±${humanize.timing ?? 0} ms · vel ±${humanize.velocity ?? 0}% · len ±${humanize.length ?? 0}%`;
}

/** One line for the track's performance settings and note expression. */
export function describePerformance(score: TrackScore, track: Track): string {
  const notes = score.notes.filter((note) => note.trackId === track.id);
  const count = (key: keyof Note) =>
    notes.filter((note) => note[key] !== undefined).length;
  const parts = [
    `glide ${track.glide ? `${ms(track.glide.time)} ${track.glide.mode}` : "off"}`,
    `pedal ${track.pedal ? `${track.pedal.length} event${track.pedal.length === 1 ? "" : "s"}` : "off"}`,
    ...(track.softPedal
      ? [
          `soft ${track.softPedal.length} event${track.softPedal.length === 1 ? "" : "s"}`,
        ]
      : []),
    ...(track.sostenuto
      ? [
          `sost ${track.sostenuto.length} event${track.sostenuto.length === 1 ? "" : "s"}`,
        ]
      : []),
    `velcurve ${track.velocityCurve ? `${track.velocityCurve.curve}${track.velocityCurve.fixed !== undefined ? ` ${track.velocityCurve.fixed}` : ""}` : "linear"}`,
    `humanize ${describeHumanize(track.humanize)}`,
  ];
  const marked = [
    ["art", count("articulation")],
    ["bend", count("bend")],
    ["vibrato", count("vibrato")],
    ["glide", count("glide")],
  ].filter(([, value]) => (value as number) > 0);
  return `expression · ${track.id} · ${parts.join(" · ")}${
    marked.length > 0
      ? ` · notes ${marked.map(([name, value]) => `${name} ${value}`).join(", ")}`
      : ""
  }`;
}

function noteResult(
  score: TrackScore,
  trackId: string,
  target: NoteTarget,
  patch: NoteExpressionPatch,
  label: string,
  value: string,
): ExpressionResult {
  const notes = targetNotes(score, trackId, target);
  if (target.type === "ids") {
    const known = new Set(notes.map((note) => note.id));
    const unknown = target.ids.find((id) => !known.has(id));
    if (unknown !== undefined)
      return {
        ok: false,
        message: `${label} · unknown note id ${unknown} · targets: all, last, bar 3, bars 2-4, ids`,
      };
  }
  if (notes.length === 0)
    return {
      ok: false,
      message: `${label} · no notes in ${describeTarget(target)} on ${trackId}`,
    };
  const noteIds = new Set(notes.map((note) => note.id));
  let next: TrackScore;
  try {
    next = patchNotes(score, noteIds, patch);
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof ExpressionValidationError
    )
      return { ok: false, message: `${label} · ${error.message}` };
    throw error;
  }
  return {
    ok: true,
    message: `${label} · ${value} · ${notes.length} note${notes.length === 1 ? "" : "s"} (${describeTarget(target)})`,
    next,
    kind: "score.expression",
    payload: { trackId, noteIds: [...noteIds], patch },
  };
}

function trackResult(
  score: TrackScore,
  track: Track,
  patch: Readonly<Record<string, unknown>>,
  message: string,
): ExpressionResult {
  let next: TrackScore;
  try {
    next = updateTrack(score, track.id, patch);
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof ExpressionValidationError
    )
      return {
        ok: false,
        message: message.split(" · ")[0] + ` · ${error.message}`,
      };
    throw error;
  }
  return {
    ok: true,
    message,
    next,
    kind: "score.performance",
    payload: { trackId: track.id, patch },
  };
}

/** Pedal events that re-pedal at every bar line of bars `from`..`to`. */
export function barPedal(
  score: TrackScore,
  from = 1,
  to = score.bars,
): PedalEvent[] {
  // Legato (syncopated) pedalling: lift at the bar line, catch the new
  // harmony a 32nd note later so the previous chord does not blur into it.
  const catchTicks = Math.max(1, Math.round(score.ticksPerBeat / 8));
  const events: PedalEvent[] = [];
  const last = Math.min(to, score.bars);
  for (let bar = from; bar <= last; bar += 1) {
    const start = barStartTick(score, bar - 1);
    if (bar > from) events.push({ tick: start, state: "up" });
    events.push({ tick: start + (bar > from ? catchTicks : 0), state: "down" });
  }
  events.push({
    tick: Math.min(barStartTick(score, last), loopTicksOf(score)),
    state: "up",
  });
  return events;
}

function mergePedal(
  current: readonly PedalEvent[] | undefined,
  added: readonly PedalEvent[],
  maxTick: number,
  label?: string,
  states?: readonly PedalState[],
): readonly PedalEvent[] | undefined {
  const byTick = new Map((current ?? []).map((event) => [event.tick, event]));
  for (const event of added) byTick.set(event.tick, event);
  return normalizePedal([...byTick.values()], maxTick, label, states);
}

/** The Track field, message label and allowed states of a pedal lane. */
function pedalLaneOf(lane: PedalLane | undefined): {
  field: "pedal" | "softPedal" | "sostenuto";
  label: string;
  states?: readonly PedalState[];
} {
  if (lane === "soft") return { field: "softPedal", label: "soft pedal" };
  if (lane === "sost")
    return { field: "sostenuto", label: "sostenuto", states: SOSTENUTO_STATES };
  return { field: "pedal", label: "pedal" };
}

/** Apply `command` to the focused track `trackId`. */
export function applyExpressionCommand(
  score: TrackScore,
  trackId: string,
  command: ExpressionCommand,
): ExpressionResult {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  const tpb = score.ticksPerBeat;
  const maxTick = loopTicksOf(score);
  switch (command.type) {
    case "show":
      return { ok: true, message: describePerformance(score, track) };
    case "invalid":
      return { ok: false, message: command.message };
    case "articulation":
      return noteResult(
        score,
        trackId,
        command.target,
        { articulation: command.articulation },
        "art",
        command.articulation
          ? `${command.articulation} (${ARTICULATION_EFFECTS[command.articulation].doc})`
          : "off",
      );
    case "bend":
      return noteResult(
        score,
        trackId,
        command.target,
        { bend: command.bend },
        "bend",
        command.bend ? describeBend(command.bend) : "off",
      );
    case "vibrato":
      return noteResult(
        score,
        trackId,
        command.target,
        { vibrato: command.vibrato },
        "vibrato",
        command.vibrato ? describeVibrato(command.vibrato) : "off",
      );
    case "note-glide":
      return noteResult(
        score,
        trackId,
        command.target,
        { glide: command.glide },
        "glide",
        command.glide === null
          ? "off"
          : command.glide === 0
            ? "never"
            : ms(command.glide),
      );
    case "track-glide": {
      if (command.time === null)
        return track.glide
          ? trackResult(
              score,
              track,
              { glide: null },
              `glide · off · ${trackId}`,
            )
          : { ok: true, message: `glide · already off · ${trackId}` };
      const glide = normalizeTrackGlide({
        time: command.time ?? track.glide?.time ?? DEFAULT_GLIDE_SECONDS,
        mode: command.mode ?? track.glide?.mode ?? "legato",
      })!;
      const how =
        glide.mode === "legato"
          ? "slides only between overlapping notes"
          : glide.mode === "mono"
            ? "one voice, every note slides"
            : "every voice slides from the previous note";
      return trackResult(
        score,
        track,
        { glide },
        `glide · ${ms(glide.time)} ${glide.mode} (${how}) · ${trackId}`,
      );
    }
    case "pedal-list": {
      const { field, label } = pedalLaneOf(command.lane);
      const events = track[field] ?? [];
      if (events.length === 0)
        return {
          ok: true,
          message: `${label} · none on ${trackId} · ${command.lane ? `pedal ${command.lane} 0-4` : "pedal bars"} to add`,
        };
      const shown = events
        .slice(0, 12)
        .map(
          (event) =>
            `${Math.round((event.tick / score.ticksPerBeat) * 1000) / 1000} ${event.state}`,
        );
      if (events.length > 12) shown.push(`+${events.length - 12} more`);
      return {
        ok: true,
        message: `${label} · ${shown.join(" · ")} · ${trackId}`,
      };
    }
    case "pedal-off": {
      const { field, label } = pedalLaneOf(command.lane);
      return track[field]
        ? trackResult(
            score,
            track,
            { [field]: null },
            `${label} · off · ${trackId}`,
          )
        : { ok: true, message: `${label} · already off · ${trackId}` };
    }
    case "pedal-spans":
    case "pedal-bars":
    case "pedal-event": {
      const { field, label, states } = pedalLaneOf(command.lane);
      let added: PedalEvent[];
      if (command.type === "pedal-bars") {
        const from = command.from ?? 1;
        if (from > score.bars)
          return {
            ok: false,
            message: `${label} · the loop has ${score.bars} bar${score.bars === 1 ? "" : "s"}`,
          };
        const to = Math.min(command.to ?? score.bars, score.bars);
        // Soft and sostenuto hold through the bars (no re-pedalling).
        added = command.lane
          ? [
              { tick: barStartTick(score, from - 1), state: "down" },
              {
                tick: Math.min(barStartTick(score, to), maxTick),
                state: "up",
              },
            ]
          : barPedal(score, from, to);
      } else if (command.type === "pedal-event") {
        added = [
          { tick: Math.round(command.beat * tpb), state: command.state },
        ];
      } else {
        added = command.spans.flatMap((span) => [
          { tick: Math.round(span.from * tpb), state: "down" as const },
          { tick: Math.round(span.to * tpb), state: "up" as const },
        ]);
      }
      if (added.some((event) => event.tick > maxTick))
        return {
          ok: false,
          message: `${label} · beats run 0..${maxTick / tpb} in this loop`,
        };
      let pedal: readonly PedalEvent[] | undefined;
      try {
        // `pedal bars` over the whole loop replaces the lane (as the agent's
        // `pedal: "bars"` does); spans, events and bar ranges add to it.
        pedal =
          command.type === "pedal-bars" &&
          command.from === undefined &&
          command.to === undefined
            ? normalizePedal(added, maxTick, field, states)
            : mergePedal(track[field], added, maxTick, field, states);
      } catch (error) {
        if (error instanceof ExpressionValidationError)
          return { ok: false, message: `${label} · ${error.message}` };
        throw error;
      }
      const downs = (pedal ?? []).filter((event) => event.state === "down");
      const halves = (pedal ?? []).filter((event) => event.state === "half");
      const held = [
        ...(downs.length > 0 || halves.length === 0
          ? [`${downs.length} down`]
          : []),
        ...(halves.length > 0 ? [`${halves.length} half`] : []),
      ].join(", ");
      return trackResult(
        score,
        track,
        { [field]: pedal ?? null },
        `${label} · ${pedal?.length ?? 0} event${pedal?.length === 1 ? "" : "s"} (${held}) · ${trackId}`,
      );
    }
    case "velcurve": {
      const velocityCurve = normalizeVelocityCurve({
        curve: command.curve,
        ...(command.fixed !== undefined ? { fixed: command.fixed } : {}),
      });
      return trackResult(
        score,
        track,
        { velocityCurve: velocityCurve ?? null },
        `velcurve · ${command.curve}${velocityCurve?.fixed !== undefined ? ` ${Math.round(velocityCurve.fixed * 100) / 100} (MIDI ${Math.round(velocityCurve.fixed * 127)})` : ""} · ${trackId}`,
      );
    }
    case "note-humanize":
      return noteResult(
        score,
        trackId,
        command.target,
        { humanize: command.humanize },
        "humanize",
        command.humanize === null
          ? "off (follows the track)"
          : Object.keys(command.humanize).length === 0
            ? "exact"
            : describeNoteHumanize(command.humanize),
      );
    case "humanize-off":
      return track.humanize
        ? trackResult(
            score,
            track,
            { humanize: null },
            `humanize · off · ${trackId}`,
          )
        : { ok: true, message: `humanize · already off · ${trackId}` };
    case "humanize-seed": {
      if (!track.humanize)
        return {
          ok: false,
          message: "humanize · off · turn it on first · humanize 10 8",
        };
      const seed =
        command.seed ??
        (track.humanize.seed + 1) % (EXPRESSION_LIMITS.maxSeed + 1);
      const humanize = normalizeHumanize({ ...track.humanize, seed })!;
      return trackResult(
        score,
        track,
        { humanize },
        `humanize · ${describeHumanize(humanize)} · ${trackId}`,
      );
    }
    case "humanize": {
      const humanize = normalizeHumanize({
        timing: command.timing,
        velocity: command.velocity,
        length: command.length,
        seed: command.seed ?? track.humanize?.seed ?? 1,
      });
      if (!humanize)
        return track.humanize
          ? trackResult(
              score,
              track,
              { humanize: null },
              `humanize · off · ${trackId}`,
            )
          : { ok: true, message: `humanize · already off · ${trackId}` };
      return trackResult(
        score,
        track,
        { humanize },
        `humanize · ${describeHumanize(humanize)} · ${trackId}`,
      );
    }
  }
}

/** Usage lines, also the /help and typo hints. */
export const EXPRESSION_USAGE = Object.freeze({
  art: `art ${ARTICULATIONS.join("|")}|off [all|last|bar <n>|bars <a>-<b>|<ids>] · art staccato bars 1-2`,
  bend: "bend <cents>|scoop|fall|doit|<at:cents>…|off [target] · bend +200 · bend 0:0 0.5:200",
  vibrato:
    "vibrato <rate Hz> <depth cents> [<delay s>]|off [target] · vibrato 5.5 30 0.2",
  glide:
    "glide <ms>|<s>s|off [legato|mono|poly] (track) · glide <ms>|off <target> (notes) · glide 60 mono · SDK glide: 0.06 (s)",
  pedal:
    "pedal [soft|sost] <beat>-<beat>…|bars [<bar>-<bar>]|down|half|up <beat>|off · pedal 0-3.5 4-7.5 · pedal bars · pedal soft 0-8 (una corda) · pedal sost 0-4 (holds keys down at 0)",
  velcurve:
    "velcurve linear|soft|hard|fixed [<v 0..1>] · velcurve soft · velcurve fixed 0.8",
  humanize:
    "humanize <ms> [<vel%> [<len%>]] [seed <n>]|on|off|reseed (track) · humanize <ms> [<vel%> [<len%>]]|exact|off <target> (notes) · humanize 10 8 5 · humanize 20 bars 2-3",
});
