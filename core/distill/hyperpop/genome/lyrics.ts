/**
 * Placeholder words for songs written without a model: a themed lexicon
 * strung through small templates, counted in syllables so every note gets
 * one. A model writing the song replaces these with its own lines.
 */
import type { Rng } from "./rng.ts";

type Lexicon = Readonly<{
  nouns: readonly string[];
  verbs: readonly string[];
  adjs: readonly string[];
}>;

// Hyphens mark syllables.
const THEMES: Readonly<Record<string, Lexicon>> = {
  signal: {
    nouns: [
      "sig-nal",
      "screen",
      "wire",
      "code",
      "pix-el",
      "sta-tic",
      "bat-ter-y",
      "phone",
      "light",
      "loop",
    ],
    verbs: ["call", "glow", "load", "freeze", "spark", "ring", "fade", "sync"],
    adjs: [
      "e-lec-tric",
      "bro-ken",
      "bright",
      "low",
      "wire-less",
      "dig-i-tal",
      "hol-low",
    ],
  },
  sugar: {
    nouns: [
      "sug-ar",
      "can-dy",
      "cher-ry",
      "heart",
      "gum",
      "rib-bon",
      "glit-ter",
      "peach",
    ],
    verbs: ["melt", "pop", "spin", "taste", "shine", "skip", "burst", "kiss"],
    adjs: ["sweet", "pink", "stick-y", "plas-tic", "shi-ny", "sour", "soft"],
  },
  night: {
    nouns: [
      "night",
      "city",
      "street",
      "star",
      "car",
      "neon",
      "moon",
      "high-way",
      "club",
    ],
    verbs: ["run", "drive", "fall", "dance", "burn", "chase", "stay", "go"],
    adjs: ["late", "fast", "wild", "lone-ly", "cold", "gold-en", "blue"],
  },
  ocean: {
    nouns: [
      "o-cean",
      "wave",
      "tide",
      "salt",
      "shore",
      "rain",
      "moon-light",
      "blue",
    ],
    verbs: ["drown", "float", "drift", "sink", "wash", "break", "swim", "rise"],
    adjs: ["deep", "slow", "clear", "end-less", "qui-et", "sil-ver", "wet"],
  },
  space: {
    nouns: [
      "or-bit",
      "comet",
      "plan-et",
      "sky",
      "sat-el-lite",
      "an-gel",
      "halo",
      "star-dust",
    ],
    verbs: ["fly", "float", "fall", "shine", "spin", "turn", "glow", "leave"],
    adjs: ["zero", "weight-less", "dis-tant", "white", "cos-mic", "far", "new"],
  },
  heart: {
    nouns: [
      "heart",
      "name",
      "touch",
      "hand",
      "kiss",
      "mir-ror",
      "face",
      "voice",
    ],
    verbs: ["miss", "want", "need", "hold", "break", "feel", "know", "call"],
    adjs: ["real", "close", "true", "ten-der", "e-mo-tion-al", "all", "on-ly"],
  },
};

export const THEME_NAMES = Object.keys(THEMES);

const VOCABLES = [
  "ah",
  "oh",
  "ooh",
  "ey",
  "la",
  "na",
  "yeah",
  "mm",
  "wo",
  "ha",
];

const syl = (word: string) => word.split("-");

/** A short line of `count` syllables on `theme`. */
export function line(rng: Rng, theme: string, count: number): string[] {
  const t = THEMES[theme] ?? THEMES.signal!;
  const pick = (list: readonly string[]) => syl(rng.pick(list));
  const templates = [
    () => [...pick(t.adjs), ...pick(t.nouns)],
    () => [...pick(t.verbs), "the", ...pick(t.nouns)],
    () => ["I", ...pick(t.verbs), "you"],
    () => [...pick(t.nouns), "on", ...pick(t.nouns)],
    () => ["in", "a", ...pick(t.adjs), ...pick(t.nouns)],
    () => ["I'm", "so", ...pick(t.adjs)],
    () => ["don't", ...pick(t.verbs), "a", "way"],
    () => [...pick(t.verbs), ...pick(t.verbs), ...pick(t.verbs)],
    () => ["make", "me", ...pick(t.verbs)],
    () => [...pick(t.adjs), "and", ...pick(t.adjs)],
  ];
  const out: string[] = [];
  while (out.length < count) out.push(...rng.pick(templates)());
  if (out.length > count) out.length = count;
  // A line that ends mid-word ends on a vowel instead.
  if (count >= 3 && rng.chance(0.35))
    out[count - 1] = rng.pick(["oh", "ah", "yeah"]);
  return out;
}

/** Syllables with no words: the abstract voice. */
export function vocables(rng: Rng, count: number): string[] {
  const pool = rng.shuffle(VOCABLES).slice(0, rng.int(2, 4));
  return Array.from(
    { length: count },
    (_, i) => pool[(i + (i % 3 === 2 ? 1 : 0)) % pool.length]!,
  );
}

/** A title from the theme: two words, title case. */
export function title(rng: Rng, theme: string): string {
  const t = THEMES[theme] ?? THEMES.signal!;
  const word = (list: readonly string[]) => rng.pick(list).replaceAll("-", "");
  const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1);
  const shape = rng.int(0, 2);
  if (shape === 0) return `${cap(word(t.adjs))} ${cap(word(t.nouns))}`;
  if (shape === 1) return `${cap(word(t.nouns))} ${cap(word(t.verbs))}`;
  return cap(word(t.nouns));
}
