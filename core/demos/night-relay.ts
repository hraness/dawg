/** Night Relay: the deep techno demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import { Composer, hall, lanes, orbit, preset, room, voice } from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

const BPM = 122;
/** Milliseconds as beats at the song tempo, for deliberate microtiming. */
const ms = (value: number): number => (value * BPM) / 60_000;

/** A tiny seeded generator (mulberry32): authored variety, same every build. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Rootless voicings that keep Ab and C still while the colour shifts: Fm9,
 * Bbm9, Dbmaj9 and Cm7 over a sub that walks F, Bb, Db, C. `high` lifts the
 * top voice for the Crest (C, Db, C, Bb); `metal` holds the reply's notes.
 */
const HARMONY = {
  i: {
    root: 29,
    approach: 31,
    low: [56, 60, 63, 67],
    high: [56, 63, 67, 72],
    metal: [79, 72, 75, 77],
  },
  iv: {
    root: 34,
    approach: 32,
    low: [56, 60, 61, 65],
    high: [56, 60, 65, 73],
    metal: [77, 73, 72, 80],
  },
  VI: {
    root: 37,
    approach: 36,
    low: [56, 60, 63, 65],
    high: [56, 63, 65, 72],
    metal: [80, 75, 77, 72],
  },
  v: {
    root: 36,
    approach: 37,
    low: [55, 58, 63, 67],
    high: [55, 63, 67, 70],
    metal: [79, 70, 75, 79],
  },
} as const;
type Degree = keyof typeof HARMONY;

const SECTIONS = [
  "Signal",
  "Pulse",
  "Weave",
  "Open",
  "Air",
  "Return",
  "Crest",
  "Dissolve",
] as const;
type SectionName = (typeof SECTIONS)[number];
const sectionOf = (bar: number): SectionName =>
  SECTIONS[Math.min(7, Math.floor(bar / 8))]!;

/** Signal and Dissolve hold one chord; the rest move every two bars. */
function degreeAt(bar: number): Degree {
  const name = sectionOf(bar);
  const pair = Math.floor((bar % 8) / 2);
  if (name === "Signal" || name === "Dissolve") return "i";
  if (name === "Pulse") return pair % 2 ? "iv" : "i";
  if (name === "Air") return (["i", "VI", "iv", "v"] as const)[pair]!;
  return (["i", "iv", "VI", "v"] as const)[pair]!;
}

/** A stab: beat, length in beats, velocity. Echoes finish the rhythm. */
type Hit = readonly [beat: number, length: number, velocity: number];
const CELLS = {
  lone: [[0.75, 0.3, 0.8]],
  pair: [
    [0.5, 0.26, 0.76],
    [2.75, 0.22, 0.62],
  ],
  lift: [
    [0, 0.18, 0.46],
    [2.5 + ms(8), 0.3, 0.78],
  ],
  push: [
    [1.5, 0.24, 0.7],
    [3.75 - ms(5), 0.2, 0.64],
  ],
  roll: [
    [0.75, 0.24, 0.74],
    [2.5 + ms(8), 0.22, 0.6],
    [3.25, 0.2, 0.52],
  ],
  wash: [[0.5, 1.6, 0.6]],
  echo: [[2.75, 0.5, 0.44]],
  drift: [
    [1.75, 0.36, 0.4],
    [2.75, 0.6, 0.5],
  ],
  climb: [
    [0.5, 0.2, 0.42],
    [1.5, 0.2, 0.5],
    [2.5, 0.2, 0.6],
    [3.5, 0.22, 0.72],
  ],
  rest: [],
} as const satisfies Record<string, readonly Hit[]>;
type Cell = keyof typeof CELLS;

/** Eight bars of stab cells per section: something moves every two bars. */
const STABS: Record<SectionName, readonly Cell[]> = {
  Signal: ["lone", "echo", "lone", "echo", "lone", "echo", "lone", "push"],
  Pulse: ["lone", "pair", "lone", "pair", "lone", "pair", "lift", "push"],
  Weave: ["pair", "lift", "lone", "push", "pair", "lift", "pair", "push"],
  Open: ["pair", "lift", "roll", "push", "pair", "lift", "roll", "lone"],
  Air: ["wash", "drift", "wash", "drift", "wash", "echo", "wash", "climb"],
  Return: ["lift", "pair", "lone", "push", "lift", "pair", "roll", "push"],
  Crest: ["pair", "roll", "lift", "push", "pair", "roll", "lift", "lone"],
  Dissolve: ["lone", "rest", "lone", "echo", "lone", "rest", "rest", "rest"],
};
const STAB_GAIN: Record<SectionName, number> = {
  Signal: 0.9,
  Pulse: 0.84,
  Weave: 0.9,
  Open: 0.95,
  Air: 1,
  Return: 0.94,
  Crest: 1,
  Dissolve: 0.82,
};

/** A sub line: beat, interval above the root, length, velocity. */
type Line = readonly (readonly [number, number, number, number])[];
const BASS = {
  roll: [
    [0.5, 0, 0.42, 0.82],
    [1.5, 0, 0.28, 0.6],
    [2.5 + ms(5), 0, 0.42, 0.78],
    [3.5, 12, 0.2, 0.5],
  ],
  skip: [
    [0.5, 0, 0.4, 0.8],
    [1.75 - ms(3), 0, 0.18, 0.48],
    [2.5 + ms(5), 0, 0.36, 0.76],
    [3.25, 7, 0.18, 0.46],
    [3.5, 0, 0.24, 0.62],
  ],
  drive: [
    [0.5, 0, 0.38, 0.84],
    [1.25, 12, 0.14, 0.4],
    [1.5, 0, 0.28, 0.64],
    [2.5 + ms(5), 0, 0.4, 0.8],
    [3, 7, 0.16, 0.44],
    [3.5, 0, 0.24, 0.66],
  ],
} as const satisfies Record<string, Line>;
const BASS_PLAN: Partial<Record<SectionName, readonly (keyof typeof BASS)[]>> =
  {
    Pulse: ["roll", "roll", "roll", "skip"],
    Weave: ["roll", "skip"],
    Open: ["skip", "roll", "drive", "skip"],
    Return: ["roll", "skip", "roll", "drive"],
    Crest: ["drive", "skip", "drive", "roll"],
    Dissolve: ["roll", "roll", "skip", "roll"],
  };
/** The sub comes back alone in the breakdown, long and soft. */
const AIR_BASS: Record<number, Line> = {
  36: [[0, 0, 3.6, 0.4]],
  37: [
    [0.5, 0, 1.4, 0.34],
    [2.5, 0, 1.2, 0.38],
  ],
  38: [[0, 0, 3.6, 0.44]],
  39: [
    [0.5, 0, 0.4, 0.5],
    [1.5, 0, 0.36, 0.54],
    [2.5, 0, 0.4, 0.6],
    [3.5, -5, 0.3, 0.58],
  ],
};

/** Closed-hat rows; the gaps leave the off-beats to the open hat. */
const TICKS = [
  "42.342.342.352.3",
  "42.343.342.342.4",
  "32.342.452.342.3",
  "42.352.342.343.2",
];
/** Open hats on the off-beats: four contours that rotate every bar. */
const OPEN = [
  [0.62, 0.54, 0.66, 0.56],
  [0.6, 0.52, 0.7, 0.58],
  [0.64, 0.55, 0.62, 0.6],
  [0.6, 0.56, 0.68, 0.5],
];

const inside = (bar: number, from: number, to: number) =>
  bar >= from && bar < to;
/** The bars where a dub throw replaces the last kick and the echoes spill. */
const THROWS = [31, 47, 55];

export const nightRelay: DemoDefinition = {
  info: demoInfo({
    id: "night-relay",
    title: "Night Relay",
    style: "Deep techno",
    description:
      "Off-beat minor-ninth stabs ride a dotted-eighth echo whose tone and feedback move across the night, over a rolling FM sub, lightly swung hats, answering metal and tape hiss.",
    tempoBpm: BPM,
    key: "Fm",
    bars: 64,
    highlightBar: 40,
    trackId: "chords",
    features: [
      "909 pulse",
      "dub-chord delay ride",
      "FM sub",
      "metal sampler",
      "polymeter rim",
      "tape-hiss bed",
      "kick-triggered ducking",
    ],
    arrangement: [
      "Signal 8",
      "Pulse 8",
      "Weave 8",
      "Open 8",
      "Air 8",
      "Return 8",
      "Crest 8",
      "Dissolve 8",
    ],
    mixNotes: [
      "Kick and FM sub stay centred and dry; the sub, pad and chord echoes yield to the kick's bus trigger.",
      "Chord stabs feed a dotted-eighth ping-pong delay whose cutoff, feedback and mix are ridden by hand, with throws into Air, Crest and Dissolve.",
      "Open hats sit right with a short echo, closed hats and rim sit left; pink tape hiss and a granular pad form the back layer, loudest where the drums drop out.",
    ],
  }),
  build() {
    const s = new Composer(nightRelay.info);
    SECTIONS.forEach((name, i) => s.section(name, i * 8, 8));
    s.track(
      voice("kick", "Kick", "kit", 0.8, {
        kit: "syn909",
        fx: { duck: { orbit: 2, depth: 0.48, attack: 0.17 } },
        // The intro kick arrives behind a closed filter and opens on Pulse.
        filterAutomation: lanes([0, 360], [7.9, 1500], [8, 7000]),
      }),
    );
    s.track(
      voice("hats", "Open hats", "kit", 0.44, {
        kit: "syn909",
        pan: 0.3,
        humanize: { timing: 3, velocity: 4, seed: 46 },
        delay: { beats: 0.75, feedback: 0.28, mix: 0.1, pingpong: true },
        reverb: room,
      }),
    );
    s.track(
      voice("ticks", "Closed hats", "kit", 0.7, {
        kit: "syn909",
        pan: -0.32,
        humanize: { timing: 4, velocity: 5, seed: 42 },
        reverb: { mix: 0.05, size: 0.2, fade: 0.5 },
      }),
    );
    s.track(
      voice("perc", "Clap & rim", "kit", 0.5, {
        kit: "syn909",
        pan: -0.14,
        humanize: { timing: 2, velocity: 4, seed: 39 },
        delay: {
          beats: 0.75,
          feedback: 0.42,
          mix: 0.16,
          pingpong: true,
          highcut: 3200,
        },
        delayMixAutomation: lanes(
          [0, 0.34],
          [8, 0.16],
          [31, 0.16],
          [31.5, 0.5],
          [32, 0.46],
          [39.5, 0.46],
          [40, 0.16],
          [47.5, 0.16],
          [47.75, 0.46],
          [48, 0.18],
          [55.5, 0.18],
          [55.75, 0.5],
          [56, 0.22],
          [63, 0.32],
        ),
        reverb: room,
      }),
    );
    s.track(
      preset("bass", "Undercurrent", "fm-bass", 0.56, {
        humanize: { timing: 2, velocity: 3, seed: 29 },
        fx: orbit,
      }),
    );
    s.track(
      voice("chords", "Dub chords", "saw", 0.34, {
        pan: -0.06,
        synth: {
          attack: 0.004,
          decay: 0.2,
          sustain: 0.06,
          release: 0.28,
          lpf: 1500,
          lpq: 3,
          lpenv: 1.5,
          lpdecay: 0.14,
          hpf: 160,
          noise: 0.12,
          unison: 2,
          detune: 0.1,
          spread: 0.7,
        },
        humanize: { timing: 3, velocity: 4, seed: 122 },
        delay: {
          beats: 0.75,
          feedback: 0.5,
          mix: 0.3,
          pingpong: true,
          highcut: 2600,
        },
        reverb: hall,
        // One long dub pass: cutoff, feedback and send ridden by hand.
        filterAutomation: lanes(
          [0, 850],
          [8, 1100],
          [16, 1400],
          [24, 2100],
          [31, 3600],
          [32, 1500],
          [36, 2000],
          [39.5, 3000],
          [40, 1700],
          [47, 3000],
          [48, 2400],
          [55, 5200],
          [56, 2600],
          [60, 1800],
          [63, 1000],
        ),
        resonanceAutomation: lanes(
          [0, 0.25],
          [31, 0.45],
          [32, 0.3],
          [48, 0.3],
          [55, 0.5],
          [56, 0.3],
        ),
        delayFeedbackAutomation: lanes(
          [0, 0.62],
          [7.5, 0.66],
          [8, 0.46],
          [15, 0.55],
          [16, 0.5],
          [23, 0.58],
          [24, 0.54],
          [30.5, 0.62],
          [31.5, 0.8],
          [32, 0.68],
          [39, 0.72],
          [40, 0.5],
          [46.5, 0.6],
          [47.5, 0.8],
          [48, 0.52],
          [54.5, 0.62],
          [55.5, 0.84],
          [56, 0.56],
          [60, 0.74],
          [63, 0.6],
        ),
        delayMixAutomation: lanes(
          [0, 0.36],
          [8, 0.26],
          [24, 0.3],
          [31, 0.34],
          [31.5, 0.44],
          [32, 0.45],
          [39.5, 0.4],
          [40, 0.3],
          [48, 0.32],
          [55, 0.36],
          [55.5, 0.44],
          [56, 0.33],
          [60, 0.45],
          [63, 0.48],
        ),
        fx: {
          ...orbit,
          autofilter: {
            type: "lpf",
            cutoff: 2600,
            depth: 0.8,
            sync: 14,
            shape: "sine",
            resonance: 0.15,
          },
        },
        // The breakdown chords sustain and ring; read at each onset.
        fxAutomation: {
          "synth-gain": lanes(
            [0, 1.9],
            [7.75, 1.6],
            [8, 1.3],
            [12, 1],
            [31.75, 1],
            [32, 1.3],
            [39.75, 1.2],
            [40, 1],
            [59.75, 1],
            [60, 1.25],
          ),
          "synth-sustain": lanes([0, 0.06], [32, 0.32], [40, 0.06], [60, 0.3]),
          "synth-release": lanes([0, 0.28], [32, 0.9], [40, 0.28], [60, 1.4]),
        },
      }),
    );
    s.track(
      voice("metal", "Metal reply", "sampler", 0.85, {
        pan: 0.42,
        sampler: {
          mode: "keyed",
          voices: {
            metal: { ...bundledSampleRef("metal-hit"), fadeTime: 0.025 },
          },
        },
        humanize: { timing: 5, velocity: 6, seed: 72 },
        delay: { beats: 1.5, feedback: 0.32, mix: 0.2, pingpong: true },
        delayMixAutomation: lanes([0, 0.2], [32, 0.42], [40, 0.2]),
        reverb: room,
      }),
    );
    s.track(
      voice("air", "Soft horizon", "granular", 0.36, {
        granular: {
          src: "synth:pad",
          grain: 0.14,
          overlap: 3,
          spread: 0.9,
          scan: 0.09,
          gain: 0.9,
        },
        filter: { cutoff: 200, resonance: 0, type: "hpf" },
        reverb: hall,
        volumeAutomation: lanes(
          [0, 0.42],
          [6, 0.36],
          [8, 0.2],
          [24, 0.22],
          [31.5, 0.22],
          [32, 0.32],
          [39.5, 0.42],
          [40, 0.2],
          [55, 0.24],
          [56, 0.34],
          [62, 0.3],
          [63.9, 0],
        ),
        fx: orbit,
      }),
    );
    s.track(
      voice("hiss", "Tape hiss", "pink", 0.3, {
        synth: { attack: 0.8, sustain: 1, release: 2 },
        filter: { cutoff: 2400, resonance: 0, type: "hpf" },
        volumeAutomation: lanes(
          [0, 0.36],
          [7, 0.28],
          [8, 0.14],
          [31, 0.14],
          [32, 0.24],
          [40, 0.13],
          [56, 0.18],
          [63.9, 0],
        ),
      }),
    );

    const rand = seeded(0x4e52);
    const jitter = (amount: number) => (rand() * 2 - 1) * amount;

    for (let b = 0; b < 64; b++) {
      const name = sectionOf(b);
      const degree = degreeAt(b);
      const harmony = HARMONY[degree];
      const nextDegree = degreeAt(Math.min(63, b + 1));
      const air = name === "Air";

      // Kick: dead on the grid, filtered in the intro, out for the break.
      if (b === 32 || b === 60) s.note("kick", b, 0, 36, 0.25, 0.9);
      else if (inside(b, 4, 32) || inside(b, 40, 60)) {
        [0.92, 0.8, 0.88, 0.8].forEach((velocity, q) => {
          if (q === 3 && THROWS.includes(b)) return;
          s.note("kick", b, q, 36, 0.25, velocity * (b < 8 ? 0.86 : 1));
        });
        if ([11, 19, 27, 43, 51].includes(b))
          s.note("kick", b, 3.75, 36, 0.12, 0.34);
      }

      // Open hats on the off-beats; a crash marks Weave, Return and Crest.
      if (inside(b, 8, 32) || inside(b, 40, 60)) {
        const row = OPEN[b % 4]!;
        const gain =
          b < 12 ? 0.8 : name === "Dissolve" ? 0.95 - (b - 56) * 0.08 : 1;
        row.forEach((velocity, q) =>
          s.note("hats", b, q + 0.5, 46, 0.2, (velocity + jitter(0.02)) * gain),
        );
      } else if (b === 38 || b === 39) {
        [0, 1, 2, 3].forEach((q) =>
          s.note("hats", b, q + 0.5, 46, 0.2, 0.3 + (b - 38) * 0.2 + q * 0.05),
        );
      }
      if (b === 16 || b === 40 || b === 48)
        s.note("hats", b, 0, 49, 1, b === 40 ? 0.42 : 0.32);
      if (name === "Crest")
        for (let e = 0; e < 8; e++)
          s.note("hats", b, e / 2, 51, 0.3, e % 2 ? 0.26 : 0.38);

      // Closed hats: four rows, a three-step accent sliding over the bar.
      if (inside(b, 16, 32) || inside(b, 40, 58)) {
        const row = TICKS[(b + Math.floor(b / 8)) % 4]!;
        const gain = name === "Dissolve" ? 0.8 - (b - 56) * 0.2 : 1;
        [...row].forEach((digit, i) => {
          if (digit === ".") return;
          const accent = (b * 16 + i) % 3 === 0 ? 0.08 : 0;
          s.note(
            "ticks",
            b,
            i / 4 + (i % 2 ? 0.02 : 0),
            42,
            0.1,
            (Number(digit) / 10 + accent + jitter(0.02)) * gain,
          );
        });
      } else if (b === 39) {
        for (let i = 0; i < 16; i++)
          s.note(
            "ticks",
            b,
            i / 4 + (i % 2 ? 0.02 : 0),
            42,
            0.1,
            0.16 + i * 0.03,
          );
      }

      // Clap a few milliseconds late on two and four; rim in twelve steps.
      if (inside(b, 16, 32) || inside(b, 40, 59)) {
        const lift = name === "Crest" ? 0.06 : 0;
        s.note("perc", b, 1 + ms(8), 39, 0.15, 0.56 + lift + jitter(0.03));
        if (!(THROWS.includes(b) && b !== 55))
          s.note("perc", b, 3 + ms(9), 39, 0.15, 0.6 + lift + jitter(0.03));
      }
      const rims = new Set<number>();
      if (inside(b, 12, 32) || inside(b, 40, 60)) {
        for (let i = 0; i < 16; i++) {
          const step = (b * 16 + i) % 12;
          if (step !== 3 && step !== 10) continue;
          rims.add(i);
          const accent = (b * 16 + i) % 24 < 12 ? 0.08 : 0;
          s.note("perc", b, i / 4, 37, 0.1, 0.34 + accent + jitter(0.03));
        }
      }
      const rimFill: Record<number, readonly (readonly [number, number])[]> = {
        1: [[3.75, 0.42]],
        3: [[3.75, 0.46]],
        5: [[3.75, 0.44]],
        6: [[2.75, 0.4]],
        7: [
          [1.75, 0.38],
          [3.25, 0.46],
        ],
        15: [
          [3.25, 0.38],
          [3.5, 0.46],
        ],
        33: [[3.75, 0.42]],
        35: [[3.75, 0.4]],
        37: [[3.75, 0.44]],
      };
      for (const [beat, velocity] of rimFill[b] ?? [])
        if (!rims.has(beat * 4)) s.note("perc", b, beat, 37, 0.1, velocity);

      // Sub: off-beat roots with approach notes into each chord change.
      const plan = BASS_PLAN[name];
      const line: Line | undefined =
        b === 60
          ? [[0, 0, 3, 0.72]]
          : air
            ? AIR_BASS[b]
            : plan && b < 60
              ? BASS[plan[(b % 8) % plan.length]!]
              : undefined;
      if (line) {
        const changing = nextDegree !== degree && b % 2 === 1 && !air;
        for (const [beat, interval, length, velocity] of line) {
          if (changing && beat >= 3.25) continue;
          s.note(
            "bass",
            b,
            beat,
            harmony.root + interval,
            length,
            velocity + jitter(0.03),
          );
        }
        if (changing)
          s.note("bass", b, 3.5, HARMONY[nextDegree].approach, 0.3, 0.6);
      }

      // Dub stabs: rolled upward a few milliseconds, top voice lifted.
      const cell = STABS[name][b % 8]!;
      const voicing = name === "Crest" ? harmony.high : harmony.low;
      for (const [beat, length, velocity] of CELLS[cell]) {
        const level = velocity * STAB_GAIN[name] + jitter(0.03);
        voicing.forEach((pitch, i) =>
          s.note(
            "chords",
            b,
            beat + ms(i * 2.2),
            pitch,
            length,
            Math.min(1, level * (i === voicing.length - 1 ? 1.08 : 0.9)),
          ),
        );
      }
      if (b === 60)
        [53, 56, 60, 63, 67].forEach((pitch, i) =>
          s.note("chords", b, ms(i * 3), pitch, 6, i === 4 ? 0.8 : 0.7),
        );

      // Metal answers on chord tones: a call, then a reply a bar later.
      const [high, low, reply, tail] = harmony.metal;
      if (inside(b, 16, 32) || inside(b, 40, 58)) {
        const gain = name === "Crest" ? 1.1 : name === "Dissolve" ? 0.8 : 1;
        if (b % 2 === 0) {
          s.note("metal", b, 0.75, high, 0.3, 0.58 * gain);
          s.note("metal", b, 2.5 + ms(6), low, 0.25, 0.46 * gain);
        } else {
          s.note("metal", b, 1.25, reply, 0.22, 0.5 * gain);
          if (b % 4 === 3 || name === "Crest")
            s.note("metal", b, 3.25, tail, 0.2, 0.4 * gain);
        }
      } else if (b === 33 || b === 35 || b === 37) {
        s.note("metal", b, 1.5, high, 0.5, 0.5);
      }

      // Pad and hiss: the back layer that slips in and melts away.
      if (b % 4 === 0 && b < 56) {
        const pad =
          name === "Signal"
            ? [53, 60, 67]
            : air
              ? [60, 65, 72, 79]
              : name === "Return" || name === "Crest"
                ? [65, 72, 79]
                : [60, 65, 72];
        s.chord("air", b, 0, pad, 15.5, air ? 0.62 : 0.5);
      }
      if (b === 56) s.chord("air", b, 0, [53, 60, 67], 30, 0.5);
      if (b % 8 === 0) s.note("hiss", b, 0, 60, 32, 0.6);
    }
    return s.finish();
  },
};
