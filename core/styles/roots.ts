/**
 * Jazz, blues, soul, gospel, country and North American folk (quality-08
 * family `roots`). `bebop` is the worked Western leaf: swung eighths at a
 * measured 1.6–2.2 ratio, ride and hi-hat on 2 and 4, a walking bass that
 * lands a chord tone on every downbeat with chromatic approaches, ii–V
 * chains with sevenths throughout and a chromatic eighth-note line.
 */

import { grid, intervals, kitRoles, maybe, role } from "./parts.ts";
import { card, type StyleCard } from "./schema.ts";

const SWING_RIDE = grid("x...x.x.x...x.x.");
/**
 * The 12-bar blues as dominant sevenths in any mode: `I[7]` is a dominant
 * seventh on the tonic whether the key is minor (blues scale) or
 * mixolydian, so IV is never a major seventh.
 */
const D = (numeral: string) => `${numeral}[7]`;
export const BLUES_FORM: readonly string[] = Object.freeze(
  ["I", "I", "I", "I", "IV", "IV", "I", "I", "V", "IV", "I", "V"].map(D),
);
/** Quick-change: IV in bar 2. */
export const QUICK_CHANGE_FORM: readonly string[] = Object.freeze(
  ["I", "IV", "I", "I", "IV", "IV", "I", "I", "V", "IV", "I", "V"].map(D),
);
/** Final chorus: V-IV-I-I, the turnaround resolved. */
export const ENDING_FORM: readonly string[] = Object.freeze(
  ["I", "I", "I", "I", "IV", "IV", "I", "I", "V", "IV", "I", "I"].map(D),
);
/** Eight-bar blues: I-V-IV-IV-I-V-I-V. */
export const EIGHT_BAR_BLUES: readonly string[] = Object.freeze(
  ["I", "V", "IV", "IV", "I", "V", "I", "V"].map(D),
);
/** Son clave 3-2 over one 4/4 bar of sixteenths: 0, 3, 6 | 10, 12. */
export const SON_CLAVE = grid("x..x..x...x.x...");
/** Bossa clave: the son clave's last stroke pushed a sixteenth late. */
export const BOSSA_CLAVE = grid("x..x..x...x..x..");
/** Tresillo 3+3+2 twice per bar. */
export const TRESILLO = grid("x..x..x.x..x..x.");

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
        iv: [
          ["I", 2],
          ["V7", 1],
        ],
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
      forms: [
        [BLUES_FORM, 0.6],
        [QUICK_CHANGE_FORM, 0.4],
      ],
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
  // -------------------------------------------------------------------------
  // Jazz leaves. References: Mark Levine, "The Jazz Theory Book" (1995);
  // Gunther Schuller, "Early Jazz" (1968) and "The Swing Era" (1989).
  card({
    id: "ragtime",
    summary:
      "ragtime: straight 2/4 march bass (oom-pah), syncopated right-hand cakewalk figure, secondary dominants, multi-strain AABBACCDD",
    seedSalt: 1899,
    meter: { signatures: [["2/4", 1]], hypermeter: [[8, 1]] },
    tempo: { bpm: [70, 110], typical: 88 },
    groove: { subdivision: 4, swingRatio: [1, 1.05] },
    rhythm: {
      onsets: { kick: null, snare: null, hat: null, chords: grid("..x...x.") },
    },
    harmony: {
      presets: [
        ["fifties", 0.4],
        ["turnaround", 0.6],
      ],
      chain: {
        I: [
          ["VI7", 2],
          ["IV", 1],
          ["V7", 1],
        ],
        VI7: [["II7", 3]],
        II7: [["V7", 3]],
        IV: [
          ["#ivo7", 1],
          ["V7", 1],
        ],
        "#ivo7": [["I", 3]],
        V7: [["I", 3]],
      },
      sources: { presets: 1, chain: 3 },
      cadences: [["V-I", 1]],
      rhythm: [[1, 1]],
      sevenths: 0.3,
      voicing: { types: [["close", 1]], range: [55, 76], notes: [3, 4] },
    },
    melody: {
      density: [3, 4],
      intervals: intervals(4, 3, 1.5, 0.5),
      chordToneRate: 0.75,
      contour: [
        ["arch", 0.6],
        ["wave", 0.4],
      ],
      repetition: 0.6,
    },
    bass: {
      behaviour: [
        ["octave", 0.6],
        ["root-fifth", 0.4],
      ],
      onsets: grid("x...x..."),
    },
    form: {
      plans: [[["verse", "verse", "chorus", "chorus", "verse"], 1]],
      archetype: "multi-strain rag",
    },
    texture: {
      kind: "homophonic",
      roles: {
        bass: role("piano"),
        chords: role("piano", "honkytonk:0.5"),
        lead: role("piano", "honkytonk:0.4"),
        counter: null,
      },
    },
  }),
  card({
    id: "new-orleans-jazz",
    summary:
      "New Orleans: two-beat with Spanish-tinge tresillo bass, collective improvisation (trumpet lead, clarinet obbligato, trombone tailgate)",
    seedSalt: 1917,
    tempo: { bpm: [90, 200], typical: 150 },
    rhythm: {
      onsets: {
        kick: grid("x...x..."),
        snare: grid("..x...x."),
        hat: grid("x.x.x.x."),
      },
    },
    harmony: {
      presets: [
        ["fifties", 0.3],
        ["turnaround", 0.7],
      ],
      sevenths: 0.5,
      rhythm: [[1, 1]],
      voicing: { types: [["close", 1]] },
    },
    melody: { chordToneRate: 0.75, density: [2, 3] },
    form: { archetype: "head-ensemble-choruses" },
  }),
  card({
    id: "chicago-jazz",
    summary:
      "Chicago style: four-to-the-bar replaces two-beat, string bass walks, solo choruses over 32-bar song form, driving hi-hat",
    seedSalt: 1927,
    tempo: { bpm: [140, 230], typical: 180 },
    rhythm: { onsets: { kick: grid("x.x.x.x."), hat: grid("..x...x.") } },
    bass: {
      behaviour: [
        ["walking", 0.7],
        ["root-fifth", 0.3],
      ],
    },
    texture: {
      roles: {
        bass: role("contrabass", "tuba:0.3"),
        chords: role("piano", "banjo:0.4"),
        lead: role("trumpet", "clarinet:0.5", "sax:0.5"),
      },
    },
    form: { archetype: "aaba" },
  }),
  card({
    id: "stride",
    summary:
      "stride piano: left hand leaps bass note on 1 and 3 to mid-register chord on 2 and 4, right-hand runs over ragtime harmony",
    seedSalt: 1921,
    tempo: { bpm: [120, 250], typical: 180 },
    groove: { swingRatio: [1.3, 1.8] },
    rhythm: {
      onsets: { kick: null, snare: null, hat: null, chords: grid("..x...x.") },
    },
    harmony: {
      presets: [["turnaround", 1]],
      rhythm: [[1, 1]],
      sevenths: 0.6,
      voicing: { types: [["close", 1]], range: [52, 70], notes: [3, 4] },
    },
    bass: {
      behaviour: [
        ["octave", 0.5],
        ["root-fifth", 0.5],
      ],
      onsets: grid("x...x..."),
      range: [28, 48],
    },
    melody: { density: [3, 4], chordToneRate: 0.7 },
    texture: {
      kind: "homophonic",
      roles: {
        bass: role("piano"),
        chords: role("piano", "upright:0.5"),
        lead: role("piano"),
        counter: null,
      },
    },
  }),
  card({
    id: "big-band-swing",
    summary:
      "big band: four-on-the-floor swing, saxes vs brass riff call and response, shout chorus, 32-bar AABA, ii-V turnarounds",
    seedSalt: 1935,
    tempo: { bpm: [120, 240], typical: 160 },
    rhythm: {
      onsets: {
        kick: grid("x.x.x.x."),
        snare: grid("..1...1."),
        hat: grid("x.xxx.xx"),
      },
    },
    bass: { behaviour: [["walking", 1]] },
    texture: {
      roles: {
        chords: role("horn", "trombone:0.6"),
        counter: role("sax", "altosax:0.6"),
        lead: role("trumpet", "sax:0.4"),
      },
    },
    form: {
      plans: [
        [["intro", "verse", "verse", "bridge", "verse", "chorus", "outro"], 1],
      ],
      archetype: "aaba",
    },
    mix: { space: 0.4 },
  }),
  card({
    id: "kansas-city-jazz",
    summary:
      "Kansas City: riff-based head arrangements over 12-bar blues, light four-four pulse, hi-hat time, relaxed hard swing",
    seedSalt: 1936,
    tempo: { bpm: [130, 240], typical: 170 },
    meter: { hypermeter: [[12, 1]] },
    pitch: {
      scales: [
        ["mixolydian", 0.6],
        ["blues", 0.4],
      ],
    },
    harmony: {
      forms: [[BLUES_FORM, 1]],
      sources: { forms: 3, presets: 0.5 },
      rhythm: [[1, 1]],
    },
    melody: {
      repetition: 0.8,
      phraseBars: [
        [2, 0.6],
        [4, 0.4],
      ],
    },
    bass: { behaviour: [["walking", 1]] },
    rhythm: { onsets: { hat: grid("..x...x.") } },
    form: { archetype: "12-bar riff" },
  }),
  card({
    id: "gypsy-jazz",
    summary:
      "gypsy jazz: la pompe rhythm guitar on every beat (2 and 4 accented), no kit, harmonic-minor and minor-sixth colour, violin and guitar arpeggio runs",
    seedSalt: 1934,
    tempo: { bpm: [120, 280], typical: 200 },
    groove: { swingRatio: [1.4, 1.8] },
    pitch: {
      scales: [
        ["harmonic-minor", 0.5],
        ["major", 0.5],
      ],
    },
    rhythm: {
      onsets: {
        kick: null,
        snare: null,
        hat: null,
        chords: grid("x.x.x.x."),
      },
    },
    harmony: {
      presets: [
        ["minor-ii-v", 0.5],
        ["turnaround", 0.5],
      ],
      rhythm: [[1, 1]],
      voicing: { types: [["close", 1]], range: [52, 72], notes: [3, 4] },
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x...") },
    melody: { density: [3, 4], intervals: intervals(4, 4, 0.8, 0.2) },
    texture: {
      kind: "homophonic",
      roles: {
        bass: role("contrabass"),
        chords: role("acoustic"),
        lead: role("violin", "acoustic:0.7"),
        counter: null,
      },
    },
  }),
  card({
    id: "vocal-jazz",
    summary:
      "vocal standards: 32-bar AABA song form, ballad to medium swing, ii-V-I with tritone subs, brushes, lyrical stepwise line",
    seedSalt: 1950,
    tempo: { bpm: [60, 180], typical: 110 },
    rhythm: { onsets: { snare: grid("..2...2."), kick: grid("x.......") } },
    melody: {
      intervals: intervals(5, 2, 0.6, 0.6),
      density: [1, 2],
      chordToneRate: 0.7,
      contour: [["arch", 1]],
      repetition: 0.5,
    },
    texture: {
      roles: {
        lead: role("sing"),
        chords: role("piano", "acoustic:0.4"),
        counter: maybe("sax", "trumpet:0.5"),
      },
    },
    form: {
      plans: [[["intro", "verse", "verse", "bridge", "verse", "outro"], 1]],
      archetype: "aaba",
    },
  }),
  card({
    id: "cool-jazz",
    summary:
      "cool jazz: relaxed tempos, light swing, counterpoint between horns, soft dynamics, chamber voicings, lydian and major-seventh colour",
    seedSalt: 1949,
    tempo: { bpm: [90, 180], typical: 130 },
    groove: { swingRatio: [1.4, 1.8] },
    pitch: {
      scales: [
        ["major", 0.6],
        ["lydian", 0.4],
      ],
    },
    melody: {
      intervals: intervals(5, 3, 0.6, 0.4),
      density: [2, 3],
      contour: [
        ["arch", 0.6],
        ["wave", 0.4],
      ],
    },
    texture: {
      kind: "polyphonic",
      roles: {
        lead: role("altosax", "trumpet:0.6"),
        counter: role("barisax", "trombone:0.5", "horn:0.4"),
        chords: role("piano", "acoustic:0.3"),
      },
    },
    expression: { dynamics: [0.3, 0.7] },
  }),
  card({
    id: "hard-bop",
    summary:
      "hard bop: bebop vocabulary with blues and gospel inflection, minor ii-V, trumpet and tenor unison heads, hard-swinging ride and snare comping",
    seedSalt: 1955,
    tempo: { bpm: [120, 260], typical: 180 },
    pitch: {
      scales: [
        ["minor", 0.4],
        ["dorian", 0.3],
        ["major", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["minor-ii-v", 0.5],
        ["ii-v-i", 0.5],
      ],
    },
    melody: { density: [2, 4], intervals: intervals(5, 3, 0.8, 0.2) },
    rhythm: { onsets: { snare: grid("..2..12.") } },
    texture: {
      roles: {
        lead: role("trumpet", "sax:0.8"),
        counter: maybe("sax"),
      },
    },
  }),
  card({
    id: "soul-jazz",
    summary:
      "soul jazz: Hammond organ trio, bluesy dorian vamps, gospel plagal turns, groove-locked straight-to-light swing backbeat",
    seedSalt: 1959,
    tempo: { bpm: [80, 150], typical: 110 },
    groove: { swingRatio: [1.3, 1.7] },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["blues", 0.5],
      ],
    },
    harmony: {
      presets: [["dorian-vamp", 1]],
      forms: [[BLUES_FORM, 1]],
      sources: { presets: 1, forms: 1, chain: 0 },
      rhythm: [[1, 1]],
    },
    rhythm: { onsets: { snare: grid("..x...x."), kick: grid("x...x...") } },
    bass: {
      behaviour: [
        ["walking", 0.6],
        ["root-fifth", 0.4],
      ],
    },
    texture: {
      roles: {
        chords: role("hammond", "jazzorgan:0.6"),
        bass: role("jazzorgan", "contrabass:0.5"),
        lead: role("sax", "electric:0.6"),
      },
    },
  }),
  card({
    id: "modal-jazz",
    summary:
      "modal jazz: few chords held 8-16 bars, dorian mode, quartal (fourths) voicings, pedal-point bass, scalar improvisation over the mode",
    seedSalt: 1959,
    tempo: { bpm: [100, 240], typical: 140 },
    pitch: {
      scales: [
        ["dorian", 0.7],
        ["mixolydian", 0.15],
        ["lydian", 0.15],
      ],
    },
    harmony: {
      model: "modal",
      rhythm: [
        [0.25, 0.6],
        [0.5, 0.4],
      ],
      sevenths: 0.5,
      voicing: { types: [["quartal", 1]], notes: [3, 5] },
    },
    melody: { chordToneRate: 0.4, intervals: intervals(5, 2, 1.2, 0.2) },
    bass: {
      behaviour: [
        ["walking", 0.7],
        ["pedal", 0.3],
      ],
    },
  }),
  card({
    id: "post-bop",
    summary:
      "post-bop: open forms, non-functional chord motion (constant-structure, chromatic mediants), sus and slash chords, interactive time",
    seedSalt: 1965,
    tempo: { bpm: [100, 260], typical: 160 },
    harmony: {
      chain: {
        Imaj7: [
          ["bIIImaj7", 1],
          ["bVImaj7", 1],
          ["ii7", 1],
        ],
        bIIImaj7: [
          ["bVImaj7", 1],
          ["ii7", 1],
        ],
        bVImaj7: [
          ["bII7", 1],
          ["V7", 1],
        ],
        bII7: [["Imaj7", 2]],
        ii7: [
          ["V7", 2],
          ["bII7", 1],
        ],
        V7: [
          ["Imaj7", 2],
          ["bVImaj7", 1],
        ],
      },
      sources: { presets: 0.5, chain: 3 },
      voicing: {
        types: [
          ["quartal", 0.5],
          ["open", 0.5],
        ],
      },
    },
    melody: { intervals: intervals(4, 3, 1.4, 0.2) },
  }),
  card({
    id: "third-stream",
    summary:
      "third stream: classical forms and orchestration fused with jazz swing, through-composed counterpoint, French horn and strings",
    seedSalt: 1957,
    tempo: { bpm: [70, 160], typical: 110 },
    groove: { swingRatio: [1.2, 1.7] },
    texture: {
      kind: "polyphonic",
      roles: {
        chords: role("strings", "horn:0.6"),
        lead: role("clarinet", "horn:0.5", "altosax:0.5"),
        counter: role("cello", "bassoon:0.5"),
      },
    },
    form: {
      plans: [[["intro", "verse", "bridge", "verse", "outro"], 1]],
      archetype: "through-composed",
    },
  }),
  card({
    id: "chamber-jazz",
    summary:
      "chamber and ECM jazz: rubato-leaning even eighths, open fifths and sus voicings, lydian and aeolian modes, space and long reverb",
    seedSalt: 1971,
    tempo: { bpm: [60, 130], typical: 90 },
    groove: { swingRatio: [1, 1.15] },
    pitch: {
      scales: [
        ["lydian", 0.4],
        ["minor", 0.3],
        ["dorian", 0.3],
      ],
    },
    harmony: {
      model: "modal",
      rhythm: [[0.5, 1]],
      voicing: {
        types: [
          ["open", 0.6],
          ["quartal", 0.4],
        ],
      },
    },
    rhythm: {
      onsets: { kick: grid("x......."), snare: null, hat: grid("x.2.x.2.") },
    },
    bass: {
      behaviour: [
        ["pedal", 0.5],
        ["root", 0.5],
      ],
      onsets: grid("x...2..."),
    },
    melody: { density: [1, 2], contour: [["arch", 1]] },
    texture: { roles: { lead: role("sax", "piano:0.6", "acoustic:0.4") } },
    expression: { dynamics: [0.25, 0.65] },
    mix: { space: 0.6 },
  }),
  card({
    id: "contemporary-jazz",
    summary:
      "contemporary jazz: straight-eighth and swing hybrid grooves, reharmonised standards, upper-structure triads, odd-meter vamps",
    seedSalt: 1990,
    tempo: { bpm: [90, 200], typical: 130 },
    meter: {
      signatures: [
        ["4/4", 0.7],
        ["7/4", 0.15],
        ["5/4", 0.15],
      ],
    },
    groove: { swingRatio: [1, 1.6] },
    harmony: {
      voicing: {
        types: [
          ["open", 0.5],
          ["quartal", 0.5],
        ],
      },
    },
  }),
  card({
    id: "uk-jazz",
    summary:
      "UK jazz new wave: straight sixteenth broken-beat and Afrobeat grooves, dorian vamps, tuba or synth bass, sax-led riff heads",
    seedSalt: 2016,
    tempo: { bpm: [95, 130], typical: 112 },
    groove: { subdivision: 4, swingRatio: [1, 1.15] },
    pitch: {
      scales: [
        ["dorian", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      model: "modal",
      rhythm: [
        [0.5, 0.6],
        [1, 0.4],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x...x..2.."),
        snare: grid("....x..2....x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x..x..x...x.x...") },
    texture: {
      roles: {
        bass: role("tuba", "ebass:0.6"),
        chords: role("rhodes", "piano:0.4"),
        lead: role("sax", "trumpet:0.5"),
      },
    },
  }),
  card({
    id: "free-jazz",
    summary:
      "free jazz: no fixed changes, pulse rather than meter, atonal and chromatic intervals, collective improvisation, energy-driven dynamics",
    seedSalt: 1960,
    tempo: { bpm: [100, 260], typical: 180 },
    groove: {
      swingRatio: [1, 1.6],
      humanize: { timingMs: 20, velocity: 0.15 },
    },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["phrygian", 0.25],
        ["locrian", 0.25],
      ],
    },
    harmony: {
      rhythm: [
        [1, 0.5],
        [0.5, 0.5],
      ],
      voicing: { types: [["quartal", 1]] },
    },
    melody: {
      intervals: intervals(2, 2, 3, 0.2),
      density: [2, 4],
      chordToneRate: 0.2,
    },
    rhythm: {
      onsets: {
        kick: grid("1.2.1..2"),
        snare: grid(".2.3.2.3"),
        hat: grid("x.5.x.5."),
      },
    },
    texture: {
      kind: "polyphonic",
      roles: {
        lead: role("sax", "altosax:0.6"),
        counter: role("trumpet", "bassclarinet:0.5"),
      },
    },
    expression: { dynamics: [0.3, 1] },
  }),
  card({
    id: "avant-garde-jazz",
    summary:
      "avant-garde jazz: composed structures with open sections, extended techniques, symmetric and whole-tone colours, sparse percussion",
    seedSalt: 1964,
    tempo: { bpm: [60, 200], typical: 120 },
    groove: { swingRatio: [1, 1.5] },
    pitch: {
      scales: [
        ["lydian", 0.4],
        ["locrian", 0.3],
        ["phrygian", 0.3],
      ],
    },
    melody: {
      intervals: intervals(2, 2, 2.5, 0.4),
      chordToneRate: 0.3,
      density: [1, 3],
    },
    rhythm: {
      onsets: {
        kick: grid("1......."),
        snare: grid("..2...2."),
        hat: grid("x.2.x.2."),
      },
    },
    texture: {
      kind: "polyphonic",
      roles: {
        lead: role("bassclarinet", "sax:0.6"),
        counter: role("prepared", "vibes:0.5"),
      },
    },
  }),
  card({
    id: "spiritual-jazz",
    summary:
      "spiritual jazz: modal drone on one chord, pedal-point ostinato bass, harp and piano washes, rubato rising to ecstatic swing",
    seedSalt: 1965,
    tempo: { bpm: [70, 160], typical: 110 },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["mixolydian", 0.3],
        ["phrygian", 0.2],
      ],
    },
    harmony: {
      model: "modal",
      rhythm: [[0.25, 1]],
      voicing: { types: [["quartal", 1]] },
    },
    bass: {
      behaviour: [
        ["ostinato", 0.6],
        ["pedal", 0.4],
      ],
      onsets: grid("x..x..x."),
    },
    texture: {
      roles: {
        chords: role("harp", "piano:0.6"),
        lead: role("sax", "flute:0.5"),
        bell: maybe("bell"),
      },
    },
    rhythm: { onsets: { bell: grid("x...x...") } },
    mix: { space: 0.55 },
  }),
  card({
    id: "dark-jazz",
    summary:
      "dark jazz: slow noir tempos, minor and phrygian harmony, brushed kit, muted trumpet over low drones and doom-laden pads",
    seedSalt: 1994,
    tempo: { bpm: [55, 90], typical: 70 },
    groove: { swingRatio: [1.3, 1.7] },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["phrygian", 0.4],
      ],
    },
    harmony: {
      presets: [["minor-ii-v", 1]],
      rhythm: [[0.5, 1]],
      voicing: { types: [["open", 1]] },
    },
    rhythm: {
      onsets: {
        kick: grid("x......."),
        snare: grid("..2...x."),
        hat: grid("..x...x."),
      },
    },
    bass: {
      behaviour: [
        ["walking", 0.4],
        ["root", 0.6],
      ],
      onsets: grid("x...x..."),
    },
    melody: { density: [1, 2] },
    texture: {
      roles: {
        lead: role("harmon", "sax:0.6"),
        chords: role("rhodes", "piano:0.5"),
        pad: maybe("strings"),
      },
    },
    mix: { space: 0.6 },
  }),
  card({
    id: "jazz-fusion",
    summary:
      "jazz fusion: rock-funk straight sixteenths, odd meters (7/8, 5/4), modal vamps with lydian and mixolydian colour, distorted guitar and synth leads",
    seedSalt: 1970,
    tempo: { bpm: [100, 180], typical: 130 },
    pitch: {
      scales: [
        ["mixolydian", 0.4],
        ["dorian", 0.3],
        ["lydian", 0.3],
      ],
    },
    harmony: {
      rhythm: [
        [0.5, 0.6],
        [1, 0.4],
      ],
      voicing: {
        types: [
          ["quartal", 0.5],
          ["open", 0.5],
        ],
      },
    },
    melody: { density: [3, 4], intervals: intervals(5, 3, 1, 0.2) },
    texture: {
      roles: {
        lead: role("electric@lead", "saw:0.5"),
        chords: role("rhodes", "saw:0.3"),
      },
    },
  }),
  card({
    id: "jazz-funk",
    summary:
      "jazz-funk: syncopated sixteenth funk groove on the one, dominant-ninth and minor-eleventh vamps, slap or finger bass ostinato, electric piano",
    seedSalt: 1973,
    tempo: { bpm: [90, 120], typical: 104 },
    meter: { signatures: [["4/4", 1]] },
    pitch: {
      scales: [
        ["dorian", 0.6],
        ["mixolydian", 0.4],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x.....x."),
        snare: grid("....x..2.2..x..."),
        hat: grid("xxxxxxxxxxxxxxxx"),
      },
    },
    bass: { onsets: grid("x..x..x.x.2..x.2") },
    texture: {
      roles: {
        bass: role("slap", "ebass:0.6"),
        chords: role("rhodes", "clav:0.5"),
      },
    },
  }),
  card({
    id: "smooth-jazz",
    summary:
      "smooth jazz: mid-tempo straight sixteenths, major-ninth and sus chords, IV-V-iii-vi ballad motion, soprano or alto sax lead, polished mix",
    seedSalt: 1987,
    tempo: { bpm: [80, 110], typical: 92 },
    meter: { signatures: [["4/4", 1]] },
    pitch: {
      scales: [
        ["major", 0.7],
        ["lydian", 0.3],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["axis", 0.4],
        ["turnaround", 0.6],
      ],
      sources: { presets: 1, chain: 1 },
      sevenths: 0.9,
      rhythm: [
        [1, 0.6],
        [0.5, 0.4],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x...x....."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: {
      behaviour: [
        ["root-fifth", 0.5],
        ["arpeggio", 0.5],
      ],
      onsets: grid("x.....x...x.x..."),
    },
    melody: { density: [1, 2], intervals: intervals(5, 3, 0.6, 0.6) },
    texture: {
      roles: {
        lead: role("altosax", "sax:0.6"),
        chords: role("rhodes", "epiano:0.6"),
      },
    },
    mix: { space: 0.45, loudness: "streaming" },
  }),
  card({
    id: "acid-jazz",
    summary:
      "acid jazz: funk and soul-jazz grooves over breakbeat drums, dorian minor-seventh vamps, Hammond and wah guitar, light sixteenth swing",
    seedSalt: 1988,
    tempo: { bpm: [95, 120], typical: 108 },
    meter: { signatures: [["4/4", 1]] },
    groove: { swingRatio: [1.1, 1.3] },
    pitch: {
      scales: [
        ["dorian", 0.8],
        ["minor", 0.2],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x.........x..2.."),
        snare: grid("....x..2.2..x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        chords: role("hammond", "funk:0.5"),
        lead: role("sax", "electric@wah:0.5"),
      },
    },
  }),
  card({
    id: "nu-jazz",
    summary:
      "nu jazz: electronic production with jazz harmony, programmed broken beats or house pulse, minor-ninth chord loops, sampled-feel horns",
    seedSalt: 1998,
    tempo: { bpm: [95, 125], typical: 118 },
    meter: { signatures: [["4/4", 1]] },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: { rhythm: [[0.5, 1]] },
    rhythm: {
      onsets: {
        kick: grid("x...x...x...x..."),
        snare: grid("....x.......x..."),
        hat: grid("..x...x...x...x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("electro"),
        chords: role("rhodes", "keys:0.4"),
        bass: role("bass", "ebass:0.4"),
        lead: role("trumpet", "flute:0.4"),
      },
    },
  }),
  card({
    id: "afro-cuban-jazz",
    summary:
      "Afro-Cuban jazz: son clave 3-2 (0,3,6,10,12 of 16) on the bell, tumbao bass anticipating beat 3 and 4, piano montuno, bebop horns over cascara",
    seedSalt: 1947,
    tempo: { bpm: [150, 240], typical: 190 },
    meter: { signatures: [["4/4", 1]] },
    groove: { swingRatio: [1, 1.05] },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["minor-ii-v", 0.5],
        ["ii-v-i", 0.5],
      ],
      sources: { presets: 1, chain: 1 },
      rhythm: [
        [1, 0.5],
        [0.5, 0.5],
      ],
    },
    rhythm: {
      onsets: {
        bell: SON_CLAVE,
        perc: grid("...x..x....x..x."),
        kick: grid("......x.....x..."),
        snare: null,
        hat: grid("x.xx.x.xx.x.x.x."),
        chords: grid("x.x..x.x..x..x.x"),
      },
      locks: [],
    },
    bass: {
      behaviour: [["root-fifth", 1]],
      onsets: grid("......x.....x..."),
      kickLock: 0,
    },
    texture: {
      roles: {
        bell: role("drums"),
        perc: role("drums"),
        chords: role("piano"),
        lead: role("trumpet", "sax:0.7"),
        counter: maybe("trombone"),
      },
    },
  }),
  card({
    id: "latin-jazz",
    summary:
      "Brazilian and pan-Latin jazz: bossa nova clave (0,3,6,10,13 of 16) on rim, surdo-like bass on 1 and 3, nylon guitar batida, ii-V with altered dominants",
    seedSalt: 1962,
    tempo: { bpm: [110, 160], typical: 132 },
    meter: { signatures: [["4/4", 1]] },
    groove: { swingRatio: [1, 1.05] },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["ii-v-i", 0.5],
        ["turnaround", 0.5],
      ],
      sources: { presets: 1, chain: 2 },
      rhythm: [
        [1, 0.5],
        [0.5, 0.5],
      ],
      voicing: {
        types: [
          ["shell", 0.4],
          ["close", 0.6],
        ],
        range: [52, 72],
      },
    },
    rhythm: {
      onsets: {
        bell: BOSSA_CLAVE,
        kick: grid("x.....x.x.....x."),
        snare: null,
        hat: grid("xxxxxxxxxxxxxxxx"),
        chords: grid("x..x..x...x..x.."),
      },
    },
    bass: {
      behaviour: [["root-fifth", 1]],
      onsets: grid("x.....x.x.....x."),
      kickLock: 0.8,
    },
    melody: { density: [1, 2], intervals: intervals(5, 3, 0.6, 0.6) },
    texture: {
      roles: {
        bell: role("drums"),
        bass: role("contrabass", "ebass:0.5"),
        chords: role("nylon"),
        lead: role("flute", "sax:0.6", "sing:0.6"),
      },
    },
  }),
  // -------------------------------------------------------------------------
  // Blues leaves. References: Jeff Todd Titon, "Early Downhome Blues" (1977);
  // David Evans, "Big Road Blues" (1982); Peter Silvester, "A Left Hand Like
  // God" (1988, piano blues and boogie-woogie).
  card({
    id: "delta-blues",
    summary:
      "Delta blues: solo bottleneck guitar, drone on the tonic, AAB couplet over 12 bars, blue third bent toward the major, heavy triplet shuffle, one-chord stretches",
    seedSalt: 1930,
    tempo: { bpm: [60, 120], typical: 84 },
    groove: { swingRatio: [1.9, 2.2] },
    pitch: {
      scales: [
        ["blues", 0.7],
        ["minor-pentatonic", 0.3],
      ],
    },
    harmony: { forms: [[BLUES_FORM, 1]], sources: { forms: 1 } },
    bass: {
      behaviour: [
        ["pedal", 0.6],
        ["root", 0.4],
      ],
      onsets: grid("x.x.x.x."),
    },
    melody: {
      density: [1, 2],
      repetition: 0.7,
      contour: [
        ["descending", 0.7],
        ["arch", 0.3],
      ],
    },
    texture: {
      roles: {
        bass: role("steel"),
        chords: role("steel"),
        lead: role("steel@glide", "sing:0.5"),
      },
    },
    form: { archetype: "12-bar" },
  }),
  card({
    id: "piedmont-blues",
    summary:
      "Piedmont blues: ragtime-derived alternating-thumb fingerpicking (bass on every beat, root and fifth), syncopated treble, major-leaning I-VI7-II7-V7 circle",
    seedSalt: 1928,
    tempo: { bpm: [90, 140], typical: 112 },
    groove: { subdivision: 4, swingRatio: [1.2, 1.5] },
    pitch: {
      scales: [
        ["major-blues", 0.6],
        ["major-pentatonic", 0.4],
      ],
    },
    harmony: {
      forms: [[BLUES_FORM, 0.5]],
      presets: [["turnaround", 0.5]],
      sources: { forms: 1, presets: 1 },
    },
    bass: {
      behaviour: [["root-fifth", 1]],
      onsets: grid("x...x...x...x..."),
    },
    rhythm: { onsets: { chords: grid("..x...x.x.x...x.") } },
    texture: {
      roles: {
        bass: role("steel"),
        chords: role("steel"),
        lead: role("steel", "sing:0.4"),
      },
    },
  }),
  card({
    id: "texas-blues",
    summary:
      "Texas blues: free single-note lines over a steady thumbed bass, looser bar counts, minor-pentatonic runs, relaxed swing with jazz-inflected ninths",
    seedSalt: 1926,
    tempo: { bpm: [70, 130], typical: 96 },
    groove: { swingRatio: [1.6, 1.9] },
    pitch: {
      scales: [
        ["blues", 0.5],
        ["minor-pentatonic", 0.5],
      ],
    },
    melody: { density: [2, 3], intervals: intervals(5, 3, 1, 0.4) },
    texture: {
      roles: {
        bass: role("steel"),
        chords: role("steel"),
        lead: role("steel", "sing:0.4"),
      },
    },
  }),
  card({
    id: "hill-country-blues",
    summary:
      "hill country blues: one-chord trance groove on a tonic drone, repetitive riff ostinato, fife-and-drum polyrhythm, droning straight-ish eighths",
    seedSalt: 1959,
    tempo: { bpm: [90, 130], typical: 108 },
    groove: { swingRatio: [1.2, 1.5] },
    pitch: {
      scales: [
        ["minor-pentatonic", 0.6],
        ["blues", 0.4],
      ],
    },
    harmony: {
      model: "modal",
      forms: null,
      presets: null,
      sources: null,
      rhythm: [[4, 1]],
    },
    bass: {
      behaviour: [
        ["ostinato", 0.7],
        ["pedal", 0.3],
      ],
      onsets: grid("x.xx..x."),
    },
    rhythm: {
      onsets: {
        kick: grid("x...x.x."),
        snare: grid("..x...x."),
        hat: null,
      },
    },
    melody: { repetition: 0.8, density: [2, 2] },
    texture: {
      roles: {
        kick: role("drums"),
        snare: maybe("drums"),
        bass: role("electric"),
        chords: role("electric@crunch"),
        lead: role("electric@crunch", "sing:0.4"),
      },
    },
    form: { archetype: "one-chord vamp" },
  }),
  card({
    id: "memphis-blues",
    summary:
      "Memphis blues: early string-band and jug-band blues of the Mid-South, sixteen-bar and twelve-bar strophes, guitar and harp duets, brisk two-beat",
    seedSalt: 1927,
    tempo: { bpm: [90, 140], typical: 116 },
    groove: { swingRatio: [1.5, 1.8] },
    pitch: {
      scales: [
        ["major-blues", 0.5],
        ["blues", 0.5],
      ],
    },
    harmony: {
      forms: [
        [BLUES_FORM, 0.6],
        [EIGHT_BAR_BLUES, 0.4],
      ],
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x...") },
    texture: {
      roles: {
        bass: role("steel"),
        chords: role("steel", "banjo:0.4"),
        lead: role("reeds", "steel:0.6"),
      },
    },
  }),
  card({
    id: "jug-band",
    summary:
      "jug band: tuba-like jug on root and fifth two-beat, washboard sixteenth scrape, kazoo and banjo, ragtime circle I-VI7-II7-V7",
    seedSalt: 1925,
    tempo: { bpm: [110, 170], typical: 140 },
    groove: { swingRatio: [1.4, 1.8] },
    pitch: {
      scales: [
        ["major", 0.6],
        ["major-blues", 0.4],
      ],
    },
    harmony: {
      presets: [["turnaround", 1]],
      forms: [[BLUES_FORM, 1]],
      sources: { presets: 1, forms: 1 },
    },
    rhythm: { onsets: { shaker: grid("xxxxxxxx") } },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x...") },
    texture: {
      roles: {
        shaker: role("drums"),
        bass: role("tuba"),
        chords: role("banjo", "steel:0.5"),
        lead: role("reeds", "whistle:0.4"),
      },
    },
  }),
  card({
    id: "classic-female-blues",
    summary:
      "classic vaudeville blues: singer fronting a small jazz band, stride-like piano, cornet obbligato answering each vocal line (call and response), 12-bar and 16-bar strophes",
    seedSalt: 1923,
    tempo: { bpm: [70, 120], typical: 88 },
    groove: { swingRatio: [1.5, 1.8] },
    pitch: {
      scales: [
        ["blues", 0.5],
        ["major-blues", 0.5],
      ],
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x...") },
    texture: {
      roles: {
        kick: null,
        snare: null,
        hat: null,
        bass: role("tuba", "contrabass:0.6"),
        chords: role("honkytonk", "upright:0.6"),
        lead: role("sing"),
        counter: role("trumpet", "clarinet:0.5"),
      },
    },
  }),
  card({
    id: "piano-blues",
    summary:
      "barrelhouse piano blues: rolling left-hand root-fifth-sixth figure, right-hand tremolos and crushed blue-note grace tones, 12-bar shuffle",
    seedSalt: 1929,
    tempo: { bpm: [70, 130], typical: 100 },
    bass: { behaviour: [["arpeggio", 1]], onsets: grid("x.x.x.x.") },
    rhythm: { onsets: { chords: grid("..x...x.") } },
    texture: {
      roles: {
        kick: null,
        snare: null,
        hat: null,
        bass: role("honkytonk", "upright:0.5"),
        chords: role("honkytonk", "upright:0.5"),
        lead: role("honkytonk", "upright:0.5"),
      },
    },
  }),
  card({
    id: "boogie-woogie",
    summary:
      "boogie-woogie: ostinato left hand of eight-to-the-bar broken octaves and walking 1-3-5-6-b7 patterns, right-hand riffs and tremolos, fast 12-bar",
    seedSalt: 1938,
    tempo: { bpm: [140, 200], typical: 168 },
    groove: { swingRatio: [1.5, 1.9] },
    harmony: { forms: [[BLUES_FORM, 1]], sources: { forms: 1 } },
    bass: {
      behaviour: [
        ["ostinato", 0.6],
        ["walking", 0.4],
      ],
      onsets: grid("xxxxxxxx"),
    },
    melody: { density: [2, 3], repetition: 0.7 },
    texture: {
      roles: {
        kick: null,
        snare: null,
        hat: null,
        bass: role("honkytonk", "grand:0.5"),
        chords: role("honkytonk", "grand:0.5"),
        lead: role("honkytonk", "grand:0.5"),
      },
    },
  }),
  card({
    id: "jump-blues",
    summary:
      "jump blues: up-tempo shuffle, walking or boogie bass, riffing horn section answering a shouted vocal, snare backbeat on 2 and 4, honking tenor solo",
    seedSalt: 1946,
    tempo: { bpm: [150, 210], typical: 176 },
    bass: {
      behaviour: [
        ["walking", 0.6],
        ["ostinato", 0.4],
      ],
      onsets: grid("x.x.x.x."),
    },
    texture: {
      roles: {
        bass: role("contrabass", "ebass:0.4"),
        chords: role("piano", "honkytonk:0.5"),
        lead: role("sax", "sing:0.6"),
        counter: role("trumpet", "trombone:0.6", "barisax:0.4"),
      },
    },
  }),
  card({
    id: "chicago-blues",
    summary:
      "Chicago blues: amplified electric band, slow-medium shuffle, quick-change 12-bar, guitar and amplified-harp call and response, root-fifth-sixth shuffle bass",
    seedSalt: 1950,
    tempo: { bpm: [70, 130], typical: 92 },
    harmony: {
      forms: [
        [QUICK_CHANGE_FORM, 0.6],
        [BLUES_FORM, 0.4],
      ],
    },
    bass: {
      behaviour: [
        ["arpeggio", 0.6],
        ["walking", 0.4],
      ],
    },
    texture: {
      roles: {
        chords: role("electric@crunch", "piano:0.5"),
        lead: role("electric@crunch", "reeds:0.5"),
        counter: maybe("reeds"),
      },
    },
  }),
  card({
    id: "louisiana-blues",
    summary:
      "Louisiana swamp blues: slow laid-back shuffle, tremolo-soaked guitar, reverb-heavy sparse arrangement, harp fills, minor-pentatonic phrasing",
    seedSalt: 1957,
    tempo: { bpm: [60, 100], typical: 76 },
    pitch: {
      scales: [
        ["blues", 0.6],
        ["minor-pentatonic", 0.4],
      ],
    },
    melody: { density: [1, 2] },
    texture: {
      roles: {
        chords: role("electric@clean"),
        lead: role("electric@clean", "reeds:0.5"),
      },
    },
    mix: { space: 0.6, fx: { chords: { tremolo: "pulse" } } },
  }),
  card({
    id: "west-coast-blues",
    summary:
      "West Coast blues: jazz-inflected urbane blues, ninth and thirteenth chords, smooth swing, horn pads, single-note guitar lines with bebop passing tones",
    seedSalt: 1947,
    tempo: { bpm: [70, 130], typical: 100 },
    groove: { swingRatio: [1.5, 1.8] },
    pitch: {
      scales: [
        ["blues", 0.4],
        ["mixolydian", 0.6],
      ],
    },
    harmony: {
      voicing: {
        types: [
          ["shell", 0.5],
          ["open", 0.5],
        ],
      },
    },
    melody: { chordToneRate: 0.6, intervals: intervals(6, 3, 0.7, 0.3) },
    texture: {
      roles: {
        chords: role("piano", "electric@clean:0.6"),
        lead: role("electric@clean"),
        pad: maybe("sax", "trumpet:0.6"),
      },
    },
  }),
  card({
    id: "soul-blues",
    summary:
      "soul blues: blues form with gospel-soul production, straight-eighth backbeat, organ pads, horn stabs, melismatic vocal over minor-pentatonic guitar fills",
    seedSalt: 1969,
    tempo: { bpm: [60, 100], typical: 78 },
    groove: { swingRatio: [1, 1.3] },
    harmony: {
      sources: { forms: 1, presets: 1 },
      presets: [["turnaround", 1]],
    },
    texture: {
      roles: {
        chords: role("hammond", "epiano:0.5"),
        lead: role("sing", "electric@clean:0.6"),
        counter: maybe("trumpet", "sax:0.6"),
      },
    },
  }),
  card({
    id: "modern-electric-blues",
    summary:
      "modern electric blues: overdriven guitar lead, power-trio texture, rock backbeat with blues shuffle or straight eighths, sustained bends and long solos",
    seedSalt: 1985,
    tempo: { bpm: [70, 140], typical: 104 },
    groove: { swingRatio: [1, 1.9] },
    pitch: {
      scales: [
        ["blues", 0.6],
        ["minor-pentatonic", 0.4],
      ],
    },
    harmony: {
      voicing: {
        types: [
          ["power", 0.5],
          ["close", 0.5],
        ],
      },
    },
    melody: { density: [2, 3] },
    texture: {
      roles: {
        chords: role("electric@crunch"),
        lead: role("electric@lead", "electric@fuzz:0.4"),
      },
    },
  }),
]);
