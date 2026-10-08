/**
 * Tempo maps and score time.
 *
 * Score time stays in integer ticks (`ticksPerBeat` per beat). A beat is a
 * quarter note and BPM counts quarter notes, as in Standard MIDI Files, so a
 * 7/8 bar lasts 3.5 beats. The song's optional `time` field turns ticks into
 * seconds:
 *
 * - `tempo`: tempo events after the start tempo (`tempoBpm` holds at tick 0).
 *   An event without `ramp` is a step. `ramp: "linear"` glides from the
 *   previous tempo into the event with an equal BPM change per beat;
 *   `ramp: "exp"` with an equal ratio per beat (even to the ear).
 * - `fermatas`: holds. The beat starting at `tick` lasts `1 + beats` times
 *   as long (it slows evenly, as a notation player or a MIDI file plays a
 *   fermata), and everything later moves back.
 * - `meter`: meter changes at bar boundaries (`bar` is 0-based). A bar lasts
 *   `beatsPerBar * 4 / beatUnit` beats. Without changes `beatsPerBar` of the
 *   score is the meter, over 4.
 *
 * A track's own `time` (`rate`, `phase`, `cycle`) places its notes on the
 * song timeline for polytempo, polymeter and Reich-style phasing:
 * `performedNotes` repeats the track's first `cycle` ticks every
 * `cycle / rate` song ticks, shifted `phase` song ticks later. Automation
 * stays in song time.
 *
 * Without these fields every function reduces to the 0.4 arithmetic, and
 * `timeMapFor` returns undefined so callers keep their original formulas
 * (0.4 projects render byte-identically).
 *
 * Pure and dependency-free: `core/score.ts` imports the types and the
 * validators from here.
 */

export const TEMPO_RAMPS = ["linear", "exp"] as const;
export type TempoRamp = (typeof TEMPO_RAMPS)[number];

/** A tempo change. The start tempo is the score's `tempoBpm` at tick 0. */
export type TempoEvent = Readonly<{
  /** Score tick, 1 or later. */
  tick: number;
  /** Quarter notes per minute from this tick on. */
  bpm: number;
  /** Glide into `bpm` from the previous tempo instead of stepping. */
  ramp?: TempoRamp;
}>;

/** A meter from bar `bar` (0-based) on. */
export type MeterChange = Readonly<{
  bar: number;
  /** Numerator: beats of `beatUnit` per bar. */
  beatsPerBar: number;
  /** Denominator: 1, 2, 4, 8, 16 or 32; default 4. */
  beatUnit?: number;
}>;

/** The beat at `tick` lasts `1 + beats` times as long. */
export type Fermata = Readonly<{
  tick: number;
  beats: number;
}>;

/** Song-level `time`: absent fields keep a constant tempo and one meter. */
export type SongTime = Readonly<{
  tempo?: readonly TempoEvent[];
  meter?: readonly MeterChange[];
  fermatas?: readonly Fermata[];
}>;

/** Track-level `time`: absent fields follow the song. */
export type TrackTime = Readonly<{
  /** Tempo ratio against the song: 1.5 plays three beats in two. */
  rate?: number;
  /**
   * Song ticks that shift the track's repeating pattern later (negative:
   * earlier). It wraps, so the loop still starts full.
   */
  phase?: number;
  /** Track ticks per repetition; default the song loop. */
  cycle?: number;
}>;

export const TIME_LIMITS = Object.freeze({
  maxTempoEvents: 256,
  maxMeterChanges: 256,
  maxFermatas: 256,
  maxFermataBeats: 64,
  /** Same as `SCORE_LIMITS.minTempoBpm` / `maxTempoBpm`. */
  minBpm: 20,
  maxBpm: 300,
  /** Same as `SCORE_LIMITS.maxTick`. */
  maxTick: 1_000_000,
  /** Same as `SCORE_LIMITS.maxBeatsPerBar`. */
  maxBeatsPerBar: 16,
  /** Same as `SCORE_LIMITS.maxBars`. */
  maxBars: 256,
  beatUnits: Object.freeze([1, 2, 4, 8, 16, 32]) as readonly number[],
  minRate: 0.125,
  maxRate: 8,
  /** Notes `performedNotes` places per score; later repetitions drop. */
  maxPerformedNotes: 16_384,
} as const);

export class TimeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeValidationError";
  }
}

// ---------------------------------------------------------------------------
// Validation

/** Validates a song `time` field; empty lists and `{}` normalize to undefined. */
export function normalizeSongTime(
  input: unknown,
  label = "time",
): SongTime | undefined {
  if (input === undefined || input === null) return undefined;
  const record = recordOf(input, label, ["tempo", "meter", "fermatas"]);
  const tempo = normalizeList(
    record.tempo,
    `${label}.tempo`,
    TIME_LIMITS.maxTempoEvents,
    normalizeTempoEvent,
    (event) => event.tick,
  );
  const meter = normalizeList(
    record.meter,
    `${label}.meter`,
    TIME_LIMITS.maxMeterChanges,
    normalizeMeterChange,
    (change) => change.bar,
  );
  const fermatas = normalizeList(
    record.fermatas,
    `${label}.fermatas`,
    TIME_LIMITS.maxFermatas,
    normalizeFermata,
    (fermata) => fermata.tick,
  );
  if (!tempo && !meter && !fermatas) return undefined;
  return Object.freeze({
    ...(tempo ? { tempo } : {}),
    ...(meter ? { meter } : {}),
    ...(fermatas ? { fermatas } : {}),
  });
}

/** Checks what needs the score's resolution: bars must be whole ticks. */
export function checkSongTime(
  time: SongTime | undefined,
  ticksPerBeat: number,
): void {
  for (const change of time?.meter ?? []) {
    const ticks = barTicksOf(
      change.beatsPerBar,
      change.beatUnit ?? 4,
      ticksPerBeat,
    );
    if (!Number.isInteger(ticks))
      throw new TimeValidationError(
        `time.meter bar ${change.bar}: ${change.beatsPerBar}/${change.beatUnit ?? 4} is not a whole number of ticks at ${ticksPerBeat} ticks per beat`,
      );
  }
}

/** Validates a track `time` field; defaults are dropped, all-default is undefined. */
export function normalizeTrackTime(
  input: unknown,
  label = "track time",
): TrackTime | undefined {
  if (input === undefined || input === null) return undefined;
  const record = recordOf(input, label, ["rate", "phase", "cycle"]);
  const out: { rate?: number; phase?: number; cycle?: number } = {};
  if (record.rate !== undefined) {
    const rate = record.rate;
    if (
      typeof rate !== "number" ||
      !Number.isFinite(rate) ||
      rate < TIME_LIMITS.minRate ||
      rate > TIME_LIMITS.maxRate
    )
      throw new TimeValidationError(
        `${label} rate must be between ${TIME_LIMITS.minRate} and ${TIME_LIMITS.maxRate}`,
      );
    if (rate !== 1) out.rate = rate;
  }
  if (record.phase !== undefined) {
    const phase = record.phase;
    if (
      typeof phase !== "number" ||
      !Number.isInteger(phase) ||
      Math.abs(phase) > TIME_LIMITS.maxTick
    )
      throw new TimeValidationError(
        `${label} phase must be an integer tick within ±${TIME_LIMITS.maxTick}`,
      );
    if (phase !== 0) out.phase = phase;
  }
  if (record.cycle !== undefined) {
    const cycle = record.cycle;
    if (
      typeof cycle !== "number" ||
      !Number.isInteger(cycle) ||
      cycle < 1 ||
      cycle > TIME_LIMITS.maxTick
    )
      throw new TimeValidationError(
        `${label} cycle must be an integer between 1 and ${TIME_LIMITS.maxTick} ticks`,
      );
    out.cycle = cycle;
  }
  return Object.keys(out).length > 0 ? Object.freeze(out) : undefined;
}

function normalizeTempoEvent(input: unknown, label: string): TempoEvent {
  const record = recordOf(input, label, ["tick", "bpm", "ramp"]);
  const tick = record.tick;
  if (
    typeof tick !== "number" ||
    !Number.isInteger(tick) ||
    tick < 1 ||
    tick > TIME_LIMITS.maxTick
  )
    throw new TimeValidationError(
      `${label} tick must be an integer between 1 and ${TIME_LIMITS.maxTick} (tick 0 is tempoBpm)`,
    );
  const bpm = record.bpm;
  if (
    typeof bpm !== "number" ||
    !Number.isFinite(bpm) ||
    bpm < TIME_LIMITS.minBpm ||
    bpm > TIME_LIMITS.maxBpm
  )
    throw new TimeValidationError(
      `${label} bpm must be between ${TIME_LIMITS.minBpm} and ${TIME_LIMITS.maxBpm}`,
    );
  const ramp = record.ramp;
  if (
    ramp !== undefined &&
    ramp !== null &&
    !TEMPO_RAMPS.includes(ramp as TempoRamp)
  )
    throw new TimeValidationError(
      `${label} ramp must be one of ${TEMPO_RAMPS.join(", ")}`,
    );
  return Object.freeze({
    tick,
    bpm,
    ...(typeof ramp === "string" ? { ramp: ramp as TempoRamp } : {}),
  });
}

function normalizeMeterChange(input: unknown, label: string): MeterChange {
  const record = recordOf(input, label, ["bar", "beatsPerBar", "beatUnit"]);
  const bar = record.bar;
  if (
    typeof bar !== "number" ||
    !Number.isInteger(bar) ||
    bar < 0 ||
    bar >= TIME_LIMITS.maxBars
  )
    throw new TimeValidationError(
      `${label} bar must be an integer between 0 and ${TIME_LIMITS.maxBars - 1}`,
    );
  const beatsPerBar = record.beatsPerBar;
  if (
    typeof beatsPerBar !== "number" ||
    !Number.isInteger(beatsPerBar) ||
    beatsPerBar < 1 ||
    beatsPerBar > TIME_LIMITS.maxBeatsPerBar
  )
    throw new TimeValidationError(
      `${label} beatsPerBar must be an integer between 1 and ${TIME_LIMITS.maxBeatsPerBar}`,
    );
  const beatUnit = record.beatUnit ?? 4;
  if (typeof beatUnit !== "number" || !TIME_LIMITS.beatUnits.includes(beatUnit))
    throw new TimeValidationError(
      `${label} beatUnit must be one of ${TIME_LIMITS.beatUnits.join(", ")}`,
    );
  return Object.freeze({
    bar,
    beatsPerBar,
    ...(beatUnit !== 4 ? { beatUnit } : {}),
  });
}

function normalizeFermata(input: unknown, label: string): Fermata {
  const record = recordOf(input, label, ["tick", "beats"]);
  const tick = record.tick;
  if (
    typeof tick !== "number" ||
    !Number.isInteger(tick) ||
    tick < 0 ||
    tick > TIME_LIMITS.maxTick
  )
    throw new TimeValidationError(
      `${label} tick must be an integer between 0 and ${TIME_LIMITS.maxTick}`,
    );
  const beats = record.beats;
  if (
    typeof beats !== "number" ||
    !Number.isFinite(beats) ||
    beats <= 0 ||
    beats > TIME_LIMITS.maxFermataBeats
  )
    throw new TimeValidationError(
      `${label} beats must be above 0 and at most ${TIME_LIMITS.maxFermataBeats}`,
    );
  return Object.freeze({ tick, beats });
}

function normalizeList<T>(
  input: unknown,
  label: string,
  max: number,
  normalize: (value: unknown, label: string) => T,
  keyOf: (value: T) => number,
): readonly T[] | undefined {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input) || input.length > max)
    throw new TimeValidationError(
      `${label} must be an array of at most ${max} entries`,
    );
  if (input.length === 0) return undefined;
  const items = input
    .map((value: unknown, index) => normalize(value, `${label}[${index}]`))
    .sort((a, b) => keyOf(a) - keyOf(b));
  for (let index = 1; index < items.length; index += 1)
    if (keyOf(items[index]!) === keyOf(items[index - 1]!))
      throw new TimeValidationError(
        `${label} has two entries at ${keyOf(items[index]!)}`,
      );
  return Object.freeze(items);
}

function recordOf(
  input: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new TimeValidationError(`${label} must be an object`);
  for (const key of Object.keys(input))
    if (!keys.includes(key))
      throw new TimeValidationError(`${label} has unknown field ${key}`);
  return input as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Meter: bar lengths and positions

/** The fields of a score that time depends on. */
export type TimeScore = Readonly<{
  tempoBpm: number;
  beatsPerBar: number;
  bars: number;
  ticksPerBeat: number;
  time?: SongTime;
}>;

/** One meter run: bar `bar` starts at `tick`, every bar is `barTicks` long. */
export type MeterSegment = Readonly<{
  bar: number;
  tick: number;
  beatsPerBar: number;
  beatUnit: number;
  barTicks: number;
}>;

/** Where a tick falls: its bar (0-based), that bar's start and meter. */
export type BarPosition = MeterSegment &
  Readonly<{
    /** Ticks from the bar's start. */
    offset: number;
  }>;

function barTicksOf(
  beatsPerBar: number,
  beatUnit: number,
  ticksPerBeat: number,
): number {
  return (beatsPerBar * ticksPerBeat * 4) / beatUnit;
}

const meterCache = new WeakMap<object, readonly MeterSegment[]>();

/** Meter runs in bar order; the first starts at bar 0, tick 0. */
export function meterSegments(score: TimeScore): readonly MeterSegment[] {
  const cached = meterCache.get(score);
  if (cached) return cached;
  let current: MeterSegment = {
    bar: 0,
    tick: 0,
    beatsPerBar: score.beatsPerBar,
    beatUnit: 4,
    barTicks: score.beatsPerBar * score.ticksPerBeat,
  };
  const segments: MeterSegment[] = [];
  for (const change of score.time?.meter ?? []) {
    const beatUnit = change.beatUnit ?? 4;
    const next: MeterSegment = {
      bar: change.bar,
      tick: current.tick + (change.bar - current.bar) * current.barTicks,
      beatsPerBar: change.beatsPerBar,
      beatUnit,
      barTicks: barTicksOf(change.beatsPerBar, beatUnit, score.ticksPerBeat),
    };
    if (change.bar > 0) segments.push(Object.freeze(current));
    current = next;
  }
  segments.push(Object.freeze(current));
  const frozen = Object.freeze(segments);
  meterCache.set(score, frozen);
  return frozen;
}

/** Start tick of bar `bar` (0-based; later bars repeat the last meter). */
export function barStartTick(score: TimeScore, bar: number): number {
  if (!score.time?.meter) return bar * score.beatsPerBar * score.ticksPerBeat;
  const segments = meterSegments(score);
  let segment = segments[0]!;
  for (const candidate of segments) {
    if (candidate.bar > bar) break;
    segment = candidate;
  }
  return segment.tick + (bar - segment.bar) * segment.barTicks;
}

/** Song loop length in ticks: `bars` bars through the meter changes. */
export function loopTicksOf(score: TimeScore): number {
  if (!score.time?.meter)
    return score.bars * score.beatsPerBar * score.ticksPerBeat;
  return barStartTick(score, score.bars);
}

/** The bar a tick falls in (ticks before 0 count back in the first meter). */
export function barAt(score: TimeScore, tick: number): BarPosition {
  const segments = meterSegments(score);
  let segment = segments[0]!;
  for (const candidate of segments) {
    if (candidate.tick > tick) break;
    segment = candidate;
  }
  const within = Math.floor((tick - segment.tick) / segment.barTicks);
  const start = segment.tick + within * segment.barTicks;
  return {
    ...segment,
    bar: segment.bar + within,
    tick: start,
    offset: tick - start,
  };
}

// The transport runs in unwrapped score beats: pass k of the loop starts at
// beat k * loop beats. These keep the 0.4 arithmetic without meter changes.

/** Bar index, counting every loop pass, of transport `beat`. */
export function transportBar(score: TimeScore, beat: number): number {
  if (!score.time?.meter) return Math.floor(beat / score.beatsPerBar);
  const loopTicks = loopTicksOf(score);
  const tick = beat * score.ticksPerBeat;
  const pass = Math.floor(tick / loopTicks);
  return pass * score.bars + barAt(score, tick - pass * loopTicks).bar;
}

/** Transport beat where transport bar `bar` (any loop pass) starts. */
export function transportBarStart(score: TimeScore, bar: number): number {
  if (!score.time?.meter) return bar * score.beatsPerBar;
  const pass = Math.floor(bar / score.bars);
  const inner = bar - pass * score.bars;
  return (
    (pass * loopTicksOf(score) + barStartTick(score, inner)) /
    score.ticksPerBeat
  );
}

/** Score tick inside the loop where transport `beat` falls. */
export function loopTickAt(score: TimeScore, beat: number): number {
  const loopTicks = loopTicksOf(score);
  const tick = beat * score.ticksPerBeat;
  return ((tick % loopTicks) + loopTicks) % loopTicks;
}

/** True when the score has a meter change after bar 0 or a non-4 unit. */
export function hasMeterChanges(score: TimeScore): boolean {
  return score.time?.meter !== undefined;
}

/** Meter label of a bar, such as `7/8`. */
export function meterLabel(
  position: Pick<MeterSegment, "beatsPerBar" | "beatUnit">,
): string {
  return `${position.beatsPerBar}/${position.beatUnit}`;
}

/**
 * Ticks between metronome clicks in a meter: one beat unit, or a dotted
 * unit in compound meters (6/8, 9/8, 12/8, 6/16 … click three units), the
 * way a Standard MIDI File's 6/8 example clicks every dotted quarter.
 */
export function clickTicksOf(
  segment: Pick<MeterSegment, "beatsPerBar" | "beatUnit">,
  ticksPerBeat: number,
): number {
  const unit = (ticksPerBeat * 4) / segment.beatUnit;
  const compound =
    segment.beatUnit >= 8 &&
    segment.beatsPerBar > 3 &&
    segment.beatsPerBar % 3 === 0;
  return compound ? unit * 3 : unit;
}

/** A grid line or click: `bar` marks a downbeat. */
export type BeatMark = Readonly<{
  tick: number;
  bar: boolean;
  barIndex: number;
}>;

/**
 * Downbeats and counted beats in `[from, to)`: clicks per `clickTicksOf`,
 * restarting on every barline (a 7/8 bar counts 7 eighths, not 3.5 beats).
 */
export function beatMarks(
  score: TimeScore,
  from: number,
  to: number,
): readonly BeatMark[] {
  const marks: BeatMark[] = [];
  if (!(to > from)) return marks;
  let position = barAt(score, from);
  for (let guard = 0; guard < 100_000; guard += 1) {
    const step = clickTicksOf(position, score.ticksPerBeat);
    for (let offset = 0; offset < position.barTicks; offset += step) {
      const tick = position.tick + offset;
      if (tick >= to) return marks;
      if (tick >= from)
        marks.push({ tick, bar: offset === 0, barIndex: position.bar });
    }
    position = barAt(score, position.tick + position.barTicks);
  }
  return marks;
}

// ---------------------------------------------------------------------------
// Tempo map: ticks ⇄ seconds

type Segment = Readonly<{
  /** Ramp start tick (the segment's own start for steps). */
  origin: number;
  /** Ramp length in beats; 0 for a constant tempo. */
  beats: number;
  from: number;
  to: number;
  ramp: TempoRamp | undefined;
}>;

type Piece = Readonly<{
  tick: number;
  /** Seconds at `tick`. */
  seconds: number;
  /** Time stretch through this piece: 1 + beats of the fermatas here. */
  stretch: number;
  segment: Segment;
  /** Seconds from the segment's origin to `tick`, unstretched. */
  base: number;
}>;

function constant(segment: Segment): boolean {
  return (
    segment.ramp === undefined ||
    segment.beats <= 0 ||
    Math.abs(segment.to - segment.from) < 1e-9
  );
}

/** Seconds from a segment's origin to `beats` beats in. */
function segmentSeconds(segment: Segment, beats: number): number {
  const { from, to } = segment;
  if (constant(segment)) return (60 * beats) / from;
  const span = segment.beats;
  if (segment.ramp === "linear") {
    const slope = (to - from) / span;
    return (60 / slope) * Math.log1p((slope * beats) / from);
  }
  const k = Math.log(to / from) / span;
  return (60 / (from * k)) * -Math.expm1(-k * beats);
}

/** Beats from a segment's origin after `seconds`. */
function segmentBeats(segment: Segment, seconds: number): number {
  const { from, to } = segment;
  if (constant(segment)) return (seconds * from) / 60;
  const span = segment.beats;
  if (segment.ramp === "linear") {
    const slope = (to - from) / span;
    return (from / slope) * Math.expm1((seconds * slope) / 60);
  }
  const k = Math.log(to / from) / span;
  return -Math.log1p((-seconds * from * k) / 60) / k;
}

function segmentBpm(segment: Segment, beats: number): number {
  const { from, to } = segment;
  if (constant(segment)) return from;
  const x = Math.min(1, Math.max(0, beats / segment.beats));
  return segment.ramp === "linear"
    ? from + (to - from) * x
    : from * Math.pow(to / from, x);
}

/**
 * Converts between score ticks and seconds through tempo events and
 * fermatas. A fermata lengthens the beat that carries it, `[tick, tick +
 * ticksPerBeat)`, to `1 + beats` times its length, as a notation player
 * and a Standard MIDI File would play it: everything inside that beat
 * slows evenly and everything later moves back.
 */
export class TimeMap {
  readonly ticksPerBeat: number;
  readonly startBpm: number;
  private readonly pieces: readonly Piece[];

  constructor(score: TimeScore) {
    this.ticksPerBeat = score.ticksPerBeat;
    this.startBpm = score.tempoBpm;
    const tpb = score.ticksPerBeat;
    const events = score.time?.tempo ?? [];
    // Tempo segments: [start tick, segment].
    const segments: { start: number; segment: Segment }[] = [];
    let previousTick = 0;
    let previousBpm = score.tempoBpm;
    for (const event of events) {
      segments.push({
        start: previousTick,
        segment: event.ramp
          ? {
              origin: previousTick,
              beats: (event.tick - previousTick) / tpb,
              from: previousBpm,
              to: event.bpm,
              ramp: event.ramp,
            }
          : {
              origin: previousTick,
              beats: 0,
              from: previousBpm,
              to: previousBpm,
              ramp: undefined,
            },
      });
      previousTick = event.tick;
      previousBpm = event.bpm;
    }
    segments.push({
      start: previousTick,
      segment: {
        origin: previousTick,
        beats: 0,
        from: previousBpm,
        to: previousBpm,
        ramp: undefined,
      },
    });
    // Pieces split segments where a fermata beat starts or ends.
    const fermatas = score.time?.fermatas ?? [];
    const starts = new Set<number>(segments.map((entry) => entry.start));
    for (const fermata of fermatas) {
      starts.add(fermata.tick);
      starts.add(fermata.tick + tpb);
    }
    const ticks = [...starts].sort((a, b) => a - b);
    const stretchAt = (tick: number) => {
      let stretch = 1;
      for (const fermata of fermatas)
        if (fermata.tick <= tick && tick < fermata.tick + tpb)
          stretch *= 1 + fermata.beats;
      return stretch;
    };
    const pieces: Piece[] = [];
    let segmentIndex = 0;
    let lastPiece: Piece | undefined;
    for (const tick of ticks) {
      while (
        segmentIndex + 1 < segments.length &&
        segments[segmentIndex + 1]!.start <= tick
      )
        segmentIndex += 1;
      const segment = segments[segmentIndex]!.segment;
      const piece: Piece = {
        tick,
        seconds: lastPiece ? this.secondsInPiece(lastPiece, tick) : 0,
        stretch: stretchAt(tick),
        segment,
        base: segmentSeconds(segment, (tick - segment.origin) / tpb),
      };
      pieces.push(piece);
      lastPiece = piece;
    }
    this.pieces = Object.freeze(pieces);
  }

  private secondsInPiece(piece: Piece, tick: number): number {
    const segment = piece.segment;
    const plain = constant(segment)
      ? ((tick - piece.tick) / this.ticksPerBeat) * (60 / segment.from)
      : segmentSeconds(segment, (tick - segment.origin) / this.ticksPerBeat) -
        piece.base;
    return (
      piece.seconds + (piece.stretch === 1 ? plain : plain * piece.stretch)
    );
  }

  private pieceAt(tick: number): Piece {
    const pieces = this.pieces;
    let low = 0;
    let high = pieces.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (pieces[middle]!.tick <= tick) low = middle;
      else high = middle - 1;
    }
    return pieces[low]!;
  }

  /** Seconds from tick 0 to `tick`. */
  seconds(tick: number): number {
    if (tick <= 0) {
      const first = this.pieces[0]!;
      if (tick === 0) return 0;
      return ((tick / this.ticksPerBeat) * 60) / first.segment.from;
    }
    const piece = this.pieceAt(tick);
    if (tick === piece.tick) return piece.seconds;
    return this.secondsInPiece(piece, tick);
  }

  /** The score tick sounding at `seconds`. */
  tick(seconds: number): number {
    if (seconds <= 0) {
      if (seconds === 0) return 0;
      return ((seconds * this.startBpm) / 60) * this.ticksPerBeat;
    }
    const pieces = this.pieces;
    let low = 0;
    let high = pieces.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (pieces[middle]!.seconds <= seconds) low = middle;
      else high = middle - 1;
    }
    const piece = pieces[low]!;
    const into = (seconds - piece.seconds) / piece.stretch;
    if (into <= 0) return piece.tick;
    const segment = piece.segment;
    if (constant(segment))
      return piece.tick + ((into * segment.from) / 60) * this.ticksPerBeat;
    return (
      segment.origin +
      segmentBeats(segment, into + piece.base) * this.ticksPerBeat
    );
  }

  /** Tempo at `tick` (after a step there; ramps interpolate; a fermata
   * beat plays slower by its stretch). */
  bpm(tick: number): number {
    if (tick < 0) return this.startBpm;
    const piece = this.pieceAt(tick);
    const segment = piece.segment;
    return (
      segmentBpm(segment, (tick - segment.origin) / this.ticksPerBeat) /
      piece.stretch
    );
  }

  /** Extra seconds a fermata adds to the beat starting at `tick`, else 0. */
  holdAt(tick: number): number {
    const piece = this.pieceAt(tick);
    if (piece.tick !== tick || piece.stretch === 1) return 0;
    const end = tick + this.ticksPerBeat;
    const span = this.seconds(end) - piece.seconds;
    return span - span / piece.stretch;
  }
}

const mapCache = new WeakMap<object, TimeMap | null>();

/**
 * The score's tempo map, or undefined when tempo is constant and nothing
 * holds: callers then keep the 0.4 arithmetic exactly.
 */
export function timeMapFor(score: TimeScore): TimeMap | undefined {
  if (!score.time?.tempo && !score.time?.fermatas) return undefined;
  const cached = mapCache.get(score);
  if (cached !== undefined) return cached ?? undefined;
  const map = new TimeMap(score);
  mapCache.set(score, map);
  return map;
}

/** Seconds from tick 0 to `tick`. */
export function secondsAtTick(score: TimeScore, tick: number): number {
  const map = timeMapFor(score);
  return map
    ? map.seconds(tick)
    : ((tick / score.ticksPerBeat) * 60) / score.tempoBpm;
}

/** Score tick at `seconds`. */
export function tickAtSeconds(score: TimeScore, seconds: number): number {
  const map = timeMapFor(score);
  return map
    ? map.tick(seconds)
    : ((seconds * score.tempoBpm) / 60) * score.ticksPerBeat;
}

/** Tempo in effect at `tick`. */
export function bpmAtTick(score: TimeScore, tick: number): number {
  return timeMapFor(score)?.bpm(tick) ?? score.tempoBpm;
}

/** Song loop length in seconds (0.4: `bars * beatsPerBar * 60 / tempoBpm`). */
export function loopSecondsOf(score: TimeScore): number {
  const map = timeMapFor(score);
  if (map) return map.seconds(loopTicksOf(score));
  if (!score.time?.meter)
    return (score.bars * score.beatsPerBar * 60) / score.tempoBpm;
  return ((loopTicksOf(score) / score.ticksPerBeat) * 60) / score.tempoBpm;
}

/** True when ticks do not map to seconds at one constant rate. */
export function hasTempoMap(score: TimeScore): boolean {
  return timeMapFor(score) !== undefined;
}

// ---------------------------------------------------------------------------
// Editing helpers (pure; they return a new `SongTime` or undefined)

function rebuild(
  time: SongTime | undefined,
  patch: Partial<Record<keyof SongTime, readonly unknown[] | undefined>>,
): SongTime | undefined {
  const next: Record<string, unknown> = { ...(time ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value.length === 0) delete next[key];
    else next[key] = value;
  }
  return normalizeSongTime(next);
}

/** Adds or replaces the tempo event at `event.tick`. */
export function withTempoEvent(
  time: SongTime | undefined,
  event: TempoEvent,
): SongTime | undefined {
  const tempo = (time?.tempo ?? []).filter((e) => e.tick !== event.tick);
  return rebuild(time, { tempo: [...tempo, event] });
}

/** Removes tempo events in `[from, to]` (a single tick when `to` is omitted). */
export function withoutTempoEvents(
  time: SongTime | undefined,
  from: number,
  to = from,
): SongTime | undefined {
  return rebuild(time, {
    tempo: (time?.tempo ?? []).filter((e) => e.tick < from || e.tick > to),
  });
}

/**
 * A gradual change: holds the tempo in effect at `from` there, then ramps to
 * `bpm` at `to`. Events strictly between are replaced. Used by `rit` and
 * `accel`.
 */
export function withTempoRamp(
  score: TimeScore,
  from: number,
  to: number,
  bpm: number,
  ramp: TempoRamp = "linear",
): SongTime | undefined {
  if (!(to > from))
    throw new TimeValidationError("a tempo ramp needs an end after its start");
  const start = bpmAtTick(score, from);
  const existing = score.time?.tempo ?? [];
  const events: TempoEvent[] = existing.filter(
    (e) => e.tick <= from || e.tick > to,
  );
  // Pin the start tempo so the ramp begins where the music is; a ramp
  // already running through `from` keeps its shape up to the pin.
  if (from > 0 && !events.some((e) => e.tick === from)) {
    const through = existing.find((e) => e.tick > from)?.ramp;
    events.push({
      tick: from,
      bpm: roundBpm(start),
      ...(through ? { ramp: through } : {}),
    });
  }
  events.push({ tick: to, bpm, ramp });
  return rebuild(score.time, { tempo: events });
}

/** Adds or replaces the fermata at `tick`. */
export function withFermata(
  time: SongTime | undefined,
  fermata: Fermata,
): SongTime | undefined {
  const fermatas = (time?.fermatas ?? []).filter(
    (f) => f.tick !== fermata.tick,
  );
  return rebuild(time, { fermatas: [...fermatas, fermata] });
}

/** Removes the fermatas in `[from, to]`. */
export function withoutFermatas(
  time: SongTime | undefined,
  from: number,
  to = from,
): SongTime | undefined {
  return rebuild(time, {
    fermatas: (time?.fermatas ?? []).filter(
      (f) => f.tick < from || f.tick > to,
    ),
  });
}

/** Sets the meter from bar `bar` (0-based) on; null removes that change. */
export function withMeterChange(
  time: SongTime | undefined,
  bar: number,
  meter: Readonly<{ beatsPerBar: number; beatUnit?: number }> | null,
): SongTime | undefined {
  const changes = (time?.meter ?? []).filter((m) => m.bar !== bar);
  return rebuild(time, {
    meter: meter
      ? [
          ...changes,
          {
            bar,
            beatsPerBar: meter.beatsPerBar,
            ...(meter.beatUnit !== undefined && meter.beatUnit !== 4
              ? { beatUnit: meter.beatUnit }
              : {}),
          },
        ]
      : changes,
  });
}

function roundBpm(bpm: number): number {
  return Math.round(bpm * 100) / 100;
}

/**
 * The rate that makes a track gain `cycles` whole cycles per song loop, so
 * a phasing pair drifts apart and lines up again exactly at the loop end
 * (Reich's Piano Phase gains one cycle; 13/12 over twelve cycles).
 */
export function driftRate(
  loopTicks: number,
  cycleTicks: number,
  cycles: number,
): number {
  const perLoop = loopTicks / cycleTicks;
  return (perLoop + cycles) / perLoop;
}

// ---------------------------------------------------------------------------
// Track time: placing notes on the song timeline

/** The note fields placement reads; extra fields are kept. */
export type PlaceableNote = Readonly<{
  trackId: string;
  startTick: number;
  durationTicks: number;
  pitch: number;
  id: string;
}>;

export type PlacementScore<N extends PlaceableNote> = TimeScore &
  Readonly<{
    tracks: readonly Readonly<{ id: string; time?: TrackTime }>[];
    notes: readonly N[];
  }>;

const placedCache = new WeakMap<object, readonly PlaceableNote[]>();

/**
 * Notes in song ticks. Tracks without `time` keep their notes (the same
 * objects, and the same array when no track has `time`); a timed track's
 * first `cycle` ticks repeat every `cycle / rate` song ticks from `phase`,
 * clipped to the song loop. Placed ticks may be fractional.
 */
export function performedNotes<N extends PlaceableNote>(
  score: PlacementScore<N>,
): readonly N[] {
  if (!score.tracks.some((track) => track.time)) return score.notes;
  const cached = placedCache.get(score);
  if (cached) return cached as readonly N[];
  const loop = loopTicksOf(score);
  const times = new Map<string, TrackTime>();
  for (const track of score.tracks)
    if (track.time) times.set(track.id, track.time);
  const out: N[] = [];
  for (const note of score.notes) {
    const time = times.get(note.trackId);
    if (!time) {
      out.push(note);
      continue;
    }
    const rate = time.rate ?? 1;
    const phase = time.phase ?? 0;
    const cycle = time.cycle ?? loop;
    if (note.startTick >= cycle) continue;
    const period = cycle / rate;
    const offset = phase + note.startTick / rate;
    const first = Math.ceil((0 - offset) / period - 1e-9);
    const last = Math.floor((loop - offset) / period - 1e-9);
    for (let k = first; k <= last; k += 1) {
      const startTick = offset + k * period;
      if (startTick < 0 || startTick >= loop) continue;
      out.push({
        ...note,
        startTick,
        durationTicks: note.durationTicks / rate,
      });
      if (out.length >= TIME_LIMITS.maxPerformedNotes) break;
    }
    if (out.length >= TIME_LIMITS.maxPerformedNotes) break;
  }
  out.sort(
    (a, b) =>
      a.startTick - b.startTick ||
      (a.trackId < b.trackId ? -1 : a.trackId > b.trackId ? 1 : 0) ||
      a.pitch - b.pitch ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const frozen = Object.freeze(out);
  placedCache.set(score, frozen);
  return frozen;
}

/** True when any track has its own `time`. */
export function hasTrackTime(
  score: Readonly<{ tracks: readonly Readonly<{ time?: TrackTime }>[] }>,
): boolean {
  return score.tracks.some((track) => track.time !== undefined);
}

/** One-line description of a song's time, for status lines and briefs. */
export function describeSongTime(score: TimeScore): string {
  const parts: string[] = [];
  const time = score.time;
  for (const event of time?.tempo ?? [])
    parts.push(
      `${event.ramp ? (event.ramp === "exp" ? "exp→" : "→") : "="}${formatNumber(event.bpm)}@${formatNumber(event.tick / score.ticksPerBeat)}`,
    );
  for (const change of time?.meter ?? [])
    parts.push(
      `${change.beatsPerBar}/${change.beatUnit ?? 4}@bar${change.bar + 1}`,
    );
  for (const fermata of time?.fermatas ?? [])
    parts.push(
      `𝄐${formatNumber(fermata.beats)}@${formatNumber(fermata.tick / score.ticksPerBeat)}`,
    );
  return parts.join(" ");
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 1000) / 1000);
}
