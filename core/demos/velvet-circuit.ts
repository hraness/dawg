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
  /** Short organ stab voicing in the gap between Rhodes and chops. */
  org: readonly number[];
  /** The organ answer's second stab: the same chord with its top voice lifted. */
  up: readonly number[];
}>;

const GM9: Chord = {
  name: "Gm9",
  root: 31,
  sev: 10,
  rh: [58, 62, 65, 69],
  org: [62, 65, 70],
  up: [62, 65, 72],
};
const EBMAJ9: Chord = {
  name: "Ebmaj9",
  root: 39,
  sev: 11,
  rh: [58, 62, 65, 67],
  org: [62, 67, 70],
  up: [62, 67, 72],
};
const CM9: Chord = {
  name: "Cm9",
  root: 36,
  sev: 10,
  rh: [58, 62, 63, 67],
  org: [62, 63, 67],
  up: [63, 67, 70],
};
/** The sus bar: G hangs over D before it falls to F# (a 4-3 at the cadence). */
const D7SUS: Chord = {
  name: "D7sus4(b9)",
  root: 38,
  sev: 10,
  rh: [57, 60, 63, 67],
  org: [60, 62, 67],
  up: [62, 67, 69],
};
const D7B9: Chord = {
  name: "D7(b9)",
  root: 38,
  sev: 10,
  rh: [57, 60, 63, 66],
  org: [60, 63, 66],
  up: [63, 66, 69],
};
const DM11: Chord = {
  name: "Dm11",
  root: 38,
  sev: 10,
  rh: [57, 60, 62, 67],
  org: [60, 62, 65],
  up: [62, 65, 67],
};
/** The lift's sus bar: Bb hangs over F before it falls to A. */
const F13SUS: Chord = {
  name: "F13sus4",
  root: 41,
  sev: 10,
  rh: [62, 63, 67, 70],
  org: [63, 65, 70],
  up: [65, 70, 72],
};
const F13: Chord = {
  name: "F13",
  root: 41,
  sev: 10,
  rh: [62, 63, 67, 69],
  org: [63, 65, 69],
  up: [65, 69, 72],
};

/** i9 - VImaj9 - iv9 - V7sus(b9) - V7(b9), two bars a chord; the top voice walks A G G G F#. */
const HOME = [GM9, GM9, EBMAJ9, EBMAJ9, CM9, CM9, D7SUS, D7B9] as const;
/** The climbing lift into each hook: iv9 - v11 - VImaj9 - VII13sus - VII13. */
const CLIMB = [CM9, CM9, DM11, DM11, EBMAJ9, EBMAJ9, F13SUS, F13] as const;

/**
 * The breakdown: a 7-6 chain over a sub that walks down G F Eb D, then a
 * 4-3 at the cadence. Each bar is the bass note, a three-note Rhodes
 * voicing whose top holds the suspension and lets it fall, and the chop
 * pitch singing the same line an octave up.
 */
const CHAIN: readonly Readonly<{
  bass: number;
  rh: readonly number[];
  chop: number;
}>[] = [
  { bass: 43, rh: [58, 62, 65], chop: 77 }, // Gm7: F is the 7th over G
  { bass: 43, rh: [58, 62, 63], chop: 75 }, // ...falls to Eb, the 6th
  { bass: 41, rh: [57, 60, 63], chop: 75 }, // F7: Eb is now the 7th over F
  { bass: 41, rh: [57, 60, 62], chop: 74 }, // ...falls to D
  { bass: 39, rh: [55, 58, 62], chop: 74 }, // Ebmaj7: D the 7th over Eb
  { bass: 39, rh: [55, 58, 60], chop: 72 }, // ...falls to C
  { bass: 38, rh: [55, 57, 60], chop: 67 }, // D7sus4: G hangs over D
  { bass: 38, rh: [54, 57, 60], chop: 66 }, // ...falls to F#
];

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
  const progression = name === "Lift" || name === "Switch-up" ? CLIMB : HOME;
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
    "pocket" | "hook" | "lift" | "half",
    readonly [readonly BassHit[], readonly BassHit[]]
  >
> = {
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
    [13, "on", 67, 3, 0.76],
  ],
  [
    [8, "hold", 70, 2, 0.66],
    [11, "on", 72, 2, 0.7],
    [14, "hold", 74, 1, 0.62],
    [15, "on", 74, 1, 0.7],
  ],
  [
    [2, "hold", 74, 3, 0.8],
    [6, "on", 70, 2, 0.72],
    [10, "hold", 67, 2, 0.72],
    [13, "on", 65, 3, 0.74],
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
    [13, "on", 67, 3, 0.74],
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
 * The lift riff: a percussive chop line on the chord's top organ tone and
 * the tone below it, strictly alternating slices. `jump` sends the "on"
 * answers down a fourth (a -5 pitched chop) in the half-time section.
 */
const riff = (chord: Chord, second: boolean, jump: boolean): Chop[] => {
  // The riff sits an octave over the organ's voicing: the chops lift clear of
  // the Rhodes and the stabs, and the +12 pitch is part of the tint.
  const t = chord.org[2]! + 12;
  const m = chord.org[1]! + 12;
  const o = jump ? m - 5 : m;
  return second
    ? [
        [6, "on", o, 1, 0.62],
        [8, "hold", t, 1, 0.64],
        [10, "on", m, 1, 0.62],
        [11, "hold", t, 1, 0.6],
        [13, "on", o, 2, 0.66],
      ]
    : [
        [2, "hold", t, 2, 0.7],
        [6, "on", m, 2, 0.64],
        [10, "hold", t, 1, 0.6],
        [11, "on", m, 1, 0.62],
        [13, "hold", t, 2, 0.7],
      ];
};

export const velvetCircuit: DemoDefinition = {
  info: demoInfo({
    id: "velvet-circuit",
    title: "Velvet Circuit",
    style: "UK garage",
    description:
      "A swung two-step pocket under a 'hold on' hook hocketed between two vocal slices, organ stabs answering in its rests, minor-ninth Rhodes that suspend before every turnaround and a sub that climbs while the chops fall; a half-time switch-up and a tape stop set up the last drop.",
    tempoBpm: 130,
    key: "Gm",
    bars: 64,
    highlightBar: 24,
    trackId: "hold",
    features: [
      "two-step swing",
      "vocal-chop hocket",
      "organ call and response",
      "Rhodes ninths with 4-3 suspensions",
      "contrary sub bass",
      "granular vowel pad",
      "half-time switch-up",
      "tape stop and retrigger ramps",
    ],
    arrangement: SECTIONS.map((name) => `${name} 8`),
    mixNotes: [
      "Kick and clap sit dead on the grid; hats, shaker, rims, bass and chops swing about 65% so the groove skips without smearing.",
      "The two syllable tracks never sound together: 'hold' and 'on' trade one tune, the organ's three-stab answer fills the first half of every second bar, and the Rhodes comps on the ands.",
      "The sub climbs to its octave while the chops fall and walks down the seventh while they rise; it slides into each chord change from an in-key approach tone and never doubles the kick.",
      "Suspensions carry the richness: a 4-3 in the Rhodes top voice before every turnaround, a 7-6 chain over the descending sub in the break, the chop line singing the same resolutions an octave up.",
      "Glitch on the phrase grid only: retrigger ramps with -5/+5/+12 jumps at phrase ends, DJ-filter flicks on single organ stabs, the half-time switch-up, and a tape stop plus a silent beat into the last drop.",
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
          [8, 0.84],
          [15.9, 0.84],
          [16, 0.9],
          [23.9, 0.9],
          [24, 1],
          [31.9, 1],
          [32, 0.8],
          [39.9, 0.86],
          [40, 0.95],
          [47.9, 0.95],
          [48, 1],
          [55.9, 1],
          [56, 0.9],
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
            ...flick(43, 5),
            ...flick(45, 3),
            ...flick(49, 3),
            ...flick(51, 0),
            ...flick(53, 5),
            [63, 0.5],
          ),
        },
      }),
    );
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
          fx: orbit,
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
          [48, 0.62],
          [55.9, 0.62],
          [56, 0.9],
        ),
        reverb: hall,
        fx: orbit,
      }),
    );
    s.track(
      voice("swell", "Reverse breath", "sampler", 0.22, {
        sampler: {
          mode: "keyed",
          voices: {
            ah: {
              ...bundledSampleRef("vowel-ah"),
              speed: -1,
              fit: true,
              fadeInTime: 0.15,
              fadeTime: 0.015,
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
    const row = (track: string, bar: number, pitch: number, grid: string) =>
      [...grid].forEach((ch, step) => {
        if (ch !== ".") hit(track, bar, step, pitch, Number(ch) / 10, 1);
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
        row("kick", b, 36, pattern);
      }

      // ---------- clap, snare, hats, rims (drums) ----------
      if (grooveOn) {
        const clapOn = !(intro && b < 4);
        if (clapOn)
          for (const step of half ? [8] : [4, 12]) {
            if (dropOut && step === 12) continue;
            const v = step === 12 || half ? 0.86 : 0.8;
            hit("drums", b, step, 39, v + jitter(0.03), 1, 0);
            hit(
              "drums",
              b,
              step,
              38,
              (step === 12 || half ? 0.56 : 0.5) + jitter(0.03),
              1,
              0,
            );
          }
        // Hats: open on the offbeat 8ths with a closed hat on the 16th before
        // most of them; busier closed 16ths from the Lift on, every 16th in
        // the last hook (the double-time lift).
        const busy = lift || hook || half || (outro && b < 60);
        for (let step = 0; step < 16; step++) {
          if (dropOut && step >= 12) continue;
          const open = half ? step === 6 || step === 14 : step % 4 === 2;
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
          if (before && !(step === 9 && second && !busy)) {
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
        // The last hook adds a soft ride on the beats for lift.
        if (last)
          for (const step of [0, 4, 8, 12]) {
            if (step === 0 && b === 48) continue;
            const v = step === 0 ? 0.3 : step === 8 ? 0.26 : 0.22;
            hit("drums", b, step, 51, v + jitter(0.03), 2, 0);
          }
      }
      // Crash on the big downbeats.
      if ([8, 24, 40, 48].includes(b))
        hit("drums", b, 0, 49, b === 48 || b === 24 ? 0.62 : 0.5, 8, 0);
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
          const accent = step % 4 === 2 ? 0.52 : step % 2 ? 0.28 : 0.36;
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
          s.note("bass", b, 0, low, 7.6, 0.4 + inBar * 0.05, {
            glide: b > 32 ? 0.12 : undefined,
          });
        }
      } else if (bassPlays(b)) {
        const cell = half
          ? BASS.half
          : lift
            ? BASS.lift
            : hook
              ? BASS.hook
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
        const link = CHAIN[inBar]!;
        stab("keys", b, 0, link.rh, inBar % 2 ? 14 : 15, 0.5, 0.03);
        if (inBar % 2 === 0 && inBar < 6)
          // A soft restrike on the "and" of three keeps the chain breathing.
          stab("keys", b, 10, link.rh.slice(0, 2), 4, 0.34, 0.02);
      } else if (half) {
        // Half-time: long chords, the sus held through bar seven's change.
        const soft = 0.88;
        if (inBar === 7) stab("keys", b, 2, chord.rh, 5, 0.56 * soft, 0.03);
        else stab("keys", b, 0, chord.rh, second ? 7 : 6, 0.56 * soft, 0.03);
        if (inBar === 6) stab("keys", b, 8, chord.rh, 9.5, 0.5 * soft, 0.02);
        else if (!tapeStop) stab("keys", b, 8, chord.rh, 6, 0.46 * soft, 0.02);
        else {
          stab("keys", b, 8, chord.rh, 4, 0.46 * soft, 0.02);
          stab("keys", b, 12, chord.rh, 4, 0.5, 0.02, TAPE);
        }
      } else if (!(outro && b >= 62)) {
        const soft = intro ? 0.82 : 1;
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
          stab("keys", b, 7, chord.rh, 2, 0.46 * soft);
          if (!dropOut) stab("keys", b, 14, chord.rh, 2, 0.42 * soft);
        } else if (push) {
          stab("keys", b, 3, chord.rh, 3, 0.56);
          stab("keys", b, 10, chord.rh, 3, 0.54);
          stab("keys", b, 15, next.rh, 6, 0.68);
        } else {
          stab("keys", b, 3, chord.rh, 3, 0.56 * soft);
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
      if (organOn && second && !tapeStop) {
        if (inBar === 7) {
          // The resolution chord, then a stab without the third: the chop
          // is singing F# (or A) at that moment and owns it.
          stab("organ", b, 0, chord.org, 1, 0.54, 0.004);
          stab(
            "organ",
            b,
            4,
            [chord.org[0]!, chord.org[1]!, chord.up[2]!],
            1,
            0.48,
            0.004,
          );
        } else {
          stab("organ", b, 0, chord.org, 1, 0.5, 0.004);
          stab("organ", b, 3, chord.up, 1, 0.56, 0.004);
          stab("organ", b, 5, chord.org, 2, 0.46, 0.004);
        }
      }
      if (organOn && !second && hook && inBar !== 6)
        // A single 16th in the gap the chops leave before their last note.
        stab("organ", b, 12, chord.org, 1, 0.42, 0.004);
      if ((lift || half) && !second)
        // A pickup into the answer bar.
        stab("organ", b, 15, chord.up, 1, 0.44, 0.004);
      if (tapeStop) {
        stab("organ", b, 0, chord.org, 1, 0.52, 0.004);
        stab("organ", b, 12, chord.org.slice(0, 2), 4, 0.5, 0.004, TAPE);
      }

      // ---------- vocal chops ----------
      const chops: Chop[] = [];
      if (hook) {
        if (inBar === 7) chops.push(...HOOK[7]!, ...ramp(last));
        else chops.push(...HOOK[inBar]!);
        if (last && !second && inBar !== 6) {
          // The last chop of each even bar echoes itself an octave up.
          const [step, syllable, pitch, , vel] = chops[chops.length - 1]!;
          chops[chops.length - 1] = [step, syllable, pitch, 2, vel];
          chops.push([15.5, "on", pitch + 12, 0.5, 0.5]);
        }
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
        else chops.push(...riff(chord, second, half));
      } else if (breakdown) {
        // The chain sung an octave up: long throws into the delay, the
        // syllables alternating with each suspension and its fall.
        const link = CHAIN[inBar]!;
        if (inBar % 2 === 0) chops.push([0, "hold", link.chop, 6, 0.64]);
        else chops.push([0, "on", link.chop, inBar === 7 ? 4 : 6, 0.6]);
        if (inBar === 3 || inBar === 5)
          // A pitched echo: the fall re-fired up an octave, then down a fourth.
          chops.push(
            [10, "hold", link.chop + 12, 1, 0.42],
            [13, "on", link.chop - 5, 2, 0.46],
          );
      } else if (outro) {
        if (b < 62 && !second && inBar < 5) chops.push(...HOOK[inBar]!);
        if (b === 62)
          chops.push([2, "hold", 67, 4, 0.6], [10, "on", 74, 8, 0.58]);
      }
      if (intro && b === 6) chops.push([10, "hold", 74, 3, 0.6]);
      if (intro && b === 7) chops.push([13, "on", 70, 3, 0.64]);
      if (tapeStop) chops.push([12, "hold", 70, 4, 0.7]);
      for (const [step, syllable, pitch, len, vel, swing] of chops) {
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
      if (padOn && b % 2 === 0 && b < 62) {
        // Root and fifth as the cloud's dyad, so the chord reads even where
        // the sub is silent; the chain keeps its own voicings.
        const rootUp = ((((chord.root - 55) % 12) + 12) % 12) + 55;
        const lo = breakdown ? CHAIN[inBar]!.rh[0]! : rootUp;
        // The fifth sits above or below the root so the dyad stays under the
        // chops (G3..F4).
        const fifth = rootUp + 7 > 66 ? rootUp - 5 : rootUp + 7;
        const hi = breakdown ? CHAIN[inBar]!.rh[2]! : fifth;
        const gain = intro || breakdown || outro ? 0.5 : 0.36;
        s.note("grains", b, 0.5, lo, 7.4, gain);
        s.note("grains", b, 1, hi, 6.9, gain * 0.8);
        if (breakdown && inBar % 2 === 0 && inBar < 6)
          // The chain's falling voice two bars later, an octave up.
          s.note("grains", b + 1, 0.5, CHAIN[inBar + 1]!.rh[2]! + 12, 3.4, 0.3);
      }
      if (b === 62) {
        s.note("grains", b, 0.5, 55, 7.4, 0.5);
        s.note("grains", b, 1, 62, 6.9, 0.42);
      }

      // ---------- FX ----------
      if ([15, 23, 31, 39, 47, 55].includes(b))
        s.note("swell", b, 2, 67, 1.9, b === 47 ? 0.8 : 0.7);
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
