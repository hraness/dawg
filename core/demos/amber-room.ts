/** Amber Room: the neo soul demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import type { PedalEvent } from "../expression.ts";
import type { NoteInput } from "../score.ts";
import { Composer, hall, lanes, room, voice } from "./build.ts";
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
 * shells (third and seventh plus one color, a fourth or wider at the
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
 * move plus a pull toward `center`. A shape whose top note climbs past
 * `top` (into the sax) costs extra, and so does every voice a half step or
 * a minor ninth from a note the tune holds over the chord (weighted by how
 * long it is held, less two octaves apart), so the chain steps around
 * the rubs a pianist would hear. Each shape carries its own color cost.
 */
function lead(
  previous: readonly number[],
  root: number,
  shapes: readonly (readonly [number, readonly number[]])[],
  [low, center, top]: readonly [number, number, number],
  tune: readonly (readonly [number, number])[],
): number[] {
  let best: number[] = [];
  let bestCost = Infinity;
  for (const [color, shape] of shapes) {
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
          // A voice on the very pitch a line holds would only double it.
          else if (gap === 0) rub += 8 * Math.max(0.3, held);
        }
      const cost =
        color +
        moved +
        rub +
        0.5 * Math.abs(mean - center) +
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
  [3, 72, 1.3, 0.68, "v"],
  [4.75, 69, 0.5, 0.6],
  [5.5, 67, 1, 0.64, "vf"],
];
const ANSWER: Line = [
  [1, 65, 0.4, 0.58, "s"],
  [1.5, 67, 0.45, 0.6],
  [2.25, 69, 0.6, 0.68],
  [3.25, 64, 0.25, 0.56, "g"],
  [4.25, 62, 0.45, 0.56],
  [5, 65, 0.45, 0.6],
  [5.75, 67, 0.9, 0.64, "vf"],
];
const THEME_DOWN: Line = [
  [0.5, 69, 0.55, 0.66, "s"],
  [1.25, 72, 0.45, 0.64],
  [2, 76, 0.75, 0.78, "a"],
  [3, 74, 1.3, 0.7, "v"],
  [4.75, 72, 0.5, 0.62],
  [5.5, 68, 1, 0.64, "vf"],
];
const TURN: Line = [
  [0.5, 67, 0.3, 0.55, "g"],
  [1, 70, 0.45, 0.6],
  [1.75, 69, 0.5, 0.64],
  [2.5, 68, 0.5, 0.66, "s"],
  [3.25, 67, 0.4, 0.58],
  [3.75, 64, 0.5, 0.6],
  // The A lands with the comp's 4-3 resolution, not over the suspension.
  [5, 69, 1.3, 0.64, "v"],
];
/** Bar 12 keeps the head's A C D C shape; the section's F5 waits for bar 16. */
const THEME_GRACE: Line = [
  [0.3, 68, 0.1, 0.42, "g"],
  [0.42, 69, 0.4, 0.68],
  [1.25, 72, 0.4, 0.64],
  [2, 74, 0.8, 0.76, "a"],
  [3, 72, 1.3, 0.7, "v"],
  [4.75, 72, 0.4, 0.62],
  [5.25, 69, 0.4, 0.6],
  [5.75, 67, 0.9, 0.66, "vf"],
];
const ANSWER_UP: Line = [
  [0.5, 72, 0.4, 0.62, "s"],
  [1, 74, 0.4, 0.66],
  [1.5, 76, 0.75, 0.74],
  [2.5, 74, 0.35, 0.6, "g"],
  [3, 72, 0.9, 0.64],
  [4.25, 74, 0.45, 0.66],
  [5, 76, 0.45, 0.7, "s"],
  [5.75, 74, 0.9, 0.7, "vf"],
];
/** Enters after the Rhodes' G5 to F5 has resolved; the F5 is the peak. */
const THEME_HIGH: Line = [
  [1.5, 76, 0.4, 0.72, "s"],
  [2, 77, 0.45, 0.74],
  [2.5, 76, 0.3, 0.66],
  [2.75, 74, 0.25, 0.62, "g"],
  [3, 72, 1.2, 0.68, "v"],
  [4.5, 75, 0.5, 0.66],
  [5.25, 72, 0.4, 0.62],
  [5.75, 68, 0.9, 0.64, "vf"],
];
const TURN_OUT: Line = [
  [0.5, 70, 0.4, 0.58],
  [1, 74, 0.4, 0.62],
  [1.75, 72, 0.5, 0.64],
  [2.5, 68, 0.6, 0.66, "s"],
  [3.25, 63, 0.4, 0.56, "g"],
  [3.75, 64, 0.5, 0.6],
  [4.5, 65, 0.4, 0.58],
  [5, 69, 1, 0.64, "v"],
  [6, 72, 0.35, 0.62],
  [6.4, 70, 0.5, 0.6, "f"],
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
  [6, 76, 1.1, 0.74, "vf"],
  [8.5, 77, 0.4, 0.74, "s"],
  [9, 76, 0.4, 0.72],
  [9.5, 72, 0.4, 0.66, "g"],
  [10, 74, 0.5, 0.7],
  [10.75, 76, 0.9, 0.74, "v"],
  // Bar 39 climbs C Eb F and stops at F5: the G5 belongs to bar 40.
  [12.5, 72, 0.4, 0.7],
  [13, 75, 0.5, 0.76, "s"],
  [14, 77, 1, 0.76, "vf"],
];
/** The one G5 of the song is bar 40's; bar 41 answers it from F5. */
const PEAK: Line = [
  [0.5, 76, 0.4, 0.78, "s"],
  [1, 77, 0.6, 0.82],
  [1.75, 79, 1.35, 0.88, "sv"],
  [3.25, 77, 0.4, 0.74],
  [3.75, 76, 0.25, 0.72, "g"],
  [5.5, 77, 1.3, 0.8, "svf"],
  [8.5, 74, 0.4, 0.68],
  [9, 72, 0.4, 0.66, "g"],
  [9.5, 70, 0.45, 0.64],
  [10.25, 68, 0.6, 0.68, "s"],
  [11, 67, 0.4, 0.62],
  [11.5, 64, 0.5, 0.6],
  [13, 69, 1.3, 0.66, "v"],
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

/**
 * The Rhodes alone in the middle, built like the sax theme: the three-note
 * idea A C D with its answer and two-beat rests (bars 28-29), the same a
 * third higher (30-31), a denser development capped at E5 then F5 (32-33),
 * one peak A5 handed to the vibes over the sus chord (34) and a long C5
 * that holds through the tape stop and the Ab13 (35).
 */
const KEYS_SOLO: Line = [
  [0.5, 69, 0.4, 0.58],
  [1.25, 72, 0.4, 0.6],
  [2, 74, 1.3, 0.64],
  [4.75, 72, 0.3, 0.56],
  [5.5, 69, 0.45, 0.58],
  [6.25, 67, 1, 0.56],
  [8.5, 72, 0.4, 0.6],
  [9.25, 74, 0.4, 0.62],
  [10, 76, 1.3, 0.66],
  [12.75, 74, 0.3, 0.58],
  [13.5, 70, 0.45, 0.58],
  [14.25, 67, 1.2, 0.56],
  [16.25, 69, 0.25, 0.56],
  [16.5, 72, 0.25, 0.58],
  [16.75, 74, 0.25, 0.6],
  [17, 76, 0.5, 0.66],
  [17.75, 74, 0.25, 0.58],
  [18.25, 72, 0.25, 0.56],
  [18.75, 69, 0.3, 0.56],
  [19.25, 67, 0.6, 0.58],
  [20.5, 68, 0.25, 0.56],
  [20.75, 72, 0.25, 0.58],
  [21, 75, 0.25, 0.6],
  [21.25, 77, 0.6, 0.68],
  [22, 75, 0.3, 0.6],
  [22.5, 72, 0.3, 0.58],
  [23, 68, 0.8, 0.56],
  [24.25, 70, 0.25, 0.58],
  [24.5, 74, 0.25, 0.6],
  [24.75, 77, 0.25, 0.64],
  [25, 81, 1.2, 0.7],
  [26.5, 80, 0.4, 0.62],
  [27, 75, 0.4, 0.58],
  [27.5, 70, 0.5, 0.56],
  [28.25, 69, 0.3, 0.56],
  [28.5, 72, 3.4, 0.62],
];

/**
 * Two backing "ooh" voices a third or a fourth apart, sitting above the
 * Rhodes and around the sax's held notes. The bridge: the modal-mixture
 * sigh (D to Db over Bbmaj9 to Bbm9), a 6-5 over Gm11 (Eb falling to D
 * around the sax's held Bb), the b7 of Gb13 kept as the 7th of Fmaj9 over
 * a 4-3 appoggiatura. The head return: a 4-3 in thirds with the Rhodes'
 * 9-8 into Gm9, a 6-5 over Fmaj9, a dip under the sax's climb, then the
 * lower voice holds an F pedal from the Dm9 cadence through the sus chord
 * and falls to E on the altered dominant while the upper voice walks C Bb
 * A Ab, and a last 9-8 over the final Fmaj9. [bar, beat, pitch, length,
 * velocity]
 */
const PAD: readonly (readonly [number, number, number, number, number])[] = [
  [20, 0, 74, 4, 0.5],
  [20, 0, 69, 4, 0.46],
  [21, 0, 73, 4, 0.5],
  [21, 0, 68, 4, 0.46],
  [22, 0, 76, 4, 0.48],
  [22, 0, 67, 4, 0.46],
  [23, 0, 72, 4, 0.48],
  [23, 0, 69, 4, 0.46],
  [24, 0, 75, 2, 0.5],
  [24, 2, 74, 2, 0.48],
  [24, 0, 67, 4, 0.46],
  [25, 0, 76, 4, 0.48],
  [25, 0, 70, 4, 0.46],
  [26, 0, 76, 4, 0.48],
  [26, 0, 70, 0.5, 0.5],
  [26, 0.5, 69, 3.5, 0.48],
  [27, 0, 75, 4.5, 0.5],
  [27, 0, 72, 4, 0.46],
  [28, 0.5, 70, 1.2, 0.44],
  [36, 0, 72, 1, 0.46],
  [36, 1, 70, 3, 0.44],
  [36, 0, 65, 4, 0.4],
  [37, 0, 74, 4, 0.44],
  [37, 0, 70, 4, 0.42],
  [38, 0, 74, 2, 0.44],
  [38, 2, 72, 2, 0.42],
  [38, 0, 70, 1.5, 0.42],
  [38, 1.5, 69, 2.5, 0.42],
  [39, 0, 70, 4, 0.42],
  [39, 0, 67, 4, 0.4],
  [40, 0, 72, 8, 0.46],
  [40, 0, 67, 1, 0.44],
  [40, 1, 65, 5, 0.42],
  [42, 0, 72, 2, 0.46],
  [42, 2, 70, 2, 0.44],
  [42, 2, 64, 2, 0.42],
  [43, 0, 70, 1, 0.44],
  [43, 1, 69, 1.5, 0.44],
  [43, 2.5, 68, 1.5, 0.42],
  [43, 0, 65, 2.5, 0.42],
  [43, 2.5, 63, 1.5, 0.4],
  [45, 0, 69, 4, 0.42],
  [46, 0, 67, 6, 0.4],
  [45, 0, 64, 10, 0.36],
];

/** Bars whose last half beat is a hat ratchet (a 32nd-note glitch fill). */
const RATCHETS = [11, 19, 27, 35] as const;

/** The Rhodes top line over the doorway's held chords (bars 0 to 3). */
const DOOR_TOP: Line = [
  [2.5, 76, 1.2, 0.46],
  [6.5, 79, 1.2, 0.46],
  [9.5, 81, 0.5, 0.42],
  [10.5, 80, 1, 0.46],
  [13, 76, 1, 0.44],
  [15, 77, 0.8, 0.44],
];

/**
 * The Rhodes answers in the sax's rests, one motif every time: three notes
 * falling over the last beat and a half of the phrase, the last held over
 * the barline as a suspension that resolves by step once the new chord is
 * in (Bb to A over Fmaj9, G to F over Dm9, F held into the sus and dropping
 * to E when the altered dominant lands, C to Bb over Gm9).
 * [phrase bar, line in beats from that bar]
 */
const ANSWERS: readonly (readonly [number, Line])[] = [
  [
    4,
    [
      [6.75, 74, 0.4, 0.5],
      [7.25, 72, 0.4, 0.5],
      [7.75, 70, 1, 0.54],
      [8.75, 69, 0.7, 0.48],
    ],
  ],
  [
    6,
    [
      [6.75, 77, 0.4, 0.5],
      [7.25, 74, 0.4, 0.5],
      [7.75, 79, 1, 0.54],
      [8.75, 77, 0.7, 0.48],
    ],
  ],
  [
    8,
    [
      [6.75, 80, 0.4, 0.5],
      [7.25, 75, 0.4, 0.5],
      [7.75, 77, 2, 0.54],
      [10, 76, 0.8, 0.48],
    ],
  ],
  [
    10,
    [
      [6.75, 78, 0.4, 0.5],
      [7.25, 75, 0.4, 0.5],
      [7.75, 72, 1, 0.54],
      [8.75, 70, 0.7, 0.48],
    ],
  ],
];
/**
 * The second head varies the answer as the sax varies the theme: the first
 * rises to its suspension instead of falling, the second and third are
 * four-note versions that land a quarter beat later, and the last turns
 * the fall into a climb that folds back onto the suspended C.
 */
const ANSWERS_2: readonly (readonly [number, Line])[] = [
  [
    12,
    [
      [7, 67, 0.35, 0.5],
      [7.5, 69, 0.3, 0.5],
      [7.75, 70, 0.75, 0.54],
      [8.5, 69, 0.9, 0.48],
    ],
  ],
  [
    14,
    [
      [7, 74, 0.3, 0.48],
      [7.25, 77, 0.3, 0.5],
      [7.5, 74, 0.3, 0.48],
      [7.75, 79, 1, 0.54],
      [8.75, 77, 0.7, 0.48],
    ],
  ],
  [
    16,
    [
      [7, 72, 0.3, 0.48],
      [7.25, 75, 0.3, 0.5],
      [7.5, 80, 0.3, 0.5],
      [7.75, 77, 2, 0.54],
      [10, 76, 0.8, 0.48],
    ],
  ],
  [
    18,
    [
      [7, 72, 0.3, 0.48],
      [7.25, 75, 0.3, 0.5],
      [7.5, 78, 0.3, 0.5],
      [7.75, 72, 1, 0.54],
      [8.75, 70, 0.7, 0.48],
    ],
  ],
];

/**
 * Cadence suspensions in the comp: 4-3 (the voice that would play the third
 * plays the fourth on the downbeat and falls to the third at `resolve`) and
 * 9-8 (the ninth falls to the octave). [bar, kind, resolve beat]
 */
const SUS: readonly (readonly [number, "4-3" | "9-8", number])[] = [
  [4, "9-8", 1],
  [5, "4-3", 1.5],
  [6, "4-3", 1.5],
  [8, "4-3", 1],
  [11, "4-3", 1],
  [13, "4-3", 1.5],
  [14, "4-3", 1.5],
  [16, "4-3", 1],
  [19, "4-3", 1],
  [36, "9-8", 1],
  [37, "4-3", 1.5],
  [38, "4-3", 1.5],
  [40, "4-3", 1],
  [43, "4-3", 1],
];
/**
 * Cadences where another voice carries the suspension on top: the Rhodes
 * answer motif at 6, 8, 14 and 16 (its last note ties over the barline and
 * falls by step) and the ooh pad at 38. The comp leaves that voice out of
 * the downbeat chord instead of doubling the suspension an octave below.
 */
const CARRIED: ReadonlySet<number> = new Set([6, 8, 14, 16, 38]);

/**
 * Voicings pinned where the chain's choice fought the pad or the sax: bar
 * 36 puts the ninth on top so the 9-8 is the Rhodes's own and the pad moves
 * in thirds above it; bar 44 keeps the Rhodes's Bb an octave under the
 * sax's A instead of a semitone above it.
 */
const PINNED: ReadonlyMap<string, number[]> = new Map([
  ["36:0", [58, 62, 65, 69]],
  ["44:0", [58, 62, 65, 72]],
]);

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
  [36, CLIMB, 1.1],
  [40, PEAK, 1.1],
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
    41,
    [
      [3, 80, 0.4, 0.42],
      [3.25, 75, 0.9, 0.38],
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
  for (const [bar, line] of [...ANSWERS, ...ANSWERS_2]) add(bar, line, KEYS);
  add(28, KEYS_SOLO, KEYS);
  for (const [bar, line] of VIBES_ANSWERS) add(bar, line, VIBES);
  for (const [bar, beat, pitch, length] of PAD)
    out.push([bar * 4 + beat, bar * 4 + beat + length, pitch]);
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
  // Under the guitar arpeggios: a touch on the and-of-2 and the push.
  [
    [2.5, 0.35, 0.42],
    [3.5, 0.9, 0.54, 1],
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
      "A six-note sax theme phrases over a Dilla-leaning pocket while the Rhodes answers in its rests and ties a 4-3 or 9-8 suspension across every cadence; a muted guitar carries the second head in eighths that interlock with the vibes, the bass falls where the sax rises, an ooh pad sighs a fourth above the Rhodes through the minor-iv bridge, the keys solo hands its one high note to the vibes, and vocal chops, hat ratchets and one tape stop tint the turnarounds.",
    tempoBpm: 96,
    key: "F",
    bars: 48,
    highlightBar: 40,
    trackId: "sax",
    features: [
      "physical bass",
      "expressive sax",
      "rootless ninths",
      "prepared suspensions",
      "call and answer",
      "interlocking arpeggios",
      "ghost-note pocket",
      "vocal chops",
      "tape stop",
      "laid-back layers",
    ],
    arrangement: [
      "Doorway 4",
      "Head 8",
      "Second head 8",
      "Pocket 8",
      "Keys alone 8",
      "Head return 8",
      "Goodnight 4",
    ],
    mixNotes: [
      "Each layer sits at its own distance from the grid: kick a hair early, snare and bass late, Rhodes rolled and later, sax furthest back.",
      "The sax rests for the last beat and a half of every two-bar phrase and the Rhodes answers there with three falling notes (inverted, extended or shifted in the second head), the last tied over the barline and resolved by step; at each cadence one voice holds the fourth or the ninth from the chord before and falls after the downbeat, and where the answer or the pad carries that voice the comp leaves it out rather than doubling it an octave below.",
      "The bass falls through the seventh and fifth under every rising sax phrase and climbs under the falling ones; in the second head the band sits back 1.3 dB while a muted guitar arpeggiates the voicing on the eighths, the vibes play the complementary off-sixteenths an octave up and the Rhodes only touches the and-of-two and pushes the next chord.",
      "The bridge rides with a bit-crushed kit under a two-voice ooh pad voiced a fourth above the comp; hat ratchets close bars 11, 19, 27 and 35, a reverse swell and a tape-stopped oh turn bar 35 into the head return, and a pitched oh takes two sax notes in the climb and the peak.",
      "The keys solo states a three-note idea with rests, moves it a third up, thickens it and hands its one A5 to the vibes before a long C5 over the tape stop, with the kick out for its first four bars; the head return lifts with a clap 12 ms behind each snare, the hats on their own track panned against the Rhodes's antiphase vibrato and the sax's single G5 at bar 40, and the last chord decays over the final two bars.",
    ],
  }),
  build() {
    const s = new Composer(amberRoom.info);
    for (const [name, start, bars] of [
      ["Doorway", 0, 4],
      ["Head", 4, 8],
      ["Second head", 12, 8],
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
        // On a 4-3 bar the third should sit in the top two voices, and on
        // a 9-8 bar the ninth on top, where the suspension is heard as a
        // line rather than a smudge.
        const kind = SUS.find(([at]) => at === bar)?.[1];
        const high = (shape: readonly number[]): number => {
          if (i !== 0 || !kind) return 0;
          if (kind === "9-8") return shape.at(-1)! % 12 === 2 ? 0 : 6;
          return shape.findIndex((tone) => tone % 12 === chord.third % 12) <
            shape.length - 2
            ? 6
            : 0;
        };
        // The comp sits between A3 and D5: under the sax, above the bass's
        // top octave, with nothing below 220 Hz to thicken the low mids.
        previous = lead(
          previous,
          root,
          [
            ...chord.forms.map((shape) => [high(shape), shape] as const),
            ...chord.alts.map((shape) => [3 + high(shape), shape] as const),
          ],
          [57, 66, 74],
          sung,
        );
        previous = PINNED.get(`${bar}:${i}`) ?? previous;
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

    // The band sits back 1.3 dB under the guitar and vibes for the second
    // head, so the interlock reads as the second chorus's texture rather
    // than a layer on top of the first.
    const sitBack = (...rest: [number, number][]) =>
      lanes([0, 1], [11.95, 1], [12, 0.86], [19.95, 0.86], [20, 1], ...rest);

    // The bridge's kit goes through a light bitcrush, a sampled beat tape
    // under the live band, and snaps clean for the keys solo.
    const crushed = {
      fx: { crush: { bits: 7, coarse: 3, mix: 0 } },
      fxAutomation: {
        "crush-mix": lanes(
          [0, 0],
          [19.95, 0],
          [20, 0.32],
          [27.5, 0.32],
          [27.95, 0],
        ),
      },
    } as const;
    s.track(
      voice("drums", "Small-room kit", "kit", 0.6, {
        kit: "acoustic",
        reverb: { mix: 0.07, size: 0.25, fade: 0.7 },
        humanize: { timing: 5, velocity: 5, seed: 7 },
        volumeAutomation: sitBack(),
        ...crushed,
      }),
    );
    s.track(
      voice("hats", "Hats and ride", "kit", 0.6, {
        kit: "acoustic",
        pan: 0.3,
        reverb: { mix: 0.07, size: 0.25, fade: 0.7 },
        humanize: { timing: 5, velocity: 5, seed: 11 },
        volumeAutomation: sitBack(),
        ...crushed,
      }),
    );
    s.track(
      voice("bass", "Flatwound bass", "fender", 0.7, {
        string: { preset: "ebass", mute: 0.3, bright: 0.36 },
        pan: -0.03,
        volumeAutomation: sitBack(),
        humanize: { timing: 8, velocity: 5, length: 8, seed: 19 },
      }),
    );
    s.track(
      voice("keys", "Amber Rhodes", "rhodes", 0.5, {
        // The suitcase vibrato pans the Rhodes left and right in antiphase.
        keys: { vibe: 0.5, vibehz: 3.6, bark: 0.3, bell: 0.42 },
        pan: -0.12,
        reverb: room,
        humanize: { timing: 6, velocity: 4, seed: 23 },
        pedal: pedal.sort((a, b) => a.tick - b.tick),
        // Sits back under the guitar in the second head; the last chord
        // decays into the room rather than stopping.
        volumeAutomation: sitBack([46, 1], [47.9, 0.2]),
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
        volumeAutomation: sitBack(),
      }),
    );
    s.track(
      voice("guitar", "Muted guitar", "steel", 0.5, {
        string: { preset: "steel", mute: 0.5, bright: 0.34 },
        pan: 0.3,
        reverb: room,
        humanize: { timing: 7, velocity: 6, seed: 41 },
      }),
    );
    s.track(
      voice("vibes", "High answer", "vibes", 0.28, {
        pan: -0.3,
        reverb: hall,
        humanize: { timing: 6, velocity: 5, seed: 37 },
      }),
    );
    s.track(
      voice("oohs", "Ooh pad", "sing", 0.4, {
        sing: {
          preset: "oohchoir",
          voice: "alto",
          voices: 4,
          breath: 0.3,
          bright: 0.3,
          attack: 0.22,
          release: 0.5,
          vib: 4.6,
          vibmod: 0.08,
          vibdelay: 0.5,
          spread: 12,
        },
        pan: -0.08,
        reverb: hall,
        filter: { type: "hpf", cutoff: 180, resonance: 0 },
        humanize: { timing: 14, velocity: 4, seed: 43 },
        volumeAutomation: lanes([0, 1], [46.5, 1], [47.9, 0.25]),
      }),
    );
    s.track(
      voice("chop", "Oh chops", "sampler", 0.3, {
        sampler: {
          mode: "keyed",
          voices: {
            // Notes from 36 play the reverse-shaped riser, from 48 the
            // "oh" slowing to a stop (the tape stop), from 60 the "oh".
            rise: {
              ...bundledSampleRef("riser"),
              root: 36,
              fit: true,
              fadeInTime: 0.3,
              fadeTime: 0.03,
            },
            stop: {
              ...bundledSampleRef("vowel-oh"),
              root: 48,
              accelerate: -1,
              fadeTime: 0.02,
            },
            oh: {
              ...bundledSampleRef("vowel-oh"),
              root: 60,
              fadeInTime: 0.003,
              fadeTime: 0.01,
            },
          },
        },
        pan: -0.22,
        filter: { type: "hpf", cutoff: 260, resonance: 0 },
        reverb: room,
        fx: { crush: { bits: 9, coarse: 2, mix: 0.2 } },
        delay: { beats: 0.75, feedback: 0.18, mix: 0.1, pingpong: true },
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
    // Hats, pedal hat and ride play from their own track, panned right of
    // the kit, so the top of the groove has width.
    const drum = (
      bar: number,
      beat: number,
      pitch: number,
      velocity: number,
      length = 0.12,
    ): void =>
      s.note(
        [42, 44, 46, 51].includes(pitch) ? "hats" : "drums",
        bar,
        beat,
        pitch,
        length,
        Math.min(1, velocity),
      );
    const hats = (bar: number, level: number, open: boolean): void => {
      const shape = [0.58, 0.16, 0.42, 0.24];
      const ratchet = (RATCHETS as readonly number[]).includes(bar);
      if (ratchet) open = false;
      for (let step = 0; step < 16; step++) {
        if ((open || ratchet) && step >= 14) continue;
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
        if (bar === 27 && step === 7) continue;
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
    // The keys solo: side stick and eighth hats; the kick sits out its
    // first four bars (the break the head return comes back from).
    const quiet = (bar: number, index: number): void => {
      if (bar >= 32) {
        drum(bar, 0 + KICK + 0.004, 36, 0.6);
        drum(bar, (index % 2 ? 2.25 : 2.5) + KICK, 36, 0.46);
      }
      drum(bar, 1 + SNARE, 37, 0.52 + 0.06 * rand());
      drum(bar, 3 + SNARE, 37, 0.56 + 0.06 * rand());
      for (let step = 0; step < 8; step++)
        if (!(bar === 35 && step === 7))
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
        case 4: {
          // Contrary motion under a rising sax phrase: the line falls from
          // the root (its octave pop when the root is low) through the
          // seventh and fifth below, lands on the low root, then climbs
          // through the approach note into the next change.
          const high = root < 34 ? root + 12 : root;
          const low = ((bar >> 1) + (bar >> 3)) % 2;
          bassNote(bar, 0, high, 1.4, 0.8 * g);
          bassNote(bar, 1.75, high + seventh - 12, 0.4, 0.6 * g);
          // Every other phrase the fall lands on the third instead of the
          // fifth, so the two-bar shapes do not repeat verbatim.
          bassNote(
            bar,
            2.5,
            low || high + third - 12 < 28
              ? high + fifth - 12
              : high + third - 12,
            0.55,
            0.62 * g,
          );
          if (low) bassNote(bar, 3.25, root, 0.3, 0.5 * g, "g");
          else bassNote(bar, 3, root, 0.5, 0.56 * g, "s");
          bassNote(bar, 3.75, approach, 0.22, 0.6 * g, "p");
          break;
        }
        default:
          // Rising under a falling or held sax note.
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
      lengths: readonly number[] = [],
    ): void => {
      pitches.forEach((pitch, i) => {
        const top = i === pitches.length - 1;
        s.note(
          "keys",
          bar,
          beat + KEYS + i * spread,
          pitch,
          Math.max(0.1, (lengths[i] ?? length) - i * spread),
          Math.min(
            1,
            (top ? velocity + 0.05 : velocity * 0.9) * (0.96 + 0.08 * rand()),
          ),
        );
      });
    };
    /**
     * The suspension a SUS bar asks for, read off its downbeat voicing: the
     * index of the voice that carries the third (or ninth), the tone it
     * holds, the tone it falls to and the beat it falls on.
     */
    const suspension = (
      bar: number,
    ):
      | {
          i: number;
          pitches: number[];
          held: number;
          to: number;
          resolve: number;
        }
      | undefined => {
      const sus = SUS.find(([at]) => at === bar);
      if (!sus) return undefined;
      const [, kind, resolve] = sus;
      const [, root, chord] = harmony(bar)[0]!;
      const pitches = voicings.get(`${bar}:0`)!;
      const want = kind === "4-3" ? chord.third % 12 : 2;
      const i = pitches.findIndex(
        (p) => (((p - root) % 12) + 12) % 12 === want,
      );
      if (i < 0) return undefined;
      const p = pitches[i]!;
      return {
        i,
        pitches,
        held: kind === "4-3" ? p + 5 - chord.third : p,
        to: kind === "4-3" ? p : p - 2,
        resolve,
      };
    };
    /**
     * The downbeat chord with its suspension prepared: the suspended tone
     * (a chord tone of the bar before) ties over the barline, the other
     * voices roll under it, and it steps down to the chord tone at
     * `resolve`. When the previous hit already holds the tone (`prepared`)
     * no new preparation is struck.
     */
    const suspend = (
      bar: number,
      beat: number,
      length: number,
      velocity: number,
      prepared: boolean,
    ): boolean => {
      const sus = suspension(bar);
      if (!sus || spanAt(bar, beat) !== 0) return false;
      const { i, pitches, held, to, resolve } = sus;
      roll(
        bar,
        beat,
        pitches.filter((_, j) => j !== i),
        length,
        velocity,
      );
      // The answer motif already sings this suspension on top.
      if (CARRIED.has(bar)) return true;
      if (!prepared)
        s.note(
          "keys",
          bar - 1,
          3.5 + KEYS,
          held,
          0.5 + resolve,
          velocity * 0.9,
        );
      s.note(
        "keys",
        bar,
        resolve + KEYS,
        to,
        Math.max(0.3, length - (resolve - beat)),
        velocity * 0.92,
      );
      return true;
    };
    let pushed = false;
    let prepared = false;
    const comp = (bar: number, cell: number, gain = 1): void => {
      const spans = harmony(bar);
      const hits = (
        spans.length > 1
          ? [
              [0, spans[1]![0] - 0.25, 0.58],
              [spans[1]![0], 3.8 - spans[1]![0], 0.55],
            ]
          : COMP[cell]!
      ) as readonly (readonly [number, number, number, number?])[];
      const wasPushed = pushed;
      const wasPrepared = prepared;
      pushed = false;
      prepared = false;
      const next = suspension(bar + 1);
      const here = suspension(bar);
      hits.forEach(([beat, length, velocity, push], h) => {
        const last = h === hits.length - 1;
        if (wasPushed && beat < 0.25) return;
        if (push) {
          // The pushed chord anticipates the next bar; when that bar opens
          // on a suspension the push carries the suspended tone, which
          // resolves after the barline.
          const coming = voicings.get(`${bar + 1}:0`)!;
          if (next && CARRIED.has(bar + 1)) {
            // The answer motif strikes and resolves the suspended voice;
            // the push plays the other three under it.
            roll(
              bar,
              beat,
              coming.filter((_, j) => j !== next.i),
              length,
              velocity * gain,
            );
            prepared = true;
          } else if (next) {
            roll(
              bar,
              beat,
              coming.map((p, j) => (j === next.i ? next.held : p)),
              length,
              velocity * gain,
              0.014,
              coming.map((_, j) =>
                j === next.i ? 4 - beat + next.resolve : length,
              ),
            );
            s.note(
              "keys",
              bar + 1,
              next.resolve + KEYS,
              next.to,
              Math.max(0.3, length - next.resolve),
              velocity * gain * 0.92,
            );
            prepared = true;
          } else roll(bar, beat, coming, length, velocity * gain);
          pushed = true;
          return;
        }
        const pitches = chordAt(bar, beat);
        if (
          beat < 0.75 &&
          !wasPushed &&
          suspend(bar, beat, length, velocity * gain, wasPrepared)
        )
          return;
        if (wasPushed && wasPrepared && here && beat < here.resolve) {
          // A second hit before the pushed suspension resolves keeps it
          // (or, when the answer motif holds it, stays out of its way).
          if (CARRIED.has(bar))
            roll(
              bar,
              beat,
              pitches.filter((_, j) => j !== here.i),
              length,
              velocity * gain,
            );
          else
            roll(
              bar,
              beat,
              pitches.map((p, j) => (j === here.i ? here.held : p)),
              length,
              velocity * gain,
              0.014,
              pitches.map((_, j) =>
                j === here.i ? here.resolve - beat : length,
              ),
            );
          return;
        }
        if (
          last &&
          next &&
          !CARRIED.has(bar + 1) &&
          pitches.includes(next.held)
        ) {
          // The last hit already holds the next bar's suspended tone: tie
          // it over the barline instead of striking it again.
          roll(
            bar,
            beat,
            pitches,
            length,
            velocity * gain,
            0.014,
            pitches.map((p) =>
              p === next.held ? 4 - beat + next.resolve : length,
            ),
          );
          prepared = true;
          return;
        }
        roll(bar, beat, pitches, length, velocity * gain);
      });
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
        // The bass falls (4) where the sax phrase rises and rises (3)
        // where it falls or holds; the Eb D Db C walk keeps long roots (1).
        bassBar(
          bar,
          [
            [4, 3, 4, 1, 4, 1],
            [4, 0, 4, 1, 3, 2],
            [4, 3, 0, 1, 4, 2],
          ][pass]![index] ?? 0,
          bar >= 36 ? 1.04 : 1,
        );
        // Under the guitar arpeggios the Rhodes only touches the and-of-2
        // and pushes the next chord; the guitar carries the harmony.
        comp(
          bar,
          pass === 1 ? 4 : [0, 1, 2, 3, 3, 2, 0, 0][index]!,
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
    // The solo is a hocket: the Rhodes rests on its highest notes and the
    // vibes play them, so the line is one tune across two timbres.
    for (const [beat, pitch, length, velocity] of KEYS_SOLO)
      if (pitch >= 79)
        s.note("vibes", 28, beat + VIBES, pitch, length, velocity + 0.04);
      else s.note("keys", 28, beat + KEYS, pitch, length, velocity);
    drum(32, 0.004, 49, 0.3, 1.5);

    // Sax lines, and the Rhodes answering in their rests.
    for (const [bar, line, gain] of SAX_PLAN) sax(bar, line, gain);
    for (const [bar, line] of [...ANSWERS, ...ANSWERS_2])
      for (const [beat, pitch, length, velocity] of line)
        s.note("keys", bar, beat + KEYS, pitch, length, velocity);

    // Interlocking arpeggios. In the second head the muted guitar plays
    // the voice-led chord tones up and down on the eighths (its top note
    // walks with the voicing chain) while the vibes echo the first four
    // tones one swung sixteenth later an octave up, a Reich offset; in the
    // head return the guitar only plays the pickup into each bar under the
    // full comp. A tone that would sit on or a step from a note the sax or
    // the Rhodes line holds drops to the voice below or stays silent.
    const sings = (start: number, pitch: number): boolean =>
      tune.some(([from, to, sung]) => {
        const gap = Math.abs(sung - pitch);
        return (
          from < start + 0.2 &&
          start < to &&
          (gap <= 2 || gap === 11 || gap === 13)
        );
      });
    const pluck = (
      track: string,
      bar: number,
      beat: number,
      tones: readonly number[],
      index: number,
      length: number,
      velocity: number,
      offset: number,
    ): void => {
      for (let i = Math.min(index, tones.length - 1); i >= 0; i--) {
        const pitch = tones[i]!;
        if (sings(bar * 4 + beat, pitch)) continue;
        s.note(track, bar, beat + offset, pitch, length, velocity);
        return;
      }
    };
    // The guitar climbs the voicing on the on-eighths and comes back down;
    // the vibes answer on the swung off-sixteenths of the first two beats
    // an octave up, falling while the guitar rises, so the two make one
    // sixteenth-note line in contrary motion and the guitar finishes the
    // bar alone.
    const ARP = [0, 1, 2, 3, 2, 1, 0] as const;
    const COUNTER = [3, 2, 1, 2] as const;
    for (let bar = 12; bar < 20; bar++) {
      ARP.forEach((index, step) => {
        const beat = step * 0.5;
        const tones = chordAt(bar, beat);
        const accent = beat === 0 || beat === 2 ? 0.68 : 0.58;
        pluck("guitar", bar, beat, tones, index, 0.45, accent, KEYS);
        if (step < 4 && bar !== 19)
          pluck(
            "vibes",
            bar,
            beat + 0.25 + SWING,
            tones.map((p) => p + 12),
            COUNTER[step]!,
            0.3,
            0.42,
            VIBES,
          );
      });
    }
    for (let bar = 36; bar < 44; bar++) {
      const tones = chordAt(bar, 2.5);
      [1, 2, 3].forEach((index, step) =>
        pluck(
          "guitar",
          bar,
          2.5 + step * 0.5,
          tones,
          index,
          0.4,
          0.5 + 0.06 * step,
          KEYS,
        ),
      );
    }

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
    ] as const)
      drum(35, beat + SWING * (beat % 0.5 ? 1 : 0), pitch, v);
    // Glitch fills: a 32nd-note hat ratchet over the last half beat of a
    // phrase, ramping up into a bigger section (the snare joins its last
    // two hits before the pocket and the head return) and down into the
    // solo.
    for (const bar of RATCHETS) {
      const up = bar !== 27;
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        drum(
          bar,
          3.5 + i / 12,
          42,
          up ? 0.22 + 0.42 * t : 0.6 - 0.42 * t,
          0.07,
        );
        if ((bar === 19 || bar === 35) && i >= 4)
          drum(bar, 3.5 + i / 12 + 0.004, 38, 0.46 + 0.22 * (i - 4));
      }
    }
    // The chops: a reverse swell and a tape stop into the head return, the
    // "oh" taking two notes of the sax's climb and peak (a hocket with a
    // pitch jump) and a stutter fading into the last chord.
    s.note("chop", 35, 0, 36, 4, 0.5);
    s.note("chop", 35, 3, 48, 1, 0.62);
    for (const [bar, beat, pitch, length, velocity] of [
      [37, 1.5, 74, 0.3, 0.62],
      [37, 1.8, 62, 0.45, 0.5],
      [41, 0.5, 75, 0.35, 0.62],
      [41, 1, 72, 0.4, 0.58],
    ] as const)
      s.note("chop", bar, beat + SAX, pitch, length, velocity);
    for (let i = 0; i < 6; i++)
      s.note("chop", 43, 3.5 + i / 12, 67, 0.08, 0.55 - 0.07 * i);
    for (const [bar, beat, pitch, length, velocity] of PAD)
      s.note("oohs", bar, beat + 0.03, pitch, length, velocity);
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
