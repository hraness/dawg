/** After Hours: the deep house demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import {
  Composer,
  hall,
  lanes,
  orbit,
  preset,
  room,
  voice,
  type Phrase,
} from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

export const afterHours: DemoDefinition = {
  info: demoInfo({
    id: "after-hours",
    title: "After Hours",
    style: "Deep house",
    tempoBpm: 122,
    key: "Dm",
    bars: 64,
    highlightBar: 48,
    trackId: "keys",
    description:
      "A warm four-floor room: elastic bass, rootless Rhodes and clipped organ replies settle into a swung percussion pocket, then open into a brighter last refrain.",
    features: [
      "four-floor 909",
      "swung congas and shakers",
      "rootless Rhodes ninths",
      "organ answers",
      "syncopated bass",
      "vocal call and response",
    ],
    arrangement: [
      "Door open 8",
      "Room groove 8",
      "Rhodes refrain 8",
      "Organ reply 8",
      "Low lights 8",
      "Room return 8",
      "Open windows 8",
      "Walk home 8",
    ],
    mixNotes: [
      "The kick is steady and dry. Bass notes arrive just after it or on pickups; subtle ducking leaves the groove elastic instead of heavily pumping.",
      "Rhodes thirds, sevenths and ninths leave roots to the bass. Short organ answers and vocal cuts fill different gaps in the two-bar phrase.",
      "The middle removes kick and organ, lets the chord tails breathe, and adds shaker motion before the return. Final Rhodes voicings rise while the bass keeps its pocket.",
    ],
  }),
  build() {
    const s = new Composer(afterHours.info);
    [
      "Door open",
      "Room groove",
      "Rhodes refrain",
      "Organ reply",
      "Low lights",
      "Room return",
      "Open windows",
      "Walk home",
    ].forEach((name, i) => s.section(name, i * 8, 8));
    // House pumps less than the EDM piece: the offbeat bass does most of the work.
    s.track(
      voice("kick", "Room kick", "kit", 0.74, {
        kit: "syn909",
        fx: { duck: { orbit: 2, depth: 0.26, attack: 0.105 } },
        humanize: { velocity: 3, seed: 3 },
      }),
    );
    s.track(
      voice("drums", "Clap & hats", "kit", 0.54, {
        kit: "syn909",
        reverb: { mix: 0.035, size: 0.18, fade: 0.45 },
        humanize: { timing: 3, velocity: 6, seed: 7 },
        // Hats and claps lean in a little more with every section (the
        // lane scales the track volume).
        volumeAutomation: lanes(
          [0, 0.86],
          [8, 0.86],
          [16, 0.93],
          [24, 0.96],
          [32, 0.93],
          [40, 0.93],
          [48, 1],
          [56, 0.93],
          [63, 0.86],
        ),
      }),
    );
    s.track(
      voice("percussion", "Shaker & rim", "kit", 0.46, {
        kit: "acoustic",
        pan: 0.36,
        reverb: { mix: 0.05, size: 0.24, fade: 0.6 },
        humanize: { timing: 4, velocity: 10, seed: 5 },
        // The shaker carries the motion through Low lights.
        volumeAutomation: lanes(
          [0, 0.8],
          [8, 0.83],
          [16, 0.9],
          [32, 0.97],
          [39, 1],
          [40, 0.9],
          [48, 0.97],
          [56, 0.9],
          [63, 0.8],
        ),
      }),
    );
    // Congas: a near-harmonic hand drum tuned to the tonic and fifth, damped
    // at note-off so short strokes are muted and open tones ring.
    s.track(
      voice("hands", "Congas", "tabla", 0.4, {
        modal: {
          preset: "tabla",
          ring: 0.45,
          tilt: 0.85,
          hardness: 0.5,
          position: 0.8,
          strikebend: 0.35,
          strikedecay: 0.05,
          damp: 0.85,
          release: 0.07,
          gain: 2,
        },
        pan: -0.34,
        reverb: { mix: 0.07, size: 0.3, fade: 0.8 },
        humanize: { timing: 5, velocity: 7, seed: 11 },
        volumeAutomation: lanes(
          [0, 0.82],
          [8, 0.86],
          [16, 0.9],
          [48, 1],
          [56, 0.9],
        ),
      }),
    );
    s.track(
      preset("bass", "Elastic bass", "pluck-bass", 0.55, {
        fx: orbit,
        filter: { cutoff: 1500, resonance: 0.16 },
        volumeAutomation: lanes(
          [0, 0.88],
          [8, 0.88],
          [16, 0.94],
          [24, 0.97],
          [32, 0.9],
          [40, 0.94],
          [48, 1],
          [56, 0.94],
          [63, 0.88],
        ),
        // One long filter ride: dark in the first groove, opening through the
        // refrains, a murmur under Low lights, widest in Open windows.
        filterAutomation: lanes(
          [0, 700],
          [8, 750],
          [16, 1100],
          [31, 1500],
          [32, 450],
          [39, 900],
          [40, 1300],
          [48, 1700],
          [55, 1900],
          [56, 1400],
          [63, 700],
        ),
      }),
    );
    s.track(
      voice("keys", "Late Rhodes", "rhodes", 0.47, {
        pan: -0.16,
        reverb: room,
        fx: orbit,
        filterAutomation: lanes(
          [0, 1700],
          [15, 4200],
          [31, 5700],
          [32, 2200],
          [39, 3400],
          [40, 4600],
          [55, 6500],
          [63, 1500],
        ),
      }),
    );
    s.track(
      preset("organ", "Round organ", "jazz-organ", 0.28, {
        pan: 0.3,
        humanize: { timing: 4, velocity: 6, seed: 17 },
        filter: { type: "hpf", cutoff: 210, resonance: 0 },
        delay: { beats: 0.75, feedback: 0.17, mix: 0.11 },
        reverb: room,
        fx: orbit,
      }),
    );
    s.track(
      voice("vocal", "Hold the room", "sampler", 0.31, {
        sampler: {
          mode: "keyed",
          voices: {
            hold: {
              ...bundledSampleRef("hold-on"),
              begin: 0,
              end: 0.25,
              fit: true,
              fadeTime: 0.02,
            },
          },
        },
        filter: { type: "hpf", cutoff: 280, resonance: 0 },
        pan: 0.07,
        delay: { beats: 1.5, feedback: 0.29, mix: 0.2, pingpong: true },
        reverb: room,
        humanize: { timing: 6, velocity: 5, seed: 13 },
        // Delay throws: the last chop before the break, the lone breakdown
        // call and the last word of the outro echo out.
        delayMixAutomation: lanes(
          [0, 0.2],
          [30.6, 0.2],
          [30.65, 0.42],
          [32.9, 0.42],
          [33, 0.2],
          [36.1, 0.2],
          [36.2, 0.45],
          [38.9, 0.45],
          [39, 0.2],
          [58.1, 0.2],
          [58.2, 0.45],
        ),
        delayFeedbackAutomation: lanes(
          [0, 0.29],
          [30.6, 0.29],
          [30.65, 0.5],
          [32.9, 0.5],
          [33, 0.29],
          [36.1, 0.29],
          [36.2, 0.52],
          [38.9, 0.52],
          [39, 0.29],
          [58.1, 0.29],
          [58.2, 0.5],
        ),
      }),
    );
    s.track(
      preset("air", "Soft ceiling", "choir-pad", 0.17, {
        filter: { type: "hpf", cutoff: 500, resonance: 0 },
        reverb: hall,
        fx: orbit,
        // The pad steps forward when the kick leaves.
        volumeAutomation: lanes(
          [0, 0.72],
          [31, 0.76],
          [32, 1],
          [39, 1],
          [40, 0.76],
          [56, 0.76],
          [63, 0.88],
        ),
      }),
    );
    s.track(
      voice("bell", "Window chime", "vibes", 0.18, { pan: 0.38, reverb: hall }),
    );
    // Filtered noise swells into the groove, the return and the top refrain.
    s.track(
      voice("swell", "Tape swell", "white", 0.06, {
        filter: { cutoff: 800, resonance: 0.35 },
        reverb: hall,
        filterAutomation: lanes(
          [0, 600],
          [6, 600],
          [8, 6000],
          [36, 500],
          [39.875, 9000],
          [46, 600],
          [48, 8000],
        ),
        volumeAutomation: lanes(
          [0, 0],
          [6, 0],
          [7, 0.15],
          [7.75, 0.4],
          [8, 0],
          [36, 0],
          [37.5, 0.18],
          [39, 0.55],
          [39.85, 1],
          [39.875, 0],
          [46, 0],
          [47, 0.22],
          [47.75, 0.65],
          [48, 0],
        ),
      }),
    );
    const roots = [26, 31, 36, 33],
      chords = [
        [53, 57, 60, 64],
        [53, 57, 59, 64],
        [52, 55, 59, 62],
        [55, 58, 61, 64],
      ];
    for (let b = 0; b < 64; b++) {
      const c = b >= 56 ? 0 : Math.floor(b / 2) % 4;
      drums(s, b);
      shakerAndRim(s, b);
      congas(s, b);
      if (b % 2 === 0) {
        bassSpan(s, b, c, roots);
        keysSpan(s, b, c, chords);
        padSpan(s, b, c);
      } else organSpan(s, b, c, chords);
      if (((b >= 16 && b < 24) || (b >= 40 && b < 56)) && b % 4 === 0)
        refrain(s, b);
      vocals(s, b);
      bell(s, b);
    }
    s.note("swell", 6, 0, 60, 8, 0.7);
    s.note("swell", 36, 0, 60, 15.5, 0.7);
    s.note("swell", 46, 0, 60, 8, 0.7);
    return s.finish();
  },
};

const KICK = 36,
  RIM = 37,
  SNARE = 38,
  CLAP = 39,
  HAT = 42,
  OPEN_HAT = 46,
  CRASH = 49,
  RIDE = 51;
/** Conga tunings: open conga on the tonic, tumba on the fifth below, slap. */
const CONGA = 62,
  TUMBA = 57,
  SLAP = 64;

/** Odd 16ths sit 0.04 beat late: about 58% MPC swing at 122 BPM. */
const SWING = 0.04;
/** Beat position of 16th step `i` (0..15) with the house swing. */
const at = (i: number): number => i / 4 + (i % 2 ? SWING : 0);

/** Deterministic scatter in -0.5..0.5 for velocity and timing shading. */
function wobble(bar: number, step: number): number {
  let h = Math.imul(bar + 101, 0x9e3779b1) ^ Math.imul(step + 7, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296 - 0.5;
}

const inMiddle = (b: number): boolean => b >= 32 && b < 40;

/**
 * The 909 room: a dead-straight kick, claps a few ms early, offbeat open
 * hats shaped across the bar and choked by ghost closed hats, crashes on
 * section starts, a ride in the brightest section and phrase-end fills.
 */
function drums(s: Composer, b: number): void {
  if (b === 62) {
    s.note("kick", b, 0, KICK, 0.25, 0.72);
    s.note("drums", b, 0, CRASH, 1, 0.36);
  }
  if (b >= 62) return;
  if (inMiddle(b)) {
    // Low lights: no kick; a clap and snare swell builds over two bars and
    // stops half a beat early so the return lands in a breath of silence.
    if (b === 38)
      for (let i = 0; i < 8; i++)
        s.note("drums", b, i / 2, CLAP, 0.12, 0.12 + i * 0.025);
    if (b === 39)
      for (let i = 0; i < 14; i++)
        s.note(
          "drums",
          b,
          at(i),
          i % 4 === 0 ? CLAP : SNARE,
          0.1,
          0.22 + i * 0.03,
        );
    return;
  }
  const outro = b >= 56;
  const level =
    b < 4
      ? 0.66
      : b < 8
        ? 0.8
        : outro
          ? 0.9 - (b - 56) * 0.035
          : b < 16
            ? 0.92
            : b >= 48
              ? 0.98
              : 0.95;
  for (let beat = 0; beat < 4; beat++) {
    if (b === 31 && beat === 3) continue; // drop the last kick into the break
    s.note(
      "kick",
      b,
      beat,
      KICK,
      0.25,
      (beat % 2 ? 0.8 : 0.9) * level + wobble(b, beat) * 0.03,
    );
  }
  const crash = [8, 16, 24, 40, 48, 56].includes(b);
  if (crash)
    s.note("drums", b, 0, CRASH, 1, b === 40 || b === 48 ? 0.62 : 0.44);
  if (b >= 8 && b < 61)
    for (const beat of [1, 3])
      s.note(
        "drums",
        b,
        beat - 0.012,
        CLAP,
        0.15,
        (beat === 3 ? 0.76 : 0.7) * (outro ? 0.86 : 1) +
          wobble(b, beat + 20) * 0.05,
      );
  // Offbeat hats: closed and thin in the intro, fuller from the groove,
  // open from bar 12 so the first groove still has somewhere to go.
  if (b >= 4) {
    const open = b >= 12;
    const shape = open
      ? [0.38, 0.46, 0.4, 0.52]
      : b >= 8
        ? [0.34, 0.42, 0.36, 0.46]
        : [0.28, 0.34, 0.3, 0.38];
    shape.forEach((v, k) => {
      const soft = crash && k === 0 ? 0.75 : 1;
      const lift = k === 3 && b % 4 === 3 ? 1.18 : 1;
      s.note(
        "drums",
        b,
        at(2 + k * 4),
        open ? OPEN_HAT : HAT,
        open ? 0.22 : 0.1,
        v * soft * lift * (outro ? 0.9 : 1) + wobble(b, k + 30) * 0.05,
      );
    });
  }
  // Ghost closed hats cut the open ones short and bring out the swing.
  const ghosts =
    b >= 24 && b < 58 ? [3, 7, 11, 15] : b >= 16 && b < 58 ? [7, 15] : [];
  for (const i of ghosts) {
    if (i === 15 && b % 4 === 3) continue; // let the lifted hat ring over
    s.note("drums", b, at(i), HAT, 0.08, 0.22 + wobble(b, i + 50) * 0.08);
  }
  if (b >= 48 && b < 56)
    for (let beat = 0; beat < 4; beat++)
      s.note(
        "drums",
        b,
        beat,
        RIDE,
        0.5,
        (beat % 2 ? 0.26 : 0.32) + wobble(b, beat + 70) * 0.04,
      );
  // Phrase-end fills, each a crescendo into the next downbeat.
  const fill = (hits: readonly (readonly [number, number, number])[]) =>
    hits.forEach(([i, pitch, v]) => s.note("drums", b, at(i), pitch, 0.12, v));
  if (b === 7) fill([[15, SNARE, 0.3]]);
  if (b === 15)
    fill([
      [12, SNARE, 0.28],
      [13, SNARE, 0.36],
      [14, SNARE, 0.46],
      [15, SNARE, 0.58],
    ]);
  if (b === 23)
    fill([
      [13, 48, 0.42],
      [14, 45, 0.52],
      [15, 43, 0.6],
    ]);
  if (b === 31)
    fill([
      [10, 50, 0.4],
      [11, 48, 0.44],
      [12, 47, 0.5],
      [13, 45, 0.55],
      [14, 43, 0.6],
      [15, 41, 0.66],
    ]);
  if (b === 47)
    for (let i = 8; i < 16; i++) fill([[i, SNARE, 0.22 + (i - 8) * 0.055]]);
  if (b === 55)
    fill([
      [14, SNARE, 0.36],
      [15, SNARE, 0.5],
    ]);
}

/**
 * Shaker as swung 16ths that lean on each offbeat, plus a syncopated rim
 * part that changes every bar and turns over at phrase ends.
 */
function shakerAndRim(s: Composer, b: number): void {
  if (b >= 62) return;
  const middle = inMiddle(b);
  // Low lights breathes: 8ths only for four bars, then 16ths that rise back
  // into the return.
  const gain =
    b < 4
      ? 0.6 + b * 0.08
      : middle
        ? 0.56 + Math.max(0, b - 35) * 0.08
        : b >= 58
          ? 1 - (b - 57) * 0.12
          : 1;
  const shape = [0.2, 0.11, 0.31, 0.15];
  for (let i = 0; i < 16; i++) {
    if (b >= 32 && b < 36 && i % 2) continue;
    const lean = i >= 12 && b % 2 ? 1.12 : 1;
    s.note(
      "percussion",
      b,
      at(i),
      HAT,
      0.1,
      shape[i % 4]! * gain * lean + wobble(b, i + 40) * 0.04,
    );
  }
  if (b < 4 || (b >= 32 && b < 36) || b >= 58) return;
  const rims: readonly (readonly [number, number])[] =
    b % 8 === 7
      ? [
          [3, 0.42],
          [6, 0.34],
          [9, 0.38],
          [11, 0.4],
          [14, 0.32],
        ]
      : b % 2
        ? [
            [3, 0.4],
            [7, 0.3],
            [10, 0.36],
            [13, 0.32],
          ]
        : [
            [3, 0.42],
            [10, 0.34],
            [14, 0.38],
          ];
  for (const [i, v] of rims)
    s.note(
      "percussion",
      b,
      at(i),
      RIM,
      0.1,
      v * (middle ? 0.7 : 1) + wobble(b, i + 60) * 0.05,
    );
}

/**
 * Tumbao congas: muted heel and toe ghosts, a slap on 2, open tones on 4
 * and its &, the tumba answering in the second bar, and a run of open
 * tones at phrase ends. Open tones sit a hair late, never on a hard grid.
 */
function congas(s: Composer, b: number): void {
  if (b < 4 || b >= 61) return;
  type Stroke = readonly [
    step: number,
    pitch: number,
    len: number,
    vel: number,
  ];
  const heel = (i: number): Stroke => [i, CONGA, 0.08, 0.2];
  const toe = (i: number): Stroke => [i, CONGA, 0.08, 0.16];
  const barA: Stroke[] = [
    heel(0),
    toe(2),
    [4, SLAP, 0.06, 0.66],
    toe(6),
    heel(8),
    toe(10),
    [12, CONGA, 0.4, 0.58],
    [14, CONGA, 0.45, 0.62],
  ];
  const barB: Stroke[] = [
    [0, SLAP, 0.06, 0.56],
    toe(2),
    [4, SLAP, 0.06, 0.68],
    toe(6),
    [7, CONGA, 0.3, 0.42],
    heel(8),
    toe(10),
    [12, TUMBA, 0.45, 0.62],
    [14, CONGA, 0.4, 0.56],
    [15, CONGA, 0.35, 0.44],
  ];
  const turn: Stroke[] = [
    [8, CONGA, 0.3, 0.5],
    [9, CONGA, 0.25, 0.38],
    [10, SLAP, 0.06, 0.6],
    [11, CONGA, 0.3, 0.46],
    [12, TUMBA, 0.35, 0.62],
    [13, TUMBA, 0.3, 0.48],
    [14, TUMBA, 0.4, 0.66],
    [15, CONGA, 0.3, 0.42],
  ];
  const sparse = b < 8 || inMiddle(b) || b >= 58;
  let strokes = b % 2 ? barB : barA;
  if (sparse) strokes = strokes.filter(([, , len]) => len > 0.2);
  else if (b % 8 === 7) strokes = [...strokes.filter(([i]) => i < 8), ...turn];
  else if (b >= 48 && b < 56 && b % 2 === 0)
    strokes = [...strokes, [10, SLAP, 0.06, 0.5] as Stroke].sort(
      (x, y) => x[0] - y[0],
    );
  const gain = sparse ? 0.78 : 1;
  for (const [i, pitch, len, vel] of strokes) {
    const late = len > 0.2 ? 0.008 : 0;
    s.note(
      "hands",
      b,
      at(i) + late + wobble(b, i + 80) * 0.016,
      pitch,
      len,
      vel * gain + wobble(b, i + 90) * 0.05,
    );
  }
}

/** Swing any beat that falls on an odd 16th. */
const swung = (beat: number): number =>
  beat + (Math.round(beat * 4) % 2 ? SWING : 0);

/**
 * Two-bar bass figures over one chord: [beat 0..8, interval, length,
 * velocity]. Interval 10 is the chord's seventh (major on Cmaj9) and NEXT
 * is a half-step approach into the next chord's root. Every note ends
 * before the next kick so the pair never fights.
 */
const NEXT = 99;
type BassStep = readonly [
  beat: number,
  interval: number,
  len: number,
  vel: number,
];
const BASS: Readonly<Record<"room" | "pocket" | "walk", readonly BassStep[]>> =
  {
    room: [
      [0.5, 0, 0.42, 0.82],
      [1.75, 12, 0.18, 0.62],
      [2.5, 0, 0.36, 0.76],
      [3.5, 10, 0.22, 0.6],
      [3.75, 12, 0.16, 0.5],
      [4.5, 0, 0.42, 0.8],
      [5.5, 7, 0.22, 0.62],
      [6.5, 12, 0.3, 0.7],
      [7.5, NEXT, 0.3, 0.66],
    ],
    pocket: [
      [0, 0, 0.2, 0.62],
      [0.75, 0, 0.2, 0.78],
      [1.5, 12, 0.2, 0.6],
      [2.5, 0, 0.4, 0.78],
      [3.25, 7, 0.18, 0.56],
      [3.5, 10, 0.3, 0.64],
      [4.5, 0, 0.3, 0.8],
      [5.25, 0, 0.14, 0.4],
      [5.5, 12, 0.2, 0.66],
      [6.5, 7, 0.3, 0.7],
      [7.25, 10, 0.2, 0.56],
      [7.75, NEXT, 0.18, 0.66],
    ],
    // The seventh rising into the root, Kerri Chandler style.
    walk: [
      [0.5, 10, 0.18, 0.64],
      [0.75, 12, 0.2, 0.82],
      [1.75, 0, 0.2, 0.62],
      [2.5, 12, 0.36, 0.76],
      [3.25, 10, 0.2, 0.58],
      [3.5, 7, 0.3, 0.66],
      [4.5, 0, 0.4, 0.8],
      [5.5, 12, 0.2, 0.66],
      [5.75, 10, 0.18, 0.54],
      [6.5, 7, 0.3, 0.72],
      [7.5, NEXT, 0.3, 0.68],
    ],
  };
const SEVENTHS = [10, 10, 11, 10];

/** Bass for the two bars starting at even bar `b` over chord `c`. */
function bassSpan(
  s: Composer,
  b: number,
  c: number,
  roots: readonly number[],
): void {
  const root = roots[c]!;
  if (b === 62) {
    s.note("bass", b, 0, 26, 6, 0.6);
    return;
  }
  if (inMiddle(b)) {
    // Low lights: a pedal on D, then on A for tension, then pulsing 8ths
    // that swell and stop half a beat before the return.
    const pedal = b < 36 ? 26 : 33;
    s.note("bass", b, 0, pedal, 3.6, 0.5);
    if (b < 38) s.note("bass", b + 1, 0, pedal, 3.6, 0.44);
    else
      for (let i = 0; i < 7; i++)
        s.note("bass", b + 1, i / 2, 33, 0.3, 0.34 + i * 0.055);
    return;
  }
  if (b < 8 || b >= 60) return;
  const unit = b - (b % 4);
  const figure =
    unit >= 48 && unit < 56
      ? BASS.walk
      : [16, 20, 28, 44].includes(unit)
        ? BASS.pocket
        : BASS.room;
  const outro = b >= 56;
  const next = roots[outro ? 0 : (c + 1) % 4]!;
  for (const [beat, interval, len, vel] of figure) {
    if (outro && b === 58 && beat >= 6) break; // leave the last bar open
    const pitch =
      interval === NEXT
        ? next === root
          ? root + 7
          : next + (next > root ? -1 : 1)
        : root + (interval === 10 ? SEVENTHS[c]! : interval);
    const run = b % 8 === 6 && beat === 6.5 && !outro;
    if (run) {
      // Phrase end: a falling three-note run replaces the octave.
      s.note("bass", b, swung(6.25), root + 12, 0.15, 0.6);
      s.note("bass", b, 6.5, root + SEVENTHS[c]!, 0.15, 0.58);
      s.note("bass", b, swung(6.75), root + 7, 0.18, 0.64);
      continue;
    }
    s.note(
      "bass",
      b,
      swung(beat),
      pitch,
      len,
      vel * (outro ? 0.9 : 1) + wobble(b, beat * 4 + 120) * 0.05,
    );
  }
}

/** A Rhodes chord rolled about 6 ms per note, top voice lifted. */
function rhodes(
  s: Composer,
  b: number,
  beat: number,
  pitches: readonly number[],
  len: number,
  vel: number,
): void {
  pitches.forEach((pitch, i) =>
    s.note(
      "keys",
      b,
      swung(beat) + i * 0.012,
      pitch,
      Math.max(0.1, len - i * 0.012),
      vel * (i === pitches.length - 1 ? 1.08 : 0.9) +
        wobble(b * 5 + i, beat * 4 + 140) * 0.04,
    ),
  );
}

/**
 * Two-bar Rhodes comps: [beat, length, velocity, next?]. Stabs sit in the
 * gaps the bass leaves, and `next` anticipates the coming chord on the
 * last 16th so the change arrives early, the way house keys push.
 */
type Comp = readonly (readonly [number, number, number, boolean?])[];
const COMPS: Readonly<Record<"intro" | "room" | "pocket" | "low", Comp>> = {
  intro: [
    [0, 2.5, 0.5],
    [2.75, 0.6, 0.42],
    [4.75, 1.8, 0.46],
    [7.75, 1.2, 0.5, true],
  ],
  room: [
    [0, 1.3, 0.56],
    [1.5, 0.28, 0.42],
    [3.25, 0.45, 0.46],
    [5.25, 0.28, 0.4],
    [6, 0.4, 0.44],
    [7.75, 1.3, 0.54, true],
  ],
  pocket: [
    [0, 1.0, 0.54],
    [1.75, 0.3, 0.44],
    [3.75, 0.5, 0.48],
    [5.75, 0.3, 0.42],
    [7, 0.5, 0.46],
  ],
  low: [
    [0, 3.6, 0.52],
    [4.75, 3.0, 0.44],
  ],
};

/** Keys for the two bars starting at even bar `b` over chord `c`. */
function keysSpan(
  s: Composer,
  b: number,
  c: number,
  chords: readonly (readonly number[])[],
): void {
  if (b === 62) {
    rhodes(s, b, 0, chords[0]!, 7.5, 0.5);
    s.note("keys", b, 1.5, 69, 6, 0.36); // the fifth on top, late, to close
    return;
  }
  const open = b >= 48 && b < 56;
  const voice = (k: number) => {
    const chord = chords[k]!;
    return open ? [...chord.slice(1), chord[0]! + 12] : chord;
  };
  const outro = b >= 56;
  const unit = b - (b % 4);
  const comp = inMiddle(b)
    ? COMPS.low
    : b < 8 || outro
      ? COMPS.intro
      : [16, 20, 28, 44].includes(unit)
        ? COMPS.pocket
        : COMPS.room;
  // The previous span pushed this chord early unless it was a pocket comp,
  // the break, or the span before the break.
  const anticipated =
    b > 0 &&
    !inMiddle(b) &&
    !inMiddle(b - 2) &&
    b - 2 !== 30 &&
    ![16, 20, 28, 44].includes(b - 2 - ((b - 2) % 4));
  const nextChord = outro ? 0 : (c + 1) % 4;
  for (const [beat, len, vel, next] of comp) {
    if (beat === 0 && anticipated) continue;
    if (outro && b === 60 && beat > 4) break;
    if (next && (b === 30 || b === 38 || b === 60)) continue;
    rhodes(
      s,
      b,
      beat,
      voice(next ? nextChord : c),
      len,
      vel * (outro ? 0.88 : 1),
    );
  }
}

/**
 * The Rhodes refrain: a motif over Dm9, its answer a step lower over
 * Cmaj9, and in Open windows the same shape lifted a third to the peak.
 */
const REFRAIN: Readonly<Record<"call" | "answer" | "peak" | "home", Phrase>> = {
  call: [
    [0.75, 77, 0.4, 0.65],
    [1.5, 76, 0.7, 0.7],
    [3, 72, 0.63, 0.66],
    [4.75, 69, 0.55, 0.59],
    [6, 72, 1.1, 0.68],
  ],
  answer: [
    [0.75, 76, 0.4, 0.62],
    [1.5, 74, 0.7, 0.68],
    [3, 71, 0.63, 0.64],
    [4.75, 67, 0.55, 0.57],
    [6, 71, 1.6, 0.66],
  ],
  peak: [
    [0.75, 81, 0.4, 0.7],
    [1.5, 79, 0.5, 0.72],
    [2.25, 77, 0.4, 0.62],
    [3, 76, 0.63, 0.68],
    [4.75, 72, 0.55, 0.6],
    [5.5, 74, 0.3, 0.58],
    [6, 77, 1.4, 0.72],
  ],
  home: [
    [0.75, 79, 0.4, 0.66],
    [1.5, 76, 0.7, 0.68],
    [3, 74, 0.63, 0.64],
    [4.75, 71, 0.55, 0.58],
    [6, 72, 1.8, 0.66],
  ],
};

function refrain(s: Composer, b: number): void {
  const line =
    b >= 48
      ? b % 8 === 0
        ? REFRAIN.peak
        : REFRAIN.home
      : b % 8 === 0
        ? REFRAIN.call
        : REFRAIN.answer;
  for (const [beat, pitch, len, vel = 0.7] of line)
    s.note(
      "keys",
      b,
      swung(beat) + 0.006,
      pitch,
      len,
      vel * 0.86 + wobble(b, beat * 4 + 160) * 0.04,
    );
}

/** Organ answers on the second bar of each chord: [beat, length, velocity]. */
type Stab = readonly [beat: number, len: number, vel: number];
const ORGAN: readonly (readonly Stab[])[] = [
  [
    [1.25, 0.3, 0.6],
    [3.25, 0.4, 0.52],
  ],
  [
    [0.5, 0.22, 0.5],
    [1.25, 0.25, 0.58],
    [2, 0.6, 0.6],
  ],
  [
    [1.25, 0.3, 0.58],
    [2.75, 0.22, 0.48],
    [3.5, 0.4, 0.56],
  ],
  [
    [0.75, 0.25, 0.52],
    [2.25, 0.3, 0.58],
    [3.25, 0.45, 0.6],
  ],
];

/** Organ for odd bar `b`: clipped upper-structure stabs, fuller at the top. */
function organSpan(
  s: Composer,
  b: number,
  c: number,
  chords: readonly (readonly number[])[],
): void {
  if (!((b >= 24 && b < 32) || (b >= 44 && b < 56))) return;
  const top = b >= 48;
  const chord = chords[c]!;
  const pitches = (top ? chord : chord.slice(0, 3)).map((n) => n + 12);
  const k = ((b - 1) / 2 + (b >= 44 ? 1 : 0) + (top ? 1 : 0)) % 4;
  for (const [beat, len, vel] of ORGAN[k]!)
    pitches.forEach((pitch, i) =>
      s.note(
        "organ",
        b,
        swung(beat) + 0.01 + i * 0.006,
        pitch,
        len,
        vel * (i === pitches.length - 1 ? 1.05 : 0.95) +
          wobble(b * 3 + i, beat * 4 + 180) * 0.04,
      ),
    );
}

/** "Hold on" chops: a call over G13, an answer over A7b9, lifted at the top. */
const VOCAL: Readonly<Record<"call" | "answer" | "lift" | "far", Phrase>> = {
  call: [
    [0.75, 65, 0.52, 0.68],
    [2.5, 69, 0.48, 0.56],
  ],
  answer: [
    [0.75, 69, 0.4, 0.62],
    [1.75, 67, 0.28, 0.5],
    [2.5, 64, 0.6, 0.58],
  ],
  lift: [
    [0.75, 69, 0.4, 0.68],
    [1.5, 71, 0.5, 0.64],
    [2.5, 69, 0.5, 0.58],
  ],
  far: [[0.75, 69, 0.9, 0.52]],
};

function vocals(s: Composer, b: number): void {
  const sung = ((b >= 16 && b < 32) || (b >= 40 && b < 56)) && b % 4 === 2;
  const line =
    b === 36 || b === 58
      ? VOCAL.far
      : !sung
        ? undefined
        : b % 8 === 6
          ? VOCAL.answer
          : b >= 48
            ? VOCAL.lift
            : VOCAL.call;
  if (!line) return;
  // A singer sits a touch behind the beat.
  for (const [beat, pitch, len, vel = 0.6] of line)
    s.note(
      "vocal",
      b,
      swung(beat) + 0.02,
      pitch,
      len,
      vel + wobble(b, beat * 4 + 200) * 0.04,
    );
}

/** Pad voicings that move by step with the Rhodes: Dm9, G13, Cmaj9, A7b9. */
const PAD = [
  [69, 72, 76],
  [69, 71, 76],
  [67, 71, 74],
  [67, 70, 73],
];

function padSpan(s: Composer, b: number, c: number): void {
  if (b >= 56) {
    // The outro holds one chord and lets it fade.
    if (b === 56 || b === 60) s.chord("air", b, 0, PAD[0]!, 16, 0.46);
    return;
  }
  const vel = b < 8 ? 0.42 : inMiddle(b) ? 0.5 : b >= 48 ? 0.52 : 0.47;
  s.chord("air", b, 0, PAD[c]!, 8, vel);
}

/** The window chime: a two-note figure that grows, then resolves to D. */
const BELLS: Readonly<Record<number, Phrase>> = {
  0: [
    [0.75, 81, 0.9, 0.42],
    [2.75, 76, 1.2, 0.35],
  ],
  16: [
    [0.75, 81, 0.9, 0.4],
    [2.75, 76, 0.7, 0.33],
    [5.5, 77, 1.4, 0.3],
  ],
  32: [
    [0.75, 77, 1.5, 0.38],
    [2.75, 76, 1, 0.32],
    [4.75, 72, 2, 0.3],
  ],
  40: [
    [0.75, 81, 0.9, 0.42],
    [2.75, 76, 1.2, 0.35],
  ],
  48: [
    [0.75, 84, 0.7, 0.4],
    [1.5, 81, 0.7, 0.36],
    [2.75, 76, 1.2, 0.34],
  ],
  60: [
    [0.75, 81, 1, 0.36],
    [2.75, 77, 1, 0.32],
    [4.75, 74, 3, 0.3],
  ],
};

function bell(s: Composer, b: number): void {
  const line = BELLS[b];
  if (line) s.phrase("bell", b, line);
}
