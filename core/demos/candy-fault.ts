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
  voice,
  type Phrase,
} from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

type Extra = Partial<NoteInput>;
type Harmony = Readonly<{
  /** 808 root (E1 to C#2). */
  root: number;
  /** Rootless electric-piano voicing around middle C. */
  keys: readonly number[];
  /** Supersaw stack, voiced high so the sub owns the lows. */
  saw: readonly number[];
  /** Chip arpeggio tones in the 2 to 6 kHz zone. */
  arp: readonly number[];
}>;

const H: Readonly<Record<string, Harmony>> = {
  E: {
    root: 28,
    keys: [56, 59, 63, 66],
    saw: [64, 68, 71, 76],
    arp: [76, 80, 83, 88],
  },
  B: {
    root: 35,
    keys: [54, 59, 61, 63],
    saw: [63, 66, 71, 75],
    arp: [75, 78, 83, 87],
  },
  Cm: {
    root: 37,
    keys: [56, 59, 61, 64],
    saw: [64, 68, 73, 76],
    arp: [76, 80, 85, 88],
  },
  A: {
    root: 33,
    keys: [57, 61, 64, 68],
    saw: [64, 69, 73, 76],
    arp: [76, 81, 85, 88],
  },
  Bs: {
    root: 35,
    keys: [57, 59, 64, 66],
    saw: [64, 66, 71, 76],
    arp: [76, 78, 83, 88],
  },
  // Soft reset colours: E/G#, F#m11, B7sus4 and the borrowed A minor 6.
  EG: { root: 32, keys: [59, 63, 64, 68], saw: [], arp: [80, 83, 87, 88] },
  Fm: { root: 30, keys: [57, 59, 61, 64], saw: [], arp: [81, 85, 88, 90] },
  B7: { root: 35, keys: [57, 59, 64, 66], saw: [], arp: [78, 81, 83, 88] },
  Am6: { root: 33, keys: [57, 60, 64, 66], saw: [], arp: [76, 78, 81, 84] },
};

/** One chord name per bar: I-IV-V intro, vi-IV-I-V verse, I-V-vi-IV chorus. */
const PROG = [
  ...["E", "E", "A", "B"],
  ...["Cm", "Cm", "A", "A", "E", "E", "B", "B"],
  ...["A", "B", "Cm", "Bs"],
  ...["E", "B", "Cm", "A", "E", "B", "Cm", "A"],
  ...["A", "EG", "Fm", "B7", "A", "Am6", "EG", "Bs"],
  ...["Cm", "A", "Bs", "B"],
  ...["E", "B", "Cm", "A", "E", "B", "Cm", "A"],
  ...["E", "B", "Cm", "A", "E", "B", "Cm", "A"],
  ...["E", "B", "A", "E"],
] as const;

type Part =
  | "boot"
  | "verse"
  | "lift"
  | "chorus"
  | "soft"
  | "rebuild"
  | "return"
  | "over"
  | "last";

const partOf = (b: number): Part =>
  b < 4
    ? "boot"
    : b < 12
      ? "verse"
      : b < 16
        ? "lift"
        : b < 24
          ? "chorus"
          : b < 32
            ? "soft"
            : b < 36
              ? "rebuild"
              : b < 44
                ? "return"
                : b < 52
                  ? "over"
                  : "last";

/** A down-a-diatonic-third shadow in E major for the backing singer. */
const E_MAJOR = new Set([4, 6, 8, 9, 11, 1, 3]);
const thirdBelow = (pitch: number): number =>
  E_MAJOR.has((pitch - 3 + 120) % 12) ? pitch - 3 : pitch - 4;

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
    "9.......8.......",
    "9.......8.....6.",
    "9...8...9...8...",
    "9...8...9.8.....",
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
  rebuild: [
    "9...8...9...8...",
    "9...8...9...8...",
    "9.8.9.8.9.8.9.8.",
    "9.8.9.8.9.8.....",
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

const MOTIF: Phrase = [
  [0, 76, 0.32, 0.78],
  [0.75, 75, 0.2, 0.63],
  [1.25, 71, 0.42, 0.75],
  [2, 68, 0.34, 0.64],
  [2.75, 71, 0.7, 0.76],
];
/** The motif over A: C# instead of the D# that clashes with the IV chord. */
const MOTIF_IV: Phrase = [
  [0, 76, 0.32, 0.78],
  [0.75, 73, 0.2, 0.63],
  [1.25, 69, 0.42, 0.75],
  [2, 68, 0.34, 0.64],
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
    [3, 83, 0.85, 0.84],
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

// ── topline (all lyrics original) ────────────────────────────────────────
type Line = readonly (readonly [bar: number, phrase: Phrase])[];

const VERSE: Line = [
  [
    4,
    [
      [0.5, 68, 0.42, 0.62, "Pink"],
      [1, 68, 0.7, 0.68, "light"],
      [2, 66, 0.42, 0.56, "on"],
      [2.5, 68, 0.9, 0.66, "low"],
      [3.5, 71, 0.42, 0.62, "bat"],
    ],
  ],
  [
    5,
    [
      [0, 69, 0.45, 0.64, "ter"],
      [0.5, 68, 1.7, 0.66, "y"],
    ],
  ],
  [
    6,
    [
      [0.5, 64, 0.4, 0.58, "I"],
      [1, 68, 0.7, 0.68, "keep"],
      [2, 69, 0.42, 0.6, "you"],
      [2.5, 71, 0.42, 0.64, "in"],
      [3, 73, 0.42, 0.66, "my"],
    ],
  ],
  [7, [[0, 71, 1.9, 0.72, "cache"]]],
  [
    8,
    [
      [0.5, 68, 0.4, 0.62, "Sug"],
      [1, 68, 0.4, 0.6, "ar"],
      [1.5, 71, 0.42, 0.64, "on"],
      [2, 73, 0.42, 0.62, "the"],
      [2.5, 76, 0.9, 0.74, "cir"],
      [3.5, 75, 0.45, 0.64, "cuit"],
    ],
  ],
  [9, [[0, 71, 1.8, 0.7, "board"]]],
  [
    10,
    [
      [0.5, 71, 0.4, 0.64, "ev"],
      [1, 73, 0.4, 0.64, "ery"],
      [1.5, 75, 0.9, 0.74, "kiss"],
      [2.5, 73, 0.42, 0.62, "a"],
      [3, 71, 0.42, 0.62, "lit"],
      [3.5, 73, 0.45, 0.66, "tle"],
    ],
  ],
  [11, [[0, 75, 1.5, 0.76, "crash"]]],
];

const LIFT: Line = [
  [
    12,
    [
      [0, 73, 0.4, 0.66, "Turn"],
      [0.5, 73, 0.4, 0.62, "it"],
      [1, 76, 0.9, 0.74, "up"],
      [2, 73, 0.4, 0.62, "un"],
      [2.5, 76, 0.4, 0.66, "til"],
      [3, 78, 0.42, 0.7, "it"],
    ],
  ],
  [13, [[0, 78, 1.6, 0.78, "breaks"]]],
  [
    14,
    [
      [0, 76, 0.7, 0.7, "Hold"],
      [1, 78, 0.7, 0.74, "on"],
      [2, 80, 1.2, 0.8, "tight"],
      [3.5, 78, 0.45, 0.72, "to"],
    ],
  ],
  [15, [[0, 83, 2.4, 0.86, "me"]]],
];

/** "We glow in the static, oh": the title line, with or without a pickup. */
function lineA(bar: number, pickup: boolean, flip: boolean): Line {
  return [
    ...(pickup ? ([[bar - 1, [[3.5, 68, 0.45, 0.72, "We"]]]] as const) : []),
    [
      bar,
      [
        ...(pickup ? [] : ([[0, 68, 0.45, 0.8, "We"]] as const)),
        [pickup ? 0 : 0.5, 71, pickup ? 1.4 : 0.95, 0.84, "glow"],
        [1.5, 73, 0.4, 0.7, "in"],
        [2, 75, 0.4, 0.72, "the"],
        [2.5, 76, 0.9, 0.84, "sta"],
        [3.5, 75, 0.45, 0.72, "tic"],
      ],
    ],
    [
      bar + 1,
      flip
        ? [
            [0, 78, 0.9, 0.84, "oh"],
            [1, 83, 1, 0.88, "oh"],
          ]
        : [[0, 78, 1.9, 0.86, "oh"]],
    ],
  ];
}

/** "Sweet as a short circuit" (six syllables) or "Sugar rush on a live wire" (seven). */
function lineB(bar: number, words: readonly string[]): Line {
  const w = (i: number) => words[i]!;
  const head: Phrase =
    words.length === 6
      ? [
          [0, 80, 0.85, 0.84, w(0)],
          [1, 78, 0.4, 0.7, w(1)],
          [1.5, 76, 0.4, 0.68, w(2)],
          [2, 80, 0.85, 0.82, w(3)],
          [3, 78, 0.85, 0.76, w(4)],
        ]
      : [
          [0, 80, 0.45, 0.82, w(0)],
          [0.5, 80, 0.45, 0.76, w(1)],
          [1, 78, 0.9, 0.8, w(2)],
          [2, 76, 0.4, 0.68, w(3)],
          [2.5, 76, 0.4, 0.7, w(4)],
          [3, 80, 0.85, 0.82, w(5)],
        ];
  return [
    [bar, head],
    [bar + 1, [[0, 76, 1.75, 0.8, w(words.length - 1)]]],
  ];
}

/** The closing line; `stutter` breaks the last word into sung sixteenths. */
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
        [0, 80, 0.7, 0.84, w(0)],
        [0.75, 80, 0.6, 0.78, w(1)],
        [1.5, 78, 0.4, 0.7, w(2)],
        [2, 76, stutter ? 0.22 : 0.4, 0.7, w(3)],
        ...(stutter
          ? ([
              [2.25, 80, 0.2, 0.82, w(4)],
              [2.5, 80, 0.2, 0.72, w(4)],
              [2.75, 83, 0.2, 0.8, w(4)],
            ] as const)
          : ([[2.5, 80, 0.45, 0.82, w(4)]] as const)),
        [3, end, 1.6, 0.84, w(5)],
      ],
    ],
  ];
}

const SOFT: Line = [
  [
    24,
    [
      [0.5, 73, 1, 0.5, "Slow"],
      [1.5, 71, 1.4, 0.52, "down"],
      [3, 68, 0.4, 0.44, "let"],
      [3.5, 69, 0.4, 0.46, "the"],
    ],
  ],
  [
    25,
    [
      [0, 71, 0.9, 0.52, "screen"],
      [1, 68, 0.5, 0.48, "go"],
      [1.5, 64, 2.2, 0.5, "dark"],
    ],
  ],
  [
    26,
    [
      [0.5, 69, 0.4, 0.46, "I"],
      [1, 69, 0.4, 0.48, "can"],
      [1.5, 73, 1, 0.54, "hear"],
      [2.5, 71, 0.4, 0.48, "your"],
      [3, 69, 0.5, 0.48, "stat"],
      [3.5, 68, 0.4, 0.46, "ic"],
    ],
  ],
  [27, [[0, 71, 2.6, 0.54, "heart"]]],
  [
    28,
    [
      [0.5, 73, 0.4, 0.5, "Sug"],
      [1, 73, 0.4, 0.5, "ar"],
      [1.5, 76, 1, 0.58, "melts"],
      [2.5, 73, 0.4, 0.5, "the"],
    ],
  ],
  [
    29,
    [
      [0, 72, 0.75, 0.56, "col"],
      [0.75, 71, 0.5, 0.5, "ors"],
      [1.25, 69, 2.2, 0.54, "run"],
    ],
  ],
  [
    30,
    [
      [0.5, 68, 0.75, 0.52, "Hold"],
      [1.25, 68, 0.4, 0.48, "the"],
      [1.75, 71, 1.2, 0.56, "light"],
      [3, 73, 0.4, 0.54, "till"],
      [3.5, 75, 0.4, 0.58, "it's"],
    ],
  ],
  [
    31,
    [
      [0, 76, 0.75, 0.62, "un"],
      [0.75, 78, 2.2, 0.68, "done"],
    ],
  ],
];

const REBUILD: Line = [
  [
    32,
    [
      [0, 73, 0.4, 0.62, "Turn"],
      [0.5, 73, 0.4, 0.58, "it"],
      [1, 76, 0.9, 0.68, "up"],
    ],
  ],
  [
    33,
    [
      [0, 76, 0.4, 0.66, "Turn"],
      [0.5, 76, 0.4, 0.62, "it"],
      [1, 78, 0.9, 0.72, "up"],
    ],
  ],
  [
    34,
    [
      [0, 78, 0.4, 0.7, "Turn"],
      [0.5, 78, 0.4, 0.66, "it"],
      [1, 80, 0.9, 0.76, "up"],
      [2.5, 78, 0.4, 0.68, "turn"],
      [3, 80, 0.4, 0.72, "it"],
      [3.5, 83, 0.45, 0.78, "up"],
    ],
  ],
  [35, [[0, 83, 2.6, 0.86, "up"]]],
];

const LAST: Line = [
  [
    52,
    [
      [0.5, 68, 0.45, 0.5, "We"],
      [1, 71, 1.4, 0.56, "glow"],
    ],
  ],
  [
    53,
    [
      [0.5, 73, 0.4, 0.5, "in"],
      [1, 75, 0.4, 0.5, "the"],
      [1.5, 76, 1, 0.56, "sta"],
      [2.5, 75, 0.45, 0.5, "tic"],
    ],
  ],
  [54, [[0, 76, 5.5, 0.56, "oh"]]],
];

const CHORUS_ONE: Line = [
  ...lineA(16, true, false),
  ...lineB(18, ["Sweet", "as", "a", "short", "cir", "cuit"]),
  ...lineA(20, false, true),
  ...lineC(22, ["Break", "me", "in", "to", "pix", "els"], false, 76),
];
const CHORUS_TWO: Line = [
  ...lineA(36, true, false),
  ...lineB(38, ["Sug", "ar", "rush", "on", "a", "live", "wire"]),
  ...lineA(40, false, true),
  ...lineC(42, ["Burn", "me", "sweet", "er", "high", "er"], false, 83),
];
const OVERLOAD: Line = [
  ...lineA(44, false, false),
  ...lineB(46, ["Sweet", "as", "a", "short", "cir", "cuit"]),
  ...lineA(48, false, true),
  ...lineC(50, ["Break", "me", "in", "to", "pix", "els"], true, 80),
];

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

export const candyFault: DemoDefinition = {
  info: demoInfo({
    id: "candy-fault",
    title: "Candy Fault",
    style: "Hyperpop",
    description:
      "A sugar-rush hyperpop song: a pitched-up machine singer, a distorted 808 that slides between roots, wide supersaw chords and chip arpeggios, broken by a glassy electric-piano bridge and a silent beat before the overload.",
    tempoBpm: 156,
    key: "E",
    bars: 56,
    highlightBar: 44,
    trackId: "chops",
    features: [
      "original verse, pre-chorus, two choruses and a bridge",
      "808 slides and octave drops",
      "hat rolls in 32nds and triplets",
      "pitched vocal stutters",
      "backing thirds and octave doubles",
      "pretty-to-harsh supersaw detune",
      "borrowed minor iv in the bridge",
    ],
    arrangement: [
      "Boot sparkle 4",
      "Half-time 8",
      "Sugar lift 4",
      "Bright fault 8",
      "Soft reset 8",
      "Rebuild 4",
      "Fault return 8",
      "Overload 8",
      "Last pixel 4",
    ],
    mixNotes: [
      "The 808 follows every kick hit, slides into each new root and drops an octave onto the chorus downbeats; the supersaw starts above 300 Hz and pumps under the kick.",
      "The singer is pitched bright with a formant lift; a softer double sings thirds below, and dotted-eighth delay throws catch the last word of each chorus line.",
      "Hats move in shaped sixteenths with 32nd and triplet rolls; the bridge drops the kick, hook and supersaw for electric piano, glass and a borrowed A minor 6.",
      "The final chorus detunes the supersaw from pretty to harsh, stutters the singer on 'pixels', and the song powers down with the 808 diving an octave.",
    ],
  }),
  build() {
    const s = new Composer(candyFault.info);
    for (const [name, start, bars] of [
      ["Boot sparkle", 0, 4],
      ["Half-time", 4, 8],
      ["Sugar lift", 12, 4],
      ["Bright fault", 16, 8],
      ["Soft reset", 24, 8],
      ["Rebuild", 32, 4],
      ["Fault return", 36, 8],
      ["Overload", 44, 8],
      ["Last pixel", 52, 4],
    ] as const)
      s.section(name, start, bars);
    s.track(
      voice("kick", "Rubber kick", "kit", 0.74, {
        kit: "syn808",
        fx: { duck: { orbit: 2, depth: 0.55, attack: 0.1 } },
      }),
    );
    s.track(
      voice("snap", "Snap & clap", "kit", 0.5, {
        kit: "synlinn",
        reverb: { mix: 0.08, size: 0.25, fade: 0.5 },
        humanize: { timing: 2, velocity: 4, seed: 11 },
      }),
    );
    s.track(
      voice("hats", "Needle hats", "kit", 0.3, {
        kit: "syn808",
        pan: 0.14,
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
      voice("hook", "Plastic hook", "pulse", 0.2, {
        pan: 0.08,
        synth: {
          attack: 0.003,
          decay: 0.1,
          sustain: 0.32,
          release: 0.08,
          pw: 0.22,
          lpf: 6500,
        },
        filter: { type: "hpf", cutoff: 260, resonance: 0 },
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
            [36, 0.28],
            [44, 0.42],
            [51, 0.12],
            [56, 0.3],
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
      voice("chords", "Sugar stack", "supersaw", 0.12, {
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
        filter: { type: "hpf", cutoff: 300, resonance: 0 },
        reverb: room,
        fx: orbit,
        fxAutomation: {
          "synth-lpf": lanes(
            [0, 5200],
            [12, 900],
            [15.9, 5200],
            [31, 900],
            [35.9, 5600],
            [44, 6400],
            [56, 6400],
          ),
          // A. G. Cook's move: one layer drifts from pretty to harsh.
          "synth-detune": lanes(
            [0, 0.26],
            [36, 0.32],
            [44, 0.4],
            [51.5, 0.85],
            [52, 0.3],
          ),
        },
      }),
    );
    s.track(
      voice("arp", "Chip arp", "square", 0.09, {
        pan: -0.26,
        synth: {
          attack: 0.002,
          decay: 0.09,
          sustain: 0.12,
          release: 0.05,
          lpf: 7500,
        },
        filter: { type: "hpf", cutoff: 600, resonance: 0 },
        delay: { beats: 0.75, feedback: 0.3, mix: 0.16, pingpong: true },
        fx: orbit,
        humanize: { timing: 2, velocity: 6, seed: 18 },
      }),
    );
    s.track(
      voice("vocal", "Candy singer", "sing", 0.5, {
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
        delay: { beats: 0.75, feedback: 0.28, mix: 0.08 },
        delayMixAutomation: throws(
          [13, 17, 19, 21, 23, 25, 27, 29, 31, 37, 39, 41, 43, 45, 47, 49],
          0.07,
          0.34,
        ),
        reverb: room,
        humanize: { timing: 6, velocity: 5, length: 4, seed: 16 },
      }),
    );
    s.track(
      voice("harm", "Candy double", "sing", 0.26, {
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
          s.note(
            track,
            bar,
            beat,
            pitch + transpose,
            length,
            velocity * gain,
            {
              ...(lyric ? { lyric } : {}),
              ...(length >= 0.85 ? scoop(-80, 0.1) : {}),
              ...(long && pitch >= 75 ? { vibrato: { rate: 5.8, depth: 32, delay: 0.28 } } : {}),
            },
          );
        }
    };
    /** Backing singer: thirds under the held notes (octave below when asked). */
    const shadow = (line: Line, octave: boolean, gain: number) => {
      for (const [bar, phrase] of line)
        for (const [beat, pitch, length, velocity = 0.7, lyric] of phrase)
          if (octave || length >= 0.8)
            s.note(
              "harm",
              bar,
              beat,
              octave ? pitch - 12 : thirdBelow(pitch),
              length,
              velocity * gain,
              lyric ? { lyric } : {},
            );
    };
    const hook = (bar: number, phrase: Phrase, gain = 1, transpose = 0) => {
      phrase.forEach(([beat, pitch, length, velocity = 0.7], i) => {
        const last = i === phrase.length - 1;
        s.note("hook", bar, beat, pitch + transpose, length, velocity * gain, {
          ...(i > 0 && !last ? { glide: 0.035 } : {}),
          ...(last ? scoop(-140, 0.18) : {}),
          ...(last && length >= 0.7
            ? { vibrato: { rate: 6.2, depth: 24, delay: 0.12 } }
            : {}),
        });
      });
    };
    const arp = (bar: number, tones: readonly number[], gain: number, order: readonly number[]) =>
      order.forEach((index, i) =>
        s.note(
          "arp",
          bar,
          i * 0.25,
          tones[index]!,
          0.2,
          (i % 4 === 0 ? 0.82 : i % 2 === 0 ? 0.62 : 0.5) * gain,
        ),
      );
    const ARP_UP = [0, 1, 2, 3, 0, 1, 2, 3, 1, 2, 3, 2, 1, 2, 3, 2];
    const ARP_CASCADE = [3, 2, 1, 0, 3, 2, 1, 0, 3, 2, 1, 2, 3, 2, 1, 2];
    const rolled = (track: string, bar: number, beat: number, pitches: readonly number[], length: number, velocity: number, spread = 0.035) =>
      pitches.forEach((pitch, i) =>
        s.note(track, bar, beat + i * spread, pitch, length - i * spread, velocity * (i === pitches.length - 1 ? 1.06 : 0.9)),
      );

    /** Kick plus an 808 that locks to it: each hit sustains to the next. */
    const kickBar = (b: number, grid: string, opts: { drop?: boolean; pops?: boolean } = {}) => {
      if (!grid) return;
      s.grid("kick", b, 36, grid);
      const root = H[PROG[b]!]!.root;
      const next = b + 1 < 56 ? H[PROG[b + 1]!]!.root : root;
      const prev = b > 0 ? H[PROG[b - 1]!]!.root : root;
      const onsets = [...grid].flatMap((c, i) => (c === "." ? [] : [i]));
      onsets.forEach((step, k) => {
        const end = k + 1 < onsets.length ? onsets[k + 1]! : 16;
        const velocity = Number(grid[step]) / 10;
        const lastHit = k === onsets.length - 1;
        // Pops: the last offbeat hit of a bar jumps an octave before a root change.
        const pop = opts.pops && lastHit && step >= 10 && next !== root;
        const length = (end - step) * 0.25 - (lastHit && next !== root ? -0.02 : 0.06);
        const extra: Extra =
          k === 0 && opts.drop
            ? {
                bend: [
                  { at: 0, cents: 1200 },
                  { at: 0.3, cents: 0 },
                ],
              }
            : k === 0 && prev !== root
              ? { glide: 0.07 }
              : pop
                ? { glide: 0.05 }
                : {};
        s.note("sub", b, step * 0.25, pop ? root + 12 : root, length, Math.min(0.9, velocity * 0.95), extra);
      });
    };

    for (let b = 0; b < 56; b++) {
      const part = partOf(b);
      const h = H[PROG[b]!]!;
      const inPart = b - [0, 4, 12, 16, 24, 32, 36, 44, 52][
        ["boot", "verse", "lift", "chorus", "soft", "rebuild", "return", "over", "last"].indexOf(part)
      ]!;
      const chorusLike = part === "chorus" || part === "return" || part === "over";

      // ── drums ─────────────────────────────────────────────────────────
      if (part === "boot" && b === 3) {
        s.grid("hats", b, 42, "1122334455667788", 0.75);
        hit("snap", b, 3.5, 39, 0.5);
      }
      if (part === "verse") {
        kickBar(b, KICK.verse![inPart % 4]!, { pops: true, drop: b === 4 });
        s.grid("snap", b, 38, "........9.......");
        s.grid("snap", b, 39, "........7.......");
        if (inPart % 4 === 1) s.grid("snap", b, 38, "..........2....3");
        if (inPart % 4 === 3) s.grid("snap", b, 38, "...2..........3.");
        s.grid("hats", b, 42, HATS_HALF[inPart % 4]!);
        if (inPart % 4 === 1) roll("hats", b, 3.5, 4, 0.125, 42, 0.35, 0.6);
        if (inPart % 4 === 2) roll("hats", b, 3, 6, 1 / 6, 42, 0.3, 0.62, [3]);
        if (inPart % 4 === 3) hit("hats", b, 3.5, 46, 0.5, 0.4);
        if (b === 7) roll("snap", b, 3.5, 8, 1 / 16, 38, 0.55, 0.2);
      }
      if (part === "lift") {
        kickBar(b, KICK.lift![inPart]!, { pops: true });
        if (inPart < 2) {
          s.grid("snap", b, 38, inPart ? "....8.......8.5." : "....8.......8...");
          s.grid("snap", b, 39, "....6.......6...");
        } else if (inPart === 2) s.grid("snap", b, 38, "4.5.5.6.6.7.7.8.");
        else {
          s.grid("snap", b, 38, "5566778899......");
          roll("snap", b, 2.5, 12, 0.125, [41, 41, 43, 43, 45, 45, 47, 47, 48, 48, 50, 50], 0.45, 0.95);
        }
        s.grid("hats", b, 42, "6363636363636363", 0.7 + inPart * 0.1);
        if (inPart === 3) roll("hats", b, 2, 8, 0.125, 42, 0.4, 0.8);
      }
      if (chorusLike) {
        const grids = part === "over" ? KICK.over! : KICK.chorus!;
        const last = inPart === 7;
        const dropout = part === "return" && inPart === 3;
        kickBar(b, last ? "9...8...9......." : dropout ? "9...8..........." : grids[inPart % 4]!, {
          pops: true,
          drop: inPart === 0,
        });
        s.grid("snap", b, 38, dropout ? "....9..........." : "....9.......9...");
        s.grid("snap", b, 39, dropout ? "....8..........." : "....8.......8...");
        if (inPart % 4 === 3 && !last && !dropout) s.grid("snap", b, 38, "..............45");
        if (dropout) roll("snap", b, 2.5, 6, 0.25, [45, 45, 47, 47, 48, 50], 0.45, 0.9);
        if (inPart === 3 && part !== "return") roll("snap", b, 3.5, 8, 1 / 16, 38, 0.6, 0.18);
        if (last && part === "chorus") roll("snap", b, 3, 8, 0.125, [50, 48, 47, 45, 43, 41, 41, 41], 0.8, 0.4);
        if (last && part === "return") roll("snap", b, 2, 4, 0.25, 38, 0.6, 0.85);
        if (last && part === "over") roll("snap", b, 2, 16, 0.125, 38, 0.35, 0.95);
        if (inPart === 0) hit("hats", b, 0, 49, part === "chorus" ? 0.75 : 0.85, 2);
        if (!dropout) {
          const drive = HATS_DRIVE[inPart % 4]!;
          s.grid("hats", b, 42, last ? "8465846584658..." : drive, part === "over" ? 1.05 : 0.95);
          const variant = (inPart + (part === "return" ? 1 : part === "over" ? 2 : 0)) % 4;
          if (inPart % 4 === 1)
            variant % 2
              ? roll("hats", b, 3.25, 6, 0.125, 42, 0.38, 0.78, [3])
              : roll("hats", b, 3, 6, 1 / 6, 42, 0.35, 0.75);
          if (inPart % 4 === 3 && !last) {
            roll("hats", b, 2.75, 10, 0.125, 42, 0.4, 0.82, [4, 9]);
            hit("hats", b, 3.5, 46, 0.55, 0.45);
          }
          if (part === "over" && inPart % 2 === 0)
            roll("hats", b, 1.5, 4, 0.125, 42, 0.32, 0.55);
        }
      }
      if (part === "soft") {
        if (b === 24) hit("hats", b, 0, 49, 0.42, 2);
        if (b >= 28) {
          s.grid("hats", b, 42, b === 31 ? "3.2.3.2.4.3.4.35" : "3.2.3.2.3.2.3.2.", 0.9);
          if (b === 29) roll("hats", b, 3, 6, 1 / 6, 42, 0.18, 0.4);
          s.grid("snap", b, 37, "........4.......");
          if (b === 31) roll("snap", b, 2, 8, 0.25, 38, 0.15, 0.62);
        }
      }
      if (part === "rebuild") {
        const grid = KICK.rebuild![inPart]!;
        s.grid("kick", b, 36, grid);
        s.note("sub", b, 0, h.root, inPart === 3 ? 2.9 : 3.95, 0.7, inPart > 0 && h.root !== H[PROG[b - 1]!]!.root ? { glide: 0.09 } : {});
        if (inPart === 3) s.note("sub", b, 3, h.root + 12, 0.95, 0.62, { glide: 0.05, ...fall(-1200, 0.2) });
        s.grid("snap", b, 38, ["....7.......7...", "....7...5...7.6.", "6.6.7.7.8.8.9.9.", "6677889999......"][inPart]!);
        s.grid("snap", b, 39, inPart < 2 ? "....6.......6..." : "................");
        if (inPart === 3) roll("snap", b, 2.5, 10, 0.125, [41, 41, 43, 43, 45, 45, 47, 48, 50, 50], 0.5, 0.95);
        s.grid("hats", b, 42, inPart < 2 ? "6.4.6.4.6.4.6.4." : "6464646464646464", 0.8 + inPart * 0.08);
      }
      if (part === "last") {
        kickBar(b, KICK.last![inPart]!, {});
        if (inPart < 2) {
          s.grid("snap", b, 38, "........6.......", 0.8);
          s.grid("hats", b, 42, "5.3.4.3.5.3.4.3.", 0.7 - inPart * 0.15);
        }
        if (b === 52) hit("hats", b, 0, 49, 0.6, 2);
        if (b === 54) s.note("sub", b, 0, h.root, 3.9, 0.55);
        if (b === 55) s.note("sub", b, 0, h.root, 3.6, 0.55, fall(-1200, 0.45));
      }
      if (part === "soft") {
        // Sub stays (pinned silence covers kick, hook and supersaw only).
        s.note("sub", b, 0, h.root, 3.6, 0.38, b > 24 && h.root !== H[PROG[b - 1]!]!.root ? { glide: 0.12 } : {});
      }

      // ── harmony ───────────────────────────────────────────────────────
      if (part === "boot") rolled("keys", b, 0, h.keys, 3.85, 0.42);
      if (part === "verse" && inPart % 2 === 0) {
        rolled("keys", b, 0, h.keys, 2.9, 0.46);
        rolled("keys", b, 3, h.keys.slice(1), 0.9, 0.34, 0.02);
        rolled("keys", b + 1, 1.5, h.keys.slice(1), 2.3, 0.38, 0.02);
      }
      if (part === "soft") {
        rolled("keys", b, 0, [h.root + 12, ...h.keys], 2.4, b < 28 ? 0.6 : 0.56, 0.045);
        rolled("keys", b, 2.5, h.keys.slice(1), 1.4, 0.42, 0.03);
      }
      if (part === "last" && b < 55) rolled("keys", b, 0, h.keys, 3.85, 0.44 - inPart * 0.04);
      if (b === 55) rolled("keys", b, 0, [52, 56, 59, 63, 66], 3.9, 0.4, 0.05);
      if ((part === "lift" || part === "rebuild" || chorusLike) && h.saw.length) {
        const top = part === "over" ? [h.saw[h.saw.length - 1]! + 12] : [];
        s.chord("chords", b, 0, [...h.saw, ...top], part === "lift" || part === "rebuild" ? 3.9 : 3.8, part === "lift" ? 0.5 : 0.6);
        if (part === "return" || part === "over")
          for (const beat of [0.5, 1.5, 2.5, 3.5])
            s.chord("chords", b, beat, h.saw.slice(2).map((p) => p + 12), 0.22, 0.42);
      }
      if (b === 15) s.chord("chords", b, 2, H.B!.saw, 1.9, 0.5);
      if (b === 35) s.chord("chords", b, 0, H.B!.saw, 3, 0.62);

      // ── chip arps: hint in the intro, second half of chorus one, then all ─
      if (b === 2 || b === 3) arp(b, h.arp, 0.45 + (b - 2) * 0.15, ARP_UP);
      if ((part === "chorus" && inPart >= 4) || part === "return")
        arp(b, h.arp, part === "chorus" ? 0.7 : 0.8, inPart % 2 ? ARP_CASCADE : ARP_UP);
      if (part === "over") arp(b, h.arp, 0.95, inPart % 2 ? ARP_CASCADE : ARP_UP);
      if (part === "soft" && b >= 28) {
        for (const [beat, index] of [[0.5, 3], [1.25, 2], [2, 1], [2.75, 2], [3.5, 3]] as const)
          s.note("spark", b, beat, h.arp[index]!, 0.5, 0.28 + (b - 28) * 0.04);
      }

      // ── hook: identity motif in the intro, answers between sung lines ───
      if (part === "boot") {
        if (b % 2 === 0) hook(b, b === 2 ? MOTIF_IV : MOTIF, 0.72);
        else hook(b, ANSWERS[b === 1 ? 0 : 1]!.map(([beat, pitch, length, velocity]) => [beat - 1.5, pitch, length, velocity] as const), 0.66);
      }
      if (b === 9) hook(b, ANSWERS[0]!, 0.5);
      if (b === 11) hook(b, ANSWERS[1]!, 0.56);
      if (b === 13) hook(b, ANSWERS[0]!, 0.62);
      if (chorusLike && (inPart === 1 || inPart === 5))
        hook(b, ANSWERS[inPart === 1 ? 0 : 2]!, part === "chorus" ? 0.9 : 1);
      if (chorusLike && inPart === 7)
        hook(b, MOTIF_IV.map(([beat, pitch, length, velocity]) => [beat + 1, pitch, length, velocity] as const), part === "over" ? 1 : 0.85);
      if (part === "rebuild" && inPart < 3) hook(b, ANSWERS[inPart === 2 ? 2 : inPart]!, 0.62 + inPart * 0.08);
      if (b === 55) hook(b, MOTIF, 0.5);

      // ── chops: up-pixel answers and stutters ─────────────────────────────
      if (b === 7)
        s.phrase("chops", b, [
          [2.5, 80, 0.25, 0.6],
          [3, 83, 0.25, 0.62],
          [3.5, 85, 0.25, 0.58],
        ]);
      if (b === 11) roll("chops", b, 2, 8, 0.25, [78, 80, 80, 83, 83, 85, 87, 88], 0.45, 0.7);
      if (b === 15 || b === 35) roll("chops", b, 2.5, 4, 0.25, [83, 85, 87, 88], 0.5, 0.72);
      if (chorusLike && (inPart === 3 || inPart === 7)) {
        s.phrase("chops", b, [
          [2, 83, 0.25, 0.66],
          [2.5, 83, 0.25, 0.6],
          [2.75, 80, 0.25, 0.62],
          [3.25, 78, 0.22, 0.6],
        ]);
        if (part === "over") roll("chops", b, 3.5, 4, 0.125, [88, 88, 85, 83], 0.66, 0.45);
      }
      if (part === "over" && inPart % 2 === 0) s.note("chops", b, 3.75, 88, 0.12, 0.42);

      // ── sparkle and tape ──────────────────────────────────────────────
      if ([0, 4, 12, 16, 24, 32, 36, 44, 52].includes(b))
        s.note("spark", b, part === "boot" ? 0.5 : 0, 88, 1.2, 0.6);
      if (b === 1) s.note("spark", b, 2.5, 83, 1, 0.42);
    }

    // ── topline ───────────────────────────────────────────────────────────
    sing("vocal", VERSE);
    sing("vocal", LIFT);
    sing("vocal", CHORUS_ONE);
    sing("vocal", SOFT, 0, 1);
    sing("vocal", REBUILD);
    sing("vocal", CHORUS_TWO);
    sing("vocal", OVERLOAD);
    sing("vocal", LAST);
    shadow(LIFT.slice(2), false, 0.62);
    shadow(CHORUS_ONE, false, 0.6);
    shadow(CHORUS_TWO, false, 0.66);
    shadow(OVERLOAD, true, 0.6);
    shadow(SOFT.slice(4), false, 0.5);

    // Transitions: tape tears, risers into both choruses.
    for (const [bar, beat] of [
      [3, 3],
      [11, 3.5],
      [23, 3],
      [31, 3.5],
      [43, 2.5],
      [51, 3],
    ] as const)
      s.note("tear", bar, beat, 60, 0.45, 0.78);
    s.note("tear", 14, 2.75, 48, 5.2, 0.62);
    s.note("tear", 34, 2.75, 48, 5.2, 0.66);
    s.note("tear", 42, 2, 48, 5, 0.6);

    // A whole-mix silent beat before Overload: nothing starts or rings in it.
    const gapBegin = 44 * BAR - 480,
      gapEnd = 44 * BAR;
    for (let i = s.notes.length - 1; i >= 0; i--) {
      const n = s.notes[i]!;
      const start = n.startTick!;
      if (start >= gapBegin && start < gapEnd) s.notes.splice(i, 1);
      else if (start < gapBegin && start + n.durationTicks! > gapBegin)
        s.notes[i] = { ...n, durationTicks: gapBegin - start };
    }
    return s.finish();
  },
};
