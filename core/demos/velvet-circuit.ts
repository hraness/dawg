/** Velvet Circuit: the UK garage demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import { Composer, hall, lanes, orbit, preset, room, voice } from "./build.ts";
import type { NoteInput } from "../score.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

/*
 * Research notes (lane music/velvet-circuit): 2-step garage sits at 130-132
 * BPM with MPC 16th swing around 62-68%, so the off-16ths land 30-40 ticks
 * late while the kick and the clap stay on the grid. The kick plays beat one
 * and the "and" of three and skips around them; the clap marks two and four
 * and never moves. Open hats sit on the offbeat 8ths with a closed hat on the
 * 16th before most of them, and a quieter shaker runs 16ths under the mix.
 * The bass is built first and answers the kick; minor ninths on Rhodes and
 * short organ stabs carry the harmony; the vocal is chopped into syllables
 * that play the rhythm and follow the chords.
 */

/** Off-16th delay in beats: about 65% MPC swing for the groove. */
const SWING = 0.075;
/** Hats and shaker swing a touch harder than the bass and the keys. */
const HAT_SWING = 0.085;

/** Beat position of a 16th step (0..15), swung when the step is odd. */
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
  /** Rootless Rhodes voicing that keeps common tones. */
  rh: readonly number[];
  /** Short organ stab voicing above it. */
  org: readonly number[];
}>;

const GM9: Chord = {
  name: "Gm9",
  root: 31,
  sev: 10,
  rh: [58, 62, 65, 69],
  org: [65, 70, 74],
};
const EBMAJ9: Chord = {
  name: "Ebmaj9",
  root: 39,
  sev: 11,
  rh: [58, 62, 65, 67],
  org: [67, 70, 74],
};
const CM9: Chord = {
  name: "Cm9",
  root: 36,
  sev: 10,
  rh: [58, 62, 63, 67],
  org: [67, 70, 75],
};
const D7SUS: Chord = {
  name: "D7sus4(b9)",
  root: 38,
  sev: 10,
  rh: [57, 60, 63, 67],
  org: [67, 69, 72],
};
const D7B9: Chord = {
  name: "D7(b9)",
  root: 38,
  sev: 10,
  rh: [57, 60, 63, 66],
  org: [66, 69, 72],
};
const DM11: Chord = {
  name: "Dm11",
  root: 38,
  sev: 10,
  rh: [57, 60, 62, 67],
  org: [65, 69, 72],
};
const F13SUS: Chord = {
  name: "F13sus4",
  root: 41,
  sev: 10,
  rh: [58, 62, 63, 67],
  org: [67, 70, 74],
};

/** i9 - VImaj9 - iv9 - V7sus(b9) - V7(b9), two bars a chord. */
const HOME = [GM9, GM9, EBMAJ9, EBMAJ9, CM9, CM9, D7SUS, D7B9] as const;
/** The climbing lift into each hook: iv9 - v11 - VImaj9 - VII13sus. */
const CLIMB = [CM9, CM9, DM11, DM11, EBMAJ9, EBMAJ9, F13SUS, F13SUS] as const;

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
  "F13sus4>Gm9": 34, // Bb, the fourth, down a minor third
};

/** G natural minor pitch classes, for harmonies the chord does not cover. */
const SCALE = new Set([7, 9, 10, 0, 2, 3, 5]);

/** A harmony a third or fourth below a pitch: a chord tone if one fits, else a scale tone. */
const below = (chord: Chord, pitch: number): number => {
  const tones = new Set(
    [chord.root, ...chord.rh, ...chord.org].map((p) => p % 12),
  );
  for (const pool of [tones, SCALE])
    for (let p = pitch - 3; p >= pitch - 5; p--) if (pool.has(p % 12)) return p;
  return pitch - 5;
};

const SECTIONS = [
  "Warm-up",
  "Pocket",
  "Lift",
  "Hold on",
  "Suspended",
  "Turnaround",
  "Last call",
  "Afterglow",
] as const;
type SectionName = (typeof SECTIONS)[number];

const sectionOf = (bar: number): SectionName => SECTIONS[Math.floor(bar / 8)]!;
const chordAt = (bar: number): Chord => {
  const name = sectionOf(bar);
  const progression = name === "Lift" || name === "Turnaround" ? CLIMB : HOME;
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

/** Bass cells, two bars each: [first bar, second bar]. `null` interval marks the approach note. */
const BASS: Readonly<
  Record<
    "pocket" | "hook" | "turn",
    readonly [readonly BassHit[], readonly BassHit[]]
  >
> = {
  // Sparse sub blips on one with the kick, then replies in the kick's gaps.
  pocket: [
    [
      [0, 0, 4, 0.9],
      [7, 12, 1, 0.48],
      [11, 0, 2, 0.7],
      [14, 7, 1, 0.56],
    ],
    [
      [2, 0, 2, 0.8],
      [6, 12, 1, 0.44],
      [11, -1, 1, 0.54],
      [13, -99, 3, 0.64],
    ],
  ],
  // Bubbling hook line with octave pops and a seventh.
  hook: [
    [
      [0, 0, 3, 0.94],
      [3, 12, 1, 0.56],
      [6, 0, 3, 0.78],
      [11, 12, 1, 0.6],
      [14, 7, 2, 0.7],
    ],
    [
      [0, 0, 3, 0.86],
      [3, 0, 1, 0.6],
      [6, -1, 2, 0.7],
      [9, 7, 1, 0.62],
      [11, 12, 1, 0.55],
      [13, -99, 3, 0.7],
    ],
  ],
  // Rolling turnaround: off-beat entries and octave drops.
  turn: [
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
  // Hyper-syncopated turnaround bar.
  hyper: "9..6......8..6..",
} as const;

/** Vocal chop events: [16th step, syllable, pitch, 16ths held, velocity]. */
type Chop = readonly [
  step: number,
  syllable: "hold" | "on",
  pitch: number,
  len: number,
  vel: number,
];

/**
 * The "hold on" hook, eight bars, one row per bar. The chops follow the
 * chord tones (Gm9, Ebmaj9, Cm9, D7sus4(b9), D7(b9)) and stutter in the
 * second bar of each pair.
 */
const HOOK: readonly (readonly Chop[])[] = [
  [
    [2, "hold", 74, 3, 0.8],
    [7, "on", 70, 2, 0.72],
    [10, "hold", 69, 2, 0.74],
    [13, "on", 67, 3, 0.76],
  ],
  [
    [8, "hold", 74, 1, 0.58],
    [9, "hold", 74, 1, 0.64],
    [10, "hold", 74, 2, 0.74],
    [14, "on", 72, 2, 0.72],
  ],
  [
    [2, "hold", 74, 3, 0.8],
    [7, "on", 70, 2, 0.72],
    [10, "hold", 67, 2, 0.72],
    [13, "on", 65, 3, 0.74],
  ],
  [
    [6, "on", 70, 1, 0.6],
    [7, "on", 70, 1, 0.66],
    [10, "hold", 72, 2, 0.74],
    [14, "on", 74, 2, 0.76],
  ],
  [
    [2, "hold", 75, 3, 0.82],
    [7, "on", 74, 2, 0.74],
    [10, "hold", 70, 2, 0.72],
    [13, "on", 67, 3, 0.74],
  ],
  [
    [8, "hold", 67, 1, 0.58],
    [9, "hold", 67, 1, 0.62],
    [10, "hold", 67, 2, 0.72],
    [14, "on", 70, 2, 0.74],
  ],
  [
    [2, "hold", 69, 3, 0.78],
    [7, "on", 72, 2, 0.74],
    [10, "hold", 69, 2, 0.7],
    [13, "on", 67, 3, 0.72],
  ],
  [
    [2, "hold", 66, 3, 0.74],
    [6, "on", 69, 2, 0.7],
    [11, "hold", 72, 1, 0.64],
    [12, "hold", 72, 1, 0.68],
    [13, "on", 74, 3, 0.78],
  ],
];

export const velvetCircuit: DemoDefinition = {
  info: demoInfo({
    id: "velvet-circuit",
    title: "Velvet Circuit",
    style: "UK garage",
    description:
      "A swung two-step pocket under a chopped 'hold on' hook that follows minor-ninth Rhodes and organ changes, with a rubbery sub that answers the kick.",
    tempoBpm: 130,
    key: "Gm",
    bars: 64,
    highlightBar: 24,
    trackId: "hold",
    features: [
      "two-step swing",
      "pitched vocal chops",
      "Rhodes ninths",
      "organ stabs",
      "sub-bass call and response",
      "reverse swell",
    ],
    arrangement: SECTIONS.map((name) => `${name} 8`),
    mixNotes: [
      "Kick and clap sit dead on the grid; hats, shaker, rims, bass and chops swing about 65% so the groove skips without smearing.",
      "Two separate syllable tracks expose the edit points; both use the same original content-pinned phrase, now played at the written pitch so the chops follow the chords.",
      "The bass leaves the claps on two and four open and answers the kick's 'and' of three; the Rhodes voicings keep common tones while the inner voices step down.",
      "Drop-outs on the last beat before each hook and a filtered intro and outro shape the arc; the breakdown throws the chops into a long delay.",
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
        fx: { duck: { orbit: 2, depth: 0.4, attack: 0.14 } },
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
        // Builds through the Lift and the Turnaround into each hook.
        volumeAutomation: lanes(
          [0, 0.8],
          [15.9, 0.8],
          [16, 0.7],
          [23.9, 1],
          [39.9, 1],
          [40, 0.78],
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
          [40, 0.93],
          [47.9, 0.93],
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
          [16, 0.8],
          [23.9, 0.92],
          [39.9, 0.92],
          [40, 0.86],
          [47.9, 0.96],
          [48, 1],
        ),
        reverb: room,
        fx: orbit,
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
    /** A Rhodes chord, top voice leading, inner voices softer, slightly rolled. */
    const stab = (
      track: string,
      bar: number,
      step: number,
      pitches: readonly number[],
      len: number,
      vel: number,
      roll = 0.012,
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
        ),
      );
    };

    /** Bars with a bassline: none in the intro, the breakdown or the last four bars. */
    const bassPlays = (bar: number) => {
      const name = sectionOf(Math.min(63, bar));
      return name !== "Warm-up" && name !== "Suspended" && bar < 60;
    };
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
      const lift = sec === "Lift" || sec === "Turnaround";
      const intro = sec === "Warm-up";
      const outro = sec === "Afterglow";
      // The last beat before each hook (and the turnaround) drops out.
      const dropOut = b === 23 || b === 47 || b === 7;
      const grooveOn = !breakdown && !(intro && b < 4) && !(outro && b >= 62);
      const kickOn = grooveOn && !(outro && b >= 60);

      // ---------- kick ----------
      if (kickOn) {
        let pattern: string = second ? KICKS.b : KICKS.a;
        if (b % 4 === 3) pattern = KICKS.c;
        if (sec === "Turnaround")
          pattern = second ? (b % 4 === 3 ? KICKS.c : KICKS.roll) : KICKS.hyper;
        if (sec === "Last call" && second && b % 4 === 1) pattern = KICKS.roll;
        if (dropOut) pattern = pattern.slice(0, 12) + "....";
        row("kick", b, 36, pattern);
      }

      // ---------- clap, snare, hats, rims (drums) ----------
      if (grooveOn) {
        const clapOn = !(intro && b < 4);
        if (clapOn)
          for (const step of [4, 12]) {
            if (dropOut && step === 12) continue;
            const v = step === 12 ? 0.86 : 0.8;
            hit("drums", b, step, 39, v + jitter(0.03), 1, 0);
            hit(
              "drums",
              b,
              step,
              38,
              (step === 12 ? 0.56 : 0.5) + jitter(0.03),
              1,
              0,
            );
          }
        // Hats: open on the offbeat 8ths with a closed hat on the 16th before
        // most of them; busier closed 16ths from the Lift on.
        const busy = lift || hook || (outro && b < 60);
        for (let step = 0; step < 16; step++) {
          if (dropOut && step >= 12) continue;
          const open = step % 4 === 2;
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
          } else if (busy && step % 4 === 3 && step !== 3) {
            hit("drums", b, step, 42, 0.26 + jitter(0.05), 0.5, HAT_SWING);
          } else if (onBeat && busy && step !== 4 && step !== 12) {
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
        // Ghost snares in the hook and the turnaround.
        if ((hook || sec === "Turnaround") && b % 2 === 0)
          hit("drums", b, 7, 38, 0.16 + jitter(0.03), 1);
        // The last hook adds a soft ride on the beats for lift.
        if (sec === "Last call")
          for (const step of [0, 4, 8, 12]) {
            if (step === 0 && b === 48) continue;
            const v = step === 0 ? 0.3 : step === 8 ? 0.26 : 0.22;
            hit("drums", b, step, 51, v + jitter(0.03), 2, 0);
          }
      }
      // Crash on the big downbeats, softer hats after it come from the jitter.
      if ([8, 24, 40, 48].includes(b))
        hit("drums", b, 0, 49, b === 48 || b === 24 ? 0.62 : 0.5, 8, 0);
      if (b === 56) hit("drums", b, 0, 49, 0.4, 8, 0);

      // ---------- fills ----------
      if (b === 15 || b === 31 || b === 55) {
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
        const per = b === 38 ? (inBar < 8 ? 2 : 2) : 1;
        for (let step = 0; step < 16; step += per) {
          const v = 0.18 + ((b - 38) * 16 + step) * 0.022;
          hit("drums", b, step, 38, v, 1, 0);
          if (b === 39 && step >= 8)
            s.note("drums", b, at(step, 0) + 0.125, 38, 0.1, v * 0.85);
        }
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
      // Silent through the intro and the breakdown so each drop lands.
      if (bassPlays(b)) {
        const cell =
          sec === "Turnaround" ? BASS.turn : hook ? BASS.hook : BASS.pocket;
        const hits = cell[second ? 1 : 0];
        const slide = slideIn;
        slideIn = false;
        hits.forEach(([step, interval, len, vel], i) => {
          if (dropOut && step >= 12) return;
          let pitch = chord.root + interval;
          let extra: Partial<NoteInput> = {};
          if (interval === -99) {
            if (bassPlays(b + 1)) {
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
      }

      // ---------- Rhodes ----------
      if (breakdown) {
        if (b % 2 === 0) {
          stab("keys", b, 0, chord.rh, 30, 0.5, 0.03);
          // A falling answer in the top voice.
          const top = chord.rh[chord.rh.length - 1]!;
          s.note("keys", b + 1, at(6), top + 5, 0.6, 0.34);
          s.note("keys", b + 1, at(9), top + 3, 0.6, 0.3);
          s.note("keys", b + 1, at(12), top, 1.5, 0.32);
        }
      } else if (!(outro && b >= 62)) {
        const soft = intro ? 0.82 : 1;
        // Pushes: the next chord lands a 16th early and holds over the bar
        // line, every fourth bar in the first hook and the turnaround and
        // on every change in the last hook.
        const push =
          second &&
          !dropOut &&
          sectionOf(b + 1) === sec &&
          ((sec === "Last call" && b % 2 === 1) ||
            ((hook || sec === "Turnaround") && b % 4 === 3));
        if (!second) {
          if (!pushed) stab("keys", b, 2, chord.rh, 4, 0.64 * soft);
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
        // In the pocket and the outro a short falling answer in the top
        // voice fills the gap every fourth bar.
        if ((sec === "Pocket" || sec === "Afterglow") && b % 4 === 2) {
          const top = chord.rh[chord.rh.length - 1]!;
          hit("keys", b, 10, top + 5, 0.42 + jitter(0.03), 1);
          hit("keys", b, 11, top + 3, 0.36 + jitter(0.03), 1);
          hit("keys", b, 12, top, 0.4 + jitter(0.03), 2);
        }
      }
      if (outro && b === 62)
        stab("keys", b, 0, GM9.rh.concat(74), 30, 0.5, 0.04);

      // ---------- organ stabs ----------
      const organOn = lift || hook;
      if (organOn && !dropOut) {
        const pattern = second ? [6, 9, 14] : [3, 11];
        for (const step of pattern) {
          const v =
            0.5 + (step === 11 || step === 14 ? 0.06 : 0) + jitter(0.03);
          stab("organ", b, step, chord.org, 1, v, 0.004);
        }
      } else if (organOn && dropOut) {
        stab("organ", b, 3, chord.org, 1, 0.52, 0.004);
      }

      // ---------- vocal chops ----------
      const chops: Chop[] = [];
      if (hook) {
        for (const chop of HOOK[inBar]!) {
          chops.push(chop);
          // The last hook doubles each longer "hold" a third or fourth below.
          const [step, syllable, pitch, len, vel] = chop;
          if (sec === "Last call" && syllable === "hold" && len >= 2)
            chops.push([step, "hold", below(chord, pitch), len, vel * 0.62]);
        }
      } else if (sec === "Pocket" || sec === "Afterglow") {
        // Sparse calls: one "hold on" per two bars, the answer moving.
        if (second && !(outro && b >= 62)) {
          const motif = HOOK[inBar - 1]!;
          chops.push(
            [10, "hold", motif[2]![2], 2, 0.66],
            [13, "on", motif[3]![2], 3, 0.68],
          );
        }
      } else if (lift) {
        // Call on the first bar, answer on the second, rising to the hook.
        const top = chord.org[chord.org.length - 1]!;
        if (!second)
          chops.push([2, "hold", top, 2, 0.68], [7, "on", top - 2, 2, 0.64]);
        else
          chops.push(
            [6, "on", chord.org[1]!, 2, 0.6],
            [10, "hold", top, 1, 0.56],
            [11, "hold", top, 1, 0.62],
            [13, "on", chord.org[0]! + 7 > top ? top : chord.org[1]!, 3, 0.68],
          );
      } else if (breakdown && b % 2 === 0) {
        // Long throws into the delay.
        const top = chord.org[chord.org.length - 1]!;
        chops.push([0, "hold", top, 6, 0.64], [8, "on", chord.org[1]!, 6, 0.6]);
      }
      if (intro && b === 6) chops.push([10, "hold", 74, 3, 0.6]);
      if (intro && b === 7) chops.push([13, "on", 70, 3, 0.64]);
      if (dropOut && !intro)
        chops.push(
          [12, "hold", 74, 1, 0.6],
          [13, "hold", 74, 1, 0.66],
          [14, "on", 72, 2, 0.74],
        );
      if (outro && b === 62)
        chops.push([2, "hold", 67, 4, 0.6], [10, "on", 74, 8, 0.58]);
      for (const [step, syllable, pitch, len, vel] of chops) {
        // A small scoop into the longer notes, like a sung chop.
        const extra: Partial<NoteInput> =
          len >= 3
            ? {
                bend: [
                  { at: 0, cents: -45 },
                  { at: 0.18, cents: 0 },
                ],
              }
            : {};
        hit(syllable, b, step, pitch, vel + jitter(0.03), len, SWING, extra);
      }

      // ---------- FX ----------
      if ([15, 23, 39, 47, 55].includes(b)) s.note("swell", b, 2, 67, 1.9, 0.7);
      if (b === 38) s.note("fx", b, 0, 36, 7.8, 0.7);
      if (b === 22) s.note("fx", b, 0, 36, 7.8, 0.55);
    }
    return s.finish();
  },
};

/** The shaker plays every 16th once the groove is up. */
function busyShaker(sec: SectionName): boolean {
  return sec !== "Warm-up" && sec !== "Pocket";
}
