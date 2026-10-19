/**
 * Low Battery: darker hyperpop in F# minor at 150. A synth singer carries
 * every line, the recorded words blended under it and up in the choruses;
 * half-time drops on a gliding 808 doubled by a growling saw under 3-3-2
 * syllable riffs; and a drumless low-power break before the last recharge.
 */
import { Composer } from "./build.ts";
import {
  RHYTHM,
  dropout,
  flick,
  glitch,
  kitTracks,
  patch,
  ramps,
  riserLane,
  singPart,
  singStutter,
  steps,
  stutter,
  sungLine,
  throws,
  writeSong,
  type Book,
  type Chord,
  type SongSection,
} from "./hyperpop.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

const BPM = 150;
const { r1, r1l, r2, r2l, l4, l4l, l5, l5l } = RHYTHM;
const QUICK = [0, 0.5, 1, 1.5, 2];
const QUICKL = [0.5, 0.5, 0.5, 0.5, 1.8];

// The book's tunes (scripts/vox/songs.py), sung by the synth too.
const BOOK: Book = {
  sample: "low-battery-vox",
  root: 69,
  syllables: ["low", "charge", "up", "fade", "hey", "ah"],
  ends: {
    v1: 3,
    v2: 3,
    v3: 3,
    v4: 3,
    v5: 2,
    v6: 2,
    v7: 2,
    v8: 2.5,
    pre1: 2,
    pre2: 2,
    ch1: 5.5,
    ch2: 3,
    ch3: 5,
  },
  melody: {
    v1: sungLine(
      "two per- cent and fad- ing fast",
      r1,
      [73, 73, 71, 69, 71, 69, 66],
      r1l,
    ),
    v2: sungLine(
      "hold- ing on to what we had",
      r2,
      [74, 74, 73, 71, 73, 71, 69],
      r2l,
    ),
    v3: sungLine(
      "red light blink- ing on my hand",
      r1,
      [73, 73, 76, 73, 71, 69, 71],
      r1l,
    ),
    v4: sungLine(
      "plug me in I'll un- der- stand",
      r2,
      [71, 71, 73, 71, 69, 68, 69],
      r2l,
    ),
    v5: sungLine("run- ning on fumes", l4, [73, 69, 66, 66], l4l),
    v6: sungLine("burn- ing too hot", l4, [68, 73, 76, 80], l4l),
    v7: sungLine("left me on read", l4, [66, 69, 73, 78], l4l),
    v8: sungLine("all you nev- er said", l5, [76, 73, 76, 80, 81], l5l),
    pre1: sungLine("don't let me go dark", QUICK, [76, 76, 74, 73, 71], QUICKL),
    pre2: sungLine(
      "you're my on- ly spark",
      QUICK,
      [76, 76, 78, 76, 80],
      QUICKL,
    ),
    ch1: sungLine(
      "low bat- tery low bat- tery",
      [0, 1, 1.5, 2.5, 3.5, 4],
      [78, 81, 76, 81, 80, 76],
      [0.9, 0.5, 0.9, 0.9, 0.5, 2.4],
    ),
    ch2: sungLine(
      "give me your en- er- gy",
      [0, 0.5, 1, 1.5, 2.5, 3],
      [76, 76, 78, 80, 81, 80],
      [0.5, 0.5, 0.5, 0.9, 0.5, 4],
    ),
    ch3: sungLine(
      "charge me up don't let me fade a- way",
      [0, 0.5, 1, 2, 2.5, 3, 3.5, 4.5, 5],
      [76, 76, 80, 81, 80, 78, 76, 78, 81],
      [0.5, 0.5, 0.9, 0.5, 0.5, 0.5, 0.9, 0.5, 2.5],
    ),
  },
};
// F# minor shares A major's pitch classes.
const SCALE = [1, 2, 4, 6, 8, 9, 11];

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
// Open voicings with sevenths and ninths, no semitone rubs; the stabs take
// the top three.
const Fsm = c(42, 57, 61, 64, 68);
const D = c(38, 57, 61, 66, 69);
const A = c(45, 57, 59, 61, 64);
const E = c(40, 56, 59, 64, 66);
const Csm = c(37, 56, 59, 61, 64);
const VERSE = [Fsm, D, A, E];
const CHORUS = [D, E, Csm, Fsm];

const HOOK: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [0, 78, 0.22],
    [0.25, 78, 0.22],
    [0.75, 81, 0.5],
    [1.5, 78, 0.25],
    [2, 76, 0.5],
    [2.75, 74, 0.5],
    [3.5, 73, 0.4],
  ],
  [
    [0, 76, 0.5],
    [0.75, 80, 0.5],
    [1.5, 83, 0.4],
    [2, 80, 0.25],
    [2.5, 76, 0.5],
    [3.25, 73, 0.6],
  ],
  [
    [0, 73, 0.22],
    [0.25, 76, 0.22],
    [0.75, 80, 0.5],
    [1.5, 85, 0.5],
    [2.25, 83, 0.25],
    [2.5, 80, 0.4],
    [3, 76, 0.25],
    [3.5, 73, 0.4],
  ],
  [
    [0, 78, 1],
    [1.5, 73, 0.25],
    [1.75, 76, 0.25],
    [2, 81, 0.5],
    [2.75, 78, 1.1],
  ],
];

// The last drop states the hook, then answers it up to the top F#.
const HOOK_LAST = [
  ...HOOK,
  [
    [0, 81, 0.22],
    [0.25, 81, 0.22],
    [0.5, 78, 0.22],
    [0.75, 81, 0.5],
    [1.5, 86, 0.5],
    [2.25, 85, 0.25],
    [2.5, 81, 0.5],
    [3.25, 78, 0.6],
  ],
  [
    [0, 83, 0.5],
    [0.75, 80, 0.25],
    [1, 83, 0.25],
    [1.25, 88, 0.6],
    [2, 83, 0.25],
    [2.25, 80, 0.5],
    [3, 76, 0.25],
    [3.25, 78, 0.25],
    [3.5, 80, 0.4],
  ],
  [
    [0, 85, 0.22],
    [0.25, 85, 0.22],
    [0.5, 80, 0.22],
    [0.75, 85, 0.5],
    [1.5, 88, 0.5],
    [2.25, 85, 0.25],
    [2.5, 83, 0.25],
    [2.75, 80, 0.5],
    [3.5, 76, 0.4],
  ],
  [
    [0, 78, 0.5],
    [0.75, 81, 0.25],
    [1, 85, 0.25],
    [1.25, 90, 1.2],
    [3, 85, 0.25],
    [3.5, 81, 0.4],
  ],
] as const;

// 3-3-2 syllable riffs, leaping octaves on the turn: they answer the sung
// chorus and carry the drops; the verses get glitch bursts instead.
const RIFF_CHORUS = [
  "4..4..6.5..5..3.",
  "3..4..5.6..5..4.",
  "4..4..6.5..5..7.",
  "7..6..5.4.3.2.1.",
];
const RIFF_DROP = [
  "44.4..6.55.5..3.",
  "3..44.5.6..55.4.",
  "44.4..6.55.5.77.",
  "7.7.6.6.5.5.4.4.",
];
const RIFF_DROP2 = [
  "4.44.46.5.55.53.",
  "3.34.45.6.65.54.",
  "4.44.46.5.55.577",
  "7-6-5-4-7.6.5.43",
];
// Choruses hold the stabs back for their first four bars, so each one
// climbs into its drop.
const STABS = [
  "8..7..8.....7...",
  "..7..7..8..7....",
  "8..7..8.....7.7.",
  "8..7..8..7..8.77",
];
const STABS_DROP = [
  "8..8..8...8..8..",
  "...8..8.8...8...",
  "8..8..8...8..8..",
  "8..8..8.8..8.8.8",
];
const BELLS = [
  "7.....5.....6...",
  "....5...4.....3.",
  "7.....5.....6...",
  "8...7...6...5...",
];
const ARP_8 = ["0.1.2.3.2.1.0.1.", "0.2.1.3.2.4.3.5."];
const ARP_SKIP = ["0.12.3.2.10.1.2.", "0.21.3.24.3.5.4."];
// 808 lines (`bassLine` steps) with glides; the growl doubles them an
// octave up in the drops.
const LINE_INTRO = ["0---------------", "0-----------2~0."];
const LINE_VERSE = ["0.....0..2~0..5~", "0......0..1~2..."];
const LINE_VERSE2 = ["0...0...0...0.2~", "0...0...0..20.2~"];
const LINE_CHORUS = ["0.....0.2~0...2~", "0..2~0.....5~2.."];
const LINE_DROP = ["0..0.2~0...2..2~", "0.20..2~0..3~2~1"];
const LINE_DROP2 = ["0.20.20.2.0.2~3.", "0.2~.20.1~2.0.5~"];

const VOICED: SongSection["lines"] = [
  "v1",
  null,
  "v2",
  null,
  "v3",
  null,
  "v4",
  null,
];
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

const SECTIONS: readonly SongSection[] = [
  {
    // Drumless: the synth voice hums over the 808 sliding in, syllables
    // booting up in bursts.
    kind: "intro",
    name: "Power on",
    bars: 8,
    chords: VERSE,
    drums: ["none", "taps"],
    energy: 0.8,
    play: ["sub", "pad", "cloud", "arp"],
    bursts: true,
    arp: ["0...............", "....0..........."],
    line: [null, null, null, null, ...LINE_INTRO, ...LINE_INTRO],
  },
  {
    kind: "verse",
    name: "Verse 1",
    bars: 8,
    chords: VERSE,
    drums: ["trap", "bounce"],
    energy: 0.8,
    play: ["sub", "bells"],
    bursts: true,
    bells: BELLS,
    line: LINE_VERSE,
    lines: VOICED,
    words: 0.28,
  },
  {
    kind: "chorus",
    name: "Chorus 1",
    bars: 8,
    chords: CHORUS,
    drums: ["half", "bounce"],
    energy: 0.8,
    play: ["sub", "pad", "stabs"],
    bursts: true,
    stabs: [null, null, null, null, ...STABS],
    line: LINE_CHORUS,
    lines: CHORUS_LINES,
    words: 0.5,
    thirds: true,
  },
  {
    kind: "post",
    name: "Drop 1",
    bars: 8,
    chords: CHORUS,
    drums: ["bounce", "trap"],
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
    drums: ["euro", "bounce"],
    energy: 0.82,
    play: ["sub", "arp", "pad"],
    bursts: true,
    arp: ARP_SKIP,
    line: LINE_VERSE2,
    lines: ["v5", null, "v6", null, "v7", null, "v8", null],
    words: 0.3,
  },
  {
    kind: "chorus",
    name: "Chorus 2",
    bars: 8,
    chords: CHORUS,
    drums: ["euro", "bounce"],
    energy: 0.84,
    play: ["sub", "pad", "stabs", "riff", "bells"],
    stabs: [null, null, null, null, ...STABS],
    bells: BELLS,
    riff: RIFF_DROP,
    line: LINE_CHORUS,
    lines: CHORUS_LINES,
    words: 0.54,
    thirds: true,
  },
  {
    kind: "post",
    name: "Drop 2",
    bars: 8,
    chords: CHORUS,
    drums: ["trap", "bounce"],
    play: ["sub", "growl", "stabs", "lead", "riff"],
    stabs: STABS_DROP,
    riff: RIFF_DROP2,
    lead: HOOK,
    voiceLead: true,
    line: LINE_DROP2,
  },
  {
    // Drumless over the chorus chords: the synth voice stutters and
    // crushes while the syllables glitch around it.
    kind: "break",
    name: "Low power",
    bars: 4,
    chords: CHORUS,
    drums: ["none"],
    play: ["pad", "cloud"],
  },
  {
    kind: "build",
    name: "Recharge",
    bars: 4,
    chords: CHORUS,
    drums: ["taps"],
    energy: 0.9,
    play: ["sub", "pad", "arp", "riff"],
    arp: ARP_8,
    riff: RIFF_CHORUS,
    line: LINE_CHORUS,
  },
  {
    kind: "chorus",
    name: "Last chorus",
    bars: 8,
    chords: CHORUS,
    drums: ["euro", "bounce"],
    energy: 0.88,
    play: ["sub", "pad", "stabs", "riff", "double", "bells"],
    stabs: [null, null, null, null, ...STABS_DROP],
    bells: BELLS,
    riff: RIFF_DROP2,
    line: LINE_CHORUS,
    lines: CHORUS_LINES,
    words: 0.6,
    thirds: true,
  },
  {
    kind: "post",
    name: "Last drop",
    bars: 8,
    chords: CHORUS,
    drums: ["bounce", "trap"],
    play: ["sub", "growl", "stabs", "lead", "riff"],
    stabs: STABS_DROP,
    riff: RIFF_DROP2,
    lead: HOOK_LAST,
    voiceLead: true,
    line: LINE_DROP2,
    transpose: 2,
  },
  {
    kind: "outro",
    name: "Shutdown",
    bars: 4,
    chords: [Fsm, D],
    drums: ["none"],
    play: ["pad", "cloud"],
  },
];
const BARS = SECTIONS.reduce((n, s) => n + s.bars, 0);

export const lowBattery: DemoDefinition = {
  info: demoInfo({
    id: "low-battery",
    title: "Low Battery",
    style: "Hyperpop",
    description:
      "Darker hyperpop in F# minor at 150: a synth singer carries every line with the recorded words blended under it, low in the verses and up in the choruses; half-time drops on a gliding 808 doubled by a growling saw under 3-3-2 syllable riffs; and a drumless low-power break where the voice stutters and crushes before the recharge.",
    tempoBpm: BPM,
    key: "F#m",
    bars: BARS,
    highlightBar: 24,
    trackId: "chops",
    features: [
      "a synth singer on every line, the book's recorded words blended under it",
      "a backing singer a third under the held chorus notes",
      "half-time drops on a gliding 808, doubled an octave up by the growl",
      "3-3-2 syllable riffs leaping octaves on the turn",
      "chopped chants that step down the chord, never slide",
      "a drumless low-power break: the voice stutters and crushes",
      "a whole-step key change into the last drop",
      "vowel wavetable lead doubled by the looped voice",
    ],
    arrangement: SECTIONS.map((s) => `${s.name} ${s.bars}`),
    mixNotes: [
      "the synth singer leads; the recorded words sit 5 to 10 dB under it",
      "the half-time drops leave room for the 808 and growl under the riff",
      "delay throws open on the last word of every sung line",
      "kick pumps the whole bed on orbit 2",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    kitTracks(s, BOOK, {
      bpm: BPM,
      kick: "syn808",
      levels: { kick: 0.46, saw: 0.23, stabs: 0.26, sing: 0.28, harm: 0.13 },
      extra: {
        snare: { kit: "syn808" },
        // Darker than the book: a lower formant, less air.
        sing: {
          sing: {
            preset: "aah",
            voice: "soprano",
            formant: 1.8,
            bright: 0.58,
            articulate: 1,
            breath: 0.06,
            jitter: 0.3,
            vib: 5.4,
            vibmod: 0.12,
            vibdelay: 0.3,
            ring: 0.42,
          },
        },
      },
    });
    const song = writeSong(s, { book: BOOK, scale: SCALE, sections: SECTIONS });
    const { at } = song;

    // Power on: a battery beep, then the synth voice humming the chorus
    // shape with no words, an octave leap on the turn.
    for (const bar of [0, 2])
      for (const beat of [0, 0.25, 0.5])
        s.note("arp", bar, beat, 93, 0.12, 0.5);
    s.note("sing", 2, 0, 73, 3.5, 0.45, { lyric: "ooh" });
    s.note("sing", 3, 0, 76, 1.5, 0.5, { lyric: "ah" });
    s.note("sing", 3, 1.5, 71, 2, 0.5, { lyric: "_" });
    singPart(
      s,
      4,
      BOOK.melody.ch1.map(([b, p, l]) => [b, p, l, "ah"] as const),
      {
        velocity: 0.5,
      },
    );
    singStutter(s, 7, 2, 8, 0.25, [80, 76, 80, 88], "ah", 0.4, 0.7);
    // Chorus pickups.
    for (const name of ["Chorus 1", "Chorus 2", "Last chorus"])
      stutter(s, song, "h_ch1", at(name) + 3, 2.5, 6, 0.25, [0], 0.45, 0.75);
    // Verse answers on the glitch track, in the second verse only: the
    // first leaves its gaps to the delay throws.
    {
      const bar = at("Verse 2");
      glitch(s, song, BOOK, bar + 1, "4..4..5.6..6..4.", ["low", "low", "up"]);
      glitch(s, song, BOOK, bar + 5, "6..5..4.3..3..2.", [
        "charge",
        "up",
        "hey",
      ]);
    }
    // Drops: the "low" chant chopped in 32nds stepping down the chord; a
    // fifth-and-octave "charge" stutter into the turn.
    for (const name of ["Drop 1", "Drop 2", "Last drop"]) {
      const bar = at(name);
      stutter(
        s,
        song,
        "s_low",
        bar + 3,
        3,
        8,
        0.125,
        [0, 0, -3, -3, -8, -8, -12, -12],
        0.75,
        0.45,
      );
      stutter(
        s,
        song,
        "s_charge",
        bar + 7,
        2,
        8,
        0.25,
        [0, 0, 7, 0, 7, 12, 7, 12],
        0.45,
        0.8,
      );
    }
    // Low power: the voice stutters on chord tones, the lead dives out.
    const down = at("Low power");
    dropout(s, down - 1, 2, 2, ["lead", "vlead"]);
    s.note("lead", down - 1, 2, 78, 2, 0.7, flick.dive(-1200, 0.05));
    singStutter(s, down, 0, 6, 0.5, [78, 73, 78, 81], "low", 0.5, 0.7);
    s.note("sing", down, 3, 76, 1, 0.6, { lyric: "bat-" });
    singStutter(s, down + 1, 0, 8, 0.25, [80, 76, 71, 76], "tery", 0.5, 0.65);
    s.note("sing", down + 1, 2.5, 76, 1.5, 0.6, { lyric: "ah" });
    singStutter(s, down + 2, 0, 12, 0.25, [80, 76, 73, 76], "fade", 0.45, 0.75);
    s.note("sing", down + 3, 0, 78, 1.5, 0.65, { lyric: "a-" });
    s.note("sing", down + 3, 1.5, 81, 1.5, 0.7, { lyric: "way" });
    glitch(
      s,
      song,
      BOOK,
      down + 1,
      "4.4..6.5..5.3...",
      ["low", "fade", "ah"],
      0.55,
    );
    glitch(
      s,
      song,
      BOOK,
      down + 3,
      ".4.4..5..6.5..4.",
      ["charge", "up", "hey"],
      0.55,
    );
    // One silent beat before the last chorus.
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
    // Shutdown: the hook hummed once more, the pad running down.
    const out = at("Shutdown");
    singPart(s, out, BOOK.melody.ch1, { velocity: 0.55 });
    s.note("pad", out + 2, 0, 54, 8, 0.4, flick.dive(-1200, 0.5));

    // ---------------------------------------------------------- lanes
    for (const id of ["vox", "sing"])
      patch(s, id, {
        delayMixAutomation: throws(song.throwsAt, 0.05, 0.4, 1),
      });
    patch(s, "sing", {
      fxAutomation: {
        "crush-mix": steps([0, 0], [down, 0.35], [down + 4, 0]),
      },
    });
    patch(s, "sweep", { filterAutomation: riserLane(song.builds) });
    patch(s, "chops", {
      fxAutomation: {
        // Down a minor third in the drops.
        "formant-shift": steps(
          [0, 0],
          [at("Drop 1"), -3],
          [at("Verse 2"), 0],
          [at("Drop 2"), -3],
          [down, 0],
          [at("Last drop"), -3],
          [out, 0],
        ),
        "crush-mix": steps([0, 0.3], [4, 0], [down, 0.3], [down + 4, 0]),
      },
    });
    patch(s, "stut", {
      fxAutomation: {
        "crush-mix": ramps([0, 0], [down, 0], [down + 3.9, 0.6], [down + 4, 0]),
      },
    });
    patch(s, "pad", {
      filterAutomation: ramps(
        [0, 900],
        [at("Verse 1"), 1300],
        [at("Chorus 1") - 0.01, 2400],
        [at("Chorus 1"), 3200],
        [at("Drop 1"), 1600],
        [at("Verse 2"), 1500],
        [at("Chorus 2"), 3600],
        [down, 2600],
        [down + 3.9, 900],
        [at("Recharge"), 1000],
        [last - 0.01, 4200],
        [last, 4000],
        [out, 2000],
        [BARS, 500],
      ),
    });
    return s.finish();
  },
};
