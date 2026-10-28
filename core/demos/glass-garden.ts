/**
 * Glass Garden: bright, glassy hyperpop in A major at 128. The recorded
 * words lead every line with a synth singer shimmering under them, FM bells
 * and syllable arps that bloom after each line, tresillo and four-floor
 * blooms, and a drumless greenhouse where the voice freezes and glitches.
 */
import { Composer } from "./build.ts";
import {
  dropout,
  flick,
  glitch,
  kitTracks,
  patch,
  ramps,
  RHYTHM,
  riserLane,
  singPart,
  singStutter,
  steps,
  stutter,
  sungLine,
  thirdBelow,
  THROW_PEAK,
  throws,
  type Book,
  type Chord,
  type KitOptions,
  type SongSection,
  VOCAL_COMP,
  VOCAL_DUCK,
  VOCAL_ECHO,
  writeSong,
} from "./hyperpop.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

export const BPM = 128;
const { r1, r1l, r2, r2l, l4, l4l } = RHYTHM;

// The book's tunes (scripts/vox/songs.py), sung by the synth too.
export const BOOK: Book = {
  sample: "glass-garden-vox",
  root: 69,
  syllables: ["glass", "bloom", "glow", "grow", "ah", "ooh"],
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
    pre2: 2.5,
    ch1: 3,
    ch2: 2.5,
    ch3: 4,
  },
  melody: {
    v1: sungLine(
      "plant- ed some- thing in the light",
      r1,
      [61, 61, 62, 61, 64, 62, 61],
      r1l,
    ),
    v2: sungLine(
      "watched it grow- ing through the night",
      r2,
      [61, 61, 66, 64, 61, 59, 57],
      r2l,
    ),
    v3: sungLine(
      "ev- ery flow- er made of glass",
      r1,
      [61, 61, 64, 61, 59, 57, 61],
      r1l,
    ),
    v4: sungLine(
      "hold it close but not too fast",
      r2,
      [59, 59, 61, 59, 57, 56, 59],
      r2l,
    ),
    v5: sungLine("rain on the roof", l4, [64, 61, 57, 61], l4l),
    v6: sungLine("green in the glass", l4, [57, 61, 66, 64], l4l),
    v7: sungLine("I give it time", l4, [57, 61, 64, 69], l4l),
    v8: sungLine("so it can grow", l4, [66, 64, 61, 66], l4l),
    pre1: sungLine(
      "care- ful care- ful now",
      [0, 0.5, 1, 1.5, 2],
      [64, 61, 64, 61, 59],
      [0.5, 0.5, 0.5, 0.5, 1.8],
    ),
    pre2: sungLine(
      "let it bloom and grow",
      [0, 0.5, 1, 2, 2.5],
      [62, 64, 66, 64, 68],
      [0.5, 0.5, 0.9, 0.5, 1.4],
    ),
    ch1: sungLine(
      "in my glass gar- den",
      [0, 0.5, 1, 2, 3],
      [69, 71, 74, 69, 66],
      [0.5, 0.5, 0.9, 0.9, 3],
    ),
    ch2: sungLine(
      "ev- ery pet- al glows",
      [0, 0.5, 1, 2, 2.5],
      [64, 68, 73, 71, 68],
      [0.5, 0.5, 0.9, 0.5, 3.5],
    ),
    ch3: sungLine(
      "don't you ev- er let the sun- light go",
      [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4],
      [68, 68, 71, 68, 71, 73, 71, 68, 66],
      [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 3],
    ),
  },
};
export const SCALE = [1, 2, 4, 6, 8, 9, 11];

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
// Open voicings with sevenths and ninths, no semitone rubs; the stabs take
// the top three. Everything stays in A major.
const A = c(45, 57, 61, 64, 71);
const E = c(40, 56, 59, 64, 66);
const Fsm = c(42, 57, 61, 64, 68);
const D = c(38, 57, 61, 66, 69);
const Csm = c(37, 56, 59, 64, 68);
export const VERSE = [A, E, Fsm, D];
export const CHORUS = [D, E, Csm, Fsm];

export const HOOK: readonly (readonly (readonly [number, number, number])[])[] =
  [
    [
      [0, 81, 0.4],
      [0.5, 80, 0.25],
      [0.75, 78, 0.25],
      [1, 76, 0.75],
      [2, 81, 0.25],
      [2.25, 83, 0.25],
      [2.5, 85, 1.25],
    ],
    [
      [0, 83, 0.4],
      [0.5, 80, 0.4],
      [1, 76, 0.4],
      [1.5, 80, 0.25],
      [1.75, 83, 0.75],
      [2.75, 88, 1],
    ],
    [
      [0, 85, 0.25],
      [0.25, 83, 0.25],
      [0.5, 80, 0.5],
      [1.25, 76, 0.5],
      [2, 80, 0.25],
      [2.25, 81, 0.25],
      [2.5, 83, 0.75],
      [3.25, 80, 0.5],
    ],
    [
      [0, 81, 1.5],
      [1.75, 78, 0.25],
      [2, 81, 0.5],
      [2.5, 85, 0.5],
      [3, 88, 0.9],
    ],
  ];

// Bloom cells: syllables rising through the chord, scattering on the turn.
// The hook's answer: the same contour a third higher, opening to the top F#.
export const ANSWER: readonly (readonly (readonly [
  number,
  number,
  number,
])[])[] = [
  [
    [0, 86, 0.4],
    [0.5, 85, 0.25],
    [0.75, 81, 0.25],
    [1, 78, 0.5],
    [1.75, 81, 0.25],
    [2, 86, 0.25],
    [2.25, 88, 0.25],
    [2.5, 90, 1.25],
  ],
  [
    [0, 88, 0.25],
    [0.25, 83, 0.25],
    [0.5, 80, 0.25],
    [0.75, 83, 0.5],
    [1.5, 88, 0.5],
    [2.25, 85, 0.25],
    [2.5, 83, 0.5],
    [3.25, 80, 0.6],
  ],
  [
    [0, 80, 0.25],
    [0.25, 85, 0.25],
    [0.5, 88, 0.5],
    [1.25, 85, 0.25],
    [1.5, 80, 0.5],
    [2.25, 83, 0.25],
    [2.5, 85, 0.75],
    [3.5, 88, 0.4],
  ],
  [
    [0, 85, 1],
    [1.25, 81, 0.25],
    [1.5, 78, 0.25],
    [1.75, 81, 0.25],
    [2, 85, 0.5],
    [2.5, 90, 1.4],
  ],
];
export const RIFF_CHORUS = [
  "3.4.5.3.4.5.6.4.",
  "5.6.7.5.6.7.8.6.",
  "3.4.5.3.4.5.6.4.",
  "8.7.6.5.7.6.5.4.",
];
export const RIFF_POST = [
  "34567.5.4.3.4.5.",
  "56789.7.6.5.6.7.",
  "34567.5.4.3.4.5.",
  "9.8.7.6.8.7.6.5-",
];
export const RIFF_POST2 = [
  "3.53.64.5.75.86.",
  "4.64.75.6.86.97.",
  "3.53.64.5.75.86.",
  "9.7.5.86.4.75.3.",
];
// Choruses hold the stabs back for their first four bars, so each one
// climbs into its drop.
export const STABS = [
  "8.....7...8..7..",
  "..8..7..8.....7.",
  "8.....7...8..7..",
  "8..7..8..7..8.7.",
];
export const STABS_POST = [
  "8..7..8...7..8..",
  ".8.7..8...8..7..",
  "8..7..8...7..8..",
  "8..7..8.7.8..7.8",
];
export const BELLS = [
  "7...6...5.......",
  "8.....6.....5...",
  "7...6...5.......",
  "8...7...6...5...",
];
export const BELLS_VERSE = [
  "5.......4.......",
  "........6...5...",
  "5.......4.......",
  "4...3...2...1...",
];
export const ARP_16 = ["0246024602460246", "6420642064206420"];
export const ARP_SKIP = ["0.24.6.0.24.6.4.", "6.42.0.6.42.0.2."];

// Bass lines (`bassLine` steps): held and gliding under the verses, an
// offbeat octave pump under the choruses and blooms.
export const LINE_VERSE = ["0-------....2~0.", "0.......0...1~0."];
export const LINE_CHORUS = ["0.2~..2~0...2~.2", "0.2...2~0...1.2~"];
export const LINE_BLOOM = ["..2.0.2~0..2.0.2", "..2.0.2...2.1~2~"];
export const LINE_BLOOM2 = ["0.2..20.2~0.2.3~", "2.0..20.1.2.5~2~"];

const CHORUS_LINES: SongSection["lines"] = [
  "ch1",
  null,
  "ch2",
  null,
  "ch1",
  null,
  "ch3",
  null,
];

export const SECTIONS: readonly SongSection[] = [
  {
    kind: "intro",
    name: "Seed",
    bars: 8,
    chords: VERSE,
    drums: ["none", "tresillo"],
    energy: 0.75,
    play: ["cloud", "bells", "pad"],
    bursts: true,
    bells: BELLS_VERSE,
  },
  {
    kind: "verse",
    name: "Verse 1",
    bars: 8,
    chords: VERSE,
    drums: ["tresillo", "skip"],
    energy: 0.85,
    play: ["sub", "bells", "pad"],
    bursts: true,
    bells: BELLS_VERSE,
    line: LINE_VERSE,
    lines: ["v1", null, "v2", null, "v3", null, "v4", null],
    words: 0.85,
  },
  {
    kind: "chorus",
    name: "Chorus 1",
    bars: 8,
    chords: CHORUS,
    drums: ["euro", "tresillo"],
    energy: 0.84,
    play: ["sub", "pad", "stabs"],
    bursts: true,
    stabs: [null, null, null, null, ...STABS],
    stabShift: 12,
    line: LINE_CHORUS,
    lines: CHORUS_LINES,
    words: 0.9,
    thirds: true,
  },
  {
    kind: "post",
    name: "Bloom 1",
    bars: 8,
    chords: CHORUS,
    drums: ["euro", "tresillo"],
    play: ["sub", "growl", "stabs", "arp", "riff", "lead"],
    stabs: STABS_POST,
    arp: ARP_16,
    riff: RIFF_POST,
    lead: HOOK,
    line: LINE_BLOOM,
  },
  {
    kind: "verse",
    name: "Verse 2",
    bars: 8,
    chords: VERSE,
    drums: ["skip", "tresillo"],
    energy: 0.9,
    play: ["sub", "arp", "pad", "bells"],
    bursts: true,
    arp: ARP_SKIP,
    bells: BELLS_VERSE,
    line: LINE_VERSE,
    lines: ["v5", null, "v6", null, "v7", null, "v8", null],
    words: 0.85,
  },
  {
    kind: "chorus",
    name: "Chorus 2",
    bars: 8,
    chords: CHORUS,
    drums: ["euro"],
    energy: 0.84,
    play: ["sub", "pad", "stabs", "riff", "double"],
    stabs: [null, null, null, null, ...STABS],
    stabShift: 12,
    riff: RIFF_POST,
    line: LINE_CHORUS,
    lines: CHORUS_LINES,
    words: 0.9,
    thirds: true,
  },
  {
    kind: "post",
    name: "Bloom 2",
    bars: 8,
    chords: CHORUS,
    drums: ["tresillo", "euro"],
    play: ["sub", "stabs", "arp", "riff", "lead", "growl"],
    stabs: STABS_POST,
    arp: ARP_SKIP,
    riff: RIFF_POST2,
    lead: [...HOOK, ...ANSWER],
    voiceLead: true,
    line: LINE_BLOOM2,
  },
  {
    // Drumless: the voice frozen into the grain pad, glitching over it.
    kind: "break",
    name: "Greenhouse",
    bars: 4,
    chords: [Fsm, D, A, E],
    drums: ["none"],
    energy: 0.7,
    play: ["pad", "cloud", "bells"],
    bells: BELLS_VERSE,
  },
  {
    kind: "build",
    name: "Sunlight",
    bars: 4,
    chords: [D, E, Fsm, E],
    drums: ["broken"],
    energy: 0.9,
    play: ["sub", "pad", "arp", "riff", "stabs"],
    arp: ARP_SKIP,
    riff: RIFF_CHORUS,
    stabs: ["8...8...8...8...", "8.8.8.8.8.8.8.8."],
    line: LINE_CHORUS,
  },
  {
    kind: "chorus",
    name: "Last chorus",
    bars: 8,
    chords: CHORUS,
    drums: ["euro", "tresillo"],
    energy: 0.88,
    play: ["sub", "pad", "stabs", "riff", "bells", "double"],
    stabs: [null, null, null, null, ...STABS_POST],
    stabShift: 12,
    bells: BELLS,
    riff: RIFF_POST2,
    line: LINE_CHORUS,
    lines: CHORUS_LINES,
    words: 0.9,
    thirds: true,
  },
  {
    kind: "post",
    name: "Last bloom",
    bars: 8,
    chords: CHORUS,
    drums: ["euro"],
    play: ["sub", "growl", "stabs", "arp", "riff", "lead"],
    stabs: STABS_POST,
    arp: ARP_16,
    riff: RIFF_POST2,
    lead: [...ANSWER, ...HOOK],
    voiceLead: true,
    line: LINE_BLOOM2,
  },
  {
    kind: "outro",
    name: "Glass",
    bars: 4,
    chords: [D, A],
    drums: ["none"],
    play: ["pad", "cloud", "bells"],
    bells: ["7...6...5.......", null],
  },
];
/** The kit's levels and patch changes for this song (bpm aside). */
export const KIT: Omit<KitOptions, "bpm"> = {
  levels: {
    bells: 0.2,
    saw: 0.16,
    arp: 0.18,
    chops: 0.8,
    vgrain: 0.32,
    sing: 0.2,
    harm: 0.16,
  },
  extra: {
    // The breathy book reads quiet: a presence lift and a little more makeup
    // keep the consonants clear while the low cut keeps the voice in its band.
    vox: {
      fx: {
        eq: { low: -6, lowfreq: 200, mid: 3, midfreq: 4000, high: 4, highfreq: 8000 },
        compressor: { ...VOCAL_COMP, makeup: 22, attack: 0.015 },
        duck: VOCAL_DUCK,
      },
    },
    // Glassy: a high formant and plenty of air.
    sing: {
      sing: {
        preset: "aah",
        voice: "soprano",
        formant: 3,
        bright: 0.78,
        articulate: 1,
        breath: 0.09,
        jitter: 0.22,
        vib: 5.8,
        vibmod: 0.15,
        vibdelay: 0.3,
        ring: 0.36,
      },
      // Close and present, with a plate behind it. With the book's own
      // duck this dips the bed on orbit 2 about 4 dB while a line sings.
      fx: {
        crush: { bits: 16, coarse: 1, mix: 0 },
        eq: { mid: 2, midfreq: 3000, high: 3, highfreq: 10000 },
        compressor: {
          threshold: -20,
          ratio: 3,
          attack: 0.006,
          release: 0.12,
          makeup: 2,
        },
        duck: {
          orbit: 2,
          depth: 0.2,
          attack: 0.5,
          onset: 0.06,
          hold: true,
        },
      },
      reverb: { mix: 0.22, size: 0.7, fade: 2.6, lowpass: 10000 },
    },
  },
};

const BARS = SECTIONS.reduce((n, s) => n + s.bars, 0);

export const glassGarden: DemoDefinition = {
  info: demoInfo({
    id: "glass-garden",
    title: "Glass Garden",
    style: "Hyperpop",
    description:
      "Bright, glassy hyperpop in A major at 128: the recorded words lead every line with a synth singer shimmering under them, FM bells and syllable arps blooming after each line, tresillo and four-floor blooms on an offbeat octave bass, and a drumless greenhouse where the voice freezes into a grain pad and glitches.",
    tempoBpm: BPM,
    key: "A",
    bars: BARS,
    highlightBar: 24,
    trackId: "chops",
    features: [
      "the book's recorded words up front on every line, a synth singer under them",
      "a backing singer a diatonic third under every chorus line",
      "syllable arps that bloom up through the chord after every line",
      "an offbeat octave bass pumping under the blooms",
      "tresillo, two-step and four-floor beats by phrase",
      "a drumless greenhouse: frozen grain voice, stuttering synth singer",
      "vowel wavetable lead doubled by the looped voice",
    ],
    arrangement: SECTIONS.map((s) => `${s.name} ${s.bars}`),
    mixNotes: [
      "the recorded words lead, about 8 dB over the mix where consonants live; the synth singer sits under them",
      "chorus stabs sit an octave above the singer's register",
      "the bed dips about 6 dB while a line sings; the syllable arps tuck under the lines and open up in the blooms",
      "bells ring above the arp so the syllables fill the middle",
      "short delay throws after the last word of every sung line",
      "kick pumps the whole bed on orbit 2",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    kitTracks(s, BOOK, { bpm: BPM, ...KIT });
    const song = writeSong(s, { book: BOOK, scale: SCALE, sections: SECTIONS });
    const { at } = song;

    // The backing singer takes the whole chorus line a diatonic third
    // under, not just the held notes (writeSong places those).
    for (const p of song.placed)
      if (p.kind === "chorus")
        (p.lines ?? []).forEach((part, i) => {
          if (!part) return;
          for (const [beat, pitch, beats, lyric] of BOOK.melody[part])
            if (beats >= 0.45 && beats < 0.8)
              s.note(
                "harm",
                p.start + i,
                beat,
                thirdBelow(SCALE, pitch),
                beats,
                0.55,
                {
                  lyric,
                },
              );
        });

    // Seed: the voice grows out of a held vowel, the synth singer humming
    // the chorus shape with no words, syllables sprouting.
    s.note("vlead", 0, 0, 69, 7.5, 0.5, flick.up(-1200, 0.4));
    s.note("sing", 2, 0, 76, 3.5, 0.42, { lyric: "ooh" });
    s.note("sing", 3, 0.5, 73, 3, 0.45, { lyric: "_" });
    singPart(
      s,
      4,
      BOOK.melody.ch1.map(([b, p, l]) => [b, p, l, "ooh"] as const),
      { velocity: 0.5 },
    );
    glitch(
      s,
      song,
      BOOK,
      5,
      "0.2.4.2.5.4.7.6.",
      ["glass", "bloom", "glow", "grow"],
      0.55,
    );
    // Verse answers, in the second verse only: the first leaves its gaps
    // to the delay throws.
    {
      const bar = at("Verse 2");
      glitch(s, song, BOOK, bar + 1, "........3.4.5.4.", [
        "bloom",
        "grow",
        "ah",
      ]);
      glitch(s, song, BOOK, bar + 5, "......5.4.3.2-1-", [
        "glass",
        "glow",
        "ooh",
      ]);
    }
    // Blooms: an "ah" scattered over the chord on each phrase's turn, and a
    // glitch burst leaping down through it on the last bar.
    for (const name of ["Bloom 1", "Bloom 2", "Last bloom"]) {
      const bar = at(name);
      stutter(
        s,
        song,
        "s_ah",
        bar + 3,
        2,
        8,
        0.25,
        [0, 4, 0, -3, 0, 4, 9, 4],
        0.45,
        0.8,
      );
      glitch(
        s,
        song,
        BOOK,
        bar + 7,
        "97.5.86.4.75.3.2",
        ["glow", "glass"],
        0.55,
      );
    }
    // Greenhouse: the synth singer stutters the chorus words on chord
    // tones over the frozen voice.
    const gh = at("Greenhouse");
    s.note("vlead", gh, 0, 69, 15.5, 0.5);
    singStutter(s, gh, 0, 6, 0.5, [76, 73, 81, 76], "glass", 0.5, 0.7);
    s.note("sing", gh, 3, 74, 1, 0.6, { lyric: "gar-" });
    singStutter(s, gh + 1, 0, 8, 0.25, [78, 74, 81, 78], "den", 0.5, 0.65);
    s.note("sing", gh + 1, 2, 76, 2, 0.6, { lyric: "ooh" });
    singStutter(s, gh + 2, 0, 12, 0.25, [76, 73, 81, 76], "glow", 0.45, 0.75);
    s.note("sing", gh + 3, 0, 80, 1.5, 0.65, { lyric: "glow-" });
    s.note("sing", gh + 3, 1.5, 83, 2.25, 0.7, { lyric: "en" });
    glitch(
      s,
      song,
      BOOK,
      gh + 1,
      "2.4.5.4.2..4.5..",
      ["glass", "bloom", "ooh"],
      0.55,
    );
    glitch(
      s,
      song,
      BOOK,
      gh + 3,
      "4.5.6.4.6.5.2...",
      ["glow", "grow", "ah"],
      0.55,
    );
    // A held breath before the last chorus.
    const last = at("Last chorus");
    dropout(s, last - 1, 3.5, 0.5, [
      "kick",
      "snare",
      "hats",
      "sub",
      "pad",
      "arp",
      "chops",
      "stabs",
      "bells",
    ]);
    const out = at("Glass");
    singPart(s, out, BOOK.melody.ch1, { velocity: 0.55 });
    s.note("bells", out + 2, 0, 93, 4, 0.4, flick.dive(-1200, 0.6));

    // ---------------------------------------------------------- lanes
    // The words throw short and low; the sung layers can throw wide.
    patch(s, "vox", {
      delayMixAutomation: throws(song.throwsAt, VOCAL_ECHO.mix, THROW_PEAK, 1),
    });
    for (const id of ["sing"])
      patch(s, id, {
        delayMixAutomation: throws(song.throwsAt, 0.06, 0.38, 1),
      });
    patch(s, "sing", {
      fxAutomation: {
        "crush-mix": steps([0, 0], [gh, 0.3], [gh + 4, 0]),
      },
    });
    patch(s, "sweep", { filterAutomation: riserLane(song.builds) });
    patch(s, "chops", {
      // The syllable arps tuck under the sung lines and open up in the blooms.
      volumeAutomation: steps(
        [0, 1],
        [at("Verse 1"), 0.75],
        [at("Chorus 1"), 0.6],
        [at("Bloom 1"), 1],
        [at("Verse 2"), 0.75],
        [at("Chorus 2"), 0.6],
        [at("Bloom 2"), 1],
        [last, 0.6],
        [at("Last bloom"), 1],
      ),
      fxAutomation: {
        "formant-shift": steps(
          [0, 0],
          [at("Bloom 1"), 3],
          [at("Verse 2"), 0],
          [at("Bloom 2"), 3],
          [gh, -2],
          [at("Sunlight"), 0],
          [at("Last bloom"), 3],
          [out, 0],
        ),
        "crush-mix": steps([0, 0], [gh, 0.2], [gh + 4, 0]),
      },
    });
    patch(s, "stut", {
      fxAutomation: {
        "crush-mix": ramps([0, 0], [gh, 0], [gh + 3.9, 0.5], [gh + 4, 0]),
      },
    });
    patch(s, "pad", {
      filterAutomation: ramps(
        [0, 1200],
        [at("Verse 1"), 1600],
        [at("Chorus 1") - 0.01, 2800],
        [at("Chorus 1"), 3800],
        [at("Verse 2"), 1800],
        [at("Chorus 2"), 4200],
        [gh, 1400],
        [gh + 3.9, 2400],
        [at("Sunlight"), 1600],
        [last - 0.01, 5000],
        [last, 4600],
        [out, 2600],
        [BARS, 700],
      ),
    });
    return s.finish();
  },
};
