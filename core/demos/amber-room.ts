/** Amber Room: the neo soul demo song. */
import type { PedalEvent } from "../expression.ts";
import type { NoteInput } from "../score.ts";
import { Composer, hall, room, voice } from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

/*
 * The feel, in beats at 96 BPM (a beat is 625 ms, so 0.016 beat is 10 ms).
 * After Dilla and Questlove: the layers rub against each other. The kick
 * leans a hair early, the backbeat sits late, the hats swing their 16ths
 * (about 56%), the bass settles behind the drums as Pino Palladino does on
 * Voodoo, the keys roll their chords from the bottom up a little late, and
 * the sax phrases furthest back, like a singer.
 */
const KICK = -0.012;
const SNARE = 0.03;
const SWING = 0.03;
const BASS = 0.034;
const KEYS = 0.026;
const SAX = 0.048;
/** The vibes sit with the Rhodes, a little behind the kit. */
const VIBES = 0.02;
const TICKS_PER_BAR = 1920;
const TICKS_PER_BEAT = 480;

/** [beat in the bar (may run past 4), pitch, length, velocity, ornament] */
type Line = readonly (readonly [number, number, number, number, string?])[];

/**
 * A chord quality, as semitones above the root (the bass plays the root):
 * the A and B rootless forms a pianist alternates between so one or two
 * voices move per change (after Mark Levine), the three-note left-hand
 * shells (third and seventh plus one colour, a fourth or wider at the
 * bottom so they stay clear low down) for when the right hand has the
 * tune, and the third, fifth and seventh the bass walks through.
 */
type Quality = Readonly<{
  forms: readonly (readonly number[])[];
  shells: readonly (readonly number[])[];
  third: number;
  fifth: number;
  seventh: number;
  /** Forms a pianist swaps in when the tune would rub against a form. */
  alts: readonly (readonly number[])[];
}>;
const quality = (
  forms: Quality["forms"],
  shells: Quality["shells"],
  [third, fifth, seventh]: readonly [number, number, number],
  alts: Quality["alts"] = [],
): Quality => ({ forms, shells, third, fifth, seventh, alts });
const M9 = quality(
  [
    [3, 7, 10, 14],
    [10, 14, 15, 19],
  ],
  [
    [3, 10, 14],
    [10, 15, 19],
  ],
  [3, 7, 10],
  [
    [3, 7, 10, 17],
    [5, 10, 15, 19],
  ],
);
/** m11 as the quartal "So What" stack, or b3 5 b7 11. */
const M11 = quality(
  [
    [5, 10, 15, 19],
    [3, 7, 10, 17],
  ],
  [
    [3, 10, 17],
    [5, 10, 15],
  ],
  [3, 7, 10],
  [[3, 10, 14, 17]],
);
const MAJ9 = quality(
  [
    [4, 7, 11, 14],
    [11, 14, 16, 19],
  ],
  [
    [4, 11, 14],
    [11, 16, 21],
  ],
  [4, 7, 11],
  [
    [4, 7, 9, 14],
    [9, 14, 16, 19],
  ],
);
/** Lydian: 3 7 9 #11, or the major seventh a fifth up over the root. */
const MAJ9S11 = quality(
  [
    [4, 11, 14, 18],
    [7, 11, 14, 18],
  ],
  [
    [4, 11, 18],
    [11, 16, 21],
  ],
  [4, 7, 11],
  [
    [4, 7, 11, 14],
    [11, 14, 16, 19],
  ],
);
const DOM13 = quality(
  [
    [10, 14, 16, 21],
    [4, 9, 10, 14],
  ],
  [
    [4, 10, 14],
    [10, 16, 21],
  ],
  [4, 7, 10],
  [
    [4, 10, 14, 19],
    [10, 14, 16, 19],
  ],
);
/** The "Bbmaj7 over C" sus sound. */
const SUS13 = quality(
  [
    [10, 14, 17, 21],
    [5, 9, 10, 14],
  ],
  [
    [5, 10, 14],
    [10, 17, 21],
  ],
  [5, 7, 10],
  [[5, 10, 14, 19]],
);
/** 3 b7 #9 b13; the bass leans on the seventh, never the fifth. */
const ALT = quality(
  [
    [4, 10, 15, 20],
    [10, 16, 20, 27],
  ],
  [
    [4, 10, 15],
    [10, 16, 20],
  ],
  [4, 10, 10],
  [
    [4, 10, 13, 20],
    [4, 10, 13],
    [10, 13, 16],
  ],
);
const SHARP9 = quality(
  [
    [4, 10, 15, 19],
    [10, 16, 19, 27],
  ],
  [
    [4, 10, 15],
    [10, 16, 21],
  ],
  [4, 7, 10],
);
const MAJ7S11 = MAJ9S11;

/** [beat in the bar, bass root, chord quality] */
type Span = readonly [number, number, Quality];

/**
 * The head: the ii-V-I-bVII "Glasper cycle" (Gm9 C13 Fmaj9 Ebmaj9) into a
 * bass line that walks down by half steps (Eb D Db C) and a turnaround whose
 * Ab13 drops a half step onto the Gm9 that starts the cycle again.
 */
const CYCLE: readonly (readonly Span[])[] = [
  [[0, 31, M9]],
  [[0, 36, DOM13]],
  [[0, 41, MAJ9]],
  [[0, 39, MAJ9S11]],
  [[0, 38, M9]],
  [[0, 37, MAJ9S11]],
  [
    [0, 36, SUS13],
    [2, 36, ALT],
  ],
  [
    [0, 29, MAJ9],
    [2.5, 32, DOM13],
  ],
];

/** The bridge borrows the minor iv and a tritone sub before it comes home. */
const BRIDGE: readonly (readonly Span[])[] = [
  [[0, 34, MAJ9]],
  [[0, 34, M9]],
  [[0, 33, M11]],
  [[0, 38, SHARP9]],
  [[0, 31, M11]],
  [[0, 30, DOM13]],
  [[0, 29, MAJ9]],
  [[0, 32, DOM13]],
];

const ENDING: readonly (readonly Span[])[] = [
  [
    [0, 31, M9],
    [2, 30, MAJ7S11],
  ],
  [[0, 29, MAJ9]],
  [[0, 29, MAJ9]],
  [[0, 29, MAJ9]],
];

function harmony(bar: number): readonly Span[] {
  if (bar < 4) return CYCLE[bar + 4]!;
  if (bar < 20) return CYCLE[(bar - 4) % 8]!;
  if (bar < 28) return BRIDGE[bar - 20]!;
  if (bar < 44) return CYCLE[(bar - 28) % 8]!;
  return ENDING[bar - 44]!;
}

/**
 * The shape nearest the previous voicing: each shape in the two octaves
 * whose bottom note sits at or above `low`, scored by how far the voices
 * move plus a pull toward `centre`. A shape whose top note climbs past
 * `top` (into the sax) costs extra, and so does every voice a half step or
 * a minor ninth from a note the tune holds over the chord (weighted by how
 * long it is held, less two octaves apart), so the chain steps around
 * the rubs a pianist would hear. Each shape carries its own colour cost.
 */
function lead(
  previous: readonly number[],
  root: number,
  shapes: readonly (readonly [number, readonly number[]])[],
  [low, centre, top]: readonly [number, number, number],
  tune: readonly (readonly [number, number])[],
): number[] {
  let best: number[] = [];
  let bestCost = Infinity;
  for (const [colour, shape] of shapes) {
    const lift = Math.ceil((low - root - shape[0]!) / 12) * 12;
    for (const octave of [0, 12]) {
      const pitches = shape.map((tone) => root + tone + lift + octave);
      const mean =
        pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length;
      const moved = pitches.reduce(
        (sum, pitch, i) => sum + Math.abs(pitch - (previous[i] ?? pitch)),
        0,
      );
      let rub = 0;
      for (const [sung, held] of tune)
        for (const pitch of pitches) {
          const gap = Math.abs(sung - pitch);
          if (gap % 12 === 1)
            rub += (gap <= 13 ? 20 : gap <= 25 ? 8 : 0) * Math.max(0.3, held);
        }
      const cost =
        colour +
        moved +
        rub +
        0.5 * Math.abs(mean - centre) +
        4 * Math.max(0, pitches.at(-1)! - top);
      if (cost < bestCost) {
        bestCost = cost;
        best = pitches;
      }
    }
  }
  return best;
}

/** Seeded so the song is identical every time (mulberry32). */
function grain(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sax ornaments: s scoop, f fall, v late vibrato, g ghost, a accent. */
function ornament(code: string, length: number): Partial<NoteInput> {
  const seconds = length * 0.625;
  const bend: { at: number; cents: number }[] = [];
  if (code.includes("s"))
    bend.push(
      { at: 0, cents: -130 },
      { at: Math.min(0.4, 0.085 / seconds), cents: 0 },
    );
  if (code.includes("f")) {
    const from = Math.max(0.45, 1 - 0.2 / seconds);
    if (!bend.length || bend.at(-1)!.at < from)
      bend.push({ at: from, cents: 0 }, { at: 1, cents: -320 });
  }
  return {
    ...(bend.length ? { bend } : {}),
    ...(code.includes("v")
      ? { vibrato: { rate: 5.1, depth: 24, delay: 0.3 } }
      : {}),
    ...(code.includes("g")
      ? { articulation: "ghost" as const }
      : code.includes("a")
        ? { articulation: "accent" as const }
        : {}),
  };
}

// The six-note theme (A C D C, A G) and its developments.
const THEME: Line = [
  [0.5, 69, 0.55, 0.66, "s"],
  [1.25, 72, 0.45, 0.62],
  [2, 74, 0.75, 0.76, "a"],
  [3, 72, 1.5, 0.68, "v"],
  [5, 69, 0.7, 0.6],
  [6.25, 67, 1.35, 0.64, "vf"],
];
const ANSWER: Line = [
  [0.75, 65, 0.5, 0.58, "s"],
  [1.5, 67, 0.45, 0.6],
  [2.25, 69, 0.6, 0.68],
  [3.25, 64, 0.25, 0.56, "g"],
  [4.5, 62, 0.45, 0.56],
  [5.25, 65, 0.45, 0.6],
  [6, 67, 1.6, 0.64, "vf"],
];
const THEME_DOWN: Line = [
  [0.5, 69, 0.55, 0.66, "s"],
  [1.25, 72, 0.45, 0.64],
  [2, 76, 0.75, 0.78, "a"],
  [3, 74, 1.4, 0.7, "v"],
  [5, 72, 0.7, 0.62],
  [6.25, 68, 1.2, 0.64, "vf"],
];
const TURN: Line = [
  [0.5, 67, 0.3, 0.55, "g"],
  [1, 70, 0.45, 0.6],
  [1.75, 69, 0.5, 0.64],
  [2.5, 68, 0.5, 0.66, "s"],
  [3.25, 67, 0.4, 0.58],
  [3.75, 64, 0.6, 0.6],
  [4.5, 69, 1.7, 0.64, "v"],
];
const THEME_GRACE: Line = [
  [0.3, 68, 0.1, 0.42, "g"],
  [0.42, 69, 0.4, 0.68],
  [1.25, 72, 0.4, 0.64],
  [2, 74, 0.45, 0.76],
  [2.5, 77, 0.45, 0.72, "s"],
  [3, 74, 1.4, 0.7, "v"],
  [5, 72, 0.45, 0.62],
  [5.5, 69, 0.4, 0.6],
  [6.25, 67, 1.4, 0.66, "vf"],
];
const ANSWER_UP: Line = [
  [0.5, 72, 0.4, 0.62, "s"],
  [1, 74, 0.4, 0.66],
  [1.5, 76, 0.75, 0.74],
  [2.5, 74, 0.35, 0.6, "g"],
  [3, 72, 0.9, 0.64],
  [4.5, 74, 0.5, 0.66],
  [5.25, 77, 0.5, 0.7, "s"],
  [6, 74, 1.6, 0.7, "vf"],
];
const THEME_HIGH: Line = [
  [0.5, 76, 0.5, 0.72, "s"],
  [1.25, 77, 0.4, 0.7],
  [2, 76, 0.4, 0.68],
  [2.5, 74, 0.4, 0.64, "g"],
  [3, 72, 1.2, 0.68, "v"],
  [5, 75, 0.5, 0.66],
  [5.75, 72, 0.4, 0.62],
  [6.25, 68, 1.2, 0.64, "vf"],
];
const TURN_OUT: Line = [
  [0.5, 70, 0.4, 0.58],
  [1, 74, 0.4, 0.62],
  [1.75, 72, 0.5, 0.64],
  [2.5, 68, 0.6, 0.66, "s"],
  [3.25, 63, 0.4, 0.56, "g"],
  [3.75, 64, 0.5, 0.6],
  [4.5, 65, 0.4, 0.58],
  [5, 69, 1.2, 0.64, "v"],
  [6.5, 72, 0.5, 0.62],
  [7.25, 70, 0.6, 0.6, "f"],
];
const BRIDGE_SAX: Line = [
  [0.5, 69, 2.8, 0.58, "sv"],
  [4.5, 68, 1, 0.56, "s"],
  [5.75, 65, 0.5, 0.52, "g"],
  [6.5, 61, 1.3, 0.55, "vf"],
  [8.75, 64, 0.45, 0.55],
  [9.25, 67, 0.45, 0.58],
  [10, 72, 1.6, 0.62, "v"],
  [12.5, 72, 0.4, 0.6],
  [13, 77, 0.8, 0.68, "s"],
  [14, 74, 0.4, 0.6],
  [14.5, 72, 0.4, 0.58, "g"],
  [15, 69, 0.8, 0.6, "f"],
  [16.5, 70, 2.5, 0.62, "sv"],
  [20.5, 68, 0.5, 0.58],
  [21.25, 70, 0.4, 0.6],
  [22, 72, 1.5, 0.66, "v"],
  [24.5, 69, 0.4, 0.6],
  [25, 67, 0.4, 0.58, "g"],
  [25.5, 64, 2, 0.6, "vf"],
];
const CLIMB: Line = [
  [0.3, 68, 0.1, 0.48, "g"],
  [0.42, 69, 0.4, 0.72],
  [1.25, 72, 0.4, 0.7],
  [2, 74, 0.45, 0.8],
  [2.5, 77, 0.45, 0.78, "s"],
  [3, 74, 1.4, 0.74, "v"],
  [5, 72, 0.4, 0.66],
  [5.5, 74, 0.4, 0.68],
  [6, 76, 1.6, 0.74, "vf"],
  [8.5, 77, 0.4, 0.74, "s"],
  [9, 76, 0.4, 0.72],
  [9.5, 72, 0.4, 0.66, "g"],
  [10, 74, 0.5, 0.7],
  [10.75, 76, 0.9, 0.74, "v"],
  [12.5, 77, 0.4, 0.76],
  [13, 79, 0.5, 0.8, "s"],
  [14, 77, 1.5, 0.76, "vf"],
];
const PEAK: Line = [
  [0.5, 76, 0.4, 0.78, "s"],
  [1, 77, 0.6, 0.82],
  [1.75, 79, 1.35, 0.88, "sv"],
  [3.25, 77, 0.4, 0.74],
  [3.75, 76, 0.25, 0.72, "g"],
  [4.5, 75, 0.4, 0.72],
  [5, 72, 0.4, 0.68],
  [5.5, 79, 1.3, 0.82, "svf"],
  [8.5, 74, 0.4, 0.68],
  [9, 72, 0.4, 0.66, "g"],
  [9.5, 70, 0.45, 0.64],
  [10.25, 68, 0.6, 0.68, "s"],
  [11, 67, 0.4, 0.62],
  [11.5, 64, 0.5, 0.6],
  [12.25, 69, 1.7, 0.66, "v"],
  [14.75, 72, 0.5, 0.6],
  [15.5, 70, 0.5, 0.58, "g"],
];
const GOODNIGHT_SAX: Line = [
  [0.5, 69, 0.5, 0.62, "s"],
  [1.25, 72, 0.45, 0.6],
  [2, 73, 0.75, 0.66],
  [3, 72, 1.2, 0.62, "v"],
  [4.5, 69, 5.2, 0.6, "svf"],
];

/** The Rhodes alone in the middle: the theme's shape, sung on the keys. */
const KEYS_SOLO: Line = [
  [0.25, 70, 0.2, 0.55],
  [0.5, 74, 0.4, 0.62],
  [1, 77, 0.5, 0.66],
  [1.75, 76, 0.25, 0.56],
  [2, 74, 0.3, 0.6],
  [2.5, 72, 0.3, 0.56],
  [3, 69, 0.8, 0.6],
  [4.75, 69, 0.25, 0.54],
  [5, 70, 0.25, 0.56],
  [5.25, 72, 0.25, 0.6],
  [5.5, 76, 0.5, 0.66],
  [6.25, 74, 0.25, 0.58],
  [6.5, 72, 0.25, 0.56],
  [6.75, 69, 0.5, 0.58],
  [7.5, 67, 0.4, 0.54],
  [8, 69, 0.5, 0.58],
  [8.75, 72, 0.25, 0.58],
  [9, 76, 0.9, 0.65],
  [10.25, 79, 0.3, 0.62],
  [10.5, 76, 0.3, 0.58],
  [11, 72, 0.4, 0.56],
  [11.5, 74, 0.4, 0.58],
  [12, 74, 0.5, 0.6],
  [12.5, 77, 0.3, 0.62],
  [13, 79, 0.4, 0.64],
  [13.5, 81, 0.6, 0.68],
  [14.5, 79, 0.3, 0.6],
  [15, 74, 0.3, 0.56],
  [15.25, 70, 0.5, 0.56],
  [16, 69, 0.25, 0.56],
  [16.25, 72, 0.25, 0.58],
  [16.5, 76, 0.25, 0.6],
  [16.75, 77, 1, 0.66],
  [18, 76, 0.25, 0.58],
  [18.25, 74, 0.25, 0.56],
  [18.5, 72, 0.25, 0.56],
  [18.75, 69, 0.7, 0.58],
  [20.5, 68, 0.25, 0.56],
  [20.75, 72, 0.25, 0.58],
  [21, 75, 0.25, 0.6],
  [21.25, 79, 0.75, 0.7],
  [22.25, 77, 0.25, 0.6],
  [22.5, 75, 0.25, 0.58],
  [22.75, 72, 0.5, 0.58],
  [23.5, 68, 0.4, 0.54],
  [24, 70, 0.5, 0.58],
  [24.5, 74, 0.25, 0.6],
  [24.75, 77, 0.5, 0.64],
  [25.5, 81, 0.4, 0.68],
  [26, 80, 0.5, 0.7],
  [26.5, 75, 0.25, 0.6],
  [26.75, 76, 0.25, 0.58],
  [27, 70, 0.4, 0.56],
  [27.5, 68, 0.4, 0.54],
  [28, 69, 1, 0.6],
  [29, 72, 0.25, 0.56],
  [29.25, 76, 0.25, 0.58],
  [29.5, 79, 0.5, 0.62],
  [30.5, 77, 0.4, 0.6],
  [31, 72, 0.3, 0.56],
  [31.5, 70, 0.4, 0.56],
];

/** The Rhodes top line over the doorway's held chords (bars 0 to 3). */
const DOOR_TOP: Line = [
  [2.5, 76, 1.2, 0.46],
  [6.5, 79, 1.2, 0.46],
  [9.5, 81, 0.5, 0.42],
  [10.5, 80, 1, 0.46],
  [13, 76, 1, 0.44],
  [15, 77, 0.8, 0.44],
];

/** Where the sax sings: [bar, line, gain]. */
const SAX_PLAN: readonly (readonly [number, Line, number])[] = [
  [4, THEME, 0.94],
  [6, ANSWER, 0.94],
  [8, THEME_DOWN, 0.95],
  [10, TURN, 0.95],
  [12, THEME_GRACE, 1],
  [14, ANSWER_UP, 1],
  [16, THEME_HIGH, 1],
  [18, TURN_OUT, 1],
  [20, BRIDGE_SAX, 0.94],
  [36, CLIMB, 1.04],
  [40, PEAK, 1.04],
  [44, GOODNIGHT_SAX, 1],
];

/** The vibes' high answers in the head return: [bar, line]. */
const VIBES_ANSWERS: readonly (readonly [number, Line])[] = [
  [
    37,
    [
      [3.25, 81, 0.4, 0.42],
      [3.5, 79, 0.8, 0.38],
    ],
  ],
  [
    39,
    [
      [3, 82, 0.4, 0.4],
      [3.25, 79, 0.4, 0.38],
      [3.5, 74, 0.8, 0.36],
    ],
  ],
  [
    42,
    [
      [3.25, 80, 0.4, 0.42],
      [3.5, 75, 0.9, 0.38],
    ],
  ],
];

/** Every sung line over the band, in absolute beats: [start, end, pitch]. */
function tunes(): [number, number, number][] {
  const out: [number, number, number][] = [];
  const add = (bar: number, line: Line, offset: number): void => {
    for (const [beat, pitch, length, , code = ""] of line) {
      const start = bar * 4 + beat + offset;
      // A ghost or grace note weighs less than a sung one.
      const weight = code.includes("g") ? 0.4 : 1;
      out.push([start, start + length * weight, pitch]);
    }
  };
  add(0, DOOR_TOP, KEYS);
  for (const [bar, line] of SAX_PLAN) add(bar, line, SAX);
  add(28, KEYS_SOLO, KEYS);
  for (const [bar, line] of VIBES_ANSWERS) add(bar, line, VIBES);
  return out;
}

/** Kick figures: 1 / a-of-2 / and-of-3 and its cousins (beat, velocity). */
const KICKS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [0, 0.82],
    [1.75, 0.56],
    [2.5, 0.7],
  ],
  [
    [0, 0.8],
    [2.5, 0.68],
    [3.75, 0.48],
  ],
  [
    [0, 0.82],
    [0.75, 0.5],
    [2.5, 0.7],
  ],
  [
    [0, 0.8],
    [1.5, 0.56],
    [2, 0.64],
    [3.5, 0.46],
  ],
];
/** Ghost-snare placements around the backbeat. */
const GHOSTS: readonly (readonly number[])[] = [
  [1.75, 2.75],
  [0.75, 1.75, 3.5],
  [1.25, 2.25, 2.75],
  [1.75, 2.5, 3.25, 3.75],
];
/** Rhodes comping cells: [beat, length, velocity, push into the next bar]. */
const COMP: readonly (readonly (readonly [
  number,
  number,
  number,
  number?,
])[])[] = [
  [
    [0, 1.6, 0.6],
    [2.5, 0.3, 0.4],
    [2.75, 0.9, 0.48],
  ],
  [
    [0.5, 1.3, 0.56],
    [2.25, 0.35, 0.42],
    [3.5, 0.4, 0.4],
  ],
  [
    [0, 2.3, 0.6],
    [3.5, 0.9, 0.54, 1],
  ],
  [
    [0, 0.9, 0.58],
    [1.5, 0.35, 0.42],
    [2.5, 1.3, 0.52],
  ],
];

/** Left-hand shells under the keys solo, [beat, length, velocity]. */
const LEFT_HAND: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [0, 1.4, 0.44],
    [2.75, 0.9, 0.38],
  ],
  [
    [0.5, 1.1, 0.42],
    [2.5, 0.35, 0.34],
    [3.25, 0.6, 0.36],
  ],
  [
    [0, 2.2, 0.44],
    [3.5, 0.4, 0.36],
  ],
  [
    [0.75, 0.9, 0.4],
    [2.25, 1.4, 0.4],
  ],
];

export const amberRoom: DemoDefinition = {
  info: demoInfo({
    id: "amber-room",
    title: "Amber Room",
    style: "Neo soul",
    description:
      "A six-note sax theme sings behind a Dilla-leaning pocket: late snares, early kicks and swung hats over a flatwound bass that walks down by half steps, with rolled rootless Rhodes chords and a bridge that borrows the minor iv.",
    tempoBpm: 96,
    key: "F",
    bars: 48,
    highlightBar: 40,
    trackId: "sax",
    features: [
      "physical bass",
      "expressive sax",
      "rootless ninths",
      "ghost-note pocket",
      "electric-piano variation",
      "laid-back layers",
    ],
    arrangement: [
      "Doorway 4",
      "Head 16",
      "Pocket 8",
      "Keys alone 8",
      "Head return 8",
      "Goodnight 4",
    ],
    mixNotes: [
      "Each layer sits at its own distance from the grid: kick a hair early, snare and bass late, Rhodes rolled and later, sax furthest back.",
      "The bass carries every root and walks Eb-D-Db-C under the head; rootless Rhodes voicings move by the smallest steps above it.",
      "The sax scoops into phrases, falls off their ends and only vibratos late on held notes; the bridge trades hats for ride and the middle hands the tune to the Rhodes.",
      "The head return lifts with a clap 12 ms behind each snare and an open hat every second bar, and the vibes answer from just behind the kit.",
    ],
  }),
  build() {
    const s = new Composer(amberRoom.info);
    for (const [name, start, bars] of [
      ["Doorway", 0, 4],
      ["Head", 4, 16],
      ["Pocket", 20, 8],
      ["Keys alone", 28, 8],
      ["Head return", 36, 8],
      ["Goodnight", 44, 4],
    ] as const)
      s.section(name, start, bars);

    // Voice-led rootless voicings for every chord span, in time order: the
    // four-note comping forms sit between F3 and D5, under the sax, and the
    // left-hand shells for the keys solo sit an octave lower.
    // Each chord hears the tune from half a beat before it (the comping
    // anticipates) to the next change.
    const tune = tunes();
    const heard = (bar: number, i: number): [number, number][] => {
      const spans = harmony(bar);
      const from = bar * 4 + spans[i]![0] - 0.5;
      const to = bar * 4 + (spans[i + 1]?.[0] ?? 4);
      return tune.flatMap(([start, end, pitch]) => {
        const held = Math.min(to, end) - Math.max(from, start);
        return held > 0 ? [[pitch, held] as [number, number]] : [];
      });
    };
    const voicings = new Map<string, number[]>();
    const shells = new Map<string, number[]>();
    let previous: number[] = [60, 64, 65, 69];
    let previousShell: number[] = [52, 57, 60];
    for (let bar = 0; bar < 48; bar++)
      harmony(bar).forEach(([, root, chord], i) => {
        const sung = heard(bar, i);
        previous = lead(
          previous,
          root,
          [
            ...chord.forms.map((shape) => [0, shape] as const),
            ...chord.alts.map((shape) => [3, shape] as const),
          ],
          [53, 64.5, 74],
          sung,
        );
        previousShell = lead(
          previousShell,
          root,
          chord.shells.map((shape) => [0, shape] as const),
          [48, 56, 66],
          sung,
        );
        voicings.set(`${bar}:${i}`, previous);
        shells.set(`${bar}:${i}`, previousShell);
      });
    const spanAt = (bar: number, beat: number): number => {
      const spans = harmony(bar);
      let index = 0;
      spans.forEach(([start], i) => {
        if (beat >= start - 0.01) index = i;
      });
      return index;
    };
    const chordAt = (bar: number, beat: number): number[] =>
      voicings.get(`${bar}:${spanAt(bar, beat)}`)!;
    const shellAt = (bar: number, beat: number): number[] =>
      shells.get(`${bar}:${spanAt(bar, beat)}`)!;

    // Sustain pedal: caught just after each chord change in the doorway, the
    // bridge and the ending; the comped head and the keys solo stay dry so
    // the stabs and the melody keep their edges.
    const pedal: PedalEvent[] = [];
    const tickOf = (bar: number, beat: number): number =>
      bar * TICKS_PER_BAR + Math.round(beat * TICKS_PER_BEAT);
    for (let bar = 0; bar < 46; bar++) {
      if ((bar >= 4 && bar < 20) || (bar >= 28 && bar < 44)) continue;
      for (const [beat] of harmony(bar)) {
        const tick = tickOf(bar, beat + KEYS);
        if (tick >= 30) pedal.push({ tick: tick - 30, state: "up" });
        pedal.push({ tick: tick + 40, state: "down" });
      }
    }
    pedal.push({ tick: tickOf(4, 0) - 20, state: "up" });
    pedal.push({ tick: tickOf(28, 0) - 20, state: "up" });

    s.track(
      voice("drums", "Small-room kit", "kit", 0.6, {
        kit: "acoustic",
        reverb: { mix: 0.07, size: 0.25, fade: 0.7 },
        humanize: { timing: 5, velocity: 5, seed: 7 },
      }),
    );
    s.track(
      voice("bass", "Flatwound bass", "fender", 0.62, {
        string: { preset: "ebass", mute: 0.3, bright: 0.36 },
        pan: -0.03,
        humanize: { timing: 8, velocity: 5, length: 8, seed: 19 },
      }),
    );
    s.track(
      voice("keys", "Amber Rhodes", "rhodes", 0.5, {
        keys: { vibe: 0.3, vibehz: 3.6, bark: 0.3, bell: 0.42 },
        pan: -0.16,
        reverb: room,
        humanize: { timing: 6, velocity: 4, seed: 23 },
        pedal: pedal.sort((a, b) => a.tick - b.tick),
      }),
    );
    s.track(
      voice("sax", "Amber theme", "sax", 0.43, {
        wind: { preset: "sax", noise: 0.13, bright: 0.44, vibmod: 0.03 },
        pan: 0.12,
        reverb: { mix: 0.13, size: 0.42, fade: 1.8 },
        delay: { beats: 0.75, feedback: 0.14, mix: 0.06 },
        filter: { type: "hpf", cutoff: 170, resonance: 0 },
        humanize: { timing: 9, velocity: 4, seed: 31 },
      }),
    );
    s.track(
      voice("vibes", "High answer", "vibes", 0.22, {
        pan: 0.32,
        reverb: hall,
        humanize: { timing: 6, velocity: 5, seed: 37 },
      }),
    );

    const rand = grain(0x5eed);
    const sax = (bar: number, line: Line, gain = 1): void => {
      for (const [beat, pitch, length, velocity, code = ""] of line)
        s.note(
          "sax",
          bar,
          beat + SAX,
          pitch,
          length,
          Math.min(1, velocity * gain),
          ornament(code, length),
        );
    };

    // Drums ----------------------------------------------------------------
    const drum = (
      bar: number,
      beat: number,
      pitch: number,
      velocity: number,
      length = 0.12,
    ): void => s.note("drums", bar, beat, pitch, length, Math.min(1, velocity));
    const hats = (bar: number, level: number, open: boolean): void => {
      const shape = [0.58, 0.16, 0.42, 0.24];
      for (let step = 0; step < 16; step++) {
        if (open && step >= 14) continue;
        if (step % 4 === 1 && rand() < 0.55) continue;
        const v = shape[step % 4]! * level * (0.9 + 0.2 * rand());
        drum(bar, step / 4 + (step % 2 ? SWING : 0) + 0.004, 42, v);
      }
      if (open) drum(bar, 3.5 + 0.006, 46, 0.42 * level, 0.4);
    };
    const groove = (bar: number, index: number, pass: number): void => {
      const kicks = KICKS[index === 7 ? 3 : (index + pass) % 4]!;
      for (const [beat, v] of kicks)
        drum(bar, beat + KICK + (beat ? 0 : 0.004), 36, v);
      const late = SNARE + (index % 4 === 3 ? 0.008 : 0);
      if (index % 4 === 3) drum(bar, 3 + late - 0.03, 38, 0.38);
      drum(bar, 1 + SNARE, 38, 0.84 + 0.06 * rand());
      drum(bar, 3 + late, 38, 0.88 + 0.06 * rand());
      // The last head doubles the backbeat with a clap a hair behind the
      // snare (the ragged flam Questlove uses to lift a chorus) and opens
      // the hat every second bar instead of every fourth.
      const last = pass === 2;
      if (last) {
        drum(bar, 1 + SNARE + 0.02, 39, 0.46 + 0.06 * rand());
        drum(bar, 3 + late + 0.02, 39, 0.5 + 0.06 * rand());
      }
      for (const beat of GHOSTS[(index + 2 * pass) % 4]!)
        drum(
          bar,
          beat + SWING * (beat % 0.5 ? 1 : 0),
          38,
          0.13 + 0.12 * rand(),
        );
      hats(
        bar,
        last ? 1.06 : 1,
        last ? index % 2 === 1 : index === 3 || index === 7,
      );
    };
    const pocket = (bar: number, index: number): void => {
      for (let step = 0; step < 8; step++) {
        const v = (step % 2 ? 0.28 : 0.46) * (0.9 + 0.2 * rand());
        drum(bar, step / 2 + (step % 2 ? SWING : 0), 51, v, 0.5);
      }
      drum(bar, 0 + KICK + 0.004, 36, 0.72);
      drum(bar, 2.5 + KICK, 36, 0.58);
      if (index % 2) drum(bar, 3.75 + KICK, 36, 0.42);
      drum(bar, 1 + SNARE, 38, 0.74 + 0.05 * rand());
      drum(bar, 3 + SNARE, 38, 0.78 + 0.05 * rand());
      for (const beat of GHOSTS[index % 4]!.slice(0, 2))
        drum(
          bar,
          beat + SWING * (beat % 0.5 ? 1 : 0),
          38,
          0.12 + 0.08 * rand(),
        );
      for (const beat of [1, 3]) drum(bar, beat + 0.006, 44, 0.3);
    };
    const quiet = (bar: number, index: number): void => {
      drum(bar, 0 + KICK + 0.004, 36, 0.6);
      drum(bar, (index % 2 ? 2.25 : 2.5) + KICK, 36, 0.46);
      drum(bar, 1 + SNARE, 37, 0.52 + 0.06 * rand());
      drum(bar, 3 + SNARE, 37, 0.56 + 0.06 * rand());
      for (let step = 0; step < 8; step++)
        drum(
          bar,
          step / 2 + (step % 2 ? SWING : 0) + 0.004,
          42,
          (step % 2 ? 0.2 : 0.34) * (0.9 + 0.2 * rand()),
        );
    };

    // Bass -------------------------------------------------------------------
    const bassNote = (
      bar: number,
      beat: number,
      pitch: number,
      length: number,
      velocity: number,
      code = "",
    ): void => {
      const extra: Partial<NoteInput> = {};
      if (code.includes("g")) Object.assign(extra, { articulation: "ghost" });
      if (code.includes("s"))
        Object.assign(extra, {
          bend: [
            { at: 0, cents: -200 },
            { at: Math.min(0.5, 0.09 / (length * 0.625)), cents: 0 },
          ],
        });
      if (code.includes("f"))
        Object.assign(extra, {
          bend: [
            { at: 0.5, cents: 0 },
            { at: 1, cents: -500 },
          ],
        });
      // Approach notes lean into the next chord; ghosts drag a little.
      const lean = code.includes("p") ? -0.014 : code.includes("g") ? 0.01 : 0;
      s.note("bass", bar, beat + BASS + lean, pitch, length, velocity, extra);
    };
    const nextRoot = (bar: number): number => harmony(bar + 1)[0]![1];
    const bassBar = (bar: number, pattern: number, gain = 1): void => {
      const spans = harmony(bar);
      const next = nextRoot(bar);
      const [, root, chord] = spans[0]!;
      const { third, fifth, seventh } = chord;
      const approach =
        bar % 2 ? next + 1 : next - 1 >= 28 ? next - 1 : next + 1;
      const g = gain;
      if (spans.length > 1) {
        const [beat2, root2] = spans[1]!;
        bassNote(bar, 0, root, beat2 - 0.6, 0.78 * g);
        bassNote(bar, beat2 - 0.5, root + 12, 0.2, 0.5 * g, "g");
        bassNote(
          bar,
          beat2,
          root2,
          3.6 - beat2,
          0.74 * g,
          root2 !== root ? "s" : "",
        );
        if (Math.abs(root2 - next) > 1)
          bassNote(bar, 3.75, approach, 0.22, 0.58 * g, "p");
        return;
      }
      switch (pattern) {
        case 0:
          bassNote(bar, 0, root, 1.45, 0.8 * g);
          bassNote(bar, 1.75, root, 0.12, 0.3 * g, "g");
          bassNote(bar, 2.5, root + fifth, 0.4, 0.62 * g);
          bassNote(bar, 3.25, root + 12, 0.2, 0.56 * g);
          bassNote(bar, 3.75, approach, 0.22, 0.6 * g, "p");
          break;
        case 1:
          bassNote(bar, 0, root, 2.2, 0.78 * g, "s");
          bassNote(
            bar,
            2.75,
            root + seventh - 12 >= 26 ? root + seventh - 12 : root + seventh,
            0.4,
            0.6 * g,
          );
          bassNote(bar, 3.75, approach, 0.25, 0.6 * g, "p");
          break;
        case 2:
          bassNote(bar, 0.5, root, 0.9, 0.74 * g);
          bassNote(bar, 1.75, root + 12, 0.2, 0.52 * g);
          bassNote(bar, 2, root + fifth, 0.4, 0.6 * g);
          bassNote(bar, 2.75, root + seventh, 0.5, 0.6 * g);
          bassNote(bar, 3.75, approach, 0.25, 0.58 * g, "p");
          break;
        default:
          bassNote(bar, 0, root, 0.9, 0.78 * g);
          bassNote(bar, 1, root, 0.15, 0.28 * g, "g");
          bassNote(bar, 1.5, root + third, 0.4, 0.58 * g);
          bassNote(bar, 2.25, root + fifth, 0.6, 0.64 * g);
          bassNote(bar, 3, root + seventh, 0.45, 0.58 * g);
          bassNote(bar, 3.75, approach, 0.25, 0.6 * g, "p");
      }
    };

    // Rhodes -----------------------------------------------------------------
    const roll = (
      bar: number,
      beat: number,
      pitches: readonly number[],
      length: number,
      velocity: number,
      spread = 0.014,
    ): void => {
      pitches.forEach((pitch, i) => {
        const top = i === pitches.length - 1;
        s.note(
          "keys",
          bar,
          beat + KEYS + i * spread,
          pitch,
          Math.max(0.1, length - i * spread),
          Math.min(
            1,
            (top ? velocity + 0.05 : velocity * 0.9) * (0.96 + 0.08 * rand()),
          ),
        );
      });
    };
    let pushed = false;
    const comp = (bar: number, cell: number, gain = 1): void => {
      const spans = harmony(bar);
      const hits =
        spans.length > 1
          ? [
              [0, spans[1]![0] - 0.25, 0.58],
              [spans[1]![0], 3.8 - spans[1]![0], 0.55],
            ]
          : COMP[cell]!;
      const wasPushed = pushed;
      pushed = false;
      for (const [beat, length, velocity, push] of hits as readonly (readonly [
        number,
        number,
        number,
        number?,
      ])[]) {
        if (wasPushed && beat < 0.25) continue;
        if (push) {
          roll(
            bar,
            beat,
            voicings.get(`${bar + 1}:0`)!,
            length,
            velocity * gain,
          );
          pushed = true;
        } else roll(bar, beat, chordAt(bar, beat), length, velocity * gain);
      }
    };

    // Doorway: the Rhodes alone on the last four chords of the cycle -------
    for (let bar = 0; bar < 4; bar++)
      for (const [beat] of harmony(bar)) {
        const span = harmony(bar).length > 1 ? 1.9 : 3.8;
        roll(bar, beat, chordAt(bar, beat), span, 0.5, 0.045);
      }
    for (const [beat, pitch, length, velocity] of DOOR_TOP)
      s.note("keys", 0, beat + KEYS, pitch, length, velocity);
    bassNote(2, 0, 36, 1.8, 0.56, "s");
    bassNote(2, 2, 36, 1.6, 0.52);
    bassNote(3, 0, 29, 2.3, 0.6);
    bassNote(3, 2.5, 32, 1.3, 0.62, "s");
    for (let step = 0; step < 8; step++)
      drum(3, step / 2 + (step % 2 ? SWING : 0), 42, step % 2 ? 0.16 : 0.26);
    drum(3, 3 + SNARE, 37, 0.42);
    drum(3, 3.5 + SWING, 38, 0.2);
    drum(3, 3.75 + SWING, 38, 0.3);

    // Head, bridge, keys alone, head return --------------------------------
    for (let bar = 4; bar < 44; bar++) {
      const head = bar < 20 || bar >= 36;
      const index = bar < 20 ? (bar - 4) % 8 : (bar - 28) % 8;
      const pass = bar < 12 ? 0 : bar < 20 ? 1 : 2;
      if (head) {
        groove(bar, index, pass);
        bassBar(
          bar,
          [
            [0, 1, 2, 3, 0, 1],
            [1, 3, 0, 2, 3, 0],
            [0, 2, 3, 1, 2, 3],
          ][pass]![index] ?? 0,
          bar >= 36 ? 1.04 : 1,
        );
        comp(
          bar,
          [0, 1, 2, 3, 3, 2, 0, 0][index]!,
          bar < 12 ? 0.94 : bar >= 36 ? 1.04 : 1,
        );
      } else if (bar < 28) {
        pocket(bar, bar - 20);
        bassNote(bar, 0, harmony(bar)[0]![1], 3.1, 0.74, bar % 2 ? "" : "s");
        if (bar % 2)
          bassNote(bar, 2.75, harmony(bar)[0]![1] + 12, 0.15, 0.3, "g");
        if (bar !== 27)
          bassNote(
            bar,
            3.5,
            nextRoot(bar) - 1 >= 28 ? nextRoot(bar) - 1 : nextRoot(bar) + 1,
            0.4,
            0.56,
            "p",
          );
        roll(bar, 0, chordAt(bar, 0), 2.4, 0.52, 0.03);
        roll(bar, 2.75, chordAt(bar, 2.75), 1.1, 0.42, 0.02);
      } else {
        quiet(bar, index);
        bassBar(bar, index % 4 === 2 ? 2 : 1, 0.86);
        const change = harmony(bar)[1]?.[0];
        const cell =
          change === undefined
            ? LEFT_HAND[index % 4]!
            : ([
                [0, change - 0.2, 0.42],
                [change, 3.7 - change, 0.4],
              ] as const);
        for (const [beat, length, velocity] of cell)
          roll(bar, beat, shellAt(bar, beat), length, velocity, 0.018);
      }
    }
    for (const [beat, pitch, length, velocity] of KEYS_SOLO)
      s.note("keys", 28, beat + KEYS, pitch, length, velocity);

    // Sax lines.
    for (const [bar, line, gain] of SAX_PLAN) sax(bar, line, gain);

    // Vibes: soft answers in the bridge and the head return, and the last word.
    // The bridge bells double the top of the Rhodes chord an octave up,
    // skipping a voice that sits a half step over another (it would ring
    // as a minor ninth against the chord below).
    for (const bar of [21, 23, 25]) {
      const chord = chordAt(bar, 0);
      const bells = chord
        .filter((p) => !chord.some((q) => (p - q + 120) % 12 === 1))
        .slice(-2);
      for (const [i, pitch] of bells.entries())
        s.note("vibes", bar, 2.5 + i * 0.25 + VIBES, pitch + 12, 1.2, 0.36);
    }
    for (const [bar, line] of VIBES_ANSWERS)
      for (const [beat, pitch, length, velocity] of line)
        s.note("vibes", bar, beat + VIBES, pitch, length, velocity);

    // Fills and cymbals: few, as Questlove would.
    drum(4, 0.004, 49, 0.4, 1.5);
    drum(20, 0.004, 49, 0.38, 1.5);
    drum(36, 0.004, 49, 0.6, 1.5);
    drum(44, 0.004, 49, 0.46, 2);
    for (const [beat, pitch, v] of [
      [3.25, 38, 0.32],
      [3.5, 47, 0.55],
      [3.75, 41, 0.62],
    ] as const)
      drum(19, beat + SWING * (beat % 0.5 ? 1 : 0), pitch, v);
    for (const [beat, pitch, v] of [
      [2.5, 50, 0.5],
      [2.75, 50, 0.44],
      [3, 47, 0.6],
      [3.25, 47, 0.5],
      [3.5, 41, 0.7],
      [3.75, 38, 0.74],
    ] as const)
      drum(35, beat + SWING * (beat % 0.5 ? 1 : 0), pitch, v);
    for (const [beat, v] of [
      [3.25, 0.36],
      [3.5, 0.52],
      [3.75, 0.66],
    ] as const)
      drum(43, beat + SWING * (beat % 0.5 ? 1 : 0), 38, v);

    // Goodnight: Gm9 to Gbmaj7#11, then Fmaj9 rings out.
    drum(44, KICK + 0.004, 36, 0.62);
    drum(44, 1 + SNARE, 37, 0.42);
    drum(44, 2 + KICK, 36, 0.5);
    drum(44, 3 + SNARE, 37, 0.38);
    drum(45, KICK + 0.004, 36, 0.5);
    drum(45, 0.004, 51, 0.34, 3);
    roll(44, 0, chordAt(44, 0), 1.9, 0.54, 0.03);
    roll(44, 2, chordAt(44, 2), 1.9, 0.52, 0.03);
    roll(45, 0, chordAt(45, 0), 11.4, 0.5, 0.06);
    bassNote(44, 0, 31, 1.8, 0.66);
    bassNote(44, 2, 30, 1.8, 0.62);
    bassNote(45, 0, 29, 8, 0.64, "s");
    for (const [i, pitch] of [72, 76, 79, 84].entries())
      s.note("vibes", 45, 1 + i * 0.5 + VIBES, pitch, 4, 0.3);

    return s.finish();
  },
};
