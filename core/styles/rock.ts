/**
 * Rock, punk and metal (quality-08 family `rock`). Root and branch cards
 * only; the family lane adds leaves.
 */

import { grid, maybe, role } from "./parts.ts";
import { card, type StyleCard } from "./schema.ts";

export const ROCK_CARDS: readonly StyleCard[] = Object.freeze([
  card({
    id: "rock-family",
    abstract: true,
    summary:
      "backbeat on 2 and 4, eighth-note drive, power chords and riffs, verse-chorus",
    tempo: { bpm: [90, 160], typical: 120 },
    groove: { subdivision: 2, velocity: [1, 0.75] },
    rhythm: {
      onsets: {
        kick: grid("x...x.1."),
        snare: grid("..x...x."),
        hat: grid("xxxxxxxx"),
      },
      fills: { every: 4, density: [0.4, 0.7] },
    },
    pitch: {
      scales: [
        ["mixolydian", 0.3],
        ["minor-pentatonic", 0.3],
        ["major", 0.2],
        ["minor", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["mixolydian-rock", 0.4],
        ["axis", 0.3],
        ["aeolian", 0.3],
      ],
      sevenths: 0,
      voicing: {
        types: [
          ["power", 0.6],
          ["close", 0.4],
        ],
        range: [40, 64],
        notes: [2, 3],
      },
    },
    melody: { range: [57, 79], chordToneRate: 0.7, repetition: 0.6 },
    bass: {
      behaviour: [
        ["root", 0.7],
        ["octave", 0.3],
      ],
      range: [28, 48],
      onsets: grid("x.x.x.x."),
      kickLock: 0.8,
    },
    form: {
      plans: [
        [
          ["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus"],
          1,
        ],
      ],
    },
    texture: {
      roles: {
        bass: role("ebass"),
        chords: role("electric@crunch", "electric:0.5"),
        lead: role("gtr-lead", "sing:0.6"),
        counter: maybe("electric"),
      },
    },
    mix: {
      levels: { kick: -1, snare: -2, hat: -9, bass: -3, chords: -5, lead: -1 },
      space: 0.25,
    },
  }),
  card({
    id: "early-rock",
    abstract: true,
    summary:
      "rock and roll: shuffle or straight eights, 12-bar blues, boogie bass",
    groove: { swingRatio: [1, 1.8] },
    harmony: {
      forms: [
        [
          [
            "I7",
            "I7",
            "I7",
            "I7",
            "IV7",
            "IV7",
            "I7",
            "I7",
            "V7",
            "IV7",
            "I7",
            "V7",
          ],
          1,
        ],
      ],
      sources: { forms: 2, presets: 1 },
    },
    bass: { behaviour: [["arpeggio", 1]] },
    texture: {
      roles: {
        chords: role("piano", "electric:0.7"),
        bass: role("contrabass", "ebass:0.5"),
      },
    },
  }),
  card({
    id: "classic-rock",
    abstract: true,
    summary: "classic and hard rock: riff-driven, bVII-IV-I, loud backbeat",
    harmony: {
      presets: [
        ["mixolydian-rock", 0.6],
        ["aeolian", 0.4],
      ],
    },
  }),
  card({
    id: "prog",
    abstract: true,
    summary: "progressive: odd meters, modal shifts, long forms, keyboards",
    meter: {
      signatures: [
        ["4/4", 0.4],
        ["7/8", 0.25],
        ["5/4", 0.2],
        ["6/8", 0.15],
      ],
      grouping: [
        [[2, 2, 3], 0.5],
        [[3, 2, 2], 0.5],
      ],
    },
    harmony: { sevenths: 0.3 },
    texture: { roles: { chords: role("hammond", "keys:0.6", "electric:0.5") } },
  }),
  card({
    id: "alt-indie",
    abstract: true,
    summary: "alternative and indie: jangle or fuzz, I-V-vi-IV and modal loops",
    harmony: {
      presets: [
        ["axis", 0.5],
        ["sad-pop", 0.5],
      ],
    },
    texture: { roles: { chords: role("jangle", "electric:0.5") } },
  }),
  card({
    id: "punk",
    abstract: true,
    summary: "punk: fast down-strummed eighths, three chords, short songs",
    tempo: { bpm: [150, 200], typical: 175 },
    rhythm: { onsets: { kick: grid("x.x.x.x."), hat: grid("xxxxxxxx") } },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["fifties", 0.5],
      ],
      voicing: { types: [["power", 1]] },
    },
    texture: { roles: { chords: role("punk") } },
  }),
  card({
    id: "metal",
    abstract: true,
    summary:
      "metal: aeolian and phrygian riffs, palm-muted pedal tones, double kick",
    pitch: {
      scales: [
        ["minor", 0.5],
        ["phrygian", 0.3],
        ["harmonic-minor", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.6],
        ["andalusian", 0.4],
      ],
      voicing: { types: [["power", 1]] },
    },
    groove: { subdivision: 4 },
    rhythm: {
      onsets: {
        kick: grid("xxxxxxxxxxxxxxxx"),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: {
      behaviour: [
        ["pedal", 0.5],
        ["root", 0.5],
      ],
      onsets: grid("xxxxxxxxxxxxxxxx"),
    },
    texture: { roles: { chords: role("gtr-metal") } },
  }),
]);
