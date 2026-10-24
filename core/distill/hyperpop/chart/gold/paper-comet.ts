/**
 * Gold song 1: a note folded into a paper comet and thrown from a bus
 * window. D major at 162, bright glass and chip, a four-to-the-floor chorus
 * that hands its hook to the lead and the chopped words in the drop.
 */
import type { Chart } from "../format.ts";

/** The hook: two bars stated, two bars answered. */
const HOOK = [
  {
    bar: 0,
    rhythm: "x.xx.x.xx.x.x-.. x.x.x---x.x.x---",
    notes: "1' 7 1' 3' 2' 1' 7 5 3' 2' 1' 5 6 1'~",
  },
  {
    bar: 2,
    rhythm: "x.xx.x.xx.x.x-.. x.x.x---x-------",
    notes: "1' 7 1' 3' 2' 1' 7 6 2' 1' 7 6~",
  },
] as const;
const HOOK8 = [...HOOK, ...HOOK.map((l) => ({ ...l, bar: l.bar + 4 }))];
/** The second drop's hook: its last answer climbs instead of settling. */
const HOOK8_HIGH = [
  ...HOOK8.slice(0, 3),
  {
    bar: 6,
    rhythm: "x.xx.x.xx.x.x-.. x.x.x.x.x-------",
    notes: "1' 7 1' 3' 2' 1' 7 6 2' 3' 5' 3' 5'~",
  },
];

const CHORUS = [
  {
    bar: 0,
    rhythm: "x.x.x.x-x---..x. x---x-----------",
    notes: "5 5 6 5 1' 7 3' 1'~",
    words: "pa- per co- met throw me high- er",
  },
  {
    bar: 2,
    rhythm: "x.x.x.x-x.x-x--- ----------......",
    notes: "3' 3' 2' 1' 7 1' 6~",
    words: "watch me burn a- cross your sky",
  },
  {
    bar: 4,
    rhythm: "x.x.x.x-x---..x. x---x-----------",
    notes: "5 5 6 5 1' 7 3' 2'~",
    words: "pa- per co- met throw me high- er",
  },
  {
    bar: 6,
    rhythm: "x.x.x.x-x.x-x--- ----------......",
    notes: "5 6 1' 7 6 5 5~",
    words: "one more night and then I'm gone",
  },
] as const;

const PRE = [
  {
    bar: 0,
    rhythm: "x.x.x.x.x.x.x---",
    notes: "1 2 3 4 5 6 5~",
    words: "I don't need to land soft- ly",
  },
  {
    bar: 2,
    rhythm: "x.x.x..xx.x.x--- x-------........",
    notes: "5 6 7 5 6 7 1' 2'~",
    words: "light me up light me up and go",
  },
] as const;

/** The last chorus: the final line lifts to the tonic up high for the landing. */
const LAST_CHORUS = [
  ...CHORUS.slice(0, 3),
  {
    bar: 6,
    rhythm: "x.x.x.x-x.x-x--- ----------......",
    notes: "5 6 1' 3' 2' 3' 1'~",
    words: "one more night and then I'm gone",
  },
];

export const PAPER_COMET: Chart = {
  title: "Paper Comet",
  key: "D",
  mode: "major",
  bpm: 162,
  sounds: {
    pad: "glass",
    stab: "sugar",
    arp: "glasspluck",
    arp2: "musicbox",
    lead: "chip",
    counter: "bell",
    bass: "sub808",
    singer: "sung",
    kit: { kick: "syn909", snare: "syn909", hats: "syn808" },
    design: { brightness: 0.7, grit: 0.35, space: 0.5, width: 0.7, echo: 0.5 },
  },
  notes: [
    "the hook is stated in the intro, sung in the chorus, played and chopped in the drop",
    "the bridge drops to half time on the Rhodes with a bell answering the singer",
    "one silent beat before the last chorus, which lands on the tonic",
  ],
  sections: [
    {
      kind: "intro",
      name: "Intro",
      bars: 4,
      chords: "IV I V vi",
      drums: "taps",
      drums2: "four",
      play: ["pad", "arp", "lead"],
      hook: HOOK,
      moves: [{ move: "riser" }],
    },
    {
      kind: "verse",
      name: "Verse",
      bars: 8,
      chords: "vi iii IV I",
      drums: "break",
      play: ["keys", "sub", "lead"],
      sing: [
        {
          bar: 0,
          rhythm: "x.x.x.x.x.x.x---",
          notes: "3 3 3 2 1 2 3",
          words: "fold- ed up the note you wrote",
        },
        {
          bar: 2,
          rhythm: "..x.x.x.x.x.x---",
          notes: "3 3 5 3 2 1~",
          words: "in the back of your coat",
        },
        {
          bar: 4,
          rhythm: "x.xx.x.xx.x.....",
          notes: "5 5 6 5 3 2 3",
          words: "sent it out the bus win- dow",
        },
        {
          bar: 6,
          rhythm: "x.x.x.x.x.x.x--- ----............",
          notes: "3 3 5 6 5 3 1~",
          words: "watched it catch the light and go",
        },
      ],
    },
    {
      kind: "pre",
      name: "Pre",
      bars: 4,
      chords: "ii IV V V",
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
      chords: "IV I V vi",
      drums: "four",
      play: ["pad", "stabs", "sub", "harmony", "arp", "vocoder"],
      sing: CHORUS,
    },
    {
      kind: "drop",
      name: "Drop",
      bars: 8,
      chords: "IV I V vi",
      drums: "jersey",
      play: ["pad", "sub", "lead", "chops", "stabs", "arp"],
      hook: HOOK8,
      moves: [
        {
          move: "stutter",
          bar: 3,
          beat: 2,
          count: 8,
          step: 0.25,
          notes: "1' 1' 2' 2' 3' 3' 5' 5'",
          word: "pa",
        },
        {
          move: "stutter",
          bar: 7,
          beat: 2,
          count: 6,
          step: 1 / 3,
          notes: "5' 3' 2' 1' 6 5",
          word: "high",
        },
        { move: "crush" },
      ],
    },
    {
      kind: "verse",
      name: "Verse 2",
      bars: 8,
      chords: "vi iii IV I",
      drums: "break",
      play: ["keys", "sub", "lead", "arp"],
      sing: [
        {
          bar: 0,
          rhythm: "x.x.x.x.x.x.x---",
          notes: "3 3 3 2 1 2 3",
          words: "tell me if you saw it fall",
        },
        {
          bar: 2,
          rhythm: "..x.x.xx.x.x.x--",
          notes: "3 3 5 5 3 2 1~",
          words: "on the step out- side your door",
        },
        {
          bar: 4,
          rhythm: "x.xx.x.xx.x.....",
          notes: "5 5 6 5 3 2 3",
          words: "did you keep it did you know",
        },
        {
          bar: 6,
          rhythm: "x.x.x.x.x.x.x--- ----............",
          notes: "3 3 5 6 5 3 1~",
          words: "I was burn- ing all a- lone",
        },
      ],
      moves: [{ move: "dropout", bar: 7, beat: 0, beats: 4 }],
    },
    {
      kind: "pre",
      name: "Pre 2",
      bars: 4,
      chords: "ii IV V V",
      drums: "four",
      energy: 0.7,
      play: ["pad", "sub", "arp", "harmony"],
      sing: PRE,
      moves: [{ move: "riser" }, { move: "formant" }],
    },
    {
      kind: "chorus",
      name: "Chorus 2",
      bars: 8,
      chords: "IV I V vi",
      drums: "four",
      play: ["pad", "stabs", "sub", "harmony", "arp", "vocoder"],
      sing: CHORUS,
    },
    {
      kind: "drop",
      name: "Drop 2",
      bars: 8,
      chords: "IV I V vi",
      drums: "jersey",
      play: ["pad", "sub", "lead", "chops", "stabs", "arp"],
      hook: HOOK8_HIGH,
      moves: [
        {
          move: "stutter",
          bar: 3,
          beat: 2,
          count: 8,
          step: 0.25,
          notes: "1' 1' 2' 2' 3' 3' 5' 5'",
          word: "pa",
        },
        {
          move: "stutter",
          bar: 7,
          beat: 0,
          count: 8,
          step: 0.25,
          notes: "5' 3' 2' 1' 5' 3' 2' 1'",
          word: "high",
        },
        { move: "tapeStop", beats: 2 },
      ],
    },
    {
      kind: "bridge",
      name: "Bridge",
      bars: 8,
      chords: "ii vi IV V",
      drums: "half",
      energy: 0.45,
      play: ["keys", "sub", "counter", "harmony", "cloud"],
      sing: [
        {
          bar: 0,
          rhythm: "x---x---x.x.x---",
          notes: "2 4 6~ 5 4~",
          words: "if the wind takes you",
        },
        {
          bar: 2,
          rhythm: "x---x---x.x.x---",
          notes: "6 5 4 2 1~",
          words: "let it take you far",
        },
        {
          bar: 4,
          rhythm: "x-x-x---x-------",
          notes: "2 3 4 6~",
          words: "I'll be the light",
        },
        {
          bar: 6,
          rhythm: "x.x.x---x.x----- ------------....",
          notes: "5 6 1' 7 2'~",
          words: "and I'll be the spark",
        },
      ],
      moves: [{ move: "drift", layer: "keys" }],
    },
    {
      kind: "break",
      name: "Break",
      bars: 4,
      chords: "IV I V V",
      drums: "none",
      play: ["pad", "cloud"],
      sing: [CHORUS[0], { ...PRE[1] }],
      moves: [{ move: "riser" }],
    },
    {
      kind: "chorus",
      name: "Last Chorus",
      bars: 8,
      chords: "IV I V vi",
      drums: "four",
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
      moves: [{ move: "silence" }, { move: "landing" }],
    },
    {
      kind: "outro",
      name: "Outro",
      bars: 4,
      chords: "IV I IV I",
      drums: "taps",
      play: ["keys", "pad", "lead"],
      hook: HOOK,
      moves: [{ move: "tapeStop", beats: 3 }],
    },
  ],
};
