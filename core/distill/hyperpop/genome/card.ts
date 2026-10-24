/**
 * The song card: what a model (small or large) writes for a generated song.
 * The model brings what it is good at, words and taste: a title, a hook,
 * verse lines, a mood, and any axes the brief names. The seeded genome
 * brings everything else, so the same brief gives a new song every seed
 * and no two songs share a template.
 */
import { MODES, scaleOf, type Mode } from "./theory.ts";
import { FORMS, GRAMMARS, VOICES, type GenomePins } from "./genome.ts";
import type { Content } from "./compose.ts";
import type { Rng } from "./rng.ts";
import type { ChatMessage } from "../prompt.ts";
import {
  DROP_BASSES,
  DROP_LEADS,
  PLANS,
  VERSE_BASSES,
  musicSchema,
  readMusic,
  validateMusic,
  type Music,
} from "./music.ts";

export type SongCard = Readonly<{
  title: string;
  /** A word or two for what the song is about. */
  theme?: string;
  /** The hook's words, syllables split by spaces or hyphens: "can-dy rush". */
  hook: string;
  /** Verse lines, the same way. */
  verses: readonly string[];
  /** 0..1 each: drive, light, dirt and room. */
  mood?: Readonly<{
    energy?: number;
    brightness?: number;
    grit?: number;
    space?: number;
  }>;
  /** Axes the brief names; leave out what it doesn't, so the composer surprises. */
  pins?: Readonly<{
    bpm?: number;
    key?: string;
    mode?: Mode;
    voice?: (typeof VOICES)[number];
    drums?: (typeof GRAMMARS)[number];
    form?: (typeof FORMS)[number];
    fugue?: boolean;
  }>;
  /** Chords, motifs and arranging habits, written for the constraints shown. */
  music?: Music;
  /** The brief the card was written for; it seeds the song with the seed. */
  brief?: string;
}>;

const NOTE: Readonly<Record<string, number>> = {
  c: 0,
  "c#": 1,
  db: 1,
  d: 2,
  "d#": 3,
  eb: 3,
  e: 4,
  f: 5,
  "f#": 6,
  gb: 6,
  g: 7,
  "g#": 8,
  ab: 8,
  a: 9,
  "a#": 10,
  bb: 10,
  b: 11,
};

const unit = (x: unknown) =>
  typeof x === "number" && Number.isFinite(x)
    ? Math.max(0, Math.min(1, x))
    : undefined;

/** Syllables from a line: spaces and hyphens split, punctuation goes. */
export function syllables(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\- ]+/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 32);
}

/**
 * Syllables as the singer takes them: a trailing `-` tells the voice the
 * word goes on ("dash-", "board"), as the demos write them.
 */
export function sungSyllables(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\- ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      const parts = word.split("-").filter(Boolean);
      return parts.map((x, i) => (i < parts.length - 1 ? `${x}-` : x));
    })
    .slice(0, 32);
}

export type CardCheck =
  | Readonly<{ ok: true; card: SongCard; warnings: readonly string[] }>
  | Readonly<{ ok: false; errors: readonly string[] }>;

/** Read a card, repairing what can be repaired and naming what was. */
export function validateCard(raw: unknown): CardCheck {
  if (!raw || typeof raw !== "object")
    return { ok: false, errors: ["the card must be a JSON object"] };
  const r = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const title = typeof r.title === "string" ? r.title.trim().slice(0, 40) : "";
  if (!title) return { ok: false, errors: ["title is required"] };
  const hook = typeof r.hook === "string" ? r.hook.trim() : "";
  if (syllables(hook).length < 2)
    return { ok: false, errors: ["hook needs at least two syllables"] };
  const verses = (Array.isArray(r.verses) ? r.verses : [])
    .filter(
      (v): v is string => typeof v === "string" && syllables(v).length > 0,
    )
    .slice(0, 12);
  if (!verses.length)
    warnings.push("no verse lines; the singer will use vocables");
  const m = (r.mood && typeof r.mood === "object" ? r.mood : {}) as Record<
    string,
    unknown
  >;
  const mood = {
    energy: unit(m.energy),
    brightness: unit(m.brightness),
    grit: unit(m.grit),
    space: unit(m.space),
  };
  const p = (r.pins && typeof r.pins === "object" ? r.pins : {}) as Record<
    string,
    unknown
  >;
  const pins: Record<string, unknown> = {};
  if (typeof p.bpm === "number") {
    pins.bpm = Math.round(Math.max(80, Math.min(200, p.bpm)));
    if (pins.bpm !== Math.round(p.bpm))
      warnings.push(`bpm ${p.bpm} moved to ${pins.bpm}`);
  }
  if (typeof p.key === "string") {
    const k = p.key
      .trim()
      .toLowerCase()
      .match(/^([a-g][#b]?)/)?.[1];
    if (k && NOTE[k] !== undefined) pins.key = p.key.trim();
    else
      warnings.push(`key ${p.key} was not a note name; the composer picks one`);
  }
  for (const [name, list] of [
    ["mode", Object.keys(MODES)],
    ["voice", VOICES],
    ["drums", GRAMMARS],
    ["form", FORMS],
  ] as const) {
    const v = p[name];
    if (v === undefined) continue;
    if (typeof v === "string" && (list as readonly string[]).includes(v))
      pins[name] = v;
    else
      warnings.push(
        `${name} ${String(v).slice(0, 20)} is not one of ${list.join(", ")}`,
      );
  }
  if (typeof p.fugue === "boolean") pins.fugue = p.fugue;
  const theme =
    typeof r.theme === "string" ? r.theme.trim().slice(0, 40) : undefined;
  const music = validateMusic(r.music);
  warnings.push(...music.warnings);
  const brief = typeof r.brief === "string" ? r.brief : undefined;
  return {
    ok: true,
    card: {
      title,
      ...(theme ? { theme } : {}),
      hook,
      verses,
      mood,
      pins: pins as SongCard["pins"],
      ...(music.music ? { music: music.music } : {}),
      ...(brief ? { brief } : {}),
    },
    warnings,
  };
}

/**
 * What the brief asks for in so many words. A model tends to pin a tempo, a
 * key or a beat the brief never named, and every pin it adds is an axis the
 * seed no longer varies, so a card keeps only the pins its brief supports.
 */
const ASKS: Readonly<Record<string, RegExp>> = {
  bpm: /\b\d{2,3}\s*(bpm|beats)|\btempo\b|\bbpm\b/,
  key: /\b[a-g](#|b|♯|♭|-sharp|-flat| sharp| flat)?\s*(major|minor|maj|min|m)\b|\bkey of\b|\bin the key\b/,
  mode: /\b(major|minor|dorian|mixolydian|lydian|phrygian)\b/,
  voice:
    /chipmunk|robot|vocoder|whisper|instrumental|no vocals?|chopped|abstract|pitched[- ]up|sung|singer|vocals?\b/,
  drums:
    /jersey|gabber|footwork|trap|two[- ]?step|2[- ]?step|dembow|reggaeton|bounce|glitch|breakbeat|\bbreaks?\b|four[- ]on[- ]the[- ]floor|4[- ]on[- ]the[- ]floor|house|techno/,
  form: /\b(form|structure|drop first|starts? with (a|the) drop|beat switch|slow burn|false ending|miniature|through-composed)\b/,
  fugue: /fugue|counterpoint|baroque|canon/,
};

/** The card with only the pins its brief names. */
export function briefPins(card: SongCard, brief: string): SongCard {
  const text = brief.toLowerCase();
  const pins = Object.fromEntries(
    Object.entries(card.pins ?? {}).filter(([name]) => ASKS[name]?.test(text)),
  );
  return { ...card, pins: pins as SongCard["pins"] };
}

/**
 * The genome pins a card asks for. Mood steers the axes it touches, unless
 * the card wrote music: then the model saw the drawn mode and beats and wrote
 * for them, so mood only shapes the sound.
 */
export function cardPins(card: SongCard, rng: Rng): GenomePins {
  const p = card.pins ?? {};
  const m = card.mood ?? {};
  const key = p.key?.trim().toLowerCase();
  const tonic = key ? NOTE[key.match(/^([a-g][#b]?)/)?.[1] ?? ""] : undefined;
  // "F minor" or "Fm" names the mode too, unless the card pins one.
  const keyMode: Mode | undefined = key
    ? ((/dorian|lydian|mixolydian|phrygian/.exec(key)?.[0] as
        Mode | undefined) ??
      (/m(in)?(or)?\b|m$/.test(key.replace(/^[a-g][#b]?/, ""))
        ? "minor"
        : /maj/.test(key)
          ? "major"
          : undefined))
    : undefined;
  const steer = !card.music;
  let mode = p.mode ?? keyMode;
  if (!mode && steer && m.brightness !== undefined) {
    // Light leans major, lydian and mixolydian; dark leans minor, dorian and phrygian.
    const b = m.brightness;
    mode = rng.weighted<Mode>({
      major: 3 * b,
      lydian: 1.6 * b,
      mixolydian: 1.2 * b,
      minor: 3 * (1 - b),
      dorian: 1.4 * (1 - b) + 0.3,
      phrygian: 0.6 * (1 - b),
    });
  }
  let drums = p.drums;
  if (!drums && steer && m.energy !== undefined) {
    const e = m.energy;
    drums = rng.weighted({
      four: 2,
      break: 1 + 2 * e,
      jersey: 1 + e,
      trap: 2 - e,
      gabber: 2 * e * e,
      footwork: e,
      twostep: 1.5 * (1 - e),
      dembow: 1 - e,
      bounce: 1.5,
      glitch: 1,
    });
  }
  const design = {
    ...(m.brightness !== undefined
      ? { brightness: 0.3 + 0.7 * m.brightness }
      : {}),
    ...(m.grit !== undefined ? { grit: m.grit } : {}),
    ...(m.space !== undefined ? { space: 0.2 + 0.8 * m.space } : {}),
  };
  return {
    ...(p.bpm !== undefined ? { bpm: p.bpm } : {}),
    ...(tonic !== undefined ? { tonic } : {}),
    ...(mode ? { mode } : {}),
    ...(p.voice ? { voice: p.voice } : {}),
    ...(p.form ? { form: p.form } : {}),
    ...(p.fugue !== undefined ? { fugue: p.fugue } : {}),
    ...(drums ? { drums: { main: drums } } : {}),
    ...(Object.keys(design).length ? { design } : {}),
  };
}

/** What the composer takes from the card's words. */
export function cardContent(card: SongCard): Content {
  return {
    title: card.title,
    ...(card.theme ? { theme: card.theme } : {}),
    hook: sungSyllables(card.hook),
    verses: card.verses.map((v) => sungSyllables(v).join(" ")),
    ...(card.music ? { music: card.music } : {}),
  };
}

export function cardSchema(): Record<string, unknown> {
  const u = { type: "number", minimum: 0, maximum: 1 };
  return {
    type: "object",
    properties: {
      title: { type: "string", maxLength: 40 },
      theme: { type: "string", maxLength: 40 },
      hook: { type: "string", maxLength: 120 },
      verses: {
        type: "array",
        items: { type: "string", maxLength: 120 },
        minItems: 2,
        maxItems: 8,
      },
      mood: {
        type: "object",
        properties: { energy: u, brightness: u, grit: u, space: u },
        additionalProperties: false,
      },
      pins: {
        type: "object",
        properties: {
          bpm: { type: "integer", minimum: 80, maximum: 200 },
          key: { type: "string", maxLength: 16 },
          mode: { enum: Object.keys(MODES) },
          voice: { enum: [...VOICES] },
          drums: { enum: [...GRAMMARS] },
          form: { enum: [...FORMS] },
          fugue: { type: "boolean" },
        },
        additionalProperties: false,
      },
      music: musicSchema(),
    },
    required: ["title", "hook", "verses", "mood"],
    additionalProperties: false,
  };
}

export const CARD_GUIDE = `You write a hyperpop song: the words, the taste and the music. A composer has already drawn the constraints (tempo, mode, beats, sections, sounds); you write for them, and an arranger performs what you write. Reply with one JSON song card.

- title: two or three words, original.
- theme: a word or two for what it is about.
- hook: the chorus words, 6 to 12 syllables, sung again in every drop. Short, vowel-rich, repeatable. Split words into syllables with hyphens ("e-lec-tric").
- verses: 4 to 8 lines, 5 to 10 syllables each, hyphenated the same way. Concrete images, not clichés; each line answers the one before.
- mood: 0 to 1 each. energy (calm to frantic), brightness (dark to sugary), grit (clean to distorted), space (dry to cavernous).
- pins: only what the brief names. bpm 80 to 200; key like "F minor"; mode ${Object.keys(MODES).join(", ")}; voice ${VOICES.join(", ")} (chopped and abstract read as texture; instrumental has no singer); drums ${GRAMMARS.join(", ")}; form ${FORMS.join(", ")}; fugue true for a baroque counterpoint break. Pin only what the brief says in words; most briefs name no pins, so most cards have none. A pin the brief does not name is dropped.
- music: the composition, written for the constraints you are given.
  - chords: Roman numerals in the song's mode, 2 to 8 per loop, for drop, verse, pre and bridge. The mode decides each chord's quality, so just write the degree: "vi", "IV", "I", "V". Add 7, 9 or add9 for colour; "V/3" puts the chord's 3rd in the bass for a smooth bass line. Only chords of the mode: no borrowed chords, no key change. Let the drop loop be the strongest and simplest; give the verse a darker or more open loop and the bridge one that is fresh but shares a chord with the drop. The pre should lean toward the drop's first chord.
  - motifs: the cells every melody grows from. rhythm is a grid of 16ths, 16 per bar: x starts a note, - holds it, . is a rest. steps are scale steps from each note to the next (one fewer than the x's), -4 to 4, 0 repeats the note. The hook may be 1, 2 or 4 bars (16, 32 or 64 long) with about one note per hook syllable; verse, pre, bridge and switch motifs are 1 bar. Strong notes land on chord tones for you. A good hook: a short cell that repeats, notes on the off 16ths, mostly steps with one leap, a held last note. Give the verse fewer notes and more rests than the hook, and the bridge longer notes.
  - hookPlan and versePlan: how a 1-bar motif fills 4 bars: A is the motif, A' changes its ending, B and C contrast. ${PLANS.join(", ")}.
  - dropLead (${DROP_LEADS.join(", ")}), dropBass (${DROP_BASSES.join(", ")}), verseBass (${VERSE_BASSES.join(", ")}), leadOctave (the lead doubles the hook an octave up), stabsInDrop (chord stabs on the beat instead of an arp), harmonyThirds (a harmony a third under held words). Leave out what you have no opinion on.

Write original words and music. Never quote an existing song. One key for the whole song: never change key.`;

/**
 * What a card's music gets wrong that the model can fix in another round:
 * a hook rhythm with far fewer notes than the hook has syllables, a grid
 * that is not whole bars, chords outside the mode. The arranger copes with
 * each, so a card that still has them on its last round is used as it is.
 */
export function musicNotes(
  card: SongCard,
  scale = scaleOf(0, card.pins?.mode ?? "major"),
): string[] {
  const music = card.music;
  if (!music) return [];
  const out: string[] = [];
  const hook = music.motifs?.hook;
  const words = sungSyllables(card.hook).length;
  if (hook) {
    const xs = (hook.rhythm.match(/x/gi) ?? []).length;
    if (xs < Math.ceil(words * 0.75))
      out.push(
        `the hook has ${words} syllables but its rhythm has only ${xs} x's; give it about one x per syllable (a 32-long rhythm has room)`,
      );
  }
  for (const [role, m] of Object.entries(music.motifs ?? {})) {
    const len = m.rhythm.replace(/\s+/g, "").length;
    // A short rhythm pads out with rests; a long one loses its tail.
    const longest = role === "hook" ? 64 : 16;
    if (len > longest)
      out.push(
        `the ${role} rhythm is ${len} long but only the first ${longest} play; keep it to ${longest}`,
      );
    const xs = (m.rhythm.match(/x/gi) ?? []).length;
    if (m.steps.length !== Math.max(0, xs - 1))
      out.push(
        `the ${role} motif has ${xs} x's, so it needs ${Math.max(0, xs - 1)} steps, not ${m.steps.length}`,
      );
  }
  out.push(
    ...readMusic({ chords: music.chords }, scale).warnings.filter((w) =>
      /borrowed|not a numeral/.test(w),
    ),
  );
  return out;
}

/** A worked card and the constraints it was written for. */
type Example = Readonly<{ constraints: readonly string[]; card: SongCard }>;

const EXAMPLES: readonly Example[] = [
  {
    constraints: [
      "164 BPM, A minor, no key change",
      "drops: breakbeat; verses: trap",
      "sections: intro, verse, build, drop, break, build, drop, outro",
    ],
    card: {
      title: "Static Bloom",
      theme: "a radio left on all night",
      hook: "sta-tic bloom, sta-tic bloom, ope-ning up",
      verses: [
        "tuned be-tween the sta-tions",
        "a voice I al-most know",
        "an-ten-na on the win-dow",
        "catch-ing what you throw",
      ],
      mood: { energy: 0.6, brightness: 0.4, grit: 0.5, space: 0.8 },
      pins: {},
      music: {
        chords: {
          drop: ["i", "VI", "III", "VII"],
          verse: ["i9", "iv7"],
          pre: ["VI", "VII"],
          bridge: ["iv", "VI", "i/3", "VII"],
        },
        motifs: {
          hook: {
            rhythm: "x.x.x-..x.x.x-..x..x..x.x---....",
            steps: [1, 1, -2, 1, 1, -2, 3, -1, -1],
          },
          verse: { rhythm: "..x.x.x-....x-..", steps: [0, 1, -2] },
          pre: { rhythm: "x-x-x-x-x.x.x.x.", steps: [1, 1, 1, -1, 1, 1, 1] },
          bridge: { rhythm: "x-------x---x---", steps: [-1, -1] },
        },
        versePlan: "AA'AB",
        dropLead: "vox+lead",
        dropBass: "rolling",
        verseBass: "sustain",
        leadOctave: true,
        harmonyThirds: true,
      },
    },
  },
  {
    constraints: [
      "142 BPM, D major, no key change",
      "drops: Jersey club; verses: hyper bounce",
      "sections: drop, verse, build, drop, bridge, build, drop, outro",
    ],
    card: {
      title: "Gum Wrapper",
      theme: "a sugar high at the arcade",
      hook: "pop it, pop it, sil-ver wrap-per",
      verses: [
        "tick-ets spill-ing on the floor",
        "high score blink-ing just for us",
        "pink-er than the last time",
        "chew the sky and blow it up",
      ],
      mood: { energy: 0.85, brightness: 0.95, grit: 0.2, space: 0.3 },
      pins: { voice: "chipmunk" },
      music: {
        chords: {
          drop: ["IV", "V", "vi", "I/3"],
          verse: ["I", "IVadd9"],
          pre: ["ii7", "V"],
          bridge: ["vi", "iii", "IV", "V"],
        },
        motifs: {
          hook: {
            rhythm: "x.x.....x.x.....x.x.x.x-........",
            steps: [2, -2, 2, -3, 1, 1, -2],
          },
          verse: { rhythm: "x.x.x...x.x.....", steps: [1, 1, -1, -1] },
          switch: { rhythm: "x..x..x.x..x..x.", steps: [2, -2, 2, -2, 2] },
        },
        hookPlan: "AAAB",
        versePlan: "ABAB",
        dropLead: "chops+vox",
        dropBass: "syncop",
        stabsInDrop: true,
      },
    },
  },
  {
    constraints: [
      "92 BPM, E dorian, no key change",
      "drops: dembow; verses: dembow",
      "sections: intro, verse, verse, build, drop, fugue, drop, outro",
    ],
    card: {
      title: "Undertow Choir",
      theme: "slow drowning, calm",
      hook: "un-der, un-der, hold me un-der",
      verses: [
        "salt is in the wir-ing",
        "lights go soft and green",
        "count the bub-bles ris-ing",
        "qui-et in be-tween",
      ],
      mood: { energy: 0.35, brightness: 0.2, grit: 0.1, space: 1 },
      pins: { fugue: true },
      music: {
        chords: {
          drop: ["i7", "IV"],
          verse: ["i", "VII", "IV/3", "i"],
          pre: ["iv", "v", "VII"],
          bridge: ["III", "IV", "i"],
        },
        motifs: {
          hook: {
            rhythm: "x-.x-.x.x---....x-.x-.x.x-------",
            steps: [-1, 0, -1, 3, -1, 0, -1],
          },
          verse: { rhythm: "x---..x.x---....", steps: [2, -1] },
          bridge: { rhythm: "x-----x-x-------", steps: [1, -3] },
        },
        versePlan: "AABA",
        dropLead: "vox",
        dropBass: "kick",
        verseBass: "pulse",
        harmonyThirds: true,
      },
    },
  },
];

/**
 * The chat for a card: the guide, one rotating worked example, the
 * constraints the seed drew and the brief.
 */
export function cardMessages(
  brief: string,
  seed: number,
  retry?: Readonly<{ reply: string; notes: readonly string[] }>,
  constraints?: readonly string[],
): ChatMessage[] {
  const example = EXAMPLES[seed % EXAMPLES.length]!;
  const shown = constraints
    ? `Constraints for your song (write the music for these; pin only what the brief names):\n- ${constraints.join("\n- ")}\n\n`
    : "";
  const chat: ChatMessage[] = [
    { role: "system" as const, content: CARD_GUIDE },
    {
      role: "user" as const,
      content: `A card for another brief and other constraints, to show the shape (do not reuse its words or music):\nconstraints: ${example.constraints.join("; ")}\n${JSON.stringify(example.card)}\n\n${shown}Brief: ${brief}`,
    },
  ];
  if (retry)
    chat.push(
      { role: "assistant" as const, content: retry.reply },
      {
        role: "user" as const,
        content: `Fix these and reply with the whole card:\n- ${retry.notes.join("\n- ")}`,
      },
    );
  return chat;
}

/** The worked example cards, for tests and evaluation. */
export const EXAMPLE_CARDS: readonly SongCard[] = EXAMPLES.map((e) => e.card);
