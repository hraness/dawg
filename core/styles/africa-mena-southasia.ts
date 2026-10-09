/**
 * Sub-Saharan Africa, Middle East and North Africa, South Asia (quality-08
 * family `africa-mena-southasia`). `arabic-classical` is the worked
 * non-Western microtonal leaf: maqam bayati with its neutral second as a
 * quarter tone (the 24-tone convention on the `bayati` tuning table),
 * heterophony instead of chords, a sayr that opens on the tonic jins and
 * climbs to the ghammaz (fourth) before returning, and the maqsum iqa as
 * a dum/tak cycle on the frame drum.
 */

import { grid, intervals, kit, maybe, role } from "./parts.ts";
import { card, type CycleSpec, type StyleCard } from "./schema.ts";

// ---------------------------------------------------------------------------
// Timelines, talas, iqa'at and usuller (this lane's section of the cycles).
//
// A cycle is one stroke per beat unit (a quarter in x/4, an eighth in x/8);
// "." is a rest, `stress` and `release` are 1-based beats (tali and khali
// for a tala, dum accents for an iqa'). The divisions (vibhag, anga,
// usul groups) must add up to the beats; `cycle()` checks that.

/** Low (bass-voice) strokes: the open dum and bayan strokes of each family. */
const LOW = Object.freeze([
  "dum",
  "dha",
  "dhin",
  "dhage",
  "ge",
  "thom",
  "dhi",
  "dhom",
]);

/**
 * A rhythmic cycle; throws when strokes and divisions disagree. Every key
 * is set (release and low too) so a child's cycle never inherits its
 * parent's khali or low strokes.
 */
export function cycle(
  kind: CycleSpec["kind"],
  name: string,
  divisions: readonly number[],
  strokes: string,
  stress: readonly number[],
  release: readonly number[] = [],
  low: readonly string[] = LOW,
): CycleSpec {
  const list = strokes.trim().split(/\s+/);
  const beats = divisions.reduce((a, b) => a + b, 0);
  if (list.length !== beats)
    throw new Error(`cycle ${name}: ${list.length} strokes for ${beats} beats`);
  for (const at of [...stress, ...release])
    if (!(at >= 1 && at <= beats))
      throw new Error(`cycle ${name}: beat ${at} outside 1-${beats}`);
  return Object.freeze({
    kind,
    name,
    beats,
    divisions: Object.freeze([...divisions]),
    strokes: Object.freeze(list),
    stress: Object.freeze([...stress]),
    release: Object.freeze([...release]),
    low: Object.freeze([...low]),
  });
}

/** Teental: 16 beats, vibhag 4+4+4+4, sam on 1, khali on 9. */
export const TEENTAL = cycle(
  "tala",
  "teental",
  [4, 4, 4, 4],
  "dha dhin dhin dha dha dhin dhin dha dha tin tin ta ta dhin dhin dha",
  [1, 5, 13],
  [9, 10, 11, 12],
);
/** Ektaal: 12 beats in six vibhag of two; khali on 3 and 7. */
export const EKTAAL = cycle(
  "tala",
  "ektaal",
  [2, 2, 2, 2, 2, 2],
  "dhin dhin dhage tirakita tu na kat ta dhage tirakita dhin na",
  [1, 5, 9, 11],
  [3, 4, 7, 8],
);
/** Chautal: 12 beats, 2+2+2+2+2+2, the pakhawaj cycle of dhrupad. */
export const CHAUTAL = cycle(
  "tala",
  "chautal",
  [2, 2, 2, 2, 2, 2],
  "dha dha din ta kita dha din ta tita kata gadi gana",
  [1, 5, 9, 11],
  [3, 4, 7, 8],
);
/** Deepchandi: 14 beats, 3+4+3+4, khali on 8 (thumri). */
export const DEEPCHANDI = cycle(
  "tala",
  "deepchandi",
  [3, 4, 3, 4],
  "dha dhin . dha dha tin . ta tin . dha dha dhin .",
  [1, 4, 11],
  [8, 9, 10],
);
/** Keherwa: 8 beats, 4+4, khali on 5. */
export const KEHERWA = cycle(
  "tala",
  "keherwa",
  [4, 4],
  "dha ge na ti na ka dhi na",
  [1],
  [5, 6, 7, 8],
);
/** Dadra: 6 beats, 3+3, khali on 4. */
export const DADRA = cycle(
  "tala",
  "dadra",
  [3, 3],
  "dha dhi na dha ti na",
  [1],
  [4, 5, 6],
);
/** Adi tala: 8 beats, laghu 4 + drutam 2 + drutam 2 (claps 1, 5, 7). */
export const ADI = cycle(
  "tala",
  "adi",
  [4, 2, 2],
  "tha ka dhi mi tha ka jo nu",
  [1, 5, 7],
  [6, 8],
);
/** Misra chapu: 7 beats, 3+2+2. */
export const MISRA_CHAPU = cycle(
  "tala",
  "misra chapu",
  [3, 2, 2],
  "tha ki ta tha ka dhi mi",
  [1, 4, 6],
);
/** Rupaka (Carnatic): 6 beats, drutam 2 + laghu 4. */
export const RUPAKA = cycle(
  "tala",
  "rupaka",
  [2, 4],
  "tha ka tha ki ta thom",
  [1, 3],
  [2],
);
/** Maqsum: 8/8 dum tak . tak dum . tak . */
export const MAQSUM = cycle(
  "iqa",
  "maqsum",
  [8],
  "dum tak . tak dum . tak .",
  [1, 5],
);
/** Baladi (masmudi saghir): dum dum . tak dum . tak . */
export const BALADI = cycle(
  "iqa",
  "baladi",
  [8],
  "dum dum . tak dum . tak .",
  [1, 2, 5],
);
/** Sama'i thaqil: 10/8, the muwashshah and sama'i cycle. */
export const SAMAI_THAQIL = cycle(
  "iqa",
  "sama'i thaqil",
  [3, 2, 2, 3],
  "dum . . tak . dum dum tak . .",
  [1, 6, 7],
);
/** Jurjina: 10/8 (3+2+2+3), the Iraqi maqam cycle. */
export const JURJINA = cycle(
  "iqa",
  "jurjina",
  [3, 2, 2, 3],
  "dum . tak dum . tak . dum tak .",
  [1, 4, 8],
);
/** Wahda: 4/4 one dum on the downbeat, the slow tarab and recitation pulse. */
export const WAHDA = cycle("iqa", "wahda", [4], "dum . tak .", [1]);
/** Aksak: 9/8 in 2+2+2+3. */
export const AKSAK = cycle(
  "usul",
  "aksak",
  [2, 2, 2, 3],
  "dum . tek . tek . dum . tek",
  [1, 7],
);
/** Curcuna: 10/8 in 3+2+2+3. */
export const CURCUNA = cycle(
  "usul",
  "curcuna",
  [3, 2, 2, 3],
  "dum . tek dum . tek . tek . .",
  [1, 4],
);
/** Devr-i revan: 14/8 in 3+2+2+3+2+2, the Mevlevi ayin's third selam. */
export const DEVR_I_REVAN = cycle(
  "usul",
  "devr-i revan",
  [3, 2, 2, 3, 2, 2],
  "dum . tek dum . tek . dum . tek tek . tek .",
  [1, 4, 8],
);
/** Devr-i hindi: 7/8 in 3+2+2. */
export const DEVR_I_HINDI = cycle(
  "usul",
  "devr-i hindi",
  [3, 2, 2],
  "dum . tek dum . tek .",
  [1, 4],
);
/** Çiftetelli: 8 beats of 4/4 over two bars, dum on 1, 6 and 7. */
export const CIFTETELLI = cycle(
  "usul",
  "ciftetelli",
  [3, 3, 2],
  "dum tek . tek . dum dum tek",
  [1, 6, 7],
);

/** Jhaptal: 10 beats, vibhag 2+3+2+3, khali on 6. */
export const JHAPTAL = cycle(
  "tala",
  "jhaptal",
  [2, 3, 2, 3],
  "dhi na dhi dhi na ti na dhi dhi na",
  [1, 3, 8],
  [6, 7],
);
/** Rupak: 7 beats, 3+2+2; the sam itself is khali (open, no bayan). */
export const RUPAK = cycle(
  "tala",
  "rupak",
  [3, 2, 2],
  "tin tin na dhi na dhi na",
  [4, 6],
  [1, 2, 3],
);
/** Malfuf: 8/8 in 3+3+2, the quick dabke and zaffa cycle. */
export const MALFUF = cycle(
  "iqa",
  "malfuf",
  [3, 3, 2],
  "dum . . tak . . tak .",
  [1],
);
/** Khaliji: 8/8, dum on 1 and 4, the Gulf clapped pulse. */
export const KHALIJI = cycle(
  "iqa",
  "khaliji",
  [3, 3, 2],
  "dum . . dum tak . tak .",
  [1, 4],
);
/** Masmudi kabir: 16/8, two dums, rest, then the tak run (muwashshah). */
export const MASMUDI_KABIR = cycle(
  "iqa",
  "masmudi kabir",
  [4, 4, 4, 4],
  "dum . dum . . . tak . dum . . tak tak . tak .",
  [1, 3, 9],
);

/** Standard 12/8 bell: seven strokes in 2-2-1-2-2-2-1. */
export const STANDARD_BELL = grid("x.x.xx.x.x.x");
/** Tresillo 3+3+2, twice per 4/4 bar of sixteenths. */
export const TRESILLO = grid("x..x..x.x..x..x.");
/** Four-on-the-floor kick. */
export const FOUR_FLOOR = grid("x...x...x...x...");
/** Backbeat on 2 and 4. */
export const BACKBEAT = grid("....x.......x...");
/** Off-beat eighths (the "and"s). */
export const OFFBEATS = grid("..x...x...x...x.");
/** Straight eighths. */
export const EIGHTHS = grid("x.x.x.x.x.x.x.x.");
/** Sixteenths with the downbeats dropped (a shaker or scraper). */
export const SIXTEENTHS = grid("xxxxxxxxxxxxxxxx");

/** Root and branch cards: the shared patterns every leaf inherits. */
const NODES: readonly StyleCard[] = [
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
      cycle: MAQSUM,
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
      cycle: TEENTAL,
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
];

// ---------------------------------------------------------------------------
// Shared leaf parts.

/** A required kit role on a named synth kit (the drum-set traditions). */
const kitRole = (name: string, weight = 1) =>
  Object.freeze({ required: true, voices: Object.freeze([kit(name, weight)]) });
/** An optional kit role on a named synth kit. */
const kitMaybe = (name: string) =>
  Object.freeze({ required: false, voices: Object.freeze([kit(name)]) });
/** The full kit (kick, snare, hat) on one synth kit. */
const fullKit = (name: string) =>
  Object.freeze({
    kick: kitRole(name),
    snare: kitRole(name),
    hat: kitRole(name),
  });
/** No kit at all (hand drums, bells and voices only). */
const NO_KIT = Object.freeze({
  kick: null,
  snare: null,
  hat: null,
  clap: null,
  rim: null,
  openhat: null,
  tom: null,
});

/** Sung lines: mostly steps, few leaps. */
const CONJUNCT = intervals(5, 2, 0.6, 0.6);
/** Chant: repeated notes and steps (recitation, call and response). */
const CHANT = intervals(4, 1.5, 0.3, 2);
/** Instrumental lines with arpeggiated leaps (guitar sebene, kora runs). */
const LEAPY = intervals(3, 2.5, 1.2, 0.4);
/** Ornamented steps (gamaka, tahrir, meend): seconds dominate. */
const ORNATE = intervals(8, 1.5, 0.3, 0.5);

const LEAVES: readonly StyleCard[] = [
  // West Africa. References: J. H. Kwabena Nketia, The Music of Africa
  // (1974); Eric Charry, Mande Music (2000).
  card({
    id: "highlife",
    summary:
      "highlife: 4/4 with the 12/8 bell felt underneath, palm-wine guitar arpeggios, I-IV-V cycles, horn riffs answering the voice",
    tempo: { bpm: [100, 132], typical: 116 },
    meter: { signatures: [["4/4", 1]], hypermeter: [[4, 1]] },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: BACKBEAT,
        hat: EIGHTHS,
        bell: grid("x.x.x..x.x.x.x.."),
        chords: OFFBEATS,
      },
    },
    harmony: {
      forms: [[["I", "IV", "I", "V"], 1]],
      sources: { forms: 2, presets: 1 },
      presets: [["fifties", 1]],
    },
    texture: {
      roles: {
        ...fullKit("acoustic"),
        chords: role("electric", "nylon:0.5"),
        lead: role("sing", "trumpet:0.4", "sax:0.4"),
        counter: maybe("trumpet", "sax:0.6"),
      },
    },
  }),
  card({
    id: "hiplife",
    summary:
      "hiplife and azonto: highlife chord loops under rapped and sung Twi, programmed kit with a syncopated kick, bell on top",
    tempo: { bpm: [96, 124], typical: 108 },
    meter: { signatures: [["4/4", 1]], hypermeter: [[4, 1]] },
    rhythm: {
      onsets: {
        kick: grid("x..x..x...x....."),
        snare: BACKBEAT,
        hat: SIXTEENTHS,
        bell: grid("x.x..x.x..x.x..."),
      },
    },
    harmony: {
      presets: [
        ["axis", 0.6],
        ["sad-pop", 0.4],
      ],
    },
    melody: { intervals: CHANT, density: [2, 3] },
    texture: {
      roles: {
        ...fullKit("syn808"),
        chords: role("keys", "electric:0.5"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "afrobeat",
    summary:
      "afrobeat: one-chord modal vamp (dorian) for minutes, interlocking tenor and rhythm guitar, open-hat sixteenths, horn-section riffs, long build",
    tempo: { bpm: [100, 128], typical: 112 },
    meter: { signatures: [["4/4", 1]], hypermeter: [[4, 1]] },
    pitch: {
      scales: [
        ["dorian", 0.7],
        ["minor-pentatonic", 0.3],
      ],
    },
    harmony: {
      model: "modal",
      rhythm: [[0.5, 1]],
      presets: [["dorian-vamp", 1]],
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x...x....."),
        snare: grid("....x..x....x..."),
        hat: SIXTEENTHS,
        bell: EIGHTHS,
        chords: grid(".x.x.x.x.x.x.x.x"),
      },
    },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x..x...x.x..x...") },
    form: {
      plans: [
        [["intro", "verse", "verse", "chorus", "breakdown", "chorus"], 1],
      ],
      archetype: "vamp-build",
    },
    texture: {
      roles: {
        ...fullKit("acoustic"),
        bass: role("ebass"),
        chords: role("electric"),
        lead: role("sax", "sing:0.6", "trumpet:0.4"),
        counter: role("trumpet", "trombone:0.6"),
        pad: maybe("organ"),
      },
    },
  }),
  card({
    id: "afrobeats",
    summary:
      "afrobeats: the 3+3+2 tresillo kick under a log-drum and shaker groove, sparse minor-pop loops, sung hooks, half-step syncopation",
    tempo: { bpm: [96, 116], typical: 104 },
    meter: { signatures: [["4/4", 1]], hypermeter: [[4, 1]] },
    rhythm: {
      onsets: {
        kick: TRESILLO,
        snare: grid("...x...x...x..x."),
        hat: SIXTEENTHS,
        shaker: SIXTEENTHS,
        bell: grid("..x..x....x..x.."),
      },
    },
    harmony: {
      presets: [
        ["sad-pop", 0.5],
        ["aeolian", 0.5],
      ],
      sevenths: 0.3,
    },
    melody: { intervals: CONJUNCT, repetition: 0.8 },
    texture: {
      roles: {
        ...fullKit("trap"),
        bass: role("bass", "saw:0.3"),
        chords: role("keys", "epiano:0.6", "pluck:0.4"),
        lead: role("sing"),
      },
    },
    mix: { loudness: "streaming" },
  }),
  card({
    id: "juju",
    summary:
      "juju: talking-drum call and response over steel-guitar lines, I-IV-V hymn harmony, layered hand drums in a medium 4/4 lilt",
    tempo: { bpm: [92, 120], typical: 104 },
    meter: { signatures: [["4/4", 1]], hypermeter: [[4, 1]] },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        perc: grid("x..x..x.x.x..x.."),
        bell: grid("x.x.x.x.x.x.x.x."),
        chords: OFFBEATS,
      },
    },
    harmony: { forms: [[["I", "IV", "V", "I"], 1]], sources: { forms: 3 } },
    texture: {
      roles: {
        chords: role("electric", "steel:0.6"),
        lead: role("sing", "steel:0.4"),
        counter: maybe("steel"),
      },
    },
  }),
  card({
    id: "fuji",
    summary:
      "fuji and apala: drums and voice only, no chords, pentatonic call and response over a dense dundun and sakara cross-rhythm",
    tempo: { bpm: [110, 140], typical: 124 },
    meter: { signatures: [["4/4", 1]], hypermeter: [[4, 1]] },
    pitch: { scales: [["major-pentatonic", 1]] },
    harmony: { model: "drone" },
    rhythm: {
      onsets: {
        kick: grid("x..x...x..x....."),
        perc: grid("x.xx.x.xx.x.x.xx"),
        bell: grid("x.x.x.x.x.x.x.x."),
      },
    },
    melody: { intervals: CHANT, density: [2, 3] },
    bass: { behaviour: [["none", 1]] },
    texture: {
      kind: "call-response",
      roles: {
        chords: null,
        bass: null,
        lead: role("sing"),
        counter: role("choir"),
      },
    },
  }),
  card({
    id: "griot",
    summary:
      "griot and kora: a kumbengo ostinato under birimintingo runs, heptatonic Mande scale, sung praise in long arching phrases, 12/8 felt in fours",
    tempo: { bpm: [96, 132], typical: 112 },
    meter: { signatures: [["12/8", 1]], hypermeter: [[2, 1]] },
    pitch: {
      scales: [
        ["major", 0.5],
        ["lydian", 0.3],
        ["mixolydian", 0.2],
      ],
    },
    harmony: { model: "modal", rhythm: [[0.5, 1]] },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x..x..x..x..") },
    melody: {
      intervals: LEAPY,
      contour: [
        ["arch", 0.6],
        ["descending", 0.4],
      ],
    },
    texture: {
      roles: {
        ...NO_KIT,
        bass: role("harp"),
        chords: role("harp"),
        lead: role("sing", "harp:0.6"),
        counter: maybe("harp", "xylophone:0.5"),
        perc: maybe("framedrum"),
      },
    },
  }),
  card({
    id: "mande-pop",
    summary:
      "Mande and wassoulou pop: pentatonic kamalengoni ostinato, shekere sixteenths, a 12/8 lope with a swung 4/4 kit, women's call and response",
    tempo: { bpm: [100, 136], typical: 118 },
    pitch: {
      scales: [
        ["minor-pentatonic", 0.6],
        ["major-pentatonic", 0.4],
      ],
    },
    harmony: { model: "modal", rhythm: [[0.5, 1]] },
    bass: { behaviour: [["ostinato", 1]] },
    texture: {
      roles: {
        snare: maybe("drums"),
        chords: role("harp", "electric:0.6"),
        lead: role("sing"),
        counter: maybe("harp", "flute:0.5"),
      },
    },
  }),
  card({
    id: "desert-blues",
    summary:
      "desert blues: minor-pentatonic guitar hypnosis on a single tonic drone, 6/8 camel-gait lope, handclaps and calabash, no chord changes",
    tempo: { bpm: [84, 120], typical: 100 },
    meter: { signatures: [["6/8", 1]], hypermeter: [[4, 1]] },
    pitch: {
      scales: [
        ["minor-pentatonic", 0.6],
        ["blues", 0.4],
      ],
    },
    harmony: { model: "drone", rhythm: [[0.25, 1]] },
    rhythm: {
      onsets: {
        kick: grid("x.....x....."),
        clap: grid("...x.....x.."),
        perc: grid("x..x.xx..x.x"),
      },
    },
    bass: { behaviour: [["pedal", 1]] },
    melody: { intervals: CONJUNCT, ambitus: [5, 12] },
    texture: {
      roles: {
        bell: null,
        clap: kitRole("acoustic"),
        drone: role("electric"),
        lead: role("electric", "sing:0.6"),
        counter: maybe("electric"),
      },
    },
  }),
  card({
    id: "mbalax",
    summary:
      "mbalax: sabar drum rolls in fast cross-rhythm, tama talking drum fills, bright major-key keys and guitar, melismatic Wolof lead",
    tempo: { bpm: [120, 150], typical: 132 },
    meter: { signatures: [["4/4", 1]], hypermeter: [[4, 1]] },
    rhythm: {
      onsets: {
        kick: grid("x..x..x.x......."),
        snare: grid("....x..x....x.x."),
        hat: SIXTEENTHS,
        perc: grid("xx.x.xx.x.xx.x.x"),
      },
    },
    melody: { intervals: ORNATE, density: [2, 4] },
    texture: {
      roles: {
        ...fullKit("acoustic"),
        chords: role("keys", "electric:0.6"),
        lead: role("sing", "sax:0.3"),
      },
    },
  }),
  card({
    id: "morna",
    summary:
      "morna and coladeira: slow 4/4 lament (sodade), minor key with V7-i and iv cadences, cavaquinho off-beat chops over nylon guitar",
    tempo: { bpm: [60, 96], typical: 76 },
    meter: { signatures: [["4/4", 1]], hypermeter: [[4, 1]] },
    pitch: {
      scales: [
        ["harmonic-minor", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["minor-ii-v", 0.6],
        ["andalusian", 0.4],
      ],
      cadences: [
        ["V-I", 0.7],
        ["iv-I", 0.3],
      ],
      sevenths: 0.5,
    },
    rhythm: {
      onsets: {
        chords: grid("x..x..x.x..x..x."),
        perc: grid("..x...x...x...x."),
      },
    },
    melody: {
      intervals: CONJUNCT,
      contour: [
        ["arch", 0.7],
        ["descending", 0.3],
      ],
    },
    texture: {
      roles: {
        ...NO_KIT,
        bell: null,
        chords: role("nylon"),
        bass: role("upright", "nylon:0.4"),
        lead: role("sing", "violin:0.3", "clarinet:0.3"),
        counter: maybe("violin", "piano:0.5"),
      },
    },
  }),
  card({
    id: "funana",
    summary:
      "funana: fast duple accordion two-chord pendulum (I-V or i-bVII), ferrinho scraper on every sixteenth, bass on every beat",
    tempo: { bpm: [128, 160], typical: 140 },
    meter: { signatures: [["4/4", 1]], hypermeter: [[4, 1]] },
    harmony: {
      forms: [
        [["I", "V"], 0.6],
        [["i", "bVII"], 0.4],
      ],
      sources: { forms: 3 },
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        kick: FOUR_FLOOR,
        shaker: SIXTEENTHS,
        chords: EIGHTHS,
      },
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: FOUR_FLOOR },
    texture: {
      roles: {
        bell: null,
        perc: null,
        shaker: role("drums"),
        chords: role("organ", "keys:0.5"),
        lead: role("sing", "organ:0.5"),
      },
    },
  }),
  card({
    id: "west-african-drum",
    summary:
      "djembe ensemble: the 12/8 bell and three dundun ostinati interlock, the lead djembe solos against the timeline, no harmony",
    tempo: { bpm: [110, 150], typical: 128 },
    meter: { signatures: [["12/8", 1]], hypermeter: [[2, 1]] },
    pitch: { scales: [["major-pentatonic", 1]] },
    harmony: { model: "none" },
    rhythm: {
      onsets: {
        bell: STANDARD_BELL,
        kick: grid("x.....x..x.."),
        perc: grid("x.xx.xx.xx.x"),
        shaker: grid("xxxxxxxxxxxx"),
      },
    },
    bass: { behaviour: [["none", 1]] },
    melody: { intervals: CHANT, density: [1, 2] },
    texture: {
      kind: "interlocking",
      roles: {
        chords: null,
        bass: null,
        lead: role("sing", "flute:0.4"),
      },
    },
  }),
  card({
    id: "ewe-drumming",
    summary:
      "Ewe dance drumming (agbadza): the gankogui bell 2-2-1-2-2-2-1 is the timeline, support drums answer on off-pulses, atsimevu leads",
    tempo: { bpm: [100, 140], typical: 120 },
    meter: { signatures: [["12/8", 1]], hypermeter: [[2, 1]] },
    pitch: { scales: [["major-pentatonic", 1]] },
    harmony: { model: "none" },
    rhythm: {
      onsets: {
        bell: STANDARD_BELL,
        kick: grid("x.....x....."),
        perc: grid("..x..x..x..x"),
        shaker: grid("x..x..x..x.."),
      },
    },
    bass: { behaviour: [["none", 1]] },
    melody: { intervals: CHANT },
    texture: {
      kind: "interlocking",
      roles: {
        chords: null,
        bass: null,
        lead: role("sing"),
        counter: role("choir"),
      },
    },
  }),

  // Central Africa. References: Gary Stewart, Rumba on the River (2000);
  // Simha Arom, African Polyphony and Polyrhythm (1991).
  card({
    id: "soukous",
    summary:
      "soukous and Congolese rumba: a sung rumba half, then the sebene: interlocking lead, mi-solo and rhythm guitars over a I-IV-V-IV cycle",
    tempo: { bpm: [116, 150], typical: 132 },
    harmony: { forms: [[["I", "IV", "V", "IV"], 1]], sources: { forms: 3 } },
    rhythm: { onsets: { hat: SIXTEENTHS } },
    melody: { intervals: LEAPY, density: [2, 4] },
    texture: {
      roles: {
        ...fullKit("acoustic"),
        bass: role("ebass"),
        counter: role("electric"),
      },
    },
  }),
  card({
    id: "makossa",
    summary:
      "makossa and bikutsi: makossa's busy melodic bass on a four-on-the-floor; bikutsi's 6/8 hammered against 4/4, balafon-like guitar",
    tempo: { bpm: [110, 140], typical: 124 },
    rhythm: { onsets: { kick: FOUR_FLOOR, hat: OFFBEATS } },
    bass: {
      behaviour: [
        ["arpeggio", 0.6],
        ["walking", 0.4],
      ],
    },
    texture: {
      roles: {
        ...fullKit("acoustic"),
        bass: role("ebass"),
        chords: role("electric", "marimba:0.4"),
        counter: maybe("sax", "trumpet:0.5"),
      },
    },
  }),
  card({
    id: "aka-polyphony",
    summary:
      "forest polyphony: yodelled interlocking voices in a pentatonic cycle, each part a short ostinato, hand claps and a hemiola pulse",
    tempo: { bpm: [100, 132], typical: 116 },
    meter: { signatures: [["12/8", 1]], hypermeter: [[2, 1]] },
    pitch: { scales: [["major-pentatonic", 1]] },
    harmony: { model: "none" },
    rhythm: {
      onsets: {
        clap: grid("x.x.xx.x.x.x"),
        perc: grid("x..x..x..x.."),
      },
    },
    bass: { behaviour: [["none", 1]] },
    melody: { intervals: LEAPY, repetition: 0.85, ambitus: [7, 14] },
    texture: {
      kind: "interlocking",
      roles: {
        ...NO_KIT,
        clap: kitRole("acoustic"),
        bell: null,
        chords: null,
        bass: null,
        lead: role("sing"),
        counter: role("choir", "flute:0.4"),
      },
    },
  }),
];

export const AFRICA_MENA_SOUTHASIA_CARDS: readonly StyleCard[] = [
  ...NODES,
  ...LEAVES,
];
