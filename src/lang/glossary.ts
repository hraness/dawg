/**
 * One vocabulary for dawg: the ten topic ids every door accepts (`/help`,
 * `/guide`, `/menu`), the canonical word for each concept with the words it
 * retired, and the British spellings dawg writes the American way.
 *
 * Retired words keep working wherever they were typed (aliases); they appear
 * in no user-facing text except alias notes. The consistency lint imports
 * TERMS and SPELLING; help, guides and docs are checked against them.
 *
 * Pure data and string helpers, no imports: the site can load it too.
 */

/** The ten topics, in the order every door lists them. */
export const TOPICS = [
  "sound",
  "voice",
  "effects",
  "rhythm",
  "chords",
  "mix",
  "arrange",
  "project",
  "keys",
  "agent",
] as const;

export type TopicId = (typeof TOPICS)[number];

/** One line per topic, for `/help` and the guide index. */
export const TOPIC_SUMMARY: Readonly<Record<TopicId, string>> = {
  sound: "instruments, presets, performance, samples",
  voice: "sing, lyrics, clips, pitch, autotune, formant, vocoder",
  effects: "filter, delay, reverb, guitar rig, shoegaze, more",
  rhythm: "drums, euclid, grid, grooves, kits, sample packs",
  chords: "key, tuning, progressions, chord play",
  mix: "volume, pan, mute, solo, automation, master",
  arrange: "notes, tracks, sections, form, styles",
  project: "transport, tempo, meter, loop, export, undo, sessions",
  keys: "the keys of every screen",
  agent: "model, model key, show-me",
};

/**
 * Old ids and everyday words that open a topic. The left side is what a
 * person may type after `/help`, `/guide` or `/menu`; the right is the
 * topic it opens. A guide or menu node with the same id still wins in its
 * own door (`/guide performance` opens the performance guide).
 */
export const TOPIC_ALIASES: Readonly<Record<string, TopicId>> = {
  // retired topic ids
  music: "arrange",
  session: "project",
  window: "keys",
  // sound
  sounds: "sound",
  instrument: "sound",
  instruments: "sound",
  performance: "sound",
  expression: "sound",
  samples: "sound",
  // voice
  vocal: "voice",
  vocals: "voice",
  sing: "voice",
  clips: "voice",
  lyrics: "voice",
  autotune: "voice",
  formant: "voice",
  vocoder: "voice",
  // effects
  fx: "effects",
  effect: "effects",
  rig: "effects",
  // rhythm
  drums: "rhythm",
  grooves: "rhythm",
  patterns: "rhythm",
  kits: "rhythm",
  packs: "rhythm",
  // chords and key
  key: "chords",
  scale: "chords",
  scales: "chords",
  tuning: "chords",
  progression: "chords",
  // mix
  master: "mix",
  automation: "mix",
  mixer: "mix",
  // arrange
  arrangement: "arrange",
  sections: "arrange",
  form: "arrange",
  style: "arrange",
  styles: "arrange",
  genre: "arrange",
  tracks: "arrange",
  notes: "arrange",
  // project
  transport: "project",
  tempo: "project",
  meter: "project",
  time: "project",
  export: "project",
  files: "project",
  undo: "project",
  // keys
  keyboard: "keys",
  shortcuts: "keys",
  mouse: "keys",
  // agent
  model: "agent",
  models: "agent",
  showme: "agent",
  "show-me": "agent",
  sessions: "project",
  login: "agent",
  ai: "agent",
};

/** A topic id for `word` (an id or an alias), or undefined. */
export function resolveTopic(word: string | undefined): TopicId | undefined {
  const name = (word ?? "").trim().toLowerCase().replace(/^\//, "");
  if ((TOPICS as readonly string[]).includes(name)) return name as TopicId;
  return TOPIC_ALIASES[name];
}

/** Levenshtein distance, small inputs only. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length]!;
}

/**
 * The closest topic id to `word`, comparing against ids and aliases (an
 * alias answers with its topic). Ties go to the earlier topic.
 */
export function nearestTopic(
  word: string,
  extra: readonly string[] = [],
): string | undefined {
  const name = word.trim().toLowerCase().replace(/^\//, "");
  // The same reach as nearestCommand: one edit for a short word, two else.
  const limit = name.length <= 4 ? 1 : 2;
  let best: { id: string; score: number } | undefined;
  const candidates: [string, string][] = [
    ...TOPICS.map((id): [string, string] => [id, id]),
    ...extra.map((id): [string, string] => [id, id]),
    ...Object.entries(TOPIC_ALIASES),
  ];
  for (const [spelling, id] of candidates) {
    const score = distance(name, spelling);
    if (score <= limit && (!best || score < best.score)) best = { id, score };
  }
  return best?.id;
}

/**
 * `no topic X · did you mean Y · /help` for any door; without a near
 * topic, `no topic X · /help`.
 */
export function topicMiss(word: string, extra: readonly string[] = []): string {
  const name = word.trim().replace(/^\//, "");
  const near = nearestTopic(name, extra);
  return near
    ? `no topic ${name} · did you mean ${near} · /help`
    : `no topic ${name} · /help`;
}

/**
 * Guitar presets that `track <name>` still creates (an alias); `rig
 * <name>` is the canonical word for the amp and pedals.
 */
export const GUITAR_TRACK_PRESETS: readonly string[] = [
  "jangle",
  "punk",
  "funk",
  "ragged",
  "gtr-lead",
  "gtr-metal",
  "bachata",
];

/** One concept: its one word, the words it retired, and typed aliases. */
export type Term = Readonly<{
  term: string;
  meaning: string;
  /**
   * Retired words, as phrases matched whole-word in prose. Only phrases
   * that are unambiguous in dawg's text are listed (not "part" or "take").
   */
  losers: readonly string[];
  /** Typed spellings that still work and are documented only as aliases. */
  aliases: readonly string[];
  /**
   * Longer phrases that contain a loser but are canonical (`ctrl-p play
   * mode` holds the loser `ctrl-p play`); they are blanked before matching.
   */
  allowed?: readonly string[];
}>;

export const TERMS: readonly Term[] = [
  { term: "track", meaning: "one instrument line", losers: [], aliases: [] },
  {
    term: "note",
    meaning: "a pitched or drum event",
    losers: [],
    aliases: [],
  },
  {
    term: "drum",
    meaning: "one row of a drum track (kick, snare, hat)",
    losers: ["drum voice", "drum voices"],
    aliases: [],
  },
  {
    term: "sample",
    meaning: "an audio file a sampler plays, or a pack item",
    losers: ["sample voice", "use a sound"],
    aliases: [],
  },
  {
    term: "instrument",
    meaning: "the engine a track plays",
    losers: ["browse sounds"],
    aliases: [],
  },
  {
    term: "preset",
    meaning: "a saved setting of an instrument or effect",
    losers: [],
    aliases: ["presets"],
  },
  {
    term: "sound",
    meaning: "the menu section that shapes the focused track",
    losers: [],
    aliases: [],
  },
  {
    term: "voice",
    meaning:
      "sung or spoken audio: sing, lyrics, clips, pitch, autotune, formant, vocoder",
    losers: [],
    aliases: [],
  },
  {
    term: "register",
    meaning: "an organ stop or combo selection",
    losers: [],
    aliases: [],
  },
  {
    term: "polyphony",
    meaning: "simultaneous grains or notes",
    losers: [],
    aliases: ["voice V"],
  },
  {
    term: "effect",
    meaning: "a processor on a track; fx is only the verb",
    losers: ["FX"],
    aliases: ["fx"],
  },
  {
    term: "lane",
    meaning: "an automation lane only",
    losers: [],
    aliases: [],
  },
  {
    term: "clip",
    meaning: "an audio region on a track",
    losers: [],
    aliases: [],
  },
  {
    term: "section",
    meaning: "a named bar range",
    losers: [],
    aliases: [],
  },
  { term: "form", meaning: "the order of sections", losers: [], aliases: [] },
  {
    term: "style",
    meaning: "a generative song recipe",
    losers: ["genre", "genres"],
    aliases: ["genre"],
  },
  {
    term: "groove",
    meaning: "a ready-made drum pattern",
    losers: ["drum pattern", "drum patterns"],
    aliases: ["pattern"],
  },
  {
    term: "idiom",
    meaning: "the progression flavor chords suggest from",
    losers: [],
    aliases: ["chords style"],
  },
  {
    term: "kit",
    meaning: "a set of drum samples",
    losers: ["drum kit", "drum kits"],
    aliases: [],
  },
  {
    term: "key",
    meaning: "tonic and scale (key A dorian)",
    losers: [],
    aliases: ["scale"],
  },
  {
    term: "tuning",
    meaning: "how pitches are tuned (edo, scl, ratios)",
    losers: ["temperament"],
    aliases: [],
  },
  {
    term: "tempo",
    meaning: "speed, displayed as BPM",
    losers: [],
    aliases: ["bpm"],
  },
  { term: "loop", meaning: "the playback region", losers: [], aliases: [] },
  {
    term: "remove",
    meaning: "delete something",
    losers: [],
    aliases: ["rm", "delete"],
  },
  {
    term: "list",
    meaning: "show choices",
    losers: [],
    aliases: ["presets", "ls"],
  },
  {
    term: "agent",
    meaning: "the optional model that acts in dawg",
    losers: ["AI assistant", "assistant"],
    aliases: [],
  },
  {
    term: "model",
    meaning: "which LLM the agent uses",
    losers: [],
    aliases: ["models"],
  },
  {
    term: "agent key",
    meaning: "the optional provider key, set with model key",
    losers: ["sign in", "sign-in", "signed in", "signs in", "login"],
    aliases: ["login"],
  },
  {
    term: "play",
    meaning: "the transport (Space)",
    losers: [],
    aliases: [],
  },
  {
    term: "play mode",
    meaning: "ctrl-p turns the computer keyboard into an instrument",
    losers: ["keys mode", "keyboard mode", "ctrl-p play", "Ctrl-P play"],
    aliases: [],
    allowed: ["ctrl-p play mode", "Ctrl-P play mode"],
  },
  {
    term: "rig",
    meaning: "a guitar amp and pedal preset (rig jangle)",
    losers: GUITAR_TRACK_PRESETS.map((name) => `track ${name}`),
    aliases: GUITAR_TRACK_PRESETS.map((name) => `track ${name}`),
  },
  {
    term: "sawtooth",
    meaning: "the saw wave, listed once as sawtooth",
    losers: ["saw square", "pluck bass saw"],
    aliases: ["saw"],
  },
  {
    term: "now / next",
    meaning: "prompt modes: send now, or run after the current request",
    losers: ["STEER", "QUEUE"],
    aliases: [],
  },
  {
    term: "range",
    meaning: "bars a to b on one track or all (copy bass 5-6 to 7)",
    losers: [],
    aliases: [],
  },
  {
    term: "clipboard",
    meaning: "what copy without `to` holds until paste (tape c, x, v)",
    losers: [],
    aliases: [],
  },
  {
    term: "pane",
    meaning: "one terminal on a shared session, with a letter and own undo",
    losers: [],
    aliases: [],
  },
];

/** British spellings dawg writes the American way (lowercase keys). */
export const SPELLING: Readonly<Record<string, string>> = {
  centre: "center",
  centred: "centered",
  centres: "centers",
  modelled: "modeled",
  modelling: "modeling",
  behaviour: "behavior",
  behaviours: "behaviors",
  cancelled: "canceled",
  cancelling: "canceling",
  colour: "color",
  colours: "colors",
  coloured: "colored",
  analyse: "analyze",
  analysed: "analyzed",
  analyses: "analyzes",
  labelled: "labeled",
  labelling: "labeling",
  towards: "toward",
  normalise: "normalize",
  normalised: "normalized",
  normalises: "normalizes",
  organise: "organize",
  organised: "organized",
  recognise: "recognize",
  recognised: "recognized",
  realise: "realize",
  optimise: "optimize",
  optimised: "optimized",
  favourite: "favorite",
  favourites: "favorites",
  grey: "gray",
  travelling: "traveling",
  levelled: "leveled",
  signalled: "signaled",
  synthesise: "synthesize",
  synthesised: "synthesized",
  quantise: "quantize",
  quantised: "quantized",
  randomise: "randomize",
  randomised: "randomized",
  customise: "customize",
  initialise: "initialize",
  licence: "license",
  dialogue: "dialog",
  catalogue: "catalog",
};

/** Typed spellings kept for old projects and muscle memory (aliases). */
export const SPELLING_ALIASES: readonly string[] = ["phasercentre"];

/** Whether a line is an alias note, where retired words may appear. */
export function isAliasNote(line: string): boolean {
  return /\balias(es)?\b|\bretired\b|\bold spelling\b/i.test(line);
}

/**
 * Retired words and British spellings in `text`, one finding per hit:
 * `losers` match whole-word (case-sensitive for all-caps losers such as
 * FX), spellings case-insensitively. Alias-note lines are skipped.
 */
export function lintText(text: string): string[] {
  const hits: string[] = [];
  for (const line of text.split("\n")) {
    if (isAliasNote(line)) continue;
    for (const { term, losers, allowed = [] } of TERMS) {
      let text = line;
      for (const phrase of allowed) text = text.split(phrase).join(" ");
      for (const loser of losers) {
        // Case-sensitive, so `FX` is not `fx`; a capital first letter
        // (sentence start) still matches a lowercase loser.
        const escaped = loser.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const first = escaped[0]!;
        const head =
          first.toUpperCase() === first
            ? first
            : `[${first}${first.toUpperCase()}]`;
        const pattern = new RegExp(
          `(?<![\\w/.\`-])${head}${escaped.slice(1)}(?![\\w\`-])`,
        );
        if (pattern.test(text)) hits.push(`${loser} → ${term}: ${line.trim()}`);
      }
    }
    for (const word of line.match(/[A-Za-z]+/g) ?? []) {
      const american = SPELLING[word.toLowerCase()];
      if (american) hits.push(`${word} → ${american}: ${line.trim()}`);
    }
  }
  return hits;
}
