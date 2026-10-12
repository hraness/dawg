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
