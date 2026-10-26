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
        "d29e0c7471805d6143c05c52a8a2912cdc27c366e9f3ebf0eac8a611ef4e659e",
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
        { name: "gold", begin: 0.882913, end: 0.898735 },
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
        "5056ffee043ff67ce2868a14107ca12f92f584a4693bbc6f680b47af05658400",
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
      id: "sparkler-vox",
      title: "Sparkler Vox",
      description:
        "Original sung hyperpop vocal book in Bb major at 148 BPM: two verses, a pre-chorus, three chorus lines, six chops and a held vowel.",
      tags: ["vocal", "phrase", "hyperpop", "pop", "chop", "book"],
      root: 70,
      seconds: 32.0268,
      bpm: 148,
      sha256:
        "d09735babde857e538131eae2c7b0cb39a6872c54ba32214ea62b53262e58345",
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
        { name: "spark", begin: 0.851266, end: 0.867089 },
        { name: "pop", begin: 0.867089, end: 0.882912 },
        { name: "light", begin: 0.882912, end: 0.898735 },
        { name: "hey", begin: 0.898735, end: 0.914557 },
        { name: "oh", begin: 0.914557, end: 0.93038 },
        { name: "ya", begin: 0.93038, end: 0.946203 },
        { name: "hold", begin: 0.946203, end: 1.0 },
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
