/**
 * Caribbean and Latin America (quality-08 family `americas`). Root and
 * branch cards only; the family lane adds leaves.
 */

import { grid, maybe, role } from "./parts.ts";
import { card, type StyleCard } from "./schema.ts";

export const AMERICAS_CARDS: readonly StyleCard[] = Object.freeze([
  card({
    id: "caribbean",
    abstract: true,
    summary:
      "off-beat skank and one-drop: guitar and keys on the and, bass melodic and heavy",
    tempo: { bpm: [65, 110], typical: 76 },
    groove: { subdivision: 4, swingRatio: [1, 1.25] },
    rhythm: {
      onsets: {
        kick: grid("........x......."),
        rim: grid("........x......."),
        hat: grid("x.x.x.x.x.x.x.x."),
        chords: grid("..x...x...x...x."),
      },
    },
    pitch: {
      scales: [
        ["minor", 0.4],
        ["major", 0.4],
        ["dorian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["dorian-vamp", 0.4],
        ["axis", 0.3],
        ["aeolian", 0.3],
      ],
      rhythm: [
        [1, 0.5],
        [0.5, 0.5],
      ],
    },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x..x..x...x.x...") },
    texture: {
      roles: {
        snare: null,
        rim: role("drums"),
        chords: role("electric", "hammond:0.5"),
        bass: role("ebass"),
      },
    },
  }),
  card({
    id: "jamaican",
    abstract: true,
    summary:
      "Jamaican: one-drop and steppers kicks, skank on the off-beat, dub space",
    mix: { space: 0.5 },
  }),
  card({
    id: "trinidad",
    abstract: true,
    summary: "calypso and soca: 2/4 drive, major I-IV-V, steelpan and brass",
    tempo: { bpm: [100, 160], typical: 125 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["axis", 0.5],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x...x...x...x..."),
        snare: grid("...x..x....x..x."),
      },
    },
    texture: {
      roles: { snare: role("drums"), lead: role("steelpan", "trumpet:0.5") },
    },
  }),
  card({
    id: "french-caribbean",
    abstract: true,
    summary: "kompa and zouk: rolling mid-tempo, tanbou and guitar arpeggios",
    tempo: { bpm: [90, 130], typical: 110 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.4],
      ],
    },
  }),
  card({
    id: "latin-america",
    abstract: true,
    summary:
      "clave-led: the 3-2 or 2-3 clave, tumbao bass anticipations, montuno piano",
    tempo: { bpm: [90, 200], typical: 120 },
    groove: { subdivision: 4 },
    rhythm: {
      onsets: {
        bell: grid("x..x..x...x.x..."),
        perc: grid("...x..x....x..x."),
        kick: grid("...x.......x...."),
        snare: null,
        hat: null,
        chords: grid("x.xx.xx.x.xx.xx."),
      },
    },
    pitch: {
      scales: [
        ["minor", 0.4],
        ["major", 0.4],
        ["harmonic-minor", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["andalusian", 0.3],
        ["fifties", 0.3],
        ["minor-ii-v", 0.4],
      ],
      rhythm: [
        [2, 0.5],
        [1, 0.5],
      ],
      sevenths: 0.3,
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("...x..x....x..x.") },
    texture: {
      roles: {
        snare: null,
        hat: null,
        kick: role("drums"),
        bell: role("bell"),
        perc: role("drums"),
        chords: role("piano", "tres:0.5"),
        lead: role("trumpet", "sing:0.6", "flute:0.3"),
      },
    },
  }),
  card({
    id: "cuban",
    abstract: true,
    summary:
      "Cuban son and its heirs: son clave, tres guajeo, anticipated bass",
  }),
  card({
    id: "puerto-rico-dr",
    abstract: true,
    summary: "salsa, bomba, merengue and bachata: clave, tumbao, guira drive",
  }),
  card({
    id: "mexican",
    abstract: true,
    summary:
      "Mexican: 3/4 and 6/8 sesquialtera, I-V7 polka bass, brass and accordion",
    meter: {
      signatures: [
        ["3/4", 0.5],
        ["6/8", 0.3],
        ["2/4", 0.2],
      ],
    },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: { presets: [["fifties", 1]] },
    bass: { behaviour: [["root-fifth", 1]] },
    texture: {
      roles: {
        chords: role("nylon", "acoustic:0.5"),
        lead: role("trumpet", "violin:0.6"),
      },
    },
  }),
  card({
    id: "colombia-venezuela",
    abstract: true,
    summary: "cumbia and joropo: 2/4 cumbia shuffle, 6/8 joropo hemiola",
    rhythm: { onsets: { perc: grid("..x...x...x...x.") } },
  }),
  card({
    id: "andean",
    abstract: true,
    summary:
      "Andean: pentatonic minor, huayno short-long rhythm, charango and quena",
    pitch: {
      scales: [
        ["minor-pentatonic", 0.6],
        ["minor", 0.4],
      ],
    },
    texture: {
      roles: { chords: role("nylon"), lead: role("panpipe", "flute:0.6") },
    },
  }),
  card({
    id: "southern-cone",
    abstract: true,
    summary: "tango and milonga: 3+3+2, harmonic minor, bandoneon marcato",
    pitch: {
      scales: [
        ["harmonic-minor", 0.6],
        ["minor", 0.4],
      ],
    },
    meter: { grouping: [[[3, 3, 2], 1]] },
    rhythm: { onsets: { chords: grid("x..x..x.x..x..x.") } },
    harmony: {
      presets: [
        ["andalusian", 0.5],
        ["minor-ii-v", 0.5],
      ],
    },
    texture: {
      roles: {
        bell: null,
        perc: null,
        kick: null,
        chords: role("piano"),
        lead: role("violin", "clarinet:0.3"),
      },
    },
  }),
  card({
    id: "brazil",
    abstract: true,
    summary:
      "Brazilian: samba 2/4 surdo on two, partido-alto syncopation, bossa harmony",
    groove: { swingRatio: [1, 1.15] },
    rhythm: {
      onsets: {
        kick: grid("....x.......x..."),
        perc: grid("x.xx.x.x..xx.x.x"),
        shaker: grid("xxxxxxxxxxxxxxxx"),
      },
    },
    harmony: { sevenths: 0.7 },
    texture: {
      roles: {
        bell: null,
        shaker: maybe("drums"),
        chords: role("nylon", "piano:0.4"),
        lead: role("flute", "sing:0.6"),
      },
    },
  }),
]);
