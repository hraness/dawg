/** Velvet Circuit: the UK garage demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import { Composer, hall, lanes, orbit, preset, room, voice } from "./build.ts";
import type { NoteInput } from "../score.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

/*
 * Research notes (lanes music/velvet-circuit and music2/velvet-circuit):
 * 2-step garage sits at 130-132 BPM with MPC 16th swing around 62-68%, so
 * the off-16ths land 30-40 ticks late while the kick and the clap stay on
 * the grid. The kick plays beat one and the "and" of three and skips around
 * them; the clap marks two and four and never moves. Open hats sit on the
 * offbeat 8ths with a closed hat on the 16th before most of them, and a
 * quieter shaker runs 16ths under the mix. The bass is built first and
 * answers the kick; minor ninths on Rhodes and short organ stabs carry the
 * harmony. The Todd Edwards / MK cut-up idiom pitches each vocal syllable
 * to the harmony and reassembles them as a melodic-percussive collage that
 * interweaves with organ stabs and an octave bassline. Here that collage is
 * written as a hocket: one tune split across the "hold" and "on" slices, so
 * each voice plays what the other rests on, the organ answers in the chops'
 * rests, and the sub moves against the chop line. The glitch tint (pitched
 * chops, retrigger ramps, filter flicks, a half-time flip, a tape stop)
 * always lands on the phrase grid.
 */

/** Off-16th delay in beats: about 65% MPC swing for the groove. */
const SWING = 0.075;
/** Hats and shaker swing a touch harder than the bass and the keys. */
const HAT_SWING = 0.085;

/** Beat position of a 16th step (fractions are 32nds), swung when the step is odd. */
const at = (step: number, swing = SWING) =>
  step / 4 + (Math.floor(step) % 2 ? swing : 0);

/** Small seeded generator (mulberry32) so the song stays deterministic. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Chord = Readonly<{
  name: string;
  /** Bass root (MIDI). */
  root: number;
  /** Interval of the chord's seventh above the root. */
  sev: number;
  /** Rootless Rhodes voicing; the top note is a slow melody across chords. */
  rh: readonly number[];
  /** Short organ stab voicing for the single downbeat and gap stabs. */
  org: readonly number[];
  /**
   * The organ's three-stab reply in the chops' rests, voiced above the
   * Rhodes (F4..F5): the top voice is a shape that answers the chop tune,
   * not a neighbour-note wobble. Only the first voicing plays in the
   * resolution bar, where the reply is one stab.
   */
  reply: readonly (readonly number[])[];
  /**
   * The lift riff's interlocking arp: eight pitches for the even bar (hold
   * on the offbeat 8ths, on the 16th after each) and a four-note tail for
   * the odd bar's second half that leads by step into the next chord.
   */
  arp: readonly number[];
  tail: readonly number[];
}>;

const GM9: Chord = {
  name: "Gm9",
  root: 31,
  sev: 10,
  rh: [58, 62, 65, 69],
  org: [62, 65, 70],
  // Bb C D rising: the hook's own bar-two answer, pre-echoed.
  reply: [
    [62, 65, 70],
    [65, 69, 72],
    [65, 70, 74],
  ],
  arp: [79, 74, 82, 77, 79, 72, 74, 79],
  tail: [74, 77, 79, 82],
};
const EBMAJ9: Chord = {
  name: "Ebmaj9",
  root: 39,
  sev: 11,
  rh: [58, 62, 65, 67],
  org: [62, 67, 70],
  // G Bb C: up through the third and fifth to the sixth.
  reply: [
    [62, 65, 67],
    [65, 67, 70],
    [67, 70, 72],
  ],
  arp: [82, 79, 77, 74, 79, 75, 82, 79],
  tail: [84, 82, 79, 75],
};
const CM9: Chord = {
  name: "Cm9",
  root: 36,
  sev: 10,
  rh: [58, 62, 63, 67],
  org: [62, 63, 67],
  // Eb D C falling into the sus bar.
  reply: [
    [67, 70, 75],
    [67, 70, 74],
    [67, 70, 72],
  ],
  arp: [79, 75, 82, 77, 79, 74, 75, 79],
  tail: [75, 77, 79, 82],
};
/** The sus bar: G hangs over D before it falls to F# (a 4-3 at the cadence). */
const D7SUS: Chord = {
  name: "D7sus4(b9)",
  root: 38,
  sev: 10,
  rh: [57, 60, 63, 67],
  org: [60, 62, 67],
  reply: [
    [62, 67, 72],
    [67, 69, 74],
    [62, 67, 72],
  ],
  arp: [79, 74, 84, 79, 81, 74, 79, 81],
  tail: [79, 77, 75, 74],
};
const D7B9: Chord = {
  name: "D7(b9)",
  root: 38,
  sev: 10,
  rh: [57, 60, 63, 66],
  org: [60, 63, 66],
  // One F# A C stab: the resolution the chop then sings.
  reply: [
    [66, 69, 72],
    [66, 69, 72],
    [66, 69, 72],
  ],
  arp: [78, 75, 81, 78, 81, 75, 78, 81],
  tail: [78, 75, 74, 72],
};
const DM11: Chord = {
  name: "Dm11",
  root: 38,
  sev: 10,
  rh: [57, 60, 62, 67],
  org: [60, 62, 65],
  // C D F rising over the minor eleventh.
  reply: [
    [65, 69, 72],
    [67, 72, 74],
    [69, 72, 77],
  ],
  arp: [81, 77, 79, 76, 77, 74, 76, 81],
  tail: [76, 77, 79, 81],
};
/** The lift's sus bar: Bb hangs over F before it falls to A. */
const F13SUS: Chord = {
  name: "F13sus4",
  root: 41,
  sev: 10,
  rh: [62, 63, 67, 70],
  org: [63, 65, 70],
  reply: [
    [65, 70, 75],
    [65, 70, 75],
    [65, 70, 75],
  ],
  arp: [82, 77, 84, 79, 82, 75, 77, 82],
  tail: [79, 77, 75, 74],
};
const F13: Chord = {
  name: "F13",
  root: 41,
  sev: 10,
  rh: [62, 63, 67, 69],
  org: [63, 65, 69],
  // One A C Eb stab under the chop's A.
  reply: [
    [69, 72, 75],
    [69, 72, 75],
    [69, 72, 75],
  ],
  arp: [81, 77, 84, 79, 81, 75, 77, 81],
  tail: [79, 77, 75, 74],
};

/** i9 - VImaj9 - iv9 - V7sus(b9) - V7(b9), two bars a chord; the top voice walks A G G G F#. */
const HOME = [GM9, GM9, EBMAJ9, EBMAJ9, CM9, CM9, D7SUS, D7B9] as const;
/** The climbing lift into each hook: iv9 - v11 - VImaj9 - VII13sus - VII13. */
const CLIMB = [CM9, CM9, DM11, DM11, EBMAJ9, EBMAJ9, F13SUS, F13] as const;
/**
 * The half-time switch-up: the hook's own harmony under the augmented tune,
 * then iv9 and the VII13 sus into the last drop.
 */
const SWITCH = [GM9, GM9, EBMAJ9, EBMAJ9, CM9, CM9, F13SUS, F13] as const;

/**
 * The breakdown: a 7-6 chain over a sub that walks down G F Eb D, then a
 * 4-3 at the cadence. Each bar is the bass note and a three-note Rhodes
 * voicing whose top holds the suspension and lets it fall; the chops sing
 * the chain an octave up (`BREAK`).
 */
const CHAIN: readonly Readonly<{
  bass: number;
  rh: readonly number[];
}>[] = [
  { bass: 43, rh: [58, 62, 65] }, // Gm7: F is the 7th over G
  { bass: 43, rh: [58, 62, 63] }, // ...falls to Eb, the 6th
  { bass: 41, rh: [57, 60, 63] }, // F7: Eb is now the 7th over F
  { bass: 41, rh: [57, 60, 62] }, // ...falls to D
  { bass: 39, rh: [55, 58, 62] }, // Ebmaj7: D the 7th over Eb
  { bass: 39, rh: [55, 58, 60] }, // ...falls to C
  { bass: 38, rh: [55, 57, 60] }, // D7sus4: G hangs over D
  { bass: 38, rh: [57, 60, 66] }, // ...falls to F#, voiced up with the others
];

/** The grains under the chain: the hook motif in whole notes, its last note resolving to F#. */
const BREAK_PAD = [74, 70, 69, 67, 74, 70, 69, 66] as const;

/**
 * The bass's approach into the next chord: a tone of the current chord a
 * step or two from the next root, so the slide stays in key.
 */
const APPROACH: Readonly<Record<string, number>> = {
  "Gm9>Ebmaj9": 38, // D, the fifth, up a half step
  "Ebmaj9>Cm9": 34, // Bb, the fifth, up a whole step
  "Cm9>D7sus4(b9)": 39, // Eb, the third, down a half step
  "D7(b9)>Gm9": 33, // A, the fifth, down a whole step
  "D7(b9)>Cm9": 34, // Bb up a whole step
  "Cm9>Dm11": 39, // Eb down a half step
  "Dm11>Ebmaj9": 41, // F, the third, down a whole step
  "Ebmaj9>F13sus4": 43, // G, the third, down a whole step
  "Cm9>F13sus4": 43, // G, the fifth, down a whole step
  "F13>Gm9": 33, // A, the third, down a whole step
};

const SECTIONS = [
  "Warm-up",
  "Pocket",
  "Lift",
  "Hold on",
  "Suspended",
  "Switch-up",
  "Last call",
  "Afterglow",
] as const;
type SectionName = (typeof SECTIONS)[number];

const sectionOf = (bar: number): SectionName => SECTIONS[Math.floor(bar / 8)]!;
const chordAt = (bar: number): Chord => {
  const name = sectionOf(bar);
  const progression =
    name === "Lift" ? CLIMB : name === "Switch-up" ? SWITCH : HOME;
  if (name === "Afterglow" && bar >= 62) return GM9;
  return progression[bar % 8]!;
};

/** One bass event: 16th step, semitones over the root, 16ths held, velocity. */
type BassHit = readonly [
  step: number,
  interval: number,
  len: number,
  vel: number,
];

/**
 * Bass cells, two bars each: [first bar, second bar]. `-99` marks the
 * approach note, `-1` the seventh. The lines move against the chops: where
 * the chop tune falls through the first bar the bass climbs to its octave,
 * and where the chops rise through the second bar the bass walks back down.
 */
const BASS: Readonly<
  Record<
    "pocket" | "hook" | "hookB" | "lift" | "half",
    readonly [readonly BassHit[], readonly BassHit[]]
  >
> = {
  // The hook's first two pairs: a downbeat root anchors the odd bars, so
  // the tune has a beat one to push against; the turnaround pairs keep the
  // skip (`hook`).
  hookB: [
    [
      [0, 0, 3, 0.94],
      [4, 7, 1, 0.56],
      [6, 12, 1, 0.6],
      [10, 12, 2, 0.72],
      [14, 7, 1, 0.6],
    ],
    [
      [0, 0, 1, 0.84],
      [1, 12, 1, 0.58],
      [3, 7, 1, 0.54],
      [8, 0, 3, 0.82],
      [11, -1, 1, 0.6],
      [13, -99, 3, 0.68],
    ],
  ],
  // Sparse sub on one with the kick, replies in the kick's gaps.
  pocket: [
    [
      [0, 0, 4, 0.9],
      [7, 7, 1, 0.5],
      [10, 12, 2, 0.66],
      [14, 12, 1, 0.52],
    ],
    [
      [2, 12, 1, 0.6],
      [6, 7, 1, 0.56],
      [11, 0, 2, 0.72],
      [13, -99, 3, 0.64],
    ],
  ],
  // Hook: up to the octave as the chops fall, down the seventh as they rise.
  hook: [
    [
      [0, 0, 3, 0.94],
      [4, 7, 1, 0.56],
      [6, 12, 1, 0.6],
      [10, 12, 2, 0.72],
      [14, 7, 1, 0.6],
    ],
    [
      [1, 12, 1, 0.62],
      [3, 7, 1, 0.56],
      [8, 0, 3, 0.82],
      [11, -1, 1, 0.6],
      [13, -99, 3, 0.68],
    ],
  ],
  // Rolling lift: off-beat entries and octave drops.
  lift: [
    [
      [0, 0, 2, 0.9],
      [2, 12, 1, 0.55],
      [5, 0, 2, 0.76],
      [8, 0, 1, 0.6],
      [11, 7, 2, 0.72],
      [14, 12, 1, 0.58],
    ],
    [
      [1, 0, 3, 0.86],
      [6, 12, 1, 0.5],
      [7, 10, 1, 0.5],
      [9, 7, 2, 0.68],
      [12, 0, 1, 0.6],
      [13, -99, 3, 0.72],
    ],
  ],
  // Half-time: long subs with octave pops in the gaps.
  half: [
    [
      [0, 0, 6, 0.92],
      [8, 12, 1, 0.5],
      [11, 7, 2, 0.6],
      [14, 12, 1, 0.5],
    ],
    [
      [0, 12, 2, 0.64],
      [4, 7, 2, 0.58],
      [8, 0, 4, 0.8],
      [13, -99, 3, 0.66],
    ],
  ],
};

/** Kick rows per bar of a two-bar cycle; digits are velocities. */
const KICKS = {
  // Beat one and the "and" of three.
  a: "9.........8.....",
  // A pickup 16th before the next bar.
  b: "9.........8...6.",
  // Fourth bar: a skip on the "and" of two before the "and" of three.
  c: "9.....6...8..7..",
  // Rolling 2-step: no kick on the second bar's downbeat.
  roll: "..8.......8..6..",
  // Hyper-syncopated last-hook bar.
  hyper: "9..6......8..6..",
  // Half-time: the downbeat alone, then a pickup every other bar.
  halfA: "9...............",
  halfB: "9.........6.....",
  halfC: "9.....6.........",
} as const;

/** Vocal chop events: [16th step (halves are 32nds), syllable, pitch, 16ths held, velocity]. */
type Chop = readonly [
  step: number,
  syllable: "hold" | "on",
  pitch: number,
  len: number,
  vel: number,
  /** Swing in beats; absent swings like the groove, 0 is machine-straight. */
  swing?: number,
];

/**
 * The hook: one tune, eight bars, split strictly between the two slices so
 * neither sounds while the other does. Motif (D Bb A G) in bar one, its
 * rising answer (Bb C D) in bar two, restated over Ebmaj9 with one change,
 * varied over Cm9 up to the peak F in bar six, then the sus bar: G hangs
 * over D7sus4 and falls to F# at bar eight, the 4-3 sung. The first half of
 * each odd bar rests for the organ's answer.
 */
const HOOK: readonly (readonly Chop[])[] = [
  [
    [2, "hold", 74, 3, 0.8],
    [6, "on", 70, 2, 0.72],
    [10, "hold", 69, 2, 0.74],
    [13, "on", 67, 2.7, 0.76],
  ],
  [
    [8, "hold", 70, 2, 0.66],
    [11, "on", 72, 2, 0.7],
    [14, "hold", 74, 1, 0.62],
    [15, "on", 74, 0.6, 0.7],
  ],
  // The restatement squares up: the D D pickup lands on the downbeat and
  // the phrase sits on the beats, the one place the tune stops floating.
  [
    [0, "hold", 74, 3, 0.8],
    [4, "on", 70, 2, 0.72],
    [8, "hold", 67, 2, 0.72],
    [12, "on", 65, 3, 0.74],
  ],
  [
    [8, "hold", 67, 2, 0.64],
    [11, "on", 70, 2, 0.7],
    [14, "hold", 72, 1, 0.62],
    [15, "on", 72, 1, 0.7],
  ],
  [
    [2, "hold", 75, 3, 0.82],
    [6, "on", 74, 2, 0.74],
    [10, "hold", 70, 2, 0.72],
    [13, "on", 67, 2.7, 0.74],
  ],
  [
    [8, "hold", 72, 2, 0.68],
    [11, "on", 74, 2, 0.72],
    [14, "hold", 77, 2, 0.84],
  ],
  [
    [1, "on", 75, 2, 0.7],
    [4, "hold", 72, 2, 0.72],
    [7, "on", 69, 2, 0.7],
    [10, "hold", 67, 6, 0.78],
  ],
  [
    [2, "on", 66, 3, 0.74],
    [6, "hold", 69, 2, 0.7],
    [9, "on", 72, 2, 0.68],
  ],
];

/**
 * A retrigger ramp over the last beat of a phrase: the syllables re-fired as
 * 32nds fading down. With `jumps` the chop pitch jumps -5, +5 and +12
 * between hits, the pitched-chop tint.
 */
const ramp = (jumps: boolean): Chop[] =>
  (
    (jumps
      ? [
          [12, "hold", 74, 0.5, 0.74],
          [12.5, "hold", 74, 0.5, 0.66],
          [13, "on", 69, 0.5, 0.6],
          [13.5, "on", 69, 0.5, 0.54],
          [14, "hold", 74, 0.5, 0.64],
          [14.5, "hold", 79, 0.5, 0.52],
          [15, "on", 74, 0.5, 0.58],
          [15.5, "on", 86, 0.5, 0.42],
        ]
      : [
          [12, "hold", 74, 0.5, 0.74],
          [12.5, "hold", 74, 0.5, 0.68],
          [13, "hold", 74, 0.5, 0.62],
          [13.5, "hold", 74, 0.5, 0.56],
          [14, "on", 74, 0.5, 0.66],
          [15, "on", 72, 0.5, 0.6],
        ]) as [number, "hold" | "on", number, number, number][]
  ).map(([step, syllable, pitch, len, vel]): Chop => [
    step,
    syllable,
    pitch,
    len,
    vel,
    0,
  ]);

/**
 * The last drop's exit: a two-beat ramp of straight 32nds whose pitch climbs
 * a beat at a time (+0, +5, +12, +17) while the velocity fades; the track's
 * bitcrush automation bites on the last two repeats only.
 */
const climb = (): Chop[] => {
  const out: Chop[] = [];
  const steps = [0, 5, 12, 17];
  for (let k = 0; k < 16; k++) {
    const step = 8 + k / 2;
    out.push([
      step,
      k % 2 ? "on" : "hold",
      72 + steps[Math.floor(k / 4)]!,
      0.5,
      0.76 - k * 0.025,
      0,
    ]);
  }
  return out;
};

/**
 * The lift riff: an interlocking arp over the +12 register. In the even bar
 * the hold slice takes the offbeat 8ths and the on slice the 16th after
 * each, so the merged line is the chord's arpeggio with its own contour; in
 * the odd bar the organ owns the first half and a four-note tail leads by
 * step into the next chord. The on's last 16th is the pickup into the
 * organ's downbeat stab.
 */
const riff = (chord: Chord, second: boolean): Chop[] => {
  if (second)
    return chord.tail.map((pitch, i): Chop => [
      [8, 9, 12, 13][i]!,
      i % 2 ? "on" : "hold",
      pitch,
      1,
      i % 2 ? 0.62 : 0.68,
    ]);
  return chord.arp.map((pitch, i): Chop => [
    2 + Math.floor(i / 2) * 4 + (i % 2),
    i % 2 ? "on" : "hold",
    pitch,
    1,
    i % 2 ? 0.62 : i % 4 === 0 ? 0.72 : 0.66,
  ]);
};

/**
 * The switch-up's chops: the hook motif and its answer in half-time
 * augmentation over bars 40-43 (every step and length doubled, so the
 * half-time flip is heard in the tune), then the riff augmented to 8ths
 * over bars 44-45. Bars 46-47 are the sus bar and the tape stop.
 */
const SWITCH_CHOPS: readonly (readonly Chop[])[] = [
  [
    [4, "hold", 74, 6, 0.8],
    [12, "on", 70, 4, 0.72],
  ],
  [
    [4, "hold", 69, 4, 0.74],
    [10, "on", 67, 6, 0.76],
  ],
  // The organ's augmented answer owns this bar.
  [],
  [
    [0, "hold", 70, 4, 0.68],
    [6, "on", 72, 4, 0.7],
    [12, "hold", 74, 2, 0.64],
    [14, "on", 74, 2, 0.7],
  ],
];

/**
 * The last call develops the hook instead of repeating it: the motif (bars
 * one and two of `HOOK`), its inversion led by the on slice with a mid-phrase
 * retrigger, then the hocket doubled to 16th-level alternation rising to the
 * song's peak G5 late in bar six, then the sus bar and the climbing ramp.
 */
const LAST: readonly (readonly Chop[])[] = [
  HOOK[0]!,
  HOOK[1]!,
  // G A Bb D: the motif inverted, answered by the organ in the next bar.
  [
    [2, "on", 67, 3, 0.74],
    [6, "hold", 69, 2, 0.72],
    [10, "on", 70, 2, 0.72],
    [13, "hold", 74, 2, 0.78],
  ],
  // D C Bb Bb: the answer inverted; the on syllable stutters -5 then +12.
  [
    [8, "on", 74, 1, 0.7],
    [9, "on", 74, 0.5, 0.62, 0],
    [9.5, "on", 69, 0.5, 0.56, 0],
    [10, "on", 86, 0.5, 0.5, 0],
    [11, "hold", 72, 2, 0.7],
    [14, "on", 70, 1, 0.64],
    [15, "hold", 70, 1, 0.7],
  ],
  // Eb D Bb G | C D Eb F on consecutive 16ths.
  [
    [2, "hold", 75, 1, 0.78],
    [3, "on", 74, 0.65, 0.72],
    [4, "hold", 70, 1, 0.74],
    [5, "on", 67, 1, 0.72],
    [10, "hold", 72, 1, 0.74],
    [11, "on", 74, 0.65, 0.74],
    [12, "hold", 75, 1, 0.78],
    [13, "on", 77, 2, 0.8],
  ],
  // D Eb F Eb G: the peak, the loudest chop in the song.
  [
    [8, "hold", 74, 1, 0.74],
    [9, "on", 75, 1, 0.74],
    [11, "hold", 77, 0.65, 0.78],
    [12, "on", 75, 1, 0.74],
    [14, "hold", 79, 2, 0.9],
  ],
  HOOK[6]!,
  [
    [2, "on", 66, 3, 0.74],
    [6, "hold", 69, 2, 0.7],
  ],
];

/**
 * The break's chops: the 7-6 chain sung an octave up and tied across the
 * bar line, so the sixth is held while the sub steps down under it (it
 * becomes the seventh) and the other slice resolves it on step two. Bar
 * seven holds G over D7 until F# answers: the 4-3.
 */
const BREAK: readonly (readonly Chop[])[] = [
  [[0, "hold", 77, 8, 0.64]],
  [
    [0, "on", 75, 6, 0.6],
    [8, "hold", 75, 9.8, 0.58],
  ],
  [[2, "on", 74, 6, 0.6]],
  [
    [1, "hold", 86, 1, 0.4],
    [4, "on", 69, 2, 0.44],
    [8, "hold", 74, 9.8, 0.58],
  ],
  [[2, "on", 72, 6, 0.6]],
  [
    [1, "hold", 84, 1, 0.4],
    [4, "on", 67, 2, 0.44],
    [8, "hold", 72, 9.8, 0.58],
  ],
  [
    [2, "on", 70, 3, 0.6],
    [6, "hold", 67, 11.8, 0.62],
  ],
  [[2, "on", 66, 4, 0.62]],
];

export const velvetCircuit: DemoDefinition = {
  info: demoInfo({
    id: "velvet-circuit",
    title: "Velvet Circuit",
    style: "UK garage",
    description:
      "A swung two-step pocket under a 'hold on' hook hocketed between two vocal slices, an organ reply shaped to answer it, minor-ninth Rhodes that suspend before every turnaround and a sub that climbs while the chops fall; the switch-up plays the tune in half-time, a tape stop sets up the last drop, and the last call inverts the hook and doubles the hocket to a peak.",
    tempoBpm: 130,
    key: "Gm",
    bars: 64,
    highlightBar: 24,
    trackId: "hold",
    features: [
      "two-step swing",
      "vocal-chop hocket that inverts and doubles",
      "organ call and response",
      "interlocking chop arpeggio",
      "Rhodes ninths with 4-3 suspensions",
      "contrary sub bass",
      "granular vowel pad",
      "half-time switch-up",
      "tape stop, retrigger ramps and a bitcrushed exit",
    ],
    arrangement: SECTIONS.map((name) => `${name} 8`),
    mixNotes: [
      "Kick and clap sit dead on the grid; hats, shaker, rims, bass and chops swing about 65% so the groove skips without smearing, and the pocket's hats open on only two of the four offbeats.",
      "The two syllable tracks never sound together: 'hold' and 'on' trade one tune, the organ's reply is voiced above the Rhodes with its own top-voice shape in the first half of every second bar, and the Rhodes leaves that half to it.",
      "The sub climbs to its octave while the chops fall and walks down the seventh while they rise; it anchors beat one of the hook's first odd bars, slides into each change from an in-key approach tone and never doubles the kick.",
      "Suspensions carry the richness: a 4-3 in the Rhodes top voice before every turnaround, a 7-6 chain in the break whose sixths are held across the bar line while the sub steps down, the chops singing the chain an octave up.",
      "The arc climbs: the pocket sits back, the break drops to a quiet pedal and a motif in the vowel cloud, the last call adds a second clap, a ride on every 8th and the loudest chops, then exits on a climbing, bitcrushed ramp.",
      "Glitch on the phrase grid only: retrigger ramps and a mid-phrase stutter, DJ-filter flicks on single stabs and one chop, a reversed syllable before the peak, the half-time switch-up, and a tape stop plus a silent beat into the last drop.",
    ],
  }),
  build() {
    const s = new Composer(velvetCircuit.info);
    SECTIONS.forEach((name, i) => s.section(name, i * 8, 8));
    const rand = seeded(1307);
    const jitter = (amount: number) => (rand() - 0.5) * 2 * amount;

    s.track(
      voice("kick", "Skip kick", "kit", 0.8, {
        kit: "syn909",
        humanize: { timing: 1.5, velocity: 3, seed: 11 },
        fx: { duck: { orbit: 2, depth: 0.45, attack: 0.14 } },
      }),
    );
    s.track(
      voice("drums", "Shuffle hats", "kit", 0.55, {
        kit: "synlinn",
        pan: -0.1,
        humanize: { timing: 5, velocity: 5, length: 10, seed: 23 },
        reverb: { mix: 0.06, size: 0.28, fade: 0.8 },
      }),
    );
    s.track(
      voice("perc", "Shaker", "kit", 0.3, {
        kit: "lofi",
        pan: 0.34,
        humanize: { timing: 7, velocity: 8, length: 15, seed: 29 },
        filter: { type: "hpf", cutoff: 2400, resonance: 0.1 },
        // Builds through the Lift and the Switch-up into each hook.
        volumeAutomation: lanes(
          [0, 0.8],
          [15.9, 0.8],
          [16, 0.7],
          [23.9, 1],
          [39.9, 1],
          [40, 0.74],
          [47.9, 1],
        ),
        reverb: { mix: 0.08, size: 0.3, fade: 0.9 },
      }),
    );
    s.track(
      preset("bass", "Round sub", "sub-sine", 0.58, {
        humanize: { timing: 3, velocity: 4, seed: 31 },
        glide: { time: 0.05, mode: "legato" },
        // A mix ride: the sub sits back in the pocket and opens up in the hooks.
        volumeAutomation: lanes(
          [8, 0.72],
          [15.9, 0.72],
          [16, 0.84],
          [23.9, 0.84],
          [24, 0.9],
          [31.9, 0.9],
          [32, 0.6],
          [39.9, 0.66],
          [40, 0.92],
          [47.9, 0.92],
          [48, 1],
          [55.9, 1],
          [56, 0.86],
        ),
        fx: orbit,
      }),
    );
    s.track(
      voice("keys", "Velvet ninths", "rhodes", 0.46, {
        pan: -0.16,
        humanize: { timing: 6, velocity: 5, length: 8, seed: 37 },
        filter: { type: "lpf", cutoff: 16000, resonance: 0.12 },
        filterAutomation: lanes(
          [0, 650],
          [6, 2200],
          [8, 16000],
          [58, 16000],
          [63.5, 900],
        ),
        reverb: room,
        delay: { beats: 0.75, feedback: 0.18, mix: 0.09 },
        fx: orbit,
      }),
    );
    // DJ-filter flicks on single organ stabs: a thin snap for one 16th.
    const flick = (bar: number, step: number): [number, number][] => {
      const t = bar + step / 16;
      return [
        [t - 0.004, 0.5],
        [t, 0.84],
        [t + 0.055, 0.84],
        [t + 0.06, 0.5],
      ];
    };
    s.track(
      voice("organ", "M1 stabs", "tonewheel", 0.3, {
        pan: 0.24,
        keys: {
          preset: "tonewheel",
          drawbars: "868000400",
          perc: "3rd",
          percdecay: "fast",
          click: 0.6,
          rotary: "slow",
          drive: 0.25,
        },
        humanize: { timing: 4, velocity: 6, length: 10, seed: 41 },
        filter: { type: "hpf", cutoff: 260, resonance: 0.1 },
        volumeAutomation: lanes(
          [8, 0.72],
          [15.9, 0.72],
          [16, 0.8],
          [23.9, 0.92],
          [39.9, 0.92],
          [40, 0.86],
          [47.9, 0.96],
          [48, 1],
        ),
        reverb: room,
        fx: { ...orbit, djf: { value: 0.5 } },
        fxAutomation: {
          "djf-value": lanes(
            [0, 0.5],
            ...flick(27, 3),
            ...flick(29, 0),
            ...flick(43, 2),
            ...flick(45, 0),
            ...flick(49, 3),
            ...flick(51, 0),
            ...flick(53, 5),
            [63, 0.5],
          ),
        },
      }),
    );
    // The bitcrush bites on the last two repeats of the final ramp (bar 55,
    // beat four) and is clean everywhere else.
    const crushLanes = {
      "crush-mix": lanes(
        [0, 0],
        [55.75 - 0.004, 0],
        [55.75, 1],
        [56 - 0.004, 1],
        [56, 0],
      ),
      "crush-bits": lanes(
        [0, 16],
        [55.75 - 0.004, 16],
        [55.75, 6],
        [56 - 0.004, 4],
        [56, 16],
      ),
    };
    for (const [id, name, begin, end, pan, seed] of [
      ["hold", "Hold", 0, 0.25, -0.1, 43],
      ["on", "On", 0.25, 0.5, 0.14, 47],
    ] as const)
      s.track(
        voice(id, name, "sampler", 0.7, {
          pan,
          sampler: {
            mode: "keyed",
            voices: {
              [id]: {
                ...bundledSampleRef("hold-on"),
                begin,
                end,
                fadeTime: 0.012,
                fadeInTime: 0.003,
              },
            },
          },
          humanize: { timing: 3, velocity: 4, seed },
          filter: { type: "hpf", cutoff: 190, resonance: 0.25 },
          fx: {
            ...orbit,
            crush: { bits: 16, coarse: 1, mix: 0 },
            ...(id === "hold" ? { djf: { value: 0.5 } } : {}),
          },
          fxAutomation: {
            ...crushLanes,
            // One DJ-filter flick on the hold slice's riff note in the
            // switch-up, so the tint touches the chops too.
            ...(id === "hold"
              ? { "djf-value": lanes([0, 0.5], ...flick(44, 4), [63, 0.5]) }
              : {}),
          },
          reverb: room,
          delay: { beats: 0.75, feedback: 0.24, mix: 0.12, pingpong: true },
          delayMixAutomation: lanes(
            [0, 0.2],
            [7.9, 0.2],
            [8, 0.11],
            [31.9, 0.11],
            [32, 0.34],
            [39.9, 0.34],
            [40, 0.11],
            [55.9, 0.11],
            [56, 0.22],
          ),
          delayFeedbackAutomation: lanes(
            [0, 0.3],
            [7.9, 0.3],
            [8, 0.22],
            [31.9, 0.22],
            [32, 0.46],
            [39.9, 0.46],
            [40, 0.22],
            [55.9, 0.22],
            [56, 0.38],
          ),
        }),
      );
    // A granular cloud of the "oh" vowel: the pad under the empty sections,
    // a faint bed under the hooks. Two slow voices a fifth or a sixth apart.
    s.track(
      voice("grains", "Vowel cloud", "granular", 0.3, {
        granular: {
          src: bundledSampleRef("vowel-oh"),
          root: 60,
          grain: 0.2,
          overlap: 4,
          pos: 0.45,
          scan: 0.06,
          spread: 0.8,
          spray: 0.03,
          jitter: 0.1,
          attack: 0.6,
          release: 1.2,
          gain: 0.5,
        },
        pan: 0.08,
        filter: { type: "lpf", cutoff: 2400, resonance: 0.1 },
        filterAutomation: lanes(
          [0, 900],
          [7, 2400],
          [8, 1600],
          [31, 1800],
          [32, 1400],
          [39, 3200],
          [40, 1800],
          [47.9, 3600],
          [48, 2000],
          [56, 2600],
          [63, 700],
        ),
        volumeAutomation: lanes(
          [0, 1],
          [7.9, 1],
          [8, 0.55],
          [19.9, 0.55],
          [20, 0.75],
          [23.9, 0.9],
          [24, 0.6],
          [31.9, 0.6],
          [32, 1],
          [39.9, 1],
          [40, 0.7],
          [47.9, 0.85],
          [48, 0.85],
          [55.9, 0.85],
          [56, 0.9],
        ),
        reverb: hall,
        fx: orbit,
      }),
    );
    // Reverse swells into the drops (`ah`, played below C5) and one reversed
    // "on" syllable (`onrev`, keyed from C5 up) that sucks into the peak bar.
    s.track(
      voice("swell", "Reverse breath", "sampler", 0.22, {
        sampler: {
          mode: "keyed",
          voices: {
            ah: {
              ...bundledSampleRef("vowel-ah"),
              root: 48,
              speed: -1,
              fit: true,
              fadeInTime: 0.15,
              fadeTime: 0.015,
            },
            onrev: {
              ...bundledSampleRef("hold-on"),
              root: 72,
              begin: 0.25,
              end: 0.5,
              gain: 1.6,
              speed: -1,
              fit: true,
              fadeInTime: 0.02,
              fadeTime: 0.008,
            },
          },
        },
        reverb: hall,
      }),
    );
    s.track(
      voice("fx", "Riser", "sampler", 0.2, {
        pan: 0.05,
        sampler: {
          mode: "oneshot",
          voices: {
            rise: {
              ...bundledSampleRef("riser"),
              fit: true,
              fadeInTime: 0.4,
              fadeTime: 0.03,
            },
          },
        },
        filter: { type: "hpf", cutoff: 400, resonance: 0.2 },
        reverb: hall,
      }),
    );

    const hit = (
      track: string,
      bar: number,
      step: number,
      pitch: number,
      vel: number,
      len = 1,
      swing = SWING,
      extra: Partial<NoteInput> = {},
    ) =>
      s.note(
        track,
        bar,
        at(step, swing),
        pitch,
        len / 4,
        Math.max(0.05, Math.min(1, vel)),
        extra,
      );
    const row = (
      track: string,
      bar: number,
      pitch: number,
      grid: string,
      scale = 1,
    ) =>
      [...grid].forEach((ch, step) => {
        if (ch !== ".")
          hit(track, bar, step, pitch, (Number(ch) / 10) * scale, 1);
      });
    /** A chord, top voice leading, inner voices softer, slightly rolled. */
    const stab = (
      track: string,
      bar: number,
      step: number,
      pitches: readonly number[],
      len: number,
      vel: number,
      roll = 0.012,
      extra: Partial<NoteInput> = {},
    ) => {
      const hand = vel + jitter(0.04);
      pitches.forEach((pitch, i) =>
        s.note(
          track,
          bar,
          at(step) + i * roll,
          pitch,
          len / 4,
          hand * (i === pitches.length - 1 ? 1 : i === 0 ? 0.84 : 0.78),
          extra,
        ),
      );
    };
    /** Everything still ringing dives an octave over one beat: the tape stop. */
    const TAPE: Partial<NoteInput> = {
      bend: [
        { at: 0, cents: 0 },
        { at: 0.15, cents: -80 },
        { at: 1, cents: -1200 },
      ],
    };

    /** Bars with a bassline: none in the intro or the last four bars. */
    const bassPlays = (bar: number) =>
      sectionOf(Math.min(63, bar)) !== "Warm-up" && bar < 60;
    let slideIn = false;
    /** The Rhodes pushed the chord over the bar line into this bar. */
    let pushed = false;

    for (let b = 0; b < 64; b++) {
      const sec = sectionOf(b);
      const inBar = b % 8;
      const second = b % 2 === 1;
      const chord = chordAt(b);
      const next = chordAt(Math.min(63, b + 1));
      const breakdown = sec === "Suspended";
      const hook = sec === "Hold on" || sec === "Last call";
      const last = sec === "Last call";
      const lift = sec === "Lift";
      const half = sec === "Switch-up";
      const intro = sec === "Warm-up";
      const outro = sec === "Afterglow";
      // The last beat before each hook drops out; bar 47 is the tape stop.
      const tapeStop = b === 47;
      const dropOut = b === 23 || tapeStop || b === 7;
      const grooveOn = !breakdown && !(intro && b < 4) && !(outro && b >= 62);
      const kickOn = grooveOn && !(outro && b >= 60);
      // The arc: the pocket sits back, the lift and the switch-up a touch
      // under the hooks, the last call at full weight.
      const weight =
        sec === "Pocket"
          ? 0.8
          : lift
            ? 0.9
            : half
              ? 0.94
              : hook && !last
                ? 0.95
                : outro
                  ? 0.9
                  : 1;
      // Hats skip in the pocket and the first hook: open hats on two of the
      // four offbeats only, with ghosted 16ths after the others.
      const skippy = sec === "Pocket" || sec === "Hold on";

      // ---------- kick ----------
      if (kickOn) {
        let pattern: string = second ? KICKS.b : KICKS.a;
        if (b % 4 === 3) pattern = KICKS.c;
        if (half)
          pattern = second
            ? b % 4 === 3
              ? KICKS.halfC
              : KICKS.halfB
            : KICKS.halfA;
        if (last && second && b % 4 === 1) pattern = KICKS.roll;
        if (last && !second && b % 4 === 2) pattern = KICKS.hyper;
        if (dropOut) pattern = pattern.slice(0, 12) + "....";
        row("kick", b, 36, pattern, weight);
      }

      // ---------- clap, snare, hats, rims (drums) ----------
      if (grooveOn) {
        const clapOn = !(intro && b < 4);
        if (clapOn)
          for (const step of half ? [8] : [4, 12]) {
            if (dropOut && step === 12) continue;
            const v = (step === 12 || half ? 0.86 : 0.8) * weight;
            hit("drums", b, step, 39, v + jitter(0.03), 1, 0);
            hit(
              "drums",
              b,
              step,
              38,
              (step === 12 || half ? 0.56 : 0.5) * weight + jitter(0.03),
              1,
              0,
            );
            // The last call layers a second, late clap on four for width.
            if (last && step === 12)
              hit("drums", b, 12.1, 39, 0.5 + jitter(0.03), 1, 0);
          }
        // Hats: open on the offbeat 8ths with a closed hat on the 16th before
        // most of them; busier closed 16ths from the Lift on, every 16th in
        // the last hook (the double-time lift).
        const busy = lift || hook || half || (outro && b < 60);
        for (let step = 0; step < 16; step++) {
          if (dropOut && step >= 12) continue;
          const open =
            half || skippy ? step === 6 || step === 14 : step % 4 === 2;
          if (open) {
            // The last open hat of the bar breathes softer; skip one now and
            // then so the line never loops exactly.
            if (step === 6 && b % 4 === 1 && !busy) continue;
            const v = step === 14 ? 0.4 : step === 10 ? 0.5 : 0.54;
            hit("drums", b, step, 46, v + jitter(0.04), 1.5, HAT_SWING);
            continue;
          }
          const before = step % 4 === 1;
          const onBeat = step % 4 === 0;
          if (skippy && (step === 3 || step === 11)) {
            // The ghost after the missing open hat: the skip.
            hit("drums", b, step, 42, 0.2 + jitter(0.04), 0.5, HAT_SWING);
          } else if (skippy && (step === 2 || step === 10)) {
            continue;
          } else if (before && !(step === 9 && second && !busy)) {
            hit("drums", b, step, 42, 0.36 + jitter(0.05), 0.5, HAT_SWING);
          } else if (last) {
            const v = onBeat ? 0.3 : step % 4 === 2 ? 0.24 : 0.2;
            hit("drums", b, step, 42, v + jitter(0.04), 0.5, HAT_SWING);
          } else if (busy && step % 4 === 3 && step !== 3) {
            hit("drums", b, step, 42, 0.26 + jitter(0.05), 0.5, HAT_SWING);
          } else if (onBeat && busy && step !== 4 && step !== 12) {
            hit("drums", b, step, 42, 0.3 + jitter(0.04), 0.5, HAT_SWING);
          } else if (half && step % 4 === 2) {
            hit("drums", b, step, 42, 0.3 + jitter(0.04), 0.5, HAT_SWING);
          }
        }
        // Rim clicks: one at the end of the first bar, a busier turnaround at
        // the end of the second (Attack's "found sound" 2-step).
        if (!dropOut) {
          if (!second) {
            hit("drums", b, 15, 37, 0.3 + jitter(0.04), 1);
            if (b % 4 === 0) hit("drums", b, 7, 37, 0.18 + jitter(0.03), 1);
          } else {
            hit("drums", b, 11, 37, 0.24 + jitter(0.03), 1);
            hit("drums", b, 13, 37, 0.3 + jitter(0.03), 1);
            if (b % 4 === 3) hit("drums", b, 14, 37, 0.36 + jitter(0.03), 1);
          }
        }
        // Skippy ghost snares: the "a" of two in the hooks, the "e" of three
        // and four in the half-time section, never on a bar the kick skips.
        if ((hook || lift) && b % 2 === 0)
          hit("drums", b, 7, 38, 0.16 + jitter(0.03), 1);
        if ((hook || lift) && b % 4 === 3 && !dropOut)
          hit("drums", b, 9, 38, 0.14 + jitter(0.03), 1);
        if (half && !dropOut) {
          hit("drums", b, 11, 38, 0.18 + jitter(0.03), 1);
          if (second) hit("drums", b, 15, 38, 0.22 + jitter(0.03), 1);
        }
        // The last hook adds a ride on every 8th for lift, the beats louder.
        if (last)
          for (let step = 0; step < 16; step += 2) {
            if (step === 0 && b === 48) continue;
            if (dropOut && step >= 12) continue;
            const v =
              step === 0 ? 0.3 : step === 8 ? 0.26 : step % 4 ? 0.17 : 0.22;
            hit("drums", b, step, 51, v + jitter(0.03), 2, 0);
          }
      }
      // Crash on the big downbeats; the pocket enters without one.
      if ([16, 24, 40, 48].includes(b))
        hit("drums", b, 0, 49, b === 48 ? 0.66 : b === 16 ? 0.42 : 0.52, 8, 0);
      if (b === 56) hit("drums", b, 0, 49, 0.4, 8, 0);

      // ---------- fills ----------
      if (b === 15 || b === 39 || b === 59) {
        // Short snare and tom pickup into the next section.
        const fill: [number, number, number][] = [
          [13, 38, 0.42],
          [14, 45, 0.55],
          [15, 38, 0.66],
        ];
        for (const [step, pitch, v] of fill) hit("drums", b, step, pitch, v, 1);
      }
      if (b === 22 || b === 46) {
        // Building 16th snare across beats three and four.
        for (let step = 8; step < 16; step++)
          hit("drums", b, step, 38, 0.3 + (step - 8) * 0.06, 1, 0.04);
      }
      if (b === 38 || b === 39) {
        // Breakdown roll: 8ths, then 16ths, then 32nds, rising.
        const per = b === 38 ? 2 : 1;
        for (let step = 0; step < 16; step += per) {
          const v = 0.18 + ((b - 38) * 16 + step) * 0.022;
          hit("drums", b, step, 38, v, 1, 0);
          if (b === 39 && step >= 8)
            s.note("drums", b, at(step, 0) + 0.125, 38, 0.1, v * 0.85);
        }
      }
      if (b === 31 || b === 55) {
        // Glitch fill: a hat ratchet of 32nds rising through the last beat.
        for (let k = 0; k < 8; k++)
          hit("drums", b, 12 + k / 2, 42, 0.2 + k * 0.05, 0.5, 0);
      }

      // ---------- shaker (perc) ----------
      const shakerOn =
        (intro && b >= 2) ||
        (!breakdown && !intro && !(outro && b >= 62)) ||
        (breakdown && b >= 36);
      if (shakerOn)
        for (let step = 0; step < 16; step++) {
          if (dropOut && step >= 12) continue;
          if (!busyShaker(sec) && step % 2 === 1 && step % 4 !== 3) continue;
          // The break's shaker sneaks in as quiet 8ths, then 16ths under the roll.
          if (breakdown && b < 38 && step % 2) continue;
          const accent = breakdown
            ? (b < 38 ? 0.18 : 0.24) + (step % 4 === 2 ? 0.06 : 0)
            : (step % 4 === 2 ? 0.52 : step % 2 ? 0.28 : 0.36) * weight;
          hit(
            "perc",
            b,
            step,
            42,
            accent + jitter(0.06),
            0.6,
            HAT_SWING + 0.01,
          );
        }

      // ---------- bass ----------
      if (breakdown) {
        // The break's descending sub: G F Eb D, two bars each, a pedal
        // under the 7-6 chain, fading in from nothing.
        if (b % 2 === 0) {
          const low = CHAIN[inBar]!.bass;
          s.note("bass", b, 0, low, 7.6, 0.24 + inBar * 0.025, {
            glide: b > 32 ? 0.12 : undefined,
          });
        }
      } else if (bassPlays(b)) {
        const cell = half
          ? BASS.half
          : lift
            ? BASS.lift
            : hook
              ? inBar < 4
                ? BASS.hookB
                : BASS.hook
              : BASS.pocket;
        const hits = cell[second ? 1 : 0];
        const slide = slideIn;
        slideIn = false;
        hits.forEach(([step, interval, len, vel], i) => {
          if (dropOut && step >= 12) return;
          let pitch = chord.root + interval;
          let extra: Partial<NoteInput> = {};
          if (interval === -99) {
            if (bassPlays(b + 1) && sectionOf(b + 1) !== "Suspended") {
              // An in-key approach tone; the next downbeat slides out of it.
              pitch = APPROACH[`${chord.name}>${next.name}`] ?? next.root + 2;
              slideIn = true;
            } else {
              // Nothing follows: the octave dives down into the gap.
              pitch = chord.root + 12;
              extra = {
                bend: [
                  { at: 0.2, cents: 0 },
                  { at: 1, cents: -1200 },
                ],
              };
            }
          } else if (interval === -1) {
            pitch = chord.root + chord.sev;
          }
          if (i === 0 && slide) extra = { ...extra, glide: 0.08 };
          hit("bass", b, step, pitch, vel + jitter(0.03), len, SWING, extra);
        });
        if (tapeStop) hit("bass", b, 12, chord.root, 0.7, 4, 0, TAPE);
      }

      // ---------- Rhodes ----------
      if (breakdown) {
        // The 7-6 chain: each voicing holds its bar; the top voice falls
        // on the second bar of each pair, the bass steps down under it.
        // One hit a bar: the chain is held, never re-struck.
        const link = CHAIN[inBar]!;
        stab("keys", b, 0, link.rh, inBar % 2 ? 14 : 15, 0.42, 0.03);
      } else if (half) {
        // Half-time: long chords after the organ's downbeat stab, the sus
        // held through bar seven's change.
        const soft = 0.84;
        if (inBar === 6) {
          stab("keys", b, 0, chord.rh, 6, 0.56 * soft, 0.03);
          stab("keys", b, 8, chord.rh, 9.5, 0.5 * soft, 0.02);
        } else if (tapeStop) {
          stab("keys", b, 2, chord.rh, 5, 0.56 * soft, 0.03);
          stab("keys", b, 8, chord.rh, 4, 0.46 * soft, 0.02);
          stab("keys", b, 12, chord.rh, 4, 0.5, 0.02, TAPE);
        } else {
          // Bar three of the section belongs to the organ's augmented answer.
          if (inBar !== 2) stab("keys", b, 2, chord.rh, 4, 0.5 * soft, 0.03);
          stab("keys", b, 8, chord.rh, 6, 0.46 * soft, 0.02);
        }
      } else if (!(outro && b >= 62)) {
        // Softer under the organ's replies so the two keyboards never blur.
        const soft = intro ? 0.82 : lift || hook ? 0.92 : 1;
        // Pushes: the next chord lands a 16th early and holds over the bar
        // line, every fourth bar in the first hook and the lift and on
        // every change in the last hook.
        const push =
          second &&
          !dropOut &&
          sectionOf(b + 1) === sec &&
          ((last && b % 2 === 1) || ((hook || lift) && b % 4 === 3));
        if (inBar === 6) {
          // The sus bar: two stabs, then the chord is tied over the bar line
          // so the 4th hangs into the resolution bar.
          stab("keys", b, 4, chord.rh, 2, 0.6 * soft);
          stab("keys", b, 7, chord.rh, 2, 0.46 * soft);
          stab("keys", b, 12, chord.rh, 5.5, 0.52 * soft, 0.02);
        } else if (inBar === 7 && !half) {
          // The resolution lands with the chop, then the chord comps on.
          stab("keys", b, 2, chord.rh, 3, 0.58 * soft);
          if (!dropOut) stab("keys", b, 10, chord.rh, 5, 0.56 * soft);
          else stab("keys", b, 10, chord.rh, 2, 0.5 * soft);
        } else if (!second) {
          if (!pushed) stab("keys", b, 4, chord.rh, 2, 0.6 * soft);
          stab("keys", b, 7, chord.rh, inBar === 2 ? 0.65 : 2, 0.46 * soft);
          if (!dropOut) stab("keys", b, 14, chord.rh, 2, 0.42 * soft);
        } else if (push) {
          // The organ owns the first half of the odd bars it answers in.
          if (!(lift || hook)) stab("keys", b, 3, chord.rh, 3, 0.56);
          stab("keys", b, 10, chord.rh, 3, 0.54 * soft);
          stab("keys", b, 15, next.rh, 6, 0.68 * soft);
        } else {
          if (!(lift || hook)) stab("keys", b, 3, chord.rh, 3, 0.56 * soft);
          if (!dropOut) stab("keys", b, 10, chord.rh, 5, 0.6 * soft);
        }
        pushed = push;
        // In the pocket and the outro the Rhodes top voice answers the chop
        // motif in the odd bars: a falling three-note reply in the rest.
        if ((sec === "Pocket" || outro) && second && inBar < 6) {
          const top = chord.rh[chord.rh.length - 1]!;
          hit("keys", b, 1, top + 5, 0.44 + jitter(0.03), 1);
          hit("keys", b, 2, top + 3, 0.38 + jitter(0.03), 1);
          hit("keys", b, 4, top, 0.42 + jitter(0.03), 2);
        }
      }
      if (outro && b === 62)
        stab("keys", b, 0, GM9.rh.concat(74), 30, 0.5, 0.04);

      // ---------- organ stabs ----------
      // The answer: three stabs in the first half of each odd bar, where the
      // chop tune rests; the middle stab lifts the top voice. The sus bar
      // (bar seven) keeps the organ out so the Rhodes suspension is heard.
      const organOn = lift || hook || half;
      // The last call pushes the organ a touch harder.
      const ov = last ? 0.05 : 0;
      const [r0, r1, r2] = chord.reply as [number[], number[], number[]];
      if (half && !tapeStop && inBar !== 6) {
        if (b === 42) {
          // The augmented answer, where the augmented tune rests.
          stab("organ", b, 0, r0, 2, 0.52, 0.004);
          stab("organ", b, 6, r1, 2, 0.56, 0.004);
          stab("organ", b, 10, r2, 4, 0.48, 0.004);
        } else if (b === 43) {
          // The chops' own answer lands on this downbeat.
        } else if (second) {
          // Two stabs on the downbeat, then the chops take the bar.
          stab("organ", b, 0, r0, 1.5, 0.5, 0.004);
          stab("organ", b, 2, r1, 1.5, 0.54, 0.004);
        } else {
          stab("organ", b, 0, chord.org, 2, 0.5, 0.004);
        }
      } else if (organOn && second && !tapeStop) {
        if (inBar === 7) {
          // The resolution bar: one stab, the chord the chop then sings.
          stab("organ", b, 0, r0, 1.5, 0.54 + ov, 0.004);
        } else {
          stab("organ", b, 0, r0, 1, 0.5 + ov, 0.004);
          stab("organ", b, 3, r1, 1, 0.56 + ov, 0.004);
          stab("organ", b, 5, r2, 2, 0.46 + ov, 0.004);
        }
      }
      if (hook && !second && inBar !== 6 && (last ? inBar !== 4 : inBar !== 2))
        // A single 16th in the gap the chops leave before their last note.
        stab("organ", b, 12, chord.org, 1, 0.42 + ov, 0.004);
      if (tapeStop) {
        stab("organ", b, 0, chord.org, 1, 0.52, 0.004);
        stab("organ", b, 12, chord.org.slice(0, 2), 4, 0.5, 0.004, TAPE);
      }
      if (outro && !second && b < 60) {
        // The afterglow hands the motif to the organ at half velocity: its
        // top voice alone, the Rhodes answering in the odd bars as before.
        for (const [step, , pitch, len, vel] of HOOK[inBar]!)
          hit("organ", b, step, pitch, vel * 0.46, len, SWING);
      }

      // ---------- vocal chops ----------
      const chops: Chop[] = [];
      if (last) {
        if (inBar === 7) chops.push(...LAST[7]!, ...climb());
        else chops.push(...LAST[inBar]!);
        if (inBar === 0 || inBar === 2) {
          // The last chop of the motif bars re-fires an octave up on the
          // last 16th: a pitched pickup into the next bar.
          const [step, syllable, pitch, , vel] = chops[chops.length - 1]!;
          chops[chops.length - 1] = [step, syllable, pitch, 2, vel];
          chops.push([
            15,
            syllable === "hold" ? "on" : "hold",
            pitch + 12,
            1,
            0.62,
          ]);
        }
      } else if (hook) {
        if (inBar === 7) chops.push(...HOOK[7]!, ...ramp(false));
        else chops.push(...HOOK[inBar]!);
      } else if (sec === "Pocket") {
        // The motif stated: calls on the even bars, the Rhodes answers in the
        // odd ones; bars seven and eight carry the sus and its resolution.
        if (inBar >= 6) chops.push(...HOOK[inBar]!);
        else if (!second) chops.push(...HOOK[inBar]!);
      } else if (lift || half) {
        if (inBar === 6)
          // Bb hangs over F13sus4 and holds across the bar line.
          chops.push(
            [2, "hold", 70, 3, 0.74],
            [6, "on", 65, 2, 0.66],
            [10, "hold", 70, 6, 0.78],
          );
        else if (inBar === 7)
          chops.push(
            [2, "on", 69, 3, 0.72],
            [6, "hold", 65, 1, 0.62],
            [8, "on", 67, 2, 0.66],
            ...(tapeStop ? [] : ramp(true)),
          );
        else if (half && inBar < 4) chops.push(...SWITCH_CHOPS[inBar]!);
        else if (half)
          // The riff augmented to 8ths: one arp bar across two bars.
          chops.push(
            ...chord.arp
              .slice(inBar === 4 ? 0 : 4, inBar === 4 ? 4 : 8)
              .map((pitch, i): Chop => [
                [4, 6, 12, 14][i]!,
                i % 2 ? "on" : "hold",
                pitch,
                2,
                i % 2 ? 0.64 : 0.7,
              ]),
          );
        else chops.push(...riff(chord, second));
      } else if (breakdown) {
        chops.push(...BREAK[inBar]!);
      } else if (outro) {
        // One fragment of the motif, then the tail.
        if (b === 60)
          chops.push([2, "hold", 74, 3, 0.6], [6, "on", 70, 2, 0.56]);
        if (b === 62)
          chops.push([2, "hold", 67, 4, 0.6], [10, "on", 74, 8, 0.58]);
      }
      if (intro && b === 6) chops.push([10, "hold", 74, 3, 0.6]);
      if (intro && b === 7) chops.push([13, "on", 70, 3, 0.64]);
      if (tapeStop) chops.push([12, "hold", 72, 4, 0.7]);
      // The pocket sings under the drop; the last call leans in.
      const lean =
        sec === "Pocket" ? -0.09 : breakdown ? -0.04 : last ? 0.08 : 0;
      for (const [step, syllable, pitch, len, vel0, swing] of chops) {
        const vel = vel0 + lean;
        const scoop: Partial<NoteInput> =
          len >= 3
            ? {
                bend: [
                  { at: 0, cents: -45 },
                  { at: 0.18, cents: 0 },
                ],
              }
            : {};
        const extra =
          tapeStop && step === 12
            ? TAPE
            : b === 62 && step === 10
              ? {
                  bend: [
                    { at: 0, cents: 0 },
                    { at: 0.7, cents: 0 },
                    { at: 1, cents: -400 },
                  ],
                }
              : scoop;
        hit(
          syllable,
          b,
          step,
          pitch,
          vel + jitter(0.03),
          len,
          swing ?? SWING,
          extra,
        );
      }

      // ---------- granular pad ----------
      const padOn =
        intro || breakdown || outro || hook || half || (lift && b >= 20);
      if (breakdown) {
        // Under the chain the cloud sings the hook motif in whole notes, the
        // second time resolving its G to F# with the cadence.
        s.note("grains", b, 0.5, BREAK_PAD[inBar]!, 3.4, 0.3);
      } else if (padOn && b % 2 === 0 && b < 62) {
        // Root and fifth as the cloud's dyad, so the chord reads even where
        // the sub is silent.
        const rootUp = ((((chord.root - 55) % 12) + 12) % 12) + 55;
        // The fifth sits above or below the root so the dyad stays under the
        // chops (G3..F4).
        const fifth = rootUp + 7 > 66 ? rootUp - 5 : rootUp + 7;
        const gain = intro || outro || last ? 0.5 : 0.36;
        s.note("grains", b, 0.5, rootUp, 7.4, gain);
        s.note("grains", b, 1, fifth, 6.9, gain * 0.8);
      }
      if (b === 62) {
        s.note("grains", b, 0.5, 55, 7.4, 0.5);
        s.note("grains", b, 1, 62, 6.9, 0.42);
      }

      // ---------- FX ----------
      if ([15, 23, 31, 39, 47, 55].includes(b))
        s.note("swell", b, 2, 55, 1.9, b === 47 ? 0.8 : 0.7);
      // One "on" syllable played backwards, sucking into the peak bar's entry.
      if (b === 53) s.note("swell", b, 1.25, 74, 0.7, 0.9);
      if (b === 38) s.note("fx", b, 0, 36, 7.8, 0.7);
      if (b === 22) s.note("fx", b, 0, 36, 7.8, 0.55);
      if (b === 46) s.note("fx", b, 0, 36, 7.6, 0.66);
    }
    return s.finish();
  },
};

/** The shaker plays every 16th once the groove is up. */
function busyShaker(sec: SectionName): boolean {
  return sec !== "Warm-up" && sec !== "Pocket" && sec !== "Switch-up";
}
