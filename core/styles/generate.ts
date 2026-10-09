/**
 * Style generation (quality-08): a resolved style card, a seed and a bar
 * count become a song. Everything comes from the card's theory: meter and
 * grouping, a groove grid with swing and microtiming, onset probability
 * grids per role, a scale (12-TET, maqam quarter tones as cents, or a
 * named tuning's degrees), a harmonic grammar (presets, fixed forms, a
 * numeral Markov chain, cadences; or a modal vamp or a drone), a bass
 * behaviour, a contour-driven melody over interval weights, a section plan
 * and a mix. The same style, seed and bars always produce the same notes.
 *
 * The result carries the plan (`StylePlan`) next to the score data so the
 * validator (`validate.ts`) can check the notes against the theory that
 * made them.
 */

import {
  findPreset,
  keyName,
  MODES,
  mulberry32,
  parseKey,
  parseRoman,
  chordPitchClasses,
  SCALES,
  voiceChord,
  type Key,
  type ModeName,
  type ScaleName,
  type Spread,
} from "../chords.ts";
import { DRUM_VOICES } from "../drums.ts";
import { FX_PRESETS, applyRigPreset, rigReverb, type TrackFx } from "../fx.ts";
import { resolveInstrumentWord } from "../instruments.ts";
import { instrumentPatchForWord } from "../resonators.ts";
import {
  createScore,
  DEFAULT_TICKS_PER_BEAT,
  SCORE_LIMITS,
  type NoteInput,
  type ScoreOperation,
  type Section,
  type TrackInput,
  type TrackScore,
  type TrackScoreData,
} from "../score.ts";
import { tuningPreset, type Tuning } from "../tuning.ts";
import { resolveStyle, stretchGrid, STYLE_TREE } from "./index.ts";
import {
  KIT_ROLES,
  PERC_ROLES,
  PITCHED_ROLES,
  ROLE_NAMES,
  type CycleSpec,
  type ResolvedStyle,
  type RoleName,
  type RoleVoice,
  type SectionKind,
  type StyleId,
  type StyleOptions,
  type StyleProvenance,
  type Weighted,
} from "./schema.ts";

export class StyleError extends Error {
  override name = "StyleError";
}

export const STYLE_LIMITS = Object.freeze({
  minBars: 1,
  maxBars: 64,
  defaultBars: 8,
  maxSeed: 2 ** 31 - 1,
});

const TPB = DEFAULT_TICKS_PER_BEAT;

/** Kit role -> General MIDI key the kit track plays. */
export const KIT_PITCH: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(DRUM_VOICES.map((voice) => [voice.voice, voice.pitch])),
);

/** Perc roles played on a kit track (instrument "drums"). */
const PERC_ON_KIT: Readonly<Record<string, number>> = Object.freeze({
  perc: KIT_PITCH.tom!,
  shaker: KIT_PITCH.hat!,
  bell: KIT_PITCH.rim!,
});

const LOW_STROKES = Object.freeze([
  "dum",
  "dha",
  "dhin",
  "ge",
  "gong",
  "kempul",
  "doum",
  "bum",
]);

// ---------------------------------------------------------------------------
// Seeded helpers

/** FNV-1a over a string: stable 32-bit hash for seeding. */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

type Random = () => number;

/** A sub-stream: each concern draws from its own seeded stream. */
function stream(seed: number, salt: string): Random {
  return mulberry32((seed ^ hashText(salt)) >>> 0);
}

export function pickWeighted<T>(list: Weighted<T>, random: Random): T {
  if (list.length === 0) throw new StyleError("empty weighted list");
  let total = 0;
  for (const [, weight] of list) total += weight > 0 ? weight : 0;
  if (!(total > 0)) return list[0]![0];
  let roll = random() * total;
  for (const [value, weight] of list) {
    if (!(weight > 0)) continue;
    roll -= weight;
    if (roll < 0) return value;
  }
  return list[list.length - 1]![0];
}

/** Standard normal, clamped to ±3 so humanisation has a hard bound. */
function gauss(random: Random): number {
  const u = Math.max(1e-12, random());
  const v = random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(-3, Math.min(3, z));
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
const mod = (value: number, size: number) => ((value % size) + size) % size;
const between = (range: readonly [number, number], random: Random) =>
  range[0] + (range[1] - range[0]) * random();

// ---------------------------------------------------------------------------
// The plan

/** One playable scale tone: the key offset in the tuning and its pitch. */
export type ScaleTone = Readonly<{
  /** Key offset above the root key within one period. */
  key: number;
  /** Extra note cents (12-TET quarter tones without a tuning). */
  cents: number;
  /** Sounding semitones above the tonic (fractional for quarter tones). */
  semis: number;
}>;

export type ScaleModel = Readonly<{
  /** Scale or tuning name. */
  name: string;
  /** Keys per period: 12, or the tuning's size (pelog 7). */
  period: number;
  tones: readonly ScaleTone[];
  /** Sounding semitones per period (12 for octave tunings). */
  periodSemis: number;
}>;

export type PlannedChord = Readonly<{
  /** Start in bars (fractional when the harmonic rhythm is faster). */
  bar: number;
  bars: number;
  /** Numeral as written in the grammar, or a degree label (`d0`). */
  numeral: string;
  /** Root as a scale index (modal, drone) or pitch class (functional). */
  rootPc: number;
  /** Pitch classes (12-TET) or scale indices (non-12 tunings). */
  pcs: readonly number[];
  /** True when `pcs` are scale indices. */
  degrees: boolean;
}>;

export type PlannedSection = Readonly<{
  kind: SectionKind;
  name: string;
  startBar: number;
  bars: number;
  energy: number;
  roles: readonly RoleName[];
}>;

export type RoleTrack = Readonly<{
  trackId: string;
  roles: readonly RoleName[];
  instrument: string;
  /** Kit (drums) or the word picked. */
  voice: RoleVoice;
}>;

export type StylePlan = Readonly<{
  style: ResolvedStyle;
  seed: number;
  bars: number;
  signature: string;
  beatsPerBar: number;
  beatUnit: number;
  grouping: readonly number[] | undefined;
  hypermeter: number;
  bpm: number;
  subdivision: number;
  stepsPerBar: number;
  stepTicks: number;
  barTicks: number;
  swing: number;
  tonic: number;
  rootKey: number;
  scale: ScaleModel;
  /** Library scale or mode name the key text uses (12-TET only). */
  scaleName: string;
  keyText: string | null;
  tuning: Tuning | undefined;
  harmonyModel: ResolvedStyle["harmony"]["model"];
  /** Numeral source per phrase: preset name, `form`, `chain` or model. */
  harmonySource: string;
  chords: readonly PlannedChord[];
  sections: readonly PlannedSection[];
  tracks: readonly RoleTrack[];
  /** Melody phrases: start/end bar and the notes' ids. */
  phrases: readonly Readonly<{ startBar: number; bars: number }>[];
  /** Role played by each note id. */
  noteRoles: ReadonlyMap<string, RoleName>;
  humanizeTicks: number;
}>;

export type GeneratedStyle = Readonly<{
  plan: StylePlan;
  data: TrackScoreData;
  operations: readonly ScoreOperation[];
  provenance: StyleProvenance;
}>;

// ---------------------------------------------------------------------------
// Meter, tempo, scale

export function parseSignature(text: string): [number, number] {
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(text.trim());
  if (!match) throw new StyleError(`bad time signature "${text}"`);
  const top = Number(match[1]);
  const bottom = Number(match[2]);
  if (top < 1 || top > 32 || ![1, 2, 4, 8, 16, 32].includes(bottom))
    throw new StyleError(`bad time signature "${text}"`);
  return [top, bottom];
}

/** Steps of the role grids per bar for a meter and subdivision. */
export function stepsPerBarOf(
  beatsPerBar: number,
  beatUnit: number,
  subdivision: number,
): number {
  return Math.max(1, Math.round(((beatsPerBar * 4) / beatUnit) * subdivision));
}

function scaleFor(
  style: ResolvedStyle,
  scaleName: string,
): { model: ScaleModel; tuning?: Tuning; keyScale: string } {
  const pitch = style.pitch;
  const preset = pitch.tuning ? tuningPreset(pitch.tuning) : undefined;
  if (pitch.tuning && !preset)
    throw new StyleError(`${style.id}: unknown tuning "${pitch.tuning}"`);
  if (preset && preset.cents.length !== 12) {
    // A non-12 tuning: its degrees are the scale, one key per degree.
    const size = preset.cents.length;
    const period = preset.cents[size - 1]!;
    const degrees = pitch.degrees ?? [...Array(size).keys()];
    const tones = degrees.map((degree) => ({
      key: degree,
      cents: 0,
      semis: degree === 0 ? 0 : preset.cents[degree - 1]! / 100,
    }));
    return {
      model: {
        name: preset.name,
        period: size,
        tones,
        periodSemis: period / 100,
      },
      tuning: { name: preset.name },
      keyScale: "major",
    };
  }
  const steps = stepsOfScale(scaleName);
  if (!steps) throw new StyleError(`${style.id}: unknown scale "${scaleName}"`);
  if (preset) {
    // A 12-key tuning (a maqam or raga table): each step sits on the key
    // whose tuned pitch is nearest, with no note cents.
    const table = [0, ...preset.cents.slice(0, 11)];
    const tones = steps.map((step) => {
      let best = 0;
      for (let key = 1; key < 12; key += 1)
        if (
          Math.abs(table[key]! - step * 100) <
          Math.abs(table[best]! - step * 100)
        )
          best = key;
      return { key: best, cents: 0, semis: table[best]! / 100 };
    });
    return {
      model: { name: scaleName, period: 12, tones, periodSemis: 12 },
      tuning: { name: preset.name },
      keyScale: scaleName,
    };
  }
  const tones = steps.map((step) => {
    const key = Math.floor(step + 1e-9);
    return { key, cents: Math.round((step - key) * 100), semis: step };
  });
  return {
    model: { name: scaleName, period: 12, tones, periodSemis: 12 },
    keyScale: scaleName,
  };
}

/** Semitone steps of a MODES or SCALES name. */
export function stepsOfScale(name: string): readonly number[] | undefined {
  if (Object.prototype.hasOwnProperty.call(MODES, name))
    return MODES[name as ModeName];
  if (Object.prototype.hasOwnProperty.call(SCALES, name))
    return SCALES[name as ScaleName].steps;
  return undefined;
}

/** The seven-note mode the chord engine harmonises a scale with. */
export function modeOfScale(name: string): ModeName {
  if (Object.prototype.hasOwnProperty.call(MODES, name))
    return name as ModeName;
  if (Object.prototype.hasOwnProperty.call(SCALES, name))
    return SCALES[name as ScaleName].mode;
  return "major";
}

// ---------------------------------------------------------------------------
// Harmony

const PLAIN_TRIAD =
  /^[b#]?(?:VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)[oø+]?$/;

const isMinorMode = (mode: ModeName) => MODES[mode][2] === 3;

/** Cadence tokens to numerals, with the tonic in the mode's quality. */
export function cadenceNumerals(cadence: string, mode: ModeName): string[] {
  if (cadence === "half") return ["V"];
  const minor = isMinorMode(mode);
  return cadence
    .split("-")
    .map((token) =>
      token === "I" || token === "i" ? (minor ? "i" : "I") : token,
    );
}

/** The grammar's numeral vocabulary and edges, for the validator. */
export type HarmonyGrammar = Readonly<{
  edges: ReadonlySet<string>;
  numerals: ReadonlySet<string>;
}>;

export const stripSeventh = (numeral: string) =>
  numeral.replace(/(maj7|7)$/, "");

export function harmonyGrammar(
  style: ResolvedStyle,
  mode: ModeName,
): HarmonyGrammar {
  const edges = new Set<string>();
  const numerals = new Set<string>();
  const cycle = (list: readonly string[]) => {
    list.forEach((numeral, i) => {
      const next = list[(i + 1) % list.length]!;
      numerals.add(stripSeventh(numeral));
      edges.add(`${stripSeventh(numeral)}>${stripSeventh(next)}`);
      edges.add(`${stripSeventh(numeral)}>${stripSeventh(numeral)}`);
    });
  };
  const harmony = style.harmony;
  for (const [name] of harmony.presets ?? []) {
    const preset = findPreset(name);
    if (preset) cycle(preset.numerals);
  }
  for (const [form] of harmony.forms ?? []) cycle(form);
  const chain = harmony.chain ?? {};
  const chainTonic = isMinorMode(mode) ? "i" : "I";
  const chainStart = chain[chainTonic] ? chainTonic : Object.keys(chain)[0];
  for (const [from, nexts] of Object.entries(chain)) {
    numerals.add(stripSeventh(from));
    edges.add(`${stripSeventh(from)}>${stripSeventh(from)}`);
    if (nexts.length === 0 && chainStart)
      edges.add(`${stripSeventh(from)}>${stripSeventh(chainStart)}`);
    for (const [to] of nexts) {
      numerals.add(stripSeventh(to));
      edges.add(`${stripSeventh(from)}>${stripSeventh(to)}`);
      if (!chain[to]?.length && !chain[stripSeventh(to)]?.length && chainStart)
        edges.add(`${stripSeventh(to)}>${stripSeventh(chainStart)}`);
    }
  }
  const cadences = harmony.cadences.map(([cadence]) =>
    cadenceNumerals(cadence, mode),
  );
  for (const list of cadences) {
    for (const numeral of list) numerals.add(numeral);
    for (let i = 0; i + 1 < list.length; i += 1)
      edges.add(`${list[i]}>${list[i + 1]}`);
  }
  // Entering a cadence from anywhere and leaving it to the phrase start.
  for (const list of cadences)
    for (const numeral of numerals) {
      edges.add(`${numeral}>${list[0]}`);
      edges.add(`${list[list.length - 1]}>${numeral}`);
    }
  return { edges, numerals };
}

function functionalNumerals(
  style: ResolvedStyle,
  mode: ModeName,
  slots: number,
  phraseSlots: number,
  random: Random,
): { numerals: string[]; source: string } {
  const harmony = style.harmony;
  const sources: Weighted<string> = [
    ...(harmony.presets?.length
      ? [["presets", harmony.sources?.presets ?? 1] as const]
      : []),
    ...(harmony.forms?.length
      ? [["forms", harmony.sources?.forms ?? 1] as const]
      : []),
    ...(harmony.chain && Object.keys(harmony.chain).length
      ? [["chain", harmony.sources?.chain ?? 1] as const]
      : []),
  ];
  if (sources.length === 0) throw new StyleError(`${style.id}: no numerals`);
  const source = pickWeighted(sources, random);
  let base: string[] = [];
  let label: string = source;
  if (source === "presets") {
    const name = pickWeighted(harmony.presets!, random);
    const preset = findPreset(name);
    if (!preset) throw new StyleError(`${style.id}: unknown preset "${name}"`);
    base = [...preset.numerals];
    label = preset.name;
  } else if (source === "forms") {
    base = [...pickWeighted(harmony.forms!, random)];
    label = "form";
  }
  const out: string[] = [];
  if (source === "chain") {
    const chain = harmony.chain!;
    const tonic = isMinorMode(mode) ? "i" : "I";
    const start = chain[tonic] ? tonic : Object.keys(chain)[0]!;
    let current = start;
    for (let i = 0; i < slots; i += 1) {
      out.push(current);
      const nexts = chain[current] ?? chain[stripSeventh(current)];
      // A numeral with no successors returns to the chain's start.
      current = nexts?.length ? pickWeighted(nexts, random) : start;
    }
  } else for (let i = 0; i < slots; i += 1) out.push(base[i % base.length]!);
  // Fixed forms keep their changes; presets and chains cadence at each
  // phrase end.
  if (source !== "forms" && harmony.cadences.length > 0)
    for (let end = phraseSlots; end <= slots; end += phraseSlots) {
      const cadence = cadenceNumerals(
        pickWeighted(harmony.cadences, random),
        mode,
      );
      if (cadence.length > phraseSlots) continue;
      cadence.forEach((numeral, i) => {
        out[end - cadence.length + i] = numeral;
      });
    }
  // Seventh colour on plain triads only (not on 7ths, 9ths, 6ths or
  // secondary-dominant slashes).
  return {
    numerals: out.map((numeral) =>
      !PLAIN_TRIAD.test(numeral) || random() >= style.harmony.sevenths
        ? numeral
        : `${numeral}7`,
    ),
    source: label,
  };
}

function planChords(
  style: ResolvedStyle,
  scale: ScaleModel,
  key: Key | undefined,
  bars: number,
  hypermeter: number,
  random: Random,
): { chords: PlannedChord[]; source: string } {
  const harmony = style.harmony;
  if (harmony.model === "none") return { chords: [], source: "none" };
  const perBar = Math.max(0.125, pickWeighted(harmony.rhythm, random));
  const slotBars = 1 / perBar;
  const slots = Math.max(1, Math.ceil(bars / slotBars));
  const phraseSlots = Math.max(1, Math.round(hypermeter / slotBars));
  const twelve = scale.period === 12;
  const make = (
    i: number,
    numeral: string,
    root: number,
    pcs: number[],
    degrees: boolean,
  ) => ({
    bar: i * slotBars,
    bars: Math.min(slotBars, bars - i * slotBars),
    numeral,
    rootPc: root,
    pcs: Object.freeze(pcs),
    degrees,
  });
  if (harmony.model === "functional" && twelve && key) {
    const { numerals, source } = functionalNumerals(
      style,
      key.mode,
      slots,
      phraseSlots,
      random,
    );
    const chords = numerals.map((numeral, i) => {
      const chord = parseRoman({ tonic: key.tonic, mode: key.mode }, numeral);
      if (!chord) throw new StyleError(`${style.id}: bad numeral "${numeral}"`);
      return make(i, numeral, chord.root, chordPitchClasses(chord), false);
    });
    return { chords, source };
  }
  // Modal vamps and drones build on scale degrees, so they work in any
  // tuning: a triad is degrees d, d+2, d+4 of the scale.
  const size = scale.tones.length;
  const triad = (d: number) =>
    [d, d + 2, d + 4]
      .map((x) => mod(x, size))
      .filter((x, i, all) => all.indexOf(x) === i);
  if (harmony.model === "drone") {
    const fifth = nearestDegree(scale, 7);
    const chords = Array.from({ length: slots }, (_, i) =>
      make(i, "drone", 0, fifth === 0 ? [0] : [0, fifth], true),
    );
    return { chords, source: "drone" };
  }
  // modal: tonic alternating with a weighted neighbour (bVII, II, IV, v).
  const neighbours: Weighted<number> = [
    [size - 1, 3],
    [1, 2],
    [Math.min(3, size - 1), 2],
    [Math.min(4, size - 1), 1],
  ];
  const chords: PlannedChord[] = [];
  for (let i = 0; i < slots; i += 1) {
    const degree = i % 2 === 0 ? 0 : pickWeighted(neighbours, random);
    chords.push(
      make(i, `d${degree}`, degree, size >= 5 ? triad(degree) : [degree], true),
    );
  }
  return { chords, source: "modal" };
}

/** Scale index whose pitch is nearest `semis` above the tonic. */
function nearestDegree(scale: ScaleModel, semis: number): number {
  let best = 0;
  scale.tones.forEach((tone, i) => {
    if (
      Math.abs(tone.semis - semis) < Math.abs(scale.tones[best]!.semis - semis)
    )
      best = i;
  });
  return best;
}

// ---------------------------------------------------------------------------
// Pitch space: scale indices <-> keys

type Pitch = Readonly<{ key: number; cents: number; semis: number }>;

/** Absolute scale index (degree + octave × size) to a key. */
function toneAt(plan: PitchContext, index: number): Pitch {
  const size = plan.scale.tones.length;
  const octave = Math.floor(index / size);
  const tone = plan.scale.tones[mod(index, size)]!;
  return {
    key: plan.rootKey + octave * plan.scale.period + tone.key,
    cents: tone.cents,
    semis: plan.rootKey + octave * plan.scale.periodSemis + tone.semis,
  };
}

/** The scale index whose pitch is nearest a sounding MIDI pitch. */
function indexNear(plan: PitchContext, semis: number): number {
  const size = plan.scale.tones.length;
  const octave = Math.floor((semis - plan.rootKey) / plan.scale.periodSemis);
  let best = octave * size;
  let distance = Infinity;
  for (let i = (octave - 1) * size; i <= (octave + 2) * size; i += 1) {
    const d = Math.abs(toneAt(plan, i).semis - semis);
    if (d < distance - 1e-9) {
      distance = d;
      best = i;
    }
  }
  return best;
}

type PitchContext = Readonly<{ scale: ScaleModel; rootKey: number }>;

/** Keys of a chord near `anchor`, for chords made of scale indices. */
function degreeChordKeys(
  plan: PitchContext,
  chord: PlannedChord,
  low: number,
  high: number,
): Pitch[] {
  const base = indexNear(plan, (low + high) / 2 - 4);
  const size = plan.scale.tones.length;
  const out: Pitch[] = [];
  const start = base - mod(base, size);
  for (const degree of chord.pcs) {
    let index = start + degree;
    let pitch = toneAt(plan, index);
    while (pitch.semis < low && index < start + 4 * size)
      pitch = toneAt(plan, (index += size));
    while (pitch.semis > high && index > start - 4 * size)
      pitch = toneAt(plan, (index -= size));
    out.push(pitch);
  }
  return out.sort((a, b) => a.semis - b.semis);
}

// ---------------------------------------------------------------------------
// Tracks

function instrumentFields(voice: RoleVoice): Partial<TrackInput> & {
  instrument: string;
} {
  if (voice.instrument === "drums")
    return { instrument: "drums", ...(voice.kit ? { kit: voice.kit } : {}) };
  const meaning = resolveInstrumentWord(voice.instrument);
  let fields: Partial<TrackInput> & { instrument: string };
  if (
    meaning &&
    (meaning.field === "modal" ||
      meaning.field === "wind" ||
      meaning.field === "sing")
  )
    fields = instrumentPatchForWord(voice.instrument) as typeof fields;
  else if (meaning?.field === "string" && meaning.preset)
    fields = {
      instrument: meaning.instrument,
      string: { preset: meaning.preset } as TrackInput["string"],
    };
  else fields = { instrument: meaning?.instrument ?? voice.instrument };
  const rig = voice.rig ?? meaning?.fx;
  if (rig) {
    const fx = applyRigPreset(undefined, rig);
    const reverb = rigReverb(rig);
    if (fx) fields = { ...fields, fx };
    if (reverb)
      fields = { ...fields, reverb: reverb as unknown as TrackInput["reverb"] };
  }
  return fields;
}

function roleFx(
  style: ResolvedStyle,
  roles: readonly RoleName[],
): TrackFx | undefined {
  const out: Record<string, unknown> = {};
  for (const role of roles)
    for (const [effect, preset] of Object.entries(style.mix.fx?.[role] ?? {})) {
      const values = (
        FX_PRESETS as Record<string, Record<string, unknown> | undefined>
      )[effect]?.[preset];
      if (!values)
        throw new StyleError(
          `${style.id}: unknown fx preset ${effect} ${preset}`,
        );
      out[effect] = { ...values };
    }
  return Object.keys(out).length ? (out as TrackFx) : undefined;
}

function planTracks(style: ResolvedStyle, random: Random): RoleTrack[] {
  const roles = style.texture.roles;
  const present = (role: RoleName) => {
    const texture = roles[role];
    if (!texture || texture.voices.length === 0) return false;
    // Kit and perc roles need a grid (or the cycle); optional roles join
    // most of the time.
    if (
      (KIT_ROLES as readonly string[]).includes(role) ||
      (PERC_ROLES as readonly string[]).includes(role)
    ) {
      const hasGrid = (style.rhythm.onsets[role]?.length ?? 0) > 0;
      const cycle = role === "perc" && style.meter.cycle !== undefined;
      if (!hasGrid && !cycle) return false;
    }
    return texture.required || random() < 0.75;
  };
  const out: RoleTrack[] = [];
  const kitRoles = KIT_ROLES.filter(present);
  if (kitRoles.length > 0) {
    const voice = pickWeighted(
      roles[kitRoles[0]!]!.voices.map((v) => [v, v.weight] as const),
      random,
    );
    out.push({ trackId: "drums", roles: kitRoles, instrument: "drums", voice });
  }
  for (const role of [...PERC_ROLES, ...PITCHED_ROLES] as RoleName[]) {
    if (!present(role)) continue;
    const voice = pickWeighted(
      roles[role]!.voices.map((v) => [v, v.weight] as const),
      random,
    );
    out.push({
      trackId: role,
      roles: [role],
      instrument: voice.instrument,
      voice,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Form

function planSections(
  style: ResolvedStyle,
  bars: number,
  hypermeter: number,
  tracks: readonly RoleTrack[],
  random: Random,
): PlannedSection[] {
  const plan = [...pickWeighted(style.form.plans, random)];
  const unit = Math.max(1, Math.min(hypermeter, 4));
  const fit = Math.max(1, Math.floor(bars / unit));
  let kinds = plan;
  if (kinds.length > fit) {
    const core = plan.filter((kind) => kind !== "intro" && kind !== "outro");
    kinds = (core.length ? core : plan).slice(0, fit);
  }
  const base = Math.floor(bars / kinds.length);
  const allRoles = tracks.flatMap((track) => track.roles);
  const seen = new Map<string, number>();
  let start = 0;
  return kinds.map((kind, i) => {
    const length = i === kinds.length - 1 ? bars - start : base;
    const count = (seen.get(kind) ?? 0) + 1;
    seen.set(kind, count);
    const mapped = style.form.roleMap?.[kind];
    const section: PlannedSection = {
      kind,
      name: count === 1 ? kind : `${kind} ${count}`,
      startBar: start,
      bars: length,
      energy: clamp(style.form.energy?.[kind] ?? 0.7, 0, 1),
      roles: mapped
        ? allRoles.filter((role) => mapped.includes(role))
        : allRoles,
    };
    start += length;
    return section;
  });
}

// ---------------------------------------------------------------------------
// Generation

type Draft = {
  trackId: string;
  role: RoleName;
  tick: number;
  duration: number;
  key: number;
  cents: number;
  velocity: number;
  articulation?: string;
};

/** Generate a style by id (or an already resolved/blended style). */
export function generateStyle(
  style: StyleId | ResolvedStyle,
  options: StyleOptions = {},
): GeneratedStyle {
  const resolved = typeof style === "string" ? resolveKnown(style) : style;
  const seed = Math.trunc(clamp(options.seed ?? 1, 0, STYLE_LIMITS.maxSeed));
  const bars = Math.trunc(
    clamp(
      options.bars ?? STYLE_LIMITS.defaultBars,
      STYLE_LIMITS.minBars,
      STYLE_LIMITS.maxBars,
    ),
  );
  if (
    !Number.isFinite(options.seed ?? 1) ||
    !Number.isFinite(options.bars ?? 8)
  )
    throw new StyleError("seed and bars must be numbers");
  const root = (seed ^ hashText(resolved.id) ^ (resolved.seedSalt >>> 0)) >>> 0;
  const rng = (salt: string) => stream(root, salt);
  const plan = planStyle(resolved, seed, bars, options, rng);
  const drafts = playRoles(plan, rng);
  return assemble(plan, drafts);
}

function resolveKnown(id: StyleId): ResolvedStyle {
  if (!STYLE_TREE.has(id)) throw new StyleError(`unknown style "${id}"`);
  return resolveStyle(id);
}

function planStyle(
  style: ResolvedStyle,
  seed: number,
  bars: number,
  options: StyleOptions,
  rng: (salt: string) => Random,
): Omit<StylePlan, "noteRoles" | "phrases"> & { phrases: never[] } {
  const random = rng("plan");
  const signature = pickWeighted(style.meter.signatures, random);
  const [beatsPerBar, beatUnit] = parseSignature(signature);
  const grouping = style.meter.grouping?.length
    ? pickWeighted(style.meter.grouping, random)
    : undefined;
  const hypermeter = Math.max(
    1,
    Math.round(pickWeighted(style.meter.hypermeter, random)),
  );
  const [low, high] = style.tempo.bpm;
  const typical = clamp(style.tempo.typical, low, high);
  // A triangular draw around the typical tempo.
  const u = random();
  const lean = typical - low;
  const span = high - low;
  const drawn =
    span <= 0
      ? low
      : u < lean / span
        ? low + Math.sqrt(u * span * lean)
        : high - Math.sqrt((1 - u) * span * (high - typical));
  const bpm = Math.round(
    clamp(
      options.bpm !== undefined ? clamp(options.bpm, low, high) : drawn,
      20,
      300,
    ),
  );
  const subdivision = Math.max(1, Math.round(style.groove.subdivision));
  const stepsPerBar = stepsPerBarOf(beatsPerBar, beatUnit, subdivision);
  const barTicks = (beatsPerBar * TPB * 4) / beatUnit;
  const stepTicks = barTicks / stepsPerBar;
  const swing = between(style.groove.swingRatio, random);
  const tonic =
    options.tonic !== undefined
      ? mod(Math.round(options.tonic), 12)
      : style.pitch.tonic === "any"
        ? Math.floor(random() * 12)
        : mod(Math.round(pickWeighted(style.pitch.tonic, random)), 12);
  const scaleName = pickWeighted(style.pitch.scales, random);
  const {
    model: scale,
    tuning: tuningName,
    keyScale,
  } = scaleFor(style, scaleName);
  const rootKey = 60 + tonic;
  const tuning: Tuning | undefined = tuningName
    ? { ...tuningName, root: rootKey }
    : undefined;
  const twelve = scale.period === 12;
  const keyText = twelve ? `${noteNameOf(tonic)} ${keyScale}` : null;
  const parsed = keyText ? parseKey(keyText) : undefined;
  if (keyText && !parsed)
    throw new StyleError(`${style.id}: key "${keyText}" does not parse`);
  const key: Key | undefined = parsed
    ? { tonic: parsed.tonic, mode: modeOfScale(keyScale) }
    : undefined;
  const { chords, source } = planChords(
    style,
    scale,
    key,
    bars,
    hypermeter,
    rng("harmony"),
  );
  const tracks = planTracks(style, rng("texture"));
  const sections = planSections(style, bars, hypermeter, tracks, rng("form"));
  return {
    style,
    seed,
    bars,
    signature,
    beatsPerBar,
    beatUnit,
    grouping,
    hypermeter,
    bpm,
    subdivision,
    stepsPerBar,
    stepTicks,
    barTicks,
    swing,
    tonic,
    rootKey,
    scale,
    scaleName: keyScale,
    keyText: parsed ? keyName(parsed) : null,
    tuning,
    harmonyModel:
      style.harmony.model === "functional" && !twelve
        ? "modal"
        : style.harmony.model,
    harmonySource: source,
    chords,
    sections,
    tracks,
    phrases: [],
    humanizeTicks: (style.groove.humanize.timingMs * bpm * TPB) / 60_000,
  };
}

const SHARPS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
const noteNameOf = (pc: number) => SHARPS[mod(pc, 12)]!;

/** Tick of grid step `step` (may exceed one bar) with swing applied. */
export function swungStepTick(
  plan: Pick<StylePlan, "stepTicks" | "subdivision" | "swing">,
  step: number,
): number {
  const base = step * plan.stepTicks;
  if (plan.subdivision % 2 !== 0 || plan.swing === 1 || step % 2 === 0)
    return base;
  const shift = ((2 * plan.swing) / (1 + plan.swing) - 1) * plan.stepTicks;
  return base + shift;
}

/** Ticks a role's onsets may sit off the swung grid (microtiming, bias, humanise). */
export function onsetTolerance(plan: StylePlan, role: RoleName): number {
  const micro = Math.max(
    0,
    ...(plan.style.groove.microtiming ?? [0]).map(Math.abs),
  );
  const bias = Math.abs(plan.style.groove.roleOffset?.[role] ?? 0);
  return (micro + bias) * plan.stepTicks + 3 * plan.humanizeTicks + 1;
}

function sectionAt(
  plan: StylePlan | ReturnType<typeof planStyle>,
  bar: number,
): PlannedSection {
  const sections = plan.sections;
  for (let i = sections.length - 1; i >= 0; i -= 1)
    if (bar >= sections[i]!.startBar) return sections[i]!;
  return sections[0]!;
}

function chordAt(
  chords: readonly PlannedChord[],
  bar: number,
): PlannedChord | undefined {
  for (let i = chords.length - 1; i >= 0; i -= 1)
    if (bar + 1e-9 >= chords[i]!.bar) return chords[i];
  return chords[0];
}

type Plan = ReturnType<typeof planStyle>;

function playRoles(plan: Plan, rng: (salt: string) => Random): Draft[] {
  const drafts: Draft[] = [];
  const style = plan.style;
  const kitOnsets = new Map<RoleName, Set<number>>();
  const groove = style.groove;
  const velocityAt = (step: number, energy: number, role: RoleName) => {
    const sub = plan.subdivision;
    const shape = groove.velocity ?? [1];
    const inBeat = step % sub;
    let accent =
      shape[Math.round((inBeat * shape.length) / sub) % shape.length] ?? 1;
    if (plan.grouping) {
      const stepsPerUnit = plan.stepsPerBar / plan.beatsPerBar;
      let at = 0;
      const starts = new Set<number>();
      for (const group of plan.grouping) {
        starts.add(Math.round(at * stepsPerUnit));
        at += group;
      }
      const barStep = step % plan.stepsPerBar;
      accent = starts.has(barStep)
        ? Math.max(accent, 1)
        : Math.min(accent, 0.8);
    }
    const [lo, hi] = style.expression.dynamics;
    const base = lo + (hi - lo) * energy;
    const roleGain = role === "kick" || role === "snare" ? 1 : 0.92;
    return clamp(base * accent * roleGain, 0.05, 1);
  };
  const timeOf = (role: RoleName, step: number, random: Random) => {
    const sub = plan.subdivision;
    const micro = groove.microtiming ?? [];
    const offset =
      (micro.length
        ? micro[Math.round(((step % sub) * micro.length) / sub) % micro.length]!
        : 0) + (groove.roleOffset?.[role] ?? 0);
    return (
      swungStepTick(plan, step) +
      offset * plan.stepTicks +
      gauss(random) * plan.humanizeTicks
    );
  };
  const humanVelocity = (velocity: number, random: Random) =>
    clamp(velocity * (1 + gauss(random) * groove.humanize.velocity), 0.05, 1);

  // --- Kit and percussion grids
  const totalSteps = plan.bars * plan.stepsPerBar;
  const gridOf = (role: RoleName) => {
    const grid = style.rhythm.onsets[role];
    return grid && grid.length
      ? stretchGrid(grid, plan.stepsPerBar)
      : undefined;
  };
  const decide = (role: RoleName, random: Random) => {
    const grid = gridOf(role);
    const hits = new Set<number>();
    if (!grid) return hits;
    for (let step = 0; step < totalSteps; step += 1) {
      const p = grid[step % plan.stepsPerBar]!;
      const section = sectionAt(plan, Math.floor(step / plan.stepsPerBar));
      if (!section.roles.includes(role)) continue;
      const scaled = p >= 1 ? 1 : p * (0.5 + section.energy * 0.7);
      if (p >= 1 || random() < scaled) hits.add(step);
    }
    return hits;
  };
  const kitTrack = plan.tracks.find((track) => track.trackId === "drums");
  const rhythmRandom = rng("rhythm");
  for (const role of [...KIT_ROLES, ...PERC_ROLES] as RoleName[]) {
    const owner = plan.tracks.find((track) => track.roles.includes(role));
    if (!owner) continue;
    if (role === "perc" && style.meter.cycle) continue;
    kitOnsets.set(role, decide(role, rhythmRandom));
  }
  // Fills: toms and snare in the last beat of each `every`-bar phrase.
  const fills = style.rhythm.fills;
  if (fills && kitTrack) {
    const random = rng("fills");
    const beatSteps = Math.max(
      1,
      Math.round(plan.stepsPerBar / plan.beatsPerBar),
    );
    for (let bar = fills.every - 1; bar < plan.bars; bar += fills.every) {
      const density = between(fills.density, random);
      const start = (bar + 1) * plan.stepsPerBar - beatSteps;
      for (let step = start; step < (bar + 1) * plan.stepsPerBar; step += 1) {
        if (random() >= density) continue;
        const role: RoleName =
          kitTrack.roles.includes("tom") && random() < 0.5 ? "tom" : "snare";
        if (!kitTrack.roles.includes(role)) continue;
        kitOnsets.get(role)?.add(step);
      }
    }
  }
  // Locks: b with a (b only where a), b avoid a.
  for (const lock of style.rhythm.locks ?? []) {
    const a = kitOnsets.get(lock.a);
    const b = kitOnsets.get(lock.b);
    if (!a || !b) continue;
    for (const step of [...b])
      if ((lock.kind === "with") !== a.has(step)) b.delete(step);
  }
  const timingRandom = rng("timing");
  for (const [role, steps] of kitOnsets) {
    const owner = plan.tracks.find((track) => track.roles.includes(role))!;
    const onKit = owner.instrument === "drums";
    for (const step of [...steps].sort((x, y) => x - y)) {
      const bar = Math.floor(step / plan.stepsPerBar);
      const section = sectionAt(plan, bar);
      const key = onKit
        ? (KIT_PITCH[role] ?? PERC_ON_KIT[role] ?? KIT_PITCH.rim!)
        : role === "bell"
          ? plan.rootKey + 12
          : plan.rootKey;
      drafts.push({
        trackId: owner.trackId,
        role,
        tick: timeOf(role, step, timingRandom),
        duration: Math.max(30, plan.stepTicks * 0.9),
        key,
        cents: 0,
        velocity: humanVelocity(
          velocityAt(step, section.energy, role),
          timingRandom,
        ),
      });
    }
  }
  // Cycle (tala, iqa', gongan) on the perc track: one stroke per pulse.
  const cycle = style.meter.cycle;
  const percTrack = plan.tracks.find((track) => track.roles.includes("perc"));
  if (cycle && percTrack)
    drafts.push(...playCycle(plan, cycle, percTrack, timingRandom));

  // --- Pitched roles
  const has = (role: RoleName) =>
    plan.tracks.some((track) => track.roles.includes(role));
  const kick = kitOnsets.get("kick") ?? new Set<number>();
  if (has("chords")) drafts.push(...playChords(plan, "chords", rng("chords")));
  if (has("pad")) drafts.push(...playSustain(plan, "pad"));
  if (has("drone")) drafts.push(...playDrone(plan));
  if (has("arp")) drafts.push(...playArp(plan, rng("arp")));
  if (has("bass"))
    drafts.push(...playBass(plan, kick, rng("bass"), timeOf, velocityAt));
  const lead = has("lead")
    ? playMelody(plan, "lead", rng("melody"))
    : { drafts: [], phrases: [] };
  drafts.push(...lead.drafts);
  if (has("counter"))
    drafts.push(...playMelody(plan, "counter", rng("counter")).drafts);
  (plan as { phrases: unknown }).phrases = lead.phrases;
  // Articulations per role.
  const articulationRandom = rng("articulation");
  for (const draft of drafts) {
    const weights = style.expression.articulation?.[draft.role];
    if (weights?.length)
      draft.articulation = pickWeighted(weights, articulationRandom);
  }
  return drafts;
}

function playCycle(
  plan: Plan,
  cycle: CycleSpec,
  track: RoleTrack,
  random: Random,
): Draft[] {
  const out: Draft[] = [];
  const pulse = (TPB * 4) / plan.beatUnit;
  const total = Math.floor((plan.bars * plan.barTicks) / pulse);
  const low = new Set(cycle.low ?? LOW_STROKES);
  const stress = new Set(cycle.stress);
  const release = new Set(cycle.release ?? []);
  const onKit = track.instrument === "drums";
  for (let i = 0; i < total; i += 1) {
    const at = i % cycle.beats;
    const stroke = cycle.strokes[at]!;
    if (stroke === ".") continue;
    const section = sectionAt(plan, Math.floor((i * pulse) / plan.barTicks));
    if (!section.roles.includes("perc")) continue;
    const isLow = low.has(stroke) && !release.has(at + 1);
    const accent = stress.has(at + 1) ? 1 : release.has(at + 1) ? 0.6 : 0.8;
    const [lo, hi] = plan.style.expression.dynamics;
    out.push({
      trackId: track.trackId,
      role: "perc",
      tick: i * pulse + gauss(random) * plan.humanizeTicks,
      duration: Math.max(30, pulse * 0.9),
      key: onKit
        ? isLow
          ? KIT_PITCH.tom!
          : KIT_PITCH.rim!
        : isLow
          ? plan.rootKey - 12
          : plan.rootKey,
      cents: 0,
      velocity: clamp((lo + (hi - lo) * section.energy) * accent, 0.05, 1),
    });
  }
  return out;
}

function chordPitches(
  plan: Plan,
  chord: PlannedChord,
  role: RoleName,
  previous: number[],
): Pitch[] {
  const voicing = plan.style.harmony.voicing;
  const [low, high] = voicing.range.map(Math.round) as [number, number];
  const maxNotes = Math.max(1, Math.round(voicing.notes[1]));
  if (chord.degrees)
    return degreeChordKeys(plan, chord, low, high).slice(0, maxNotes);
  return [];
  void role;
  void previous;
}

function voiceFunctional(
  plan: Plan,
  chord: PlannedChord,
  type: string,
  previous: number[] | undefined,
): number[] {
  const voicing = plan.style.harmony.voicing;
  const low = Math.round(voicing.range[0]);
  const high = Math.round(voicing.range[1]);
  const maxNotes = Math.max(1, Math.round(voicing.notes[1]));
  const minNotes = Math.max(
    1,
    Math.min(maxNotes, Math.round(voicing.notes[0])),
  );
  const root = chord.rootPc;
  const anchor = Math.round((low + high) / 2) - 5;
  const rootKey = anchor + mod(root - anchor, 12);
  let notes: number[];
  if (type === "power") notes = [rootKey, rootKey + 7, rootKey + 12];
  else if (type === "shell") {
    const third = chord.pcs.find((pc) => [3, 4].includes(mod(pc - root, 12)));
    const seventh = chord.pcs.find((pc) =>
      [10, 11].includes(mod(pc - root, 12)),
    );
    notes = [rootKey];
    if (third !== undefined) notes.push(rootKey + mod(third - root, 12));
    if (seventh !== undefined) notes.push(rootKey + mod(seventh - root, 12));
    else notes.push(rootKey + 7);
  } else if (type === "quartal") {
    // Stack fourths from the root and keep the chord's own tones nearest.
    notes = [rootKey, rootKey + 5, rootKey + 10, rootKey + 15].map((key) => {
      const pc = mod(key, 12);
      if (chord.pcs.includes(pc)) return key;
      let best = key;
      for (const d of [1, -1, 2, -2])
        if (chord.pcs.includes(mod(key + d, 12))) {
          best = key + d;
          break;
        }
      return best;
    });
  } else {
    const spread: Spread = type === "open" || type === "wide" ? type : "close";
    const parsed = { root, quality: "maj" as const, extensions: [] };
    void parsed;
    notes = voiceChord(chordFromPcs(chord), {
      anchor,
      spread,
      low,
      high,
      ...(previous?.length ? { previous } : {}),
    });
  }
  notes = [...new Set(notes)].sort((a, b) => a - b);
  while (notes.length > maxNotes) notes.splice(1, 1); // drop the inner voices first
  while (notes.length < minNotes)
    notes.push(
      notes[notes.length - minNotes] !== undefined
        ? notes[0]! + 12
        : notes[0]! + 12,
    );
  // Fold into range by octaves.
  return [
    ...new Set(
      notes.map((key) => {
        let k = key;
        while (k < low) k += 12;
        while (k > high) k -= 12;
        return k;
      }),
    ),
  ].sort((a, b) => a - b);
}

function chordFromPcs(chord: PlannedChord) {
  // Rebuild a chord-engine chord from its numeral, which the plan keeps.
  return (
    parsedChords.get(chord) ?? {
      root: chord.rootPc,
      quality: "maj" as const,
      extensions: [],
    }
  );
}
const parsedChords = new WeakMap<
  PlannedChord,
  ReturnType<typeof parseRoman> & object
>();

function playChords(plan: Plan, role: RoleName, random: Random): Draft[] {
  const out: Draft[] = [];
  const style = plan.style;
  const grid = style.rhythm.onsets[role];
  const type = pickWeighted(style.harmony.voicing.types, random);
  const strum = style.harmony.voicing.strokes?.length ? 14 : 0;
  let previous: number[] | undefined;
  const key = plan.keyText ? parseKey(plan.keyText) : undefined;
  for (const chord of plan.chords) {
    if (!chord.degrees && key) {
      const parsed = parseRoman(
        { tonic: key.tonic, mode: modeOfScale(plan.scaleName) },
        chord.numeral,
      );
      if (parsed) parsedChords.set(chord, parsed);
    }
    const pitches: Pitch[] = chord.degrees
      ? chordPitches(plan, chord, role, [])
      : voiceFunctional(plan, chord, type, previous).map((k) => ({
          key: k,
          cents: 0,
          semis: k,
        }));
    previous = pitches.map((p) => p.key);
    const startTick = chord.bar * plan.barTicks;
    const endTick = (chord.bar + chord.bars) * plan.barTicks;
    const hits: number[] = [];
    if (grid && grid.length) {
      const stretched = stretchGrid(grid, plan.stepsPerBar);
      const firstStep = Math.round(startTick / plan.stepTicks);
      const lastStep = Math.round(endTick / plan.stepTicks);
      for (let step = firstStep; step < lastStep; step += 1) {
        const p = stretched[step % plan.stepsPerBar]!;
        if (p >= 1 || (p > 0 && random() < p))
          hits.push(swungStepTick(plan, step));
      }
    }
    if (hits.length === 0) hits.push(startTick);
    hits.forEach((tick, i) => {
      const section = sectionAt(plan, Math.floor(tick / plan.barTicks));
      if (!section.roles.includes(role)) return;
      const next = hits[i + 1] ?? endTick;
      const [lo, hi] = style.expression.dynamics;
      const velocity = clamp((lo + (hi - lo) * section.energy) * 0.85, 0.05, 1);
      pitches.forEach((pitch, v) => {
        out.push({
          trackId: role,
          role,
          tick: tick + v * strum,
          duration: Math.max(30, (next - tick) * 0.92 - v * strum),
          key: pitch.key,
          cents: pitch.cents,
          velocity,
        });
      });
    });
  }
  return out;
}

function playSustain(plan: Plan, role: RoleName): Draft[] {
  const out: Draft[] = [];
  const key = plan.keyText ? parseKey(plan.keyText) : undefined;
  let previous: number[] | undefined;
  for (const chord of plan.chords) {
    const section = sectionAt(plan, Math.floor(chord.bar));
    if (!section.roles.includes(role)) continue;
    if (!chord.degrees && key && !parsedChords.has(chord)) {
      const parsed = parseRoman(
        { tonic: key.tonic, mode: modeOfScale(plan.scaleName) },
        chord.numeral,
      );
      if (parsed) parsedChords.set(chord, parsed);
    }
    const pitches: Pitch[] = chord.degrees
      ? chordPitches(plan, chord, role, [])
      : voiceFunctional(plan, chord, "open", previous).map((k) => ({
          key: k,
          cents: 0,
          semis: k,
        }));
    previous = pitches.map((p) => p.key);
    const [lo, hi] = plan.style.expression.dynamics;
    for (const pitch of pitches)
      out.push({
        trackId: role,
        role,
        tick: chord.bar * plan.barTicks,
        duration: Math.max(30, chord.bars * plan.barTicks - 20),
        key: pitch.key,
        cents: pitch.cents,
        velocity: clamp((lo + (hi - lo) * section.energy) * 0.6, 0.05, 1),
      });
  }
  return out;
}

function playDrone(plan: Plan): Draft[] {
  const out: Draft[] = [];
  const tonic = toneAt(plan, indexNear(plan, plan.rootKey - 12));
  const fifthIndex = nearestDegree(plan.scale, 7);
  const fifth = toneAt(plan, indexNear(plan, plan.rootKey - 12) + fifthIndex);
  const [lo, hi] = plan.style.expression.dynamics;
  for (let bar = 0; bar < plan.bars; bar += 1) {
    const section = sectionAt(plan, bar);
    if (!section.roles.includes("drone")) continue;
    for (const pitch of fifthIndex === 0 ? [tonic] : [tonic, fifth])
      out.push({
        trackId: "drone",
        role: "drone",
        tick: bar * plan.barTicks,
        duration: plan.barTicks - 10,
        key: pitch.key,
        cents: pitch.cents,
        velocity: clamp((lo + (hi - lo) * section.energy) * 0.5, 0.05, 1),
      });
  }
  return out;
}

function chordIndices(plan: Plan, chord: PlannedChord): number[] {
  if (chord.degrees) return [...chord.pcs];
  // Functional chord tones that are scale tones, as scale indices; the
  // rest are chromatic and played by pitch below.
  const out: number[] = [];
  plan.scale.tones.forEach((tone, i) => {
    if (tone.cents === 0 && chord.pcs.includes(mod(plan.tonic + tone.key, 12)))
      out.push(i);
  });
  return out;
}

function playArp(plan: Plan, random: Random): Draft[] {
  const out: Draft[] = [];
  const grid = plan.style.rhythm.onsets.arp;
  const stretched = grid?.length
    ? stretchGrid(grid, plan.stepsPerBar)
    : undefined;
  const [lo, hi] = plan.style.expression.dynamics;
  const totalSteps = plan.bars * plan.stepsPerBar;
  let n = 0;
  for (let step = 0; step < totalSteps; step += 1) {
    const p = stretched
      ? stretched[step % plan.stepsPerBar]!
      : step % 2 === 0
        ? 1
        : 0;
    if (!(p >= 1 || (p > 0 && random() < p))) continue;
    const bar = step / plan.stepsPerBar;
    const section = sectionAt(plan, Math.floor(bar));
    if (!section.roles.includes("arp")) continue;
    const chord = chordAt(plan.chords, bar);
    const pitches = chord
      ? arpPitches(plan, chord)
      : [toneAt(plan, indexNear(plan, plan.rootKey + 12))];
    if (pitches.length === 0) continue;
    const pitch = pitches[n % pitches.length]!;
    n += 1;
    out.push({
      trackId: "arp",
      role: "arp",
      tick: swungStepTick(plan, step),
      duration: Math.max(30, plan.stepTicks * 0.8),
      key: pitch.key,
      cents: pitch.cents,
      velocity: clamp((lo + (hi - lo) * section.energy) * 0.7, 0.05, 1),
    });
  }
  return out;
}

function arpPitches(plan: Plan, chord: PlannedChord): Pitch[] {
  const base = plan.rootKey + 12;
  if (!chord.degrees) {
    const root = base + mod(chord.rootPc - base, 12);
    return chord.pcs
      .map((pc) => root + mod(pc - chord.rootPc, 12))
      .map((k) => ({ key: k, cents: 0, semis: k }));
  }
  const start = indexNear(plan, base);
  const size = plan.scale.tones.length;
  return chord.pcs.map((degree) =>
    toneAt(plan, start - mod(start, size) + degree),
  );
}

function playBass(
  plan: Plan,
  kick: ReadonlySet<number>,
  random: Random,
  timeOf: (role: RoleName, step: number, random: Random) => number,
  velocityAt: (step: number, energy: number, role: RoleName) => number,
): Draft[] {
  const style = plan.style;
  const behaviour = pickWeighted(style.bass.behaviour, random);
  if (behaviour === "none") return [];
  const [low, high] = style.bass.range.map(Math.round) as [number, number];
  const totalSteps = plan.bars * plan.stepsPerBar;
  const beatSteps = Math.max(
    1,
    Math.round(plan.stepsPerBar / plan.beatsPerBar),
  );
  // Onsets: walking plays every beat; others follow the grid.
  let steps: number[] = [];
  if (behaviour === "walking") {
    for (let step = 0; step < totalSteps; step += beatSteps) steps.push(step);
  } else {
    const grid = style.bass.onsets?.length
      ? stretchGrid(style.bass.onsets, plan.stepsPerBar)
      : stretchGrid([1, 0, 0, 0, 1, 0, 0, 0], plan.stepsPerBar);
    for (let step = 0; step < totalSteps; step += 1) {
      const p = grid[step % plan.stepsPerBar]!;
      if (p >= 1 || (p > 0 && random() < p)) steps.push(step);
    }
    // Kick lock: drop off-kick onsets (latest first) until the share holds.
    const lock = style.bass.kickLock;
    if (lock && kick.size > 0) {
      const onKick = () =>
        steps.filter((s) => kick.has(s)).length / Math.max(1, steps.length);
      const off = steps.filter(
        (s) => !kick.has(s) && s % plan.stepsPerBar !== 0,
      );
      while (onKick() < lock && off.length > 0) {
        const drop = off.pop()!;
        steps = steps.filter((s) => s !== drop);
      }
    }
  }
  const bassIndex = (semis: number) => {
    let index = indexNear(plan, semis);
    while (toneAt(plan, index).semis < low) index += plan.scale.tones.length;
    while (toneAt(plan, index).semis > high) index -= plan.scale.tones.length;
    return index;
  };
  const rootPitch = (chord: PlannedChord | undefined): Pitch => {
    if (!chord) return toneAt(plan, bassIndex(low + 7));
    if (chord.degrees) {
      const index = bassIndex(low + 7);
      const size = plan.scale.tones.length;
      return toneAt(plan, index - mod(index, size) + chord.rootPc);
    }
    let key = low + mod(chord.rootPc - low, 12);
    if (key > high) key -= 12;
    return { key, cents: 0, semis: key };
  };
  const fold = (pitch: Pitch): Pitch => {
    if (pitch.semis > high + 0.01)
      return {
        key: pitch.key - plan.scale.period,
        cents: pitch.cents,
        semis: pitch.semis - plan.scale.periodSemis,
      };
    if (pitch.semis < low - 0.01)
      return {
        key: pitch.key + plan.scale.period,
        cents: pitch.cents,
        semis: pitch.semis + plan.scale.periodSemis,
      };
    return pitch;
  };
  const fifthOf = (root: Pitch, chord: PlannedChord | undefined): Pitch => {
    if (chord && !chord.degrees) {
      const fifth = chord.pcs.find((pc) =>
        [6, 7, 8].includes(mod(pc - chord.rootPc, 12)),
      );
      const k =
        root.key + (fifth === undefined ? 7 : mod(fifth - chord.rootPc, 12));
      return fold({ key: k, cents: 0, semis: k });
    }
    return fold(
      toneAt(plan, indexNear(plan, root.semis) + nearestDegree(plan.scale, 7)),
    );
  };
  // Ostinato: one seeded bar of scale offsets, repeated.
  const ostinato = Array.from({ length: plan.stepsPerBar }, () =>
    pickWeighted(
      [
        [0, 4],
        [2, 1],
        [4, 2],
        [-1, 1],
        [7, 1],
      ],
      random,
    ),
  );
  const out: Draft[] = [];
  const timing = random;
  steps.forEach((step, i) => {
    const bar = step / plan.stepsPerBar;
    const section = sectionAt(plan, Math.floor(bar));
    if (!section.roles.includes("bass")) return;
    const chord = chordAt(plan.chords, bar);
    const root = rootPitch(chord);
    let pitch: Pitch = root;
    const beat = Math.floor((step % plan.stepsPerBar) / beatSteps);
    switch (behaviour) {
      case "root-fifth":
        pitch = beat % 2 === 0 ? root : fifthOf(root, chord);
        break;
      case "octave":
        pitch =
          i % 2 === 0
            ? root
            : fold({
                key: root.key + plan.scale.period,
                cents: root.cents,
                semis: root.semis + plan.scale.periodSemis,
              });
        break;
      case "pedal":
        pitch = toneAt(
          plan,
          bassIndex(low + 7) - mod(bassIndex(low + 7), plan.scale.tones.length),
        );
        break;
      case "arpeggio": {
        const tones =
          chord && !chord.degrees
            ? chord.pcs.map((pc) =>
                fold({
                  key: root.key + mod(pc - chord.rootPc, 12),
                  cents: 0,
                  semis: root.semis + mod(pc - chord.rootPc, 12),
                }),
              )
            : chordIndices(plan, chord ?? plan.chords[0]!).map((d) =>
                fold(
                  toneAt(
                    plan,
                    indexNear(plan, root.semis) -
                      mod(
                        indexNear(plan, root.semis),
                        plan.scale.tones.length,
                      ) +
                      d,
                  ),
                ),
              );
        pitch = tones.length ? tones[i % tones.length]! : root;
        break;
      }
      case "ostinato": {
        const offset = ostinato[step % plan.stepsPerBar]!;
        pitch = fold(toneAt(plan, indexNear(plan, root.semis) + offset));
        break;
      }
      case "walking": {
        const nextChord = chordAt(
          plan.chords,
          (step + beatSteps) / plan.stepsPerBar,
        );
        const nextIsNew =
          nextChord !== chord || (step + beatSteps) % plan.stepsPerBar === 0;
        const walk = style.bass.walk ?? {
          chordToneOnOne: 0.9,
          chromaticApproach: 0.3,
        };
        if (step % plan.stepsPerBar === 0) {
          pitch = random() < walk.chordToneOnOne ? root : fifthOf(root, chord);
        } else if (
          nextIsNew &&
          random() < walk.chromaticApproach &&
          !nextChord?.degrees &&
          plan.scale.period === 12
        ) {
          const target = rootPitch(nextChord);
          const k = target.key + (random() < 0.5 ? -1 : 1);
          pitch = fold({ key: k, cents: 0, semis: k });
        } else {
          const prev = out[out.length - 1];
          const from = prev
            ? indexNear(plan, prev.key + prev.cents / 100)
            : indexNear(plan, root.semis);
          const target = indexNear(plan, rootPitch(nextChord).semis);
          const dir =
            target > from ? 1 : target < from ? -1 : random() < 0.5 ? 1 : -1;
          pitch = fold(toneAt(plan, from + dir));
        }
        break;
      }
      default:
        pitch = root;
    }
    const next = steps[i + 1] ?? Math.min(totalSteps, step + plan.stepsPerBar);
    out.push({
      trackId: "bass",
      role: "bass",
      tick: timeOf("bass", step, timing),
      duration: Math.max(30, (next - step) * plan.stepTicks * 0.9),
      key: pitch.key,
      cents: pitch.cents,
      velocity: clamp(velocityAt(step, section.energy, "bass"), 0.05, 1),
    });
  });
  return out;
}

const CONTOUR_TARGETS: Readonly<Record<string, (x: number) => number>> =
  Object.freeze({
    arch: (x: number) => Math.sin(Math.PI * x),
    ascending: (x: number) => x,
    descending: (x: number) => 1 - x,
    wave: (x: number) => 0.5 + 0.5 * Math.sin(2 * Math.PI * x),
    flat: () => 0.5,
    terraced: (x: number) => Math.floor(x * 3) / 2,
  });

function playMelody(
  plan: Plan,
  role: "lead" | "counter",
  random: Random,
): { drafts: Draft[]; phrases: { startBar: number; bars: number }[] } {
  const style = plan.style;
  const melody = style.melody;
  const out: Draft[] = [];
  const phrases: { startBar: number; bars: number }[] = [];
  const shift = role === "counter" ? -12 : 0;
  const low = Math.round(melody.range[0]) + shift;
  const high = Math.round(melody.range[1]) + shift;
  const size = plan.scale.tones.length;
  const raga = style.pitch.raga;
  const maqam = style.pitch.maqam;
  const beatSteps = Math.max(
    1,
    Math.round(plan.stepsPerBar / plan.beatsPerBar),
  );
  const inRange = (index: number) => {
    const s = toneAt(plan, index).semis;
    return s >= low - 1e-9 && s <= high + 1e-9;
  };
  const allowed = (index: number, direction: number) => {
    if (!raga) return true;
    const semis = Math.round(plan.scale.tones[mod(index, size)]!.semis);
    const set = direction >= 0 ? raga.aroha : raga.avaroha;
    return set.some((d) => mod(d, 12) === mod(semis, 12));
  };
  let previousRhythm: number[] | undefined;
  let bar = 0;
  let sayrAt = 0;
  let current = indexNear(plan, clamp(plan.rootKey + 7 + shift, low, high));
  while (bar < plan.bars) {
    const length = Math.min(
      plan.bars - bar,
      Math.max(1, Math.round(pickWeighted(melody.phraseBars, random))),
    );
    phrases.push({ startBar: bar, bars: length });
    const contour =
      CONTOUR_TARGETS[pickWeighted(melody.contour, random)] ??
      CONTOUR_TARGETS.arch!;
    const ambitus = clamp(between(melody.ambitus, random), 2, high - low);
    // Phrase register: a maqam's sayr walks the phrase centres up.
    let centre = (low + high) / 2;
    if (maqam?.sayr.length) {
      const degree = maqam.sayr[sayrAt % maqam.sayr.length]!;
      sayrAt += 1;
      centre = clamp(
        toneAt(plan, indexNear(plan, plan.rootKey + shift) + degree).semis,
        low + ambitus / 2,
        high - ambitus / 2,
      );
    }
    const floor = clamp(centre - ambitus / 2, low, high);
    const ceil = clamp(centre + ambitus / 2, low, high);
    // Rhythm: onsets per beat from the density range, or the last phrase's.
    let rhythm: number[];
    const totalSteps = length * plan.stepsPerBar;
    if (
      previousRhythm &&
      previousRhythm.length &&
      random() < melody.repetition &&
      previousRhythm[previousRhythm.length - 1]! < totalSteps
    )
      rhythm = previousRhythm;
    else {
      rhythm = [];
      for (let beat = 0; beat * beatSteps < totalSteps; beat += 1) {
        const count = clamp(
          Math.round(between(melody.density, random)),
          0,
          beatSteps,
        );
        const options = [...Array(beatSteps).keys()];
        const picks: number[] = [];
        for (let c = 0; c < count; c += 1) {
          const at =
            c === 0 && random() < 0.7
              ? 0
              : Math.floor(random() * options.length);
          picks.push(options.splice(Math.min(at, options.length - 1), 1)[0]!);
        }
        for (const p of picks.sort((a, b) => a - b)) {
          const step = beat * beatSteps + p;
          if (step < totalSteps) rhythm.push(step);
        }
      }
      if (rhythm.length === 0) rhythm.push(0);
    }
    previousRhythm = rhythm;
    const finalDegree = mod(
      Math.round(pickWeighted(melody.finals, random)),
      size,
    );
    rhythm.forEach((local, n) => {
      const step = bar * plan.stepsPerBar + local;
      const x = rhythm.length > 1 ? n / (rhythm.length - 1) : 0;
      const target = floor + (ceil - floor) * clamp(contour(x), 0, 1);
      const last = n === rhythm.length - 1;
      let next: number;
      if (last) {
        // Phrase final: the card's final degree nearest the line.
        const near = indexNear(plan, toneAt(plan, current).semis);
        next = near - mod(near, size) + finalDegree;
        if (toneAt(plan, next).semis - toneAt(plan, current).semis > 6)
          next -= size;
        if (toneAt(plan, current).semis - toneAt(plan, next).semis > 6)
          next += size;
        while (!inRange(next) && toneAt(plan, next).semis < low) next += size;
        while (!inRange(next) && toneAt(plan, next).semis > high) next -= size;
      } else if (n === 0 && raga?.pakad?.length && random() < 0.35) {
        next = indexNear(plan, plan.rootKey + shift + raga.pakad[0]![0]!);
      } else {
        // Weighted by interval size, pulled toward the contour target.
        const from = toneAt(plan, current).semis;
        let best = current;
        let bestScore = -Infinity;
        const candidates: [number, number][] = [];
        for (let d = -size; d <= size; d += 1) {
          const index = current + d;
          if (!inRange(index)) continue;
          const semis = toneAt(plan, index).semis;
          const interval = Math.round(semis - from);
          if (Math.abs(interval) > 12) continue;
          if (!allowed(index, semis - from)) continue;
          let weight = melody.intervals[interval + 12] ?? 0;
          const pull = Math.abs(semis - target);
          weight *= Math.exp(-pull / 4);
          if (
            raga &&
            mod(Math.round(plan.scale.tones[mod(index, size)]!.semis), 12) ===
              mod(raga.vadi, 12)
          )
            weight *= 1.6;
          candidates.push([index, weight]);
        }
        if (candidates.length) best = pickWeighted(candidates, random);
        else {
          for (let d = -size; d <= size; d += 1)
            if (inRange(current + d) && -Math.abs(d) > bestScore) {
              bestScore = -Math.abs(d);
              best = current + d;
            }
        }
        next = best;
        // Strong beats lean on chord tones under functional harmony.
        const strong = local % beatSteps === 0;
        if (
          strong &&
          plan.harmonyModel === "functional" &&
          random() < melody.chordToneRate
        ) {
          const chord = chordAt(plan.chords, step / plan.stepsPerBar);
          if (chord) {
            const tones = chordIndices(plan, chord);
            let snap = next;
            let distance = Infinity;
            for (let d = -3; d <= 3; d += 1) {
              const index = next + d;
              if (
                tones.includes(mod(index, size)) &&
                inRange(index) &&
                Math.abs(d) < distance
              ) {
                distance = Math.abs(d);
                snap = index;
              }
            }
            next = snap;
          }
        }
      }
      if (!inRange(next)) next = current;
      // No leap past an octave inside a phrase (finals, snaps and pakad
      // entries fold back toward the line).
      if (n > 0) {
        const from = toneAt(plan, current).semis;
        while (toneAt(plan, next).semis - from > 12 && inRange(next - size))
          next -= size;
        while (from - toneAt(plan, next).semis > 12 && inRange(next + size))
          next += size;
        if (Math.abs(toneAt(plan, next).semis - from) > 12) next = current;
      }
      current = next;
      const pitch = toneAt(plan, current);
      const end = rhythm[n + 1] ?? totalSteps;
      const section = sectionAt(plan, Math.floor(step / plan.stepsPerBar));
      if (!section.roles.includes(role)) return;
      const [lo, hi] = style.expression.dynamics;
      out.push({
        trackId: role,
        role,
        tick: swungStepTick(plan, step),
        duration: Math.max(
          30,
          Math.min((end - local) * plan.stepTicks, plan.barTicks) * 0.9,
        ),
        key: pitch.key,
        cents: pitch.cents,
        velocity: clamp(
          (lo + (hi - lo) * section.energy) *
            (local % beatSteps === 0 ? 1 : 0.85) *
            (role === "counter" ? 0.8 : 1),
          0.05,
          1,
        ),
      });
    });
    bar += length;
  }
  return { drafts: out, phrases };
}

// ---------------------------------------------------------------------------
// Assembly

const dbToVolume = (db: number) => clamp(0.8 * 10 ** (db / 20), 0, 1);

function assemble(plan: Plan, drafts: Draft[]): GeneratedStyle {
  const style = plan.style;
  const loopTicks = plan.bars * plan.barTicks;
  // Notes start inside the song and are integral ticks.
  const cleaned = drafts
    .map((draft) => ({
      ...draft,
      tick: clamp(Math.round(draft.tick), 0, loopTicks - 1),
      duration: Math.max(1, Math.round(draft.duration)),
    }))
    .filter(
      (draft) =>
        draft.key >= 0 && draft.key <= 127 && Number.isFinite(draft.velocity),
    );
  cleaned.sort(
    (a, b) =>
      a.tick - b.tick || a.trackId.localeCompare(b.trackId) || a.key - b.key,
  );
  // Over the note cap: thin the quietest percussion first.
  if (cleaned.length > SCORE_LIMITS.maxNotes) {
    const order = cleaned
      .map((draft, i) => ({
        i,
        weight:
          (KIT_ROLES as readonly string[]).includes(draft.role) ||
          (PERC_ROLES as readonly string[]).includes(draft.role)
            ? draft.velocity
            : 2 + draft.velocity,
      }))
      .sort((a, b) => a.weight - b.weight || a.i - b.i);
    const drop = new Set(
      order
        .slice(0, cleaned.length - SCORE_LIMITS.maxNotes)
        .map((entry) => entry.i),
    );
    for (let i = cleaned.length - 1; i >= 0; i -= 1)
      if (drop.has(i)) cleaned.splice(i, 1);
  }
  const noteRoles = new Map<string, RoleName>();
  const counters = new Map<string, number>();
  const notes: NoteInput[] = cleaned.map((draft) => {
    const n = (counters.get(draft.trackId) ?? 0) + 1;
    counters.set(draft.trackId, n);
    const id = `${draft.trackId}-${n}`;
    noteRoles.set(id, draft.role);
    return {
      id,
      trackId: draft.trackId,
      startTick: draft.tick,
      durationTicks: Math.min(draft.duration, loopTicks - draft.tick),
      pitch: draft.key,
      velocity: Math.round(draft.velocity * 1000) / 1000,
      ...(draft.cents ? { cents: draft.cents } : {}),
      ...(draft.articulation
        ? { articulation: draft.articulation as NoteInput["articulation"] }
        : {}),
    };
  });
  const space = clamp(style.mix.space, 0, 1);
  const tracks: TrackInput[] = plan.tracks.map((track) => {
    const fields = instrumentFields(track.voice);
    const fx = roleFx(style, track.roles);
    const level = Math.max(
      ...track.roles.map((role) => style.mix.levels?.[role] ?? -6),
    );
    const pan = clamp(style.mix.pan?.[track.roles[0]!] ?? 0, -1, 1);
    const pitched = (PITCHED_ROLES as readonly string[]).includes(
      track.roles[0]!,
    );
    return {
      ...fields,
      id: track.trackId,
      name: track.trackId,
      volume: Math.round(dbToVolume(level) * 1000) / 1000,
      pan,
      ...(fx ? { fx: { ...(fields.fx ?? {}), ...fx } } : {}),
      ...(!fields.reverb && pitched && space > 0.02
        ? {
            reverb: {
              mix: Math.round(space * 0.45 * 1000) / 1000,
              size: Math.round((0.3 + space * 0.6) * 1000) / 1000,
            },
          }
        : {}),
    } as TrackInput;
  });
  const sections: Section[] = plan.sections.map((section) => {
    const mute = plan.tracks
      .filter(
        (track) => !track.roles.some((role) => section.roles.includes(role)),
      )
      .map((track) => track.trackId);
    return {
      name: section.name,
      startBar: section.startBar,
      bars: section.bars,
      ...(mute.length ? { mute } : {}),
    };
  });
  const time =
    plan.beatUnit === 4
      ? undefined
      : {
          meter: [
            { bar: 0, beatsPerBar: plan.beatsPerBar, beatUnit: plan.beatUnit },
          ],
        };
  const data: TrackScoreData = {
    tempoBpm: plan.bpm,
    beatsPerBar: plan.beatsPerBar,
    bars: plan.bars,
    key: plan.keyText,
    ...(time ? { time } : {}),
    ...(plan.tuning ? { tuning: plan.tuning } : {}),
    tracks,
    notes,
    ...(sections.length > 1 ? { sections } : {}),
  };
  const operations: ScoreOperation[] = [
    { type: "setTempo", tempoBpm: plan.bpm },
    { type: "setBars", bars: plan.bars },
    ...(time
      ? [{ type: "setTime", time } as ScoreOperation]
      : [
          { type: "setMeter", beatsPerBar: plan.beatsPerBar } as ScoreOperation,
        ]),
    { type: "setKey", key: plan.keyText },
    { type: "setTuning", tuning: plan.tuning ?? null },
    ...tracks.map((track) => ({ type: "addTrack", track }) as ScoreOperation),
    ...notes.map((note) => ({ type: "addNote", note }) as ScoreOperation),
    ...(sections.length > 1
      ? [{ type: "setSections", sections, form: [] } as ScoreOperation]
      : []),
  ];
  const blend = (
    style as ResolvedStyle & {
      blend?: { a: string; b: string; weight: number };
    }
  ).blend;
  const provenance: StyleProvenance = {
    id: blend ? blend.a : style.id,
    seed: plan.seed,
    bars: plan.bars,
    ...(blend ? { blend: { id: blend.b, weight: blend.weight } } : {}),
  };
  const full: StylePlan = { ...plan, noteRoles };
  return { plan: full, data, operations, provenance };
}

/** The generated song as a score. */
export function styleScore(generated: GeneratedStyle): TrackScore {
  return createScore(generated.data);
}

/** Every role name, for surfaces that list them. */
export const STYLE_ROLE_NAMES: readonly RoleName[] = ROLE_NAMES;
