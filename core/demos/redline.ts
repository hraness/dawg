/**
 * Redline: a hard-driving night-drive hyperpop in F minor at 172. Two-step
 * breakbeats and a rolling reese under a voice sung half-time: the recorded
 * words lead and drive a classic vocoder that sings them back over held
 * chord tones, a backing singer shadows the chorus a chord tone under, and the
 * syllables run as delayed ostinatos between the lines. No key change.
 */
import type { NoteInput, TrackInput } from "../score.ts";
import { Composer, voice } from "./build.ts";
import {
  filterArc,
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
  THROW_PEAK,
  throws,
  type Book,
  type Chord,
  type KitOptions,
  type Part,
  type SongSection,
  UNDER_WORDS,
  VOCAL_COMP,
  VOCAL_DUCK,
  VOCAL_ECHO,
  VOCAL_VERB,
  writeSong,
  sungAt,
  rave,
} from "./hyperpop.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

export const BPM = 172;
// The book's half-time rhythms (scripts/vox/songs.py E1, E2, Q4, Q5).
const E1 = [0, 0.5, 1, 1.5, 2, 3];
const E1L = [0.45, 0.45, 0.45, 0.45, 0.9, 0.9];
const E2 = [0, 0.5, 1, 1.5, 2.5, 3];
const E2L = [0.45, 0.45, 0.45, 0.9, 0.45, 0.9];
const Q4 = [0, 0.5, 1, 2];
const Q4L = [0.45, 0.45, 0.9, 1.8];
const Q5 = [0, 0.5, 1, 1.5, 2];
const Q5L = [0.45, 0.45, 0.45, 0.45, 1.8];

export const BOOK: Book = {
  sample: "redline-vox",
  root: 68,
  syllables: ["red", "line", "go", "up", "hey", "oh"],
  // "I" is a pickup, so "don't" lands on the downbeat.
  pickup: { pre1: -0.5 },
  ends: {
    v1: 3,
    v2: 3,
    v3: 3,
    v4: 3,
    v5: 2,
    v6: 2,
    v7: 2,
    v8: 2,
    pre1: 2,
    pre2: 2,
    ch1: 5,
    ch2: 4.5,
    ch3: 5,
  },
  melody: {
    v1: sungLine(
      "win- dows down at mid- night",
      E1,
      [65, 65, 63, 65, 68, 65],
      E1L,
    ),
    v2: sungLine("cit- y in the mir- ror", E2, [63, 63, 60, 63, 67, 63], E2L),
    v3: sungLine("turn the ra- di- o up", E1, [68, 68, 72, 68, 65, 68], E1L),
    v4: sungLine("no- bod- y can see us", E2, [67, 65, 63, 63, 65, 63], E2L),
    v5: sungLine("white lines like a pulse", Q5, [68, 68, 65, 63, 65], Q5L),
    v6: sungLine("all the way home", Q4, [63, 65, 67, 63], Q4L),
    v7: sungLine("en- gine in my chest", Q5, [65, 68, 65, 63, 60], Q5L),
    v8: sungLine("beat- ing like a drum", Q5, [67, 70, 67, 65, 63], Q5L),
    pre1: sungLine("I don't wan- na go", Q5, [61, 61, 63, 65, 68], Q5L),
    pre2: sungLine("take me to the line", Q5, [61, 63, 65, 68, 73], Q5L),
    ch1: sungLine(
      "red- line take me to the red- line",
      [0, 1, 2.5, 3, 3.5, 3.75, 4, 5],
      [72, 68, 68, 70, 72, 72, 73, 68],
      [0.9, 1.4, 0.45, 0.45, 0.25, 0.25, 0.9, 2.8],
    ),
    ch2: sungLine(
      "don't you slow it down to- night",
      [0, 0.5, 1, 2, 2.5, 4, 4.5],
      [72, 72, 75, 72, 70, 67, 70],
      [0.45, 0.45, 0.9, 0.45, 1.4, 0.45, 3],
    ),
    ch3: sungLine(
      "hold on tight 'til the sky turns white",
      [0, 0.5, 1, 2, 2.5, 3, 4, 5],
      [68, 70, 72, 72, 70, 72, 70, 67],
      [0.45, 0.45, 0.9, 0.45, 0.45, 0.9, 0.9, 2.8],
    ),
  },
};
// F minor: F G Ab Bb C Db Eb.
export const SCALE = [0, 1, 3, 5, 7, 8, 10];

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
// Every voicing shares Ab and Eb, so the bed barely moves while the bass
// walks; added ninths, no sevenths a semitone off the root.
const Fm = c(41, 56, 60, 63, 65);
const Db = c(37, 56, 61, 63, 65);
const Ab = c(44, 56, 60, 63, 70);
const Eb = c(39, 55, 58, 63, 65);
export const VERSE = [Fm, Ab, Eb, Db];
export const PRE = [Db, Eb];
export const CHORUS = [Fm, Db, Ab, Eb];

// The drop hook on the vowel lead, doubled an octave down by the looped
// voice: 3-3-2 into each bar, chord tones on every strong beat.
export const HOOK: readonly (readonly (readonly [number, number, number])[])[] =
  [
    [
      [0, 77, 0.5],
      [0.75, 80, 0.5],
      [1.5, 84, 0.4],
      [2, 82, 0.25],
      [2.5, 80, 0.5],
      [3, 77, 0.4],
      [3.5, 75, 0.4],
    ],
    [
      [0, 77, 0.5],
      [0.75, 80, 0.5],
      [1.5, 85, 0.4],
      [2, 82, 0.25],
      [2.5, 80, 0.5],
      [3, 77, 0.9],
    ],
    [
      [0, 75, 0.5],
      [0.75, 80, 0.5],
      [1.5, 84, 0.4],
      [2, 82, 0.25],
      [2.5, 80, 0.5],
      [3, 75, 0.4],
      [3.5, 72, 0.4],
    ],
    [
      [0, 75, 1],
      [1.5, 79, 0.5],
      [2, 82, 0.5],
      [2.75, 79, 1.1],
    ],
  ];

// Vocal ostinatos: the syllables arpeggiate the chord in eighths between
// the verse lines, then lock into 3-3-2 riffs in the drops.
export const RIFF_INTRO = ["0.2.4.2.0.2.4.2.", "0.2.4.2.5.4.2.4."];
export const RIFF_VERSE = ["0.2.4.2.5.4.2.4.", "0.2.4.2.5.4.6.5."];
export const RIFF_CHORUS = ["6.5.4.5.6.5.4.2.", "6.5.4.5.7.6.5.4."];
export const RIFF_DROP = [
  "44.4..6.55.5..4.",
  "4..44.5.6..55.4.",
  "44.4..6.55.5.66.",
  "6.6.5.5.4.4.2.2.",
];
export const RIFF_DROP2 = [
  "4.44.46.5.55.54.",
  "4.44.45.6.65.54.",
  "4.44.46.5.55.566",
  "6.5.4.2.6.5.4.24",
];
export const ARP_8 = ["0.1.2.3.2.1.2.3.", "0.1.2.3.4.3.2.1."];
// The chorus arp on its top rungs, above the singer.
export const ARP_HI = ["5.6.7.8.7.6.7.8.", "5.6.7.8.9.8.7.6."];
export const ARP_16 = ["0123432101234321", "0123454321234543"];
export const BELLS = ["6.......4.......", "5.......3...4..."];
export const STABS = ["8.....8...8.....", "8.....8...8...7."];
export const STABS_DROP = ["8..8..8...8.....", "8..8..8...8...7."];
// Bass steps: 0 root, 1 fifth, 2 octave, 3 octave fifth (all diatonic on
// every root here); `~` glides into the next note.
export const LINE_INTRO = ["0---------------", "0-----------2~0-"];
export const LINE_VERSE = ["0-----0---0-----", "0-----0---2~0---"];
export const LINE_CHORUS = ["0-------0-----2~", "0-----1-2-----0-"];
export const LINE_DROP = ["0--0----2~0---1-", "0--0--2~0---2-1-"];
export const LINE_DROP2 = ["0-20--0-2~0-1-2-", "0--0-2-0-3~2-1-0"];

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
    // The hook heard first through the vocoder over a drumless bed, then
    // the half-step beat rolls in under the ostinato.
    kind: "intro",
    name: "Ignition",
    bars: 8,
    chords: CHORUS,
    drums: ["none", "halfstep"],
    energy: 0.85,
    play: ["sub", "pad", "cloud", "riff"],
    riff: RIFF_INTRO,
    line: [null, null, null, null, ...LINE_INTRO, ...LINE_INTRO],
    lines: [null, null, null, null, "ch1", null, null, null],
    words: 0.7,
  },
  {
    kind: "verse",
    name: "Verse 1",
    bars: 8,
    chords: VERSE,
    drums: ["dnb", "dnb"],
    energy: 0.85,
    play: ["sub", "riff"],
    riff: RIFF_VERSE,
    line: LINE_VERSE,
    lines: VOICED("v1", "v2", "v3", "v4"),
    words: 0.85,
  },
  {
    kind: "pre",
    name: "Pre 1",
    bars: 4,
    chords: PRE,
    drums: ["halfstep"],
    energy: 0.9,
    play: ["sub", "pad", "arp"],
    arp: ARP_8,
    lines: ["pre1", null, "pre2", null],
    words: 0.85,
  },
  {
    kind: "chorus",
    name: "Chorus 1",
    bars: 8,
    chords: CHORUS,
    drums: ["dnb", "roller"],
    energy: 0.92,
    play: ["sub", "pad", "stabs", "riff"],
    stabs: STABS,
    stabShift: 12,
    riff: RIFF_CHORUS,
    line: LINE_CHORUS,
    lines: CHORUS_LINES,
    words: 0.9,
  },
  {
    kind: "post",
    name: "Drop 1",
    bars: 8,
    chords: CHORUS,
    drums: ["roller", "roller"],
    play: ["sub", "growl", "stabs", "riff"],
    stabs: STABS_DROP,
    riff: RIFF_DROP,
    line: LINE_DROP,
  },
  {
    kind: "verse",
    name: "Verse 2",
    bars: 8,
    chords: VERSE,
    drums: ["dnb", "roller"],
    energy: 0.88,
    play: ["sub", "riff"],
    riff: RIFF_VERSE,
    line: LINE_VERSE,
    lines: VOICED("v5", "v6", "v7", "v8"),
    words: 0.85,
  },
  {
    kind: "pre",
    name: "Pre 2",
    bars: 4,
    chords: PRE,
    drums: ["halfstep"],
    energy: 0.92,
    play: ["sub", "pad", "arp"],
    arp: ARP_16,
    lines: ["pre1", null, "pre2", null],
    words: 0.85,
  },
  {
    kind: "chorus",
    name: "Chorus 2",
    bars: 8,
    chords: CHORUS,
    drums: ["roller", "roller"],
    energy: 0.95,
    play: ["sub", "pad", "stabs", "riff", "arp"],
    stabs: STABS,
    stabShift: 12,
    riff: RIFF_CHORUS,
    arp: ARP_HI,
    line: LINE_CHORUS,
    lines: CHORUS_LINES,
    words: 0.9,
  },
  {
    kind: "post",
    name: "Drop 2",
    bars: 8,
    chords: CHORUS,
    drums: ["roller", "roller"],
    play: ["sub", "growl", "stabs", "lead", "riff"],
    stabs: STABS_DROP,
    riff: RIFF_DROP2,
    lead: HOOK,
    voiceLead: true,
    line: LINE_DROP2,
  },
  {
    // Drumless: the hook as words and vocoder over the pad alone.
    kind: "break",
    name: "Headlights",
    bars: 4,
    chords: CHORUS,
    drums: ["none"],
    play: ["pad", "cloud", "bells"],
    bells: BELLS,
    lines: ["ch1", null, "ch3", null],
    words: 0.9,
  },
  {
    kind: "build",
    name: "Redline",
    bars: 4,
    chords: CHORUS,
    drums: ["halfstep"],
    energy: 0.92,
    play: ["sub", "pad", "arp", "riff"],
    arp: ARP_16,
    riff: RIFF_CHORUS,
    line: LINE_CHORUS,
  },
  {
    kind: "chorus",
    name: "Last chorus",
    bars: 8,
    chords: CHORUS,
    drums: ["roller", "roller"],
    play: ["sub", "pad", "stabs", "riff", "arp", "double"],
    stabs: STABS,
    stabShift: 12,
    riff: RIFF_CHORUS,
    arp: ARP_HI,
    line: LINE_CHORUS,
    lines: CHORUS_LINES,
    words: 0.95,
  },
  {
    kind: "post",
    name: "Last drop",
    bars: 8,
    chords: CHORUS,
    drums: ["roller", "roller"],
    play: ["sub", "growl", "stabs", "lead", "riff"],
    stabs: STABS_DROP,
    riff: RIFF_DROP2,
    lead: HOOK,
    voiceLead: true,
    line: LINE_DROP2,
  },
  {
    kind: "outro",
    name: "Taillights",
    bars: 4,
    chords: [Fm, Db],
    drums: ["none"],
    play: ["pad", "cloud", "bells"],
    bells: BELLS,
  },
];
/**
 * The vocoder: a voice (the recorded words, or any sung track) shapes a wide
 * supersaw that plays the melody and two chord tones under it.
 */
export const vocoderTrack = (src = "vox"): TrackInput =>
  voice("voc", "Vocoder stack", "vocoder", 0.34 * UNDER_WORDS, {
    vocoder: {
      src,
      preset: "classic",
      follow: "notes",
      carrier: "supersaw",
      bands: 20,
      spread: 0.2,
      release: 0.07,
      unvoiced: 0.35,
    },
    filter: { type: "hpf", cutoff: 240, resonance: 0 },
    fx: {
      chorus: { rate: 0.5, depth: 0.5, mix: 0.4 },
      double: { time: 14, drift: 1.5, width: 0.9 },
      eq: { mid: -2, midfreq: 500, high: 2, highfreq: 7000 },
    },
    delay: { beats: 0.75, feedback: 0.3, mix: 0.12, pingpong: true },
    reverb: { mix: 0.22, size: 0.75, fade: 2.8, lowpass: 8000 },
  });

/** The kit's levels and patch changes for this song (bpm aside). */
export const KIT: Omit<KitOptions, "bpm"> = {
  hats: "syn909",
  levels: {
    kick: 0.5,
    snare: 0.4,
    hats: 0.1,
    sub: 0.42,
    saw: 0.19,
    pad: 0.3,
    stabs: 0.4,
    arp: 0.24,
    bells: 0.15,
    lead: 0.2,
    vox: 1,
    sing: 0.13,
    harm: 0.17,
    dbl: 0.34,
    chops: 1,
    stut: 1,
    vlead: 0.4,
    vgrain: 0.28,
  },
  extra: {
    // A clean sub: the reese carries the grit.
    sub: {
      synth: {
        attack: 0.01,
        decay: 0.4,
        sustain: 0.95,
        release: 0.1,
        lpf: 700,
      },
      fx: {
        orbit: { orbit: 2 },
        distort: { type: "soft", drive: 2, mix: 0.3 },
      },
    },
    saw: {
      synth: {
        attack: 0.004,
        decay: 0.3,
        sustain: 0.7,
        release: 0.1,
        unison: 5,
        detune: 0.32,
        spread: 0.6,
        lpf: 700,
        lpenv: 2,
        lpdecay: 0.2,
        lpsustain: 0.35,
        lpq: 3,
      },
      humanize: { timing: 3, velocity: 5, seed: 41 },
    },
    // The kit's driven snare with its fizz shelved off and its crack
    // carved out of the consonant band, pumped with the bed.
    snare: {
      fx: {
        orbit: { orbit: 2 },
        distort: { type: "soft", drive: 2.6, tone: 5200, mix: 0.45 },
        compressor: {
          threshold: -16,
          ratio: 3,
          attack: 0.003,
          release: 0.09,
          makeup: 3,
        },
        eq: { mid: -6, midfreq: 2500, high: -4, highfreq: 8000 },
      },
      reverb: { mix: 0.12, size: 0.35, fade: 0.8 },
      humanize: { timing: 2, velocity: 4, seed: 31 },
    },
    hats: { fx: { orbit: { orbit: 2 } } },
    // The words inside the track, not on top of it: the low end cut so the
    // voice owns only its band, a presence lift for the consonants, and a
    // slower attack that lets each one through before the compressor grabs.
    vox: {
      fx: {
        eq: {
          low: -6,
          lowfreq: 200,
          mid: 3,
          midfreq: 4000,
          high: 4,
          highfreq: 8000,
        },
        compressor: { ...VOCAL_COMP, makeup: 14, attack: 0.015 },
        duck: VOCAL_DUCK,
      },
      reverb: VOCAL_VERB,
    },
    // The synth singer as a high, breathy sheen over the words.
    sing: {
      pan: -0.1,
      sing: {
        preset: "aah",
        voice: "soprano",
        formant: 3,
        bright: 0.66,
        articulate: 1,
        breath: 0.14,
        jitter: 0.2,
        vib: 5.6,
        vibmod: 0.12,
        vibdelay: 0.3,
        ring: 0.3,
      },
      reverb: { mix: 0.24, size: 0.7, fade: 2.6, lowpass: 9000 },
    },
    harm: { pan: 0.32 },
  },
};

const BARS = SECTIONS.reduce((n, s) => n + s.bars, 0);
const START = (name: string) => {
  let bar = 0;
  for (const s of SECTIONS) {
    if (s.name === name) return bar;
    bar += s.bars;
  }
  throw new Error(`redline: no section ${name}`);
};

/** Chord tones under `pitch`, nearest first, at least a minor third down. */
function under(chord: Chord, pitch: number, count: number): number[] {
  const pcs = new Set(chord.tones.map((t) => t % 12));
  const out: number[] = [];
  for (let p = pitch - 3; p > pitch - 15 && out.length < count; p--)
    if (pcs.has(p % 12)) out.push(p);
  return out;
}

const rev = (cents: number): Partial<NoteInput> => flick.up(cents, 0.08);

export const redline: DemoDefinition = {
  info: demoInfo({
    id: "redline",
    title: "Redline",
    style: "Hyperpop",
    description:
      "Hard-driving night-drive hyperpop in F minor at 172: two-step breakbeats and a rolling reese under a voice sung half-time, the recorded words up front driving a vocoder that sings them back as chord stacks, a backing singer a chord tone under every chorus line, and syllable ostinatos echoing between the lines.",
    tempoBpm: BPM,
    key: "Fm",
    bars: BARS,
    highlightBar: START("Chorus 1"),
    trackId: "voc",
    features: [
      "the recorded words up front, a classic vocoder singing them back over held chord tones",
      "a backing singer a chord tone under every chorus note",
      "an octave-up double on the last chorus",
      "syllable ostinatos on dotted-eighth pingpong between the lines",
      "two-step breakbeats and rolling drops at 172, the voice half-time",
      "a reese bass doubling the sub an octave up in the drops",
      "a drumless break: the hook as words and vocoder over the pad",
      "one key throughout",
    ],
    arrangement: SECTIONS.map((s) => `${s.name} ${s.bars}`),
    mixNotes: [
      "the words lead; the vocoder sits about 10 dB under them, wide",
      "the bed ducks about 6 dB while a line sings",
      "chorus stabs and arp sit an octave above the singer's register",
      "short delay throws after the last word of every line",
      "kick pumps the bed on orbit 2; the voice stays out of the pump",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    kitTracks(s, BOOK, { bpm: BPM, ...KIT });
    // The vocoder: the recorded words shape a wide supersaw that plays the
    // melody and two chord tones under it.
    s.track(vocoderTrack());
    const song = writeSong(s, { book: BOOK, scale: SCALE, sections: SECTIONS });
    const { at } = song;

    // Every sung line: the vocoder plays its melody over two chord tones
    // held under the bar's lowest sung note, so the words come back as a
    // chord; the chorus lines get the backing singer one chord tone under.
    for (const p of song.placed)
      (p.lines ?? []).forEach((part, i) => {
        if (!part || !p.words) return;
        const bar = p.start + i;
        const notes = sungAt(BOOK, part);
        for (
          let b = Math.floor(notes[0]![0] / 4);
          b * 4 < notes.at(-1)![0];
          b++
        ) {
          const sung = notes.filter(([beat]) => Math.floor(beat / 4) === b);
          if (sung.length === 0) continue;
          const low = Math.min(...sung.map(([, pitch]) => pitch));
          const from = sung[0]![0];
          const to = Math.max(...sung.map(([beat, , beats]) => beat + beats));
          for (const pitch of under(song.chordAt(bar + b), low, 2))
            s.note("voc", bar, from, pitch, to - from, 0.55);
        }
        for (const [beat, pitch, beats, lyric] of notes) {
          const chord = song.chordAt(bar + Math.floor(beat / 4));
          s.note("voc", bar, beat, pitch, beats, 0.62);
          if (part.startsWith("ch") && beats >= 0.45)
            s.note("harm", bar, beat, under(chord, pitch, 1)[0]!, beats, 0.6, {
              lyric,
            });
        }
      });

    // Drops: the "red" chant chopped in 32nds down the Eb triad, and "go"
    // climbing it into the turn (the syllables sit on Ab, so every jump
    // lands on G, Bb or Eb).
    for (const name of ["Drop 1", "Drop 2", "Last drop"]) {
      const bar = at(name);
      stutter(
        s,
        song,
        "s_red",
        bar + 3,
        3,
        8,
        0.125,
        [-1, -1, -5, -5, -10, -10, -5, -5],
        0.72,
        0.45,
      );
      stutter(
        s,
        song,
        "s_go",
        bar + 7,
        2,
        8,
        0.25,
        [-1, -1, 2, -1, 2, 7, 2, 7],
        0.45,
        0.8,
      );
    }
    // The second chorus hands over to its drop on "go" up the Eb triad.
    stutter(
      s,
      song,
      "s_go",
      at("Chorus 2") + 7,
      2,
      8,
      0.25,
      [-1, 2, 7, 11],
      0.4,
      0.7,
    );
    // Verse 2 answers on the glitch track between its lines.
    {
      const bar = at("Verse 2");
      glitch(s, song, BOOK, bar + 3, "4.4.5.6.4.4.2...", ["red", "line"]);
      glitch(s, song, BOOK, bar + 7, "6.5.4.2.6.5.4...", ["go", "up", "hey"]);
    }
    // Headlights: the singer's sheen stutters the hook's top note on chord
    // tones as the break hands over to the build.
    const lights = at("Headlights");
    singStutter(s, lights + 3, 0, 8, 0.5, [80, 77, 80, 84], "ah", 0.4, 0.65);
    dropout(s, lights - 1, 2, 2, ["lead", "vlead"]);
    s.note("lead", lights - 1, 2, 80, 2, 0.6, flick.dive(-1200, 0.05));
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
    s.note("lead", last - 1, 3, 80, 1, 0.5, rev(-700));
    // Taillights: the vocoder's last chord fades under the bells.
    const out = at("Taillights");
    s.note("pad", out + 2, 0, 53, 8, 0.4, flick.dive(-1200, 0.5));

    // ---------------------------------------------------------- lanes
    // The words throw short and low; the sung layers can throw wide.
    patch(s, "vox", {
      delayMixAutomation: throws(song.throwsAt, VOCAL_ECHO.mix, THROW_PEAK, 1),
    });
    for (const id of ["sing", "voc"])
      patch(s, id, {
        delayMixAutomation: throws(song.throwsAt, 0.06, 0.38, 1),
      });
    const verses = [at("Verse 1"), at("Verse 2")];
    // The singer's sheen sits back in the verses, up in the choruses.
    patch(s, "sing", {
      volumeAutomation: steps(
        [0, 0.7],
        [verses[0]!, 0.45],
        [at("Pre 1"), 0.75],
        [at("Chorus 1"), 1],
        [verses[1]!, 0.45],
        [at("Pre 2"), 0.75],
        [at("Chorus 2"), 1],
        [lights, 0.8],
        [last, 1],
      ),
    });
    patch(s, "sweep", { filterAutomation: riserLane(song.builds) });
    patch(s, "chops", {
      // The ostinato tucks under the words and opens up in the drops.
      volumeAutomation: steps(
        [0, 0.8],
        [verses[0]!, 0.5],
        [at("Pre 1"), 0.75],
        [at("Drop 1"), 1],
        [verses[1]!, 0.5],
        [at("Pre 2"), 0.75],
        [at("Drop 2"), 1],
        [lights, 0.75],
        [at("Redline"), 1],
        [last, 0.75],
        [at("Last drop"), 1],
      ),
      fxAutomation: {
        // Down a minor third in the drops.
        "formant-shift": steps(
          [0, 0],
          [at("Drop 1"), -3],
          [verses[1]!, 0],
          [at("Drop 2"), -3],
          [lights, 0],
          [at("Last drop"), -3],
          [out, 0],
        ),
      },
    });
    // The stabs and arp follow the filter arc, read at each hit.
    patch(s, "stabs", {
      fxAutomation: { "synth-lpf": filterArc(s.sections, 1100, 6000) },
    });
    patch(s, "arp", {
      fxAutomation: { "synth-lpf": filterArc(s.sections, 1600, 7000) },
    });
    patch(s, "pad", {
      filterAutomation: ramps(
        [0, 700],
        [4, 1400],
        [verses[0]!, 1200],
        [at("Pre 1"), 1300],
        [at("Chorus 1") - 0.01, 2600],
        [at("Chorus 1"), 3000],
        [at("Drop 1"), 1500],
        [verses[1]!, 1300],
        [at("Chorus 2"), 3400],
        [lights, 2200],
        [at("Redline"), 900],
        [last - 0.01, 4000],
        [last, 3800],
        [out, 1800],
        [BARS, 500],
      ),
    });
    rave(s, {
      gated: ["pad"],
      lift: (n) => (/drop/i.test(n) ? 3.5 : 1.6),
    });
    return s.finish();
  },
};
