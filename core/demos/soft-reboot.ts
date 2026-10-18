/**
 * Soft Reboot: bright four-floor hyperpop in D. It opens with the chorus
 * sung alone over the pad; the verses bounce on a gliding bass line and
 * close each phrase with a glitch burst of syllables; the choruses pump
 * offbeat octaves under a clap on every backbeat; and the drops play one
 * hook on the syllables, the vowel lead and the voice lead together.
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

const BPM = 140;

const BOOK: Book = {
  sample: "soft-reboot-vox",
  root: 69,
  syllables: ["stay", "night", "back", "life", "oh", "yeah"],
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
    ch1: 3,
    ch2: 4,
    ch3: 4.5,
  },
};

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
// Four-note voicings with sevenths and ninths; the stabs take the top three.
const D = c(38, 57, 62, 64, 66);
const G = c(43, 59, 62, 66, 69);
const A = c(45, 57, 61, 64, 71);
const Bm = c(47, 57, 62, 66, 69);
const Em = c(40, 59, 62, 66, 67);
const Fsm = c(42, 57, 61, 64, 69);
const Gm = c(43, 58, 62, 65, 67);
const Bb = c(46, 58, 62, 65, 69);
const VERSE = [Bm, G, D, A];
const CHORUS = [G, A, Bm, D];
const PRE = [Em, Fsm, G, A];
// The breakdown borrows from D minor (G minor, B flat major seven) twice,
// then turns back home under the last chorus line.
const BREAK = [G, Gm, D, Bb, G, Gm, D, Bb, G, A, Bm, D];

// The post-chorus hook, one phrase a bar over G A Bm D.
const HOOK: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [0, 74, 0.5],
    [0.75, 79, 0.5],
    [1.5, 78, 0.4],
    [2, 74, 0.25],
    [2.5, 71, 0.4],
    [3, 74, 0.7],
  ],
  [
    [0, 76, 0.5],
    [0.75, 81, 0.5],
    [1.5, 79, 0.25],
    [2, 78, 0.5],
    [2.75, 76, 0.5],
    [3.5, 73, 0.4],
  ],
  [
    [0, 74, 0.5],
    [0.75, 78, 0.5],
    [1.5, 83, 0.5],
    [2.25, 81, 0.25],
    [2.5, 78, 0.4],
    [3, 76, 0.25],
    [3.25, 74, 0.6],
  ],
  [
    [0, 74, 1.4],
    [2, 78, 0.25],
    [2.25, 81, 0.25],
    [2.5, 86, 1.2],
  ],
];
// The second drop answers itself an octave up on the third bar.
const HOOK_UP = [
  HOOK[0]!,
  HOOK[1]!,
  HOOK[2]!.map(([b, p, l]) => [b, p + 12, l] as const),
  HOOK[3]!,
];
// The last drop states the hook, then answers it: 16th runs up to the top D.
const HOOK_LAST = [
  ...HOOK,
  [
    [0, 86, 0.25],
    [0.25, 83, 0.25],
    [0.5, 81, 0.5],
    [1.25, 78, 0.25],
    [1.5, 79, 0.5],
    [2.25, 81, 0.5],
    [3, 83, 0.9],
  ],
  [
    [0, 85, 0.5],
    [0.75, 81, 0.25],
    [1, 85, 0.25],
    [1.25, 88, 0.6],
    [2, 85, 0.25],
    [2.25, 81, 0.5],
    [3, 76, 0.25],
    [3.25, 78, 0.5],
  ],
  [
    [0, 78, 0.25],
    [0.25, 81, 0.25],
    [0.5, 83, 0.5],
    [1.25, 86, 0.25],
    [1.5, 83, 0.25],
    [1.75, 81, 0.5],
    [2.5, 78, 0.25],
    [2.75, 81, 0.25],
    [3, 83, 0.75],
  ],
  [
    [0, 86, 0.5],
    [0.75, 85, 0.25],
    [1, 81, 0.25],
    [1.25, 78, 0.5],
    [2, 74, 1.8],
  ],
] as const;

// Syllable riffs: syncopated chord tones with octave leaps (ladder rungs).
// The chops play the hook with the lead in the drops and answer the sung
// chorus; the verses get glitch bursts at phrase ends instead.
const RIFF_CHORUS = [
  "4..5..3.6..5.4..",
  ".3.5..6..5.3..4.",
  "4..5..3.6..5.7.6",
  "7.6.5.4.6.5.4.3.",
];
const RIFF_DROP = [
  "4..6..4.7..6.5..",
  ".4.6..7..6.4..5.",
  "4..6..4.7..6.8.7",
  "8.7.6.5.7.6.5.4-",
];
const RIFF_DROP2 = [
  "44.6..4.7.76.5..",
  ".4.6.47..6.4.55.",
  "4..6..4.7..6.877",
  "8-7-6-5-7.6.5.4.",
];
// Stabs: syncopated, never on every 16th; the last bar of four pushes.
const STABS = [
  "8..6..7...6.....",
  ".7.6..7...6..7..",
  "8..6..7...6..7.6",
  "8.....7..6..7.8.",
];
const STABS_DROP = [
  "8..7..8...7..8..",
  ".8.7..8..7..8...",
  "8..7..8...7..8.7",
  "8.7..8..7.8.8.8.",
];
const ARP_VERSE = ["0...2...1...3...", "0...2...1...4..."];
const ARP_8 = ["0.2.4.2.1.3.5.3.", "0.2.4.5.4.2.1.2."];
const BELLS = [
  "4.....3.5...2...",
  "..3.4.....5...3.",
  "4.....3.5...6...",
  "5.4...3...2.....",
];
// Bass lines (`bassLine` steps). Verses bounce an 808 with glides; the
// pre-choruses drive octaves; choruses pump offbeat octaves; drops move.
const LINE_VERSE = ["0.....0.2~0...5~", "0.....0...1~2~0."];
const LINE_VERSE2 = ["0..0....2~0...5~", "0.....0.1...2~1."];
const LINE_PRE = ["0.2.0.2~0.2.0.2.", "0.2.0.2~0.2.1~2."];
const LINE_CHORUS = ["0.2.0.2~0.2.0.2~", "0.2.0.2.0.2~1~2."];
const LINE_DROP = ["0.20.20.2~0.2.1~", "0.20.20.2.01.2~3"];
const LINE_DROP2 = ["0.2~0.20.1.2.3~2", "0.20.2~0.2.5.6~2"];

const SECTIONS: readonly SongSection[] = [
  {
    // No drums: the chorus is sung alone over the pad and the cloud, the
    // syllables bursting between its lines.
    kind: "intro",
    name: "Boot",
    bars: 8,
    chords: CHORUS,
    drums: ["none"],
    play: ["pad", "cloud"],
    bursts: true,
    lines: [null, null, null, null, "ch1", null, "ch2", null],
  },
  {
    kind: "verse",
    name: "Verse 1",
    bars: 8,
    chords: VERSE,
    drums: ["taps", "bounce"],
    energy: 0.85,
    play: ["sub", "arp"],
    bursts: true,
    arp: ARP_VERSE,
    line: [null, null, null, null, ...LINE_VERSE, ...LINE_VERSE],
    lines: ["v1", null, "v2", null, "v3", null, "v4", null],
  },
  {
    kind: "pre",
    name: "Pre 1",
    bars: 4,
    chords: PRE,
    drums: ["none"],
    energy: 0.75,
    play: ["sub", "pad", "arp", "stabs"],
    arp: ARP_8,
    stabs: ["8.......7.......", "8.......7..7...."],
    line: LINE_PRE,
    lines: ["pre1", "pre2", null, null],
  },
  {
    kind: "chorus",
    name: "Chorus 1",
    bars: 8,
    chords: CHORUS,
    drums: ["bounce", "euro"],
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
    drums: ["euro"],
    play: ["sub", "growl", "stabs", "lead", "riff"],
    stabs: STABS_DROP,
    riff: RIFF_DROP,
    lead: HOOK,
    line: LINE_DROP,
  },
  {
    kind: "verse",
    name: "Verse 2",
    bars: 8,
    chords: VERSE,
    drums: ["none", "skip"],
    energy: 0.9,
    play: ["sub", "bells", "arp"],
    bursts: true,
    bells: BELLS,
    arp: ["0.......2.......", "1.......3......."],
    line: LINE_VERSE2,
    lines: ["v5", null, "v6", null, "v7", null, "v8", null],
  },
  {
    kind: "pre",
    name: "Pre 2",
    bars: 4,
    chords: PRE,
    drums: ["euro"],
    energy: 0.8,
    play: ["sub", "pad", "arp", "stabs"],
    arp: ARP_8,
    stabs: ["8..7....8..7....", "8..7..7.8..7..7."],
    line: LINE_PRE,
    lines: ["pre1", "pre2", null, null],
  },
  {
    kind: "chorus",
    name: "Chorus 2",
    bars: 8,
    chords: CHORUS,
    drums: ["euro"],
    energy: 0.88,
    play: ["sub", "pad", "stabs", "riff"],
    stabs: STABS,
    riff: RIFF_DROP,
    line: LINE_CHORUS,
    lines: ["ch1", null, "ch2", null, "ch1", null, "ch3", null],
  },
  {
    kind: "post",
    name: "Drop 2",
    bars: 8,
    chords: CHORUS,
    drums: ["bounce", "euro"],
    play: ["sub", "growl", "stabs", "lead", "riff"],
    stabs: STABS_DROP,
    riff: RIFF_DROP2,
    lead: HOOK_UP,
    voiceLead: true,
    line: LINE_DROP2,
  },
  {
    // Twelve drumless bars: the borrowed chords under the glitch-vox solo,
    // the bass gone until the last four.
    kind: "break",
    name: "Breakdown",
    bars: 12,
    chords: BREAK,
    drums: ["none"],
    play: ["sub", "pad", "cloud", "bells"],
    bells: [
      "4.......3.......",
      "........5.......",
      "4...............",
      "........",
    ],
    line: [
      ...Array.from({ length: 8 }, () => null),
      "0---------------",
      "0---------------",
      "0---------------",
      "0-----------2~1.",
    ],
  },
  {
    kind: "build",
    name: "Reload",
    bars: 4,
    chords: PRE,
    drums: ["taps"],
    energy: 0.8,
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
    drums: ["euro"],
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
    drums: ["euro", "bounce"],
    play: ["sub", "growl", "stabs", "lead", "riff", "arp"],
    stabs: STABS_DROP,
    riff: RIFF_DROP2,
    arp: ARP_8,
    lead: HOOK_LAST,
    voiceLead: true,
    line: LINE_DROP2,
  },
  {
    kind: "outro",
    name: "Shutdown",
    bars: 8,
    chords: CHORUS,
    drums: ["none"],
    play: ["pad", "cloud"],
    bursts: true,
    lines: ["ch1", null, null, null, null, null, null, null],
  },
];
const BARS = SECTIONS.reduce((n, s) => n + s.bars, 0);

export const softReboot: DemoDefinition = {
  info: demoInfo({
    id: "soft-reboot",
    title: "Soft Reboot",
    style: "Hyperpop",
    description:
      "Bright four-floor hyperpop in D at 140: the chorus sung alone over the pad to open, verses on a gliding bass line closed by glitch bursts of syllables, pumping octave-bass choruses, drops where the syllables, a vowel wavetable lead and a looped voice lead play one hook together, and a twelve-bar drumless breakdown.",
    tempoBpm: BPM,
    key: "D",
    bars: BARS,
    highlightBar: 28,
    trackId: "chops",
    features: [
      "an original vocal book: two verses, a pre-chorus and three chorus lines",
      "syllable riffs on a keyed round-robin sampler, a new syllable every hit",
      "glitch bursts: twelve 32nd-note syllables flying over four octaves",
      "a bass line that glides in the verses and pumps octaves in the choruses",
      "seventh and ninth chords, full in the pad and the top three in the stabs",
      "chorus heads stuttered on 16ths and 32nds into each chorus",
      "reversed syllables swelling into every section but the verses",
      "a vowel wavetable lead doubled by the looped voice",
      "pitch-zapped, filter-snapped supersaw stabs on syncopated grids",
      "a drumless breakdown over borrowed G minor and B flat, with a glitch-vox solo",
      "an octave-up chipmunk double on the last chorus",
    ],
    arrangement: SECTIONS.map((s) => `${s.name} ${s.bars}`),
    mixNotes: [
      "the lead vocal ducks the orbit-2 bed by about 2.5 dB while it sings",
      "delay throws open on the last word of every sung line",
      "the chops' formant moves bar by bar in the drops; the glitch track crushes in the breakdown",
      "kick pumps pads, stabs, chops and leads on orbit 2",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    kitTracks(s, BOOK, { bpm: BPM });
    const song = writeSong(s, { book: BOOK, sections: SECTIONS });
    const { at } = song;

    // Boot: the syllables flicker up out of silence through the cloud.
    stutter(s, song, "s_oh", 0, 0, 8, 0.5, 700, 0.3, 0.6);
    // Chorus pickups: "st-st-stay" before each chorus' second ch1.
    for (const name of ["Chorus 1", "Chorus 2", "Last chorus"]) {
      const bar = at(name) + 3;
      stutter(s, song, "h_ch1", bar, 3, 4, 0.25, 0, 0.45, 0.7);
    }
    // Verse answers: after the first and third lines the glitch track
    // answers on the syllables; bursts close the second and fourth.
    for (const verse of ["Verse 1", "Verse 2"]) {
      const bar = at(verse);
      glitch(s, song, BOOK, bar + 1, "........4.4.5.3.", ["back", "stay"]);
      glitch(s, song, BOOK, bar + 5, "......6.5.4.3.5.", [
        "night",
        "oh",
        "yeah",
      ]);
    }
    // Drops: 32nd rolls into the turnaround bars.
    for (const name of ["Drop 1", "Drop 2", "Last drop"]) {
      const bar = at(name);
      stutter(s, song, "s_yeah", bar + 3, 3, 8, 0.125, 1200, 0.4, 0.75);
      stutter(s, song, "s_stay", bar + 7, 2, 8, 0.25, -700, 0.7, 0.4);
    }
    // Breakdown: the looped voice holds the borrowed B flat and F, the
    // glitch-vox solo answers with syllables pitched to the chord and the
    // crush opening, then the last chorus line is sung over the way home.
    const brk = at("Breakdown");
    const SOLO = [
      "3.3.4..5.3..6.5.",
      ".4.3..5..4.3..2.",
      "3.35.4.36.5.4.3.",
      "6.5.4.3.5.4.3.2-",
    ];
    for (let i = 2; i < 6; i++)
      glitch(
        s,
        song,
        BOOK,
        brk + i,
        SOLO[i - 2]!,
        ["stay", "night", "oh", "back", "life", "yeah"],
        0.62,
      );
    for (const [bar, pitch] of [
      [0, 62],
      [1, 58],
      [2, 62],
      [3, 65],
      [6, 62],
      [7, 65],
    ] as const)
      s.note("vlead", brk + bar, 0, pitch, 3.9, 0.52);
    s.note("vox", brk + 10, -0.25, slot(trackOf(s, "vox"), "ch3"), 8.25, 0.7);
    // A silent beat before the last chorus, then the tape-stop at the end.
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
    dropout(s, out - 1, 2, 2, ["lead", "vlead"]);
    s.note("lead", out - 1, 2, 86, 2, 0.7, flick.dive(-2400, 0.1));

    // ---------------------------------------------------------- lanes
    patch(s, "vox", {
      delayMixAutomation: throws(song.throwsAt, 0.05, 0.4, 1),
    });
    patch(s, "sweep", { filterAutomation: riserLane(song.builds) });
    const drops = song.placed.filter((p) => p.kind === "post");
    patch(s, "chops", {
      fxAutomation: {
        "formant-shift": merge(
          [{ tick: 0, value: 0 }],
          ...drops.map((p) =>
            steps(
              ...Array.from(
                { length: p.bars + 1 },
                (_, i) =>
                  [
                    p.start + i,
                    i === p.bars ? 0 : [0, 3, -2, 5][i % 4]!,
                  ] as const,
              ),
            ),
          ),
        ),
        "crush-mix": steps([0, 0], [brk, 0.35], [brk + 8, 0], [out, 0.25]),
      },
    });
    patch(s, "stut", {
      fxAutomation: {
        "crush-mix": ramps(
          [0, 0],
          [brk + 1, 0],
          [brk + 7.9, 0.6],
          [brk + 8, 0],
        ),
      },
    });
    patch(s, "pad", {
      filterAutomation: ramps(
        [0, 700],
        [4, 2000],
        [at("Pre 1"), 1600],
        [at("Chorus 1") - 0.01, 4200],
        [at("Chorus 1"), 3600],
        [at("Verse 2"), 1800],
        [at("Chorus 2"), 3800],
        [brk, 900],
        [brk + 11.9, 3200],
        [at("Last chorus"), 4400],
        [out, 3000],
        [BARS, 600],
      ),
    });
    return s.finish();
  },
};
