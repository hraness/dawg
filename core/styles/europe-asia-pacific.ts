/**
 * European folk, East and Southeast Asia, Oceania (quality-08 family
 * `europe-asia-pacific`). Root and branch cards only.
 */

import { grid, intervals, kitRoles, maybe, role } from "./parts.ts";
import {
  AGUNG,
  CHING,
  DEGUNG,
  GILAK,
  LADRANG,
  pathetFinals,
  pathetPitch,
  SI_WA,
} from "./gamelan.ts";
import { card, type CycleSpec, type StyleCard } from "./schema.ts";

const NO_KIT = Object.freeze({ kick: null, snare: null, hat: null });

// ---------------------------------------------------------------------------
// Celtic and British
//
// References: Breandán Breathnach, "Folk Music and Dances of Ireland"
// (1971); Roderick Cannon, "The Highland Bagpipe and Its Music" (1988).

const KIT_LIGHT = kitRoles("acoustic", ["kick", "snare"], ["hat"]);

/** Jig and reel feel: the lift on the first of each beat group. */
const JIG_GROOVE = { subdivision: 3, velocity: [1, 0.7, 0.8] } as const;

/** Flamenco 12-beat compas (soleá, bulería): accents 3, 6, 8, 10, 12. */
export const SOLEA_COMPAS: CycleSpec = Object.freeze({
  kind: "compas",
  name: "solea",
  beats: 12,
  divisions: [3, 3, 2, 2, 2],
  strokes: Object.freeze([
    "tak",
    "tak",
    "dum",
    "tak",
    "tak",
    "dum",
    "tak",
    "dum",
    "tak",
    "dum",
    "tak",
    "dum",
  ]),
  low: Object.freeze(["dum"]),
  stress: Object.freeze([3, 6, 8, 10, 12]),
});

/** Rumba flamenca: the 3+3+2 ventilador cell on eighths. */
const RUMBA_CELL = grid("x..x..x.");

const EUROPE_LEAVES: readonly StyleCard[] = [
  card({
    id: "irish-trad",
    summary:
      "reel and jig: AABB tunes in 8-bar strains, dorian and mixolydian, roll and cut ornaments, unison session heterophony",
    tempo: { bpm: [160, 220], typical: 190 },
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["6/8", 0.5],
      ],
      hypermeter: [[8, 1]],
    },
    melody: {
      density: [3, 4],
      ambitus: [9, 14],
      range: [62, 86],
      phraseBars: [[4, 1]],
      finals: [
        [0, 0.7],
        [4, 0.3],
      ],
    },
    texture: {
      roles: {
        lead: role("fiddle", "tinwhistle:0.6", "flute:0.5"),
        counter: maybe("fiddle", "flute:0.5"),
        chords: role("acoustic", "lute:0.4"),
        perc: maybe("bodhran"),
      },
    },
  }),
  card({
    id: "sean-nos",
    summary:
      "sean-nós: unaccompanied melismatic solo song, free strophic rubato, decorated stepwise lines, no harmony",
    tempo: { bpm: [56, 80], typical: 66 },
    meter: { signatures: [["4/4", 1]] },
    harmony: { model: "none" },
    melody: {
      density: [1, 3],
      intervals: intervals(8, 2, 0.4, 0.5),
      phraseBars: [[4, 1]],
      contour: [["arch", 1]],
    },
    bass: { behaviour: [["none", 1]] },
    texture: {
      kind: "monophonic",
      roles: {
        chords: null,
        bass: null,
        perc: null,
        lead: role("sing"),
      },
    },
    mix: { space: 0.4 },
  }),
  card({
    id: "scottish-trad",
    summary:
      "strathspey: dotted snap (short-long Scotch snap), double-tonic I-bVII shift, pipe-scale mixolydian",
    tempo: { bpm: [110, 150], typical: 128 },
    meter: { signatures: [["4/4", 1]] },
    groove: { subdivision: 4, velocity: [1, 0.9, 0.5, 0.8] },
    pitch: { scales: [["mixolydian", 1]] },
    harmony: {
      presets: null,
      forms: [[["I", "I", "bVII", "bVII"], 1]],
      cadences: [["bVII-I", 1]],
    },
    melody: { density: [2, 4] },
    texture: {
      roles: {
        lead: role("fiddle", "tinwhistle:0.5"),
        drone: maybe("reeds"),
        chords: role("acoustic", "piano:0.4"),
        perc: maybe("bodhran"),
      },
    },
    rhythm: { onsets: { perc: grid("x.x.x.x.") } },
  }),
  card({
    id: "piobaireachd",
    summary:
      "ceòl mòr: theme (ùrlar) and variations over a fixed pipe drone, nine-note mixolydian chanter, slow pulse",
    tempo: { bpm: [40, 66], typical: 52 },
    meter: { signatures: [["4/4", 1]] },
    pitch: { scales: [["mixolydian", 1]] },
    harmony: { model: "drone" },
    melody: {
      density: [1, 2],
      ambitus: [9, 9],
      range: [67, 79],
      repetition: 0.8,
      phraseBars: [[4, 1]],
    },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      kind: "monophonic",
      roles: {
        chords: null,
        perc: null,
        drone: role("reeds"),
        bass: maybe("reeds"),
        lead: role("reeds"),
      },
    },
    form: { archetype: "theme-and-variations" },
  }),
  card({
    id: "english-folk",
    summary:
      "morris and ceilidh: 2-bar call figures over I-IV-V, major and mixolydian, melodeon and fiddle, stepped hop on beat",
    tempo: { bpm: [100, 130], typical: 112 },
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["6/8", 0.4],
      ],
    },
    pitch: {
      scales: [
        ["major", 0.6],
        ["mixolydian", 0.4],
      ],
    },
    harmony: { presets: [["fifties", 1]], cadences: [["V-I", 1]] },
    texture: {
      roles: {
        lead: role("fiddle", "reeds:0.6"),
        chords: role("reeds", "acoustic:0.5"),
        perc: maybe("framedrum"),
      },
    },
  }),
  card({
    id: "welsh",
    summary:
      "cerdd dant: a sung counter-melody (descant) set over a repeated harp air, major-key diatonic harmony",
    tempo: { bpm: [70, 100], typical: 84 },
    meter: {
      signatures: [
        ["3/4", 0.5],
        ["4/4", 0.5],
      ],
    },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["canon", 0.5],
        ["fifties", 0.5],
      ],
      cadences: [["V-I", 1]],
    },
    melody: { density: [1, 2] },
    texture: {
      kind: "polyphonic",
      roles: {
        chords: role("harp"),
        lead: role("sing"),
        counter: role("harp", "flute:0.4"),
        perc: null,
      },
    },
  }),
  card({
    id: "breton",
    summary:
      "kan ha diskan: two singers in overlapping call and response, an dro and gavotte in 4/4, bombarde and biniou in octave pairs",
    tempo: { bpm: [110, 140], typical: 124 },
    meter: { signatures: [["4/4", 1]], hypermeter: [[4, 1]] },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: { model: "drone" },
    melody: { repetition: 0.85, phraseBars: [[2, 1]] },
    texture: {
      kind: "heterophonic",
      roles: {
        chords: null,
        lead: role("oboe", "sing:0.6"),
        counter: role("reeds", "sing:0.5"),
        drone: maybe("reeds"),
      },
    },
  }),
  card({
    id: "galician",
    summary:
      "muiñeira: 6/8 gaita (bagpipe) over a drone, pandeireta on the dotted pulse, mixolydian and major",
    tempo: { bpm: [150, 190], typical: 168 },
    meter: { signatures: [["6/8", 1]] },
    groove: JIG_GROOVE,
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: { model: "drone" },
    texture: {
      roles: {
        chords: null,
        lead: role("reeds", "oboe:0.4"),
        drone: role("reeds"),
        perc: role("framedrum", "bodhran:0.5"),
      },
    },
    rhythm: { onsets: { perc: grid("x.5x.5") } },
  }),
  card({
    id: "celtic-fusion",
    summary:
      "celtic rock: trad modal tunes over a rock backbeat on 2 and 4, I-bVII-IV mixolydian loops, electric bass",
    tempo: { bpm: [110, 160], typical: 130 },
    meter: { signatures: [["4/4", 1]] },
    harmony: {
      presets: [
        ["mixolydian-rock", 0.6],
        ["axis", 0.4],
      ],
    },
    bass: { behaviour: [["root-fifth", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        ...KIT_LIGHT,
        bass: role("bassguitar"),
        chords: role("electric", "acoustic:0.5"),
        lead: role("fiddle", "tinwhistle:0.5"),
        perc: null,
      },
    },
    rhythm: {
      onsets: {
        kick: grid("x...x.5."),
        snare: grid("..x...x."),
        hat: grid("xxxxxxxx"),
      },
    },
  }),

  // -------------------------------------------------------------------------
  // Nordic and Baltic
  //
  // References: Jan Ling, "A History of European Folk Music" (1997);
  // Mats Johansson on polska beat asymmetry (2010).
  card({
    id: "nordic-fiddle",
    summary:
      "polska: 3/4 with an uneven, long-first beat, hardingfele sympathetic drone strings, double stops on open fifths",
    tempo: { bpm: [100, 130], typical: 114 },
    meter: { signatures: [["3/4", 1]] },
    groove: {
      subdivision: 2,
      velocity: [1, 0.7],
      microtiming: [0, 0.1],
    },
    harmony: { model: "drone" },
    texture: {
      roles: {
        chords: null,
        lead: role("fiddle", "violin:0.5"),
        counter: maybe("fiddle", "viola:0.5"),
        drone: role("fiddle"),
      },
    },
  }),
  card({
    id: "kulning",
    summary:
      "kulning: high head-voice herding calls, long held tones and falling glides, free rhythm, no accompaniment",
    tempo: { bpm: [40, 66], typical: 50 },
    meter: { signatures: [["4/4", 1]] },
    pitch: { scales: [["major-pentatonic", 1]] },
    harmony: { model: "none" },
    melody: {
      density: [0, 1],
      range: [72, 91],
      contour: [["descending", 1]],
      intervals: intervals(2, 3, 2, 0.4),
    },
    bass: { behaviour: [["none", 1]] },
    texture: {
      kind: "monophonic",
      roles: { chords: null, bass: null, lead: role("sing") },
    },
    mix: { space: 0.75 },
  }),
  card({
    id: "joik",
    summary:
      "Sámi joik: a short cyclic pentatonic figure repeated without end, wide leaps of fourths and fifths, no fixed close",
    tempo: { bpm: [80, 120], typical: 96 },
    meter: { signatures: [["4/4", 1]] },
    pitch: { scales: [["minor-pentatonic", 1]] },
    harmony: { model: "none" },
    melody: {
      repetition: 0.9,
      phraseBars: [[2, 1]],
      intervals: intervals(2, 4, 3, 0.8),
      contour: [["wave", 1]],
    },
    bass: { behaviour: [["none", 1]] },
    texture: {
      kind: "monophonic",
      roles: {
        chords: null,
        bass: null,
        lead: role("sing"),
        perc: maybe("framedrum"),
      },
    },
    rhythm: { onsets: { perc: grid("x.x.x.x.") } },
  }),
  card({
    id: "rune-singing",
    summary:
      "runo song: trochaic tetrameter on a 5-note range, 5/4 lines, lead singer and chorus overlap on the line end",
    tempo: { bpm: [90, 130], typical: 108 },
    meter: { signatures: [["5/4", 1]], grouping: [[[2, 3], 1]] },
    pitch: { scales: [["minor", 1]] },
    harmony: { model: "none" },
    melody: {
      ambitus: [5, 5],
      repetition: 0.9,
      phraseBars: [[1, 1]],
      intervals: intervals(8, 1, 0.1, 1),
    },
    bass: { behaviour: [["none", 1]] },
    texture: {
      roles: {
        chords: null,
        bass: null,
        lead: role("sing"),
        counter: role("choir"),
        drone: maybe("dulcimer"),
      },
    },
  }),
  card({
    id: "baltic-folk",
    summary:
      "sutartinės: two-voice canon in clashing seconds, dainas in narrow-range strophes, kanklės drone",
    tempo: { bpm: [80, 110], typical: 92 },
    meter: {
      signatures: [
        ["2/4", 0.6],
        ["4/4", 0.4],
      ],
    },
    pitch: {
      scales: [
        ["major", 0.5],
        ["dorian", 0.5],
      ],
    },
    harmony: { model: "drone" },
    melody: {
      ambitus: [4, 7],
      repetition: 0.9,
      intervals: intervals(8, 1.5, 0.2, 1),
    },
    texture: {
      kind: "polyphonic",
      roles: {
        chords: null,
        lead: role("sing"),
        counter: role("sing", "choir:0.5"),
        drone: role("dulcimer"),
      },
    },
  }),
  card({
    id: "nordic-folk-revival",
    summary:
      "ambient nordic folk: frame-drum ostinato, lyre drones, aeolian and dorian chant over pedal point",
    tempo: { bpm: [70, 100], typical: 84 },
    meter: { signatures: [["4/4", 1]] },
    harmony: {
      model: "modal",
      rhythm: [[0.5, 1]],
    },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      roles: {
        chords: role("lute", "harp:0.5"),
        pad: maybe("strings", "choir:0.5"),
        lead: role("sing", "flute:0.4"),
        perc: role("framedrum"),
      },
    },
    rhythm: { onsets: { perc: grid("x..x..x.x...x...") } },
    mix: { space: 0.6 },
  }),

  // -------------------------------------------------------------------------
  // Western Europe
  //
  // References: Peter Manuel, "Popular Musics of the Non-Western World"
  // (1988) on Iberian and Mediterranean dance forms; Max Peter Baumann,
  // "Musikfolklore und Musikfolklorismus" (1976) on yodel and Ländler.
  card({
    id: "volksmusik",
    summary:
      "Ländler: 3/4 oom-pah-pah, tonic and dominant only, yodel leaps across the register break, reeds and tuba",
    tempo: { bpm: [120, 160], typical: 138 },
    meter: { signatures: [["3/4", 1]] },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: null,
      forms: [[["I", "I", "V", "V", "V", "V", "I", "I"], 1]],
      cadences: [["V-I", 1]],
      voicing: { strokes: [["waltz", 1]] },
    },
    melody: { intervals: intervals(3, 5, 2, 0.5) },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x.....") },
    texture: {
      kind: "homophonic",
      roles: {
        bass: role("tuba"),
        chords: role("reeds", "nylon:0.4"),
        lead: role("sing", "clarinet:0.5", "trumpet:0.4"),
        perc: null,
      },
    },
  }),
  card({
    id: "polka",
    summary:
      "polka: 2/4 oom-pah, bass on the beat and chords on the off-beat, I-V-I in major, clarinet and reeds lead",
    tempo: { bpm: [110, 140], typical: 126 },
    meter: { signatures: [["2/4", 1]], hypermeter: [[8, 1]] },
    groove: { subdivision: 2, velocity: [1, 0.8] },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: null,
      forms: [[["I", "I", "V", "V", "V", "V", "I", "I"], 1]],
      cadences: [["V-I", 1]],
      rhythm: [[1, 1]],
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x.x.") },
    texture: {
      kind: "homophonic",
      roles: {
        ...kitRoles("acoustic", ["kick", "snare"]),
        bass: role("tuba"),
        chords: role("reeds"),
        lead: role("clarinet", "trumpet:0.6", "reeds:0.4"),
        perc: null,
      },
    },
    rhythm: {
      onsets: { kick: grid("x.x."), snare: grid(".x.x"), chords: grid(".x.x") },
    },
  }),
  card({
    id: "waltz-folk",
    summary:
      "folk waltz: 3/4 with bass on 1 and chords on 2 and 3, I-IV-V-I in major, musette reeds",
    tempo: { bpm: [130, 180], typical: 150 },
    meter: { signatures: [["3/4", 1]] },
    pitch: {
      scales: [
        ["major", 0.7],
        ["harmonic-minor", 0.3],
      ],
    },
    harmony: {
      presets: [["fifties", 1]],
      voicing: { strokes: [["waltz", 1]] },
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x.....") },
    texture: {
      kind: "homophonic",
      roles: {
        bass: role("contrabass", "tuba:0.4"),
        chords: role("reeds", "nylon:0.5"),
        lead: role("reeds", "violin:0.5"),
        perc: null,
      },
    },
    rhythm: { onsets: { chords: grid("..x.x.") } },
  }),
  card({
    id: "levenslied",
    summary:
      "levenslied: sentimental strophic ballad with a sing-along refrain, waltz or schlager 4/4, I-vi-IV-V, key change up a step",
    tempo: { bpm: [90, 130], typical: 108 },
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["3/4", 0.4],
      ],
    },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["fifties", 0.6],
        ["axis", 0.4],
      ],
    },
    texture: {
      kind: "homophonic",
      roles: {
        ...KIT_LIGHT,
        bass: role("bass"),
        chords: role("reeds", "piano:0.6"),
        lead: role("sing"),
        perc: null,
      },
    },
    rhythm: {
      onsets: { kick: grid("x...x..."), snare: grid("..x...x."), hat: null },
    },
  }),
  card({
    id: "basque",
    summary:
      "Basque trikitixa and txalaparta: two players interlock on wooden planks in fast 5/8 and 6/8 cells, trikitixa reeds over a tambourine",
    tempo: { bpm: [130, 180], typical: 150 },
    meter: {
      signatures: [
        ["5/8", 0.5],
        ["6/8", 0.5],
      ],
      grouping: [
        [[2, 3], 0.5],
        [[3, 3], 0.5],
      ],
    },
    pitch: {
      scales: [
        ["major", 0.5],
        ["mixolydian", 0.5],
      ],
    },
    texture: {
      kind: "interlocking",
      roles: {
        chords: role("reeds"),
        lead: role("reeds", "oboe:0.4"),
        perc: role("xylophone", "framedrum:0.5"),
      },
    },
    rhythm: { onsets: { perc: grid("x.x.x.") } },
  }),
  card({
    id: "occitan",
    summary:
      "Occitan bourrée: 3/8 and 2/4 dance over the hurdy-gurdy's drone and trompette buzz, mixolydian and dorian",
    tempo: { bpm: [110, 150], typical: 126 },
    meter: {
      signatures: [
        ["3/4", 0.5],
        ["2/4", 0.5],
      ],
    },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["dorian", 0.5],
      ],
    },
    harmony: { model: "drone" },
    texture: {
      roles: {
        chords: null,
        drone: role("fiddle", "reeds:0.5"),
        lead: role("fiddle", "reeds:0.5"),
        perc: maybe("framedrum"),
      },
    },
  }),
  card({
    id: "italian-folk",
    summary:
      "tarantella and pizzica: fast 6/8 tamburello triplets, i-V7 harmonic minor alternation, tremolo plucked strings",
    tempo: { bpm: [150, 200], typical: 176 },
    meter: { signatures: [["6/8", 1]] },
    groove: JIG_GROOVE,
    pitch: {
      scales: [
        ["harmonic-minor", 0.7],
        ["major", 0.3],
      ],
    },
    harmony: {
      presets: null,
      forms: [[["i", "V", "V", "i"], 1]],
      cadences: [["V-I", 1]],
    },
    texture: {
      roles: {
        chords: role("nylon", "reeds:0.5"),
        lead: role("tremolo", "violin:0.5", "reeds:0.4"),
        perc: role("framedrum"),
      },
    },
    rhythm: { onsets: { perc: grid("xxxxxx") } },
  }),
  card({
    id: "maltese",
    summary:
      "għana: improvised sung exchanges over a strummed guitar ostinato, Mediterranean minor with a phrygian close",
    tempo: { bpm: [80, 110], typical: 94 },
    meter: { signatures: [["4/4", 1]] },
    pitch: {
      scales: [
        ["harmonic-minor", 0.5],
        ["phrygian-dominant", 0.5],
      ],
    },
    harmony: { presets: [["andalusian", 1]] },
    texture: {
      roles: {
        chords: role("nylon"),
        lead: role("sing"),
        counter: maybe("sing"),
      },
    },
  }),

  // -------------------------------------------------------------------------
  // Iberia
  //
  // References: Peter Manuel, "Modal Harmony in Andalusian, Eastern
  // European, and Turkish Syncretic Musics" (1989); Rui Vieira Nery,
  // "A History of Portuguese Fado" (2012).
  card({
    id: "flamenco",
    summary:
      "soleá compás: 12-beat cycle accented 3, 6, 8, 10, 12, phrygian (Andalusian) cadence iv-III-II-I, rasgueado nylon guitar",
    tempo: { bpm: [100, 160], typical: 128 },
    meter: { signatures: [["12/8", 1]], cycle: SOLEA_COMPAS },
    pitch: { scales: [["phrygian-dominant", 1]] },
    harmony: {
      presets: [["andalusian", 1]],
      cadences: [["bII-I", 1]],
      voicing: { strokes: [["down", 1]] },
    },
    melody: { intervals: intervals(8, 2, 0.4, 0.8) },
    texture: {
      kind: "homophonic",
      roles: {
        chords: role("nylon"),
        lead: role("sing", "nylon:0.4"),
        perc: role("framedrum"),
      },
    },
  }),
  card({
    id: "rumba-flamenca",
    summary:
      "rumba flamenca: the 3+3+2 ventilador strum on nylon guitar, Andalusian cadence loop, palmas on 2 and 4",
    tempo: { bpm: [96, 128], typical: 110 },
    meter: { signatures: [["4/4", 1]] },
    harmony: {
      presets: [["andalusian", 1]],
      voicing: { strokes: [["funk", 1]] },
    },
    texture: {
      roles: {
        bass: role("bass"),
        chords: role("nylon"),
        lead: role("sing", "nylon:0.4"),
        perc: role("framedrum"),
      },
    },
    rhythm: { onsets: { chords: RUMBA_CELL, perc: grid("..x...x.") } },
  }),
  card({
    id: "copla",
    summary:
      "copla: orchestral song in three parts, minor verse turning to a major refrain (modal interchange), pasodoble 2/4 lilt",
    tempo: { bpm: [90, 120], typical: 104 },
    meter: {
      signatures: [
        ["2/4", 0.6],
        ["4/4", 0.4],
      ],
    },
    pitch: {
      scales: [
        ["harmonic-minor", 0.6],
        ["major", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["andalusian", 0.5],
        ["fifties", 0.5],
      ],
      cadences: [["V-I", 1]],
    },
    texture: {
      kind: "homophonic",
      roles: {
        bass: role("contrabass"),
        chords: role("strings", "piano:0.5"),
        lead: role("sing"),
        counter: maybe("violins", "trumpet:0.4"),
        perc: null,
      },
    },
  }),
  card({
    id: "jota",
    summary:
      "jota: fast 3/4 with castanet triplets, alternating tonic and dominant only, sung copla between danced strains",
    tempo: { bpm: [150, 200], typical: 174 },
    meter: { signatures: [["3/4", 1]] },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: null,
      forms: [[["I", "V", "V", "I"], 1]],
      cadences: [["V-I", 1]],
      voicing: { strokes: [["waltz", 1]] },
    },
    texture: {
      roles: {
        chords: role("nylon", "lute:0.5"),
        lead: role("lute", "sing:0.6"),
        perc: role("framedrum"),
      },
    },
    rhythm: { onsets: { perc: grid("x.xxx.") } },
  }),
  card({
    id: "catalan",
    summary:
      "sardana: cobla of shawms (tenora), flabiol and brass, curts and llargs sections in 6/8, major tonality",
    tempo: { bpm: [90, 120], typical: 104 },
    meter: {
      signatures: [
        ["6/8", 0.6],
        ["2/4", 0.4],
      ],
    },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["canon", 0.5],
      ],
    },
    texture: {
      kind: "homophonic",
      roles: {
        bass: role("contrabass", "tuba:0.5"),
        chords: role("cornet", "horn:0.5"),
        lead: role("oboe", "flute:0.4"),
        perc: maybe("framedrum"),
      },
    },
  }),
  card({
    id: "fado",
    summary:
      "fado: saudade in minor with a turn to the parallel major, guitarra portuguesa counter-lines, i-iv-V7-i, rubato voice",
    tempo: { bpm: [60, 96], typical: 76 },
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["2/4", 0.4],
      ],
    },
    pitch: {
      scales: [
        ["harmonic-minor", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["minor-ii-v", 0.5],
        ["aeolian", 0.5],
      ],
      cadences: [["V-I", 1]],
    },
    texture: {
      kind: "homophonic",
      roles: {
        bass: maybe("doublebass"),
        chords: role("nylon"),
        lead: role("sing"),
        counter: role("lute"),
        perc: null,
      },
    },
  }),

  // -------------------------------------------------------------------------
  // Central and Eastern Europe
  //
  // References: Béla Bartók, "Hungarian Folk Music" (1931); Lajos Vargyas,
  // "Hungarian Folk Music" (1981); Izaly Zemtsovsky on Russian folk lyric.
  card({
    id: "hungarian-folk",
    summary:
      "Hungarian new-style song: descending pentatonic fifth-transposition (ABBA), csárdás 2/4 with kontra off-beat chords",
    tempo: { bpm: [90, 150], typical: 120 },
    meter: {
      signatures: [
        ["2/4", 0.7],
        ["4/4", 0.3],
      ],
    },
    pitch: {
      scales: [
        ["minor-pentatonic", 0.5],
        ["dorian", 0.5],
      ],
    },
    harmony: { model: "modal" },
    melody: { contour: [["descending", 1]] },
    texture: {
      roles: {
        bass: role("contrabass"),
        chords: role("viola", "dulcimer:0.5"),
        lead: role("fiddle"),
      },
    },
    rhythm: { onsets: { chords: grid(".x.x") } },
  }),
  card({
    id: "romani",
    summary:
      "Romani verbunkos and lassú-friss: slow rubato then fast, double harmonic minor (augmented seconds), cimbalom tremolo",
    tempo: { bpm: [80, 180], typical: 132 },
    meter: {
      signatures: [
        ["2/4", 0.6],
        ["4/4", 0.4],
      ],
    },
    pitch: {
      scales: [
        ["bhairav", 0.5],
        ["harmonic-minor", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["andalusian", 0.5],
        ["minor-ii-v", 0.5],
      ],
      cadences: [["V-I", 1]],
    },
    texture: {
      roles: {
        bass: role("contrabass"),
        chords: role("dulcimer", "nylon:0.5"),
        lead: role("violin", "clarinet:0.4"),
      },
    },
  }),
  card({
    id: "polish-folk",
    summary:
      "mazurka and oberek: 3/4 with the accent moved to beat 2 or 3, dotted first beat, fiddle over a basy drone",
    tempo: { bpm: [120, 180], typical: 150 },
    meter: { signatures: [["3/4", 1]] },
    groove: { subdivision: 2, velocity: [1, 0.7] },
    pitch: {
      scales: [
        ["major", 0.4],
        ["lydian", 0.3],
        ["minor", 0.3],
      ],
    },
    harmony: { model: "drone" },
    texture: {
      roles: {
        chords: null,
        bass: role("cello"),
        lead: role("fiddle"),
        perc: role("framedrum"),
      },
    },
    rhythm: { onsets: { perc: grid("x.x.5.") } },
  }),
  card({
    id: "czech-slovak",
    summary:
      "cimbalom band (cimbálová muzika): verbunk and polka figures, lydian sharp fourth in Moravian song, I-IV-V",
    tempo: { bpm: [100, 140], typical: 118 },
    meter: {
      signatures: [
        ["2/4", 0.6],
        ["3/4", 0.4],
      ],
    },
    pitch: {
      scales: [
        ["major", 0.6],
        ["lydian", 0.4],
      ],
    },
    harmony: { presets: [["fifties", 1]] },
    texture: {
      roles: {
        bass: role("contrabass"),
        chords: role("dulcimer"),
        lead: role("violin", "clarinet:0.5"),
      },
    },
  }),
  card({
    id: "russian-folk",
    summary:
      "protyazhnaya and chastushka: drawn-out podgoloski heterophony in natural minor, relative-major shifts, fast 2/4 ditties",
    tempo: { bpm: [70, 150], typical: 104 },
    meter: {
      signatures: [
        ["2/4", 0.5],
        ["4/4", 0.5],
      ],
    },
    pitch: {
      scales: [
        ["minor", 0.7],
        ["dorian", 0.3],
      ],
    },
    harmony: { presets: [["aeolian", 1]] },
    texture: {
      kind: "heterophonic",
      roles: {
        bass: role("contrabass"),
        chords: role("reeds", "tremolo:0.5"),
        lead: role("sing", "tremolo:0.4"),
        counter: role("choir"),
      },
    },
  }),
  card({
    id: "ukrainian-folk",
    summary:
      "Ukrainian dumy and kolomyika: Ukrainian dorian (raised fourth), bandura harp textures, choral thirds",
    tempo: { bpm: [80, 150], typical: 112 },
    meter: {
      signatures: [
        ["2/4", 0.6],
        ["4/4", 0.4],
      ],
    },
    pitch: {
      scales: [
        ["nikriz", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: { model: "modal" },
    texture: {
      roles: {
        chords: role("harp"),
        lead: role("sing", "violin:0.4"),
        counter: maybe("choir"),
      },
    },
  }),
  card({
    id: "estrada-romance",
    summary:
      "romance and estrada: harmonic minor i-iv-V7, descending chromatic-tinged bass, guitar arpeggios and strings",
    tempo: { bpm: [70, 110], typical: 88 },
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["3/4", 0.5],
      ],
    },
    pitch: { scales: [["harmonic-minor", 1]] },
    harmony: {
      presets: [
        ["minor-ii-v", 0.5],
        ["andalusian", 0.5],
      ],
      cadences: [["V-I", 1]],
      sevenths: 0.4,
    },
    bass: { behaviour: [["root-fifth", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        ...KIT_LIGHT,
        bass: role("bass"),
        chords: role("nylon", "strings:0.5"),
        lead: role("sing"),
        pad: maybe("strings"),
      },
    },
    rhythm: {
      onsets: { kick: grid("x...x..."), snare: grid("..x...x."), hat: null },
    },
  }),

  // -------------------------------------------------------------------------
  // Balkans and Mediterranean
  //
  // References: Timothy Rice, "May It Fill Your Soul" (1994) on Bulgarian
  // aksak; Gail Holst-Warhaft, "Road to Rembetika" (1975); Albert Lord,
  // "The Singer of Tales" (1960) on gusle epic.
  card({
    id: "balkan-brass",
    summary:
      "Balkan brass (truba): čoček 2/4 and 7/8 aksak, oro in 2+2+3, tapan bass drum, trumpets in parallel thirds over tuba",
    tempo: { bpm: [120, 170], typical: 140 },
    meter: {
      signatures: [
        ["7/8", 0.5],
        ["2/4", 0.5],
      ],
      grouping: [[[2, 2, 3], 1]],
    },
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.5],
        ["andalusian", 0.5],
      ],
    },
    bass: { behaviour: [["root-fifth", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        kick: role("drums"),
        snare: role("drums"),
        bass: role("tuba"),
        chords: role("horn", "trombone:0.5"),
        lead: role("trumpet"),
        counter: role("trumpet", "clarinet:0.4"),
        perc: null,
      },
    },
    rhythm: { onsets: { kick: grid("x.x.x.."), snare: grid(".x.x.x.") } },
  }),
  card({
    id: "bulgarian-folk",
    summary:
      "Bulgarian aksak: rachenitsa 7/8 (2+2+3) and kopanitsa 11/8 (2+2+3+2+2), gaida drone, close-harmony seconds",
    tempo: { bpm: [140, 200], typical: 170 },
    meter: {
      signatures: [
        ["7/8", 0.5],
        ["11/8", 0.5],
      ],
      grouping: [
        [[2, 2, 3], 0.5],
        [[2, 2, 3, 2, 2], 0.5],
      ],
    },
    // Bulgarian dance tunes sit mostly in major, mixolydian and dorian;
    // the augmented-second colour is Thracian, a minority here.
    pitch: {
      scales: [
        ["mixolydian", 0.35],
        ["dorian", 0.3],
        ["major", 0.2],
        ["hijaz", 0.15],
      ],
    },
    harmony: { model: "drone" },
    texture: {
      roles: {
        chords: null,
        drone: role("reeds"),
        lead: role("reeds", "fiddle:0.5", "ney:0.4"),
        perc: role("framedrum"),
      },
    },
  }),
  card({
    id: "macedonian-folk",
    summary:
      "lesnoto: 7/8 counted 3+2+2 (long beat first), zurla shawms and tapan, makam-flavoured hijaz turns",
    tempo: { bpm: [110, 160], typical: 132 },
    meter: { signatures: [["7/8", 1]], grouping: [[[3, 2, 2], 1]] },
    pitch: {
      scales: [
        ["hijaz", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: { model: "drone" },
    texture: {
      roles: {
        chords: null,
        drone: role("oboe"),
        lead: role("oboe", "clarinet:0.5"),
        perc: role("framedrum"),
      },
    },
    rhythm: { onsets: { perc: grid("x..x.x.") } },
  }),
  card({
    id: "rebetiko",
    summary:
      "rebetiko: zeibekiko 9/4-feel 9/8 and hasapiko 2/4, dromos hijaz and ousak modes, bouzouki tremolo over baglamas",
    tempo: { bpm: [70, 130], typical: 96 },
    meter: {
      signatures: [
        ["9/8", 0.6],
        ["2/4", 0.4],
      ],
      grouping: [[[2, 2, 2, 3], 1]],
    },
    pitch: {
      scales: [
        ["hijaz", 0.6],
        ["kurd", 0.4],
      ],
    },
    harmony: { model: "modal" },
    texture: {
      roles: {
        chords: role("lute", "nylon:0.5"),
        lead: role("tremolo", "sing:0.6"),
      },
    },
  }),
  card({
    id: "laiko",
    summary:
      "laïkó: tsifteteli 8/8 belly-dance groove and hasapiko, bouzouki leads over a pop kit, harmonic minor",
    tempo: { bpm: [100, 140], typical: 118 },
    meter: { signatures: [["4/4", 1]] },
    pitch: {
      scales: [
        ["harmonic-minor", 0.5],
        ["hijaz", 0.5],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.5],
        ["andalusian", 0.5],
      ],
    },
    texture: {
      roles: {
        ...KIT_LIGHT,
        bass: role("bassguitar"),
        chords: role("lute", "keys:0.5"),
        lead: role("sing", "tremolo:0.5"),
      },
    },
    rhythm: {
      onsets: {
        kick: grid("x..x..x."),
        snare: grid("..x...x."),
        hat: grid("x.x.x.x."),
      },
    },
  }),
  card({
    id: "cretan",
    summary:
      "Cretan syrtos and pentozalis: lyra lead over laouto ostinato, dorian with a raised fourth, 2/4 driving pulse",
    tempo: { bpm: [110, 160], typical: 134 },
    meter: { signatures: [["2/4", 1]] },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["nikriz", 0.5],
      ],
    },
    harmony: { model: "modal" },
    texture: {
      roles: {
        chords: role("lute"),
        lead: role("kemence", "fiddle:0.5"),
      },
    },
  }),
  card({
    id: "tamburica",
    summary:
      "tamburica orchestra: kolo 2/4 in major, plucked tambura choir in tremolo thirds over a berde bass",
    tempo: { bpm: [110, 150], typical: 128 },
    meter: { signatures: [["2/4", 1]] },
    pitch: { scales: [["major", 1]] },
    harmony: { presets: [["fifties", 1]], cadences: [["V-I", 1]] },
    bass: { behaviour: [["root-fifth", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        bass: role("contrabass"),
        chords: role("requinto", "tres:0.5"),
        lead: role("tremolo", "requinto:0.5"),
      },
    },
    rhythm: { onsets: { chords: grid(".x.x") } },
  }),
  card({
    id: "turbo-folk",
    summary:
      "turbo-folk: synth-pop kit and four-on-floor under oriental harmonic-minor melisma, i-VII-VI-V loops",
    tempo: { bpm: [110, 140], typical: 124 },
    meter: { signatures: [["4/4", 1]] },
    pitch: {
      scales: [
        ["harmonic-minor", 0.6],
        ["hijaz", 0.4],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["andalusian", 0.6],
        ["aeolian", 0.4],
      ],
    },
    texture: {
      roles: {
        ...kitRoles("electro"),
        bass: role("saw"),
        chords: role("keys", "strings:0.5"),
        lead: role("sing", "reeds:0.5"),
      },
    },
    rhythm: {
      onsets: {
        kick: grid("x.x.x.x."),
        snare: grid("..x...x."),
        hat: grid(".x.x.x.x"),
      },
    },
  }),
  card({
    id: "albanian-iso",
    summary:
      "iso-polyphony: a held group drone (iso) under two soloists who answer in pentatonic seconds and fourths",
    tempo: { bpm: [56, 90], typical: 70 },
    meter: { signatures: [["4/4", 1]], grouping: null },
    pitch: { scales: [["minor-pentatonic", 1]] },
    harmony: { model: "drone" },
    texture: {
      kind: "polyphonic",
      roles: {
        chords: null,
        drone: role("choir"),
        lead: role("sing"),
        counter: role("sing"),
      },
    },
  }),
  card({
    id: "sevdalinka",
    summary:
      "sevdalinka: slow melismatic love song, makam hijaz with an augmented second, saz and accordion-like reeds",
    tempo: { bpm: [50, 80], typical: 62 },
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["7/8", 0.4],
      ],
      grouping: [[[3, 2, 2], 1]],
    },
    pitch: {
      scales: [
        ["hijaz", 0.6],
        ["harmonic-minor", 0.4],
      ],
    },
    harmony: { model: "modal" },
    melody: { density: [1, 2], intervals: intervals(8, 1.5, 0.3, 0.7) },
    texture: {
      roles: {
        chords: role("reeds", "lute:0.5"),
        lead: role("sing"),
        counter: maybe("lute"),
        // Sung over saz and accordion; no drum (never an Irish bodhrán).
        perc: null,
      },
    },
  }),
  card({
    id: "dinaric-rural",
    summary:
      "ganga and ojkanje: narrow-range singing in clashing seconds, a lead line and a group that holds and shakes the tone",
    tempo: { bpm: [56, 90], typical: 72 },
    meter: { signatures: [["4/4", 1]], grouping: null },
    pitch: { scales: [["minor", 1]] },
    harmony: { model: "none" },
    melody: {
      ambitus: [3, 4],
      intervals: intervals(9, 0.5, 0.05, 1.2),
      density: [1, 2],
    },
    bass: { behaviour: [["none", 1]] },
    texture: {
      kind: "polyphonic",
      roles: {
        chords: null,
        bass: null,
        lead: role("sing"),
        counter: role("choir"),
      },
    },
  }),
  card({
    id: "gusle-epic",
    summary:
      "gusle epic: decasyllabic lines recited on a narrow 4-note range, the single-string gusle doubling the voice",
    tempo: { bpm: [90, 120], typical: 104 },
    meter: { signatures: [["5/4", 1]], grouping: [[[2, 3], 1]] },
    pitch: { scales: [["minor", 1]] },
    harmony: { model: "none" },
    melody: {
      ambitus: [4, 5],
      repetition: 0.85,
      phraseBars: [[2, 1]],
      intervals: intervals(9, 1, 0.05, 1.5),
    },
    bass: { behaviour: [["none", 1]] },
    texture: {
      kind: "heterophonic",
      roles: {
        chords: null,
        bass: null,
        lead: role("sing"),
        counter: role("kemence", "fiddle:0.5"),
      },
    },
  }),
];

// ---------------------------------------------------------------------------
// East Asia
//
// References: Alan R. Thrasher, "Chinese Musical Instruments" (2000) and
// "Sizhu Instrumental Music of South China" (2008); William P. Malm,
// "Traditional Japanese Music and Musical Instruments" (1959/2000);
// Keith Howard, "Perspectives on Korean Music" (2006); Theodore Levin,
// "Where Rivers and Mountains Sing" (2006) on Tuvan overtone song.

/**
 * Korean jangdan: janggu strokes, `deong` (both heads, low), `kung`
 * (left, low), `deok` (right stick), `giduk` (stick roll).
 */
export const JUNGMORI: CycleSpec = Object.freeze({
  kind: "timeline",
  name: "jungmori",
  beats: 12,
  divisions: [3, 3, 3, 3],
  strokes: Object.freeze([
    "deong",
    ".",
    "kung",
    "deok",
    ".",
    "kung",
    "kung",
    ".",
    "deong",
    "deok",
    ".",
    ".",
  ]),
  low: Object.freeze(["deong", "kung"]),
  stress: Object.freeze([1, 9]),
});

/** Gutgeori: four dotted beats, the third answered by a left-hand kung. */
export const GUTGEORI: CycleSpec = Object.freeze({
  kind: "timeline",
  name: "gutgeori",
  beats: 12,
  divisions: [3, 3, 3, 3],
  strokes: Object.freeze([
    "deong",
    ".",
    "deok",
    "kung",
    "deok",
    ".",
    "kung",
    ".",
    "deok",
    "kung",
    "deok",
    "deok",
  ]),
  low: Object.freeze(["deong", "kung"]),
  stress: Object.freeze([1, 7]),
});

/** Noh yatsu-byōshi: the 8-beat frame the hayashi drums articulate. */
export const YATSU_BYOSHI: CycleSpec = Object.freeze({
  kind: "timeline",
  name: "yatsu-byoshi",
  beats: 8,
  divisions: [4, 4],
  strokes: Object.freeze(["pon", ".", "ta", "pon", ".", "ta", "pon", "ta"]),
  low: Object.freeze(["pon"]),
  stress: Object.freeze([1, 8]),
});

/** The Japanese in scale (miyako-bushi): semitone above tonic and fifth. */
const IN_SCALE = Object.freeze({
  scales: [["phrygian", 1]] as const,
  raga: {
    aroha: [0, 1, 5, 7, 10],
    avaroha: [0, 1, 5, 7, 8],
    vadi: 7,
    samvadi: 0,
  },
});

/**
 * In-scale cadences: phrases close on the tonic, the 4th or the 5th
 * (phrygian degrees 0, 3, 4), never on the avoided minor 3rd.
 */
const IN_FINALS = Object.freeze([
  [0, 0.6],
  [3, 0.15],
  [4, 0.25],
] as const);

/** Ryūkyū scale: major with no 2nd or 6th (do mi fa so ti). */
const RYUKYU = Object.freeze({
  scales: [["major", 1]] as const,
  raga: {
    aroha: [0, 4, 5, 7, 11],
    avaroha: [0, 4, 5, 7, 11],
    vadi: 0,
    samvadi: 7,
  },
});

/** Shang mode of the Chinese pentatonic: re mi so la do on re. */
const SHANG_MODE = Object.freeze({
  scales: [["dorian", 1]] as const,
  raga: {
    aroha: [0, 2, 5, 7, 10],
    avaroha: [0, 2, 5, 7, 10],
    vadi: 0,
    samvadi: 7,
  },
});

/**
 * Thai thang (pitch level) on the seven equidistant tones: a pentatonic
 * subset 1 2 3 5 6 of the seven, with 4 and 7 as passing tones left out.
 */
const THANG_NOK = Object.freeze({
  tuning: "thai",
  degrees: Object.freeze([0, 1, 2, 4, 5]),
  scales: Object.freeze([Object.freeze(["major-pentatonic", 1] as const)]),
});

/**
 * Khmer pinpeat pentatonic on the same equidistant scale, a different
 * pitch level (1 2 4 5 6 of the seven), so the gaps sit elsewhere.
 */
const KHMER_PENTATONIC = Object.freeze({
  tuning: "thai",
  degrees: Object.freeze([0, 1, 3, 4, 5]),
  scales: Object.freeze([Object.freeze(["major-pentatonic", 1] as const)]),
});

/**
 * Vietnamese điệu oán (the sad nam mode of cải lương and đờn ca tài tử):
 * hò xự xang xê cống with xự and cống neutral, about a quarter tone off
 * the tempered third and seventh (rast's 3.5 and 10.5 steps).
 */
const DIEU_OAN = Object.freeze({
  tuning: null,
  degrees: null,
  scales: [["rast", 1]] as const,
  raga: {
    aroha: [0, 4, 5, 7, 11],
    avaroha: [0, 4, 5, 7, 11],
    vadi: 0,
    samvadi: 7,
  },
});

/**
 * Nanguan wukong guan: on the pipa's open string it reads 5 6 1 2 3, the
 * zhi mode of the pentatonic (sol la do re mi on sol), so the fourth is
 * present and the major third absent; the guqin's gong mode is the reverse.
 */
const WUKONG_GUAN = Object.freeze({
  scales: [["mixolydian", 1]] as const,
  raga: {
    aroha: [0, 2, 5, 7, 9],
    avaroha: [0, 2, 5, 7, 9],
    vadi: 0,
    samvadi: 7,
  },
});

/** 12-TET for leaves under the slendro-tuned southeast-asia branch. */
const TWELVE = Object.freeze({ tuning: null, degrees: null });

const ASIA_PACIFIC_LEAVES: readonly StyleCard[] = [
  card({
    id: "guqin",
    summary:
      "guqin: slow solo zither, harmonics (fanyin) and sliding stopped tones, gong-mode pentatonic, sparse sound and silence",
    tempo: { bpm: [38, 56], typical: 46 },
    meter: { signatures: [["4/4", 1]] },
    pitch: { scales: [["major-pentatonic", 1]] },
    melody: {
      density: [0, 1],
      range: [48, 79],
      intervals: intervals(4, 4, 1, 0.6),
      contour: [["wave", 1]],
    },
    texture: {
      kind: "monophonic",
      roles: { drone: null, bass: null, lead: role("koto"), counter: null },
    },
    mix: { space: 0.55 },
  }),
  card({
    id: "chinese-classical",
    summary:
      "sizhu chamber pieces: silk and bamboo heterophony, each player ornamenting one skeletal pentatonic line, jiahua elaboration",
    tempo: { bpm: [60, 96], typical: 76 },
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["2/4", 0.4],
      ],
    },
    // Jiangnan sizhu sits mostly in zhi mode (the dizi's D pieces: sol la
    // do re mi on sol), like nanguan's wukong guan but brisk and busy.
    pitch: WUKONG_GUAN,
    melody: {
      density: [2, 3],
      finals: [
        [0, 0.6],
        [4, 0.4],
      ],
    },
    texture: {
      kind: "heterophonic",
      roles: {
        lead: role("lute", "erhu:0.6"),
        counter: role("flute", "hammered:0.5"),
        drone: null,
        bass: null,
        perc: null,
      },
    },
  }),
  card({
    id: "chinese-opera",
    summary:
      "jingju: xipi and erhuang modes, banshi metres led by the clapper, jinghu fiddle doubling the voice, gong-and-cymbal luogu",
    tempo: { bpm: [70, 140], typical: 100 },
    meter: {
      signatures: [
        ["2/4", 0.6],
        ["4/4", 0.4],
      ],
    },
    pitch: {
      scales: [
        ["major-pentatonic", 0.6],
        ["durga", 0.4],
      ],
    },
    melody: { range: [64, 88], density: [1, 3] },
    texture: {
      kind: "heterophonic",
      roles: {
        lead: role("sing"),
        counter: role("erhu"),
        drone: null,
        bass: maybe("gong"),
        perc: role("framedrum"),
      },
    },
    rhythm: { onsets: { perc: grid("x.x.xxx.") } },
  }),
  card({
    id: "chinese-folk",
    summary:
      "xiaodiao and shan'ge: strophic folk song in the zhi mode (sol la do re mi), suona and dizi, four-phrase qi-cheng-zhuan-he",
    tempo: { bpm: [72, 120], typical: 92 },
    meter: {
      signatures: [
        ["2/4", 0.6],
        ["4/4", 0.4],
      ],
    },
    pitch: {
      scales: [
        ["durga", 0.6],
        ["major-pentatonic", 0.4],
      ],
    },
    melody: { phraseBars: [[2, 1]], repetition: 0.6 },
    texture: {
      roles: {
        lead: role("sing", "oboe:0.5", "flute:0.5"),
        counter: maybe("flute"),
        drone: null,
        perc: maybe("framedrum"),
      },
    },
  }),
  card({
    id: "cantonese-music",
    summary:
      "guangdong yinyue: gaohu and yangqin, lively 2/4 with the yi and fan pien tones colouring the shang mode",
    tempo: { bpm: [96, 140], typical: 116 },
    meter: { signatures: [["2/4", 1]] },
    pitch: SHANG_MODE,
    melody: {
      density: [2, 4],
      // shang closes on the tonic, the 4th or the 5th; the gate omits the 3rd
      finals: [
        [0, 0.5],
        [3, 0.2],
        [4, 0.3],
      ],
    },
    texture: {
      kind: "heterophonic",
      roles: {
        lead: role("erhu"),
        counter: role("hammered", "lute:0.5"),
        drone: null,
      },
    },
  }),
  card({
    id: "nanguan",
    summary:
      "nanguan: very slow Hokkien art song, pipa held horizontally, dongxiao flute, clapper on the strong beat, long melismas",
    tempo: { bpm: [36, 56], typical: 44 },
    meter: { signatures: [["4/4", 1]] },
    pitch: WUKONG_GUAN,
    melody: {
      density: [0, 1],
      intervals: intervals(6, 3, 0.4, 0.6),
      finals: [
        [0, 0.6],
        [4, 0.4],
      ],
    },
    texture: {
      kind: "heterophonic",
      roles: {
        lead: role("sing"),
        counter: role("lute", "shakuhachi:0.6"),
        drone: null,
        perc: role("framedrum"),
      },
    },
    rhythm: { onsets: { perc: grid("x.......") } },
  }),
  card({
    id: "chinese-orchestra",
    summary:
      "guoyue orchestra: Western-style sections of erhu, yangqin, pipa and dizi, pentatonic melody harmonised in functional triads",
    tempo: { bpm: [66, 120], typical: 88 },
    meter: { signatures: [["4/4", 1]] },
    harmony: {
      model: "functional",
      presets: [
        ["fifties", 0.5],
        ["canon", 0.5],
      ],
      rhythm: [[1, 1]],
    },
    bass: { behaviour: [["root", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        bass: role("cellos", "contrabasses:0.5"),
        chords: role("hammered", "strings:0.6"),
        lead: role("erhu", "flute:0.5"),
        counter: maybe("lute"),
        drone: null,
      },
    },
  }),
  card({
    id: "gagaku",
    summary:
      "gagaku tōgaku: shō cluster chords held over a slow jo-ha-kyū unfolding, hichiriki and ryūteki in heterophony, ritsu mode",
    tempo: { bpm: [30, 50], typical: 40 },
    meter: { signatures: [["4/4", 1]] },
    // Ritsu (re mi sol la do on re): the hyōjō, ōshikichō and banshikichō
    // repertory; the ryo modes are in practice coloured toward ritsu.
    pitch: { scales: [["durga", 1]] },
    melody: { density: [0, 1], range: [62, 84] },
    texture: {
      kind: "heterophonic",
      roles: {
        drone: role("reeds"),
        lead: role("oboe"),
        counter: role("flute"),
        bass: role("koto"),
        perc: role("kettledrum"),
      },
    },
    // Kakko taps lead into the taiko stroke that closes each measure.
    rhythm: { onsets: { perc: grid("....5.5.5..5..x.") } },
    mix: { space: 0.55 },
  }),
  card({
    id: "shomyo",
    summary:
      "shōmyō: Buddhist chant in unison, narrow range, long melismas on held syllables, ryo and ritsu modes, free pulse",
    tempo: { bpm: [36, 56], typical: 44 },
    meter: { signatures: [["4/4", 1]] },
    // Shingon and Tendai chant favour the ryo pentatonic over ritsu.
    pitch: {
      scales: [
        ["major-pentatonic", 0.8],
        ["durga", 0.2],
      ],
    },
    // Melisma: several tones on each held syllable.
    melody: {
      density: [1, 2],
      ambitus: [4, 7],
      range: [48, 67],
      intervals: intervals(9, 1, 0.05, 1),
    },
    texture: {
      kind: "monophonic",
      roles: {
        lead: role("choir"),
        drone: null,
        bass: null,
        perc: maybe("bowl"),
      },
    },
    rhythm: { onsets: { perc: grid("x...............") } },
    mix: { space: 0.7 },
  }),
  card({
    id: "sankyoku",
    summary:
      "sankyoku: koto, shamisen and shakuhachi trio in heterophony, in scale (semitone above tonic and fifth), dan sections that accelerate",
    tempo: { bpm: [60, 110], typical: 80 },
    meter: { signatures: [["4/4", 1]] },
    pitch: IN_SCALE,
    melody: { density: [1, 3], finals: IN_FINALS },
    texture: {
      kind: "heterophonic",
      roles: {
        lead: role("koto"),
        counter: role("shakuhachi"),
        drone: maybe("lute"),
      },
    },
  }),
  card({
    id: "honkyoku",
    summary:
      "honkyoku: solo shakuhachi, one breath per phrase (ma between), meri pitch bends in the in scale, no metre",
    tempo: { bpm: [36, 56], typical: 44 },
    meter: { signatures: [["4/4", 1]] },
    pitch: IN_SCALE,
    melody: {
      density: [0, 1],
      phraseBars: [[1, 1]],
      contour: [["arch", 1]],
      // Breaths end on ro (the tonic) or on re a fifth above.
      finals: [
        [0, 0.6],
        [4, 0.4],
      ],
    },
    texture: {
      kind: "monophonic",
      roles: { lead: role("shakuhachi"), drone: null, bass: null },
    },
    mix: { space: 0.65 },
  }),
  card({
    id: "noh",
    summary:
      "noh: utai chant over the hayashi (nōkan flute, kotsuzumi, ōtsuzumi) in the 8-beat yatsu-byōshi, in scale",
    tempo: { bpm: [50, 80], typical: 62 },
    meter: { signatures: [["4/4", 1]], cycle: YATSU_BYOSHI },
    pitch: IN_SCALE,
    // Utai moves in a narrow band around the jo, chū and ge pivot tones.
    melody: { ambitus: [3, 7], density: [1, 2], finals: IN_FINALS },
    texture: {
      kind: "heterophonic",
      roles: {
        lead: role("sing"),
        counter: role("flute"),
        drone: null,
        perc: role("framedrum"),
      },
    },
  }),
  card({
    id: "minyo",
    summary:
      "min'yō: work and festival song in the yo scale (no semitones), shamisen and taiko on a 2/4 pulse, kakegoe calls",
    tempo: { bpm: [90, 130], typical: 108 },
    meter: { signatures: [["2/4", 1]] },
    pitch: { scales: [["durga", 1]] },
    texture: {
      kind: "heterophonic",
      roles: {
        lead: role("sing"),
        counter: role("lute", "flute:0.5"),
        drone: null,
        perc: role("kettledrum"),
      },
    },
    rhythm: { onsets: { perc: grid("x.x.x.xx") } },
  }),
  card({
    id: "taiko",
    summary:
      "kumi-daiko: ensemble drums over a ji-uchi base pattern (don doko), shinobue flute above, yo scale, accelerating sections",
    tempo: { bpm: [100, 160], typical: 128 },
    meter: { signatures: [["4/4", 1]] },
    pitch: { scales: [["durga", 1]] },
    texture: {
      roles: {
        kick: role("kettledrum"),
        perc: role("kettledrum", "framedrum:0.5"),
        lead: role("flute"),
        drone: null,
      },
    },
    rhythm: {
      onsets: {
        kick: grid("x...x...x...x..."),
        perc: grid("x.xxx.xxx.xxx.xx"),
      },
    },
  }),
  card({
    id: "okinawan",
    summary:
      "Ryūkyū song: sanshin lute in the ryūkyū scale (do mi fa so ti), kachāshī 2/4 dance lilt, hayashi handclaps",
    tempo: { bpm: [100, 140], typical: 120 },
    meter: { signatures: [["2/4", 1]] },
    groove: { subdivision: 2, swingRatio: [1.4, 1.8] },
    pitch: RYUKYU,
    texture: {
      roles: {
        lead: role("sing"),
        counter: role("lute"),
        drone: null,
        perc: maybe("framedrum"),
      },
    },
  }),
  card({
    id: "korean-court",
    summary:
      "jeongak: very slow court music, pyeongjo mode, piri and daegeum heterophony with wide vibrato and swelling held tones",
    tempo: { bpm: [24, 44], typical: 32 },
    meter: { signatures: [["12/8", 1]] },
    pitch: { scales: [["durga", 1]] },
    melody: { density: [0, 1] },
    texture: {
      kind: "heterophonic",
      roles: {
        lead: role("oboe"),
        counter: role("flute", "erhu:0.5"),
        drone: maybe("koto"),
        perc: role("framedrum"),
      },
    },
    rhythm: { onsets: { perc: grid("x...........") } },
  }),
  card({
    id: "pansori",
    summary:
      "pansori: one singer and a buk drummer, jungmori 12-beat jangdan, gyemyeonjo mode (trembling fifth, falling fourth), chuimsae calls",
    tempo: { bpm: [60, 110], typical: 84 },
    meter: { signatures: [["12/8", 1]], cycle: JUNGMORI },
    pitch: { scales: [["minor-pentatonic", 1]] },
    melody: { intervals: intervals(6, 3, 0.4, 0.8) },
    texture: {
      kind: "monophonic",
      roles: { lead: role("sing"), drone: null, perc: role("framedrum") },
    },
  }),
  card({
    id: "pungmul",
    summary:
      "pungmul: farmers' band of kkwaenggwari gong, jing, janggu and buk in gutgeori 12/8, taepyeongso shawm, accelerating",
    tempo: { bpm: [90, 150], typical: 120 },
    meter: { signatures: [["12/8", 1]], cycle: GUTGEORI },
    pitch: { scales: [["durga", 1]] },
    texture: {
      roles: {
        lead: role("oboe"),
        bass: role("gong"),
        drone: null,
        perc: role("framedrum"),
      },
    },
  }),
  card({
    id: "mongolian",
    summary:
      "urtyn duu long song: unmetred, wide-ranging pentatonic phrases with falsetto turns over the morin khuur's drone",
    tempo: { bpm: [44, 70], typical: 54 },
    meter: { signatures: [["4/4", 1]] },
    melody: {
      density: [0, 1],
      ambitus: [10, 17],
      intervals: intervals(3, 4, 2, 0.6),
    },
    texture: {
      kind: "heterophonic",
      roles: {
        lead: role("sing"),
        counter: role("fiddle", "cello:0.5"),
        drone: maybe("khoomei"),
      },
    },
    mix: { space: 0.5 },
  }),
  card({
    id: "tuvan",
    summary:
      "khöömei: a sung fundamental drone (kargyraa) with a whistled overtone melody (sygyt) on the harmonic series, galloping igil",
    tempo: { bpm: [90, 130], typical: 108 },
    meter: { signatures: [["6/8", 1]] },
    groove: { subdivision: 3, velocity: [1, 0.5, 0.8] },
    harmony: { model: "drone" },
    texture: {
      roles: {
        drone: role("kargyraa", "khoomei:0.6"),
        lead: role("sygyt"),
        counter: maybe("fiddle"),
        perc: maybe("framedrum"),
      },
    },
    rhythm: { onsets: { perc: grid("x.xx.x") } },
  }),
  card({
    id: "kazakh-kyrgyz",
    summary:
      "dombra and komuz küy: two-string lute in parallel fourths and fifths, galloping strum, programmatic tune episodes",
    tempo: { bpm: [110, 160], typical: 132 },
    meter: {
      signatures: [
        ["6/8", 0.6],
        ["2/4", 0.4],
      ],
    },
    groove: { subdivision: 3, velocity: [1, 0.6, 0.8] },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["mixolydian", 0.5],
      ],
    },
    harmony: { model: "drone" },
    texture: {
      roles: {
        lead: role("lute"),
        drone: role("lute"),
        counter: maybe("fiddle"),
      },
    },
  }),

  // -------------------------------------------------------------------------
  // Southeast Asia
  //
  // References: Judith Becker and Sumarsam (see gamelan.ts); Michael
  // Tenzer, "Gamelan Gong Kebyar" (2000); Pamela Myers-Moro, "Thai Music
  // and Musicians in Contemporary Bangkok" (1993); Andrew Weintraub,
  // "Dangdut Stories" (2010).
  card({
    id: "javanese-gamelan",
    summary:
      "Javanese gamelan: ladrang colotomy (gong closes the 32-beat gongan), balungan with bonang elaboration, pathet nem",
    meter: { signatures: [["4/4", 1]], cycle: LADRANG },
    pitch: pathetPitch("pelog-nem"),
    // Balungan mlaku: the saron states one skeleton tone per beat.
    melody: { density: [1, 1], finals: pathetFinals("pelog-nem") },
    texture: {
      roles: {
        perc: role("kenong", "kethuk:0.5"),
        lead: role("saron", "demung:0.5"),
        counter: role("bonang", "gender:0.5"),
      },
    },
  }),
  card({
    id: "balinese-gamelan",
    summary:
      "gong kebyar: fast gilak cycle, kotekan (two gangsa parts interlocking polos and sangsih), pelog selisir, sudden dynamic shifts",
    tempo: { bpm: [110, 160], typical: 132 },
    meter: { signatures: [["4/4", 1]], cycle: GILAK },
    pitch: pathetPitch("pelog-lima"),
    melody: { density: [3, 4], finals: pathetFinals("pelog-lima") },
    texture: {
      roles: {
        perc: role("gongageng", "kempul:0.5"),
        lead: role("gangsa"),
        counter: role("gangsa"),
      },
    },
  }),
  card({
    id: "sundanese",
    summary:
      "degung: Sundanese gong-chime ensemble, the goong closing a 16-beat cycle, suling flute above, pelog-derived degung scale",
    // Degung klasik is unhurried; the suling ornaments freely above.
    tempo: { bpm: [52, 76], typical: 64 },
    meter: { signatures: [["4/4", 1]], cycle: DEGUNG },
    pitch: pathetPitch("pelog-nem"),
    melody: { finals: pathetFinals("pelog-nem") },
    texture: {
      roles: {
        perc: role("bonang", "kenong:0.5"),
        lead: role("suling"),
        counter: role("bonang", "saron:0.5"),
      },
    },
  }),
  card({
    id: "dangdut",
    summary:
      "dangdut: the kendang 'dang-dut' (open low stroke on 4, high on 1), harmonic minor melisma, suling and mandolin-like tremolo",
    tempo: { bpm: [70, 110], typical: 88 },
    meter: { signatures: [["4/4", 1]] },
    pitch: {
      ...TWELVE,
      scales: [
        ["harmonic-minor", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.5],
        ["andalusian", 0.5],
      ],
      rhythm: [[1, 1]],
    },
    melody: { density: [2, 3], finals: [[0, 1]] },
    bass: { behaviour: [["root-fifth", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        bass: role("bassguitar"),
        chords: role("keys", "nylon:0.5"),
        lead: role("sing", "suling:0.4"),
        counter: maybe("tremolo"),
        perc: role("tabla"),
      },
    },
    rhythm: { onsets: { perc: grid("x..x....x..x..x.") } },
  }),
  card({
    id: "keroncong",
    summary:
      "keroncong: cak and cuk ukuleles interlocking off-beats, pizzicato cello in a running kendang role, I-IV-V7 in major",
    tempo: { bpm: [80, 110], typical: 92 },
    meter: { signatures: [["4/4", 1]] },
    pitch: { ...TWELVE, scales: [["major", 1]] },
    harmony: {
      model: "functional",
      presets: [
        ["fifties", 0.5],
        ["turnaround", 0.5],
      ],
      rhythm: [[1, 1]],
      sevenths: 0.3,
    },
    melody: { finals: [[0, 1]] },
    bass: { behaviour: [["root-fifth", 1]] },
    texture: {
      kind: "interlocking",
      roles: {
        bass: role("pizzicato", "doublebass:0.5"),
        chords: role("requinto", "nylon:0.5"),
        lead: role("sing", "violin:0.5", "flute:0.4"),
        counter: role("tres"),
      },
    },
    rhythm: { onsets: { chords: grid(".x.x.x.x"), counter: grid("x.x.x.x.") } },
  }),
  card({
    id: "thai-classical",
    summary:
      "piphat: ranat xylophone and khong wong gong circle elaborate a core melody in the seven equidistant tones, ching cymbal alternating open ching and damped chap",
    tempo: { bpm: [70, 130], typical: 96 },
    meter: { signatures: [["4/4", 1]], cycle: CHING },
    pitch: THANG_NOK,
    melody: {
      finals: [
        [0, 0.7],
        [3, 0.3],
      ],
    },
    texture: {
      roles: {
        perc: role("crotales", "glock:0.5"),
        lead: role("xylophone"),
        counter: role("bonang", "oboe:0.4"),
        bass: maybe("gong"),
      },
    },
  }),
  card({
    id: "luk-thung",
    summary:
      "luk thung: Thai country song, pentatonic melody with vocal ornaments (luk khor), brass and a cha-cha-tinged kit",
    tempo: { bpm: [90, 130], typical: 110 },
    meter: { signatures: [["4/4", 1]] },
    pitch: {
      ...TWELVE,
      scales: [["major-pentatonic", 1]],
    },
    harmony: {
      model: "functional",
      presets: [
        ["fifties", 0.5],
        ["sad-pop", 0.5],
      ],
      rhythm: [[1, 1]],
    },
    melody: { finals: [[0, 1]] },
    bass: { behaviour: [["root-fifth", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        ...KIT_LIGHT,
        bass: role("bassguitar"),
        chords: role("keys", "electric:0.5"),
        lead: role("sing"),
        counter: maybe("trumpet", "sax:0.5"),
        perc: role("crotales"),
      },
    },
    rhythm: {
      onsets: {
        perc: grid(".x.x.x.x"),
        kick: grid("x...x..."),
        snare: grid("..x...xx"),
        hat: grid("x.x.x.x."),
      },
    },
  }),
  card({
    id: "mor-lam",
    summary:
      "mor lam: the khaen free-reed mouth organ's drone and pulsing chords, rapid patter singing in lai pentatonic modes",
    tempo: { bpm: [110, 150], typical: 128 },
    meter: { signatures: [["4/4", 1]] },
    pitch: {
      ...TWELVE,
      scales: [
        ["minor-pentatonic", 0.6],
        ["major-pentatonic", 0.4],
      ],
    },
    melody: { density: [3, 4], ambitus: [5, 9], finals: [[0, 1]] },
    texture: {
      kind: "heterophonic",
      roles: {
        bass: null,
        drone: role("reeds"),
        lead: role("sing"),
        counter: role("reeds", "lute:0.5"),
        perc: maybe("framedrum"),
      },
    },
    rhythm: { onsets: { perc: grid("x.xxx.xx") } },
  }),
  card({
    id: "khmer",
    summary:
      "pinpeat: sralai oboe leading roneat xylophone heterophony over the ching-chap cycle and skor thom drums, equidistant pentatonic",
    tempo: { bpm: [70, 120], typical: 92 },
    meter: { signatures: [["4/4", 1]], cycle: CHING },
    pitch: KHMER_PENTATONIC,
    melody: {
      finals: [
        [0, 0.7],
        [2, 0.3],
      ],
    },
    texture: {
      kind: "heterophonic",
      roles: {
        perc: role("crotales"),
        kick: role("kettledrum"),
        lead: role("oboe"),
        counter: role("xylophone", "bonang:0.5"),
        bass: maybe("gong"),
      },
    },
    rhythm: { onsets: { kick: grid("x.......x...x.x.") } },
  }),
  card({
    id: "vietnamese",
    summary:
      "Vietnamese điệu oán: the sad nam mode of cải lương, neutral xự and cống with vibrato, đàn bầu over đàn tranh, song lang on the strong beats",
    tempo: { bpm: [56, 96], typical: 72 },
    meter: { signatures: [["4/4", 1]] },
    pitch: DIEU_OAN,
    melody: { density: [1, 2], intervals: intervals(5, 3, 0.6, 0.6) },
    bass: { behaviour: [["none", 1]] },
    texture: {
      kind: "heterophonic",
      roles: {
        bass: null,
        lead: role("erhu", "sing:0.6"),
        counter: role("koto"),
        perc: role("framedrum"),
      },
    },
    rhythm: { onsets: { perc: grid("....x.......x...") } },
  }),
  card({
    id: "philippine",
    summary:
      "kulintang: a row of eight gong-chimes plays the melody over agung pair off-beats and the dabakan drum, binalig rhythmic mode",
    tempo: { bpm: [100, 140], typical: 120 },
    meter: { signatures: [["4/4", 1]], cycle: AGUNG },
    pitch: { ...TWELVE, scales: [["major-pentatonic", 1]] },
    texture: {
      roles: {
        perc: role("gong", "gongageng:0.5"),
        lead: role("bonang"),
        counter: maybe("kenong"),
        bass: null,
      },
    },
  }),
  card({
    id: "burmese",
    summary:
      "hsaing waing: the pat waing tuned-drum circle leads, hne oboe answers, si bell and wa clapper alternate at the half bar, dense diatonic runs",
    tempo: { bpm: [90, 150], typical: 116 },
    meter: { signatures: [["4/4", 1]], cycle: SI_WA },
    pitch: { ...TWELVE, scales: [["mixolydian", 1]] },
    melody: { density: [3, 4] },
    texture: {
      roles: {
        perc: role("crotales", "chimes:0.4"),
        lead: role("timpani"),
        counter: role("oboe"),
        bass: maybe("gong"),
      },
    },
  }),
  card({
    id: "malay",
    summary:
      "zapin and joget: gambus lute and marwas drums in 4/4 zapin (accent on the last beat), violin in harmonic minor, ronggeng lilt",
    tempo: { bpm: [90, 130], typical: 108 },
    meter: { signatures: [["4/4", 1]] },
    pitch: {
      ...TWELVE,
      scales: [
        ["harmonic-minor", 0.6],
        ["hijaz", 0.4],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["andalusian", 0.5],
        ["aeolian", 0.5],
      ],
      rhythm: [[1, 1]],
    },
    melody: { finals: [[0, 1]] },
    bass: { behaviour: [["root", 1]] },
    texture: {
      kind: "heterophonic",
      roles: {
        bass: role("doublebass"),
        chords: role("oud"),
        lead: role("violin", "sing:0.6"),
        counter: null,
        perc: role("daf", "framedrum:0.5"),
      },
    },
    rhythm: { onsets: { perc: grid("x.....x.x.x.x.xx") } },
  }),

  // -------------------------------------------------------------------------
  // Oceania
  //
  // References: Mervyn McLean, "Weavers of Song: Polynesian Music and
  // Dance" (1999); Catherine Ellis, "Aboriginal Music: Education for
  // Living" (1985); George Kanahele (ed.), "Hawaiian Music and Musicians"
  // (1979).
  card({
    id: "aboriginal",
    summary:
      "song series: descending terraced melodic contour over a continuous low drone (didjeridu, voiced here by kargyraa) and clapstick pulse",
    tempo: { bpm: [100, 140], typical: 120 },
    meter: { signatures: [["4/4", 1]] },
    pitch: { scales: [["minor-pentatonic", 1]] },
    harmony: { model: "drone", presets: null },
    melody: {
      contour: [
        ["terraced", 0.6],
        ["descending", 0.4],
      ],
    },
    texture: {
      kind: "heterophonic",
      roles: {
        chords: null,
        drone: role("kargyraa"),
        lead: role("sing"),
        perc: role("framedrum"),
      },
    },
    rhythm: { onsets: { perc: grid("x.x.x.x.") } },
  }),
  card({
    id: "maori",
    summary:
      "waiata and haka: narrow-range unison chant on a recitation tone, waiata-ā-ringa action songs with strummed I-IV-V",
    tempo: { bpm: [80, 120], typical: 96 },
    meter: { signatures: [["4/4", 1]] },
    melody: { ambitus: [4, 7], intervals: intervals(8, 1.5, 0.2, 1) },
    texture: {
      kind: "homophonic",
      roles: {
        chords: role("acoustic"),
        lead: role("choir", "sing:0.6"),
        bass: null,
      },
    },
    rhythm: { onsets: { chords: grid("x.xx.xx.") } },
  }),
  card({
    id: "hawaiian",
    summary:
      "kī hō'alu slack key and steel guitar: open-tuned I-IV-V7 with the II7-V7-I vamp, falsetto ha'i breaks, 2/4 hula",
    tempo: { bpm: [70, 110], typical: 88 },
    meter: {
      signatures: [
        ["2/4", 0.5],
        ["4/4", 0.5],
      ],
    },
    harmony: {
      presets: null,
      forms: [[["I", "I", "IV", "I", "II", "V", "I", "I"], 1]],
      cadences: [["V-I", 1]],
      sevenths: 0.4,
    },
    melody: { intervals: intervals(4, 3, 1.5, 0.6) },
    bass: { behaviour: [["root-fifth", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        bass: maybe("bassguitar"),
        chords: role("steel", "nylon:0.5"),
        lead: role("sing"),
        counter: maybe("steel"),
      },
    },
  }),
  card({
    id: "polynesian",
    summary:
      "Tahitian and Cook Islands drum dance: fast to'ere log-drum 16th patterns with pahu bass drum, himene choral harmony",
    tempo: { bpm: [120, 170], typical: 144 },
    meter: { signatures: [["4/4", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        kick: role("kettledrum"),
        perc: role("xylophone", "framedrum:0.5"),
        chords: role("choir"),
        lead: role("sing"),
      },
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        perc: grid("x.xxx.xxx.xxx.xx"),
      },
    },
  }),
  card({
    id: "melanesian",
    summary:
      "string band and bamboo band: fast-strummed guitars and ukulele on I-IV-V, panpipe ensembles in parallel voices",
    tempo: { bpm: [100, 140], typical: 120 },
    meter: { signatures: [["4/4", 1]] },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["axis", 0.5],
      ],
      voicing: { strokes: [["island", 1]] },
    },
    bass: { behaviour: [["root-fifth", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        bass: role("bassguitar", "doublebass:0.5"),
        chords: role("steel", "nylon:0.5"),
        lead: role("sing", "panpipes:0.5"),
        counter: maybe("panpipes"),
      },
    },
  }),
  card({
    id: "island-reggae",
    summary:
      "island reggae: off-beat guitar skank, one-drop kick and snare on beat 3, ukulele strum, I-IV-V love-song changes",
    tempo: { bpm: [70, 100], typical: 84 },
    meter: { signatures: [["4/4", 1]] },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["fifties", 0.5],
      ],
      voicing: { strokes: [["reggae", 1]] },
    },
    bass: { behaviour: [["root-fifth", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        ...KIT_LIGHT,
        bass: role("bassguitar"),
        chords: role("steel", "keys:0.4"),
        lead: role("sing"),
      },
    },
    rhythm: {
      onsets: {
        kick: grid("........x......."),
        snare: grid("........x......."),
        hat: grid("x.x.x.x.x.x.x.x."),
        chords: grid("..x...x...x...x."),
      },
    },
  }),
];

export const EUROPE_ASIA_PACIFIC_CARDS: readonly StyleCard[] = Object.freeze([
  card({
    id: "europe-folk",
    abstract: true,
    summary:
      "dance tunes and strophic song: modal diatonic tunes in 2- and 4-bar strains",
    tempo: { bpm: [90, 140], typical: 112 },
    groove: { subdivision: 2 },
    pitch: {
      scales: [
        ["major", 0.35],
        ["dorian", 0.25],
        ["mixolydian", 0.25],
        ["minor", 0.15],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.3],
        ["mixolydian-rock", 0.3],
        ["dorian-vamp", 0.4],
      ],
      sevenths: 0,
      voicing: { types: [["open", 1]] },
    },
    melody: {
      density: [2, 4],
      repetition: 0.7,
      intervals: intervals(5, 3, 0.6, 0.6),
      phraseBars: [
        [4, 0.7],
        [2, 0.3],
      ],
    },
    bass: {
      behaviour: [
        ["root-fifth", 0.6],
        ["pedal", 0.4],
      ],
    },
    form: {
      plans: [
        [
          [
            "verse",
            "verse",
            "chorus",
            "chorus",
            "verse",
            "verse",
            "chorus",
            "chorus",
          ],
          1,
        ],
      ],
      archetype: "AABB",
    },
    texture: {
      kind: "heterophonic",
      roles: {
        ...NO_KIT,
        bass: maybe("cello"),
        chords: role("acoustic", "lute:0.4", "harp:0.4"),
        lead: role("fiddle", "whistle:0.6", "flute:0.4"),
        perc: maybe("bodhran", "framedrum:0.5"),
      },
    },
    rhythm: { onsets: { perc: grid("x..x..x.") } },
  }),
  card({
    id: "celtic-british",
    abstract: true,
    summary:
      "jigs, reels and airs: 6/8 and 4/4, dorian and mixolydian, drone pipes",
    meter: {
      signatures: [
        ["6/8", 0.4],
        ["4/4", 0.4],
        ["9/8", 0.2],
      ],
    },
  }),
  card({
    id: "nordic-baltic",
    abstract: true,
    summary: "polska and runo song: 3/4 asymmetric lilt, minor and dorian",
    meter: {
      signatures: [
        ["3/4", 0.7],
        ["4/4", 0.3],
      ],
    },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["dorian", 0.5],
      ],
    },
  }),
  card({
    id: "west-europe",
    abstract: true,
    summary:
      "chanson, musette and alpine: waltz and march, major-minor tonality",
    meter: {
      signatures: [
        ["3/4", 0.5],
        ["4/4", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["andalusian", 0.5],
      ],
    },
  }),
  card({
    id: "iberia",
    abstract: true,
    summary:
      "flamenco and fado: phrygian-dominant and andalusian cadence, 12-beat compas",
    pitch: {
      scales: [
        ["phrygian-dominant", 0.5],
        ["harmonic-minor", 0.3],
        ["minor", 0.2],
      ],
    },
    harmony: { presets: [["andalusian", 1]] },
    texture: {
      roles: { chords: role("nylon"), lead: role("nylon", "sing:0.6") },
    },
  }),
  card({
    id: "central-east-europe",
    abstract: true,
    summary:
      "polka, czardas and klezmer neighbours: 2/4 oom-pah, harmonic minor turns",
    meter: {
      signatures: [
        ["2/4", 0.5],
        ["4/4", 0.5],
      ],
    },
    pitch: {
      scales: [
        ["harmonic-minor", 0.4],
        ["major", 0.4],
        ["minor", 0.2],
      ],
    },
  }),
  card({
    id: "balkans-mediterranean",
    abstract: true,
    summary: "aksak meters 7/8, 9/8, 11/8 in 2s and 3s, makam-tinged modes",
    meter: {
      signatures: [
        ["7/8", 0.4],
        ["9/8", 0.3],
        ["11/8", 0.3],
      ],
      grouping: [
        [[3, 2, 2], 0.5],
        [[2, 2, 2, 3], 0.5],
      ],
    },
    pitch: {
      scales: [
        ["phrygian-dominant", 0.4],
        ["minor", 0.3],
        ["hijaz", 0.3],
      ],
    },
    harmony: { model: "modal" },
  }),
  card({
    id: "east-asia",
    abstract: true,
    summary:
      "anhemitonic pentatonic melody, heterophony, ornament over sustained tones, little harmony",
    tempo: { bpm: [56, 110], typical: 76 },
    pitch: {
      scales: [
        ["major-pentatonic", 0.6],
        ["minor-pentatonic", 0.4],
      ],
    },
    harmony: { model: "drone", rhythm: [[0.5, 1]] },
    melody: {
      intervals: intervals(3, 4, 0.8, 0.6),
      chordToneRate: 0.4,
      density: [1, 2],
    },
    bass: {
      behaviour: [
        ["none", 0.6],
        ["pedal", 0.4],
      ],
    },
    texture: {
      kind: "heterophonic",
      roles: {
        ...NO_KIT,
        chords: null,
        drone: maybe("koto", "strings:0.5"),
        lead: role("erhu", "shakuhachi:0.6", "koto:0.5", "flute:0.4"),
      },
    },
    mix: { space: 0.5 },
  }),
  card({
    id: "china",
    abstract: true,
    summary: "gong-shang-jiao-zhi-yu pentatonic, erhu and dizi heterophony",
    texture: { roles: { lead: role("erhu", "flute:0.6") } },
  }),
  card({
    id: "japan",
    abstract: true,
    summary: "in and yo scales, ma silence, koto and shakuhachi",
    pitch: {
      scales: [
        ["major-pentatonic", 0.4],
        ["phrygian", 0.6],
      ],
    },
    melody: { density: [0, 2] },
    texture: { roles: { lead: role("shakuhachi", "koto:0.6") } },
  }),
  card({
    id: "korea",
    abstract: true,
    summary:
      "jangdan cycles in compound triple time, pyeongjo and gyemyeonjo modes",
    meter: {
      signatures: [
        ["12/8", 0.6],
        ["9/8", 0.4],
      ],
    },
  }),
  card({
    id: "central-north-asia",
    abstract: true,
    summary: "steppe song: overtone drone, galloping 6/8, pentatonic long song",
    meter: {
      signatures: [
        ["6/8", 0.6],
        ["4/4", 0.4],
      ],
    },
    texture: {
      roles: {
        drone: role("khoomei", "strings:0.4"),
        lead: role("fiddle", "sing:0.5"),
      },
    },
  }),
  card({
    id: "southeast-asia",
    abstract: true,
    summary:
      "gong-chime colotomy: slendro or pelog tuning, nested cycles, interlocking elaboration",
    tempo: { bpm: [60, 120], typical: 84 },
    pitch: { tuning: "slendro", scales: [["major-pentatonic", 1]] },
    harmony: { model: "drone", rhythm: [[0.25, 1]] },
    melody: {
      chordToneRate: 0.3,
      density: [2, 4],
      repetition: 0.8,
      intervals: intervals(5, 2, 0.5, 0.5),
    },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      kind: "interlocking",
      roles: {
        ...NO_KIT,
        chords: null,
        bass: role("gong", "kempul:0.6"),
        lead: role("saron", "gangsa:0.6", "bonang:0.4"),
        counter: maybe("gender", "bonang:0.5"),
      },
    },
    mix: { space: 0.45 },
  }),
  card({
    id: "oceania",
    abstract: true,
    summary:
      "Pacific song: I-IV-V slack-key and choral harmony, island reggae lilt",
    tempo: { bpm: [70, 120], typical: 92 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["axis", 0.5],
      ],
    },
    texture: {
      roles: {
        ...NO_KIT,
        chords: role("steel", "nylon:0.5"),
        lead: role("sing", "steelpan:0.3"),
      },
    },
  }),
  ...EUROPE_LEAVES,
  ...ASIA_PACIFIC_LEAVES,
]);
