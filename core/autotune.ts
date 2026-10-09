/**
 * Pitch correction (0.7 `Track.autotune`): from gentle to hard-tuned.
 *
 * A tracked pitch curve (src/audio/dsp/pitch.ts) becomes a shift in cents
 * per analysis frame, which a PSOLA pass (src/audio/dsp/psola.ts) applies
 * with the formants kept. Two target sources:
 *
 * - a grid (`to: scale | chromatic | chord`): pitches in cents re A440,
 *   chosen per note with hysteresis, Auto-Tune style. `speed` is the retune
 *   time constant of a one-pole slew on the correction, so a slow speed
 *   corrects the note centre and lets vibrato and scoops through while
 *   speed 0 snaps (the stepped hard-tune sound). `relax` slows the retune
 *   on sustained notes (Auto-Tune Humanize), `flex` narrows the capture
 *   zone so only notes already near a target are pulled (Flex-Tune).
 * - guide notes (`to: notes`): each frame's target is the note sounding
 *   then. Without `speed` it is Melodyne-style (`center` moves each note's
 *   mean to the written pitch, `drift` is the share of slow drift removed);
 *   with `speed` it is the grid retune locked to the melody (`locked`).
 *
 * Everything here is pure and deterministic. The render hooks build the
 * targets (tuning table, key, chord timeline, guide notes through the tempo
 * map) and call `autotuneBuffer`. Accuracy and cost are measured in
 * .plans/dawg-07/pitch.md section 3.
 */
import { parseKey, scaleSteps } from "./chords.ts";
import { FxValidationError } from "./params.ts";
import { ratioCents, type TuningTable } from "./tuning.ts";

/** Bumped when correction output changes for the same inputs. */
export const AUTOTUNE_VERSION = 1;

export const AUTOTUNE_PRESETS = [
  "hard",
  "robot",
  "warble",
  "trap",
  "pop",
  "natural",
  "gentle",
  "guided",
  "locked",
] as const;
export type AutotunePreset = (typeof AUTOTUNE_PRESETS)[number];

export const AUTOTUNE_TARGETS = [
  "scale",
  "chromatic",
  "chord",
  "notes",
] as const;
export type AutotuneTarget = (typeof AUTOTUNE_TARGETS)[number];

export const AUTOTUNE_VOICES = [
  "auto",
  "bass",
  "tenor",
  "alto",
  "soprano",
] as const;
export type AutotuneVoice = (typeof AUTOTUNE_VOICES)[number];

/** Track.autotune: a preset and/or fields; explicit fields override it. */
export type TrackAutotune = Readonly<{
  preset?: AutotunePreset;
  /** Target source (default `scale`). */
  to?: AutotuneTarget;
  /** Guide track id for `to: notes`; omitted = the track's own notes. */
  from?: string;
  /** Scale override, anything `parseKey` reads (`D bayati`). */
  key?: string;
  /** Retune time constant in ms, 0..400; 0 is instant. */
  speed?: number;
  /** 0..1 slower retune on sustained notes. */
  relax?: number;
  /** ms 50..1000 before a note counts as sustained. */
  hold?: number;
  /** 0..100 Flex-Tune: capture zone 50·(1 − flex/100) cents. */
  flex?: number;
  /** Seconds 0..0.5 to move between targets. */
  glide?: number;
  /** 0..1 correction strength. */
  amount?: number;
  /** Added vibrato rate in Hz, 0..12 (0 off). */
  vib?: number;
  /** Added vibrato depth in semitones, 0..1 (0.2 when vib is on). */
  vibmod?: number;
  /** Note mode without speed: 0..1 how far each note's mean moves. */
  center?: number;
  /** Note mode without speed: 0..1 share of slow drift removed. */
  drift?: number;
  /** Tracker range. */
  voice?: AutotuneVoice;
}>;

/** Every field filled: the preset applied, then the explicit fields. */
export type ResolvedAutotune = Readonly<{
  to: AutotuneTarget;
  from?: string;
  key?: string;
  /** Undefined in note mode means center/drift (Melodyne-style). */
  speed?: number;
  relax: number;
  hold: number;
  flex: number;
  glide: number;
  amount: number;
  vib: number;
  vibmod: number;
  center: number;
  drift: number;
  voice: AutotuneVoice;
}>;

export type AutotuneNumberField =
  | "speed"
  | "relax"
  | "hold"
  | "flex"
  | "glide"
  | "amount"
  | "vib"
  | "vibmod"
  | "center"
  | "drift";

export type AutotuneParam = Readonly<{
  name: AutotuneNumberField;
  min: number;
  max: number;
  def: number;
  /** Step for menu left/right. */
  step: number;
  unit: string;
  label: string;
  help: string;
}>;

/** Numeric fields with ranges, defaults (= pop) and units, in type order. */
export const AUTOTUNE_PARAMS: readonly AutotuneParam[] = Object.freeze([
  {
    name: "speed",
    min: 0,
    max: 400,
    def: 25,
    step: 5,
    unit: "ms",
    label: "Speed",
    help: "retune time; 0 is instant and stepped",
  },
  {
    name: "relax",
    min: 0,
    max: 1,
    def: 0.3,
    step: 0.05,
    unit: "",
    label: "Relax",
    help: "slower retune on held notes",
  },
  {
    name: "hold",
    min: 50,
    max: 1000,
    def: 150,
    step: 10,
    unit: "ms",
    label: "Hold",
    help: "when a note counts as held, for relax",
  },
  {
    name: "flex",
    min: 0,
    max: 100,
    def: 0,
    step: 5,
    unit: "",
    label: "Flex",
    help: "higher only pulls notes already near a target",
  },
  {
    name: "glide",
    min: 0,
    max: 0.5,
    def: 0,
    step: 0.01,
    unit: "s",
    label: "Glide",
    help: "time to move between targets",
  },
  {
    name: "amount",
    min: 0,
    max: 1,
    def: 1,
    step: 0.05,
    unit: "",
    label: "Amount",
    help: "correction strength",
  },
  {
    name: "vib",
    min: 0,
    max: 12,
    def: 0,
    step: 0.5,
    unit: "Hz",
    label: "Vib",
    help: "added vibrato rate (0 off)",
  },
  {
    name: "vibmod",
    min: 0,
    max: 1,
    def: 0.2,
    step: 0.05,
    unit: "st",
    label: "Vib depth",
    help: "added vibrato depth",
  },
  {
    name: "center",
    min: 0,
    max: 1,
    def: 1,
    step: 0.05,
    unit: "",
    label: "Center",
    help: "notes: move each note's middle to the written pitch",
  },
  {
    name: "drift",
    min: 0,
    max: 1,
    def: 0.5,
    step: 0.05,
    unit: "",
    label: "Drift",
    help: "notes: share of slow drift removed",
  },
]);

export const AUTOTUNE_FIELDS = [
  "preset",
  "to",
  "from",
  "key",
  "speed",
  "relax",
  "hold",
  "flex",
  "glide",
  "amount",
  "vib",
  "vibmod",
  "center",
  "drift",
  "voice",
] as const satisfies readonly (keyof TrackAutotune)[];

/** Preset fields (pitch.md section 5). */
export const AUTOTUNE_PRESET_FIELDS: Readonly<
  Record<AutotunePreset, TrackAutotune>
> = Object.freeze({
  hard: { speed: 0, relax: 0, glide: 0 },
  robot: { speed: 0, relax: 0, to: "chromatic" },
  warble: { speed: 0, relax: 0, vib: 6.5, vibmod: 0.35 },
  trap: { speed: 10, relax: 0.2 },
  pop: { speed: 25, relax: 0.3 },
  natural: { speed: 60, relax: 0.5, flex: 40 },
  gentle: { speed: 120, relax: 0.6, flex: 20 },
  guided: { to: "notes", center: 1, drift: 0.5, glide: 0.04 },
  locked: { to: "notes", speed: 0, relax: 0 },
});

/** One line per preset for help and menus. */
export const AUTOTUNE_PRESET_HELP: Readonly<Record<AutotunePreset, string>> =
  Object.freeze({
    hard: "instant, stepped notes",
    robot: "stepped on every step of the tuning",
    warble: "hard with wide synthetic vibrato",
    trap: "fast and glossy",
    pop: "polished but sung",
    natural: "keeps scoops and vibrato",
    gentle: "barely there",
    guided: "notes to a written melody, vibrato kept",
    locked: "hard tune locked to a melody",
  });

export function isAutotunePreset(value: unknown): value is AutotunePreset {
  return (
    typeof value === "string" &&
    (AUTOTUNE_PRESETS as readonly string[]).includes(value)
  );
}

function fail(message: string): never {
  throw new FxValidationError(`autotune: ${message}`);
}

function word<T extends string>(
  value: unknown,
  words: readonly T[],
  field: string,
): T {
  if (
    typeof value !== "string" ||
    !(words as readonly string[]).includes(value)
  )
    fail(`${field} must be one of ${words.join(", ")}`);
  return value as T;
}

/**
 * Validates Track.autotune. Without `from`, `to: notes` follows the
 * track's own notes (any track). `null`/undefined → undefined.
 * Ranges are checked, never clamped. `from` naming an existing track is
 * checked at score level (core/score.ts).
 */
export function normalizeAutotune(
  input: unknown,
  _instrument?: string,
): TrackAutotune | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== "object" || Array.isArray(input))
    fail("must be an object");
  const record = input as Readonly<Record<string, unknown>>;
  for (const key of Object.keys(record))
    if (!(AUTOTUNE_FIELDS as readonly string[]).includes(key))
      fail(`unknown field ${key}`);
  const out: Record<string, unknown> = {};
  for (const field of AUTOTUNE_FIELDS) {
    const value = record[field];
    if (value === undefined) continue;
    if (field === "preset") out.preset = word(value, AUTOTUNE_PRESETS, field);
    else if (field === "to") out.to = word(value, AUTOTUNE_TARGETS, field);
    else if (field === "voice") out.voice = word(value, AUTOTUNE_VOICES, field);
    else if (field === "from") {
      if (typeof value !== "string" || value.length === 0 || value.length > 64)
        fail("from must be a track id");
      out.from = value;
    } else if (field === "key") {
      if (typeof value !== "string" || parseKey(value) === undefined)
        fail(`key ${JSON.stringify(value)} is not a key (try "A minor")`);
      out.key = value;
    } else {
      const spec = AUTOTUNE_PARAMS.find((param) => param.name === field)!;
      if (typeof value !== "number" || !Number.isFinite(value))
        fail(`${field} must be a number`);
      if (value < spec.min || value > spec.max)
        fail(
          `${field} must be ${spec.min}..${spec.max}${spec.unit ? ` ${spec.unit}` : ""}`,
        );
      out[field] = value;
    }
  }
  if (Object.keys(out).length === 0) fail("give a preset or settings");
  const to =
    (out.to as AutotuneTarget | undefined) ??
    (out.preset
      ? AUTOTUNE_PRESET_FIELDS[out.preset as AutotunePreset].to
      : undefined) ??
    "scale";
  if (out.from !== undefined && to !== "notes")
    fail(`from needs to: notes (this one tunes to ${to})`);
  const ordered: Record<string, unknown> = {};
  for (const field of AUTOTUNE_FIELDS)
    if (out[field] !== undefined) ordered[field] = out[field];
  return Object.freeze(ordered) as TrackAutotune;
}

/** The preset (pop when none), then the explicit fields. */
export function resolveAutotune(input: TrackAutotune): ResolvedAutotune {
  const base: TrackAutotune = AUTOTUNE_PRESET_FIELDS[input.preset ?? "pop"];
  const pick = <K extends keyof TrackAutotune>(key: K) =>
    input[key] !== undefined ? input[key] : base[key];
  const to = pick("to") ?? "scale";
  const def = (name: AutotuneNumberField) =>
    (pick(name) as number | undefined) ??
    AUTOTUNE_PARAMS.find((param) => param.name === name)!.def;
  const vib = def("vib");
  // Note mode keeps center/drift (Melodyne-style) unless speed is set by
  // the user or the preset; the pop base speed does not count there.
  const speed =
    to === "notes"
      ? (input.speed ?? (input.preset ? base.speed : undefined))
      : def("speed");
  const from = input.from;
  const key = input.key;
  return Object.freeze({
    to,
    ...(from !== undefined ? { from } : {}),
    ...(key !== undefined ? { key } : {}),
    ...(speed !== undefined ? { speed } : {}),
    relax: def("relax"),
    hold: def("hold"),
    flex: def("flex"),
    glide: def("glide"),
    amount: def("amount"),
    vib,
    vibmod: vib > 0 ? def("vibmod") : 0,
    center: def("center"),
    drift: def("drift"),
    voice: pick("voice") ?? "auto",
  });
}

/** A stable digest of the resolved settings, for cache and stem keys. */
export function autotuneDigest(resolved: ResolvedAutotune): string {
  return `at${AUTOTUNE_VERSION}:${JSON.stringify(resolved)}`;
}

/** The shortest description: `hard`, `pop · speed 35 ms`. */
export function describeAutotune(input: TrackAutotune): string {
  const parts: string[] = [input.preset ?? "pop"];
  for (const field of AUTOTUNE_FIELDS) {
    if (field === "preset") continue;
    const value = input[field];
    if (value === undefined) continue;
    const spec = AUTOTUNE_PARAMS.find((param) => param.name === field);
    // glide is stored in seconds (like Track.glide) and shown in ms.
    parts.push(
      field === "glide"
        ? `glide ${Math.round((value as number) * 1000)} ms`
        : `${field} ${value}${spec?.unit ? ` ${spec.unit}` : ""}`.trimEnd(),
    );
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Targets

/**
 * A pitch curve, structurally the pitch lane's `PitchCurve`: frame f is
 * centred at t0 + f·hop seconds; `f0` Hz (0 unvoiced); `prob` and
 * `aperiodic` in 1/255 steps.
 */
export type AutotuneCurve = Readonly<{
  t0: number;
  hop: number;
  f0: ArrayLike<number>;
  prob: ArrayLike<number>;
  aperiodic: ArrayLike<number>;
}>;

/** Target pitches in cents re A440, ascending (absolute, every octave). */
export type Grid = Readonly<{ points: Float64Array; minStep: number }>;

export const centsOfHz = (hz: number): number => 1200 * Math.log2(hz / 440);

function gridOf(points: number[]): Grid {
  const sorted = [...new Set(points.map((p) => Math.round(p * 1e6) / 1e6))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  let minStep = Infinity;
  for (let i = 1; i < sorted.length; i += 1)
    minStep = Math.min(minStep, sorted[i]! - sorted[i - 1]!);
  return Object.freeze({
    points: Float64Array.from(sorted),
    minStep: Number.isFinite(minStep) ? minStep : 1200,
  });
}

/** 12-TET A440 cents of a (possibly fractional) key through a table. */
function keyCents(table: TuningTable | undefined, key: number): number {
  const at = (k: number) => {
    const hz = table?.hz[k];
    return hz && hz > 0 ? ratioCents(hz / 440) : (k - 69) * 100;
  };
  const base = Math.min(126, Math.max(0, Math.floor(key)));
  const frac = key - base;
  if (frac === 0) return at(base);
  // A maqam or dastgah scale preset (core/tuning.ts scalePreset) already
  // lowered the upper key to the quarter tone: read it there. Only an
  // untuned pair of keys interpolates.
  const gap = at(base + 1) - at(base);
  if (table && Math.abs(gap - 100) > 25) return at(base + 1);
  return at(base) + gap * frac;
}

/** Every mapped pitch of a tuning (12-TET A440 without one). */
export function chromaticGrid(table?: TuningTable): Grid {
  const points: number[] = [];
  for (let key = 0; key < 128; key += 1) {
    if (table) {
      const hz = table.hz[key]!;
      if (hz > 0) points.push(ratioCents(hz / 440));
    } else points.push((key - 69) * 100);
  }
  return gridOf(points);
}

/**
 * The key's scale through a tuning: degree positions are table pitches of
 * the scale steps (fractional steps interpolate, so quarter tones and a
 * raga tuning's intonation apply). A table that is not 12 to the period
 * (19-EDO, Bohlen-Pierce) has no 12-note scale, so every table pitch is a
 * target. No key: chromatic.
 */
export function scaleGrid(
  keyText: string | null | undefined,
  table?: TuningTable,
): Grid {
  const key = parseKey(keyText ?? undefined);
  if (
    !key ||
    (table && (table.size !== 12 || Math.abs(table.period - 1200) > 1e-6))
  )
    return chromaticGrid(table);
  const steps = scaleSteps(key);
  const points: number[] = [];
  for (let octave = -1; octave <= 10; octave += 1)
    for (const step of steps) {
      const k = octave * 12 + key.tonic + step;
      if (k >= 0 && k <= 127) points.push(keyCents(table, k));
    }
  return gridOf(points);
}

/** A chord's pitch classes (0 = C) through a tuning, every octave. */
export function classGrid(
  classes: readonly number[],
  table?: TuningTable,
): Grid {
  const points: number[] = [];
  for (let key = 0; key < 128; key += 1)
    if (classes.includes(((key % 12) + 12) % 12))
      points.push(keyCents(table, key));
  return gridOf(points);
}

/** Nearest grid target to `c` cents (lower on ties). */
export function nearestTarget(grid: Grid, c: number): number {
  const p = grid.points;
  if (p.length === 0) return c;
  let lo = 0;
  let hi = p.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p[mid]! < c) lo = mid + 1;
    else hi = mid;
  }
  const above = p[lo]!;
  const below = lo > 0 ? p[lo - 1]! : above;
  return c - below <= above - c ? below : above;
}

/** Distance from target `t` to its nearer neighbouring point. */
function gapAt(grid: Grid, t: number): number {
  const p = grid.points;
  let best = Infinity;
  for (let i = 0; i < p.length; i += 1) {
    if (Math.abs(p[i]! - t) > 1e-6) continue;
    if (i > 0) best = Math.min(best, t - p[i - 1]!);
    if (i + 1 < p.length) best = Math.min(best, p[i + 1]! - t);
    break;
  }
  return Number.isFinite(best) ? best : 1200;
}

// ---------------------------------------------------------------------------
// Correction curves

const lp = (dtMs: number, tauMs: number) =>
  tauMs <= 0 ? 1 : 1 - Math.exp(-dtMs / tauMs);
const smoothstep = (x: number, a: number, b: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

function voicedAt(curve: AutotuneCurve, f: number): boolean {
  return curve.f0[f]! > 0;
}

/**
 * How much correction a frame may take: breath, consonant tails and creak
 * track as low-confidence or aperiodic frames, and hard tune on them would
 * impose a periodic pitch on noise.
 */
export function voicingWeight(curve: AutotuneCurve, f: number): number {
  return (
    smoothstep((curve.prob[f] ?? 0) / 255, 0.3, 0.7) *
    (1 - smoothstep((curve.aperiodic[f] ?? 255) / 255, 0.2, 0.4))
  );
}

/**
 * Hard tune's weight: full correction on any pitched frame, including the
 * lower-confidence onsets and glides between notes, so transitions land on
 * the grid; breath and noise (aperiodic frames) still get none.
 */
export function hardVoicingWeight(curve: AutotuneCurve, f: number): number {
  return (
    smoothstep((curve.prob[f] ?? 0) / 255, 0.04, 0.18) *
    (1 - smoothstep((curve.aperiodic[f] ?? 255) / 255, 0.2, 0.4))
  );
}

/** Centred moving average of cents over ±r frames, inside voiced runs. */
function centredAverage(curve: AutotuneCurve, r: number): Float64Array {
  const n = curve.f0.length;
  const out = new Float64Array(n).fill(NaN);
  let f = 0;
  while (f < n) {
    if (!voicedAt(curve, f)) {
      f += 1;
      continue;
    }
    let e = f;
    while (e < n && voicedAt(curve, e)) e += 1;
    // prefix sums keep it linear in the run length
    const sums = new Float64Array(e - f + 1);
    for (let i = f; i < e; i += 1)
      sums[i - f + 1] = sums[i - f]! + centsOfHz(curve.f0[i]!);
    for (let i = f; i < e; i += 1) {
      const a = Math.max(f, i - r);
      const b = Math.min(e - 1, i + r);
      out[i] = (sums[b - f + 1]! - sums[a - f]!) / (b - a + 1);
    }
    f = e;
  }
  return out;
}

/** Median of voiced cents over ±r frames (NaN where unvoiced). */
export function runningMedian(curve: AutotuneCurve, r: number): Float64Array {
  const n = curve.f0.length;
  const out = new Float64Array(n).fill(NaN);
  const cents = new Float64Array(n);
  for (let f = 0; f < n; f += 1)
    cents[f] = voicedAt(curve, f) ? centsOfHz(curve.f0[f]!) : NaN;
  const window: number[] = [];
  for (let f = 0; f < n; f += 1) {
    if (!voicedAt(curve, f)) continue;
    window.length = 0;
    for (let g = Math.max(0, f - r); g <= Math.min(n - 1, f + r); g += 1)
      if (!Number.isNaN(cents[g]!)) window.push(cents[g]!);
    window.sort((a, b) => a - b);
    out[f] = window[window.length >> 1]!;
  }
  return out;
}

/** Grid targets: one grid, or one per frame time (chord changes). */
export type GridSource = Grid | ((seconds: number) => Grid);

export type RetuneParams = Readonly<{
  speed: number;
  relax?: number;
  hold?: number;
  flex?: number;
  glide?: number;
  amount?: number;
  /** Added vibrato rate Hz and peak depth in cents. */
  vib?: number;
  vibCents?: number;
  /** Hysteresis floor in cents (default 12). */
  hysteresis?: number;
}>;

/**
 * Grid correction: shift in cents per frame (NaN where unvoiced, i.e. pass
 * through). Port of proto/pitch/correct.ts retuneCurve with its review
 * fixes: density-scaled hysteresis, 180 ms centred selection on dense
 * grids, octave guard, voicing weight.
 */
export function retuneCurve(
  curve: AutotuneCurve,
  source: GridSource,
  p: RetuneParams,
): Float64Array {
  const n = curve.f0.length;
  const out = new Float64Array(n).fill(NaN);
  const dtMs = curve.hop * 1000;
  const amount = p.amount ?? 1;
  const hystFloor = p.hysteresis ?? 12;
  const relax = p.relax ?? 0;
  const holdMs = p.hold ?? 150;
  const flex = Math.min(100, Math.max(0, p.flex ?? 0));
  const zone = 50 * (1 - flex / 100);
  const glideMs = (p.glide ?? 0) * 1000;
  const gridAt =
    typeof source === "function" ? source : (_seconds: number) => source;
  const dynamic = typeof source === "function";
  const selTau = p.speed <= 5 ? 0 : 60;
  // Hard tune also snaps the pitched glides between notes, which track
  // with lower confidence than the held middles.
  const hardTune = p.speed === 0 && relax === 0;
  const first = gridAt(curve.t0);
  const anyDense = dynamic || first.minStep < 100;
  const avg = anyDense
    ? centredAverage(curve, Math.round(0.09 / curve.hop))
    : null;
  const med = runningMedian(curve, Math.round(0.15 / curve.hop));
  let centre = NaN;
  let target = NaN;
  let shown = NaN;
  let corr = 0;
  let inNote = 0;
  let lastGrid: Grid | undefined;
  for (let f = 0; f < n; f += 1) {
    const hz = curve.f0[f]!;
    if (!(hz > 0)) {
      centre = NaN;
      target = NaN;
      shown = NaN;
      corr = 0;
      inNote = 0;
      continue;
    }
    const grid = gridAt(curve.t0 + f * curve.hop);
    const dense = grid.minStep < 100;
    const c = centsOfHz(hz);
    centre =
      dense && avg
        ? avg[f]!
        : Number.isNaN(centre)
          ? c
          : centre + (c - centre) * lp(dtMs, selTau);
    const nearest = nearestTarget(grid, centre);
    // the grid changed (a chord change) and the held target left it
    if (lastGrid !== grid && !Number.isNaN(target)) {
      if (Math.abs(nearestTarget(grid, target) - target) > 1e-6) {
        target = nearest;
        inNote = 0;
      }
    }
    lastGrid = grid;
    const hyst =
      Number.isNaN(target) || !dense
        ? hystFloor
        : Math.max(hystFloor, 0.35 * gapAt(grid, target));
    if (Number.isNaN(target)) target = nearest;
    else if (
      nearest !== target &&
      Math.abs(centre - nearest) + hyst < Math.abs(centre - target)
    ) {
      target = nearest;
      inNote = 0;
    }
    if (Number.isNaN(shown) || glideMs <= 0) shown = target;
    else {
      const maxStep = (dtMs / glideMs) * 100;
      shown += Math.max(-maxStep, Math.min(maxStep, target - shown));
    }
    inNote += dtMs;
    let w = amount;
    if (flex > 0) {
      const dist = Math.abs(centre - target);
      w *= dist <= zone ? 1 : Math.max(0, 1 - (dist - zone) / 10);
    }
    const voicing =
      Math.abs(c - med[f]!) > 900
        ? 0
        : hardTune
          ? hardVoicingWeight(curve, f)
          : voicingWeight(curve, f);
    w *= voicing;
    const sustained =
      relax > 0 && inNote > holdMs
        ? Math.min(1, (inNote - holdMs) / holdMs)
        : 0;
    const tau =
      p.speed * (1 + 7 * relax * sustained) +
      (sustained > 0 && p.speed === 0 ? 40 * relax * sustained : 0);
    const err = (shown - c) * w;
    corr += (err - corr) * lp(dtMs, tau);
    // Added vibrato follows the voicing too: none on breath or octave slips.
    out[f] =
      corr + voicing * addedVibrato(p.vib ?? 0, p.vibCents ?? 0, inNote / 1000);
  }
  return out;
}

/**
 * Added vibrato: starts `delay` seconds into a note (0.2 s for the track's
 * vib, the note's own vibrato delay for a guide note) and fades in over
 * 0.15 s like core/expression.ts.
 */
function addedVibrato(
  rate: number,
  depth: number,
  t: number,
  delay = 0.2,
): number {
  if (rate <= 0 || depth <= 0) return 0;
  const into = t - delay;
  if (into <= 0) return 0;
  return depth * Math.min(1, into / 0.15) * Math.sin(2 * Math.PI * rate * into);
}

/** A guide note in buffer seconds. */
export type GuideNote = Readonly<{
  start: number;
  end: number;
  /** Target cents re A440 (noteHz of the note, cents included). */
  cents: number;
  /** Per-note drift override (NoteExpression.drift). */
  drift?: number;
  /** Ghost notes get no correction. */
  ghost?: boolean;
  /** Seconds of glide into this note (the note's glide). */
  glide?: number;
  /** The note's vibrato (rate Hz, depth semitones) replaces vib/vibmod. */
  vib?: number;
  vibmod?: number;
  /** The note's vibrato delay in seconds (0 when it has none). */
  vibDelay?: number;
}>;

export type GuideParams = Readonly<{
  center?: number;
  drift?: number;
  /** Transition between notes in seconds. */
  glide?: number;
  /** When set, locked mode: the retune slew in ms. */
  speed?: number;
  amount?: number;
  relax?: number;
  hold?: number;
  vib?: number;
  vibCents?: number;
}>;

/**
 * Note-guided correction (port of proto guideCurve with its review fixes):
 * Melodyne-style center/drift, or locked to the notes with `speed`; legato
 * boundaries follow the straight line between the corrected pitches half a
 * transition either side.
 */
export function guideCurve(
  curve: AutotuneCurve,
  notes: readonly GuideNote[],
  p: GuideParams,
): Float64Array {
  const n = curve.f0.length;
  const out = new Float64Array(n).fill(NaN);
  const center = p.center ?? 1;
  const driftDefault = p.drift ?? 0.5;
  const trans = p.glide ?? 0.04;
  const dtMs = curve.hop * 1000;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const noteOf = new Int32Array(n).fill(-1);
  const sums = sorted.map(() => ({ s: 0, n: 0 }));
  let cursor = 0;
  for (let f = 0; f < n; f += 1) {
    const hz = curve.f0[f]!;
    if (!(hz > 0)) continue;
    const t = curve.t0 + f * curve.hop;
    while (cursor < sorted.length && sorted[cursor]!.end <= t) cursor += 1;
    for (let k = cursor; k < sorted.length && sorted[k]!.start <= t; k += 1) {
      const note = sorted[k]!;
      if (t >= note.start && t < note.end) {
        noteOf[f] = k;
        if (t > note.start + 0.06) {
          sums[k]!.s += centsOfHz(hz);
          sums[k]!.n += 1;
        }
        break;
      }
    }
  }
  const mean = sums.map((s) => (s.n ? s.s / s.n : NaN));
  // The slow (drift) estimate: a 150 ms one-pole run forwards then
  // backwards inside each note, starting from the note mean. Zero phase
  // (offline), so a scoop or the next note's step never leaks into it
  // (review open item: drift 1 leaked the step with a causal estimate).
  const slowArr = new Float64Array(n).fill(NaN);
  {
    const a = lp(dtMs, 150);
    let f = 0;
    while (f < n) {
      const k = noteOf[f]!;
      if (k < 0) {
        f += 1;
        continue;
      }
      let e = f;
      while (e < n && noteOf[e] === k) e += 1;
      let y = Number.isNaN(mean[k]!) ? centsOfHz(curve.f0[f]!) : mean[k]!;
      for (let g = f; g < e; g += 1) {
        y += (centsOfHz(curve.f0[g]!) - y) * a;
        slowArr[g] = y;
      }
      y = Number.isNaN(mean[k]!) ? slowArr[e - 1]! : mean[k]!;
      for (let g = e - 1; g >= f; g -= 1) {
        y += (slowArr[g]! - y) * a;
        slowArr[g] = y;
      }
      f = e;
    }
  }
  const hard = p.speed !== undefined;
  const amount = p.amount ?? 1;
  const relax = p.relax ?? 0;
  const holdMs = p.hold ?? 150;
  let slow = NaN;
  let prevK = -1;
  let corr = 0;
  let inNote = 0;
  for (let f = 0; f < n; f += 1) {
    const k = noteOf[f]!;
    if (k < 0) {
      slow = NaN;
      prevK = -1;
      corr = 0;
      inNote = 0;
      continue;
    }
    const note = sorted[k]!;
    if (k !== prevK) inNote = 0;
    inNote += dtMs;
    const c = centsOfHz(curve.f0[f]!);
    let want: number;
    if (note.ghost) want = 0;
    else if (hard) {
      const sustained =
        relax > 0 && inNote > holdMs
          ? Math.min(1, (inNote - holdMs) / holdMs)
          : 0;
      const glideMs = (note.glide ?? 0) * 1000;
      const tau = Math.max(p.speed! * (1 + 7 * relax * sustained), glideMs / 3);
      const err = note.cents - c;
      corr = prevK < 0 ? err : corr + (err - corr) * lp(dtMs, tau);
      want = corr * amount;
    } else {
      slow = slowArr[f]!;
      const m = Number.isNaN(mean[k]!) ? c : mean[k]!;
      const drift = note.drift ?? driftDefault;
      want = amount * (center * (note.cents - m) - drift * (slow - m));
    }
    const rate = note.vib ?? p.vib ?? 0;
    const depth =
      note.vib !== undefined ? (note.vibmod ?? 0) * 100 : (p.vibCents ?? 0);
    const delay = note.vib !== undefined ? (note.vibDelay ?? 0) : 0.2;
    out[f] = note.ghost
      ? 0
      : want + addedVibrato(rate, depth, inNote / 1000, delay);
    prevK = k;
  }
  const voiced = (f: number) => noteOf[f]! >= 0;
  if (!hard) {
    const src = Float64Array.from(out);
    for (let f = 1; f < n; f += 1) {
      if (!voiced(f) || !voiced(f - 1) || noteOf[f] === noteOf[f - 1]) continue;
      const into = sorted[noteOf[f]!]!;
      const width = into.glide ?? trans;
      if (width <= 0 || into.ghost || sorted[noteOf[f - 1]!]!.ghost) continue;
      const half = Math.max(1, Math.round(width / 2 / curve.hop));
      const a = Math.max(0, f - half);
      const b = Math.min(n - 1, f + half - 1);
      let ok = true;
      for (let g = a; g <= b; g += 1) if (!voiced(g)) ok = false;
      if (!ok) continue;
      const pa = centsOfHz(curve.f0[a]!) + src[a]!;
      const pb = centsOfHz(curve.f0[b]!) + src[b]!;
      for (let g = a; g <= b; g += 1) {
        const u = (g - a) / Math.max(1, b - a);
        out[g] = pa + (pb - pa) * u - centsOfHz(curve.f0[g]!);
      }
    }
  }
  for (let f = 0; f < n; f += 1)
    if (voiced(f) && !sorted[noteOf[f]!]!.ghost)
      out[f] = out[f]! * voicingWeight(curve, f);
  return out;
}

// ---------------------------------------------------------------------------
// Buffer

/** Targets for one buffer, in buffer seconds. */
export type AutotuneTargets =
  | Readonly<{ kind: "grid"; grid: GridSource }>
  | Readonly<{ kind: "notes"; notes: readonly GuideNote[] }>;

/** The PSOLA pass: input f0 and shift in cents per sample. */
export type PsolaShift = (
  x: Float64Array,
  sampleRate: number,
  curve: Readonly<{ f0: Float64Array; cents: Float64Array }>,
) => Float64Array;

/** Shift in cents per frame for resolved settings and targets. */
export function correctionCurve(
  curve: AutotuneCurve,
  targets: AutotuneTargets,
  r: ResolvedAutotune,
  maxShift = 12,
): Float64Array {
  const vibCents = r.vibmod * 100;
  const shift =
    targets.kind === "grid"
      ? retuneCurve(curve, targets.grid, {
          speed: r.speed ?? 25,
          relax: r.relax,
          hold: r.hold,
          flex: r.flex,
          glide: r.glide,
          amount: r.amount,
          vib: r.vib,
          vibCents,
        })
      : guideCurve(curve, targets.notes, {
          center: r.center,
          drift: r.drift,
          glide: r.glide,
          ...(r.speed !== undefined ? { speed: r.speed } : {}),
          amount: r.amount,
          relax: r.relax,
          hold: r.hold,
          vib: r.vib,
          vibCents,
        });
  const cap = maxShift * 100;
  for (let f = 0; f < shift.length; f += 1)
    if (!Number.isNaN(shift[f]!))
      shift[f] = Math.max(-cap, Math.min(cap, shift[f]!));
  return shift;
}

/** Per-sample input f0 and shift (linear between frames). */
export function perSampleShift(
  curve: AutotuneCurve,
  shift: Float64Array,
  frames: number,
  sampleRate: number,
): { f0: Float64Array; cents: Float64Array } {
  const f0 = new Float64Array(frames);
  const cents = new Float64Array(frames);
  const n = curve.f0.length;
  for (let i = 0; i < frames; i += 1) {
    const pos = (i / sampleRate - curve.t0) / curve.hop;
    const j = Math.floor(pos);
    if (j < 0 || j >= n) continue;
    const u = pos - j;
    const fa = curve.f0[j]!;
    const fb = j + 1 < n ? curve.f0[j + 1]! : fa;
    // the nearer frame decides voicing; both voiced interpolate in Hz
    f0[i] = fa > 0 && fb > 0 ? fa + (fb - fa) * u : u < 0.5 ? fa : fb;
    const a = shift[j]!;
    const b = j + 1 < n ? shift[j + 1]! : a;
    if (Number.isNaN(a) && Number.isNaN(b)) cents[i] = 0;
    else if (Number.isNaN(a)) cents[i] = b;
    else if (Number.isNaN(b)) cents[i] = a;
    else cents[i] = a + (b - a) * u;
  }
  return { f0, cents };
}

/**
 * A resumable PSOLA pass (the pitch lane's psola as a generator): yields
 * between blocks so the live scheduler can run it in slices.
 */
export type PsolaJob = (
  x: Float64Array,
  sampleRate: number,
  curve: Readonly<{ f0: Float64Array; cents: Float64Array }>,
) => Generator<void, Float64Array>;

/** Samples between yields in the per-sample steps of `autotuneJob`. */
const JOB_BLOCK = 16384;

/**
 * The tuned buffer as a resumable job: correction curve, per-sample shift
 * and PSOLA, yielding between blocks (and inside `psolaJob` when given).
 * Its result is identical to `autotuneBuffer`, which drains it.
 */
export function* autotuneJob(
  x: Float32Array,
  sampleRate: number,
  curve: AutotuneCurve,
  targets: AutotuneTargets,
  r: ResolvedAutotune,
  psola: PsolaShift,
  maxShift = 12,
  psolaJob?: PsolaJob,
): Generator<void, Float32Array> {
  const shift = correctionCurve(curve, targets, r, maxShift);
  let moves = false;
  for (let f = 0; f < shift.length && !moves; f += 1)
    if (Math.abs(shift[f]!) > 1e-9) moves = true;
  if (!moves) return x;
  yield;
  const input = new Float64Array(x.length);
  for (let i = 0; i < x.length; i += JOB_BLOCK) {
    const end = Math.min(x.length, i + JOB_BLOCK);
    for (let j = i; j < end; j += 1) input[j] = x[j]!;
    yield;
  }
  const per = perSampleShift(curve, shift, x.length, sampleRate);
  yield;
  const y = psolaJob
    ? yield* psolaJob(input, sampleRate, per)
    : psola(input, sampleRate, per);
  yield;
  return Float32Array.from(y);
}

/**
 * The tuned buffer: correction curve, per-sample shift, PSOLA. The one
 * entry point the sampler and clip hooks call. Returns the input unchanged
 * (same object) when nothing would move.
 */
export function autotuneBuffer(
  x: Float32Array,
  sampleRate: number,
  curve: AutotuneCurve,
  targets: AutotuneTargets,
  r: ResolvedAutotune,
  psola: PsolaShift,
  maxShift = 12,
): Float32Array {
  const job = autotuneJob(x, sampleRate, curve, targets, r, psola, maxShift);
  for (;;) {
    const step = job.next();
    if (step.done) return step.value;
  }
}
