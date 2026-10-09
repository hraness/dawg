/**
 * Instrument words for 0.6: the one place a typed, menu, agent or SDK
 * instrument word turns into what a track stores. Pure and import-free;
 * `core/sdk/v1.ts` carries an exact copy of the section below (run
 * `bun core/sdk/sync-instruments.ts`).
 *
 * Lanes add rows to `INSTRUMENT_WORDS` (one block each, appended). A legacy
 * word always resolves to itself, so stored and typed `piano`, `marimba`,
 * `sitar` keep today's voice; a row can never claim one. With no rows,
 * every word resolves exactly as it did before 0.6.
 */

// ---- instrument words (copied into core/sdk/v1.ts) ----

/** What an instrument word stores on a track. */
type InstrumentWord = Readonly<{
  /** The `Track.instrument` value. */
  instrument: string;
  /** The optional Track field the engine reads (created with defaults). */
  field?: string;
  /** A preset of that engine to apply. */
  preset?: string;
  /** An insert-effect preset to apply with it (rig aliases). */
  fx?: string;
}>;

/** A word and what it means. */
type InstrumentWordRow = Readonly<{ word: string }> & InstrumentWord;

/**
 * Words that keep their pre-0.6 meaning forever: they resolve to
 * themselves, whatever rows the lanes add.
 */
export const LEGACY_WORDS: readonly string[] = Object.freeze([
  "piano",
  "pluck",
  "bass",
  "saw",
  "square",
  "triangle",
  "marimba",
  "wind",
  "cello",
  "contrabass",
  "ebass",
  "sitar",
  "organ",
  "strings",
  "bell",
  "keys",
  "lead",
]);

/** 0.6 instrument words; each lane appends its own block. */
export const INSTRUMENT_WORDS: readonly InstrumentWordRow[] = Object.freeze([
  // strings (f06-strings): plucked presets of the string engine. Legacy
  // sitar/ebass keep today's voice (`string preset sitar` reaches the
  // engine), jangle is the rig alias (12string reaches the preset) and
  // upright is the keys lane's piano (doublebass reaches the preset).
  { word: "nylon", instrument: "string", field: "string", preset: "nylon" },
  { word: "steel", instrument: "string", field: "string", preset: "steel" },
  {
    word: "electric",
    instrument: "string",
    field: "string",
    preset: "electric",
  },
  { word: "slap", instrument: "string", field: "string", preset: "slap" },
  { word: "tanpura", instrument: "string", field: "string", preset: "tanpura" },
  {
    word: "harpsichord",
    instrument: "string",
    field: "string",
    preset: "harpsichord",
  },
  { word: "lute", instrument: "string", field: "string", preset: "lute" },
  { word: "oud", instrument: "string", field: "string", preset: "oud" },
  { word: "setar", instrument: "string", field: "string", preset: "setar" },
  { word: "tar", instrument: "string", field: "string", preset: "tar" },
  { word: "santur", instrument: "string", field: "string", preset: "santur" },
  {
    word: "dulcimer",
    instrument: "string",
    field: "string",
    preset: "dulcimer",
  },
  { word: "koto", instrument: "string", field: "string", preset: "koto" },
  { word: "harp", instrument: "string", field: "string", preset: "harp" },
  { word: "banjo", instrument: "string", field: "string", preset: "banjo" },
  { word: "tres", instrument: "string", field: "string", preset: "tres" },
  {
    word: "requinto",
    instrument: "string",
    field: "string",
    preset: "requinto",
  },
  { word: "acoustic", instrument: "string", field: "string", preset: "steel" },
  { word: "classical", instrument: "string", field: "string", preset: "nylon" },
  { word: "12string", instrument: "string", field: "string", preset: "jangle" },
  {
    word: "bassguitar",
    instrument: "string",
    field: "string",
    preset: "ebass",
  },
  { word: "fender", instrument: "string", field: "string", preset: "ebass" },
  {
    word: "doublebass",
    instrument: "string",
    field: "string",
    preset: "upright",
  },
  {
    word: "cembalo",
    instrument: "string",
    field: "string",
    preset: "harpsichord",
  },
  {
    word: "hammered",
    instrument: "string",
    field: "string",
    preset: "dulcimer",
  },
  { word: "sehtar", instrument: "string", field: "string", preset: "setar" },
]);

/**
 * What an instrument word means: a legacy word is itself, a row word is its
 * row, anything else is undefined (callers keep the word as typed).
 */
export function resolveInstrumentWord(
  word: string,
): InstrumentWord | undefined {
  if (LEGACY_WORDS.includes(word)) return Object.freeze({ instrument: word });
  const row = INSTRUMENT_WORDS.find((entry) => entry.word === word);
  if (!row) return undefined;
  const { word: _word, ...meaning } = row;
  return Object.freeze(meaning);
}

/** The `Track.instrument` value a word stores (the word itself if unknown). */
export function instrumentForWord(word: string): string {
  return resolveInstrumentWord(word)?.instrument ?? word;
}
