/** Bounded stock-voice input. No executable code, external speech or paths. */
export const VOCAL_VOICE = "bf_emma" as const;
export const VOCAL_MODEL = Object.freeze({
  repository: "hexgrad/Kokoro-82M",
  revision: "f3ff3571791e39611d31c381e3a41a3af07b4987",
  files: Object.freeze({
    config: "5abb01e2403b072bf03d04fde160443e209d7a0dad49a423be15196b9b43c17f",
    weights: "496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4",
    voice: "d0a423deabf4a52b4f49318c51742c54e21bb89bbbe9a12141e7758ddb5da701",
  }),
});
export const VOCAL_LIMITS = Object.freeze({
  maxSpecBytes: 512 * 1024,
  maxParts: 128,
  maxNotes: 4096,
  maxNotesPerPart: 256,
  maxSeconds: 600,
  maxWavBytes: 32 * 1024 * 1024,
  maxOutputBytes: 64 * 1024,
  timeoutMs: 15 * 60_000,
});

export class VocalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VocalError";
  }
}

export class VocalCancelledError extends VocalError {
  constructor() {
    super("Vocal generation cancelled; accepted takes were kept.");
    this.name = "VocalCancelledError";
  }
}

export type VocalNote = Readonly<{
  syl: string;
  beat: number;
  len: number;
  midi: number;
  scoop?: number;
  fall?: number;
  glide?: number;
  vib?: number;
  dyn?: number;
  air?: number;
  gap?: number;
  legato?: boolean;
}>;
export type VocalSettings = Readonly<{
  formant: number;
  clarity: number;
  speed: number;
  human: number;
  seed: number;
}>;
export type VocalPart = readonly [
  name: string,
  beats: number,
  notes: readonly VocalNote[],
  settings?: Partial<VocalSettings>,
];
export type VocalBookSpec = VocalSettings &
  Readonly<{
    voice: typeof VOCAL_VOICE;
    bpm: number;
    root: number;
    lead: number;
    parts: readonly VocalPart[];
    syllables: readonly string[];
    lines: Readonly<Record<string, number>>;
    heads: readonly string[];
  }>;

export function record(value: unknown, where: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new VocalError(`${where} must be an object`);
  return value as Record<string, unknown>;
}

function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new VocalError(`${where}.${key} is not supported`);
}

export function numberIn(
  value: unknown,
  low: number,
  high: number,
  where: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < low ||
    value > high
  )
    throw new VocalError(`${where} must be a number from ${low} to ${high}`);
  return value;
}

export function vocalName(value: unknown, where: string): string {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(value) ||
    ["constructor", "prototype", "__proto__"].includes(value)
  )
    throw new VocalError(
      `${where} must be a lowercase name of at most 64 letters, digits, dashes or underscores`,
    );
  return value;
}

const SETTINGS = ["formant", "clarity", "speed", "human", "seed"] as const;
function settings(input: Record<string, unknown>): Partial<VocalSettings> {
  const result: { -readonly [K in keyof VocalSettings]?: VocalSettings[K] } =
    {};
  for (const [key, low, high] of [
    ["formant", -12, 12],
    ["clarity", 0.25, 4],
    ["speed", 0.5, 2],
    ["human", 0, 1],
    ["seed", 0, 2147483647],
  ] as const)
    if (input[key] !== undefined)
      result[key] = numberIn(input[key], low, high, key);
  if (result.seed !== undefined && !Number.isInteger(result.seed))
    throw new VocalError("seed must be an integer");
  return result;
}

function syllable(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 48 ||
    !/^(?:[A-Za-z]+(?:'[A-Za-z]+)*-?|~)$/.test(value)
  )
    throw new VocalError(
      "Each syl must be an English syllable, a trailing-hyphen continuation, or ~ for a held vowel",
    );
  return value;
}

/** Parse from unknown and emit a canonical object used for the cache identity. */
export function parseVocalBookSpec(value: unknown): VocalBookSpec {
  const input = record(value, "vocal spec");
  keys(
    input,
    [
      "voice",
      "bpm",
      "root",
      "lead",
      "parts",
      "syllables",
      "lines",
      "heads",
      ...SETTINGS,
    ],
    "vocal spec",
  );
  if (input.voice !== undefined && input.voice !== VOCAL_VOICE)
    throw new VocalError(
      `This backend supports the stock ${VOCAL_VOICE} voice only`,
    );
  const bpm = numberIn(input.bpm, 40, 240, "bpm");
  const root = numberIn(input.root ?? 69, 24, 108, "root");
  const lead = numberIn(input.lead ?? 0.25, 0.08, 1, "lead");
  if (
    !Array.isArray(input.parts) ||
    input.parts.length < 1 ||
    input.parts.length > VOCAL_LIMITS.maxParts
  )
    throw new VocalError(`parts must contain 1–${VOCAL_LIMITS.maxParts} parts`);
  let count = 0;
  let seconds = 0;
  const names = new Set<string>();
  const parts: VocalPart[] = input.parts.map((raw: unknown, index) => {
    if (!Array.isArray(raw) || raw.length < 3 || raw.length > 4)
      throw new VocalError(
        `parts[${index}] must be [name, beats, notes, settings?]`,
      );
    const name = vocalName(raw[0], `parts[${index}].name`);
    if (names.has(name)) throw new VocalError(`Duplicate vocal part: ${name}`);
    names.add(name);
    const beats = numberIn(raw[1], 0.125, 128, `${name}.beats`);
    seconds += ((beats + lead) * 60) / bpm;
    if (
      !Array.isArray(raw[2]) ||
      raw[2].length < 1 ||
      raw[2].length > VOCAL_LIMITS.maxNotesPerPart
    )
      throw new VocalError(
        `${name}.notes must contain 1–${VOCAL_LIMITS.maxNotesPerPart} notes`,
      );
    count += raw[2].length;
    let previousBeat = -Infinity;
    let previousSyllable = "";
    const notes: VocalNote[] = raw[2].map((rawNote: unknown) => {
      const note = record(rawNote, `${name}.note`);
      keys(
        note,
        [
          "syl",
          "beat",
          "len",
          "midi",
          "scoop",
          "fall",
          "glide",
          "vib",
          "dyn",
          "air",
          "gap",
          "legato",
        ],
        `${name}.note`,
      );
      const syl = syllable(note.syl);
      if (syl === "~" && (!previousSyllable || previousSyllable.endsWith("-")))
        throw new VocalError("A ~ note needs a completed syllable before it");
      const beat = numberIn(note.beat, 0, beats, `${name}.beat`);
      const len = numberIn(note.len, 0.03, beats, `${name}.len`);
      if (beat <= previousBeat)
        throw new VocalError(`${name} note beats must increase`);
      if (beat + len > beats + 1e-6)
        throw new VocalError(
          `${name} note extends beyond its part; leave room for the held ending`,
        );
      previousBeat = beat;
      previousSyllable = syl;
      const result: { -readonly [K in keyof VocalNote]: VocalNote[K] } = {
        syl,
        beat,
        len,
        midi: numberIn(note.midi, 24, 108, `${name}.midi`),
      };
      for (const [key, low, high] of [
        ["scoop", -12, 12],
        ["fall", -12, 12],
        ["glide", 0, 1],
        ["vib", 0, 2],
        ["dyn", 0.05, 1.5],
        ["air", 0, 1],
        ["gap", 0, 0.5],
      ] as const)
        if (note[key] !== undefined)
          result[key] = numberIn(note[key], low, high, `${name}.${key}`);
      if (note.legato !== undefined) {
        if (typeof note.legato !== "boolean")
          throw new VocalError("legato must be a boolean");
        result.legato = note.legato;
      }
      return result;
    });
    if (previousSyllable.endsWith("-"))
      throw new VocalError(`${name} ends with an unfinished word`);
    if (raw[3] === undefined) return [name, beats, notes];
    const overrides = record(raw[3], `${name}.settings`);
    keys(overrides, SETTINGS, `${name}.settings`);
    return [name, beats, notes, settings(overrides)];
  });
  if (count > VOCAL_LIMITS.maxNotes || seconds > VOCAL_LIMITS.maxSeconds)
    throw new VocalError(
      `A vocal book is limited to ${VOCAL_LIMITS.maxNotes} notes and ${VOCAL_LIMITS.maxSeconds} seconds; generate smaller books`,
    );
  const list = (raw: unknown, where: string, limit: number): string[] => {
    if (!Array.isArray(raw) || raw.length > limit)
      throw new VocalError(`${where} must be a bounded list of part names`);
    const result = raw.map((name: unknown) => vocalName(name, where));
    if (
      new Set(result).size !== result.length ||
      result.some((name) => !names.has(name))
    )
      throw new VocalError(`${where} must name unique existing parts`);
    return result;
  };
  const syllables = list(input.syllables ?? [], "syllables", 32);
  const lineInput =
    input.lines === undefined
      ? Object.fromEntries(
          parts
            .filter(([name]) => name !== "hold" && !syllables.includes(name))
            .map(([name, beats]) => [name, beats]),
        )
      : record(input.lines, "lines");
  if (Object.keys(lineInput).length > VOCAL_LIMITS.maxParts)
    throw new VocalError("Too many lines");
  const lines: Record<string, number> = {};
  for (const name of Object.keys(lineInput).sort()) {
    vocalName(name, "lines");
    const part = parts.find(([key]) => key === name);
    if (!part || syllables.includes(name) || part[1] !== lineInput[name])
      throw new VocalError(
        `lines.${name} must match the duration of an existing line part`,
      );
    lines[name] = part[1];
  }
  const heads = list(input.heads ?? [], "heads", 3);
  if (heads.some((name) => lines[name] === undefined))
    throw new VocalError("heads must name line parts");
  const result: VocalBookSpec = {
    voice: VOCAL_VOICE,
    bpm,
    root,
    lead,
    formant: 0,
    clarity: 1,
    speed: 1,
    human: 0,
    seed: 0,
    ...settings(input),
    parts,
    syllables,
    lines,
    heads,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > VOCAL_LIMITS.maxSpecBytes)
    throw new VocalError("Vocal spec is too large");
  return result;
}

export function expectedVocalFrames(spec: VocalBookSpec): number {
  return spec.parts.reduce(
    (frames, [, beats]) =>
      frames + Math.round((((beats + spec.lead) * 60) / spec.bpm) * 24000),
    0,
  );
}
