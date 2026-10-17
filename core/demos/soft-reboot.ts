/**
 * Soft Reboot: bright four-floor hyperpop in D. The voice is the lead
 * instrument: sung verses answered by chopped syllable riffs, a chorus that
 * stutters into itself, and post-chorus drops where the syllables, the
 * vowel lead and the voice lead play one hook together.
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
    v5: 3,
    v6: 3,
    v7: 3,
    v8: 3,
    pre1: 2,
    pre2: 2,
    ch1: 3,
    ch2: 4,
    ch3: 4.5,
  },
};

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
const D = c(38, 57, 62, 66);
const G = c(43, 59, 62, 67);
const A = c(45, 57, 61, 64);
const Bm = c(47, 59, 62, 66);
const Em = c(40, 59, 64, 67);
const Gm = c(43, 58, 62, 67);
const VERSE = [Bm, G, D, A];
const CHORUS = [G, A, Bm, D];
const PRE = [G, A, Em, A];
const BREAK = [G, Gm, D, A];

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
const RIFF_VERSE = [
  "..........4.5.3.",
  "3..5..4.........",
  "..........5.4.6.",
  "6..5..3...3.4..5",
];
// Verse 2 answers on new rhythms, falling where the first verse climbed.
const RIFF_VERSE2 = [
  "............5.6.",
  "3..4..6.5..3.4..",
  "............6.4.",
  "2..3..5.4.3...6-",
];
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
const STABS = [
  "8..6..7...6..7.6",
  ".7.6..7..6.7..6.",
  "8..6..7..6..7.86",
  "8.6.7..6.7..6.7.",
];
const STABS_DROP = [
  "8..7..8.7..7.8.7",
  ".8.7.78..7.8..7.",
  "8..7..8.7..7.877",
  "8.7.8.7.8.78.8.8",
];
const ARP_VERSE = ["0...2...1...3...", "0...2...1...4..."];
const ARP_8 = ["0.2.4.2.1.3.5.3.", "0.2.4.5.4.2.1.2."];
const ARP_16 = ["0242024213531353", "0242135324244242"];
// Under a sung chorus the arp skips, leaving the 16ths to the riff.
const ARP_SKIP = ["0.24.2.1.35.3.1.", "0.24.2.13.5.4.2."];
const BELLS = [
  "4.....3.5...2...",
  "..3.4.....5...3.",
  "4.....3.5...6...",
  "5.4...3...2.....",
];
const GROWL = ["2..2..1.2..2.3..", "2..2..1.2..3.2-1"];

const SECTIONS: readonly SongSection[] = [
  {
    kind: "intro",
    name: "Boot",
    bars: 4,
    chords: CHORUS,
    drums: ["none"],
    play: ["pad", "cloud", "riff"],
    riff: RIFF_CHORUS,
  },
  {
    kind: "verse",
    name: "Verse 1",
    bars: 8,
    chords: VERSE,
    drums: ["broken", "half"],
    energy: 0.85,
    play: ["sub", "arp", "riff", "cloud"],
    arp: ARP_VERSE,
    riff: RIFF_VERSE,
    bass: ["9.......7.......", "9.........7....."],
    lines: ["v1", null, "v2", null, "v3", null, "v4", null],
  },
  {
    kind: "pre",
    name: "Pre 1",
    bars: 4,
    chords: PRE,
    drums: ["four"],
    energy: 0.8,
    play: ["sub", "pad", "arp", "riff", "stabs"],
    arp: ARP_8,
    riff: RIFF_VERSE,
    stabs: ["8.......7.......", "8.......7..7...."],
    bass: ["9...9...9...9..."],
    lines: ["pre1", "pre2", null, null],
  },
  {
    kind: "chorus",
    name: "Chorus 1",
    bars: 8,
    chords: CHORUS,
    drums: ["four", "house"],
    play: ["sub", "pad", "stabs", "arp", "riff", "cloud"],
    stabs: STABS,
    arp: ARP_SKIP,
    riff: RIFF_CHORUS,
    bass: ["9.....7.....7...", "9.....7...7.7..."],
    lines: ["ch1", null, "ch2", null, "ch1", null, "ch3", null],
  },
  {
    kind: "post",
    name: "Drop 1",
    bars: 8,
    chords: CHORUS,
    drums: ["four"],
    play: ["sub", "stabs", "lead", "riff", "cloud", "arp"],
    stabs: STABS_DROP,
    riff: RIFF_DROP,
    arp: ["....0...........", "........0......."],
    lead: HOOK,
    voiceLead: true,
    bass: ["9..7..7...7..7..", "9..7..7...7..77."],
  },
  {
    kind: "verse",
    name: "Verse 2",
    bars: 8,
    chords: VERSE,
    drums: ["skip", "trap"],
    energy: 0.9,
    play: ["sub", "bells", "riff", "cloud", "arp"],
    bells: BELLS,
    riff: RIFF_VERSE2,
    arp: ["0.......2.......", "1.......3......."],
    bass: ["9.....7...7.....", "9.........7..7.."],
    lines: ["v5", null, "v6", null, "v7", null, "v8", null],
  },
  {
    kind: "pre",
    name: "Pre 2",
    bars: 4,
    chords: PRE,
    drums: ["four"],
    energy: 0.85,
    play: ["sub", "pad", "arp", "riff", "stabs"],
    arp: ARP_8,
    riff: RIFF_CHORUS,
    stabs: ["8..7....8..7....", "8..7..7.8..7..7."],
    bass: ["9...9...9...9..."],
    lines: ["pre1", "pre2", null, null],
  },
  {
    kind: "chorus",
    name: "Chorus 2",
    bars: 8,
    chords: CHORUS,
    drums: ["house", "four"],
    play: ["sub", "pad", "stabs", "arp", "riff", "cloud"],
    stabs: STABS,
    arp: ARP_SKIP,
    riff: RIFF_DROP,
    bass: ["9.....7.....7...", "9.....7...7.7..."],
    lines: ["ch1", null, "ch2", null, "ch1", null, "ch3", null],
  },
  {
    kind: "post",
    name: "Drop 2",
    bars: 8,
    chords: CHORUS,
    drums: ["tresillo", "four"],
    play: ["sub", "growl", "stabs", "lead", "riff", "cloud"],
    stabs: STABS,
    riff: RIFF_DROP2,
    growl: GROWL,
    lead: HOOK_UP,
    voiceLead: true,
    bass: ["9...............", "9.......9......."],
  },
  {
    kind: "break",
    name: "Breakdown",
    bars: 8,
    chords: BREAK,
    drums: ["none"],
    play: ["pad", "cloud", "bells"],
    bells: [
      "4.......3.......",
      "........5.......",
      "4...............",
      "........",
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
    bass: ["9...9...9...9..."],
  },
  {
    kind: "chorus",
    name: "Last chorus",
    bars: 8,
    chords: CHORUS,
    drums: ["four", "house"],
    play: ["sub", "pad", "stabs", "arp", "riff", "cloud", "double", "bells"],
    stabs: STABS_DROP,
    arp: ARP_SKIP,
    bells: BELLS,
    riff: RIFF_DROP2,
    bass: ["9.....7.....7...", "9.....7...7.7..."],
    lines: ["ch1", null, "ch2", null, "ch1", null, "ch3", null],
  },
  {
    kind: "post",
    name: "Last drop",
    bars: 8,
    chords: CHORUS,
    drums: ["four", "tresillo"],
    play: ["sub", "growl", "stabs", "lead", "riff", "cloud", "arp"],
    stabs: STABS_DROP,
    riff: RIFF_DROP2,
    arp: ARP_8,
    growl: GROWL,
    lead: HOOK_LAST,
    voiceLead: true,
    bass: ["9...............", "9.......9......."],
  },
  {
    kind: "outro",
    name: "Shutdown",
    bars: 8,
    chords: CHORUS,
    drums: ["none"],
    play: ["pad", "cloud", "riff"],
    riff: [
      RIFF_CHORUS[0]!,
      null,
      RIFF_CHORUS[1]!,
      null,
      "4...............",
      null,
      null,
      null,
    ],
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
      "Bright four-floor hyperpop in D at 140: two sung verses answered by chopped-syllable riffs, a chorus that stutters into itself, and drops where the vocal syllables, a vowel wavetable lead and a looped voice lead play one hook together.",
    tempoBpm: BPM,
    key: "D",
    bars: BARS,
    highlightBar: 24,
    trackId: "chops",
    features: [
      "an original vocal book: two verses, a pre-chorus and three chorus lines",
      "syllable riffs on a keyed round-robin sampler, a new syllable every hit",
      "chorus heads stuttered on 16ths and 32nds into each chorus",
      "reversed syllables swelling into every section but the verses",
      "a vowel wavetable lead doubled by the looped voice",
      "pitch-zapped, filter-snapped supersaw stabs on syncopated grids",
      "a glitch-vox solo over a borrowed G minor in the breakdown",
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
    // Verse answers: the glitch track trades a bar with the riff.
    for (const verse of ["Verse 1", "Verse 2"]) {
      const bar = at(verse);
      glitch(s, song, BOOK, bar + 3, "4.4.5.3.6...5.4.", ["back", "stay"]);
      glitch(s, song, BOOK, bar + 7, "6.5.4.3.2.3.4.5.", [
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
    // Breakdown over G, Gm, D, A: the looped voice holds the borrowed B flat,
    // the glitch-vox solo answers with syllables pitched to the chord and
    // the crush opening, then the last chorus line is sung alone.
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
      [3, 61],
      [6, 62],
      [7, 61],
    ] as const)
      s.note("vlead", brk + bar, 0, pitch, 3.9, 0.52);
    s.note("vox", brk + 6, -0.25, slot(trackOf(s, "vox"), "ch3"), 8.25, 0.7);
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
        [brk + 7.9, 3200],
        [at("Last chorus"), 4400],
        [out, 3000],
        [BARS, 600],
      ),
    });
    return s.finish();
  },
};
