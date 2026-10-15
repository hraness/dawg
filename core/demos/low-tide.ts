/** Low Tide: the trip hop demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import type { BendPoint, NoteVibrato, PedalEvent } from "../expression.ts";
import { BAR, Composer, TPB, hall, lanes, orbit, voice } from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

/**
 * Timing, from the research notes: at 84 BPM a sixteenth is 179 ms. MPC-style
 * swing near 57% delays every second sixteenth by about 25 ms; the backbeat
 * sits about 26 ms behind the grid while the kick stays on it.
 */
const SW = 0.035;
const LATE = 0.036;
const at = (step: number) => step / 4 + (step % 2 ? SW : 0);

/** Where each section starts; the song is 54 bars. */
const LOW = 4;
const VERSE1 = 8;
const REFRAIN1 = 16;
const DUB = 24;
const VERSE2 = 32;
const REFRAIN2 = 40;
const SHORE = 48;
const SLACK = 52;
const END = 54;

/** Seeded, so every render of the song is identical. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A chord: the bass root, the bass's chord tones above it (so every passing
 * note in the bass line agrees with the Rhodes), the full Rhodes voicing
 * (`keys`, struck in the bars where the horn answers) and the three-note
 * voicing under the singer (`low`, topping at A3, Bb3 or B3 so the alto's
 * landing notes have the octave above the Rhodes to themselves; the top
 * note arrives only on the re-strike in the horn's bar).
 */
type Chord = Readonly<{
  root: number;
  third: number;
  fifth: number;
  seventh: number;
  keys: readonly number[];
  low: readonly number[];
}>;
/** Rootless Rhodes voicings, Eb3 to D4; the top voice moves by step. */
const CM9: Chord = {
  root: 36,
  third: 3,
  fifth: 7,
  seventh: 10,
  keys: [51, 55, 58, 62],
  low: [51, 55, 58],
};
const AM7B5: Chord = {
  root: 33,
  third: 3,
  fifth: 6,
  seventh: 10,
  keys: [51, 55, 57, 60],
  low: [51, 55, 57],
};
const ABMAJ9: Chord = {
  root: 32,
  third: 4,
  fifth: 7,
  seventh: 11,
  keys: [51, 55, 58, 60],
  low: [51, 55, 58],
};
/**
 * G7 flat nine, rootless: F, Ab, B, D; B falls to Bb and Ab to G in Cm9.
 * Under the singer the B is struck and then let go at beat two, where the
 * voice takes the third (D4 "way", F4-D4 "sand").
 */
const G7B9: Chord = {
  root: 31,
  third: 4,
  fifth: 7,
  seventh: 10,
  keys: [53, 56, 59, 62],
  low: [53, 56, 59],
};
/**
 * G7sus: the C that the strings and the voice resolve to B (a 4-3). The
 * Rhodes lets its C go at beat two and re-strikes only the D above the
 * singer's B.
 */
const G7SUS: Chord = {
  root: 31,
  third: 5,
  fifth: 7,
  seventh: 10,
  keys: [53, 56, 60, 62],
  low: [53, 56, 60],
};
/** Fm9 under the singer leaves out the third: the voice sings the Ab. */
const FM9: Chord = {
  root: 41,
  third: 3,
  fifth: 7,
  seventh: 10,
  keys: [51, 55, 56, 60],
  low: [51, 55, 60],
};
const DBMAJ9: Chord = {
  root: 37,
  third: 4,
  fifth: 7,
  seventh: 11,
  keys: [51, 53, 56, 60],
  low: [51, 53, 56],
};
/** The line cliché under the second verse: Cm, Cm(maj7)/B, Cm7/Bb. */
const CMMAJ7_B: Chord = {
  root: 47,
  third: 4,
  fifth: 8,
  seventh: 1,
  keys: [51, 55, 59, 62],
  low: [51, 55, 59],
};
const CM7_BB: Chord = {
  root: 46,
  third: 5,
  fifth: 9,
  seventh: 2,
  keys: [51, 55, 58, 62],
  low: [51, 55, 58],
};
const AM7B5_HI: Chord = { ...AM7B5, root: 45 };
/** Abmaj7 voiced Eb G Ab C, so the inner line runs B, Bb, A, Ab, Ab. */
const ABMAJ7_WALK: Chord = {
  ...ABMAJ9,
  root: 44,
  keys: [51, 55, 56, 60],
  low: [51, 55, 56],
};
const G7B9_HI: Chord = { ...G7B9, root: 43 };

/** The chord of every bar. */
const CHORDS: readonly Chord[] = [
  // Room tone, Low water: the needle drops on Cm9 and Abmaj9.
  ...[CM9, CM9, ABMAJ9, ABMAJ9],
  ...[CM9, CM9, ABMAJ9, ABMAJ9],
  // First light: the lament, C, A, Ab, G.
  ...[CM9, CM9, AM7B5, AM7B5, ABMAJ9, ABMAJ9, G7B9, G7B9],
  // Refrain: Fm9, the Neapolitan Dbmaj9, then a 4-3 over G.
  ...[FM9, FM9, DBMAJ9, DBMAJ9, ABMAJ9, ABMAJ9, G7SUS, G7B9],
  // Dub room.
  ...[CM9, CM9, ABMAJ9, ABMAJ9, CM9, CM9, G7B9, G7B9],
  // Second tide: the bass walks down by half steps, then ii, V.
  ...[CM9, CMMAJ7_B, CM7_BB, AM7B5_HI, ABMAJ7_WALK, FM9, G7B9_HI, G7B9_HI],
  // Refrain return.
  ...[FM9, FM9, DBMAJ9, DBMAJ9, ABMAJ9, ABMAJ9, G7SUS, G7B9],
  // Shore and slack water: home, a last V, then the tail on Cm9.
  ...[CM9, CM9, G7B9, G7B9, CM9, CM9],
];
/** Bars whose chord resolves on beat two (the sus voicing above). */
const SUS_BARS = new Set([REFRAIN1 + 6, REFRAIN2 + 6]);
/**
 * Cadence bars where the Rhodes lets its third (or the suspended fourth) go
 * at beat two and leaves it to the singer: "way", "turns", "sand", "turns".
 */
const CADENCE_BARS = new Set([
  VERSE1 + 6,
  REFRAIN1 + 6,
  VERSE2 + 6,
  REFRAIN2 + 6,
]);
/** Bars where the voice sings a line and the Rhodes plays its low voicing. */
const SUNG_BARS = new Set(
  [VERSE1, REFRAIN1, VERSE2, REFRAIN2].flatMap((start) =>
    [0, 2, 4, 6].map((b) => start + b),
  ),
);

/** C minor with the raised leading tone: where a bass approach note may land. */
const SCALE = new Set([0, 2, 3, 5, 7, 8, 10, 11]);
/**
 * A scale-step approach into the next root, from above when the line falls
 * and from below when it rises. None when the roots already move by step.
 * B is only allowed under G7, where it is the chord's own third.
 */
function approach(from: number, to: number): number | undefined {
  if (Math.abs(to - from) <= 2) return undefined;
  const side = to < from ? 1 : -1;
  const fits = (pitch: number) =>
    SCALE.has(pitch % 12) && (pitch % 12 !== 11 || from % 12 === 7);
  const near = to + side;
  return fits(near) ? near : to + 2 * side;
}

type Sung = readonly [
  beat: number,
  pitch: number,
  length: number,
  velocity: number,
  lyric: string,
];

const VERSE_ONE: readonly (readonly Sung[])[] = [
  [
    [0.5, 67, 0.6, 0.66, "Salt"],
    [1.25, 63, 0.25, 0.56, "on"],
    [1.5, 62, 0.25, 0.54, "the"],
    [1.75 + SW, 63, 0.45, 0.62, "win-"],
    [2.25, 60, 1.6, 0.64, "dow"],
  ],
  [
    [0.5, 60, 0.4, 0.6, "no-"],
    [1, 63, 0.6, 0.66, "thing"],
    [1.75 + SW, 62, 0.25, 0.55, "to"],
    [2, 60, 1.8, 0.63, "say"],
  ],
  // "I" picks up from the horn's bar and "count" lands on the downbeat.
  [
    [-0.5, 63, 0.4, 0.58, "I"],
    [0, 68, 0.7, 0.72, "count"],
    [0.75 + SW, 67, 0.25, 0.56, "the"],
    [1, 65, 0.6, 0.64, "boats"],
    [1.75 + SW, 63, 1.6, 0.62, "out"],
  ],
  // The verse ends open, on the fifth, a third down from the seventh.
  [
    [0.5, 62, 0.4, 0.62, "slip-"],
    [1, 63, 0.4, 0.6, "ping"],
    [1.5, 65, 0.4, 0.6, "a-"],
    [2, 62, 2.4, 0.64, "way"],
  ],
];

const VERSE_TWO: readonly (readonly Sung[])[] = [
  [
    [0.5, 70, 0.6, 0.7, "Rope"],
    [1.25, 67, 0.25, 0.58, "on"],
    [1.5, 65, 0.25, 0.56, "the"],
    [1.75 + SW, 63, 0.45, 0.64, "har-"],
    [2.25, 62, 1.6, 0.64, "bour"],
  ],
  [
    [0.5, 63, 0.9, 0.68, "cold"],
    [1.5, 62, 0.25, 0.56, "in"],
    [1.75 + SW, 60, 0.25, 0.55, "the"],
    [2, 63, 1.8, 0.64, "hand"],
  ],
  [
    [0.5, 60, 0.25, 0.58, "you"],
    [0.75 + SW, 63, 0.45, 0.64, "wrote"],
    [1.25, 67, 0.25, 0.6, "your"],
    [1.5, 67, 0.7, 0.7, "name"],
    [2.25, 65, 1.1, 0.62, "in"],
  ],
  // "sand" is the seventh slurred down to the fifth as the ratchet starts.
  [
    [0.5, 63, 0.25, 0.62, "wa-"],
    [0.75 + SW, 62, 0.45, 0.58, "ter"],
    [1.25, 62, 0.4, 0.58, "and"],
    [1.75 + SW, 65, 1.2, 0.66, "sand"],
    [3, 62, 0.65, 0.6, "_"],
  ],
];

/** The hook: four notes, G Eb | Ab G, sung twice in every refrain. */
const HOOK: readonly Sung[] = [
  [0.5, 67, 0.9, 0.72, "Low"],
  [1.5, 63, 0.8, 0.66, "tide"],
  [2.5, 68, 0.45, 0.7, "low"],
  [3, 67, 1.6, 0.7, "tide"],
];
/** The hook a third up, Bb Ab | C G: the refrain's C5, placed late. */
const HOOK_HIGH: readonly Sung[] = [
  [0.5, 70, 0.9, 0.76, "Low"],
  [1.5, 68, 0.8, 0.7, "tide"],
  [2.5, 72, 0.45, 0.78, "low"],
  [3, 67, 1.6, 0.72, "tide"],
];
const UNDER: readonly Sung[] = [
  [0.5, 65, 0.4, 0.64, "don't"],
  [1, 68, 0.6, 0.72, "pull"],
  [1.75 + SW, 65, 0.25, 0.58, "me"],
  [2, 63, 0.5, 0.64, "un-"],
  [2.5, 60, 1.8, 0.64, "der"],
];
const LIGHT: readonly Sung[] = [
  [0.5, 63, 0.45, 0.64, "leave"],
  [1, 65, 0.25, 0.58, "the"],
  [1.25, 67, 1.2, 0.72, "light"],
  [2.75 + SW, 63, 1.1, 0.62, "on"],
];
const TURNS: readonly Sung[] = [
  [0.5, 65, 0.25, 0.64, "till"],
  [0.75 + SW, 63, 0.25, 0.58, "the"],
  [1, 62, 0.5, 0.64, "wa-"],
  [1.5, 63, 0.5, 0.62, "ter"],
  [2, 59, 2.5, 0.68, "turns"],
];
/** Refrain one: the title four times, the C5 arriving in its third line. */
const REFRAIN_LINES: readonly (readonly Sung[])[] = [
  HOOK,
  UNDER,
  HOOK_HIGH,
  TURNS,
];
/**
 * The return's third line runs on into the fourth as one three-bar phrase:
 * "on" is held across the bar and "till the water" pushes in early, so the
 * vibes skip an answer and the cadence arrives without a breath.
 */
const LIGHT_LONG: readonly Sung[] = [
  [0.5, 63, 0.45, 0.66, "leave"],
  [1, 65, 0.25, 0.6, "the"],
  [1.25, 70, 1.2, 0.76, "light"],
  [2.75 + SW, 68, 3.4, 0.66, "on"],
  [7, 65, 0.4, 0.64, "till"],
  [7.5, 63, 0.45, 0.6, "the"],
  [8, 62, 0.9, 0.66, "wa-"],
  [9, 63, 0.9, 0.64, "ter"],
];

const SCOOP: readonly BendPoint[] = [
  { at: 0, cents: -90 },
  { at: 0.16, cents: 0 },
];
const FALL: readonly BendPoint[] = [
  { at: 0, cents: 0 },
  { at: 0.74, cents: 0 },
  { at: 1, cents: -140 },
];
const LONG_VIBRATO: NoteVibrato = { rate: 5.1, depth: 24, delay: 0.34 };
const HORN_VIBRATO: NoteVibrato = { rate: 4.6, depth: 18, delay: 0.3 };

/** A horn phrase: beat, pitch, length, velocity. */
type Blown = readonly (readonly [number, number, number, number])[];
/**
 * The answer motif: four notes that rise while the voice fell, stated,
 * restated with one change, varied, then resolved by the fourth answer
 * (F, D, B) whose C lands on the next section's downbeat.
 */
const ANSWER_A: Blown = [
  [1.5 + SW, 67, 0.4, 0.42],
  [2, 70, 0.4, 0.5],
  [2.5, 72, 0.9, 0.62],
  [3.5, 70, 0.5, 0.54],
];
/** Each cell swells to its long note and eases off the tail. */
const ANSWER_B: Blown = [
  [1.5 + SW, 67, 0.4, 0.42],
  [2, 69, 0.4, 0.5],
  [2.5, 72, 0.9, 0.62],
  [3.5, 75, 0.5, 0.56],
];
/** Verse one's third answer ends early: the voice picks up on "I". */
const ANSWER_B_SHORT: Blown = [
  [1.5 + SW, 67, 0.4, 0.42],
  [2, 69, 0.4, 0.5],
  [2.5, 72, 0.9, 0.62],
];
const ANSWER_C: Blown = [
  [1.5 + SW, 70, 0.4, 0.44],
  [2, 72, 0.4, 0.52],
  [2.5, 75, 0.9, 0.64],
  [3.5, 72, 0.5, 0.56],
];
/** The cadence tag falls away into its C. */
const ANSWER_D: Blown = [
  [1.5 + SW, 77, 0.45, 0.6],
  [2, 74, 0.45, 0.54],
  [2.5, 71, 1.4, 0.5],
];
/** Over Cm(maj7)/B: the leading tone inside the motif. */
const ANSWER_A2: Blown = [
  [1.5 + SW, 67, 0.4, 0.42],
  [2, 71, 0.4, 0.5],
  [2.5, 74, 0.9, 0.62],
  [3.5, 71, 0.5, 0.54],
];
/** Verse two's second answer comes late and lands on the next downbeat. */
const ANSWER_B_LATE: Blown = [
  [2.5, 67, 0.4, 0.42],
  [3, 69, 0.4, 0.5],
  [3.5, 72, 0.45, 0.6],
  [4, 75, 0.4, 0.56],
];
/** Over Fm9. */
const ANSWER_C2: Blown = [
  [1.5 + SW, 68, 0.4, 0.44],
  [2, 72, 0.4, 0.52],
  [2.5, 75, 0.9, 0.64],
  [3.5, 72, 0.5, 0.56],
];
/** A falling sigh after "under", over Dbmaj9. */
const SIGH: Blown = [
  [1.5 + SW, 72, 0.4, 0.5],
  [2, 70, 0.4, 0.46],
  [2.5, 68, 1.2, 0.42],
];

export const lowTide: DemoDefinition = {
  info: demoInfo({
    id: "low-tide",
    title: "Low Tide",
    style: "Trip hop",
    description:
      "A swung, crushed break with a lazy backbeat under a dub bass, tape-wobbled Rhodes and a close sung voice answered by a muted horn. The verses walk a lament down from C, the second walks it by half steps, the refrain sings the title four times and turns to F minor and D flat under a high string pedal that suspends and resolves, the middle drops into a kick-less dub room where voice and horn hocket the hook, the shore flips to half time and horn and vibes trade a last tag over the held chord.",
    tempoBpm: 84,
    key: "Cm",
    bars: 54,
    highlightBar: 16,
    trackId: "vocal",
    features: [
      "a sung line and a muted-horn answer in its rests, each answer swelling to its long note",
      "a four-note hook sung twice per refrain, the second time a third up",
      "voice and horn hocket the hook in a kick-less dub room",
      "string pedal with 4-3 and 9-8 suspensions at the cadences",
      "chromatic bass descent under the second verse",
      "swung crushed break with a late backbeat and ghost notes",
      "stuttered syllables, a tape stop and a ratchet glitch fill",
      "half-time flip on the shore, dub throws on the phrase grid",
    ],
    arrangement: [
      "Room tone 4",
      "Low water 4",
      "First light 8",
      "Refrain 8",
      "Dub room 8",
      "Second tide 8",
      "Refrain return 8",
      "Shore 4",
      "Slack water 2",
    ],
    mixNotes: [
      "The kick has its own track and ducks the keys, strings and horn a little; the backbeat lands about 26 ms late and the off sixteenths swing near 57%.",
      "The drum bus runs through a light bitcrush that sweeps down over the bar before the last refrain and snaps clean on its downbeat.",
      "Bass and kick share their onsets and the center; the Rhodes plays three-note rootless voicings topping at Bb3 under the singer and adds its top note only in the horn's bars, with a slow tape wobble and a slow pan drift.",
      "The voice is close and nearly dry in the verses with a touch of singer's-formant ring; its ping-pong echo throws on line ends, floods the dub room and the shore.",
      "Strings sit right and vibes left, the horn a little right of the voice, so the answers come from different places in the room.",
    ],
  }),
  build() {
    const s = new Composer(lowTide.info);
    for (const [name, start, bars] of [
      ["Room tone", 0, 4],
      ["Low water", LOW, 4],
      ["First light", VERSE1, 8],
      ["Refrain", REFRAIN1, 8],
      ["Dub room", DUB, 8],
      ["Second tide", VERSE2, 8],
      ["Refrain return", REFRAIN2, 8],
      ["Shore", SHORE, 4],
      ["Slack water", SLACK, 2],
    ] as const)
      s.section(name, start, bars);
    const pedal: PedalEvent[] = [];
    // Low water: the break arrives muffled, as if heard from under the
    // surface, and opens over bar 7 as the voice comes in.
    const surface = lanes(
      [0, 760],
      [LOW + 2, 760],
      [LOW + 2.5, 1100],
      [LOW + 3, 1700],
      [LOW + 3.5, 3400],
      [LOW + 3.75, 7000],
      [VERSE1, 20000],
    );
    s.track(
      voice("kick", "Dust kick", "kit", 0.66, {
        kit: "lofi",
        humanize: { timing: 3, velocity: 4, seed: 85 },
        fx: { duck: { orbit: 2, depth: 0.18, attack: 0.12 } },
      }),
    );
    s.track(
      voice("drums", "Dust break", "kit", 0.66, {
        kit: "lofi",
        reverb: { mix: 0.07, size: 0.24, fade: 0.7 },
        humanize: { timing: 5, velocity: 5, seed: 84 },
        filterAutomation: surface,
        // The crushed bed; its bits sweep down into the last refrain.
        fx: { crush: { bits: 9, coarse: 2, mix: 0.22 } },
        fxAutomation: {
          "crush-bits": lanes(
            [0, 9],
            [REFRAIN2 - 1, 9],
            [REFRAIN2 - 0.05, 4],
            [REFRAIN2, 9],
          ),
        },
      }),
    );
    s.track(
      voice("throws", "Snare throws", "kit", 0.42, {
        kit: "lofi",
        pan: 0.08,
        reverb: { mix: 0.3, size: 0.34, fade: 1.4, predelay: 0.045 },
        delay: {
          beats: 0.75,
          feedback: 0.52,
          mix: 0.42,
          pingpong: true,
          highcut: 2400,
        },
      }),
    );
    s.track(
      voice("bass", "Dub bass", "motown", 0.82, {
        // The preset's calibrated trim (0.227) left the bass about 28 dB
        // under the mix, inaudible; trip hop wants it heavy and in front.
        string: { preset: "motown", mute: 0.34, bright: 0.3, gain: 2 },
        glide: { time: 0.07, mode: "legato" },
        humanize: { timing: 4, velocity: 4, seed: 12 },
      }),
    );
    s.track(
      voice("keys", "Tape Rhodes", "rhodes", 0.36, {
        pan: -0.14,
        // A slow drift across the stereo field, a tape machine's wander.
        panAutomation: Array.from(
          { length: 2 * Math.ceil(END / 2.5) + 1 },
          (_, i) => ({
            tick: Math.round(Math.min(END, i * 1.25) * BAR),
            value: i % 2 ? 0.28 : -0.5,
          }),
        ),
        // Thin the pedalled low end so the bass and the voice have room.
        filter: { type: "hpf", cutoff: 150, resonance: 0 },
        reverb: { mix: 0.14, size: 0.45, fade: 1.8, lowpass: 6000 },
        delay: {
          beats: 0.75,
          feedback: 0.26,
          mix: 0.1,
          highcut: 2800,
          pingpong: true,
        },
        delayMixAutomation: lanes(
          [0, 0.1],
          [DUB - 0.25, 0.1],
          [DUB, 0.32],
          [VERSE2 - 0.25, 0.32],
          [VERSE2, 0.1],
          [SHORE - 0.25, 0.1],
          [SHORE, 0.22],
        ),
        fx: {
          ...orbit,
          wobble: { depth: 7, rate: 0.42, drift: 0.55 },
          chorus: { rate: 0.28, depth: 0.24, mix: 0.34 },
        },
        // The tape wows at the turnaround into the second verse.
        fxAutomation: {
          "wobble-depth": lanes(
            [0, 7],
            [VERSE2 - 0.6, 7],
            [VERSE2 - 0.1, 34],
            [VERSE2 + 0.1, 7],
          ),
        },
        humanize: { timing: 7, velocity: 4, seed: 33 },
        pedal,
      }),
    );
    s.track(
      voice("vocal", "Low tide singer", "sing", 0.68, {
        sing: {
          preset: "airy",
          voice: "alto",
          articulate: 1,
          vib: 4.9,
          vibmod: 0.1,
          breath: 0.18,
          jitter: 0.12,
          attack: 0.05,
          // A little singer's-formant ring near 3 kHz lifts the words over
          // the Rhodes without raising the fader.
          bright: 0.55,
          ring: 0.3,
        },
        reverb: { mix: 0.1, size: 0.4, fade: 1.6 },
        delay: {
          beats: 0.75,
          feedback: 0.3,
          mix: 0.1,
          highcut: 3200,
          pingpong: true,
        },
        filter: { type: "hpf", cutoff: 140, resonance: 0 },
        humanize: { timing: 12, velocity: 3, length: 4, seed: 7 },
        // Dub throws land on the phrase grid: the end of the first refrain
        // line, "turns", the whole dub room, then the shore.
        delayMixAutomation: lanes(
          [0, 0.07],
          [REFRAIN1 + 1, 0.07],
          [REFRAIN1 + 1.1, 0.22],
          [REFRAIN1 + 2, 0.07],
          [REFRAIN1 + 6.6, 0.09],
          [REFRAIN1 + 7.4, 0.36],
          [DUB, 0.42],
          [DUB + 7.5, 0.42],
          [VERSE2, 0.08],
          [REFRAIN2 + 1, 0.08],
          [REFRAIN2 + 1.1, 0.22],
          [REFRAIN2 + 2, 0.08],
          [REFRAIN2 + 6.6, 0.1],
          [SHORE, 0.3],
          [SHORE + 1, 0.45],
          [END, 0.5],
        ),
        delayFeedbackAutomation: lanes(
          [0, 0.3],
          [DUB - 0.5, 0.3],
          [DUB, 0.55],
          [DUB + 7.5, 0.55],
          [VERSE2, 0.3],
          [SHORE - 0.5, 0.3],
          [SHORE + 0.5, 0.5],
        ),
      }),
    );
    s.track(
      voice("double", "Refrain double", "sing", 0.3, {
        sing: {
          preset: "airy",
          voice: "alto",
          articulate: 1,
          vib: 5.4,
          vibmod: 0.12,
          breath: 0.24,
          jitter: 0.16,
          attack: 0.06,
        },
        pan: -0.36,
        reverb: { mix: 0.16, size: 0.36, fade: 1.8 },
        filter: { type: "hpf", cutoff: 220, resonance: 0 },
        humanize: { timing: 14, velocity: 4, length: 5, seed: 31 },
      }),
    );
    s.track(
      voice("reply", "Harmon reply", "harmon", 0.22, {
        wind: { preset: "harmon", breath: 0.72, bright: 0.62 },
        pan: 0.3,
        reverb: { ...hall, mix: 0.3 },
        delay: {
          beats: 0.75,
          feedback: 0.3,
          mix: 0.16,
          highcut: 3000,
          pingpong: true,
        },
        filter: { type: "hpf", cutoff: 200, resonance: 0 },
        fx: orbit,
        humanize: { timing: 9, velocity: 5, length: 4, seed: 41 },
      }),
    );
    s.track(
      voice("strings", "Tide strings", "violins", 0.76, {
        pan: 0.5,
        reverb: { ...hall, mix: 0.26 },
        // A second take spread wide: the pedal is the room's width.
        fx: { ...orbit, double: { time: 24, drift: 3, width: 0.8 } },
        humanize: { timing: 10, velocity: 3, seed: 21 },
      }),
    );
    s.track(
      voice("cellos", "Tide cellos", "cellos", 0.66, {
        string: { preset: "cellos" },
        pan: -0.3,
        reverb: { ...hall, mix: 0.24 },
        fx: orbit,
        humanize: { timing: 12, velocity: 3, seed: 23 },
      }),
    );
    s.track(
      voice("vibes", "Amber reply", "vibes", 0.31, {
        pan: -0.5,
        reverb: hall,
        delay: { beats: 0.75, feedback: 0.24, mix: 0.13 },
        fx: { ...orbit, wobble: { depth: 5, rate: 0.37, drift: 0.6 } },
        humanize: { timing: 8, velocity: 5, seed: 5 },
      }),
    );
    s.track(
      voice("tape", "Tape knocks", "sampler", 0.3, {
        pan: -0.31,
        sampler: {
          mode: "keyed",
          voices: { tape: { ...bundledSampleRef("tape-hit"), fadeTime: 0.03 } },
        },
        delay: { beats: 1.5, feedback: 0.34, mix: 0.26, pingpong: true },
      }),
    );
    s.track(
      voice("swell", "Tape swell", "sampler", 0.24, {
        pan: 0.12,
        sampler: {
          mode: "keyed",
          voices: { rise: { ...bundledSampleRef("riser"), fadeTime: 0.2 } },
        },
        filter: { type: "lpf", cutoff: 4200, resonance: 0 },
        reverb: { ...hall, mix: 0.3 },
      }),
    );
    s.track(
      voice("dust", "Vinyl dust", "kit", 0.4, {
        kit: "lofi",
        filter: { type: "hpf", cutoff: 4200, resonance: 0 },
      }),
    );

    const roll = random(1984);
    const shade = (low: number, high: number) => low + (high - low) * roll();
    const chordAt = (bar: number) => CHORDS[Math.min(bar, END - 1)]!;
    const inDub = (bar: number) => bar >= DUB && bar < VERSE2;

    // ── Rhodes: rolled rootless voicings on each change, a soft restrike
    // when a chord holds a second bar, a pedal per chord, the sus resolved
    // on beat two with the voice. ──
    for (let bar = 0; bar < END; bar++) {
      const chord = chordAt(bar);
      if (inDub(bar)) {
        // Dub skank: short chords on two and four, a lazy 25 ms behind;
        // three notes under the singer, four where the voice rests.
        const skank = bar % 2 === 0 && bar < DUB + 6 ? chord.low : chord.keys;
        for (const beat of [1, 3]) {
          if (bar === VERSE2 - 1 && beat === 3) continue;
          skank.forEach((pitch, v) =>
            s.note(
              "keys",
              bar,
              beat + LATE + 0.008 * v,
              pitch,
              0.32,
              0.4 + 0.03 * v,
              { articulation: "staccato" },
            ),
          );
        }
        continue;
      }
      const lift =
        bar >= REFRAIN2 && bar < SHORE
          ? 1.16
          : bar >= REFRAIN1 && bar < DUB
            ? 1.12
            : bar < LOW || bar >= SHORE
              ? 0.88
              : bar >= VERSE2 && bar < REFRAIN2
                ? 0.9
                : 0.92;
      const held =
        bar > 0 && chordAt(bar - 1) === chord && !SUS_BARS.has(bar - 1);
      if (held) {
        // A soft restrike of the top two voices breathes in the second bar.
        if (bar >= SLACK + 1 || bar === SHORE - 1) continue;
        chord.keys
          .slice(2)
          .forEach((pitch, v) =>
            s.note(
              "keys",
              bar,
              1.5 + 0.012 + v * 0.011,
              pitch,
              1.6,
              0.36 * lift,
            ),
          );
        continue;
      }
      let span = 1;
      while (bar + span < END && chordAt(bar + span) === chord) span++;
      if (bar >= SLACK) span = END - bar;
      const sus = SUS_BARS.has(bar);
      const cadence = CADENCE_BARS.has(bar);
      // Under the singer only the low three voices; the full voicing where
      // the horn answers and in the instrumental bars. Where the voice holds
      // "turns" on B the Rhodes leaves the third out (F Ab D over the bass
      // G, the singer completing the chord), and under the shore's last
      // "tide" (an E flat the strings suspend too) it leaves out the D.
      const turnsBar =
        chord === G7B9 && (bar === REFRAIN1 + 7 || bar === REFRAIN2 + 7);
      const voicing = turnsBar
        ? [53, 56, 62]
        : chord === G7B9 && bar === SHORE + 2
          ? [53, 56, 59]
          : SUNG_BARS.has(bar)
            ? chord.low
            : chord.keys;
      const topVoice = voicing.length - 1;
      const length = sus ? 7.6 : span * 4 - 0.4;
      // Rolled bottom to top over about 25 ms, the top voice a touch louder.
      // At a cadence the third (or the suspended fourth) is struck and let
      // go at beat two: the singer takes it from there.
      voicing.forEach((pitch, v) =>
        s.note(
          "keys",
          bar,
          0.006 + v * 0.011,
          pitch,
          cadence && (pitch === 59 || pitch === 60) ? 1.9 : length,
          Math.min(0.9, (v === topVoice ? 0.62 : 0.5 + v * 0.02) * lift),
        ),
      );
      if (sus) {
        // The C gives way as the voice lands "turns" on B; only the D above
        // it is re-struck.
        s.note("keys", bar, 2 + 0.012, 62, 5.6, 0.52 * lift);
      }
      pedal.push({ tick: bar * BAR + 40, state: "down" });
      if (cadence) {
        // A quick pedal change at beat two releases the note that ended.
        pedal.push({ tick: bar * BAR + 2 * TPB - 24, state: "up" });
        pedal.push({ tick: bar * BAR + 2 * TPB + 24, state: "down" });
      }
      pedal.push({
        tick: (bar + (sus ? 2 : span)) * BAR - 30,
        state: "up",
      });
    }

    // ── Kick rows, shared by the drums and the bass so the two always land
    // together. The first groove is sparse, the refrains push with pickups,
    // and the second tide moves the second kick to the "and" of two. ──
    const KICKS = {
      verse: [
        "9..6......8.....",
        "8.....5...8.....",
        "9..6......8....4",
        "8.....5..7......",
      ],
      refrain: [
        "9..6......8.....",
        "8.....5...8..5..",
        "9..6...4..8.....",
        "8.....5..7....5.",
      ],
      tide: [
        "9.....5...8..5..",
        "8..5......8.....",
        "9.....5...8....4",
        "8..5..6..7......",
      ],
      shore: [
        "9.............6.",
        "9.....5.........",
        "9.............6.",
        "9.....5.........",
      ],
    } as const;
    const FILL_KICKS: Readonly<Record<number, string>> = {
      [REFRAIN1 - 1]: "8.....5...8.....",
      [DUB - 1]: "9..6............",
      [REFRAIN2 - 1]: "8.....5.........",
      [SHORE - 1]: "9..6......8.....",
    };
    const kickRow = (bar: number): string =>
      FILL_KICKS[bar] ??
      KICKS[
        bar < REFRAIN1
          ? "verse"
          : bar >= VERSE2 && bar < REFRAIN2
            ? "tide"
            : bar >= SHORE
              ? "shore"
              : "refrain"
      ][bar % 4]!;
    const kickSteps = (bar: number) =>
      [...kickRow(bar)].flatMap((hit, step) => (hit === "." ? [] : [step]));

    // ── Bass: plays with the kick, rises to the octave while the voice
    // falls, slides into each chord; silent for the first half of the dub
    // room and for the last beat before the shore. ──
    const bassBars = (bar: number) =>
      bar >= LOW && bar < VERSE2 && bar !== DUB && bar !== DUB + 1;
    const weightAt = (bar: number) =>
      bar < VERSE1
        ? 0.9
        : bar < REFRAIN1
          ? 0.95
          : bar >= REFRAIN2
            ? 1.06
            : bar < DUB
              ? 1.02
              : 1;
    const play = (
      b: number,
      beat: number,
      pitch: number,
      length: number,
      velocity: number,
      legato = false,
    ) => {
      // The silent beat before the shore: only the voice and strings ring.
      if (b === SHORE - 1 && beat >= 3) return;
      s.note(
        "bass",
        b,
        beat,
        pitch,
        length,
        Math.min(0.95, velocity * weightAt(b)),
        {
          ...(beat === 0 ? { articulation: "tenuto" as const } : {}),
          ...(legato ? { articulation: "legato" as const } : {}),
        },
      );
    };
    for (let bar = 0; bar < END; bar += 2) {
      if (!(bassBars(bar) || (bar >= REFRAIN2 && bar < SHORE))) continue;
      const chord = chordAt(bar);
      const { root: r, third, fifth, seventh } = chord;
      const next = chordAt(bar + 2);
      const lead = approach(r, next.root);
      /** The octave, or the fifth when the octave would crowd the Rhodes. */
      const top = r + 12 <= 48 ? r + 12 : r + fifth;
      const color = r + seventh <= 48 ? r + seventh : r + seventh - 12;
      if (inDub(bar)) {
        // The dub riff: long root, a climb through the chord, then space.
        s.note("bass", bar, 0, r, 1.3, 0.86, { articulation: "tenuto" });
        s.note("bass", bar, 1.5, r + fifth, 0.4, 0.6);
        s.note("bass", bar, 2, color, 0.4, 0.62);
        s.note("bass", bar, 2.5, top, 0.85, 0.7);
        s.note("bass", bar, 3.5, r + fifth, 0.35, 0.55);
        s.note("bass", bar + 1, 0, r, 2.4, 0.84);
        // The last riff leaves G1 through G2 and B2 so the second verse's
        // walk starts from C3 and is heard falling from there.
        const exit = bar === VERSE2 - 2;
        s.note(
          "bass",
          bar + 1,
          3,
          exit ? r + 12 : lead === r + third ? r + fifth : r + third,
          0.4,
          0.56,
        );
        if (exit)
          s.note("bass", bar + 1, 3.5, 47, 0.45, 0.62, {
            articulation: "legato",
          });
        else if (lead !== undefined)
          s.note("bass", bar + 1, 3.5, lead, 0.45, 0.6, {
            articulation: "legato",
          });
        continue;
      }
      for (const b of [bar, bar + 1]) {
        const second = b === bar + 1;
        const steps = kickSteps(b);
        const pickup = second && steps.some((step) => step >= 13);
        steps.forEach((step, k) => {
          const beat = at(step);
          const until = k + 1 < steps.length ? at(steps[k + 1]!) : 4;
          const room = Math.max(0.2, until - beat - 0.1);
          if (step === 0) {
            play(
              b,
              0,
              r,
              Math.min(room, second ? 1.85 : 1.4),
              second ? 0.82 : 0.86,
            );
          } else if (step <= 4) {
            play(b, beat, r, Math.min(room, 1.45), 0.64);
          } else if (step <= 8) {
            play(b, beat, second ? r + fifth : r, Math.min(room, 0.9), 0.56);
          } else if (step <= 11) {
            if (second) play(b, beat, r, Math.min(room, 0.6), 0.66);
            else play(b, beat, top, 0.42, 0.62);
          } else if (second) {
            // A kick near the bar line carries the slide into the next chord.
            play(b, beat, lead ?? r, 4 - beat, 0.6, true);
          } else {
            play(b, beat, r + fifth, Math.min(room, 0.4), 0.52);
          }
        });
        if (!second) {
          // The octave falls to the seventh before the bar line.
          if (!steps.some((step) => step >= 11 && step <= 13))
            play(b, 3, color, steps.includes(15) ? 0.62 : 0.8, 0.56);
        } else if (!pickup && b !== DUB - 1) {
          if (lead !== undefined) play(b, 3.5, lead, 0.5, 0.6, true);
          // Roots a step apart: the last note slides into the next chord.
          else play(b, 3.25 + SW, r, 0.6, 0.58, true);
        }
      }
    }
    // Second tide: the walk down by half steps from C3, B Bb A Ab, then F
    // to G, each bass note held on the downbeat with a chord tone beside it.
    const walk: readonly (readonly [
      bar: number,
      beat: number,
      pitch: number,
      length: number,
      velocity: number,
      legato?: boolean,
    ])[] = [
      [0, 0, 48, 1.4, 0.86],
      [0, at(6), 43, 0.9, 0.6],
      [0, at(10), 48, 0.6, 0.66],
      [0, at(13), 48, 0.7, 0.58, true],
      [1, 0, 47, 1.4, 0.84],
      [1, at(3), 47, 0.5, 0.6],
      [1, at(10), 43, 0.6, 0.6],
      [1, 3.25 + SW, 47, 0.6, 0.56, true],
      [2, 0, 46, 1.4, 0.84],
      [2, at(6), 43, 0.9, 0.6],
      [2, at(10), 46, 0.6, 0.64],
      [2, at(15), 46, 0.3, 0.56, true],
      [3, 0, 45, 1.4, 0.84],
      [3, at(3), 45, 0.5, 0.6],
      [3, at(6), 39, 0.6, 0.58],
      [3, at(9), 48, 0.6, 0.62],
      [3, 3.25 + SW, 45, 0.6, 0.56, true],
      [4, 0, 44, 1.4, 0.86],
      [4, at(6), 39, 0.9, 0.6],
      [4, at(10), 44, 0.6, 0.64],
      [4, at(13), 43, 0.7, 0.58, true],
      [5, 0, 41, 1.4, 0.84],
      [5, at(3), 41, 0.5, 0.6],
      [5, at(10), 48, 0.6, 0.64],
      [5, 3.25 + SW, 44, 0.6, 0.56, true],
      [6, 0, 43, 1.4, 0.86],
      [6, at(6), 38, 0.9, 0.6],
      [6, at(10), 43, 0.6, 0.64],
      [6, at(15), 41, 0.3, 0.56],
      [7, 0, 43, 1.4, 0.84],
      [7, at(6), 38, 0.9, 0.6],
      [7, 3.25 + SW, 43, 0.6, 0.56, true],
    ];
    for (const [bar, beat, pitch, length, velocity, legato] of walk)
      play(VERSE2 + bar, beat, pitch, length, velocity, legato);
    // The shore, half time: long low roots, a pickup on the "a" of four,
    // an approach into the last V, then one long C under the tail.
    for (const [bar, beat, pitch, length, velocity, legato] of [
      [0, 0, 36, 3.3, 0.84],
      [0, at(14), 43, 0.45, 0.56],
      [1, 0, 36, 1.4, 0.8],
      [1, at(6), 43, 0.9, 0.58],
      [1, 2.5, 46, 0.8, 0.54],
      [1, 3.5, 32, 0.5, 0.58, true],
      [2, 0, 31, 3.3, 0.84],
      [2, at(14), 38, 0.45, 0.56],
      [3, 0, 31, 1.4, 0.8],
      [3, at(6), 35, 0.9, 0.58],
    ] as const)
      play(SHORE + bar, beat, pitch, length, velocity, legato);
    s.note("bass", SLACK, 0, 36, 7.6, 0.78, { articulation: "tenuto" });

    // ── Drums: a four-bar break, side stick first, snare from the refrain ──
    const ghosts = [
      [7, 15],
      [3, 9],
      [7, 13],
      [5, 11],
    ];
    const kick = (bar: number, pattern: string, gain = 1) =>
      [...pattern].forEach((hit, step) => {
        if (hit !== ".")
          s.note("kick", bar, at(step), 36, 0.2, (Number(hit) / 10) * gain);
      });
    const groove = (bar: number, mode: "rim" | "snare" | "double") => {
      const cycle = bar % 4;
      kick(bar, kickRow(bar));
      const backbeat = mode === "rim" ? 37 : 38;
      const strength = mode === "rim" ? 0.62 : 0.84;
      s.note("drums", bar, 1 + LATE, backbeat, 0.14, strength * shade(0.94, 1));
      s.note(
        "drums",
        bar,
        3 + LATE + 0.004,
        backbeat,
        0.14,
        strength * shade(0.98, 1.06),
      );
      for (const step of ghosts[cycle]!)
        s.note("drums", bar, at(step), 38, 0.08, shade(0.12, 0.22));
      const open = cycle === 1 ? 14 : cycle === 3 ? 10 : -1;
      for (let step = 0; step < 16; step++) {
        if (step === open) {
          s.note("drums", bar, at(step), 46, 0.5, shade(0.3, 0.38));
          continue;
        }
        if (step % 2 === 0) {
          const accent = step % 4 === 0 ? 0.08 : 0;
          const lift = mode === "rim" ? 0.05 : 0.03;
          s.note(
            "drums",
            bar,
            at(step),
            42,
            0.1,
            shade(0.26, 0.44) + accent + lift,
          );
        } else if (mode === "double" || (step === 15 && cycle === 1))
          s.note("drums", bar, at(step), 42, 0.08, shade(0.14, 0.26));
      }
    };
    const fills = [LOW + 3, REFRAIN1 - 1, DUB - 1, REFRAIN2 - 1, SHORE - 1];
    for (let bar = LOW; bar < SHORE; bar++) {
      if (inDub(bar) || fills.includes(bar)) continue;
      groove(
        bar,
        bar < REFRAIN1
          ? "rim"
          : bar >= VERSE2 && bar < REFRAIN2
            ? "double"
            : "snare",
      );
    }
    // Bar 7: the side stick hands over with a drag into the verse.
    groove(LOW + 3, "rim");
    s.note("drums", LOW + 3, 3.62, 38, 0.06, 0.2);
    s.note("drums", LOW + 3, 3.7, 38, 0.06, 0.28);
    // Bar 15: a tom pickup into the refrain; hats drop out on four.
    kick(REFRAIN1 - 1, kickRow(REFRAIN1 - 1));
    s.note("drums", REFRAIN1 - 1, 1 + LATE, 37, 0.14, 0.6);
    for (const step of [0, 2, 4, 6, 8, 10])
      s.note("drums", REFRAIN1 - 1, at(step), 42, 0.1, shade(0.26, 0.4));
    for (const [beat, pitch, velocity] of [
      [3, 48, 0.5],
      [3.25 + SW, 47, 0.46],
      [3.5, 45, 0.58],
      [3.75 + SW, 43, 0.66],
    ] as const)
      s.note("drums", REFRAIN1 - 1, beat, pitch, 0.3, velocity);
    // Bar 23: the floor gives way; one snare goes into the echo and the
    // tape stops under it.
    kick(DUB - 1, kickRow(DUB - 1));
    s.note("drums", DUB - 1, 1 + LATE, 38, 0.14, 0.78);
    s.note("drums", DUB - 1, 0, 42, 0.1, 0.34);
    s.note("drums", DUB - 1, 0.5, 42, 0.1, 0.3);
    s.note("throws", DUB - 1, 3 + LATE, 38, 0.14, 0.8);
    // Bar 39: the glitch fill. A snare ratchet in 32nds ramps up under the
    // tape swell while the tape sampler ratchets a rising pitch.
    kick(REFRAIN2 - 1, kickRow(REFRAIN2 - 1));
    s.note("drums", REFRAIN2 - 1, 1 + LATE, 38, 0.14, 0.76);
    for (const step of [0, 2, 4, 6])
      s.note("drums", REFRAIN2 - 1, at(step), 42, 0.1, shade(0.26, 0.4));
    for (let k = 0; k < 8; k++) {
      const tight = { humanize: { timing: 0, velocity: 0, length: 0 } };
      s.note(
        "drums",
        REFRAIN2 - 1,
        2 + k * 0.125,
        38,
        0.06,
        0.18 + k * 0.05,
        tight,
      );
      s.note(
        "drums",
        REFRAIN2 - 1,
        3 + k * 0.125,
        38,
        0.06,
        0.4 + k * 0.05,
        tight,
      );
      s.note(
        "tape",
        REFRAIN2 - 1,
        3 + k * 0.125,
        [60, 62, 63, 65, 67, 68, 71, 72][k]!,
        0.11,
        0.3 + k * 0.045,
      );
    }
    // Bar 47: the break thins to kick, snare and a last open hat, then the
    // silent beat before the shore.
    kick(SHORE - 1, "9..6......8.....");
    s.note("drums", SHORE - 1, 1 + LATE, 38, 0.14, 0.72);
    s.note("drums", SHORE - 1, at(10), 46, 0.6, 0.3);
    for (const step of [0, 2, 4, 6, 8])
      s.note("drums", SHORE - 1, at(step), 42, 0.1, shade(0.26, 0.4));
    // Crashes mark the refrains, the return of the full break and the flip.
    for (const [bar, velocity] of [
      [REFRAIN1, 0.5],
      [VERSE2, 0.4],
      [REFRAIN2, 0.56],
      [SHORE, 0.46],
    ] as const)
      s.note("drums", bar, 0, 49, 2, velocity);

    // Dub room: no kick for four bars (one-drop side stick, skank hats,
    // throws), then the heartbeat kick returns under the riff.
    for (let bar = DUB; bar < VERSE2; bar++) {
      if (bar >= DUB + 4)
        kick(bar, bar % 2 ? "8.........5....." : "9..5............");
      if (bar !== VERSE2 - 1)
        s.note("drums", bar, 2 + LATE, 37, 0.14, shade(0.5, 0.58));
      for (const step of [6, 14])
        if (!(bar === VERSE2 - 1 && step === 14))
          s.note("drums", bar, at(step), 46, 0.3, shade(0.16, 0.24));
      if (bar % 2 === 0) s.note("throws", bar, 3 + LATE, 38, 0.14, 0.72);
      else if (bar === DUB + 3 || bar === DUB + 5)
        s.note("throws", bar, 3.75 + SW, 38, 0.14, 0.42);
    }
    // Shore: the half-time flip. Kick on one, a fat late snare on three,
    // swung eighth hats, an open hat on the "and" of four every other bar;
    // the last bar drops out after the snare.
    for (let bar = SHORE; bar < SLACK; bar++) {
      const last = bar === SLACK - 1;
      kick(bar, kickRow(bar));
      s.note("drums", bar, 2 + LATE * 1.5, 38, 0.16, 0.84 * shade(0.96, 1.04));
      if (bar % 2) s.note("drums", bar, at(11), 38, 0.08, 0.18);
      for (let step = 0; step < (last ? 9 : 16); step += 2) {
        if (step === 14 && bar % 2) {
          s.note("drums", bar, at(step), 46, 0.5, 0.34);
          continue;
        }
        const accent = step % 4 === 0 ? 0.06 : 0;
        s.note("drums", bar, at(step), 42, 0.1, shade(0.28, 0.4) + accent);
      }
    }
    // Slack water: the heartbeat fades.
    kick(SLACK, "8..5............");
    kick(SLACK + 1, "6...............");
    s.note("throws", SLACK + 1, 1 + LATE, 37, 0.14, 0.5);

    // ── Vocal ──
    /**
     * The refrains are double-tracked: a second take of the same line, a few
     * cents sharp, about 20 ms late and panned away, as on a tape double.
     * With `stutter`, the line's last syllable is cut and re-fired as 32nds
     * that fade, then lands once more on the next downbeat.
     */
    const sing = (
      bar: number,
      line: readonly Sung[],
      gain = 1,
      doubled = false,
      stutter = false,
      open = false,
    ) =>
      line.forEach(([beat, pitch, length, velocity, lyric], i) => {
        const first = i === 0;
        // An open line runs on into the next one: no fall on its last note.
        const final = i === line.length - 1 && !open;
        const takes: readonly (readonly [string, number, number])[] = doubled
          ? [
              ["vocal", 0, 1],
              ["double", 0.028, 0.84],
            ]
          : [["vocal", 0, 1]];
        for (const [track, late, level] of takes) {
          const v = velocity * gain * level;
          const vib =
            track === "vocal"
              ? LONG_VIBRATO
              : { rate: 5.6, depth: 13, delay: 0.5 };
          if (final && stutter) {
            s.note(track, bar, beat + late, pitch, 0.45, v, { lyric });
            [0.5, 0.625, 0.75, 0.875].forEach((off, k) =>
              s.note(
                track,
                bar,
                beat + off + late,
                pitch,
                0.1,
                v * (0.84 - k * 0.14),
                {
                  lyric: "_",
                  articulation: "staccato",
                  humanize: { timing: 0, velocity: 0, length: 0 },
                },
              ),
            );
            s.note(track, bar + 1, late, pitch, 0.6, v * 0.52, {
              lyric: "_",
              bend: FALL,
              vibrato: vib,
            });
            continue;
          }
          s.note(
            track,
            bar,
            beat + late,
            pitch,
            track === "vocal" ? length : Math.max(0.2, length - 0.06),
            v,
            {
              lyric,
              ...(track === "double" ? { cents: 7 } : {}),
              ...(first && length >= 0.4 && track === "vocal"
                ? { bend: SCOOP }
                : {}),
              ...(final
                ? track === "vocal"
                  ? { bend: FALL, vibrato: vib }
                  : { vibrato: vib }
                : {}),
              ...(!final && length >= 1 && track === "vocal"
                ? { vibrato: { rate: 5.3, depth: 16, delay: 0.4 } }
                : {}),
            },
          );
        }
      });
    VERSE_ONE.forEach((line, i) => sing(VERSE1 + i * 2, line));
    REFRAIN_LINES.forEach((line, i) =>
      sing(REFRAIN1 + i * 2, line, 1, true, i === 0),
    );
    VERSE_TWO.forEach((line, i) => sing(VERSE2 + i * 2, line, 1.04));
    // The return: the high hook, "don't pull me under", then "leave the
    // light on till the water turns" as one phrase into the cadence.
    sing(REFRAIN2, HOOK_HIGH, 1, true, true);
    sing(REFRAIN2 + 2, UNDER, 1.06, true);
    sing(REFRAIN2 + 4, LIGHT_LONG, 1.06, true, false, true);
    // The last "turns" leans on B and rises to C as the shore arrives.
    s.note("vocal", REFRAIN2 + 6, 2, 59, 10, 0.72, {
      lyric: "turns",
      bend: [
        { at: 0, cents: 0 },
        { at: 0.54, cents: 0 },
        { at: 0.6, cents: 100 },
        { at: 1, cents: 100 },
      ],
      vibrato: LONG_VIBRATO,
    });
    // Dub room: the hook hocketed between the voice and the horn. The voice
    // sings "Low" and "low"; the horn plays the "tide"s an octave up, so the
    // sum of the two is the refrain's first line. Line two is split the same
    // way, line three is sung whole once the kick returns.
    s.note("vocal", DUB, 0.5, 67, 0.9, 0.66, { lyric: "Low", bend: SCOOP });
    s.note("vocal", DUB, 2.5, 68, 0.45, 0.62, { lyric: "low" });
    s.note("vocal", DUB + 2, 0.5, 65, 0.4, 0.62, { lyric: "don't" });
    s.note("vocal", DUB + 2, 1.75 + SW, 65, 0.25, 0.56, { lyric: "me" });
    s.note("vocal", DUB + 2, 2, 63, 0.5, 0.62, { lyric: "un-" });
    s.note("vocal", DUB + 2, 2.5, 60, 1.8, 0.62, {
      lyric: "der",
      bend: FALL,
      vibrato: LONG_VIBRATO,
    });
    sing(DUB + 4, LIGHT, 0.96);
    // Shore: one last, distant call; the horn answers it into the tail.
    s.note("vocal", SHORE + 1, 2.5, 67, 0.9, 0.52, {
      lyric: "low",
      bend: SCOOP,
    });
    s.note("vocal", SHORE + 1, 3.5, 63, 2.6, 0.5, {
      lyric: "tide",
      bend: FALL,
      vibrato: LONG_VIBRATO,
    });

    // ── Horn: the answer in every rest of the voice ──
    const blow = (bar: number, phrase: Blown, gain = 1) =>
      phrase.forEach(([beat, pitch, length, velocity], i) =>
        s.note("reply", bar, beat, pitch, length, velocity * gain, {
          ...(i === phrase.length - 1 || length >= 0.9
            ? { vibrato: HORN_VIBRATO }
            : {}),
          ...(i === 0 ? { bend: SCOOP } : {}),
        }),
      );
    // Low water: the vibes state the hook, the horn answers it once.
    blow(LOW + 2, ANSWER_C, 0.9);
    // First light: stated, restated (cut short for the voice's pickup),
    // varied, resolved onto the refrain.
    blow(VERSE1 + 1, ANSWER_A);
    blow(VERSE1 + 3, ANSWER_B_SHORT);
    blow(VERSE1 + 5, ANSWER_C);
    blow(VERSE1 + 7, ANSWER_D);
    s.note("reply", REFRAIN1, 0, 72, 1.5, 0.5, { vibrato: HORN_VIBRATO });
    // Refrain one: a sigh after "under", then the "tide"s an octave up in
    // the gap after the high hook, the figure the dub room's hocket takes.
    blow(REFRAIN1 + 3, SIGH);
    s.note("reply", REFRAIN1 + 5, 1.5, 75, 0.9, 0.5, { bend: SCOOP });
    s.note("reply", REFRAIN1 + 5, 3, 79, 1.4, 0.56, {
      bend: FALL,
      vibrato: HORN_VIBRATO,
    });
    // Dub room: the hocket's "tide"s, "pull", then the fourth answer alone,
    // its C landing on the second verse's downbeat.
    s.note("reply", DUB, 1.5, 75, 0.9, 0.56, { bend: SCOOP });
    s.note("reply", DUB, 3, 79, 1.6, 0.58, {
      bend: FALL,
      vibrato: HORN_VIBRATO,
    });
    s.note("reply", DUB + 2, 1, 80, 0.6, 0.6, { bend: SCOOP });
    blow(DUB + 7, ANSWER_D, 0.9);
    s.note("reply", VERSE2, 0, 72, 0.45, 0.46);
    // Second tide: the motif over the line cliché; the second answer comes
    // late and lands on the next downbeat, the last starts as a pickup
    // under "sand" and holds the leading tone through the ratchet.
    blow(VERSE2 + 1, ANSWER_A2);
    blow(VERSE2 + 3, ANSWER_B_LATE);
    blow(VERSE2 + 5, ANSWER_C2);
    s.note("reply", VERSE2 + 6, 3.5, 77, 1.4, 0.6, { bend: SCOOP });
    s.note("reply", VERSE2 + 7, 1, 74, 0.9, 0.54);
    s.note("reply", VERSE2 + 7, 2, 71, 1.9, 0.5, { vibrato: HORN_VIBRATO });
    s.note("reply", REFRAIN2, 0, 72, 0.9, 0.52, { vibrato: HORN_VIBRATO });
    // Refrain return: thirds under the vibes' answers; the third gap is
    // sung through.
    for (const [bar, a, b, c] of [
      [REFRAIN2 + 1, 77, 75, 72],
      [REFRAIN2 + 3, 73, 72, 68],
    ] as const) {
      s.note("reply", bar, 1.5 + SW, a, 0.5, 0.5);
      s.note("reply", bar, 2, b, 0.5, 0.52);
      s.note("reply", bar, 2.5, c, 1.2, 0.54, { vibrato: HORN_VIBRATO });
    }
    // Shore: the fourth answer once more, resolving onto the tail's C.
    s.note("reply", SHORE + 3, 0.5, 77, 0.5, 0.54, { bend: SCOOP });
    s.note("reply", SHORE + 3, 1, 74, 0.5, 0.52);
    s.note("reply", SHORE + 3, 1.5 + SW, 71, 0.9, 0.52);
    s.note("reply", SLACK, 0, 72, 3.5, 0.54, { vibrato: HORN_VIBRATO });

    // ── Strings: an inverted C pedal over the refrains with a tenor line
    // under it, 4-3 at each cadence as the voice lands on B, a 9-8 into the
    // second verse, a G pedal under the chromatic walk, four voices for the
    // return, then a C minor tail. ──
    const bow = (
      bar: number,
      beat: number,
      pitch: number,
      length: number,
      velocity: number,
    ) => s.note("strings", bar, beat, pitch, length, velocity);
    const cello = (
      bar: number,
      beat: number,
      pitch: number,
      length: number,
      velocity: number,
    ) => s.note("cellos", bar, beat, pitch, length, velocity);
    const refrainStrings = (start: number, gain: number, tail: boolean) => {
      // The C pedal: re-bowed on beat three of the bar before the cadence,
      // tied over the bar line into G7 and let down to B as the voice lands
      // "turns".
      for (let b = 0; b < 4; b += 2) bow(start + b, 0, 72, 7.9, 0.5 * gain);
      bow(start + 4, 0, 72, 5.9, 0.52 * gain);
      bow(start + 5, 2, 72, 3.95, 0.54 * gain);
      bow(start + 6, 2, 71, 5.9, 0.52 * gain);
      // Cellos under the Rhodes: Ab, F, Eb, then the seventh F, which is
      // tied into the next section and falls to Eb there (the tail).
      [56, 53, 51].forEach((pitch, i) =>
        cello(start + i * 2, 0, pitch, 7.9, (0.44 + i * 0.012) * gain),
      );
      cello(start + 6, 0, 53, tail ? 5.9 : 7.9, 0.48 * gain);
      if (tail) {
        cello(start + 7, 2, 53, 3.95, 0.48 * gain);
        cello(start + 8, 2, 51, 5.9, 0.42);
      }
    };
    refrainStrings(REFRAIN1, 1, false);
    // Into the second verse, a double suspension: D and F over G7 are tied
    // across the bar line into Cm and let down to C and Eb on beat two.
    bow(VERSE2 - 1, 3, 74, 2.9, 0.42);
    bow(VERSE2 - 1, 3, 77, 2.9, 0.38);
    bow(VERSE2, 2, 72, 1.9, 0.4);
    bow(VERSE2, 2, 75, 1.9, 0.36);
    for (let b = 1; b < 8; b += 2)
      cello(VERSE2 + b, 0, 55, 7.9, 0.4 + b * 0.01);
    refrainStrings(REFRAIN2, 1.12, true);
    for (const [bar, beat, pitch, length, velocity] of [
      // A high line over the second half of the return: Eb tied over the
      // bar line into G7 and let down to D with the pedal's C to B.
      [REFRAIN2 + 4, 0, 75, 5.9, 0.5],
      [REFRAIN2 + 5, 2, 75, 3.95, 0.52],
      [REFRAIN2 + 6, 2, 74, 5.9, 0.52],
      // Shore: home, the same 4-3 over the last V, a line G F Eb D on top
      // with the Eb suspended too, then the tail.
      [SHORE, 0, 72, 5.9, 0.48],
      [SHORE + 1, 2, 72, 3.95, 0.48],
      [SHORE + 2, 2, 71, 5.9, 0.44],
      [SHORE, 0, 79, 3.9, 0.42],
      [SHORE + 1, 0, 77, 1.95, 0.4],
      [SHORE + 1, 2, 75, 3.95, 0.4],
      [SHORE + 2, 2, 74, 5.9, 0.4],
      [SLACK, 0, 72, 7.8, 0.36],
      [SLACK, 0, 63, 7.8, 0.3],
      [SLACK, 0, 79, 7.8, 0.26],
    ] as const)
      bow(bar, beat, pitch, length, velocity);
    cello(SHORE + 2, 0, 50, 7.9, 0.4);
    cello(SLACK, 0, 55, 7.8, 0.32);

    // ── Vibes: the hook first, then answers in the refrain's gaps ──
    for (const [bar, beat, pitch, length, velocity] of [
      [2, 0.5, 79, 0.9, 0.34],
      [2, 1.5, 75, 1.6, 0.3],
      [LOW, 0.5, 79, 0.9, 0.44],
      [LOW, 1.5, 75, 1.1, 0.4],
      [LOW, 2.5, 80, 0.45, 0.42],
      [LOW, 3, 79, 1.5, 0.44],
      [DUB + 1, 0.75, 75, 1.3, 0.42],
      [DUB + 1, 2.5, 74, 1.2, 0.36],
      [DUB + 5, 0.75, 79, 1.3, 0.42],
      [DUB + 5, 2.5, 75, 1.2, 0.36],
      [REFRAIN2 + 1, 1.5 + SW, 80, 0.5, 0.42],
      [REFRAIN2 + 1, 2, 79, 0.5, 0.44],
      [REFRAIN2 + 1, 2.5, 75, 1.2, 0.46],
      [REFRAIN2 + 3, 1.5 + SW, 77, 0.5, 0.42],
      [REFRAIN2 + 3, 2, 75, 0.5, 0.44],
      [REFRAIN2 + 3, 2.5, 72, 1.2, 0.46],
      // The last exchange: the vibes answer the horn's tag and the song ends.
      [SLACK + 1, 0.5, 79, 0.9, 0.38],
      [SLACK + 1, 1.5, 75, 1.1, 0.35],
      [SLACK + 1, 2.5, 74, 0.5, 0.34],
      [SLACK + 1, 3, 72, 0.95, 0.36],
    ] as const)
      s.note("vibes", bar, beat, pitch, length, velocity);

    // ── Tape knocks and the swells ──
    for (const [bar, beat, velocity] of [
      [3, 3.5, 0.5],
      [DUB - 1, 3.5, 0.5],
      [DUB, 1.5, 0.56],
      [DUB + 2, 1.5, 0.52],
      [DUB + 4, 1.5, 0.56],
      [DUB + 6, 1.5, 0.5],
      [VERSE2 - 1, 3.5 + SW, 0.4],
      [SHORE - 1, 3.5, 0.44],
      [SHORE + 1, 1.5, 0.5],
      [SLACK + 1, 1.5, 0.42],
    ] as const)
      s.note("tape", bar, beat, 60, 0.2, velocity);
    s.note("swell", REFRAIN1 - 1, 1.4, 58, 2.6, 0.45);
    s.note("swell", REFRAIN2 - 1, 1.2, 60, 2.8, 0.7);
    s.note("swell", SHORE - 1, 2, 57, 2, 0.4);

    // ── Vinyl dust: tiny clicks, never on the grid, mostly faint with the
    // odd pop; clearest in the room tone and the slack water, where the band
    // is quiet, and thinned out under the full break. ──
    const dust = random(77);
    for (let bar = 0; bar < END; bar++) {
      const open = bar < LOW || bar >= SLACK;
      const count = open ? 8 : inDub(bar) ? 6 : 4;
      for (let k = 0; k < count; k++) {
        const beat = Math.floor(dust() * 3.9 * 48) / 48 + 0.007;
        const grain = dust();
        const pop = grain > 0.93;
        s.note(
          "dust",
          bar,
          beat,
          42,
          0.03,
          (pop ? 0.09 + grain * 0.04 : 0.025 + grain * 0.04) * (open ? 1.2 : 1),
        );
      }
    }

    // ── The tape stop: everything pitched that is still ringing over the
    // last beat of bar 23 dives an octave into the dub room. ──
    const stopAt = DUB * BAR - TPB;
    const stopEnd = DUB * BAR;
    const pitched = new Set([
      "keys",
      "strings",
      "cellos",
      "bass",
      "vibes",
      "reply",
    ]);
    s.notes.forEach((n, i) => {
      if (!pitched.has(n.trackId)) return;
      const start = n.startTick!;
      const end = start + n.durationTicks!;
      if (start >= stopAt || end <= stopAt) return;
      const duration = Math.min(end, stopEnd) - start;
      const hold = (stopAt - start) / duration;
      s.notes[i] = {
        ...n,
        durationTicks: duration,
        bend: [
          { at: 0, cents: 0 },
          { at: hold, cents: 0 },
          { at: 1, cents: -1200 },
        ],
      };
    });

    return s.finish();
  },
};
