/** Signal Bloom: the synth pop demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import type { NoteInput } from "../score.ts";
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

/*
 * Arranged from a synth-pop style sheet (LinnDrum and DX-era records, Kate
 * Bush, Tears for Fears, Depeche Mode, CHVRCHES, The Weeknd) and built as
 * the shelf's arpeggio and counterpoint showcase: two arpeggios share the
 * sixteenths (one on the on-sixteenths, one on the offs, the same chord
 * tones rotated by two so the sum is a broken-thirds line), a third pluck
 * plays the pattern three sixteenths late as a Reich canon, a string line
 * answers the singer's held words, the bass moves against the hook, and a
 * 4-3 or 9-8 suspension sits at every cadence. The glitch tint is seasoning:
 * chopped syllables hocketing with the singer, 1/32 stutter ramps at phrase
 * ends, a bitcrush sweep over the last pre-chorus bar, and a final chorus
 * with 32nd-note hats, an octave-up double and a silent beat before it.
 * Every lyric is original.
 */

// Pad voicings sit between F3 and B4 so the singer owns the octave above.
const AM9 = [57, 60, 64, 67, 71],
  FMAJ9 = [53, 57, 60, 64, 67],
  CADD9 = [55, 60, 62, 64, 67],
  DM9 = [57, 60, 64, 65],
  DM7 = [57, 60, 62, 65],
  EM7 = [55, 59, 62, 64, 67],
  FMAJ7 = [57, 60, 64, 65],
  GSUS4 = [55, 60, 62, 67],
  G = [55, 59, 62, 67],
  FADD9 = [57, 60, 65, 67],
  AM7 = [57, 60, 64, 67],
  C_G = [55, 60, 64, 67],
  AM_C_SUS = [57, 62, 64, 69],
  AM_C = [57, 60, 64, 69],
  ESUS4 = [57, 59, 64, 69],
  E = [56, 59, 64, 68],
  E7 = [56, 59, 62, 64],
  G6 = [55, 59, 62, 64];
// Bass roots in the A1..E2 octave; the chorus patterns add the octave above.
const A = 33,
  C = 36,
  D = 38,
  EB = 40,
  F = 29,
  GB = 31;

/**
 * One bar of harmony: the pad voicing, the bass root, four arpeggio tones
 * (low to high, C5..D6) that outline the chord's 9th, and optionally the
 * chord and tones from beat 2 when the bar carries a suspension resolving.
 */
type Harmony = Readonly<{
  chord: readonly number[];
  root: number;
  arp: readonly number[];
  then?: readonly number[];
  thenArp?: readonly number[];
}>;
const H = (
  chord: readonly number[],
  root: number,
  arp: readonly number[],
  then?: readonly number[],
  thenArp?: readonly number[],
): Harmony => ({ chord, root, arp, then, thenArp });

// Arpeggio top notes walk in a line: verse B A G A, pre-chorus A B C D,
// chorus A A B C, bridge C B A B.
const VERSE: readonly Harmony[] = [
  H(AM9, A, [72, 76, 79, 83]),
  H(FMAJ9, F, [72, 76, 79, 81]),
  H(CADD9, C, [72, 74, 76, 79]),
  // 4-3: the C of Cadd9 is held over the G bass and resolves to B.
  H(GSUS4, GB, [72, 74, 79, 81], G, [71, 74, 79, 81]),
];
const PRE: readonly Harmony[] = [
  // 9-8: E over the D bass resolves to D.
  H(DM9, D, [72, 74, 77, 81], DM7, [72, 74, 77, 81]),
  H(EM7, EB, [74, 76, 79, 83]),
  // 9-8: G over the F bass resolves to F.
  H(FADD9, F, [76, 79, 81, 84], FMAJ7, [76, 79, 81, 84]),
  H(GSUS4, GB, [74, 79, 84, 86], G, [74, 79, 83, 86]),
];
const CHORUS: readonly Harmony[] = [
  H(FADD9, F, [72, 76, 79, 81]),
  H(GSUS4, GB, [72, 74, 79, 81], G, [71, 74, 79, 81]),
  H(AM7, A, [72, 76, 79, 83]),
  H(C_G, GB, [72, 76, 79, 84]),
];
const POST: readonly Harmony[] = [
  H(FADD9, F, [72, 76, 79, 81]),
  H(GSUS4, GB, [72, 74, 79, 81], G, [71, 74, 79, 81]),
  H(AM7, A, [72, 76, 79, 83]),
  H(AM7, A, [72, 76, 79, 83]),
];
const BRIDGE: readonly Harmony[] = [
  H(DM9, D, [74, 77, 81, 84]),
  // 9-8 over the C bass: the D of Dm9 resolves to C.
  H(AM_C_SUS, C, [74, 76, 79, 83], AM_C, [72, 76, 79, 83]),
  H(FMAJ7, F, [72, 76, 79, 81]),
  H(ESUS4, EB, [71, 76, 81, 83], E, [71, 76, 80, 83]),
  H(DM9, D, [74, 77, 81, 84]),
  H(AM_C_SUS, C, [74, 76, 79, 83], AM_C, [72, 76, 79, 83]),
  H(FMAJ7, F, [72, 76, 79, 81]),
  H(ESUS4, EB, [71, 76, 81, 83], E7, [71, 74, 80, 83]),
];
const OUTRO: readonly Harmony[] = [
  H(FADD9, F, [72, 76, 79, 81]),
  H(GSUS4, GB, [72, 74, 79, 81], G6, [71, 74, 79, 81]),
  H(AM9, A, [72, 76, 79, 83]),
  H(AM9, A, [72, 76, 79, 83]),
];

type Part =
  "intro" | "pulse" | "verse" | "pre" | "chorus" | "post" | "bridge" | "outro";
const partOf = (bar: number): Part =>
  bar < 4
    ? "intro"
    : bar < 8
      ? "pulse"
      : bar < 16
        ? "verse"
        : bar < 20
          ? "pre"
          : bar < 28
            ? "chorus"
            : bar < 32
              ? "post"
              : bar < 40
                ? "bridge"
                : bar < 44
                  ? "verse"
                  : bar < 48
                    ? "pre"
                    : bar < 56
                      ? "chorus"
                      : bar < 60
                        ? "post"
                        : "outro";
const harmonyAt = (bar: number): Harmony => {
  const part = partOf(bar);
  if (part === "bridge") return BRIDGE[(bar - 32) % 8]!;
  const table =
    part === "pre"
      ? PRE
      : part === "chorus"
        ? CHORUS
        : part === "post"
          ? POST
          : part === "outro"
            ? OUTRO
            : VERSE;
  return table[bar % 4]!;
};

// The glass riff: one head, four tails that land on each pair of chords.
const RIFF_HEAD: Phrase = [
  [0, 76, 0.4, 0.74],
  [0.5, 72, 0.4, 0.56],
  [1, 74, 0.4, 0.62],
  [1.5, 76, 0.9, 0.72],
  [2.5, 79, 0.4, 0.66],
  [3, 76, 0.4, 0.58],
  [3.5, 74, 0.4, 0.6],
];
const riff = (tail: readonly (readonly [number, number])[]): Phrase => [
  ...RIFF_HEAD,
  [4, tail[0]![1], 0.9, 0.7],
  [5, tail[1]![1], 0.4, 0.56],
  [5.5, tail[2]![1], 0.4, 0.6],
  [6, tail[3]![1], 1.8, 0.66],
];
const RIFF_AM_F = riff([
  [4, 72],
  [5, 74],
  [5.5, 72],
  [6, 69],
]);
const RIFF_C_G = riff([
  [4, 74],
  [5, 71],
  [5.5, 72],
  [6, 67],
]);
const RIFF_F_G = riff([
  [4, 74],
  [5, 71],
  [5.5, 74],
  [6, 79],
]);
const RIFF_AM = riff([
  [4, 72],
  [5, 71],
  [5.5, 72],
  [6, 69],
]);

// Verse: syllabic, about one note per beat, inside a ninth (C4..C5).
const LATE_NIGHT: Phrase = [
  [0.5, 64, 0.45, 0.62, "Late"],
  [1.5, 67, 0.45, 0.68, "night"],
  [2.5, 64, 0.4, 0.56, "and"],
  [3, 62, 0.4, 0.54, "the"],
  [3.5, 60, 0.45, 0.6, "ci"],
  [4, 62, 0.45, 0.58, "ty"],
  [4.5, 64, 1.9, 0.68, "hums"],
];
const STATIC_WHERE: Phrase = [
  [0.5, 67, 0.45, 0.64, "stat"],
  [1, 64, 0.45, 0.56, "ic"],
  [1.5, 67, 0.45, 0.62, "where"],
  [2, 69, 0.4, 0.58, "your"],
  [2.5, 69, 0.9, 0.72, "voice"],
  [3.5, 67, 0.45, 0.6, "comes"],
  [4.5, 62, 1.8, 0.64, "from"],
];
const WINDOW_WIDE: Phrase = [
  [0.5, 64, 0.45, 0.62, "I"],
  [1, 67, 0.45, 0.64, "keep"],
  [1.5, 69, 0.45, 0.6, "the"],
  [2, 72, 0.45, 0.74, "win"],
  [2.5, 71, 0.45, 0.62, "dow"],
  [3, 69, 0.45, 0.62, "o"],
  [3.5, 67, 0.45, 0.58, "pen"],
  [4.5, 69, 1.9, 0.7, "wide"],
];
const LIGHT_OUTSIDE: Phrase = [
  [0.5, 67, 0.45, 0.64, "wait"],
  [1, 64, 0.45, 0.56, "ing"],
  [1.5, 62, 0.45, 0.56, "for"],
  [2, 64, 0.4, 0.58, "a"],
  [2.5, 67, 0.9, 0.72, "light"],
  [3.5, 64, 0.45, 0.6, "out"],
  [4.5, 62, 1.6, 0.64, "side"],
];
const words = (shape: Phrase, lyric: readonly string[]): Phrase =>
  shape.map(([beat, pitch, length, velocity], i) => [
    beat,
    pitch,
    length,
    velocity,
    lyric[i],
  ]);
const TURNS_TO_GOLD = words(LATE_NIGHT, [
  "Now",
  "the",
  "stat",
  "ic",
  "turns",
  "to",
  "gold",
]);
const COLOR_I_HOLD = words(STATIC_WHERE, [
  "ev",
  "ery",
  "col",
  "or",
  "I",
  "can",
  "hold",
]);

// Pre-chorus: sixteenth syncopation and a climb to a held D5 over the
// suspended V, written from the bar before (beat 3.5 is the pickup).
const FLICKER: Phrase = [
  [3.5, 65, 0.4, 0.6, "Ev"],
  [4, 65, 0.4, 0.6, "ery"],
  [4.75, 67, 0.4, 0.66, "flick"],
  [5.25, 69, 0.4, 0.64, "er"],
  [5.75, 69, 0.4, 0.62, "on"],
  [6.25, 67, 0.4, 0.6, "the"],
  [6.75, 69, 2.6, 0.74, "line"],
];
const COMING_THROUGH = (
  first: string,
  fifth: string,
  sixth: string,
): Phrase => [
  [2.5, 67, 0.45, 0.62, first],
  [3, 69, 0.45, 0.66, "I"],
  [3.5, 72, 0.75, 0.74, "feel"],
  [4.75, 69, 0.4, 0.64, "you"],
  [5.25, 72, 0.4, 0.7, fifth],
  [5.75, 72, 0.4, 0.68, sixth],
  [6.25, 74, 3.2, 0.8, "through"],
];

// Chorus: the highest part of the song (G4..E5), pushing "bloom" an eighth
// ahead of the VII chord so the band and the singer land together. "out"
// and "light" start a step above their chord tone and lean down onto it
// (appoggiaturas on the downbeat).
const SIGNAL: Phrase = [
  [0, 72, 0.7, 0.84, "Send"],
  [0.75, 69, 0.25, 0.64, "me"],
  [1, 72, 0.45, 0.72, "your"],
  [1.5, 76, 0.7, 0.9, "sig"],
  [2.25, 74, 0.25, 0.68, "nal"],
  [2.5, 72, 0.45, 0.7, "let"],
  [3, 69, 0.45, 0.66, "it"],
  [3.5, 74, 2.6, 0.84, "bloom"],
];
const INTO_THE_ROOM: Phrase = [
  [0, 74, 0.3, 0.8, "out"],
  [0.3, 72, 0.2, 0.7, "_"],
  [0.5, 71, 0.25, 0.6, "of"],
  [0.75, 69, 0.25, 0.58, "the"],
  [1, 72, 0.45, 0.74, "stat"],
  [1.5, 69, 0.45, 0.62, "ic"],
  [2.5, 69, 0.45, 0.68, "in"],
  [3, 67, 0.45, 0.64, "to"],
  [3.5, 64, 0.45, 0.6, "the"],
  [4, 67, 2.4, 0.74, "room"],
];
const LIGHT_UP: Phrase = [
  [0, 77, 0.3, 0.9, "light"],
  [0.3, 76, 0.45, 0.82, "_"],
  [0.75, 74, 0.25, 0.66, "up"],
  [1, 72, 0.45, 0.7, "the"],
  [1.5, 74, 0.45, 0.74, "win"],
  [2, 72, 0.45, 0.68, "dow"],
  [2.5, 76, 0.45, 0.86, "light"],
  [3, 74, 0.45, 0.72, "up"],
  [3.5, 71, 0.45, 0.66, "the"],
  [4, 72, 2.9, 0.8, "room"],
];

// Bridge: lower, longer notes over half-time drums, turning to E major.
const LIGHTS_GO_OUT: Phrase = [
  [1, 62, 0.45, 0.56, "If"],
  [1.5, 64, 0.45, 0.58, "the"],
  [2, 65, 0.9, 0.66, "lights"],
  [3, 64, 0.45, 0.58, "go"],
  [3.5, 62, 0.45, 0.58, "out"],
  [4, 64, 0.45, 0.6, "to"],
  [4.5, 60, 2.4, 0.64, "night"],
];
const FADES_TO_WHITE: Phrase = [
  [1, 65, 0.45, 0.58, "and"],
  [1.5, 67, 0.45, 0.6, "the"],
  [2, 69, 0.9, 0.7, "sig"],
  [3, 67, 0.45, 0.6, "nal"],
  [3.5, 65, 0.45, 0.6, "fades"],
  [4, 64, 0.45, 0.62, "to"],
  [4.5, 64, 1.4, 0.66, "white"],
  [6, 68, 1.8, 0.68, "oh"],
];
const BY_YOUR_LIGHT: Phrase = [
  [1, 69, 0.45, 0.64, "I"],
  [1.5, 69, 0.45, 0.64, "will"],
  [2, 72, 0.9, 0.76, "find"],
  [3, 71, 0.45, 0.66, "you"],
  [3.5, 69, 0.45, 0.64, "by"],
  [4, 71, 0.45, 0.66, "your"],
  [4.5, 72, 2.4, 0.78, "light"],
];
const BRIDGE_CRY: Phrase = [
  [0.5, 76, 1.4, 0.76, "oh"],
  [2, 74, 0.45, 0.64],
  [2.5, 72, 0.45, 0.62],
  [3, 71, 0.9, 0.64],
  [4, 68, 2.6, 0.68, "oh"],
];

// The string answer: a three-note motif (the 9th stepping down to a chord
// tone) that speaks in the gap after each held word, in the tenor so it
// never crosses the singer. Verse: stated, a step higher, varied, shortened.
const ANSWER_1: Phrase = [
  [2.5, 67, 0.45, 0.5],
  [3, 65, 0.45, 0.46],
  [3.5, 64, 0.9, 0.52],
];
const ANSWER_2: Phrase = [
  [2.5, 69, 0.45, 0.52],
  [3, 67, 0.45, 0.48],
  [3.5, 62, 0.9, 0.5],
];
const ANSWER_3: Phrase = [
  [2.5, 72, 0.45, 0.56],
  [2.75, 69, 0.25, 0.46],
  [3, 67, 0.45, 0.5],
  [3.5, 65, 0.9, 0.52],
];
const ANSWER_4: Phrase = [
  [2.25, 67, 0.35, 0.5],
  [2.75, 64, 0.35, 0.46],
  [3, 62, 0.45, 0.5],
];

export const signalBloom: DemoDefinition = {
  info: demoInfo({
    id: "signal-bloom",
    title: "Signal Bloom",
    style: "Synth pop",
    description:
      "A synth-pop song in A minor built on two interlocking arpeggios and a Reich-offset pluck: a gated Linn snare, a sequenced bass that moves against the sung hook, a string line answering in the singer's rests, suspensions at every cadence, and a glitch tint of chopped syllables, stutter ramps, a bitcrush pre-chorus and a silent beat before the final chorus.",
    tempoBpm: 108,
    key: "Am",
    bars: 64,
    highlightBar: 20,
    trackId: "vocal",
    features: [
      "two arpeggios on complementary sixteenths",
      "Reich-offset second pluck",
      "string counter-melody in the vocal's rests",
      "bass in contrary motion to the hook",
      "4-3 and 9-8 suspensions at the cadences",
      "gated Linn snare with a late clap",
      "original sung hook with appoggiaturas",
      "chopped-syllable hocket and stutter ramps",
      "bitcrush pre-chorus sweep",
      "silent beat into a double-time final chorus",
      "octave-up vocal double",
    ],
    arrangement: [
      "Glass intro 4",
      "Pulse 4",
      "Verse 8",
      "Prechorus 4",
      "Chorus 8",
      "Signal 4",
      "Bridge 8",
      "Verse return 4",
      "Second lift 4",
      "Final chorus 8",
      "Bloom 4",
      "Last light 4",
    ],
    mixNotes: [
      "Only the snare gets ambience, a short gated room; the kick and hats stay dry and the kick alone ducks the bass, chords and halo.",
      "Chords sit below B4 and the string answer below G4, so the singer owns C4-E5 and the two arpeggios share C5-D6, one panned each side with the glass pluck quieter and brighter.",
      "The bitcrush lives on the pad only, swept from 16 bits to 4 over the last pre-chorus bar and snapped clean on the chorus downbeat; the octave-up double is a soprano at a fifth of the lead's level.",
    ],
  }),
  build() {
    const s = new Composer(signalBloom.info);
    for (const [name, start, bars] of [
      ["Glass intro", 0, 4],
      ["Pulse", 4, 4],
      ["Verse", 8, 8],
      ["Prechorus", 16, 4],
      ["Chorus", 20, 8],
      ["Signal", 28, 4],
      ["Bridge", 32, 8],
      ["Verse return", 40, 4],
      ["Second lift", 44, 4],
      ["Final chorus", 48, 8],
      ["Bloom", 56, 4],
      ["Last light", 60, 4],
    ] as const)
      s.section(name, start, bars);

    s.track(
      voice("kick", "Linn kick", "kit", 0.64, {
        kit: "synlinn",
        // The Linn kick lives at 60-120 Hz; below 36 Hz is only rumble.
        filter: { type: "hpf", cutoff: 36, resonance: 0 },
        fx: { duck: { orbit: 2, depth: 0.3, attack: 0.16 } },
        humanize: { timing: 2, velocity: 3, seed: 11 },
      }),
    );
    s.track(
      voice("snare", "Gated snare", "kit", 0.48, {
        kit: "synlinn",
        reverb: {
          mix: 0.34,
          size: 0.5,
          predelay: 0.01,
          lowpass: 7000,
          ir: { src: "builtin:gate" },
        },
        humanize: { timing: 4, velocity: 4, seed: 12 },
      }),
    );
    s.track(
      voice("hats", "Linn hats", "kit", 0.56, {
        kit: "synlinn",
        pan: 0.2,
        humanize: { timing: 5, velocity: 7, seed: 13 },
      }),
    );
    s.track(
      voice("perc", "Toms, clap & crash", "kit", 0.4, {
        kit: "synlinn",
        pan: -0.16,
        reverb: { ...room, mix: 0.16 },
        humanize: { timing: 5, velocity: 5, seed: 14 },
      }),
    );
    s.track(
      preset("bass", "Analog bass", "moog-bass", 0.5, {
        filter: { type: "hpf", cutoff: 32, resonance: 0 },
        fx: orbit,
        humanize: { timing: 3, velocity: 4, length: 6, seed: 15 },
      }),
    );
    // The pad carries the bitcrush: 16 bits is clean, the lane dives to 4
    // over the last pre-chorus bar and snaps back on the chorus downbeat.
    const crushSweep = lanes(
      [0, 16],
      [18, 16],
      [19, 11],
      [19.75, 4],
      [19.98, 4],
      [20, 16],
      [46, 16],
      [47, 10],
      [47.7, 4],
      [47.74, 4],
      [47.75, 16],
    );
    s.track(
      voice("chords", "Warm polysynth", "saw", 0.48, {
        fx: {
          ...orbit,
          chorus: { rate: 0.55, depth: 0.5, mix: 0.45 },
          crush: { bits: 16, coarse: 1, mix: 0.6 },
        },
        fxAutomation: { "crush-bits": crushSweep },
        synth: {
          attack: 0.06,
          decay: 0.3,
          sustain: 0.62,
          release: 0.4,
          lpf: 2400,
          detune: 0.1,
        },
        reverb: room,
        humanize: { timing: 6, velocity: 4, seed: 16 },
        filterAutomation: lanes(
          [0, 700],
          [7, 1100],
          [8, 1000],
          [15, 1500],
          [16, 1300],
          [19.9, 3400],
          [20, 3600],
          [31, 3300],
          [32, 1000],
          [39, 2000],
          [40, 1200],
          [44, 1400],
          [47.7, 3800],
          [48, 4200],
          [59, 4600],
          [60, 2600],
          [63.9, 600],
        ),
      }),
    );
    // Arpeggio A on the on-sixteenths (left), arpeggio B on the offs (right,
    // a brighter glass pluck), the echo pluck three sixteenths behind A.
    s.track(
      preset("arp", "Pulse arpeggio", "pulse-seq", 0.38, {
        pan: -0.3,
        delay: { beats: 0.75, feedback: 0.26, mix: 0.16, pingpong: true },
        filter: { type: "hpf", cutoff: 220, resonance: 0 },
        humanize: { timing: 2, velocity: 5, seed: 18 },
      }),
    );
    s.track(
      preset("arp2", "Glass arpeggio", "glass-pluck", 0.3, {
        pan: 0.3,
        filter: { type: "hpf", cutoff: 300, resonance: 0 },
        reverb: { ...room, mix: 0.1 },
        humanize: { timing: 2, velocity: 6, seed: 23 },
      }),
    );
    s.track(
      preset("echo", "Canon pluck", "pluck-arp", 0.26, {
        pan: 0.42,
        filter: { type: "hpf", cutoff: 320, resonance: 0 },
        reverb: { ...room, mix: 0.14 },
        humanize: { timing: 3, velocity: 6, seed: 24 },
      }),
    );
    s.track(
      preset("hook", "Glass hook", "fm-bells", 0.34, {
        pan: 0.22,
        delay: { beats: 0.75, feedback: 0.28, mix: 0.18, pingpong: true },
        reverb: room,
        humanize: { timing: 4, velocity: 5, seed: 17 },
      }),
    );
    s.track(
      voice("vocal", "Signal singer", "sing", 0.8, {
        sing: {
          preset: "aah",
          voice: "alto",
          articulate: 1,
          breath: 0.12,
          jitter: 0.14,
          vib: 5,
          vibmod: 0.08,
          // A stronger singer's formant near 3 kHz cuts through the pads.
          ring: 0.32,
        },
        reverb: { ...hall, mix: 0.16, predelay: 0.03 },
        delay: { beats: 0.75, feedback: 0.2, mix: 0.1, pingpong: true },
        filter: { type: "hpf", cutoff: 150, resonance: 0 },
        humanize: { timing: 9, velocity: 4, length: 4, seed: 19 },
      }),
    );
    s.track(
      voice("double", "Octave double", "sing", 0.16, {
        pan: -0.26,
        sing: { preset: "soprano", vowel: "o", breath: 0.22, vib: 4.6 },
        reverb: hall,
        filter: { type: "hpf", cutoff: 300, resonance: 0 },
        humanize: { timing: 14, velocity: 5, seed: 20 },
      }),
    );
    s.track(
      voice("stay", "Stay chop", "sampler", 0.32, {
        pan: -0.3,
        sampler: {
          mode: "keyed",
          voices: {
            stay: {
              ...bundledSampleRef("stay-up"),
              begin: 0,
              end: 0.25,
              fadeTime: 0.012,
            },
          },
        },
        delay: { beats: 0.75, feedback: 0.24, mix: 0.16, pingpong: true },
        reverb: room,
        filter: { type: "hpf", cutoff: 180, resonance: 0 },
        humanize: { timing: 4, velocity: 5, seed: 21 },
      }),
    );
    s.track(
      voice("up", "Up reply", "sampler", 0.32, {
        pan: 0.3,
        sampler: {
          mode: "keyed",
          voices: {
            up: {
              ...bundledSampleRef("stay-up"),
              begin: 0.25,
              end: 0.5,
              fadeTime: 0.012,
            },
          },
        },
        delay: { beats: 0.5, feedback: 0.26, mix: 0.14, pingpong: true },
        reverb: room,
        filter: { type: "hpf", cutoff: 180, resonance: 0 },
        humanize: { timing: 4, velocity: 5, seed: 22 },
      }),
    );
    s.track(
      preset("answer", "String answer", "synth-strings", 0.4, {
        pan: 0.26,
        filter: { type: "hpf", cutoff: 200, resonance: 0 },
        reverb: { ...hall, mix: 0.18 },
        humanize: { timing: 8, velocity: 5, length: 5, seed: 25 },
      }),
    );
    s.track(
      voice("halo", "Wavetable halo", "wavetable", 0.2, {
        wavetable: {
          table: { src: "builtin:basic" },
          wt: 0.19,
          wtrate: 0.18,
          wtdepth: 0.1,
        },
        synth: { attack: 0.7, release: 1.4, lpf: 2600 },
        filter: { type: "hpf", cutoff: 330, resonance: 0 },
        fx: { ...orbit, chorus: { rate: 0.3, depth: 0.6, mix: 0.5 } },
        wtAutomation: lanes(
          [0, 0.08],
          [19, 0.16],
          [27, 0.3],
          [32, 0.1],
          [39, 0.24],
          [48, 0.22],
          [59, 0.42],
          [63, 0.05],
        ),
        pan: 0.08,
        reverb: hall,
        humanize: { timing: 10, velocity: 4, seed: 26 },
      }),
    );
    // Risers sweep a high-passed noise bed up into each arrival; the one
    // before the final chorus stops at beat 3 so the silent beat is silent.
    const risers = [3, 19, 31, 39, 47, 55];
    s.track(
      voice("lift", "Breath lifts", "white", 0.09, {
        synth: { attack: 0.5, release: 0.08 },
        reverb: hall,
        filter: { type: "hpf", cutoff: 1800, resonance: 0.1 },
        filterAutomation: lanes(
          [0, 900],
          ...risers.flatMap(
            (bar) =>
              [
                [bar, 900],
                [bar + (bar === 47 ? 0.74 : 0.97), 7200],
                [bar + (bar === 47 ? 0.75 : 1), 1200],
              ] as const,
          ),
          [62, 1600],
          [63.9, 5200],
        ),
        humanize: { timing: 6, velocity: 3, seed: 27 },
      }),
    );

    const note = (
      track: string,
      bar: number,
      beat: number,
      pitch: number,
      length: number,
      velocity: number,
      extra: Partial<NoteInput> = {},
    ) => s.note(track, bar, beat, pitch, length, velocity, extra);
    const sing = (bar: number, phrase: Phrase, track = "vocal", gain = 1) => {
      for (const [beat, pitch, length, velocity = 0.7, lyric] of phrase) {
        const extra: Partial<NoteInput> = {};
        if (lyric) Object.assign(extra, { lyric });
        // Held words bloom into vibrato; stressed words scoop up from below
        // (never an appoggiatura's resolution, which already leans down).
        if (length >= 1.4)
          Object.assign(extra, {
            vibrato: { rate: 5.2, depth: 22, delay: 0.32 },
          });
        if (velocity >= 0.8 && track === "vocal" && lyric !== "_")
          Object.assign(extra, {
            bend: [
              { at: 0, cents: -70 },
              { at: 0.14, cents: 0 },
            ],
          });
        // Unstressed syllables sit a hair behind the beat (about 9 ms) and
        // the double trails the lead by about 17 ms, as a sung double does.
        const lag =
          track === "vocal"
            ? velocity < 0.62 && lyric !== "_"
              ? 0.016
              : 0
            : 0.03;
        note(
          track,
          bar,
          beat + lag,
          pitch,
          length - lag,
          velocity * gain,
          extra,
        );
      }
    };
    const chord = (
      bar: number,
      beat: number,
      voicing: readonly number[],
      length: number,
      velocity: number,
    ) => s.chord("chords", bar, beat, voicing, length, velocity);

    // ---- Drums --------------------------------------------------------
    const kick = (bar: number, hits: readonly (readonly [number, number])[]) =>
      hits.forEach(([beat, velocity]) =>
        note("kick", bar, beat, 36, 0.2, velocity),
      );
    // The gated snare sits 5 ms late for weight; the clap trails it by 15 ms.
    const backbeat = (
      bar: number,
      beats: readonly number[],
      clap: boolean,
      gain = 1,
    ) =>
      beats.forEach((beat) => {
        note(
          "snare",
          bar,
          beat + 0.01,
          38,
          0.2,
          Math.min(1, (beat === 3 ? 0.94 : 0.9) * gain),
        );
        if (clap) note("perc", bar, beat + 0.027, 39, 0.2, 0.64);
      });
    const roll = (
      bar: number,
      from: number,
      to: number,
      low: number,
      step = 0.25,
    ) => {
      const steps = Math.round((to - from) / step);
      for (let i = 0; i < steps; i++)
        note(
          "snare",
          bar,
          from + i * step,
          38,
          step * 0.5,
          low + ((0.96 - low) * i) / Math.max(1, steps - 1),
        );
    };
    // Sixteenth hats with on-beat accents and a 55% swing on the offs.
    const HAT_16 = [
      0.6, 0.26, 0.44, 0.3, 0.56, 0.26, 0.44, 0.32, 0.6, 0.26, 0.44, 0.3, 0.56,
      0.28, 0.46, 0.36,
    ];
    // Each 4-bar phrase leans forward: the hats grow a little bar by bar, an
    // open hat lifts into the next phrase, and no hat plays under a crash.
    // "double" is the final chorus: straight sixteenths with a 32nd-note
    // ratchet on the "and" of 2 and of 4.
    const CRASH_BARS = new Set([8, 16, 20, 24, 28, 32, 40, 44, 48, 52, 56, 60]);
    const hats = (
      bar: number,
      mode: "8" | "16" | "open" | "soft" | "double",
      until = 16,
    ) => {
      const lean = 0.94 + (bar % 4) * 0.03,
        lift = bar % 4 === 3 && mode !== "soft" && until === 16;
      for (let i = 0; i < until; i++) {
        const offbeat8 = i % 4 === 2,
          beat = i / 4 + (i % 2 && mode !== "double" ? 0.025 : 0);
        if (i === 0 && CRASH_BARS.has(bar)) continue;
        if (lift && i >= 14) {
          if (i === 14) note("hats", bar, beat, 46, 0.55, 0.58 * lean);
          continue;
        }
        if (mode === "8" && i % 2) {
          if (i === 15 && bar % 2) note("hats", bar, beat, 42, 0.1, 0.3);
          continue;
        }
        if (mode === "soft" && i % 2) continue;
        if (mode === "open" && offbeat8) {
          note("hats", bar, beat, 46, 0.4, 0.5 * lean);
          continue;
        }
        if (mode === "double" && (i === 6 || i === 14)) {
          for (let r = 0; r < 2; r++)
            note("hats", bar, beat + r / 8, 42, 0.06, (0.3 + r * 0.1) * lean);
          continue;
        }
        const scale =
          mode === "soft"
            ? 0.62
            : mode === "8"
              ? 1.08
              : mode === "double"
                ? 1.04
                : 1;
        note("hats", bar, beat, 42, 0.1, HAT_16[i]! * scale * lean);
      }
    };
    const crash = (bar: number, velocity: number) =>
      note("perc", bar, 0, 49, 2, velocity);
    const toms = (bar: number, hits: readonly (readonly number[])[]) =>
      hits.forEach(([beat, pitch, velocity]) =>
        note("perc", bar, beat!, pitch!, 0.25, velocity!),
      );
    const FILL_SHORT = [
      [3, 48, 0.72],
      [3.25, 47, 0.6],
      [3.5, 45, 0.66],
      [3.75, 43, 0.62],
    ];
    const FILL_LONG = [
      [2, 50, 0.78],
      [2.25, 48, 0.58],
      [2.5, 48, 0.66],
      [2.75, 47, 0.58],
      [3, 45, 0.72],
      [3.25, 45, 0.58],
      [3.5, 43, 0.7],
      [3.75, 41, 0.66],
    ];
    const TOM_RIDE = [
      [0, 45, 0.62],
      [0.75, 43, 0.44],
      [1.5, 45, 0.5],
      [2.5, 41, 0.56],
      [3.25, 43, 0.46],
    ];

    for (let b = 0; b < 64; b++) {
      const part = partOf(b),
        odd = b % 2 === 1,
        phraseEnd = b % 4 === 3;
      if (part === "intro") {
        if (b === 3)
          toms(b, [
            [3, 45, 0.5],
            [3.5, 43, 0.62],
          ]);
      } else if (part === "pulse") {
        kick(b, [
          [0, 0.9],
          [2, 0.82],
        ]);
        hats(b, "soft");
        note("perc", b, 1, 37, 0.1, 0.42);
        note("perc", b, 3, 37, 0.1, 0.46);
        if (b === 7) toms(b, FILL_SHORT);
      } else if (part === "verse") {
        const stripped = b === 40 || b === 41;
        kick(b, [
          [0, 0.92],
          [1.5, 0.66],
          [2, 0.84],
          ...(odd ? ([[3.5, 0.6]] as const) : []),
        ]);
        if (stripped) {
          note("perc", b, 1, 37, 0.1, 0.5);
          note("perc", b, 3, 37, 0.1, 0.54);
          hats(b, "soft");
        } else {
          backbeat(b, [1, 3], false, b < 12 ? 0.82 : 0.88);
          if (odd) note("snare", b, 3.75, 38, 0.1, 0.2);
          hats(b, "8");
        }
        if (b === 8 || b === 40) crash(b, 0.5);
        if (b === 15) toms(b, FILL_LONG.slice(2));
        if (b === 43) toms(b, FILL_SHORT);
      } else if (part === "pre") {
        const last = b === 19 || b === 47,
          first = b === 16 || b === 44,
          silent = b === 47;
        kick(
          b,
          last
            ? [
                [0, 0.92],
                [1, 0.8],
                [2, 0.86],
                ...(silent ? [] : ([[3, 0.84]] as const)),
              ]
            : [
                [0, 0.92],
                [2, 0.86],
                [3.5, 0.64],
              ],
        );
        if (last) {
          backbeat(b, [1], false);
          // Chorus 1: a sixteenth roll to the bar line. Final chorus: a
          // 32nd-note ratchet that cuts dead at beat 3, the silent beat.
          if (silent) roll(b, 2, 3, 0.3, 0.125);
          else roll(b, 2, 4, 0.3);
        } else if (b % 4 < 2) backbeat(b, [2], false);
        else backbeat(b, [1, 3], false);
        hats(b, b % 4 < 2 ? "8" : "16", silent ? 12 : 16);
        if (first) crash(b, 0.42);
        if (last && !silent) toms(b, [[3, 45, 0.5]]);
      } else if (part === "chorus" || part === "post") {
        const final = b >= 48;
        kick(b, [
          [0, 0.95],
          [1, 0.8],
          [2, 0.9],
          [3, 0.8],
          ...(phraseEnd ? ([[3.5, 0.6]] as const) : []),
          ...(final && part === "chorus" && odd
            ? ([[2.75, 0.5]] as const)
            : []),
        ]);
        backbeat(b, [1, 3], true, part === "chorus" ? 1.05 : 1);
        // Ghost strokes before the backbeat keep the machine breathing.
        if (odd && !phraseEnd) note("snare", b, 2.75, 38, 0.1, 0.18);
        if (b % 4 === 2) note("snare", b, 1.75, 38, 0.1, 0.16);
        hats(
          b,
          part === "chorus" && final
            ? "double"
            : part === "post" && !odd
              ? "16"
              : "open",
        );
        if (b % 4 === 0) crash(b, b === 20 || b === 48 ? 0.85 : 0.6);
        if (b === 27 || b === 55) {
          toms(b, FILL_SHORT.slice(0, 2));
          // Glitch fill: a 32nd snare ratchet rising into the post-chorus.
          roll(b, 3.5, 4, 0.34, 0.125);
        }
        if (b === 31 || b === 59) toms(b, FILL_LONG);
      } else if (part === "bridge") {
        // The first half is the break: no kick for four bars, just the
        // snare on 3, the toms and the arpeggio; the kick returns at 36.
        if (b >= 36)
          kick(b, [
            [0, 0.9],
            [1.5, 0.54],
            [2.5, 0.5],
          ]);
        backbeat(b, [2], false, b < 36 ? 0.84 : 0.96);
        if (b === 32) crash(b, 0.55);
        if (b >= 36) hats(b, "soft");
        toms(b, b === 39 ? TOM_RIDE.slice(0, 3) : TOM_RIDE);
        if (b === 39) {
          roll(b, 3, 4, 0.36);
          toms(b, [
            [2.5, 47, 0.6],
            [3, 45, 0.66],
          ]);
        }
      } else if (b === 60 || b === 61) {
        kick(b, [[0, b === 60 ? 0.84 : 0.66]]);
        hats(b, "soft");
        if (b === 60) crash(b, 0.5);
      }
    }

    // ---- Harmony: bass, chords, arpeggios, halo ------------------------
    const OCTAVE_PULSE = [0.86, 0.58, 0.72, 0.58, 0.82, 0.58, 0.72, 0.62];
    const ROOT_PULSE = [0.78, 0.46, 0.6, 0.46, 0.72, 0.46, 0.62, 0.52];
    // Chorus bass, one bar each over F, G, Am7 and C/G: it dips to A1-G1 as
    // "sig-nal... bloom" rises, climbs A B while "bloom" holds, climbs C E A
    // as "out of the static" falls, and walks G B D E up into the F.
    const CHORUS_BASS = [
      [41, 29, 29, 29, 36, 29, 33, 31],
      [31, 43, 31, 43, 31, 43, 33, 35],
      [33, 45, 33, 45, 36, 40, 45, 43],
      [31, 43, 31, 43, 31, 35, 38, 40],
    ];
    // The second phrase of each chorus answers "light up the window" in
    // contrary motion (C A E G under C-E, E-D, D-B) and walks G B D E up to
    // E3 under the held "room", so the bass peaks late in the phrase.
    const CHORUS_BASS_2 = [
      CHORUS_BASS[0]!,
      CHORUS_BASS[1]!,
      [33, 45, 33, 45, 36, 33, 40, 43],
      [31, 43, 31, 43, 43, 47, 50, 52],
    ];
    const rotate = (set: readonly number[], by: number) =>
      set.map((_, i) => set[(i + by) % set.length]!);
    for (let b = 0; b < 64; b++) {
      const part = partOf(b),
        { chord: voicing, root, then } = harmonyAt(b),
        next = harmonyAt(Math.min(63, b + 1)),
        silent = b === 47,
        phraseEnd = b % 4 === 3;
      // Chorus pushes: the VII arrives an eighth early with the word "bloom",
      // suspended (G C D) and resolving to G on beat 3 of the next bar.
      const pushBar = part === "chorus" && b % 4 === 0,
        resolveBar = part === "chorus" && b % 4 === 1;

      // Bass
      if (part === "pulse" || part === "verse") {
        ROOT_PULSE.forEach((velocity, i) => {
          const octave = part === "verse" && i === 7 && b % 2 === 1;
          note(
            "bass",
            b,
            i / 2,
            root + (octave ? 12 : 0),
            i % 2 ? 0.28 : 0.36,
            velocity * (part === "pulse" ? 0.82 : b < 12 ? 0.86 : 0.92),
          );
        });
      } else if (part === "pre") {
        const last = b === 19 || b === 47;
        for (let i = 0; i < (silent ? 6 : 8); i++)
          note(
            "bass",
            b,
            i / 2,
            root + (last && i >= 6 ? 12 : 0),
            0.42,
            ROOT_PULSE[i]! * (0.9 + (b % 4) * 0.04),
          );
      } else if (part === "chorus") {
        ((b >= 48 ? b - 48 : b - 20) >= 4 ? CHORUS_BASS_2 : CHORUS_BASS)[
          b % 4
        ]!.forEach((pitch, i) =>
          note(
            "bass",
            b,
            i / 2,
            pitch,
            0.4,
            OCTAVE_PULSE[i]! * (b >= 48 ? 1.04 : 1),
          ),
        );
      } else if (part === "post") {
        OCTAVE_PULSE.forEach((velocity, i) =>
          note("bass", b, i / 2, root + (i % 2 ? 12 : 0), 0.4, velocity),
        );
      } else if (part === "bridge") {
        // "If the lights go out": the bass waits two bars, then holds each
        // root under the suspension chain, D C F E.
        if (b >= 34) {
          note("bass", b, 0, root, 3.3, b < 36 ? 0.62 : 0.74);
          note(
            "bass",
            b,
            3.5,
            b === 39 ? A : b === 34 ? C : root + 12,
            0.4,
            b < 36 ? 0.5 : 0.6,
          );
        }
      } else if (b >= 60) {
        if (b < 62) note("bass", b, 0, root, 3.8, 0.74);
        else if (b === 62) note("bass", b, 0, A, 7.8, 0.7);
      }

      // Chords
      const level =
        part === "intro"
          ? 0.4
          : part === "pulse"
            ? 0.44
            : part === "verse"
              ? b < 12
                ? 0.38
                : 0.44
              : part === "bridge"
                ? b < 36
                  ? 0.4
                  : 0.5
                : part === "chorus"
                  ? b >= 48
                    ? 0.72
                    : 0.6
                  : 0.58;
      if (part === "pre") {
        // Off-beat stabs build momentum under the climbing bass; the 9-8
        // and 4-3 resolve on the stab at beat 3.
        for (let i = 0; i < (silent ? 6 : 8); i++) {
          const chordNow = then && i >= 4 ? then : voicing;
          chord(
            b,
            i / 2,
            chordNow,
            i % 2 ? 0.3 : 0.4,
            (i % 2 ? 0.5 : 0.42) + (b % 4) * 0.04,
          );
        }
      } else if (part === "outro") {
        if (b === 61) {
          chord(b, 0, voicing, 1.9, 0.5);
          chord(b, 2, then!, 1.9, 0.48);
        } else if (b < 62) chord(b, 0, voicing, 3.85, 0.5);
        else if (b === 62) chord(b, 0, AM9, 7.8, 0.46);
      } else if (pushBar) {
        chord(b, 0, voicing, 3.4, level);
        chord(b, 3.5, next.chord, 2.4, level);
      } else if (resolveBar) {
        chord(b, 2, then!, 1.9, level);
      } else if (then) {
        chord(b, 0, voicing, 1.9, level);
        chord(b, 2, then, 1.9, level);
      } else {
        chord(b, 0, voicing, 3.85, level);
      }

      // Two arpeggios share the sixteenths. A (on the on-sixteenths) runs
      // the chord's four tones upward; B (on the offs) runs the same tones
      // rotated by two, so the sum is a0 a2 a1 a3 a2 a0 a3 a1, a line in
      // broken thirds. The last bar of each phrase runs downward. The echo
      // pluck repeats A three sixteenths late where B rests (a canon).
      const { arp: arpSet, thenArp } = harmonyAt(b);
      const withB =
        (part === "verse" && (b >= 12 || b >= 40)) ||
        part === "pre" ||
        part === "chorus" ||
        (part === "post" && b >= 56);
      const withEcho = part === "post" || (part === "bridge" && b >= 36);
      const steps = silent ? 12 : part === "outro" && b >= 62 ? 0 : 16;
      const gainA =
        part === "bridge"
          ? b < 36
            ? 0.42
            : 0.44 + (b - 36) * 0.04
          : part === "post"
            ? 0.56
            : part === "pre"
              ? 0.44 + (b % 4) * 0.05
              : part === "chorus"
                ? b >= 48
                  ? 0.56
                  : 0.48
                : part === "verse"
                  ? b < 12
                    ? 0.34
                    : 0.4
                  : part === "intro"
                    ? 0.4
                    : part === "outro"
                      ? 0.46
                      : 0.5;
      const gainB =
        part === "chorus"
          ? b >= 48
            ? 0.78
            : 0.7
          : part === "pre"
            ? 0.74
            : 0.66;
      const bUp = part === "post" && b >= 56;
      for (let i = 0; i < steps; i++) {
        const beat = i / 4,
          set = thenArp && beat >= 2 ? thenArp : arpSet,
          up = phraseEnd ? [...set].reverse() : set,
          seqA = up,
          seqB = rotate(up, 2),
          k = Math.floor(i / 2);
        if (i % 2 === 0)
          note(
            "arp",
            b,
            beat,
            seqA[k % 4]!,
            0.2,
            gainA * (k % 4 === 0 ? 1 : 0.74),
          );
        else if (withB)
          note(
            "arp2",
            b,
            beat,
            seqB[k % 4]! + (bUp ? 12 : 0),
            0.18,
            gainA * gainB * (k % 2 ? 0.78 : 0.9),
          );
        if (i % 2 === 0 && withEcho && b < 63)
          note(
            "echo",
            b,
            beat + 0.75,
            seqA[k % 4]!,
            0.2,
            gainA * 0.62 * (k % 4 === 2 ? 1 : 0.8),
          );
      }
      if (b === 62)
        [0, 1, 2, 3, 4, 5, 6, 7].forEach((i) =>
          note("arp", b, i / 2, AM9[i % 5]! + 12, 0.45, 0.5 - i * 0.04),
        );

      // Halo: the wavetable shimmer opens only at the peaks.
      if (
        (part === "chorus" && b % 4 === 0) ||
        (part === "post" && b % 4 === 0) ||
        (part === "bridge" && b % 4 === 0) ||
        b === 0 ||
        b === 60
      ) {
        const top = [...voicing]
          .sort((x, y) => x - y)
          .slice(-3)
          .map((p) => p + 12);
        s.chord(
          "halo",
          b,
          0,
          top,
          b === 60 ? 15.5 : 15.6,
          part === "chorus" ? 0.5 : 0.44,
        );
      }
    }

    // ---- Glass riff and chorus answers -------------------------------
    s.phrase("hook", 0, RIFF_AM_F, 0, 0.92);
    s.phrase("hook", 2, RIFF_C_G, 0, 0.96);
    for (const bar of [28, 56]) {
      s.phrase("hook", bar, RIFF_F_G);
      s.phrase("hook", bar + 2, RIFF_AM);
    }
    s.phrase("hook", 60, RIFF_F_G, 0, 0.78);
    s.phrase(
      "hook",
      62,
      [
        [0, 76, 0.4, 0.6],
        [0.5, 72, 0.4, 0.5],
        [1, 74, 0.4, 0.52],
        [1.5, 69, 6.2, 0.58],
      ],
      0,
      1,
    );
    // After "room" the bells cascade down; chorus 2 adds a high answer.
    for (const bar of [23, 27, 51, 55]) {
      s.phrase(
        "hook",
        bar,
        [
          [2.5, 79, 0.25, 0.56],
          [2.75, 76, 0.25, 0.5],
          [3, 72, 0.25, 0.52],
          [3.25, 74, 0.5, 0.56],
        ],
        0,
        bar >= 48 ? 1.08 : 1,
      );
    }

    // ---- Vocal ---------------------------------------------------------
    sing(8, LATE_NIGHT);
    sing(10, STATIC_WHERE);
    sing(12, WINDOW_WIDE);
    sing(14, LIGHT_OUTSIDE);
    sing(15, FLICKER);
    sing(17, COMING_THROUGH("I", "com", "ing"));
    // The last chorus is sung a little harder than the first.
    for (const bar of [20, 48]) {
      const push = bar === 48 ? 1.06 : 1;
      sing(bar, SIGNAL, "vocal", push);
      sing(bar + 2, INTO_THE_ROOM, "vocal", push);
      sing(bar + 4, SIGNAL, "vocal", push);
      sing(bar + 6, LIGHT_UP, "vocal", push);
    }
    sing(32, LIGHTS_GO_OUT);
    sing(34, FADES_TO_WHITE);
    sing(36, BY_YOUR_LIGHT);
    sing(38, BRIDGE_CRY);
    sing(40, TURNS_TO_GOLD);
    sing(42, COLOR_I_HOLD);
    sing(43, FLICKER);
    sing(45, COMING_THROUGH("now", "break", "ing"));
    // Bloom: the title phrase twice, the second reaching the top E.
    sing(56, [
      [0.5, 72, 0.4, 0.66, "let"],
      [1, 69, 0.4, 0.6, "it"],
      [1.5, 74, 2.2, 0.76, "bloom"],
    ]);
    sing(58, [
      [0.5, 72, 0.4, 0.68, "let"],
      [1, 71, 0.4, 0.62, "it"],
      [1.5, 76, 2.4, 0.82, "bloom"],
    ]);
    sing(60, [
      [0.5, 64, 0.45, 0.56, "light"],
      [1, 67, 0.45, 0.56, "up"],
      [1.5, 69, 0.45, 0.56, "the"],
      [2, 69, 5.6, 0.6, "room"],
    ]);

    // ---- Final-chorus double: the hook's long words an octave up --------
    const OCTAVE_SIGNAL: Phrase = [
      [0, 84, 0.7, 0.42],
      [1.5, 88, 0.7, 0.46],
      [3.5, 86, 2.6, 0.44],
    ];
    sing(48, OCTAVE_SIGNAL, "double");
    sing(
      50,
      [
        [0, 84, 0.45, 0.4],
        [1, 84, 0.45, 0.4],
        [4, 79, 2.4, 0.42],
      ],
      "double",
    );
    sing(52, OCTAVE_SIGNAL, "double");
    sing(
      54,
      [
        [0, 88, 0.7, 0.46],
        [2.5, 88, 0.45, 0.44],
        [4, 84, 2.9, 0.46],
      ],
      "double",
    );
    // Bloom and last light: a rising "oh" line behind the title.
    sing(
      56,
      [
        [0, 69, 3.8, 0.44],
        [4, 71, 3.8, 0.46],
        [8, 72, 3.8, 0.48],
        [12, 76, 3.8, 0.5],
        [16, 72, 3.8, 0.4],
        [20, 71, 3.8, 0.34],
      ],
      "double",
    );

    // ---- Chopped syllables: a hocket in the singer's rests -------------
    // "stay" and "up" trade sixteenths after "bloom" and "room", jumping
    // +5, +7 and +12 from the chop's own pitch; the final chorus lifts the
    // last two an octave.
    const hocket = (
      bar: number,
      from: number,
      pattern: readonly (readonly [number, number])[],
      lift = 0,
    ) =>
      pattern.forEach(([step, pitch], i) =>
        note(
          i % 2 ? "up" : "stay",
          bar,
          from + step / 4,
          pitch + (lift && i >= pattern.length - 2 ? 12 : 0),
          0.22,
          0.54 + (i % 2 ? 0.06 : 0) + i * 0.02,
        ),
      );
    const HOCKET_A = [
      [0, 60],
      [1, 67],
      [2, 60],
      [3, 65],
      [4, 67],
      [5, 72],
    ] as const;
    const HOCKET_B = [
      [0, 60],
      [2, 67],
      [3, 60],
      [4, 72],
      [5, 65],
    ] as const;
    for (const chorus of [20, 48]) {
      const lift = chorus === 48 ? 1 : 0;
      hocket(chorus + 1, 2.5, HOCKET_A, lift);
      hocket(chorus + 3, 2.5, HOCKET_B, lift);
      hocket(chorus + 5, 2.5, HOCKET_A, lift);
      hocket(chorus + 7, 3, HOCKET_B.slice(0, 4), lift);
    }
    // Pre-chorus: the chops fill the breath between "line" and the pickup.
    for (const bar of [17, 45]) {
      note("stay", bar, 1.25, 64, 0.35, 0.66);
      note("up", bar, 2, 67, 0.32, 0.6);
    }
    for (const bar of [28, 29, 30, 31, 56, 57, 58, 59]) {
      const { chord: voicing } = harmonyAt(bar),
        top = Math.max(...voicing);
      note("stay", bar, 0.5, top, 0.3, 0.6);
      note("up", bar, 1.75, top + (bar % 2 ? 2 : 0), 0.3, 0.52);
      if (bar % 2) note("stay", bar, 3.25, top, 0.25, 0.5);
    }
    note("stay", 35, 3, 68, 0.35, 0.5);
    note("up", 39, 2.5, 68, 0.35, 0.5);

    // ---- Stutter ramps at the phrase ends ------------------------------
    // 1/32 retriggers of one chop: a rising ramp into each chorus (the one
    // before the final chorus ends at beat 3, where the silent beat starts)
    // and a falling ramp out of each chorus into the post-chorus.
    const stutter = (
      bar: number,
      from: number,
      track: string,
      pitches: readonly number[],
      low: number,
      high: number,
    ) =>
      pitches.forEach((pitch, i) =>
        note(
          track,
          bar,
          from + i / 8,
          pitch,
          0.1,
          low + ((high - low) * i) / (pitches.length - 1),
          { humanize: {} },
        ),
      );
    const RISE = [60, 60, 65, 65, 67, 67, 72, 72],
      FALL = [72, 72, 67, 67, 65, 65, 60, 60];
    stutter(19, 3, "stay", RISE, 0.3, 0.8);
    stutter(47, 2, "stay", RISE, 0.32, 0.84);
    stutter(27, 3, "up", FALL, 0.72, 0.24);
    stutter(
      55,
      3,
      "up",
      FALL.map((p) => p + 12),
      0.74,
      0.24,
    );

    // ---- The string answer and the bridge pedal ------------------------
    s.phrase("answer", 9, ANSWER_1);
    s.phrase("answer", 11, ANSWER_2);
    s.phrase("answer", 13, ANSWER_3);
    s.phrase("answer", 15, ANSWER_4);
    s.phrase("answer", 41, ANSWER_1, 0, 1.06);
    s.phrase("answer", 43, ANSWER_4, 0, 1.06);
    s.phrase("answer", 33, [
      [3, 67, 0.45, 0.5],
      [3.5, 64, 0.9, 0.5],
    ]);
    s.phrase("answer", 37, [
      [3, 67, 0.45, 0.52],
      [3.5, 69, 0.9, 0.5],
    ]);
    // An E pedal under the second half of the bridge: the 9th of Dm9, the
    // 5th of Am/C, the 7th of Fmaj7 and the root of E.
    note("answer", 36, 0, 52, 15.6, 0.34);

    // ---- Risers --------------------------------------------------------
    for (const bar of risers)
      note("lift", bar, 0, 60, bar === 47 ? 2.9 : 3.9, 0.62);
    note("lift", 62, 0, 60, 7.8, 0.4);

    return s.finish();
  },
};
