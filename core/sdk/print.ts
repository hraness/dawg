/**
 * Deterministic printer: score → `song.ts` + `tracks/<slug>/track.ts`.
 *
 * Output is already in prettier's shape (80 columns, double quotes, trailing
 * commas, two-space indent, objects kept expanded) so formatting it again is
 * a no-op, and printing the evaluation of a printed project reproduces the
 * same bytes. Note ids are never printed: `song()` derives them from content.
 */

import { DRUM_VOICES, isDrumInstrument } from "../drums.ts";
import type { TrackGranular } from "../granular.ts";
import { DEFAULT_FIXED_VELOCITY } from "../expression.ts";
import type { RhythmRow } from "../euclid.ts";
import {
  FX_LANES,
  RIG_STAGES,
  fxSpec,
  rigPresetKeys,
  rigPresetOf,
  type FxName,
  type FxValues,
} from "../fx.ts";
import { MASTER_SPECS, MASTER_UNITS, type SongMaster } from "../master.ts";
import { midiToPitch } from "../pitch.ts";
import {
  MODAL_INSTRUMENT,
  MODAL_PARAMS,
  type TrackModal,
} from "../resonators.ts";
import { WIND_INSTRUMENT, WIND_PARAMS, type TrackWind } from "../winds.ts";
import {
  SING_INSTRUMENT,
  SING_KEY_ORDER,
  singNoteName,
  type TrackSing,
} from "../sing.ts";
import {
  VOCODER_INSTRUMENT,
  VOCODER_PARAMS,
  type TrackVocoder,
} from "../vocoder.ts";
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
  type FormEntry,
  type Note,
  type SampleRef,
  type Sampler,
  type Section,
  type AudioClip,
  type Take,
  type Track,
} from "../score.ts";
import { trackSlug } from "../slug.ts";
import { barStartTick, timeWithinSong } from "../tempo.ts";
import type { Tuning } from "../tuning.ts";
import { DEFAULT_STRING_PRESET, type TrackString } from "../strings.ts";
import { DEFAULT_HIT_LENGTH, DEFAULT_VELOCITY, defaultClipId } from "./v1.ts";

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
  "rig",
  "granular",
  "modal",
  "wind",
  "sing",
  "audio",
  "take",
  "lyrics",
  "repeatAudio",
  "vocoder",
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
  if (score.tuning)
    entries.push(
      `tuning: ${printTuning(score.tuning, INDENT, "tuning: ".length)}`,
    );
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
  if (score.master) entries.push(printMaster(score.master));
  // Song sections and form (0.5): printed only when the song has them.
  if (score.sections.length > 0)
    entries.push(
      `sections: ${list(
        score.sections.map((section) => printSection(section, INDENT + INDENT)),
        INDENT,
        "sections: ".length,
        1,
      )}`,
    );
  if (score.form.length > 0)
    entries.push(`form: ${printForm(score.form, INDENT)}`);
  if (score.loopSection !== undefined)
    entries.push(`loopSection: ${str(score.loopSection)}`);
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
  // Marks past the final barline are never heard and the SDK refuses them.
  const time = timeWithinSong(score);
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

/**
 * One `sections` item: `{ name: "verse", startBar: 0, bars: 8 }`. `indent`
 * is the item's own line; expanded fields sit one level deeper.
 */
function printSection(section: Section, indent: string): string {
  const inner = indent + INDENT;
  const entries: (readonly [string, string])[] = [
    ["name", str(section.name)],
    ["startBar", num(section.startBar)],
    ["bars", num(section.bars)],
  ];
  if (section.mute && section.mute.length > 0)
    entries.push([
      "mute",
      list(section.mute.map(str), inner, "mute: ".length, 1),
    ]);
  if (section.vary) {
    const vary = Object.entries(section.vary).map(([id, change]) => {
      const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id) ? id : str(id);
      const fields: (readonly [string, string])[] = [];
      if (change.transpose !== undefined)
        fields.push(["transpose", num(change.transpose)]);
      if (change.gain !== undefined) fields.push(["gain", num(change.gain)]);
      return [key, obj(fields, inner + INDENT, `${key}: `.length, 1)] as const;
    });
    if (vary.length > 0)
      entries.push(["vary", obj(vary, inner, "vary: ".length, 1)]);
  }
  return obj(entries, indent, 0, 1);
}

/**
 * The form as a string when every name is plain (`"intro verse chorus*2"`),
 * else as a list of entries.
 */
function printForm(form: readonly FormEntry[], indent: string): string {
  // Word characters only, so the string reads back as the same entries.
  const plain = form.every((entry) => /^\w+$/u.test(entry.section));
  if (plain) {
    const text = form
      .map(
        (entry) =>
          `${entry.section}${(entry.repeat ?? 1) > 1 ? `*${entry.repeat}` : ""}`,
      )
      .join(" ");
    return str(text);
  }
  return list(
    form.map((entry) =>
      (entry.repeat ?? 1) > 1
        ? obj(
            [
              ["section", str(entry.section)],
              ["repeat", num(entry.repeat!)],
            ],
            indent + INDENT,
            0,
            1,
          )
        : str(entry.section),
    ),
    indent,
    "form: ".length,
    1,
  );
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
    const voice = note.cents ? undefined : voiceFor.get(note.pitch);
    if (voice !== undefined) {
      used.add("hit");
      return printHit(score, note, voice, INDENT + INDENT);
    }
    used.add("note");
    return printNote(score, note, !kit && !slots, INDENT + INDENT);
  });
  const grained =
    track.instrument === "granular" && track.granular !== undefined;
  if (grained) used.add("granular");
  if (track.sampler) used.add("sampler");
  const wavetable = isWavetableInstrument(track.instrument)
    ? wavetableOf(track)
    : undefined;
  if (wavetable) used.add("wavetable");
  const stringed = track.instrument === "string" && track.string !== undefined;
  if (stringed) used.add("stringed");
  const modalCall =
    track.instrument === MODAL_INSTRUMENT && track.modal
      ? printModal(track.modal, INDENT)
      : undefined;
  if (modalCall?.startsWith("modal(")) used.add("modal");
  const windCall =
    track.instrument === WIND_INSTRUMENT && track.wind
      ? printWind(track.wind, INDENT)
      : undefined;
  if (windCall?.startsWith("wind(")) used.add("wind");
  const singCall =
    track.instrument === SING_INSTRUMENT && track.sing
      ? printSing(track.sing, INDENT)
      : undefined;
  if (singCall?.startsWith("sing(")) used.add("sing");
  const vocoderCall = track.vocoder
    ? printVocoder(
        track.vocoder,
        vocoderSrcText(score, track.vocoder.src),
        track.instrument === VOCODER_INSTRUMENT ? "instrument: " : "vocoder: ",
        INDENT,
      )
    : undefined;
  if (vocoderCall?.startsWith("vocoder(")) used.add("vocoder");

  const entries: string[] = [
    `id: ${str(track.id)}`,
    `name: ${str(track.name)}`,
  ];
  if (grained) {
    entries.push(`instrument: ${printGranular(track.granular!, INDENT)}`);
    // The sampler a granular track keeps for `grain off`.
    if (track.sampler)
      entries.push(`sampler: ${printSampler(track.sampler, INDENT)}`);
  } else if (track.sampler) {
    entries.push(`instrument: ${printSampler(track.sampler, INDENT)}`);
  } else if (wavetable) {
    entries.push(`instrument: ${printWavetable(wavetable, INDENT)}`);
  } else if (stringed) {
    entries.push(`instrument: ${printStringed(track.string!, INDENT)}`);
  } else if (modalCall) {
    entries.push(`instrument: ${modalCall}`);
  } else if (windCall) {
    entries.push(`instrument: ${windCall}`);
  } else if (singCall) {
    entries.push(`instrument: ${singCall}`);
  } else if (vocoderCall && track.instrument === VOCODER_INSTRUMENT) {
    entries.push(`instrument: ${vocoderCall}`);
  } else entries.push(`instrument: ${str(track.instrument)}`);
  if (vocoderCall && track.instrument !== VOCODER_INSTRUMENT)
    entries.push(`vocoder: ${vocoderCall}`);
  if (track.kit) entries.push(`kit: ${str(track.kit)}`);
  // The table a track keeps after leaving the wavetable instrument.
  if (track.wavetable && !wavetable) {
    used.add("wavetable");
    entries.push(`wavetable: ${printWavetable(track.wavetable, INDENT)}`);
  }
  if (track.granular && !grained)
    entries.push(
      `granular: ${obj(
        [
          ...(track.granular.preset
            ? [["preset", str(track.granular.preset)] as const]
            : []),
          ...granularEntries(track.granular, INDENT),
        ],
        INDENT,
        "granular: ".length,
        1,
      )}`,
    );
  if (track.time) {
    const beats = (ticks: number) => num(ticks / score.ticksPerBeat);
    const fields: (readonly [string, string])[] = [];
    if (track.time.rate !== undefined)
      fields.push(["rate", num(track.time.rate)]);
    if (track.time.phase !== undefined)
      fields.push(["phase", beats(track.time.phase)]);
    if (track.time.cycle !== undefined)
      fields.push(["cycle", beats(track.time.cycle)]);
    if (track.time.steps) {
      const { shift, hold, drift } = track.time.steps;
      fields.push([
        "steps",
        `{ shift: ${beats(shift)}, hold: ${num(hold)}, drift: ${num(drift)} }`,
      ]);
    }
    entries.push(`time: ${obj(fields, INDENT, "time: ".length, 1)}`);
  }
  if (track.tuning)
    entries.push(
      `tuning: ${printTuning(track.tuning, INDENT, "tuning: ".length)}`,
    );
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
    // A whole rig preset prints as `...rig("crunch")` (SDK 1.22.0).
    const rigName = rigPresetOf(track.fx);
    if (rigName) used.add("rig");
    const effects = (Object.entries(track.fx) as [FxName, FxValues][]).filter(
      ([effect]) =>
        !rigName ||
        !(
          (RIG_STAGES as readonly string[]).includes(effect) ||
          rigPresetKeys(rigName).includes(effect)
        ),
    );
    const inner = INDENT + INDENT;
    const rigLine = rigName ? [`${inner}...rig(${str(rigName)}),`] : [];
    const body = rigLine.concat(
      effects.map(([effect, values]) => {
        // Only values that differ from the default: decoding fills the rest.
        const params = Object.entries(fxSpec(effect).params)
          .filter(
            ([key, spec]) =>
              values[key] !== undefined && values[key] !== spec.default,
          )
          .map(([key]) => [key, value(values[key]!)] as const);
        return `${inner}${effect}: ${params.length === 0 ? "{}" : obj(params, inner, `${effect}: `.length, 1)},`;
      }),
    );
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
  if (track.string && !stringed) {
    const params = Object.entries(track.string).map(
      ([key, v]) => [key, value(v!)] as const,
    );
    entries.push(`string: ${obj(params, INDENT, "string: ".length, 1)}`);
  }
  if (track.keys) {
    // `{}` is meaningful: it turns the modelled piano on.
    const params = Object.entries(track.keys).map(
      ([key, v]) => [key, value(v)] as const,
    );
    entries.push(
      `keys: ${params.length === 0 ? "{}" : obj(params, INDENT, "keys: ".length, 1)}`,
    );
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
  if (track.takes && track.takes.length > 0) {
    used.add("take");
    const items = track.takes.map((t) => printTake(score, t, INDENT + INDENT));
    entries.push(`takes: ${list(items, INDENT, "takes: ".length, 1, true)}`);
  }
  if (track.clips && track.clips.length > 0) {
    used.add("audio");
    const items = track.clips.map((clip, index) =>
      printClip(score, clip, index, INDENT + INDENT),
    );
    entries.push(
      `clips: ${list(items, INDENT, "clips: ".length, 1, items.length > 1)}`,
    );
  }

  const names = [
    "track",
    "note",
    "seq",
    "hit",
    "hits",
    "every",
    "sampler",
    "wavetable",
    "stringed",
    "rig",
    "granular",
    "modal",
    "wind",
    "sing",
    "vocoder",
    "euclid",
    "grid",
    "audio",
    "take",
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
  // A detuned note always prints by name: `"E4-14c"`.
  const pitch = note.cents
    ? str(
        `${midiToPitch(note.pitch)}${note.cents > 0 ? "+" : ""}${num(note.cents)}c`,
      )
    : named
      ? str(midiToPitch(note.pitch))
      : num(note.pitch);
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
  if (note.vowel) entries.push(["vowel", str(note.vowel)]);
  if (note.lyric !== undefined) entries.push(["lyric", str(note.lyric)]);
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

/** Seconds at 4 decimals (sources.md 6). */
function secs(value: number): string {
  return num(Math.round(value * 1e4) / 1e4);
}

/**
 * `audio(src, { at, offset, dur, gain, fadeInTime, fadeTime, rev, take,
 * mute, text, say, sha256 })` (SDK 1.32.0); defaults omitted, an id printed
 * only when it differs from the positional default.
 */
function printClip(
  score: TrackScore,
  clip: AudioClip,
  index: number,
  indent: string,
): string {
  const how: [string, string][] = [];
  if (clip.id !== defaultClipId(index)) how.push(["id", str(clip.id)]);
  if (clip.startTick !== 0)
    how.push(["at", num(clip.startTick / score.ticksPerBeat)]);
  if (clip.offset) how.push(["offset", secs(clip.offset)]);
  if (clip.dur !== undefined) how.push(["dur", secs(clip.dur)]);
  // Gain is linear in the file; a comment shows the dB the commands speak.
  if (clip.gain !== undefined && clip.gain !== 1)
    how.push([
      "gain",
      `${num(clip.gain)} /* ${
        clip.gain > 0 ? (20 * Math.log10(clip.gain)).toFixed(1) : "-inf"
      } dB */`,
    ]);
  if (clip.fadeInTime !== undefined)
    how.push(["fadeInTime", secs(clip.fadeInTime)]);
  if (clip.fadeTime !== undefined) how.push(["fadeTime", secs(clip.fadeTime)]);
  if (clip.rev) how.push(["rev", "true"]);
  if (clip.take !== undefined) how.push(["take", str(clip.take)]);
  if (clip.mute) how.push(["mute", "true"]);
  if (clip.text !== undefined) how.push(["text", str(clip.text)]);
  if (clip.say !== undefined) how.push(["say", JSON.stringify(clip.say)]);
  how.push(["sha256", str(clip.sha256)]);
  return call("audio", [str(clip.src)], how, indent);
}

/** `take(name, src, { at, in, out, ... })` (SDK 1.32.0). */
function printTake(score: TrackScore, t: Take, indent: string): string {
  const beatsAt = (tick: number) => num(tick / score.ticksPerBeat);
  const how: [string, string][] = [];
  if (t.startTick !== 0) how.push(["at", beatsAt(t.startTick)]);
  how.push(["in", beatsAt(t.inTick)], ["out", beatsAt(t.outTick)]);
  if (t.offset) how.push(["offset", secs(t.offset)]);
  if (t.latency) how.push(["latency", secs(t.latency)]);
  if (t.latencyAssumed) how.push(["latencyAssumed", "true"]);
  if (t.ppm !== undefined)
    how.push(["ppm", num(Math.round(t.ppm * 100) / 100)]);
  if (t.fit !== undefined) how.push(["fit", num(t.fit)]);
  if (t.warn !== undefined) how.push(["warn", str(t.warn)]);
  if (t.nudge !== undefined) how.push(["nudge", num(t.nudge)]);
  how.push(["sha256", str(t.sha256)]);
  return call("take", [str(t.name), str(t.src)], how, indent);
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
  for (const key of ["pedal", "softPedal", "sostenuto"] as const) {
    const lane = track[key];
    if (!lane) continue;
    const events = lane.map(
      (event) =>
        `[${num(event.tick / score.ticksPerBeat)}, ${str(event.state)}]`,
    );
    entries.push(
      `${key}: ${list(events, INDENT, `${key}: `.length, 1, events.length > 1)}`,
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
  if (track.guitar) {
    const { tune, capo, hand, ring, position } = track.guitar;
    const fields: [string, string][] = [];
    if (tune !== undefined)
      fields.push([
        "tune",
        typeof tune === "string" ? str(tune) : `[${tune.map(num).join(", ")}]`,
      ]);
    if (capo !== undefined) fields.push(["capo", num(capo)]);
    if (hand !== undefined) fields.push(["hand", num(hand)]);
    if (ring !== undefined) fields.push(["ring", num(ring)]);
    if (position !== undefined) fields.push(["position", num(position)]);
    entries.push(`guitar: ${obj(fields, INDENT, "guitar: ".length, 1)}`);
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

/** `stringed("sitar", { buzz: 0.8 })`: the preset, then its overrides. */
function printStringed(settings: TrackString, indent: string): string {
  const name = str(settings.preset ?? DEFAULT_STRING_PRESET);
  const params = Object.entries(settings)
    .filter(([key]) => key !== "preset")
    .map(([key, v]) => [key, value(v!)] as const);
  if (params.length === 0) return `stringed(${name})`;
  const inline = `stringed(${name}, { ${params.map(([k, v]) => `${k}: ${v}`).join(", ")} })`;
  if (indent.length + "instrument: ".length + inline.length + 1 <= WIDTH)
    return inline;
  const inner = indent + INDENT;
  return `stringed(${name}, {\n${params.map(([k, v]) => `${inner}${k}: ${v},`).join("\n")}\n${indent}})`;
}

/** `[key, literal]` for each stored granular field but the preset. */
function granularEntries(
  settings: TrackGranular,
  indent: string,
): (readonly [string, string])[] {
  return Object.entries(settings)
    .filter(([key]) => key !== "preset")
    .map(([key, v]) => [
      key,
      typeof v === "object"
        ? printSample(v as SampleRef, indent + INDENT, `${key}: `.length)
        : value(v as number | string | boolean),
    ]);
}

/** `granular("cloud", { scan: 0.1 })`: the preset, then its overrides. */
function printGranular(settings: TrackGranular, indent: string): string {
  const inner = indent + INDENT;
  const params = granularEntries(settings, indent);
  const name = settings.preset ? str(settings.preset) : undefined;
  if (params.length === 0) return name ? `granular(${name})` : "granular()";
  const head = name ? `granular(${name}, ` : "granular(";
  const inline = `${head}{ ${params.map(([k, v]) => `${k}: ${v}`).join(", ")} })`;
  if (
    !inline.includes("\n") &&
    indent.length + "instrument: ".length + inline.length + 1 <= WIDTH
  )
    return inline;
  return `${head}{\n${params.map(([k, v]) => property(k, v, inner)).join("\n")}\n${indent}})`;
}

/**
 * A modal track's instrument: the preset word alone (`"vibes"`) when there
 * are no overrides, else `modal("vibes", { motor: 4 })` with keys in
 * `MODAL_PARAMS` order. `marimba` is a legacy word, so the modal marimba
 * always prints as `modal("marimba")`.
 */
function printModal(settings: TrackModal, indent: string): string {
  const params: [string, string][] = [];
  for (const key of Object.keys(MODAL_PARAMS) as (keyof TrackModal)[]) {
    const value = settings[key];
    if (value === undefined) continue;
    params.push([key, typeof value === "number" ? num(value) : str(value)]);
  }
  if (settings.pair !== undefined) params.push(["pair", str(settings.pair)]);
  const preset = settings.preset;
  if (params.length === 0 && preset && preset !== "marimba") return str(preset);
  const head = preset ? str(preset) : "";
  if (params.length === 0) return `modal(${head})`;
  const lead = head ? `${head}, ` : "";
  const inline = `modal(${lead}{ ${params.map(([k, v]) => `${k}: ${v}`).join(", ")} })`;
  if (indent.length + "instrument: ".length + inline.length + 1 <= WIDTH)
    return inline;
  const inner = indent + INDENT;
  return `modal(${lead}{\n${params.map(([k, v]) => `${inner}${k}: ${v},`).join("\n")}\n${indent}})`;
}

/**
 * A wind track's instrument: the preset word alone (`"flute"`) when there
 * are no overrides, else `wind("sax", { breath: 0.8 })` with keys in
 * `WIND_PARAMS` order. Every wind preset word is also an instrument word.
 */
function printWind(settings: TrackWind, indent: string): string {
  const params: [string, string][] = [];
  for (const key of Object.keys(WIND_PARAMS)) {
    const value = (settings as Record<string, unknown>)[key];
    if (value === undefined) continue;
    params.push([
      key,
      typeof value === "number"
        ? num(value)
        : typeof value === "boolean"
          ? String(value)
          : str(String(value)),
    ]);
  }
  const preset = settings.preset;
  if (params.length === 0 && preset) return str(preset);
  const head = preset ? str(preset) : "";
  if (params.length === 0) return `wind(${head})`;
  const lead = head ? `${head}, ` : "";
  const inline = `wind(${lead}{ ${params.map(([k, v]) => `${k}: ${v}`).join(", ")} })`;
  if (indent.length + "instrument: ".length + inline.length + 1 <= WIDTH)
    return inline;
  const inner = indent + INDENT;
  return `wind(${lead}{\n${params.map(([k, v]) => `${inner}${k}: ${v},`).join("\n")}\n${indent}})`;
}

/**
 * A sing track's instrument: the preset word alone (`"choir"`) when there
 * are no overrides and the preset is an instrument word, else
 * `sing("khoomei", { drone: "D3" })` with keys in `SING_KEY_ORDER`; the
 * drone prints as a note name.
 */
function printSing(settings: TrackSing, indent: string): string {
  const params: [string, string][] = [];
  for (const key of SING_KEY_ORDER) {
    const value = (settings as Record<string, unknown>)[key];
    if (value === undefined) continue;
    params.push([
      key,
      key === "drone"
        ? str(singNoteName(value as number))
        : Array.isArray(value)
          ? `[${value.map((v) => num(v as number)).join(", ")}]`
          : typeof value === "number"
            ? num(value)
            : str(String(value)),
    ]);
  }
  const preset = settings.preset;
  if (params.length === 0 && preset && SING_BARE_WORDS.has(preset))
    return str(preset);
  if (params.length === 0 && !preset) return str(SING_INSTRUMENT);
  const head = preset ? str(preset) : "";
  if (params.length === 0) return `sing(${head})`;
  const lead = head ? `${head}, ` : "";
  const inline = `sing(${lead}{ ${params.map(([k, v]) => `${k}: ${v}`).join(", ")} })`;
  if (indent.length + "instrument: ".length + inline.length + 1 <= WIDTH)
    return inline;
  const inner = indent + INDENT;
  return `sing(${lead}{\n${params.map(([k, v]) => `${inner}${k}: ${v},`).join("\n")}\n${indent}})`;
}

/** Sing presets that are also instrument words (`"choir"`). */
const SING_BARE_WORDS: ReadonlySet<string> = new Set([
  "aah",
  "ooh",
  "choir",
  "chorale",
  "khoomei",
  "sygyt",
  "kargyraa",
]);

/**
 * A vocoder's `src` as the SDK reads it back: the track's name slug when it
 * names exactly that track (no other slug or id collides), else the id.
 */
function vocoderSrcText(
  score: TrackScore,
  src: string | undefined,
): string | undefined {
  if (src === undefined) return undefined;
  const target = score.tracks.find((track) => track.id === src);
  if (!target) return src;
  const slug = trackSlug(target.name);
  const clash = score.tracks.some(
    (track) =>
      track.id !== target.id &&
      (track.id === slug || trackSlug(track.name) === slug),
  );
  return clash ? src : slug;
}

/**
 * A vocoder: the bare word `"vocoder"` for a built-in carrier with nothing
 * set, else `vocoder("talkbox", { src: "vox", formant: 2 })` with `src`
 * first and the rest in `VOCODER_PARAMS` order.
 */
function printVocoder(
  settings: TrackVocoder,
  src: string | undefined,
  prefix: string,
  indent: string,
): string {
  const params: [string, string][] = [];
  if (src !== undefined) params.push(["src", str(src)]);
  for (const key of Object.keys(VOCODER_PARAMS)) {
    const value = (settings as Record<string, unknown>)[key];
    if (value === undefined) continue;
    params.push([
      key,
      typeof value === "number"
        ? num(value)
        : typeof value === "boolean"
          ? String(value)
          : str(String(value)),
    ]);
  }
  const preset = settings.preset;
  if (params.length === 0 && !preset && prefix === "instrument: ")
    return str(VOCODER_INSTRUMENT);
  const head = preset ? str(preset) : "";
  if (params.length === 0) return `vocoder(${head})`;
  const lead = head ? `${head}, ` : "";
  const inline = `vocoder(${lead}{ ${params.map(([k, v]) => `${k}: ${v}`).join(", ")} })`;
  if (indent.length + prefix.length + inline.length + 1 <= WIDTH) return inline;
  const inner = indent + INDENT;
  return `vocoder(${lead}{\n${params.map(([k, v]) => `${inner}${k}: ${v},`).join("\n")}\n${indent}})`;
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
  if (ref.bpm !== undefined) entries.push(["bpm", num(ref.bpm)]);
  if (ref.fitmode !== undefined) entries.push(["fitmode", str(ref.fitmode)]);
  if (ref.len !== undefined) entries.push(["len", num(ref.len)]);
  if (ref.shift !== undefined) entries.push(["shift", num(ref.shift)]);
  if (ref.formant !== undefined) entries.push(["formant", num(ref.formant)]);
  if (ref.fadeInTime !== undefined)
    entries.push(["fadeInTime", num(ref.fadeInTime)]);
  if (ref.fadeTime !== undefined) entries.push(["fadeTime", num(ref.fadeTime)]);
  if (ref.from !== undefined) {
    const from = ref.from;
    const parts: [string, string][] = [["source", str(from.source)]];
    if (from.section !== undefined) parts.push(["section", str(from.section)]);
    if (from.bars !== undefined)
      parts.push(["bars", `[${num(from.bars[0])}, ${num(from.bars[1])}]`]);
    parts.push(["score", str(from.score)]);
    entries.push(["from", obj(parts, indent + INDENT, "from: ".length, 1)]);
  }
  if (ref.vel !== undefined)
    entries.push(["vel", `[${num(ref.vel[0])}, ${num(ref.vel[1])}]`]);
  if (ref.rr !== undefined) entries.push(["rr", str(ref.rr)]);
  if (entries.length === 1) return str(ref.src);
  return obj(entries, indent, prefix, 1);
}

/**
 * A song or track tuning: a bare library name, or an object without the
 * fields dawg resolved from Scala files (the table of an `scl`, the keymap
 * of a `kbm`).
 */
function printTuning(tuning: Tuning, indent: string, prefix: number): string {
  const entries: [string, string][] = [];
  if (tuning.name !== undefined) entries.push(["name", str(tuning.name)]);
  if (tuning.scl === undefined) {
    const inner = indent + INDENT;
    if (tuning.edo !== undefined) entries.push(["edo", num(tuning.edo)]);
    if (tuning.ratios)
      entries.push([
        "ratios",
        list(tuning.ratios.map(str), inner, "ratios: ".length, 1),
      ]);
    if (tuning.cents)
      entries.push([
        "cents",
        fill(tuning.cents.map(num), inner, "cents: ".length, 1),
      ]);
  } else entries.push(["scl", str(tuning.scl)]);
  if (tuning.kbm !== undefined) entries.push(["kbm", str(tuning.kbm)]);
  if (tuning.ref !== undefined) entries.push(["ref", num(tuning.ref)]);
  if (tuning.root !== undefined)
    entries.push(["root", str(midiToPitch(tuning.root))]);
  if (tuning.map !== undefined) entries.push(["map", str(tuning.map)]);
  if (entries.length === 1 && entries[0]![0] === "name") return entries[0]![1];
  return obj(entries, indent, prefix, 1);
}

/**
 * Number array the way prettier prints one: inline when it fits, else
 * filled (as many per line as fit, each followed by a comma).
 */
function fill(
  items: readonly string[],
  indent: string,
  prefix: number,
  trailing: number,
): string {
  const inline = `[${items.join(", ")}]`;
  if (
    items.length < 2 ||
    indent.length + prefix + inline.length + trailing <= WIDTH
  )
    return inline;
  const inner = indent + INDENT;
  const lines: string[] = [];
  let line = "";
  for (const item of items) {
    const next = `${item},`;
    if (line !== "" && inner.length + line.length + 1 + next.length <= WIDTH)
      line += ` ${next}`;
    else {
      if (line !== "") lines.push(inner + line);
      line = next;
    }
  }
  lines.push(inner + line);
  return `[\n${lines.join("\n")}\n${indent}]`;
}

/** `master: { … }`, always expanded like `fx`; units in chain order. */
function printMaster(master: SongMaster): string {
  const inner = INDENT + INDENT;
  const body: string[] = [];
  for (const unit of MASTER_UNITS) {
    const values = master[unit];
    if (!values) continue;
    // Only values that differ from the default: loading fills the rest.
    const params = Object.entries(MASTER_SPECS[unit].params)
      .filter(
        ([key, spec]) =>
          values[key] !== undefined && values[key] !== spec.default,
      )
      .map(([key]) => [key, value(values[key]!)] as const);
    body.push(
      `${inner}${unit}: ${params.length === 0 ? "{}" : obj(params, inner, `${unit}: `.length, 1)},`,
    );
  }
  if (master.target !== undefined)
    body.push(`${inner}target: ${num(master.target)},`);
  return `master: {\n${body.join("\n")}\n${INDENT}}`;
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
