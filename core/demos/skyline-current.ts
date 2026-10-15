/** Skyline Current: the melodic EDM demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import {
  BAR,
  Composer,
  hall,
  lanes,
  machineTracks,
  orbit,
  preset,
  room,
  voice,
  type Phrase,
} from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

/** Beats per millisecond at 128 BPM (one beat is 468.75 ms). */
const MS = 128 / 60000;

type Harmony = Readonly<{
  root: number;
  chord: readonly number[];
  /** The added ninth the second drop stacks on top of the saw chord. */
  nine: number;
}>;
const BM: Harmony = { root: 35, chord: [59, 62, 66], nine: 73 };
const G: Harmony = { root: 31, chord: [59, 62, 67], nine: 69 };
const D: Harmony = { root: 38, chord: [57, 62, 66], nine: 76 };
const A: Harmony = { root: 33, chord: [57, 61, 64], nine: 71 };
const ASUS: Harmony = { root: 33, chord: [57, 62, 64], nine: 71 };
const LOOP = [BM, BM, G, G, D, D, A, A] as const;

/** i-VI-III-VII in two-bar steps; both rises and the peak lean on VI-VII-i. */
function harmonyAt(bar: number): Harmony {
  if ([16, 17, 56, 57].includes(bar)) return G;
  if (bar === 18 || bar === 46) return ASUS;
  if ([19, 58, 59].includes(bar)) return A;
  if (bar >= 60) return BM;
  // Drop one starts its loop on i, so the rise lands VI-VII-i and each
  // hook phrase sits on the chord it was written for.
  if (bar >= 20 && bar < 28) return LOOP[bar - 20]!;
  return LOOP[bar % 8]!;
}

/** Small seeded generator (mulberry32): ghost notes vary, renders do not. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The hook: a syncopated 3-3-2 call (F#-A-B) that the answers develop.
const call: Phrase = [
  [0, 78, 0.7, 0.84],
  [0.75, 81, 0.7, 0.76],
  [1.5, 83, 1.4, 0.92],
  [3, 81, 0.45, 0.74],
  [3.5, 78, 0.45, 0.72],
  [4, 76, 0.7, 0.8],
  [4.75, 78, 0.7, 0.74],
  [5.5, 74, 2.2, 0.86],
];
/** Over VI: reaches up to D and leaves the major seventh hanging. */
const lift: Phrase = [
  [0, 78, 0.7, 0.82],
  [0.75, 81, 0.7, 0.74],
  [1.5, 83, 1, 0.88],
  [2.5, 86, 0.9, 0.9],
  [3.5, 83, 0.45, 0.74],
  [4, 81, 0.7, 0.8],
  [4.75, 79, 0.7, 0.74],
  [5.5, 78, 2.2, 0.84],
];
/** Over III: the call again, opening onto A instead of closing on D. */
const open: Phrase = [...call.slice(0, 7), [5.5, 81, 2.2, 0.86]];
/** Over VII (sus4 resolving on beat 3): climbs to C#, settles on the third. */
const answer: Phrase = [
  [0, 76, 0.7, 0.8],
  [0.75, 78, 0.7, 0.74],
  [1.5, 81, 1, 0.86],
  [2.5, 85, 0.9, 0.92],
  [3.5, 83, 0.45, 0.76],
  [4, 81, 0.7, 0.8],
  [4.75, 78, 0.7, 0.72],
  [5.5, 76, 0.5, 0.76],
  [6, 73, 1.7, 0.82],
];
/** Second drop, over III: the call keeps climbing to the octave. */
const soar: Phrase = [
  [0, 78, 0.7, 0.84],
  [0.75, 81, 0.7, 0.78],
  [1.5, 83, 1, 0.9],
  [2.5, 86, 0.9, 0.92],
  [3.5, 85, 0.45, 0.76],
  [4, 83, 0.7, 0.8],
  [4.75, 85, 0.7, 0.78],
  [5.5, 86, 2.2, 0.9],
];
/** Second drop, over VII: the answer an octave of energy higher. */
const answerHigh: Phrase = [
  [0, 81, 0.7, 0.82],
  [0.75, 83, 0.7, 0.76],
  [1.5, 85, 1, 0.88],
  [2.5, 88, 0.9, 0.94],
  [3.5, 86, 0.45, 0.78],
  [4, 86, 0.7, 0.82],
  [4.75, 85, 0.7, 0.76],
  [5.5, 88, 0.5, 0.8],
  [6, 85, 1.7, 0.86],
];
/** The peak over VI-VII: E6 then F#6, before the lead lands home on B. */
const peakVI: Phrase = [
  [0, 83, 0.7, 0.86],
  [0.75, 86, 0.7, 0.8],
  [1.5, 88, 1, 0.92],
  [2.5, 86, 0.9, 0.86],
  [3.5, 83, 0.45, 0.76],
  [4, 86, 0.7, 0.84],
  [4.75, 83, 0.7, 0.76],
  [5.5, 79, 2.2, 0.86],
];
const peakVII: Phrase = [
  [0, 85, 0.7, 0.88],
  [0.75, 88, 0.7, 0.82],
  [1.5, 90, 1, 0.96],
  [2.5, 88, 0.9, 0.88],
  [3.5, 85, 0.45, 0.78],
  [4, 86, 0.7, 0.84],
  [4.75, 85, 0.7, 0.78],
  [5.5, 81, 0.5, 0.8],
  [6, 85, 1.7, 0.88],
];
const SENTENCE = [call, lift, open, answer] as const;
const SENTENCE_2 = [call, lift, soar, answerHigh] as const;

/** 3-3-2 across sixteen steps: the progressive-house pluck rhythm. */
const TRESILLO = [0, 3, 6, 8, 11, 14];
/** Snare roll step (in beats) per bar of each rise. */
const ROLL: Readonly<Record<number, number>> = {
  16: 1,
  17: 0.5,
  18: 0.25,
  19: 0.125,
  40: 1,
  41: 1,
  42: 1,
  43: 1,
  44: 0.5,
  45: 0.5,
  46: 0.25,
  47: 0.125,
};

export const skylineCurrent: DemoDefinition = {
  info: demoInfo({
    id: "skyline-current",
    title: "Skyline Current",
    style: "Melodic EDM",
    tempoBpm: 128,
    key: "Bm",
    bars: 64,
    highlightBar: 48,
    trackId: "lead",
    description:
      "A syncopated F#-A-B hook passes from vibes to pluck to piano before it lands on a layered supersaw lead over pumping saw chords. Two snare-and-riser builds end in a silent beat; the second drop climbs the hook to a VI-VII-i peak.",
    features: [
      "layered supersaw lead",
      "kick-triggered sidechain",
      "3-3-2 pluck arpeggio",
      "accelerating snare build",
      "piano and vocal-pad breakdown",
      "second-drop melodic climb",
    ],
    arrangement: [
      "Horizon 8",
      "Gather 8",
      "First rise 4",
      "First drop 8",
      "Afterimage 4",
      "Open air 8",
      "Long rise 8",
      "Second drop 8",
      "High current 4",
      "Home 4",
    ],
    mixNotes: [
      "The sub rolls on the offbeats between kicks and ducks with the saw chords and lead; a narrow core saw and a wide seven-voice layer share the lead, and its filter opens across each drop.",
      "Hats sit a few milliseconds behind the grid and claps a few ahead, with a quiet snare under the clap; ghost sixteenths, open hats and a ride arrive in four-bar steps so each drop keeps growing.",
      "Both rises go quarters, eighths, sixteenths and thirty-seconds over filtered sus4 saw stabs and an octave pitch riser, then leave a silent beat; the breakdown hands the hook to a pedalled piano.",
    ],
  }),
  build() {
    const s = new Composer(skylineCurrent.info);
    for (const [name, start, bars] of [
      ["Horizon", 0, 8],
      ["Gather", 8, 8],
      ["First rise", 16, 4],
      ["First drop", 20, 8],
      ["Afterimage", 28, 4],
      ["Open air", 32, 8],
      ["Long rise", 40, 8],
      ["Second drop", 48, 8],
      ["High current", 56, 4],
      ["Home", 60, 4],
    ] as const)
      s.section(name, start, bars);
    machineTracks(s, "syn909", 0.8);
    s.tracks[0] = voice("kick", "Current kick", "kit", 0.8, {
      kit: "syn909",
      fx: { duck: { orbit: 2, depth: 0.67, attack: 0.19 } },
    });
    s.tracks[1] = voice("drums", "Clap & hats", "kit", 0.52, {
      kit: "syn909",
      reverb: { mix: 0.05, size: 0.22, fade: 0.6 },
      humanize: { timing: 3, velocity: 7, seed: 11 },
    });
    s.track(
      voice("build", "Rise snare", "kit", 0.38, {
        kit: "syn909",
        reverb: { mix: 0.16, size: 0.42, fade: 1.2 },
        humanize: { timing: 2, velocity: 5, seed: 5 },
        filterAutomation: lanes(
          [0, 900],
          [16, 1100],
          [19.5, 7400],
          [20, 900],
          [40, 900],
          [47.5, 8600],
          [48, 900],
        ),
      }),
    );
    s.track(
      voice("sub", "Root current", "sine", 0.58, {
        synth: { attack: 0.004, decay: 0.16, sustain: 0.82, release: 0.08 },
        fx: {
          ...orbit,
          distort: { type: "soft", drive: 0.8, mix: 0.24, tone: 1000 },
        },
      }),
    );
    s.track(
      voice("chords", "Wide skyline", "supersaw", 0.16, {
        synth: {
          attack: 0.012,
          decay: 0.2,
          sustain: 0.61,
          release: 0.2,
          unison: 5,
          detune: 0.21,
          spread: 0.9,
          lpf: 6500,
        },
        filter: { type: "hpf", cutoff: 270, resonance: 0 },
        reverb: room,
        fx: orbit,
        humanize: { timing: 2, velocity: 4, seed: 7 },
        fxAutomation: {
          "synth-lpf": lanes(
            [0, 900],
            [18, 900],
            [19.9, 6200],
            [20, 6500],
            [43.9, 6500],
            [44, 800],
            [47.4, 7400],
            [48, 6800],
            [56, 7600],
            [64, 7600],
          ),
        },
      }),
    );
    s.track(
      preset("arp", "Horizon pluck", "house-pluck", 0.28, {
        pan: -0.16,
        delay: { beats: 0.75, feedback: 0.27, mix: 0.18, pingpong: true },
        // Delay throws: the last pluck notes before each silent beat echo on.
        delayFeedbackAutomation: lanes(
          [0, 0.27],
          [19, 0.27],
          [19.7, 0.6],
          [20, 0.27],
          [46.9, 0.27],
          [47.45, 0.6],
          [48, 0.27],
        ),
        delayMixAutomation: lanes(
          [0, 0.18],
          [19, 0.18],
          [19.7, 0.32],
          [20, 0.18],
          [46.9, 0.18],
          [47.45, 0.32],
          [48, 0.18],
        ),
        reverb: room,
        fx: orbit,
        humanize: { timing: 3, velocity: 7, length: 8, seed: 3 },
        filterAutomation: lanes(
          [0, 1300],
          [15, 3700],
          [19, 7100],
          [20, 2700],
          [31, 2400],
          [32, 1100],
          [39, 1800],
          [47, 8300],
          [48, 3200],
          [59, 5600],
          [63, 700],
        ),
      }),
    );
    s.track(
      voice("lead", "Skyline theme", "supersaw", 0.2, {
        synth: {
          attack: 0.008,
          decay: 0.14,
          sustain: 0.6,
          release: 0.18,
          unison: 3,
          detune: 0.11,
          spread: 0.3,
          lpf: 7800,
        },
        filter: { type: "hpf", cutoff: 420, resonance: 0 },
        delay: { beats: 0.75, feedback: 0.24, mix: 0.13, pingpong: true },
        reverb: room,
        fx: orbit,
        humanize: { timing: 2, velocity: 3, seed: 9 },
        fxAutomation: {
          "synth-lpf": lanes(
            [0, 3600],
            [20, 3600],
            [24, 7800],
            [28, 7800],
            [48, 5200],
            [52, 8800],
            [56, 9800],
            [64, 9800],
          ),
        },
      }),
    );
    s.track(
      voice("wide", "Skyline width", "supersaw", 0.12, {
        synth: {
          attack: 0.012,
          decay: 0.2,
          sustain: 0.65,
          release: 0.22,
          unison: 7,
          detune: 0.28,
          spread: 1,
          lpf: 6400,
        },
        filter: { type: "hpf", cutoff: 300, resonance: 0 },
        reverb: hall,
        fx: orbit,
      }),
    );
    s.track(
      voice("vowel", "Open-air choir", "sampler", 0.18, {
        sampler: {
          mode: "keyed",
          voices: {
            ah: {
              ...bundledSampleRef("vowel-ah"),
              fit: true,
              fadeTime: 0.15,
              fadeInTime: 0.08,
            },
          },
        },
        filter: { type: "hpf", cutoff: 490, resonance: 0 },
        reverb: hall,
        fx: orbit,
        humanize: { timing: 6, velocity: 5, seed: 4 },
      }),
    );
    s.track(
      voice("piano", "Open-air piano", "ballad", 0.32, {
        pan: 0.08,
        // Keeps the hammer thump below the lowest note (G2) out of the sub.
        filter: { type: "hpf", cutoff: 75, resonance: 0 },
        reverb: hall,
        humanize: { timing: 8, velocity: 7, length: 5, seed: 2 },
        pedal: [32, 34, 36, 38, 40, 42, 60, 62].flatMap((bar) => [
          { tick: bar * BAR - 24, state: "up" as const },
          { tick: bar * BAR + 12, state: "down" as const },
        ]),
      }),
    );
    s.track(
      voice("rise", "Air lift", "white", 0.08, {
        synth: { attack: 0.7, decay: 0.2, sustain: 0.7, release: 0.15 },
        filter: { type: "hpf", cutoff: 1800, resonance: 0 },
        reverb: room,
        // Short swells into Gather and the breakdown, long ones into the drops.
        volumeAutomation: lanes(
          [0, 0.01],
          [6, 0.01],
          [7.95, 0.07],
          [8, 0.01],
          [16, 0.02],
          [19, 0.11],
          [20, 0.01],
          [30, 0.01],
          [31.95, 0.05],
          [32, 0.01],
          [40, 0.01],
          [43, 0.05],
          [47, 0.14],
          [48, 0.01],
          [63, 0.01],
        ),
        fxAutomation: {
          "synth-lpf": lanes(
            [0, 1800],
            [6, 1800],
            [7.95, 7000],
            [8, 1800],
            [16, 2400],
            [19, 11000],
            [20, 1800],
            [30, 1800],
            [31.95, 6000],
            [32, 1800],
            [40, 1600],
            [47, 13000],
            [48, 1800],
          ),
        },
      }),
    );
    s.track(
      voice("lift", "Pitch riser", "supersaw", 0.06, {
        synth: {
          attack: 1.4,
          decay: 0.2,
          sustain: 1,
          release: 0.35,
          unison: 5,
          detune: 0.3,
          spread: 1,
          lpf: 6000,
        },
        filter: { type: "hpf", cutoff: 600, resonance: 0 },
        reverb: hall,
      }),
    );
    s.track(
      voice("impact", "Bright landing", "kit", 0.27, {
        kit: "syn909",
        reverb: hall,
      }),
    );
    s.track(
      voice("bell", "Last horizon", "vibes", 0.2, {
        pan: 0.27,
        reverb: hall,
        humanize: { timing: 6, velocity: 8, seed: 6 },
      }),
    );

    const hit = (
      bar: number,
      step: number,
      pitch: number,
      velocity: number,
      ms = 0,
    ) => s.note("drums", bar, step / 4 + ms * MS, pitch, 0.13, velocity);
    const ghost = seeded(128);
    /** 0 kick and hats, 1 adds the clap, 2 the drop kit, 3 ghosts, 4 ride. */
    const groove = (bar: number, level: number) => {
      s.grid("kick", bar, 36, "9...8...9...8...", level >= 2 ? 1 : 0.74);
      const lift = level >= 2 ? 1 : 0.85;
      [2, 6, 10, 14].forEach((step, i) =>
        hit(bar, step, 42, [0.52, 0.6, 0.5, 0.64][i]! * lift, 4),
      );
      if (level >= 2) {
        hit(bar, 6, 46, 0.42, 5);
        hit(bar, 14, 46, 0.5, 5);
      }
      if (level >= 1) {
        hit(bar, 4, 39, level >= 2 ? 0.8 : 0.6, -4);
        hit(bar, 12, 39, level >= 2 ? 0.86 : 0.66, -4);
      }
      if (level >= 2) {
        hit(bar, 4, 38, 0.3, -2);
        hit(bar, 12, 38, 0.34, -2);
      }
      // Ghost sixteenths breathe like a player's: louder before the beat,
      // a little different every bar, and the odd one left out.
      if (level >= 3)
        for (const step of [1, 3, 5, 7, 9, 11, 13, 15]) {
          const r = ghost();
          if (r < 0.12 && step % 4 === 1) continue;
          hit(
            bar,
            step,
            42,
            (step % 4 === 3 ? 0.3 : 0.17) * (0.82 + r * 0.36),
            6,
          );
        }
      if (level >= 4)
        for (const step of [0, 4, 8, 12])
          hit(bar, step, 51, step % 8 ? 0.24 : 0.3, 2);
    };
    const kicks = (bar: number, velocity: number) =>
      [0, 1, 2, 3].forEach((beat) =>
        s.note("kick", bar, beat, 36, 0.13, velocity * (beat % 2 ? 0.9 : 1)),
      );
    const arpTones = (h: Harmony) => [
      h.chord[0]! + 12,
      h.chord[2]! + 12,
      h.chord[1]! + 12,
      h.chord[2]! + 24,
    ];
    const arp = (bar: number, mode: "332" | "8" | "16", gain: number) => {
      const tones = arpTones(harmonyAt(bar));
      if (mode === "332")
        TRESILLO.forEach((step, i) =>
          s.note(
            "arp",
            bar,
            step / 4,
            tones[[0, 1, 2, 3, 1, 2][i]!]!,
            0.55,
            [0.66, 0.5, 0.58, 0.64, 0.48, 0.56][i]! * gain,
          ),
        );
      else if (mode === "8")
        for (let i = 0; i < 8; i++)
          s.note(
            "arp",
            bar,
            i / 2,
            tones[i % 4]!,
            0.3,
            (i % 4 === 0 ? 0.62 : 0.44) * gain,
          );
      else
        for (let i = 0; i < 16; i++)
          s.note(
            "arp",
            bar,
            i / 4,
            tones[i % 4]!,
            0.18,
            (TRESILLO.includes(i) ? 0.6 : 0.36) * gain,
          );
    };
    /** The lead plus its wide layer, with vibrato and a scoop on long notes. */
    const leadLine = (bar: number, phrase: Phrase, gain = 1) =>
      phrase.forEach(([beat, pitch, length, velocity = 0.8], i) => {
        const prev = phrase[i - 1];
        const scoop = prev !== undefined && length >= 0.9;
        s.note("lead", bar, beat, pitch, length, Math.min(1, velocity * gain), {
          ...(length >= 1.3
            ? { vibrato: { rate: 5.4, depth: 16, delay: 0.3 } }
            : {}),
          ...(scoop ? { glide: 0.03 } : {}),
        });
        s.note("wide", bar, beat, pitch, length, velocity * gain * 0.9);
      });
    /** Saw chord stack for one bar; the VII bar before i suspends, then resolves. */
    const sawChord = (bar: number, velocity: number, nine: boolean) => {
      const h = harmonyAt(bar);
      const stack = (x: Harmony) => [
        ...x.chord,
        x.chord[0]! + 12,
        ...(nine ? [x.nine] : []),
      ];
      if (harmonyAt(bar + 1) === BM && h === A) {
        s.chord("chords", bar, 0, stack(ASUS), 1.9, velocity);
        s.chord("chords", bar, 2, stack(A), 1.65, velocity * 0.96);
      } else s.chord("chords", bar, 0, stack(h), 3.65, velocity);
    };
    /** Offbeat sub between the kicks; the last eighth anticipates a new root. */
    const rollingSub = (bar: number, gain: number) => {
      const root = harmonyAt(bar).root,
        next = harmonyAt(bar + 1).root;
      [0.5, 1.5, 2.5, 3.5].forEach((beat, i) =>
        s.note(
          "sub",
          bar,
          beat,
          i === 3 && next !== root ? next : root,
          0.42,
          [0.82, 0.74, 0.8, 0.76][i]! * gain,
        ),
      );
    };
    /**
     * Two bars of ballad piano: an open left hand (root, fifth, octave
     * spread over the bar instead of stacked) under a right-hand chord
     * rolled upward over about 20 ms with the top note lifted.
     */
    const pianoChord = (bar: number, gain: number) => {
      const h = harmonyAt(bar);
      const rolled = (beat: number, velocity: number, length: number) =>
        h.chord.forEach((pitch, i) =>
          s.note(
            "piano",
            bar,
            beat + 0.03 + i * 0.022,
            pitch,
            length,
            velocity * (i === h.chord.length - 1 ? 1.12 : 0.9),
          ),
        );
      s.note("piano", bar, 0, h.root + 12, 7.6, 0.5 * gain);
      s.note("piano", bar, 1.5, h.root + 19, 1.6, 0.3 * gain);
      s.note("piano", bar, 3, h.root + 24, 1.2, 0.26 * gain);
      s.note("piano", bar, 5, h.root + 19, 2.4, 0.26 * gain);
      rolled(0, 0.34 * gain, 3.8);
      rolled(4, 0.3 * gain, 3.6);
    };

    for (let b = 0; b < 64; b++) {
      const h = harmonyAt(b),
        drop1 = b >= 20 && b < 28,
        drop2 = b >= 48 && b < 60,
        drop = drop1 || drop2,
        build = b in ROLL,
        air = b >= 32 && b < 40,
        last = b >= 60;

      // Drums.
      if (b >= 8 && b < 16) groove(b, b < 12 ? 0 : 1);
      if (drop1) groove(b, b < 24 ? 2 : 3);
      if (b >= 48 && b < 56) groove(b, 3);
      if (b >= 56 && b < 60) groove(b, 4);
      if (b >= 28 && b < 32) groove(b, 1);
      if (b >= 16 && b < 19) kicks(b, 0.62 - (b - 16) * 0.04);
      if (b >= 44 && b < 47) kicks(b, 0.5 + (b - 44) * 0.06);
      if (b === 23 || b === 51)
        [13, 14, 15].forEach((step, i) =>
          hit(b, step, 39, [0.32, 0.42, 0.54][i]!, -3),
        );
      if ([27, 55, 59].includes(b)) s.fill(b, "drums", 0.5);

      // Bass.
      if (drop || (b >= 12 && b < 16)) rollingSub(b, drop ? 1 : 0.62);
      else if ((b >= 8 && b < 12) || (b >= 28 && b < 32))
        s.note("sub", b, 0, h.root, 2.1, 0.61);
      // The breakdown opens with no sub at all; it returns softly for bars 36-39.
      else if (air && b >= 36)
        s.note("sub", b, 0, h.root, 3.5, 0.28 + (b - 36) * 0.02);
      else if (b === 60) s.note("sub", b, 0, h.root, 7, 0.42);

      // Saw chords: pumping in the drops, filtered sus stabs in the rises.
      if (drop) sawChord(b, drop2 ? 0.64 : 0.6, b >= 48);
      if (b >= 18 && b < 20) {
        const end = b === 19 ? 3 : 4;
        for (let beat = 0; beat < end; beat += 0.5)
          s.chord("chords", b, beat, h.chord, 0.38, 0.4 + beat * 0.02);
      }
      if (b >= 44 && b < 48) {
        const step = b === 47 ? 0.25 : 0.5,
          end = b === 47 ? 2 : 4;
        for (let beat = 0; beat < end; beat += step)
          s.chord(
            "chords",
            b,
            beat,
            h.chord,
            step * 0.75,
            0.38 + (b - 44) * 0.04 + beat * 0.01,
          );
      }

      // Lead: an eight-bar call and answer, developed in the second drop.
      if (drop1 && b % 2 === 0) leadLine(b, SENTENCE[(b - 20) / 2]!);
      if (b >= 48 && b < 56 && b % 2 === 0)
        leadLine(b, SENTENCE_2[(b - 48) / 2]!, 1.04);
      if (b === 56) leadLine(b, peakVI, 1.06);
      if (b === 58) leadLine(b, peakVII, 1.08);
      if (b === 60) {
        s.note("lead", b, 0, 83, 3.6, 0.84, {
          vibrato: { rate: 5.2, depth: 18, delay: 0.35 },
        });
        s.note("wide", b, 0, 83, 3.6, 0.74);
      }

      // Pluck: 3-3-2 pulse, sixteenths under the drops, the hook after drop one.
      if (b < 8) arp(b, "332", 1);
      else if (b < 12) arp(b, "332", 1);
      else if (b < 16) arp(b, "16", 0.86);
      else if (b < 18) arp(b, "332", 1);
      else if (b < 20) arp(b, "16", 1);
      else if (drop1 && b >= 24) arp(b, "16", 0.78);
      else if (b === 28) s.phrase("arp", b, open, 0, 0.82);
      else if (b === 30) s.phrase("arp", b, answer, 0, 0.82);
      else if (b >= 36 && b < 40) arp(b, "332", 0.5 + (b - 36) * 0.04);
      else if (b >= 40 && b < 44) arp(b, "8", 0.72 + (b - 40) * 0.04);
      else if (b >= 44 && b < 48) arp(b, "16", 0.82 + (b - 44) * 0.05);
      else if (drop2) arp(b, "16", 0.74);
      else if (last) arp(b, "332", 0.56 - (b - 60) * 0.05);

      // Breakdown: pedalled piano carries the hook; the pad breathes under it.
      if (air && b % 2 === 0) {
        pianoChord(b, 1);
        s.phrase("piano", b, SENTENCE[(b - 32) / 2]!, 0, 0.6);
      }
      if (b >= 40 && b < 44) {
        s.note("piano", b, 0, h.root + 12, 3.8, 0.46);
        for (let beat = 0; beat < 4; beat += 0.5)
          s.chord(
            "piano",
            b,
            beat,
            h.chord,
            0.45,
            0.3 + (b - 40) * 0.025 + (beat % 1 ? 0 : 0.05),
          );
      }
      if (b === 60) {
        pianoChord(b, 0.85);
        s.phrase("piano", b, call, 0, 0.5);
      }
      if (b === 62) {
        s.note("piano", b, 0, 47, 7.6, 0.4);
        s.chord("piano", b, 0.05, [59, 62, 66, 73], 7.5, 0.3);
      }

      // The choir: intro, breakdown, rises, and from bar 52 under the drop.
      if ((air || b < 8 || build || last || (b >= 52 && b < 60)) && b % 2 === 0)
        s.chord(
          "vowel",
          b,
          0,
          h.chord.map((n) => n + 12),
          7.5,
          air ? 0.62 : b < 8 ? 0.54 : drop2 ? 0.4 : 0.46,
        );
      if (b < 8 && b % 4 === 0)
        s.phrase("bell", b, b === 0 ? call : open, 0, 0.68);
      if (b >= 36 && b < 40 && b % 2 === 1)
        s.phrase("bell", b, [
          [1.5, 90, 0.5, 0.34],
          [2.5, 86, 0.9, 0.3],
        ]);
      if (b >= 56 && b < 60 && b % 2 === 1)
        s.phrase("bell", b, [
          [0.5, b < 58 ? 91 : 88, 0.4, 0.42],
          [1.5, 86, 0.4, 0.46],
          [2.5, b < 58 ? 83 : 85, 0.6, 0.4],
        ]);

      // Rises: accelerating snare, noise, pitch riser, a silent last beat.
      if (build) {
        const start = b < 20 ? 16 : 40,
          len = b < 20 ? 4 : 8,
          step = ROLL[b]!,
          end = b === 19 ? 3 : b === 47 ? 2 : 4;
        for (let beat = 0; beat < end; beat += step) {
          const p = (b - start + beat / 4) / len;
          s.note(
            "build",
            b,
            beat,
            38,
            0.12,
            0.24 + 0.34 * p + (beat % 1 ? 0 : 0.04),
          );
        }
        if (b % 2 === 0) s.note("rise", b, 0, 60, 7.6, 0.6);
      }
      if (b === 6 || b === 30) s.note("rise", b, 0, 60, 7.9, 0.5);
      if (b === 18)
        s.note("lift", b, 0, 66, 7, 0.6, {
          bend: [
            { at: 0, cents: 0 },
            { at: 1, cents: 1200 },
          ],
        });
      if (b === 44)
        s.note("lift", b, 0, 66, 14, 0.62, {
          bend: [
            { at: 0, cents: 0 },
            { at: 0.6, cents: 500 },
            { at: 1, cents: 1200 },
          ],
        });
      if (b === 8) s.note("impact", b, 0, 49, 2.5, 0.42);
      if (b === 28) s.note("impact", b, 0, 49, 2.5, 0.4);
      if ([20, 48].includes(b)) s.note("impact", b, 0, 49, 2.5, 0.64);
      if (b === 56) s.note("impact", b, 0, 49, 2.5, 0.56);
      if (b === 60) s.note("impact", b, 0, 49, 3, 0.36);
      if (b === 62) s.note("bell", b, 0, 83, 3.6, 0.45);
    }
    // Silent space before each landing: nothing starts in the gap and held
    // notes stop at its edge, so only reverb and delay tails ring on.
    for (const [from, to] of [
      [19 * BAR + 1440, 20 * BAR],
      [47 * BAR + 960, 48 * BAR],
    ] as const)
      for (let i = s.notes.length - 1; i >= 0; i--) {
        const n = s.notes[i]!,
          start = n.startTick!,
          end = start + n.durationTicks!;
        if (start >= from && start < to) s.notes.splice(i, 1);
        else if (start < from && end > from)
          s.notes[i] = { ...n, durationTicks: from - start };
      }
    return s.finish();
  },
};
