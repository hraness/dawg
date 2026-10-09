/**
 * Sub-Saharan Africa, Middle East and North Africa, South Asia (quality-08
 * family `africa-mena-southasia`). `arabic-classical` is the worked
 * non-Western microtonal leaf: maqam bayati with its neutral second as a
 * quarter tone (the 24-tone convention on the `bayati` tuning table),
 * heterophony instead of chords, a sayr that opens on the tonic jins and
 * climbs to the ghammaz (fourth) before returning, and the maqsum iqa as
 * a dum/tak cycle on the frame drum.
 */

import { grid, intervals, maybe, role } from "./parts.ts";
import { card, type StyleCard } from "./schema.ts";

export const AFRICA_MENA_SOUTHASIA_CARDS: readonly StyleCard[] = Object.freeze([
  card({
    id: "africa",
    abstract: true,
    summary:
      "timeline-led polyrhythm: a bell pattern, interlocking parts, cyclic short forms",
    meter: {
      signatures: [
        ["12/8", 0.5],
        ["4/4", 0.5],
      ],
      hypermeter: [[2, 1]],
    },
    tempo: { bpm: [90, 140], typical: 118 },
    groove: { subdivision: 4, humanize: { timingMs: 6, velocity: 0.08 } },
    rhythm: {
      onsets: {
        bell: grid("x.x.xx.x.x.x"),
        kick: grid("x.....x....."),
        perc: grid("..x..x..x..x"),
        shaker: grid("xxxxxxxxxxxx"),
      },
    },
    pitch: {
      scales: [
        ["major", 0.5],
        ["major-pentatonic", 0.3],
        ["mixolydian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["fifties", 0.5],
      ],
      rhythm: [
        [1, 0.6],
        [2, 0.4],
      ],
      sevenths: 0,
    },
    melody: {
      repetition: 0.75,
      phraseBars: [
        [1, 0.5],
        [2, 0.5],
      ],
    },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x..x..x..x..") },
    form: {
      plans: [[["intro", "verse", "chorus", "verse", "chorus"], 1]],
      archetype: "cyclic",
    },
    texture: {
      kind: "interlocking",
      roles: {
        snare: null,
        hat: null,
        kick: role("drums"),
        bell: role("bell"),
        perc: role("drums"),
        shaker: maybe("drums"),
        chords: role("nylon", "mbira:0.6", "marimba:0.4"),
        lead: role("sing", "flute:0.3"),
      },
    },
  }),
  card({
    id: "west-africa",
    abstract: true,
    summary: "12/8 bell timeline, call and response, kora and balafon ostinati",
    texture: { roles: { chords: role("harp", "marimba:0.6") } },
  }),
  card({
    id: "central-africa",
    abstract: true,
    summary: "soukous and rumba: interlocking guitars, sebene sixteenth runs",
    meter: { signatures: [["4/4", 1]] },
    rhythm: {
      onsets: {
        kick: grid("x...x...x...x..."),
        snare: grid("....x.......x..."),
        bell: grid("x..x..x...x.x..."),
      },
    },
    texture: {
      roles: { chords: role("electric"), lead: role("electric", "sing:0.6") },
    },
  }),
  card({
    id: "east-africa",
    abstract: true,
    summary: "pentatonic lyres and taarab: 6/8 lilt, call and response",
    pitch: {
      scales: [
        ["major-pentatonic", 0.5],
        ["minor-pentatonic", 0.5],
      ],
    },
    meter: {
      signatures: [
        ["6/8", 0.6],
        ["4/4", 0.4],
      ],
    },
  }),
  card({
    id: "southern-africa",
    abstract: true,
    summary: "mbira cycles and choral harmony: I-IV-I64-V in a four-bar loop",
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["12/8", 0.4],
      ],
    },
    harmony: { forms: [[["I", "IV", "I", "V"], 1]], sources: { forms: 3 } },
    texture: { roles: { chords: role("mbira", "choir:0.5") } },
  }),
  card({
    id: "mena",
    abstract: true,
    summary:
      "modal monophony and heterophony: maqam or dastgah, iqa cycles, no functional chords",
    meter: {
      signatures: [
        ["8/8", 0.6],
        ["4/4", 0.4],
      ],
    },
    tempo: { bpm: [60, 130], typical: 96 },
    pitch: {
      scales: [
        ["hijaz", 0.4],
        ["nahawand", 0.3],
        ["kurd", 0.3],
      ],
    },
    harmony: { model: "drone", rhythm: [[0.5, 1]], sevenths: 0 },
    melody: {
      contour: [
        ["arch", 0.5],
        ["terraced", 0.5],
      ],
      ambitus: [7, 14],
      range: [57, 81],
      intervals: intervals(6, 2, 0.5, 0.8),
      chordToneRate: 0.3,
      density: [2, 3],
      repetition: 0.4,
      finals: [
        [0, 0.8],
        [5, 0.2],
      ],
    },
    bass: {
      behaviour: [
        ["pedal", 0.6],
        ["none", 0.4],
      ],
    },
    texture: {
      kind: "heterophonic",
      roles: {
        kick: null,
        snare: null,
        hat: null,
        chords: null,
        perc: role("daf", "framedrum:0.6", "tabla:0.3"),
        drone: maybe("oud", "strings:0.4"),
        lead: role("oud", "ney:0.7", "violin:0.5", "santur:0.3"),
        counter: maybe("ney", "violin:0.6"),
      },
    },
    mix: {
      levels: { perc: -4, lead: 0, counter: -4, drone: -10 },
      space: 0.45,
    },
  }),
  card({
    id: "arabic-maqam",
    abstract: true,
    summary: "Arabic maqam: ajnas joined at the ghammaz, quarter-tone seconds",
  }),
  card({
    id: "arabic-classical",
    summary:
      "maqam bayati in quarter tones, maqsum iqa, heterophonic oud and ney",
    seedSalt: 1932,
    tempo: { bpm: [72, 112], typical: 92 },
    meter: {
      signatures: [["8/8", 1]],
      cycle: {
        kind: "iqa",
        name: "maqsum",
        beats: 8,
        divisions: [8],
        strokes: ["dum", "tak", ".", "tak", "dum", ".", "tak", "."],
        stress: [1, 5],
      },
    },
    pitch: {
      tuning: "bayati",
      scales: [["bayati", 1]],
      tonic: [[2, 1]],
      maqam: { sayr: [0, 0, 2, 3, 0], ghammaz: 3 },
    },
    melody: {
      ambitus: [7, 12],
      finals: [
        [0, 0.85],
        [3, 0.15],
      ],
      intervals: intervals(7, 1.5, 0.4, 0.6),
    },
    texture: {
      roles: {
        lead: role("oud", "violin:0.4"),
        counter: role("ney"),
        perc: role("daf", "framedrum:0.5"),
      },
    },
  }),
  card({
    id: "persian-turkic",
    abstract: true,
    summary: "dastgah and makam: gushe phrases, avaz free rhythm, aksak usul",
    pitch: {
      scales: [
        ["shur", 0.4],
        ["chahargah", 0.3],
        ["homayoun", 0.3],
      ],
    },
    meter: {
      signatures: [
        ["6/8", 0.4],
        ["9/8", 0.3],
        ["8/8", 0.3],
      ],
    },
    texture: {
      roles: { lead: role("santur", "setar:0.6", "ney:0.5", "kemence:0.4") },
    },
  }),
  card({
    id: "jewish",
    abstract: true,
    summary: "freygish and misheberakh modes, doina freedom, bulgar 3+3+2",
    pitch: {
      scales: [
        ["phrygian-dominant", 0.6],
        ["dorian", 0.4],
      ],
    },
    meter: {
      signatures: [
        ["8/8", 0.6],
        ["4/4", 0.4],
      ],
      grouping: [[[3, 3, 2], 1]],
    },
    harmony: { model: "modal" },
    texture: {
      roles: {
        lead: role("clarinet", "violin:0.6"),
        chords: role("piano", "strings:0.4"),
      },
    },
  }),
  card({
    id: "south-asia",
    abstract: true,
    summary:
      "raga over tanpura drone in a tala cycle: alap, then composition and improvisation",
    meter: { signatures: [["4/4", 1]], hypermeter: [[4, 1]] },
    tempo: { bpm: [50, 140], typical: 80 },
    pitch: {
      scales: [
        ["yaman", 0.3],
        ["bhairav", 0.25],
        ["kafi", 0.25],
        ["khamaj", 0.2],
      ],
    },
    harmony: { model: "drone", rhythm: [[0.25, 1]], sevenths: 0 },
    melody: {
      contour: [
        ["arch", 0.6],
        ["ascending", 0.4],
      ],
      ambitus: [7, 19],
      chordToneRate: 0.25,
      intervals: intervals(6, 2, 0.6, 0.8),
      finals: [
        [0, 0.7],
        [7, 0.3],
      ],
    },
    bass: { behaviour: [["none", 1]] },
    rhythm: { onsets: { perc: grid("x..x..x.x..x..x.") } },
    texture: {
      kind: "heterophonic",
      roles: {
        kick: null,
        snare: null,
        hat: null,
        chords: null,
        bass: null,
        drone: role("tanpura"),
        perc: role("tabla"),
        lead: role("sitar", "bansuri:0.7", "sing:0.4"),
      },
    },
    mix: { space: 0.5 },
  }),
  card({
    id: "hindustani",
    abstract: true,
    summary:
      "Hindustani raga: teental 16-beat cycle, vadi and samvadi emphasis, meend",
    meter: {
      cycle: {
        kind: "tala",
        name: "teental",
        beats: 16,
        divisions: [4, 4, 4, 4],
        strokes: [
          "dha",
          "dhin",
          "dhin",
          "dha",
          "dha",
          "dhin",
          "dhin",
          "dha",
          "dha",
          "tin",
          "tin",
          "ta",
          "ta",
          "dhin",
          "dhin",
          "dha",
        ],
        stress: [1, 5, 13],
        release: [9, 10, 11, 12],
      },
    },
  }),
  card({
    id: "carnatic",
    abstract: true,
    summary:
      "Carnatic raga: adi tala, gamaka-rich lines, kriti form, mridangam",
    pitch: {
      scales: [
        ["major", 0.3],
        ["kafi", 0.3],
        ["bhairavi", 0.4],
      ],
    },
    texture: { roles: { lead: role("violin", "bansuri:0.5", "sing:0.5") } },
  }),
  card({
    id: "south-asian-popular",
    abstract: true,
    summary: "film and pop: raga-tinged melody over chords, dholak and kit",
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.5],
        ["sad-pop", 0.5],
      ],
    },
    pitch: {
      scales: [
        ["minor", 0.4],
        ["kafi", 0.3],
        ["khamaj", 0.3],
      ],
    },
    bass: { behaviour: [["root", 1]] },
    texture: {
      roles: {
        kick: role("drums"),
        snare: role("drums"),
        bass: role("bass"),
        chords: role("strings", "keys:0.5"),
      },
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x......."),
        snare: grid("....x.......x..."),
      },
    },
  }),
]);
