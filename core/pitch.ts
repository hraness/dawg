/**
 * Pitch-name helpers shared by the command parser, the SDK and the printer.
 *
 * Names are scientific pitch notation: a letter `A`–`G`, an optional `#` or
 * `b`, and an octave from -1 to 9 (`C4` = 60, `A4` = 69). Parsing is
 * case-insensitive; printing always uses sharps so a name round-trips to the
 * same MIDI number.
 */

const SEMITONES: Readonly<Record<string, number>> = Object.freeze({
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
});

const NAMES = Object.freeze([
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
] as const);

/** MIDI number for a pitch name, or NaN when the name is malformed or out of range. */
export function pitchToMidi(value: string): number {
  if (typeof value !== "string") return Number.NaN;
  const match = value.trim().match(/^([a-gA-G])([#b]?)(-?\d{1,2})$/);
  if (!match) return Number.NaN;
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const midi =
    (Number(match[3]) + 1) * 12 +
    (SEMITONES[match[1]!.toLowerCase()] ?? 0) +
    accidental;
  return midi >= 0 && midi <= 127 ? midi : Number.NaN;
}

/** Pitch name with sharps for a MIDI number 0..127 (`60` → `C4`). */
export function midiToPitch(midi: number): string {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127)
    throw new RangeError(`MIDI pitch out of range: ${String(midi)}`);
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** True when `value` is a MIDI integer 0..127 or a parseable pitch name. */
export function isPitch(value: unknown): value is number | string {
  if (typeof value === "number")
    return Number.isInteger(value) && value >= 0 && value <= 127;
  return typeof value === "string" && Number.isFinite(pitchToMidi(value));
}
