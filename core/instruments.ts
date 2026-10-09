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
type InstrumentWordRow = Readonly<{
  word: string;
  /**
   * Borrow the voice (instrument, field, preset) of this other word's row
   * when it exists; `instrument` is the fallback when it does not.
   */
  voice?: string;
}> &
  InstrumentWord;

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
  // engine), jangle is the rig alias (the guitar lane maps its 12string to the
  // preset; `string jangle` reaches it) and
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
  { word: "motown", instrument: "string", field: "string", preset: "motown" },
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
  // bowed (f061-bowed): bowed presets of the string engine. `cello`,
  // `contrabass` and `strings` stay legacy words (today's voice);
  // `bowed-cello`, `string cello` or `bowed cello` reach the engine.
  { word: "violin", instrument: "string", field: "string", preset: "violin" },
  { word: "viola", instrument: "string", field: "string", preset: "viola" },
  { word: "fiddle", instrument: "string", field: "string", preset: "fiddle" },
  { word: "erhu", instrument: "string", field: "string", preset: "erhu" },
  {
    word: "kamancheh",
    instrument: "string",
    field: "string",
    preset: "kamancheh",
  },
  {
    word: "kemence",
    instrument: "string",
    field: "string",
    preset: "kamancheh",
  },
  { word: "violins", instrument: "string", field: "string", preset: "violins" },
  { word: "violas", instrument: "string", field: "string", preset: "violas" },
  { word: "cellos", instrument: "string", field: "string", preset: "cellos" },
  {
    word: "contrabasses",
    instrument: "string",
    field: "string",
    preset: "contrabasses",
  },
  { word: "pizzicato", instrument: "string", field: "string", preset: "pizz" },
  { word: "tremolo", instrument: "string", field: "string", preset: "trem" },
  {
    word: "bowed-cello",
    instrument: "string",
    field: "string",
    preset: "cello",
  },
  // f06-rig: guitar track aliases, a guitar voice plus a whole rig. The
  // voice is the strings lane's `electric` row (jangle: its 12-string
  // `jangle` preset); the pluck only while that row is absent. Never `lead`
  // or `bass`.
  {
    word: "jangle",
    instrument: "string",
    field: "string",
    preset: "jangle",
    fx: "jangle",
  },
  { word: "punk", instrument: "pluck", voice: "electric", fx: "punk" },
  { word: "funk", instrument: "pluck", voice: "electric", fx: "funk" },
  { word: "ragged", instrument: "pluck", voice: "electric", fx: "ragged" },
  { word: "gtr-lead", instrument: "pluck", voice: "electric", fx: "lead" },
  { word: "gtr-metal", instrument: "pluck", voice: "electric", fx: "metal" },
  { word: "bachata", instrument: "pluck", voice: "electric", fx: "bachata" },
  // granular (f06-granular): the instrument and its texture presets. Each
  // starts from a built-in synth source, so nothing downloads.
  {
    word: "granular",
    instrument: "granular",
    field: "granular",
    preset: "cloud",
  },
  {
    word: "grains",
    instrument: "granular",
    field: "granular",
    preset: "cloud",
  },
  { word: "cloud", instrument: "granular", field: "granular", preset: "cloud" },
  {
    word: "sparkle",
    instrument: "granular",
    field: "granular",
    preset: "sparkle",
  },
  { word: "swarm", instrument: "granular", field: "granular", preset: "swarm" },
  {
    word: "microloop",
    instrument: "granular",
    field: "granular",
    preset: "microloop",
  },
  // keys (f06-piano): modelled pianos. `piano` stays legacy here; the typed
  // surfaces store a new `piano` as `grand` (core/keys.ts `pianoWrite`).
  { word: "grand", instrument: "grand", field: "keys", preset: "grand" },
  { word: "ballad", instrument: "grand", field: "keys", preset: "ballad" },
  { word: "upright", instrument: "upright", field: "keys", preset: "upright" },
  { word: "felt", instrument: "felt", field: "keys", preset: "felt" },
  { word: "lofi", instrument: "felt", field: "keys", preset: "lofi" },
  {
    word: "honkytonk",
    instrument: "honkytonk",
    field: "keys",
    preset: "honkytonk",
  },
  {
    word: "prepared",
    instrument: "prepared",
    field: "keys",
    preset: "prepared",
  },
  // keys (f061-organ): tonewheel, combo and pipe organs on the keys
  // engine. `organ` stays legacy (the sine voice).
  {
    word: "tonewheel",
    instrument: "tonewheel",
    field: "keys",
    preset: "tonewheel",
  },
  {
    word: "hammond",
    instrument: "tonewheel",
    field: "keys",
    preset: "tonewheel",
  },
  { word: "b3", instrument: "tonewheel", field: "keys", preset: "tonewheel" },
  { word: "gospel", instrument: "tonewheel", field: "keys", preset: "gospel" },
  {
    word: "jazzorgan",
    instrument: "tonewheel",
    field: "keys",
    preset: "jazzorgan",
  },
  { word: "combo", instrument: "combo", field: "keys", preset: "combo" },
  { word: "farfisa", instrument: "combo", field: "keys", preset: "combo" },
  { word: "vox", instrument: "combo", field: "keys", preset: "vox" },
  { word: "pipe", instrument: "pipe", field: "keys", preset: "pipe" },
  { word: "church", instrument: "pipe", field: "keys", preset: "pipe" },
  { word: "pipeorgan", instrument: "pipe", field: "keys", preset: "pipe" },
  { word: "churchorgan", instrument: "pipe", field: "keys", preset: "pipe" },
  { word: "flutes", instrument: "pipe", field: "keys", preset: "flutes" },
  { word: "cornet", instrument: "pipe", field: "keys", preset: "cornet" },
  { word: "reeds", instrument: "pipe", field: "keys", preset: "reeds" },
  { word: "celeste", instrument: "pipe", field: "keys", preset: "celeste" },
  // f06-modal: mallets and bells (core/resonators.ts). `marimba` is legacy;
  // `modal` alone gives the modal marimba.
  { word: "modal", instrument: "modal", field: "modal", preset: "marimba" },
  { word: "vibes", instrument: "modal", field: "modal", preset: "vibes" },
  { word: "vibraphone", instrument: "modal", field: "modal", preset: "vibes" },
  {
    word: "xylophone",
    instrument: "modal",
    field: "modal",
    preset: "xylophone",
  },
  { word: "glock", instrument: "modal", field: "modal", preset: "glock" },
  {
    word: "glockenspiel",
    instrument: "modal",
    field: "modal",
    preset: "glock",
  },
  { word: "celesta", instrument: "modal", field: "modal", preset: "celesta" },
  { word: "chimes", instrument: "modal", field: "modal", preset: "chimes" },
  { word: "tubular", instrument: "modal", field: "modal", preset: "chimes" },
  { word: "kalimba", instrument: "modal", field: "modal", preset: "kalimba" },
  {
    word: "thumbpiano",
    instrument: "modal",
    field: "modal",
    preset: "kalimba",
  },
  { word: "mbira", instrument: "modal", field: "modal", preset: "mbira" },
  { word: "steelpan", instrument: "modal", field: "modal", preset: "steelpan" },
  { word: "bowl", instrument: "modal", field: "modal", preset: "bowl" },
  { word: "gong", instrument: "modal", field: "modal", preset: "gong" },
  { word: "gongageng", instrument: "modal", field: "modal", preset: "gong" },
  { word: "timpani", instrument: "modal", field: "modal", preset: "timpani" },
  {
    word: "steeldrum",
    instrument: "modal",
    field: "modal",
    preset: "steelpan",
  },
  { word: "singingbowl", instrument: "modal", field: "modal", preset: "bowl" },
  {
    word: "kettledrum",
    instrument: "modal",
    field: "modal",
    preset: "timpani",
  },
  {
    word: "tubularbells",
    instrument: "modal",
    field: "modal",
    preset: "chimes",
  },
  // keys-electric (0.6.1): electric pianos and clavinet. `keys` stays legacy.
  { word: "epiano", instrument: "epiano", field: "keys", preset: "epiano" },
  { word: "rhodes", instrument: "epiano", field: "keys", preset: "epiano" },
  {
    word: "suitcase",
    instrument: "epiano",
    field: "keys",
    preset: "suitcase",
  },
  { word: "dyno", instrument: "epiano", field: "keys", preset: "dyno" },
  { word: "wurli", instrument: "wurli", field: "keys", preset: "wurli" },
  { word: "wurlitzer", instrument: "wurli", field: "keys", preset: "wurli" },
  { word: "clav", instrument: "clav", field: "keys", preset: "clav" },
  { word: "clavinet", instrument: "clav", field: "keys", preset: "clav" },
  { word: "funkclav", instrument: "clav", field: "keys", preset: "funkclav" },
  // f061-guitar: the shoegaze alias, an electric guitar voice plus the
  // shoegaze rig and its long wash.
  { word: "shoegaze", instrument: "pluck", voice: "electric", fx: "shoegaze" },
  // f061-gamelan-winds: gamelan, small bells and frame drums.
  { word: "crotales", instrument: "modal", field: "modal", preset: "crotales" },
  { word: "crotale", instrument: "modal", field: "modal", preset: "crotales" },
  { word: "musicbox", instrument: "modal", field: "modal", preset: "musicbox" },
  { word: "toypiano", instrument: "modal", field: "modal", preset: "toypiano" },
  { word: "saron", instrument: "modal", field: "modal", preset: "saron" },
  { word: "demung", instrument: "modal", field: "modal", preset: "demung" },
  { word: "slenthem", instrument: "modal", field: "modal", preset: "slenthem" },
  { word: "gangsa", instrument: "modal", field: "modal", preset: "gangsa" },
  { word: "gender", instrument: "modal", field: "modal", preset: "gender" },
  { word: "bonang", instrument: "modal", field: "modal", preset: "bonang" },
  { word: "kenong", instrument: "modal", field: "modal", preset: "kenong" },
  { word: "kethuk", instrument: "modal", field: "modal", preset: "kethuk" },
  { word: "kempul", instrument: "modal", field: "modal", preset: "kempul" },
  { word: "daf", instrument: "modal", field: "modal", preset: "daf" },
  { word: "bodhran", instrument: "modal", field: "modal", preset: "bodhran" },
  { word: "framedrum", instrument: "modal", field: "modal", preset: "bodhran" },
  { word: "tabla", instrument: "modal", field: "modal", preset: "tabla" },
  // f061-gamelan-winds: blown waveguides (core/winds.ts). The legacy word
  // `wind` keeps its tone; these words and their aliases pick a wind preset.
  { word: "flute", instrument: "wind", field: "wind", preset: "flute" },
  { word: "recorder", instrument: "wind", field: "wind", preset: "recorder" },
  { word: "whistle", instrument: "wind", field: "wind", preset: "whistle" },
  { word: "ney", instrument: "wind", field: "wind", preset: "ney" },
  {
    word: "shakuhachi",
    instrument: "wind",
    field: "wind",
    preset: "shakuhachi",
  },
  { word: "panpipe", instrument: "wind", field: "wind", preset: "panpipe" },
  { word: "suling", instrument: "wind", field: "wind", preset: "suling" },
  { word: "bansuri", instrument: "wind", field: "wind", preset: "bansuri" },
  { word: "clarinet", instrument: "wind", field: "wind", preset: "clarinet" },
  {
    word: "bassclarinet",
    instrument: "wind",
    field: "wind",
    preset: "bassclarinet",
  },
  { word: "oboe", instrument: "wind", field: "wind", preset: "oboe" },
  { word: "bassoon", instrument: "wind", field: "wind", preset: "bassoon" },
  { word: "sax", instrument: "wind", field: "wind", preset: "sax" },
  { word: "altosax", instrument: "wind", field: "wind", preset: "altosax" },
  { word: "barisax", instrument: "wind", field: "wind", preset: "barisax" },
  { word: "trumpet", instrument: "wind", field: "wind", preset: "trumpet" },
  { word: "harmon", instrument: "wind", field: "wind", preset: "harmon" },
  { word: "plunger", instrument: "wind", field: "wind", preset: "plunger" },
  { word: "trombone", instrument: "wind", field: "wind", preset: "trombone" },
  { word: "tuba", instrument: "wind", field: "wind", preset: "tuba" },
  { word: "horn", instrument: "wind", field: "wind", preset: "horn" },
  { word: "tinwhistle", instrument: "wind", field: "wind", preset: "whistle" },
  {
    word: "pennywhistle",
    instrument: "wind",
    field: "wind",
    preset: "whistle",
  },
  { word: "nay", instrument: "wind", field: "wind", preset: "ney" },
  { word: "panflute", instrument: "wind", field: "wind", preset: "panpipe" },
  { word: "panpipes", instrument: "wind", field: "wind", preset: "panpipe" },
  { word: "saxophone", instrument: "wind", field: "wind", preset: "sax" },
  { word: "tenorsax", instrument: "wind", field: "wind", preset: "sax" },
  { word: "tenor", instrument: "wind", field: "wind", preset: "sax" },
  { word: "alto", instrument: "wind", field: "wind", preset: "altosax" },
  { word: "bari", instrument: "wind", field: "wind", preset: "barisax" },
  { word: "baritonesax", instrument: "wind", field: "wind", preset: "barisax" },
  { word: "frenchhorn", instrument: "wind", field: "wind", preset: "horn" },
  { word: "mutedtrumpet", instrument: "wind", field: "wind", preset: "harmon" },
  { word: "wahtrumpet", instrument: "wind", field: "wind", preset: "plunger" },
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
  const { word: _word, voice, ...meaning } = row;
  const borrowed =
    voice === undefined
      ? undefined
      : INSTRUMENT_WORDS.find((entry) => entry.word === voice && !entry.voice);
  if (!borrowed) return Object.freeze(meaning);
  return Object.freeze({
    instrument: borrowed.instrument,
    ...(borrowed.field === undefined ? {} : { field: borrowed.field }),
    ...(borrowed.preset === undefined ? {} : { preset: borrowed.preset }),
    ...(meaning.fx === undefined ? {} : { fx: meaning.fx }),
  });
}

/** The `Track.instrument` value a word stores (the word itself if unknown). */
export function instrumentForWord(word: string): string {
  return resolveInstrumentWord(word)?.instrument ?? word;
}
