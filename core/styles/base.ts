/**
 * BASE_STYLE: the neutral body every style resolves on top of (quality-08).
 * A 4/4 straight-sixteenths song in a major key with a functional
 * progression, a root bass, a piano comp, a lead and a plain kit. Root
 * cards replace what their family does differently; nothing here is a
 * style of its own.
 */

import type { StyleBody } from "./schema.ts";

/** Signed interval weights for -12..12 semitones: mostly steps, few leaps. */
export const STEPWISE_INTERVALS: readonly number[] = Object.freeze([
  0.2, 0.1, 0.1, 0.2, 0.4, 0.6, 0.5, 1.2, 1.4, 2.6, 4.2, 5.2, 1.6, 5.2, 4.2,
  2.6, 1.4, 1.2, 0.5, 0.6, 0.4, 0.2, 0.1, 0.1, 0.2,
]);

export const BASE_STYLE: StyleBody = Object.freeze({
  summary: "neutral 4/4 song: functional harmony, root bass, comp and lead",
  seedSalt: 0,
  meter: { signatures: [["4/4", 1]], hypermeter: [[4, 1]] },
  tempo: { bpm: [90, 130], typical: 110 },
  groove: {
    subdivision: 4,
    swingRatio: [1, 1],
    velocity: [1, 0.7, 0.85, 0.7],
    humanize: { timingMs: 4, velocity: 0.05 },
  },
  rhythm: {
    onsets: {
      kick: [1, 0, 0, 0, 0, 0, 0, 0.2, 1, 0, 0.3, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.1],
      hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    },
    fills: { every: 4, density: [0.3, 0.6] },
  },
  pitch: {
    scales: [["major", 1]],
    tonic: "any",
  },
  harmony: {
    model: "functional",
    presets: [
      ["axis", 0.4],
      ["fifties", 0.3],
      ["canon", 0.3],
    ],
    cadences: [
      ["V-I", 0.6],
      ["IV-I", 0.2],
      ["half", 0.2],
    ],
    rhythm: [[1, 1]],
    sevenths: 0.1,
    voicing: { types: [["close", 1]], range: [52, 76], notes: [3, 4] },
  },
  melody: {
    contour: [
      ["arch", 0.5],
      ["wave", 0.5],
    ],
    ambitus: [5, 12],
    range: [60, 84],
    intervals: STEPWISE_INTERVALS,
    chordToneRate: 0.7,
    density: [1, 2],
    phraseBars: [
      [2, 0.5],
      [4, 0.5],
    ],
    repetition: 0.4,
    finals: [
      [0, 0.6],
      [2, 0.2],
      [4, 0.2],
    ],
  },
  bass: {
    behaviour: [["root", 1]],
    range: [33, 52],
    onsets: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  },
  form: {
    plans: [[["intro", "verse", "chorus", "verse", "chorus", "outro"], 1]],
    energy: {
      intro: 0.4,
      verse: 0.6,
      pre: 0.7,
      chorus: 0.9,
      build: 0.8,
      drop: 1,
      breakdown: 0.3,
      bridge: 0.6,
      outro: 0.4,
    },
    archetype: "verse-chorus",
  },
  texture: {
    kind: "homophonic",
    roles: {
      kick: {
        required: true,
        voices: [{ instrument: "drums", kit: "acoustic", weight: 1 }],
      },
      snare: {
        required: true,
        voices: [{ instrument: "drums", kit: "acoustic", weight: 1 }],
      },
      hat: {
        required: false,
        voices: [{ instrument: "drums", kit: "acoustic", weight: 1 }],
      },
      bass: { required: true, voices: [{ instrument: "bass", weight: 1 }] },
      chords: { required: true, voices: [{ instrument: "piano", weight: 1 }] },
      lead: { required: true, voices: [{ instrument: "lead", weight: 1 }] },
    },
  },
  expression: { dynamics: [0.45, 0.95] },
  mix: {
    levels: { kick: -2, snare: -4, hat: -10, bass: -3, chords: -6, lead: 0 },
    space: 0.25,
  },
  wants: [],
} satisfies StyleBody);
