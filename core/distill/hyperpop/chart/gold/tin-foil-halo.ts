/**
 * Gold song 3: a crown folded out of kitchen foil and worn on the night bus.
 * A flat at 136 in mixolydian, so the flat seventh carries the hook; a
 * breathy alto low in the mix of brass and marimba, a two-step verse, a
 * bounce chorus and a dembow drop, and a half-time bridge where a whistle
 * answers the singer.
 */
import type { Chart } from "../format.ts";

/** The hook leans on the flat seventh, then settles on the sixth. */
const HOOK = [
  {
    bar: 0,
    rhythm: "x..x..x.x.x.x--- x..x..x.x-------",
    notes: "1' 7 5 7 1' 3' 2' 1' 7 4~",
  },
  {
    bar: 2,
    rhythm: "x..x..x.x.x.x--- x..x..x.x.x.x---",
    notes: "1' 7 6 4 6 1' 1' 6 5 3 5 6~",
  },
] as const;
const HOOK8 = [...HOOK, ...HOOK.map((l) => ({ ...l, bar: l.bar + 4 }))];
/** The last drop: the final answer climbs to the tonic up high. */
const HOOK8_HIGH = [
  ...HOOK8.slice(0, 3),
  {
    bar: 6,
    rhythm: "x..x..x.x.x.x--- x..x..x.x.x.x---",
    notes: "1' 7 6 4 6 1' 1' 3' 5' 3' 6' 1''~",
  },
];

const CHORUS = [
  {
    bar: 0,
    rhythm: "x.x.x.x-x.x.x.x. x-----------....",
    notes: "5 5 6 5 3 5 6 7 1'~",
    words: "tin foil ha- lo catch- ing all the light",
  },
  {
    bar: 2,
    rhythm: "x.x.x.x-x.x.x--- ----------......",
    notes: "1' 1' 7 6 5 4 6~",
    words: "you can hear me from the street",
  },
  {
    bar: 4,
    rhythm: "x.x.x.x-x.x.x.x. x-----------....",
    notes: "5 5 6 5 3 5 6 7 2'~",
    words: "tin foil ha- lo when the bus goes by",
  },
  {
    bar: 6,
    rhythm: "x.x.x.x-x.x.x--- ----------......",
    notes: "1' 2' 3' 2' 1' 7 1'~",
    words: "I'm the bright- est thing in town",
  },
] as const;
const LAST_CHORUS = [
  ...CHORUS.slice(0, 3),
  {
    bar: 6,
    rhythm: "x.x.x.x-x.x.x--- ----------......",
    notes: "1' 2' 3' 5' 3' 2' 1'~",
    words: "I'm the bright- est thing in town",
  },
];

const PRE = [
  {
    bar: 0,
    rhythm: "x.x.x.x.x.x.x---",
    notes: "2 4 6 4 2 4 6~",
    words: "if they laugh then let them laugh",
  },
  {
    bar: 2,
    rhythm: "x.x.x.x.x.x.x.x. x-------........",
    notes: "7 7 1' 2' 1' 7 4 7 2'~",
    words: "I'm a light- ning rod to- night ooh yeah",
  },
] as const;

const VERSE_TUNE = [
  { bar: 0, rhythm: "x.x.x.x.x.x.x...", notes: "3 3 1 3 5 3 1" },
  { bar: 2, rhythm: "..x.x.x.x.x.x.x.", notes: "3 5 5 6 5 3 1" },
  { bar: 4, rhythm: "x.x.x.x.x.x.x...", notes: "3 3 1 3 5 6 5" },
  {
    bar: 6,
    rhythm: "..x.x.x.x.x.x.x- ----............",
    notes: "5 5 6 5 4 3 2~",
  },
] as const;
const verse = (words: readonly string[]) =>
  VERSE_TUNE.map((line, i) => ({ ...line, words: words[i]! }));

export const TIN_FOIL_HALO: Chart = {
  title: "Tin Foil Halo",
  key: "Ab",
  mode: "mixolydian",
  bpm: 136,
  sounds: {
    pad: "bloom",
    stab: "brass",
    arp: "marimba",
    arp2: "vibes",
    lead: "sync",
    counter: "whistle",
    bass: "growl",
    singer: "whisper",
    kit: { kick: "syn909", snare: "synlinn", hats: "syn707" },
    design: {
      brightness: 0.55,
      grit: 0.4,
      space: 0.6,
      width: 0.65,
      echo: 0.55,
    },
  },
  notes: [
    "the flat seventh carries the hook, stated on the sync lead before anyone sings",
    "a breathy alto: the chorus whispers the hook's shape back an octave down",
    "the bridge drops to half time and a whistle answers each sung line",
  ],
  sections: [
    {
      kind: "intro",
      name: "Intro",
      bars: 4,
      chords: "I VII IV vi",
      drums: "taps",
      drums2: "bounce",
      play: ["pad", "arp", "lead"],
      hook: HOOK,
      moves: [{ move: "riser" }],
    },
    {
      kind: "verse",
      name: "Verse",
      bars: 8,
      chords: "vi IV I VII",
      drums: "twostep",
      play: ["keys", "sub", "counter"],
      sing: verse([
        "kit- chen light is buz- zing blue",
        "tape on the mir- ror says go",
        "fold- ed foil in- to a crown",
        "wear it to the bus a- lone",
      ]),
      moves: [{ move: "dropout", bar: 3, beat: 2, beats: 2 }],
    },
    {
      kind: "pre",
      name: "Pre",
      bars: 4,
      chords: "ii IV VII VII",
      drums: "four",
      energy: 0.66,
      play: ["pad", "sub", "arp", "harmony"],
      sing: PRE,
      moves: [{ move: "riser" }],
    },
    {
      kind: "chorus",
      name: "Chorus",
      bars: 8,
      chords: "I VII IV vi",
      drums: "bounce",
      play: ["pad", "stabs", "sub", "harmony", "arp", "vocoder"],
      sing: CHORUS,
    },
    {
      kind: "drop",
      name: "Drop",
      bars: 8,
      chords: "I VII IV vi",
      drums: "dembow",
      play: ["sub", "lead", "chops", "stabs", "arp"],
      hook: HOOK8,
      moves: [
        {
          move: "stutter",
          bar: 3,
          beat: 2,
          count: 8,
          step: 0.25,
          notes: "6 6 1' 1' 3' 3' 1' 1'",
          word: "ha",
        },
        {
          move: "stutter",
          bar: 7,
          beat: 2,
          count: 6,
          step: 1 / 3,
          notes: "3' 1' 6 5 3 1",
          word: "lo",
        },
        { move: "crush" },
      ],
    },
    {
      kind: "verse",
      name: "Verse 2",
      bars: 8,
      chords: "vi IV I VII",
      drums: "twostep",
      play: ["keys", "sub", "counter", "arp"],
      sing: verse([
        "ev- ery- bo- dy's half a- sleep",
        "head- phones lea- king some- one's song",
        "no- bo- dy looks up at me",
        "so I shine the whole way home",
      ]),
      moves: [{ move: "dropout", bar: 7, beat: 0, beats: 4 }],
    },
    {
      kind: "pre",
      name: "Pre 2",
      bars: 4,
      chords: "ii IV VII VII",
      drums: "four",
      energy: 0.7,
      play: ["pad", "sub", "arp", "harmony", "vocoder"],
      sing: PRE,
      moves: [{ move: "riser" }, { move: "formant" }],
    },
    {
      kind: "chorus",
      name: "Chorus 2",
      bars: 8,
      chords: "I VII IV vi",
      drums: "bounce",
      play: [
        "pad",
        "stabs",
        "sub",
        "harmony",
        "arp",
        "arp2",
        "vocoder",
        "double",
      ],
      sing: CHORUS,
      moves: [{ move: "tapeStop", beats: 2 }],
    },
    {
      kind: "bridge",
      name: "Bridge",
      bars: 8,
      chords: "IV v vi VII",
      drums: "half",
      energy: 0.45,
      play: ["keys", "sub", "counter", "harmony", "cloud"],
      sing: [
        {
          bar: 0,
          rhythm: "x---x---x.x.x---",
          notes: "6 5 4 5 6~",
          words: "call me what you want",
        },
        {
          bar: 2,
          rhythm: "x---x---x.x.x---",
          notes: "3' 1' 6 1' 6~",
          words: "I know what I am",
        },
        {
          bar: 4,
          rhythm: "x-x-x---x-------",
          notes: "4 5 6 1'~",
          words: "tin foil ha- lo",
        },
        {
          bar: 6,
          rhythm: "x.x.x---x------- ------------....",
          notes: "6 5 6 2'~",
          words: "all made of light",
        },
      ],
      counter: [
        { bar: 1, rhythm: "....x.x.x.x-----", notes: "2' 1' 7 5~" },
        { bar: 3, rhythm: "....x.x.x.x-----", notes: "7 1' 2' 4'~" },
        { bar: 5, rhythm: "....x.x.x.x-----", notes: "2' 1' 7 5~" },
      ],
      moves: [{ move: "drift", layer: "keys" }, { move: "riser" }],
    },
    {
      kind: "chorus",
      name: "Last Chorus",
      bars: 8,
      chords: "I VII IV vi",
      drums: "bounce",
      play: [
        "pad",
        "stabs",
        "sub",
        "harmony",
        "double",
        "arp",
        "arp2",
        "vocoder",
        "counter",
      ],
      sing: LAST_CHORUS,
      moves: [{ move: "silence" }],
    },
    {
      kind: "drop",
      name: "Last Drop",
      bars: 8,
      chords: "I VII IV vi",
      drums: "dembow",
      drums2: "bounce",
      play: ["sub", "lead", "chops", "stabs", "arp", "arp2"],
      hook: HOOK8_HIGH,
      moves: [
        {
          move: "stutter",
          bar: 3,
          beat: 2,
          count: 8,
          step: 0.25,
          notes: "6 6 1' 1' 3' 3' 6' 6'",
          word: "ha",
        },
        { move: "drift", layer: "stabs" },
        { move: "landing" },
      ],
    },
    {
      kind: "outro",
      name: "Outro",
      bars: 4,
      chords: "I VII IV I",
      drums: "taps",
      play: ["keys", "pad", "lead"],
      hook: HOOK,
      moves: [{ move: "tapeStop", beats: 3 }],
    },
  ],
};
