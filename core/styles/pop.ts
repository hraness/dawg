/**
 * Pop, hip hop and breakbeat bass (quality-08 family `pop`). Root and
 * branch cards only; `breakbeat-family` sits under `electronic` in the
 * tree but belongs to this family's file.
 */

import { grid, intervals, kit, maybe, role } from "./parts.ts";
import { card, type StyleCard } from "./schema.ts";

const MACHINE = Object.freeze({
  required: true,
  voices: Object.freeze([kit("syn808"), kit("trap", 0.6)]),
});

export const POP_CARDS: readonly StyleCard[] = Object.freeze([
  card({
    id: "pop",
    abstract: true,
    summary:
      "song-first: hooks that repeat, I-V-vi-IV loops, verse-pre-chorus-chorus",
    tempo: { bpm: [80, 130], typical: 112 },
    rhythm: {
      onsets: {
        kick: grid("x.......x.x....."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    harmony: {
      presets: [
        ["axis", 0.4],
        ["sad-pop", 0.3],
        ["fifties", 0.15],
        ["canon", 0.15],
      ],
    },
    melody: {
      repetition: 0.75,
      ambitus: [7, 12],
      phraseBars: [
        [2, 0.5],
        [4, 0.5],
      ],
      intervals: intervals(5, 3, 0.8, 1.5),
    },
    form: {
      plans: [
        [
          [
            "intro",
            "verse",
            "pre",
            "chorus",
            "verse",
            "pre",
            "chorus",
            "bridge",
            "chorus",
          ],
          1,
        ],
      ],
    },
    texture: {
      roles: {
        chords: role("piano", "acoustic:0.5", "keys:0.5"),
        lead: role("sing", "lead:0.5"),
        pad: maybe("strings"),
      },
    },
  }),
  card({
    id: "traditional-pop",
    abstract: true,
    summary:
      "crooner and standards pop: 32-bar AABA, ii-V turnarounds, strings",
    groove: { subdivision: 2, swingRatio: [1, 1.6] },
    harmony: {
      presets: [
        ["turnaround", 0.5],
        ["ii-v-i", 0.5],
      ],
      sevenths: 0.6,
    },
    form: {
      plans: [[["verse", "verse", "bridge", "verse"], 1]],
      archetype: "AABA",
    },
    texture: {
      roles: { chords: role("strings", "piano:0.6"), bass: role("contrabass") },
    },
  }),
  card({
    id: "sixties-pop",
    abstract: true,
    summary:
      "1960s pop: fifties progressions, tambourine backbeat, vocal harmony",
    harmony: {
      presets: [
        ["fifties", 0.6],
        ["axis", 0.4],
      ],
    },
    groove: { subdivision: 2 },
    texture: {
      roles: { chords: role("jangle", "piano:0.5"), counter: maybe("choir") },
    },
  }),
  card({
    id: "modern-pop",
    abstract: true,
    summary:
      "modern pop: programmed drums, four-chord loops, sparse verses, big choruses",
    rhythm: { onsets: { clap: grid("....x.......x...") } },
    texture: {
      roles: { clap: maybe("drums"), chords: role("keys", "pluck:0.5") },
    },
  }),
  card({
    id: "hip-hop",
    abstract: true,
    summary:
      "beat-first: boom-bap or trap grids, loops of one to four chords, rap-led",
    tempo: { bpm: [70, 100], typical: 90 },
    groove: { swingRatio: [1, 1.3], humanize: { timingMs: 6, velocity: 0.08 } },
    rhythm: {
      onsets: {
        kick: grid("x......x..x....."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["dorian", 0.3],
        ["minor-pentatonic", 0.2],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.4],
        ["dorian-vamp", 0.3],
        ["sad-pop", 0.3],
      ],
      rhythm: [
        [1, 0.5],
        [0.5, 0.5],
      ],
      sevenths: 0.5,
    },
    melody: { density: [1, 2], repetition: 0.85, ambitus: [3, 8] },
    bass: {
      behaviour: [
        ["root", 0.6],
        ["ostinato", 0.4],
      ],
    },
    form: {
      plans: [[["intro", "verse", "chorus", "verse", "chorus", "outro"], 1]],
    },
    texture: {
      roles: {
        kick: MACHINE,
        snare: MACHINE,
        hat: MACHINE,
        chords: role("epiano", "keys:0.5", "strings:0.3"),
        lead: role("vocal", "pluck:0.5"),
      },
    },
  }),
  card({
    id: "old-school",
    abstract: true,
    summary:
      "old-school hip hop: break loops, electro drum machines, funk samples feel",
    tempo: { bpm: [95, 115], typical: 104 },
  }),
  card({
    id: "regional-rap",
    abstract: true,
    summary: "regional rap: boom-bap swing, bounce, crunk and g-funk grooves",
    groove: { swingRatio: [1.1, 1.4] },
  }),
  card({
    id: "modern-rap",
    abstract: true,
    summary: "trap-era rap: half-time snare, rolling hats, 808 glides",
    tempo: { bpm: [130, 160], typical: 140 },
    rhythm: {
      onsets: {
        kick: grid("x.....x.......x."),
        snare: grid("........x......."),
        hat: grid("xxxxxxxxxxxxxxxx"),
      },
    },
    bass: { behaviour: [["root", 1]] },
  }),
  card({
    id: "breakbeat-family",
    abstract: true,
    summary:
      "breakbeat and bass: syncopated broken kits, sub bass, 130-175 bpm",
    tempo: { bpm: [130, 175], typical: 170 },
    rhythm: {
      onsets: {
        kick: grid("x.........x....."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    pitch: {
      scales: [
        ["minor", 0.7],
        ["phrygian", 0.3],
      ],
    },
    harmony: { presets: [["aeolian", 1]], rhythm: [[0.5, 1]] },
    bass: {
      behaviour: [
        ["root", 0.5],
        ["octave", 0.5],
      ],
      range: [26, 45],
    },
    form: {
      plans: [[["intro", "build", "drop", "breakdown", "drop", "outro"], 1]],
      archetype: "build-drop",
    },
    texture: {
      roles: {
        kick: MACHINE,
        snare: MACHINE,
        hat: MACHINE,
        bass: role("bass", "saw:0.5"),
        chords: role("keys", "strings:0.5"),
        lead: maybe("lead"),
      },
    },
  }),
]);
