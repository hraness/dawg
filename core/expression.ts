/**
 * Expressive performance (dawg 0.5): per-note articulation, glide, bend and
 * vibrato, and per-track glide, sustain pedal, velocity curve and humanize.
 *
 * Every field is optional and absent means today's behaviour: a track and
 * notes without any of them come back from `performNotes` as the very same
 * array, so 0.4 projects render byte-identically.
 *
 * The score stays clean: humanize, pedal extension and articulation are
 * applied at render time to copies of the notes (`PerformedNote`), never
 * written back. Precedence with the synth voice (`core/synth.ts`): a note's
 * `vibrato` replaces the synth `vib`/`vibmod`, a note's `bend` replaces the
 * pitch envelope (`penv`), and a gliding note ignores the ZzFX `slide`.
 */
import type { Note, Track, TrackScore } from "./score.ts";
import { keyCentsFor, resolveTuning } from "./tuning.ts";
import {
  hasTempoMap,
  loopTicksOf,
  secondsAtTick,
  type TimeScore,
} from "./tempo.ts";

export const EXPRESSION_LIMITS = Object.freeze({
  maxBendPoints: 32,
  /** |cents| of a bend point (four octaves). */
  maxBendCents: 4800,
  /** Vibrato rate in Hz. */
  maxVibratoRate: 20,
  /** Vibrato depth in cents (peak deviation either side). */
  maxVibratoDepth: 1200,
  /** Vibrato delay in seconds. */
  maxVibratoDelay: 10,
  /** Glide time in seconds, note or track. */
  maxGlideSeconds: 10,
  maxPedalEvents: 1024,
  /** Humanize timing spread in milliseconds (either side). */
  maxHumanizeTimingMs: 250,
  /** Humanize velocity and length spread in percent. */
  maxHumanizePercent: 100,
  maxSeed: 2_147_483_647,
});

export const ARTICULATIONS = [
  "staccato",
  "legato",
  "accent",
  "tenuto",
  "marcato",
  "ghost",
] as const;
export type Articulation = (typeof ARTICULATIONS)[number];

/**
 * What each articulation does at render: the sounding length is
 * `length ×` the written length, velocity becomes
 * `clamp(velocity × scale + add)`. `legato` also holds the note until the
 * next note on the track starts (closing a gap of up to one beat) and
 * overlaps it by a 64th note, so a legato glide track slides into it.
 * Values follow notation-playback conventions (MuseScore: staccato 50%
 * gate, marcato about two thirds and louder; tenuto full value).
 */
export const ARTICULATION_EFFECTS: Readonly<
  Record<
    Articulation,
    Readonly<{ length: number; scale: number; add: number; doc: string }>
  >
> = Object.freeze({
  staccato: { length: 0.5, scale: 1, add: 0, doc: "half length" },
  legato: {
    length: 1,
    scale: 1,
    add: 0,
    doc: "held into the next note with a short overlap",
  },
  accent: { length: 1, scale: 1, add: 0.2, doc: "velocity +0.2" },
  tenuto: {
    length: 1,
    scale: 1,
    add: 0.05,
    doc: "full length, velocity +0.05",
  },
  marcato: {
    length: 2 / 3,
    scale: 1,
    add: 0.3,
    doc: "two-thirds length, velocity +0.3",
  },
  ghost: {
    length: 0.5,
    scale: 0.4,
    add: 0,
    doc: "half length, velocity ×0.4",
  },
});

export type BendPoint = Readonly<{
  /**
   * Position in the note, 0 (start) .. 1 (end of its articulated length,
   * before sustain pedal and humanize; the last value holds after it).
   */
  at: number;
  /** Pitch offset in cents, ±4800. */
  cents: number;
}>;

export type NoteVibrato = Readonly<{
  /** Hz, > 0. */
  rate: number;
  /** Peak deviation in cents either side, 0..1200. */
  depth: number;
  /** Seconds before the vibrato starts (it then fades in over 0.15 s). */
  delay?: number;
}>;

/** The expression fields a note may carry (all optional). */
export type NoteExpression = Readonly<{
  articulation?: Articulation;
  /** Portamento into this note from the previous pitch, seconds; 0 never glides. */
  glide?: number;
  bend?: readonly BendPoint[];
  vibrato?: NoteVibrato;
  /**
   * This note's humanize amounts, replacing the track's (seeded by the
   * track's humanize seed, 1 when it has none). `{}` keeps the note exact.
   */
  humanize?: NoteHumanize;
}>;

/** Per-note humanize: amounts as in `Humanize`, absent ones 0. */
export type NoteHumanize = Readonly<{
  timing?: number;
  velocity?: number;
  length?: number;
}>;

/** Patch for `setNoteExpression`: `null` clears a field. */
export type NoteExpressionPatch = Readonly<{
  articulation?: Articulation | null;
  glide?: number | null;
  bend?: readonly BendPoint[] | null;
  vibrato?: NoteVibrato | null;
  humanize?: NoteHumanize | null;
}>;

export const NOTE_EXPRESSION_FIELDS = [
  "articulation",
  "glide",
  "bend",
  "vibrato",
  "humanize",
] as const;

export const GLIDE_MODES = ["legato", "mono", "poly"] as const;
export type GlideMode = (typeof GLIDE_MODES)[number];

/**
 * A track's glide default. `legato` (TB-303 style, the default) is
 * monophonic and glides only into a note that overlaps the previous one,
 * without retriggering its envelope; `mono` is monophonic, always glides and
 * retriggers; `poly` keeps every voice and glides each note from the
 * matching note of the previous chord.
 */
export type TrackGlide = Readonly<{ time: number; mode: GlideMode }>;

export const DEFAULT_GLIDE_SECONDS = 0.06;

export const PEDAL_STATES = ["down", "half", "up"] as const;
export type PedalState = (typeof PEDAL_STATES)[number];

/** A sustain pedal (MIDI CC64) change at a tick. */
export type PedalEvent = Readonly<{ tick: number; state: PedalState }>;

export const VELOCITY_CURVES = ["linear", "soft", "hard", "fixed"] as const;
export type VelocityCurveName = (typeof VELOCITY_CURVES)[number];

/**
 * How a track responds to velocity: `soft` (v^0.5: soft notes come out
 * louder), `hard` (v^2: needs a firm touch), `fixed` (every note at
 * `fixed`, default 0.8, like an organ). `linear` is the default and is
 * never stored.
 */
export type VelocityCurve = Readonly<{
  curve: Exclude<VelocityCurveName, "linear">;
  fixed?: number;
}>;

export const DEFAULT_FIXED_VELOCITY = 0.8;

/**
 * Seeded, deterministic humanize applied at render: `timing` in ms either
 * side, `velocity` in percent of full scale, `length` in percent of the
 * note's length. Offsets follow a triangular distribution seeded by `seed`
 * and the note id, so editing one note never reshuffles the others.
 */
export type Humanize = Readonly<{
  timing?: number;
  velocity?: number;
  length?: number;
  seed: number;
}>;

/** Seconds of the half-pedal fade (time constant) and its cap (×5). */
export const HALF_PEDAL_TAU = 0.5;

/** Vibrato fade-in after its delay, seconds. */
export const VIBRATO_FADE_SECONDS = 0.15;

export class ExpressionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionValidationError";
  }
}

// ---------------------------------------------------------------------------
// Validation

function finite(value: unknown, label: string, min: number, max: number) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new ExpressionValidationError(
      `${label} must be a number ${min}..${max}`,
    );
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ExpressionValidationError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function onlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(value))
    if (!keys.includes(key))
      throw new ExpressionValidationError(
        `${label} has an unknown field ${key.slice(0, 32)}`,
      );
}

export function normalizeArticulation(
  value: unknown,
): Articulation | undefined {
  if (value === undefined || value === null) return undefined;
  const name = typeof value === "string" ? value.trim().toLowerCase() : "";
  const found = ARTICULATIONS.find(
    (candidate) => candidate === name || candidate.slice(0, 4) === name,
  );
  if (!found)
    throw new ExpressionValidationError(
      `articulation must be one of ${ARTICULATIONS.join(", ")}`,
    );
  return found;
}

export function normalizeNoteGlide(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return finite(value, "note glide", 0, EXPRESSION_LIMITS.maxGlideSeconds);
}

export function normalizeBend(
  value: unknown,
): readonly BendPoint[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > EXPRESSION_LIMITS.maxBendPoints)
    throw new ExpressionValidationError(
      `bend must be an array of at most ${EXPRESSION_LIMITS.maxBendPoints} points`,
    );
  if (value.length === 0) return undefined;
  const points = value.map((item: unknown) => {
    const point = record(item, "bend point");
    onlyKeys(point, ["at", "cents"], "bend point");
    return Object.freeze({
      at: finite(point.at, "bend at", 0, 1),
      cents: finite(
        point.cents,
        "bend cents",
        -EXPRESSION_LIMITS.maxBendCents,
        EXPRESSION_LIMITS.maxBendCents,
      ),
    });
  });
  // Stable sort by position: equal positions keep their order (a jump).
  points.sort((a, b) => a.at - b.at);
  return Object.freeze(points);
}

export function normalizeVibrato(value: unknown): NoteVibrato | undefined {
  if (value === undefined || value === null) return undefined;
  const input = record(value, "vibrato");
  onlyKeys(input, ["rate", "depth", "delay"], "vibrato");
  const rate = finite(
    input.rate ?? 5.5,
    "vibrato rate",
    0.01,
    EXPRESSION_LIMITS.maxVibratoRate,
  );
  const depth = finite(
    input.depth ?? 20,
    "vibrato depth",
    0,
    EXPRESSION_LIMITS.maxVibratoDepth,
  );
  const delay =
    input.delay === undefined
      ? 0
      : finite(
          input.delay,
          "vibrato delay",
          0,
          EXPRESSION_LIMITS.maxVibratoDelay,
        );
  return Object.freeze({ rate, depth, ...(delay > 0 ? { delay } : {}) });
}

/** Validates a note's expression fields; only the set ones are returned. */
export function normalizeNoteExpression(
  input: Readonly<Record<string, unknown>>,
): NoteExpression {
  const articulation = normalizeArticulation(input.articulation);
  const glide = normalizeNoteGlide(input.glide);
  const bend = normalizeBend(input.bend);
  const vibrato = normalizeVibrato(input.vibrato);
  const humanize = normalizeNoteHumanize(input.humanize);
  return {
    ...(articulation ? { articulation } : {}),
    ...(glide !== undefined ? { glide } : {}),
    ...(bend ? { bend } : {}),
    ...(vibrato ? { vibrato } : {}),
    ...(humanize ? { humanize } : {}),
  };
}

/** A note's humanize amounts; zero amounts are dropped (`{}` = exact). */
export function normalizeNoteHumanize(
  value: unknown,
): NoteHumanize | undefined {
  if (value === undefined || value === null) return undefined;
  const input = record(value, "humanize");
  onlyKeys(input, ["timing", "velocity", "length"], "humanize");
  const amount = (key: "timing" | "velocity" | "length", max: number) =>
    finite(input[key] ?? 0, `humanize ${key}`, 0, max);
  const timing = amount("timing", EXPRESSION_LIMITS.maxHumanizeTimingMs);
  const velocity = amount("velocity", EXPRESSION_LIMITS.maxHumanizePercent);
  const length = amount("length", EXPRESSION_LIMITS.maxHumanizePercent);
  return Object.freeze({
    ...(timing > 0 ? { timing } : {}),
    ...(velocity > 0 ? { velocity } : {}),
    ...(length > 0 ? { length } : {}),
  });
}

export function normalizeTrackGlide(value: unknown): TrackGlide | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number")
    return Object.freeze({
      time: finite(value, "glide time", 0, EXPRESSION_LIMITS.maxGlideSeconds),
      mode: "legato" as const,
    });
  const input = record(value, "glide");
  onlyKeys(input, ["time", "mode"], "glide");
  const time = finite(
    input.time ?? DEFAULT_GLIDE_SECONDS,
    "glide time",
    0,
    EXPRESSION_LIMITS.maxGlideSeconds,
  );
  const mode = input.mode ?? "legato";
  if (!GLIDE_MODES.includes(mode as GlideMode))
    throw new ExpressionValidationError(
      `glide mode must be one of ${GLIDE_MODES.join(", ")}`,
    );
  return Object.freeze({ time, mode: mode as GlideMode });
}

export function normalizePedal(
  value: unknown,
  maxTick: number,
): readonly PedalEvent[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > EXPRESSION_LIMITS.maxPedalEvents)
    throw new ExpressionValidationError(
      `pedal must be an array of at most ${EXPRESSION_LIMITS.maxPedalEvents} events`,
    );
  const byTick = new Map<number, PedalEvent>();
  for (const item of value as unknown[]) {
    const event = record(item, "pedal event");
    onlyKeys(event, ["tick", "state"], "pedal event");
    const tick = event.tick;
    if (
      typeof tick !== "number" ||
      !Number.isInteger(tick) ||
      tick < 0 ||
      tick > maxTick
    )
      throw new ExpressionValidationError(
        `pedal tick must be an integer 0..${maxTick}`,
      );
    if (!PEDAL_STATES.includes(event.state as PedalState))
      throw new ExpressionValidationError(
        `pedal state must be one of ${PEDAL_STATES.join(", ")}`,
      );
    // The last event at a tick wins.
    byTick.set(tick, Object.freeze({ tick, state: event.state as PedalState }));
  }
  if (byTick.size === 0) return undefined;
  return Object.freeze([...byTick.values()].sort((a, b) => a.tick - b.tick));
}

export function normalizeVelocityCurve(
  value: unknown,
): VelocityCurve | undefined {
  if (value === undefined || value === null) return undefined;
  const input =
    typeof value === "string"
      ? { curve: value }
      : record(value, "velocityCurve");
  onlyKeys(input, ["curve", "fixed"], "velocityCurve");
  const curve = input.curve;
  if (!VELOCITY_CURVES.includes(curve as VelocityCurveName))
    throw new ExpressionValidationError(
      `velocityCurve must be one of ${VELOCITY_CURVES.join(", ")}`,
    );
  if (curve === "linear") return undefined;
  if (curve === "fixed")
    return Object.freeze({
      curve,
      fixed: finite(
        input.fixed ?? DEFAULT_FIXED_VELOCITY,
        "velocityCurve fixed",
        0,
        1,
      ),
    });
  if (input.fixed !== undefined)
    throw new ExpressionValidationError(
      "velocityCurve fixed is only used by the fixed curve",
    );
  return Object.freeze({ curve: curve as "soft" | "hard" });
}

export function normalizeHumanize(value: unknown): Humanize | undefined {
  if (value === undefined || value === null) return undefined;
  const input = record(value, "humanize");
  onlyKeys(input, ["timing", "velocity", "length", "seed"], "humanize");
  const timing = finite(
    input.timing ?? 0,
    "humanize timing",
    0,
    EXPRESSION_LIMITS.maxHumanizeTimingMs,
  );
  const velocity = finite(
    input.velocity ?? 0,
    "humanize velocity",
    0,
    EXPRESSION_LIMITS.maxHumanizePercent,
  );
  const length = finite(
    input.length ?? 0,
    "humanize length",
    0,
    EXPRESSION_LIMITS.maxHumanizePercent,
  );
  const seed = input.seed ?? 1;
  if (
    typeof seed !== "number" ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > EXPRESSION_LIMITS.maxSeed
  )
    throw new ExpressionValidationError(
      `humanize seed must be an integer 0..${EXPRESSION_LIMITS.maxSeed}`,
    );
  if (timing === 0 && velocity === 0 && length === 0) return undefined;
  return Object.freeze({
    ...(timing > 0 ? { timing } : {}),
    ...(velocity > 0 ? { velocity } : {}),
    ...(length > 0 ? { length } : {}),
    seed,
  });
}

export const TRACK_PERFORMANCE_FIELDS = [
  "glide",
  "pedal",
  "velocityCurve",
  "humanize",
] as const;

/** The performance fields a track may carry (all optional). */
export type TrackPerformance = Readonly<{
  glide?: TrackGlide;
  pedal?: readonly PedalEvent[];
  velocityCurve?: VelocityCurve;
  humanize?: Humanize;
}>;

export function normalizeTrackPerformance(
  input: Readonly<Record<string, unknown>>,
  maxTick: number,
): TrackPerformance {
  const glide = normalizeTrackGlide(input.glide);
  const pedal = normalizePedal(input.pedal, maxTick);
  const velocityCurve = normalizeVelocityCurve(input.velocityCurve);
  const humanize = normalizeHumanize(input.humanize);
  return {
    ...(glide ? { glide } : {}),
    ...(pedal ? { pedal } : {}),
    ...(velocityCurve ? { velocityCurve } : {}),
    ...(humanize ? { humanize } : {}),
  };
}

// ---------------------------------------------------------------------------
// Velocity curve

export function curveVelocity(
  curve: VelocityCurve | undefined,
  velocity: number,
): number {
  const v = Math.max(0, Math.min(1, velocity));
  if (!curve) return v;
  if (curve.curve === "soft") return Math.sqrt(v);
  if (curve.curve === "hard") return v * v;
  return curve.fixed ?? DEFAULT_FIXED_VELOCITY;
}

// ---------------------------------------------------------------------------
// Pedal

/** The pedal state at `tick` (events at the tick count), `up` before any. */
export function pedalStateAt(
  pedal: readonly PedalEvent[] | undefined,
  tick: number,
): PedalState {
  let state: PedalState = "up";
  for (const event of pedal ?? []) {
    if (event.tick > tick) break;
    state = event.state;
  }
  return state;
}

// ---------------------------------------------------------------------------
// Performance

/** One stretch of a (possibly legato-chained) note's pitch curve. */
export type PitchSegment = Readonly<{
  /** Seconds from the performed note's start. */
  offset: number;
  /** Seconds the segment's own note sounds (bend positions scale to it). */
  length: number;
  /** Target pitch in cents relative to the performed note's pitch. */
  target: number;
  /** Glide into `target` from `from` over `glide` seconds (0: none). */
  from: number;
  glide: number;
  bend?: readonly BendPoint[];
  vibrato?: NoteVibrato;
  /** Seconds the vibrato's phase counts from (its own note's start). */
  vibratoFrom: number;
}>;

/** Render-only additions to a note; absent means it plays as written. */
export type NotePerformance = Readonly<{
  /** Pitch offset in cents at `t` seconds from the note start. */
  cents?: (t: number) => number;
  /** Half pedal: from `from` seconds the level fades with time constant `tau`. */
  damp?: Readonly<{ from: number; tau: number }>;
  /** The note's vibrato replaces the synth `vib`/`vibmod`. */
  replaceVibrato: boolean;
  /** The note's bend replaces the synth pitch envelope (`penv`). */
  replacePitchEnvelope: boolean;
  /** The note glides, so the ZzFX `slide` is ignored. */
  replaceSlide: boolean;
  /**
   * Accent or marcato: synth voices open the filter (`faccent` octaves on
   * the cutoff and envelope depth, shorter filter decay), TB-303 style.
   */
  accent?: boolean;
}>;

export type PerformedNote = Note & { readonly performance?: NotePerformance };

export type PerformanceTiming = Readonly<{
  tempoBpm: number;
  ticksPerBeat: number;
  /** Ticks a sustained note may ring to (the loop end). */
  endTick: number;
  /**
   * Seconds at a score tick, through the song's tempo map and fermatas.
   * Absent means one constant `tempoBpm` (the 0.4 arithmetic).
   */
  secondsAt?: (tick: number) => number;
  /**
   * Cents of a key above A4 = 440 Hz in the track's tuning, so glides and
   * legato chains move by the tuned interval. Absent is 12-TET.
   */
  keyCents?: (pitch: number) => number;
}>;

/**
 * The timing `performNotes` needs for a song: notes ring to the loop end
 * (through meter changes), and glides, bends, half pedal and humanize
 * convert seconds through the tempo map when the song has one.
 */
export function performanceTimingFor(score: TimeScore): PerformanceTiming {
  return {
    tempoBpm: score.tempoBpm,
    ticksPerBeat: score.ticksPerBeat,
    endTick: loopTicksOf(score),
    ...(hasTempoMap(score)
      ? { secondsAt: (tick: number) => secondsAtTick(score, tick) }
      : {}),
  };
}

/**
 * `timing` with a track's merged tuning, so glides move by tuned steps.
 * Without a song or track tuning it returns `timing` unchanged.
 */
export function tunedTiming(
  timing: PerformanceTiming,
  score: Pick<TrackScore, "tuning" | "key">,
  track: Track | undefined,
): PerformanceTiming {
  const tuning = resolveTuning(score.tuning, track?.tuning, score.key);
  return tuning ? { ...timing, keyCents: keyCentsFor(tuning) } : timing;
}

/** Seconds between two ticks: through the tempo map, or at one tempo. */
type Span = (from: number, to: number) => number;

/** Cents from note `b` up to note `a`, with each note's own cents. */
type Interval = (a: Note, b: Note) => number;

function intervalFor(keyCents: PerformanceTiming["keyCents"]): Interval {
  // Without a tuning this is exactly the 0.4 `(a − b) · 100` for notes
  // without cents (adding 0 changes no float).
  const keys = keyCents
    ? (a: Note, b: Note) => keyCents(a.pitch) - keyCents(b.pitch)
    : (a: Note, b: Note) => (a.pitch - b.pitch) * 100;
  return (a, b) => keys(a, b) + ((a.cents ?? 0) - (b.cents ?? 0));
}

export function hasNoteExpression(note: Note): boolean {
  return (
    note.articulation !== undefined ||
    note.glide !== undefined ||
    note.bend !== undefined ||
    note.vibrato !== undefined ||
    note.humanize !== undefined
  );
}

export function hasTrackPerformance(track: Track | undefined): boolean {
  return (
    track !== undefined &&
    (track.glide !== undefined ||
      track.pedal !== undefined ||
      track.velocityCurve !== undefined ||
      track.humanize !== undefined)
  );
}

/** FNV-1a seeded generator (same family as `src/audio/random.ts`). */
function seeded(seed: string): () => number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let state = hash;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Triangular in -1..1, peaked at 0. */
function triangular(random: () => number): number {
  return random() + random() - 1;
}

type Working = {
  note: Note;
  start: number;
  duration: number;
  velocity: number;
  damp?: { from: number; tau: number };
  /** Humanize timing offset in ticks, applied after the glide structure. */
  shift: number;
  /** Humanize length factor (1: none). */
  stretch: number;
  /** The end is held by the sustain pedal (it stays at the lift). */
  pedalled?: boolean;
  /** Ticks bend positions scale to: the length after articulation. */
  bendLength: number;
};

/** Articulations that accent a note (`NotePerformance.accent`). */
const ACCENTED: ReadonlySet<string> = new Set(["accent", "marcato"]);

/**
 * The notes of one track as they are performed: articulation, humanize,
 * sustain pedal, glide (with monophonic legato chains) and the velocity
 * curve. Returns `notes` itself when neither the track nor any note uses
 * expression. Ticks in the result may be fractional (humanize timing).
 */
export function performNotes(
  track: Track | undefined,
  notes: readonly Note[],
  timing: PerformanceTiming,
): readonly PerformedNote[] {
  if (!hasTrackPerformance(track) && !notes.some(hasNoteExpression))
    return notes;
  const { tempoBpm, ticksPerBeat } = timing;
  const secondsPerTick = 60 / (tempoBpm * ticksPerBeat);
  const { secondsAt } = timing;
  const span: Span = secondsAt
    ? (from, to) => secondsAt(to) - secondsAt(from)
    : (from, to) => (to - from) * secondsPerTick;
  // Seconds per tick at `tick` (the local tempo).
  const localSecondsPerTick = (tick: number): number =>
    secondsAt ? secondsAt(tick + 1) - secondsAt(tick) : secondsPerTick;
  const ordered = [...notes].sort(
    (a, b) =>
      a.startTick - b.startTick ||
      a.pitch - b.pitch ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const onsets = [...new Set(ordered.map((note) => note.startTick))];
  // `onsets` is sorted, so the first onset after `tick` is a binary search.
  const nextOnset = (tick: number): number | undefined => {
    let lo = 0;
    let hi = onsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (onsets[mid]! > tick) hi = mid;
      else lo = mid + 1;
    }
    return onsets[lo];
  };
  // 1. Articulation.
  let working: Working[] = ordered.map((note) => {
    const effect = note.articulation
      ? ARTICULATION_EFFECTS[note.articulation]
      : undefined;
    let duration = note.durationTicks;
    let velocity = note.velocity;
    if (effect) {
      duration = Math.max(1, duration * effect.length);
      velocity = Math.max(0, Math.min(1, velocity * effect.scale + effect.add));
      if (note.articulation === "legato") {
        const overlap = ticksPerBeat / 16;
        const next = nextOnset(note.startTick);
        const end = note.startTick + duration;
        if (next !== undefined && next - end <= ticksPerBeat)
          duration = Math.max(duration, next - note.startTick + overlap);
        else duration += overlap;
      }
    }
    return {
      note,
      start: note.startTick,
      duration,
      velocity,
      shift: 0,
      stretch: 1,
      bendLength: duration,
    };
  });
  // 2. Humanize (seeded per note id, so edits never reshuffle the rest).
  // Velocity applies now; the timing and length offsets are only stored and
  // applied to the performed voices after step 4, so chords, the mono line,
  // legato chains and pedal releases are all decided on the written timing.
  // A note's own humanize replaces the track's amounts (same seed).
  const trackHumanize = track?.humanize;
  const seed = trackHumanize?.seed ?? 1;
  const humanizing = working.some(
    (item) =>
      (item.note.humanize ?? trackHumanize) !== undefined &&
      Object.keys(item.note.humanize ?? trackHumanize ?? {}).some(
        (key) => key !== "seed",
      ),
  );
  if (humanizing) {
    working = working.map((item) => {
      const ticksPerMs = 1 / (localSecondsPerTick(item.start) * 1000);
      const humanize: NoteHumanize | undefined =
        item.note.humanize ?? trackHumanize;
      if (!humanize) return item;
      const random = seeded(`${seed}:${item.note.id}`);
      const shift = triangular(random) * (humanize.timing ?? 0) * ticksPerMs;
      const velocity =
        item.velocity + (triangular(random) * (humanize.velocity ?? 0)) / 100;
      const stretch = 1 + (triangular(random) * (humanize.length ?? 0)) / 100;
      return {
        ...item,
        shift,
        stretch,
        velocity: Math.max(0, Math.min(1, velocity)),
      };
    });
  }
  // 3. Sustain pedal: a key released while the pedal is down rings until
  // the pedal lifts; under half pedal it fades. Re-striking the same pitch
  // stops the ringing one (the string is struck again).
  const pedal = track?.pedal;
  if (pedal) {
    const ups = pedal.filter((event) => event.state === "up");
    working = working.map((item) => {
      const release = item.start + item.duration;
      const state = pedalStateAt(pedal, release);
      if (state === "up") return item;
      const lift =
        ups.find((event) => event.tick > release)?.tick ?? timing.endTick;
      let end = Math.max(release, Math.min(lift, timing.endTick));
      // Half pedal, at the release or later while held, lets the note fade.
      const halfAt =
        state === "half"
          ? release
          : pedal.find(
              (event) =>
                event.state === "half" &&
                event.tick > release &&
                event.tick < end,
            )?.tick;
      let damp: Working["damp"];
      if (halfAt !== undefined) {
        const tauTicks = HALF_PEDAL_TAU / localSecondsPerTick(halfAt);
        end = Math.min(end, halfAt + 5 * tauTicks);
        damp = {
          from: span(item.start, halfAt),
          tau: HALF_PEDAL_TAU,
        };
      }
      const restrike = working.find(
        (other) =>
          other !== item &&
          other.note.pitch === item.note.pitch &&
          other.start > item.start &&
          other.start < end,
      );
      if (restrike) end = Math.max(release, restrike.start);
      return {
        ...item,
        duration: end - item.start,
        pedalled: end > release,
        ...(damp ? { damp } : {}),
      };
    });
  }
  // 4. Glide and monophony (on the written timing).
  let performed = glideAndMono(
    track,
    working,
    span,
    ticksPerBeat,
    intervalFor(timing.keyCents),
  );
  // 4b. Humanize timing and length, applied to whole voices: a legato chain
  // moves as one, and a pedalled end stays at the pedal lift. A note on tick
  // 0 can only drift late (nothing sounds before the loop starts).
  if (
    humanizing &&
    working.some((item) => item.shift !== 0 || item.stretch !== 1)
  ) {
    performed = performed.map((item) => {
      const start = Math.max(0, item.start + item.shift);
      const end = item.pedalled
        ? item.start + item.duration
        : start + item.duration * item.stretch;
      return { ...item, start, duration: Math.max(1, end - start) };
    });
    if (track?.glide?.mode === "legato" || track?.glide?.mode === "mono") {
      // One voice: a humanized note still stops where the next one starts.
      const byStart = [...performed].sort((a, b) => a.start - b.start);
      for (let k = 0; k + 1 < byStart.length; k += 1) {
        const item = byStart[k]!;
        const next = byStart[k + 1]!;
        if (item.start + item.duration > next.start)
          item.duration = Math.max(1, next.start - item.start);
      }
    }
  }
  // 5. Velocity curve.
  const curve = track?.velocityCurve;
  return performed.map((item) => {
    const velocity = curveVelocity(curve, item.velocity);
    const performance = item.performance;
    const changed =
      item.start !== item.note.startTick ||
      item.duration !== item.note.durationTicks ||
      velocity !== item.note.velocity ||
      performance !== undefined;
    if (!changed) return item.note;
    return Object.freeze({
      ...item.note,
      startTick: item.start,
      durationTicks: item.duration,
      velocity,
      ...(performance ? { performance } : {}),
    });
  });
}

type Glided = Working & { performance?: NotePerformance };

function segmentFor(
  item: Working,
  offset: number,
  target: number,
  from: number,
  glide: number,
  span: Span,
  vibratoFrom: number,
): PitchSegment {
  const { note } = item;
  return {
    offset,
    // Bends follow the key (the articulated length), not pedal or humanize.
    length: span(item.start, item.start + item.bendLength),
    target,
    from,
    glide,
    ...(note.bend ? { bend: note.bend } : {}),
    ...(note.vibrato ? { vibrato: note.vibrato } : {}),
    vibratoFrom,
  };
}

function performanceFor(
  segments: readonly PitchSegment[],
  damp: Working["damp"],
  accent = false,
): NotePerformance | undefined {
  const pitched = segments.some(
    (segment) =>
      segment.glide > 0 ||
      segment.target !== 0 ||
      segment.bend !== undefined ||
      segment.vibrato !== undefined,
  );
  if (!pitched && !damp && !accent) return undefined;
  // Voices ask for increasing `t`, so a cursor makes the segment lookup
  // amortised O(1) even for a long legato chain (one voice, many segments).
  let cursor = 0;
  const cents = (t: number): number => {
    if (t < segments[cursor]!.offset) cursor = 0;
    cursor = segmentIndexAt(segments, t, cursor);
    return centsOfSegment(segments[cursor]!, t);
  };
  return Object.freeze({
    ...(pitched ? { cents } : {}),
    ...(accent ? { accent: true } : {}),
    ...(damp ? { damp: Object.freeze({ ...damp }) } : {}),
    replaceVibrato: segments.some((segment) => segment.vibrato !== undefined),
    replacePitchEnvelope: segments.some(
      (segment) => segment.bend !== undefined,
    ),
    replaceSlide: segments.some(
      (segment) => segment.glide > 0 || segment.target !== 0,
    ),
  });
}

/** Cents of a bend curve at `x` (0..1); starts from 0 unless a point is at 0. */
export function bendAt(points: readonly BendPoint[], x: number): number {
  let previous: BendPoint = { at: 0, cents: 0 };
  if (points[0] && points[0].at === 0) previous = points[0];
  for (const point of points) {
    if (point.at >= x) {
      if (point.at === previous.at) return point.cents;
      const mix = (x - previous.at) / (point.at - previous.at);
      return previous.cents + (point.cents - previous.cents) * mix;
    }
    previous = point;
  }
  return previous.cents;
}

/** Vibrato in cents at `t` seconds after its note's start. */
export function vibratoAt(vibrato: NoteVibrato, t: number): number {
  const into = t - (vibrato.delay ?? 0);
  if (into <= 0 || vibrato.depth === 0) return 0;
  const fade = Math.min(1, into / VIBRATO_FADE_SECONDS);
  return vibrato.depth * fade * Math.sin(2 * Math.PI * vibrato.rate * into);
}

/** The last segment starting at or before `t`, scanning on from `from`. */
function segmentIndexAt(
  segments: readonly PitchSegment[],
  t: number,
  from = 0,
): number {
  let index = from;
  while (index + 1 < segments.length && segments[index + 1]!.offset <= t)
    index += 1;
  return index;
}

/** The pitch offset in cents at `t` seconds into a performed note. */
export function centsAt(segments: readonly PitchSegment[], t: number): number {
  return centsOfSegment(segments[segmentIndexAt(segments, t)]!, t);
}

/**
 * The glide and bend part of a segment at `t` (no vibrato): the pitch a
 * voice has reached, which the next legato segment glides on from.
 */
function reachedCents(segment: PitchSegment, t: number): number {
  return centsOfSegment({ ...segment, vibrato: undefined }, t);
}

function centsOfSegment(segment: PitchSegment, t: number): number {
  const local = t - segment.offset;
  let cents = segment.target;
  if (segment.glide > 0 && local < segment.glide)
    cents =
      segment.from + ((segment.target - segment.from) * local) / segment.glide;
  if (segment.bend)
    cents += bendAt(
      segment.bend,
      segment.length > 0 ? Math.min(1, local / segment.length) : 1,
    );
  if (segment.vibrato)
    cents += vibratoAt(segment.vibrato, t - segment.vibratoFrom);
  return cents;
}

function glideAndMono(
  track: Track | undefined,
  working: readonly Working[],
  span: Span,
  ticksPerBeat: number,
  interval: Interval,
): Glided[] {
  const trackGlide = track?.glide;
  const mode = trackGlide?.mode;
  const glideOf = (item: Working): number =>
    item.note.glide ?? trackGlide?.time ?? 0;
  const accented = (item: Working): boolean =>
    item.note.articulation !== undefined &&
    ACCENTED.has(item.note.articulation);
  const single = (item: Working, from?: number, glide = 0): Glided => {
    const segments = [
      segmentFor(
        item,
        0,
        0,
        from ?? 0,
        from === undefined ? 0 : glide,
        span,
        0,
      ),
    ];
    const performance = performanceFor(segments, item.damp, accented(item));
    return { ...item, ...(performance ? { performance } : {}) };
  };
  if (mode === "legato" || mode === "mono") {
    // Monophonic: of notes starting together the highest plays, and a note
    // stops when the next one starts.
    const line: Working[] = [];
    for (const item of [...working].sort(
      (a, b) => a.start - b.start || b.note.pitch - a.note.pitch,
    )) {
      const last = line[line.length - 1];
      if (last && last.start === item.start) continue;
      line.push({ ...item });
    }
    const out: Glided[] = [];
    let monoSegment: PitchSegment | undefined;
    let index = 0;
    while (index < line.length) {
      const first = line[index]!;
      if (mode === "mono") {
        const next = line[index + 1];
        if (next && first.start + first.duration > next.start)
          first.duration = Math.max(1, next.start - first.start);
        const previous = line[index - 1];
        const glide = glideOf(first);
        let from: number | undefined;
        if (previous && glide > 0) {
          // From the pitch the previous voice reached (it may still be
          // gliding when it is cut off).
          const at = span(previous.start, first.start);
          const reached = monoSegment ? reachedCents(monoSegment, at) : 0;
          from = interval(previous.note, first.note) + reached;
        }
        const voice =
          from === undefined ? single(first) : single(first, from, glide);
        monoSegment = segmentFor(
          first,
          0,
          0,
          from ?? 0,
          from === undefined ? 0 : glide,
          span,
          0,
        );
        out.push(voice);
        index += 1;
        continue;
      }
      // Legato: overlapping notes chain into one voice that glides.
      const chain: Working[] = [first];
      while (index + chain.length < line.length) {
        const last = chain[chain.length - 1]!;
        const next = line[index + chain.length]!;
        // A note's own glide is the TB-303 slide flag: the gate holds
        // across a small gap (up to a 64th) and the pitch slides.
        const end = last.start + last.duration;
        const slide =
          (next.note.glide ?? 0) > 0 && next.start - end <= ticksPerBeat / 16;
        if ((end <= next.start && !slide) || next.note.glide === 0) break;
        chain.push(next);
      }
      // Cut each chained note at the next one's start; a note that does not
      // chain still ends where the next starts (one voice).
      const after = line[index + chain.length];
      const tail = chain[chain.length - 1]!;
      if (after && tail.start + tail.duration > after.start)
        tail.duration = Math.max(1, after.start - tail.start);
      if (chain.length === 1) {
        out.push(single(first));
        index += 1;
        continue;
      }
      const segments: PitchSegment[] = [];
      chain.forEach((item, k) => {
        const offset = span(first.start, item.start);
        const target = interval(item.note, first.note);
        // Glide on from the pitch the voice has reached, so a glide cut off
        // by the next note never jumps (a TB-303 slide is continuous).
        const prior = segments[k - 1];
        const from = prior ? reachedCents(prior, offset) : 0;
        const segment = segmentFor(
          item,
          offset,
          target,
          from,
          k === 0 ? 0 : glideOf(item),
          span,
          offset,
        );
        const sounding =
          k + 1 < chain.length
            ? span(item.start, chain[k + 1]!.start)
            : segment.length;
        segments.push({
          ...segment,
          length: Math.min(segment.length, sounding),
        });
      });
      const end = tail.start + tail.duration;
      const merged: Working = {
        ...first,
        duration: end - first.start,
        stretch: 1,
        pedalled: tail.pedalled ?? false,
        ...(tail.damp
          ? {
              damp: {
                from: tail.damp.from + span(first.start, tail.start),
                tau: tail.damp.tau,
              },
            }
          : {}),
      };
      const performance = performanceFor(
        segments,
        merged.damp,
        accented(first),
      );
      out.push({ ...merged, ...(performance ? { performance } : {}) });
      index += chain.length;
    }
    return out;
  }
  // Polyphonic: each note glides from the note of the previous chord with
  // the same rank (lowest to lowest, …), when a glide time applies.
  const chords = new Map<number, Working[]>();
  for (const item of working) {
    const chord = chords.get(item.start);
    if (chord) chord.push(item);
    else chords.set(item.start, [item]);
  }
  const starts = [...chords.keys()].sort((a, b) => a - b);
  for (const chord of chords.values())
    chord.sort((a, b) => a.note.pitch - b.note.pitch);
  return working.map((item) => {
    const glide = glideOf(item);
    if (glide <= 0) return single(item);
    const at = starts.indexOf(item.start);
    const previous = at > 0 ? chords.get(starts[at - 1]!)! : undefined;
    if (!previous) return single(item);
    const rank = chords.get(item.start)!.indexOf(item);
    const source = previous[Math.min(rank, previous.length - 1)]!;
    return single(item, interval(source.note, item.note), glide);
  });
}
