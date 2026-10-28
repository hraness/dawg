/** Small, original, offline sample library. Assets are versioned and immutable. */
import type { PinnedSampleRef } from "./score.ts";

export const BUNDLED_SAMPLE_BASE = "https://dawg.sh/bundled/studio-v1/";
export type BundledSample = Readonly<{
  id: string;
  title: string;
  description: string;
  tags: readonly string[];
  root: number;
  seconds: number;
  bpm?: number;
  sha256: string;
  slices: readonly Readonly<{ name: string; begin: number; end: number }>[];
}>;

const phraseSlices = (a: string, b: string) =>
  [a, b, a, b].map((name, i) =>
    Object.freeze({ name, begin: i / 4, end: (i + 1) / 4 }),
  );
/**
 * The sung hooks are five bars plus a half-beat lead at their tempo: line A
 * on beats 0-8, line B on 8-16 and three held syllables at 16, 17.5 and 19.
 * Each slice opens a quarter beat early so onset consonants land before the
 * beat; trigger slices a quarter beat ahead of the downbeat.
 */
const hookSlices = (...chops: readonly [string, string, string]) => {
  const at = (beats: number) => Math.round((beats / 20.5) * 1e5) / 1e5;
  return [
    { name: "line-a", begin: at(0.25), end: at(8.25) },
    { name: "line-b", begin: at(8.25), end: at(16.25) },
    ...chops.map((name, i) => ({
      name,
      begin: at(16.25 + 1.5 * i),
      end: at(17.5 + 1.5 * i),
    })),
  ].map((slice) => Object.freeze(slice));
};
export const BUNDLED_SAMPLES: readonly BundledSample[] = Object.freeze(
  [
    {
      id: "hold-on",
      title: "Hold On",
      description:
        "Original alto machine-voice phrase; four clean syllables for garage chops.",
      tags: ["vocal", "phrase", "garage", "chop"],
      root: 60,
      seconds: 2,
      bpm: 120,
      sha256:
        "2ba6611084af627e05e375ef5d35e3947a004969d04202b4c0bf7814d85184d1",
      slices: phraseSlices("hold", "on"),
    },
    {
      id: "stay-up",
      title: "Stay Up",
      description:
        "Original tenor machine-voice phrase; tight consonants for pop and electro.",
      tags: ["vocal", "phrase", "pop", "electro", "chop"],
      root: 60,
      seconds: 2,
      bpm: 120,
      sha256:
        "86e53719fdc7a28ab1f4062fd6160be51c067a64226f5ad3576f65ea08ec3d80",
      slices: phraseSlices("stay", "up"),
    },
    {
      id: "vowel-ah",
      title: "Ah",
      description:
        "Dry C4 alto vowel for playable chords, pads and reverse swells.",
      tags: ["vocal", "vowel", "pad", "chord"],
      root: 60,
      seconds: 1,
      sha256:
        "fc2203d1b567348baee1aeafad74e0c980a5bb3a730ad21ced80572399c024eb",
      slices: [],
    },
    {
      id: "vowel-oh",
      title: "Oh",
      description:
        "Dry C4 tenor vowel; a rounded counterpoint to the bright Ah.",
      tags: ["vocal", "vowel", "pad", "chord"],
      root: 60,
      seconds: 1,
      sha256:
        "c98b8f9b8683d8eab3f1420e88ee6e7aef01fa0bdf7564f5d09ddc9c724980e8",
      slices: [],
    },
    {
      id: "glass-hit",
      title: "Glass",
      description: "C6 tuned glass strike with a bright inharmonic ring.",
      tags: ["percussion", "glass", "bell", "bright"],
      root: 84,
      seconds: 0.8,
      sha256:
        "d9b0785e8172cba4e6fa5e57320a70392e6c1a9db8f3737d087704a86812086b",
      slices: [],
    },
    {
      id: "metal-hit",
      title: "Metal",
      description:
        "C5 struck metal; short, woody attack and irregular partials.",
      tags: ["percussion", "metal", "industrial"],
      root: 72,
      seconds: 0.8,
      sha256:
        "d6a80299a60b764d538e041c4c7ff3c6d11237182336217d28cf27202145a454",
      slices: [],
    },
    {
      id: "tape-hit",
      title: "Tape",
      description:
        "Saturated low thump and hiss for fills and transition punctuation.",
      tags: ["percussion", "texture", "lofi", "thump"],
      root: 60,
      seconds: 0.45,
      sha256:
        "7abfa46ffbd43ee40bba87a8bfe59db2eceb15b0e78e57c05600c1452399645f",
      slices: [],
    },
    {
      id: "riser",
      title: "Rise",
      description: "Two-second noise and sine sweep; reverse for a downlifter.",
      tags: ["fx", "transition", "noise", "riser"],
      root: 60,
      seconds: 2,
      sha256:
        "5a57894a109dc4fd117cee9acd9ea15c48a61fcfd27a9ba262e852ef9cff2108",
      slices: [],
    },
    {
      id: "stay-tonight",
      title: "Stay Tonight",
      description:
        "Original sung pop hook in D major at 130 BPM: two lines plus three held chop syllables.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "hook"],
      root: 69,
      seconds: 9.4615,
      bpm: 130,
      sha256:
        "d307feefc253325088ea38f091aa58fa0e6c81f82e5c0c96186358018cdc4ebc",
      slices: hookSlices("stay", "night", "go"),
    },
    {
      id: "lights-out",
      title: "Lights Out",
      description:
        "Original sung pop hook in F major at 140 BPM, a bright formant; two lines and three chops.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "hook"],
      root: 69,
      seconds: 8.785708333333334,
      bpm: 140,
      sha256:
        "130b0d29d7ddd0047294422e4c2d04fcc4875964501582a88ac0f59af4039810",
      slices: hookSlices("lights", "out", "on"),
    },
    {
      id: "all-i-need",
      title: "All I Need",
      description:
        "Original breathy sung pop hook in A major at 136 BPM; two lines and three chops.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "hook"],
      root: 69,
      seconds: 9.044083333333333,
      bpm: 136,
      sha256:
        "52c373c3d830b7cd4004c782680582d942ed8eadb1ae4425a6736a4fac1ee8db",
      slices: hookSlices("need", "name", "oh"),
    },
    {
      id: "soft-reboot-vox",
      title: "Soft Reboot Vox",
      description:
        "Original sung hyperpop vocal book in D major at 140 BPM: two verses, a pre-chorus, three chorus lines, six chop syllables and a held vowel.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "book"],
      root: 69,
      seconds: 33.85695833333333,
      bpm: 140,
      sha256:
        "0ff75944741f0e4c520f72432bfcc67afcbcd7fb34313d43a2486e8222902be9",
      slices: [
        { name: "v1", begin: 0.0, end: 0.053797 },
        { name: "v2", begin: 0.053797, end: 0.107595 },
        { name: "v3", begin: 0.107595, end: 0.161392 },
        { name: "v4", begin: 0.161392, end: 0.21519 },
        { name: "v5", begin: 0.21519, end: 0.268987 },
        { name: "v6", begin: 0.268987, end: 0.322784 },
        { name: "v7", begin: 0.322784, end: 0.376582 },
        { name: "v8", begin: 0.376582, end: 0.430379 },
        { name: "pre1", begin: 0.430379, end: 0.484177 },
        { name: "pre2", begin: 0.484177, end: 0.537974 },
        { name: "ch1", begin: 0.537974, end: 0.642405 },
        { name: "ch2", begin: 0.642405, end: 0.746836 },
        { name: "ch3", begin: 0.746836, end: 0.851266 },
        { name: "stay", begin: 0.851266, end: 0.867089 },
        { name: "night", begin: 0.867089, end: 0.882912 },
        { name: "back", begin: 0.882912, end: 0.898735 },
        { name: "life", begin: 0.898735, end: 0.914557 },
        { name: "oh", begin: 0.914557, end: 0.93038 },
        { name: "yeah", begin: 0.93038, end: 0.946203 },
        { name: "hold", begin: 0.946203, end: 1.0 },
      ],
    },
    {
      id: "low-battery-vox",
      title: "Low Battery Vox",
      description:
        "Original sung hyperpop vocal book in F# minor at 150 BPM, a bright formant: two verses, a pre-chorus, three chorus lines, six chops and a held vowel.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "book"],
      root: 69,
      seconds: 31.6,
      bpm: 150,
      sha256:
        "8b3424c25822b4b0fcaf9aa7933fb147a7ab5a4bb60cc49ce2d508f6d344cf32",
      slices: [
        { name: "v1", begin: 0.0, end: 0.053797 },
        { name: "v2", begin: 0.053797, end: 0.107595 },
        { name: "v3", begin: 0.107595, end: 0.161392 },
        { name: "v4", begin: 0.161392, end: 0.21519 },
        { name: "v5", begin: 0.21519, end: 0.268987 },
        { name: "v6", begin: 0.268987, end: 0.322785 },
        { name: "v7", begin: 0.322785, end: 0.376582 },
        { name: "v8", begin: 0.376582, end: 0.43038 },
        { name: "pre1", begin: 0.43038, end: 0.484177 },
        { name: "pre2", begin: 0.484177, end: 0.537975 },
        { name: "ch1", begin: 0.537975, end: 0.642405 },
        { name: "ch2", begin: 0.642405, end: 0.746835 },
        { name: "ch3", begin: 0.746835, end: 0.851266 },
        { name: "low", begin: 0.851266, end: 0.867089 },
        { name: "charge", begin: 0.867089, end: 0.882911 },
        { name: "up", begin: 0.882911, end: 0.898734 },
        { name: "fade", begin: 0.898734, end: 0.914557 },
        { name: "hey", begin: 0.914557, end: 0.93038 },
        { name: "ah", begin: 0.93038, end: 0.946203 },
        { name: "hold", begin: 0.946203, end: 1.0 },
      ],
    },
    {
      id: "glass-garden-vox",
      title: "Glass Garden Vox",
      description:
        "Original breathy sung hyperpop vocal book in A major at 128 BPM: two verses, a pre-chorus, three chorus lines, six chops and a held vowel.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "book"],
      root: 69,
      seconds: 37.030833333333334,
      bpm: 128,
      sha256:
        "37d6487f368e7142870a87a2d903ad44050fb5864dd82e35cda4daa1a0636a56",
      slices: [
        { name: "v1", begin: 0.0, end: 0.053798 },
        { name: "v2", begin: 0.053798, end: 0.107595 },
        { name: "v3", begin: 0.107595, end: 0.161393 },
        { name: "v4", begin: 0.161393, end: 0.21519 },
        { name: "v5", begin: 0.21519, end: 0.268988 },
        { name: "v6", begin: 0.268988, end: 0.322785 },
        { name: "v7", begin: 0.322785, end: 0.376583 },
        { name: "v8", begin: 0.376583, end: 0.43038 },
        { name: "pre1", begin: 0.43038, end: 0.484178 },
        { name: "pre2", begin: 0.484178, end: 0.537975 },
        { name: "ch1", begin: 0.537975, end: 0.642406 },
        { name: "ch2", begin: 0.642406, end: 0.746837 },
        { name: "ch3", begin: 0.746837, end: 0.851268 },
        { name: "glass", begin: 0.851268, end: 0.86709 },
        { name: "bloom", begin: 0.86709, end: 0.882913 },
        { name: "glow", begin: 0.882913, end: 0.898735 },
        { name: "grow", begin: 0.898735, end: 0.914558 },
        { name: "ah", begin: 0.914558, end: 0.93038 },
        { name: "ooh", begin: 0.93038, end: 0.946202 },
        { name: "hold", begin: 0.946202, end: 1.0 },
      ],
    },
    {
      id: "redline-vox",
      title: "Redline Vox",
      description:
        "Original sung hyperpop vocal book in F minor at 172 BPM, sung half-time: two verses, a pre-chorus, three chorus lines, six chops and a held vowel.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "book"],
      root: 68,
      seconds: 27.557958333333332,
      bpm: 172,
      sha256:
        "0b3559e83340f55441659d003321b27a091f9e0c062dabc1e28d057a48b34ae0",
      slices: [
        { name: "v1", begin: 0.0, end: 0.053797 },
        { name: "v2", begin: 0.053797, end: 0.107594 },
        { name: "v3", begin: 0.107594, end: 0.161392 },
        { name: "v4", begin: 0.161392, end: 0.215189 },
        { name: "v5", begin: 0.215189, end: 0.268986 },
        { name: "v6", begin: 0.268986, end: 0.322783 },
        { name: "v7", begin: 0.322783, end: 0.376581 },
        { name: "v8", begin: 0.376581, end: 0.430378 },
        { name: "pre1", begin: 0.430378, end: 0.484175 },
        { name: "pre2", begin: 0.484175, end: 0.537972 },
        { name: "ch1", begin: 0.537972, end: 0.642404 },
        { name: "ch2", begin: 0.642404, end: 0.746835 },
        { name: "ch3", begin: 0.746835, end: 0.851266 },
        { name: "red", begin: 0.851266, end: 0.867089 },
        { name: "line", begin: 0.867089, end: 0.882912 },
        { name: "go", begin: 0.882912, end: 0.898735 },
        { name: "up", begin: 0.898735, end: 0.914557 },
        { name: "hey", begin: 0.914557, end: 0.93038 },
        { name: "oh", begin: 0.93038, end: 0.946203 },
        { name: "hold", begin: 0.946203, end: 1.0 },
      ],
    },
    {
      id: "light-one-vox",
      title: "Light One Vox",
      description:
        "The Light One vocal book: verse, chorus and break lines in F major at 122, sung by the synthetic Kokoro voice bf_emma, with one-word chops and a held ah.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "book"],
      root: 65,
      seconds: 69.95895833333333,
      bpm: 122,
      sha256:
        "ea556064bcbb55ec5c509f4e84145ec09711e766c5c73f4154e820e0b7b26284",
      slices: [
        { name: "v1", begin: 0.0, end: 0.057997 },
        { name: "v2", begin: 0.057997, end: 0.115993 },
        { name: "v3", begin: 0.115993, end: 0.17399 },
        { name: "v4", begin: 0.17399, end: 0.231986 },
        { name: "v5", begin: 0.231986, end: 0.289983 },
        { name: "v6", begin: 0.289983, end: 0.347979 },
        { name: "v7", begin: 0.347979, end: 0.405976 },
        { name: "v8", begin: 0.405976, end: 0.463972 },
        { name: "ch1", begin: 0.463972, end: 0.521969 },
        { name: "ch2", begin: 0.521969, end: 0.579965 },
        { name: "ch3", begin: 0.579965, end: 0.637962 },
        { name: "ch4", begin: 0.637962, end: 0.695958 },
        { name: "br1", begin: 0.695958, end: 0.753955 },
        { name: "br2", begin: 0.753955, end: 0.811951 },
        { name: "last", begin: 0.811951, end: 0.898067 },
        { name: "light", begin: 0.898067, end: 0.906854 },
        { name: "oh", begin: 0.906854, end: 0.915642 },
        { name: "ah", begin: 0.915642, end: 0.924429 },
        { name: "one", begin: 0.924429, end: 0.933216 },
        { name: "mm", begin: 0.933216, end: 0.942003 },
        { name: "hold", begin: 0.942003, end: 1.0 },
      ],
    },
    {
      id: "window-seat-vox",
      title: "Window Seat Vox",
      description:
        "The Window Seat vocal book: half-time verse, chorus and break lines in G major at 170, sung by the synthetic Kokoro voice bf_emma, with one-word chops and a held ah.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "book"],
      root: 67,
      seconds: 93.9705,
      bpm: 170,
      sha256:
        "218575ee6796d906b2bd231ba9fe66d2bd4550b336b6f3241be9ddf39d70253c",
      slices: [
        { name: "v1", begin: 0.0, end: 0.061033 },
        { name: "v2", begin: 0.061033, end: 0.122066 },
        { name: "v3", begin: 0.122066, end: 0.183099 },
        { name: "v4", begin: 0.183099, end: 0.244132 },
        { name: "v5", begin: 0.244132, end: 0.305164 },
        { name: "v6", begin: 0.305164, end: 0.366197 },
        { name: "v7", begin: 0.366197, end: 0.42723 },
        { name: "v8", begin: 0.42723, end: 0.488263 },
        { name: "ch1", begin: 0.488263, end: 0.549296 },
        { name: "ch2", begin: 0.549296, end: 0.610329 },
        { name: "ch3", begin: 0.610329, end: 0.671362 },
        { name: "ch4", begin: 0.671362, end: 0.732395 },
        { name: "br1", begin: 0.732395, end: 0.793428 },
        { name: "br2", begin: 0.793428, end: 0.854461 },
        { name: "last", begin: 0.854461, end: 0.945541 },
        { name: "oh", begin: 0.945541, end: 0.950235 },
        { name: "ah", begin: 0.950235, end: 0.95493 },
        { name: "seat", begin: 0.95493, end: 0.959625 },
        { name: "hey", begin: 0.959625, end: 0.964319 },
        { name: "mm", begin: 0.964319, end: 0.969014 },
        { name: "hold", begin: 0.969014, end: 1.0 },
      ],
    },
    {
      id: "glow-stick-vox",
      title: "Glow Stick Vox",
      description:
        "The Glow Stick vocal book: verse, chorus and break lines in Db major at 128, sung by the synthetic Kokoro voice bf_emma, with one-word chops and a held ooh.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "book"],
      root: 61,
      seconds: 64.80425,
      bpm: 128,
      sha256:
        "968bd4e425a5b4401c3c577ecd010bd155325650bf93a7f26f7d10c2450a1d55",
      slices: [
        { name: "v1", begin: 0.0, end: 0.059675 },
        { name: "v2", begin: 0.059675, end: 0.119349 },
        { name: "v3", begin: 0.119349, end: 0.179024 },
        { name: "v4", begin: 0.179024, end: 0.238698 },
        { name: "v5", begin: 0.238698, end: 0.298373 },
        { name: "v6", begin: 0.298373, end: 0.358048 },
        { name: "v7", begin: 0.358048, end: 0.417722 },
        { name: "v8", begin: 0.417722, end: 0.477397 },
        { name: "ch1", begin: 0.477397, end: 0.537071 },
        { name: "ch2", begin: 0.537071, end: 0.596746 },
        { name: "ch3", begin: 0.596746, end: 0.65642 },
        { name: "ch4", begin: 0.65642, end: 0.716095 },
        { name: "br1", begin: 0.716095, end: 0.77577 },
        { name: "br2", begin: 0.77577, end: 0.835444 },
        { name: "last", begin: 0.835444, end: 0.924052 },
        { name: "glow", begin: 0.924052, end: 0.933093 },
        { name: "oh", begin: 0.933093, end: 0.942135 },
        { name: "ah", begin: 0.942135, end: 0.951176 },
        { name: "hey", begin: 0.951176, end: 0.960217 },
        { name: "mm", begin: 0.960217, end: 0.969259 },
        { name: "hold", begin: 0.969259, end: 1.0 },
      ],
    },
    {
      id: "bubble-wrap-vox",
      title: "Bubble Wrap Vox",
      description:
        "A plain, low conversational voice singing every line of Bubble Wrap (Bb major, 100), a deadpan low male chant, single-syllable chops on Bb4 for chipmunk riffs and a held ooh.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "book"],
      root: 70,
      seconds: 86.55,
      bpm: 100,
      sha256:
        "b21570977e21a76a9e718cd5da4e4b862223999573a676de7678c1f60c03755c",
      slices: [
        { name: "v1", begin: 0.0, end: 0.057192 },
        { name: "v2", begin: 0.057192, end: 0.114385 },
        { name: "v3", begin: 0.114385, end: 0.171577 },
        { name: "v4", begin: 0.171577, end: 0.228769 },
        { name: "v5", begin: 0.228769, end: 0.285962 },
        { name: "v6", begin: 0.285962, end: 0.343154 },
        { name: "v7", begin: 0.343154, end: 0.400347 },
        { name: "v8", begin: 0.400347, end: 0.457539 },
        { name: "chant1", begin: 0.457539, end: 0.487002 },
        { name: "chant2", begin: 0.487002, end: 0.516464 },
        { name: "chant3", begin: 0.516464, end: 0.545927 },
        { name: "chant4", begin: 0.545927, end: 0.57539 },
        { name: "ch1", begin: 0.57539, end: 0.632582 },
        { name: "ch2", begin: 0.632582, end: 0.689775 },
        { name: "ch3", begin: 0.689775, end: 0.746967 },
        { name: "ch4", begin: 0.746967, end: 0.804159 },
        { name: "br1", begin: 0.804159, end: 0.861352 },
        { name: "br2", begin: 0.861352, end: 0.918544 },
        { name: "pop", begin: 0.918544, end: 0.92721 },
        { name: "up", begin: 0.92721, end: 0.935875 },
        { name: "oh", begin: 0.935875, end: 0.944541 },
        { name: "ah", begin: 0.944541, end: 0.953206 },
        { name: "hey", begin: 0.953206, end: 0.961872 },
        { name: "mm", begin: 0.961872, end: 0.970537 },
        { name: "hold", begin: 0.970537, end: 1.0 },
      ],
    },
    {
      id: "candy-fault-vox",
      title: "Candy Fault Vox",
      description:
        "A bright British voice singing Candy Fault's whole topline (E major, 156) note for note, the final chorus a half step up in F, with single-syllable chops on G#5 for the glitch-break stutters.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "book"],
      root: 80,
      seconds: 75.57679166666667,
      bpm: 156,
      sha256:
        "2cea8cc8571b2eed31f87c645bb55e4e533be85edb16474b50d54a773000ce58",
      slices: [
        { name: "v1a", begin: 0.0, end: 0.036896 },
        { name: "v1b", begin: 0.036896, end: 0.073791 },
        { name: "v1c", begin: 0.073791, end: 0.110687 },
        { name: "v1d", begin: 0.110687, end: 0.142494 },
        { name: "lift1", begin: 0.142494, end: 0.179389 },
        { name: "lift2", begin: 0.179389, end: 0.221374 },
        { name: "chA", begin: 0.221374, end: 0.263359 },
        { name: "chB1", begin: 0.263359, end: 0.300255 },
        { name: "chA2", begin: 0.300255, end: 0.34224 },
        { name: "chC1", begin: 0.34224, end: 0.374046 },
        { name: "v2a", begin: 0.374046, end: 0.410942 },
        { name: "v2b", begin: 0.410942, end: 0.447838 },
        { name: "v2c", begin: 0.447838, end: 0.484733 },
        { name: "v2d", begin: 0.484733, end: 0.51654 },
        { name: "chB2", begin: 0.51654, end: 0.553435 },
        { name: "chC2", begin: 0.553435, end: 0.585242 },
        { name: "br1", begin: 0.585242, end: 0.708652 },
        { name: "br2", begin: 0.708652, end: 0.745547 },
        { name: "chAo", begin: 0.745547, end: 0.782443 },
        { name: "chBo", begin: 0.782443, end: 0.819339 },
        { name: "chA2o", begin: 0.819339, end: 0.861324 },
        { name: "chCo", begin: 0.861324, end: 0.908398 },
        { name: "last", begin: 0.908398, end: 0.980917 },
        { name: "pix", begin: 0.980917, end: 0.987278 },
        { name: "me", begin: 0.987278, end: 0.993639 },
        { name: "oh", begin: 0.993639, end: 1.0 },
      ],
    },
    {
      id: "kite-season-vox",
      title: "Kite Season Vox",
      description:
        "A low dry alto singing every line of Kite Season (E major, 146, half-time), with a low male answer, single-syllable chops on E4 and a held ooh.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "book"],
      root: 64,
      seconds: 50.65083333333333,
      bpm: 146,
      sha256:
        "91790065d4c2259701f923f869e8d9d1e897a8d93cc3bf9f34a353d2b3da0331",
      slices: [
        { name: "v1", begin: 0.0, end: 0.066937 },
        { name: "v2", begin: 0.066937, end: 0.133874 },
        { name: "v3", begin: 0.133874, end: 0.200811 },
        { name: "v4", begin: 0.200811, end: 0.267748 },
        { name: "v5", begin: 0.267748, end: 0.334685 },
        { name: "v6", begin: 0.334685, end: 0.401622 },
        { name: "v7", begin: 0.401622, end: 0.468559 },
        { name: "v8", begin: 0.468559, end: 0.535496 },
        { name: "ch1", begin: 0.535496, end: 0.602433 },
        { name: "ch2", begin: 0.602433, end: 0.66937 },
        { name: "ch3", begin: 0.66937, end: 0.736307 },
        { name: "ch4", begin: 0.736307, end: 0.803244 },
        { name: "br", begin: 0.803244, end: 0.870181 },
        { name: "echo", begin: 0.870181, end: 0.904664 },
        { name: "high", begin: 0.904664, end: 0.914806 },
        { name: "go", begin: 0.914806, end: 0.924949 },
        { name: "kite", begin: 0.924949, end: 0.935091 },
        { name: "oh", begin: 0.935091, end: 0.945233 },
        { name: "ah", begin: 0.945233, end: 0.955375 },
        { name: "mm", begin: 0.955375, end: 0.965517 },
        { name: "hold", begin: 0.965517, end: 1.0 },
      ],
    },
    {
      id: "night-swim-vox",
      title: "Night Swim Vox",
      description:
        "Original sung Balearic pop vocal book in D major at 122 BPM: eight verse lines sung low on speech rhythm, two pre-chorus lines, four chorus lines with one melisma, a low bridge line, a low second-voice echo, six chops and a held vowel.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "book"],
      root: 62,
      seconds: 49.057375,
      bpm: 122,
      sha256:
        "0a310cf014588e2f015eef872a0aaa5dbcfb2ba68af9ff2c5b10f1b434c2b8d8",
      slices: [
        { name: "v1", begin: 0.0, end: 0.042607 },
        { name: "v2", begin: 0.042607, end: 0.085213 },
        { name: "v3", begin: 0.085213, end: 0.12782 },
        { name: "v4", begin: 0.12782, end: 0.170426 },
        { name: "v5", begin: 0.170426, end: 0.213033 },
        { name: "v6", begin: 0.213033, end: 0.255639 },
        { name: "v7", begin: 0.255639, end: 0.298246 },
        { name: "v8", begin: 0.298246, end: 0.340853 },
        { name: "pre1", begin: 0.340853, end: 0.383459 },
        { name: "pre2", begin: 0.383459, end: 0.426066 },
        { name: "ch1", begin: 0.426066, end: 0.508772 },
        { name: "ch2", begin: 0.508772, end: 0.591479 },
        { name: "ch3", begin: 0.591479, end: 0.674186 },
        { name: "ch4", begin: 0.674186, end: 0.756893 },
        { name: "br", begin: 0.756893, end: 0.839599 },
        { name: "echo", begin: 0.839599, end: 0.882206 },
        { name: "swim", begin: 0.882206, end: 0.894737 },
        { name: "night", begin: 0.894737, end: 0.907268 },
        { name: "stay", begin: 0.907268, end: 0.9198 },
        { name: "oh", begin: 0.9198, end: 0.932331 },
        { name: "ah", begin: 0.932331, end: 0.944862 },
        { name: "mm", begin: 0.944862, end: 0.957393 },
        { name: "hold", begin: 0.957393, end: 1.0 },
      ],
    },
  ].map((sample) =>
    Object.freeze({
      ...sample,
      tags: Object.freeze(sample.tags),
      slices: Object.freeze(sample.slices),
    }),
  ),
);

export function bundledSample(id: string): BundledSample | undefined {
  const key = id.toLowerCase().replace(/^(?:pack:)?studio\//, "");
  return BUNDLED_SAMPLES.find((sample) => sample.id === key);
}

export function bundledSampleRef(id: string): PinnedSampleRef {
  const sample = bundledSample(id);
  if (!sample) throw new Error(`Unknown studio sample: ${id.slice(0, 80)}`);
  return Object.freeze({
    src: `pack:studio/${sample.id}`,
    url: `${BUNDLED_SAMPLE_BASE}${sample.id}.wav`,
    sha256: sample.sha256,
    license: "CC0-1.0",
    root: sample.root,
  });
}

/** All words match metadata, so `vocal garage` narrows to the intended phrase. */
export function searchBundledSamples(query = ""): readonly BundledSample[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return BUNDLED_SAMPLES.filter((sample) =>
    words.every((word) =>
      `${sample.id} ${sample.title} ${sample.description} ${sample.tags.join(" ")}`
        .toLowerCase()
        .includes(word),
    ),
  );
}
