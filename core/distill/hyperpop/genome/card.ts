/**
 * The song card: what a model (small or large) writes for a generated song.
 * The model brings what it is good at, words and taste: a title, a hook,
 * verse lines, a mood, and any axes the brief names. The seeded genome
 * brings everything else, so the same brief gives a new song every seed
 * and no two songs share a template.
 */
import { MODES, type Mode } from "./theory.ts";
import { FORMS, GRAMMARS, VOICES, type GenomePins } from "./genome.ts";
import type { Content } from "./compose.ts";
import type { Rng } from "./rng.ts";
import type { ChatMessage } from "../prompt.ts";

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
  return {
    ok: true,
    card: {
      title,
      ...(theme ? { theme } : {}),
      hook,
      verses,
      mood,
      pins: pins as SongCard["pins"],
    },
    warnings,
  };
}

/** The genome pins a card asks for. Mood steers the axes it touches. */
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
  let mode = p.mode ?? keyMode;
  if (!mode && m.brightness !== undefined) {
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
  if (!drums && m.energy !== undefined) {
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
    hook: syllables(card.hook),
    verses: card.verses,
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
    },
    required: ["title", "hook", "verses", "mood"],
    additionalProperties: false,
  };
}

export const CARD_GUIDE = `You write the words and the taste for a hyperpop song; a composer writes the music. Reply with one JSON song card.

- title: two or three words, original.
- theme: a word or two for what it is about.
- hook: the chorus words, 6 to 12 syllables, sung again in every drop. Short, vowel-rich, repeatable. Split words into syllables with hyphens ("e-lec-tric").
- verses: 4 to 8 lines, 5 to 10 syllables each, hyphenated the same way. Concrete images, not clichés; each line answers the one before.
- mood: 0 to 1 each. energy (calm to frantic), brightness (dark to sugary), grit (clean to distorted), space (dry to cavernous).
- pins: only what the brief names. bpm 80 to 200; key like "F minor"; mode ${Object.keys(MODES).join(", ")}; voice ${VOICES.join(", ")} (chopped and abstract read as texture; instrumental has no singer); drums ${GRAMMARS.join(", ")}; form ${FORMS.join(", ")}; fugue true for a baroque counterpoint break. Leave a pin out and the composer chooses, which is usually better.

Write original words. Never quote an existing song. One key for the whole song: the composer never changes key.`;

const EXAMPLES: readonly SongCard[] = [
  {
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
  },
  {
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
  },
  {
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
  },
];

/** The chat for a card: the guide, one rotating example, the brief. */
export function cardMessages(
  brief: string,
  seed: number,
  retry?: Readonly<{ reply: string; notes: readonly string[] }>,
): ChatMessage[] {
  const example = EXAMPLES[seed % EXAMPLES.length]!;
  const chat: ChatMessage[] = [
    { role: "system" as const, content: CARD_GUIDE },
    {
      role: "user" as const,
      content: `A card for another brief, to show the shape (do not reuse its words):\n${JSON.stringify(example)}\n\nBrief: ${brief}`,
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
