/**
 * Gold song 2: a snow day, the TV on, waiting for a call. G dorian at 150
 * with its raised sixth up front, a chipmunk singer on pickups, a cold open
 * on the drop, and a bridge that turns into a two-voice canon: the singer
 * states the line and a glockenspiel answers it a bar later, a fourth down.
 */
import type { Chart } from "../format.ts";

const HOOK = [
  {
    bar: 0,
    rhythm:
      "x.xx.xx.x.xx.x.. x.x.x.x.x---.... x.xx.xx.x.xx.x.. x.x.x.x.x-------",
    notes:
      "1' 1' 6 1' 1' 2' 3' 2' 1' 3' 2' 1' 6 5~ 1' 1' 6 1' 1' 2' 3' 4' 3' 2' 1' 6 5 6~",
  },
] as const;
const HOOK8 = [...HOOK, { ...HOOK[0], bar: 4 }];

const CHORUS = [
  {
    bar: 0,
    rhythm: "..x.x.xx.x.x.x-- ----............",
    notes: "5 5 6 5 4 2 3~",
    words: "snow day sta- tic in my head",
  },
  {
    bar: 2,
    rhythm: "..x.x.xx.x.x.x-- ----............",
    notes: "1' 1' 7 1' 2' 7 1'~",
    words: "ev- ery chan- nel gone to white",
  },
  {
    bar: 4,
    rhythm: "..x.x.xx.x.x.x-- ----............",
    notes: "5 5 6 5 4 2 3~",
    words: "snow day sta- tic in my head",
  },
  {
    bar: 6,
    rhythm: "..x.x.xx.x.x.x-- ----............",
    notes: "1' 2' 3' 2' 1' 7 1'~",
    words: "hold me till the screen goes black",
  },
] as const;

const PRE = [
  {
    bar: 0,
    rhythm: "x.x.x.x.x.x.x.x.",
    notes: "7 2' 7 2' 1' 3' 1' 3'",
    words: "pick up pick up pick up pick up",
  },
  {
    bar: 1,
    rhythm: "x---x---x.x.x---",
    notes: "4' 3' 1' 7 1'~",
    words: "please pick up the phone",
  },
  {
    bar: 2,
    rhythm: "x.x.x.x.x.x.x.x. x-x-x-x-x-------",
    notes: "5 6 1' 6 5 6 2' 1' 2' 3' 4' 3' 2'~",
    words: "it's a snow day it's a snow day are you home at all",
  },
] as const;

const VERSE_TUNE = [
  { bar: 0, rhythm: "x.x.x.x.x.x.x...", notes: "1 1 3 1 5 4 3" },
  { bar: 2, rhythm: "..x.x.x.x.x.x.x.", notes: "3 3 4 5 4 3 1" },
  { bar: 4, rhythm: "x.x.x.x.x.x.x...", notes: "5 5 6 5 3 4 5" },
  {
    bar: 6,
    rhythm: "..x.x.x.x.x.x.x- ----............",
    notes: "4 3 4 3 2 1 2~",
  },
] as const;
const verse = (words: readonly string[]) =>
  VERSE_TUNE.map((line, i) => ({ ...line, words: words[i]! }));

export const SNOW_DAY_STATIC: Chart = {
  title: "Snow Day Static",
  key: "G",
  mode: "dorian",
  bpm: 150,
  sounds: {
    pad: "pwm",
    stab: "pump",
    arp: "kalimba",
    arp2: "fmbells",
    lead: "square",
    counter: "glock",
    bass: "reese",
    singer: "chipmunk",
    kit: { kick: "trap", snare: "electro", hats: "trap" },
    design: { brightness: 0.6, grit: 0.55, space: 0.45, width: 0.6, echo: 0.6 },
  },
  notes: [
    "a cold open on the drop, filtered to taps, before the first verse",
    "the bridge is a canon: the glockenspiel answers the singer a bar later, a fourth down",
    "the last drop hands its hook to the chops while the lead climbs",
  ],
  sections: [
    {
      kind: "intro",
      name: "Cold Open",
      bars: 4,
      chords: "i III VII IV",
      drums: "taps",
      play: ["pad", "lead", "spark"],
      hook: HOOK,
      moves: [{ move: "riser" }],
    },
    {
      kind: "drop",
      name: "Drop",
      bars: 8,
      chords: "i III VII IV",
      drums: "footwork",
      play: ["sub", "lead", "stabs", "arp"],
      hook: HOOK8,
      moves: [
        {
          move: "stutter",
          bar: 3,
          beat: 3,
          count: 4,
          step: 0.25,
          notes: "5 6 1' 2'",
          word: "snow",
        },
        { move: "tapeStop", beats: 1 },
      ],
    },
    {
      kind: "verse",
      name: "Verse",
      bars: 8,
      chords: "i v III IV",
      drums: "half",
      play: ["keys", "sub", "lead"],
      sing: verse([
        "school is out the roads are gone",
        "mom's a- sleep the T V's on",
        "gray light lea- king down the hall",
        "wait- ing for your name to call",
      ]),
      moves: [{ move: "dropout", bar: 3, beat: 2, beats: 2 }],
    },
    {
      kind: "pre",
      name: "Pre",
      bars: 4,
      chords: "VII III IV IV",
      drums: "glitch",
      energy: 0.68,
      play: ["pad", "sub", "arp", "vocoder"],
      sing: PRE,
      moves: [{ move: "riser" }, { move: "crush" }],
    },
    {
      kind: "chorus",
      name: "Chorus",
      bars: 8,
      chords: "i III VII IV",
      drums: "trap",
      play: ["pad", "sub", "stabs", "harmony", "arp", "chops"],
      sing: CHORUS,
    },
    {
      kind: "drop",
      name: "Drop 2",
      bars: 8,
      chords: "i III VII IV",
      drums: "footwork",
      play: ["sub", "lead", "stabs", "arp", "arp2", "chops"],
      hook: HOOK8,
      moves: [
        {
          move: "stutter",
          bar: 3,
          beat: 2,
          count: 8,
          step: 0.25,
          notes: "5 5 6 6 1' 1' 2' 2'",
          word: "snow",
        },
        {
          move: "stutter",
          bar: 7,
          beat: 2,
          count: 6,
          step: 1 / 3,
          notes: "3' 2' 1' 6 5 3",
          word: "day",
        },
      ],
    },
    {
      kind: "verse",
      name: "Verse 2",
      bars: 8,
      chords: "i v III IV",
      drums: "half",
      play: ["keys", "sub", "lead", "counter"],
      sing: verse([
        "brea- king i- ci- cles for fun",
        "foot- prints where the plow won't run",
        "news says it's not stop- ping soon",
        "and I'm stuck here wait- ing too",
      ]),
      moves: [{ move: "dropout", bar: 7, beat: 0, beats: 4 }],
    },
    {
      kind: "pre",
      name: "Pre 2",
      bars: 4,
      chords: "VII III IV IV",
      drums: "glitch",
      energy: 0.72,
      play: ["pad", "sub", "arp", "vocoder", "harmony"],
      sing: PRE,
      moves: [{ move: "riser" }, { move: "formant" }],
    },
    {
      kind: "chorus",
      name: "Chorus 2",
      bars: 8,
      chords: "i III VII IV",
      drums: "trap",
      play: ["pad", "sub", "stabs", "harmony", "arp", "chops", "double"],
      sing: CHORUS,
      moves: [{ move: "tapeStop", beats: 2 }],
    },
    {
      kind: "bridge",
      name: "Canon",
      bars: 8,
      chords: "IV v III VII",
      drums: "none",
      play: ["keys", "counter", "cloud"],
      sing: [
        {
          bar: 0,
          rhythm: "x-x-x-x-x---x---",
          notes: "5 6 1' 2' 1' 6",
          words: "if it melts let it melt",
        },
        {
          bar: 2,
          rhythm: "x-x-x-x-x---x---",
          notes: "3' 2' 1' 2' 3' 4'",
          words: "I was cold a- ny- way",
        },
        {
          bar: 4,
          rhythm: "x-x-x-x-x---x---",
          notes: "5 6 1' 2' 1' 6",
          words: "if it melts let it melt",
        },
        {
          bar: 6,
          rhythm: "x-x-x-x-x------- ----------------",
          notes: "3' 2' 1' 7 1'~",
          words: "you were far a- way",
        },
      ],
      counter: [
        { bar: 1, rhythm: "x-x-x-x-x---x---", notes: "2 3 5 6 5 3" },
        { bar: 3, rhythm: "x-x-x-x-x---x---", notes: "7 6 5 6 7 1'" },
        { bar: 5, rhythm: "x-x-x-x-x---x---", notes: "2 3 5 6 5 3" },
        { bar: 7, rhythm: "x-x-x-x-x-------", notes: "7 6 5 4 5~" },
      ],
      moves: [{ move: "riser" }],
    },
    {
      kind: "chorus",
      name: "Last Chorus",
      bars: 8,
      chords: "i III VII IV",
      drums: "trap",
      play: [
        "pad",
        "sub",
        "stabs",
        "harmony",
        "arp",
        "arp2",
        "chops",
        "double",
        "vocoder",
      ],
      sing: CHORUS,
      moves: [{ move: "silence" }],
    },
    {
      kind: "drop",
      name: "Last Drop",
      bars: 8,
      chords: "i III VII IV",
      drums: "footwork",
      drums2: "gabber",
      play: ["sub", "lead", "stabs", "arp", "arp2", "chops", "counter"],
      hook: HOOK8,
      moves: [
        {
          move: "stutter",
          bar: 3,
          beat: 2,
          count: 8,
          step: 0.25,
          notes: "1' 1' 2' 2' 3' 3' 5' 5'",
          word: "snow",
        },
        { move: "drift", layer: "stabs" },
        { move: "landing" },
      ],
    },
    {
      kind: "outro",
      name: "Outro",
      bars: 4,
      chords: "i III VII i",
      drums: "taps",
      play: ["keys", "lead"],
      hook: HOOK,
      moves: [{ move: "tapeStop", beats: 4 }],
    },
  ],
};
