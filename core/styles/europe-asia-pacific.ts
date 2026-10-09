/**
 * European folk, East and Southeast Asia, Oceania (quality-08 family
 * `europe-asia-pacific`). Root and branch cards only.
 */

import { grid, intervals, kitRoles, maybe, role } from "./parts.ts";
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
    tempo: { bpm: [56, 90], typical: 70 },
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
]);
