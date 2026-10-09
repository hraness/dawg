/**
 * Electronic dance, ambient and experimental electronic (quality-08 family
 * `electronic`). `deep-house` is the worked electronic leaf: 118–125 bpm,
 * four-on-the-floor kick, clap on 2 and 4, off-beat open hat, a light
 * 16th swing (about 54–58 %), minor-seventh and ninth chords on a
 * two-chord dorian or aeolian loop, a syncopated bass that avoids the
 * kick, 8-bar phrasing and filter-led build and breakdown sections.
 */

import { grid, intervals, kit, maybe, role } from "./parts.ts";
import { card, type StyleCard } from "./schema.ts";

const FOUR_FLOOR = grid("x...x...x...x...");
const BACKBEAT_CLAP = grid("....x.......x...");
const OFFBEAT_HAT = grid("..x...x...x...x.");
const MACHINE = Object.freeze({
  required: true,
  voices: Object.freeze([kit("syn909"), kit("syn808", 0.4)]),
});
const MACHINE_OPT = Object.freeze({ required: false, voices: MACHINE.voices });

export const ELECTRONIC_CARDS: readonly StyleCard[] = Object.freeze([
  card({
    id: "electronic",
    abstract: true,
    summary:
      "loop-based machine music: quantised grids, 8-bar phrases, builds and drops, synth voices",
    tempo: { bpm: [100, 140], typical: 124 },
    meter: { hypermeter: [[8, 1]] },
    groove: { subdivision: 4, humanize: { timingMs: 0, velocity: 0.02 } },
    rhythm: {
      onsets: { kick: FOUR_FLOOR, clap: BACKBEAT_CLAP, hat: OFFBEAT_HAT },
      fills: { every: 8, density: [0.3, 0.6] },
    },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["dorian", 0.25],
        ["phrygian", 0.15],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["dorian-vamp", 0.3],
        ["sad-pop", 0.2],
      ],
      rhythm: [
        [1, 0.5],
        [0.5, 0.5],
      ],
      sevenths: 0.4,
    },
    melody: {
      repetition: 0.8,
      density: [2, 3],
      phraseBars: [
        [2, 0.5],
        [4, 0.5],
      ],
      intervals: intervals(4, 3, 1.2, 1.2),
    },
    bass: {
      behaviour: [
        ["ostinato", 0.5],
        ["octave", 0.3],
        ["root", 0.2],
      ],
      onsets: grid("..x...x...x...x."),
      kickLock: 0,
    },
    form: {
      plans: [
        [["intro", "build", "drop", "breakdown", "build", "drop", "outro"], 1],
      ],
      archetype: "build-drop",
    },
    texture: {
      roles: {
        snare: null,
        kick: MACHINE,
        clap: MACHINE,
        hat: MACHINE,
        openhat: MACHINE_OPT,
        bass: role("bass", "saw:0.4", "square:0.3"),
        chords: role("keys", "saw:0.5"),
        pad: maybe("strings", "granular:0.4"),
        lead: role("lead", "pluck:0.6"),
      },
    },
    expression: { dynamics: [0.6, 1] },
    mix: {
      levels: {
        kick: 0,
        clap: -5,
        hat: -9,
        openhat: -11,
        bass: -3,
        chords: -8,
        pad: -12,
        lead: -4,
      },
      space: 0.3,
      loudness: "club",
    },
  }),
  card({
    id: "disco-family",
    abstract: true,
    summary:
      "disco: four-on-the-floor, open hat on the off-beat, octave bass, strings",
    tempo: { bpm: [110, 130], typical: 120 },
    pitch: {
      scales: [
        ["minor", 0.4],
        ["dorian", 0.3],
        ["major", 0.3],
      ],
    },
    bass: { behaviour: [["octave", 1]], onsets: grid("x.x.x.x.x.x.x.x.") },
    texture: {
      roles: {
        chords: role("strings", "epiano:0.5"),
        lead: role("strings", "lead:0.5"),
      },
    },
  }),
  card({
    id: "house",
    abstract: true,
    summary:
      "house: 120-128 bpm, four-on-the-floor, off-beat hats, piano or organ stabs",
    tempo: { bpm: [118, 130], typical: 124 },
    texture: {
      roles: { kick: MACHINE, chords: role("piano", "organ:0.5", "keys:0.5") },
    },
  }),
  card({
    id: "deep-house",
    summary:
      "minor 7th and 9th loops, swung 16ths, off-beat hat, syncopated bass",
    seedSalt: 1986,
    tempo: { bpm: [118, 125], typical: 122 },
    groove: { swingRatio: [1.18, 1.38], velocity: [1, 0.55, 0.8, 0.6] },
    rhythm: {
      onsets: {
        kick: FOUR_FLOOR,
        clap: BACKBEAT_CLAP,
        hat: grid("..x...x...x...x."),
        openhat: grid("..1...1...1...1."),
        shaker: grid("x.xxx.xxx.xxx.xx"),
      },
      locks: [{ kind: "avoid", a: "kick", b: "openhat" }],
    },
    pitch: {
      scales: [
        ["dorian", 0.55],
        ["minor", 0.45],
      ],
    },
    harmony: {
      presets: [
        ["dorian-vamp", 0.6],
        ["aeolian", 0.4],
      ],
      forms: [
        [["i7", "iv7"], 0.5],
        [["i9", "bVII", "iv7", "i7"], 0.5],
      ],
      sources: { presets: 1, forms: 2 },
      rhythm: [
        [1, 0.6],
        [0.5, 0.4],
      ],
      sevenths: 0.9,
      voicing: {
        types: [
          ["open", 0.6],
          ["shell", 0.4],
        ],
        range: [52, 74],
        notes: [4, 5],
      },
    },
    melody: { density: [1, 2], ambitus: [5, 10], repetition: 0.85 },
    bass: {
      behaviour: [["ostinato", 1]],
      range: [31, 48],
      onsets: grid("..x..x....x..x.."),
      kickLock: 0,
    },
    texture: {
      roles: {
        shaker: MACHINE_OPT,
        chords: role("epiano", "organ:0.5"),
        pad: maybe("strings"),
        lead: maybe("pluck", "vibes:0.4"),
      },
    },
    mix: { space: 0.4 },
  }),
  card({
    id: "techno",
    abstract: true,
    summary:
      "techno: 125-140 bpm, relentless kick, ride and hat patterns, minimal harmony",
    tempo: { bpm: [125, 140], typical: 132 },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    rhythm: {
      onsets: {
        clap: grid("....1.......x..."),
        perc: grid("..x..x..x...x..x"),
      },
    },
    texture: {
      roles: {
        perc: MACHINE_OPT,
        chords: maybe("saw", "keys:0.5"),
        lead: role("saw", "square:0.5"),
      },
    },
    melody: { repetition: 0.9, density: [2, 4] },
  }),
  card({
    id: "trance-family",
    abstract: true,
    summary:
      "trance: 132-140 bpm, rolling off-beat bass, supersaw chords, long builds",
    tempo: { bpm: [130, 140], typical: 138 },
    pitch: { scales: [["minor", 1]] },
    harmony: {
      presets: [
        ["aeolian", 0.6],
        ["sad-pop", 0.4],
      ],
      rhythm: [[0.5, 1]],
    },
    bass: {
      behaviour: [
        ["octave", 0.5],
        ["ostinato", 0.5],
      ],
      onsets: grid("..x...x...x...x."),
    },
    texture: { roles: { chords: role("saw"), arp: role("pluck") } },
    rhythm: { onsets: { arp: grid("x.xxx.xxx.xxx.xx") } },
  }),
  card({
    id: "hardcore-family",
    abstract: true,
    summary: "hardcore: 150-200 bpm, distorted kick, minor riffs",
    tempo: { bpm: [150, 200], typical: 170 },
    mix: { fx: { kick: { distort: "crunch" } }, loudness: "loud" },
    texture: { roles: { kick: MACHINE } },
  }),
  card({
    id: "downtempo-family",
    abstract: true,
    summary: "downtempo: 70-110 bpm, broken beats, jazz-tinged chords, space",
    tempo: { bpm: [70, 110], typical: 90 },
    groove: { swingRatio: [1, 1.3] },
    rhythm: {
      onsets: {
        kick: grid("x.....x...x....."),
        snare: grid("....x.......x..."),
        clap: null,
      },
    },
    harmony: { sevenths: 0.8 },
    texture: {
      roles: { snare: MACHINE, clap: null, chords: role("epiano", "keys:0.5") },
    },
    mix: { space: 0.5, loudness: "streaming" },
  }),
  card({
    id: "ambient-family",
    abstract: true,
    summary: "ambient: no kit, drones and slow pads, modal stasis, long tails",
    tempo: { bpm: [60, 100], typical: 80 },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    melody: { density: [0, 1], repetition: 0.5 },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      roles: {
        kick: null,
        clap: null,
        hat: null,
        openhat: null,
        chords: null,
        pad: role("strings", "granular:0.6"),
        drone: role("organ", "cloud:0.5"),
        lead: maybe("bell", "pluck:0.5"),
      },
    },
    mix: { space: 0.85, loudness: "ambient" },
  }),
  card({
    id: "idm-family",
    abstract: true,
    summary:
      "IDM: irregular programmed beats, odd groupings, glitch, modal colour",
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["7/8", 0.2],
        ["5/4", 0.2],
      ],
    },
    harmony: { model: "modal" },
    rhythm: {
      onsets: {
        kick: grid("x..1..x...1.x..."),
        clap: grid("....x..1....x.1."),
        hat: grid("x1x1x1x1x1x1x1x1"),
      },
    },
  }),
  card({
    id: "synthwave-family",
    abstract: true,
    summary:
      "synthwave and chip: gated backbeat, 16th-note octave bass, minor pop chords",
    tempo: { bpm: [80, 120], typical: 100 },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: BACKBEAT_CLAP,
        clap: null,
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    harmony: {
      presets: [
        ["sad-pop", 0.5],
        ["aeolian", 0.5],
      ],
    },
    bass: { behaviour: [["octave", 1]], onsets: grid("xxxxxxxxxxxxxxxx") },
    texture: {
      roles: {
        snare: MACHINE,
        clap: null,
        chords: role("saw"),
        lead: role("square", "lead:0.6"),
      },
    },
  }),
]);
