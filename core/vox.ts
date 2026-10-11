/**
 * Machine vox (0.9, lane V0): the per-note and per-track voice fields, their
 * validators, the lint over a track's lyrics and the compact inspect form
 * that `/vox show` and the `inspect_vox` agent tool print. Import-light,
 * like `core/vocoder.ts`: the score, the prompt, the agent and the printer
 * share it. The built-in formant engine that sings these fields is lane V1
 * (`src/audio/sing/`).
 *
 * Lyric text stays on `Note.lyric` (one syllable; a trailing `-` means the
 * word continues on the next syllable note, `_` holds). `Note.vox` carries
 * what the text cannot: phonemes, breaths, timing feel and per-note params.
 */
import { isRecord } from "./params.ts";

/**
 * dawg's phone set: ARPAbet without stress digits, plus `ax` (schwa), `q`
 * (glottal stop) and `dx` (flap). Append-only.
 */
export const VOX_PHONES: readonly string[] = Object.freeze([
  "iy", "ih", "eh", "ae", "aa", "ah", "ao", "uh", "uw", "er", "ax",
  "ey", "ay", "aw", "oy", "ow",
  "w", "y", "r", "l", "m", "n", "ng",
  "s", "z", "sh", "zh", "f", "v", "th", "dh", "hh",
  "p", "b", "t", "d", "k", "g", "ch", "jh", "q", "dx",
]); // prettier-ignore

const PHONE_SET = new Set(VOX_PHONES);

/** Vox engines (append-only). Only `formant` is built in. */
export const VOX_ENGINES = Object.freeze([
  "formant",
  "espeak-ng",
  "kokoro",
  "piper",
  "openutau",
  "say",
] as const);
export type VoxEngine = (typeof VOX_ENGINES)[number];

/** How a speech engine is fitted to the notes (lane V3). */
export const VOX_FITS = Object.freeze(["psola", "world", "none"] as const);
export type VoxFit = (typeof VOX_FITS)[number];

export const VOX_LIMITS = Object.freeze({
  maxPhones: 12,
  maxParams: 8,
  maxVoiceLength: 64,
  maxDynPoints: 16,
});

/** Breath length that a `,` in lyric text writes when the note has none. */
export const DEFAULT_BREATH = 0.2;

/** How one note is voiced on a vox track. Keys print in this order. */
export type NoteVox = Readonly<{
  /** Phonemes replacing letter-to-sound for this syllable (at most 12). */
  ph?: readonly string[];
  /** Language override for letter-to-sound (BCP-47, `en-us`). */
  lang?: string;
  /** Onset consonants: a share of the note 0..0.9, or `{ s }` seconds. */
  cons?: number | Readonly<{ s: number }>;
  /** Seconds the onset consonants start before the note, 0..0.25. */
  lead?: number;
  /** Timing offset of the syllable in seconds, -0.25..0.25. */
  shift?: number;
  /** A breath before this note, its length in seconds 0.05..1. */
  breath?: number;
  /** Loudness curve over the note; `v` multiplies velocity. */
  dyn?: readonly Readonly<{ at: number; v: number }>[];
  /** Per-note engine params, at most 8. */
  p?: Readonly<Record<string, number>>;
}>;

export const NOTE_VOX_KEYS = Object.freeze([
  "ph",
  "lang",
  "cons",
  "lead",
  "shift",
  "breath",
  "dyn",
  "p",
] as const);

/** A track's voice: which engine sings its notes, and with what voice. */
export type TrackVox = Readonly<{
  engine: VoxEngine;
  /** Engine voice id (`formant:robot`, `kokoro:af_heart`), ≤ 64 chars. */
  voice: string;
  /** Default letter-to-sound language (default `en-us`). */
  lang?: string;
  fit?: VoxFit;
  /** Track-level engine params, at most 8. */
  p?: Readonly<Record<string, number>>;
}>;

export const TRACK_VOX_KEYS = Object.freeze([
  "engine",
  "voice",
  "lang",
  "fit",
  "p",
] as const);

export class VoxValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "VoxValidationError";
  }
}

const fail = (message: string): never => {
  throw new VoxValidationError(message);
};

function numberIn(
  value: unknown,
  min: number,
  max: number,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return fail(`${label} must be a number`);
  if (value < min || value > max)
    return fail(`${label} must be ${min}..${max}`);
  return value;
}

const LANG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

function lang(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 16 || !LANG.test(value))
    return fail(`${label} must be a language tag like en-us`);
  return value.toLowerCase();
}

/** Phones from an array or a space-separated string; stress digits drop. */
export function parsePhones(value: unknown, label = "vox ph"): string[] {
  const list =
    typeof value === "string"
      ? value.trim().split(/\s+/).filter(Boolean)
      : Array.isArray(value)
        ? value
        : fail(`${label} must be phones like "hh eh l"`);
  if (list.length === 0) return fail(`${label} needs at least one phone`);
  if (list.length > VOX_LIMITS.maxPhones)
    return fail(`${label} takes at most ${VOX_LIMITS.maxPhones} phones`);
  return list.map((raw) => {
    if (typeof raw !== "string") return fail(`${label} phones are strings`);
    const phone = raw.toLowerCase().replace(/[0-2]$/, "");
    if (!PHONE_SET.has(phone))
      return fail(
        `${label} "${raw.slice(0, 8)}" is not a phone (ARPAbet: hh eh l ow …)`,
      );
    return phone;
  });
}

function params(value: unknown, label: string): Record<string, number> {
  if (!isRecord(value)) return fail(`${label} must be an object of numbers`);
  const keys = Object.keys(value).sort();
  if (keys.length > VOX_LIMITS.maxParams)
    return fail(`${label} takes at most ${VOX_LIMITS.maxParams} params`);
  const out: Record<string, number> = {};
  for (const key of keys) {
    if (!/^[a-z][a-z0-9]{0,15}$/i.test(key))
      return fail(`${label} key "${key.slice(0, 16)}" is not a param name`);
    out[key] = numberIn(value[key], -1000, 1000, `${label}.${key}`);
  }
  return out;
}

/**
 * Validates `Note.vox`: unknown keys throw, keys come out in NOTE_VOX_KEYS
 * order, null, absent and `{}` mean none.
 */
export function normalizeNoteVox(
  input: unknown,
  label = "vox",
): NoteVox | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input)) return fail(`${label} must be an object`);
  for (const key of Object.keys(input))
    if (!(NOTE_VOX_KEYS as readonly string[]).includes(key))
      fail(
        `${label} has no field "${key.slice(0, 16)}" (${NOTE_VOX_KEYS.join(" ")})`,
      );
  const out: Record<string, unknown> = {};
  if (input.ph !== undefined)
    out.ph = Object.freeze(parsePhones(input.ph, `${label} ph`));
  if (input.lang !== undefined) out.lang = lang(input.lang, `${label} lang`);
  if (input.cons !== undefined) {
    const cons = input.cons;
    if (isRecord(cons)) {
      if (Object.keys(cons).some((key) => key !== "s"))
        fail(`${label} cons takes { s } seconds`);
      out.cons = Object.freeze({
        s: numberIn(cons.s, 0, 1, `${label} cons.s`),
      });
    } else out.cons = numberIn(cons, 0, 0.9, `${label} cons`);
  }
  if (input.lead !== undefined)
    out.lead = numberIn(input.lead, 0, 0.25, `${label} lead`);
  if (input.shift !== undefined)
    out.shift = numberIn(input.shift, -0.25, 0.25, `${label} shift`);
  if (input.breath !== undefined)
    out.breath = numberIn(input.breath, 0.05, 1, `${label} breath`);
  if (input.dyn !== undefined) {
    if (!Array.isArray(input.dyn) || input.dyn.length === 0)
      fail(`${label} dyn must be a list of { at, v } points`);
    const dyn = input.dyn as unknown[];
    if (dyn.length > VOX_LIMITS.maxDynPoints)
      fail(`${label} dyn takes at most ${VOX_LIMITS.maxDynPoints} points`);
    let last = -1;
    out.dyn = Object.freeze(
      dyn.map((point, index) => {
        if (
          !isRecord(point) ||
          Object.keys(point).some((k) => k !== "at" && k !== "v")
        )
          return fail(`${label} dyn[${index}] must be { at, v }`);
        const at = numberIn(point.at, 0, 1, `${label} dyn[${index}].at`);
        if (at < last) fail(`${label} dyn points must be in time order`);
        last = at;
        return Object.freeze({
          at,
          v: numberIn(point.v, 0, 1, `${label} dyn[${index}].v`),
        });
      }),
    );
  }
  if (input.p !== undefined)
    out.p = Object.freeze(params(input.p, `${label} p`));
  return Object.keys(out).length > 0 ? Object.freeze(out) : undefined;
}

/** Validates `Track.vox`; null and absent mean none. */
export function normalizeTrackVox(
  input: unknown,
  label = "vox",
): TrackVox | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input)) return fail(`${label} must be an object`);
  for (const key of Object.keys(input))
    if (!(TRACK_VOX_KEYS as readonly string[]).includes(key))
      fail(
        `${label} has no field "${key.slice(0, 16)}" (${TRACK_VOX_KEYS.join(" ")})`,
      );
  const engine = input.engine ?? "formant";
  if (!(VOX_ENGINES as readonly unknown[]).includes(engine))
    fail(`${label} engine must be one of ${VOX_ENGINES.join(" ")}`);
  const voice = input.voice ?? `${String(engine)}:default`;
  if (
    typeof voice !== "string" ||
    voice.length === 0 ||
    voice.length > VOX_LIMITS.maxVoiceLength ||
    /\s/.test(voice)
  )
    fail(
      `${label} voice must be 1..${VOX_LIMITS.maxVoiceLength} characters without spaces`,
    );
  const out: Record<string, unknown> = { engine, voice };
  if (input.lang !== undefined) out.lang = lang(input.lang, `${label} lang`);
  if (input.fit !== undefined) {
    if (!(VOX_FITS as readonly unknown[]).includes(input.fit))
      fail(`${label} fit must be one of ${VOX_FITS.join(" ")}`);
    out.fit = input.fit;
  }
  if (input.p !== undefined)
    out.p = Object.freeze(params(input.p, `${label} p`));
  return Object.freeze(out) as TrackVox;
}

/** `vox` with `fields` replaced (`null` drops one); undefined when empty. */
export function patchNoteVox(
  vox: NoteVox | undefined,
  fields: Readonly<Partial<Record<keyof NoteVox, unknown>>>,
): NoteVox | undefined {
  const next: Record<string, unknown> = { ...(vox ?? {}) };
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return normalizeNoteVox(next);
}

// ---------------------------------------------------------------------------
// Phrases, lint and the compact form

type VoxNote = Readonly<{
  id: string;
  trackId: string;
  startTick: number;
  durationTicks: number;
  pitch: number;
  lyric?: string;
  vox?: NoteVox;
}>;

type VoxScore = Readonly<{
  ticksPerBeat: number;
  beatsPerBar: number;
  notes: readonly VoxNote[];
}>;

/** One sung note per onset (the top pitch of a chord), in time order. */
export function sungLine<N extends VoxNote>(
  notes: readonly N[],
  trackId: string,
): N[] {
  const sorted = notes
    .filter((note) => note.trackId === trackId)
    .sort((a, b) => a.startTick - b.startTick || b.pitch - a.pitch);
  return sorted.filter(
    (note, index) =>
      index === 0 || note.startTick !== sorted[index - 1]!.startTick,
  );
}

/**
 * Phrases: runs of sung notes with no gap of at least `restSplit` ticks
 * (default an eighth of a beat).
 */
export function voxPhrases<N extends VoxNote>(
  line: readonly N[],
  restSplit: number,
): N[][] {
  const phrases: N[][] = [];
  let end = -Infinity;
  for (const note of line) {
    if (phrases.length === 0 || note.startTick - end >= restSplit)
      phrases.push([]);
    phrases.at(-1)!.push(note);
    end = Math.max(end, note.startTick + note.durationTicks);
  }
  return phrases;
}

export type VoxFinding = Readonly<{
  rule: "continuation" | "orphan-hold" | "phone" | "timing";
  noteId: string;
  message: string;
}>;

/**
 * The lyric invariants of one track (design 3.4): a `-` syllable needs a
 * later syllable in its phrase, no phrase starts with `_`, and onset timing
 * fits the note. Phones are checked by the validator already.
 */
export function lintVox(score: VoxScore, trackId: string): VoxFinding[] {
  const findings: VoxFinding[] = [];
  const restSplit = Math.max(1, Math.round(score.ticksPerBeat / 8));
  for (const phrase of voxPhrases(sungLine(score.notes, trackId), restSplit)) {
    const first = phrase[0]!;
    if (first.lyric === "_")
      findings.push({
        rule: "orphan-hold",
        noteId: first.id,
        message: `${first.id}: "_" starts a phrase (nothing to hold); it sings the track vowel`,
      });
    phrase.forEach((note, index) => {
      if (note.lyric?.endsWith("-") && note.lyric.length > 1) {
        const next = phrase
          .slice(index + 1)
          .find((later) => later.lyric !== undefined && later.lyric !== "_");
        if (!next)
          findings.push({
            rule: "continuation",
            noteId: note.id,
            message: `${note.id}: "${note.lyric}" continues a word but no syllable follows in its phrase`,
          });
      }
      const cons = note.vox?.cons;
      if (typeof cons === "number" && cons + (note.vox?.lead ? 0.1 : 0) > 0.9)
        findings.push({
          rule: "timing",
          noteId: note.id,
          message: `${note.id}: onset consonants and lead fill the note; clamped at render`,
        });
    });
  }
  return findings;
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pitchName = (pitch: number): string =>
  `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

/** A number with at most three decimals and no trailing zeros. */
const short = (value: number): string =>
  String(Math.round(value * 1000) / 1000);

/** One syllable as the lyric grammar writes it: `hel[hh eh l]-`, `_`. */
export function syllableText(note: Pick<VoxNote, "lyric" | "vox">): string {
  const lyric = note.lyric ?? "~";
  const ph = note.vox?.ph;
  if (!ph || lyric === "~") return lyric;
  const dash = lyric.length > 1 && lyric.endsWith("-");
  const body = dash ? lyric.slice(0, -1) : lyric;
  return `${body}[${ph.join(" ")}]${dash ? "-" : ""}`;
}

/**
 * The compact inspect form (design 3.5): one line per phrase, bar then
 * beat:pitch:syllable, `,` before a breath. `bars` limits it (1-based,
 * inclusive); at most `maxLines` phrase lines.
 */
export function voxCompact(
  score: VoxScore,
  trackId: string,
  options: Readonly<{
    from?: number;
    to?: number;
    maxLines?: number;
    barStartTick?: (bar: number) => number;
  }> = {},
): string[] {
  const barStart =
    options.barStartTick ??
    ((bar: number) => bar * score.beatsPerBar * score.ticksPerBeat);
  const restSplit = Math.max(1, Math.round(score.ticksPerBeat / 8));
  const lo = options.from ? barStart(options.from - 1) : -Infinity;
  const hi = options.to ? barStart(options.to) : Infinity;
  const line = sungLine(score.notes, trackId).filter(
    (note) => note.startTick >= lo && note.startTick < hi,
  );
  const barOf = (tick: number): number => {
    let bar = 0;
    while (barStart(bar + 1) <= tick && bar < 100_000) bar += 1;
    return bar;
  };
  const out: string[] = [];
  const phrases = voxPhrases(line, restSplit);
  for (const phrase of phrases.slice(0, options.maxLines ?? 60)) {
    const bar = barOf(phrase[0]!.startTick);
    const cells = phrase.map((note) => {
      const noteBar = barOf(note.startTick);
      const beat =
        (note.startTick - barStart(noteBar)) / score.ticksPerBeat + 1;
      const at =
        noteBar === bar ? short(beat) : `${noteBar + 1}.${short(beat)}`;
      return `${note.vox?.breath ? ", " : ""}${at} ${pitchName(note.pitch)}:${syllableText(note)}`;
    });
    out.push(`b${bar + 1}`.padEnd(5) + cells.join(" "));
  }
  if (phrases.length > (options.maxLines ?? 60))
    out.push(`… ${phrases.length - (options.maxLines ?? 60)} more phrases`);
  return out;
}

// ---------------------------------------------------------------------------
// Note split and join (the lyric rules of design 3.4)

/**
 * The lyric halves of a note split in two: the first part keeps the lyric
 * and `vox` (minus `breath` moved nowhere and `dyn`, which no longer fits);
 * the second part holds (`_`) and inherits `ph` only when it is one vowel.
 * Splitting never creates a syllable.
 */
export function splitLyric(note: Pick<VoxNote, "lyric" | "vox">): Readonly<{
  first: Pick<VoxNote, "lyric" | "vox">;
  second: Pick<VoxNote, "lyric" | "vox">;
}> {
  const firstVox = note.vox ? patchNoteVox(note.vox, { dyn: null }) : undefined;
  const ph = note.vox?.ph;
  const vowelPh =
    ph && ph.length === 1 && /^(?:[aeiou]|er|ax)/.test(ph[0]!)
      ? Object.freeze({ ph })
      : undefined;
  return {
    first: {
      ...(note.lyric !== undefined ? { lyric: note.lyric } : {}),
      ...(firstVox ? { vox: firstVox } : {}),
    },
    second: {
      ...(note.lyric !== undefined ? { lyric: "_" } : {}),
      ...(vowelPh ? { vox: vowelPh } : {}),
    },
  };
}

/**
 * The lyric of notes joined into the first: the first note's lyric stays;
 * every real syllable of the absorbed notes is dropped and reported (a `_`
 * merges silently). A dropped `hel-` hands its continuation to the result.
 */
export function joinLyric(
  notes: readonly Pick<VoxNote, "lyric" | "vox">[],
): Readonly<{ lyric?: string; vox?: NoteVox; dropped: string[] }> {
  const [head, ...rest] = notes;
  if (!head) return { dropped: [] };
  const dropped = rest
    .map((note) => note.lyric)
    .filter((lyric): lyric is string => lyric !== undefined && lyric !== "_");
  return {
    ...(head.lyric !== undefined ? { lyric: head.lyric } : {}),
    ...(head.vox ? { vox: head.vox } : {}),
    dropped,
  };
}
