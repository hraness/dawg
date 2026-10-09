/**
 * Rock, punk and metal (quality-08 family `rock`): the root, six branch
 * cards and every leaf. Branch cards carry the shared patterns; a leaf
 * carries only its deltas and names its defining concepts in `summary`
 * (the theory note, searchable by /style search).
 *
 * Grids follow the card's subdivision: the root and most branches count in
 * eighths (8 steps a 4/4 bar), metal in sixteenths (16 steps), shuffle and
 * 12/8 styles in triplets (12 steps). `x` is a defining hit, digits are
 * optional ghosts (`5` = half the bars).
 *
 * References (theory, not material):
 * - Walter Everett, "The Foundations of Rock" (2009): backbeat, the
 *   mixolydian bVII, power-chord voicing, the 12-bar and its boogie bass.
 * - Ken Stephenson, "What to Listen For in Rock" (2002): rock harmonic
 *   grammar (plagal and double-plagal motion, bVI-bVII-I, modal loops).
 * - Dylan Hicks / Mark Spicer: accumulative form, quiet-loud dynamics.
 * - Dietmar Elflein, "Schwermetallanalysen" (2010) and Esa Lilja, "Theory
 *   and Analysis of Classic Heavy Metal Harmony" (2009): aeolian and
 *   phrygian riffing, the bII, pedal-point riffs, gallops, blast beats.
 */

import { grid, intervals, kit, maybe, role } from "./parts.ts";
import { card, type RoleTexture, type StyleCard } from "./schema.ts";

// Eighth-note grids (8 steps per 4/4 bar).
const BACKBEAT = grid("..x...x.");
const EIGHTHS = grid("xxxxxxxx");
const QUARTERS = grid("x.x.x.x.");
// Sixteenth grids (16 steps per 4/4 bar).
const BACKBEAT16 = grid("....x.......x...");
const EIGHTHS16 = grid("x.x.x.x.x.x.x.x.");
const SIXTEENTHS = grid("xxxxxxxxxxxxxxxx");
const QUARTERS16 = grid("x...x...x...x...");
// Triplet grids (12 steps per 4/4 bar): the shuffle's long-short pairs.
const SHUFFLE_HAT = grid("x.xx.xx.xx.x");
const SHUFFLE_SNARE = grid("...x.....x..");
const SHUFFLE_KICK = grid("x.....x.....");

/** The drum machine kits (coldwave, synth punk, industrial). */
const MACHINE: RoleTexture = Object.freeze({
  required: true,
  voices: Object.freeze([kit("electro"), kit("syn808", 0.5)]),
});
const MACHINE_KIT = { kick: MACHINE, snare: MACHINE, hat: MACHINE };
const LOFI_KIT: RoleTexture = Object.freeze({
  required: true,
  voices: Object.freeze([kit("lofi")]),
});
const KIT_TOM: RoleTexture = Object.freeze({
  required: true,
  voices: Object.freeze([kit("acoustic")]),
});
const KIT_TOM_OPT: RoleTexture = Object.freeze({
  required: false,
  voices: Object.freeze([kit("acoustic")]),
});
const KIT_CLAP: RoleTexture = Object.freeze({
  required: true,
  voices: Object.freeze([kit("acoustic")]),
});
const SHAKER: RoleTexture = Object.freeze({
  required: false,
  voices: Object.freeze([kit("acoustic")]),
});

const TWELVE_BAR = [
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
] as const;
/** Quick-change 12-bar: IV in bar 2. */
const QUICK_CHANGE = [
  "I7",
  "IV7",
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
] as const;
/** Pentatonic riff melodies: steps and thirds, few leaps. */
const RIFF = intervals(1, 1.4, 0.5, 0.6);
/** Wide, vocal-anthem lines with fourth and fifth leaps. */
const ANTHEM = intervals(1, 0.9, 0.7, 0.4, 1.1);
/** Chromatic, half-step-heavy metal lines (semitone weight added after). */
const CHROMATIC = intervals(1.4, 0.6, 0.3, 0.5);
/** Shred: scalar runs, step-dominated, fast. */
const SHRED = intervals(2, 0.6, 0.2, 0.1);

export const ROCK_CARDS: readonly StyleCard[] = Object.freeze([
  // -------------------------------------------------------------------
  // Root: backbeat (snare on 2 and 4), driving eighth hats, the power
  // chord (root and fifth), the mixolydian bVII and pentatonic riffs,
  // root-note eighth bass locked to the kick, verse-chorus form.
  card({
    id: "rock-family",
    abstract: true,
    summary:
      "backbeat on 2 and 4, eighth-note drive, power chords, mixolydian bVII, pentatonic riffs, verse-chorus",
    tempo: { bpm: [90, 160], typical: 120 },
    groove: { subdivision: 2, velocity: [1, 0.75] },
    rhythm: {
      onsets: {
        kick: grid("x...x.1."),
        snare: BACKBEAT,
        hat: EIGHTHS,
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
      cadences: [
        ["bVII-I", 0.35],
        ["IV-I", 0.35],
        ["V-I", 0.3],
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
    melody: {
      range: [57, 79],
      chordToneRate: 0.7,
      repetition: 0.6,
      intervals: RIFF,
    },
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

  // -------------------------------------------------------------------
  // Early rock: the 12-bar blues as fixed changes, a 12-bar hypermeter,
  // shuffle (swung eighths) or straight eights, the boogie bass (root,
  // third, fifth, sixth arpeggio), dominant sevenths on every degree.
  card({
    id: "early-rock",
    abstract: true,
    summary:
      "rock and roll: 12-bar blues changes, shuffle or straight eights, boogie bass on 1-3-5-6, dominant sevenths",
    tempo: { bpm: [120, 180], typical: 150 },
    meter: { hypermeter: [[12, 1]] },
    groove: { swingRatio: [1, 1.8] },
    pitch: {
      scales: [
        ["major-blues", 0.4],
        ["mixolydian", 0.4],
        ["major-pentatonic", 0.2],
      ],
    },
    harmony: {
      forms: [
        [TWELVE_BAR, 0.7],
        [QUICK_CHANGE, 0.3],
      ],
      presets: [["fifties", 1]],
      sources: { forms: 2, presets: 1 },
      cadences: [
        ["V-I", 0.6],
        ["IV-I", 0.4],
      ],
      voicing: {
        types: [
          ["close", 0.6],
          ["power", 0.4],
        ],
      },
    },
    bass: { behaviour: [["arpeggio", 1]] },
    form: {
      plans: [[["intro", "verse", "verse", "bridge", "verse", "outro"], 1]],
      archetype: "12-bar",
    },
    texture: {
      roles: {
        chords: role("piano", "electric:0.7"),
        bass: role("contrabass", "ebass:0.5"),
      },
    },
  }),
  card({
    id: "rock-and-roll",
    summary:
      "rock and roll: hard shuffle, 12-bar blues, boogie-woogie bass and piano triplets, backbeat snare",
    tempo: { bpm: [140, 185], typical: 165 },
    groove: { swingRatio: [1.6, 2] },
    texture: {
      roles: {
        chords: role("piano", "honkytonk:0.5"),
        lead: role("tenorsax", "gtr-lead:0.7", "sing:0.6"),
      },
    },
  }),
  card({
    id: "rockabilly",
    summary:
      "rockabilly: slap upright on 1 and 3 with the click on 2 and 4, slapback echo, twangy clean lead, light shuffle",
    tempo: { bpm: [150, 200], typical: 175 },
    groove: { swingRatio: [1.4, 1.8] },
    rhythm: { onsets: { kick: grid("x...x..."), hat: QUARTERS } },
    bass: {
      behaviour: [["root-fifth", 1]],
      onsets: grid("x.x.x.x."),
      kickLock: 0.5,
    },
    texture: {
      roles: {
        bass: role("slap"),
        chords: role("electric@clean", "acoustic:0.5"),
        lead: role("electric@clean", "sing:0.6"),
      },
    },
  }),
  card({
    id: "skiffle",
    summary:
      "skiffle: strummed acoustic and banjo, washboard shuffle, tea-chest bass on root-fifth, three-chord I-IV-V",
    tempo: { bpm: [130, 180], typical: 150 },
    groove: { swingRatio: [1.4, 1.8] },
    rhythm: {
      onsets: { kick: grid("x...x..."), shaker: EIGHTHS, hat: null },
    },
    harmony: {
      forms: [[["I", "I", "IV", "I", "V", "IV", "I", "V"], 1]],
      presets: [["fifties", 1]],
      voicing: { types: [["close", 1]], strokes: [["folk", 1]] },
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: QUARTERS, kickLock: 0.4 },
    form: { plans: [[["intro", "verse", "chorus", "verse", "chorus"], 1]] },
    texture: {
      roles: {
        hat: null,
        shaker: SHAKER,
        bass: role("doublebass"),
        chords: role("acoustic", "banjo:0.6"),
        lead: role("sing", "banjo:0.4"),
      },
    },
  }),
  card({
    id: "surf",
    summary:
      "surf rock: spring-reverb twang, tremolo-picked sixteenth lead, phrygian-dominant and andalusian i-bVII-bVI-V, floor-tom surf beat",
    tempo: { bpm: [150, 180], typical: 165 },
    groove: { subdivision: 4, swingRatio: [1, 1] },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x......."),
        snare: BACKBEAT16,
        hat: EIGHTHS16,
        tom: grid("x.x.x.x.x.x.x.x."),
      },
    },
    pitch: {
      scales: [
        ["phrygian-dominant", 0.4],
        ["harmonic-minor", 0.3],
        ["minor", 0.3],
      ],
    },
    harmony: {
      forms: [],
      presets: [
        ["andalusian", 0.6],
        ["aeolian", 0.4],
      ],
      sources: {},
      cadences: [["V-I", 1]],
    },
    melody: { density: [3, 4], intervals: SHRED },
    bass: { behaviour: [["root", 1]], onsets: QUARTERS16, kickLock: 0.4 },
    form: { archetype: "verse-chorus" },
    texture: {
      roles: {
        tom: KIT_TOM_OPT,
        chords: role("electric@spring"),
        lead: role("electric@spring"),
        bass: role("ebass"),
      },
    },
    mix: { space: 0.5 },
  }),
  card({
    id: "twist",
    summary:
      "twist and dance crazes: straight eights, I-vi-IV-V doo-wop changes, tenor sax hook, handclaps on the backbeat",
    tempo: { bpm: [145, 170], typical: 156 },
    groove: { swingRatio: [1, 1.15] },
    rhythm: { onsets: { clap: BACKBEAT } },
    harmony: {
      forms: [],
      presets: [["fifties", 1]],
      sources: {},
      cadences: [["V-I", 1]],
    },
    texture: {
      roles: {
        clap: KIT_CLAP,
        lead: role("sing", "tenorsax:0.7"),
        counter: maybe("tenorsax"),
      },
    },
  }),
  card({
    id: "beat",
    summary:
      "beat and British invasion: jangly Rickenbacker chords, borrowed bVI and bVII, close harmony vocals, straight eights",
    tempo: { bpm: [120, 150], typical: 136 },
    meter: { hypermeter: [[4, 1]] },
    groove: { swingRatio: [1, 1.1] },
    pitch: {
      scales: [
        ["major", 0.6],
        ["mixolydian", 0.4],
      ],
    },
    harmony: {
      forms: [],
      presets: [
        ["fifties", 0.4],
        ["mixolydian-rock", 0.3],
        ["axis", 0.3],
      ],
      chain: {
        I: [
          ["IV", 2],
          ["bVI", 1],
          ["vi", 1],
        ],
        IV: [
          ["V", 2],
          ["bVII", 1],
        ],
        bVI: [["bVII", 1]],
        bVII: [["I", 1]],
        vi: [["IV", 1]],
        V: [["I", 1]],
      },
      sources: { presets: 2, chain: 1 },
      voicing: { types: [["close", 1]], strokes: [["jangle", 1]] },
    },
    bass: {
      behaviour: [
        ["root-fifth", 0.6],
        ["root", 0.4],
      ],
    },
    form: {
      plans: [
        [
          ["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus"],
          1,
        ],
      ],
      archetype: "verse-chorus",
    },
    texture: {
      roles: {
        chords: role("jangle", "electric@clean:0.5"),
        bass: role("ebass"),
        lead: role("sing"),
        counter: maybe("choir"),
      },
    },
  }),
  card({
    id: "garage-rock",
    summary:
      "garage rock: fuzz guitar and combo organ, two- and three-chord I-bVII-IV riffs, raw straight eights",
    tempo: { bpm: [130, 170], typical: 148 },
    groove: { swingRatio: [1, 1.1] },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["minor-pentatonic", 0.5],
      ],
    },
    harmony: {
      forms: [[["I", "bVII", "IV", "I"], 1]],
      presets: [["mixolydian-rock", 1]],
      cadences: [["bVII-I", 1]],
      voicing: { types: [["power", 1]] },
    },
    bass: { behaviour: [["root", 1]] },
    texture: {
      roles: {
        chords: role("electric@fuzz"),
        counter: maybe("farfisa", "vox:0.6"),
        bass: role("ebass"),
        lead: role("sing", "electric@fuzz:0.4"),
      },
    },
  }),
  card({
    id: "instrumental-rock",
    summary:
      "instrumental rock: the twangy clean guitar carries the tune, I-IV-V and fifties changes, no vocal",
    tempo: { bpm: [120, 160], typical: 138 },
    groove: { swingRatio: [1, 1.3] },
    harmony: {
      forms: [[TWELVE_BAR, 1]],
      presets: [["fifties", 1]],
      sources: { forms: 1, presets: 1 },
    },
    melody: { repetition: 0.7, intervals: ANTHEM },
    texture: {
      roles: {
        lead: role("electric@clean", "gtr-lead:0.6"),
        chords: role("electric@crunch", "piano:0.4"),
      },
    },
    mix: { space: 0.35 },
  }),

  // -------------------------------------------------------------------
  // Classic and hard rock: riff-driven, the double-plagal bVII-IV-I,
  // minor-pentatonic riffs over major chords, loud backbeat, plexi crunch.
  card({
    id: "classic-rock",
    abstract: true,
    summary:
      "classic and hard rock: riff-driven, double-plagal bVII-IV-I, minor pentatonic over major chords, loud backbeat",
    harmony: {
      presets: [
        ["mixolydian-rock", 0.6],
        ["aeolian", 0.4],
      ],
      cadences: [
        ["bVII-I", 0.5],
        ["IV-I", 0.5],
      ],
    },
    texture: {
      roles: {
        chords: role("electric@crunch", "electric@lead:0.4"),
        counter: maybe("hammond", "electric:0.6"),
      },
    },
  }),
  card({
    id: "psychedelic-rock",
    summary:
      "psychedelic rock: modal mixolydian and dorian vamps, tonic pedal point and drone, fuzz and phaser, slow-to-mid tempo",
    tempo: { bpm: [80, 130], typical: 104 },
    rhythm: { onsets: { kick: grid("x......x") } },
    pitch: {
      scales: [
        ["mixolydian", 0.4],
        ["dorian", 0.4],
        ["phrygian-dominant", 0.2],
      ],
    },
    harmony: { model: "modal", rhythm: [[0.5, 1]] },
    bass: {
      behaviour: [
        ["pedal", 0.5],
        ["root", 0.5],
      ],
    },
    texture: {
      roles: {
        chords: role("electric@fuzz", "hammond:0.6"),
        drone: maybe("tanpura", "organ:0.5"),
        lead: role("sing", "electric@fuzz:0.5", "sitar:0.4"),
      },
    },
    mix: { fx: { chords: { phaser: "slow" } }, space: 0.45 },
  }),
  card({
    id: "blues-rock",
    summary:
      "blues rock: 12-bar shuffle, blues scale over dominant-seventh changes, call-and-response lead, triplet feel",
    tempo: { bpm: [70, 130], typical: 96 },
    meter: { hypermeter: [[12, 1]] },
    groove: { subdivision: 3, swingRatio: [1, 1] },
    rhythm: {
      onsets: { kick: SHUFFLE_KICK, snare: SHUFFLE_SNARE, hat: SHUFFLE_HAT },
    },
    pitch: {
      scales: [
        ["blues", 0.6],
        ["minor-pentatonic", 0.4],
      ],
    },
    harmony: {
      forms: [
        [TWELVE_BAR, 0.6],
        [QUICK_CHANGE, 0.4],
      ],
      sources: { forms: 1 },
      presets: [],
      cadences: [
        ["V-I", 0.5],
        ["IV-I", 0.5],
      ],
      sevenths: 1,
    },
    bass: {
      behaviour: [
        ["arpeggio", 0.6],
        ["root-fifth", 0.4],
      ],
      onsets: grid("x..x..x..x.."),
      kickLock: 0.4,
    },
    form: { archetype: "12-bar" },
  }),
  card({
    id: "hard-rock",
    summary:
      "hard rock: minor-pentatonic riffs on power chords, plexi crunch, kick on 1 and the and of 3, arena chorus",
    tempo: { bpm: [100, 150], typical: 124 },
    rhythm: { onsets: { kick: grid("x...xx..") } },
    pitch: {
      scales: [
        ["minor-pentatonic", 0.5],
        ["mixolydian", 0.3],
        ["minor", 0.2],
      ],
    },
    harmony: { voicing: { types: [["power", 1]] } },
    texture: {
      roles: { chords: role("electric@lead", "electric@crunch:0.5") },
    },
  }),
  card({
    id: "southern-rock",
    summary:
      "southern rock: mixolydian I-bVII-IV, twin harmonised lead guitars in thirds, light shuffle, honky-tonk piano",
    tempo: { bpm: [90, 140], typical: 112 },
    rhythm: { onsets: { kick: grid("x..x..x.") } },
    groove: { swingRatio: [1.1, 1.4] },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["major-pentatonic", 0.3],
        ["major-blues", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["mixolydian-rock", 0.7],
        ["fifties", 0.3],
      ],
    },
    texture: {
      roles: {
        counter: role("gtr-lead"),
        chords: role("electric@crunch", "honkytonk:0.5"),
      },
    },
  }),
  card({
    id: "glam-rock",
    summary:
      "glam rock: stomping quarter-note kick, handclaps on 2 and 4, boogie riffs, sing-along chorus",
    tempo: { bpm: [110, 140], typical: 124 },
    rhythm: { onsets: { kick: grid("x.x.x.x."), clap: BACKBEAT } },
    harmony: {
      presets: [
        ["mixolydian-rock", 0.5],
        ["fifties", 0.5],
      ],
    },
    bass: { onsets: QUARTERS },
    texture: { roles: { clap: KIT_CLAP, counter: maybe("piano", "saw:0.5") } },
  }),
  card({
    id: "pub-rock",
    summary:
      "pub rock: back-to-basics R&B, boogie piano, light shuffle 12-bar and I-IV-V, small-room sound",
    tempo: { bpm: [130, 165], typical: 145 },
    rhythm: { onsets: { kick: grid("x.xx..x.") } },
    groove: { swingRatio: [1.2, 1.5] },
    harmony: {
      forms: [[TWELVE_BAR, 1]],
      presets: [["fifties", 1]],
      sources: { forms: 1, presets: 1 },
      cadences: [
        ["V-I", 0.5],
        ["IV-I", 0.5],
      ],
    },
    bass: {
      behaviour: [
        ["arpeggio", 0.6],
        ["root", 0.4],
      ],
    },
    texture: { roles: { chords: role("piano", "electric@crunch:0.7") } },
    mix: { space: 0.15 },
  }),
  card({
    id: "soft-rock",
    summary:
      "soft and yacht rock: major-seventh and ninth chords, ii-V turnarounds, electric piano, smooth laid-back backbeat",
    tempo: { bpm: [70, 105], typical: 88 },
    groove: { subdivision: 4, swingRatio: [1, 1.1] },
    rhythm: {
      onsets: {
        kick: grid("x.....3.x.3....."),
        snare: BACKBEAT16,
        hat: EIGHTHS16,
      },
    },
    pitch: {
      scales: [
        ["major", 0.7],
        ["dorian", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["turnaround", 0.4],
        ["ii-v-i", 0.3],
        ["axis", 0.3],
      ],
      cadences: [
        ["V-I", 0.6],
        ["IV-I", 0.4],
      ],
      sevenths: 0.7,
      voicing: {
        types: [
          ["open", 0.6],
          ["close", 0.4],
        ],
        notes: [3, 4],
      },
    },
    melody: { intervals: intervals(1.2, 1, 0.4, 0.4) },
    bass: { onsets: grid("x.....x.x......."), kickLock: 0.6 },
    expression: { dynamics: [0.35, 0.8] },
    texture: {
      roles: {
        chords: role("rhodes", "epiano:0.6", "acoustic:0.4"),
        lead: role("sing"),
        counter: maybe("altosax", "electric@clean:0.6"),
      },
    },
  }),
  card({
    id: "heartland-rock",
    summary:
      "heartland rock: I-V-vi-IV anthems, driving straight eighths, organ pad and open-chord acoustic, plain-spoken melody",
    tempo: { bpm: [110, 145], typical: 124 },
    rhythm: { onsets: { kick: grid("x.x.x.x.") } },
    pitch: {
      scales: [
        ["major", 0.7],
        ["mixolydian", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["mixolydian-rock", 0.3],
        ["fifties", 0.2],
      ],
      cadences: [
        ["IV-I", 0.5],
        ["V-I", 0.5],
      ],
      voicing: {
        types: [
          ["open", 0.5],
          ["power", 0.5],
        ],
      },
    },
    melody: { intervals: ANTHEM },
    texture: {
      roles: {
        pad: maybe("hammond", "organ:0.5"),
        chords: role("electric@crunch", "acoustic:0.6"),
      },
    },
  }),
  card({
    id: "stoner-rock",
    summary:
      "stoner and desert rock: down-tuned fuzz riffs, dorian and minor-pentatonic, tonic pedal bass, heavy mid-tempo groove",
    tempo: { bpm: [70, 115], typical: 92 },
    rhythm: { onsets: { kick: grid("x.x..xx.") } },
    pitch: {
      scales: [
        ["minor-pentatonic", 0.4],
        ["dorian", 0.3],
        ["blues", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["dorian-vamp", 0.5],
      ],
      cadences: [["bVII-I", 1]],
      voicing: { types: [["power", 1]], range: [36, 58] },
    },
    bass: {
      behaviour: [
        ["pedal", 0.5],
        ["root", 0.5],
      ],
      range: [26, 45],
    },
    texture: { roles: { chords: role("electric@fuzz"), bass: role("ebass") } },
  }),
  card({
    id: "folk-rock",
    summary:
      "folk rock: chiming 12-string jangle on folk strum patterns, I-IV-V and modal mixolydian, harmony vocals",
    tempo: { bpm: [95, 130], typical: 112 },
    rhythm: { onsets: { kick: grid("x.....x."), hat: QUARTERS } },
    pitch: {
      scales: [
        ["major", 0.6],
        ["mixolydian", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.4],
        ["mixolydian-rock", 0.3],
        ["axis", 0.3],
      ],
      cadences: [
        ["IV-I", 0.5],
        ["V-I", 0.5],
      ],
      voicing: {
        types: [["open", 1]],
        strokes: [
          ["folk", 0.6],
          ["jangle", 0.4],
        ],
      },
    },
    texture: {
      roles: {
        chords: role("jangle", "acoustic:0.7"),
        counter: maybe("choir", "electric@clean:0.5"),
      },
    },
  }),
  card({
    id: "pop-rock",
    summary:
      "pop rock: diatonic I-V-vi-IV and I-vi-IV-V, guitar-led verse-pre-chorus-chorus, hook repetition",
    tempo: { bpm: [100, 140], typical: 120 },
    rhythm: { onsets: { kick: grid("x..xx...") } },
    pitch: {
      scales: [
        ["major", 0.8],
        ["mixolydian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["fifties", 0.25],
        ["sad-pop", 0.25],
      ],
      cadences: [
        ["V-I", 0.6],
        ["IV-I", 0.4],
      ],
    },
    melody: { repetition: 0.75, intervals: ANTHEM },
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
      roles: { chords: role("electric@clean", "electric@crunch:0.7") },
    },
  }),
  card({
    id: "roots-rock",
    summary:
      "roots and swamp rock: mixolydian I-IV-V and 12-bar, light shuffle, acoustic and clean electric, plainspoken grooves",
    tempo: { bpm: [90, 130], typical: 108 },
    rhythm: { onsets: { kick: grid("x...x...") } },
    groove: { swingRatio: [1.1, 1.4] },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["major-pentatonic", 0.3],
        ["major-blues", 0.2],
      ],
    },
    harmony: {
      forms: [[TWELVE_BAR, 1]],
      presets: [
        ["mixolydian-rock", 0.6],
        ["fifties", 0.4],
      ],
      sources: { forms: 1, presets: 2 },
      cadences: [
        ["IV-I", 0.5],
        ["V-I", 0.5],
      ],
    },
    texture: { roles: { chords: role("electric@clean", "acoustic:0.7") } },
  }),

  card({
    id: "latin-rock",
    summary:
      "Latin rock: Afro-Cuban percussion (timbale bell, congas) over a rock kit, minor i-IV montuno vamps, sustained-guitar lead, organ comping",
    tempo: { bpm: [95, 135], typical: 116 },
    groove: { subdivision: 4 },
    rhythm: {
      onsets: {
        kick: grid("x..x..x.x..x..x."),
        snare: BACKBEAT16,
        hat: EIGHTHS16,
        bell: grid("x.x.xx.x.x.xx.x."),
        perc: grid("..x..xx...x..xx."),
      },
    },
    pitch: {
      scales: [
        ["dorian", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      forms: [
        [["i", "IV"], 0.6],
        [["i", "bVII", "bVI", "V"], 0.4],
      ],
      presets: [["dorian-vamp", 1]],
      sources: { forms: 2, presets: 1 },
      rhythm: [[1, 1]],
      cadences: [["IV-I", 1]],
    },
    bass: {
      behaviour: [["root-fifth", 1]],
      onsets: grid("x..x..x.x..x..x."),
      kickLock: 0.8,
    },
    melody: { intervals: ANTHEM, density: [1, 3] },
    texture: {
      roles: {
        bell: role("drums"),
        perc: role("drums"),
        chords: role("hammond", "electric@crunch:0.5"),
        lead: role("gtr-lead", "electric@lead:0.5"),
      },
    },
  }),

  // -------------------------------------------------------------------
  // Progressive and art rock: additive odd meters (7/8 as 2+2+3, 5/4),
  // modal interchange, extended tertian chords, keyboard textures, long
  // multi-section forms.
  card({
    id: "prog",
    abstract: true,
    summary:
      "progressive: additive odd meters (7/8 as 2+2+3, 5/4), modal interchange, sevenths, organ and mellotron, long forms",
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
    harmony: {
      sevenths: 0.3,
      chain: {
        I: [
          ["bVII", 1],
          ["IV", 1],
          ["vi", 1],
          ["iv", 0.5],
        ],
        bVII: [
          ["IV", 1],
          ["bVI", 0.5],
        ],
        IV: [
          ["I", 1],
          ["V", 1],
          ["iv", 0.5],
        ],
        iv: [["I", 1]],
        bVI: [["bVII", 1]],
        vi: [
          ["IV", 1],
          ["ii", 0.5],
        ],
        ii: [["V", 1]],
        V: [
          ["I", 1],
          ["vi", 0.5],
        ],
      },
      sources: { presets: 1, chain: 1 },
      voicing: {
        types: [
          ["open", 0.5],
          ["close", 0.3],
          ["power", 0.2],
        ],
      },
    },
    form: {
      plans: [
        [
          [
            "intro",
            "verse",
            "chorus",
            "bridge",
            "breakdown",
            "verse",
            "chorus",
            "outro",
          ],
          1,
        ],
      ],
      archetype: "multi-section",
    },
    texture: {
      roles: {
        chords: role("hammond", "keys:0.6", "electric:0.5"),
        pad: maybe("strings", "organ:0.4"),
      },
    },
  }),
  card({
    id: "prog-rock",
    summary:
      "symphonic prog: mellotron strings and organ, 7/8 and 5/4 sections, modal interchange iv and bVI, extended suites",
    tempo: { bpm: [80, 140], typical: 108 },
    meter: {
      signatures: [
        ["7/8", 0.4],
        ["5/4", 0.3],
        ["4/4", 0.3],
      ],
    },
    pitch: {
      scales: [
        ["minor", 0.4],
        ["dorian", 0.3],
        ["major", 0.3],
      ],
    },
    texture: {
      roles: {
        pad: role("strings", "choir:0.4"),
        lead: role("saw", "gtr-lead:0.7", "sing:0.6"),
      },
    },
  }),
  card({
    id: "art-rock",
    summary:
      "art rock: sevenths and modal interchange, piano-led arrangement, theatrical dynamics, 4/4 and 6/8",
    meter: {
      signatures: [
        ["4/4", 0.7],
        ["6/8", 0.3],
      ],
    },
    rhythm: { onsets: { kick: grid("x..x.xx.") } },
    harmony: { sevenths: 0.5 },
    expression: { dynamics: [0.3, 0.95] },
    texture: { roles: { chords: role("piano", "grand:0.5", "electric:0.4") } },
  }),
  card({
    id: "canterbury",
    summary:
      "Canterbury: jazz-tinged sevenths and ninths, 7/8 and 9/8 meters, fuzz organ and electric piano leads, whimsy",
    tempo: { bpm: [100, 150], typical: 120 },
    meter: {
      signatures: [
        ["7/8", 0.4],
        ["9/8", 0.3],
        ["4/4", 0.3],
      ],
      grouping: [
        [[2, 2, 3], 0.4],
        [[2, 2, 2, 3], 0.3],
        [[3, 2, 2], 0.3],
      ],
    },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["mixolydian", 0.3],
        ["major", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["ii-v-i", 0.5],
        ["dorian-vamp", 0.5],
      ],
      sevenths: 0.8,
      cadences: [["V-I", 1]],
    },
    rhythm: { onsets: { kick: grid("x.....x."), hat: grid("x.xxx.xx") } },
    texture: {
      roles: {
        chords: role("epiano", "hammond:0.6"),
        lead: role("organ", "sax:0.5", "sing:0.4"),
      },
    },
  }),
  card({
    id: "krautrock",
    summary:
      "krautrock: motorik beat (steady kick and eighth hats, no fills), one-chord modal drone, bass ostinato, hypnotic repetition",
    tempo: { bpm: [120, 160], typical: 138 },
    meter: { signatures: [["4/4", 1]], hypermeter: [[8, 1]] },
    rhythm: {
      onsets: {
        kick: grid("x.x.x.xx"),
        snare: BACKBEAT,
        hat: EIGHTHS,
      },
      fills: { every: 16, density: [0, 0.1] },
    },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["mixolydian", 0.5],
      ],
    },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    melody: { repetition: 0.9, density: [1, 2] },
    bass: { behaviour: [["ostinato", 1]], onsets: EIGHTHS, kickLock: 0 },
    form: {
      plans: [[["intro", "verse", "verse", "breakdown", "verse", "outro"], 1]],
      archetype: "strophic",
    },
    texture: {
      roles: {
        chords: role("electric@clean", "organ:0.6"),
        pad: maybe("saw", "strings:0.4"),
        lead: role("saw", "electric@clean:0.5"),
      },
    },
  }),
  card({
    id: "space-rock",
    summary:
      "space rock: droning one-chord modal jams, synth pads and oscillator leads, phased wash, tonic pedal",
    tempo: { bpm: [90, 135], typical: 112 },
    meter: { signatures: [["4/4", 1]], hypermeter: [[8, 1]] },
    pitch: {
      scales: [
        ["dorian", 0.4],
        ["mixolydian", 0.3],
        ["minor", 0.3],
      ],
    },
    harmony: { model: "drone", rhythm: [[0.25, 1]] },
    bass: {
      behaviour: [
        ["pedal", 0.6],
        ["ostinato", 0.4],
      ],
      kickLock: 0,
    },
    texture: {
      roles: {
        chords: role("electric@fuzz"),
        pad: role("strings", "saw:0.6"),
        lead: role("saw", "square:0.6"),
      },
    },
    mix: { fx: { lead: { phaser: "slow" } }, space: 0.6 },
  }),
  card({
    id: "zeuhl",
    summary:
      "zeuhl and RIO: hammering bass ostinato, phrygian and minor pedal points, choral chant, martial 7/8 and 4/4",
    tempo: { bpm: [90, 150], typical: 120 },
    meter: {
      signatures: [
        ["7/8", 0.5],
        ["4/4", 0.5],
      ],
    },
    pitch: {
      scales: [
        ["phrygian", 0.5],
        ["minor", 0.3],
        ["locrian", 0.2],
      ],
    },
    harmony: { model: "modal", rhythm: [[0.5, 1]] },
    bass: { behaviour: [["ostinato", 1]], onsets: EIGHTHS, kickLock: 0 },
    texture: {
      roles: {
        chords: role("piano", "epiano:0.6"),
        lead: role("choir"),
        bass: role("ebass"),
      },
    },
  }),
  card({
    id: "jam-band",
    summary:
      "jam band: long mixolydian and dorian vamps, improvised lead over light swing, open-ended forms",
    tempo: { bpm: [95, 130], typical: 110 },
    meter: { signatures: [["4/4", 1]], hypermeter: [[8, 1]] },
    groove: { swingRatio: [1, 1.3] },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["dorian", 0.5],
      ],
    },
    harmony: { model: "modal", rhythm: [[0.5, 1]] },
    melody: { density: [2, 3], repetition: 0.3 },
    texture: {
      roles: {
        chords: role("electric@clean", "hammond:0.6"),
        lead: role("gtr-lead"),
        counter: maybe("rhodes", "piano:0.5"),
      },
    },
  }),

  // -------------------------------------------------------------------
  // Alternative and indie: jangle or fuzz guitars, the I-V-vi-IV axis and
  // its relative-minor rotation vi-IV-I-V, modal loops, quiet-loud.
  card({
    id: "alt-indie",
    abstract: true,
    summary:
      "alternative and indie: jangle or fuzz, I-V-vi-IV axis and vi-IV-I-V rotation, modal loops, quiet-loud",
    harmony: {
      presets: [
        ["axis", 0.5],
        ["sad-pop", 0.5],
      ],
      cadences: [
        ["IV-I", 0.5],
        ["V-vi", 0.2],
        ["V-I", 0.3],
      ],
    },
    pitch: {
      scales: [
        ["major", 0.5],
        ["minor", 0.3],
        ["mixolydian", 0.2],
      ],
    },
    form: { energy: { verse: 0.5, chorus: 0.95 } },
    texture: { roles: { chords: role("jangle", "electric:0.5") } },
  }),
  card({
    id: "indie-rock",
    summary:
      "indie and college rock: angular clean and crunch guitars, axis loops and modal mixolydian, straight eights",
    tempo: { bpm: [110, 150], typical: 128 },
    rhythm: { onsets: { kick: grid("x..x...x") } },
    texture: { roles: { chords: role("electric@alt", "electric@crunch:0.6") } },
  }),
  card({
    id: "jangle-pop",
    summary:
      "jangle pop: chiming arpeggiated major chords on jangle strum patterns, I-IV-V and fifties changes, bright tempo",
    tempo: { bpm: [120, 155], typical: 136 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["mixolydian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["axis", 0.5],
      ],
      voicing: { types: [["open", 1]], strokes: [["jangle", 1]] },
    },
    texture: {
      roles: { chords: role("jangle"), arp: maybe("electric@jangle") },
    },
  }),
  card({
    id: "shoegaze",
    summary:
      "shoegaze: wall of reverse-reverb guitar wash, sustained open chords, buried vocal, lydian and major colours, tonic drone",
    tempo: { bpm: [80, 130], typical: 104 },
    pitch: {
      scales: [
        ["major", 0.5],
        ["lydian", 0.3],
        ["mixolydian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.4],
        ["sad-pop", 0.3],
        ["mixolydian-rock", 0.3],
      ],
      rhythm: [[0.5, 1]],
      sevenths: 0.4,
      voicing: { types: [["open", 1]], notes: [3, 4] },
    },
    melody: { density: [0.5, 1], intervals: intervals(1.4, 0.8, 0.3, 0.8) },
    texture: {
      roles: {
        chords: role("shoegaze"),
        pad: role("shoegaze", "granular:0.5"),
        lead: role("sing", "ebow:0.5"),
      },
    },
    mix: { levels: { lead: -4, pad: -6 }, space: 0.7 },
  }),
  card({
    id: "dream-pop",
    summary:
      "dream pop: reverb-washed major-seventh chords, slow arpeggios, breathy vocal, drum machine or soft kit",
    tempo: { bpm: [70, 110], typical: 88 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["lydian", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["canon", 0.5],
      ],
      rhythm: [[0.5, 1]],
      sevenths: 0.7,
      voicing: { types: [["open", 1]], notes: [3, 4] },
    },
    rhythm: { onsets: { kick: grid("x...x...") } },
    melody: { density: [0.5, 1.5] },
    expression: { dynamics: [0.3, 0.75] },
    texture: {
      roles: {
        chords: role("dreampop"),
        arp: maybe("dreampop", "celesta:0.4"),
        lead: role("sing", "aah:0.5"),
      },
    },
    mix: { space: 0.65 },
  }),
  card({
    id: "noise-rock",
    summary:
      "noise rock: dissonant locrian and phrygian riffs, ragged distortion, pounding toms, abrasive repetition",
    tempo: { bpm: [100, 160], typical: 126 },
    pitch: {
      scales: [
        ["phrygian", 0.4],
        ["locrian", 0.3],
        ["minor", 0.3],
      ],
    },
    harmony: {
      model: "modal",
      rhythm: [[1, 1]],
      voicing: { types: [["power", 1]] },
    },
    rhythm: { onsets: { tom: grid("x..x..x.") } },
    melody: { intervals: CHROMATIC },
    texture: {
      roles: {
        tom: KIT_TOM_OPT,
        chords: role("ragged", "electric@fuzz:0.6"),
      },
    },
  }),
  card({
    id: "grunge",
    summary:
      "grunge: quiet-loud dynamics, drop-D power chords, aeolian with chromatic i-bIII-bVI-IV moves, sludgy mid-tempo",
    tempo: { bpm: [85, 130], typical: 104 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["minor-pentatonic", 0.3],
        ["dorian", 0.2],
      ],
    },
    harmony: {
      presets: [["aeolian", 0.5]],
      chain: {
        i: [
          ["bIII", 1],
          ["bVI", 1],
          ["IV", 0.5],
        ],
        bIII: [
          ["bVI", 1],
          ["IV", 0.5],
        ],
        bVI: [
          ["bVII", 1],
          ["IV", 0.5],
        ],
        IV: [["i", 1]],
        bVII: [["i", 1]],
      },
      sources: { presets: 1, chain: 1 },
      cadences: [
        ["bVII-I", 0.6],
        ["IV-I", 0.4],
      ],
      voicing: { types: [["power", 1]], range: [38, 60] },
    },
    form: {
      energy: { intro: 0.3, verse: 0.35, pre: 0.6, chorus: 1, bridge: 0.5 },
      archetype: "quiet-loud",
    },
    texture: {
      roles: { chords: role("electric@fuzz", "electric@alt:0.5") },
    },
  }),
  card({
    id: "britpop",
    summary:
      "britpop: mixolydian swagger, I-V-vi-IV and I-bVII-IV, tambourine on the backbeat, terrace sing-along chorus",
    tempo: { bpm: [100, 130], typical: 112 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["mixolydian", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.4],
        ["mixolydian-rock", 0.4],
        ["canon", 0.2],
      ],
    },
    rhythm: { onsets: { shaker: BACKBEAT } },
    melody: { intervals: ANTHEM },
    texture: {
      roles: {
        shaker: SHAKER,
        chords: role("electric@crunch", "jangle:0.5"),
        counter: maybe("strings", "hammond:0.5"),
      },
    },
  }),
  card({
    id: "math-rock",
    summary:
      "math rock: odd and shifting meters (7/8, 5/4, 9/8), tapped clean arpeggios, syncopated stop-start accents",
    tempo: { bpm: [120, 165], typical: 140 },
    meter: {
      signatures: [
        ["7/8", 0.35],
        ["5/4", 0.25],
        ["9/8", 0.2],
        ["4/4", 0.2],
      ],
      grouping: [
        [[2, 2, 3], 0.4],
        [[3, 3, 3], 0.2],
        [[3, 2, 2], 0.4],
      ],
    },
    groove: { subdivision: 4 },
    rhythm: {
      onsets: {
        kick: grid("x..x..x...x..x.."),
        snare: grid("....x.......x..3"),
        hat: EIGHTHS16,
      },
    },
    pitch: {
      scales: [
        ["major", 0.4],
        ["lydian", 0.3],
        ["dorian", 0.3],
      ],
    },
    harmony: { sevenths: 0.5, voicing: { types: [["open", 1]] } },
    bass: { onsets: grid("x..x..x...x..x.."), kickLock: 0.5 },
    texture: {
      roles: {
        chords: role("electric@clean"),
        arp: role("electric@clean"),
        lead: role("electric@clean", "sing:0.4"),
      },
    },
  }),
  card({
    id: "post-rock",
    summary:
      "post-rock: instrumental crescendo form, tremolo-picked arpeggios over pedal bass, reverb-washed guitars, slow build",
    tempo: { bpm: [70, 125], typical: 96 },
    meter: { hypermeter: [[8, 1]] },
    pitch: {
      scales: [
        ["major", 0.4],
        ["minor", 0.4],
        ["lydian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.3],
        ["sad-pop", 0.4],
        ["aeolian", 0.3],
      ],
      rhythm: [[0.5, 1]],
      voicing: { types: [["open", 1]] },
    },
    melody: { density: [0.5, 1] },
    bass: {
      behaviour: [
        ["pedal", 0.5],
        ["root", 0.5],
      ],
    },
    form: {
      plans: [
        [
          [
            "intro",
            "build",
            "build",
            "drop",
            "breakdown",
            "build",
            "drop",
            "outro",
          ],
          1,
        ],
      ],
      energy: { intro: 0.2, build: 0.55, drop: 1, breakdown: 0.25, outro: 0.3 },
      archetype: "crescendo",
    },
    texture: {
      roles: {
        chords: role("electric@clean", "shoegaze:0.5"),
        arp: role("electric@clean", "glock:0.4"),
        lead: role("ebow", "strings:0.5"),
      },
    },
    mix: { fx: { lead: { swell: "slow" } }, space: 0.6 },
  }),
  card({
    id: "slowcore",
    summary:
      "slowcore and sadcore: very slow tempo, sparse kit, clean guitars, minor loops, long sustained notes",
    tempo: { bpm: [50, 80], typical: 64 },
    rhythm: {
      onsets: {
        kick: grid("x......."),
        snare: grid("....x..."),
        hat: QUARTERS,
      },
      fills: { every: 8, density: [0.1, 0.2] },
    },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["major", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["sad-pop", 0.5],
        ["aeolian", 0.5],
      ],
      rhythm: [[0.5, 1]],
    },
    melody: { density: [0.5, 1] },
    bass: { onsets: grid("x...x..."), kickLock: 0.4 },
    expression: { dynamics: [0.25, 0.6] },
    texture: {
      roles: { chords: role("electric@clean"), lead: role("sing") },
    },
    mix: { space: 0.5 },
  }),
  card({
    id: "lo-fi-indie",
    summary:
      "lo-fi indie: home-recorded lofi kit, steel-string strums, plain I-IV-V and axis loops, tape-worn sound",
    tempo: { bpm: [85, 130], typical: 104 },
    harmony: {
      presets: [
        ["axis", 0.4],
        ["fifties", 0.3],
        ["sad-pop", 0.3],
      ],
      voicing: { types: [["close", 1]], strokes: [["folk", 1]] },
    },
    texture: {
      roles: {
        kick: LOFI_KIT,
        snare: LOFI_KIT,
        hat: LOFI_KIT,
        chords: role("steel", "lofi:0.5"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "garage-revival",
    summary:
      "garage and post-punk revival: disco-tinged four-on-the-floor or driving eighths, fuzz and wiry clean guitars, minor loops",
    tempo: { bpm: [115, 160], typical: 130 },
    rhythm: { onsets: { kick: QUARTERS, hat: EIGHTHS } },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["mixolydian", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["mixolydian-rock", 0.5],
      ],
    },
    bass: {
      onsets: EIGHTHS,
      behaviour: [
        ["octave", 0.5],
        ["root", 0.5],
      ],
    },
    texture: { roles: { chords: role("electric@fuzz", "electric@clean:0.7") } },
  }),
  card({
    id: "midwest-emo",
    summary:
      "midwest emo: twinkly open-tuned arpeggios, major-seventh and add9 colours, odd-meter turns, earnest vocal",
    tempo: { bpm: [120, 160], typical: 138 },
    meter: {
      signatures: [
        ["4/4", 0.7],
        ["7/8", 0.15],
        ["6/8", 0.15],
      ],
    },
    pitch: {
      scales: [
        ["major", 0.6],
        ["lydian", 0.4],
      ],
    },
    harmony: { sevenths: 0.6, voicing: { types: [["open", 1]] } },
    texture: {
      roles: {
        chords: role("electric@clean"),
        arp: role("electric@clean"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "emo",
    summary:
      "emo and emo pop: vi-IV-I-V rotation, palm-muted verses into open choruses, quiet-loud, fast backbeat",
    tempo: { bpm: [140, 185], typical: 160 },
    harmony: {
      presets: [
        ["sad-pop", 0.6],
        ["axis", 0.4],
      ],
      voicing: { types: [["power", 1]] },
    },
    form: { energy: { verse: 0.45, chorus: 1 }, archetype: "quiet-loud" },
    texture: { roles: { chords: role("electric@alt", "punk:0.5") } },
  }),
  card({
    id: "indie-songwriter",
    summary:
      "indie songwriter rock: confessional melody over steel-string strums, sad-pop and axis loops, sparse kit",
    tempo: { bpm: [80, 125], typical: 100 },
    rhythm: { onsets: { kick: grid("x...5...") } },
    harmony: {
      presets: [
        ["sad-pop", 0.5],
        ["axis", 0.5],
      ],
      voicing: { types: [["open", 1]], strokes: [["folk", 1]] },
    },
    melody: { repetition: 0.5 },
    texture: {
      roles: {
        chords: role("steel", "electric@clean:0.6"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "j-rock",
    summary:
      "J-rock and visual kei: royal-road IVmaj7-V7-iii7-vi progression, fast melodic lead, tight sixteenth drive",
    tempo: { bpm: [140, 190], typical: 165 },
    groove: { subdivision: 4 },
    rhythm: {
      onsets: {
        kick: grid("x.x...x.x.x....."),
        snare: BACKBEAT16,
        hat: EIGHTHS16,
      },
    },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      forms: [[["IVmaj7", "V7", "iii7", "vi"], 1]],
      presets: [["sad-pop", 1]],
      sources: { forms: 2, presets: 1 },
      cadences: [
        ["V-I", 0.5],
        ["V-vi", 0.5],
      ],
      voicing: {
        types: [
          ["close", 0.6],
          ["power", 0.4],
        ],
      },
    },
    melody: { density: [2, 3], intervals: ANTHEM },
    bass: { onsets: EIGHTHS16, kickLock: 0.4 },
    texture: {
      roles: { chords: role("electric@crunch", "electric@lead:0.5") },
    },
  }),
  card({
    id: "k-rock",
    summary:
      "K-rock: band-sound anthems, sad-pop vi-IV-I-V and canon changes, big unison chorus, straight eighths",
    tempo: { bpm: [130, 175], typical: 150 },
    rhythm: { onsets: { kick: grid("x.x.x.x.") } },
    harmony: {
      presets: [
        ["sad-pop", 0.4],
        ["canon", 0.3],
        ["axis", 0.3],
      ],
    },
    melody: { intervals: ANTHEM, repetition: 0.7 },
    texture: { roles: { chords: role("electric@crunch") } },
  }),
  card({
    id: "anatolian-rock",
    summary:
      "Anatolian rock: makam hijaz and kurd colours on fuzz guitar and saz-like setar, aksak 9/8 as 2+2+2+3, tonic drone",
    tempo: { bpm: [100, 140], typical: 118 },
    meter: {
      signatures: [
        ["9/8", 0.6],
        ["4/4", 0.4],
      ],
      grouping: [[[2, 2, 2, 3], 1]],
    },
    rhythm: { onsets: { kick: grid("x..x.x..") } },
    pitch: {
      scales: [
        ["phrygian-dominant", 0.5],
        ["phrygian", 0.3],
        ["harmonic-minor", 0.2],
      ],
    },
    harmony: { model: "modal", rhythm: [[1, 1]] },
    texture: {
      roles: {
        chords: role("electric@fuzz"),
        counter: role("setar", "oud:0.5"),
        drone: maybe("organ"),
      },
    },
  }),

  // -------------------------------------------------------------------
  // Punk: fast down-strummed eighths, three-chord I-IV-V, power chords,
  // the "skank" alternating kick-snare beat, short songs.
  card({
    id: "punk",
    abstract: true,
    summary:
      "punk: fast down-picked eighths, three-chord I-IV-V, power chords, kick on every beat, short songs",
    tempo: { bpm: [150, 200], typical: 175 },
    rhythm: { onsets: { kick: grid("x.x.x.x."), hat: EIGHTHS } },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["fifties", 0.5],
      ],
      voicing: { types: [["power", 1]], strokes: [["punk", 1]] },
    },
    form: {
      plans: [[["intro", "verse", "chorus", "verse", "chorus", "outro"], 1]],
    },
    texture: { roles: { chords: role("punk") } },
  }),
  card({
    id: "proto-punk",
    summary:
      "proto-punk: raw two-chord drones, fuzz guitar, mid-tempo straight eighths, minimal I-bVII changes",
    tempo: { bpm: [115, 160], typical: 136 },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["minor-pentatonic", 0.5],
      ],
    },
    harmony: {
      forms: [[["I", "bVII"], 1]],
      presets: [["mixolydian-rock", 1]],
      sources: { forms: 2, presets: 1 },
      cadences: [["bVII-I", 1]],
    },
    texture: { roles: { chords: role("electric@fuzz", "ragged:0.5") } },
  }),
  card({
    id: "punk-rock",
    summary:
      "first-wave punk: down-stroked eighth power chords, I-IV-V, kick on every beat, shouted unison chorus",
    tempo: { bpm: [165, 210], typical: 185 },
    rhythm: { onsets: { kick: QUARTERS, hat: EIGHTHS } },
    pitch: {
      scales: [
        ["major", 0.6],
        ["mixolydian", 0.4],
      ],
    },
    harmony: {
      forms: [
        [["I", "IV", "V", "IV"], 0.5],
        [["I", "I", "IV", "V"], 0.3],
        [["I", "bVII", "IV", "I"], 0.2],
      ],
      presets: [["fifties", 1]],
      sources: { forms: 3, presets: 1 },
      cadences: [
        ["V-I", 0.6],
        ["IV-I", 0.4],
      ],
    },
    bass: { behaviour: [["root", 1]], onsets: EIGHTHS, kickLock: 0 },
    melody: { repetition: 0.8, density: [1, 2] },
  }),
  card({
    id: "oi",
    summary:
      "Oi! and street punk: mid-tempo stomp, terrace gang-vocal chorus, I-IV-V power chords, quarter-note kick",
    tempo: { bpm: [125, 160], typical: 140 },
    melody: { intervals: ANTHEM, repetition: 0.8 },
    texture: { roles: { counter: role("choir") } },
  }),
  card({
    id: "hardcore-punk",
    summary:
      "hardcore punk: skank beat (kick on the beat, snare on every off-beat eighth), 180-240 bpm, breakdowns, short songs",
    tempo: { bpm: [180, 240], typical: 205 },
    rhythm: { onsets: { kick: grid("x.x.x.x."), snare: grid(".x.x.x.x") } },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["phrygian", 0.3],
        ["minor-pentatonic", 0.2],
      ],
    },
    harmony: {
      forms: [
        [["i", "bVII", "bVI", "bVII"], 0.5],
        [["i", "bIII", "bVII", "i"], 0.5],
      ],
      presets: [["aeolian", 1]],
      sources: { forms: 2, presets: 1 },
      cadences: [["bVII-I", 1]],
    },
    melody: { intervals: CHROMATIC, density: [1, 2] },
    bass: { kickLock: 0.5 },
    form: {
      plans: [[["intro", "verse", "chorus", "breakdown", "chorus"], 1]],
      energy: { breakdown: 0.8 },
    },
  }),
  card({
    id: "crust",
    summary:
      "crust and d-beat: the d-beat (kick on 1, the and of 2 and 3, snare on 2 and 4), aeolian power chords, ragged tone",
    tempo: { bpm: [150, 200], typical: 172 },
    rhythm: { onsets: { kick: grid("x..xx..."), snare: BACKBEAT } },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["phrygian", 0.4],
      ],
    },
    harmony: { presets: [["aeolian", 1]], cadences: [["bVII-I", 1]] },
    texture: { roles: { chords: role("ragged", "gtr-metal:0.5") } },
  }),
  card({
    id: "anarcho-punk",
    summary:
      "anarcho-punk: tribal floor-tom beats, minor drones, chanted choir vocals, stark mid-fast tempo",
    tempo: { bpm: [140, 180], typical: 158 },
    rhythm: { onsets: { tom: grid("x.xx.x.x"), kick: QUARTERS } },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["dorian", 0.4],
      ],
    },
    harmony: { presets: [["aeolian", 1]], cadences: [["bVII-I", 1]] },
    texture: { roles: { tom: KIT_TOM, counter: maybe("choir") } },
  }),
  card({
    id: "pop-punk",
    summary:
      "pop punk: I-V-vi-IV power chords, palm-muted verse eighths into open choruses, hooky major melody",
    tempo: { bpm: [145, 185], typical: 165 },
    rhythm: { onsets: { kick: grid("x..xx.x.") } },
    pitch: { scales: [["major", 1]] },
    harmony: {
      forms: [],
      presets: [
        ["axis", 0.6],
        ["sad-pop", 0.4],
      ],
      sources: { presets: 1 },
    },
    melody: { repetition: 0.75, intervals: ANTHEM },
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
      energy: { verse: 0.6, chorus: 1 },
    },
  }),
  card({
    id: "skate-punk",
    summary:
      "skate punk: melodic hardcore at 180-230 bpm, skank beat, fast major melodies with harmony leads",
    tempo: { bpm: [180, 230], typical: 200 },
    rhythm: { onsets: { snare: grid(".x.x.x.x") } },
    pitch: { scales: [["major", 1]] },
    harmony: {
      forms: [],
      sources: { presets: 1 },
      presets: [
        ["axis", 0.5],
        ["sad-pop", 0.5],
      ],
    },
    bass: { kickLock: 0.5 },
    melody: { density: [2, 3] },
  }),
  card({
    id: "post-punk",
    summary:
      "post-punk: melodic bass ostinato carries the tune, chorus-washed wiry guitar, dorian and minor vamps, motorik hats",
    tempo: { bpm: [115, 150], typical: 132 },
    groove: { subdivision: 4 },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x......."),
        snare: BACKBEAT16,
        hat: SIXTEENTHS,
      },
    },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["dorian", 0.5],
      ],
    },
    harmony: {
      model: "modal",
      rhythm: [[0.5, 1]],
      voicing: { types: [["close", 1]], strokes: [] },
    },
    bass: {
      behaviour: [["ostinato", 1]],
      range: [33, 55],
      onsets: EIGHTHS16,
      kickLock: 0,
    },
    texture: { roles: { chords: role("electric@clean"), lead: role("sing") } },
    mix: { fx: { chords: { chorus: "wide" } }, levels: { bass: 0 } },
  }),
  card({
    id: "no-wave",
    summary:
      "no wave: atonal locrian clusters, skronking alto sax, ragged guitar, disjunct jagged rhythm",
    tempo: { bpm: [100, 160], typical: 128 },
    pitch: {
      scales: [
        ["locrian", 0.5],
        ["phrygian", 0.5],
      ],
    },
    harmony: {
      model: "modal",
      voicing: { types: [["close", 1]], strokes: [] },
    },
    melody: { intervals: intervals(0.8, 0.8, 1, 0.3) },
    texture: { roles: { chords: role("ragged"), lead: role("altosax") } },
  }),
  card({
    id: "deathrock",
    summary:
      "deathrock: tom-heavy tribal beat, minor and phrygian riffs, flanged chorus guitar, horror-tinged mood",
    tempo: { bpm: [120, 160], typical: 138 },
    rhythm: { onsets: { tom: grid("x..x..x."), kick: grid("x...x...") } },
    pitch: {
      scales: [
        ["phrygian", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: {
      model: "modal",
      voicing: { types: [["power", 1]], strokes: [] },
    },
    texture: { roles: { tom: KIT_TOM, chords: role("electric@clean") } },
    mix: { fx: { chords: { chorus: "seasick" } } },
  }),
  card({
    id: "goth-rock",
    summary:
      "gothic rock: drum-machine pulse, aeolian and phrygian, chorus-drenched guitar, deep melodic bass, baritone vocal",
    tempo: { bpm: [110, 150], typical: 126 },
    rhythm: { onsets: { kick: QUARTERS } },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["phrygian", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.6],
        ["andalusian", 0.4],
      ],
      cadences: [
        ["bVII-I", 0.6],
        ["V-I", 0.4],
      ],
      voicing: { types: [["close", 1]], strokes: [] },
    },
    bass: {
      behaviour: [
        ["ostinato", 0.5],
        ["root", 0.5],
      ],
      kickLock: 0,
    },
    texture: { roles: { ...MACHINE_KIT, chords: role("electric@clean") } },
    mix: { fx: { chords: { chorus: "wide" } }, space: 0.5 },
  }),
  card({
    id: "coldwave",
    summary:
      "coldwave: cheap drum machine, minor synth ostinatos, detached vocal, sparse cold arrangement",
    tempo: { bpm: [105, 140], typical: 122 },
    rhythm: { onsets: { kick: QUARTERS } },
    pitch: {
      scales: [
        ["minor", 0.7],
        ["dorian", 0.3],
      ],
    },
    harmony: {
      presets: [["aeolian", 1]],
      cadences: [["bVII-I", 1]],
      voicing: { types: [["close", 1]], strokes: [] },
    },
    bass: { behaviour: [["ostinato", 1]], kickLock: 0 },
    texture: {
      roles: {
        ...MACHINE_KIT,
        chords: role("saw", "square:0.5"),
        bass: role("saw", "bass:0.5"),
        lead: role("sing", "square:0.5"),
      },
    },
  }),
  card({
    id: "psychobilly",
    summary:
      "psychobilly: slap upright at punk speed, rockabilly root-fifth bass, harmonic-minor horror riffs, light shuffle",
    tempo: { bpm: [170, 230], typical: 195 },
    groove: { swingRatio: [1.2, 1.5] },
    pitch: {
      scales: [
        ["harmonic-minor", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["andalusian", 0.5],
        ["aeolian", 0.5],
      ],
      cadences: [["V-I", 1]],
    },
    bass: { behaviour: [["root-fifth", 1]], kickLock: 0.4 },
    texture: { roles: { bass: role("slap"), chords: role("electric@crunch") } },
  }),
  card({
    id: "post-hardcore",
    summary:
      "post-hardcore: dynamic quiet-loud sections, angular dissonant riffs, displaced accents, sung-to-screamed vocal",
    tempo: { bpm: [130, 180], typical: 150 },
    groove: { subdivision: 4 },
    rhythm: {
      onsets: {
        kick: grid("x..x..x...x.x..."),
        snare: BACKBEAT16,
        hat: EIGHTHS16,
      },
    },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["dorian", 0.3],
        ["phrygian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["sad-pop", 0.5],
      ],
    },
    bass: { onsets: grid("x..x..x...x.x..."), kickLock: 0.6 },
    form: { energy: { verse: 0.45, chorus: 1 }, archetype: "quiet-loud" },
  }),
  card({
    id: "screamo",
    summary:
      "screamo: tremolo-picked minor arpeggios, blast-to-halftime swings, quiet-loud, dissonant open chords",
    tempo: { bpm: [150, 200], typical: 172 },
    groove: { subdivision: 4 },
    rhythm: {
      onsets: { kick: EIGHTHS16, snare: BACKBEAT16, hat: EIGHTHS16 },
    },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["dorian", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["sad-pop", 0.5],
        ["aeolian", 0.5],
      ],
      voicing: { types: [["open", 1]], strokes: [] },
    },
    bass: { onsets: EIGHTHS16, kickLock: 0.6 },
    form: { energy: { verse: 0.5, chorus: 1 }, archetype: "quiet-loud" },
    texture: {
      roles: { chords: role("ragged"), arp: maybe("electric@clean") },
    },
  }),
  card({
    id: "powerviolence",
    summary:
      "powerviolence: blast beats (kick and snare alternating every sixteenth) cut against slow sludge, very fast, very short",
    tempo: { bpm: [200, 280], typical: 240 },
    groove: { subdivision: 4, velocity: [1, 0.85, 0.95, 0.85] },
    rhythm: {
      onsets: {
        kick: grid("x.x.x.x.x.x.x.x."),
        snare: grid(".x.x.x.x.x.x.x.x"),
        hat: EIGHTHS16,
      },
    },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["phrygian", 0.3],
        ["locrian", 0.2],
      ],
    },
    harmony: { presets: [["aeolian", 1]], cadences: [["bVII-I", 1]] },
    melody: { intervals: CHROMATIC },
    bass: { onsets: EIGHTHS16, kickLock: 0.8 },
    form: {
      plans: [[["intro", "verse", "breakdown", "verse"], 1]],
      energy: { breakdown: 0.7 },
    },
    texture: { roles: { chords: role("gtr-metal", "ragged:0.5") } },
  }),
  card({
    id: "folk-punk",
    summary:
      "folk and celtic punk: strummed acoustic and banjo at punk speed, fiddle and whistle reels, mixolydian I-bVII-IV",
    tempo: { bpm: [150, 195], typical: 172 },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["mixolydian-rock", 0.5],
        ["fifties", 0.5],
      ],
      voicing: {
        types: [["close", 1]],
        strokes: [
          ["punk", 0.5],
          ["folk", 0.5],
        ],
      },
    },
    melody: { density: [2, 3] },
    texture: {
      roles: {
        chords: role("acoustic", "banjo:0.6"),
        counter: role("fiddle", "tinwhistle:0.6"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "synthpunk",
    summary:
      "synth punk: buzzing saw and square synths over a drum machine at punk speed, minimal two-chord riffs",
    tempo: { bpm: [150, 195], typical: 170 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["mixolydian", 0.5],
      ],
    },
    harmony: {
      forms: [[["I", "bVII"], 1]],
      presets: [["aeolian", 1]],
      sources: { forms: 1, presets: 1 },
      cadences: [["bVII-I", 1]],
      voicing: { types: [["power", 1]], strokes: [] },
    },
    texture: {
      roles: {
        ...MACHINE_KIT,
        chords: role("saw", "square:0.6"),
        bass: role("square", "saw:0.5"),
        lead: role("sing", "square:0.5"),
      },
    },
  }),

  // -------------------------------------------------------------------
  // Metal: aeolian and phrygian riffing (the bII), palm-muted pedal-point
  // riffs on the tonic, power chords only, sixteenth subdivision, double
  // kick, dark modal cadences bVI-bVII-i.
  card({
    id: "metal",
    abstract: true,
    summary:
      "metal: aeolian and phrygian riffs with the bII, palm-muted tonic pedal point, power chords, double kick, bVI-bVII-i",
    tempo: { bpm: [100, 180], typical: 140 },
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
      cadences: [
        ["bVI-bVII-I", 0.5],
        ["bVII-I", 0.3],
        ["bII-I", 0.2],
      ],
      voicing: { types: [["power", 1]], range: [36, 60] },
    },
    groove: { subdivision: 4, velocity: [1, 0.8, 0.9, 0.8] },
    rhythm: {
      onsets: {
        kick: SIXTEENTHS,
        snare: BACKBEAT16,
        hat: EIGHTHS16,
      },
    },
    melody: { intervals: CHROMATIC },
    bass: {
      behaviour: [
        ["pedal", 0.5],
        ["root", 0.5],
      ],
      range: [24, 45],
      onsets: SIXTEENTHS,
    },
    texture: { roles: { chords: role("gtr-metal") } },
    mix: { loudness: "loud" },
  }),
  card({
    id: "heavy-metal",
    summary:
      "heavy and NWOBHM metal: the gallop (eighth plus two sixteenths), aeolian bVI-bVII-i, twin harmony leads, plexi lead tone",
    tempo: { bpm: [110, 170], typical: 140 },
    rhythm: {
      onsets: { kick: grid("x.xxx.xxx.xxx.xx"), hat: EIGHTHS16 },
    },
    bass: { onsets: grid("x.xxx.xxx.xxx.xx") },
    pitch: {
      scales: [
        ["minor", 0.7],
        ["harmonic-minor", 0.3],
      ],
    },
    melody: { intervals: ANTHEM },
    texture: {
      roles: {
        chords: role("electric@lead", "gtr-metal:0.5"),
        counter: role("gtr-lead"),
      },
    },
  }),
  card({
    id: "speed-metal",
    summary:
      "speed metal: driving sixteenth palm-mutes at 160-220 bpm, gallops, harmonic-minor runs, high vocal",
    tempo: { bpm: [160, 220], typical: 185 },
    rhythm: { onsets: { kick: EIGHTHS16 } },
    pitch: {
      scales: [
        ["minor", 0.7],
        ["phrygian", 0.3],
      ],
    },
    melody: { intervals: SHRED, density: [2, 4] },
  }),
  card({
    id: "thrash",
    summary:
      "thrash: skank beat at 180-240 bpm, chromatic phrygian riffs on the low tonic pedal, tritone accents",
    tempo: { bpm: [170, 240], typical: 200 },
    rhythm: { onsets: { kick: QUARTERS16, snare: grid("..x...x...x...x.") } },
    pitch: {
      scales: [
        ["phrygian", 0.6],
        ["locrian", 0.2],
        ["minor", 0.2],
      ],
    },
    bass: { onsets: SIXTEENTHS, kickLock: 0.5 },
  }),
  card({
    id: "power-metal",
    summary:
      "power metal: double-kick sixteenths, major and harmonic-minor anthems, i-bVI-bVII and I-V-vi-IV, choir and keys",
    tempo: { bpm: [140, 200], typical: 170 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.4],
        ["aeolian", 0.4],
        ["canon", 0.2],
      ],
      cadences: [
        ["V-I", 0.5],
        ["bVI-bVII-I", 0.5],
      ],
    },
    melody: { intervals: ANTHEM, repetition: 0.7 },
    texture: {
      roles: {
        pad: role("choir", "strings:0.6"),
        lead: role("sing", "gtr-lead:0.5"),
        counter: maybe("saw"),
      },
    },
  }),
  card({
    id: "glam-metal",
    summary:
      "glam metal: mid-tempo rock backbeat, mixolydian I-bVII-IV and axis anthems, gang-vocal choruses, shred solo",
    tempo: { bpm: [100, 145], typical: 120 },
    groove: { subdivision: 2, velocity: [1, 0.75] },
    rhythm: {
      onsets: { kick: grid("x...x.x."), snare: BACKBEAT, hat: EIGHTHS },
    },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["major", 0.3],
        ["minor-pentatonic", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["mixolydian-rock", 0.5],
        ["axis", 0.5],
      ],
      cadences: [
        ["bVII-I", 0.5],
        ["IV-I", 0.5],
      ],
    },
    melody: { intervals: ANTHEM },
    bass: { behaviour: [["root", 1]], onsets: EIGHTHS, kickLock: 0.5 },
    texture: {
      roles: { chords: role("electric@lead"), counter: maybe("choir") },
    },
  }),
  card({
    id: "doom-metal",
    summary:
      "doom metal: very slow half-time, aeolian and phrygian riffs on the tonic and bII, sustained power chords, tritone colour",
    tempo: { bpm: [50, 80], typical: 64 },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("........x......."),
        hat: QUARTERS16,
      },
      fills: { every: 4, density: [0.2, 0.4] },
    },
    harmony: { rhythm: [[0.5, 1]] },
    melody: { density: [0.5, 1] },
    bass: { onsets: grid("x.......x......."), kickLock: 0.6 },
    texture: { roles: { chords: role("electric@fuzz", "gtr-metal:0.5") } },
  }),
  card({
    id: "funeral-doom",
    summary:
      "funeral doom: glacial 30-50 bpm, sustained minor chords one per two bars, organ pad, sparse kit, dirge",
    tempo: { bpm: [30, 50], typical: 40 },
    rhythm: {
      onsets: {
        kick: grid("x..............."),
        snare: grid("........x......."),
        hat: QUARTERS16,
      },
      fills: { every: 8, density: [0.1, 0.2] },
    },
    harmony: { rhythm: [[0.5, 1]] },
    melody: { density: [0.25, 0.5] },
    bass: { onsets: grid("x..............."), kickLock: 0.6 },
    texture: { roles: { pad: role("organ", "churchorgan:0.5") } },
    mix: { space: 0.6 },
  }),
  card({
    id: "sludge",
    summary:
      "sludge: slow down-tuned fuzz, blues-scale riffs, feedback-heavy, hardcore half-time breakdowns",
    tempo: { bpm: [60, 100], typical: 76 },
    rhythm: { onsets: { kick: grid("x.....x.x......."), hat: QUARTERS16 } },
    pitch: {
      scales: [
        ["blues", 0.4],
        ["minor", 0.4],
        ["phrygian", 0.2],
      ],
    },
    bass: { onsets: grid("x.....x.x......."), kickLock: 0.6 },
    texture: { roles: { chords: role("electric@fuzz") } },
  }),
  card({
    id: "stoner-metal",
    summary:
      "stoner metal: fuzz riffs in minor pentatonic and dorian, groove-laden mid-tempo, tonic pedal, swung sixteenths",
    tempo: { bpm: [70, 115], typical: 90 },
    groove: { swingRatio: [1, 1.3] },
    rhythm: { onsets: { kick: grid("x.....x...x....."), hat: EIGHTHS16 } },
    pitch: {
      scales: [
        ["minor-pentatonic", 0.5],
        ["dorian", 0.3],
        ["blues", 0.2],
      ],
    },
    bass: { onsets: grid("x.....x...x....."), kickLock: 0.6 },
    texture: { roles: { chords: role("electric@fuzz") } },
  }),
  card({
    id: "death-metal",
    summary:
      "death metal: chromatic phrygian and locrian riffs, blast beats and double kick, tritone and bII, guttural low register",
    tempo: { bpm: [160, 240], typical: 190 },
    rhythm: {
      onsets: {
        kick: SIXTEENTHS,
        snare: grid("..x...x...x...x."),
        hat: EIGHTHS16,
      },
    },
    pitch: {
      scales: [
        ["phrygian", 0.5],
        ["locrian", 0.3],
        ["harmonic-minor", 0.2],
      ],
    },
    harmony: { voicing: { range: [33, 55] } },
    melody: { range: [45, 67] },
  }),
  card({
    id: "brutal-death",
    summary:
      "brutal and technical death metal: constant blasts, slam half-time grooves, chromatic low riffs, very low tuning",
    tempo: { bpm: [180, 260], typical: 210 },
    rhythm: {
      onsets: {
        kick: SIXTEENTHS,
        snare: grid(".x.x.x.x.x.x.x.x"),
        hat: EIGHTHS16,
      },
    },
    pitch: {
      scales: [
        ["phrygian", 0.4],
        ["locrian", 0.4],
        ["harmonic-minor", 0.2],
      ],
    },
    harmony: { voicing: { range: [30, 52] } },
    melody: { range: [40, 62], intervals: CHROMATIC },
    bass: { range: [22, 40] },
  }),
  card({
    id: "melodic-death",
    summary:
      "melodic death metal: Gothenburg harmonised twin leads in thirds, aeolian and harmonic-minor, double kick gallops",
    tempo: { bpm: [140, 200], typical: 165 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["harmonic-minor", 0.5],
      ],
    },
    melody: { intervals: ANTHEM, repetition: 0.7 },
    texture: { roles: { counter: role("gtr-lead") } },
  }),
  card({
    id: "black-metal",
    summary:
      "black metal: tremolo-picked minor chords, blast beats, aeolian and phrygian drones, cold reverb, long chord holds",
    tempo: { bpm: [160, 230], typical: 190 },
    rhythm: {
      onsets: {
        kick: SIXTEENTHS,
        snare: grid(".x.x.x.x.x.x.x.x"),
        hat: EIGHTHS16,
      },
    },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["phrygian", 0.3],
        ["harmonic-minor", 0.2],
      ],
    },
    harmony: {
      rhythm: [[0.5, 1]],
      voicing: {
        types: [
          ["power", 0.6],
          ["close", 0.4],
        ],
      },
    },
    melody: { density: [3, 4], intervals: SHRED },
    texture: { roles: { pad: maybe("strings", "organ:0.5") } },
    mix: { space: 0.5 },
  }),
  card({
    id: "blackgaze",
    summary:
      "blackgaze: blast beats under major-key shoegaze wash, tremolo-picked open chords, lydian and major lift",
    tempo: { bpm: [150, 210], typical: 175 },
    rhythm: {
      onsets: {
        kick: SIXTEENTHS,
        snare: grid(".x.x.x.x.x.x.x.x"),
        hat: EIGHTHS16,
      },
    },
    pitch: {
      scales: [
        ["major", 0.5],
        ["lydian", 0.3],
        ["minor", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["sad-pop", 0.5],
      ],
      cadences: [
        ["IV-I", 0.5],
        ["V-I", 0.5],
      ],
      rhythm: [[0.5, 1]],
      voicing: { types: [["open", 1]] },
    },
    texture: {
      roles: {
        chords: role("shoegaze", "gtr-metal:0.5"),
        pad: maybe("shoegaze"),
      },
    },
    mix: { space: 0.6 },
  }),
  card({
    id: "viking-metal",
    summary:
      "viking and folk metal: dorian and aeolian folk modes, 6/8 and 4/4 marches, choir chant, fiddle and whistle melody",
    tempo: { bpm: [100, 160], typical: 128 },
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["6/8", 0.4],
      ],
    },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["dorian-vamp", 0.5],
      ],
    },
    melody: { intervals: ANTHEM },
    texture: {
      roles: {
        counter: role("fiddle", "tinwhistle:0.6", "choir:0.6"),
        pad: maybe("choir"),
      },
    },
  }),
  card({
    id: "grindcore",
    summary:
      "grindcore: relentless blast beats at 200-300 bpm, chromatic noise riffs, songs under a minute, crust breakdowns",
    tempo: { bpm: [200, 300], typical: 250 },
    rhythm: {
      onsets: {
        kick: grid("x.x.x.x.x.x.x.x."),
        snare: grid(".x.x.x.x.x.x.x.x"),
        hat: EIGHTHS16,
      },
    },
    pitch: {
      scales: [
        ["locrian", 0.4],
        ["phrygian", 0.4],
        ["minor", 0.2],
      ],
    },
    bass: { onsets: EIGHTHS16, kickLock: 0.8 },
    form: { plans: [[["intro", "verse", "breakdown", "verse"], 1]] },
    texture: { roles: { chords: role("gtr-metal", "ragged:0.5") } },
  }),
  card({
    id: "groove-metal",
    summary:
      "groove metal: syncopated mid-tempo palm-mute riffs locked to the kick, half-time feel, blues-scale bends",
    tempo: { bpm: [90, 140], typical: 112 },
    rhythm: {
      onsets: {
        kick: grid("x..x..x...x.x..."),
        snare: grid("........x......."),
        hat: EIGHTHS16,
      },
    },
    pitch: {
      scales: [
        ["minor", 0.4],
        ["blues", 0.3],
        ["phrygian", 0.3],
      ],
    },
    bass: { onsets: grid("x..x..x...x.x..."), kickLock: 0.9 },
  }),
  card({
    id: "nu-metal",
    summary:
      "nu metal and alt metal: drop-tuned syncopated chugs, hip-hop swung sixteenths, minor two-chord riffs, turntable-era loops",
    tempo: { bpm: [85, 115], typical: 100 },
    groove: { swingRatio: [1, 1.25] },
    rhythm: {
      onsets: {
        kick: grid("x..x..x...x....."),
        snare: BACKBEAT16,
        hat: EIGHTHS16,
      },
    },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["phrygian", 0.5],
      ],
    },
    harmony: {
      forms: [
        [["i", "bII"], 0.5],
        [["i", "bVI"], 0.5],
      ],
      sources: { forms: 1, presets: 1 },
    },
    bass: { onsets: grid("x..x..x...x....."), kickLock: 0.9 },
    melody: { intervals: RIFF },
  }),
  card({
    id: "industrial-metal",
    summary:
      "industrial metal: drum-machine quantised four-on-the-floor, chugging riffs, synth stabs, machine-tight grid",
    tempo: { bpm: [100, 140], typical: 120 },
    groove: { humanize: { timingMs: 0, velocity: 0.02 } },
    rhythm: { onsets: { kick: QUARTERS16, snare: BACKBEAT16, hat: EIGHTHS16 } },
    bass: { onsets: EIGHTHS16, kickLock: 0.5 },
    texture: { roles: { ...MACHINE_KIT, counter: maybe("saw", "square:0.5") } },
  }),
  card({
    id: "gothic-metal",
    summary:
      "gothic and symphonic metal: orchestral strings and choir over aeolian and harmonic-minor riffs, andalusian cadence",
    tempo: { bpm: [90, 150], typical: 118 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["harmonic-minor", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["andalusian", 0.5],
        ["aeolian", 0.5],
      ],
    },
    melody: { intervals: ANTHEM },
    texture: {
      roles: {
        pad: role("strings", "choir:0.7"),
        lead: role("sing", "choir:0.4"),
      },
    },
    mix: { space: 0.45 },
  }),
  card({
    id: "neo-classical-metal",
    summary:
      "neoclassical metal: harmonic-minor shred arpeggios, V-i and diminished leading-tone motion, baroque sequences",
    tempo: { bpm: [110, 150], typical: 130 },
    rhythm: { onsets: { kick: grid("x.x...x.x.x...x.") } },
    pitch: {
      scales: [
        ["harmonic-minor", 0.7],
        ["phrygian-dominant", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["andalusian", 0.5],
        ["minor-ii-v", 0.5],
      ],
      cadences: [["V-I", 1]],
    },
    melody: { density: [3, 4], intervals: SHRED },
    texture: { roles: { counter: role("harpsichord", "strings:0.6") } },
  }),
  card({
    id: "prog-metal",
    summary:
      "progressive metal and djent: odd groupings over 4/4 (polymetric 3+3+3+3+4 chugs), 7/8 and 5/4, extended-range low tonic pedal",
    tempo: { bpm: [100, 160], typical: 128 },
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["7/8", 0.25],
        ["5/4", 0.25],
      ],
      grouping: [
        [[2, 2, 3], 0.5],
        [[3, 2, 2], 0.5],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x..x..x..x..x..."),
        snare: BACKBEAT16,
        hat: EIGHTHS16,
      },
    },
    bass: { onsets: grid("x..x..x..x..x..."), kickLock: 0.9 },
    harmony: { sevenths: 0.2 },
    texture: { roles: { pad: maybe("strings", "saw:0.5") } },
  }),
  card({
    id: "metalcore",
    summary:
      "metalcore: melodic-death riffs plus hardcore breakdowns in half time, sung chorus on axis loops, double kick",
    tempo: { bpm: [130, 190], typical: 155 },
    rhythm: { onsets: { kick: grid("xxxx..x.xxxx..x.") } },
    bass: { onsets: grid("x..x..x.x..x..x.") },
    pitch: {
      scales: [
        ["minor", 0.8],
        ["phrygian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["sad-pop", 0.5],
      ],
    },
    form: {
      plans: [
        [
          [
            "intro",
            "verse",
            "chorus",
            "verse",
            "chorus",
            "breakdown",
            "chorus",
          ],
          1,
        ],
      ],
      energy: { breakdown: 0.85 },
    },
    melody: { intervals: ANTHEM },
  }),
  card({
    id: "deathcore",
    summary:
      "deathcore: death-metal blasts and half-time breakdowns on a very low tonic pedal, chromatic phrygian chugs",
    tempo: { bpm: [120, 200], typical: 150 },
    rhythm: {
      onsets: {
        kick: grid("x..x..x.x..x..x."),
        snare: grid("........x......."),
        hat: QUARTERS16,
      },
    },
    pitch: {
      scales: [
        ["phrygian", 0.6],
        ["locrian", 0.2],
        ["harmonic-minor", 0.2],
      ],
    },
    harmony: { voicing: { range: [30, 52] } },
    bass: { onsets: grid("x..x..x.x..x..x."), kickLock: 0.9, range: [22, 40] },
    melody: { range: [45, 67] },
    form: {
      plans: [
        [["intro", "verse", "breakdown", "verse", "breakdown", "outro"], 1],
      ],
      energy: { breakdown: 0.9 },
    },
  }),
  card({
    id: "mathcore",
    summary:
      "mathcore: jagged odd meters (7/8, 5/8, 9/8), stop-start dissonant chromatic riffs, abrupt tempo-feel shifts",
    tempo: { bpm: [130, 200], typical: 160 },
    meter: {
      signatures: [
        ["7/8", 0.35],
        ["5/8", 0.25],
        ["9/8", 0.2],
        ["4/4", 0.2],
      ],
      grouping: [
        [[2, 2, 3], 0.4],
        [[3, 2], 0.2],
        [[2, 3, 2, 2], 0.4],
      ],
    },
    pitch: {
      scales: [
        ["locrian", 0.4],
        ["phrygian", 0.4],
        ["minor", 0.2],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x..x.x..x.x..x.."),
        snare: grid("...x....x..x...x"),
        hat: EIGHTHS16,
      },
    },
    bass: { onsets: grid("x..x.x..x.x..x.."), kickLock: 0.9 },
    melody: { intervals: intervals(0.9, 0.7, 0.9, 0.3) },
  }),
  card({
    id: "post-metal",
    summary:
      "post-metal: slow crescendo forms, sludge riffs alternating with clean ambient passages, layered drones",
    tempo: { bpm: [60, 110], typical: 84 },
    meter: { hypermeter: [[8, 1]] },
    rhythm: {
      onsets: {
        kick: grid("x.......x.x....."),
        snare: grid("........x......."),
        hat: EIGHTHS16,
      },
    },
    harmony: { rhythm: [[0.5, 1]] },
    melody: { density: [0.5, 1] },
    bass: { onsets: grid("x.......x.x....."), kickLock: 0.6 },
    form: {
      plans: [
        [["intro", "build", "drop", "breakdown", "build", "drop", "outro"], 1],
      ],
      energy: { intro: 0.2, build: 0.55, drop: 1, breakdown: 0.25 },
      archetype: "crescendo",
    },
    texture: { roles: { pad: role("shoegaze", "strings:0.5") } },
    mix: { space: 0.55 },
  }),
  card({
    id: "drone-metal",
    summary:
      "drone metal: one sustained power chord over tonic drone, beatless or near-beatless, extreme length and volume",
    tempo: { bpm: [30, 60], typical: 42 },
    rhythm: {
      onsets: {
        kick: grid("x..............."),
        snare: grid("................"),
        hat: grid("................"),
      },
      fills: { every: 16, density: [0, 0.05] },
    },
    harmony: { model: "drone", rhythm: [[0.25, 1]] },
    melody: { density: [0.25, 0.5] },
    bass: {
      behaviour: [["pedal", 1]],
      onsets: grid("x..............."),
      kickLock: 0,
    },
    texture: {
      roles: {
        snare: null,
        hat: null,
        drone: role("organ", "electric@fuzz:0.6"),
        chords: role("electric@fuzz"),
        lead: maybe("ebow", "electric@fuzz:0.5"),
      },
    },
    mix: { space: 0.6 },
  }),
  card({
    id: "nintendocore",
    summary:
      "nintendocore: square and triangle chiptune leads over metalcore riffs, major and minor arpeggio runs, blast and breakdown",
    tempo: { bpm: [150, 210], typical: 175 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.4],
        ["aeolian", 0.4],
        ["sad-pop", 0.2],
      ],
    },
    melody: { density: [2, 4], intervals: SHRED },
    texture: {
      roles: {
        lead: role("square", "triangle:0.5"),
        arp: maybe("square"),
      },
    },
  }),
]);
