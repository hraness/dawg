/** Candy Fault: the hyperpop demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import type { AutomationPoint, NoteInput } from "../score.ts";
import {
  BAR,
  Composer,
  hall,
  lanes,
  orbit,
  room,
  TPB,
  voice,
  type Phrase,
} from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

type Extra = Partial<NoteInput>;
type Harmony = Readonly<{
  /** 808 root. */
  root: number;
  /** Electric-piano voicing around middle C. */
  keys: readonly number[];
  /** Bridge only: the first strike of a suspension bar leaves out the 3rd. */
  sus?: readonly number[];
  /**
   * Supersaw stack for the choruses: open, B2/E3 up to B4, so its top voice
   * (B4 F#4 G#4 A4 across the phrase) sits just under the singer and the
   * 808 owns the bottom.
   */
  saw: readonly number[];
  /** Two short octave stabs above her. */
  stab: readonly number[];
  /**
   * Two five-note chip arpeggio sets (with the 6th or 9th). Across a
   * I-V-vi-IV phrase `lo` walks its top note down a line (E D# C# B) and
   * `hi` walks it up (B C# D# E).
   */
  lo: readonly number[];
  hi: readonly number[];
}>;

const NONE: readonly number[] = [];
const H: Readonly<Record<string, Harmony>> = {
  E: {
    root: 28,
    keys: [54, 56, 59, 63],
    saw: [52, 59, 64, 68, 71],
    stab: [83, 88],
    lo: [85, 88, 92, 95, 100],
    hi: [80, 83, 88, 90, 95],
  },
  B: {
    root: 35,
    keys: [51, 54, 59, 61],
    saw: [47, 54, 59, 63, 66],
    stab: [83, 87],
    lo: [87, 90, 95, 97, 99],
    hi: [83, 87, 90, 95, 97],
  },
  Cm: {
    root: 37,
    keys: [52, 56, 59, 61],
    saw: [52, 56, 61, 64, 68],
    stab: [85, 88],
    lo: [85, 88, 92, 95, 97],
    hi: [88, 92, 95, 97, 99],
  },
  A: {
    root: 33,
    keys: [52, 57, 61, 64],
    saw: [52, 57, 61, 64, 69],
    stab: [85, 88],
    lo: [81, 85, 88, 93, 95],
    hi: [85, 88, 93, 97, 100],
  },
  /** The bVII lift at the end of verse two. */
  D: {
    root: 38,
    keys: [54, 57, 62, 66],
    saw: [54, 57, 62, 66, 69],
    stab: [86, 90],
    lo: [81, 86, 90, 93, 98],
    hi: [86, 90, 93, 98, 100],
  },
  /** Pre-chorus: Aadd9 and two B sus chords (the stack is written in code). */
  A9: {
    root: 33,
    keys: [57, 61, 64, 68],
    saw: NONE,
    stab: NONE,
    lo: [81, 85, 88, 93, 95],
    hi: [85, 88, 93, 97, 100],
  },
  Bs: {
    root: 35,
    keys: [57, 59, 64, 66],
    saw: NONE,
    stab: NONE,
    lo: [87, 90, 95, 97, 99],
    hi: [83, 87, 90, 95, 97],
  },
  Cm7: {
    root: 37,
    keys: [56, 59, 61, 64],
    saw: NONE,
    stab: NONE,
    lo: [85, 88, 92, 95, 97],
    hi: [88, 92, 95, 97, 99],
  },
  Bs2: {
    root: 35,
    keys: [57, 59, 64, 66],
    saw: NONE,
    stab: NONE,
    lo: [87, 90, 95, 97, 99],
    hi: [83, 87, 90, 95, 97],
  },
  // Bridge: a bass line walking down E D# C# B A G# F# then V. The singer
  // and her double carry a 7-6 / 4-3 chain over it, so with the bass they
  // form parallel first-inversion triads; the keys leave the suspended
  // voices alone (no 3rd on the first strike where it would rub).
  E8: {
    root: 40,
    keys: [52, 56, 59, 64],
    saw: NONE,
    stab: NONE,
    lo: NONE,
    hi: NONE,
  },
  BD: {
    root: 39,
    keys: [51, 54, 59, 63],
    saw: NONE,
    stab: NONE,
    lo: NONE,
    hi: NONE,
  },
  Cm8: {
    root: 37,
    keys: [49, 52, 61, 64],
    saw: NONE,
    stab: NONE,
    lo: NONE,
    hi: NONE,
  },
  B8: {
    root: 35,
    keys: [54, 59, 63, 66],
    sus: [54, 59, 66],
    saw: NONE,
    stab: NONE,
    lo: NONE,
    hi: NONE,
  },
  A8: {
    root: 33,
    keys: [52, 57, 61, 64],
    sus: [45, 52, 57],
    saw: NONE,
    stab: NONE,
    lo: NONE,
    hi: NONE,
  },
  EG: {
    root: 32,
    keys: [44, 52, 56, 59],
    saw: NONE,
    stab: NONE,
    lo: NONE,
    hi: NONE,
  },
  /** The borrowed ii half-diminished (F# A C# E), the minor-iv colour. */
  Fh: {
    root: 30,
    keys: [54, 57, 61, 64],
    saw: NONE,
    stab: NONE,
    lo: NONE,
    hi: NONE,
  },
  B7s: {
    root: 35,
    keys: [54, 57, 59, 66],
    saw: NONE,
    stab: NONE,
    lo: NONE,
    hi: NONE,
  },
};

/** One chord name per bar. */
const PROG = [
  ...["E", "E", "A", "B"], // 0 intro
  ...["Cm", "Cm", "A", "A", "E", "E", "B", "B"], // 4 verse 1
  ...["A9", "Bs", "Cm7", "Bs2"], // 12 pre-chorus
  ...["E", "B", "Cm", "A", "E", "B", "Cm", "A"], // 16 chorus 1
  ...["E", "E", "A", "B"], // 24 glitch break
  ...["Cm", "Cm", "A", "A", "E", "E", "D", "D"], // 28 verse 2 (bVII lift)
  ...["A9", "Bs", "Cm7", "Bs2"], // 36 pre-chorus 2
  ...["E", "B", "Cm", "A", "E", "B", "Cm", "A"], // 40 chorus 2
  ...["E8", "BD", "Cm8", "B8", "A8", "EG", "Fh", "B7s"], // 48 bridge
  ...["E", "B", "Cm", "A", "E", "B", "Cm", "A"], // 56 final chorus (lifted to F)
  ...["E", "B", "A", "E"], // 64 outro
] as const;
const BARS = PROG.length;

type Part =
  | "boot"
  | "verse"
  | "lift"
  | "chorus"
  | "glitch"
  | "verse2"
  | "lift2"
  | "return"
  | "bridge"
  | "over"
  | "last";

const PARTS: readonly (readonly [Part, start: number])[] = [
  ["boot", 0],
  ["verse", 4],
  ["lift", 12],
  ["chorus", 16],
  ["glitch", 24],
  ["verse2", 28],
  ["lift2", 36],
  ["return", 40],
  ["bridge", 48],
  ["over", 56],
  ["last", 64],
];
const partOf = (b: number): readonly [Part, inPart: number] => {
  let found = PARTS[0]!;
  for (const entry of PARTS) if (b >= entry[1]) found = entry;
  return [found[0], b - found[1]];
};

/** Diatonic shadows in E major for the backing singer. */
const E_MAJOR = new Set([4, 6, 8, 9, 11, 1, 3]);
const thirdBelow = (pitch: number): number =>
  E_MAJOR.has((pitch - 3 + 120) % 12) ? pitch - 3 : pitch - 4;
const sixthBelow = (pitch: number): number =>
  E_MAJOR.has((pitch - 8 + 120) % 12) ? pitch - 8 : pitch - 9;

/** Scoop into a note from below, the hard-tune snap of a pitched vocal. */
const scoop = (cents = -90, at = 0.12): Extra => ({
  bend: [
    { at: 0, cents },
    { at, cents: 0 },
  ],
});
/** Fall off the end of a held note. */
const fall = (cents = -250, from = 0.7): Extra => ({
  bend: [
    { at: from, cents: 0 },
    { at: 1, cents },
  ],
});

// ── kick patterns (one per bar, cycled) ─────────────────────────────────
const KICK: Readonly<Record<string, readonly string[]>> = {
  verse: [
    "9.....7.........",
    "9.........7...6.",
    "9.....7...5.....",
    "9...........7.8.",
  ],
  lift: [
    "8.......7.......",
    "8.......7.....5.",
    "8...7...8...7...",
    "8...7...8.7.....",
  ],
  chorus: [
    "9...8...9..68...",
    "9...8...9...8..6",
    "9...8..69...8...",
    "9...8...9.7.8.7.",
  ],
  over: [
    "9...8...9..68.6.",
    "9..68...9...8..6",
    "9...8..69..68...",
    "9...8...9.7.8.79",
  ],
  last: ["9.........7.....", "9.....7.........", "", ""],
};

const HATS_HALF = [
  "7.4.6.4.7.4.6.45",
  "7.4.6.4.7.4.6.4.",
  "7.4.6.4.7.4.6.4.",
  "7.4.6.4.7.4.6...",
];
const HATS_DRIVE = [
  "8465846584658466",
  "8465846584658...",
  "8465846584658466",
  "84658465846.....",
];
/** Chorus backbeat with a ghost that moves each bar. */
const SNAP_CHORUS = [
  "....9.......9...",
  "....9.....3.9...",
  "....9.......9..3",
  "....9..3....9...",
];

// ── hook motifs (the plastic pulse lead) ─────────────────────────────────
const MOTIF: Phrase = [
  [0, 76, 0.32, 0.78],
  [0.75, 75, 0.2, 0.63],
  [1, 76, 0.22, 0.66],
  [1.25, 71, 0.42, 0.75],
  [2, 68, 0.34, 0.64],
  [2.75, 71, 0.7, 0.76],
];
/** The motif over A: C# instead of the D# that clashes with the IV chord. */
const MOTIF_IV: Phrase = [
  [0, 76, 0.32, 0.78],
  [0.75, 73, 0.2, 0.63],
  [1.25, 69, 0.42, 0.75],
  [2, 71, 0.34, 0.64],
  [2.75, 73, 0.7, 0.76],
];
/** Answers to the singer only ever climb (hyperpop leads move up). */
const ANSWERS: readonly Phrase[] = [
  [
    [2, 71, 0.22, 0.7],
    [2.25, 75, 0.22, 0.6],
    [2.5, 76, 0.22, 0.7],
    [2.75, 78, 0.22, 0.6],
    [3, 80, 0.85, 0.82],
  ],
  [
    [2, 76, 0.22, 0.68],
    [2.5, 75, 0.2, 0.58],
    [2.75, 76, 0.22, 0.66],
    [3, 78, 0.2, 0.7],
    [3.25, 83, 0.7, 0.84],
  ],
  [
    [2, 80, 0.2, 0.7],
    [2.25, 78, 0.2, 0.58],
    [2.5, 80, 0.2, 0.66],
    [2.75, 83, 0.2, 0.62],
    [3, 85, 0.3, 0.74],
    [3.5, 88, 0.45, 0.84],
  ],
];
/**
 * Verse-two counter-melody: a three-note idea above the singer, answering
 * each sung line in its rest. Verse one's answers climb; these fall, until
 * the last one climbs into the bVII lift.
 */
const COUNTER: Readonly<Record<string, Phrase>> = {
  Cm: [
    [2.5, 76, 0.22, 0.6],
    [3, 75, 0.22, 0.54],
    [3.5, 73, 0.6, 0.62],
  ],
  A: [
    [2.5, 76, 0.22, 0.6],
    [3, 73, 0.22, 0.54],
    [3.5, 69, 0.6, 0.62],
  ],
  E: [
    [2.5, 75, 0.22, 0.6],
    [3, 71, 0.22, 0.54],
    [3.5, 68, 0.6, 0.62],
  ],
  D: [
    [2, 74, 0.22, 0.58],
    [2.5, 78, 0.22, 0.6],
    [3, 81, 0.22, 0.62],
    [3.5, 86, 0.6, 0.66],
  ],
};
/**
 * Chorus hocket: where the singer rests, the chip pluck plays the next
 * syllables of the tune an octave up, so voice and chip add up to one line.
 */
const CHIP: Readonly<Record<string, Phrase>> = {
  // After "oh" resolves on B: the tune continues B G# F# B.
  B: [
    [2, 83, 0.2, 0.74],
    [2.5, 80, 0.2, 0.62],
    [3, 78, 0.2, 0.66],
    [3.5, 83, 0.45, 0.78],
  ],
  // After "circuit" on A: A C# B A G#.
  A: [
    [1.75, 81, 0.2, 0.7],
    [2, 85, 0.2, 0.74],
    [2.5, 83, 0.2, 0.64],
    [2.75, 81, 0.2, 0.62],
    [3, 80, 0.2, 0.6],
    [3.25, 81, 0.2, 0.66],
  ],
};

// ── topline (all lyrics original) ────────────────────────────────────────
type Line = readonly (readonly [bar: number, phrase: Phrase])[];
type Slot = readonly [
  bar: number,
  beat: number,
  pitch: number,
  length: number,
  velocity: number,
];

/** Split lyrics into syllables; a trailing `-` tells the voice the word goes on. */
const syllables = (text: string): string[] =>
  text.split(" ").flatMap((word) => {
    const parts = word.split("-");
    return parts.map((part, i) => (i < parts.length - 1 ? `${part}-` : part));
  });

/** Put syllables on a melody template, one per slot, in time order. */
const withWords = (
  start: number,
  slots: readonly Slot[],
  words: readonly string[],
): Line => {
  if (words.length !== slots.length)
    throw new Error(
      `candy-fault: ${words.length} syllables for ${slots.length} notes`,
    );
  const byBar = new Map<number, Phrase[number][]>();
  slots.forEach(([bar, beat, pitch, length, velocity], i) => {
    const list = byBar.get(start + bar) ?? [];
    list.push([beat, pitch, length, velocity, words[i]!]);
    byBar.set(start + bar, list);
  });
  return [...byBar.entries()].map(([bar, phrase]) => [bar, phrase] as const);
};

/** The verse melody: vi vi IV IV I I V V, a four-line stanza of 7 6 7 7. */
const VERSE_SLOTS: readonly Slot[] = [
  [0, 0.5, 68, 0.42, 0.62],
  [0, 1, 68, 0.7, 0.68],
  [0, 2, 66, 0.42, 0.56],
  [0, 2.5, 68, 0.9, 0.66],
  [0, 3.5, 71, 0.42, 0.62],
  [1, 0, 69, 0.45, 0.64],
  [1, 0.5, 68, 1.7, 0.66],
  [2, 0.5, 64, 0.4, 0.58],
  [2, 1, 69, 0.7, 0.68],
  [2, 2, 68, 0.42, 0.6],
  [2, 2.5, 71, 0.42, 0.64],
  [2, 3, 73, 0.42, 0.66],
  [3, 0, 71, 1.9, 0.72],
  [4, 0.5, 68, 0.4, 0.62],
  [4, 1, 68, 0.4, 0.6],
  [4, 1.5, 71, 0.42, 0.64],
  [4, 2, 73, 0.42, 0.62],
  [4, 2.5, 76, 0.9, 0.74],
  [4, 3.5, 75, 0.45, 0.64],
  [5, 0, 71, 1.8, 0.7],
];
/** Last two bars over V (verse one) or over the borrowed bVII (verse two). */
const VERSE_END_V: readonly Slot[] = [
  [6, 0.5, 71, 0.4, 0.64],
  [6, 1, 73, 0.4, 0.64],
  [6, 1.5, 75, 0.9, 0.74],
  [6, 2.5, 73, 0.42, 0.62],
  [6, 3, 71, 0.42, 0.62],
  [6, 3.5, 73, 0.45, 0.66],
  [7, 0, 75, 1.5, 0.76],
];
const VERSE_END_VII: readonly Slot[] = [
  [6, 0.5, 69, 0.4, 0.64],
  [6, 1, 71, 0.4, 0.64],
  [6, 1.5, 74, 0.9, 0.74],
  [6, 2.5, 71, 0.42, 0.62],
  [6, 3, 69, 0.42, 0.62],
  [6, 3.5, 71, 0.45, 0.66],
  [7, 0, 74, 1.5, 0.76],
];
const VERSE_ONE = withWords(
  4,
  [...VERSE_SLOTS, ...VERSE_END_V],
  syllables(
    "Pink light on low bat-ter-y I keep you in my cache Sug-ar on the cir-cuit board ev-ery kiss a lit-tle crash",
  ),
);
const VERSE_TWO = withWords(
  28,
  [...VERSE_SLOTS, ...VERSE_END_VII],
  syllables(
    "Blue screen in the morn-ing light you're buf-fer-ing my heart Can-dy coat-ed er-ror code I don't want it to re-start",
  ),
);

/** Pre-chorus: a rising line that ends on the 7th of V, unresolved. */
const lift = (bar: number): Line => [
  [
    bar,
    [
      [0, 73, 0.4, 0.66, "Turn"],
      [0.5, 73, 0.4, 0.62, "it"],
      [1, 76, 0.9, 0.74, "up"],
      [2, 73, 0.4, 0.62, "un"],
      [2.5, 76, 0.4, 0.66, "til"],
      [3, 78, 0.42, 0.7, "it"],
    ],
  ],
  [bar + 1, [[0, 78, 1.6, 0.78, "breaks"]]],
  [
    bar + 2,
    [
      [0, 76, 0.7, 0.7, "Hold"],
      [1, 78, 0.7, 0.74, "on"],
      [2, 80, 1.2, 0.8, "tight"],
      [3.5, 78, 0.45, 0.72, "to"],
    ],
  ],
  [
    bar + 3,
    [
      [0, 81, 2.4, 0.86, "me"],
      // The beat repeat: the last syllable re-fired in sixteenths.
      [2.5, 81, 0.2, 0.8, "me"],
      [2.75, 81, 0.2, 0.74, "me"],
      [3, 81, 0.2, 0.68, "me"],
      [3.25, 81, 0.18, 0.62, "me"],
    ],
  ],
];

/**
 * "We glow in the static, oh": the title line. "Glow" lands on the 9th
 * over I and resolves down to the root; "oh" is the 9th over V resolving
 * to its root. `flip` answers with a second "oh" that climbs instead.
 */
function lineA(bar: number, pickup: boolean, flip: boolean): Line {
  return [
    ...(pickup ? ([[bar - 1, [[3.5, 71, 0.45, 0.72, "We"]]]] as const) : []),
    [
      bar,
      [
        ...(pickup
          ? ([
              [0, 78, 0.5, 0.86, "glow"],
              [0.5, 76, 1, 0.8, "_"],
            ] as const)
          : ([
              [0, 71, 0.4, 0.8, "We"],
              [0.5, 78, 0.4, 0.86, "glow"],
              [0.9, 76, 0.6, 0.8, "_"],
            ] as const)),
        [1.5, 73, 0.4, 0.7, "in"],
        [2, 75, 0.4, 0.72, "the"],
        [2.5, 76, 0.9, 0.84, "sta-"],
        [3.5, 75, 0.45, 0.72, "tic"],
      ],
    ],
    [
      bar + 1,
      flip
        ? [
            [0, 73, 0.75, 0.84, "oh"],
            [0.75, 71, 0.5, 0.76, "_"],
            [1.5, 78, 1, 0.88, "oh"],
          ]
        : [
            [0, 73, 1, 0.86, "oh"],
            [1, 71, 1, 0.8, "_"],
          ],
    ],
  ];
}

/** "Sweet as a short circuit" (six syllables) or "Sugar rush on a live wire" (seven). */
function lineB(bar: number, words: readonly string[]): Line {
  const w = (i: number) => words[i]!;
  const head: Phrase =
    words.length === 6
      ? [
          [0.5, 76, 0.5, 0.76, "_"],
          [1, 73, 0.4, 0.7, w(1)],
          [1.5, 76, 0.4, 0.68, w(2)],
          [2, 80, 0.9, 0.84, w(3)],
          [3, 78, 0.85, 0.76, w(4)],
        ]
      : [
          [0.5, 76, 0.45, 0.76, w(1)],
          [1, 73, 0.9, 0.8, w(2)],
          [2, 76, 0.4, 0.68, w(3)],
          [2.5, 78, 0.4, 0.7, w(4)],
          [3, 80, 0.85, 0.84, w(5)],
        ];
  return [
    // The first word is sung on the and-of-four over V and held into the
    // vi bar: a prepared 4-3 that resolves on the half beat.
    [bar - 1, [[3.5, 78, 1, 0.84, w(0)]]],
    [bar, head],
    [bar + 1, [[0, 76, 1.5, 0.8, w(words.length - 1)]]],
  ];
}

/** The closing line with the section's one peak on "pix"; `stutter` chops it. */
function lineC(
  bar: number,
  words: readonly string[],
  stutter: boolean,
  end: number,
): Line {
  const w = (i: number) => words[i]!;
  return [
    [
      bar,
      [
        [0, 80, 0.7, 0.86, w(0)],
        [0.75, 80, 0.6, 0.8, w(1)],
        [1.5, 78, 0.4, 0.72, w(2)],
        [2, 76, stutter ? 0.22 : 0.4, 0.72, w(3)],
        ...(stutter
          ? ([
              [2.25, 83, 0.2, 0.84, w(4).replace(/-$/, "")],
              [2.5, 83, 0.2, 0.74, w(4).replace(/-$/, "")],
              [2.75, 83, 0.2, 0.8, w(4)],
            ] as const)
          : ([[2.5, 83, 0.45, 0.9, w(4)]] as const)),
        [3, end + 2, 1.5, 0.84, w(5)],
      ],
    ],
    [bar + 1, [[0.5, end, 0.5, 0.72, "_"]]],
  ];
}

/**
 * The bridge: a lament. Each word is held across the bar line so it becomes
 * a 7th over the new bass note, then steps down to the 6th: a 7-6 chain
 * over E D# C# B A G#, then the borrowed ii half-diminished and a 4-3 on V.
 */
const BRIDGE: Line = [
  [
    48,
    [
      [0.5, 73, 1, 0.5, "Slow"],
      [1.5, 73, 3.5, 0.54, "down"],
    ],
  ],
  [
    49,
    [
      [1, 71, 2.5, 0.5, "_"],
      [3.5, 71, 1.5, 0.5, "let"],
    ],
  ],
  [
    50,
    [
      [1, 69, 2.5, 0.48, "_"],
      [3.5, 69, 1.5, 0.5, "the"],
    ],
  ],
  [
    51,
    [
      [1, 68, 2.5, 0.48, "_"],
      [3.5, 68, 1.5, 0.52, "col-"],
    ],
  ],
  [
    52,
    [
      [1, 66, 2.5, 0.5, "ors"],
      [3.5, 66, 1.5, 0.52, "run"],
    ],
  ],
  [53, [[1, 64, 2.5, 0.5, "_"]]],
  [
    54,
    [
      [0.5, 69, 0.4, 0.52, "Hold"],
      [1, 71, 0.4, 0.54, "the"],
      [1.5, 73, 1, 0.58, "light"],
      [2.5, 73, 0.4, 0.56, "till"],
      [3, 76, 0.4, 0.58, "it's"],
      [3.5, 76, 1.5, 0.64, "un-"],
    ],
  ],
  [55, [[1, 75, 1.4, 0.62, "done"]]],
];

/**
 * The bridge double sings the 10th above the walking bass, a 4th under the
 * singer: G# F# E D# C# B over D# C# B A G#. Each note is held across the
 * bar line like hers, so her 7-6 and its 4-3 resolve together on beat two
 * and voice, double and bass move as parallel first-inversion triads.
 */
const BRIDGE_HARM: Line = [
  [48, [[1.5, 68, 3.5, 0.5, "down"]]],
  [
    49,
    [
      [1, 66, 2.5, 0.48, "_"],
      [3.5, 66, 1.5, 0.48, "let"],
    ],
  ],
  [
    50,
    [
      [1, 64, 2.5, 0.46, "_"],
      [3.5, 64, 1.5, 0.48, "the"],
    ],
  ],
  [
    51,
    [
      [1, 63, 2.5, 0.46, "_"],
      [3.5, 63, 1.5, 0.5, "col-"],
    ],
  ],
  [
    52,
    [
      [1, 61, 2.5, 0.48, "ors"],
      [3.5, 61, 1.5, 0.5, "run"],
    ],
  ],
  [53, [[1, 59, 2.5, 0.48, "_"]]],
];

const LAST: Line = [
  [
    64,
    [
      [0.5, 68, 0.45, 0.5, "We"],
      [1, 71, 1.4, 0.56, "glow"],
    ],
  ],
  [
    65,
    [
      [0.5, 73, 0.4, 0.5, "in"],
      [1, 75, 0.4, 0.5, "the"],
      [1.5, 76, 1, 0.56, "sta-"],
      [2.5, 75, 0.45, 0.5, "tic"],
    ],
  ],
  [66, [[0, 76, 5.5, 0.56, "oh"]]],
];

const chorusLines = (c: number, second: boolean, stutter: boolean): Line => [
  ...lineA(c, c !== 56, false),
  ...lineB(
    c + 2,
    syllables(
      second ? "Su-gar rush on a live wire" : "Sweet as a short cir-cuit",
    ),
  ),
  ...lineA(c + 4, true, true),
  ...lineC(
    c + 6,
    syllables(second ? "Burn me sweet-er high-er" : "Break me in-to pix-els"),
    stutter,
    78,
  ),
];
const CHORUS_ONE = chorusLines(16, false, false);
const CHORUS_TWO = chorusLines(40, true, false);
/**
 * The final chorus lands: its last bar turns to the tonic at the half bar,
 * so her held F# becomes a 9th over E and steps down to the root.
 */
const OVERLOAD: Line = chorusLines(56, false, true).map(
  (entry): Line[number] =>
    entry[0] === 63
      ? [
          63,
          [
            [0.5, 78, 2, 0.74, "_"],
            [2.5, 76, 1.5, 0.8, "_"],
          ],
        ]
      : entry,
);

/** Step automation: each value holds until the next listed bar, then jumps. */
const steps = (
  ...points: readonly (readonly [bar: number, value: number])[]
): AutomationPoint[] =>
  points.flatMap(([bar, value], i) =>
    i === 0
      ? [{ tick: Math.round(bar * BAR), value }]
      : [
          { tick: Math.round(bar * BAR) - 1, value: points[i - 1]![1] },
          { tick: Math.round(bar * BAR), value },
        ],
  );

/** Short dub throws on the last word of each line (dotted-eighth delay). */
function throws(bars: readonly number[], base: number, peak: number) {
  const points: AutomationPoint[] = [{ tick: 0, value: base }];
  for (const bar of bars)
    points.push(
      { tick: Math.round(bar * BAR), value: base },
      { tick: Math.round((bar + 0.02) * BAR), value: peak },
      { tick: Math.round((bar + 0.55) * BAR), value: peak },
      { tick: Math.round((bar + 0.62) * BAR), value: base },
    );
  return points;
}

/**
 * A lane that rests at `base` and sweeps to `peak` over each listed bar
 * (`from` to `to` within it), snapping back to `base` at the next bar.
 */
function sweeps(
  base: number,
  peak: number,
  bars: readonly number[],
  from = 0,
  to = 1,
): AutomationPoint[] {
  const points: AutomationPoint[] = [{ tick: 0, value: base }];
  for (const bar of bars)
    points.push(
      { tick: Math.round((bar + from) * BAR), value: base },
      { tick: Math.round((bar + to) * BAR) - 1, value: peak },
      { tick: Math.round((bar + to) * BAR), value: base },
    );
  return points;
}

export const candyFault: DemoDefinition = {
  info: demoInfo({
    id: "candy-fault",
    title: "Candy Fault",
    style: "Hyperpop",
    description:
      "A sugar-rush hyperpop single: a pitched-up machine singer whose hook lands on 9ths and resolves, a chip pluck that finishes her lines, two interlocking chip arpeggios, a distorted 808 that slides between roots and pops an octave at phrase ends, a kick-less glitch break, a Rhodes bridge sung as a 7-6 chain over a falling bass, then a silent beat that slams the final chorus up a half step and lands it on the tonic.",
    tempoBpm: 156,
    key: "E",
    bars: BARS,
    highlightBar: 56,
    trackId: "chops",
    features: [
      "original verses, pre-choruses, three choruses, a glitch break and a bridge",
      "hook appoggiaturas on the downbeat and a 9th that resolves",
      "vocal and chip pluck hocket: the chip plays where the singer rests",
      "two interlocking chip arpeggios on complementary sixteenths",
      "an open supersaw stack under the singer with octave stabs that grow from two a bar to four",
      "a sung 7-6 suspension chain over a descending bass, doubled a 10th above the bass",
      "pre-chorus 9-8 and 4-3 suspensions with a crush sweep and beat repeat",
      "808 phrasing: slides, held roots, passing tones, octave pops and a tape-stop power-down",
      "stutter ramps, pitched chop jumps and a half-step lift after a silent beat",
      "a different fill at every phrase end and a final chorus that lands on the tonic under a crash",
    ],
    arrangement: [
      "Boot sparkle 4",
      "Half-time 8",
      "Sugar lift 4",
      "Bright fault 8",
      "Glitch break 4",
      "Second cache 8",
      "Second lift 4",
      "Fault return 8",
      "Soft reset 8",
      "Overload 8",
      "Last pixel 4",
    ],
    mixNotes: [
      "The 808 follows the kick but phrases across the bar: one verse bar in four holds its root, the octave pop comes only before the phrase-end IV, vi and I are reached by step, IV from a half step below, and it rests on beat three under 'oh'; in the bridge it walks down alone, E to F#, under the Rhodes.",
      "The singer is pitched bright with a formant lift; a softer double sings thirds below (in the bridge, the 10th above the walking bass, so her 7-6 and its 4-3 resolve together) and a thin octave-up double joins every line of the final chorus; dotted-eighth delay throws catch the last word of each line.",
      "Two chip arps split the sixteenths, the square on the beat and the pulse between, with inversions that walk the top note down then up each phrase; the plastic pulse hook finishes the singer's lines, owns the fourth bar of each chorus phrase, and answers verse two an octave above her.",
      "The pre-chorus supersaw sits close under the singer (A3 to D#5) with its top voice climbing A4 B4 C#5 D#5 into the drop; the chorus opens the stack to E3..B4 so her line stays clear, with octave stabs above her from chorus one (two a bar, then four) and a held top voice in the Overload; the Rhodes voicings in the verses top out under her lowest notes.",
      "The pre-chorus bit-crushes and formant-shifts into a stuttered 'me' before the 808 lets go for the drop; the glitch break drops the kick for four bars of stuttered syllables and ends on a tape stop. Every phrase end gets its own fill (a tom climb in chorus one, a hats-only glitch fill in chorus two's dropout bar, a 32nd ratchet in the Overload), and the drums leave a half-bar hole under the Overload's stuttered 'pix-els' before the landing. After one beat of silence the final chorus jumps from E to F, detunes the supersaw from pretty to harsh and stutters the hook; its last bar turns to the tonic on beat three under a crash, her held F# becoming a 9th that resolves, and the song powers down with the 808 and the last chip fragment diving an octave.",
    ],
  }),
  build() {
    const s = new Composer(candyFault.info);
    for (const [name, start, bars] of [
      ["Boot sparkle", 0, 4],
      ["Half-time", 4, 8],
      ["Sugar lift", 12, 4],
      ["Bright fault", 16, 8],
      ["Glitch break", 24, 4],
      ["Second cache", 28, 8],
      ["Second lift", 36, 4],
      ["Fault return", 40, 8],
      ["Soft reset", 48, 8],
      ["Overload", 56, 8],
      ["Last pixel", 64, 4],
    ] as const)
      s.section(name, start, bars);
    s.track(
      // A short clicky kick; the 808 track owns everything under 60 Hz.
      voice("kick", "Rubber kick", "kit", 0.55, {
        kit: "syn707",
        fx: { duck: { orbit: 2, depth: 0.55, attack: 0.1 } },
      }),
    );
    s.track(
      voice("snap", "Snap & clap", "kit", 0.3, {
        kit: "synlinn",
        reverb: { mix: 0.08, size: 0.25, fade: 0.5 },
        humanize: { timing: 2, velocity: 4, seed: 11 },
      }),
    );
    s.track(
      voice("hats", "Needle hats", "kit", 0.72, {
        kit: "syn909",
        pan: 0.14,
        // Each chorus pass is a little bigger than the last.
        volumeAutomation: steps(
          [0, 0.86],
          [16, 0.88],
          [24, 0.7],
          [28, 0.86],
          [40, 1],
          [56, 1],
          [64, 0.86],
        ),
        humanize: { timing: 3, velocity: 6, seed: 12 },
      }),
    );
    s.track(
      voice("sub", "Bending sub", "sine", 0.58, {
        synth: {
          attack: 0.003,
          decay: 0.45,
          sustain: 0.7,
          release: 0.07,
          lpf: 950,
        },
        fx: {
          ...orbit,
          distort: { type: "soft", drive: 2.2, tone: 1900, mix: 0.42 },
        },
      }),
    );
    s.track(
      voice("hook", "Plastic hook", "pulse", 0.45, {
        pan: 0.08,
        synth: {
          attack: 0.003,
          decay: 0.1,
          sustain: 0.32,
          release: 0.08,
          pw: 0.22,
          lpf: 6500,
        },
        filter: { type: "hpf", cutoff: 200, resonance: 0 },
        fx: {
          ...orbit,
          distort: { type: "fold", drive: 1.2, mix: 0.28, tone: 6200 },
        },
        delay: { beats: 0.75, feedback: 0.24, mix: 0.14, pingpong: true },
        reverb: room,
        humanize: { timing: 3, velocity: 5, seed: 13 },
        fxAutomation: {
          "synth-pw": lanes(
            [0, 0.22],
            [16, 0.37],
            [23, 0.18],
            [28, 0.3],
            [40, 0.28],
            [56, 0.42],
            [63, 0.12],
            [68, 0.3],
          ),
        },
      }),
    );
    s.track(
      voice("keys", "Soft reset keys", "rhodes", 0.4, {
        pan: -0.18,
        reverb: hall,
        humanize: { timing: 8, velocity: 6, length: 6, seed: 14 },
      }),
    );
    s.track(
      voice("chords", "Sugar stack", "supersaw", 0.5, {
        synth: {
          attack: 0.012,
          decay: 0.35,
          sustain: 0.55,
          release: 0.14,
          unison: 7,
          detune: 0.28,
          spread: 0.9,
          lpf: 5200,
        },
        filter: { type: "hpf", cutoff: 160, resonance: 0 },
        reverb: room,
        fx: { ...orbit, crush: { bits: 16, coarse: 1, mix: 0 } },
        volumeAutomation: steps([0, 0.8], [40, 0.9], [56, 1]),
        fxAutomation: {
          "synth-lpf": lanes(
            [0, 5200],
            [12, 900],
            [15.9, 5200],
            [36, 900],
            [39.9, 5600],
            [56, 6400],
            [68, 6400],
          ),
          // A. G. Cook's move: one layer drifts from pretty to harsh.
          "synth-detune": lanes(
            [0, 0.26],
            [40, 0.32],
            [56, 0.4],
            [63.5, 0.85],
            [64, 0.3],
          ),
          // The crush sweeps in over the last pre-chorus bar, clean on the drop.
          "crush-bits": sweeps(16, 3, [15, 39], 0.25, 1),
          "crush-mix": sweeps(0, 0.85, [15, 39], 0.25, 1),
        },
      }),
    );
    s.track(
      voice("arp", "Chip arp", "square", 0.5, {
        pan: -0.24,
        synth: {
          attack: 0.002,
          decay: 0.09,
          sustain: 0.12,
          release: 0.05,
          lpf: 7500,
        },
        filter: { type: "hpf", cutoff: 600, resonance: 0 },
        // Dotted-eighth pingpong plus a slow chorus: the arp cascades side to side.
        delay: { beats: 0.75, feedback: 0.3, mix: 0.22, pingpong: true },
        fx: {
          ...orbit,
          chorus: { rate: 0.45, depth: 0.35, mix: 0.45 },
          crush: { bits: 16, coarse: 1, mix: 0 },
        },
        volumeAutomation: steps([0, 0.82], [40, 0.9], [56, 1]),
        fxAutomation: {
          // The glitch break bit-crushes the arp deeper bar by bar.
          "crush-bits": lanes([0, 16], [24, 12], [27.9, 4], [28, 16], [68, 16]),
          "crush-mix": lanes([0, 0], [24, 0.5], [27.9, 0.9], [28, 0], [68, 0]),
        },
        humanize: { timing: 2, velocity: 6, seed: 18 },
      }),
    );
    s.track(
      voice("arp2", "Pulse arp", "pulse", 0.42, {
        pan: 0.3,
        synth: {
          attack: 0.002,
          decay: 0.08,
          sustain: 0.1,
          release: 0.05,
          pw: 0.33,
          lpf: 7000,
        },
        filter: { type: "hpf", cutoff: 700, resonance: 0 },
        delay: { beats: 0.5, feedback: 0.22, mix: 0.16, pingpong: true },
        fx: orbit,
        volumeAutomation: steps([0, 0.85], [56, 1]),
        humanize: { timing: 2, velocity: 6, seed: 19 },
      }),
    );
    s.track(
      voice("vocal", "Candy singer", "sing", 0.76, {
        sing: {
          preset: "aah",
          voice: "soprano",
          formant: 2.5,
          bright: 0.72,
          articulate: 1,
          breath: 0.06,
          jitter: 0.25,
          vib: 5.6,
          vibmod: 0.14,
          vibdelay: 0.3,
          ring: 0.38,
        },
        filter: { type: "hpf", cutoff: 230, resonance: 0 },
        fx: { crush: { bits: 16, coarse: 1, mix: 0 } },
        delay: { beats: 0.75, feedback: 0.28, mix: 0.08 },
        delayMixAutomation: throws(
          [13, 17, 19, 21, 23, 37, 41, 43, 45, 47, 49, 51, 57, 59, 61, 63],
          0.07,
          0.34,
        ),
        fxAutomation: {
          // Formant lifts through the pre-chorus peak; wobbles through the break.
          "sing-formant": [
            ...lanes([0, 2.5], [15.5, 2.5], [15.95, 7], [16, 2.5]),
            ...lanes(
              [24, 2.5],
              [25, -2],
              [26, 6],
              [27, -1],
              [27.9, 5],
              [28, 2.5],
            ),
            ...lanes(
              [39.5, 2.5],
              [39.95, 7],
              [40, 2.5],
              [55, 2.5],
              [55.6, 5.5],
              [56, 2.5],
            ),
          ],
          "crush-mix": lanes(
            [0, 0],
            [24, 0.2],
            [26, 0.6],
            [27.9, 0.7],
            [28, 0],
          ),
          "crush-bits": lanes([0, 16], [24, 10], [27.9, 5], [28, 16]),
        },
        reverb: room,
        humanize: { timing: 6, velocity: 5, length: 4, seed: 16 },
      }),
    );
    s.track(
      voice("harm", "Candy double", "sing", 0.55, {
        pan: 0.32,
        sing: {
          preset: "aah",
          voice: "alto",
          formant: 2,
          bright: 0.55,
          articulate: 1,
          breath: 0.12,
          voices: 3,
          spread: 14,
          vib: 5.2,
          vibmod: 0.1,
          vibdelay: 0.35,
        },
        filter: { type: "hpf", cutoff: 300, resonance: 0 },
        reverb: hall,
        humanize: { timing: 9, velocity: 6, seed: 17 },
      }),
    );
    s.track(
      // The octave-up double for the final chorus: thin, bright, tucked under.
      voice("high", "Pixel double", "sing", 0.36, {
        pan: -0.28,
        sing: {
          preset: "glass",
          voice: "soprano",
          formant: 4.5,
          bright: 0.6,
          articulate: 1,
          breath: 0.1,
          vib: 6,
          vibmod: 0.08,
          vibdelay: 0.2,
        },
        filter: { type: "hpf", cutoff: 500, resonance: 0 },
        reverb: hall,
        humanize: { timing: 5, velocity: 5, seed: 21 },
      }),
    );
    s.track(
      voice("chops", "Up pixels", "sampler", 0.3, {
        sampler: {
          mode: "keyed",
          voices: {
            up: {
              ...bundledSampleRef("stay-up"),
              begin: 0.25,
              end: 0.5,
              fit: true,
              fadeTime: 0.007,
              fadeInTime: 0.002,
            },
          },
        },
        pan: 0.22,
        filter: { type: "hpf", cutoff: 650, resonance: 0 },
        fx: { crush: { bits: 10, coarse: 2, mix: 0.19 } },
        delay: { beats: 0.75, feedback: 0.2, mix: 0.12, pingpong: true },
      }),
    );
    s.track(
      voice("spark", "Glass pixels", "sampler", 0.18, {
        sampler: {
          mode: "keyed",
          voices: {
            glass: { ...bundledSampleRef("glass-hit"), fadeTime: 0.012 },
          },
        },
        pan: -0.31,
        reverb: hall,
        fx: { crush: { bits: 7, coarse: 2, mix: 0.24 } },
      }),
    );
    s.track(
      voice("tear", "Tape tears", "sampler", 0.26, {
        sampler: {
          mode: "keyed",
          voices: {
            // Notes from 48 play the riser, from 60 the tape hit.
            rise: { ...bundledSampleRef("riser"), root: 48, fadeTime: 0.05 },
            tape: { ...bundledSampleRef("tape-hit"), fadeTime: 0.006 },
          },
        },
        filter: { type: "hpf", cutoff: 190, resonance: 0 },
      }),
    );

    const hit = (
      track: string,
      bar: number,
      beat: number,
      pitch: number,
      velocity: number,
      length = 0.13,
    ) => s.note(track, bar, beat, pitch, length, velocity);
    /** A roll of `count` hits `step` beats apart, ramping velocity; `skip` drops hits. */
    const roll = (
      track: string,
      bar: number,
      beat: number,
      count: number,
      step: number,
      pitch: number | readonly number[],
      from: number,
      to: number,
      skip: readonly number[] = [],
    ) => {
      for (let i = 0; i < count; i++) {
        if (skip.includes(i)) continue;
        hit(
          track,
          bar,
          beat + i * step,
          typeof pitch === "number" ? pitch : pitch[i]!,
          from + ((to - from) * i) / Math.max(1, count - 1),
          Math.min(0.13, step * 0.9),
        );
      }
    };
    const sing = (track: string, line: Line, transpose = 0, gain = 1) => {
      for (const [bar, phrase] of line)
        for (const [beat, pitch, length, velocity = 0.7, lyric] of phrase) {
          const long = length >= 1.4;
          s.note(track, bar, beat, pitch + transpose, length, velocity * gain, {
            ...(lyric ? { lyric } : {}),
            ...(length >= 0.85 && lyric !== "_" ? scoop(-80, 0.1) : {}),
            ...(long && pitch >= 75
              ? { vibrato: { rate: 5.8, depth: 32, delay: 0.28 } }
              : {}),
          });
        }
    };
    /** A line sung exactly as written (no scoop, no vibrato). */
    const plain = (track: string, line: Line, gain: number) => {
      for (const [bar, phrase] of line)
        for (const [beat, pitch, length, velocity = 0.7, lyric] of phrase)
          s.note(track, bar, beat, pitch, length, velocity * gain, {
            ...(lyric ? { lyric } : {}),
          });
    };
    /** Backing singer: thirds (or sixths) under the held notes, octave when asked. */
    const shadow = (
      line: Line,
      mode: "third" | "sixth" | "octave",
      gain: number,
      minLength = 0.8,
    ) => {
      for (const [bar, phrase] of line)
        for (const [beat, pitch, length, velocity = 0.7, lyric] of phrase)
          if (mode === "octave" || length >= minLength)
            s.note(
              "harm",
              bar,
              beat,
              mode === "octave"
                ? pitch - 12
                : mode === "sixth"
                  ? sixthBelow(pitch)
                  : thirdBelow(pitch),
              length,
              velocity * gain,
              lyric ? { lyric } : {},
            );
    };
    const hook = (
      bar: number,
      phrase: Phrase,
      gain = 1,
      transpose = 0,
      track = "hook",
    ) => {
      phrase.forEach(([beat, pitch, length, velocity = 0.7], i) => {
        const last = i === phrase.length - 1;
        s.note(track, bar, beat, pitch + transpose, length, velocity * gain, {
          ...(i > 0 && !last ? { glide: 0.035 } : {}),
          ...(last ? scoop(-140, 0.18) : {}),
          ...(last && length >= 0.7
            ? { vibrato: { rate: 6.2, depth: 24, delay: 0.12 } }
            : {}),
        });
      });
    };
    /**
     * Interlocking arpeggios: `arp` takes the on-sixteenths, `arp2` the offs.
     * `order` indexes the five chord tones; a phrase end turns the direction.
     */
    const ARP_UP = [0, 1, 2, 3, 1, 2, 3, 4];
    const ARP_DOWN = [4, 3, 2, 1, 3, 2, 1, 0];
    const ARP_ROCK = [2, 3, 4, 3, 2, 1, 0, 1];
    const arp = (
      track: "arp" | "arp2",
      bar: number,
      tones: readonly number[],
      gain: number,
      order: readonly number[],
      offset = 0,
    ) =>
      order.forEach((index, i) =>
        s.note(
          track,
          bar,
          offset + i * 0.5,
          tones[index]!,
          0.2,
          (i % 2 === 0 ? 0.78 : 0.56) * gain,
        ),
      );
    const rolled = (
      track: string,
      bar: number,
      beat: number,
      pitches: readonly number[],
      length: number,
      velocity: number,
      spread = 0.035,
    ) =>
      pitches.forEach((pitch, i) =>
        s.note(
          track,
          bar,
          beat + i * spread,
          pitch,
          length - i * spread,
          velocity * (i === pitches.length - 1 ? 1.06 : 0.9),
        ),
      );
    /** A stutter: one pitch (or a list of jumps) re-fired `count` times, velocity ramped. */
    const stutter = (
      track: string,
      bar: number,
      beat: number,
      count: number,
      step: number,
      pitches: readonly number[],
      from: number,
      to: number,
      extra: Extra = {},
    ) => {
      for (let i = 0; i < count; i++)
        s.note(
          track,
          bar,
          beat + i * step,
          pitches[i % pitches.length]!,
          step * 0.9,
          from + ((to - from) * i) / Math.max(1, count - 1),
          extra,
        );
    };

    /** Kick plus an 808 that locks to it: each hit sustains to the next. */
    const kickBar = (
      b: number,
      grid: string,
      opts: {
        drop?: boolean;
        /**
         * What the last offbeat hit before a root change plays: an octave
         * pop, an approach pitch, or (unset) the root held into the change.
         */
        last?: "pop" | number;
        /** One root held for the whole bar, whatever the kick does. */
        hold?: boolean;
        /** Grid steps the 808 leaves empty (the kick still plays). */
        rest?: readonly number[];
        /** The step where the last 808 note ends (default: the bar end). */
        cut?: number;
        /** Kick and 808 level (chorus one sits a notch under the later ones). */
        level?: number;
      } = {},
    ) => {
      if (!grid) return;
      const level = opts.level ?? 1;
      s.grid("kick", b, 36, grid, level);
      const root = H[PROG[b]!]!.root;
      const next = b + 1 < BARS ? H[PROG[b + 1]!]!.root : root;
      const prev = b > 0 ? H[PROG[b - 1]!]!.root : root;
      const onsets = [...grid].flatMap((c, i) => (c === "." ? [] : [i]));
      const entry: Extra = opts.drop
        ? {
            bend: [
              { at: 0, cents: 1200 },
              { at: 0.3, cents: 0 },
            ],
          }
        : prev !== root
          ? { glide: 0.07 }
          : {};
      if (opts.hold) {
        const step = onsets[0] ?? 0;
        s.note(
          "sub",
          b,
          step * 0.25,
          root,
          (16 - step) * 0.25 - 0.04,
          Math.min(0.9, (Number(grid[step]) / 10) * 0.95 * level),
          entry,
        );
        return;
      }
      const last = opts.last;
      onsets.forEach((step, k) => {
        if (opts.rest?.includes(step)) return;
        const end = k + 1 < onsets.length ? onsets[k + 1]! : (opts.cut ?? 16);
        const velocity = Number(grid[step]) / 10;
        const lastHit = k === onsets.length - 1;
        const leaves =
          lastHit && step >= 10 && next !== root && last !== undefined;
        const pitch =
          !leaves || last === undefined
            ? root
            : last === "pop"
              ? root + 12
              : last;
        const length =
          (end - step) * 0.25 - (lastHit && next !== root ? -0.02 : 0.06);
        const extra: Extra = k === 0 ? entry : leaves ? { glide: 0.05 } : {};
        s.note(
          "sub",
          b,
          step * 0.25,
          pitch,
          length,
          Math.min(0.9, velocity * 0.95 * level),
          extra,
        );
      });
    };

    for (let b = 0; b < BARS; b++) {
      const [part, inPart] = partOf(b);
      const name = PROG[b]!;
      const h = H[name]!;
      const chorusLike =
        part === "chorus" || part === "return" || part === "over";
      const verseLike = part === "verse" || part === "verse2";
      const liftLike = part === "lift" || part === "lift2";

      // ── drums ─────────────────────────────────────────────────────────
      if (part === "boot" && b === 3) {
        s.grid("hats", b, 42, "1122334455667788", 0.75);
        hit("snap", b, 3.5, 39, 0.5);
      }
      if (verseLike) {
        // One bar in four holds its root; one pop in four (into IV); the
        // move into I walks down through its 3rd; the rest change on the
        // downbeat with a glide.
        kickBar(b, KICK.verse![inPart % 4]!, {
          drop: inPart === 0,
          hold: inPart % 4 === 0,
          last: inPart % 4 === 1 ? "pop" : inPart === 3 ? 32 : undefined,
        });
        s.grid("snap", b, 38, "........9.......");
        s.grid("snap", b, 39, "........7.......");
        if (inPart % 4 === 1) s.grid("snap", b, 38, "..........2....3");
        if (inPart % 4 === 3) s.grid("snap", b, 38, "...2..........3.");
        const busy = part === "verse2" && inPart >= 4;
        s.grid(
          "hats",
          b,
          42,
          busy ? "7465746574657465" : HATS_HALF[inPart % 4]!,
          busy ? 0.74 : 0.92,
        );
        if (inPart % 4 === 1) roll("hats", b, 3.5, 4, 0.125, 42, 0.35, 0.6);
        if (inPart % 4 === 2) roll("hats", b, 3, 6, 1 / 6, 42, 0.3, 0.62, [3]);
        if (inPart % 4 === 3) hit("hats", b, 3.5, 46, 0.5, 0.4);
        // Verse one ratchets into its second half; verse two claps instead.
        if (inPart === 3 && part === "verse")
          roll("snap", b, 3.5, 8, 1 / 16, 38, 0.55, 0.2);
        if (inPart === 3 && part === "verse2")
          roll("snap", b, 3, 4, 0.25, 39, 0.35, 0.72);
        if (part === "verse2" && inPart === 7)
          roll(
            "snap",
            b,
            3,
            8,
            0.125,
            [38, 38, 41, 41, 43, 45, 47, 48],
            0.4,
            0.8,
          );
      }
      if (liftLike) {
        kickBar(b, KICK.lift![inPart]!, {
          last: inPart === 3 ? "pop" : undefined,
        });
        if (inPart < 2) {
          s.grid(
            "snap",
            b,
            38,
            inPart ? "....7.......7.4." : "....7.......7...",
          );
          s.grid("snap", b, 39, "....5.......5...");
        } else if (inPart === 2) s.grid("snap", b, 38, "3.4.4.5.5.6.6.7.");
        else {
          s.grid("snap", b, 38, "4455667788......");
          // The ratchet glitch fill: a snare roll climbing in pitch.
          roll(
            "snap",
            b,
            2.5,
            12,
            0.125,
            [41, 41, 43, 43, 45, 45, 47, 47, 48, 48, 50, 50],
            0.4,
            0.9,
          );
        }
        s.grid("hats", b, 42, "6363636363636363", 0.48 + inPart * 0.08);
        if (inPart === 3) roll("hats", b, 2, 8, 0.125, 42, 0.4, 0.8);
      }
      if (chorusLike) {
        const grids = part === "over" ? KICK.over! : KICK.chorus!;
        const last = inPart === 7;
        const dropout = part === "return" && inPart === 3;
        // The 808's phrase: the octave kick-up only at the phrase end, vi
        // reached by step on the downbeat, IV from a half step below (the
        // 5th of vi, so it never runs in fifths with her falling line), and
        // a rest on beat three under "oh" (not in the Overload).
        // The Overload's seventh bar drops the drums for its second half
        // (her stuttered "pix-els" stands alone); its last bar lands: IV
        // for two beats, then the tonic at full width under a crash.
        const half = part === "over" && inPart === 6;
        const land = part === "over" && last;
        if (land) {
          s.grid("kick", b, 36, "9...8...9...8...");
          s.note("sub", b, 0, 33, 1.94, 0.85);
          s.note("sub", b, 1, 33, 0.94, 0.76);
          s.note("sub", b, 2, 28, 1.98, 0.88, { glide: 0.07 });
        } else
          kickBar(
            b,
            dropout || half
              ? "9...8..........."
              : last
                ? "9...8...9......."
                : grids[inPart % 4]!,
            {
              drop: inPart === 0,
              last:
                inPart % 4 === 3 ? "pop" : inPart % 4 === 2 ? 32 : undefined,
              rest: inPart % 4 === 1 && part !== "over" ? [8] : [],
              cut: half ? 8 : undefined,
              level: part === "chorus" ? 0.9 : 1,
            },
          );
        const shift = part === "return" ? 1 : part === "over" ? 2 : 0;
        s.grid(
          "snap",
          b,
          38,
          dropout || half
            ? "....9..........."
            : SNAP_CHORUS[(inPart + shift) % 4]!,
        );
        s.grid(
          "snap",
          b,
          39,
          dropout || half ? "....8..........." : "....8.......8...",
        );
        if (inPart % 4 === 3 && !last && !dropout && !half)
          s.grid("snap", b, 38, "..............45");
        // Overload: a clap flam and the 32nd ratchet on its fourth bar.
        if (part === "over" && inPart === 3) {
          s.grid("snap", b, 39, ".....3.......3..");
          roll("snap", b, 3.5, 8, 1 / 16, 38, 0.6, 0.18);
        }
        // Three phrase-end fills: a tom climb in chorus one, a hats-only
        // glitch fill in chorus two's dropout bar, the ratchet in the Overload.
        if (inPart === 3 && part === "chorus")
          roll(
            "snap",
            b,
            3,
            8,
            0.125,
            [38, 38, 41, 43, 45, 47, 48, 50],
            0.5,
            0.88,
          );
        if (dropout) {
          roll("hats", b, 2, 4, 0.25, 42, 0.3, 0.5);
          roll("hats", b, 3, 8, 1 / 16, 42, 0.5, 0.9);
          hit("hats", b, 3.5, 46, 0.7, 0.5);
        }
        if (land) {
          // A 32nd snare run into the crash on beat three.
          roll("snap", b, 0.5, 12, 0.125, 38, 0.35, 0.95);
          hit("snap", b, 2, 38, 0.95);
          hit("snap", b, 2, 39, 0.8);
          hit("hats", b, 2, 49, 0.9, 2);
        }
        if (last && part === "chorus")
          roll(
            "snap",
            b,
            3,
            8,
            0.125,
            [50, 48, 47, 45, 43, 41, 41, 41],
            0.8,
            0.4,
          );
        if (last && part === "return")
          roll("snap", b, 2, 4, 0.25, 38, 0.6, 0.85);
        if (inPart === 0)
          hit("hats", b, 0, 49, part === "chorus" ? 0.75 : 0.85, 2);
        if (!dropout) {
          const drive = HATS_DRIVE[inPart % 4]!;
          s.grid(
            "hats",
            b,
            42,
            half
              ? "84658465........"
              : land
                ? "8465846584658465"
                : last
                  ? "8465846584658..."
                  : drive,
            part === "over" ? 1.18 : 1,
          );
          const variant =
            (inPart + (part === "return" ? 1 : part === "over" ? 2 : 0)) % 4;
          if (inPart % 4 === 1)
            variant % 2
              ? roll("hats", b, 3.25, 6, 0.125, 42, 0.38, 0.78, [3])
              : roll("hats", b, 3, 6, 1 / 6, 42, 0.35, 0.75);
          if (inPart % 4 === 3 && !last && !half) {
            roll("hats", b, 2.75, 10, 0.125, 42, 0.4, 0.82, [4, 9]);
            hit("hats", b, 3.5, 46, 0.55, 0.45);
          }
          // The final chorus doubles the hats: 32nd bursts on every bar.
          if (part === "over" && !half)
            roll(
              "hats",
              b,
              inPart % 2 === 0 ? 1.5 : 3.5,
              inPart % 2 === 0 ? 4 : 4,
              0.125,
              42,
              0.32,
              0.6,
            );
        }
      }
      if (part === "glitch") {
        // Kick-less. A clap on three, hats as sparse crushed eighths.
        s.grid(
          "snap",
          b,
          39,
          inPart === 3 ? "........6..5..4." : "........7.......",
        );
        s.grid(
          "hats",
          b,
          42,
          [
            "4.3.4.3.4.3.4.3.",
            "4.3...3.4.3...3.",
            "4.3.4.3.4.3.4.3.",
            "4.3.4.3.4.3.....",
          ][inPart]!,
          0.95,
        );
        if (inPart === 1) roll("hats", b, 3, 8, 0.125, 42, 0.2, 0.5, [2, 5]);
        if (inPart === 3) roll("hats", b, 2, 8, 0.125, 46, 0.5, 0.15);
        s.note("sub", b, 0, h.root, inPart === 3 ? 2.4 : 3.6, 0.42, {
          ...(inPart > 0 && h.root !== H[PROG[b - 1]!]!.root
            ? { glide: 0.12 }
            : {}),
        });
      }
      if (part === "bridge") {
        // Kick-less. The 808 walks the descending line alone.
        s.note(
          "sub",
          b,
          0,
          h.root,
          inPart === 7 ? 2.4 : 3.8,
          inPart < 6 ? 0.4 : 0.46,
          inPart > 0 ? { glide: 0.1 } : {},
        );
        if (inPart === 0) hit("hats", b, 0, 49, 0.42, 2);
        if (inPart >= 4) {
          s.grid(
            "hats",
            b,
            42,
            inPart === 7 ? "3.2.3.2.4.3....." : "3.2.3.2.3.2.3.2.",
            0.9,
          );
          if (inPart === 5) roll("hats", b, 3, 6, 1 / 6, 42, 0.18, 0.4);
          s.grid("snap", b, 37, "........4.......");
          if (inPart === 7) roll("snap", b, 1.5, 4, 0.25, 38, 0.15, 0.5);
        }
      }
      if (part === "last") {
        kickBar(b, KICK.last![inPart]!, {});
        if (inPart < 2) {
          s.grid("snap", b, 38, "........6.......", 0.8);
          s.grid("hats", b, 42, "5.3.4.3.5.3.4.3.", 0.7 - inPart * 0.15);
        }
        if (inPart === 0) hit("hats", b, 0, 49, 0.6, 2);
        if (inPart === 2) s.note("sub", b, 0, h.root, 3.9, 0.55);
        if (inPart === 3)
          s.note("sub", b, 0, h.root, 3.6, 0.55, fall(-1200, 0.45));
      }

      // ── harmony ───────────────────────────────────────────────────────
      if (part === "boot") rolled("keys", b, 0, h.keys, 3.85, 0.42);
      if (verseLike && inPart % 2 === 0) {
        rolled("keys", b, 0, h.keys, 2.9, 0.46);
        rolled("keys", b, 3, h.keys.slice(1), 0.9, 0.34, 0.02);
        rolled("keys", b + 1, 1.5, h.keys.slice(1), 2.3, 0.38, 0.02);
      }
      if (part === "bridge") {
        rolled(
          "keys",
          b,
          0,
          h.sus ?? h.keys,
          2.4,
          inPart < 4 ? 0.58 : 0.54,
          0.045,
        );
        rolled(
          "keys",
          b,
          2.5,
          h.keys.slice(1),
          inPart === 7 ? 0.4 : 1.4,
          0.4,
          0.03,
        );
      }
      if (part === "last" && inPart < 3)
        rolled("keys", b, 0, h.keys, 3.85, 0.44 - inPart * 0.04);
      if (part === "last" && inPart === 3)
        rolled("keys", b, 0, [52, 56, 59, 63, 66], 3.9, 0.4, 0.05);
      if (liftLike) {
        // The stack sits in close position under the singer and rises by
        // inversion, its top voice climbing A4 B4 C#5 D#5 under her C#5..A5.
        // Suspensions: 9-8 over Aadd9, 4-3 over each B sus. Each suspended
        // voice is prepared on the and-of-four of the bar before (or held
        // from the chord before), sits on the downbeat and resolves down
        // on beat two.
        const gain = 0.4 + inPart * 0.03;
        if (inPart === 0) {
          s.note("chords", b - 1, 3.5, 71, 1.5, gain * 0.9);
          s.chord("chords", b, 0, [57, 61, 64], 3.9, gain);
          s.note("chords", b, 1, 69, 2.9, gain * 0.95);
          s.note("chords", b, 3.5, 64, 1.5, gain);
        } else if (inPart === 1) {
          s.chord("chords", b, 0, [59, 66, 71], 3.9, gain);
          s.note("chords", b, 1, 63, 2.9, gain * 0.95);
        } else if (inPart === 2) {
          // C#m7 with the E held on through the bar line as the next 4th.
          s.chord("chords", b, 0, [61, 68, 71, 73], 3.9, gain);
          s.note("chords", b, 0, 64, 3.5, gain);
          s.note("chords", b, 3.5, 64, 1.5, gain);
        } else {
          s.chord("chords", b, 0, [66, 71, 75], 3.9, gain);
          s.note("chords", b, 1, 63, 2.9, gain * 0.95);
        }
      }
      if (chorusLike) {
        // An open stack, E3 up to B4, whose top voice sits just under the
        // singer; the octave stabs above her grow from two a bar to four,
        // and the Overload adds a held top voice. Phrase-end bars re-strike
        // the stack on three and four so the next phrase is pushed into.
        const over = part === "over";
        const stack = [...h.saw, ...(over ? [h.stab[1]!] : [])];
        const gain = part === "chorus" ? 0.58 : part === "return" ? 0.7 : 0.96;
        const land = over && inPart === 7;
        if (land) {
          // IV for two beats, then the whole tonic stack with both stabs.
          s.chord("chords", b, 0, stack, 1.9, gain);
          s.chord(
            "chords",
            b,
            2,
            [...H.E!.saw, ...H.E!.stab],
            1.95,
            Math.min(1, gain * 1.08),
          );
        } else if (inPart % 4 === 3) {
          s.chord("chords", b, 0, stack, 1.9, gain);
          s.chord("chords", b, 2, stack, 0.9, gain * 0.92);
          s.chord("chords", b, 3, stack, 0.95, gain * 1.02);
        } else s.chord("chords", b, 0, stack, 3.8, gain);
        // The stab on 2.5 of the seventh bar steps aside for her peak ("pix").
        const beats =
          part === "chorus" && inPart < 4
            ? [1.5, 3.5]
            : inPart === 6
              ? [0.5, 1.5, 3.5]
              : [0.5, 1.5, 2.5, 3.5];
        for (const beat of beats)
          s.chord(
            "chords",
            b,
            beat,
            land && beat > 2 ? H.E!.stab : h.stab,
            0.22,
            part === "chorus" ? 0.36 : over ? 0.56 : 0.44,
          );
      }
      if (part === "glitch") {
        // A crushed stack that stutters, then the tape stop into verse two.
        const low = h.saw;
        if (inPart === 1) s.chord("chords", b, 2, low, 1.9, 0.56);
        if (inPart === 2) {
          stutter(
            "chords",
            b,
            0,
            8,
            1 / 8,
            [h.saw[2]! + 12, h.saw[3]! + 12],
            0.7,
            0.3,
          );
          s.chord("chords", b, 2, low, 1.9, 0.58);
        }
        if (inPart === 3) {
          stutter("chords", b, 0, 4, 0.25, [h.saw[2]! + 12], 0.62, 0.4);
          stutter(
            "chords",
            b,
            1,
            8,
            1 / 8,
            [h.saw[2]! + 12, h.saw[2]! + 24],
            0.68,
            0.35,
          );
          s.chord("chords", b, 2, low, 1.95, 0.62);
        }
      }

      // ── chip arps ───────────────────────────────────────────────────────
      if (b === 2 || b === 3) {
        arp("arp", b, h.lo, 0.45 + (b - 2) * 0.15, ARP_UP);
        if (b === 3) arp("arp2", b, h.hi, 0.4, ARP_DOWN, 0.25);
      }
      if (chorusLike) {
        const phraseEnd = inPart % 4 === 3;
        const tones = inPart < 4 ? h.lo : h.hi;
        const gain = part === "chorus" ? 0.74 : part === "return" ? 0.9 : 1.24;
        if (part === "over" && inPart === 7) {
          // The landing bar: IV down for two beats, then the tonic set.
          arp("arp", b, tones, gain, ARP_DOWN.slice(0, 4));
          arp("arp", b, H.E!.hi, gain, ARP_DOWN.slice(4), 2);
          arp("arp2", b, tones, gain * 0.9, ARP_UP.slice(0, 4), 0.25);
          arp("arp2", b, H.E!.hi, gain * 0.95, ARP_UP.slice(4), 2.25);
        } else {
          arp("arp", b, tones, gain, phraseEnd ? ARP_DOWN : ARP_UP);
          // The second arp joins for the second half of chorus one, then always.
          if (part !== "chorus" || inPart >= 4)
            arp(
              "arp2",
              b,
              tones,
              gain * 0.9,
              phraseEnd ? ARP_UP : ARP_ROCK,
              0.25,
            );
        }
      }
      if (part === "glitch")
        arp(
          "arp",
          b,
          h.lo,
          0.5 - inPart * 0.06,
          // The last bar stops short of the tape stop.
          inPart === 3 ? ARP_DOWN.slice(0, 6) : inPart % 2 ? ARP_DOWN : ARP_UP,
        );
      if (part === "lift2")
        arp("arp2", b, h.hi, 0.42 + inPart * 0.08, ARP_UP, 0.25);
      if (part === "bridge" && inPart >= 4) {
        for (const [beat, index] of [
          [0.5, 3],
          [1.25, 2],
          [2, 1],
          [2.75, 2],
          [3.5, 3],
        ] as const)
          if (inPart < 7 || beat < 2.5)
            s.note(
              "spark",
              b,
              beat,
              h.keys[index]! + 24,
              0.5,
              0.26 + (inPart - 4) * 0.04,
            );
      }

      // ── hook: identity motif in the intro, hockets in the chorus ──────────
      if (part === "boot") {
        if (b % 2 === 0) hook(b, b === 2 ? MOTIF_IV : MOTIF, 0.72);
        else
          hook(
            b,
            ANSWERS[b === 1 ? 0 : 1]!.map(
              ([beat, pitch, length, velocity]) =>
                [beat - 1.5, pitch, length, velocity] as const,
            ),
            0.66,
          );
      }
      if (part === "verse" && (inPart === 5 || inPart === 7))
        hook(b, ANSWERS[inPart === 5 ? 0 : 1]!, 0.5);
      // Verse two: the counter-melody answers each sung line in its rest.
      if (part === "verse2" && inPart % 2 === 1) hook(b, COUNTER[name]!, 0.95);
      // The counter-line carries on into the second pre-chorus: a rising B
      // arpeggio echoing "breaks", then the same shape under the held "me"
      // (a third below her A, out of the way of its beat repeat).
      if (part === "lift2" && inPart % 2 === 1)
        hook(
          b,
          inPart === 1
            ? [
                [2, 71, 0.22, 0.56],
                [2.5, 75, 0.22, 0.58],
                [3, 78, 0.9, 0.62],
              ]
            : [
                [1.5, 71, 0.22, 0.58],
                [2, 75, 0.22, 0.6],
                [2.5, 78, 0.9, 0.64],
              ],
          0.8,
        );
      if (b === 13)
        hook(b, [...ANSWERS[0]!.slice(0, 4), [3, 83, 0.85, 0.82]], 0.62);
      if (chorusLike && inPart % 2 === 1 && inPart !== 7) {
        const gain = part === "chorus" ? 0.9 : 1;
        hook(b, CHIP[name]!, gain);
        if (part === "over" && inPart === 3)
          stutter("hook", b, 3.5, 4, 0.125, [80, 87], 0.7, 0.5);
      }
      // The Overload's last hook phrase turns with the harmony and ends on E.
      if (chorusLike && inPart === 7)
        hook(
          b,
          part === "over"
            ? [
                [1, 88, 0.32, 0.78],
                [1.75, 85, 0.2, 0.63],
                [2.25, 83, 0.42, 0.75],
                [2.75, 85, 0.34, 0.64],
                [3, 88, 1, 0.8],
              ]
            : MOTIF_IV.map(
                ([beat, pitch, length, velocity]) =>
                  [beat + 1, pitch, length, velocity] as const,
              ),
          part === "over" ? 1 : 0.85,
        );
      if (part === "over" && inPart === 7)
        stutter("hook", b, 0, 4, 0.25, [85, 85, 88, 92], 0.5, 0.78);
      if (b === 67) hook(b, MOTIF, 0.5);

      // ── chops: pitched fragments, beat repeats and stutters ───────────────
      if (part === "boot" && b % 2 === 1)
        // A pitched vocal fragment hocketing with the arp's off-sixteenths.
        s.phrase(
          "chops",
          b,
          b === 1
            ? [
                [1.75, 80, 0.2, 0.5],
                [2.25, 87, 0.2, 0.52],
                [2.75, 92, 0.2, 0.56],
                [3.25, 87, 0.45, 0.5],
              ]
            : [
                [0.75, 80, 0.2, 0.52],
                [1.25, 92, 0.2, 0.56],
                [1.75, 85, 0.2, 0.5],
                [2.25, 87, 0.2, 0.54],
                [2.75, 92, 0.6, 0.58],
              ],
        );
      if (verseLike && inPart === 3)
        s.phrase("chops", b, [
          [2.5, 80, 0.25, 0.6],
          [3, 83, 0.25, 0.62],
          [3.5, 85, 0.25, 0.58],
        ]);
      if (verseLike && inPart === 7)
        roll(
          "chops",
          b,
          2,
          8,
          0.25,
          [78, 80, 80, 83, 83, 85, 87, 88],
          0.45,
          0.7,
        );
      if (liftLike && inPart === 3) {
        // The beat repeat: 32nds jumping +7 and +12, fading into the drop.
        stutter("chops", b, 2.5, 4, 0.125, [83, 90], 0.6, 0.7);
        stutter("chops", b, 3, 8, 1 / 16, [83, 90, 95, 90], 0.72, 0.3);
      }
      if (part === "glitch") {
        const base = 80;
        if (inPart === 0) {
          stutter("chops", b, 0, 4, 0.25, [base, base + 7], 0.66, 0.5);
          stutter(
            "chops",
            b,
            2,
            8,
            0.125,
            [base + 12, base + 7, base, base + 12],
            0.7,
            0.35,
          );
        }
        if (inPart === 1) {
          stutter("chops", b, 0.5, 6, 0.125, [base + 5, base], 0.55, 0.66);
          stutter(
            "chops",
            b,
            2.5,
            8,
            1 / 16,
            [base + 12, base + 12, base + 7, base + 7],
            0.72,
            0.3,
          );
        }
        if (inPart === 2) {
          stutter(
            "chops",
            b,
            0,
            8,
            0.125,
            [base, base + 7, base + 12, base + 7],
            0.3,
            0.72,
          );
          stutter("chops", b, 2, 4, 0.25, [base + 12], 0.7, 0.4);
        }
        if (inPart === 3) {
          stutter("chops", b, 0, 16, 1 / 16, [base + 7, base + 12], 0.72, 0.25);
          stutter("chops", b, 1.5, 4, 0.125, [base, base - 5], 0.6, 0.3);
        }
      }
      // The fourth bar of each phrase belongs to the hook pluck: the chops
      // only echo its last two notes an octave up in chorus two, or flick
      // 32nds in the Overload. The eighth bar is theirs after "pix-els".
      if (chorusLike && inPart === 7) {
        s.phrase("chops", b, [
          [2, 83, 0.25, 0.66],
          [2.5, 83, 0.25, 0.6],
          [2.75, 80, 0.25, 0.62],
          [3.25, 78, 0.22, 0.6],
        ]);
        if (part === "over")
          stutter("chops", b, 3.5, 4, 0.125, [88, 88, 95, 92], 0.66, 0.42);
      }
      if (part === "return" && inPart === 3)
        s.phrase("chops", b, [
          [3.5, 92, 0.2, 0.58],
          [3.75, 93, 0.3, 0.62],
        ]);
      if (part === "over" && inPart === 3)
        stutter("chops", b, 3.5, 4, 0.125, [88, 88, 95, 92], 0.66, 0.42);
      if (part === "over" && inPart % 2 === 0)
        stutter("chops", b, 3.5, 4, 0.125, [88, 95], 0.48, 0.32);
      if (b === 67) stutter("chops", b, 1.5, 6, 0.125, [92, 87, 80], 0.5, 0.2);

      // ── sparkle and tape ──────────────────────────────────────────────
      if (PARTS.some(([, start]) => start === b))
        s.note("spark", b, part === "boot" ? 0.5 : 0, 88, 1.2, 0.6);
      if (b === 1) s.note("spark", b, 2.5, 83, 1, 0.42);
    }

    // ── topline ───────────────────────────────────────────────────────────
    sing("vocal", VERSE_ONE);
    sing("vocal", lift(12));
    sing("vocal", CHORUS_ONE);
    sing("vocal", VERSE_TWO);
    sing("vocal", lift(36));
    sing("vocal", CHORUS_TWO);
    sing("vocal", BRIDGE);
    sing("vocal", OVERLOAD, 0, 1.1);
    sing("vocal", LAST);
    // The glitch break stutters the hook's last word.
    for (const [bar, beat, count, step, pitch] of [
      [24, 0, 4, 0.25, 83],
      [24, 2, 6, 0.125, 83],
      [25, 1, 8, 1 / 16, 80],
      [26, 0, 3, 0.5, 78],
      [26, 2.5, 6, 0.125, 83],
      [27, 0, 8, 1 / 16, 83],
    ] as const)
      stutter("vocal", bar, beat, count, step, [pitch], 0.88, 0.42, {
        lyric: "pix",
      });
    shadow(lift(12).slice(2), "third", 0.62);
    shadow(lift(36).slice(2), "third", 0.62);
    shadow(CHORUS_ONE, "third", 0.6);
    shadow(CHORUS_TWO, "third", 0.66);
    // The landing bar's double: the 3rd of IV under her held F#, then the
    // 3rd of the tonic under her resolution (a plain third would be D#
    // against A).
    shadow(
      OVERLOAD.filter(([bar]) => bar !== 63),
      "third",
      0.66,
    );
    plain(
      "harm",
      [
        [
          63,
          [
            [0.5, 73, 2, 0.74, "_"],
            [2.5, 68, 1.5, 0.8, "_"],
          ],
        ],
      ],
      0.66,
    );
    plain("harm", BRIDGE_HARM, 1);
    shadow(BRIDGE.slice(6), "sixth", 0.52, 0.4);
    // The octave-up double sings all four hook lines of the final chorus;
    // the lift is above her, never an octave below inside the stack.
    for (const [bar, phrase] of OVERLOAD)
      for (const [beat, pitch, length, velocity = 0.7, lyric] of phrase)
        if (pitch <= 80)
          s.note("high", bar, beat, pitch + 12, length, velocity * 0.9, {
            ...(lyric ? { lyric } : {}),
          });

    // Transitions: tape tears, risers into every chorus.
    for (const [bar, beat] of [
      [3, 3],
      [11, 3.5],
      [23, 3],
      [35, 3.5],
      [47, 3],
      [55, 2.5],
      [63, 3],
    ] as const)
      s.note("tear", bar, beat, 60, 0.45, 0.78);
    s.note("tear", 14, 2.75, 48, 5.2, 0.62);
    s.note("tear", 38, 2.75, 48, 5.2, 0.66);
    s.note("tear", 54, 2, 48, 5, 0.6);

    // After the silent beat the overload and the outro lift a half step, E to F.
    const LIFTED = new Set([
      "sub",
      "hook",
      "keys",
      "chords",
      "arp",
      "arp2",
      "vocal",
      "harm",
      "high",
      "chops",
      "spark",
    ]);
    for (let i = 0; i < s.notes.length; i++) {
      const n = s.notes[i]!;
      if (LIFTED.has(n.trackId!) && n.startTick! >= 56 * BAR)
        s.notes[i] = { ...n, pitch: n.pitch! + 1 };
    }

    // The 808 lets go for the last beat of each pre-chorus so the drop lands.
    for (const suck of [15 * BAR + 3 * TPB, 39 * BAR + 3 * TPB])
      for (let i = 0; i < s.notes.length; i++) {
        const n = s.notes[i]!;
        if (
          n.trackId === "sub" &&
          n.startTick! < suck &&
          n.startTick! + n.durationTicks! > suck
        )
          s.notes[i] = { ...n, durationTicks: suck - n.startTick! };
      }

    /**
     * A tape stop: whatever rings into [from, to) dives an octave over its
     * last beat and is cut at `to`; with `silent` nothing may start inside.
     */
    const powerDown = (from: number, to: number, silent: boolean) => {
      for (let i = s.notes.length - 1; i >= 0; i--) {
        const n = s.notes[i]!;
        const start = n.startTick!;
        if (start >= from && start < to) {
          if (silent) s.notes.splice(i, 1);
          continue;
        }
        if (start < from && start + n.durationTicks! > from) {
          const duration = Math.min(start + n.durationTicks!, to) - start;
          const dive = Math.max(0, (duration - TPB) / duration);
          s.notes[i] = {
            ...n,
            durationTicks: duration,
            ...(["kick", "snap", "hats", "tear"].includes(n.trackId!)
              ? {}
              : {
                  bend: [
                    { at: 0, cents: 0 },
                    ...(dive > 0 ? [{ at: dive, cents: 0 }] : []),
                    { at: 1, cents: -1200 },
                  ],
                }),
          };
        }
      }
    };
    // The glitch break ends on a tape stop over its last beat.
    powerDown(27 * BAR + 3 * TPB, 28 * BAR, false);
    // A whole-mix silent beat before Overload: nothing starts or rings in it.
    powerDown(56 * BAR - TPB, 56 * BAR, true);
    return s.finish();
  },
};
