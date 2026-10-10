/**
 * The `sing` prompt command (0.7): the built-in singing voice on the
 * focused track (core/sing.ts). The menu and the `set_sing` / `set_vowels`
 * agent tools build the same edits.
 *
 *   sing                               show the track's preset and overrides
 *   sing <preset>                      aah ooh choir oohchoir chorale airy
 *                                      glass lament soprano basso drone
 *                                      khoomei sygyt kargyraa
 *   sing <preset> <param> <value>…     a preset with overrides
 *   sing <param> <value> [<param> <value>…]   vowel o, voices 6, voice bass
 *   sing drone <D3|50>                 throat mode on the current preset
 *   sing harmonics 6-12                the overtone range a throat track picks
 *   sing <param> off                   back to the preset's value
 *   sing vowels a e i o>u …            the track's notes' vowels, in order, cycled
 *   sing reset | sing off | sing list
 *   note vowel <a|a>u|off> [target]    the sung vowel of some notes
 *
 * Any edit makes the track a sing track (`instrument "sing"` plus a `sing`
 * field). One `updateTrack` revision and one undo step per command.
 */
import { isGuideInstrument } from "../../core/clips.ts";
import { parseKey } from "../../core/chords.ts";
import { FxValidationError } from "../../core/params.ts";
import {
  DEFAULT_SING_PRESET,
  isSingPreset,
  normalizeSing,
  normalizeVowel,
  parseDrone,
  resolveSing,
  SING_INSTRUMENT,
  SING_PARAMS,
  SING_PRESETS,
  SING_PRESET_NAMES,
  singNoteName,
  singParamName,
  singSummary,
  type SingPreset,
  type TrackSing,
} from "../../core/sing.ts";
import {
  addNote,
  ScoreValidationError,
  updateTrack,
  type TrackScore,
} from "../../core/score.ts";
import { nearest } from "./nearest.ts";
import {
  describeTarget,
  parseNoteTarget,
  patchNotes,
  targetNotes,
  type NoteTarget,
} from "./expression.ts";
import { parseParamValue } from "./fx.ts";

export type SingValue = number | string | readonly [number, number] | null;

export type SingCommand =
  | { type: "sing-show" }
  | { type: "sing-list" }
  | { type: "sing-reset" }
  | { type: "sing-off" }
  | { type: "sing-usage"; message: string }
  | { type: "sing-vowels"; vowels: readonly string[] }
  | { type: "note-vowel"; vowel: string | null; target: NoteTarget }
  | {
      type: "sing-set";
      /** A preset applied before the values (`sing khoomei drone D3`). */
      preset?: SingPreset;
      /** `null` returns a parameter to the preset's value. */
      values: Readonly<Record<string, SingValue>>;
    };

export const SING_USAGE =
  "sing <preset> | sing <param> <value> | sing drone <D3> | sing vowels a e i … | sing reset | sing off | sing list";

const PARAM_NAMES = [...Object.keys(SING_PARAMS), "harmonics"];

function rangeOf(name: string): string {
  if (name === "vowel") return "vowel is a e i o u or a morph like a>o";
  if (name === "drone")
    return "drone is a note name C2..G4 (D3) or MIDI 36..67";
  if (name === "harmonics") return "harmonics is a range like 6-12 (2..24)";
  const spec = SING_PARAMS[name]!;
  if (spec.kind === "number") return `${name} is ${spec.min}..${spec.max}`;
  if (spec.kind === "enum") return `${name} is one of ${spec.values.join(" ")}`;
  return `${name} is on or off`;
}

function presetFor(word: string): SingPreset | undefined {
  const lower = word.toLowerCase();
  return isSingPreset(lower) ? lower : undefined;
}

/** One value word for `name`; undefined when it is out of range. */
function valueOf(name: string, word: string): SingValue | undefined {
  try {
    if (name === "vowel") return normalizeVowel(word);
    if (name === "drone") return parseDrone(word);
  } catch {
    return undefined;
  }
  if (name === "harmonics") {
    const match = /^(\d+)[-,:](\d+)$/.exec(word);
    if (!match) return undefined;
    const lo = Number(match[1]);
    const hi = Number(match[2]);
    return lo >= 2 && hi <= 24 && lo < hi
      ? (Object.freeze([lo, hi]) as readonly [number, number])
      : undefined;
  }
  const spec = SING_PARAMS[name];
  if (!spec) return undefined;
  const value = parseParamValue(spec, word);
  return typeof value === "boolean" ? undefined : value;
}

function parseNoteVowel(words: readonly string[]): SingCommand | undefined {
  const [first, ...rest] = words;
  if (!first)
    return { type: "sing-usage", message: "note vowel <a|a>u|off> [target]" };
  let vowel: string | null;
  if (first === "off" || first === "unset") vowel = null;
  else {
    try {
      vowel = normalizeVowel(first);
    } catch {
      return {
        type: "sing-usage",
        message: "note vowel is a e i o u or a morph like a>u",
      };
    }
  }
  const target = parseNoteTarget(rest);
  if (!target)
    return {
      type: "sing-usage",
      message: "note vowel <v> [all|last|bar <n>|bars <a>-<b>|<ids>]",
    };
  return { type: "note-vowel", vowel, target };
}

export function parseSingCommand(prompt: string): SingCommand | undefined {
  const words = prompt.trim().replace(/^\//, "").toLowerCase().split(/\s+/);
  if (words[0] === "note" && words[1] === "vowel") {
    if (prompt.length > 1_024) return undefined;
    return parseNoteVowel(words.slice(2));
  }
  if (words[0] === "presets" && words[1] === "sing" && words.length === 2)
    return { type: "sing-list" };
  if (words[0] !== "sing") return undefined;
  if (words.length === 1) return { type: "sing-show" };
  if (prompt.length > 1_024) return undefined;
  const rest = words.slice(1);
  if (rest.length === 1 && rest[0] === "reset") return { type: "sing-reset" };
  if (rest.length === 1 && rest[0] === "off") return { type: "sing-off" };
  if (rest.length === 1 && (rest[0] === "list" || rest[0] === "presets"))
    return { type: "sing-list" };
  if (rest[0] === "vowels") {
    const vowels: string[] = [];
    for (const word of rest.slice(1)) {
      try {
        vowels.push(normalizeVowel(word));
      } catch {
        return {
          type: "sing-usage",
          message: `sing vowels · ${word.slice(0, 16)} is not a e i o u or a morph like a>o`,
        };
      }
    }
    return vowels.length > 0
      ? { type: "sing-vowels", vowels }
      : { type: "sing-usage", message: "sing vowels a e i o u (cycled)" };
  }
  if (rest[0] === "preset") {
    const preset = rest.length === 2 ? presetFor(rest[1]!) : undefined;
    return preset
      ? { type: "sing-set", preset, values: {} }
      : {
          type: "sing-usage",
          message: `sing preset is one of ${SING_PRESET_NAMES.join(" ")}`,
        };
  }
  if (rest.length === 1) {
    const preset = presetFor(rest[0]!);
    if (preset) return { type: "sing-set", preset, values: {} };
    const near = nearest(rest[0]!.slice(0, 24), SING_PRESET_NAMES);
    return {
      type: "sing-usage",
      message: near ? `sing · did you mean ${near}?` : SING_USAGE,
    };
  }
  // `harmonics 6 12` is the range `harmonics 6-12`.
  for (let index = 0; index + 2 < rest.length; index += 1)
    if (
      rest[index] === "harmonics" &&
      /^\d+$/.test(rest[index + 1]!) &&
      /^\d+$/.test(rest[index + 2]!)
    )
      rest.splice(index + 1, 2, `${rest[index + 1]}-${rest[index + 2]}`);
  // `sing <preset> <param> <value>…`: the preset, then its overrides.
  const lead = rest.length % 2 === 1 ? presetFor(rest[0]!) : undefined;
  if (lead) rest.shift();
  if (rest.length % 2 !== 0) return { type: "sing-usage", message: SING_USAGE };
  const values: Record<string, SingValue> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = singParamName(rest[index]!);
    if (!name) {
      const word = rest[index]!.slice(0, 24);
      const near = nearest(word, PARAM_NAMES);
      return {
        type: "sing-usage",
        message: `sing has no parameter ${word}${near ? ` · did you mean ${near}?` : ""} · vowel voices bright breath vib drone …`,
      };
    }
    const word = rest[index + 1]!;
    if (word === "off" || word === "unset") {
      values[name] = null;
      continue;
    }
    const value = valueOf(name, word);
    if (value === undefined)
      return { type: "sing-usage", message: rangeOf(name) };
    values[name] = value;
  }
  return lead
    ? { type: "sing-set", preset: lead, values }
    : { type: "sing-set", values };
}

/** `preset khoomei · drone D3 · voices 4`, overrides in canonical order. */
export function describeSing(sing: TrackSing | undefined): string {
  if (!sing) return "not a sing track";
  const preset = sing.preset ?? DEFAULT_SING_PRESET;
  const overrides = Object.entries(sing)
    .filter(([key]) => key !== "preset")
    .map(([key, value]) =>
      key === "drone"
        ? `drone ${singNoteName(value as number)}`
        : Array.isArray(value)
          ? `${key} ${value.join("-")}`
          : `${key} ${value}`,
    );
  return [`preset ${preset}`, ...overrides].join(" · ");
}

/** One line per preset, for `sing list` and the agent brief. */
export function singListLines(): string[] {
  return SING_PRESET_NAMES.map(
    (name) => `${name.padEnd(9)} ${SING_PRESETS[name].doc}`,
  );
}

export type SingResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

/**
 * The sing field a command leaves on a track (pure; the agent tool shares
 * it). A preset switch keeps the overrides; `reset` keeps the preset.
 */
export function nextSing(
  current: TrackSing | undefined,
  command: Extract<SingCommand, { type: "sing-reset" | "sing-set" }>,
): TrackSing {
  if (command.type === "sing-reset")
    return normalizeSing(current?.preset ? { preset: current.preset } : {})!;
  const base: Record<string, unknown> = { ...current };
  if (command.preset) base.preset = command.preset;
  for (const [key, value] of Object.entries(command.values)) {
    if (value === null) delete base[key];
    else base[key] = value;
  }
  return normalizeSing(base)!;
}

/**
 * Set the vowels of a track's notes in time order, cycling `vowels`
 * (`sing vowels a e i o u`). Pure; the `set_vowels` tool shares it.
 * `noteIds` limits it to those notes (still in time order).
 */
export function assignVowels(
  score: TrackScore,
  trackId: string,
  vowels: readonly string[],
  noteIds?: readonly string[],
): { next: TrackScore; count: number } {
  const ids = noteIds ? new Set(noteIds) : undefined;
  const notes = score.notes
    .filter((note) => (ids ? ids.has(note.id) : note.trackId === trackId))
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  if (notes.length === 0 || vowels.length === 0)
    return { next: score, count: 0 };
  const canonical = vowels.map((vowel) => normalizeVowel(vowel));
  let next = score;
  // Group notes by vowel so one patchNotes call per vowel builds the score.
  const byVowel = new Map<string, Set<string>>();
  notes.forEach((note, index) => {
    const vowel = canonical[index % canonical.length]!;
    const set = byVowel.get(vowel) ?? new Set<string>();
    set.add(note.id);
    byVowel.set(vowel, set);
  });
  for (const [vowel, set] of byVowel) next = patchNotes(next, set, { vowel });
  return { next, count: notes.length };
}

/** The throat demo line in semitones over the drone (formant.md 4.4). */
export const THROAT_DEMO_STEPS = Object.freeze([
  12, 14, 16, 19, 21, 19, 16, 14,
]);

/**
 * Write the throat demo melody on an empty throat track: one note per
 * two beats, one octave above the drone that plays, inside the song.
 * Undefined when the voice has no drone. Pure.
 */
export function throatDemo(
  score: TrackScore,
  trackId: string,
  sing: TrackSing,
): { next: TrackScore; count: number } | undefined {
  const drone = resolveSing(sing, keyRootOf(score)).drone;
  if (drone === undefined) return undefined;
  const step = score.ticksPerBeat * 2;
  const total = score.ticksPerBeat * score.beatsPerBar * score.bars;
  const ids = new Set(score.notes.map((note) => note.id));
  let next = score;
  let count = 0;
  for (const [index, offset] of THROAT_DEMO_STEPS.entries()) {
    const startTick = index * step;
    if (startTick + step > total) break;
    let id = `${trackId}-demo-${index + 1}`;
    for (let n = 2; ids.has(id); n += 1)
      id = `${trackId}-demo-${index + 1}-${n}`;
    ids.add(id);
    next = addNote(next, {
      id,
      trackId,
      startTick,
      durationTicks: step,
      pitch: Math.min(127, drone + offset),
      velocity: 0.8,
    });
    count += 1;
  }
  return count > 0 ? { next, count } : undefined;
}

const keyRootOf = (score: TrackScore): number | undefined =>
  parseKey(score.key)?.tonic;

/** The instrument a track plays after `sing off` (the default track voice). */
export const SING_OFF_INSTRUMENT = "sine";

export function applySingCommand(
  score: TrackScore,
  trackId: string,
  command: SingCommand,
): SingResult {
  if (command.type === "sing-usage")
    return {
      ok: false,
      message: command.message.startsWith("note")
        ? command.message
        : `sing · ${command.message}`,
    };
  if (command.type === "sing-list")
    return {
      ok: true,
      message: `sing presets · ${SING_PRESET_NAMES.join(" ")}`,
    };
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  if (command.type === "note-vowel") {
    const notes = targetNotes(score, trackId, command.target);
    if (notes.length === 0)
      return {
        ok: false,
        message: `note vowel · no notes in ${describeTarget(command.target)}`,
      };
    const next = patchNotes(score, new Set(notes.map((note) => note.id)), {
      vowel: command.vowel,
    });
    return {
      ok: true,
      message: `note vowel · ${command.vowel ?? "off"} · ${notes.length} note${notes.length === 1 ? "" : "s"}`,
      next,
      kind: "score.notes.vowel",
      payload: {
        trackId,
        vowel: command.vowel,
        noteIds: notes.map((note) => note.id),
      },
    };
  }
  if (command.type === "sing-vowels") {
    const { next, count } = assignVowels(score, trackId, command.vowels);
    if (count === 0)
      return { ok: false, message: `sing vowels · ${trackId} has no notes` };
    return {
      ok: true,
      message: `sing vowels · ${command.vowels.join(" ")} over ${count} note${count === 1 ? "" : "s"}`,
      next,
      kind: "score.notes.vowel",
      payload: { trackId, vowels: command.vowels },
    };
  }
  const current = track.instrument === SING_INSTRUMENT ? track.sing : undefined;
  if (command.type === "sing-show")
    return {
      ok: true,
      message: current
        ? `sing · ${singSummary(current, keyRootOf(score))} · ${describeSing(current)}`
        : track.instrument === SING_INSTRUMENT
          ? `sing · off · sing <preset> turns it on (${SING_PRESET_NAMES.join(" ")})`
          : isGuideInstrument(track.instrument)
            ? `${trackId} sings with the vocal guide · try sing choir`
            : `sing · ${trackId} plays ${track.instrument} · sing <preset> to switch (${SING_PRESET_NAMES.join(" ")})`,
    };
  if (track.sampler || track.instrument === "kit")
    return {
      ok: false,
      message: `sing · ${trackId} is a ${track.sampler ? "sampler" : "drum"} track`,
    };
  if (command.type === "sing-off") {
    if (!current) return { ok: true, message: "sing · already off" };
    // Off is a plain sine, never instrument "sing" without its field: the
    // word `sing` reads back as the default voice, so a field-less sing
    // track would sound again after a save and reload.
    const next = updateTrack(score, trackId, {
      instrument: SING_OFF_INSTRUMENT,
      sing: null,
    });
    return {
      ok: true,
      message: `sing · off (${SING_OFF_INSTRUMENT}) · sing ${current.preset ?? DEFAULT_SING_PRESET} turns it back on`,
      next,
      kind: "score.sing",
      payload: { trackId, instrument: SING_OFF_INSTRUMENT, sing: null },
    };
  }
  let sing: TrackSing;
  let next: TrackScore;
  try {
    sing = nextSing(current, command);
    next = updateTrack(score, trackId, { instrument: SING_INSTRUMENT, sing });
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof FxValidationError
    )
      return { ok: false, message: `sing · ${error.message}` };
    throw error;
  }
  // A throat style needs a run of notes to steer the drone's overtones:
  // on an empty track, write a short demo line so one step is audible.
  const demo =
    command.type === "sing-set" &&
    command.preset !== undefined &&
    !score.notes.some((note) => note.trackId === trackId)
      ? throatDemo(next, trackId, sing)
      : undefined;
  if (demo) next = demo.next;
  return {
    ok: true,
    message: `sing · ${singSummary(sing, keyRootOf(next))}${demo ? ` · ${demo.count} demo notes (^z removes them; clear before writing your own)` : ""}`,
    next,
    kind: "score.sing",
    payload: { trackId, instrument: SING_INSTRUMENT, sing },
  };
}
