/** Glass Arc: the future garage demo song. */
import type { NoteInput } from "../score.ts";
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
} from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

/** Seeded scatter (mulberry32): every render places each hit the same way. */
function scatter(seed: number): (amount: number) => number {
  let state = seed >>> 0;
  return (amount) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1) * amount;
  };
}

const clamp = (velocity: number) =>
  Math.round(Math.min(1, Math.max(0.04, velocity)) * 1000) / 1000;

/** A chord slot: start bar, length in bars, sub root, pad voicing, air note. */
type Slot = readonly [
  bar: number,
  bars: number,
  root: number,
  pad: readonly number[],
  air: number,
  glass: readonly number[],
];

// Archangel's falling-bass idiom moved to D minor: VI, i over the fifth,
// iv9, the half-diminished ii over G, iv over its seventh. Voicings keep
// common tones so only one or two inner voices move per change.
const BB9 = [62, 65, 69, 72],
  DM9 = [62, 64, 69, 72],
  GM9 = [62, 65, 69, 70],
  EO7 = [62, 64, 67, 70],
  GM7 = [62, 65, 67, 70],
  ASUS = [62, 64, 69],
  A7B9 = [61, 64, 67, 70],
  DADD9 = [62, 64, 65, 69];

function mainCycle(bar: number, turn = false): Slot[] {
  return [
    [bar, 2, 34, BB9, 74, [81, 77, 76, 74]],
    [bar + 2, 2, 33, DM9, 76, [81, 76, 74, 72]],
    [bar + 4, 2, 31, GM9, 77, [82, 81, 77, 74]],
    turn
      ? [bar + 6, 1, 33, ASUS, 76, [81, 76, 74, 69]]
      : [bar + 6, 1, 31, EO7, 74, [79, 76, 74, 70]],
    turn
      ? [bar + 7, 1, 33, A7B9, 73, [79, 76, 73, 70]]
      : [bar + 7, 1, 29, GM7, 74, [77, 74, 70, 67]],
  ];
}

// The bridge drops the sub: the pad's own low note carries G, Eb, D, A,
// and the A7(b9) leads every voice up a step into the Bbmaj9 that follows.
const BRIDGE: Slot[] = [
  [32, 2, 43, GM9, 81, [82, 81, 77, 74]],
  [34, 2, 39, GM7, 79, [79, 77, 74, 70]],
  [36, 2, 38, GM9, 81, [81, 77, 74, 70]],
  [38, 1, 45, ASUS, 76, [81, 76, 74, 69]],
  [39, 1, 45, A7B9, 73, [79, 76, 73, 70]],
];

const MIST: Slot[] = [
  [56, 2, 34, BB9, 74, [81, 77, 76, 74]],
  [58, 2, 31, GM9, 77, [82, 81, 77, 74]],
  [60, 4, 26, DADD9, 76, [81, 77, 76, 74]],
];

const SLOTS: Slot[] = [
  ...mainCycle(0),
  ...mainCycle(8),
  ...mainCycle(16),
  ...mainCycle(24),
  ...BRIDGE,
  ...mainCycle(40),
  ...mainCycle(48, true),
  ...MIST,
];

const PARTS = [
  "rain",
  "half",
  "gather",
  "arc",
  "air",
  "arc2",
  "sky",
  "mist",
] as const;
type Part = (typeof PARTS)[number];

// Kick: beat one dead on, the second kick moved bar to bar (2-step).
const KICK_HALF = [
  [0, 10],
  [0, 11],
  [0, 10],
  [0, 6, 11, 14],
];
const KICK_TWO = [
  [0, 10],
  [0, 7, 10],
  [0, 11],
  [0, 10, 14],
];
const KICK_SKY = [
  [0, 3, 10],
  [0, 7, 10],
  [0, 11, 14],
  [0, 10, 15],
];
// Hats: digits are velocity tenths; the "and" of each beat leads the shuffle.
const HAT_HALF = [
  "..4...4...4...4.",
  "..4...42..4...4.",
  "..4.2.4...4...42",
  "..4...4...4.2.4.",
];
const HAT_TWO = [
  "..5.2.5...5.2.5.",
  "2.5.2.5...5.235.",
  "..5.2.5.2.5...52",
  "2.5...5.2.5.2.53",
];
const SKY_TICKS = "3232432323243234";
const GHOSTS_HALF = [[3, 13], [15], [5, 13], [7, 14, 15]];
const GHOSTS_TWO = [[7, 15], [6, 14], [11, 15], [3, 9, 15], [7, 10, 15], [14]];

// The "stay up" call: a falling statement, a rising repeat, a darker third
// line and a cadence onto a long D. Bars are offsets inside an 8-bar cycle.
type Line = readonly (readonly [
  bar: number,
  beat: number,
  pitch: number,
  length: number,
  velocity: number,
])[];
const CALL: Line = [
  [0, 0.5, 69, 1.5, 0.8],
  [0, 2.25, 67, 0.45, 0.6],
  [0, 2.75, 65, 1.9, 0.74],
  [1, 1.75, 62, 0.5, 0.52],
  [2, 0.5, 69, 1.5, 0.8],
  [2, 2.25, 72, 0.45, 0.62],
  [2, 2.75, 69, 1.9, 0.74],
  [3, 1.5, 64, 0.5, 0.52],
  [4, 0.5, 70, 1.5, 0.82],
  [4, 2.25, 69, 0.45, 0.62],
  [4, 2.75, 65, 1.9, 0.74],
  [5, 1.75, 62, 0.5, 0.52],
  [6, 0.5, 67, 0.9, 0.72],
  [6, 1.5, 65, 0.5, 0.6],
  [6, 2.5, 64, 1, 0.68],
  [7, 0.25, 62, 3.4, 0.78],
];
// Over the climax's Asus4 and A7(b9) turn the cadence lands on C#.
const CALL_TURN: Line = [
  ...CALL.slice(0, 12),
  [6, 0.5, 69, 0.9, 0.74],
  [6, 1.5, 67, 0.5, 0.62],
  [6, 2.5, 64, 1, 0.7],
  [7, 0.25, 61, 3.4, 0.8],
];
// The high "hold on" answers fill the call's gaps; the second arc climbs.
const ANSWER: Line = [
  [1, 2.5, 74, 1.4, 0.62],
  [3, 2.5, 76, 1.4, 0.62],
  [5, 2.5, 77, 1.4, 0.64],
  [7, 2.5, 74, 1.4, 0.58],
];
const ANSWER_HIGH: Line = [
  [1, 2.5, 77, 1.4, 0.64],
  [3, 2.5, 79, 1.4, 0.66],
  [5, 2.5, 81, 1.4, 0.7],
  [7, 2.5, 76, 1.6, 0.62],
];

const FIGURES: Readonly<
  Record<string, readonly (readonly [number, number])[]>
> = {
  a: [
    [0.75, 0],
    [2.25, 1],
    [3.5, 2],
  ],
  b: [
    [0.5, 1],
    [1.25, 0],
    [3, 3],
  ],
  c: [
    [0.75, 0],
    [1.5, 2],
    [2.25, 1],
    [3.25, 3],
  ],
  d: [
    [1.5, 0],
    [3.25, 2],
  ],
};

const cave = {
  mix: 0.3,
  size: 0.9,
  fade: 5.5,
  lowpass: 3800,
  predelay: 0.03,
};

export const glassArc: DemoDefinition = {
  info: demoInfo({
    id: "glass-arc",
    title: "Glass Arc",
    style: "Future garage",
    description:
      "Hand-placed 2-step drums under vinyl rain, a falling Bbmaj9 to Dm/A to Gm9 loop, an original 'stay up' call with a high formant-shifted 'hold on' answer, and glass bells; the final arc doubles the hat motion.",
    tempoBpm: 138,
    key: "Dm",
    bars: 64,
    highlightBar: 48,
    trackId: "chop",
    features: [
      "hand-placed 2-step pocket",
      "granular vowel bed",
      "formant-shifted vocal answers",
      "glass sampler countermelody",
      "reverse swells and risers",
      "vinyl crackle bed",
    ],
    arrangement: [
      "Rain glass 8",
      "Half-step 8",
      "Gather 8",
      "First arc 8",
      "Weightless 8",
      "Second arc 8",
      "Open sky 8",
      "Mist 8",
    ],
    mixNotes: [
      "Kick and sub stay mono in the center and lock together; rims, ticks and the glass sit off-center with their own delays.",
      "Every snare and rim lands 10 to 20 ms late and every hat swings near 62%, nudged hit by hit, so no bar repeats exactly.",
      "The crackle bed rises in the empty sections and falls back under the full arcs; the bridge removes the sub and kick completely.",
      "The 'stay up' call and the high 'hold on' answer trade two-bar phrases; the vocal reverb is long and dark, the chop delay a dotted eighth.",
    ],
  }),
  build() {
    const s = new Composer(glassArc.info);
    [
      "Rain glass",
      "Half-step",
      "Gather",
      "First arc",
      "Weightless",
      "Second arc",
      "Open sky",
      "Mist",
    ].forEach((name, i) => s.section(name, i * 8, 8));

    s.track(
      voice("kick", "Low pulse", "kit", 0.8, {
        kit: "syn808",
        fx: { duck: { orbit: 2, depth: 0.4, attack: 0.22 } },
        humanize: { velocity: 3, seed: 11 },
      }),
    );
    s.track(
      voice("drums", "Half-step kit", "kit", 0.56, {
        kit: "lofi",
        pan: -0.06,
        reverb: room,
        humanize: { timing: 3, velocity: 5, seed: 23 },
      }),
    );
    s.track(
      voice("perc", "Rim and tick", "kit", 0.4, {
        kit: "electro",
        pan: 0.32,
        reverb: { ...room, mix: 0.18 },
        delay: { beats: 0.75, feedback: 0.22, mix: 0.1, highcut: 5200 },
        humanize: { timing: 4, velocity: 7, seed: 31 },
      }),
    );
    s.track(preset("bass", "Sub floor", "sub-sine", 0.64, { fx: orbit }));
    s.track(
      preset("reese", "Warm reese", "reese", 0.15, {
        fx: orbit,
        filterAutomation: lanes(
          [40, 450],
          [43, 900],
          [44, 600],
          [47, 1300],
          [48, 700],
          [51, 1200],
          [52, 800],
          [55, 1700],
          [56, 400],
        ),
      }),
    );
    s.track(
      voice("grains", "Vowel clouds", "granular", 0.33, {
        granular: {
          src: bundledSampleRef("vowel-ah"),
          root: 60,
          grain: 0.18,
          overlap: 4,
          pos: 0.48,
          scan: 0.07,
          spread: 0.82,
          spray: 0.035,
          jitter: 0.12,
          gain: 0.5,
        },
        reverb: hall,
        fx: orbit,
        filterAutomation: lanes(
          [0, 650],
          [7, 1500],
          [8, 1100],
          [15, 1700],
          [16, 1400],
          [23, 2800],
          [24, 2300],
          [31, 3400],
          [32, 1000],
          [39, 2600],
          [40, 2400],
          [47, 3600],
          [48, 4600],
          [55, 5200],
          [56, 2400],
          [63, 480],
        ),
      }),
    );
    s.track(
      voice("chop", "Stay up", "sampler", 0.6, {
        pan: -0.08,
        sampler: {
          mode: "keyed",
          voices: {
            stay: {
              ...bundledSampleRef("stay-up"),
              begin: 0,
              end: 0.5,
              fadeInTime: 0.006,
              fadeTime: 0.05,
            },
          },
        },
        delay: {
          beats: 0.75,
          feedback: 0.32,
          mix: 0.18,
          pingpong: true,
          highcut: 3600,
        },
        delayMixAutomation: lanes(
          [0, 0.18],
          [30, 0.18],
          [31, 0.42],
          [32, 0.26],
          [40, 0.18],
          [54, 0.2],
          [55, 0.45],
          [56, 0.3],
          [63, 0.4],
        ),
        reverb: cave,
        filter: { type: "hpf", cutoff: 220, resonance: 0.2 },
        fx: orbit,
        humanize: { timing: 6, velocity: 4, length: 6, seed: 41 },
      }),
    );
    s.track(
      voice("hold", "Hold on (high)", "sampler", 0.42, {
        pan: 0.2,
        sampler: {
          mode: "keyed",
          voices: {
            on: {
              ...bundledSampleRef("hold-on"),
              root: 72,
              begin: 0,
              end: 0.5,
              shift: 12,
              formant: 4,
              fadeInTime: 0.01,
              fadeTime: 0.06,
            },
          },
        },
        delay: {
          beats: 1.5,
          feedback: 0.38,
          mix: 0.22,
          pingpong: true,
          highcut: 3000,
        },
        reverb: { ...cave, mix: 0.38 },
        filter: { type: "hpf", cutoff: 420, resonance: 0.15 },
        fx: orbit,
        humanize: { timing: 7, velocity: 5, length: 8, seed: 43 },
      }),
    );
    s.track(
      voice("glass", "Glass bells", "sampler", 0.32, {
        pan: -0.3,
        sampler: {
          mode: "keyed",
          voices: {
            glass: { ...bundledSampleRef("glass-hit"), fadeTime: 0.025 },
          },
        },
        delay: { beats: 0.75, feedback: 0.3, mix: 0.24, pingpong: true },
        reverb: hall,
        humanize: { timing: 5, velocity: 8, seed: 53 },
      }),
    );
    s.track(
      voice("reverse", "Reverse vowel", "sampler", 0.26, {
        pan: -0.2,
        sampler: {
          mode: "keyed",
          voices: {
            oh: {
              ...bundledSampleRef("vowel-oh"),
              speed: -1,
              fit: true,
              fitmode: "tones",
              fadeInTime: 0.12,
              fadeTime: 0.02,
            },
            rise: {
              ...bundledSampleRef("riser"),
              root: 96,
              fit: true,
              fitmode: "tones",
              fadeInTime: 0.6,
              fadeTime: 0.05,
            },
          },
        },
        reverb: hall,
      }),
    );
    s.track(
      voice("rain", "Vinyl rain", "crackle", 0.2, {
        synth: { attack: 1.5, release: 3, density: 0.02, noise: 0.3 },
        filter: { type: "hpf", cutoff: 320, resonance: 0.1 },
        reverb: room,
        panAutomation: lanes(
          [0, -0.25],
          [16, 0.2],
          [32, -0.15],
          [48, 0.25],
          [63, 0],
        ),
      }),
    );

    const dice = scatter(0x6a55);
    const hit = (
      track: string,
      bar: number,
      step: number,
      pitch: number,
      velocity: number,
      ticks = 0,
      length = 0.13,
    ) =>
      s.note(
        track,
        bar,
        step / 4 + Math.round(ticks) / TPB,
        pitch,
        length,
        clamp(velocity),
      );
    const sing = (
      track: string,
      bar: number,
      line: Line,
      gain = 1,
      shift = 0,
      keep: (bar: number) => boolean = () => true,
    ) => {
      for (const [at, beat, pitch, length, velocity] of line) {
        if (!keep(at)) continue;
        const extra: Partial<NoteInput> =
          length >= 3
            ? {
                bend: [
                  { at: 0, cents: -70 },
                  { at: 0.08, cents: 0 },
                  { at: 0.7, cents: 0 },
                  { at: 1, cents: -180 },
                ],
                vibrato: { rate: 5.2, depth: 22, delay: 0.3 },
              }
            : length >= 1.4
              ? {
                  bend: [
                    { at: 0, cents: -60 },
                    { at: 0.12, cents: 0 },
                  ],
                }
              : {};
        s.note(
          track,
          bar + at,
          beat + Math.round(dice(12) - (beat % 1 === 0.5 ? 6 : 0)) / TPB,
          pitch + shift,
          length,
          clamp(velocity * gain + dice(0.04)),
          extra,
        );
      }
    };

    // ── chords, sub, reese and glass, slot by slot ───────────────────────
    for (const [bar, bars, root, pad, air, tones] of SLOTS) {
      const part: Part = PARTS[Math.floor(bar / 8)]!;
      const padGain = {
        rain: 0.5,
        half: 0.52,
        gather: 0.55,
        arc: 0.6,
        air: 0.62,
        arc2: 0.6,
        sky: 0.62,
        mist: 0.5,
      }[part];
      const length = bars * 4 - (part === "mist" && bar === 60 ? 0 : 0.08);
      s.chord(
        "grains",
        bar,
        0,
        part === "air" ? [root, ...pad] : pad,
        length,
        padGain,
      );
      if (part === "air" || part === "sky" || (part === "mist" && bar === 60))
        s.note("grains", bar, 0.5, air, length - 0.5, padGain * 0.62);

      // Glass: a figure in the slot's first bar, an echo in its second.
      const figure = {
        rain: "d",
        half: "a",
        gather: "b",
        arc: bars === 2 && (bar / 2) % 2 ? "c" : "a",
        air: "d",
        arc2: (bar / 2) % 2 ? "c" : "b",
        sky: "c",
        mist: "d",
      }[part];
      const lift = part === "air" ? 12 : 0;
      FIGURES[figure]!.forEach(([beat, index], i) =>
        s.note(
          "glass",
          bar,
          beat + Math.round(dice(14)) / TPB,
          tones[index]! + lift,
          0.6,
          clamp(0.46 - i * 0.05 + dice(0.05) - (part === "air" ? 0.1 : 0)),
        ),
      );
      if (part === "sky")
        s.note("glass", bar, 0.75 + 30 / TPB, tones[0]! + 12, 0.5, 0.28);
      if (bars >= 2 && part !== "half")
        s.note(
          "glass",
          bar + 1,
          1.75 + Math.round(dice(12)) / TPB,
          tones[3]!,
          0.7,
          clamp(0.32 + dice(0.04)),
        );

      // Reese: a long filtered tone an octave over the sub in the second half.
      if (part === "arc2" || part === "sky") {
        s.note("reese", bar, 0, root + 12, bars * 4 - 0.25, 0.62);
        if (part === "sky" && bars === 2)
          s.note("reese", bar + 1, 2.5, root + 12, 1.4, 0.5);
      }
    }

    // ── drums and sub, bar by bar ────────────────────────────────────────
    const slotAt = (bar: number) =>
      SLOTS.find(([start, bars]) => bar >= start && bar < start + bars)!;
    for (let b = 0; b < 64; b++) {
      const part: Part = PARTS[Math.floor(b / 8)]!;
      const pos = b % 8;
      const [slotBar, slotBars, root] = slotAt(b);
      const slotEnd = b === slotBar + slotBars - 1;

      if (part === "rain") {
        if (b >= 6)
          for (const step of b === 7 ? [2, 6, 10, 14, 15] : [6, 14])
            hit("perc", b, step, 42, 0.12 + dice(0.03), 30 + dice(8));
        continue;
      }
      if (part === "air") {
        if (b === 36 || b === 37) {
          hit("perc", b, 12, 37, 0.3 + dice(0.04), 16 + dice(4));
          hit("perc", b, 2, 46, 0.16 + dice(0.03), 20 + dice(14), 0.3);
        }
        if (b >= 38)
          for (let i = 0; i < 16; i++)
            hit(
              "perc",
              b,
              i,
              42,
              0.06 + (0.36 * ((b - 38) * 16 + i)) / 32,
              (i % 2 ? 34 : 0) + dice(6),
            );
        if (b === 39) hit("drums", b, 12, 38, 0.5, 16);
        continue;
      }
      if (part === "mist" && b >= 60) continue;

      const half = part === "half" || part === "mist";
      // Kick
      let kicks = (half ? KICK_HALF : part === "sky" ? KICK_SKY : KICK_TWO)[
        pos % 4
      ]!;
      if (part === "gather" && pos < 4) kicks = [0, 10];
      if (part === "mist") kicks = pos % 2 ? [0] : [0, 10];
      if (b === 23 || b === 47) kicks = [0];
      if (b === 15 || b === 31) kicks = [0, 10];
      if (b === 55) kicks = [0, 7];
      for (const step of kicks)
        hit(
          "kick",
          b,
          step,
          36,
          step === 0
            ? 0.9 + dice(0.04)
            : step >= 14 || step === 3
              ? 0.5 + dice(0.05)
              : 0.7 + dice(0.06),
          step === 0 ? dice(2) - 1 : 4 + dice(6),
        );

      // Sub: locks with the kick, rests between, octave pickups at slot ends.
      if (part !== "mist") {
        const second = kicks.find((step) => step >= 6 && step <= 11);
        const pickup =
          slotEnd && (part === "sky" || (part !== "half" && (slotBar / 2) % 2));
        s.note("bass", b, 0, root, second ? second / 4 - 0.15 : 3.2, 0.8, {
          ...(b === 24 || b === 40 || b === 48 ? { glide: 0.09 } : {}),
          ...(pos > 0 && b - 1 === slotBar + slotBars - 1
            ? { glide: 0.05 }
            : {}),
        });
        if (second)
          s.note(
            "bass",
            b,
            second / 4,
            root,
            pickup ? 0.8 : half ? 1 : 1.35,
            0.68,
          );
        if (pickup) {
          const next = slotAt(Math.min(63, b + 1))[2];
          s.note("bass", b, 3.5, next + 12, 0.4, 0.5);
        }
      } else if (b < 60) s.note("bass", b, 0, root, 3.4, 0.7);
      if (b === 23 || b === 39 || b === 47)
        s.note("bass", b, 3.5, slotAt(b + 1)[2] + 12, 0.4, 0.46);

      // Backbeat: laid back 10 to 20 ms, rim and snare alternating.
      if (half) {
        hit(
          "drums",
          b,
          8,
          38,
          (part === "mist" ? 0.62 : 0.78) + dice(0.05),
          16 + dice(5),
        );
        if (b % 2) hit("perc", b, 8, 37, 0.4 + dice(0.05), 12 + dice(4));
        for (const step of GHOSTS_HALF[(b * 3) % 4]!)
          hit(
            step % 2 ? "perc" : "drums",
            b,
            step,
            step % 2 ? 37 : 38,
            0.15 + Math.abs(dice(0.08)),
            8 + dice(10),
          );
      } else {
        const soft = part === "gather" && pos < 4;
        hit("perc", b, 4, 37, (soft ? 0.5 : 0.62) + dice(0.06), 12 + dice(4));
        hit("drums", b, 4, b % 2 ? 39 : 38, 0.28 + dice(0.04), 9 + dice(3));
        hit("drums", b, 12, 38, (soft ? 0.68 : 0.8) + dice(0.05), 15 + dice(5));
        if (part !== "gather")
          hit("drums", b, 12, 39, 0.3 + dice(0.04), 6 + dice(3));
        for (const step of GHOSTS_TWO[(b * 5) % 6]!)
          if (!(b === 23 && step >= 8))
            hit(
              step % 2 ? "perc" : "drums",
              b,
              step,
              step % 2 ? 37 : 38,
              0.14 + Math.abs(dice(0.09)),
              6 + dice(10),
            );
      }

      // Hats: swung near 62% (+29 ticks), each hit nudged by hand.
      const pattern = (half ? HAT_HALF : HAT_TWO)[(pos + (b >> 3)) % 4]!;
      const afterCrash = b === 24 || b === 40 || b === 48 ? 0.85 : 1;
      [...pattern].forEach((digit, step) => {
        if (digit === ".") return;
        if ((b === 23 && step >= 8) || (b === 55 && step >= 10)) return;
        if (part === "mist" && pos >= 2 && step % 4 !== 2) return;
        hit(
          "drums",
          b,
          step,
          42,
          (Number(digit) / 10) * 0.92 * afterCrash + dice(0.04),
          (step % 2 ? 29 : 3) + dice(6),
        );
      });
      // The climax doubles the hat motion: a triplet-swung tick layer.
      if (part === "sky")
        [...SKY_TICKS].forEach((digit, step) => {
          if (b === 55 && step >= 10) return;
          hit(
            "perc",
            b,
            step,
            42,
            (Number(digit) / 10) * 0.7 + dice(0.04),
            (step % 2 ? 38 : 0) + dice(5),
          );
        });
      // Shaker on the first offbeat, timed a little differently each time.
      if (part === "arc" || part === "arc2" || part === "sky")
        hit("perc", b, 2, 46, 0.2 + dice(0.05), 18 + dice(14), 0.25);
      if ((part === "arc" || part === "arc2") && pos % 4 === 3 && b !== 47)
        hit("drums", b, 14, 46, 0.34 + dice(0.04), 26 + dice(6), 0.5);
      if (part === "sky" && pos % 2 === 0)
        for (const step of [2, 10])
          hit("drums", b, step, 51, 0.24 + dice(0.04), 6 + dice(4), 0.5);

      // Crashes open the arcs; fills and drop-outs close the phrases.
      if (b === 24 || b === 40 || b === 48) hit("drums", b, 0, 49, 0.52, 0, 2);
      if (b === 56) hit("drums", b, 0, 49, 0.32, 0, 2);
      if (b === 15)
        [0.2, 0.28, 0.38].forEach((v, i) =>
          hit("drums", b, 13 + i, 38, v, 10 + dice(4)),
        );
      if (b === 31) {
        [0.32, 0.42, 0.55].forEach((v, i) =>
          hit("drums", b, 13 + i, 38, v, 10 + dice(4)),
        );
        hit("drums", b, 14, 46, 0.36, 24, 0.5);
      }
      if (b === 47)
        for (let step = 8; step < 16; step++)
          hit("drums", b, step, 38, 0.18 + (step - 8) * 0.06, 8 + dice(5));
      if (b === 55) hit("drums", b, 14, 46, 0.3, 24, 0.6);
    }

    // ── vocals ───────────────────────────────────────────────────────────
    // Rain glass and Half-step: stray fragments, the words barely there.
    s.note("chop", 4, 1, 62, 3, 0.42, {
      bend: [
        { at: 0, cents: -40 },
        { at: 0.1, cents: 0 },
        { at: 0.75, cents: 0 },
        { at: 1, cents: -200 },
      ],
    });
    s.note("hold", 6, 2.5, 76, 1.4, 0.36);
    for (const [bar, beat, pitch, length, velocity] of [
      [9, 2.75, 65, 1, 0.55],
      [11, 0.5, 69, 0.6, 0.5],
      [13, 1.25, 62, 2.2, 0.6],
      [15, 0.75, 64, 0.5, 0.45],
    ] as const)
      s.note(
        "chop",
        bar,
        beat + Math.round(dice(10)) / TPB,
        pitch,
        length,
        velocity,
      );
    s.note("hold", 12, 2.5, 74, 1.4, 0.44);
    // Gather: the call's long notes only; First arc: the whole call and answer.
    sing("chop", 16, CALL, 0.86, 0, (at) => at === 0 || at === 4 || at === 7);
    s.note("hold", 21, 2.5, 77, 1.4, 0.5);
    sing("chop", 24, CALL);
    sing("hold", 24, ANSWER);
    // Weightless: long held calls over the bridge, the answer rising F G A.
    for (const [bar, pitch] of [
      [32, 65],
      [34, 67],
      [36, 69],
      [38, 64],
    ] as const)
      s.note("chop", bar, 0.5 + Math.round(dice(10)) / TPB, pitch, 3.5, 0.6, {
        bend: [
          { at: 0, cents: -50 },
          { at: 0.1, cents: 0 },
        ],
        vibrato: { rate: 4.8, depth: 18, delay: 0.35 },
      });
    for (const [bar, beat, pitch] of [
      [33, 2.5, 77],
      [35, 2.5, 79],
      [37, 2.5, 81],
      [39, 1.5, 76],
    ] as const)
      s.note("hold", bar, beat + Math.round(dice(10)) / TPB, pitch, 1.6, 0.55);
    // Second arc: the call again, the answer a step higher each time.
    sing("chop", 40, CALL);
    sing("hold", 40, ANSWER_HIGH);
    // Open sky: the call with its turn, octave-up doubles, the high answer.
    sing("chop", 48, CALL_TURN);
    sing("chop", 48, CALL_TURN, 0.42, 12, (at) => at % 2 === 0 && at < 6);
    sing("hold", 48, ANSWER_HIGH, 1.05);
    for (const bar of [48, 50, 52])
      s.note("hold", bar, 3.5 + Math.round(dice(8)) / TPB, 81, 0.5, 0.4);
    // Mist: the last echoes, then the long D.
    sing("chop", 56, [
      [0, 0.5, 69, 1.5, 0.6],
      [0, 2.75, 65, 1.9, 0.5],
      [2, 0.5, 70, 1.5, 0.52],
      [2, 2.75, 65, 1.9, 0.42],
      [4, 0.25, 62, 3.6, 0.48],
    ]);
    s.note("hold", 61, 2.5, 74, 1.6, 0.38);
    s.note("hold", 62, 2.5, 69, 1.6, 0.26);

    // ── transitions and the rain bed ─────────────────────────────────────
    for (const [bar, pitch] of [
      [7, 62],
      [15, 69],
      [23, 65],
      [31, 70],
      [39, 62],
      [47, 69],
      [55, 62],
    ] as const)
      s.note("reverse", bar, 1, pitch, 3, 0.72);
    s.note("reverse", 22, 0, 96, 8, 0.5);
    s.note("reverse", 46, 0, 96, 8, 0.55);
    for (const [bar, velocity] of [
      [0, 0.95],
      [8, 0.62],
      [16, 0.52],
      [24, 0.4],
      [32, 0.9],
      [40, 0.42],
      [48, 0.36],
      [56, 0.92],
    ] as const)
      s.note("rain", bar, 0, 60, 32.5, velocity);
    return s.finish();
  },
};
