// Vendored from soundfish `lib/song-import/basic-pitch.ts` (same owner): the CSV parser and per-stem parameters.
import type { TimedNote } from "../types.ts";
import { clamp, decodeUtf8 } from "./util.ts";

const MAX_NOTES = 100_000;

const HEADER_ALIASES = {
  start: [
    "start_time_s",
    "onset_time_s",
    "onset_time",
    "onset",
    "start_time",
    "start",
  ],
  end: [
    "end_time_s",
    "offset_time_s",
    "offset_time",
    "offset",
    "end_time",
    "end",
  ],
  pitch: ["pitch_midi", "midi_pitch", "pitch"],
  amplitude: ["amplitude", "velocity"],
  confidence: ["confidence", "note_confidence"],
} as const;

function parseCsvRows(text: string): readonly string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted)
    throw new Error("Basic Pitch note CSV ended inside a quoted field.");
  row.push(field.replace(/\r$/u, ""));
  if (row.some((value) => value.length > 0)) rows.push(row);
  // Leading `#` lines are comments (dawg's fixtures carry attribution there).
  return rows.filter((entry) => !entry[0]?.startsWith("#"));
}

function columnMatch(
  headers: readonly string[],
  aliases: readonly string[],
  label: string,
): { index: number; alias: string } {
  for (const alias of aliases) {
    const index = headers.indexOf(alias);
    if (index >= 0) return { index, alias };
  }
  throw new Error(
    `Basic Pitch note CSV is missing a recognized ${label} column.`,
  );
}

function optionalColumnIndex(
  headers: readonly string[],
  aliases: readonly string[],
): number | undefined {
  for (const alias of aliases) {
    const index = headers.indexOf(alias);
    if (index >= 0) return index;
  }
  return undefined;
}

/** Parses `<base>_basic_pitch.csv` (`--save-note-events`) into seconds-based notes. */
export function parseBasicPitchNoteCsv(
  bytes: Uint8Array,
): readonly TimedNote[] {
  const rows = parseCsvRows(decodeUtf8(bytes, "Basic Pitch note CSV"));
  const header = rows[0]?.map((value) =>
    value.trim().toLowerCase().replace(/^﻿/u, ""),
  );
  if (!header || header.length === 0)
    throw new Error("Basic Pitch note CSV is empty.");
  const startIndex = columnMatch(
    header,
    HEADER_ALIASES.start,
    "onset/start",
  ).index;
  const endIndex = columnMatch(header, HEADER_ALIASES.end, "offset/end").index;
  const pitchIndex = columnMatch(
    header,
    HEADER_ALIASES.pitch,
    "MIDI pitch",
  ).index;
  const amplitudeColumn = columnMatch(
    header,
    HEADER_ALIASES.amplitude,
    "amplitude/velocity",
  );
  const amplitudeIndex = amplitudeColumn.index;
  const confidenceIndex = optionalColumnIndex(
    header,
    HEADER_ALIASES.confidence,
  );
  if (rows.length - 1 > MAX_NOTES)
    throw new Error(`Basic Pitch produced more than ${MAX_NOTES} notes.`);

  const notes: TimedNote[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (
      row[startIndex]?.trim() === "" ||
      row[endIndex]?.trim() === "" ||
      row[pitchIndex]?.trim() === "" ||
      row[amplitudeIndex]?.trim() === ""
    )
      continue;
    const startSeconds = Number(row[startIndex]);
    const endSeconds = Number(row[endIndex]);
    const rawPitch = Number(row[pitchIndex]);
    const amplitude = Number(row[amplitudeIndex]);
    const confidenceText =
      confidenceIndex === undefined ? undefined : row[confidenceIndex]?.trim();
    const confidence =
      confidenceText === undefined || confidenceText === ""
        ? undefined
        : Number(confidenceText);
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      !Number.isFinite(rawPitch) ||
      !Number.isFinite(amplitude) ||
      startSeconds < 0 ||
      endSeconds <= startSeconds ||
      endSeconds > 7_200
    ) {
      continue;
    }
    const pitch = Math.round(rawPitch);
    if (pitch < 0 || pitch > 127) continue;
    // dawg velocities are 0..1; Basic Pitch writes 1..127 under "velocity"
    // and 0..1 under "amplitude".
    const velocity127 =
      amplitudeColumn.alias === "velocity"
        ? clamp(Math.round(amplitude), 1, 127)
        : clamp(Math.round(1 + clamp(amplitude, 0, 1) * 126), 1, 127);
    const velocity = Math.round((velocity127 / 127) * 100) / 100;
    notes.push({
      pitch,
      startSeconds,
      endSeconds,
      velocity,
      ...(confidence === undefined || !Number.isFinite(confidence)
        ? {}
        : { confidence: clamp(confidence, 0, 1) }),
    });
  }
  return notes.sort(
    (left, right) =>
      left.startSeconds - right.startSeconds ||
      left.pitch - right.pitch ||
      left.endSeconds - right.endSeconds ||
      right.velocity - left.velocity,
  );
}

/**
 * Basic Pitch parameters chosen per instrument. Bass and vocals get frequency
 * bounds that exclude bleed outside their register; the polyphonic stems need
 * a firmer onset and a shorter minimum note than Basic Pitch's defaults
 * (onset 0.5, 127.7 ms) so chords stop fragmenting into ghost re-triggers.
 */
export type BasicPitchStemParameters = Readonly<{
  onsetThreshold: number;
  minimumNoteLengthMs: number;
  minimumFrequencyHz?: number;
  maximumFrequencyHz?: number;
}>;

export const PITCHED_KINDS = [
  "bass",
  "vocals",
  "guitar",
  "piano",
  "other",
] as const;
export type PitchedKind = (typeof PITCHED_KINDS)[number];

const DEFAULT_ONSET_THRESHOLD = 0.5;
const DEFAULT_MINIMUM_NOTE_LENGTH_MS = 127.7;
const POLYPHONIC_PARAMETERS: BasicPitchStemParameters = {
  onsetThreshold: 0.6,
  minimumNoteLengthMs: 100,
};

export const BASIC_PITCH_STEM_PARAMETERS: Readonly<
  Record<PitchedKind, BasicPitchStemParameters>
> = {
  bass: {
    onsetThreshold: DEFAULT_ONSET_THRESHOLD,
    minimumNoteLengthMs: DEFAULT_MINIMUM_NOTE_LENGTH_MS,
    minimumFrequencyHz: 30,
    maximumFrequencyHz: 400,
  },
  vocals: {
    onsetThreshold: DEFAULT_ONSET_THRESHOLD,
    minimumNoteLengthMs: DEFAULT_MINIMUM_NOTE_LENGTH_MS,
    minimumFrequencyHz: 80,
    maximumFrequencyHz: 1_100,
  },
  guitar: POLYPHONIC_PARAMETERS,
  piano: POLYPHONIC_PARAMETERS,
  other: POLYPHONIC_PARAMETERS,
};

function numberArgument(value: number): string {
  if (!Number.isFinite(value) || value < 0)
    throw new Error("Basic Pitch parameters must be finite and non-negative.");
  return String(value);
}

/** Command-line form of one parameter set, in a fixed order. */
export function basicPitchParameterArguments(
  parameters: BasicPitchStemParameters,
): readonly string[] {
  return [
    "--onset-threshold",
    numberArgument(parameters.onsetThreshold),
    "--minimum-note-length",
    numberArgument(parameters.minimumNoteLengthMs),
    ...(parameters.minimumFrequencyHz === undefined
      ? []
      : ["--minimum-frequency", numberArgument(parameters.minimumFrequencyHz)]),
    ...(parameters.maximumFrequencyHz === undefined
      ? []
      : ["--maximum-frequency", numberArgument(parameters.maximumFrequencyHz)]),
  ];
}

/** `<name>.wav` → `<name>_basic_pitch`, the stem of Basic Pitch's output files. */
export function basicPitchOutputBase(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return `${dot < 0 ? fileName : fileName.slice(0, dot)}_basic_pitch`;
}
