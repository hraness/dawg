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
      // The rare non-form chorus is a turnaround or I-bVII-IV vamp, never a
      // pop axis loop.
      presets: [
        ["turnaround", 0.5],
        ["mixolydian-rock", 0.5],
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
  // -------------------------------------------------------------------------
  // R&B, soul and funk leaves. References: Rob Bowman, "Soulsville, U.S.A."
  // (1997); Anne Danielsen, "Presence and Pleasure: The Funk Grooves of James
  // Brown and Parliament" (2006); Allan Slutsky, "Standing in the Shadows of
  // Motown" (1989).
  card({
    id: "classic-rnb",
    summary:
      "classic rhythm and blues: shuffle backbeat on 2 and 4, 12-bar and I-vi-IV-V forms, boogie arpeggio bass, honking tenor sax answering the vocal",
    seedSalt: 1949,
    tempo: { bpm: [90, 160], typical: 120 },
    harmony: {
      forms: [[BLUES_FORM, 1]],
      presets: [["fifties", 1]],
      sources: { forms: 1, presets: 1 },
    },
    rhythm: { onsets: { snare: grid("..x...x."), kick: grid("x...x...") } },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("piano", "honkytonk:0.5"),
        lead: role("sing"),
        counter: role("sax", "barisax:0.4"),
      },
    },
  }),
  card({
    id: "doo-wop",
    summary:
      "doo-wop: the I-vi-IV-V fifties progression, 12/8 triplet ballad pulse, vocal-group nonsense-syllable backing pads, bass voice on roots",
    seedSalt: 1954,
    tempo: { bpm: [60, 130], typical: 76 },
    meter: {
      signatures: [
        ["12/8", 0.6],
        ["4/4", 0.4],
      ],
      hypermeter: [[4, 1]],
    },
    groove: { subdivision: 2, swingRatio: [1.8, 2.1] },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [["fifties", 1]],
      sevenths: 0.2,
      cadences: [["V-I", 1]],
    },
    bass: {
      behaviour: [
        ["root", 0.6],
        ["arpeggio", 0.4],
      ],
    },
    rhythm: { onsets: { chords: grid("x.x.x.x.") } },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("ooh", "piano:0.4"),
        bass: role("contrabass", "aah:0.3"),
        lead: role("sing"),
        pad: maybe("aah"),
      },
    },
  }),
  card({
    id: "new-orleans-rnb",
    summary:
      "New Orleans R&B: second-line rumba-boogie piano, tresillo bass (3+3+2), parade-drum snare, horns, I-IV-V in major",
    seedSalt: 1952,
    tempo: { bpm: [100, 160], typical: 128 },
    groove: { subdivision: 4, swingRatio: [1.2, 1.5] },
    pitch: {
      scales: [
        ["major", 0.6],
        ["mixolydian", 0.4],
      ],
    },
    harmony: {
      forms: [[BLUES_FORM, 1]],
      presets: [["fifties", 1]],
      sources: { forms: 1, presets: 1 },
    },
    rhythm: {
      onsets: {
        kick: grid("x..x..x.x..x..x."),
        snare: grid("....x..1....x.1."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: { behaviour: [["arpeggio", 1]], onsets: TRESILLO },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("honkytonk", "upright:0.6"),
        lead: role("sing", "sax:0.5"),
        counter: maybe("trumpet", "trombone:0.6"),
      },
    },
  }),
  card({
    id: "southern-soul",
    summary:
      "Southern soul: lazy behind-the-beat snare on 2 and 4, gospel organ, unison horn stabs, I-IV vamps and 6/8 ballads, sparse Memphis rhythm section",
    seedSalt: 1965,
    tempo: { bpm: [60, 120], typical: 92 },
    pitch: {
      scales: [
        ["major", 0.5],
        ["mixolydian", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["mixolydian-rock", 0.4],
        ["fifties", 0.3],
        ["turnaround", 0.3],
      ],
      sevenths: 0.4,
    },
    groove: { roleOffset: { snare: 0.12 } },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x......."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
        counter: grid("....x.......x..."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("hammond", "electric@clean:0.6"),
        bass: role("ebass"),
        lead: role("sing"),
        counter: role("trumpet", "sax:0.8"),
      },
    },
  }),
  card({
    id: "motown",
    summary:
      "Motown: four-on-the-floor snare and tambourine on every beat, melodic syncopated bass with chromatic approaches, I-vi-ii-V and ii-V changes, vibes and strings",
    seedSalt: 1964,
    tempo: { bpm: [110, 140], typical: 124 },
    groove: { subdivision: 4, swingRatio: [1, 1.1] },
    pitch: {
      scales: [
        ["major", 0.8],
        ["minor", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["turnaround", 0.5],
        ["ii-v-i", 0.3],
        ["axis", 0.2],
      ],
      sevenths: 0.4,
    },
    rhythm: {
      onsets: {
        kick: grid("x...x...x...x..."),
        snare: grid("x...x...x...x..."),
        shaker: grid("x...x...x...x..."),
        hat: grid("..x...x...x...x."),
      },
    },
    bass: {
      behaviour: [
        ["walking", 0.5],
        ["arpeggio", 0.5],
      ],
      onsets: grid("x..x..x.x.x..x.x"),
      walk: { chordToneOnOne: 1, chromaticApproach: 0.5 },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        shaker: role("drums"),
        chords: role("piano", "electric@clean:0.5"),
        bass: role("motown"),
        lead: role("sing"),
        pad: maybe("strings", "vibes:0.5"),
      },
    },
  }),
  card({
    id: "chicago-soul",
    summary:
      "Chicago soul: light mid-tempo backbeat, gospel-group vocal harmony, falsetto lead, Latin-tinged percussion, brassy arrangements with major-seventh colour",
    seedSalt: 1963,
    tempo: { bpm: [90, 120], typical: 104 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["turnaround", 0.5],
        ["axis", 0.5],
      ],
      sevenths: 0.6,
    },
    rhythm: { onsets: { perc: grid("..x...x...x...x.") } },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        perc: maybe("drums"),
        chords: role("electric@clean", "piano:0.6"),
        lead: role("sing"),
        counter: role("trumpet", "aah:0.6"),
      },
    },
  }),
  card({
    id: "northern-soul",
    summary:
      "Northern soul: up-tempo Motown-style stomp, four-to-the-floor snare and claps on every beat, driving eighth bass, strings and horns, major key",
    seedSalt: 1966,
    tempo: { bpm: [120, 150], typical: 134 },
    groove: { subdivision: 2, swingRatio: [1, 1.05] },
    pitch: {
      scales: [
        ["major", 0.8],
        ["minor", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["turnaround", 0.5],
        ["axis", 0.5],
      ],
      sevenths: 0.3,
    },
    rhythm: {
      onsets: {
        kick: grid("x.x.x.x."),
        snare: grid("x.x.x.x."),
        clap: grid("x.x.x.x."),
        hat: grid(".x.x.x.x"),
      },
    },
    bass: {
      behaviour: [
        ["octave", 0.5],
        ["arpeggio", 0.5],
      ],
      onsets: grid("xxxxxxxx"),
    },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "snare", "hat"], ["clap"]),
        chords: role("piano"),
        bass: role("motown"),
        lead: role("sing"),
        pad: maybe("strings", "trumpet:0.5"),
      },
    },
  }),
  card({
    id: "philly-soul",
    summary:
      "Philadelphia soul: lush string and horn orchestration, open hi-hat on the off-beat over four-on-the-floor, major-seventh and ninth chords, ii-V turnarounds",
    seedSalt: 1972,
    tempo: { bpm: [100, 125], typical: 112 },
    groove: { subdivision: 4, swingRatio: [1, 1.05] },
    pitch: {
      scales: [
        ["major", 0.7],
        ["dorian", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["ii-v-i", 0.5],
        ["turnaround", 0.5],
      ],
      sevenths: 1,
      voicing: {
        types: [
          ["open", 0.6],
          ["close", 0.4],
        ],
        notes: [4, 5],
      },
    },
    rhythm: {
      onsets: {
        kick: grid("x...x...x...x..."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
        openhat: grid("..x...x...x...x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "snare", "hat", "openhat"]),
        chords: role("electric@clean", "epiano:0.6"),
        bass: role("ebass"),
        lead: role("sing"),
        pad: role("strings"),
        counter: maybe("horn", "vibes:0.5"),
      },
    },
  }),
  card({
    id: "psychedelic-soul",
    summary:
      "psychedelic soul: long dorian one-chord vamps, wah guitar sixteenths, fuzz bass, phased drums and extended jams over the backbeat",
    seedSalt: 1969,
    tempo: { bpm: [90, 120], typical: 104 },
    groove: { subdivision: 4, swingRatio: [1, 1.1] },
    pitch: {
      scales: [
        ["dorian", 0.6],
        ["minor-pentatonic", 0.4],
      ],
    },
    harmony: { presets: [["dorian-vamp", 1]], rhythm: [[2, 1]], sevenths: 0.9 },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x..x..x...x.x...") },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("electric@wah"),
        bass: role("ebass"),
        lead: role("sing", "electric@fuzz:0.6"),
        pad: maybe("hammond"),
      },
    },
    mix: { space: 0.5, fx: { chords: { phaser: "slow" } } },
  }),
  card({
    id: "quiet-storm",
    summary:
      "quiet storm: slow late-night ballad, soft rim-click backbeat, electric-piano ninths and elevenths, fretless-style sustained bass, ii-V-I with smooth voice leading",
    seedSalt: 1976,
    tempo: { bpm: [60, 84], typical: 70 },
    groove: { subdivision: 4, swingRatio: [1, 1.15] },
    pitch: {
      scales: [
        ["major", 0.6],
        ["dorian", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["ii-v-i", 0.6],
        ["turnaround", 0.4],
      ],
      sevenths: 1,
      voicing: { types: [["open", 1]], notes: [4, 5] },
    },
    rhythm: {
      onsets: {
        kick: grid("x.........x....."),
        snare: null,
        rim: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: {
      behaviour: [
        ["root", 0.6],
        ["arpeggio", 0.4],
      ],
      onsets: grid("x.........x....."),
    },
    melody: { density: [1, 2] },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "rim", "hat"]),
        snare: null,
        chords: role("epiano"),
        bass: role("ebass"),
        lead: role("sing", "sax:0.5"),
        pad: maybe("strings"),
      },
    },
    mix: { space: 0.6 },
  }),
  card({
    id: "neo-soul",
    summary:
      "neo soul: drunk unquantised hip-hop pocket (late snare, early kick), extended ninth and eleventh chords, dorian ii-V vamps, warm Rhodes and upright-style bass",
    seedSalt: 1997,
    tempo: { bpm: [70, 98], typical: 84 },
    groove: {
      subdivision: 4,
      swingRatio: [1.2, 1.5],
      roleOffset: { snare: 0.15, kick: -0.05, hat: 0.08 },
      humanize: { timingMs: 14, velocity: 0.12 },
    },
    pitch: {
      scales: [
        ["dorian", 0.6],
        ["major", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["ii-v-i", 0.4],
        ["dorian-vamp", 0.6],
      ],
      sevenths: 1,
      voicing: {
        types: [
          ["open", 0.6],
          ["shell", 0.4],
        ],
        notes: [4, 5],
      },
    },
    rhythm: {
      onsets: {
        kick: grid("x......x..x....."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("lofi"),
        chords: role("rhodes", "wurli:0.5"),
        bass: role("ebass", "contrabass:0.4"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "uk-street-soul",
    summary:
      "UK street soul: mid-tempo programmed swingbeat, minor dorian vamps, synth pads and electric piano, dub-weighted sub bass with off-beat skank",
    seedSalt: 1989,
    tempo: { bpm: [86, 104], typical: 96 },
    groove: { subdivision: 4, swingRatio: [1.2, 1.5] },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["dorian-vamp", 0.6],
        ["aeolian", 0.4],
      ],
      sevenths: 0.8,
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x...x....."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("syn808"),
        chords: role("epiano", "keys:0.5"),
        bass: role("bass"),
        lead: role("sing"),
        pad: maybe("strings"),
      },
    },
  }),
  card({
    id: "contemporary-rnb",
    summary:
      "contemporary R&B: half-time programmed groove, rolled sixteenth and triplet hi-hats, 808 sub bass, minor-ninth loops (vi-IV-I-V) and melismatic vocal",
    seedSalt: 2010,
    tempo: { bpm: [60, 100], typical: 76 },
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
      sevenths: 0.9,
    },
    rhythm: {
      onsets: {
        kick: grid("x......x..x....."),
        snare: grid("........x......."),
        hat: grid("xxx.x.xxx.x.x.xx"),
      },
    },
    texture: {
      roles: {
        ...kitRoles("trap"),
        chords: role("epiano", "keys:0.5"),
        bass: role("bass"),
        lead: role("sing"),
        pad: maybe("strings"),
      },
    },
  }),
  card({
    id: "new-jack-swing",
    summary:
      "new jack swing: hard swung sixteenth drum-machine shuffle (swing ratio 1.6), gated snare on 2 and 4, synth brass stabs, gospel-tinged ninth chords",
    seedSalt: 1988,
    tempo: { bpm: [100, 118], typical: 108 },
    groove: { subdivision: 4, swingRatio: [1.5, 1.7] },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["dorian-vamp", 0.5],
        ["ii-v-i", 0.5],
      ],
      sevenths: 0.9,
    },
    rhythm: {
      onsets: {
        kick: grid("x..x..x...x..x.."),
        snare: grid("....x.......x..."),
        hat: grid("x.xxx.xxx.xxx.xx"),
      },
    },
    texture: {
      roles: {
        ...kitRoles("syn909"),
        chords: role("keys", "epiano:0.5"),
        bass: role("bass"),
        lead: role("sing"),
        counter: role("saw", "trumpet:0.4"),
      },
    },
  }),
  card({
    id: "hip-hop-soul",
    summary:
      "hip hop soul: boom-bap breakbeat (kick on 1 and the and-of-2, snare on 2 and 4), looped soul-chord vamp, live-feel bass, gospel vocal over hip-hop drums",
    seedSalt: 1994,
    tempo: { bpm: [84, 100], typical: 92 },
    groove: { subdivision: 4, swingRatio: [1.2, 1.5] },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["dorian", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["dorian-vamp", 0.5],
      ],
      sevenths: 0.8,
    },
    rhythm: {
      onsets: {
        kick: grid("x......x..x....."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("syn808"),
        chords: role("epiano", "piano:0.5"),
        bass: role("ebass", "bass:0.5"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "alternative-rnb",
    summary:
      "alternative R&B: sparse half-time beats with wide space, detuned pads, modal minor and lydian colour, sub bass and reverb-washed vocal",
    seedSalt: 2012,
    tempo: { bpm: [60, 90], typical: 72 },
    pitch: {
      scales: [
        ["minor", 0.4],
        ["dorian", 0.3],
        ["lydian", 0.3],
      ],
    },
    harmony: {
      model: "modal",
      presets: null,
      rhythm: [[2, 1]],
      sevenths: 1,
    },
    rhythm: {
      onsets: {
        kick: grid("x.........x....."),
        snare: grid("........x......."),
        hat: grid("x...x.x.x...x.xx"),
      },
    },
    melody: { density: [1, 2] },
    texture: {
      roles: {
        ...kitRoles("trap"),
        chords: role("keys", "epiano:0.5"),
        bass: role("bass"),
        lead: role("sing"),
        pad: role("strings", "saw:0.5"),
      },
    },
    mix: { space: 0.7 },
  }),
  card({
    id: "classic-funk",
    summary:
      "classic funk: emphasis on the one, interlocking sixteenth-note scratch guitar, ghosted snare, dominant ninth one-chord vamp, horn stabs, syncopated bass anchoring beat 1",
    seedSalt: 1967,
    tempo: { bpm: [96, 120], typical: 108 },
    harmony: { presets: null, rhythm: [[4, 1]] },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x.....x."),
        snare: grid("....x..1.1..x..1"),
        hat: grid("xxxxxxxxxxxxxxxx"),
        chords: grid(".x.x.xx..x.x.xx."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("funk"),
        bass: role("ebass"),
        lead: role("sing", "sax:0.5"),
        counter: maybe("trumpet", "sax:0.6"),
      },
    },
  }),
  card({
    id: "p-funk",
    summary:
      "P-Funk: slower heavy on-the-one groove, synth bass and Moog leads, layered chant vocals, mixolydian and dorian vamps, cosmic synth textures",
    seedSalt: 1975,
    tempo: { bpm: [90, 110], typical: 100 },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("clav", "funk:0.6"),
        bass: role("bass", "ebass:0.4"),
        lead: role("lead", "saw:0.6"),
        pad: maybe("choir", "strings:0.5"),
      },
    },
  }),
  card({
    id: "bayou-funk",
    summary:
      "New Orleans funk: second-line syncopation, kick and snare displaced off the grid around a tresillo, open loose sixteenths, clavinet and organ",
    seedSalt: 1969,
    tempo: { bpm: [90, 112], typical: 100 },
    groove: { swingRatio: [1.15, 1.35] },
    rhythm: {
      onsets: {
        kick: grid("x..x..x...x..x.."),
        snare: grid("...x..1..1..x..."),
        hat: grid("x.xxx.xxx.xxx.xx"),
      },
    },
    bass: { onsets: TRESILLO },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("clav", "hammond:0.6"),
        bass: role("ebass"),
        lead: role("electric@clean", "hammond:0.5"),
      },
    },
  }),
  card({
    id: "go-go",
    summary:
      "go-go: the pocket beat with congas and cowbell in a swung sixteenth, kick-snare figure with the bell on 1 and the and-of-2, call and response over one-chord vamps",
    seedSalt: 1978,
    tempo: { bpm: [92, 112], typical: 100 },
    groove: { swingRatio: [1.3, 1.6] },
    rhythm: {
      onsets: {
        kick: grid("x..x......x....."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
        bell: grid("x..x...x..x.x..."),
        perc: grid("x.xx..x.x.xx..x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        bell: role("bell"),
        perc: role("drums"),
        chords: role("keys", "funk:0.5"),
        bass: role("ebass"),
        lead: role("sing", "trumpet:0.5"),
      },
    },
  }),
  card({
    id: "minneapolis-sound",
    summary:
      "Minneapolis sound: LinnDrum-style straight sixteenth machine groove, synth stabs replacing horns, clipped funk guitar, mixolydian vamps",
    seedSalt: 1981,
    tempo: { bpm: [110, 130], typical: 120 },
    groove: { swingRatio: [1, 1.05] },
    rhythm: {
      onsets: {
        kick: grid("x.....x...x....."),
        snare: grid("....x.......x..."),
        hat: grid("xxxxxxxxxxxxxxxx"),
        clap: grid("....x.......x..."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("electro", ["kick", "snare", "hat", "clap"]),
        chords: role("saw", "funk:0.6"),
        bass: role("bass"),
        lead: role("sing", "lead:0.5"),
        counter: maybe("square", "saw:0.5"),
      },
    },
  }),
  card({
    id: "boogie",
    summary:
      "boogie (post-disco): mid-tempo four-on-the-floor slowed to a funk pocket, synth bass octaves, ninth and eleventh chords, ii-V cycles, clap backbeat",
    seedSalt: 1982,
    tempo: { bpm: [104, 122], typical: 112 },
    groove: { swingRatio: [1, 1.1] },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["ii-v-i", 0.5],
        ["dorian-vamp", 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        kick: grid("x...x...x...x..."),
        snare: grid("....x.......x..."),
        clap: grid("....x.......x..."),
        hat: grid("..x...x...x...x."),
      },
    },
    bass: {
      behaviour: [
        ["octave", 0.6],
        ["ostinato", 0.4],
      ],
      onsets: grid("x.xx..x.x.xx..x."),
    },
    texture: {
      roles: {
        ...kitRoles("syn808", ["kick", "snare", "hat", "clap"]),
        chords: role("epiano", "keys:0.5"),
        bass: role("bass"),
        lead: role("sing"),
        pad: maybe("strings", "saw:0.5"),
      },
    },
  }),
  card({
    id: "free-funk",
    summary:
      "free funk: harmolodic funk with free-jazz soloing over tight sixteenth grooves, odd accents, unison lines that drift, few or no fixed chord changes",
    seedSalt: 1977,
    tempo: { bpm: [100, 140], typical: 120 },
    harmony: { model: "modal", presets: null, rhythm: [[4, 1]] },
    melody: {
      density: [3, 4],
      intervals: intervals(4, 2, 1.5, 1.2),
      chordToneRate: 0.3,
    },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("electric@crunch"),
        bass: role("ebass"),
        lead: role("sax", "trumpet:0.5"),
        counter: maybe("electric@clean"),
      },
    },
  }),
  card({
    id: "funk-band",
    summary:
      "big-band and soul revue funk: full horn section riffing in unison on the one, stop-time hits, tight sixteenth rhythm section, dominant ninth vamps",
    seedSalt: 1970,
    tempo: { bpm: [100, 126], typical: 112 },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("funk", "hammond:0.5"),
        bass: role("ebass"),
        lead: role("trumpet", "sax:0.8", "sing:0.6"),
        counter: role("trombone", "barisax:0.6"),
      },
    },
  }),
  // -------------------------------------------------------------------------
  // Gospel and sacred leaves. References: Horace Clarence Boyer, "How Sweet
  // the Sound: The Golden Age of Gospel" (1995); Eileen Southern, "The Music
  // of Black Americans" (3rd ed., 1997).
  card({
    id: "traditional-gospel",
    summary:
      "traditional black gospel: 12/8 slow shout or swung 4/4, plagal IV-I amens, passing diminished chords, Hammond and piano, lead vocal with choir call and response",
    seedSalt: 1940,
    tempo: { bpm: [60, 140], typical: 84 },
    meter: {
      signatures: [
        ["12/8", 0.5],
        ["4/4", 0.5],
      ],
      hypermeter: [[4, 1]],
    },
    groove: { swingRatio: [1.7, 2.1] },
    pitch: {
      scales: [
        ["major", 0.7],
        ["major-blues", 0.3],
      ],
    },
    harmony: {
      chain: {
        I: [
          ["IV", 2],
          ["V7/IV", 1.5],
          ["vi", 1],
        ],
        "V7/IV": [["IV", 3]],
        IV: [
          ["#ivo7", 1.5],
          ["I", 2],
          ["V7", 1],
        ],
        "#ivo7": [["I", 3]],
        vi: [
          ["ii", 2],
          ["IV", 1],
        ],
        ii: [["V7", 3]],
        V7: [["I", 3]],
      },
      presets: null,
      sources: { chain: 1 },
      cadences: [
        ["IV-I", 0.6],
        ["V-I", 0.4],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x...x..."),
        snare: grid("..x...x."),
        clap: grid("..x...x."),
        hat: grid("x.x.x.x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "snare", "hat"], ["clap"]),
        chords: role("gospel", "piano:0.6"),
        bass: role("ebass", "hammond:0.4"),
        lead: role("sing"),
        counter: role("choir"),
      },
    },
  }),
  card({
    id: "gospel-quartet",
    summary:
      "gospel quartet: four-part male close harmony, syncopated jubilee bass voice on every beat, minimal guitar, I-IV-V with secondary dominants, call and response lead",
    seedSalt: 1937,
    tempo: { bpm: [80, 150], typical: 112 },
    groove: { swingRatio: [1.5, 1.9] },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["turnaround", 0.5],
        ["fifties", 0.5],
      ],
      sevenths: 0.5,
    },
    bass: {
      behaviour: [
        ["root-fifth", 0.6],
        ["walking", 0.4],
      ],
      onsets: grid("x.x.x.x."),
    },
    texture: {
      roles: {
        kick: null,
        snare: null,
        hat: null,
        clap: maybe("drums"),
        chords: role("aah", "electric@clean:0.4"),
        bass: role("aah", "contrabass:0.5"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "urban-gospel",
    summary:
      "urban contemporary gospel: R&B production, ii-V-I and IV-iii-ii-I chromatic walk-downs, ninth and eleventh chords, half-time drums and choir stabs, shout vamp sections",
    seedSalt: 1993,
    tempo: { bpm: [70, 130], typical: 96 },
    groove: { subdivision: 4, swingRatio: [1.1, 1.4] },
    pitch: {
      scales: [
        ["major", 0.6],
        ["dorian", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["ii-v-i", 0.5],
        ["turnaround", 0.5],
      ],
      sevenths: 1,
      voicing: {
        types: [
          ["open", 0.6],
          ["close", 0.4],
        ],
        notes: [4, 5],
      },
    },
    rhythm: {
      onsets: {
        kick: grid("x......x..x....."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("syn808"),
        chords: role("gospel", "epiano:0.5"),
        bass: role("bass", "ebass:0.5"),
        lead: role("sing"),
        counter: role("choir"),
      },
    },
  }),
  card({
    id: "southern-gospel",
    summary:
      "Southern gospel: white quartet with tenor-lead-baritone-bass stacked harmony, piano-driven country two-beat, I-IV-V and the half-step lift key change",
    seedSalt: 1950,
    tempo: { bpm: [80, 140], typical: 108 },
    groove: { swingRatio: [1, 1.5] },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["turnaround", 0.5],
      ],
      sevenths: 0.2,
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x...") },
    rhythm: {
      onsets: { kick: grid("x...x..."), snare: grid("..x...x."), hat: null },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "snare"]),
        hat: null,
        chords: role("piano"),
        bass: role("ebass", "contrabass:0.5"),
        lead: role("sing"),
        counter: role("aah"),
      },
    },
  }),
  card({
    id: "spirituals",
    summary:
      "spirituals: unaccompanied pentatonic melody, call and response, ring-shout handclap and foot-stomp timeline, slow ballad or shout, plagal colour",
    seedSalt: 1867,
    tempo: { bpm: [56, 120], typical: 72 },
    groove: { swingRatio: [1.3, 1.9] },
    pitch: {
      scales: [
        ["major-pentatonic", 0.6],
        ["minor-pentatonic", 0.4],
      ],
    },
    harmony: {
      presets: [["fifties", 1]],
      sevenths: 0,
      cadences: [["IV-I", 1]],
    },
    rhythm: {
      onsets: {
        kick: grid("x...x..."),
        clap: grid("..x...x."),
        snare: null,
        hat: null,
      },
    },
    melody: { chordToneRate: 0.6, repetition: 0.7, density: [1, 2] },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick"], ["clap"]),
        snare: null,
        hat: null,
        chords: role("aah"),
        bass: maybe("aah"),
        lead: role("sing"),
        counter: maybe("choir"),
      },
    },
  }),
  card({
    id: "ccm",
    summary:
      "contemporary Christian music: pop-rock song form, I-V-vi-IV loops, straight eighths backbeat, verse-chorus-bridge with a lifted final chorus",
    seedSalt: 1985,
    tempo: { bpm: [72, 132], typical: 100 },
    groove: { subdivision: 4, swingRatio: [1, 1.05] },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["sad-pop", 0.3],
        ["canon", 0.2],
      ],
      sevenths: 0.1,
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x.x....."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("acoustic", "piano:0.6"),
        bass: role("ebass"),
        lead: role("sing"),
        counter: maybe("electric@clean"),
      },
    },
    form: {
      plans: [[["verse", "chorus", "verse", "chorus", "bridge", "chorus"], 1]],
    },
  }),
  card({
    id: "worship",
    summary:
      "praise and worship: slow-build anthem on I-V-vi-IV, sustained pads, dotted-eighth delay guitar, tom-driven build into a congregational chorus",
    seedSalt: 2000,
    tempo: { bpm: [64, 80], typical: 72 },
    groove: { subdivision: 4, swingRatio: [1, 1.05] },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["sad-pop", 0.5],
      ],
      sevenths: 0,
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("........x......."),
        tom: grid("x..x..x...x..x.."),
        hat: null,
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "snare"], ["tom"]),
        hat: null,
        chords: role("piano", "acoustic:0.6"),
        bass: role("ebass"),
        lead: role("sing"),
        pad: role("strings", "saw:0.4"),
        counter: maybe("electric@clean"),
      },
    },
    mix: { space: 0.6, fx: { counter: { chorus: "wide" } } },
    form: {
      plans: [
        [["intro", "verse", "chorus", "verse", "chorus", "build", "chorus"], 1],
      ],
    },
  }),
  // -------------------------------------------------------------------------
  // Country leaves. References: Bill C. Malone, "Country Music, U.S.A." (3rd
  // ed., 2010); Neil V. Rosenberg, "Bluegrass: A History" (1985).
  card({
    id: "old-time",
    summary:
      "old-time string band: fiddle tune AABB strains in 2/4, droning double stops, clawhammer banjo bum-ditty, I-IV-V and mixolydian or dorian modal tunes",
    seedSalt: 1925,
    meter: {
      signatures: [
        ["2/4", 0.6],
        ["4/4", 0.4],
      ],
      hypermeter: [[8, 1]],
    },
    tempo: { bpm: [100, 140], typical: 120 },
    groove: { subdivision: 4, swingRatio: [1, 1.15] },
    pitch: {
      scales: [
        ["major", 0.5],
        ["mixolydian", 0.3],
        ["dorian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["mixolydian-rock", 0.5],
        ["fifties", 0.5],
      ],
      sevenths: 0,
    },
    rhythm: { onsets: { kick: null, snare: null, chords: grid("x.xxx.xx") } },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x...") },
    melody: {
      density: [3, 4],
      intervals: intervals(7, 2, 0.6, 0.6),
      repetition: 0.7,
    },
    texture: {
      roles: {
        kick: null,
        snare: null,
        bass: maybe("contrabass", "steel:0.4"),
        chords: role("banjo"),
        lead: role("fiddle"),
      },
    },
    form: { archetype: "AABB" },
  }),
  card({
    id: "bluegrass",
    summary:
      "bluegrass: fast cut-time with mandolin chop on the backbeat, Scruggs three-finger banjo rolls in sixteenths, upright bass root-fifth on 1 and 3, G-run turnarounds, high lonesome harmony",
    seedSalt: 1946,
    tempo: { bpm: [140, 200], typical: 168 },
    groove: { subdivision: 4, swingRatio: [1, 1.1] },
    pitch: {
      scales: [
        ["major", 0.8],
        ["mixolydian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.4],
        ["mixolydian-rock", 0.6],
      ],
      sevenths: 0.1,
    },
    rhythm: {
      onsets: {
        kick: null,
        snare: null,
        hat: null,
        chords: grid("....x.......x..."),
        arp: grid("xxxxxxxxxxxxxxxx"),
      },
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x.......x.......") },
    melody: { density: [3, 4] },
    texture: {
      roles: {
        kick: null,
        snare: null,
        hat: null,
        bass: role("contrabass"),
        chords: role("steel"),
        arp: role("banjo"),
        lead: role("fiddle", "sing:0.6"),
      },
    },
  }),
  card({
    id: "progressive-bluegrass",
    summary:
      "progressive bluegrass (newgrass): bluegrass instrumentation with jazz and rock harmony, seventh and suspended chords, modal vamps, odd-meter and extended improvisations",
    seedSalt: 1972,
    meter: {
      signatures: [
        ["4/4", 0.8],
        ["7/8", 0.2],
      ],
      hypermeter: [[4, 1]],
    },
    tempo: { bpm: [110, 180], typical: 140 },
    groove: { subdivision: 4, swingRatio: [1, 1.15] },
    pitch: {
      scales: [
        ["major", 0.4],
        ["dorian", 0.3],
        ["lydian", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["ii-v-i", 0.4],
        ["axis", 0.3],
        ["mixolydian-rock", 0.3],
      ],
      sevenths: 0.6,
    },
    rhythm: {
      onsets: {
        kick: null,
        snare: null,
        hat: null,
        arp: grid("xxxxxxxxxxxxxxxx"),
      },
    },
    texture: {
      roles: {
        kick: null,
        snare: null,
        hat: null,
        bass: role("contrabass"),
        chords: role("steel"),
        arp: maybe("banjo"),
        lead: role("fiddle", "steel:0.6"),
      },
    },
  }),
  card({
    id: "western-swing",
    summary:
      "western swing: jazz swing feel (ratio 1.7) on a two-beat country bass, steel guitar and twin fiddles, sixth and dominant seventh chords, ii-V turnarounds",
    seedSalt: 1936,
    tempo: { bpm: [120, 200], typical: 160 },
    groove: { subdivision: 2, swingRatio: [1.6, 1.9] },
    harmony: {
      presets: [
        ["turnaround", 0.5],
        ["ii-v-i", 0.3],
        ["fifties", 0.2],
      ],
      sevenths: 0.8,
    },
    rhythm: {
      onsets: {
        kick: grid("x...x..."),
        snare: grid("..x...x."),
        hat: grid("..x...x."),
      },
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
        ...kitRoles("acoustic"),
        bass: role("contrabass"),
        chords: role("electric@clean", "piano:0.6"),
        lead: role("fiddle", "electric@glide:0.6"),
        counter: maybe("fiddle", "trumpet:0.4"),
      },
    },
  }),
  card({
    id: "honky-tonk",
    summary:
      "honky-tonk: shuffle two-beat with brush snare on 2 and 4, alternating root-fifth bass, crying pedal-steel fills, simple I-IV-V, plain-spoken strophic verses",
    seedSalt: 1950,
    tempo: { bpm: [90, 150], typical: 116 },
    groove: { subdivision: 2, swingRatio: [1.3, 1.7] },
    harmony: {
      presets: [
        ["fifties", 0.4],
        ["mixolydian-rock", 0.6],
      ],
      sevenths: 0.2,
    },
    rhythm: { onsets: { kick: grid("x...x..."), snare: grid("..x...x.") } },
    bass: { onsets: grid("x...x...") },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "snare"]),
        chords: role("acoustic", "honkytonk:0.6"),
        lead: role("sing", "fiddle:0.6"),
        counter: role("electric@glide", "fiddle:0.4"),
      },
    },
  }),
  card({
    id: "nashville-sound",
    summary:
      "Nashville sound: smooth countrypolitan ballads, string section and background vocal pads replacing fiddle and steel, slip-note piano, I-vi-IV-V",
    seedSalt: 1958,
    tempo: { bpm: [70, 120], typical: 92 },
    groove: { swingRatio: [1, 1.3] },
    harmony: {
      presets: [
        ["fifties", 0.6],
        ["turnaround", 0.4],
      ],
      sevenths: 0.3,
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("....x.......x..."),
        hat: null,
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "snare"]),
        chords: role("piano"),
        bass: role("ebass", "contrabass:0.4"),
        lead: role("sing"),
        pad: role("strings", "ooh:0.6"),
      },
    },
  }),
  card({
    id: "bakersfield",
    summary:
      "Bakersfield sound: bright twangy Telecaster lead, driving straight-eighth train beat, root-fifth bass, raw I-IV-V honky-tonk harmony, electric pedal steel",
    seedSalt: 1963,
    harmony: {
      presets: [
        ["fifties", 0.4],
        ["mixolydian-rock", 0.6],
      ],
    },
    tempo: { bpm: [120, 170], typical: 144 },
    groove: { subdivision: 2, swingRatio: [1, 1.15] },
    rhythm: {
      onsets: {
        kick: grid("x...x..."),
        snare: grid("..x...x."),
        hat: grid("xxxxxxxx"),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("electric@clean", "acoustic:0.4"),
        lead: role("electric@clean", "electric@glide:0.5"),
      },
    },
    mix: { fx: { lead: { tremolo: "gentle" } } },
  }),
  card({
    id: "outlaw-country",
    summary:
      "outlaw country: stripped-down rock-leaning band, loose mid-tempo backbeat, mixolydian bVII colour, blues-inflected leads, unpolished vocals",
    seedSalt: 1973,
    tempo: { bpm: [80, 140], typical: 108 },
    pitch: {
      scales: [
        ["mixolydian", 0.6],
        ["major", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["mixolydian-rock", 0.7],
        ["fifties", 0.3],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("acoustic", "electric@crunch:0.5"),
        bass: role("ebass"),
        lead: role("sing", "electric@crunch:0.5"),
      },
    },
  }),
  card({
    id: "cowboy-western",
    summary:
      "cowboy and western song: loping horse-gait two-beat (clip-clop woodblock), close vocal-trio harmony, yodel leaps of a sixth and octave, simple I-IV-V waltzes and ballads",
    seedSalt: 1935,
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["3/4", 0.4],
      ],
      hypermeter: [[4, 1]],
    },
    tempo: { bpm: [80, 130], typical: 100 },
    groove: { subdivision: 2, swingRatio: [1.2, 1.5] },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["turnaround", 0.5],
      ],
      sevenths: 0.2,
    },
    rhythm: {
      onsets: { kick: null, snare: null, hat: null, rim: grid("x.x.x.x.") },
    },
    melody: { intervals: intervals(4, 3, 1.4, 0.4), ambitus: [9, 16] },
    texture: {
      roles: {
        kick: null,
        snare: null,
        hat: null,
        rim: role("drums"),
        bass: role("contrabass"),
        chords: role("acoustic"),
        lead: role("sing", "fiddle:0.4"),
        pad: maybe("aah"),
      },
    },
  }),
  card({
    id: "country-pop",
    summary:
      "country pop: pop song form with country instrumentation, I-V-vi-IV loops, straight sixteenth groove, big lifted choruses, acoustic strum plus steel and fiddle colour",
    seedSalt: 2000,
    tempo: { bpm: [80, 130], typical: 104 },
    groove: { subdivision: 4, swingRatio: [1, 1.05] },
    harmony: {
      presets: [
        ["axis", 0.6],
        ["sad-pop", 0.2],
        ["fifties", 0.2],
      ],
      sevenths: 0,
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x.x....."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("acoustic"),
        bass: role("ebass"),
        lead: role("sing"),
        counter: maybe("fiddle", "electric@glide:0.6"),
      },
    },
    form: {
      plans: [[["verse", "chorus", "verse", "chorus", "bridge", "chorus"], 1]],
    },
  }),
  card({
    id: "alt-country",
    summary:
      "alt-country: punk and indie energy on country forms, ragged mixolydian rock chords, twangy reverb guitar, unadorned backbeat, minor-key ballads",
    seedSalt: 1990,
    tempo: { bpm: [80, 150], typical: 112 },
    pitch: {
      scales: [
        ["major", 0.4],
        ["mixolydian", 0.3],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["mixolydian-rock", 0.5],
        ["aeolian", 0.2],
        ["axis", 0.3],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("ragged", "acoustic:0.5"),
        bass: role("ebass"),
        lead: role("sing", "electric@crunch:0.5"),
      },
    },
  }),
  card({
    id: "texas-red-dirt",
    summary:
      "Texas country and red dirt: dance-hall two-step shuffle, fiddle and steel answering the vocal, loose roadhouse rock backbeat, I-IV-V with bVII",
    seedSalt: 1995,
    tempo: { bpm: [100, 150], typical: 124 },
    groove: { subdivision: 2, swingRatio: [1.2, 1.5] },
    harmony: {
      presets: [
        ["mixolydian-rock", 0.6],
        ["fifties", 0.4],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x...x..."),
        snare: grid("..x...x."),
        hat: grid("x.x.x.x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic"),
        chords: role("acoustic", "electric@clean:0.5"),
        bass: role("ebass"),
        lead: role("sing", "fiddle:0.6"),
        counter: role("fiddle", "electric@glide:0.6"),
      },
    },
  }),
  // -------------------------------------------------------------------------
  // North American folk leaves. References: Alan Lomax, "The Folk Songs of
  // North America" (1960); Barry Jean Ancelet, "Cajun and Creole Music
  // Makers" (1999); Jean-Jacques Nattiez, "Inuit Vocal Games" (1983).
  card({
    id: "appalachian",
    summary:
      "Appalachian ballad: gapped pentatonic and hexatonic modal melody (dorian, mixolydian, aeolian), unmetered-feeling strophic ballad, dulcimer drone on tonic and fifth",
    seedSalt: 1916,
    meter: {
      signatures: [
        ["3/4", 0.4],
        ["4/4", 0.6],
      ],
      hypermeter: [[4, 1]],
    },
    tempo: { bpm: [60, 110], typical: 80 },
    pitch: {
      scales: [
        ["dorian", 0.3],
        ["mixolydian", 0.3],
        ["minor", 0.2],
        ["major-pentatonic", 0.2],
      ],
    },
    harmony: { model: "drone", presets: null, rhythm: [[1, 1]], sevenths: 0 },
    melody: {
      density: [1, 2],
      repetition: 0.6,
      contour: [
        ["arch", 0.6],
        ["descending", 0.4],
      ],
    },
    texture: {
      roles: {
        chords: null,
        bass: null,
        drone: role("dulcimer"),
        lead: role("sing", "fiddle:0.4"),
      },
    },
  }),
  card({
    id: "sacred-harp",
    summary:
      "Sacred Harp shape-note singing: four-part dispersed harmony in open fifths and fourths, modal minor tunes, tenor-carried melody, square-beat 4/4 and 3/2, fuging entries, unaccompanied",
    seedSalt: 1844,
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["3/4", 0.4],
      ],
      hypermeter: [[4, 1]],
    },
    tempo: { bpm: [80, 130], typical: 104 },
    groove: { subdivision: 2, swingRatio: [1, 1] },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["major", 0.3],
        ["dorian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["fifties", 0.5],
      ],
      sevenths: 0,
      voicing: {
        types: [
          ["power", 0.5],
          ["open", 0.5],
        ],
      },
      cadences: [
        ["V-I", 0.5],
        ["IV-I", 0.5],
      ],
    },
    rhythm: { onsets: { chords: grid("x.x.x.x.") } },
    bass: { behaviour: [["root", 1]], onsets: grid("x.x.x.x.") },
    texture: {
      roles: {
        chords: role("chorale"),
        bass: role("aah"),
        lead: role("choir"),
        counter: role("aah"),
      },
    },
    form: { plans: [[["verse", "verse", "chorus", "chorus"], 1]] },
  }),
  card({
    id: "american-folk-revival",
    summary:
      "American folk revival: Travis-picked alternating-bass acoustic guitar, protest and topical strophic songs, I-IV-V and I-vi-IV-V, harmonica breaks, unison group chorus",
    seedSalt: 1962,
    tempo: { bpm: [80, 140], typical: 104 },
    groove: { subdivision: 4, swingRatio: [1, 1.15] },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["mixolydian-rock", 0.5],
      ],
    },
    rhythm: { onsets: { arp: grid("x.x.x.x.x.x.x.x.") } },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x...x...x...") },
    texture: {
      roles: {
        bass: role("steel"),
        chords: role("steel"),
        arp: role("steel"),
        lead: role("sing"),
        counter: maybe("reeds", "banjo:0.5"),
      },
    },
  }),
  card({
    id: "singer-songwriter",
    summary:
      "singer-songwriter: intimate fingerpicked guitar or piano, sus2 and add9 colour, I-V-vi-IV and vi-IV-I-V, verse-chorus-bridge with confessional melody close to speech rhythm",
    seedSalt: 1971,
    tempo: { bpm: [64, 120], typical: 88 },
    groove: { subdivision: 4, swingRatio: [1, 1.1] },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.4],
        ["sad-pop", 0.3],
        ["canon", 0.3],
      ],
      sevenths: 0.2,
    },
    rhythm: { onsets: { arp: grid("x.x.x.x.x.x.x.x.") } },
    melody: { intervals: intervals(7, 2, 0.5, 1.2), density: [2, 2] },
    texture: {
      roles: {
        bass: maybe("steel"),
        chords: role("steel", "piano:0.6"),
        arp: role("steel", "piano:0.4"),
        lead: role("sing"),
      },
    },
    form: {
      plans: [[["verse", "chorus", "verse", "chorus", "bridge", "chorus"], 1]],
      archetype: "verse-chorus",
    },
  }),
  card({
    id: "contemporary-folk",
    summary:
      "contemporary and indie folk: stomp-and-clap four-on-the-floor kick, banjo and acoustic strum, gang-vocal choruses, I-IV-vi-V, building dynamics",
    seedSalt: 2010,
    tempo: { bpm: [80, 130], typical: 112 },
    groove: { subdivision: 4, swingRatio: [1, 1.1] },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["canon", 0.5],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x...x...x...x..."),
        clap: grid("....x.......x..."),
        snare: null,
        hat: null,
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "clap"]),
        snare: null,
        hat: null,
        bass: maybe("contrabass"),
        chords: role("acoustic", "banjo:0.5"),
        lead: role("sing"),
        counter: maybe("choir"),
      },
    },
  }),
  card({
    id: "cajun",
    summary:
      "Cajun: diatonic accordion and twin fiddles, two-step (2/4 boom-chick) and 3/4 waltz, I-V alternation in major, triangle on every eighth, high-pitched declamatory vocal",
    seedSalt: 1928,
    meter: {
      signatures: [
        ["2/4", 0.5],
        ["3/4", 0.5],
      ],
      hypermeter: [[8, 1]],
    },
    tempo: { bpm: [100, 170], typical: 136 },
    groove: { subdivision: 2, swingRatio: [1.1, 1.4] },
    pitch: { scales: [["major", 1]] },
    harmony: {
      chain: {
        I: [
          ["V7", 3],
          ["IV", 1],
        ],
        V7: [["I", 3]],
        IV: [
          ["I", 2],
          ["V7", 1],
        ],
      },
      presets: null,
      sources: { chain: 1 },
      sevenths: 0,
    },
    rhythm: { onsets: { kick: null, snare: null, hat: grid("xx") } },
    bass: { behaviour: [["root-fifth", 1]] },
    texture: {
      roles: {
        kick: null,
        snare: null,
        hat: role("drums"),
        bass: maybe("contrabass"),
        chords: role("reeds", "steel:0.5"),
        lead: role("fiddle", "reeds:0.6"),
        counter: maybe("fiddle"),
      },
    },
  }),
  card({
    id: "zydeco",
    summary:
      "zydeco: Creole accordion over a syncopated R&B backbeat, rubboard (frottoir) scraping straight sixteenths, blues-scale riffs, I-IV-V and one-chord vamps",
    seedSalt: 1955,
    tempo: { bpm: [110, 160], typical: 132 },
    groove: { subdivision: 4, swingRatio: [1.1, 1.3] },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["major-blues", 0.5],
      ],
    },
    harmony: {
      forms: [[BLUES_FORM, 0.5]],
      presets: [["mixolydian-rock", 1]],
      sources: { forms: 1, presets: 1 },
      sevenths: 0.6,
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x......."),
        snare: grid("....x.......x..."),
        shaker: grid("xxxxxxxxxxxxxxxx"),
        hat: null,
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "snare"]),
        hat: null,
        shaker: role("drums"),
        bass: role("ebass"),
        chords: role("reeds", "electric@clean:0.5"),
        lead: role("reeds", "sing:0.5"),
      },
    },
  }),
  card({
    id: "swamp-pop",
    summary:
      "swamp pop: slow 12/8 triplet ballad, pounded piano triplets, I-vi-IV-V doo-wop changes, tenor sax break, emotional falsetto-edged vocal",
    seedSalt: 1958,
    meter: { signatures: [["12/8", 1]], hypermeter: [[4, 1]] },
    tempo: { bpm: [56, 80], typical: 66 },
    groove: { subdivision: 2, swingRatio: [1.9, 2.1] },
    pitch: { scales: [["major", 1]] },
    harmony: { presets: [["fifties", 1]], sevenths: 0.2 },
    rhythm: {
      onsets: {
        kick: grid("x...x..."),
        snare: grid("..x...x."),
        hat: null,
        chords: grid("xxxxxxxx"),
      },
    },
    bass: { behaviour: [["arpeggio", 1]] },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "snare"]),
        hat: null,
        bass: role("ebass", "contrabass:0.5"),
        chords: role("piano", "honkytonk:0.5"),
        lead: role("sing"),
        counter: maybe("sax"),
      },
    },
  }),
  card({
    id: "native-american",
    summary:
      "powwow and Native American song: unison big-drum straight pulse with honor-beat accents, terraced descending pentatonic melody on vocables starting high, no chordal harmony",
    seedSalt: 1880,
    meter: { signatures: [["4/4", 1]], hypermeter: [[4, 1]] },
    tempo: { bpm: [90, 150], typical: 120 },
    groove: { subdivision: 2, swingRatio: [1, 1.1] },
    pitch: {
      scales: [
        ["minor-pentatonic", 0.7],
        ["major-pentatonic", 0.3],
      ],
    },
    harmony: { model: "none", presets: null, sevenths: 0 },
    rhythm: {
      onsets: {
        kick: grid("x.x.x.x."),
        snare: null,
        hat: null,
        perc: grid("x.x.x.x."),
      },
    },
    melody: {
      contour: [
        ["terraced", 0.6],
        ["descending", 0.4],
      ],
      intervals: intervals(2, 4, 1.4, 1),
      chordToneRate: 0,
      ambitus: [10, 17],
      density: [1, 2],
    },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick"]),
        snare: null,
        hat: null,
        perc: maybe("framedrum"),
        chords: null,
        bass: null,
        lead: role("sing", "flute:0.3"),
      },
    },
  }),
  card({
    id: "inuit-throat",
    summary:
      "Inuit katajjaq: two-voice throat-singing game, short motifs repeated in a fixed cycle, interlocking hocket on alternating pulses (voiced and breathed), narrow range, no harmony",
    seedSalt: 1950,
    meter: { signatures: [["4/4", 1]], hypermeter: [[2, 1]] },
    tempo: { bpm: [110, 160], typical: 132 },
    groove: { subdivision: 2, swingRatio: [1, 1] },
    pitch: {
      scales: [
        ["minor-pentatonic", 0.6],
        ["major-pentatonic", 0.4],
      ],
    },
    harmony: { model: "none", presets: null, sevenths: 0 },
    rhythm: {
      onsets: {
        kick: null,
        snare: null,
        hat: null,
        lead: grid("x.x.x.x."),
        counter: grid(".x.x.x.x"),
      },
      locks: [{ kind: "avoid", a: "lead", b: "counter" }],
    },
    melody: {
      ambitus: [3, 7],
      intervals: intervals(2, 3, 0.2, 2),
      repetition: 0.9,
      density: [2, 2],
      contour: [
        ["wave", 0.6],
        ["flat", 0.4],
      ],
      phraseBars: [[1, 1]],
    },
    texture: {
      roles: {
        kick: null,
        snare: null,
        hat: null,
        chords: null,
        bass: null,
        lead: role("kargyraa", "sing:0.5"),
        counter: role("kargyraa", "sing:0.5"),
      },
    },
  }),
  card({
    id: "sea-shanty",
    summary:
      "sea shanty: work-song call and response (shantyman solo, crew chorus), stamped downbeats for hauling, 6/8 or 2/4, plain major and dorian tunes, unaccompanied or concertina",
    seedSalt: 1850,
    meter: {
      signatures: [
        ["6/8", 0.5],
        ["4/4", 0.5],
      ],
      hypermeter: [[4, 1]],
    },
    tempo: { bpm: [80, 120], typical: 100 },
    groove: { subdivision: 2, swingRatio: [1, 1.5] },
    pitch: {
      scales: [
        ["major", 0.5],
        ["dorian", 0.3],
        ["minor", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.4],
        ["aeolian", 0.3],
        ["mixolydian-rock", 0.3],
      ],
      sevenths: 0,
    },
    rhythm: { onsets: { kick: grid("x......."), snare: null, hat: null } },
    melody: { repetition: 0.7, density: [1, 2] },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick"]),
        snare: null,
        hat: null,
        bass: null,
        chords: maybe("reeds"),
        lead: role("sing"),
        counter: role("choir"),
      },
    },
    form: {
      plans: [[["verse", "chorus", "verse", "chorus", "verse", "chorus"], 1]],
      archetype: "call-and-response",
    },
  }),
  card({
    id: "barbershop",
    summary:
      "barbershop: unaccompanied four-part close harmony with melody in the lead (second voice), barbershop dominant sevenths around the circle of fifths (III7-VI7-II7-V7-I), ringing tags",
    seedSalt: 1905,
    tempo: { bpm: [60, 120], typical: 84 },
    groove: { subdivision: 2, swingRatio: [1, 1.4] },
    pitch: { scales: [["major", 1]] },
    harmony: {
      chain: {
        I: [
          ["III7", 2],
          ["VI7", 2],
          ["IV", 1],
        ],
        III7: [["VI7", 3]],
        VI7: [["II7", 3]],
        II7: [["V7", 3]],
        IV: [
          ["#ivo7", 1],
          ["I", 1],
        ],
        "#ivo7": [
          ["I", 1],
          ["V7", 1],
        ],
        V7: [["I", 3]],
      },
      presets: null,
      sources: { chain: 1 },
      sevenths: 0.8,
      voicing: { types: [["close", 1]], notes: [4, 4] },
      cadences: [["V-I", 1]],
    },
    rhythm: { onsets: { chords: grid("x...x...") } },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x...") },
    texture: {
      roles: {
        kick: null,
        snare: null,
        hat: null,
        chords: role("ooh", "aah:0.6"),
        bass: role("aah"),
        lead: role("sing"),
      },
    },
  }),
]);
