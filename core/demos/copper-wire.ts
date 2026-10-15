/** Copper Wire: the jungle demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import {
  Composer,
  TPB,
  hall,
  lanes,
  orbit,
  preset,
  room,
  voice,
  type Phrase,
} from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

/*
 * Groove numbers from the style research: the Amen's 16th swing measures
 * about 1.2:1, so offbeat 16ths land about 8 ms (11 ticks at 170 BPM) late,
 * and ghost snares sit a few ticks further back while kick and backbeat stay
 * on the grid.
 */
const SWING = 11 / TPB;
const GHOST_LAG = 5 / TPB;

/** A tiny seeded generator for the shadow break's ghost placement. */
const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};

/**
 * One-bar drum cells shaped like the Amen's four bars and the edits jungle
 * producers made from them: k kick, s snare (digits under 5 are ghosts),
 * o open hat, m the machine kick that doubles the main kicks.
 */
type Cell = Readonly<{ k: string; s: string; m: string; o?: string }>;
const CELLS = {
  // Kick 1 and its 8th, the "and" of 3 doubled, snare 2 and 4, ghost pickups.
  a: { k: "9.7.......86....", s: "....9..3.3..9..4", m: "8.........6....." },
  // The beat-4 snare slides late, to the "and" of 4.
  c: { k: "9.7.......8.....", s: "....9..3.3...29.", m: "8.........6....." },
  // Ghost pickup, kick pair on the "and" of 1, late snare, open hat.
  d: {
    k: "..78......8.....",
    s: ".3..9..3.3....9.",
    o: "..........5.....",
    m: "..6.......7.....",
  },
  // Two-step: the snare anchors, the kick need not mark every beat.
  t: { k: "9.........8.....", s: "....9.2..3..9.3.", m: "8.........6....." },
  // Half-bar repeat: the first two beats played twice.
  r: { k: "9.7.....9.7.....", s: "....9..3....9..3", m: "8.......7......." },
  // Resequenced slices: a doubled snare on 3, the kicks pushed to the end.
  x: { k: "9.7.........8.7.", s: "....9..39..3...2", m: "8...........6..." },
  // The edit: the beat-2 snare doubled at a 16th, the classic chop.
  e: { k: "9.7.......86....", s: "....97.3.3..9..3", m: "8.........6....." },
  // Half time: kick 1, snare 3, ghosts still running at full speed.
  h: { k: "9.....6.........", s: "...2....9..3..2.", m: "9.....5........." },
  // Half time with the kick answered on the "and" of 3 and a ghost cluster.
  g: { k: "9.........7.....", s: "..2.....9.....32", m: "9..............." },
} as const satisfies Record<string, Cell>;
type CellName = keyof typeof CELLS;

const RIDE = "6.4.5.4.6.4.5.4.";
const HATS = ".2.1...2.1...2..";
const HATS_DOUBLE = "4232423242324232";
/** Two bars of break per unit; the shadow break swaps in on the odd units. */
type Unit = readonly [CellName, CellName];
const MOTOR: readonly Unit[] = [
  ["a", "a"],
  ["a", "c"],
  ["a", "d"],
  ["r", "c"],
  ["a", "a"],
  ["c", "d"],
  ["t", "x"],
  ["a", "d"],
];
const RUN: readonly Unit[] = [
  ["a", "c"],
  ["r", "d"],
  ["e", "x"],
  ["c", "d"],
];
const HALF: readonly Unit[] = [
  ["h", "h"],
  ["h", "g"],
  ["h", "h"],
  ["g", "g"],
];
const CHASE: readonly Unit[] = [
  ["a", "r"],
  ["c", "d"],
  ["e", "x"],
  ["a", "d"],
  ["a", "c"],
  ["x", "r"],
  ["t", "d"],
  ["c", "x"],
];
const LIVE: readonly Unit[] = [
  ["a", "x"],
  ["e", "d"],
  ["r", "c"],
  ["x", "d"],
];
const COAST: readonly Unit[] = [
  ["a", "c"],
  ["t", "d"],
  ["a", "c"],
];

/** i9, VI maj9, iv9, v (Bm11, or B7 flat 9 when it turns a phrase home). */
type Chord = "e" | "c" | "a" | "bm" | "b7";
/**
 * Rootless pad voicings over the sub. The top voice is its own slow line,
 * F sharp, G, A, F sharp, moving against the reese roots E, C, A, B: when the
 * bass falls the top rises. B7 arrives with the fourth (E) suspended; it
 * resolves to D sharp a bar later (4-3) and up to E when the phrase turns home.
 */
const PAD: Record<Chord, readonly number[]> = {
  e: [55, 59, 62, 66],
  c: [52, 59, 62, 67],
  a: [55, 60, 64, 69],
  bm: [54, 57, 62, 66],
  b7: [54, 57, 60, 64],
};
const PAD_HOME = [55, 59, 62, 64];
/** Rhodes shells above the pad's top voice, never sharing a pitch with it. */
const KEYS: Record<Chord, readonly number[]> = {
  e: [67, 71, 74],
  c: [71, 74, 76],
  a: [67, 71, 76],
  bm: [69, 74, 78],
  b7: [69, 72, 75],
};
/** Two-bar half-speed sub: a held root, then a pickup that glides on. */
const SUB: Record<Chord, Phrase> = {
  // E, then G and B walk up a step into C.
  e: [
    [0, 28, 5.5, 0.86],
    [6, 31, 0.9, 0.64],
    [7, 35, 1.1, 0.7],
  ],
  // C, then E and B step down into A.
  c: [
    [0, 36, 5.5, 0.84],
    [6, 40, 0.9, 0.62],
    [7, 35, 1.1, 0.68],
  ],
  // A, then E and D fall into B.
  a: [
    [0, 33, 5.5, 0.84],
    [6, 40, 0.9, 0.6],
    [7, 38, 1.1, 0.66],
  ],
  // B, then G and F sharp step down home to E.
  bm: [
    [0, 35, 5.5, 0.84],
    [6, 31, 0.9, 0.62],
    [7, 30, 1.1, 0.68],
  ],
  b7: [
    [0, 35, 5.5, 0.84],
    [6, 35, 0.9, 0.62],
    [7, 30, 1.1, 0.68],
  ],
};
/** The reese an octave up: re-struck roots, an answer, a slide home. */
const REESE: Record<Chord, Phrase> = {
  e: [
    [0, 40, 2.6, 0.8],
    [3, 40, 0.4, 0.56],
    [3.5, 47, 1.4, 0.66],
    [5.5, 43, 2.6, 0.7],
  ],
  c: [
    [0, 48, 2.6, 0.78],
    [3, 48, 0.4, 0.54],
    [3.5, 43, 1.4, 0.64],
    [5.5, 47, 2.6, 0.68],
  ],
  a: [
    [0, 45, 2.6, 0.78],
    [3, 45, 0.4, 0.54],
    [3.5, 40, 1.4, 0.64],
    [5.5, 48, 2.6, 0.68],
  ],
  bm: [
    [0, 47, 2.6, 0.78],
    [3, 47, 0.4, 0.54],
    [3.5, 50, 1.4, 0.64],
    [5.5, 42, 2.6, 0.68],
  ],
  b7: [
    [0, 47, 2.6, 0.78],
    [3, 47, 0.4, 0.54],
    [3.5, 51, 1.4, 0.64],
    [5.5, 42, 2.6, 0.68],
  ],
};
/** The motor's sub leaves room: root, a re-struck root, then the pickup. */
const sparse = (phrase: Phrase): Phrase => [
  [0, phrase[0]![1], 3, 0.84],
  [4.5, phrase[0]![1], 1.25, 0.72],
  phrase[phrase.length - 1]!,
];
/** The tape stop: the last beat of a note falls an octave. */
const DIVE = [
  { at: 0, cents: 0 },
  { at: 0.4, cents: 0 },
  { at: 1, cents: -1200 },
];

/*
 * The hook is one tune split between the vocal chop (V) and the chip (C), so
 * each plays what the other rests on. Felt at half speed over the 2-bar
 * chords: Em "E G B G | F# E", Cmaj9 the Rhodes answers, Am9 the same shape
 * a fourth up "A C E C | B A", B7 "D B A F# | A F#" with the chip's F sharp
 * stuttered into the next phrase, where the vocal's E resolves it by step.
 */
const HOOK_V: Record<number, Phrase> = {
  0: [
    [0, 64, 0.5, 0.7],
    [2, 71, 0.5, 0.74],
  ],
  1: [
    [0, 66, 0.45, 0.66],
    [1, 64, 1.4, 0.7],
  ],
  4: [
    [0, 69, 0.5, 0.7],
    [3, 72, 0.45, 0.68],
  ],
  5: [
    [0, 71, 0.45, 0.66],
    [1, 69, 1.4, 0.7],
  ],
  6: [
    [0, 74, 0.5, 0.72],
    [2, 69, 0.5, 0.68],
  ],
  7: [[0, 69, 0.6, 0.66]],
};
/** The second eight varies bar 1 (it ends on G, the third) and bar 7. */
const HOOK_V_VARY: Record<number, Phrase> = {
  1: [
    [0, 66, 0.45, 0.66],
    [1, 67, 1.4, 0.7],
  ],
  7: [
    [0, 69, 0.4, 0.66],
    [1, 66, 0.9, 0.62],
  ],
};
const HOOK_C: Record<number, Phrase> = {
  0: [
    [1, 79, 0.3, 0.58],
    [3, 79, 0.3, 0.54],
  ],
  4: [
    [1, 84, 0.3, 0.58],
    [2, 88, 0.3, 0.6],
  ],
  6: [
    [1, 83, 0.3, 0.58],
    [3, 78, 0.3, 0.56],
  ],
};
/** The chip's whole tune, for the octave-up double of the last chorus. */
const HOOK_C_FULL: Record<number, Phrase> = {
  0: [
    [0, 76, 0.3, 0.4],
    [2, 83, 0.3, 0.42],
  ],
  1: [
    [0, 78, 0.3, 0.38],
    [1, 76, 0.8, 0.4],
  ],
  4: [
    [0, 81, 0.3, 0.4],
    [3, 84, 0.3, 0.4],
  ],
  5: [
    [0, 83, 0.3, 0.38],
    [1, 81, 0.8, 0.4],
  ],
  6: [
    [0, 86, 0.3, 0.42],
    [2, 81, 0.3, 0.4],
  ],
};
/** Rhodes answer in the tune's rests over Cmaj9: rise B D E, fall D B G. */
const ANSWER: readonly [Phrase, Phrase] = [
  [
    [1.5, 71, 0.45, 0.5],
    [2.5, 74, 0.45, 0.52],
    [3.5, 76, 0.7, 0.56],
  ],
  [
    [0.5, 74, 0.45, 0.5],
    [1.5, 71, 0.5, 0.48],
    [3, 67, 0.9, 0.46],
  ],
];
/** The second time the answer lifts to F sharp (the lydian colour) first. */
const ANSWER_LIFT: Phrase = [
  [0.5, 78, 0.45, 0.52],
  [1.5, 76, 0.5, 0.5],
  [3, 71, 0.9, 0.48],
];
/**
 * The vacuum's 7-6 chain: the top voice holds while the bass steps down
 * E D C B under it, so each new bass note makes a seventh that resolves a bar
 * later to a sixth: D-C over E, C-B over D, B-A over C, A-G over B.
 */
const CHAIN: Phrase = [
  [0, 74, 4, 0.5],
  [4, 72, 8, 0.52],
  [12, 71, 8, 0.52],
  [20, 69, 8, 0.54],
  [28, 67, 3, 0.56],
];
const CHAIN_PAD: readonly (readonly number[])[] = [
  [55, 59, 64],
  [54, 57, 62],
  [52, 55, 60],
  [54, 59, 62],
];
/** The strings reprise over the coast: a pedal E under E C B7 E. */
const COAST_LINE: Phrase = [
  [0, 71, 4, 0.46],
  [4, 74, 4, 0.48],
  [8, 76, 6, 0.5],
  [14, 74, 2, 0.46],
  [16, 69, 8, 0.48],
  [24, 67, 7.5, 0.46],
];
/** Interlocking arps: the chip states Cmaj9 and the Rhodes follows a beat later an octave down. */
const ARP: readonly number[] = [76, 79, 83, 86, 79, 83, 86, 88];
/** Time-stretch pitches for the pitched break hits: up 7, up 12, down 5, up 5. */
const STRETCH: readonly number[] = [67, 72, 55, 64];
/** The half-time turn: the vocal alone states the tune at double length. */
const SLOW: readonly Phrase[] = [
  [
    [0, 64, 2.2, 0.66],
    [4, 71, 2.2, 0.7],
  ],
  [
    [0, 66, 2.2, 0.64],
    [4, 64, 3.2, 0.66],
  ],
  [
    [0, 69, 2.2, 0.66],
    [4, 72, 2.2, 0.68],
  ],
  [
    [0, 74, 2.2, 0.7],
    [4, 66, 2.4, 0.66],
  ],
];

/** Bars 72 to 79 resolve E, C, B7, E instead of continuing the cycle. */
function chordAt(bar: number): Chord {
  const degree =
    bar >= 72
      ? (["e", "c", "b", "e"] as const)[Math.floor((bar - 72) / 2)]!
      : (["e", "c", "a", "b"] as const)[Math.floor(bar / 2) % 4]!;
  if (degree !== "b") return degree;
  const turn = bar % 16 >= 14 || bar === 70 || bar === 71 || bar >= 72;
  return turn ? "b7" : "bm";
}

export const copperWire: DemoDefinition = {
  info: demoInfo({
    id: "copper-wire",
    title: "Copper Wire",
    style: "Jungle",
    description:
      "Two breaks hocket, one re-sliced every two bars and a shadow break playing the gaps, over a reese that moves against a slow string top line; a vocal chop and a chip split one hook, Rhodes answers in its rests, a 7-6 chain falls through the breakdown, and the drop returns from a crushed, silent beat.",
    tempoBpm: 170,
    key: "Em",
    bars: 80,
    highlightBar: 48,
    trackId: "break",
    features: [
      "two break voices hocketing, re-sequenced every two bars",
      "vocal chop and chip pluck splitting one singable hook",
      "7-6 suspension chain over a descending bass in the breakdown",
      "half-time turn after a tape stop; crush sweep and a silent beat before the second drop",
      "interlocking chip and Rhodes arpeggios in canon at the peak",
      "time-stretch pitch jumps and reverse swells on break hits",
    ],
    arrangement: [
      "Wire up 8",
      "Motor 16",
      "First run 16",
      "Vacuum 8",
      "Chase 16",
      "Live wire 8",
      "Coast 8",
    ],
    mixNotes: [
      "The main break (left) is authored from Amen-shaped cells on a synthesized kit with the Amen's measured 1.2:1 swing; the shadow break (right, high-passed) plays ghost 16ths where the main rests and takes the back half of every fourth bar.",
      "The sub carries the fundamental and ducks under the machine kick; the reese sits an octave up with a slow detune and a low-pass that opens across each run. The vacuum has no sub, only the reese stepping down E D C B under the suspensions.",
      "Registers are kept apart: sub 28-40, reese 40-52 (down to B1 in the vacuum, where it is the only bass), pad 52-69 with a top line that climbs to D5 in the vacuum and E5 at the end, vocal chop 64-74, Rhodes 64-78, chip 76-88. The crush on the break is clean everywhere except the last two bars of the vacuum.",
      "Pitched break hits are a tape-struck sample with a falling rate, jumping +7, +12, -5 and +4 semitones; reverse swells of the same sample lead into phrase downbeats.",
    ],
  }),
  build() {
    const s = new Composer(copperWire.info);
    for (const [name, start, bars] of [
      ["Wire up", 0, 8],
      ["Motor", 8, 16],
      ["First run", 24, 16],
      ["Vacuum", 40, 8],
      ["Chase", 48, 16],
      ["Live wire", 64, 8],
      ["Coast", 72, 8],
    ] as const)
      s.section(name, start, bars);
    s.track(
      voice("break", "Wire break", "kit", 0.7, {
        kit: "breaks",
        pan: -0.15,
        filter: { type: "hpf", cutoff: 40, resonance: 0.2 },
        filterAutomation: lanes(
          [0, 1500],
          [4, 1100],
          [7.75, 380],
          [8, 40],
          [43.9, 40],
          [44, 700],
          [47.5, 220],
          [48, 40],
          [76, 40],
          [77.9, 700],
          [78, 40],
        ),
        fx: { crush: { bits: 16, coarse: 1, mix: 0 } },
        fxAutomation: {
          "crush-bits": lanes([0, 16], [46, 16], [47.7, 4.5], [47.75, 16]),
          "crush-mix": lanes(
            [0, 0],
            [46, 0],
            [46.05, 0.3],
            [47.7, 0.9],
            [47.75, 0],
          ),
        },
        reverb: { mix: 0.07, size: 0.22, fade: 0.5 },
        humanize: { timing: 3, velocity: 6, seed: 170 },
      }),
    );
    s.track(
      voice("break2", "Shadow break", "kit", 0.5, {
        kit: "acoustic",
        pan: 0.3,
        filter: { type: "hpf", cutoff: 170, resonance: 0.25 },
        reverb: { mix: 0.1, size: 0.3, fade: 0.6 },
        humanize: { timing: 4, velocity: 8, seed: 71 },
      }),
    );
    s.track(
      voice("kick", "Machine weight", "kit", 0.38, {
        kit: "syn808",
        fx: { duck: { orbit: 2, depth: 0.42, attack: 0.08 } },
      }),
    );
    s.track(
      preset("sub", "Sub weight", "sub-sine", 0.5, {
        fx: orbit,
        glide: { time: 0.07, mode: "legato" },
        // The last low E fades under the strings instead of stopping.
        volumeAutomation: lanes([78, 1], [79.7, 0.15]),
      }),
    );
    s.track(
      preset("bass", "Reese current", "reese", 0.4, {
        filter: { cutoff: 900, resonance: 0.15 },
        fx: orbit,
        glide: { time: 0.11, mode: "legato" },
        filterAutomation: lanes(
          [16, 420],
          [23.9, 1300],
          [24, 1600],
          [31, 2600],
          [31.9, 900],
          [32, 700],
          [39, 1400],
          [40, 380],
          [47.7, 1500],
          [48, 2800],
          [63, 3600],
          [64, 3000],
          [71, 4200],
          [72, 1800],
          [79, 300],
        ),
        // Slow detune: the saws beat harder as each run builds.
        fxAutomation: {
          "synth-detune": lanes(
            [0, 0.12],
            [31, 0.3],
            [32, 0.16],
            [40, 0.1],
            [63, 0.34],
            [71, 0.4],
            [72, 0.16],
          ),
        },
        // The reese creeps in under the vacuum and opens for the drop.
        volumeAutomation: lanes(
          [39.9, 1],
          [40, 0.4],
          [47.7, 0.9],
          [48, 1],
          [71.9, 1],
          [79, 0.35],
        ),
      }),
    );
    s.track(
      preset("pad", "Indigo bed", "string-pad", 0.3, {
        reverb: hall,
        fx: orbit,
        volumeAutomation: lanes(
          [0, 0.55],
          [7.5, 0.85],
          [24, 0.8],
          [40, 1],
          [47.7, 1],
          [48, 0.72],
          [64, 0.8],
          [72, 0.9],
          [77, 0.9],
          [79.75, 0.45],
        ),
      }),
    );
    s.track(
      preset("keys", "Rhodes answers", "rhodes", 0.24, {
        pan: -0.26,
        delay: { beats: 0.75, feedback: 0.38, mix: 0.26, pingpong: true },
        reverb: room,
        fx: orbit,
        humanize: { timing: 6, velocity: 9, seed: 31 },
      }),
    );
    s.track(
      voice("chop", "Up fragments", "sampler", 0.45, {
        pan: 0.12,
        // Natural-speed syllable cut at the note's end, pitched by key only.
        sampler: {
          mode: "keyed",
          voices: {
            up: {
              ...bundledSampleRef("stay-up"),
              begin: 0.25,
              end: 0.5,
              fadeTime: 0.012,
              fadeInTime: 0.003,
            },
          },
        },
        filter: { type: "hpf", cutoff: 230, resonance: 0.2 },
        delay: { beats: 0.75, feedback: 0.2, mix: 0.16, pingpong: true },
        reverb: room,
        humanize: { timing: 5, velocity: 6, seed: 11 },
      }),
    );
    s.track(
      preset("chip", "Chip echo", "square-lead", 0.17, {
        pan: -0.2,
        filter: { type: "hpf", cutoff: 400, resonance: 0.1 },
        reverb: room,
        fx: orbit,
        humanize: { timing: 3, velocity: 5, seed: 5 },
      }),
    );
    s.track(
      voice("stretch", "Stretched hits", "sampler", 0.42, {
        pan: 0.08,
        sampler: {
          mode: "keyed",
          voices: {
            hit: {
              ...bundledSampleRef("tape-hit"),
              accelerate: -0.55,
              fadeTime: 0.01,
            },
          },
        },
        filter: { type: "hpf", cutoff: 300, resonance: 0.2 },
        reverb: { mix: 0.12, size: 0.3, fade: 0.7 },
      }),
    );
    s.track(
      voice("swell", "Reverse swells", "sampler", 0.3, {
        pan: -0.08,
        sampler: {
          mode: "keyed",
          voices: {
            rev: { ...bundledSampleRef("tape-hit"), speed: -1, fadeTime: 0.02 },
          },
        },
        reverb: { mix: 0.18, size: 0.4, fade: 0.9 },
      }),
    );
    s.track(
      voice("glass", "Signal glass", "sampler", 0.26, {
        pan: 0.36,
        sampler: {
          mode: "keyed",
          voices: { glass: bundledSampleRef("glass-hit") },
        },
        delay: { beats: 0.75, feedback: 0.32, mix: 0.2, pingpong: true },
        humanize: { timing: 4, velocity: 12, seed: 7 },
      }),
    );
    s.track(
      voice("rise", "Noise marker", "sampler", 0.2, {
        sampler: {
          mode: "keyed",
          voices: {
            rise: { ...bundledSampleRef("riser"), fit: true, fadeTime: 0.02 },
          },
        },
        pan: -0.1,
      }),
    );

    const hits = (
      track: string,
      bar: number,
      pitch: number,
      grid: string,
      gain = 1,
    ): void =>
      [...grid].forEach((hit, i) => {
        if (hit === ".") return;
        const ghost = pitch === 38 && Number(hit) < 5;
        s.note(
          track,
          bar,
          i / 4 + (i % 2 ? SWING : 0) + (ghost ? GHOST_LAG : 0),
          pitch,
          0.13,
          Math.min(1, (Number(hit) / 10) * gain),
        );
      });
    const roll = (
      bar: number,
      from: number,
      to: number,
      step: number,
      v0: number,
      v1: number,
      track = "break",
    ): void => {
      const count = Math.round((to - from) / step);
      for (let i = 0; i < count; i++)
        s.note(
          track,
          bar,
          from + i * step,
          38,
          step * 0.8,
          v0 + ((v1 - v0) * i) / Math.max(1, count - 1),
        );
    };
    const cut = (grid: string, from: number, until: number) =>
      [...grid]
        .map((hit, i) => (i / 4 >= from && i / 4 < until ? hit : "."))
        .join("");
    const drums = (
      bar: number,
      name: CellName,
      gain: number,
      opts: { until?: number; ride?: number; hats?: boolean; machine?: number },
    ): void => {
      const cell: Cell = CELLS[name];
      const until = opts.until ?? 4;
      hits("break", bar, 36, cut(cell.k, 0, until), gain);
      hits("break", bar, 38, cut(cell.s, 0, until), gain);
      if (cell.o) hits("break", bar, 46, cut(cell.o, 0, until), gain);
      if (opts.ride)
        hits("break", bar, 51, cut(RIDE, 0, until), gain * opts.ride);
      if (opts.hats) hits("break", bar, 42, cut(HATS, 0, until), gain);
      if (opts.machine)
        hits("kick", bar, 36, cut(cell.m, 0, until), opts.machine);
    };
    // The shadow break plays the 16ths the main break rests on: ghost
    // snares between the beats, now and then a kick pickup, from a seeded
    // draw so no two bars match.
    const rnd = seeded(1994);
    const shadow = (
      bar: number,
      name: CellName,
      density: number,
      opts: { until?: number; hats?: boolean } = {},
    ): void => {
      const cell: Cell = CELLS[name];
      const until = opts.until ?? 4;
      let ghosts = "",
        kicks = "";
      for (let i = 0; i < 16; i++) {
        const free = cell.k[i] === "." && cell.s[i] === "." && i / 4 < until;
        const roll = rnd();
        ghosts +=
          free && i % 4 !== 0 && roll < density
            ? String(2 + Math.floor(rnd() * 2))
            : ".";
        kicks +=
          free && (i === 10 || i === 14 || i === 6) && roll > 1 - density * 0.4
            ? "6"
            : ".";
      }
      hits("break2", bar, 38, ghosts);
      hits("break2", bar, 36, kicks);
      if (opts.hats) hits("break2", bar, 42, cut(HATS_DOUBLE, 0, until), 0.55);
    };
    // The swap: the shadow break takes the back half of the bar at full
    // weight with a different cell while the main break rests.
    const swap = (bar: number, name: CellName, from: number, gain = 0.95) => {
      const cell: Cell = CELLS[name];
      hits("break2", bar, 36, cut(cell.k, from, 4), gain);
      hits("break2", bar, 38, cut(cell.s, from, 4), gain);
      hits("break2", bar, 51, cut(RIDE, from, 4), gain * 0.8);
    };
    const strum = (
      track: string,
      bar: number,
      beat: number,
      pitches: readonly number[],
      length: number,
      velocity: number,
    ): void =>
      pitches.forEach((pitch, i) =>
        s.note(
          track,
          bar,
          beat + i * 0.02,
          pitch,
          length,
          velocity * (i === pitches.length - 1 ? 1 : 0.86),
        ),
      );
    const reese = (bar: number, phrase: Phrase, lift = 0, dive = false) =>
      phrase.forEach(([beat, pitch, length, velocity = 0.7], i) => {
        const last = i === phrase.length - 1;
        s.note(
          "bass",
          bar,
          beat,
          pitch + (i === 2 && pitch + lift <= 60 ? lift : 0),
          dive && last ? 2.3 : length,
          velocity,
          dive && last ? { bend: DIVE } : {},
        );
      });
    /** Pad chord with the 4-3 on B7: E held a bar, then D sharp. */
    const pad = (
      bar: number,
      chord: Chord,
      home: boolean,
      velocity: number,
    ) => {
      const start = bar === 0 ? 0 : -0.5;
      if (chord !== "b7") {
        strum("pad", bar, start, home ? PAD_HOME : PAD[chord], 8.3, velocity);
        return;
      }
      strum("pad", bar, start, PAD.b7.slice(0, 3), 8.3, velocity);
      s.note("pad", bar, start, 64, 4.4, velocity);
      s.note("pad", bar + 1, 0, 63, 3.4, velocity * 1.04);
    };
    // A two-bar unit of break: the main cells, the shadow's ghosts, and on
    // the odd units a half-bar swap. The last bar of the unit may be cut
    // short for a roll.
    const unit = (
      bar: number,
      cells: Unit,
      index: number,
      gain: number,
      opts: {
        ride?: number;
        hats?: boolean;
        machine?: number;
        density?: number;
        lastUntil?: number;
        doubleHats?: boolean;
      },
    ) => {
      const density = opts.density ?? 0.3;
      const swapHere = index % 2 === 1 && (opts.lastUntil ?? 4) === 4;
      drums(bar, cells[0], gain, {
        ride: opts.ride,
        hats: opts.hats,
        machine: opts.machine,
      });
      shadow(bar, cells[0], density, { hats: opts.doubleHats });
      drums(bar + 1, cells[1], gain, {
        ride: opts.ride,
        hats: opts.hats,
        machine: opts.machine,
        until: swapHere ? 2 : opts.lastUntil,
      });
      if (swapHere) {
        shadow(bar + 1, cells[1], density, { until: 2, hats: opts.doubleHats });
        swap(bar + 1, index % 4 === 1 ? "t" : "x", 2, gain * 0.95);
        if (opts.machine)
          hits("kick", bar + 1, 36, cut(CELLS.x.m, 2, 4), opts.machine);
      } else
        shadow(bar + 1, cells[1], density, {
          until: opts.lastUntil,
          hats: opts.doubleHats,
        });
    };
    /** Pitched break hit: a stretched snare on the late-snare slot. */
    let stretchIndex = 0;
    const stretched = (bar: number, beat: number, velocity = 0.56) => {
      s.note(
        "stretch",
        bar,
        beat,
        STRETCH[stretchIndex % STRETCH.length]!,
        0.5,
        velocity,
      );
      stretchIndex += 1;
    };
    const hookV = (bar: number, p: number, vary: boolean) => {
      const phrase = (vary && HOOK_V_VARY[p]) || HOOK_V[p];
      if (phrase) s.phrase("chop", bar, phrase);
      // The tape stop into the half-time turn: the vocal's last A falls an
      // octave over the beat before bar 32.
      if (bar === 31) s.note("chop", 31, 1, 66, 2.6, 0.64, { bend: DIVE });
    };
    const hookC = (bar: number, p: number, full: boolean) => {
      if (HOOK_C[p]) s.phrase("chip", bar, HOOK_C[p]!);
      if (full && HOOK_C_FULL[p]) s.phrase("chip", bar, HOOK_C_FULL[p]!);
      if (p === 7) {
        // The stutter: the F sharp re-fired as 32nds, ramping up, that the
        // next bar's E (vocal) and G (chip) resolve by step.
        for (let i = 0; i < 8; i++)
          s.note("chip", bar, 1.5 + i / 8, 78, 0.1, 0.3 + i * 0.045);
      }
    };

    for (let b = 0; b < 80; b++) {
      const chord = chordAt(b);
      // Drums: filtered intro, Amen units with the shadow break, rolls,
      // the half-time turn, the vacuum's thin half-time, and the coast.
      if (b < 8) {
        drums(b, (["a", "c", "a", "d"] as const)[b % 4]!, b < 4 ? 0.72 : 0.85, {
          ride: 0.9,
          until: b === 7 ? 2 : 4,
        });
        if (b >= 4) shadow(b, (["a", "c", "a", "d"] as const)[b % 4]!, 0.2);
        if (b === 7) {
          roll(7, 2, 3, 0.25, 0.32, 0.55);
          roll(7, 3, 4, 0.125, 0.5, 0.92);
        }
      } else if (b < 24) {
        if (b % 2 === 0) {
          const i = (b - 8) / 2;
          // The raw break and its shadow carry the first eight bars; the
          // machine kick locks in with the reese at bar 16.
          unit(b, MOTOR[i]!, i, 1, {
            ride: 1,
            machine: b >= 16 ? 0.85 : 0,
            density: b < 16 ? 0.22 : 0.3,
            lastUntil: b === 14 ? 3 : b === 22 ? 2 : 4,
          });
        }
        if (b === 15) roll(15, 3, 4, 0.25, 0.4, 0.75);
        if (b === 23) {
          roll(23, 2, 3, 0.25, 0.35, 0.6);
          roll(23, 3, 4, 0.125, 0.55, 0.98);
          s.note("swell", 23, 2.7, 60, 1.3, 0.5);
        }
        if (b === 19 || b === 21) stretched(b, 3.75, 0.5);
      } else if (b < 32) {
        if (b % 2 === 0) {
          const i = (b - 24) / 2;
          unit(b, RUN[i]!, i, 1, {
            ride: 1.05,
            machine: 0.85,
            density: 0.34,
            lastUntil: b === 30 ? 3 : 4,
          });
        }
        if (b % 4 === 1) stretched(b, 3.75);
        if (b === 27) stretched(27, 1.5, 0.5);
        if (b === 31) {
          // Into the half-time turn: a 32nd roll and the tape stop.
          roll(31, 3, 4, 0.125, 0.4, 0.9);
          s.note("swell", 31, 2.7, 60, 1.3, 0.5);
        }
      } else if (b < 40) {
        // The half-time turn: kick 1, snare 3, the same bass underneath,
        // ghosts and the ride still at full speed.
        if (b % 2 === 0) {
          const i = (b - 32) / 2;
          unit(b, HALF[i]!, i, 1, {
            ride: 0.85,
            machine: 0.95,
            density: 0.26,
            lastUntil: b === 38 ? 3 : 4,
          });
        }
        if (b === 35) stretched(35, 2.75, 0.5);
        if (b === 39) {
          roll(39, 3, 4, 0.125, 0.4, 0.86);
          s.note("swell", 39, 2.7, 60, 1.3, 0.5);
        }
      } else if (b < 48) {
        // Vacuum: no kick track for eight bars. The filtered break returns
        // at 44 in half time; the crush eats it over 46 and 47 and the last
        // beat of 47 is silent before the drop.
        if (b >= 44) {
          drums(b, b % 2 ? "g" : "h", 0.8, {
            ride: 0.7,
            until: b === 47 ? 1 : 4,
          });
          shadow(b, b % 2 ? "g" : "h", 0.3, { until: b === 47 ? 1 : 4 });
        }
        if (b === 47) {
          roll(47, 1, 2, 0.25, 0.35, 0.55);
          roll(47, 2, 2.5, 0.125, 0.5, 0.8);
          roll(47, 2.5, 3, 0.0625, 0.8, 1);
        }
      } else if (b < 64) {
        if (b % 2 === 0) {
          const i = (b - 48) / 2;
          unit(b, CHASE[i]!, i, 1, {
            ride: 1.05,
            hats: true,
            machine: 0.85,
            density: 0.36,
            lastUntil: b === 54 ? 3 : b === 62 ? 2 : 4,
            doubleHats: b >= 60,
          });
        }
        if (b % 4 === 2) hits("break", b, 37, "..3....2.3....3.");
        if (b % 4 === 1) stretched(b, 3.75);
        if (b === 51 || b === 59) stretched(b, 1.75, 0.5);
        if (b === 55) {
          roll(55, 3, 4, 0.125, 0.4, 0.8);
          s.note("swell", 55, 2.7, 60, 1.3, 0.46);
        }
        if (b === 63) {
          roll(63, 2, 3, 0.25, 0.35, 0.6);
          roll(63, 3, 4, 0.125, 0.55, 1);
          s.note("swell", 63, 2.7, 60, 1.3, 0.52);
        }
      } else if (b < 72) {
        if (b % 2 === 0) {
          const i = (b - 64) / 2;
          unit(b, LIVE[i]!, i, 1, {
            ride: 1.1,
            hats: true,
            machine: 0.9,
            density: 0.4,
            lastUntil: b === 66 ? 3 : b === 70 ? 1 : 4,
            doubleHats: true,
          });
        }
        if (b % 4 === 1) stretched(b, 3.75, 0.6);
        if (b === 67)
          for (const [beat, pitch, velocity] of [
            [3, 50, 0.62],
            [3.25, 48, 0.66],
            [3.5, 47, 0.72],
            [3.75, 45, 0.8],
          ] as const)
            s.note("break", 67, beat, pitch, 0.2, velocity);
        if (b === 71) {
          // The glitch fill: 32nds on the main break, the stretched hit
          // ratcheting up 2, 4, 7 and 12 semitones in the last beat.
          roll(71, 1, 2, 0.25, 0.3, 0.5);
          roll(71, 2, 3, 0.125, 0.45, 0.85);
          roll(71, 3, 4, 0.125, 0.5, 1, "break2");
          for (const [i, pitch] of [60, 62, 64, 67, 72].entries())
            s.note("stretch", 71, 3 + i * 0.2, pitch, 0.18, 0.5 + i * 0.08);
        }
      } else if (b < 78) {
        if (b % 2 === 0) {
          const i = (b - 72) / 2;
          unit(b, COAST[i]!, i, b < 76 ? 0.9 : 0.7, {
            ride: 0.9,
            machine: b < 76 ? 0.7 : 0,
            density: 0.24,
            lastUntil: b === 76 ? 3 : 4,
          });
        }
        if (b === 77) roll(77, 3, 4, 0.125, 0.3, 0.72);
      } else if (b === 78) {
        // The last word: kick, crash and the low E, then everything rings out.
        s.note("break", b, 0, 36, 0.25, 0.86);
        s.note("break", b, 0, 49, 2, 0.58);
        s.note("kick", b, 0, 36, 0.25, 0.8);
      }
      if ([8, 24, 32, 48, 56, 64, 68].includes(b))
        s.note("break", b, 0, 49, 1, 0.62);
      if (b === 72) s.note("break", b, 0, 49, 1, 0.45);

      // Harmony moves every two bars, at half speed against the break.
      if (b % 2 === 0) {
        const home = chord === "e" && b >= 2 && chordAt(b - 2) === "b7";
        if (b >= 40 && b < 48) {
          // The vacuum: three-note pad under the suspension chain, the
          // reese stepping down E D C B, no sub until the drop.
          strum(
            "pad",
            b,
            -0.5,
            CHAIN_PAD[(b - 40) / 2]!,
            b === 46 ? 7.4 : 8.3,
            0.46,
          );
          if (b === 40)
            for (const [beat, pitch, length, velocity = 0.5] of CHAIN)
              s.note("pad", 40, beat, pitch, length, velocity, {
                vibrato: { rate: 5.2, depth: 14, delay: 0.6 },
              });
          s.note(
            "bass",
            b,
            0,
            [40, 38, 36, 35][(b - 40) / 2]!,
            b === 46 ? 7.4 : 7.9,
            0.72,
          );
        } else pad(b, chord, home, b >= 72 ? 0.42 : 0.38);
        if (b === 72)
          for (const [beat, pitch, length, velocity = 0.5] of COAST_LINE)
            s.note("pad", 72, beat, pitch, length, velocity, {
              vibrato: { rate: 5.2, depth: 12, delay: 0.5 },
            });
        // Sub: half-speed roots that glide on, sparse for the first eight
        // bars of the motor, a pedal E under the coast, one last low E.
        if (b >= 72 && b < 78)
          s.note("sub", b, 0, 28, b === 76 ? 7.2 : 7.8, 0.74);
        else if (b === 78) s.note("sub", b, 0, 28, 7.6, 0.8);
        else if (b >= 8 && b < 16) s.phrase("sub", b, sparse(SUB[chord]));
        else if (b >= 16 && b < 72 && (b < 40 || b >= 48))
          s.phrase("sub", b, SUB[chord]);
        // Reese from the second half of the motor on; it dives into the
        // half-time turn at 31 and lifts an octave for the last answers.
        if ((b >= 16 && b < 40) || (b >= 48 && b < 72))
          reese(
            b,
            REESE[chord],
            (b >= 60 && b < 64) || b >= 68 ? 12 : 0,
            b === 30 || b === 70,
          );
        else if (b >= 72 && b < 78)
          s.note("bass", b, 0, REESE[chord][0]![1], b === 76 ? 7.2 : 7.8, 0.66);
        else if (b === 78) s.note("bass", b, 0, 40, 5, 0.6);
      }

      // Rhodes shells behind the beat, except where the Rhodes answers the
      // hook (bars 2 and 3 of each eight) or plays the arp canon.
      const runs = (b >= 24 && b < 32) || (b >= 48 && b < 72);
      const p = b % 8;
      if (runs && p !== 2 && p !== 3 && b % 2 === 0) {
        strum("keys", b, 1.5, KEYS[chord], 0.45, 0.5);
        strum("keys", b, 4.75, KEYS[chord], 0.4, 0.42);
      }
      if (b >= 32 && b < 40 && b % 2 === 0)
        strum("keys", b, 0.5, KEYS[chord], 3.2, 0.4);
      if (b >= 72 && b < 78 && b % 2 === 0)
        strum("keys", b, 1.5, KEYS[chord], 0.5, 0.44);

      // The hook: vocal and chip hocket in the runs, the Rhodes answer in
      // bars 2-3, the arp canon at 58 and 66, the full tune doubled at the
      // peak.
      if (runs) {
        const vary = b >= 56 && b < 64;
        hookV(b, p, vary);
        hookC(b, p, b >= 64);
        if (p === 2 || p === 3) {
          if (b === 58 || b === 59 || b === 66 || b === 67) {
            const start = (b % 2) * 4;
            for (let i = 0; i < 4; i++) {
              s.note("chip", b, i, ARP[start + i]!, 0.3, 0.5);
              s.note("keys", b, i + 1, ARP[start + i]! - 12, 0.6, 0.46);
            }
          } else
            s.phrase(
              "keys",
              b,
              p === 2 ? ANSWER[0] : vary ? ANSWER_LIFT : ANSWER[1],
            );
        }
      }
      // The half-time turn: the vocal alone states the tune at double length.
      if (b >= 32 && b < 40 && b % 2 === 0)
        s.phrase("chop", b, SLOW[(b - 32) / 2]!);
      // Teasers and fragments outside the runs.
      if (b === 5) s.note("chip", b, 1.5, 76, 0.4, 0.4);
      if (b === 5) s.note("chip", b, 2.5, 83, 0.6, 0.42);
      if (b === 22)
        s.phrase("chop", b, [
          [2, 64, 0.5, 0.6],
          [3, 71, 0.8, 0.62],
        ]);
      // Vacuum fragments sit a third under the suspension chain: the fifth
      // of each chord, then a stuttered F sharp the drop's E resolves.
      if (b === 42 || b === 44)
        s.note("chop", b, 1, b === 42 ? 69 : 67, 1.6, 0.5);
      if (b === 46) s.note("chop", b, 1, 66, 1.6, 0.52);
      if (b === 47)
        for (let i = 0; i < 8; i++)
          s.note("chop", 47, 0.5 + i / 8, 66, 0.1, 0.34 + i * 0.05);
      if (b === 76)
        s.phrase("chop", b, [
          [0, 74, 0.5, 0.56],
          [2, 71, 0.5, 0.54],
        ]);
      if (b === 77)
        s.phrase("chop", b, [
          [0, 69, 0.5, 0.52],
          [1, 66, 1.2, 0.5],
        ]);
      if (b === 78) {
        s.note("chop", 78, 0, 64, 2.4, 0.56);
        // The last chip fragment: the tune's opening as a slow arpeggio,
        // the final note tape-stopped.
        for (const [beat, pitch, length, velocity] of [
          [1, 76, 0.5, 0.4],
          [2, 79, 0.5, 0.42],
          [3, 83, 0.5, 0.44],
        ] as const)
          s.note("chip", 78, beat, pitch, length, velocity);
        s.note("chip", 79, 0, 88, 3.5, 0.46, { bend: DIVE });
      }
      if (b === 4 || b === 40 || b === 44)
        s.note("glass", b, 0, b === 44 ? 76 : 83, 0.5, 0.38);
      if (b === 79) s.note("glass", b, 0, 83, 1, 0.32);
      // Glass pings an octave over the pad top line into each chord of the
      // motor's second half and the half-time turn, where the vocal is alone.
      if (((b >= 15 && b < 23) || (b >= 33 && b < 39)) && b % 2 === 1)
        s.note(
          "glass",
          b,
          3.5,
          ({ e: 78, c: 79, a: 81, bm: 78, b7: 76 } as const)[chordAt(b + 1)],
          1,
          0.3,
        );
      if ([7, 23, 31, 39, 63, 71].includes(b))
        s.note("rise", b, 0, 60, 3.9, 0.6);
      if (b === 46) s.note("rise", b, 0, 60, 6.9, 0.62);
    }
    return s.finish();
  },
};
