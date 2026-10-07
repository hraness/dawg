/**
 * Euclidean rhythms and T-1-style rhythm rows.
 *
 * `bjorklund(pulses, steps)` is a port of Strudel's `bjorklund` (itself
 * Rohan Drape's Haskell `bjorklund`), so `E(3,8)` here is the same
 * `x..x..x.` Strudel plays, and `euclidRot(p, s, r)` rotates the same way
 * Strudel's `euclidRot` does: a positive rotation moves the pattern later
 * (right) by `r` steps.
 *
 * A `RhythmRow` is the stored generator: one voice, T-1 Shape/Groove
 * parameters (steps, pulses, rotate, division, repeats, time, pace, ramp,
 * velocity, accent, gate, probability + seed, swing, nudge, cycles). It is
 * plain JSON on a track (`track.rhythm`) and `expandRow` turns it into hits
 * deterministically: the same row and loop always produce the same notes.
 * The score keeps those hits as ordinary notes, so rendering, diffing and
 * sync never see the generator.
 *
 * Pure and dependency-free: `core/score.ts` imports the types and the
 * validator from here.
 */

// ── Bjorklund (Strudel-compatible) ────────────────────────────────────

type Groups = [number[][], number[][]];

function bjorklundStep(
  counts: [number, number],
  groups: Groups,
): [[number, number], Groups] {
  const [ons, offs] = counts;
  if (Math.min(ons, offs) <= 1) return [counts, groups];
  const [xs, ys] = groups;
  if (ons > offs) {
    // Strudel `left`: split the ons at `offs`, append each off to one of them.
    const head = xs.slice(0, offs);
    const rest = xs.slice(offs);
    return bjorklundStep(
      [offs, ons - offs],
      [head.map((a, index) => a.concat(ys[index]!)), rest],
    );
  }
  // Strudel `right`: append the first `ons` offs to the ons.
  const head = ys.slice(0, ons);
  const rest = ys.slice(ons);
  return bjorklundStep(
    [ons, offs - ons],
    [xs.map((a, index) => a.concat(head[index]!)), rest],
  );
}

/**
 * The Euclidean pattern E(pulses, steps) as 0/1, exactly as Strudel's
 * `bjorklund`: `bjorklund(3, 8)` → `[1,0,0,1,0,0,1,0]`. Negative `pulses`
 * inverts the pattern (Strudel's convention); `|pulses| > steps` is clamped.
 */
export function bjorklund(pulses: number, steps: number): number[] {
  const count = Math.max(0, Math.floor(steps));
  if (count === 0) return [];
  const inverted = pulses < 0;
  const ons = Math.min(count, Math.abs(Math.trunc(pulses)));
  const offs = count - ons;
  const ones = Array.from({ length: ons }, () => [1]);
  const zeros = Array.from({ length: offs }, () => [0]);
  const [, [xs, ys]] = bjorklundStep([ons, offs], [ones, zeros]);
  const pattern = [...xs.flat(), ...ys.flat()];
  return inverted ? pattern.map((value) => 1 - value) : pattern;
}

/**
 * `bjorklund(pulses, steps)` rotated like Strudel's `euclidRot`: positive
 * `rotation` moves every hit `rotation` steps later. Rotations outside
 * `-steps..steps` wrap (Strudel leaves those unrotated; within range both
 * agree).
 */
export function euclidRot(
  pulses: number,
  steps: number,
  rotation = 0,
): number[] {
  const pattern = bjorklund(pulses, steps);
  const length = pattern.length;
  if (length === 0) return pattern;
  const shift = ((Math.trunc(rotation) % length) + length) % length;
  if (shift === 0) return pattern;
  return pattern.slice(length - shift).concat(pattern.slice(0, length - shift));
}

/** `x..x..x.` for a 0/1 pattern. */
export function patternText(pattern: readonly (number | boolean)[]): string {
  return pattern.map((on) => (on ? "x" : ".")).join("");
}

// ── rhythm rows ───────────────────────────────────────────────────────

/** Per-pass overrides (T-1 Cycles): pass `n` of the row uses `cycles[n % length]`. */
export type RhythmCycle = Readonly<{
  pulses?: number;
  rotate?: number;
  repeats?: number;
  probability?: number;
  velocity?: number;
}>;

/**
 * One generated voice. Every field but `voice` is optional and omitted at
 * its default, so a stored row is as short as what was changed.
 */
export type RhythmRow = Readonly<{
  /** Drum voice (`kick`), one-shot sampler voice, or a pitch on a melodic track. */
  voice: string;
  /** Length of the row in steps, 1..64 (default 16). Ignored with `grid`. */
  steps?: number;
  /** Hits spread Euclidean-style over `steps`, 0..steps (default 4). */
  pulses?: number;
  /** Steps to shift the pattern later (negative: earlier); default 0. */
  rotate?: number;
  /** Length of one step as a note value: `1/16` (default), `1/8`, `1/8t`, … */
  division?: string;
  /**
   * Explicit steps instead of a Euclidean pattern (T-1 manual pulses):
   * `x` hit, `X` accented hit, `.` or `-` rest. Its length is the step count.
   */
  grid?: string;
  /** Extra triggers after each pulse, 0..16 (T-1 Repeats); default 0. */
  repeats?: number;
  /** Spacing of repeats as a note value (T-1 Time); default `division`. */
  time?: string;
  /** -1..1: repeats speed up (<0) or slow down (>0) progressively (T-1 Pace). */
  pace?: number;
  /** -1..1: velocity ramp across repeats, fade out (<0) or build (>0) (T-1 Ramp). */
  ramp?: number;
  /** Base velocity 0..1 (default 0.8). */
  velocity?: number;
  /** 0..1: how far accented hits rise toward full velocity (default 0). */
  accent?: number;
  /** Which pulses are accented: E(accents, pulses) over each pass (default 1, the first). */
  accents?: number;
  /** Note length as a fraction of a step, 0.05..4 (T-1 Sustain); default 1. */
  gate?: number;
  /** Each pulse lasts until the next one (Strudel `euclidLegato`); overrides `gate`. */
  legato?: boolean;
  /** Chance 0..1 that a pulse (and its repeats) plays (default 1). */
  probability?: number;
  /** Seed for `probability`; the same seed always drops the same hits. */
  seed?: number;
  /** -0.5..0.5 of a step: every second step later (>0) or earlier (T-1 Timing). */
  swing?: number;
  /** -0.5..0.5 of a step: the whole row later or earlier (T-1 Delay). */
  nudge?: number;
  /** Per-pass variations (T-1 Cycles), 1..16 entries. */
  cycles?: readonly RhythmCycle[];
}>;

export const RHYTHM_LIMITS = Object.freeze({
  maxRows: 16,
  maxSteps: 64,
  maxRepeats: 16,
  maxCycles: 16,
  maxRotate: 64,
  maxSeed: 1_000_000,
  minGate: 0.05,
  maxGate: 4,
  maxSwing: 0.5,
  maxNudge: 0.5,
  /** Shortest and longest step, in beats (1/64 triplet … 4 bars of 4/4). */
  minDivisionBeats: 1 / 24,
  maxDivisionBeats: 16,
} as const);

export const RHYTHM_DEFAULTS = Object.freeze({
  steps: 16,
  pulses: 4,
  rotate: 0,
  division: "1/16",
  repeats: 0,
  pace: 0,
  ramp: 0,
  velocity: 0.8,
  accent: 0,
  accents: 1,
  gate: 1,
  probability: 1,
  seed: 0,
  swing: 0,
  nudge: 0,
} as const);

/** Divisions the editor steps through, shortest first. */
export const DIVISIONS: readonly string[] = Object.freeze([
  "1/32",
  "1/16t",
  "1/16",
  "1/8t",
  "1/8",
  "1/4t",
  "1/4",
  "1/2",
  "1/1",
]);

/** Beats in a note value: `1/16` → 0.25, `1/8t` → 1/3, `3/16` → 0.75. */
export function divisionBeats(value: string): number | undefined {
  const match = /^(\d{1,2})\/(\d{1,3})(t?)$/i.exec(value.trim());
  if (!match) return undefined;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (numerator < 1 || denominator < 1) return undefined;
  const beats = ((4 * numerator) / denominator) * (match[3] ? 2 / 3 : 1);
  if (
    beats < RHYTHM_LIMITS.minDivisionBeats - 1e-12 ||
    beats > RHYTHM_LIMITS.maxDivisionBeats + 1e-12
  )
    return undefined;
  return beats;
}

/** Canonical spelling: lower-case triplet suffix, no spaces. */
export function canonicalDivision(value: string): string | undefined {
  return divisionBeats(value) === undefined
    ? undefined
    : value.trim().toLowerCase();
}

const GRID = /^[xX.\-]{1,64}$/;

/** Steps in a row (the grid's length when it has one). */
export function rowSteps(row: RhythmRow): number {
  return row.grid?.length ?? row.steps ?? RHYTHM_DEFAULTS.steps;
}

/** The row's on/off pattern for one pass (cycle overrides applied). */
export function rowPattern(row: RhythmRow, pass = 0): number[] {
  if (row.grid !== undefined)
    return [...row.grid].map((char) => (char === "x" || char === "X" ? 1 : 0));
  const cycle = cycleFor(row, pass);
  return euclidRot(
    cycle.pulses ?? row.pulses ?? RHYTHM_DEFAULTS.pulses,
    rowSteps(row),
    cycle.rotate ?? row.rotate ?? RHYTHM_DEFAULTS.rotate,
  );
}

function cycleFor(row: RhythmRow, pass: number): RhythmCycle {
  const cycles = row.cycles;
  if (!cycles || cycles.length === 0) return {};
  return cycles[pass % cycles.length]!;
}

/**
 * Validates a row from unknown input and returns it frozen with default
 * fields dropped. Throws `Error` with a message naming the field.
 */
export function normalizeRhythmRow(
  input: unknown,
  label = "rhythm",
): RhythmRow {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error(`${label} must be an object`);
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(value))
    if (!ROW_KEYS.has(key))
      throw new Error(`${label} has unknown field ${key}`);
  if (
    typeof value.voice !== "string" ||
    value.voice.trim().length === 0 ||
    value.voice.length > 32
  )
    throw new Error(`${label} voice must be a short non-empty string`);
  const out: Record<string, unknown> = { voice: value.voice.trim() };
  let steps: number = RHYTHM_DEFAULTS.steps;
  if (value.grid !== undefined) {
    if (typeof value.grid !== "string" || !GRID.test(value.grid))
      throw new Error(`${label} grid must be 1..64 of x X . -`);
    out.grid = value.grid.replace(/-/g, ".");
    steps = value.grid.length;
    if (value.steps !== undefined && value.steps !== steps)
      throw new Error(`${label} steps must match the grid length`);
  } else {
    steps = integer(
      value.steps,
      RHYTHM_DEFAULTS.steps,
      1,
      RHYTHM_LIMITS.maxSteps,
      `${label} steps`,
    );
    if (steps !== RHYTHM_DEFAULTS.steps) out.steps = steps;
  }
  const pulses = integer(
    value.pulses,
    RHYTHM_DEFAULTS.pulses,
    0,
    RHYTHM_LIMITS.maxSteps,
    `${label} pulses`,
  );
  if (value.grid === undefined && pulses > steps)
    throw new Error(`${label} pulses must be at most steps (${steps})`);
  if (value.grid === undefined && pulses !== RHYTHM_DEFAULTS.pulses)
    out.pulses = pulses;
  const rotate = integer(
    value.rotate,
    0,
    -RHYTHM_LIMITS.maxRotate,
    RHYTHM_LIMITS.maxRotate,
    `${label} rotate`,
  );
  if (value.grid === undefined && rotate !== 0) out.rotate = rotate;
  for (const key of ["division", "time"] as const) {
    if (value[key] === undefined) continue;
    const text =
      typeof value[key] === "string"
        ? canonicalDivision(value[key])
        : undefined;
    if (text === undefined)
      throw new Error(
        `${label} ${key} must be a note value like "1/16" or "1/8t"`,
      );
    if (key === "division" && text === RHYTHM_DEFAULTS.division) continue;
    out[key] = text;
  }
  const repeats = integer(
    value.repeats,
    0,
    0,
    RHYTHM_LIMITS.maxRepeats,
    `${label} repeats`,
  );
  if (repeats !== 0) out.repeats = repeats;
  const ranged: readonly [keyof typeof RHYTHM_DEFAULTS, number, number][] = [
    ["pace", -1, 1],
    ["ramp", -1, 1],
    ["velocity", 0, 1],
    ["accent", 0, 1],
    ["gate", RHYTHM_LIMITS.minGate, RHYTHM_LIMITS.maxGate],
    ["probability", 0, 1],
    ["swing", -RHYTHM_LIMITS.maxSwing, RHYTHM_LIMITS.maxSwing],
    ["nudge", -RHYTHM_LIMITS.maxNudge, RHYTHM_LIMITS.maxNudge],
  ];
  for (const [key, min, max] of ranged) {
    const number = finite(
      value[key],
      RHYTHM_DEFAULTS[key] as number,
      min,
      max,
      `${label} ${key}`,
    );
    if (number !== RHYTHM_DEFAULTS[key]) out[key] = number;
  }
  if (value.legato !== undefined && typeof value.legato !== "boolean")
    throw new Error(`${label} legato must be true or false`);
  if (value.legato === true) out.legato = true;
  const accents = integer(
    value.accents,
    1,
    0,
    RHYTHM_LIMITS.maxSteps,
    `${label} accents`,
  );
  if (accents !== 1) out.accents = accents;
  const seed = integer(
    value.seed,
    0,
    0,
    RHYTHM_LIMITS.maxSeed,
    `${label} seed`,
  );
  if (seed !== 0) out.seed = seed;
  if (value.cycles !== undefined) {
    if (
      !Array.isArray(value.cycles) ||
      value.cycles.length < 1 ||
      value.cycles.length > RHYTHM_LIMITS.maxCycles
    )
      throw new Error(
        `${label} cycles must be 1..${RHYTHM_LIMITS.maxCycles} entries`,
      );
    out.cycles = Object.freeze(
      value.cycles.map((cycle: unknown, index) =>
        normalizeCycle(cycle, steps, `${label} cycles[${index}]`),
      ),
    );
  }
  return Object.freeze(
    ORDER.filter((key) => key in out).reduce<Record<string, unknown>>(
      (row, key) => {
        row[key] = out[key];
        return row;
      },
      {},
    ),
  ) as RhythmRow;
}

const ORDER = [
  "voice",
  "steps",
  "pulses",
  "rotate",
  "division",
  "grid",
  "repeats",
  "time",
  "pace",
  "ramp",
  "velocity",
  "accent",
  "accents",
  "gate",
  "legato",
  "probability",
  "seed",
  "swing",
  "nudge",
  "cycles",
] as const;
const ROW_KEYS = new Set<string>(ORDER);
const CYCLE_KEYS = new Set([
  "pulses",
  "rotate",
  "repeats",
  "probability",
  "velocity",
]);

function normalizeCycle(
  input: unknown,
  steps: number,
  label: string,
): RhythmCycle {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error(`${label} must be an object`);
  const value = input as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of Object.keys(value))
    if (!CYCLE_KEYS.has(key))
      throw new Error(`${label} has unknown field ${key}`);
  if (value.pulses !== undefined)
    out.pulses = integer(value.pulses, 0, 0, steps, `${label} pulses`);
  if (value.rotate !== undefined)
    out.rotate = integer(
      value.rotate,
      0,
      -RHYTHM_LIMITS.maxRotate,
      RHYTHM_LIMITS.maxRotate,
      `${label} rotate`,
    );
  if (value.repeats !== undefined)
    out.repeats = integer(
      value.repeats,
      0,
      0,
      RHYTHM_LIMITS.maxRepeats,
      `${label} repeats`,
    );
  if (value.probability !== undefined)
    out.probability = finite(
      value.probability,
      1,
      0,
      1,
      `${label} probability`,
    );
  if (value.velocity !== undefined)
    out.velocity = finite(value.velocity, 0.8, 0, 1, `${label} velocity`);
  return Object.freeze(out);
}

function integer(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} must be an integer ${min}..${max}`);
  return value;
}

function finite(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} must be a number ${min}..${max}`);
  return value;
}

// ── expansion ─────────────────────────────────────────────────────────

/** One generated hit, in score ticks. */
export type RhythmHit = Readonly<{
  startTick: number;
  durationTicks: number;
  velocity: number;
  /** Pass of the row (0-based) and step within it. */
  pass: number;
  step: number;
  /** 0 for the pulse, 1.. for its repeats. */
  repeat: number;
}>;

export type ExpandContext = Readonly<{
  ticksPerBeat: number;
  /** Loop length in ticks; hits at or past it are dropped. */
  loopTicks: number;
}>;

/** Hits shorter than this velocity are dropped (a ramp fading to nothing). */
const MIN_VELOCITY = 0.01;

/**
 * Every hit of `row` over the loop, sorted by start. Deterministic: depends
 * only on the row and the context. Each pass of the row (steps × division)
 * repeats from tick 0 until the loop ends; a row longer than the loop is cut.
 */
export function expandRow(row: RhythmRow, context: ExpandContext): RhythmHit[] {
  const tpb = context.ticksPerBeat;
  const steps = rowSteps(row);
  const stepTicks =
    (divisionBeats(row.division ?? RHYTHM_DEFAULTS.division) ?? 0.25) * tpb;
  const timeTicks = row.time
    ? (divisionBeats(row.time) ?? 0.25) * tpb
    : stepTicks;
  const gate = row.gate ?? RHYTHM_DEFAULTS.gate;
  const swing = row.swing ?? 0;
  const nudge = row.nudge ?? 0;
  const pace = row.pace ?? 0;
  const ramp = row.ramp ?? 0;
  const accent = row.accent ?? (row.grid?.includes("X") ? 0.25 : 0);
  const seed = row.seed ?? 0;
  const passTicks = steps * stepTicks;
  if (!(passTicks > 0) || context.loopTicks <= 0) return [];
  const passes = Math.ceil(context.loopTicks / passTicks);

  type Pulse = {
    start: number;
    velocity: number;
    pass: number;
    step: number;
    repeats: number;
  };
  const pulses: Pulse[] = [];
  for (let pass = 0; pass < passes; pass += 1) {
    const cycle = cycleFor(row, pass);
    const pattern = rowPattern(row, pass);
    const velocity = cycle.velocity ?? row.velocity ?? RHYTHM_DEFAULTS.velocity;
    const probability = cycle.probability ?? row.probability ?? 1;
    const repeats = cycle.repeats ?? row.repeats ?? 0;
    const count = pattern.reduce((sum, on) => sum + on, 0);
    const accented =
      row.grid !== undefined
        ? [...row.grid]
            .filter((char) => char !== ".")
            .map((char) => (char === "X" ? 1 : 0))
        : bjorklund(
            Math.min(row.accents ?? RHYTHM_DEFAULTS.accents, count),
            count,
          );
    let ordinal = 0;
    for (let step = 0; step < steps; step += 1) {
      if (!pattern[step]) continue;
      const index = ordinal;
      ordinal += 1;
      const global = pass * steps + step;
      const offset = nudge + (global % 2 === 1 ? swing : 0);
      const start = Math.max(0, Math.round((global + offset) * stepTicks));
      if (start >= context.loopTicks) continue;
      if (probability < 1 && chance(seed, row.voice, pass, step) >= probability)
        continue;
      const lifted = accented[index]
        ? velocity + (1 - velocity) * accent
        : velocity;
      pulses.push({ start, velocity: lifted, pass, step, repeats });
    }
  }
  pulses.sort((a, b) => a.start - b.start);

  const hits: RhythmHit[] = [];
  const minInterval = Math.max(1, Math.round(tpb / 32));
  const factor = 1 + 0.5 * pace;
  pulses.forEach((pulse, index) => {
    const cutoff = pulses[index + 1]?.start ?? context.loopTicks;
    const length = row.legato
      ? Math.max(1, cutoff - pulse.start)
      : Math.max(1, Math.round(gate * stepTicks));
    push(hits, pulse.start, length, pulse.velocity, pulse, 0);
    let at = pulse.start;
    let interval = timeTicks;
    for (let repeat = 1; repeat <= pulse.repeats; repeat += 1) {
      at += Math.max(minInterval, interval);
      const tick = Math.round(at);
      if (tick >= cutoff) break;
      const velocity = pulse.velocity * (1 + (ramp * repeat) / pulse.repeats);
      const span = Math.max(
        1,
        Math.round(
          Math.min(gate * stepTicks, Math.max(minInterval, interval * factor)),
        ),
      );
      push(hits, tick, span, velocity, pulse, repeat);
      interval *= factor;
    }
  });
  return hits;
}

function push(
  hits: RhythmHit[],
  startTick: number,
  durationTicks: number,
  velocity: number,
  pulse: Readonly<{ pass: number; step: number }>,
  repeat: number,
): void {
  const clamped = Math.round(Math.min(1, Math.max(0, velocity)) * 1000) / 1000;
  if (clamped < MIN_VELOCITY) return;
  hits.push(
    Object.freeze({
      startTick,
      durationTicks,
      velocity: clamped,
      pass: pulse.pass,
      step: pulse.step,
      repeat,
    }),
  );
}

/** Deterministic [0, 1) from the seed and position (FNV-1a + xorshift mix). */
export function chance(
  seed: number,
  voice: string,
  pass: number,
  step: number,
): number {
  const text = `${seed}|${voice}|${pass}|${step}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000;
}

/** `E(4,16)`, `E(3,8,r2)` or `grid` for a status line. */
export function rowSummary(row: RhythmRow): string {
  if (row.grid !== undefined) return `grid ${row.grid.length}`;
  const rotate = row.rotate ? `,r${row.rotate}` : "";
  return `E(${row.pulses ?? RHYTHM_DEFAULTS.pulses},${rowSteps(row)}${rotate})`;
}
