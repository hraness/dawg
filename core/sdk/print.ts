/**
 * Deterministic printer: score → `song.ts` + `tracks/<slug>/track.ts`.
 *
 * Output is already in prettier's shape (80 columns, double quotes, trailing
 * commas, two-space indent, objects kept expanded) so formatting it again is
 * a no-op, and printing the evaluation of a printed project reproduces the
 * same bytes. Note ids are never printed: `song()` derives them from content.
 */

import { DRUM_VOICES, isDrumInstrument } from "../drums.ts";
import { DEFAULT_FIXED_VELOCITY } from "../expression.ts";
import type { RhythmRow } from "../euclid.ts";
import { FX_LANES, fxSpec, type FxName, type FxValues } from "../fx.ts";
import { midiToPitch } from "../pitch.ts";
import { rhythmVoicePitch, rowInSync } from "../rhythm.ts";
import {
  BUILTIN_TABLE_PREFIX,
  WAVETABLE_PARAMS,
  isSamplerInstrument,
  isWavetableInstrument,
  samplerVoiceSlots,
  wavetableOf,
  type TrackWavetable,
  type WavetableParam,
  TrackScore,
  type AutomationPoint,
  type Note,
  type SampleRef,
  type Sampler,
  type Track,
} from "../score.ts";
import { trackSlug } from "../slug.ts";
import { barStartTick } from "../tempo.ts";
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
  "wavetable",
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
    if (
      !/^[a-z_]/.test(base) ||
      RESERVED.has(base) ||
      (score.time && TIME_HELPERS.includes(base))
    )
      base = `track_${base}`;
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
  const time = printTime(score);
  const helpers = [
    "song",
    ...TIME_HELPERS.filter((name) => time.used.has(name)),
  ];
  const lines: string[] = [`import { ${helpers.join(", ")} } from "dawg";`];
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
  if (time.marks.length > 0)
    entries.push(`time: ${list(time.marks, INDENT, "time: ".length, 1)}`);
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

/** SDK time helpers `song.ts` may import, in import order. */
const TIME_HELPERS: readonly string[] = ["tempo", "ramp", "meter", "fermata"];

/** `song({ time })` marks for a score's tempo map, meters and fermatas. */
function printTime(score: TrackScore): {
  marks: string[];
  used: Set<string>;
} {
  const marks: string[] = [];
  const used = new Set<string>();
  const time = score.time;
  if (!time) return { marks, used };
  const beat = (tick: number) => num(tick / score.ticksPerBeat);
  type Mark = { tick: number; order: number; text: string };
  const all: Mark[] = [];
  for (const event of time.tempo ?? []) {
    if (event.ramp) {
      used.add("ramp");
      const curve = event.ramp === "exp" ? ', "exp"' : "";
      all.push({
        tick: event.tick,
        order: 1,
        text: `ramp(${beat(event.tick)}, ${num(event.bpm)}${curve})`,
      });
    } else {
      used.add("tempo");
      all.push({
        tick: event.tick,
        order: 1,
        text: `tempo(${beat(event.tick)}, ${num(event.bpm)})`,
      });
    }
  }
  for (const change of time.meter ?? []) {
    used.add("meter");
    const tick = barStartTick(score, change.bar);
    const unit = change.beatUnit ?? 4;
    const value =
      unit === 4
        ? num(change.beatsPerBar)
        : `[${num(change.beatsPerBar)}, ${num(unit)}]`;
    all.push({ tick, order: 0, text: `meter(${beat(tick)}, ${value})` });
  }
  for (const hold of time.fermatas ?? []) {
    used.add("fermata");
    all.push({
      tick: hold.tick,
      order: 2,
      text: `fermata(${beat(hold.tick)}, ${num(hold.beats)})`,
    });
  }
  all.sort((a, b) => a.tick - b.tick || a.order - b.order);
  for (const mark of all) marks.push(mark.text);
  return { marks, used };
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
      return printHit(score, note, voice, INDENT + INDENT);
    }
    used.add("note");
    return printNote(score, note, !kit && !slots, INDENT + INDENT);
  });
  if (track.sampler) used.add("sampler");
  const wavetable = isWavetableInstrument(track.instrument)
    ? wavetableOf(track)
    : undefined;
  if (wavetable) used.add("wavetable");

  const entries: string[] = [
    `id: ${str(track.id)}`,
    `name: ${str(track.name)}`,
  ];
  if (track.sampler) {
    entries.push(`instrument: ${printSampler(track.sampler, INDENT)}`);
  } else if (wavetable) {
    entries.push(`instrument: ${printWavetable(wavetable, INDENT)}`);
  } else entries.push(`instrument: ${str(track.instrument)}`);
  if (track.kit) entries.push(`kit: ${str(track.kit)}`);
  if (track.time) {
    const beats = (ticks: number) => num(ticks / score.ticksPerBeat);
    const fields: (readonly [string, string])[] = [];
    if (track.time.rate !== undefined)
      fields.push(["rate", num(track.time.rate)]);
    if (track.time.phase !== undefined)
      fields.push(["phase", beats(track.time.phase)]);
    if (track.time.cycle !== undefined)
      fields.push(["cycle", beats(track.time.cycle)]);
    entries.push(`time: ${obj(fields, INDENT, "time: ".length, 1)}`);
  }
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
          ...optional(track.filter, ["type", "ftype"]),
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
          ...optional(track.delay, ["time", "pingpong", "highcut"]),
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
          ...optional(track.reverb, ["fade", "lowpass", "dim", "predelay"]),
          ...(track.reverb.ir
            ? ([
                [
                  "ir",
                  track.reverb.ir.src.startsWith(BUILTIN_TABLE_PREFIX)
                    ? str(
                        track.reverb.ir.src.slice(BUILTIN_TABLE_PREFIX.length),
                      )
                    : printSample(
                        track.reverb.ir,
                        INDENT + INDENT,
                        "ir: ".length,
                      ),
                ],
              ] as const)
            : []),
        ],
        INDENT,
        "reverb: ".length,
        1,
      )}`,
    );
  if (track.fx) {
    const effects = Object.entries(track.fx) as [FxName, FxValues][];
    const inner = INDENT + INDENT;
    const body = effects.map(([effect, values]) => {
      // Only values that differ from the default: decoding fills the rest.
      const params = Object.entries(fxSpec(effect).params)
        .filter(
          ([key, spec]) =>
            values[key] !== undefined && values[key] !== spec.default,
        )
        .map(([key]) => [key, value(values[key]!)] as const);
      return `${inner}${effect}: ${params.length === 0 ? "{}" : obj(params, inner, `${effect}: `.length, 1)},`;
    });
    entries.push(`fx: {\n${body.join("\n")}\n${INDENT}}`);
  }
  if (track.synth) {
    const params = Object.entries(track.synth).map(
      ([key, v]) =>
        [
          key,
          Array.isArray(v)
            ? `[${(v as readonly number[]).map(num).join(", ")}]`
            : value(v as number | string | boolean),
        ] as const,
    );
    entries.push(`synth: ${obj(params, INDENT, "synth: ".length, 1)}`);
  }
  entries.push(...performanceEntries(score, track));
  const lanes: [string, readonly AutomationPoint[] | undefined][] = [
    ["volume", track.volumeAutomation],
    ["pan", track.panAutomation],
    ["filter", track.filterAutomation],
    ["resonance", track.resonanceAutomation],
    ["delayFeedback", track.delayFeedbackAutomation],
    ["delayMix", track.delayMixAutomation],
    ["wt", track.wtAutomation],
  ];
  const automation = lanes.filter(([, points]) => points && points.length > 0);
  const fxLanes = FX_LANES.filter(
    ({ lane }) => (track.fxAutomation?.[lane]?.length ?? 0) > 0,
  ).map(({ lane }) => [lane, track.fxAutomation![lane]!] as const);
  const laneLine = (
    name: string,
    points: readonly AutomationPoint[],
    indent: string,
  ) => {
    const items = points.map(
      (point) =>
        `[${num(point.tick / score.ticksPerBeat)}, ${num(point.value)}]`,
    );
    // Prettier forces a break on arrays of 2+ arrays that each hold 2+ items.
    return `${indent}${name}: ${list(items, indent, `${name}: `.length, 1, items.length > 1)},`;
  };
  if (automation.length > 0 || fxLanes.length > 0) {
    const inner = INDENT + INDENT;
    const body = automation.map(([lane, points]) =>
      laneLine(lane, points!, inner),
    );
    if (fxLanes.length > 0) {
      const deeper = inner + INDENT;
      const fxBody = fxLanes.map(([lane, points]) =>
        laneLine(str(lane), points, deeper),
      );
      body.push(`${inner}fx: {\n${fxBody.join("\n")}\n${inner}},`);
    }
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
    "wavetable",
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

function printNote(
  score: TrackScore,
  note: Note,
  named: boolean,
  indent: string,
): string {
  const pitch = named ? str(midiToPitch(note.pitch)) : num(note.pitch);
  const args = [pitch, num(note.startTick / score.ticksPerBeat)];
  const length = note.durationTicks / score.ticksPerBeat;
  const how = expressionEntries(note, indent + INDENT);
  if (length !== 1 || note.velocity !== DEFAULT_VELOCITY || how)
    args.push(num(length));
  if (note.velocity !== DEFAULT_VELOCITY || how) args.push(num(note.velocity));
  return call("note", args, how, indent);
}

function printHit(
  score: TrackScore,
  note: Note,
  voice: string,
  indent: string,
): string {
  const args = [str(voice), num(note.startTick / score.ticksPerBeat)];
  const length = note.durationTicks / score.ticksPerBeat;
  const how = expressionEntries(note, indent + INDENT);
  if (
    note.velocity !== DEFAULT_VELOCITY ||
    length !== DEFAULT_HIT_LENGTH ||
    how
  )
    args.push(num(note.velocity));
  if (length !== DEFAULT_HIT_LENGTH || how) args.push(num(length));
  return call("hit", args, how, indent);
}

/**
 * A note's expression as the fields of its `how` argument, values laid out
 * for property lines at `indent`; undefined when it has none.
 */
function expressionEntries(
  note: Note,
  indent: string,
): (readonly [string, string])[] | undefined {
  const entries: (readonly [string, string])[] = [];
  if (note.articulation) entries.push(["art", str(note.articulation)]);
  if (note.glide !== undefined) entries.push(["glide", num(note.glide)]);
  if (note.bend) {
    const points = note.bend.map((p) => `[${num(p.at)}, ${num(p.cents)}]`);
    // Prettier forces a break on arrays of 2+ arrays that each hold 2+ items.
    entries.push([
      "bend",
      list(points, indent, "bend: ".length, 1, points.length > 1),
    ]);
  }
  if (note.vibrato)
    entries.push([
      "vibrato",
      obj(
        [
          ["rate", num(note.vibrato.rate)],
          ["depth", num(note.vibrato.depth)],
          ...(note.vibrato.delay !== undefined
            ? ([["delay", num(note.vibrato.delay)]] as const)
            : []),
        ],
        indent,
        "vibrato: ".length,
        1,
      ),
    ]);
  if (note.humanize) {
    const { timing, velocity, length } = note.humanize;
    entries.push([
      "humanize",
      obj(
        [
          ...(timing !== undefined ? ([["timing", num(timing)]] as const) : []),
          ...(velocity !== undefined
            ? ([["velocity", num(velocity)]] as const)
            : []),
          ...(length !== undefined ? ([["length", num(length)]] as const) : []),
        ],
        indent,
        "humanize: ".length,
        1,
      ),
    ]);
  }
  return entries.length === 0 ? undefined : entries;
}

/**
 * `name(args, how)` as a list item at `indent`: on one line when it fits,
 * otherwise with the trailing `how` object hugged and broken one field per
 * line, the way prettier prints a last object argument.
 */
function call(
  name: string,
  args: readonly string[],
  how: readonly (readonly [string, string])[] | undefined,
  indent: string,
): string {
  if (!how) return `${name}(${args.join(", ")})`;
  const inline = `${name}(${[...args, `{ ${how.map(([k, v]) => `${k}: ${v}`).join(", ")} }`].join(", ")})`;
  if (!inline.includes("\n") && indent.length + inline.length + 1 <= WIDTH)
    return inline;
  const inner = indent + INDENT;
  const body = how.map(([k, v]) => property(k, v, inner)).join("\n");
  return `${name}(${[...args, "{"].join(", ")}\n${body}\n${indent}})`;
}

/** A track's performance fields (SDK 1.15.0) as `key: literal` entries. */
function performanceEntries(score: TrackScore, track: Track): string[] {
  const entries: string[] = [];
  if (track.glide)
    entries.push(
      track.glide.mode === "legato"
        ? `glide: ${num(track.glide.time)}`
        : `glide: ${obj(
            [
              ["time", num(track.glide.time)],
              ["mode", str(track.glide.mode)],
            ],
            INDENT,
            "glide: ".length,
            1,
          )}`,
    );
  if (track.pedal) {
    const events = track.pedal.map(
      (event) =>
        `[${num(event.tick / score.ticksPerBeat)}, ${str(event.state)}]`,
    );
    entries.push(
      `pedal: ${list(events, INDENT, "pedal: ".length, 1, events.length > 1)}`,
    );
  }
  if (track.velocityCurve)
    entries.push(
      track.velocityCurve.curve !== "fixed" ||
        (track.velocityCurve.fixed ?? DEFAULT_FIXED_VELOCITY) ===
          DEFAULT_FIXED_VELOCITY
        ? `velocityCurve: ${str(track.velocityCurve.curve)}`
        : `velocityCurve: ${obj(
            [
              ["curve", str(track.velocityCurve.curve)],
              ["fixed", num(track.velocityCurve.fixed!)],
            ],
            INDENT,
            "velocityCurve: ".length,
            1,
          )}`,
    );
  if (track.humanize) {
    const { timing, velocity, length, seed } = track.humanize;
    entries.push(
      `humanize: ${obj(
        [
          ...(timing !== undefined ? ([["timing", num(timing)]] as const) : []),
          ...(velocity !== undefined
            ? ([["velocity", num(velocity)]] as const)
            : []),
          ...(length !== undefined ? ([["length", num(length)]] as const) : []),
          ["seed", num(seed)],
        ],
        INDENT,
        "humanize: ".length,
        1,
      )}`,
    );
  }
  return entries;
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
  // Options are euclid's fifth argument, so rotate 0 is spelled out before them.
  if (row.grid === undefined && !row.rotate && fields.length > 0)
    args.push("0");
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
  const voices = (at: string) =>
    Object.keys(sampler.voices)
      .sort()
      .map((name) => {
        const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : str(name);
        return `${at}${key}: ${printSample(sampler.voices[name]!, at, `${key}: `.length)},`;
      })
      .join("\n");
  if (sampler.mode === "oneshot")
    return `sampler({\n${voices(inner)}\n${indent}})`;
  // Prettier breaks every argument out when an earlier one contains a break,
  // so the voices sit one level deeper (multi-line voices included).
  const shifted = `{\n${voices(inner + INDENT)}\n${inner}}`;
  return `sampler(\n${inner}${shifted},\n${inner}{ mode: ${str(sampler.mode)} },\n${indent})`;
}

/** `wavetable("basic", { wt: 0.5 })`; pack tables keep their pin. */
function printWavetable(settings: TrackWavetable, indent: string): string {
  const src = settings.table.src;
  const name = src.startsWith(BUILTIN_TABLE_PREFIX)
    ? str(src.slice(BUILTIN_TABLE_PREFIX.length))
    : printSample(settings.table, indent, "wavetable(".length);
  const params: [string, string][] = [];
  for (const key of Object.keys(WAVETABLE_PARAMS) as WavetableParam[])
    if (settings[key] !== undefined) params.push([key, num(settings[key])]);
  if (settings.warpmode) params.push(["warpmode", str(settings.warpmode)]);
  if (params.length === 0) return `wavetable(${name})`;
  const inline = `wavetable(${name}, { ${params.map(([k, v]) => `${k}: ${v}`).join(", ")} })`;
  if (
    !inline.includes("\n") &&
    indent.length + "instrument: ".length + inline.length + 1 <= WIDTH
  )
    return inline;
  const inner = indent + INDENT;
  if (
    !name.includes("\n") &&
    indent.length + "instrument: wavetable(".length + name.length + 4 <= WIDTH
  )
    return `wavetable(${name}, {\n${params.map(([k, v]) => `${inner}${k}: ${v},`).join("\n")}\n${indent}})`;
  // Prettier breaks every argument out when the first one breaks.
  const deeper = inner + INDENT;
  const table = src.startsWith(BUILTIN_TABLE_PREFIX)
    ? name
    : printSample(settings.table, inner, 0);
  return `wavetable(\n${inner}${table},\n${inner}{\n${params.map(([k, v]) => `${deeper}${k}: ${v},`).join("\n")}\n${inner}},\n${indent})`;
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
  if (ref.loopBegin !== undefined)
    entries.push(["loopBegin", num(ref.loopBegin)]);
  if (ref.loopEnd !== undefined) entries.push(["loopEnd", num(ref.loopEnd)]);
  if (ref.clip !== undefined) entries.push(["clip", num(ref.clip)]);
  if (ref.unit !== undefined) entries.push(["unit", str(ref.unit)]);
  if (ref.fit !== undefined) entries.push(["fit", String(ref.fit)]);
  if (ref.accelerate !== undefined)
    entries.push(["accelerate", num(ref.accelerate)]);
  if (ref.squiz !== undefined) entries.push(["squiz", num(ref.squiz)]);
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
  return `{\n${entries.map(([k, v]) => property(k, v, inner)).join("\n")}\n${indent}}`;
}

/**
 * One expanded `key: value,` line. Like prettier, a string too long for the
 * line moves under its key (a 64-hex sha256 pin in a nested object does).
 */
function property(key: string, value: string, indent: string): string {
  const line = `${indent}${key}: ${value},`;
  // Prettier keeps a short key (under tabWidth + 3 = 5 characters) inline.
  if (
    line.length <= WIDTH ||
    key.length < 5 ||
    !value.startsWith('"') ||
    value.includes("\n")
  )
    return line;
  return `${indent}${key}:\n${indent}${INDENT}${value},`;
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

/** Effect parameter literal. */
function value(v: number | string | boolean): string {
  return typeof v === "number"
    ? num(v)
    : typeof v === "string"
      ? str(v)
      : `${v}`;
}

/** `[key, literal]` for each optional effect field that is set. */
function optional(
  record: object,
  keys: readonly string[],
): (readonly [string, string])[] {
  const out: (readonly [string, string])[] = [];
  for (const key of keys) {
    const v = (record as Record<string, number | string | boolean | undefined>)[
      key
    ];
    if (v !== undefined) out.push([key, value(v)]);
  }
  return out;
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
