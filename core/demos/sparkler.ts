/**
 * Sparkler: euphoric summer-night hyperpop in Bb major at 148. Bounce and
 * skip verses open into four-floor choruses with offbeat house stabs and a
 * pumping offbeat bass; the recorded words lead with a backing singer a third
 * under the held chorus notes, the syllables fly up and fall like sparks in
 * the drops, and the break is a little three-voice fugue: the subject on the
 * chopped voice, a tonal answer on a plucked synth, then the subject in the
 * bass. No key change; the pre borrows the minor iv.
 */
import type { NoteInput } from "../score.ts";
import { Composer, orbit, voice, room } from "./build.ts";
import {
  dropout,
  flick,
  glitch,
  kitTracks,
  patch,
  ramps,
  riserLane,
  singStutter,
  steps,
  stutter,
  sungLine,
  throws,
  writeSong,
  type Book,
  type Chord,
  type KitOptions,
  type Part,
  type SongSection,
} from "./hyperpop.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

export const BPM = 148;
// The book's rhythms (scripts/vox/songs.py SA, SB, L4, Q5).
const SA = [0, 0.5, 0.75, 1.5, 2, 2.5, 3];
const SAL = [0.45, 0.25, 0.6, 0.45, 0.45, 0.45, 0.9];
const SB = [0, 0.25, 0.5, 1, 1.5, 2.25, 3];
const SBL = [0.25, 0.25, 0.45, 0.45, 0.6, 0.6, 0.9];
const L4 = [0, 0.75, 1.5, 2];
const L4L = [0.6, 0.6, 0.45, 1.6];
const Q5 = [0, 0.5, 1, 1.5, 2];
const Q5L = [0.45, 0.45, 0.45, 0.45, 1.8];

export const BOOK: Book = {
  sample: "sparkler-vox",
  root: 70,
  syllables: ["spark", "pop", "light", "hey", "oh", "ya"],
  ends: {
    v1: 3,
    v2: 3,
    v3: 3,
    v4: 3,
    v5: 2,
    v6: 2,
    v7: 2,
    v8: 2,
    pre1: 3,
    pre2: 2,
    ch1: 4,
    ch2: 4,
    ch3: 4,
  },
  melody: {
    v1: sungLine(
      "strike a match and hold it up",
      SA,
      [74, 74, 77, 74, 79, 77, 74],
      SAL,
    ),
    v2: sungLine(
      "write your name be- fore it's gone",
      SB,
      [77, 77, 74, 72, 74, 72, 70],
      SBL,
    ),
    v3: sungLine(
      "sil- ver sparks a- cross the lawn",
      SA,
      [74, 74, 79, 77, 74, 77, 79],
      SAL,
    ),
    v4: sungLine(
      "eve- ry- one is count- ing down",
      SB,
      [79, 77, 77, 74, 77, 74, 70],
      SBL,
    ),
    v5: sungLine("light the long fuse", L4, [67, 70, 74, 79], L4L),
    v6: sungLine("cov- er your ears", L4, [77, 74, 70, 74], L4L),
    v7: sungLine("here comes the noise", L4, [70, 74, 79, 82], L4L),
    v8: sungLine("bright- er than day", L4, [81, 79, 77, 82], L4L),
    pre1: sungLine(
      "wait for it wait for it",
      [0, 0.5, 1, 2, 2.5, 3],
      [75, 75, 79, 75, 75, 82],
      [0.45, 0.45, 0.9, 0.45, 0.45, 0.9],
    ),
    pre2: sungLine("light up the whole sky", Q5, [77, 79, 82, 79, 82], Q5L),
    ch1: sungLine(
      "spar- kler spar- kler in my hand",
      [0, 0.5, 1.5, 2, 2.5, 3, 4],
      [77, 82, 77, 82, 81, 82, 77],
      [0.45, 0.9, 0.45, 0.45, 0.45, 0.9, 2.8],
    ),
    ch2: sungLine(
      "draw your name a- cross the night",
      [0, 0.5, 1, 1.5, 2.5, 3, 4],
      [79, 79, 82, 79, 77, 75, 77],
      [0.45, 0.45, 0.45, 0.9, 0.45, 0.9, 3],
    ),
    ch3: sungLine(
      "we burn so fast we burn so bright",
      [0, 0.5, 1, 2, 2.5, 3, 3.5, 4],
      [75, 79, 82, 79, 77, 79, 81, 81],
      [0.45, 0.45, 0.9, 0.45, 0.45, 0.45, 0.45, 2.8],
    ),
  },
};
// Bb major: Bb C D Eb F G A.
export const SCALE = [0, 2, 3, 5, 7, 9, 10];

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
// Open voicings that keep F and Bb in the middle of every chord, added
// ninths, all under the singer.
const Bb = c(46, 58, 60, 62, 65);
const Dm = c(38, 57, 60, 62, 65);
const Eb = c(39, 55, 58, 63, 65);
const F = c(41, 57, 60, 65, 67);
const Gm = c(43, 55, 58, 62, 65);
const Cm = c(36, 55, 58, 60, 63);
// The borrowed minor iv: Gb for G, one note, then home to Bb.
const Ebm = c(39, 54, 58, 63, 65);
export const VERSE = [Gm, Eb, Bb, F];
export const PRE = [Eb, F, Eb, Ebm];
export const CHORUS = [Bb, Dm, Eb, F];

// The drop hook on the vowel lead, doubled an octave down by the looped
// voice: sparks cascading down from the top of each chord.
export const HOOK: readonly (readonly (readonly [number, number, number])[])[] =
  [
    [
      [0, 86, 0.25],
      [0.25, 84, 0.25],
      [0.5, 82, 0.5],
      [1, 77, 0.5],
      [1.5, 82, 0.5],
      [2, 86, 0.75],
      [3, 84, 0.25],
      [3.25, 82, 0.25],
      [3.5, 81, 0.5],
    ],
    [
      [0, 81, 0.5],
      [0.5, 77, 0.5],
      [1, 74, 0.5],
      [1.5, 77, 0.5],
      [2, 81, 0.75],
      [3, 84, 0.5],
      [3.5, 81, 0.5],
    ],
    [
      [0, 82, 0.25],
      [0.25, 84, 0.25],
      [0.5, 87, 0.5],
      [1, 82, 0.5],
      [1.5, 79, 0.5],
      [2, 87, 0.75],
      [3, 86, 0.25],
      [3.25, 84, 0.25],
      [3.5, 82, 0.5],
    ],
    [
      [0, 81, 0.75],
      [1, 77, 0.5],
      [1.5, 81, 0.5],
      [2, 84, 1.5],
    ],
  ];

// Vocal ostinatos: the syllables answer each verse line from the end of the
// bar, tuck under the chorus, then run 16th riffs in the drops.
export const RIFF_INTRO = ["0..2..4.2..4..2.", "0..2..4.5..4..2."];
export const RIFF_VERSE = ["............4.2.", "0.2.4.5.4.2.4.5."];
export const RIFF_CHORUS = ["0.1.2.1.0.1.2.1.", "0.1.2.3.2.1.2.3."];
export const RIFF_DROP = [
  "44.4.5.6.5.44.2.",
  "4.4.56.5.4.4.6.7",
  "44.4.5.6.5.44.2.",
  "6.5.4.6.5.4.2.4.",
];
export const RIFF_DROP2 = [
  "4.45.4.6.5.45.4.",
  "4.45.4.7.6.54.2.",
  "4.45.4.6.5.45.4.",
  "7.6.5.4.6.5.4.24",
];
export const ARP_8 = ["0.1.2.3.2.1.2.3.", "0.1.2.3.4.3.2.1."];
// Verse 2: 3-3-2 dots that leave the line room.
export const ARP_VERSE = ["0..2..4.2..4..2.", "0..2..4.5..4..2."];
export const ARP_16 = ["0123432101234321", "0123454321234543"];
// The chorus arp on its top rungs, every second bar so the hook stays clear.
export const ARP_HI_HALF = [null, "5.6.7.8.9.8.7.6."];
export const BELLS = ["6.......4.......", "5.......3...4..."];
export const BELLS_VERSE = ["........6.......", "........5...4..."];
// House stabs on the offbeats; the drops push into the bar over a held pad.
export const STABS = ["..8...8...8...8.", "..8...8...8...87"];
export const STABS_DROP = ["8.8...8...8.8...", "8.8...8...8...87"];
// Bass steps: 0 root, 1 fifth, 2 octave, 3 octave fifth; `~` glides. The
// four-floor sections sit the bass between the kicks.
export const LINE_INTRO = ["0---------------", "0-----------2~0-"];
export const LINE_VERSE = ["0-----0---0-----", "0-----0---2~0---"];
export const LINE_CHORUS = ["..0-..0-..0-..2-", "..0-..0-..0-.12~"];
export const LINE_DROP = ["..2-.02-..2-.02-", "..2-.02-..2-1~2-"];
export const LINE_DROP2 = ["..2-.02-..3-.21-", "..2-.02-..2-1~0-"];

const VOICED = (a: Part, b: Part, c2: Part, d: Part): SongSection["lines"] => [
  a,
  null,
  b,
  null,
  c2,
  null,
  d,
  null,
];
export const CHORUS_LINES = VOICED("ch1", "ch2", "ch1", "ch3");

export const SECTIONS: readonly SongSection[] = [
  {
    // The hook teased over a filtered bed and the chop ostinato, then the
    // four-floor kick comes in under it.
    kind: "intro",
    name: "Fuse",
    bars: 8,
    chords: CHORUS,
    drums: ["none", "four"],
    energy: 0.85,
    play: ["sub", "pad", "cloud", "riff"],
    riff: RIFF_INTRO,
    line: [null, null, null, null, ...LINE_INTRO, ...LINE_INTRO],
    lines: [null, null, null, null, "ch1", null, null, null],
    words: 0.75,
  },
  {
    kind: "verse",
    name: "Verse 1",
    bars: 8,
    chords: VERSE,
    drums: ["bounce", "bounce"],
    energy: 0.85,
    play: ["sub", "riff", "bells"],
    riff: RIFF_VERSE,
    bells: BELLS_VERSE,
    line: LINE_VERSE,
    lines: VOICED("v1", "v2", "v3", "v4"),
    words: 0.9,
  },
  {
    kind: "pre",
    name: "Pre 1",
    bars: 4,
    chords: PRE,
    drums: ["half"],
    energy: 0.9,
    play: ["sub", "pad", "arp"],
    arp: ARP_8,
    lines: ["pre1", null, "pre2", null],
    words: 0.9,
  },
  {
    kind: "chorus",
    name: "Chorus 1",
    bars: 8,
    chords: CHORUS,
    drums: ["four", "house"],
    energy: 0.92,
    play: ["sub", "pad", "stabs", "riff"],
    stabs: STABS,
    stabShift: 12,
    riff: RIFF_CHORUS,
    line: LINE_CHORUS,
    lines: CHORUS_LINES,
    thirds: true,
    words: 0.92,
  },
  {
    kind: "post",
    name: "Burst 1",
    bars: 8,
    chords: CHORUS,
    drums: ["house", "four"],
    play: ["sub", "pad", "growl", "stabs", "riff"],
    stabs: STABS_DROP,
    riff: RIFF_DROP,
    line: LINE_DROP,
  },
  {
    kind: "verse",
    name: "Verse 2",
    bars: 8,
    chords: VERSE,
    drums: ["skip", "bounce"],
    energy: 0.88,
    play: ["sub", "pad", "riff", "arp"],
    riff: RIFF_VERSE,
    arp: ARP_VERSE,
    line: LINE_VERSE,
    lines: VOICED("v5", "v6", "v7", "v8"),
    words: 0.9,
  },
  {
    kind: "pre",
    name: "Pre 2",
    bars: 4,
    chords: PRE,
    drums: ["half"],
    energy: 0.92,
    play: ["sub", "pad", "arp"],
    arp: ARP_16,
    lines: ["pre1", null, "pre2", null],
    words: 0.9,
  },
  {
    kind: "chorus",
    name: "Chorus 2",
    bars: 8,
    chords: CHORUS,
    drums: ["four", "house"],
    energy: 0.95,
    play: ["sub", "pad", "stabs", "riff", "arp"],
    stabs: STABS,
    stabShift: 12,
    riff: RIFF_CHORUS,
    arp: ARP_HI_HALF,
    line: LINE_CHORUS,
    lines: CHORUS_LINES,
    thirds: true,
    words: 0.92,
  },
  {
    kind: "post",
    name: "Burst 2",
    bars: 8,
    chords: CHORUS,
    drums: ["house", "house"],
    play: ["sub", "pad", "growl", "stabs", "lead", "riff"],
    stabs: STABS_DROP,
    riff: RIFF_DROP2,
    lead: HOOK,
    voiceLead: true,
    line: LINE_DROP2,
  },
  {
    // The fugue: subject on the chops (Bb-F), tonal answer on the pluck a
    // fifth up (F-Cm) over the countersubject, the subject in the bass under
    // both (Bb-F), then an episode down to the half cadence. Every voice is
    // written in build() over a held pad; the half beat comes in under the
    // bass entry.
    kind: "break",
    name: "Counterpoint",
    bars: 8,
    chords: [Bb, F, F, Cm, Bb, F, Gm, F],
    drums: ["none", "half"],
    energy: 0.9,
    play: ["pad"],
  },
  {
    kind: "build",
    name: "Rocket",
    bars: 4,
    chords: PRE,
    drums: ["half"],
    energy: 0.92,
    play: ["sub", "pad", "arp", "riff"],
    arp: ARP_16,
    riff: RIFF_CHORUS,
    line: LINE_VERSE,
  },
  {
    kind: "chorus",
    name: "Last chorus",
    bars: 8,
    chords: CHORUS,
    drums: ["four", "house"],
    play: ["sub", "pad", "stabs", "riff", "arp", "double"],
    stabs: STABS,
    stabShift: 12,
    riff: RIFF_CHORUS,
    arp: ARP_HI_HALF,
    line: LINE_CHORUS,
    lines: CHORUS_LINES,
    thirds: true,
    words: 0.95,
  },
  {
    kind: "post",
    name: "Finale",
    bars: 8,
    chords: CHORUS,
    drums: ["house", "four"],
    play: ["sub", "pad", "growl", "stabs", "lead", "riff"],
    stabs: STABS_DROP,
    riff: RIFF_DROP2,
    lead: HOOK,
    voiceLead: true,
    line: LINE_DROP2,
  },
  {
    kind: "outro",
    name: "Smoke",
    bars: 4,
    chords: [Bb, Eb],
    drums: ["none"],
    play: ["pad", "cloud", "bells"],
    bells: BELLS,
  },
];

// ------------------------------------------------------------ the fugue
type Line = readonly (readonly [number, number, number])[];

/** `pitch` moved `n` steps along the Bb major scale (diatonic, no new key). */
export function dia(pitch: number, n: number): number {
  // Scale steps above Bb, so the octave turns over at Bb.
  const rel = SCALE.map((p) => (p + 2) % 12).sort((a, b) => a - b);
  const k = rel.indexOf((((pitch - 10) % 12) + 12) % 12);
  if (k < 0) throw new Error(`sparkler: ${pitch} is outside Bb major`);
  const idx = k + n;
  const octave = Math.floor((pitch - 10) / 12) + Math.floor(idx / 7);
  return 10 + octave * 12 + rel[((idx % 7) + 7) % 7]!;
}

const shift = (line: Line, steps: number, octaves = 0): Line =>
  line.map(([b, p, l]) => [b, dia(p, steps) + 12 * octaves, l] as const);

// Two bars over Bb then F: an arpeggio up to the octave, a run down in
// 16ths, and a cadence onto the low F.
export const SUBJECT: Line = [
  [0, 70, 0.5],
  [0.5, 74, 0.5],
  [1, 77, 0.5],
  [1.5, 82, 0.5],
  [2, 81, 0.25],
  [2.25, 79, 0.25],
  [2.5, 77, 0.25],
  [2.75, 75, 0.25],
  [3, 74, 0.5],
  [3.5, 77, 0.5],
  [4, 75, 0.25],
  [4.25, 74, 0.25],
  [4.5, 72, 0.25],
  [4.75, 70, 0.25],
  [5, 69, 0.5],
  [5.5, 72, 0.5],
  [6, 77, 0.5],
  [6.5, 72, 0.5],
  [7, 65, 1],
];
// Against the answer (F then Cm): slow notes in contrary motion.
export const COUNTER: Line = [
  [0, 72, 1],
  [1, 70, 0.5],
  [1.5, 69, 0.5],
  [2, 72, 1],
  [3, 77, 1],
  [4, 75, 1],
  [5, 74, 0.5],
  [5.5, 72, 0.5],
  [6, 70, 0.5],
  [6.5, 72, 0.5],
  [7, 67, 1],
];
// The episode: the subject's run sequenced down over Gm, then F.
export const EPISODE: Line = [
  [0, 79, 0.5],
  [0.5, 82, 0.5],
  [1, 86, 0.5],
  [1.5, 84, 0.25],
  [1.75, 82, 0.25],
  [2, 81, 0.25],
  [2.25, 79, 0.25],
  [2.5, 77, 0.25],
  [2.75, 75, 0.25],
  [3, 74, 0.5],
  [3.5, 79, 0.5],
  [4, 77, 0.5],
  [4.5, 81, 0.5],
  [5, 84, 0.5],
  [5.5, 82, 0.25],
  [5.75, 81, 0.25],
  [6, 79, 0.25],
  [6.25, 77, 0.25],
  [6.5, 75, 0.25],
  [6.75, 74, 0.25],
  [7, 72, 1],
];

/** A plucked, harpsichord-bright pulse for the fugue's synth voice. */
const fugueTrack = () =>
  voice("fug", "Counterpoint pluck", "pulse", 0.3, {
    pan: 0.28,
    synth: {
      attack: 0.001,
      decay: 0.32,
      sustain: 0.08,
      release: 0.12,
      pw: 0.36,
      lpf: 3600,
      lpenv: 2,
      lpdecay: 0.1,
    },
    filter: { type: "hpf", cutoff: 260, resonance: 0 },
    fx: {
      chorus: { rate: 0.7, depth: 0.3, mix: 0.25 },
      eq: { high: 2, highfreq: 6000 },
    },
    delay: { beats: 0.5, feedback: 0.22, mix: 0.12, pingpong: true },
    reverb: room,
  });

/** The kit's levels and patch changes for this song (bpm aside). */
export const KIT: Omit<KitOptions, "bpm"> = {
  hats: "syn909",
  levels: {
    kick: 0.46,
    snare: 0.42,
    hats: 0.12,
    sub: 0.46,
    saw: 0.18,
    pad: 0.3,
    stabs: 0.36,
    arp: 0.22,
    bells: 0.16,
    lead: 0.2,
    vox: 1,
    sing: 0.24,
    harm: 0.24,
    dbl: 0.36,
    chops: 1,
    stut: 1,
    vlead: 0.4,
    vgrain: 0.26,
  },
  extra: {
    // The syllables lead the drops: squeezed and lifted over the stabs.
    chops: {
      fx: {
        ...orbit,
        formant: { shift: 0, mix: 1 },
        crush: { bits: 10, coarse: 1, mix: 0 },
        eq: { mid: 3, midfreq: 3000, high: 3, highfreq: 8000 },
        compressor: {
          threshold: -20,
          ratio: 3,
          attack: 0.003,
          release: 0.08,
          makeup: 5,
        },
      },
      humanize: { timing: 6, velocity: 7, seed: 43 },
    },
    sub: {
      synth: {
        attack: 0.008,
        decay: 0.3,
        sustain: 0.9,
        release: 0.08,
        lpf: 900,
      },
      fx: {
        orbit: { orbit: 2 },
        distort: { type: "soft", drive: 2.4, mix: 0.4 },
      },
    },
    // The kit's snare as a clap-bright crack for the four-floor.
    snare: {
      fx: {
        distort: { type: "soft", drive: 2.2, tone: 6000, mix: 0.35 },
        compressor: {
          threshold: -16,
          ratio: 3,
          attack: 0.003,
          release: 0.09,
          makeup: 3,
        },
        eq: { high: -3, highfreq: 9000 },
      },
      reverb: { mix: 0.16, size: 0.4, fade: 0.9 },
      humanize: { timing: 2, velocity: 4, seed: 31 },
    },
    vox: {
      fx: {
        eq: { mid: 3, midfreq: 3000, high: 5, highfreq: 8000 },
        compressor: {
          threshold: -24,
          ratio: 4,
          attack: 0.004,
          release: 0.1,
          makeup: 8,
        },
        duck: {
          orbit: 2,
          depth: 0.4,
          attack: 0.5,
          onset: 0.06,
          hold: true,
        },
      },
      reverb: { mix: 0.16, size: 0.6, fade: 2, lowpass: 12000 },
    },
    sing: {
      pan: -0.1,
      sing: {
        preset: "aah",
        voice: "soprano",
        formant: 3,
        bright: 0.7,
        articulate: 1,
        breath: 0.12,
        jitter: 0.2,
        vib: 5.6,
        vibmod: 0.12,
        vibdelay: 0.3,
        ring: 0.3,
      },
      reverb: { mix: 0.26, size: 0.7, fade: 2.6, lowpass: 9000 },
    },
    harm: { pan: 0.3 },
  },
};

const BARS = SECTIONS.reduce((n, s) => n + s.bars, 0);
const START = (name: string) => {
  let bar = 0;
  for (const s of SECTIONS) {
    if (s.name === name) return bar;
    bar += s.bars;
  }
  throw new Error(`sparkler: no section ${name}`);
};

const rev = (cents: number): Partial<NoteInput> => flick.up(cents, 0.08);

const play = (
  s: Composer,
  track: string,
  bar: number,
  line: Line,
  velocity: number,
) => {
  for (const [beat, pitch, beats] of line)
    s.note(track, bar, beat, pitch, beats * 0.92, velocity);
};

export const sparkler: DemoDefinition = {
  info: demoInfo({
    id: "sparkler",
    title: "Sparkler",
    style: "Hyperpop",
    description:
      "Euphoric summer-night hyperpop in Bb major at 148: bounce verses open into four-floor choruses with offbeat house stabs and a pumping offbeat bass, the recorded words up front with a backing singer a third under, syllables flying up and falling like sparks in the drops, and a three-voice fugue break between the chopped voice, a plucked synth and the bass.",
    tempoBpm: BPM,
    key: "Bb",
    bars: BARS,
    highlightBar: START("Chorus 1"),
    trackId: "fug",
    features: [
      "the recorded words up front, a backing singer a third under the held chorus notes",
      "four-floor choruses with offbeat house stabs and an offbeat bass between the kicks",
      "syllable ostinatos answering every verse line",
      "pop and spark stutters that fly up the chord and fall back down in the drops",
      "a three-voice fugue break: chopped-voice subject, tonal answer on a pluck, the subject in the bass",
      "a borrowed minor iv in the pre-chorus",
      "an octave-up double on the last chorus",
      "one key throughout",
    ],
    arrangement: SECTIONS.map((s) => `${s.name} ${s.bars}`),
    mixNotes: [
      "the words lead; the bed ducks about 4 dB while a line sings",
      "in the choruses the stabs ride an octave up but quieter, the chops and synth singer pull back, and the stabs hit full in the drops",
      "the bass sits between the kicks in the four-floor sections",
      "delay throws open on the last word of every line",
      "the fugue break keeps its three voices in three registers",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    kitTracks(s, BOOK, { bpm: BPM, ...KIT });
    s.track(fugueTrack());
    const song = writeSong(s, { book: BOOK, scale: SCALE, sections: SECTIONS });
    const { at } = song;

    // Bursts: "spark" falls down the F triad in 32nds, "pop" climbs it
    // into the turn (the syllables sit on Bb: -5 F, -1 A, 2 C, 7 F).
    for (const name of ["Burst 1", "Burst 2", "Finale"]) {
      const bar = at(name);
      stutter(
        s,
        song,
        "s_spark",
        bar + 3,
        3,
        8,
        0.125,
        [7, 7, 2, 2, -1, -1, -5, -5],
        0.72,
        0.45,
      );
      stutter(
        s,
        song,
        "s_pop",
        bar + 7,
        2,
        8,
        0.25,
        [-5, -1, 2, 7, -1, 2, 7, 11],
        0.45,
        0.8,
      );
    }
    stutter(
      s,
      song,
      "s_pop",
      at("Chorus 2") + 7,
      2,
      8,
      0.25,
      [-5, -1, 2, 7],
      0.4,
      0.7,
    );
    // Verse 2 answers on the glitch track between its lines; the pad comes
    // in on "here comes the noise".
    {
      const bar = at("Verse 2");
      dropout(s, bar, 0, 16, ["pad"]);
      glitch(s, song, BOOK, bar + 3, "4.4.5.6.4.4.2...", ["spark", "light"]);
      glitch(s, song, BOOK, bar + 7, "6.5.4.2.6.5.4...", ["pop", "hey", "ya"]);
    }

    // The fugue.
    const fugue = at("Counterpoint");
    // Subject alone on the chops.
    play(s, "chops", fugue, SUBJECT, 0.78);
    // Tonal answer a fifth up on the pluck; the chops take the countersubject.
    play(s, "fug", fugue + 2, shift(SUBJECT, 4), 0.72);
    play(s, "chops", fugue + 2, COUNTER, 0.7);
    // The subject in the bass, two octaves down, under the countersubject
    // (a fifth down, an octave up) on the pluck and the held voice between.
    play(s, "saw", fugue + 4, shift(SUBJECT, 0, -2), 0.8);
    play(s, "fug", fugue + 4, shift(COUNTER, -4, 1), 0.66);
    play(
      s,
      "vlead",
      fugue + 4,
      [
        [0, 65, 2],
        [2, 62, 2],
        [4, 60, 2],
        [6, 65, 2],
      ],
      0.5,
    );
    // Episode: the pluck sequences the run down, the chops answer on the
    // chord, the bass walks to the half cadence.
    play(s, "fug", fugue + 6, EPISODE, 0.72);
    glitch(s, song, BOOK, fugue + 6, "..4.2.0...4.2.0.", ["spark", "pop"], 0.6);
    glitch(s, song, BOOK, fugue + 7, "..5.4.2...5.4.2.", ["light", "oh"], 0.6);
    play(
      s,
      "sub",
      fugue + 6,
      [
        [0, 43, 1],
        [1, 41, 1],
        [2, 39, 1],
        [3, 38, 1],
        [4, 41, 1],
        [5, 45, 1],
        [6, 48, 1],
        [7, 41, 1],
      ],
      0.8,
    );
    play(
      s,
      "vlead",
      fugue + 6,
      [
        [0, 62, 4],
        [4, 60, 4],
      ],
      0.5,
    );
    // The singer's sheen stutters the hook's top note into the rocket.
    const rocket = at("Rocket");
    singStutter(s, rocket + 3, 0, 8, 0.5, [77, 82, 77, 86], "ah", 0.4, 0.65);
    // One silent beat before the last chorus, a scoop into its first word.
    const last = at("Last chorus");
    dropout(s, last - 1, 3, 1, [
      "kick",
      "snare",
      "hats",
      "sub",
      "pad",
      "arp",
      "chops",
      "stabs",
    ]);
    s.note("lead", last - 1, 3, 82, 1, 0.5, rev(-700));
    // Smoke: a last chord diving under the bells.
    const out = at("Smoke");
    s.note("pad", out + 2, 0, 53, 8, 0.4, flick.dive(-1200, 0.5));

    // ---------------------------------------------------------- lanes
    for (const id of ["vox", "sing"])
      patch(s, id, {
        delayMixAutomation: throws(song.throwsAt, 0.06, 0.38, 1),
      });
    const verses = [at("Verse 1"), at("Verse 2")];
    patch(s, "sing", {
      volumeAutomation: steps(
        [0, 0.7],
        [verses[0]!, 0.45],
        [at("Pre 1"), 0.75],
        [at("Chorus 1"), 0.6],
        [verses[1]!, 0.45],
        [at("Pre 2"), 0.75],
        [at("Chorus 2"), 0.6],
        [rocket, 0.8],
        [last, 0.6],
      ),
    });
    patch(s, "sweep", { filterAutomation: riserLane(song.builds) });
    patch(s, "chops", {
      volumeAutomation: steps(
        [0, 0.8],
        [verses[0]!, 0.55],
        [at("Pre 1"), 0.75],
        [at("Chorus 1"), 0.5],
        [at("Burst 1"), 1],
        [verses[1]!, 0.38],
        [at("Pre 2"), 0.75],
        [at("Chorus 2"), 0.5],
        [at("Burst 2"), 1],
        [fugue, 0.9],
        [rocket, 1],
        [last, 0.5],
        [at("Finale"), 1],
      ),
      fxAutomation: {
        // Up a minor third in the drops, so the sparks fly brighter; the
        // fugue's subject comes back at the voice's own formant.
        "formant-shift": steps(
          [0, 0],
          [at("Burst 1"), 3],
          [verses[1]!, 0],
          [at("Burst 2"), 3],
          [fugue, 0],
          [at("Finale"), 3],
          [out, 0],
        ),
      },
    });
    // The stabs sit back in the sung choruses and hit full in the drops.
    patch(s, "stabs", {
      volumeAutomation: steps(
        [0, 0.72],
        [at("Burst 1"), 1],
        [verses[1]!, 0.72],
        [at("Burst 2"), 1],
        [fugue, 0.72],
        [at("Finale"), 1],
      ),
    });
    patch(s, "pad", {
      filterAutomation: ramps(
        [0, 700],
        [4, 1400],
        [verses[0]!, 1200],
        [at("Pre 1"), 1300],
        [at("Chorus 1") - 0.01, 2600],
        [at("Chorus 1"), 3000],
        [at("Burst 1"), 1600],
        [verses[1]!, 1300],
        [at("Chorus 2"), 3400],
        [rocket, 900],
        [last - 0.01, 4000],
        [last, 3800],
        [out, 1800],
        [BARS, 500],
      ),
    });
    return s.finish();
  },
};
