/**
 * Jazz, blues, soul, gospel, country and North American folk (quality-08
 * family `roots`). `bebop` is the worked Western leaf: swung eighths at a
 * measured 1.6–2.2 ratio, ride and hi-hat on 2 and 4, a walking bass that
 * lands a chord tone on every downbeat with chromatic approaches, ii–V
 * chains with sevenths throughout and a chromatic eighth-note line.
 */

import { grid, intervals, kit, maybe, role } from "./parts.ts";
import { card, type StyleCard } from "./schema.ts";

const SWING_RIDE = grid("x...x.x.x...x.x.");
const BLUES_FORM = [
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

export const ROOTS_CARDS: readonly StyleCard[] = Object.freeze([
  card({
    id: "jazz",
    abstract: true,
    summary:
      "swung eighths, sevenths on every chord, ii-V motion, walking bass",
    tempo: { bpm: [80, 260], typical: 160 },
    groove: {
      subdivision: 2,
      swingRatio: [1.5, 2.2],
      velocity: [0.8, 1],
      humanize: { timingMs: 8, velocity: 0.08 },
    },
    rhythm: {
      onsets: {
        kick: grid("x......."),
        snare: grid("..1...1."),
        hat: grid("..x...x."),
      },
      fills: { every: 8, density: [0.2, 0.4] },
    },
    harmony: {
      presets: [
        ["ii-v-i", 0.5],
        ["turnaround", 0.3],
        ["minor-ii-v", 0.2],
      ],
      chain: {
        I: [
          ["vi", 1.5],
          ["ii", 2],
          ["V7/ii", 1],
          ["IV", 1],
        ],
        Imaj7: [
          ["vi7", 1.5],
          ["ii7", 2],
          ["V7/ii", 1],
        ],
        vi7: [
          ["ii7", 3],
          ["V7/ii", 1],
        ],
        vi: [["ii7", 3]],
        "V7/ii": [["ii7", 3]],
        ii: [["V7", 3]],
        ii7: [
          ["V7", 3],
          ["bII7", 0.6],
        ],
        bII7: [["Imaj7", 3]],
        IV: [
          ["iv", 1],
          ["V7", 1],
          ["iii7", 1],
        ],
        iii7: [
          ["vi7", 2],
          ["V7/ii", 1],
        ],
        V7: [
          ["Imaj7", 3],
          ["vi7", 0.5],
        ],
      },
      sources: { presets: 1, chain: 2 },
      cadences: [
        ["ii-V-I", 0.7],
        ["V-I", 0.3],
      ],
      rhythm: [
        [1, 0.6],
        [2, 0.4],
      ],
      sevenths: 0.95,
      voicing: {
        types: [
          ["shell", 0.4],
          ["open", 0.4],
          ["quartal", 0.2],
        ],
        range: [50, 74],
        notes: [3, 4],
      },
    },
    melody: {
      contour: [
        ["wave", 0.5],
        ["descending", 0.3],
        ["arch", 0.2],
      ],
      ambitus: [9, 17],
      intervals: intervals(5, 2.5, 0.8, 0.3),
      chordToneRate: 0.6,
      density: [2, 4],
      repetition: 0.25,
    },
    bass: {
      behaviour: [["walking", 1]],
      range: [28, 50],
      onsets: grid("x.x.x.x."),
      walk: { chordToneOnOne: 0.95, chromaticApproach: 0.35 },
    },
    form: {
      plans: [[["intro", "verse", "chorus", "chorus", "verse"], 1]],
      archetype: "head-solos-head",
    },
    texture: {
      roles: {
        kick: role("drums"),
        snare: role("drums"),
        hat: role("drums"),
        bass: role("contrabass"),
        chords: role("piano", "rhodes:0.4", "hammond:0.2"),
        lead: role("sax", "trumpet:0.6", "vibes:0.3", "piano:0.3"),
      },
    },
    expression: {
      dynamics: [0.4, 0.9],
      articulation: {
        lead: [
          ["legato", 0.6],
          ["accent", 0.2],
          ["ghost", 0.2],
        ],
      },
    },
    mix: {
      levels: { kick: -8, snare: -8, hat: -6, bass: -2, chords: -6, lead: 0 },
      space: 0.35,
    },
  }),
  card({
    id: "early-jazz",
    abstract: true,
    summary:
      "two-beat feel, collective polyphony, tuba or slap bass, ragtime harmony",
    tempo: { bpm: [100, 220], typical: 170 },
    bass: {
      behaviour: [
        ["root-fifth", 0.7],
        ["walking", 0.3],
      ],
      onsets: grid("x...x..."),
    },
    texture: {
      kind: "polyphonic",
      roles: {
        bass: role("tuba", "contrabass:0.6"),
        lead: role("trumpet", "clarinet:0.6"),
        counter: role("clarinet", "trombone:0.6"),
        chords: role("piano", "banjo:0.6"),
      },
    },
  }),
  card({
    id: "swing-era",
    abstract: true,
    summary:
      "big-band four-on-the-floor swing, riff sections, brass and reed shout",
    groove: { swingRatio: [1.6, 2.2] },
    rhythm: { onsets: { kick: grid("x.x.x.x.") } },
    texture: {
      roles: {
        chords: role("horn", "piano:0.5"),
        counter: maybe("trombone", "sax:0.6"),
      },
    },
  }),
  card({
    id: "modern-jazz",
    abstract: true,
    summary: "small combo, ride cymbal time, extended chords, improvised lines",
  }),
  card({
    id: "bebop",
    summary: "fast swung eighths, ii-V chains, chromatic lines, walking bass",
    seedSalt: 1942,
    tempo: { bpm: [160, 300], typical: 220 },
    groove: {
      swingRatio: [1.6, 2.0],
      microtiming: [0, 0.02],
      roleOffset: { bass: -0.01 },
    },
    rhythm: {
      onsets: {
        hat: grid("..x...x."),
        kick: grid("1...1..."),
        snare: grid("...1..2."),
      },
      locks: [{ kind: "avoid", a: "kick", b: "snare" }],
    },
    harmony: {
      presets: [
        ["ii-v-i", 0.6],
        ["turnaround", 0.4],
      ],
      sources: { presets: 1, chain: 3 },
      rhythm: [
        [2, 0.7],
        [1, 0.3],
      ],
      sevenths: 1,
      voicing: {
        types: [
          ["shell", 0.6],
          ["open", 0.4],
        ],
      },
    },
    melody: {
      density: [3, 4],
      ambitus: [12, 19],
      intervals: intervals(6, 2.5, 0.6, 0.1),
      chordToneRate: 0.55,
      contour: [
        ["descending", 0.5],
        ["wave", 0.5],
      ],
      phraseBars: [
        [2, 0.5],
        [4, 0.5],
      ],
    },
    bass: { walk: { chordToneOnOne: 1, chromaticApproach: 0.45 } },
    texture: {
      roles: {
        lead: role("sax", "trumpet:0.7", "alto:0.5"),
        chords: role("piano"),
      },
    },
  }),
  card({
    id: "avant-jazz",
    abstract: true,
    summary: "free time and harmony: clusters, pedal points, wide intervals",
    harmony: { model: "modal" },
    melody: { intervals: intervals(2, 2, 2, 0.3), chordToneRate: 0.3 },
    bass: {
      behaviour: [
        ["pedal", 0.4],
        ["walking", 0.6],
      ],
    },
  }),
  card({
    id: "jazz-fusion-family",
    abstract: true,
    summary:
      "straight sixteenths, modal vamps, electric keys and bass, odd meters",
    groove: { subdivision: 4, swingRatio: [1, 1.1] },
    meter: {
      signatures: [
        ["4/4", 0.7],
        ["7/8", 0.15],
        ["5/4", 0.15],
      ],
    },
    harmony: { model: "modal" },
    rhythm: {
      onsets: {
        kick: grid("x.....x...x....."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: {
      behaviour: [
        ["ostinato", 0.6],
        ["arpeggio", 0.4],
      ],
      onsets: grid("x..x..x...x.x..."),
    },
    texture: {
      roles: { bass: role("ebass"), chords: role("rhodes", "hammond:0.4") },
    },
  }),
  card({
    id: "blues",
    abstract: true,
    summary:
      "12-bar I7-IV7-V7 form, shuffle triplets, blue thirds and sevenths",
    tempo: { bpm: [60, 150], typical: 96 },
    meter: {
      signatures: [
        ["4/4", 0.7],
        ["12/8", 0.3],
      ],
      hypermeter: [[12, 1]],
    },
    groove: { subdivision: 2, swingRatio: [1.8, 2.1] },
    rhythm: {
      onsets: {
        kick: grid("x...x..."),
        snare: grid("..x...x."),
        hat: grid("x.x.x.x."),
      },
    },
    pitch: {
      scales: [
        ["blues", 0.6],
        ["mixolydian", 0.4],
      ],
    },
    harmony: {
      forms: [[BLUES_FORM, 1]],
      sources: { forms: 3, presets: 0.2 },
      sevenths: 1,
      rhythm: [[1, 1]],
    },
    melody: {
      chordToneRate: 0.5,
      intervals: intervals(4, 3, 0.8, 0.8),
      repetition: 0.6,
    },
    bass: {
      behaviour: [
        ["walking", 0.5],
        ["root-fifth", 0.5],
      ],
      onsets: grid("x.x.x.x."),
    },
    texture: {
      roles: {
        chords: role("electric", "piano:0.6"),
        lead: role("electric", "sax:0.4"),
      },
    },
  }),
  card({
    id: "acoustic-blues",
    abstract: true,
    summary: "solo guitar or piano, irregular bar lengths, bent thirds, no kit",
    texture: {
      roles: {
        kick: null,
        snare: null,
        hat: null,
        chords: role("steel", "piano:0.4"),
        lead: role("steel", "whistle:0.2"),
      },
    },
  }),
  card({
    id: "urban-blues",
    abstract: true,
    summary:
      "electric band blues: shuffle kit, amplified guitar lead, horn riffs",
    texture: { roles: { lead: role("electric"), bass: role("ebass") } },
  }),
  card({
    id: "rnb-soul",
    abstract: true,
    summary: "backbeat on 2 and 4, gospel-derived chords, call and response",
    tempo: { bpm: [70, 120], typical: 96 },
    pitch: {
      scales: [
        ["major", 0.4],
        ["dorian", 0.3],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["turnaround", 0.4],
        ["dorian-vamp", 0.3],
        ["ii-v-i", 0.3],
      ],
      sevenths: 0.7,
    },
    bass: {
      behaviour: [
        ["arpeggio", 0.5],
        ["root-fifth", 0.5],
      ],
      onsets: grid("x.....x...x.x..."),
    },
    texture: {
      roles: {
        chords: role("epiano", "hammond:0.5", "piano:0.4"),
        bass: role("ebass", "motown:0.6"),
        lead: role("sing", "sax:0.4"),
      },
    },
  }),
  card({
    id: "rhythm-and-blues",
    abstract: true,
    summary: "jump and shuffle R&B: triplet swing, honking sax, boogie bass",
    groove: { subdivision: 2, swingRatio: [1.7, 2.1] },
    bass: { behaviour: [["arpeggio", 1]] },
  }),
  card({
    id: "soul",
    abstract: true,
    summary: "straight eighths backbeat, horn section, I-IV and ii-V vamps",
  }),
  card({
    id: "modern-rnb",
    abstract: true,
    summary:
      "programmed drums, extended chords, sparse sub bass, melismatic lead",
    rhythm: {
      onsets: { kick: grid("x......x..x....."), hat: grid("x.x.x.x.x.x.x.x.") },
    },
    texture: {
      roles: { kick: role("drums"), bass: role("bass", "ebass:0.4") },
    },
  }),
  card({
    id: "funk",
    abstract: true,
    summary: "the one: downbeat-heavy sixteenth grooves, dominant-ninth vamps",
    groove: { subdivision: 4, swingRatio: [1, 1.15] },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["mixolydian", 0.5],
      ],
    },
    harmony: { model: "modal", sevenths: 0.9 },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x.....x."),
        snare: grid("....x..1.1..x..."),
        hat: grid("xxxxxxxxxxxxxxxx"),
      },
    },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x..x..x.x.1..x.1") },
    texture: { roles: { chords: role("funk", "clav:0.6") } },
  }),
  card({
    id: "gospel-sacred",
    abstract: true,
    summary: "church harmony: plagal IV-I, passing diminished chords, choir",
    harmony: {
      cadences: [
        ["IV-I", 0.5],
        ["V-I", 0.5],
      ],
      sevenths: 0.6,
    },
    groove: { subdivision: 2, swingRatio: [1, 1.8] },
    texture: {
      roles: {
        chords: role("hammond", "piano:0.7"),
        lead: role("choir", "sing:0.6"),
      },
    },
  }),
  card({
    id: "country",
    abstract: true,
    summary:
      "boom-chick two-beat, I-IV-V in major, root-fifth bass, twang leads",
    tempo: { bpm: [80, 170], typical: 112 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["mixolydian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.3],
        ["axis", 0.3],
        ["mixolydian-rock", 0.4],
      ],
      sevenths: 0.1,
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("....x.......x..."),
      },
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x.......x.......") },
    texture: {
      roles: {
        chords: role("acoustic"),
        lead: role("fiddle", "electric:0.6", "banjo:0.4"),
      },
    },
  }),
  card({
    id: "north-american-folk",
    abstract: true,
    summary:
      "strophic song, diatonic modes, acoustic strings, little or no kit",
    pitch: {
      scales: [
        ["major", 0.5],
        ["mixolydian", 0.25],
        ["dorian", 0.25],
      ],
    },
    harmony: { sevenths: 0 },
    texture: {
      roles: {
        kick: null,
        snare: null,
        hat: null,
        chords: role("acoustic", "banjo:0.5"),
        lead: role("fiddle", "whistle:0.4"),
      },
    },
    form: {
      plans: [[["verse", "verse", "chorus", "verse", "chorus"], 1]],
      archetype: "strophic",
    },
  }),
]);
