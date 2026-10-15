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
  // Half time: kick 1, snare 3, ghosts still running at full speed.
  h: { k: "9.....6.........", s: "...2....9..3..2.", m: "9.....5........." },
} as const satisfies Record<string, Cell>;
type CellName = keyof typeof CELLS;

const RIDE = "6.4.5.4.6.4.5.4.";
const HATS = ".2.1...2.1...2..";
const RUN: readonly CellName[] = ["a", "r", "c", "d", "t", "x", "c", "d"];
const CHASE: readonly CellName[] = ["a", "c", "r", "d", "t", "x", "a", "d"];
const LIVE: readonly CellName[] = ["a", "x", "c", "d", "r", "c", "x", "d"];

/** i9, VI maj9, iv9, v (Bm11, or B7 flat 9 when it turns a phrase home). */
type Chord = "e" | "c" | "a" | "bm" | "b7";
/** Rootless voicings over the sub, voice-led so changes move by step. */
const PAD: Record<Chord, readonly number[]> = {
  e: [55, 59, 62, 66],
  c: [55, 59, 62, 64],
  a: [55, 59, 60, 64],
  bm: [54, 57, 62, 64],
  b7: [54, 57, 60, 63],
};
/** After B7 the leading tone resolves up to E. */
const PAD_HOME = [55, 59, 62, 64];
const KEYS: Record<Chord, readonly number[]> = {
  e: [62, 66, 67, 71],
  c: [59, 62, 64, 67],
  a: [60, 64, 67, 71],
  bm: [57, 62, 64, 66],
  b7: [57, 60, 63, 66],
};
/** Two-bar half-speed sub: a held root, then a pickup that glides on. */
const SUB: Record<Chord, Phrase> = {
  e: [
    [0, 28, 5.5, 0.86],
    [6, 35, 0.9, 0.64],
    [7, 31, 1.1, 0.7],
  ],
  c: [
    [0, 36, 5.5, 0.84],
    [6, 31, 0.9, 0.62],
    [7, 35, 1.1, 0.68],
  ],
  a: [
    [0, 33, 5.5, 0.84],
    [6, 40, 0.9, 0.6],
    [7, 36, 1.1, 0.66],
  ],
  bm: [
    [0, 35, 5.5, 0.84],
    [6, 38, 0.9, 0.62],
    [7, 30, 1.1, 0.68],
  ],
  b7: [
    [0, 35, 5.5, 0.84],
    [6, 39, 0.9, 0.62],
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
const GLASS: Record<Chord, readonly [number, number]> = {
  e: [83, 78],
  c: [79, 76],
  a: [76, 72],
  bm: [78, 74],
  b7: [78, 75],
};
const CALL: Phrase = [
  [1.5, 64, 0.4, 0.66],
  [3.25, 67, 0.35, 0.72],
];
const CALL_LOW: Phrase = [
  [1.5, 62, 0.4, 0.6],
  [2.5, 64, 0.3, 0.55],
  [3.25, 59, 0.45, 0.62],
];
const FRAGMENT: Phrase = [
  [2.5, 62, 0.2, 0.6],
  [2.75, 62, 0.2, 0.5],
  [3.25, 64, 0.35, 0.7],
];
const STUTTER: Phrase = [
  [2.5, 64, 0.1, 0.42],
  [2.625, 64, 0.1, 0.48],
  [2.75, 64, 0.1, 0.54],
  [2.875, 64, 0.1, 0.6],
  [3.25, 67, 0.6, 0.72],
];
/** The soaring string line of the vacuum, reprised in the coast. */
const LINE: Record<number, Phrase> = {
  0: [
    [0, 71, 4, 0.5],
    [4, 74, 4, 0.5],
  ],
  2: [
    [0, 76, 6, 0.52],
    [6, 74, 2, 0.48],
  ],
  4: [
    [0, 72, 4, 0.5],
    [4, 71, 4, 0.48],
  ],
  6: [
    [0, 72, 4, 0.52],
    [4, 71, 3, 0.5],
  ],
};
const DIVE = [
  { at: 0, cents: 0 },
  { at: 0.4, cents: 0 },
  { at: 1, cents: -1200 },
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
      "An Amen-shaped break, re-sequenced and swung, rolls over a gliding sub and a half-speed reese; strings, delayed Rhodes and a stuttered vocal answer the glass, and a half-time drop turns the second run.",
    tempoBpm: 170,
    key: "Em",
    bars: 80,
    highlightBar: 48,
    trackId: "break",
    features: [
      "Amen-shaped break edits with measured swing",
      "reese bass over a gliding sub",
      "half-time drop after a one-beat cut",
      "vocal stutters answered by glass",
      "voice-led ninth chords and delayed Rhodes",
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
      "The break is authored from Amen-shaped cells on a synthesized kit; no recording is borrowed. Offbeat 16ths sit about 8 ms late, the Amen's measured 1.2:1 swing, and ghost snares a little later.",
      "The sub carries the fundamental and ducks under the machine kick; the reese sits an octave up under a low-pass that opens across each run.",
      "The intro, the vacuum and the coast ride a high-pass on the break, the filtered-break move.",
      "Chords are rootless voicings over the sub, led so most changes move one note by a step; B7 flat 9 turns each sixteen-bar phrase home.",
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
      voice("break", "Wire break", "kit", 0.72, {
        kit: "breaks",
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
          [72, 40],
          [79, 1800],
        ),
        reverb: { mix: 0.07, size: 0.22, fade: 0.5 },
        humanize: { timing: 3, velocity: 6, seed: 170 },
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
          [39, 2600],
          [39.9, 900],
          [44, 380],
          [47.9, 1100],
          [48, 2800],
          [63, 3600],
          [64, 3000],
          [71, 4200],
          [72, 1800],
          [79, 300],
        ),
        volumeAutomation: lanes([71.9, 1], [79, 0.35]),
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
          [47.9, 1],
          [48, 0.72],
          [64, 0.8],
          [72, 0.9],
        ),
      }),
    );
    s.track(
      preset("keys", "Rhodes answers", "rhodes", 0.22, {
        pan: -0.18,
        delay: { beats: 0.75, feedback: 0.38, mix: 0.26, pingpong: true },
        reverb: room,
        fx: orbit,
      }),
    );
    s.track(
      voice("chop", "Up fragments", "sampler", 0.45, {
        sampler: {
          mode: "keyed",
          voices: {
            up: {
              ...bundledSampleRef("stay-up"),
              begin: 0.25,
              end: 0.5,
              fit: true,
              fadeTime: 0.008,
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
      voice("glass", "Signal glass", "sampler", 0.28, {
        pan: 0.3,
        sampler: {
          mode: "keyed",
          voices: { glass: bundledSampleRef("glass-hit") },
        },
        delay: { beats: 0.75, feedback: 0.32, mix: 0.2, pingpong: true },
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
    ): void => {
      const count = Math.round((to - from) / step);
      for (let i = 0; i < count; i++)
        s.note(
          "break",
          bar,
          from + i * step,
          38,
          step * 0.8,
          v0 + ((v1 - v0) * i) / Math.max(1, count - 1),
        );
    };
    const drums = (
      bar: number,
      name: CellName,
      gain: number,
      opts: { until?: number; ride?: number; hats?: boolean; machine?: number },
    ): void => {
      const cell: Cell = CELLS[name];
      const until = opts.until ?? 4;
      const cut = (grid: string) =>
        [...grid].map((hit, i) => (i / 4 < until ? hit : ".")).join("");
      hits("break", bar, 36, cut(cell.k), gain);
      hits("break", bar, 38, cut(cell.s), gain);
      if (cell.o) hits("break", bar, 46, cut(cell.o), gain);
      if (opts.ride) hits("break", bar, 51, cut(RIDE), gain * opts.ride);
      if (opts.hats) hits("break", bar, 42, cut(HATS), gain);
      if (opts.machine) hits("kick", bar, 36, cut(cell.m), opts.machine);
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
          pitch + (i === 2 ? lift : 0),
          dive && last ? 2.3 : length,
          velocity,
          dive && last ? { bend: DIVE } : {},
        );
      });

    for (let b = 0; b < 80; b++) {
      // Drums: filtered intro, Amen cells, edits, rolls and the half-time turns.
      if (b < 8) {
        drums(b, (["a", "c", "a", "d"] as const)[b % 4]!, b < 4 ? 0.72 : 0.85, {
          ride: 0.9,
          until: b === 7 ? 2 : 4,
        });
        if (b === 7) {
          roll(7, 2, 3, 0.25, 0.32, 0.55);
          roll(7, 3, 4, 0.125, 0.5, 0.92);
        }
      } else if (b < 24) {
        const name = b === 19 ? "r" : (["a", "a", "c", "d"] as const)[b % 4]!;
        drums(b, name, 1, {
          ride: 1,
          machine: 0.85,
          until: b === 15 ? 3 : b === 23 ? 2 : 4,
        });
        if (b === 15) roll(15, 3, 4, 0.25, 0.4, 0.75);
        if (b === 23) {
          roll(23, 2, 3, 0.25, 0.35, 0.6);
          roll(23, 3, 4, 0.125, 0.55, 0.98);
        }
      } else if (b < 40) {
        if (b >= 38) drums(b, "h", 1, { ride: 0.8, machine: 0.9 });
        else {
          drums(b, RUN[(b - 24) % 8]!, 1, {
            ride: 1.05,
            machine: 0.85,
            until: b === 31 ? 3 : 4,
          });
          if (b === 31) roll(31, 3, 4, 0.125, 0.4, 0.9);
        }
      } else if (b < 48) {
        if (b >= 44) drums(b, "h", 0.8, { ride: 0.7, until: b === 47 ? 1 : 4 });
        if (b === 47) {
          roll(47, 1, 2, 0.25, 0.35, 0.55);
          roll(47, 2, 3, 0.125, 0.5, 0.95);
        }
      } else if (b < 52) {
        drums(b, "h", 1, { ride: 0.9, machine: 1, until: b === 51 ? 3 : 4 });
        if (b === 51) roll(51, 3, 4, 0.125, 0.45, 0.9);
      } else if (b < 64) {
        drums(b, CHASE[(b - 52) % 8]!, 1, {
          ride: 1.05,
          hats: true,
          machine: 0.85,
          until: b === 63 ? 2 : 4,
        });
        if (b % 4 === 2) hits("break", b, 37, "..3....2.3....3.");
        if (b === 55 || b === 59) roll(b, 2.625, 3, 0.125, 0.14, 0.27);
        if (b === 63) {
          roll(63, 2, 3, 0.25, 0.35, 0.6);
          roll(63, 3, 4, 0.125, 0.55, 1);
        }
      } else if (b < 72) {
        drums(b, LIVE[(b - 64) % 8]!, 1, {
          ride: 1.1,
          hats: true,
          machine: 0.9,
          until: b === 67 ? 3 : b === 71 ? 1 : 4,
        });
        if (b === 67)
          for (const [beat, pitch, velocity] of [
            [3, 50, 0.62],
            [3.25, 48, 0.66],
            [3.5, 47, 0.72],
            [3.75, 45, 0.8],
          ] as const)
            s.note("break", 67, beat, pitch, 0.2, velocity);
        if (b === 71) {
          roll(71, 1, 2, 0.25, 0.3, 0.5);
          roll(71, 2, 4, 0.125, 0.45, 1);
        }
      } else if (b < 78) {
        drums(b, (["a", "c", "t", "d"] as const)[b % 4]!, b < 76 ? 0.9 : 0.7, {
          ride: 0.9,
          machine: b < 76 ? 0.7 : 0,
        });
      }
      if ([8, 24, 48, 52, 64, 68].includes(b))
        s.note("break", b, 0, 49, 1, 0.62);
      if (b === 72) s.note("break", b, 0, 49, 1, 0.45);

      // Harmony moves every two bars, at half speed against the break.
      const chord = chordAt(b);
      if (b % 2 === 0) {
        const home = chord === "e" && b >= 2 && chordAt(b - 2) === "b7";
        const cut = b === 46;
        strum(
          "pad",
          b,
          b === 0 ? 0 : -0.5,
          home ? PAD_HOME : PAD[chord],
          cut ? 7.5 : 8.3,
          b >= 40 && b < 48 ? 0.5 : 0.38,
        );
        if (b >= 40 && b < 48) {
          for (const [beat, pitch, length, velocity = 0.5] of LINE[b - 40]!)
            s.note("pad", b, beat, pitch, length, velocity, {
              vibrato: { rate: 5.2, depth: 14, delay: 0.5 },
            });
        }
        if (b >= 72) {
          const line: Phrase =
            b === 78
              ? [
                  [0, 71, 3.5, 0.46],
                  [4, 67, 4, 0.42],
                ]
              : LINE[b === 76 ? 6 : b - 72]!;
          for (const [beat, pitch, length, velocity = 0.5] of line)
            s.note("pad", b, beat, pitch, length, velocity * 0.9, {
              vibrato: { rate: 5.2, depth: 12, delay: 0.5 },
            });
        }
        // Sub: half-speed roots that glide on; whole notes in the vacuum and coast.
        if (b >= 40 && b < 48)
          s.note("sub", b, 0, SUB[chord][0]![1], cut ? 7 : 7.8, 0.8);
        else if (b >= 72)
          s.note("sub", b, 0, SUB[chord][0]![1], 7.8, b === 78 ? 0.7 : 0.8);
        else if (b >= 8) s.phrase("sub", b, SUB[chord]);
        // Reese from the second half of the motor on.
        if ((b >= 16 && b < 40) || (b >= 52 && b < 72))
          reese(
            b,
            REESE[chord],
            b >= 60 && b < 64 ? 12 : b >= 68 ? 12 : 0,
            b === 38 || b === 70,
          );
        else if (b === 44)
          reese(b, [
            [0, 45, 5.8, 0.7],
            [6, 52, 1, 0.55],
            [7, 48, 1.1, 0.6],
          ]);
        else if (b === 46)
          reese(b, [
            [0, 47, 5.4, 0.72],
            [5.5, 51, 1.4, 0.6],
          ]);
        else if (b === 48 || b === 50)
          reese(
            b,
            b === 48
              ? [
                  [0, 40, 5.8, 0.82],
                  [6, 47, 1, 0.62],
                  [7, 52, 1.1, 0.66],
                ]
              : [
                  [0, 48, 5.8, 0.8],
                  [6, 43, 1, 0.6],
                  [7, 47, 1.1, 0.64],
                ],
          );
        else if (b >= 72) s.note("bass", b, 0, REESE[chord][0]![1], 7.8, 0.66);
        // Rhodes stabs behind the beat; held chords in the vacuum.
        if ((b >= 24 && b < 38) || (b >= 52 && b < 76)) {
          strum("keys", b, 1.5, KEYS[chord], 0.45, 0.5);
          strum("keys", b, 4.75, KEYS[chord], 0.4, 0.42);
        } else if (b >= 40 && b < 46) strum("keys", b, 0.5, KEYS[chord], 3, 0.36);
      }

      // Vocal call, glass answer; stutters in the second half.
      const runs = (b >= 26 && b < 38) || (b >= 52 && b < 72);
      if (runs) {
        if (b % 4 === 0) s.phrase("chop", b, CALL);
        if (b % 4 === 2) s.phrase("chop", b, CALL_LOW);
        if (b % 4 === 3) s.phrase("chop", b, b >= 52 ? STUTTER : FRAGMENT);
      }
      if ((b >= 24 && b < 40) || (b >= 48 && b < 72)) {
        const [high, low] = GLASS[chord];
        if (b % 4 === 1)
          s.phrase("glass", b, [
            [0.75, high, 0.35, 0.42],
            [2.75, low, 0.4, 0.34],
          ]);
        if (b % 4 === 3 && b >= 48) s.note("glass", b, 0.75, low, 0.35, 0.34);
      }
      if (b === 5) s.note("chop", b, 1.5, 64, 1.5, 0.4);
      if (b === 41 || b === 45) s.note("chop", b, 1, 64, 1.6, 0.55);
      if (b === 43) s.note("chop", b, 1, 67, 1.6, 0.55);
      if (b === 47)
        for (let i = 0; i < 8; i++)
          s.note("chop", 47, 1.5 + i / 8, 64, 0.1, 0.36 + i * 0.05);
      if (b === 73 || b === 77) s.note("chop", b, 1.5, b === 73 ? 64 : 67, 1.6, 0.42);
      if (b === 4 || b === 40 || b === 44)
        s.note("glass", b, 0, b === 44 ? 76 : 83, 0.5, 0.38);
      if (b === 79) s.note("glass", b, 0, 83, 1, 0.32);
      if ([7, 23, 39, 63, 71].includes(b)) s.note("rise", b, 0, 60, 3.9, 0.62);
      if (b === 47) s.note("rise", b, 0, 60, 3, 0.66);
    }
    return s.finish();
  },
};
