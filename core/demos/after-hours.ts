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
      voice("drums", "Clap & hats", "kit", 0.5, {
        kit: "syn909",
        reverb: { mix: 0.035, size: 0.18, fade: 0.45 },
        humanize: { timing: 3, velocity: 6, seed: 7 },
      }),
    );
    s.track(
      voice("percussion", "Shaker & rim", "kit", 0.42, {
        kit: "acoustic",
        pan: 0.27,
        reverb: { mix: 0.05, size: 0.24, fade: 0.6 },
        humanize: { timing: 4, velocity: 10, seed: 5 },
      }),
    );
    // Congas: a near-harmonic hand drum tuned to the tonic and fifth, damped
    // at note-off so short strokes are muted and open tones ring.
    s.track(
      voice("hands", "Congas", "tabla", 0.36, {
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
        pan: -0.26,
        reverb: { mix: 0.07, size: 0.3, fade: 0.8 },
        humanize: { timing: 5, velocity: 7, seed: 11 },
      }),
    );
    s.track(
      preset("bass", "Elastic bass", "pluck-bass", 0.55, {
        fx: orbit,
        filter: { cutoff: 1500, resonance: 0.16 },
      }),
    );
    s.track(
      voice("keys", "Late Rhodes", "rhodes", 0.47, {
        pan: -0.13,
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
        pan: 0.2,
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
      }),
    );
    s.track(
      preset("air", "Soft ceiling", "choir-pad", 0.13, {
        filter: { type: "hpf", cutoff: 500, resonance: 0 },
        reverb: hall,
        fx: orbit,
      }),
    );
    s.track(
      voice("bell", "Window chime", "vibes", 0.18, { pan: 0.31, reverb: hall }),
    );
    const roots = [26, 31, 36, 33],
      chords = [
        [53, 57, 60, 64],
        [53, 57, 59, 64],
        [52, 55, 59, 62],
        [55, 58, 61, 64],
      ];
    const refrain: Phrase = [
      [0.75, 77, 0.4, 0.65],
      [1.5, 76, 0.7, 0.7],
      [3, 72, 0.63, 0.66],
      [4.75, 69, 0.55, 0.59],
      [6, 72, 1.1, 0.68],
    ];
    for (let b = 0; b < 64; b++) {
      const middle = b >= 32 && b < 40,
        outro = b >= 56,
        c = outro ? 0 : Math.floor(b / 2) % 4,
        chord = chords[c]!,
        root = roots[c]!;
      drums(s, b);
      shakerAndRim(s, b);
      congas(s, b);
      if (b >= 8 && !middle && b < 60) {
        s.phrase("bass", b, [
          [0.5, root, 0.38, 0.8],
          [1.75, root + 7, 0.22, 0.61],
          [2.5, root + 12, 0.4, 0.72],
          [3.5, root + (b % 2 ? 10 : 7), 0.25, 0.58],
        ]);
      } else if (middle && b % 4 === 0) s.note("bass", b, 0, root, 2.6, 0.42);
      if (b < 62) {
        const voicing =
          b >= 48 && b < 56 ? [...chord.slice(1), chord[0]! + 12] : chord;
        s.chord(
          "keys",
          b,
          b % 2 ? 0.56 : 0.04,
          voicing,
          middle ? 2.7 : 0.9,
          middle ? 0.54 : 0.58,
        );
        if (!middle && b >= 8 && !outro)
          s.chord("keys", b, 2.78, voicing, 0.48, 0.43);
      }
      if (((b >= 16 && b < 24) || (b >= 40 && b < 56)) && b % 4 === 0)
        s.phrase("keys", b, refrain, 0, 0.82);
      if (((b >= 24 && b < 32) || (b >= 44 && b < 56)) && b % 2 === 1) {
        s.chord(
          "organ",
          b,
          1.27,
          chord.slice(0, 3).map((n) => n + 12),
          0.31,
          0.59,
        );
        s.chord(
          "organ",
          b,
          3.28,
          chord.slice(0, 3).map((n) => n + 12),
          0.39,
          0.52,
        );
      }
      if (((b >= 16 && b < 32) || (b >= 40 && b < 56)) && b % 4 === 2) {
        s.note("vocal", b, 0.75, 65, 0.52, 0.68);
        s.note("vocal", b, 2.5, 69, 0.48, 0.54);
      }
      if (b % 8 === 0)
        s.chord(
          "air",
          b,
          0,
          [chord[0]! + 12, chord[2]! + 12, chord[3]! + 12],
          middle ? 15 : 7.5,
          0.51,
        );
      if ([0, 16, 32, 40, 48, 60].includes(b))
        s.phrase("bell", b, [
          [0.75, 81, 0.9, 0.42],
          [2.75, 76, 1.2, 0.35],
        ]);
      if (b === 62) {
        s.chord("keys", b, 0, chords[0]!, 7.5, 0.45);
        s.note("bass", b, 0, 26, 5, 0.5);
      }
    }
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
    b < 4 ? 0.66 : b < 8 ? 0.8 : outro ? 0.9 - (b - 56) * 0.035 : 0.95;
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
  // Offbeat hats: closed and thin in the intro, open from the groove on.
  if (b >= 4) {
    const open = b >= 8;
    const shape = open ? [0.38, 0.46, 0.4, 0.52] : [0.28, 0.34, 0.3, 0.38];
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
  const gain =
    b < 4 ? 0.6 + b * 0.08 : middle ? 0.62 : b >= 58 ? 1 - (b - 57) * 0.12 : 1;
  const shape = [0.2, 0.11, 0.31, 0.15];
  for (let i = 0; i < 16; i++) {
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
