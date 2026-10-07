/**
 * Deterministic printer: score → `song.ts` + `tracks/<slug>/track.ts`.
 *
 * Output is already in prettier's shape (80 columns, double quotes, trailing
 * commas, two-space indent, objects kept expanded) so formatting it again is
 * a no-op, and printing the evaluation of a printed project reproduces the
 * same bytes. Note ids are never printed: `song()` derives them from content.
 */

import { DRUM_VOICES, isDrumInstrument } from "../drums.ts";
import type { RhythmRow } from "../euclid.ts";
import { midiToPitch } from "../pitch.ts";
import { rhythmVoicePitch, rowInSync } from "../rhythm.ts";
import {
  isSamplerInstrument,
  samplerVoiceSlots,
  TrackScore,
  type AutomationPoint,
  type Note,
  type SampleRef,
  type Sampler,
  type Track,
} from "../score.ts";
import { trackSlug } from "../slug.ts";
import { DEFAULT_HIT_LENGTH, DEFAULT_VELOCITY } from "./v1.ts";

const WIDTH = 80;
const INDENT = "  ";

/** One file the printer produces, path relative to the project root. */
export type PrintedFile = Readonly<{ path: string; text: string }>;

/** Everything a project needs for a score: `song.ts` first, then one file per track in score order. */
export type PrintedProject = Readonly<{
  files: readonly PrintedFile[];
  /** Track id → `tracks/<dir>/track.ts`. */
  trackFiles: ReadonlyMap<string, string>;
}>;

/** Directory under `tracks/` for each track, unique in score order. */
export function trackDirectories(
  score: TrackScore,
): ReadonlyMap<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const track of score.tracks) {
    const base = trackSlug(track.name);
    let dir = base;
    for (let n = 2; used.has(dir); n += 1) dir = `${base}-${n}`;
    used.add(dir);
    out.set(track.id, dir);
  }
  return out;
}

/** Prints the whole project. Pure; returns frozen data. */
export function printProject(score: TrackScore): PrintedProject {
  const dirs = trackDirectories(score);
  const trackFiles = new Map<string, string>();
  const files: PrintedFile[] = [
    Object.freeze({ path: "song.ts", text: printSong(score, dirs) }),
  ];
  for (const track of score.tracks) {
    const path = `tracks/${dirs.get(track.id)!}/track.ts`;
    trackFiles.set(track.id, path);
    files.push(Object.freeze({ path, text: printTrack(score, track) }));
  }
  return Object.freeze({ files: Object.freeze(files), trackFiles });
}

const RESERVED = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "let",
  "static",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "await",
  "song",
  "track",
  "note",
  "seq",
  "hit",
  "hits",
  "every",
  "sampler",
  "slices",
  "euclid",
  "euclidRot",
  "euclidLegato",
  "grid",
]);

/** Import identifiers for each track, unique in score order. */
export function trackIdentifiers(
  score: TrackScore,
  dirs: ReadonlyMap<string, string> = trackDirectories(score),
): ReadonlyMap<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const track of score.tracks) {
    let base = dirs.get(track.id)!.replace(/-/g, "_");
    if (!/^[a-z_]/.test(base) || RESERVED.has(base)) base = `track_${base}`;
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = `${base}_${n}`;
    used.add(name);
    out.set(track.id, name);
  }
  return out;
}

/** `song.ts` for a score. */
export function printSong(
  score: TrackScore,
  dirs: ReadonlyMap<string, string> = trackDirectories(score),
): string {
  const ids = trackIdentifiers(score, dirs);
  const lines: string[] = ['import { song } from "dawg";'];
  for (const track of score.tracks)
    lines.push(
      `import ${ids.get(track.id)!} from "./tracks/${dirs.get(track.id)!}/track.ts";`,
    );
  lines.push("");
  const entries: string[] = [
    `tempo: ${num(score.tempoBpm)}`,
    `meter: [${num(score.beatsPerBar)}, 4]`,
    `bars: ${num(score.bars)}`,
  ];
  if (score.key !== null) entries.push(`key: ${str(score.key)}`);
  if (score.ticksPerBeat !== 480)
    entries.push(`ticksPerBeat: ${num(score.ticksPerBeat)}`);
  entries.push(
    `tracks: ${list(
      score.tracks.map((track) => ids.get(track.id)!),
      INDENT,
      "tracks: ".length,
      1,
    )}`,
  );
  lines.push("export default song({");
  for (const entry of entries) lines.push(`${INDENT}${entry},`);
  lines.push("});", "");
  return lines.join("\n");
}

/** `tracks/<slug>/track.ts` for one track of a score. */
export function printTrack(score: TrackScore, track: Track): string {
  // Rows whose lane still matches their expansion print as generators and
  // own their notes; a hand-edited lane prints as plain notes instead.
  const rows = (track.rhythm ?? []).filter((row) =>
    rowInSync(score, track, row),
  );
  const owned = new Set(rows.map((row) => rhythmVoicePitch(track, row.voice)));
  const notes = score.notes.filter(
    (note) => note.trackId === track.id && !owned.has(note.pitch),
  );
  const kit = isDrumInstrument(track.instrument);
  const voiceSlots =
    isSamplerInstrument(track.instrument) && track.sampler
      ? samplerVoiceSlots(track.sampler)
      : undefined;
  // Keyed samplers have no slots: their notes print as named pitches.
  const slots = voiceSlots && voiceSlots.size > 0 ? voiceSlots : undefined;
  const voiceFor = new Map<number, string>();
  if (kit) for (const info of DRUM_VOICES) voiceFor.set(info.pitch, info.voice);
  if (slots) for (const [voice, slot] of slots) voiceFor.set(slot, voice);
  const used = new Set<string>(["track"]);
  const printed = notes.map((note) => {
    const voice = voiceFor.get(note.pitch);
    if (voice !== undefined) {
      used.add("hit");
      return printHit(score, note, voice);
    }
    used.add("note");
    return printNote(score, note, !kit && !slots);
  });
  if (track.sampler) used.add("sampler");

  const entries: string[] = [
    `id: ${str(track.id)}`,
    `name: ${str(track.name)}`,
  ];
  if (track.sampler) {
    entries.push(`instrument: ${printSampler(track.sampler, INDENT)}`);
  } else entries.push(`instrument: ${str(track.instrument)}`);
  if (track.muted) entries.push("muted: true");
  if (track.solo) entries.push("solo: true");
  if (track.volume !== 1) entries.push(`volume: ${num(track.volume)}`);
  if (track.pan !== 0) entries.push(`pan: ${num(track.pan)}`);
  if (track.filter)
    entries.push(
      `filter: ${obj(
        [
          ["cutoff", num(track.filter.cutoff)],
          ["resonance", num(track.filter.resonance)],
        ],
        INDENT,
        "filter: ".length,
        1,
      )}`,
    );
  if (track.delay)
    entries.push(
      `delay: ${obj(
        [
          ["beats", num(track.delay.beats)],
          ["feedback", num(track.delay.feedback)],
          ["mix", num(track.delay.mix)],
        ],
        INDENT,
        "delay: ".length,
        1,
      )}`,
    );
  if (track.reverb)
    entries.push(
      `reverb: ${obj(
        [
          ["mix", num(track.reverb.mix)],
          ["size", num(track.reverb.size)],
        ],
        INDENT,
        "reverb: ".length,
        1,
      )}`,
    );
  const lanes: [string, readonly AutomationPoint[] | undefined][] = [
    ["volume", track.volumeAutomation],
    ["pan", track.panAutomation],
    ["filter", track.filterAutomation],
    ["resonance", track.resonanceAutomation],
    ["delayFeedback", track.delayFeedbackAutomation],
    ["delayMix", track.delayMixAutomation],
  ];
  const automation = lanes.filter(([, points]) => points && points.length > 0);
  if (automation.length > 0) {
    const inner = INDENT + INDENT;
    const body = automation.map(([lane, points]) => {
      const items = points!.map(
        (point) =>
          `[${num(point.tick / score.ticksPerBeat)}, ${num(point.value)}]`,
      );
      // Prettier forces a break on arrays of 2+ arrays that each hold 2+ items.
      return `${inner}${lane}: ${list(items, inner, `${lane}: `.length, 1, items.length > 1)},`;
    });
    entries.push(`automation: {\n${body.join("\n")}\n${INDENT}}`);
  }
  if (rows.length > 0) {
    const inner = INDENT + INDENT;
    const items = rows.map((row) => {
      const call = printRow(row, inner);
      used.add(call.slice(0, call.indexOf("(")));
      return call;
    });
    entries.push(
      `rhythm: ${list(
        items,
        INDENT,
        "rhythm: ".length,
        1,
        items.some((item) => item.includes("\n")),
      )}`,
    );
  }
  if (rows.length === 0 || printed.length > 0)
    entries.push(`notes: ${list(printed, INDENT, "notes: ".length, 1)}`);

  const names = [
    "track",
    "note",
    "seq",
    "hit",
    "hits",
    "every",
    "sampler",
    "euclid",
    "grid",
  ]
    .filter((name) => used.has(name))
    .join(", ");
  const lines = [
    `import { ${names} } from "dawg";`,
    "",
    "export default track({",
  ];
  for (const entry of entries) lines.push(`${INDENT}${entry},`);
  lines.push("});", "");
  return lines.join("\n");
}

function printNote(score: TrackScore, note: Note, named: boolean): string {
  const pitch = named ? str(midiToPitch(note.pitch)) : num(note.pitch);
  const args = [pitch, num(note.startTick / score.ticksPerBeat)];
  const length = note.durationTicks / score.ticksPerBeat;
  if (length !== 1 || note.velocity !== DEFAULT_VELOCITY)
    args.push(num(length));
  if (note.velocity !== DEFAULT_VELOCITY) args.push(num(note.velocity));
  return `note(${args.join(", ")})`;
}

function printHit(score: TrackScore, note: Note, voice: string): string {
  const args = [str(voice), num(note.startTick / score.ticksPerBeat)];
  const length = note.durationTicks / score.ticksPerBeat;
  if (note.velocity !== DEFAULT_VELOCITY || length !== DEFAULT_HIT_LENGTH)
    args.push(num(note.velocity));
  if (length !== DEFAULT_HIT_LENGTH) args.push(num(length));
  return `hit(${args.join(", ")})`;
}

/** `euclid("hat", 7, 16, 2, { velocity: 0.5 })` or `grid("sd", "....x...")`. */
function printRow(row: RhythmRow, indent: string): string {
  const args: string[] = [str(row.voice)];
  const fields: [string, string][] = [];
  if (row.grid !== undefined) args.push(str(row.grid));
  else {
    args.push(num(row.pulses ?? 4), num(row.steps ?? 16));
    if (row.rotate) args.push(num(row.rotate));
  }
  const inner = indent + INDENT;
  for (const key of [
    "division",
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
  ] as const) {
    const value = row[key];
    if (value === undefined) continue;
    if (key === "cycles") {
      const cycles = row.cycles!.map((cycle) =>
        Object.keys(cycle).length === 0
          ? "{}"
          : obj(
              Object.entries(cycle).map(
                ([k, v]) => [k, num(v as number)] as const,
              ),
              inner + INDENT,
              0,
              1,
            ),
      );
      const force =
        cycles.length > 1 &&
        row.cycles!.every((cycle) => Object.keys(cycle).length > 1);
      fields.push([key, list(cycles, inner, "cycles: ".length, 1, force)]);
    } else
      fields.push([
        key,
        typeof value === "string"
          ? str(value)
          : typeof value === "boolean"
            ? String(value)
            : num(value as number),
      ]);
  }
  const name = row.grid !== undefined ? "grid" : "euclid";
  const head = `${name}(${args.join(", ")}`;
  if (fields.length === 0) return `${head})`;
  const inlineObject = `{ ${fields.map(([k, v]) => `${k}: ${v}`).join(", ")} }`;
  const inline = `${head}, ${inlineObject})`;
  if (!inline.includes("\n") && indent.length + inline.length + 1 <= WIDTH)
    return inline;
  const body = fields.map(([k, v]) => `${inner}${k}: ${v},`).join("\n");
  return `${head}, {\n${body}\n${indent}})`;
}

function printSampler(sampler: Sampler, indent: string): string {
  const inner = indent + INDENT;
  const voices = Object.keys(sampler.voices)
    .sort()
    .map((name) => {
      const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : str(name);
      return `${inner}${key}: ${printSample(sampler.voices[name]!, inner, `${key}: `.length)},`;
    });
  const body = `{\n${voices.join("\n")}\n${indent}}`;
  if (sampler.mode === "oneshot") return `sampler(${body})`;
  // Prettier breaks every argument out when an earlier one contains a break.
  const shifted = `{\n${voices.map((line) => INDENT + line).join("\n")}\n${inner}}`;
  return `sampler(\n${inner}${shifted},\n${inner}{ mode: ${str(sampler.mode)} },\n${indent})`;
}

function printSample(ref: SampleRef, indent: string, prefix: number): string {
  const entries: [string, string][] = [["src", str(ref.src)]];
  // Pack sounds keep their pin in the file; local files are hashed on eval.
  if (ref.src.startsWith("pack:")) {
    if (ref.sha256 !== undefined) entries.push(["sha256", str(ref.sha256)]);
    if (ref.url !== undefined) entries.push(["url", str(ref.url)]);
    if (ref.license !== undefined) entries.push(["license", str(ref.license)]);
  }
  if (ref.root !== undefined)
    entries.push(["root", str(midiToPitch(ref.root))]);
  if (ref.begin !== undefined) entries.push(["begin", num(ref.begin)]);
  if (ref.end !== undefined) entries.push(["end", num(ref.end)]);
  if (ref.gain !== undefined) entries.push(["gain", num(ref.gain)]);
  if (ref.speed !== undefined) entries.push(["speed", num(ref.speed)]);
  if (ref.loop !== undefined) entries.push(["loop", String(ref.loop)]);
  if (ref.choke !== undefined) entries.push(["choke", str(ref.choke)]);
  if (entries.length === 1) return str(ref.src);
  return obj(entries, indent, prefix, 1);
}

/** Object literal: inline when the line fits, expanded otherwise (prettier keeps both). */
function obj(
  entries: readonly (readonly [string, string])[],
  indent: string,
  prefix: number,
  trailing: number,
): string {
  const inline = `{ ${entries.map(([k, v]) => `${k}: ${v}`).join(", ")} }`;
  if (indent.length + prefix + inline.length + trailing <= WIDTH) return inline;
  const inner = indent + INDENT;
  return `{\n${entries.map(([k, v]) => `${inner}${k}: ${v},`).join("\n")}\n${indent}}`;
}

/** Array literal: inline when the line fits (and no forced break), else one item per line. */
function list(
  items: readonly string[],
  indent: string,
  prefix: number,
  trailing: number,
  forceBreak = false,
): string {
  if (items.length === 0) return "[]";
  const inline = `[${items.join(", ")}]`;
  if (
    !forceBreak &&
    !inline.includes("\n") &&
    indent.length + prefix + inline.length + trailing <= WIDTH
  )
    return inline;
  const inner = indent + INDENT;
  return `[\n${items.map((item) => `${inner}${item},`).join("\n")}\n${indent}]`;
}

/** Number the way prettier normalizes literals. */
export function num(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`cannot print ${value}`);
  return String(value)
    .replace(/e\+/, "e")
    .replace(/^(-?)\./, "$10.");
}

/** Double-quoted string unless it holds more `"` than `'`, like prettier. */
export function str(value: string): string {
  const doubles = (value.match(/"/g) ?? []).length;
  const singles = (value.match(/'/g) ?? []).length;
  const quote = doubles > singles ? "'" : '"';
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(new RegExp(quote, "g"), `\\${quote}`)
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(
      /[\x00-\x1f\u2028\u2029]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  return `${quote}${escaped}${quote}`;
}
