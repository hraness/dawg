/**
 * Low Battery: darker hyperpop in F# minor at 150. Trap and half-time
 * verses, half-time growl drops under a syllable riff, a four-floor second
 * verse, and a power-down breakdown where everything dives and the key
 * turns major for the last recharge.
 */
import { Composer } from "./build.ts";
import {
  dropout,
  flick,
  glitch,
  kitTracks,
  merge,
  patch,
  ramps,
  riserLane,
  slot,
  steps,
  stutter,
  throws,
  trackOf,
  writeSong,
  type Book,
  type Chord,
  type SongSection,
} from "./hyperpop.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

const BPM = 150;

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
};

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
// Four-note voicings with sevenths and ninths; the stabs take the top three.
const Fsm = c(42, 57, 61, 64, 68);
const D = c(38, 57, 61, 62, 66);
const A = c(45, 57, 59, 61, 64);
const E = c(40, 56, 59, 64, 66);
const Csm = c(37, 56, 59, 61, 64);
const Bm = c(47, 57, 61, 62, 66);
const Fs = c(42, 58, 61, 66, 68);
const VERSE = [Fsm, D, A, E];
const CHORUS = [D, E, Csm, Fsm];
const PRE = [Bm, Csm, D, E];
const DOWN = [D, E, Fs, Fs];

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
const LINE_PRE = ["0..0..2~0..0..2.", "0..0..2.0..2.3~2"];
const LINE_CHORUS = ["0.....0.2~0...2~", "0..2~0.....5~2.."];
const LINE_DROP = ["0..0.2~0...2..2~", "0.20..2~0..3~2~1"];
const LINE_DROP2 = ["0.20.20.2.0.2~3.", "0.2~.20.1~2.0.5~"];

const SECTIONS: readonly SongSection[] = [
  {
    // Drumless: the syllables boot up in bursts, then the 808 slides in.
    kind: "intro",
    name: "Power on",
    bars: 8,
    chords: VERSE,
    drums: ["none"],
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
    drums: ["taps", "bounce"],
    energy: 0.9,
    play: ["sub", "bells"],
    bursts: true,
    bells: BELLS,
    line: LINE_VERSE,
    lines: ["v1", null, "v2", null, "v3", null, "v4", null],
  },
  {
    kind: "pre",
    name: "Pre 1",
    bars: 4,
    chords: PRE,
    drums: ["none"],
    energy: 0.85,
    play: ["sub", "pad", "stabs", "arp"],
    stabs: ["8.......8.......", "8.......8..8...."],
    arp: ARP_8,
    line: LINE_PRE,
    lines: ["pre1", "pre2", null, null],
  },
  {
    kind: "chorus",
    name: "Chorus 1",
    bars: 8,
    chords: CHORUS,
    drums: ["bounce", "half"],
    energy: 0.88,
    play: ["sub", "pad", "stabs"],
    bursts: true,
    stabs: STABS,
    line: LINE_CHORUS,
    lines: ["ch1", null, "ch2", null, "ch1", null, "ch3", null],
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
    drums: ["none", "euro"],
    energy: 0.8,
    play: ["sub", "arp", "pad"],
    bursts: true,
    arp: ARP_SKIP,
    line: LINE_VERSE2,
    lines: ["v5", null, "v6", null, "v7", null, "v8", null],
  },
  {
    kind: "pre",
    name: "Pre 2",
    bars: 4,
    chords: PRE,
    drums: ["broken"],
    energy: 0.9,
    play: ["sub", "pad", "stabs", "arp"],
    stabs: ["8..7..8.....8...", "8..7..8..7..8..."],
    arp: ARP_8,
    line: LINE_PRE,
    lines: ["pre1", "pre2", null, null],
  },
  {
    kind: "chorus",
    name: "Chorus 2",
    bars: 8,
    chords: CHORUS,
    drums: ["euro", "bounce"],
    energy: 0.88,
    play: ["sub", "pad", "stabs", "riff", "bells"],
    stabs: STABS,
    bells: BELLS,
    riff: RIFF_DROP,
    line: LINE_CHORUS,
    lines: ["ch1", null, "ch2", null, "ch1", null, "ch3", null],
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
    kind: "break",
    name: "Power down",
    bars: 8,
    chords: DOWN,
    drums: ["none"],
    play: ["pad", "cloud"],
  },
  {
    kind: "build",
    name: "Recharge",
    bars: 4,
    chords: PRE,
    drums: ["taps"],
    energy: 0.9,
    play: ["sub", "pad", "arp", "riff"],
    arp: ARP_8,
    riff: RIFF_CHORUS,
    line: LINE_PRE,
  },
  {
    kind: "chorus",
    name: "Last chorus",
    bars: 8,
    chords: CHORUS,
    drums: ["euro", "bounce"],
    play: ["sub", "pad", "stabs", "riff", "double", "bells"],
    stabs: STABS_DROP,
    bells: BELLS,
    riff: RIFF_DROP2,
    line: LINE_CHORUS,
    lines: ["ch1", null, "ch2", null, "ch1", null, "ch3", null],
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
    bars: 6,
    chords: [Fsm],
    drums: ["none"],
    play: ["pad", "cloud"],
    bursts: true,
  },
];
const BARS = SECTIONS.reduce((n, s) => n + s.bars, 0);

export const lowBattery: DemoDefinition = {
  info: demoInfo({
    id: "low-battery",
    title: "Low Battery",
    style: "Hyperpop",
    description:
      "Darker hyperpop in F# minor at 150: a drumless boot where a gliding 808 slides in under glitch bursts of syllables, half-time verses and drops on that 808 doubled by a growling saw under 3-3-2 syllable riffs, a four-floor second verse, and a power-down breakdown that dives in pitch and turns major for the recharge.",
    tempoBpm: BPM,
    key: "F#m",
    bars: BARS,
    highlightBar: 28,
    trackId: "chops",
    features: [
      "a whole-step key change into the last drop: harmony, bass, riffs and lead all lift",
      "an original vocal book: two verses, a pre-chorus and a chanted chorus",
      "glitch bursts of syllables flying over four octaves at phrase ends",
      "half-time drops on a gliding 808, doubled an octave up by the growl",
      "a power-down breakdown: tape dives, then a major-key turn",
      "glitch-vox solo pitched to the chords, crushing as it climbs",
      "stuttered chorus heads, reversed syllables into every section but the verses",
      "vowel wavetable lead doubled by the looped voice",
      "an octave-up chipmunk double on the last chorus",
    ],
    arrangement: SECTIONS.map((s) => `${s.name} ${s.bars}`),
    mixNotes: [
      "the half-time drops leave room for the 808 and growl under the riff",
      "delay throws open on the last word of every sung line",
      "the chops' formant drops in the drops and rises in the recharge",
      "kick pumps the whole bed on orbit 2",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    kitTracks(s, BOOK, {
      bpm: BPM,
      kick: "syn808",
      levels: { kick: 0.46, saw: 0.23, stabs: 0.26 },
      extra: { snare: { kit: "syn808" } },
    });
    const song = writeSong(s, { book: BOOK, sections: SECTIONS });
    const { at } = song;
    const vox = trackOf(s, "vox");

    // Power on: a battery beep, then the syllables booting up in pitch.
    for (const bar of [0, 2])
      for (const beat of [0, 0.25, 0.5])
        s.note("arp", bar, beat, 93, 0.12, 0.5);
    // The climb hands over to the phrase's glitch burst at beat 2.5.
    stutter(s, song, "s_up", 3, 0, 10, 0.25, 1200, 0.3, 0.7);
    // Chorus pickups.
    for (const name of ["Chorus 1", "Chorus 2", "Last chorus"])
      stutter(s, song, "h_ch1", at(name) + 3, 2.5, 6, 0.25, 0, 0.45, 0.75);
    // Verse answers on the glitch track.
    for (const verse of ["Verse 1", "Verse 2"]) {
      const bar = at(verse);
      glitch(s, song, BOOK, bar + 1, "4..4..5.6..6..4.", ["low", "low", "up"]);
      glitch(s, song, BOOK, bar + 5, "6..5..4.3..3..2.", [
        "charge",
        "up",
        "hey",
      ]);
    }
    // Drops: the "low" chant chopped in 32nds; a tape dive into the turn.
    for (const name of ["Drop 1", "Drop 2", "Last drop"]) {
      const bar = at(name);
      stutter(s, song, "s_low", bar + 3, 3, 8, 0.125, -1200, 0.75, 0.4);
      stutter(s, song, "s_charge", bar + 7, 2, 8, 0.25, 700, 0.4, 0.8);
    }
    // Power down: everything dives, then the voice alone over D, E, F#.
    const down = at("Power down");
    dropout(s, down - 1, 2, 2, ["lead", "vlead"]);
    s.note("lead", down - 1, 2, 78, 2, 0.7, flick.dive(-2400, 0.05));
    s.note("vlead", down - 1, 2, 66, 2, 0.6, flick.dive(-1200, 0.05));
    s.note("vox", down, -0.25, slot(vox, "ch2"), 8.25, 0.72);
    s.note("vlead", down + 2, 0, 66, 7.5, 0.55);
    s.note("vlead", down + 6, 0, 70, 7.5, 0.55, flick.up(-200, 0.1));
    const SOLO = [
      "4.4.4..6.5..5.3.",
      ".4.4..5..6.5..4.",
      "4.46.5.46.5.4.3.",
      "7.6.5.4.6.5.4.3-",
    ];
    for (let i = 3; i < 8; i++)
      glitch(
        s,
        song,
        BOOK,
        down + i,
        SOLO[(i - 3) % 4]!,
        ["low", "fade", "ah", "up", "charge", "hey"],
        0.6,
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
    const out = at("Shutdown");
    s.note("vox", out, -0.25, slot(vox, "ch1"), 8.25, 0.6);
    s.note("pad", out + 4, 0, 54, 8, 0.4, flick.dive(-1200, 0.5));

    // ---------------------------------------------------------- lanes
    patch(s, "vox", {
      delayMixAutomation: throws(song.throwsAt, 0.05, 0.42, 1),
    });
    patch(s, "sweep", { filterAutomation: riserLane(song.builds) });
    patch(s, "chops", {
      fxAutomation: {
        // Down a minor third in the drops, climbing through the recharge.
        "formant-shift": merge(
          steps(
            [0, 0],
            [at("Drop 1"), -3],
            [at("Verse 2"), 0],
            [at("Drop 2"), -3],
            [down, 0],
          ),
          ramps([at("Recharge"), 0], [at("Recharge") + 3.9, 6]),
          steps(
            [at("Last chorus"), 6],
            [at("Last chorus") + 0.002, 0],
            [at("Last drop"), -3],
            [out, 0],
          ),
        ),
        "crush-mix": steps([0, 0.3], [4, 0], [down, 0.3], [down + 8, 0]),
      },
    });
    patch(s, "stut", {
      fxAutomation: {
        "crush-mix": ramps(
          [0, 0],
          [down + 3, 0],
          [down + 7.9, 0.7],
          [down + 8, 0],
        ),
      },
    });
    patch(s, "pad", {
      filterAutomation: ramps(
        [0, 900],
        [at("Pre 1"), 1400],
        [at("Chorus 1") - 0.01, 3800],
        [at("Chorus 1"), 3200],
        [at("Drop 1"), 1600],
        [at("Verse 2"), 1500],
        [at("Chorus 2"), 3600],
        [down, 2600],
        [down + 7.9, 700],
        [at("Recharge"), 900],
        [last - 0.01, 4200],
        [last, 4000],
        [out, 2000],
        [BARS, 500],
      ),
    });
    return s.finish();
  },
};
