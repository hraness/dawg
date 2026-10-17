/**
 * Glass Garden: bright, glassy hyperpop in A major at 128. Tresillo and
 * broken-beat verses, FM bells and a syllable arp that blooms out of the
 * vocal, a borrowed D minor that clouds every fourth bar, and a
 * half-speed bridge where the voice is frozen into a grain pad.
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

const BPM = 128;

const BOOK: Book = {
  sample: "glass-garden-vox",
  root: 69,
  syllables: ["glass", "bloom", "gold", "grow", "ah", "ooh"],
  ends: {
    v1: 3,
    v2: 3,
    v3: 3,
    v4: 3,
    v5: 3,
    v6: 3,
    v7: 3,
    v8: 3,
    pre1: 2,
    pre2: 2.5,
    ch1: 3,
    ch2: 2.5,
    ch3: 4,
  },
};

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
const A = c(45, 61, 64, 69);
const E = c(40, 59, 64, 68);
const Fsm = c(42, 61, 66, 69);
const D = c(38, 62, 66, 69);
const Dm = c(38, 62, 65, 69);
const Bm = c(47, 62, 66, 71);
const Csm = c(37, 61, 64, 68);
const F = c(41, 60, 65, 69);
const VERSE = [A, E, Fsm, Dm];
const CHORUS = [D, E, Csm, Fsm];
const PRE = [Bm, Csm, D, E];
const BRIDGE = [F, Dm, A, E];

const HOOK: readonly (readonly (readonly [number, number, number])[])[] = [
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
const ANSWER: readonly (readonly (readonly [number, number, number])[])[] = [
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
// Verse 2 answers on new rhythms, falling where the first verse climbed.
const RIFF_VERSE2 = [
  "............4.6.",
  "3..5..4.6...5...",
  "............5.3.",
  "4.5.6...7.6.5.4.",
];
const RIFF_VERSE = [
  "............3.4.",
  "5.....4.3.......",
  "............4.5.",
  "6...5...4.3.2...",
];
const RIFF_CHORUS = [
  "3.4.5.3.4.5.6.4.",
  "5.6.7.5.6.7.8.6.",
  "3.4.5.3.4.5.6.4.",
  "8.7.6.5.7.6.5.4.",
];
const RIFF_POST = [
  "34567.5.4.3.4.5.",
  "56789.7.6.5.6.7.",
  "34567.5.4.3.4.5.",
  "9.8.7.6.8.7.6.5-",
];
const RIFF_POST2 = [
  "3.53.64.5.75.86.",
  "4.64.75.6.86.97.",
  "3.53.64.5.75.86.",
  "9876876576546543",
];
const STABS = [
  "8.....7...8..7..",
  "..8..7..8.....7.",
  "8.....7...8..7..",
  "8..7..8..7..8.7.",
];
const STABS_POST = [
  "8.7.8..7.8.7..8.",
  ".8.7.8..7.8.8.7.",
  "8.7.8..7.8.7..8.",
  "8.8.7.7.8.8.7.78",
];
const BELLS = [
  "7...6...5.......",
  "8.....6.....5...",
  "7...6...5.......",
  "8...7...6...5...",
];
const BELLS_VERSE = [
  "5.......4.......",
  "........6...5...",
  "5.......4.......",
  "4...3...2...1...",
];
const ARP_16 = ["0246024602460246", "6420642064206420"];
const ARP_SKIP = ["0.24.6.0.24.6.4.", "6.42.0.6.42.0.2."];

const SECTIONS: readonly SongSection[] = [
  {
    kind: "intro",
    name: "Seed",
    bars: 4,
    chords: VERSE,
    drums: ["taps"],
    energy: 0.75,
    play: ["cloud", "bells"],
    bells: BELLS_VERSE,
  },
  {
    kind: "verse",
    name: "Verse 1",
    bars: 8,
    chords: VERSE,
    drums: ["broken", "tresillo"],
    energy: 0.85,
    play: ["sub", "bells", "riff", "pad"],
    bells: BELLS_VERSE,
    riff: RIFF_VERSE,
    bass: ["9.....7.....7...", "9.....7...7....."],
    lines: ["v1", null, "v2", null, "v3", null, "v4", null],
  },
  {
    kind: "pre",
    name: "Pre 1",
    bars: 4,
    chords: PRE,
    drums: ["skip"],
    energy: 0.85,
    play: ["sub", "pad", "arp", "riff", "stabs"],
    arp: ARP_SKIP,
    stabs: ["8.......8.......", "8.....8.....8..."],
    riff: RIFF_VERSE,
    bass: ["9.......7......."],
    lines: ["pre1", "pre2", null, null],
  },
  {
    kind: "chorus",
    name: "Chorus 1",
    bars: 8,
    chords: CHORUS,
    drums: ["house", "tresillo"],
    play: ["sub", "pad", "stabs", "arp", "riff", "cloud"],
    stabs: STABS,
    arp: ARP_SKIP,
    riff: RIFF_CHORUS,
    bass: ["9..7..7...7..7..", "9..7..7...7....."],
    lines: ["ch1", null, "ch2", null, "ch1", null, "ch3", null],
  },
  {
    kind: "post",
    name: "Bloom 1",
    bars: 4,
    chords: CHORUS,
    drums: ["four"],
    play: ["sub", "stabs", "arp", "riff", "lead", "cloud"],
    stabs: STABS_POST,
    arp: ARP_16,
    riff: RIFF_POST,
    lead: HOOK,
    bass: ["9..7..7...7..7..", "9..7..7.7..7..7."],
  },
  {
    kind: "verse",
    name: "Verse 2",
    bars: 8,
    chords: VERSE,
    drums: ["tresillo", "skip"],
    energy: 0.9,
    play: ["sub", "arp", "riff", "pad", "bells"],
    arp: ARP_SKIP,
    bells: BELLS_VERSE,
    riff: RIFF_VERSE2,
    bass: ["9..7..7...7.....", "9..7..7...7..7.."],
    lines: ["v5", null, "v6", null, "v7", null, "v8", null],
  },
  {
    kind: "pre",
    name: "Pre 2",
    bars: 4,
    chords: PRE,
    drums: ["skip"],
    energy: 0.9,
    play: ["sub", "pad", "arp", "riff", "stabs"],
    arp: ARP_SKIP,
    stabs: STABS,
    riff: RIFF_CHORUS,
    bass: ["9.......7......."],
    lines: ["pre1", "pre2", null, null],
  },
  {
    kind: "chorus",
    name: "Chorus 2",
    bars: 8,
    chords: CHORUS,
    drums: ["house", "four"],
    play: ["sub", "pad", "stabs", "arp", "riff", "cloud", "double"],
    stabs: STABS,
    arp: ARP_SKIP,
    riff: RIFF_POST,
    bass: ["9..7..7...7..7..", "9..7..7...7....."],
    lines: ["ch1", null, "ch2", null, "ch1", null, "ch3", null],
  },
  {
    kind: "post",
    name: "Bloom 2",
    bars: 8,
    chords: CHORUS,
    drums: ["tresillo", "four"],
    play: ["sub", "stabs", "arp", "riff", "lead", "cloud", "growl"],
    stabs: STABS_POST,
    arp: ARP_SKIP,
    riff: RIFF_POST2,
    lead: [...HOOK, ...ANSWER],
    voiceLead: true,
    growl: ["2..2..2...2..2..", "2..2..3...3..2.."],
    bass: ["9...............", "9.......9......."],
  },
  {
    kind: "break",
    name: "Greenhouse",
    bars: 8,
    chords: BRIDGE,
    drums: ["none", "half"],
    energy: 0.7,
    play: ["pad", "cloud", "bells"],
    bells: BELLS_VERSE,
  },
  {
    kind: "build",
    name: "Sunlight",
    bars: 4,
    chords: PRE,
    drums: ["broken"],
    energy: 0.9,
    play: ["sub", "pad", "arp", "riff", "stabs"],
    arp: ARP_SKIP,
    riff: RIFF_CHORUS,
    stabs: ["8...8...8...8...", "8.8.8.8.8.8.8.8."],
    bass: ["9...9...9...9..."],
  },
  {
    kind: "chorus",
    name: "Last chorus",
    bars: 8,
    chords: CHORUS,
    drums: ["house", "tresillo"],
    play: ["sub", "pad", "stabs", "arp", "riff", "bells", "cloud", "double"],
    stabs: STABS_POST,
    arp: ARP_SKIP,
    bells: BELLS,
    riff: RIFF_POST2,
    bass: ["9..7..7...7..7..", "9..7..7.7..7..7."],
    lines: ["ch1", null, "ch2", null, "ch1", null, "ch3", null],
  },
  {
    kind: "post",
    name: "Last bloom",
    bars: 4,
    chords: CHORUS,
    drums: ["four"],
    play: ["sub", "stabs", "arp", "riff", "lead", "cloud", "bells"],
    stabs: STABS_POST,
    arp: ARP_16,
    bells: BELLS,
    riff: RIFF_POST2,
    lead: ANSWER,
    voiceLead: true,
    bass: ["9..7..7...7..7..", "9..7..7.7..7..7."],
  },
  {
    kind: "outro",
    name: "Glass",
    bars: 4,
    chords: [D, A, Dm, A],
    drums: ["none"],
    play: ["pad", "cloud", "bells"],
    bells: ["7...6...5.......", null, "5...4...3.......", null],
  },
];
const BARS = SECTIONS.reduce((n, s) => n + s.bars, 0);

export const glassGarden: DemoDefinition = {
  info: demoInfo({
    id: "glass-garden",
    title: "Glass Garden",
    style: "Hyperpop",
    description:
      "Bright, glassy hyperpop in A major at 128: tresillo and broken-beat verses, FM bells and a syllable arp that blooms out of each sung line, a borrowed D minor clouding every fourth bar, and a greenhouse bridge where the voice freezes into a grain pad under a glitching vocal solo.",
    tempoBpm: BPM,
    key: "A",
    bars: BARS,
    highlightBar: 48,
    trackId: "chops",
    features: [
      "an original vocal book: two verses, a pre-chorus and a soaring chorus",
      "syllable arps that bloom up through the chord after every line",
      "a borrowed D minor in the verse and an F-major bridge",
      "tresillo, broken and two-step beats changing by phrase",
      "a greenhouse bridge: frozen grain voice, glitching solo",
      "stuttered chorus heads and reversed syllables into every section but the verses",
      "vowel wavetable lead doubled by the looped voice",
      "an octave-up chipmunk double on the second and last chorus",
    ],
    arrangement: SECTIONS.map((s) => `${s.name} ${s.bars}`),
    mixNotes: [
      "bells ring above the arp so the syllables fill the middle",
      "delay throws open on the last word of every sung line",
      "the chops' formant rises in the blooms and falls in the bridge",
      "kick pumps the whole bed on orbit 2",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    kitTracks(s, BOOK, {
      bpm: BPM,
      levels: { bells: 0.2, saw: 0.16, arp: 0.18, chops: 0.8, vgrain: 0.32 },
    });
    const song = writeSong(s, { book: BOOK, sections: SECTIONS });
    const { at } = song;
    const vox = trackOf(s, "vox");

    // Seed: the voice grows out of a held vowel, syllables sprouting.
    s.note("vlead", 0, 0, 69, 7.5, 0.5, flick.up(-1200, 0.4));
    stutter(s, song, "s_glass", 2, 0, 8, 0.5, 700, 0.3, 0.6);
    glitch(
      s,
      song,
      BOOK,
      3,
      "0.1.2.3.4.5.6789",
      ["glass", "bloom", "gold", "grow"],
      0.55,
    );
    // Verse answers.
    for (const verse of ["Verse 1", "Verse 2"]) {
      const bar = at(verse);
      glitch(s, song, BOOK, bar + 3, "..3.4.5...4.3...", [
        "bloom",
        "grow",
        "ah",
      ]);
      glitch(s, song, BOOK, bar + 7, "5.4.3.5.4.3.2-1-", [
        "glass",
        "gold",
        "ooh",
      ]);
    }
    // Blooms: a rising "ah" scatter on the turn of each phrase.
    for (const name of ["Bloom 1", "Bloom 2", "Last bloom"]) {
      const bar = at(name);
      const bars = song.sectionAt(bar).bars;
      stutter(
        s,
        song,
        "s_ah",
        bar + (bars === 4 ? 1 : 3),
        2,
        8,
        0.25,
        1200,
        0.45,
        0.8,
      );
      glitch(
        s,
        song,
        BOOK,
        bar + bars - 1,
        "9876543298765432",
        ["gold", "glass"],
        0.55,
      );
    }
    // Greenhouse: the voice alone, frozen and glitching over F, Dm, A, E.
    const gh = at("Greenhouse");
    // "let it bloom and grow" lands on the A bars; the voice holds F, then A.
    for (const bar of [gh + 2, gh + 6])
      s.note("vox", bar, -0.25, slot(vox, "pre2"), 4.25, 0.7);
    s.note("vlead", gh, 0, 65, 7.5, 0.5);
    s.note("vlead", gh + 4, 0, 69, 7.5, 0.5);
    const SOLO = [
      "2.4.5.4.2..4.5..",
      "3.5.6.5.3..5.6..",
      "4.5.6.7.6.5.4.5.",
      "6.7.8.9.8.7.6.5-",
    ];
    for (let i = 4; i < 8; i++)
      glitch(
        s,
        song,
        BOOK,
        gh + i,
        SOLO[i - 4]!,
        ["glass", "bloom", "ooh", "gold", "grow", "ah"],
        0.6,
      );
    s.note("lead", gh + 7, 2, 81, 2, 0.6, flick.wobble(150, 8));
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
    s.note("vox", out, -0.25, slot(vox, "ch3"), 8.25, 0.6);
    s.note("bells", out + 3, 0, 93, 4, 0.4, flick.dive(-1200, 0.6));

    // ---------------------------------------------------------- lanes
    patch(s, "vox", {
      delayMixAutomation: throws(song.throwsAt, 0.06, 0.38, 1),
    });
    patch(s, "sweep", { filterAutomation: riserLane(song.builds) });
    patch(s, "chops", {
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
        "crush-mix": steps([0, 0], [gh, 0.2], [gh + 8, 0]),
      },
    });
    patch(s, "stut", {
      fxAutomation: {
        "crush-mix": ramps([0, 0], [gh + 4, 0], [gh + 7.9, 0.55], [gh + 8, 0]),
      },
    });
    patch(s, "pad", {
      filterAutomation: ramps(
        [0, 1200],
        [at("Pre 1"), 1800],
        [at("Chorus 1") - 0.01, 4200],
        [at("Chorus 1"), 3800],
        [at("Verse 2"), 1800],
        [at("Chorus 2"), 4200],
        [gh, 1400],
        [gh + 7.9, 2800],
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
