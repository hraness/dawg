/**
 * Art, experimental, screen and functional styles (quality-08 family
 * `art`). Root and branch cards set the theory each branch shares; the
 * family lane adds a leaf by appending a card whose id is a taxonomy leaf.
 */

import { grid, intervals, kit, kitRoles, maybe, role } from "./parts.ts";
import { card, type StyleCard } from "./schema.ts";

const CONJUNCT = intervals(5, 2, 0.6, 0.6);
/** Steps and repeats only: chant, tintinnabuli melody voice. */
const STEPWISE = intervals(5, 0.4, 0, 0.8);
/** Wide leaps (sevenths, ninths folded): post-tonal lines. */
const ANGULAR = intervals(0.8, 1, 3, 0.2);
/** 3/4 in twelve sixteenths: bass on one, chords on two and three. */
const WALTZ_BASS = grid("x...........");
const WALTZ_CHORDS = grid("....x...x...");
/** Off-beat after-beats (march and oom-pah). */
const AFTERBEATS = grid("..x...x...x...x.");
const ON_BEATS = grid("x...x...x...x...");
const STRINGS_ONLY = { kick: null, snare: null, hat: null } as const;

const BRANCH_CARDS: readonly StyleCard[] = Object.freeze([
  card({
    id: "western-art",
    abstract: true,
    summary:
      "common-practice tonality: functional progressions, cadences that close phrases, voice-led chords, conjunct melody, no kit",
    tempo: { bpm: [60, 140], typical: 92 },
    groove: { subdivision: 4, humanize: { timingMs: 10, velocity: 0.08 } },
    rhythm: {
      onsets: { chords: grid("x...x...x...x...") },
      fills: null,
    },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.3],
        ["harmonic-minor", 0.1],
      ],
    },
    harmony: {
      presets: [
        ["canon", 0.4],
        ["fifties", 0.2],
        ["turnaround", 0.2],
        ["andalusian", 0.2],
      ],
      chain: {
        I: [
          ["IV", 2],
          ["V", 2],
          ["vi", 1.5],
          ["ii", 1.5],
          ["iii", 0.3],
        ],
        ii: [
          ["V", 3],
          ["viio", 0.5],
        ],
        iii: [
          ["vi", 2],
          ["IV", 1],
        ],
        IV: [
          ["V", 2],
          ["I", 1],
          ["ii", 1],
        ],
        V: [
          ["I", 3],
          ["vi", 1],
        ],
        vi: [
          ["ii", 2],
          ["IV", 2],
          ["V", 0.5],
        ],
        viio: [["I", 2]],
        i: [
          ["iv", 2],
          ["V", 2],
          ["VI", 1.5],
          ["iiø", 1],
          ["III", 1],
        ],
        iv: [
          ["V", 2],
          ["i", 1],
        ],
        VI: [
          ["iv", 1],
          ["iiø", 1],
          ["V", 1],
        ],
        iiø: [["V", 3]],
        III: [
          ["VI", 1],
          ["iv", 1],
        ],
      },
      sources: { presets: 1, chain: 3 },
      cadences: [
        ["V-I", 0.6],
        ["IV-I", 0.15],
        ["half", 0.25],
      ],
      rhythm: [
        [1, 0.6],
        [2, 0.4],
      ],
      sevenths: 0.15,
      voicing: {
        types: [
          ["close", 0.5],
          ["open", 0.5],
        ],
        range: [48, 76],
        notes: [3, 4],
      },
    },
    melody: {
      contour: [
        ["arch", 0.6],
        ["descending", 0.2],
        ["wave", 0.2],
      ],
      ambitus: [7, 14],
      range: [60, 86],
      intervals: CONJUNCT,
      chordToneRate: 0.75,
      density: [1, 3],
      phraseBars: [
        [4, 0.7],
        [2, 0.3],
      ],
      repetition: 0.5,
    },
    bass: {
      behaviour: [
        ["root", 0.4],
        ["arpeggio", 0.3],
        ["walking", 0.3],
      ],
      range: [36, 55],
      onsets: grid("x...x...x...x..."),
      walk: { chordToneOnOne: 0.95, chromaticApproach: 0.05 },
    },
    form: {
      plans: [
        [["intro", "verse", "bridge", "verse", "outro"], 0.5],
        [["verse", "chorus", "verse", "chorus"], 0.5],
      ],
      archetype: "ternary",
    },
    texture: {
      kind: "homophonic",
      roles: {
        kick: null,
        snare: null,
        hat: null,
        bass: role("cello", "contrabass:0.5"),
        chords: role("strings", "piano:0.6", "harpsichord:0.2"),
        lead: role("violin", "flute:0.5", "oboe:0.4", "piano:0.4"),
        counter: maybe("viola", "clarinet:0.5"),
      },
    },
    expression: {
      dynamics: [0.3, 0.9],
      articulation: {
        lead: [
          ["legato", 0.5],
          ["tenuto", 0.3],
          ["staccato", 0.2],
        ],
      },
    },
    mix: {
      levels: { bass: -4, chords: -6, lead: -1, counter: -5 },
      space: 0.55,
      loudness: "classical",
    },
  }),
  card({
    id: "early-music",
    abstract: true,
    summary:
      "modal counterpoint: church modes, cadences by step, open fifths, triple and duple tactus",
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["3/4", 0.3],
        ["6/4", 0.2],
      ],
    },
    pitch: {
      scales: [
        ["dorian", 0.35],
        ["mixolydian", 0.2],
        ["phrygian", 0.15],
        ["major", 0.15],
        ["minor", 0.15],
      ],
    },
    harmony: {
      presets: [["dorian-vamp", 1]],
      sources: { presets: 0.3, chain: 3 },
      cadences: [
        ["V-I", 0.5],
        ["IV-I", 0.5],
      ],
      sevenths: 0,
      voicing: { types: [["open", 1]], notes: [2, 3] },
    },
    melody: { intervals: intervals(6, 1.5, 0.3, 0.4), density: [0.5, 2] },
    bass: {
      behaviour: [
        ["root", 0.5],
        ["pedal", 0.2],
        ["arpeggio", 0.3],
      ],
      walk: null,
    },
    texture: {
      kind: "polyphonic",
      roles: {
        chords: role("organ", "lute:0.6", "harpsichord:0.4"),
        lead: role("choir", "recorder:0.6", "violin:0.3"),
        counter: role("choir", "recorder:0.5"),
      },
    },
  }),
  card({
    id: "baroque",
    abstract: true,
    summary:
      "basso continuo and motor rhythm: sequences by fifths, running bass, terraced dynamics",
    tempo: { bpm: [60, 132], typical: 96 },
    pitch: {
      scales: [
        ["major", 0.55],
        ["minor", 0.35],
        ["harmonic-minor", 0.1],
      ],
    },
    harmony: {
      chain: {
        I: [
          ["IV", 2],
          ["V", 2],
          ["vi", 2],
          ["ii", 1],
        ],
        vi: [
          ["ii", 3],
          ["IV", 1],
        ],
        ii: [["V", 3]],
        IV: [
          ["viio", 1],
          ["V", 2],
          ["ii", 1],
        ],
        viio: [
          ["iii", 1],
          ["I", 1],
        ],
        iii: [["vi", 2]],
        V: [
          ["I", 3],
          ["vi", 0.5],
        ],
      },
      sources: { presets: 0.3, chain: 3 },
      rhythm: [
        [1, 0.5],
        [2, 0.5],
      ],
      sevenths: 0.2,
    },
    melody: {
      density: [2, 4],
      contour: [
        ["wave", 0.5],
        ["arch", 0.3],
        ["terraced", 0.2],
      ],
      repetition: 0.6,
    },
    bass: {
      behaviour: [
        ["walking", 0.6],
        ["arpeggio", 0.4],
      ],
      onsets: grid("x.x.x.x.x.x.x.x."),
    },
    texture: {
      roles: {
        chords: role("harpsichord", "organ:0.4", "strings:0.4"),
        bass: role("cello", "bassoon:0.3"),
        lead: role("violin", "oboe:0.5", "trumpet:0.3", "recorder:0.3"),
      },
    },
    expression: { dynamics: [0.45, 0.85] },
  }),
  card({
    id: "classical-period",
    abstract: true,
    summary:
      "periodic phrases in 4+4, Alberti and arpeggio accompaniment, clear tonic-dominant polarity",
    harmony: {
      cadences: [
        ["V-I", 0.6],
        ["half", 0.4],
      ],
      sevenths: 0.1,
    },
    melody: {
      phraseBars: [
        [4, 0.8],
        [2, 0.2],
      ],
      repetition: 0.6,
      contour: [
        ["arch", 0.7],
        ["descending", 0.3],
      ],
    },
    bass: {
      behaviour: [
        ["arpeggio", 0.6],
        ["root", 0.4],
      ],
      onsets: grid("x.x.x.x.x.x.x.x."),
    },
    texture: { roles: { chords: role("piano", "strings:0.6") } },
    form: {
      plans: [
        [["verse", "verse", "bridge", "verse"], 0.6],
        [["intro", "verse", "bridge", "verse", "outro"], 0.4],
      ],
      archetype: "sonata",
    },
  }),
  card({
    id: "romantic",
    abstract: true,
    summary:
      "chromatic tonality: secondary dominants, borrowed iv and bVI, wide-range singing lines, rubato",
    tempo: { bpm: [50, 132], typical: 76 },
    groove: { humanize: { timingMs: 18, velocity: 0.1 } },
    pitch: {
      scales: [
        ["minor", 0.45],
        ["major", 0.45],
        ["harmonic-minor", 0.1],
      ],
    },
    harmony: {
      chain: {
        I: [
          ["vi", 1.5],
          ["IV", 1.5],
          ["iv", 1],
          ["bVI", 0.7],
          ["V7/IV", 0.6],
          ["ii", 1],
        ],
        "V7/IV": [["IV", 2]],
        IV: [
          ["iv", 1],
          ["V", 2],
          ["ii", 1],
        ],
        iv: [
          ["V", 1.5],
          ["I", 1],
        ],
        bVI: [
          ["V", 1.5],
          ["iv", 1],
        ],
        vi: [
          ["ii", 2],
          ["V7/V", 1],
        ],
        "V7/V": [["V", 3]],
        ii: [["V", 3]],
        V: [
          ["I", 3],
          ["vi", 0.8],
          ["bVI", 0.4],
        ],
        i: [
          ["iv", 2],
          ["VI", 2],
          ["V", 2],
          ["bII", 0.5],
        ],
        bII: [["V", 3]],
        VI: [
          ["iv", 1],
          ["V", 1],
        ],
      },
      sevenths: 0.35,
      voicing: {
        types: [
          ["open", 0.7],
          ["wide", 0.3],
        ],
        range: [43, 79],
        notes: [3, 5],
      },
    },
    melody: { ambitus: [10, 19], intervals: intervals(4, 2.5, 1.2, 0.5) },
    texture: { roles: { chords: role("piano", "strings:0.8", "grand:0.4") } },
    expression: { dynamics: [0.2, 1] },
  }),
  card({
    id: "modern-art",
    abstract: true,
    summary:
      "post-tonal colour: symmetric and modal scales, quartal chords, irregular meter",
    meter: {
      signatures: [
        ["4/4", 0.4],
        ["5/4", 0.2],
        ["7/8", 0.2],
        ["3/4", 0.2],
      ],
      grouping: [
        [[2, 2, 3], 0.5],
        [[3, 2, 2], 0.5],
      ],
    },
    pitch: {
      scales: [
        ["messiaen-1", 0.2],
        ["messiaen-2", 0.25],
        ["messiaen-3", 0.15],
        ["lydian", 0.2],
        ["phrygian", 0.2],
      ],
    },
    harmony: {
      model: "modal",
      voicing: {
        types: [
          ["quartal", 0.6],
          ["open", 0.4],
        ],
      },
    },
    melody: {
      intervals: intervals(2, 2, 2, 0.3),
      ambitus: [10, 22],
      chordToneRate: 0.3,
    },
  }),
  card({
    id: "contemporary-art",
    abstract: true,
    summary:
      "minimal and spectral: repeated cells, slow harmonic rhythm, pedal bass, additive meter",
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["6/8", 0.2],
        ["7/8", 0.15],
        ["5/4", 0.15],
      ],
    },
    harmony: {
      model: "modal",
      rhythm: [
        [0.5, 0.6],
        [0.25, 0.4],
      ],
      voicing: {
        types: [
          ["open", 0.6],
          ["quartal", 0.4],
        ],
      },
    },
    melody: {
      repetition: 0.85,
      density: [2, 4],
      contour: [
        ["flat", 0.4],
        ["wave", 0.6],
      ],
    },
    bass: {
      behaviour: [
        ["pedal", 0.5],
        ["ostinato", 0.5],
      ],
    },
    texture: {
      roles: { arp: maybe("marimba", "piano:0.6", "vibes:0.4") },
      kind: "polyphonic",
    },
    rhythm: { onsets: { arp: grid("xxxxxxxxxxxxxxxx") } },
  }),
  card({
    id: "concert-band",
    abstract: true,
    summary:
      "wind band and march: 2/4 and 6/8 strains, oom-pah bass, brass melody, snare cadence",
    meter: {
      signatures: [
        ["4/4", 0.4],
        ["2/4", 0.3],
        ["6/8", 0.3],
      ],
    },
    tempo: { bpm: [88, 128], typical: 116 },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("x.x.x.xxx.x.x.xx"),
      },
      fills: { every: 4, density: [0.4, 0.7] },
    },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["turnaround", 0.5],
      ],
      cadences: [
        ["V-I", 0.8],
        ["half", 0.2],
      ],
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x.......x.......") },
    texture: {
      roles: {
        kick: role("drums"),
        snare: role("drums"),
        bass: role("tuba"),
        chords: role("horn", "trombone:0.6"),
        lead: role("trumpet", "clarinet:0.6", "flute:0.4"),
      },
    },
    form: {
      plans: [[["intro", "verse", "verse", "chorus", "chorus"], 1]],
      archetype: "march",
    },
  }),
  card({
    id: "experimental",
    abstract: true,
    summary:
      "process over song: drones, clusters, sparse events, free meter feel, indeterminate density",
    tempo: { bpm: [40, 120], typical: 70 },
    groove: { humanize: { timingMs: 25, velocity: 0.15 } },
    pitch: {
      scales: [
        ["messiaen-3", 0.3],
        ["phrygian", 0.3],
        ["locrian", 0.2],
        ["messiaen-7", 0.2],
      ],
    },
    harmony: { model: "drone", rhythm: [[0.5, 1]] },
    melody: {
      density: [0, 1],
      intervals: intervals(1.5, 1.5, 2, 0.8),
      chordToneRate: 0.2,
      contour: [
        ["flat", 0.5],
        ["wave", 0.5],
      ],
    },
    bass: {
      behaviour: [
        ["pedal", 0.7],
        ["none", 0.3],
      ],
    },
    form: {
      plans: [[["intro", "build", "breakdown", "outro"], 1]],
      archetype: "process",
    },
    texture: {
      kind: "heterophonic",
      roles: {
        kick: null,
        snare: null,
        hat: null,
        chords: null,
        drone: role("granular", "organ:0.5", "cloud:0.5"),
        pad: maybe("strings", "granular:0.6"),
        lead: role("prepared", "bell:0.6", "cello:0.4"),
      },
    },
    mix: { space: 0.8 },
  }),
  card({
    id: "screen-stage",
    abstract: true,
    summary:
      "cue writing: ostinato under sustained strings, minor-mode tension, rising hits, builds into a peak",
    tempo: { bpm: [70, 140], typical: 100 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["dorian", 0.2],
        ["harmonic-minor", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["andalusian", 0.2],
        ["sad-pop", 0.3],
      ],
      rhythm: [
        [0.5, 0.6],
        [1, 0.4],
      ],
      voicing: {
        types: [
          ["open", 0.6],
          ["wide", 0.4],
        ],
        range: [43, 79],
      },
    },
    bass: {
      behaviour: [
        ["ostinato", 0.6],
        ["pedal", 0.4],
      ],
      onsets: grid("x.x.x.x.x.x.x.x."),
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("............x..."),
      },
    },
    form: {
      plans: [
        [["intro", "build", "chorus", "breakdown", "chorus", "outro"], 1],
      ],
      archetype: "cue",
    },
    texture: {
      roles: {
        hat: null,
        kick: role("drums"),
        snare: maybe("drums"),
        chords: role("strings"),
        pad: maybe("choir", "strings:0.5"),
        lead: role("horn", "violin:0.6", "piano:0.4"),
      },
    },
    mix: { space: 0.6 },
  }),
  card({
    id: "childrens",
    abstract: true,
    summary:
      "nursery and functional song: major key, I-IV-V, short repeating phrases, small range",
    tempo: { bpm: [90, 132], typical: 112 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["major-pentatonic", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["axis", 0.5],
      ],
      cadences: [
        ["V-I", 0.8],
        ["IV-I", 0.2],
      ],
      sevenths: 0,
    },
    melody: {
      ambitus: [4, 9],
      range: [60, 79],
      repetition: 0.8,
      phraseBars: [
        [2, 0.6],
        [4, 0.4],
      ],
      intervals: intervals(5, 3, 0.6, 1.5),
    },
    bass: {
      behaviour: [
        ["root-fifth", 0.7],
        ["root", 0.3],
      ],
    },
    texture: {
      roles: {
        chords: role("piano", "acoustic:0.5"),
        lead: role("glockenspiel", "piano:0.6", "flute:0.4"),
      },
    },
  }),
]);

// ---------------------------------------------------------------------------
// Early music. References: Richard Hoppin, "Medieval Music" (1978); Gustave
// Reese, "Music in the Renaissance" (1954); Peter Schubert, "Modal
// Counterpoint, Renaissance Style" (2008).

const EARLY_LEAVES: readonly StyleCard[] = Object.freeze([
  card({
    id: "plainchant",
    summary:
      "eight church modes with finalis and reciting tenor; unmeasured monophony, neumatic steps inside one octave, phrases close on the final",
    tempo: { bpm: [50, 80], typical: 64 },
    pitch: {
      scales: [
        ["dorian", 0.35],
        ["phrygian", 0.2],
        ["lydian", 0.15],
        ["mixolydian", 0.3],
      ],
    },
    harmony: { model: "none" },
    melody: {
      intervals: STEPWISE,
      ambitus: [5, 9],
      range: [55, 72],
      density: [1, 2],
      chordToneRate: 0,
      contour: [["arch", 1]],
      finals: [[0, 1]],
      repetition: 0.3,
    },
    bass: { behaviour: [["none", 1]] },
    texture: {
      kind: "monophonic",
      roles: { bass: null, chords: null, counter: null, lead: role("choir") },
    },
    expression: {
      dynamics: [0.4, 0.7],
      articulation: { lead: [["legato", 1]] },
    },
    mix: { space: 0.85 },
  }),
  card({
    id: "byzantine-chant",
    summary:
      "oktoechos echoi incl. the chromatic hijaz-like second echos; ison drone holds the tonic under a stepwise melos",
    tempo: { bpm: [50, 80], typical: 62 },
    pitch: {
      scales: [
        ["phrygian", 0.3],
        ["dorian", 0.3],
        ["hijaz", 0.25],
        ["mixolydian", 0.15],
      ],
    },
    harmony: { model: "drone", rhythm: [[0.25, 1]] },
    melody: {
      intervals: STEPWISE,
      ambitus: [5, 9],
      range: [55, 72],
      density: [1, 2.5],
      finals: [[0, 1]],
    },
    bass: { behaviour: [["none", 1]] },
    texture: {
      kind: "monophonic",
      roles: {
        bass: null,
        chords: null,
        counter: null,
        drone: role("choir"),
        lead: role("choir"),
      },
    },
    mix: { levels: { drone: -8 }, space: 0.85 },
  }),
  card({
    id: "organum",
    summary:
      "vox organalis in parallel fourths and fifths; sustained tenor under a melismatic duplum; first rhythmic mode long-short in compound time",
    meter: { signatures: [["6/8", 1]], grouping: [[[3, 3], 1]] },
    tempo: { bpm: [50, 76], typical: 60 },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["mixolydian", 0.3],
        ["lydian", 0.2],
      ],
    },
    harmony: {
      model: "drone",
      rhythm: [[0.25, 1]],
      voicing: { types: [["open", 1]], notes: [2, 2] },
    },
    melody: { intervals: STEPWISE, density: [1, 3], ambitus: [5, 10] },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      kind: "polyphonic",
      roles: {
        bass: role("choir"),
        chords: null,
        counter: null,
        drone: role("organ", "choir:0.5"),
        lead: role("choir"),
      },
    },
    mix: { space: 0.85 },
  }),
  card({
    id: "ars-nova",
    summary:
      "isorhythmic tenor (talea and color repeat), perfect and imperfect prolation, hocket, double-leading-tone cadence to open fifth",
    meter: {
      signatures: [
        ["6/8", 0.5],
        ["3/4", 0.5],
      ],
    },
    pitch: {
      scales: [
        ["dorian", 0.4],
        ["lydian", 0.3],
        ["mixolydian", 0.3],
      ],
    },
    harmony: { cadences: [["V-I", 1]], voicing: { types: [["open", 1]] } },
    melody: { repetition: 0.85, density: [1.5, 3] },
    bass: { behaviour: [["ostinato", 1]] },
    texture: {
      roles: {
        bass: role("cello", "organ:0.5"),
        chords: role("organ", "harp:0.5"),
        counter: role("recorder", "choir:0.5"),
        lead: role("choir", "recorder:0.4"),
      },
    },
    form: { archetype: "isorhythmic motet" },
  }),
  card({
    id: "troubadour",
    summary:
      "strophic monophonic song in dorian and mixolydian, triple modal rhythm, harp or fiddle doubling the line, refrain returns",
    meter: {
      signatures: [
        ["3/4", 0.6],
        ["6/8", 0.4],
      ],
    },
    tempo: { bpm: [70, 110], typical: 88 },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["mixolydian", 0.5],
      ],
    },
    harmony: { model: "drone" },
    melody: { ambitus: [5, 10], repetition: 0.7 },
    bass: { behaviour: [["pedal", 1]] },
    rhythm: { onsets: { bass: WALTZ_BASS } },
    texture: {
      kind: "heterophonic",
      roles: {
        chords: null,
        counter: maybe("cello", "harp:0.6"),
        bass: role("harp", "lute:0.5"),
        lead: role("vocal", "recorder:0.5"),
      },
    },
    form: {
      plans: [[["verse", "chorus", "verse", "chorus", "verse"], 1]],
      archetype: "strophic",
    },
  }),
  card({
    id: "medieval-dance",
    summary:
      "estampie puncta with ouvert and clos endings (half then full cadence), drone fifths, tabor in compound meter",
    meter: {
      signatures: [
        ["6/8", 0.7],
        ["3/4", 0.3],
      ],
    },
    tempo: { bpm: [96, 140], typical: 120 },
    rhythm: {
      onsets: {
        perc: grid("x.....x.x..."),
      },
    },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["mixolydian", 0.5],
      ],
    },
    harmony: {
      model: "drone",
      cadences: [
        ["half", 0.5],
        ["V-I", 0.5],
      ],
    },
    melody: { density: [2, 3], repetition: 0.75, phraseBars: [[2, 1]] },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      kind: "heterophonic",
      roles: {
        chords: null,
        counter: null,
        perc: role("framedrum", "bodhran:0.5"),
        drone: role("reeds", "organ:0.4"),
        bass: role("cello"),
        lead: role("recorder", "oboe:0.5", "fiddle:0.3"),
      },
    },
    form: {
      archetype: "estampie",
      plans: [[["verse", "verse", "chorus", "chorus"], 1]],
    },
  }),
  card({
    id: "franco-flemish",
    summary:
      "pervading imitation between four equal voices, cantus firmus, clausula vera (6-8 by contrary step) closes each point",
    tempo: { bpm: [60, 96], typical: 76 },
    pitch: {
      scales: [
        ["dorian", 0.35],
        ["mixolydian", 0.25],
        ["major", 0.25],
        ["phrygian", 0.15],
      ],
    },
    harmony: {
      cadences: [["V-I", 1]],
      rhythm: [
        [1, 0.5],
        [2, 0.5],
      ],
    },
    melody: { intervals: CONJUNCT, repetition: 0.75, phraseBars: [[4, 1]] },
    bass: {
      behaviour: [
        ["root", 0.6],
        ["arpeggio", 0.4],
      ],
    },
    texture: {
      kind: "polyphonic",
      roles: {
        bass: role("choir"),
        chords: role("choir"),
        counter: role("choir"),
        lead: role("choir"),
      },
    },
    form: { archetype: "mass movement" },
  }),
  card({
    id: "roman-school",
    summary:
      "stile antico: dissonance only as passing or suspension, leaps recovered by step, arch lines, smooth a cappella consonance",
    tempo: { bpm: [56, 84], typical: 70 },
    pitch: {
      scales: [
        ["dorian", 0.4],
        ["major", 0.3],
        ["mixolydian", 0.3],
      ],
    },
    harmony: {
      cadences: [
        ["V-I", 0.7],
        ["IV-I", 0.3],
      ],
    },
    melody: {
      intervals: intervals(6, 1.2, 0.2, 0.4),
      chordToneRate: 0.85,
      contour: [["arch", 1]],
      ambitus: [5, 10],
    },
    texture: {
      kind: "polyphonic",
      roles: {
        bass: role("choir"),
        chords: role("choir"),
        counter: role("choir"),
        lead: role("choir"),
      },
    },
    expression: { dynamics: [0.4, 0.75] },
  }),
  card({
    id: "venetian-polychoral",
    summary:
      "cori spezzati: two spatially split choirs answer in homophonic blocks, cornett and sackbut doubling, plagal and authentic closes",
    tempo: { bpm: [72, 104], typical: 88 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["mixolydian", 0.4],
      ],
    },
    harmony: {
      cadences: [
        ["V-I", 0.6],
        ["IV-I", 0.4],
      ],
      rhythm: [[1, 1]],
    },
    texture: {
      kind: "homophonic",
      roles: {
        chords: role("choir"),
        counter: role("trombone", "trumpet:0.5"),
        bass: role("trombone", "organ:0.5"),
        lead: role("trumpet", "choir:0.6"),
      },
    },
    mix: { pan: { chords: -0.7, counter: 0.7 }, space: 0.85 },
  }),
  card({
    id: "madrigal",
    summary:
      "word painting, chromatic inflection (raised leading tones, harmonic minor), alternating imitative and homophonic passages for five voices",
    tempo: { bpm: [64, 100], typical: 82 },
    pitch: {
      scales: [
        ["minor", 0.4],
        ["harmonic-minor", 0.3],
        ["dorian", 0.3],
      ],
    },
    harmony: {
      cadences: [
        ["V-I", 0.7],
        ["half", 0.3],
      ],
      rhythm: [
        [1, 0.5],
        [2, 0.5],
      ],
    },
    melody: { ambitus: [7, 13], intervals: intervals(4, 2, 1, 0.5) },
    texture: {
      kind: "polyphonic",
      roles: {
        bass: role("choir"),
        chords: role("choir"),
        counter: role("choir"),
        lead: role("choir", "vocal:0.5"),
      },
    },
  }),
  card({
    id: "lute-song",
    summary:
      "strophic ayre: one voice over broken lute chords and a bass viol, minor-mode melancholy, phrygian half cadences",
    tempo: { bpm: [60, 96], typical: 76 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["dorian", 0.3],
        ["major", 0.2],
      ],
    },
    harmony: {
      cadences: [
        ["V-I", 0.6],
        ["iv-V", 0.4],
      ],
    },
    bass: { behaviour: [["root", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        chords: role("lute"),
        bass: role("cello"),
        counter: null,
        lead: role("vocal", "recorder:0.5"),
      },
    },
    rhythm: { onsets: { chords: grid("x.x.x.x.x.x.x.x.") } },
    form: { archetype: "strophic", plans: [[["verse", "verse", "verse"], 1]] },
  }),
  card({
    id: "iberian-renaissance",
    summary:
      "villancico with estribillo and coplas; sesquialtera hemiola (6/8 against 3/4), vihuela strum, tabor on the shifted accents",
    meter: {
      signatures: [["6/8", 1]],
      grouping: [
        [[3, 3], 0.5],
        [[2, 2, 2], 0.5],
      ],
    },
    tempo: { bpm: [80, 120], typical: 100 },
    rhythm: { onsets: { perc: grid("x.....x.x.x.") } },
    pitch: {
      scales: [
        ["major", 0.4],
        ["minor", 0.3],
        ["mixolydian", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["andalusian", 0.5],
      ],
      sources: { presets: 2, chain: 1 },
    },
    texture: {
      roles: {
        perc: role("framedrum"),
        chords: role("lute", "nylon:0.6", "harp:0.4"),
        bass: role("cello", "harp:0.4"),
        lead: role("vocal", "choir:0.5", "recorder:0.4"),
      },
    },
    form: {
      plans: [[["chorus", "verse", "chorus", "verse", "chorus"], 1]],
      archetype: "estribillo-coplas",
    },
  }),
  card({
    id: "renaissance-dance",
    summary:
      "pavane and galliard pairs over standard grounds: passamezzo moderno I-IV-I-V and bergamasca I-IV-V-I, tabor marks the step",
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["3/4", 0.5],
      ],
    },
    tempo: { bpm: [72, 132], typical: 100 },
    rhythm: { onsets: { perc: grid("x...x.x.x...x.x.") } },
    pitch: { scales: [["major", 1]] },
    harmony: {
      forms: [
        [["I", "IV", "I", "V", "I", "IV", "V", "I"], 0.6],
        [["I", "IV", "V", "I"], 0.4],
      ],
      sources: { forms: 3, chain: 0.5, presets: 0 },
      cadences: [["V-I", 1]],
    },
    melody: { repetition: 0.7, phraseBars: [[4, 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        perc: role("framedrum"),
        chords: role("lute", "harpsichord:0.4"),
        bass: role("cello", "trombone:0.4"),
        lead: role("recorder", "cello:0.5"),
        counter: maybe("recorder"),
      },
    },
    form: { archetype: "pavane-galliard" },
  }),
]);

// ---------------------------------------------------------------------------
// Baroque and classical. References: Manfred Bukofzer, "Music in the
// Baroque Era" (1947); Robert Gjerdingen, "Music in the Galant Style"
// (2007); Charles Rosen, "The Classical Style" (1971).

const BAROQUE_LEAVES: readonly StyleCard[] = Object.freeze([
  card({
    id: "early-baroque",
    summary:
      "monody over basso continuo, seconda pratica dissonance for the text, romanesca ground III-VII-i-V, phrygian half cadence iv-V",
    tempo: { bpm: [56, 96], typical: 72 },
    pitch: {
      scales: [
        ["minor", 0.7],
        ["dorian", 0.3],
      ],
    },
    harmony: {
      forms: [[["III", "VII", "i", "V", "III", "VII", "i", "V", "i"], 1]],
      sources: { forms: 2, chain: 1, presets: 0 },
      cadences: [
        ["V-i", 0.6],
        ["iv-V", 0.4],
      ],
      rhythm: [[1, 1]],
    },
    melody: { density: [1, 3], repetition: 0.4 },
    bass: { behaviour: [["root", 1]], onsets: grid("x.......x.......") },
    texture: {
      kind: "homophonic",
      roles: {
        chords: role("lute", "harpsichord:0.5", "organ:0.3"),
        bass: role("cello", "cello:0.5"),
        counter: null,
        lead: role("vocal", "violin:0.5"),
      },
    },
  }),
  card({
    id: "italian-baroque",
    summary:
      "ritornello form, concertino against ripieno, descending-fifths sequence I-IV-viio-iii-vi-ii-V-I, motor sixteenths",
    tempo: { bpm: [96, 140], typical: 120 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      forms: [[["I", "IV", "viio", "iii", "vi", "ii", "V", "I"], 1]],
      sources: { forms: 3, chain: 1, presets: 0 },
    },
    melody: { density: [3, 4], repetition: 0.7 },
    rhythm: { onsets: { chords: grid("x.x.x.x.x.x.x.x.") } },
    texture: {
      roles: {
        chords: role("strings", "harpsichord:0.5"),
        bass: role("cello", "contrabass:0.4"),
        lead: role("violin"),
        counter: maybe("violin", "oboe:0.4"),
      },
    },
    form: { archetype: "ritornello" },
  }),
  card({
    id: "french-baroque",
    summary:
      "notes inegales (paired eighths played long-short), dotted French overture, ornamented oboe and harpsichord, minuet and sarabande in 3/4",
    // Minuet, sarabande, courante and passacaille are triple; the dotted
    // overture is the duple exception.
    meter: {
      signatures: [
        ["3/4", 0.75],
        ["4/4", 0.25],
      ],
    },
    tempo: { bpm: [60, 112], typical: 84 },
    groove: { swingRatio: [1.4, 1.8] },
    melody: { density: [1, 2], repetition: 0.7 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: {
      cadences: [
        ["V-I", 0.7],
        ["half", 0.3],
      ],
    },
    expression: {
      articulation: {
        lead: [
          ["accent", 0.4],
          ["staccato", 0.3],
          ["legato", 0.3],
        ],
      },
    },
    texture: {
      roles: {
        chords: role("harpsichord", "strings:0.5"),
        bass: role("cello", "bassoon:0.5"),
        lead: role("oboe", "flute:0.6", "violin:0.4"),
        counter: maybe("bassoon", "flute:0.5"),
      },
    },
    form: { archetype: "french overture" },
  }),
  card({
    id: "german-baroque",
    summary:
      "fugal counterpoint: subject answered at the fifth, invertible countersubject, chorale harmony thick with sevenths, walking continuo",
    tempo: { bpm: [66, 112], typical: 88 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["major", 0.4],
        ["harmonic-minor", 0.1],
      ],
    },
    harmony: {
      sevenths: 0.45,
      rhythm: [
        [2, 0.6],
        [1, 0.4],
      ],
    },
    meter: { signatures: [["4/4", 1]] },
    melody: { repetition: 0.8, density: [3, 4] },
    bass: { behaviour: [["walking", 1]] },
    texture: {
      kind: "polyphonic",
      roles: {
        chords: role("organ", "harpsichord:0.5"),
        bass: role("organ", "cello:0.5"),
        lead: role("organ", "violin:0.4", "oboe:0.3"),
        counter: role("organ", "viola:0.5"),
      },
    },
    form: { archetype: "fugue" },
  }),
  card({
    id: "english-baroque",
    summary:
      "ground bass on the descending minor tetrachord (lament i-v-iv-V), triple meter, divisions over the ground, oratorio choruses",
    meter: { signatures: [["3/4", 1]] },
    tempo: { bpm: [56, 100], typical: 72 },
    pitch: { scales: [["minor", 1]] },
    harmony: {
      forms: [[["i", "v", "iv", "V"], 1]],
      sources: { forms: 4, chain: 0.3, presets: 0 },
      cadences: [["V-i", 1]],
      rhythm: [[1, 1]],
    },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x...x...x...") },
    rhythm: { onsets: { chords: WALTZ_CHORDS } },
    texture: {
      roles: {
        chords: role("strings", "harpsichord:0.5"),
        bass: role("cello", "cello:0.5"),
        lead: role("vocal", "violin:0.6", "trumpet:0.3"),
      },
    },
    form: { archetype: "ground" },
  }),
  card({
    id: "opera-seria",
    summary:
      "da capo aria A-B-A with ornamented return, string ritornelli frame the voice, cadenza on the cadential six-four",
    tempo: { bpm: [60, 120], typical: 84 },
    harmony: {
      cadences: [
        ["V-I", 0.8],
        ["half", 0.2],
      ],
    },
    melody: { ambitus: [10, 15], density: [1, 3] },
    texture: {
      kind: "homophonic",
      roles: {
        chords: role("strings", "harpsichord:0.4"),
        bass: role("cello", "harpsichord:0.4"),
        lead: role("vocal"),
        counter: maybe("violin", "oboe:0.5"),
      },
    },
    form: {
      plans: [[["intro", "verse", "bridge", "verse", "outro"], 1]],
      archetype: "da capo",
    },
  }),
  card({
    id: "harpsichord-suite",
    summary:
      "binary dances AABB (allemande, courante, sarabande with second-beat stress, gigue in 6/8), style brise broken chords",
    meter: {
      signatures: [
        ["4/4", 0.3],
        ["3/4", 0.4],
        ["6/8", 0.3],
      ],
    },
    tempo: { bpm: [60, 132], typical: 96 },
    melody: { repetition: 0.65 },
    bass: {
      behaviour: [
        ["walking", 0.5],
        ["arpeggio", 0.5],
      ],
    },
    texture: {
      kind: "polyphonic",
      roles: {
        chords: role("harpsichord"),
        bass: role("harpsichord"),
        lead: role("harpsichord"),
        counter: null,
      },
    },
    form: {
      plans: [[["verse", "verse", "chorus", "chorus"], 1]],
      archetype: "binary",
    },
  }),
  card({
    id: "style-galant",
    summary:
      "galant schemata as stock phrases: romanesca, Prinner IV-I-viio-I, Fonte V/ii-ii-V-I, Monte V/IV-IV-V/V-V; light texture, singing treble",
    tempo: { bpm: [72, 120], typical: 96 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["minor", 0.2],
      ],
    },
    harmony: {
      forms: [
        [["I", "V", "vi", "iii", "IV", "I", "IV", "V"], 0.3],
        [["IV", "I", "viio", "I"], 0.25],
        [["V7/ii", "ii", "V7", "I"], 0.25],
        [["V7/IV", "IV", "V7/V", "V"], 0.2],
      ],
      sources: { forms: 4, chain: 0, presets: 0 },
    },
    melody: {
      phraseBars: [
        [2, 0.5],
        [4, 0.5],
      ],
    },
    texture: {
      roles: {
        chords: role("harpsichord", "piano:0.5"),
        bass: role("cello", "harpsichord:0.4"),
        lead: role("flute", "violin:0.6"),
      },
    },
    form: { archetype: "schemata" },
  }),
  card({
    id: "viennese-classical",
    summary:
      "sonata form; 4+4 period with half-cadence antecedent and authentic consequent; Alberti bass (low-high-middle-high) under a singing line",
    tempo: { bpm: [76, 144], typical: 116 },
    bass: {
      behaviour: [["arpeggio", 1]],
      onsets: grid("xxxxxxxxxxxxxxxx"),
    },
    harmony: {
      cadences: [
        ["V-I", 0.55],
        ["half", 0.45],
      ],
    },
    texture: {
      roles: {
        chords: role("strings", "piano:0.6"),
        bass: role("piano", "cello:0.5"),
        lead: role("piano", "violin:0.6", "flute:0.3"),
      },
    },
    form: {
      plans: [
        [["intro", "verse", "chorus", "bridge", "verse", "chorus", "outro"], 1],
      ],
      archetype: "sonata",
    },
  }),
  card({
    id: "opera-buffa",
    summary:
      "patter song (fast repeated notes, syllabic), 2/4 and 6/8 comic ensembles, tonic-dominant oscillation, crescendo finale",
    meter: {
      signatures: [
        ["2/4", 0.5],
        ["6/8", 0.5],
      ],
    },
    tempo: { bpm: [120, 168], typical: 144 },
    harmony: {
      forms: [[["I", "V7", "I", "V7", "I", "IV", "V7", "I"], 1]],
      sources: { forms: 2, chain: 1, presets: 0 },
    },
    melody: {
      density: [3, 4],
      intervals: intervals(4, 1.5, 0.5, 3),
      repetition: 0.75,
    },
    texture: {
      roles: {
        chords: role("strings"),
        bass: role("cello", "bassoon:0.5"),
        lead: role("vocal", "bassoon:0.4"),
      },
    },
    expression: {
      articulation: {
        lead: [
          ["staccato", 0.7],
          ["accent", 0.3],
        ],
      },
    },
  }),
  card({
    id: "singspiel",
    summary:
      "German song-play: strophic folk-like Lied tunes in major, I-IV-V, horn and flute colour, spoken dialogue between numbers",
    meter: {
      signatures: [
        ["2/4", 0.4],
        ["6/8", 0.3],
        ["3/4", 0.3],
      ],
    },
    tempo: { bpm: [80, 126], typical: 100 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["fifties", 0.6],
        ["turnaround", 0.4],
      ],
      sources: { presets: 2, chain: 1 },
      sevenths: 0.05,
    },
    melody: { ambitus: [5, 10], repetition: 0.75 },
    texture: {
      roles: {
        chords: role("strings"),
        bass: role("cello"),
        lead: role("vocal", "flute:0.5"),
        counter: maybe("horn", "clarinet:0.5"),
      },
    },
    form: {
      archetype: "strophic",
      plans: [[["verse", "chorus", "verse", "chorus"], 1]],
    },
  }),
]);

// ---------------------------------------------------------------------------
// Romantic. References: Carl Dahlhaus, "Nineteenth-Century Music" (1989);
// Richard Cohn, "Audacious Euphony" (2012) for chromatic-mediant and
// hexatonic relations.

const ROMANTIC_LEAVES: readonly StyleCard[] = Object.freeze([
  card({
    id: "early-romantic",
    summary:
      "classical periods coloured by chromatic mediants (I-bVI), the augmented-sixth approach to V and lyrical second themes over arpeggiated accompaniment",
    tempo: { bpm: [60, 132], typical: 92 },
    harmony: {
      forms: [
        [["I", "bVI", "iv", "V", "I", "vi", "ii", "V"], 0.5],
        [["i", "VI", "iv", "V", "i", "III", "iv", "V"], 0.5],
      ],
      sources: { forms: 1, chain: 2 },
      cadences: [
        ["V-I", 0.7],
        ["half", 0.3],
      ],
    },
    bass: {
      behaviour: [
        ["arpeggio", 0.6],
        ["root", 0.4],
      ],
    },
    texture: {
      roles: {
        chords: role("strings", "piano:0.6"),
        bass: role("cello", "contrabass:0.5"),
        lead: role("violin", "clarinet:0.5", "piano:0.5"),
      },
    },
    form: { archetype: "sonata" },
  }),
  card({
    id: "romantic-miniature",
    summary:
      "nocturne and character piece: wide left-hand arpeggio spanning a tenth under a bel-canto treble, rubato, ternary ABA with a contrasting middle",
    meter: {
      signatures: [
        ["4/4", 0.4],
        ["3/4", 0.3],
        ["6/8", 0.3],
      ],
    },
    tempo: { bpm: [50, 96], typical: 66 },
    groove: { humanize: { timingMs: 24, velocity: 0.12 } },
    bass: {
      behaviour: [["arpeggio", 1]],
      onsets: grid("x.x.x.x.x.x.x.x."),
      range: [33, 57],
    },
    harmony: {
      voicing: { types: [["wide", 1]] },
      rhythm: [
        [1, 0.6],
        [0.5, 0.4],
      ],
    },
    melody: {
      density: [1, 3],
      contour: [
        ["arch", 0.7],
        ["wave", 0.3],
      ],
    },
    texture: {
      kind: "homophonic",
      roles: {
        chords: role("piano", "grand:0.5"),
        bass: role("piano", "grand:0.5"),
        lead: role("piano", "grand:0.5"),
        counter: null,
      },
    },
    form: {
      plans: [[["verse", "bridge", "verse", "outro"], 1]],
      archetype: "ternary",
    },
  }),
  card({
    id: "lied",
    summary:
      "art song: voice and piano as equal partners, through-composed or modified strophic, tonicizations and major-minor mixture follow the poem",
    tempo: { bpm: [52, 112], typical: 72 },
    harmony: {
      rhythm: [
        [1, 0.6],
        [0.5, 0.4],
      ],
    },
    melody: { ambitus: [8, 14], density: [1, 2.5] },
    rhythm: { onsets: { chords: grid("x.x.x.x.x.x.x.x.") } },
    texture: {
      kind: "homophonic",
      roles: {
        chords: role("piano"),
        bass: role("piano"),
        lead: role("vocal"),
        counter: null,
      },
    },
    form: {
      plans: [[["verse", "verse", "bridge", "verse"], 1]],
      archetype: "modified strophic",
    },
  }),
  card({
    id: "bel-canto",
    summary:
      "cantabile line over guitar-like um-pa-pa strings, cabaletta doubles the tempo, appoggiaturas and a cadenza on the cadential six-four",
    meter: {
      signatures: [
        ["3/4", 0.5],
        ["4/4", 0.5],
      ],
    },
    tempo: { bpm: [60, 132], typical: 84 },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["turnaround", 0.5],
      ],
      sources: { presets: 2, chain: 1 },
      sevenths: 0.15,
    },
    bass: { behaviour: [["root", 1]], onsets: grid("x...x...x...x...") },
    rhythm: { onsets: { chords: AFTERBEATS } },
    melody: { ambitus: [10, 16], intervals: intervals(4, 2, 1, 0.4) },
    texture: {
      kind: "homophonic",
      roles: {
        chords: role("strings", "pizzicato:0.5"),
        bass: role("cello", "contrabass:0.5"),
        lead: role("vocal"),
        counter: maybe("flute", "clarinet:0.5"),
      },
    },
    form: { archetype: "cavatina-cabaletta" },
  }),
  card({
    id: "grand-opera",
    summary:
      "massed chorus and brass tableaux, march and ballet numbers, dramatic diminished-seventh tremolo before the cadence",
    tempo: { bpm: [66, 132], typical: 96 },
    harmony: {
      chain: {
        V: [
          ["I", 3],
          ["viio7/V", 0.6],
        ],
        "viio7/V": [["V", 3]],
      },
      voicing: { notes: [4, 6] },
    },
    texture: {
      roles: {
        kick: maybe("drums"),
        perc: maybe("timpani"),
        chords: role("strings", "choir:0.6"),
        pad: role("choir", "frenchhorn:0.5"),
        bass: role("contrabass", "tuba:0.4"),
        lead: role("vocal", "trumpet:0.4"),
      },
    },
    expression: { dynamics: [0.3, 1] },
  }),
  card({
    id: "music-drama",
    summary:
      "endless melody without full cadences, leitmotif cells transformed, deceptive V-bVI and the half-diminished chord resolving by semitone voice leading",
    tempo: { bpm: [40, 76], typical: 54 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["harmonic-minor", 0.5],
      ],
    },
    harmony: {
      chain: {
        V: [
          ["bVI", 2],
          ["vi", 1.5],
          ["I", 0.5],
        ],
        I: [
          ["iiø7", 1],
          ["bVI", 1],
          ["iv", 1],
        ],
        iiø7: [["V7", 3]],
      },
      cadences: [
        ["V-vi", 0.6],
        ["half", 0.4],
      ],
      sevenths: 0.6,
    },
    melody: { phraseBars: [[8, 1]], repetition: 0.55, ambitus: [10, 17] },
    texture: {
      roles: {
        chords: role("strings", "horn:0.5"),
        pad: role("frenchhorn", "strings:0.5"),
        bass: role("contrabass", "tuba:0.4"),
        lead: role("vocal", "cello:0.4", "frenchhorn:0.3"),
      },
    },
    form: { archetype: "through-composed" },
  }),
  card({
    id: "verismo",
    summary:
      "melodic climax doubled in unison by full strings, sudden dynamic swells, parlando recitative, minor-key tragedy closing on the tonic",
    tempo: { bpm: [56, 120], typical: 80 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["harmonic-minor", 0.2],
        ["major", 0.2],
      ],
    },
    melody: {
      ambitus: [12, 17],
      contour: [
        ["ascending", 0.4],
        ["arch", 0.6],
      ],
    },
    texture: {
      roles: {
        chords: role("strings"),
        bass: role("cello", "contrabass:0.5"),
        lead: role("vocal", "violins:0.5"),
        counter: maybe("violins"),
      },
    },
    expression: { dynamics: [0.25, 1] },
  }),
  card({
    id: "romantic-symphonic",
    summary:
      "four-movement symphony: horn-call themes, cyclic motifs, brass chorales at the climax, timpani on tonic and dominant",
    tempo: { bpm: [60, 144], typical: 100 },
    rhythm: { onsets: { kick: grid("x.......x.......") } },
    texture: {
      roles: {
        kick: role("timpani"),
        chords: role("strings"),
        pad: maybe("frenchhorn", "trombone:0.5"),
        bass: role("contrabass", "cellos:0.6"),
        lead: role("violins", "frenchhorn:0.5", "clarinet:0.3"),
        counter: maybe("cellos", "bassoon:0.4"),
      },
    },
    form: {
      plans: [
        [["intro", "verse", "chorus", "bridge", "verse", "chorus", "outro"], 1],
      ],
      archetype: "symphonic sonata",
    },
  }),
  card({
    id: "tone-poem",
    summary:
      "programmatic single movement: thematic transformation of one idea, chromatic-mediant shifts between scenes, orchestral colour as narrative",
    tempo: { bpm: [44, 96], typical: 66 },
    groove: { humanize: { timingMs: 30, velocity: 0.15 } },
    harmony: {
      chain: {
        I: [
          ["bVI", 1.5],
          ["III", 1],
          ["vi", 1],
          ["IV", 1],
        ],
        bVI: [
          ["I", 1],
          ["iv", 1],
          ["V", 1],
        ],
        III: [
          ["vi", 1.5],
          ["I", 1],
        ],
      },
    },
    melody: { repetition: 0.75 },
    texture: {
      roles: {
        chords: role("strings"),
        pad: maybe("frenchhorn", "celesta:0.4"),
        arp: role("harp"),
        bass: role("contrabass", "cellos:0.5"),
        lead: role("clarinet", "oboe:0.5", "flute:0.4", "violins:0.5"),
      },
    },
    form: {
      plans: [
        [
          ["intro", "verse", "build", "chorus", "breakdown", "chorus", "outro"],
          1,
        ],
      ],
      archetype: "programmatic",
    },
  }),
  card({
    id: "nationalist-romantic",
    summary:
      "folk modes inside the orchestra: dorian and mixolydian tunes, drone fifths, dance rhythms, bVII-I and modal plagal cadences",
    pitch: {
      scales: [
        ["dorian", 0.35],
        ["mixolydian", 0.25],
        ["minor", 0.25],
        ["major", 0.15],
      ],
    },
    harmony: {
      forms: [
        [["i", "bVII", "i", "bVII", "i", "iv", "bVII", "i"], 0.5],
        [["I", "bVII", "IV", "I"], 0.5],
      ],
      sources: { forms: 2, chain: 1 },
      cadences: [
        ["bVII-I", 0.5],
        ["V-I", 0.5],
      ],
    },
    bass: {
      behaviour: [
        ["root-fifth", 0.5],
        ["pedal", 0.5],
      ],
    },
    texture: {
      roles: {
        chords: role("strings"),
        bass: role("contrabass", "cellos:0.5"),
        lead: role("oboe", "clarinet:0.6", "violin:0.6"),
      },
    },
  }),
  card({
    id: "late-romantic",
    summary:
      "saturated chromaticism: ninth chords, long appoggiaturas, enharmonic pivots, slow-building climaxes for a very large orchestra",
    tempo: { bpm: [52, 112], typical: 72 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["lydian", 0.2],
        ["minor", 0.2],
      ],
    },
    harmony: {
      sevenths: 0.7,
      voicing: { notes: [4, 6], range: [38, 84] },
      chain: {
        I: [
          ["bVI", 1.2],
          ["bIII", 0.8],
          ["iv", 1],
          ["vi", 1],
          ["IV", 1],
        ],
        bIII: [
          ["iv", 1],
          ["bVI", 1],
        ],
      },
    },
    melody: { ambitus: [12, 22], intervals: intervals(4, 2, 1.6, 0.3) },
    texture: {
      roles: {
        chords: role("strings"),
        pad: role("frenchhorn", "choir:0.4"),
        bass: role("contrabass", "tuba:0.4"),
        lead: role("violins", "frenchhorn:0.6", "vocal:0.3"),
      },
    },
    expression: { dynamics: [0.15, 1] },
  }),
  card({
    id: "operetta",
    summary:
      "light stage music: waltz refrains with oom-pah-pah, can-can galops in 2/4, tuneful major-key couplets, I-V7 oscillation",
    meter: {
      signatures: [
        ["3/4", 0.6],
        ["2/4", 0.4],
      ],
    },
    tempo: { bpm: [96, 168], typical: 132 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["minor", 0.2],
      ],
    },
    harmony: {
      forms: [[["I", "I", "V7", "V7", "V7", "V7", "I", "I"], 1]],
      sources: { forms: 2, chain: 1 },
    },
    bass: { behaviour: [["root", 1]], onsets: WALTZ_BASS },
    rhythm: { onsets: { chords: WALTZ_CHORDS } },
    melody: { repetition: 0.75, phraseBars: [[4, 1]] },
    texture: {
      roles: {
        chords: role("strings", "pizzicato:0.5"),
        bass: role("contrabass", "tuba:0.4"),
        lead: role("vocal", "violin:0.6", "flute:0.3"),
      },
    },
    form: { archetype: "number opera" },
  }),
  card({
    id: "zarzuela",
    summary:
      "Spanish stage music: jota in fast triple time, sesquialtera hemiola, Andalusian cadence i-bVII-bVI-V, guitar strum and castanet figures",
    meter: {
      signatures: [
        ["3/4", 0.6],
        ["6/8", 0.4],
      ],
      grouping: [
        [[3, 3], 0.5],
        [[2, 2, 2], 0.5],
      ],
    },
    tempo: { bpm: [100, 176], typical: 138 },
    groove: { humanize: { timingMs: 6, velocity: 0.08 } },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["major", 0.3],
        ["harmonic-minor", 0.2],
      ],
    },
    harmony: {
      presets: [["andalusian", 1]],
      sources: { presets: 3, chain: 1 },
      cadences: [["V-i", 1]],
    },
    rhythm: { onsets: { perc: grid("x.xx..x.x.x.") } },
    texture: {
      roles: {
        perc: role("framedrum"),
        chords: role("nylon", "strings:0.6"),
        bass: role("contrabass", "cello:0.5"),
        lead: role("vocal", "violin:0.5", "oboe:0.3"),
      },
    },
  }),
  card({
    id: "salon-music",
    summary:
      "parlour waltzes, polkas and romances: bright major, decorated melody, secondary dominants, waltz bass on one and chords on two and three",
    meter: {
      signatures: [
        ["3/4", 0.6],
        ["2/4", 0.4],
      ],
    },
    tempo: { bpm: [84, 160], typical: 120 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["minor", 0.2],
      ],
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: WALTZ_BASS },
    rhythm: { onsets: { chords: WALTZ_CHORDS } },
    expression: { dynamics: [0.3, 0.8] },
    texture: {
      roles: {
        chords: role("piano", "upright:0.5"),
        bass: role("piano", "upright:0.5"),
        lead: role("piano", "violin:0.6", "flute:0.4"),
      },
    },
  }),
]);

// ---------------------------------------------------------------------------
// Modern and contemporary. References: Robert Morgan, "Twentieth-Century
// Music" (1991); Joseph Straus, "Introduction to Post-Tonal Theory"
// (2016); Keith Potter, "Four Musical Minimalists" (2000).

const MODERN_LEAVES: readonly StyleCard[] = Object.freeze([
  card({
    id: "impressionism",
    summary:
      "planing (parallel ninth chords), whole-tone and pentatonic collections, added-note chords, pedal points and blurred harp and flute colour",
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["3/4", 0.3],
        ["6/8", 0.2],
      ],
      grouping: null,
    },
    tempo: { bpm: [48, 100], typical: 66 },
    pitch: {
      scales: [
        ["messiaen-1", 0.3],
        ["major-pentatonic", 0.25],
        ["lydian", 0.25],
        ["dorian", 0.2],
      ],
    },
    harmony: {
      voicing: {
        types: [
          ["open", 0.6],
          ["wide", 0.4],
        ],
        notes: [4, 5],
      },
      rhythm: [
        [1, 0.5],
        [0.5, 0.5],
      ],
    },
    melody: { intervals: intervals(3, 2.5, 1, 0.5), chordToneRate: 0.55 },
    bass: {
      behaviour: [
        ["pedal", 0.7],
        ["root", 0.3],
      ],
    },
    texture: {
      roles: {
        chords: role("piano", "harp:0.6", "strings:0.5"),
        bass: role("piano", "contrabass:0.5"),
        lead: role("flute", "oboe:0.5", "piano:0.5"),
        pad: maybe("strings", "celesta:0.4"),
      },
    },
    mix: { space: 0.7 },
  }),
  card({
    id: "expressionism",
    summary:
      "free atonality: no tonic, wide leaps of sevenths and ninths, extreme registers and dynamics, short motivic cells with no repetition",
    tempo: { bpm: [40, 132], typical: 72 },
    pitch: { scales: [["chromatic", 1]] },
    harmony: {
      model: "modal",
      voicing: {
        types: [
          ["cluster", 0.5],
          ["wide", 0.5],
        ],
      },
    },
    melody: {
      intervals: ANGULAR,
      chordToneRate: 0.15,
      repetition: 0.15,
      ambitus: [14, 24],
    },
    expression: {
      dynamics: [0.1, 1],
      articulation: {
        lead: [
          ["accent", 0.5],
          ["staccato", 0.2],
          ["legato", 0.3],
        ],
      },
    },
    texture: {
      roles: {
        chords: role("strings", "piano:0.6"),
        bass: role("cello", "bassclarinet:0.5"),
        lead: role("violin", "clarinet:0.5", "vocal:0.3"),
      },
    },
  }),
  card({
    id: "twelve-tone",
    summary:
      "the tone row: all twelve pitch classes before any repeats, prime, inversion, retrograde and retrograde inversion forms, no tonal centre",
    tempo: { bpm: [48, 120], typical: 72 },
    pitch: { scales: [["chromatic", 1]] },
    harmony: {
      model: "modal",
      voicing: {
        types: [
          ["wide", 0.6],
          ["open", 0.4],
        ],
      },
    },
    melody: {
      intervals: ANGULAR,
      chordToneRate: 0.1,
      repetition: 0.2,
      row: "pitch",
    },
    texture: {
      kind: "polyphonic",
      roles: {
        chords: role("strings", "piano:0.5"),
        bass: role("cello", "piano:0.5"),
        lead: role("violin", "clarinet:0.5", "piano:0.4"),
        counter: maybe("viola", "bassoon:0.5"),
      },
    },
    form: { archetype: "serial" },
  }),
  card({
    id: "integral-serialism",
    summary:
      "series applied to pitch, duration, dynamics and attack alike; pointillist isolated events spread across registers",
    tempo: { bpm: [40, 112], typical: 60 },
    pitch: { scales: [["chromatic", 1]] },
    harmony: { model: "none" },
    melody: {
      row: "integral",
      intervals: ANGULAR,
      chordToneRate: 0,
      repetition: 0.05,
      density: [0.5, 2],
      ambitus: [18, 30],
      range: [40, 96],
    },
    bass: { behaviour: [["none", 1]] },
    expression: {
      dynamics: [0.05, 1],
      articulation: {
        lead: [
          ["staccato", 0.3],
          ["accent", 0.3],
          ["tenuto", 0.2],
          ["marcato", 0.2],
        ],
      },
    },
    texture: {
      kind: "polyphonic",
      roles: {
        chords: null,
        bass: null,
        lead: role("piano", "vibes:0.5"),
        counter: maybe("flute", "piano:0.5"),
      },
    },
    form: { archetype: "serial" },
  }),
  card({
    id: "neoclassicism",
    summary:
      "baroque and classical forms with wrong-note diatonicism, dry motor rhythm, polytonal shading and lean winds",
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["3/4", 0.2],
        ["5/4", 0.15],
        ["7/8", 0.15],
      ],
    },
    tempo: { bpm: [84, 144], typical: 112 },
    pitch: {
      scales: [
        ["major", 0.5],
        ["mixolydian", 0.25],
        ["lydian", 0.25],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["turnaround", 0.5],
        ["canon", 0.5],
      ],
      sevenths: 0.3,
    },
    melody: { intervals: intervals(3, 2, 1.5, 0.6), chordToneRate: 0.55 },
    bass: {
      behaviour: [
        ["walking", 0.5],
        ["ostinato", 0.5],
      ],
    },
    expression: {
      articulation: {
        lead: [
          ["staccato", 0.5],
          ["accent", 0.5],
        ],
      },
    },
    texture: {
      roles: {
        chords: role("strings", "piano:0.5"),
        bass: role("bassoon", "contrabass:0.6"),
        lead: role("oboe", "trumpet:0.5", "clarinet:0.5"),
      },
    },
  }),
  card({
    id: "primitivism",
    summary:
      "ostinato blocks, shifting irregular accents and additive meters, polychords (two triads stacked), percussive tutti stabs",
    meter: {
      signatures: [
        ["7/8", 0.3],
        ["5/8", 0.2],
        ["4/4", 0.3],
        ["3/4", 0.2],
      ],
      grouping: [
        [[2, 2, 3], 0.4],
        [[3, 2, 2], 0.3],
        [[2, 3], 0.3],
      ],
    },
    tempo: { bpm: [96, 160], typical: 126 },
    pitch: {
      scales: [
        ["dorian", 0.4],
        ["messiaen-2", 0.3],
        ["phrygian", 0.3],
      ],
    },
    harmony: {
      voicing: {
        types: [
          ["cluster", 0.5],
          ["quartal", 0.5],
        ],
      },
    },
    bass: { behaviour: [["ostinato", 1]] },
    rhythm: { onsets: { kick: grid("x..x..x.x..x.x..") } },
    expression: {
      dynamics: [0.4, 1],
      articulation: {
        chords: [
          ["marcato", 0.6],
          ["accent", 0.4],
        ],
      },
    },
    melody: { repetition: 0.8, intervals: intervals(4, 2, 0.6, 1) },
    texture: {
      roles: {
        kick: role("timpani", "drums:0.4"),
        chords: role("strings", "horn:0.5"),
        bass: role("contrabass", "bassoon:0.5"),
        lead: role("bassoon", "horn:0.5", "oboe:0.4"),
      },
    },
  }),
  card({
    id: "futurism",
    summary:
      "noise intoners and machine rhythm: mechanical repeated pulses, clusters, ostinato motor patterns, noise as material",
    tempo: { bpm: [100, 168], typical: 132 },
    pitch: {
      scales: [
        ["messiaen-7", 0.5],
        ["messiaen-2", 0.5],
      ],
    },
    harmony: { voicing: { types: [["cluster", 1]] } },
    rhythm: {
      onsets: {
        kick: grid("x.x.x.x.x.x.x.x."),
        snare: grid("..x...x...x...x."),
      },
    },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x.x.x.x.x.x.x.x.") },
    melody: {
      repetition: 0.9,
      chordToneRate: 0.3,
      intervals: intervals(3, 1, 1, 2),
    },
    texture: {
      kind: "interlocking",
      roles: {
        kick: role("drums"),
        snare: role("drums"),
        chords: role("organ", "piano:0.5"),
        bass: role("bassoon", "contrabass:0.5"),
        lead: role("trumpet", "granular:0.5"),
      },
    },
    mix: { fx: { lead: { distort: "crunch" } } },
  }),
  card({
    id: "folk-modernism",
    summary:
      "village modes made modern: acoustic (lydian-dominant) and dorian scales, Bulgarian additive meters 2+2+3, bitonal folk tune harmonisation",
    meter: {
      signatures: [
        ["7/8", 0.4],
        ["5/8", 0.2],
        ["2/4", 0.4],
      ],
      grouping: [
        [[2, 2, 3], 0.5],
        [[3, 2, 2], 0.2],
        [[2, 3], 0.3],
      ],
    },
    tempo: { bpm: [92, 168], typical: 132 },
    pitch: {
      scales: [
        ["lydian", 0.35],
        ["dorian", 0.35],
        ["mixolydian", 0.3],
      ],
    },
    melody: {
      repetition: 0.75,
      chordToneRate: 0.45,
      intervals: intervals(4, 2, 0.8, 0.8),
    },
    bass: {
      behaviour: [
        ["ostinato", 0.6],
        ["pedal", 0.4],
      ],
    },
    texture: {
      roles: {
        chords: role("strings", "piano:0.5"),
        bass: role("cello", "contrabass:0.5"),
        lead: role("violin", "clarinet:0.5"),
      },
    },
  }),
  card({
    id: "soviet-modernism",
    summary:
      "sardonic marches and tragic slow movements: octatonic flavour, chromatic lowered degrees, motor ostinato under brass, DSCH-type motto cells",
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["2/4", 0.3],
        ["3/4", 0.2],
      ],
      grouping: null,
    },
    tempo: { bpm: [56, 160], typical: 112 },
    pitch: {
      scales: [
        ["minor", 0.3],
        ["phrygian", 0.3],
        ["messiaen-2", 0.2],
        ["locrian", 0.2],
      ],
    },
    rhythm: { onsets: { snare: grid("x.xxx.x.x.xxx.x.") } },
    bass: {
      behaviour: [
        ["ostinato", 0.6],
        ["root-fifth", 0.4],
      ],
    },
    texture: {
      roles: {
        snare: maybe("drums"),
        chords: role("strings", "horn:0.5"),
        bass: role("contrabass", "tuba:0.5"),
        lead: role("trumpet", "violins:0.5", "clarinet:0.4"),
      },
    },
  }),
  card({
    id: "modal-mysticism",
    summary:
      "modes of limited transposition (messiaen 2 and 3), non-retrogradable rhythms and added values, birdsong-like lines, static ecstatic chords",
    meter: {
      signatures: [
        ["5/4", 0.3],
        ["7/8", 0.3],
        ["4/4", 0.4],
      ],
    },
    tempo: { bpm: [40, 88], typical: 56 },
    pitch: {
      scales: [
        ["messiaen-2", 0.5],
        ["messiaen-3", 0.3],
        ["messiaen-7", 0.2],
      ],
    },
    harmony: {
      rhythm: [
        [0.5, 0.5],
        [0.25, 0.5],
      ],
      voicing: { notes: [4, 6], types: [["wide", 1]] },
    },
    melody: { intervals: intervals(3, 3, 1.2, 0.4), chordToneRate: 0.4 },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      roles: {
        chords: role("organ", "piano:0.5"),
        bass: role("organ"),
        lead: role("flute", "piano:0.5", "glock:0.3"),
        pad: maybe("strings", "organ:0.5"),
      },
    },
    mix: { space: 0.8 },
  }),
  card({
    id: "american-modernism",
    summary:
      "open fifths and quartal spacing, hymn and folk quotations as types, polytonal collage, syncopated prairie and jazz-tinged rhythm",
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["3/4", 0.2],
        ["5/4", 0.15],
        ["7/8", 0.15],
      ],
    },
    pitch: {
      scales: [
        ["mixolydian", 0.3],
        ["major", 0.3],
        ["lydian", 0.2],
        ["major-pentatonic", 0.2],
      ],
    },
    harmony: {
      voicing: {
        types: [
          ["quartal", 0.6],
          ["open", 0.4],
        ],
      },
      rhythm: [
        [0.5, 0.6],
        [1, 0.4],
      ],
    },
    melody: { intervals: intervals(3, 2, 1.6, 0.5), chordToneRate: 0.55 },
    texture: {
      roles: {
        chords: role("strings", "horn:0.4"),
        bass: role("contrabass", "cello:0.5"),
        lead: role("trumpet", "clarinet:0.5", "oboe:0.4"),
      },
    },
  }),
  card({
    id: "neo-romantic",
    summary:
      "return to tonal lyricism after modernism: modal-tinged diatonic harmony, added sixths and ninths, broad string melody, slow harmonic rhythm",
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["3/4", 0.4],
      ],
      grouping: null,
    },
    tempo: { bpm: [48, 96], typical: 66 },
    pitch: {
      scales: [
        ["major", 0.4],
        ["minor", 0.3],
        ["dorian", 0.3],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["axis", 0.4],
        ["aeolian", 0.3],
        ["canon", 0.3],
      ],
      sevenths: 0.4,
      voicing: {
        types: [
          ["open", 0.6],
          ["wide", 0.4],
        ],
      },
    },
    melody: { intervals: intervals(4, 2.5, 1, 0.4), chordToneRate: 0.65 },
    texture: {
      roles: {
        chords: role("strings"),
        bass: role("contrabass", "cellos:0.5"),
        lead: role("violins", "oboe:0.4", "frenchhorn:0.3"),
      },
    },
  }),
]);

// ---------------------------------------------------------------------------
// Contemporary art music. References: Keith Potter, "Four Musical
// Minimalists" (2000); Julian Anderson, "A Provisional History of
// Spectral Music" (Contemporary Music Review 19, 2000); Kyle Gann, "The
// Arithmetic of Listening" (2019) for just intonation.

const CONTEMPORARY_LEAVES: readonly StyleCard[] = Object.freeze([
  card({
    id: "aleatoric",
    summary:
      "indeterminacy: chance-ordered events, mobile form, unmeasured gestures in a time frame, pitch fields instead of progressions",
    tempo: { bpm: [40, 96], typical: 60 },
    groove: { humanize: { timingMs: 30, velocity: 0.2 } },
    pitch: {
      scales: [
        ["messiaen-7", 0.5],
        ["messiaen-3", 0.5],
      ],
    },
    harmony: { rhythm: [[0.25, 1]] },
    melody: {
      intervals: ANGULAR,
      density: [0.5, 2],
      chordToneRate: 0.15,
      repetition: 0.2,
      contour: [
        ["wave", 0.5],
        ["flat", 0.5],
      ],
    },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      roles: {
        arp: null,
        chords: role("strings", "piano:0.5"),
        bass: role("contrabass", "cello:0.5"),
        lead: role("flute", "clarinet:0.6", "prepared:0.5"),
        counter: maybe("vibes", "harp:0.5"),
      },
    },
    expression: { dynamics: [0.1, 0.8] },
    form: { archetype: "mobile" },
    mix: { space: 0.6, loudness: "classical" },
  }),
  card({
    id: "sonorism",
    summary:
      "texture as subject: tone clusters, string glissando bands and tremolo masses, density and register replacing melody and harmony",
    tempo: { bpm: [40, 90], typical: 56 },
    pitch: {
      scales: [
        ["messiaen-7", 0.7],
        ["phrygian", 0.3],
      ],
    },
    harmony: {
      rhythm: [[0.25, 1]],
      voicing: { types: [["close", 1]], range: [40, 84], notes: [5, 6] },
    },
    melody: {
      density: [0, 1],
      chordToneRate: 0.4,
      intervals: intervals(4, 1, 0.3, 1.5),
      contour: [
        ["ascending", 0.5],
        ["descending", 0.5],
      ],
    },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      roles: {
        arp: null,
        chords: role("tremolo", "strings:0.6"),
        pad: role("strings", "violins:0.5"),
        bass: role("contrabasses", "cellos:0.5"),
        lead: role("violins", "tremolo:0.5"),
      },
    },
    expression: { dynamics: [0.05, 1] },
    mix: { space: 0.7, loudness: "classical" },
  }),
  card({
    id: "spectralism",
    summary:
      "harmony from the overtone series: a low fundamental pedal, partials stacked as wide chords, slow spectral interpolation instead of progression",
    tempo: { bpm: [40, 72], typical: 52 },
    pitch: {
      tuning: "harmonic-series",
      scales: [["harmonic-series", 1]],
    },
    harmony: {
      rhythm: [[0.25, 1]],
      sevenths: 0.8,
      voicing: { types: [["wide", 1]], range: [36, 88], notes: [5, 6] },
    },
    melody: {
      density: [0.5, 1],
      chordToneRate: 0.85,
      intervals: intervals(2, 2, 1, 1),
    },
    bass: { behaviour: [["pedal", 1]], range: [28, 43] },
    texture: {
      roles: {
        arp: null,
        drone: role("contrabass", "organ:0.5"),
        chords: role("strings", "organ:0.4"),
        pad: maybe("cloud", "strings:0.5"),
        bass: role("contrabass"),
        lead: role("horn", "clarinet:0.5", "cello:0.4"),
      },
    },
    expression: { dynamics: [0.15, 0.85] },
    mix: { space: 0.75, loudness: "classical" },
  }),
  card({
    id: "new-complexity",
    summary:
      "maximal notational density: irrational subdivisions, wide angular leaps, constantly shifting meter and dynamics, no repetition",
    meter: {
      signatures: [
        ["5/4", 0.3],
        ["7/8", 0.3],
        ["4/4", 0.2],
        ["3/4", 0.2],
      ],
      grouping: [
        [[3, 2, 2], 0.5],
        [[2, 3, 2], 0.5],
      ],
    },
    tempo: { bpm: [48, 80], typical: 60 },
    groove: { humanize: { timingMs: 22, velocity: 0.2 } },
    pitch: { scales: [["messiaen-7", 1]] },
    melody: {
      intervals: ANGULAR,
      density: [3, 4],
      chordToneRate: 0.1,
      repetition: 0.05,
      ambitus: [18, 30],
      range: [52, 92],
    },
    bass: {
      behaviour: [
        ["arpeggio", 0.5],
        ["walking", 0.5],
      ],
    },
    texture: {
      roles: {
        arp: null,
        chords: role("piano"),
        bass: role("cello", "bassclarinet:0.5"),
        lead: role("flute", "violin:0.6", "clarinet:0.5"),
        counter: role("piano", "viola:0.5"),
      },
    },
    expression: {
      dynamics: [0.1, 1],
      articulation: {
        lead: [
          ["accent", 0.4],
          ["staccato", 0.3],
          ["marcato", 0.3],
        ],
      },
    },
    mix: { space: 0.4, loudness: "classical" },
  }),
  card({
    id: "drone-minimalism",
    summary:
      "sustained just-intoned intervals over a held tonic drone: no progression, overtones heard as harmony, events measured in minutes",
    tempo: { bpm: [40, 66], typical: 48 },
    pitch: {
      tuning: "just",
      scales: [
        ["mixolydian", 0.6],
        ["major", 0.4],
      ],
    },
    harmony: { model: "drone", rhythm: [[0.25, 1]] },
    melody: {
      density: [0, 0.5],
      chordToneRate: 0.9,
      repetition: 0.9,
      intervals: intervals(2, 2, 2, 2),
      contour: [["flat", 1]],
    },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      kind: "heterophonic",
      roles: {
        arp: null,
        chords: null,
        drone: role("organ", "tanpura:0.6", "strings:0.4"),
        pad: maybe("cloud", "strings:0.5"),
        bass: role("contrabass", "organ:0.5"),
        lead: role("sing", "violin:0.5", "sax:0.3"),
      },
    },
    expression: { dynamics: [0.3, 0.7] },
    mix: { space: 0.85 },
  }),
  card({
    id: "pulse-minimalism",
    summary:
      "an unbroken sixteenth-note pulse, interlocking repeated cells shifting by phase, harmony changing only every few bars",
    tempo: { bpm: [100, 160], typical: 132 },
    pitch: {
      scales: [
        ["dorian", 0.35],
        ["mixolydian", 0.3],
        ["major", 0.35],
      ],
    },
    harmony: {
      rhythm: [
        [0.25, 0.5],
        [0.5, 0.5],
      ],
    },
    melody: { density: [2, 4], repetition: 0.9 },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x.x.x.x.x.x.x.x.") },
    rhythm: { onsets: { arp: grid("xxxxxxxxxxxxxxxx") } },
    texture: {
      kind: "interlocking",
      roles: {
        arp: role("marimba", "piano:0.6", "vibes:0.4"),
        chords: role("piano", "organ:0.4"),
        bass: role("piano", "bassclarinet:0.5"),
        lead: role("marimba", "clarinet:0.4", "vibes:0.4"),
      },
    },
    groove: { humanize: { timingMs: 2, velocity: 0.04 } },
    form: {
      roleMap: {
        intro: ["arp"],
        build: ["arp", "chords", "bass"],
        breakdown: ["arp", "bass"],
        outro: ["arp"],
      },
    },
  }),
  card({
    id: "additive-minimalism",
    summary:
      "additive process: a figure grows one note per repeat (1, 1+2, 1+2+3), arpeggiated triads over slow minor-key cycles",
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["6/8", 0.3],
        ["3/4", 0.2],
      ],
    },
    tempo: { bpm: [96, 160], typical: 132 },
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.5],
        ["andalusian", 0.5],
      ],
      sources: { presets: 3 },
      rhythm: [[0.5, 1]],
    },
    pitch: {
      scales: [
        ["minor", 0.7],
        ["dorian", 0.3],
      ],
    },
    melody: { density: [2, 4], repetition: 0.95, chordToneRate: 0.9 },
    bass: { behaviour: [["arpeggio", 1]] },
    rhythm: { onsets: { arp: grid("xxx.xxxxx.xxxxx.") } },
    texture: {
      roles: {
        arp: role("organ", "piano:0.6", "farfisa:0.3"),
        chords: role("organ", "strings:0.5"),
        bass: role("organ", "bassclarinet:0.4"),
        lead: role("sax", "flute:0.5", "sing:0.4"),
      },
    },
  }),
  card({
    id: "holy-minimalism",
    summary:
      "tintinnabuli: a stepwise melody voice around the tonic against a voice sounding only the tonic triad, slow chant-like tempo",
    tempo: { bpm: [40, 72], typical: 52 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["dorian", 0.4],
      ],
    },
    harmony: { model: "drone", rhythm: [[0.25, 1]] },
    melody: {
      intervals: STEPWISE,
      density: [0.5, 1],
      ambitus: [4, 7],
      chordToneRate: 0.5,
      repetition: 0.6,
      contour: [
        ["flat", 0.5],
        ["descending", 0.25],
        ["ascending", 0.25],
      ],
    },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        arp: null,
        chords: null,
        drone: role("strings", "organ:0.5"),
        bass: role("contrabass", "organ:0.5"),
        lead: role("choir", "violin:0.6", "cello:0.4"),
        counter: maybe("bell", "piano:0.6", "tubular:0.4"),
      },
    },
    expression: { dynamics: [0.2, 0.7] },
    mix: { space: 0.85, loudness: "classical" },
  }),
  card({
    id: "choral-art",
    summary:
      "contemporary choral: added-second and ninth clusters, slow homophonic chords, modal and lydian colour, a cappella or organ support",
    tempo: { bpm: [44, 84], typical: 60 },
    pitch: {
      scales: [
        ["major", 0.4],
        ["lydian", 0.3],
        ["dorian", 0.3],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["canon", 0.5],
        ["axis", 0.5],
      ],
      sevenths: 0.6,
      rhythm: [
        [1, 0.6],
        [0.5, 0.4],
      ],
      voicing: {
        types: [
          ["close", 0.7],
          ["open", 0.3],
        ],
        notes: [4, 6],
      },
    },
    melody: { intervals: CONJUNCT, density: [0.5, 1.5], chordToneRate: 0.7 },
    bass: { behaviour: [["root", 1]] },
    texture: {
      kind: "homophonic",
      roles: {
        arp: null,
        chords: role("choir", "chorale:0.6"),
        bass: role("choir", "organ:0.4"),
        lead: role("choir", "aah:0.5"),
        pad: maybe("organ"),
      },
    },
    expression: { dynamics: [0.15, 0.8] },
    mix: { space: 0.8, loudness: "classical" },
  }),
  card({
    id: "postminimalism",
    summary:
      "minimalist pulse loosened by lyric melody: tonal progressions return, repetition with variation, pop-tinged diatonic harmony",
    tempo: { bpm: [80, 140], typical: 108 },
    harmony: {
      model: "functional",
      presets: [
        ["axis", 0.4],
        ["sad-pop", 0.3],
        ["aeolian", 0.3],
      ],
      rhythm: [
        [0.5, 0.5],
        [1, 0.5],
      ],
    },
    pitch: {
      scales: [
        ["major", 0.5],
        ["minor", 0.3],
        ["mixolydian", 0.2],
      ],
    },
    melody: { repetition: 0.6, intervals: CONJUNCT, chordToneRate: 0.6 },
    bass: {
      behaviour: [
        ["arpeggio", 0.5],
        ["root", 0.5],
      ],
    },
    rhythm: { onsets: { arp: grid("x.xxx.xxx.xxx.xx") } },
    texture: {
      roles: {
        arp: maybe("piano", "marimba:0.5"),
        chords: role("strings", "piano:0.5"),
        bass: role("cello", "contrabass:0.5"),
        lead: role("violin", "clarinet:0.5", "piano:0.4"),
      },
    },
  }),
  card({
    id: "polystylism",
    summary:
      "postmodern collage: tonal and atonal idioms side by side, baroque sequence against cluster, abrupt style cuts between sections",
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["3/4", 0.3],
        ["5/4", 0.2],
      ],
    },
    tempo: { bpm: [60, 132], typical: 92 },
    pitch: {
      scales: [
        ["minor", 0.35],
        ["major", 0.25],
        ["messiaen-2", 0.2],
        ["messiaen-7", 0.2],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["canon", 0.4],
        ["andalusian", 0.3],
        ["minor-ii-v", 0.3],
      ],
      sevenths: 0.3,
    },
    melody: {
      intervals: intervals(2.5, 2, 2, 0.5),
      chordToneRate: 0.45,
      repetition: 0.4,
    },
    bass: {
      behaviour: [
        ["walking", 0.5],
        ["root", 0.5],
      ],
    },
    texture: {
      roles: {
        arp: null,
        chords: role("harpsichord", "strings:0.6", "prepared:0.4"),
        bass: role("cello", "contrabass:0.5"),
        lead: role("violin", "piano:0.5"),
        counter: maybe("prepared", "celesta:0.5"),
      },
    },
    expression: { dynamics: [0.1, 1] },
    mix: { space: 0.55, loudness: "classical" },
  }),
  card({
    id: "microtonal-art",
    summary:
      "beyond twelve equal steps: quarter tones in 24-EDO (Haba, Wyschnegradsky, Ives), neutral seconds, thirds and sixths sounding beside the tempered ones",
    tempo: { bpm: [48, 96], typical: 66 },
    // Quarter tones as note cents: each tempered degree keeps its shadow.
    pitch: { scales: [["quarter-tone", 1]] },
    harmony: {
      rhythm: [
        [0.5, 0.6],
        [1, 0.4],
      ],
      sevenths: 0,
    },
    melody: { intervals: CONJUNCT, chordToneRate: 0.6, density: [1, 2] },
    bass: {
      behaviour: [
        ["root", 0.6],
        ["pedal", 0.4],
      ],
    },
    texture: {
      roles: {
        arp: null,
        chords: role("organ", "strings:0.5"),
        bass: role("organ", "cello:0.5"),
        lead: role("violin", "clarinet:0.5"),
      },
    },
    mix: { space: 0.65, loudness: "classical" },
  }),
  card({
    id: "modern-classical",
    summary:
      "contemporary neoclassical: felt piano ostinato, string pads, aeolian loops with suspended chords, intimate close-miked dynamics",
    tempo: { bpm: [56, 96], typical: 72 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["major", 0.4],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.4],
        ["sad-pop", 0.3],
        ["axis", 0.3],
      ],
      sources: { presets: 3 },
      rhythm: [
        [1, 0.6],
        [0.5, 0.4],
      ],
      sevenths: 0.3,
    },
    melody: {
      intervals: CONJUNCT,
      chordToneRate: 0.7,
      density: [0.5, 2],
      repetition: 0.7,
    },
    bass: {
      behaviour: [
        ["root", 0.6],
        ["arpeggio", 0.4],
      ],
    },
    rhythm: { onsets: { arp: grid("x.x.x.x.x.x.x.x.") } },
    texture: {
      kind: "homophonic",
      roles: {
        arp: role("felt", "piano:0.6"),
        chords: role("strings", "felt:0.4"),
        bass: role("cello", "felt:0.4"),
        lead: role("felt", "cello:0.5", "violin:0.4"),
      },
    },
    expression: { dynamics: [0.15, 0.6] },
    mix: { space: 0.6 },
  }),
]);

// ---------------------------------------------------------------------------
// Bands and marches. References: Frank Battisti, "The Winds of Change"
// (2002); Paul E. Bierley, "John Philip Sousa: American Phenomenon" (1973)
// for march form; William Ross, "Pipe Band Drumming" (Scottish Pipe Band
// Association tutor) for the pipe-band snare idiom.

const BAND_LEAVES: readonly StyleCard[] = Object.freeze([
  card({
    id: "military-march",
    summary:
      "march form: strains of 16 bars, a trio in the subdominant, oom-pah bass on the strong beats, snare rudiments and a breakstrain",
    meter: {
      signatures: [
        ["2/4", 0.5],
        ["6/8", 0.5],
      ],
    },
    tempo: { bpm: [108, 132], typical: 120 },
    groove: { humanize: { timingMs: 4, velocity: 0.05 } },
    harmony: {
      model: "functional",
      chain: {
        I: [
          ["IV", 1.5],
          ["V", 2],
          ["V7/V", 0.6],
          ["vi", 0.5],
        ],
        IV: [
          ["I", 1.5],
          ["V", 1],
          ["iv", 0.3],
        ],
        iv: [["I", 1]],
        "V7/V": [["V", 3]],
        vi: [["ii", 1]],
        ii: [["V", 2]],
        V: [["I", 3]],
      },
      sources: { presets: 0.5, chain: 3 },
      rhythm: [[1, 1]],
    },
    melody: {
      intervals: intervals(4, 3, 1, 1.2),
      density: [1, 3],
      phraseBars: [[4, 1]],
      repetition: 0.6,
    },
    expression: {
      dynamics: [0.55, 1],
      articulation: {
        lead: [
          ["marcato", 0.4],
          ["staccato", 0.3],
          ["accent", 0.3],
        ],
      },
    },
    texture: {
      roles: {
        kick: role("drums"),
        snare: role("drums"),
        bass: role("tuba"),
        chords: role("horn", "trombone:0.5"),
        lead: role("cornet", "trumpet:0.6", "clarinet:0.4"),
        counter: maybe("trombone", "horn:0.5"),
      },
    },
  }),
  card({
    id: "brass-band",
    summary:
      "the cornet-and-saxhorn band: hymn-tune homophony, warm close brass voicing, plagal IV-I amens and slow-march or contest-piece strains",
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["3/4", 0.4],
      ],
    },
    tempo: { bpm: [66, 116], typical: 84 },
    rhythm: {
      onsets: { kick: grid("x.......x.......") },
      fills: { every: 8, density: [0.2, 0.4] },
    },
    harmony: {
      model: "functional",
      presets: [
        ["canon", 0.5],
        ["fifties", 0.3],
        ["turnaround", 0.2],
      ],
      cadences: [
        ["IV-I", 0.5],
        ["V-I", 0.5],
      ],
      sevenths: 0.15,
      voicing: { types: [["close", 1]], notes: [4, 4] },
    },
    melody: { intervals: CONJUNCT, chordToneRate: 0.75, density: [1, 2] },
    bass: {
      behaviour: [
        ["root", 0.6],
        ["walking", 0.4],
      ],
      onsets: grid("x...x...x...x..."),
    },
    texture: {
      roles: {
        kick: maybe("drums"),
        snare: null,
        bass: role("tuba"),
        chords: role("horn", "trombone:0.6"),
        lead: role("cornet"),
        counter: maybe("trombone", "horn:0.5"),
      },
    },
    expression: { dynamics: [0.3, 0.95] },
    mix: { space: 0.5 },
  }),
  card({
    id: "concert-wind-band",
    summary:
      "the symphonic wind ensemble: folk-song settings, modal mixture and bVII colour, chorale tutti against woodwind solos, mixed meter",
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["3/4", 0.3],
        ["5/4", 0.2],
      ],
    },
    tempo: { bpm: [60, 132], typical: 96 },
    rhythm: {
      onsets: {
        kick: grid("x..............."),
        snare: grid("............x..."),
      },
      fills: { every: 8, density: [0.2, 0.5] },
    },
    pitch: {
      scales: [
        ["major", 0.4],
        ["mixolydian", 0.3],
        ["dorian", 0.3],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["mixolydian-rock", 0.3],
        ["canon", 0.4],
        ["aeolian", 0.3],
      ],
      sevenths: 0.2,
      voicing: {
        types: [
          ["open", 0.6],
          ["wide", 0.4],
        ],
      },
    },
    melody: { intervals: CONJUNCT, chordToneRate: 0.65 },
    bass: {
      behaviour: [
        ["root", 0.6],
        ["pedal", 0.4],
      ],
      onsets: grid("x.......x......."),
    },
    texture: {
      roles: {
        kick: maybe("drums"),
        perc: maybe("timpani"),
        snare: maybe("drums"),
        bass: role("tuba", "bassoon:0.4"),
        chords: role("horn", "clarinet:0.6", "trombone:0.4"),
        lead: role("flute", "oboe:0.6", "clarinet:0.5", "trumpet:0.4"),
        counter: maybe("bassclarinet", "horn:0.5"),
      },
    },
    form: {
      plans: [[["intro", "verse", "bridge", "chorus", "outro"], 1]],
      archetype: "through-composed",
    },
    expression: { dynamics: [0.2, 1] },
    mix: { space: 0.55, loudness: "classical" },
  }),
  card({
    id: "pipe-band",
    summary:
      "Highland pipes and drums: a mixolydian chanter over a constant tonic-and-fifth drone, grace-note gracing, 2/4 and 6/8 marches, rolling snare",
    meter: {
      signatures: [
        ["2/4", 0.4],
        ["6/8", 0.4],
        ["3/4", 0.2],
      ],
    },
    tempo: { bpm: [80, 120], typical: 96 },
    groove: { humanize: { timingMs: 4, velocity: 0.06 } },
    pitch: { scales: [["mixolydian", 1]] },
    harmony: { model: "drone", rhythm: [[0.25, 1]] },
    melody: {
      intervals: intervals(5, 3, 1, 0.5),
      density: [2, 3],
      range: [67, 81],
      ambitus: [9, 9],
      chordToneRate: 0.5,
      repetition: 0.6,
    },
    bass: { behaviour: [["none", 1]] },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("x.xxx.xxx.xxx.xx"),
      },
      fills: { every: 4, density: [0.5, 0.8] },
    },
    texture: {
      kind: "heterophonic",
      roles: {
        kick: role("drums"),
        snare: role("drums"),
        bass: null,
        chords: null,
        counter: null,
        drone: role("reeds", "oboe:0.4"),
        lead: role("oboe", "tinwhistle:0.4"),
      },
    },
    expression: {
      dynamics: [0.7, 1],
      articulation: { lead: [["legato", 1]] },
    },
  }),
  card({
    id: "marching-band",
    summary:
      "field show and drumline: a cadence of snare rudiments and multi-tom grooves, unison brass hits, backbeat on 2 and 4 in the stand tunes",
    meter: {
      signatures: [
        ["4/4", 0.7],
        ["2/4", 0.3],
      ],
    },
    tempo: { bpm: [112, 148], typical: 128 },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("x.xxx.x.x.xxx.xx"),
        tom: grid("..x...x...x...x."),
      },
      fills: { every: 4, density: [0.5, 0.9] },
    },
    harmony: {
      model: "functional",
      presets: [
        ["axis", 0.4],
        ["mixolydian-rock", 0.3],
        ["fifties", 0.3],
      ],
    },
    melody: {
      density: [1, 3],
      repetition: 0.7,
      intervals: intervals(4, 3, 1, 1.5),
    },
    expression: {
      dynamics: [0.6, 1],
      articulation: {
        lead: [
          ["accent", 0.5],
          ["marcato", 0.5],
        ],
      },
    },
    texture: {
      roles: {
        kick: role("drums"),
        snare: role("drums"),
        tom: role("drums"),
        bass: role("tuba"),
        chords: role("trombone", "horn:0.5"),
        lead: role("trumpet", "altosax:0.4"),
      },
    },
    mix: { space: 0.3 },
  }),
]);

// ---------------------------------------------------------------------------
// Children's and functional. References: Patricia Shehan Campbell and Carol
// Scott-Kassner, "Music in Childhood" (4th ed., 2013); the Kodaly sol-mi-la
// sequence for the small singing range.

const CHILDRENS_LEAVES: readonly StyleCard[] = Object.freeze([
  card({
    id: "childrens-song",
    summary:
      "sing-along teaching song: sol-mi-la cells inside a sixth, call and echo, two-bar repeats, I-IV-V with a clear V-I close",
    tempo: { bpm: [92, 126], typical: 108 },
    melody: {
      ambitus: [4, 9],
      intervals: intervals(5, 3.5, 0.5, 1.5),
      chordToneRate: 0.8,
      repetition: 0.85,
      finals: [[0, 1]],
    },
    harmony: {
      model: "functional",
      chain: {
        I: [
          ["IV", 2],
          ["V", 2],
        ],
        IV: [
          ["I", 1],
          ["V", 1.5],
        ],
        V: [["I", 3]],
      },
      sources: { presets: 0.5, chain: 3 },
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("....x.......x..."),
      },
    },
    texture: {
      roles: {
        kick: maybe("drums"),
        snare: maybe("drums"),
        hat: null,
        bass: role("bass", "ebass:0.5"),
        chords: role("acoustic", "piano:0.6", "banjo:0.2"),
        lead: role("sing", "glockenspiel:0.5", "xylophone:0.4"),
      },
    },
  }),
  card({
    id: "novelty",
    summary:
      "comic and novelty song: oom-pah two-beat, ragtime-ish V7/V turnarounds, staccato toy timbres, a punch-line stop before the last chorus",
    tempo: { bpm: [104, 152], typical: 128 },
    harmony: {
      model: "functional",
      presets: [
        ["turnaround", 0.5],
        ["fifties", 0.5],
      ],
      chain: {
        I: [
          ["V7/V", 1],
          ["IV", 1],
          ["vi", 1],
        ],
        vi: [["V7/V", 1]],
        "V7/V": [["V", 2]],
        IV: [["V", 1]],
        V: [["I", 2]],
      },
      sources: { presets: 1, chain: 2 },
      sevenths: 0.4,
    },
    bass: {
      behaviour: [["root-fifth", 1]],
      onsets: grid("x.......x......."),
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("....x.......x..."),
        chords: grid("....x.......x..."),
      },
    },
    melody: { density: [2, 3], repetition: 0.7 },
    texture: {
      roles: {
        kick: role("drums"),
        snare: role("drums"),
        hat: null,
        bass: role("tuba", "upright:0.5"),
        chords: role("honkytonk", "banjo:0.5"),
        lead: role("xylophone", "toypiano:0.5", "clarinet:0.4"),
      },
    },
    expression: {
      dynamics: [0.5, 0.9],
      articulation: {
        lead: [
          ["staccato", 0.7],
          ["accent", 0.3],
        ],
      },
    },
  }),
  card({
    id: "wellness",
    summary:
      "meditation and relaxation: an unpulsed tonic drone, pentatonic bell tones that never resolve away, slow breath-length phrases, soft dynamics",
    tempo: { bpm: [48, 72], typical: 60 },
    groove: { humanize: { timingMs: 20, velocity: 0.08 } },
    pitch: {
      scales: [
        ["major-pentatonic", 0.6],
        ["lydian", 0.4],
      ],
    },
    harmony: { model: "drone", rhythm: [[0.25, 1]] },
    melody: {
      density: [0, 1],
      chordToneRate: 0.7,
      repetition: 0.7,
      phraseBars: [[4, 1]],
      contour: [["wave", 1]],
    },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      kind: "heterophonic",
      roles: {
        kick: null,
        snare: null,
        hat: null,
        chords: null,
        drone: role("singingbowl", "tanpura:0.5", "cloud:0.4"),
        pad: role("cloud", "strings:0.5"),
        bass: maybe("felt"),
        lead: role("bowl", "kalimba:0.5", "flute:0.4", "felt:0.4"),
      },
    },
    expression: { dynamics: [0.15, 0.55] },
    mix: { space: 0.9, loudness: "ambient" },
  }),
]);

// ---------------------------------------------------------------------------
// Experimental. References: Pierre Schaeffer, "Traite des objets musicaux"
// (1966) for the sound object and reduced listening; Denis Smalley,
// "Spectromorphology" (Organised Sound 2/2, 1997); Curtis Roads,
// "Microsound" (2001); Paul Hegarty, "Noise/Music" (2007).

const EXPERIMENTAL_LEAVES: readonly StyleCard[] = Object.freeze([
  card({
    id: "musique-concrete",
    summary:
      "the sound object: recorded material looped, cut and transposed on tape, reduced listening to timbre, closed grooves instead of themes",
    tempo: { bpm: [50, 100], typical: 72 },
    melody: { density: [0.5, 2], repetition: 0.6, chordToneRate: 0.2 },
    rhythm: { onsets: { perc: grid("x..x....x.x.....") } },
    texture: {
      roles: {
        drone: role("microloop", "granular:0.6"),
        pad: maybe("grains", "cloud:0.5"),
        lead: role("prepared", "microloop:0.5", "bell:0.4"),
        perc: maybe("prepared", "gong:0.5"),
      },
    },
    mix: {
      fx: { lead: { wobble: "tape" }, drone: { wobble: "seasick" } },
      space: 0.7,
    },
  }),
  card({
    id: "elektronische-musik",
    summary:
      "the studio as instrument: sine-tone and filtered-noise synthesis, serial ordering of pitch, duration and loudness, pointillist events",
    tempo: { bpm: [48, 96], typical: 66 },
    pitch: { scales: [["chromatic", 1]] },
    melody: {
      row: "integral",
      intervals: ANGULAR,
      density: [0.5, 2],
      repetition: 0.1,
      ambitus: [18, 30],
      range: [48, 96],
    },
    texture: {
      roles: {
        drone: role("triangle", "square:0.4"),
        pad: null,
        lead: role("triangle", "bell:0.6", "square:0.4"),
        counter: maybe("bell", "triangle:0.5"),
      },
    },
    expression: {
      dynamics: [0.1, 0.9],
      articulation: {
        lead: [
          ["staccato", 0.6],
          ["tenuto", 0.4],
        ],
      },
    },
    mix: { fx: { lead: { autofilter: "s&h" } }, space: 0.6 },
  }),
  card({
    id: "electroacoustic",
    summary:
      "acousmatic composition: spectromorphology of gesture and texture, an acoustic source spread into granular clouds, onset-sustain-decay shaped by space",
    tempo: { bpm: [44, 90], typical: 60 },
    melody: {
      density: [0.5, 1.5],
      contour: [
        ["ascending", 0.3],
        ["descending", 0.3],
        ["arch", 0.4],
      ],
    },
    texture: {
      roles: {
        drone: role("granular", "cloud:0.6"),
        pad: role("swarm", "grains:0.6"),
        lead: role("cello", "clarinet:0.5", "flute:0.4"),
      },
    },
    expression: { dynamics: [0.05, 0.9] },
    mix: {
      fx: { lead: { swell: "slow" }, pad: { chorus: "wide" } },
      space: 0.85,
    },
  }),
  card({
    id: "sound-collage",
    summary:
      "plunderphonics and cut-up: borrowed-sounding tonal fragments spliced against each other, abrupt edits, a lo-fi sampler loop as the glue",
    tempo: { bpm: [80, 120], typical: 96 },
    groove: { humanize: { timingMs: 12, velocity: 0.12 } },
    pitch: {
      scales: [
        ["major", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["fifties", 0.4],
        ["turnaround", 0.3],
        ["aeolian", 0.3],
      ],
      rhythm: [[1, 1]],
    },
    melody: { chordToneRate: 0.6, repetition: 0.7, density: [1, 2] },
    bass: { behaviour: [["root", 1]] },
    rhythm: {
      onsets: {
        kick: grid("x.....x...x....."),
        snare: grid("....x.......x..."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("lofi", ["kick", "snare"]),
        drone: null,
        chords: role("lofi", "microloop:0.5"),
        bass: role("upright", "bass:0.5"),
        lead: role("microloop", "honkytonk:0.5", "vibes:0.4"),
      },
    },
    mix: { fx: { chords: { crush: "lofi" } }, space: 0.4 },
  }),
  card({
    id: "free-improvisation",
    summary:
      "non-idiomatic improvisation: no shared meter, key or form, extended techniques, collective listening, density rising and thinning by consensus",
    tempo: { bpm: [60, 160], typical: 100 },
    groove: { humanize: { timingMs: 35, velocity: 0.25 } },
    pitch: {
      scales: [
        ["messiaen-7", 0.6],
        ["blues", 0.4],
      ],
    },
    melody: {
      intervals: ANGULAR,
      density: [1, 4],
      chordToneRate: 0.1,
      repetition: 0.15,
      ambitus: [14, 28],
    },
    bass: {
      behaviour: [
        ["walking", 0.5],
        ["none", 0.5],
      ],
    },
    texture: {
      kind: "polyphonic",
      roles: {
        drone: null,
        pad: null,
        bass: maybe("upright", "doublebass:0.5"),
        lead: role("sax", "tenorsax:0.5", "trumpet:0.3"),
        counter: role("prepared", "piano:0.5", "cello:0.4"),
      },
    },
    expression: {
      dynamics: [0.1, 1],
      articulation: {
        lead: [
          ["accent", 0.4],
          ["staccato", 0.3],
          ["legato", 0.3],
        ],
      },
    },
    mix: { space: 0.4 },
  }),
  card({
    id: "onkyo",
    summary:
      "onkyo and lowercase: near-silence, sine tones and small clicks at the threshold of hearing, long rests that are part of the piece",
    tempo: { bpm: [40, 72], typical: 52 },
    melody: { density: [0, 0.5], repetition: 0.5, contour: [["flat", 1]] },
    bass: { behaviour: [["none", 1]] },
    texture: {
      roles: {
        drone: role("triangle", "microloop:0.4"),
        pad: null,
        lead: role("triangle", "prepared:0.5", "bell:0.3"),
      },
    },
    expression: { dynamics: [0.03, 0.3] },
    mix: { space: 0.5, loudness: "ambient" },
  }),
  card({
    id: "drone",
    summary:
      "a single sustained sonority held for the whole piece: tonic and fifth pedal, slow beating partials, timbre and loudness as the only motion",
    tempo: { bpm: [40, 66], typical: 48 },
    pitch: {
      scales: [
        ["mixolydian", 0.4],
        ["dorian", 0.3],
        ["phrygian", 0.3],
      ],
    },
    harmony: { model: "drone", rhythm: [[0.25, 1]] },
    melody: { density: [0, 0.5], contour: [["flat", 1]], chordToneRate: 0.9 },
    texture: {
      roles: {
        drone: role("organ", "tanpura:0.5", "cloud:0.5"),
        pad: role("strings", "granular:0.6", "ebow:0.4"),
        lead: maybe("ebow", "cello:0.5"),
      },
    },
    expression: { dynamics: [0.3, 0.8] },
    mix: { fx: { drone: { bloom: "fifth" } }, space: 0.9, loudness: "ambient" },
  }),
  card({
    id: "harsh-noise",
    summary:
      "noise as material: saturated feedback, fold-back distortion and bit destruction, sudden cuts between walls of sound, maximum loudness",
    tempo: { bpm: [60, 180], typical: 120 },
    groove: { humanize: { timingMs: 30, velocity: 0.3 } },
    pitch: {
      scales: [
        ["locrian", 0.5],
        ["messiaen-7", 0.5],
      ],
    },
    melody: { density: [2, 4], intervals: ANGULAR, chordToneRate: 0.1 },
    texture: {
      roles: {
        drone: role("swarm", "saw:0.6"),
        pad: role("granular", "saw:0.5"),
        lead: role("saw", "square:0.5"),
      },
    },
    expression: { dynamics: [0.8, 1] },
    mix: {
      fx: {
        drone: { distort: "fold" },
        lead: { crush: "destroy" },
        pad: { distort: "fuzz" },
      },
      space: 0.2,
      loudness: "loud",
    },
  }),
  card({
    id: "harsh-noise-wall",
    summary:
      "the static wall: one dense unchanging noise texture for the whole duration, no gesture, no rhythm, no development, detail heard from inside",
    tempo: { bpm: [40, 80], typical: 60 },
    groove: { humanize: { timingMs: 8, velocity: 0.03 } },
    pitch: { scales: [["locrian", 1]] },
    harmony: { model: "drone", rhythm: [[0.25, 1]] },
    melody: { density: [0, 0.5], contour: [["flat", 1]] },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      roles: {
        drone: role("swarm", "saw:0.5"),
        pad: role("granular", "swarm:0.5"),
        bass: role("saw"),
        lead: role("swarm"),
      },
    },
    expression: { dynamics: [0.9, 1] },
    form: {
      plans: [[["intro", "verse", "outro"], 1]],
      archetype: "static",
    },
    mix: {
      fx: { drone: { distort: "fold" }, pad: { crush: "destroy" } },
      space: 0.1,
      loudness: "loud",
    },
  }),
  card({
    id: "power-electronics",
    summary:
      "power electronics: a slow distorted pulse, feedback squeal over a sub-bass pedal, a ranting processed voice, confrontational dynamics",
    tempo: { bpm: [60, 100], typical: 80 },
    rhythm: { onsets: { kick: grid("x.......x.......") } },
    pitch: {
      scales: [
        ["phrygian", 0.6],
        ["locrian", 0.4],
      ],
    },
    melody: { density: [1, 2], repetition: 0.6, intervals: ANGULAR },
    bass: { behaviour: [["pedal", 1]], range: [28, 40] },
    texture: {
      roles: {
        ...kitRoles("syn909", ["kick"]),
        drone: role("swarm", "saw:0.6"),
        bass: role("saw", "square:0.5"),
        lead: role("vocoder", "vocal:0.5"),
      },
    },
    expression: { dynamics: [0.7, 1] },
    mix: {
      fx: {
        kick: { distort: "crunch" },
        drone: { distort: "fuzz" },
        lead: { distort: "crunch" },
      },
      space: 0.3,
      loudness: "loud",
    },
  }),
  card({
    id: "field-recording",
    summary:
      "soundscape composition: a keynote ambience bed, sparse signal sounds and soundmarks, no meter, the place itself as the form",
    tempo: { bpm: [40, 80], typical: 56 },
    groove: { humanize: { timingMs: 40, velocity: 0.2 } },
    pitch: { scales: [["major-pentatonic", 1]] },
    melody: {
      density: [0, 1],
      intervals: intervals(1, 1, 2, 1),
      contour: [
        ["descending", 0.5],
        ["wave", 0.5],
      ],
    },
    bass: { behaviour: [["none", 1]] },
    texture: {
      roles: {
        drone: role("cloud", "grains:0.6"),
        pad: maybe("grains"),
        lead: role("whistle", "flute:0.5", "chimes:0.4"),
      },
    },
    expression: { dynamics: [0.1, 0.6] },
    mix: { space: 0.95, loudness: "ambient" },
  }),
  card({
    id: "sound-art",
    summary:
      "installation sound: loops of unequal length phasing against each other, no beginning or end, a room-filling texture heard by walking through it",
    tempo: { bpm: [48, 84], typical: 64 },
    pitch: {
      scales: [
        ["major-pentatonic", 0.5],
        ["lydian", 0.5],
      ],
    },
    melody: { density: [0.5, 1], repetition: 0.9, chordToneRate: 0.7 },
    rhythm: { onsets: { arp: grid("x....x....x..x..") } },
    texture: {
      kind: "interlocking",
      roles: {
        drone: role("cloud", "organ:0.5"),
        arp: role("musicbox", "bell:0.6", "kalimba:0.4"),
        lead: role("bell", "vibes:0.5"),
      },
    },
    mix: { fx: { arp: { chorus: "wide" } }, space: 0.85 },
  }),
  card({
    id: "sound-poetry",
    summary:
      "voice as material: phonemes and syllables without words, percussive consonants against held vowels, repetition and permutation",
    tempo: { bpm: [72, 132], typical: 100 },
    pitch: {
      scales: [
        ["minor-pentatonic", 0.5],
        ["phrygian", 0.5],
      ],
    },
    melody: {
      density: [2, 4],
      repetition: 0.8,
      intervals: intervals(3, 2, 0.6, 2),
      ambitus: [5, 12],
      range: [52, 72],
    },
    bass: { behaviour: [["none", 1]] },
    texture: {
      roles: {
        drone: maybe("ooh", "aah:0.5"),
        pad: null,
        lead: role("vocal", "sing:0.6"),
        counter: maybe("aah", "vocoder:0.5"),
      },
    },
    expression: {
      dynamics: [0.3, 1],
      articulation: {
        lead: [
          ["staccato", 0.5],
          ["accent", 0.3],
          ["tenuto", 0.2],
        ],
      },
    },
    mix: { space: 0.3 },
  }),
  card({
    id: "spoken-word",
    summary:
      "spoken word over a bed: speech-rhythm phrasing in a narrow low range, a walking bass and brushed kit under ii-V-I changes, space for the line to land",
    meter: { signatures: [["4/4", 1]] },
    tempo: { bpm: [72, 108], typical: 88 },
    groove: {
      swingRatio: [1.5, 2],
      humanize: { timingMs: 4, velocity: 0.08 },
    },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["ii-v-i", 0.6],
        ["minor-ii-v", 0.4],
      ],
      sevenths: 0.9,
    },
    melody: {
      density: [1, 3],
      repetition: 0.4,
      ambitus: [3, 7],
      range: [48, 64],
      intervals: STEPWISE,
    },
    bass: {
      behaviour: [["walking", 1]],
      walk: { chordToneOnOne: 0.9, chromaticApproach: 0.3 },
    },
    rhythm: {
      onsets: {
        hat: grid("x...x.x.x...x.x."),
        snare: grid("....x.......x..."),
      },
    },
    texture: {
      kind: "homophonic",
      roles: {
        hat: role("drums"),
        snare: maybe("drums"),
        drone: null,
        pad: null,
        chords: role("piano", "rhodes:0.5"),
        bass: role("upright"),
        lead: role("vocal"),
      },
    },
    expression: { dynamics: [0.3, 0.75] },
    mix: { space: 0.35 },
  }),
  card({
    id: "glitch-art",
    summary:
      "glitch and microsound: clicks, skips and buffer stutters as rhythm, grains under 100 ms, digital errors made into a groove",
    tempo: { bpm: [90, 140], typical: 120 },
    groove: { subdivision: 4, humanize: { timingMs: 2, velocity: 0.1 } },
    rhythm: {
      onsets: {
        hat: grid("x.xx.x..xx.x.x.x"),
        kick: grid("x.....x...x....."),
      },
    },
    melody: { density: [2, 4], repetition: 0.8 },
    texture: {
      roles: {
        ...kitRoles("electro", ["kick", "hat"]),
        drone: role("microloop", "grains:0.6"),
        pad: maybe("granular"),
        lead: role("microloop", "sparkle:0.5", "bell:0.4"),
      },
    },
    mix: {
      fx: { lead: { crush: "8-bit" }, hat: { crush: "lofi" } },
      space: 0.4,
    },
  }),
  card({
    id: "algorithmic",
    summary:
      "generative process: a rule set run on a seed, Markov steps over a pentatonic field, rotating patterns of coprime lengths, no two passes alike",
    tempo: { bpm: [72, 132], typical: 100 },
    pitch: {
      scales: [
        ["major-pentatonic", 0.5],
        ["minor-pentatonic", 0.3],
        ["lydian", 0.2],
      ],
    },
    harmony: { model: "modal", rhythm: [[0.5, 1]] },
    melody: {
      density: [1, 3],
      repetition: 0.5,
      chordToneRate: 0.5,
      intervals: STEPWISE,
    },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x....x....x....x") },
    rhythm: { onsets: { arp: grid("x..x..x.x..x..x.") } },
    texture: {
      kind: "interlocking",
      roles: {
        drone: null,
        arp: role("marimba", "sparkle:0.5", "bell:0.4"),
        pad: maybe("cloud"),
        bass: role("triangle", "marimba:0.5"),
        lead: role("vibes", "bell:0.5", "kalimba:0.4"),
      },
    },
    mix: { fx: { arp: { phaser: "slow" } }, space: 0.6 },
  }),
]);

// ---------------------------------------------------------------------------
// Screen and stage. References: Kathryn Kalinak, "Settling the Score"
// (1992) for the classical Hollywood model (leitmotif, mickey-mousing,
// the stinger); Karen Collins, "Game Sound" (2008) for loop-based and
// adaptive scoring; Ethan Mordden, "Anything Goes: A History of American
// Musical Theatre" (2013) for the 32-bar AABA show tune.

const SCREEN_LEAVES: readonly StyleCard[] = Object.freeze([
  card({
    id: "golden-age-score",
    summary:
      "the late-romantic studio orchestra: leitmotif themes over lush divided strings, chromatic-mediant shifts for scene changes, horn calls and V-I cadences that close each cue",
    meter: {
      signatures: [
        ["4/4", 0.7],
        ["3/4", 0.3],
      ],
    },
    tempo: { bpm: [60, 120], typical: 84 },
    pitch: {
      scales: [
        ["major", 0.5],
        ["minor", 0.3],
        ["lydian", 0.2],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["canon", 0.4],
        ["turnaround", 0.3],
        ["axis", 0.3],
      ],
      // The chromatic-mediant scene change: I to bVI and back through V.
      forms: [[["I", "bVI", "IV", "V"], 1]],
      sources: { presets: 2, forms: 1 },
      sevenths: 0.4,
      cadences: [
        ["V-I", 0.7],
        ["half", 0.3],
      ],
    },
    melody: {
      intervals: intervals(4, 2, 1.4, 0.4),
      chordToneRate: 0.65,
      contour: [["arch", 1]],
    },
    bass: {
      behaviour: [
        ["root", 0.6],
        ["root-fifth", 0.4],
      ],
    },
    rhythm: { onsets: { kick: grid("x...............") } },
    texture: {
      roles: {
        kick: maybe("timpani"),
        snare: null,
        chords: role("strings", "harp:0.4"),
        pad: maybe("strings", "horn:0.4"),
        bass: role("contrabass", "cello:0.5"),
        lead: role("violins", "frenchhorn:0.5", "trumpet:0.3"),
      },
    },
    expression: { dynamics: [0.3, 0.95] },
    mix: { space: 0.7 },
  }),
  card({
    id: "modern-orchestral-score",
    summary:
      "the thematic blockbuster score: a heroic theme with rising fourths and fifths, brass on lydian I-II colour, a string ostinato driving the action under it",
    tempo: { bpm: [72, 120], typical: 96 },
    pitch: {
      scales: [
        ["lydian", 0.4],
        ["major", 0.3],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.4],
        ["aeolian", 0.3],
        ["mixolydian-rock", 0.3],
      ],
    },
    melody: {
      intervals: intervals(2, 1.5, 2.5, 0.3, 1.3),
      chordToneRate: 0.7,
      contour: [
        ["ascending", 0.5],
        ["arch", 0.5],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x......."),
        snare: grid("....x.......x..."),
      },
    },
    texture: {
      roles: {
        kick: role("timpani"),
        snare: maybe("drums"),
        chords: role("strings", "horn:0.4"),
        bass: role("contrabasses", "tuba:0.4"),
        lead: role("frenchhorn", "trumpet:0.5", "violins:0.4"),
        counter: maybe("trombone", "cellos:0.5"),
      },
    },
    expression: { dynamics: [0.4, 1] },
    mix: { space: 0.65 },
  }),
  card({
    id: "hybrid-trailer",
    summary:
      "the trailer build: a pulsing low-string ostinato on one pedal, synth rises and braams, i-VI-III-VII under a three-act crescendo to a final hit",
    tempo: { bpm: [90, 140], typical: 120 },
    pitch: {
      scales: [
        ["minor", 0.7],
        ["phrygian", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.6],
        ["andalusian", 0.4],
      ],
      rhythm: [[1, 1]],
    },
    melody: {
      density: [0.5, 1.5],
      chordToneRate: 0.8,
      contour: [["ascending", 1]],
    },
    bass: {
      behaviour: [
        ["pedal", 0.6],
        ["ostinato", 0.4],
      ],
      range: [28, 43],
    },
    rhythm: {
      onsets: {
        kick: grid("x..x..x...x..x.."),
        snare: grid("....x.......x..."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("syn909", ["kick"]),
        snare: role("timpani"),
        arp: role("strings", "saw:0.5"),
        chords: role("strings", "choir:0.4"),
        pad: role("swarm", "choir:0.5"),
        bass: role("saw", "contrabasses:0.5"),
        lead: role("trombone", "frenchhorn:0.5", "choir:0.4"),
      },
    },
    expression: { dynamics: [0.3, 1] },
    form: {
      plans: [[["intro", "build", "chorus", "build", "chorus", "outro"], 1]],
      archetype: "three-act build",
      energy: { intro: 0.3, build: 0.7, chorus: 1 },
    },
    mix: { fx: { kick: { distort: "crunch" } }, space: 0.6, loudness: "loud" },
  }),
  card({
    id: "synth-score",
    summary:
      "the analogue synth score: a sequenced eighth-note ostinato on a minor pedal, slow string-machine pads, a sparse square-wave theme, drum-machine pulse",
    tempo: { bpm: [80, 130], typical: 104 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["dorian", 0.3],
        ["phrygian", 0.2],
      ],
    },
    harmony: {
      model: "modal",
      rhythm: [
        [1, 0.5],
        [2, 0.5],
      ],
    },
    melody: { density: [0.5, 1.5], repetition: 0.6, chordToneRate: 0.7 },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x.x.x.x.x.x.x.x.") },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("....x.......x..."),
        arp: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("syn808", ["kick", "snare"]),
        arp: role("saw", "square:0.5"),
        chords: null,
        pad: role("strings", "saw:0.5"),
        bass: role("saw", "square:0.5"),
        lead: role("square", "triangle:0.5"),
      },
    },
    mix: { fx: { pad: { chorus: "wide" } }, space: 0.55 },
  }),
  card({
    id: "western-score",
    summary:
      "the spaghetti-western palette: a whistled or twangy electric theme in minor, open-fifth guitar strums, the andalusian descent, a galloping hoof rhythm",
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["2/4", 0.4],
      ],
    },
    tempo: { bpm: [80, 140], typical: 112 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["dorian", 0.4],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["andalusian", 0.6],
        ["aeolian", 0.4],
      ],
      cadences: [["V-i", 1]],
    },
    melody: {
      intervals: intervals(2, 1.5, 2.5, 0.6),
      chordToneRate: 0.7,
      repetition: 0.5,
    },
    bass: { behaviour: [["root-fifth", 1]] },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x.....x."),
        snare: grid("....x.......x..."),
      },
    },
    texture: {
      roles: {
        kick: role("drums"),
        snare: maybe("drums"),
        chords: role("nylon", "steel:0.5"),
        pad: maybe("choir"),
        bass: role("bassguitar", "contrabass:0.5"),
        lead: role("whistle", "electric:0.5", "trumpet:0.4"),
      },
    },
    mix: { fx: { lead: { tremolo: "gentle" } }, space: 0.75 },
  }),
  card({
    id: "horror-score",
    summary:
      "suspense scoring: a tritone pedal, chromatic cluster stabs, the stinger after silence, high tremolo strings and a semitone-neighbour motif that never resolves",
    tempo: { bpm: [50, 110], typical: 72 },
    pitch: {
      scales: [
        ["locrian", 0.4],
        ["phrygian", 0.3],
        ["messiaen-2", 0.3],
      ],
    },
    harmony: { model: "drone", rhythm: [[2, 1]] },
    melody: {
      intervals: intervals(4, 0.5, 1, 1),
      density: [0.5, 1.5],
      repetition: 0.7,
      chordToneRate: 0.3,
      ambitus: [3, 8],
    },
    bass: { behaviour: [["pedal", 1]], range: [28, 40] },
    rhythm: { onsets: { kick: grid("x...............") } },
    texture: {
      roles: {
        kick: maybe("timpani"),
        snare: null,
        chords: role("tremolo", "strings:0.5"),
        pad: role("cloud", "choir:0.4"),
        bass: role("contrabasses", "cellos:0.5"),
        lead: role("violins", "prepared:0.5", "musicbox:0.4"),
      },
    },
    expression: { dynamics: [0.05, 1] },
    mix: { space: 0.8 },
  }),
  card({
    id: "ambient-score",
    summary:
      "the minimal prestige score: a held pedal under slow modal chords, a two-note felt-piano cell repeated with space, cello sustains, swells instead of themes",
    tempo: { bpm: [50, 84], typical: 66 },
    pitch: {
      scales: [
        ["dorian", 0.4],
        ["minor", 0.3],
        ["lydian", 0.3],
      ],
    },
    harmony: {
      model: "modal",
      rhythm: [
        [2, 0.6],
        [4, 0.4],
      ],
    },
    melody: {
      density: [0.5, 1],
      repetition: 0.8,
      chordToneRate: 0.8,
      intervals: STEPWISE,
    },
    bass: { behaviour: [["pedal", 1]] },
    rhythm: { onsets: { kick: grid("x...............") } },
    texture: {
      roles: {
        kick: null,
        snare: null,
        chords: role("felt", "strings:0.4"),
        pad: role("cloud", "strings:0.5"),
        bass: role("cello", "contrabass:0.5"),
        lead: role("felt", "cello:0.5"),
      },
    },
    expression: { dynamics: [0.15, 0.6] },
    mix: { fx: { pad: { swell: "slow" } }, space: 0.85, loudness: "ambient" },
  }),
  card({
    id: "library-music",
    summary:
      "production music built to edit: steady tempo, four- and eight-bar blocks that can be cut anywhere, a clean I-V-vi-IV bed and a short ident hook",
    meter: { signatures: [["4/4", 1]] },
    tempo: { bpm: [104, 128], typical: 118 },
    groove: { humanize: { timingMs: 4, velocity: 0.06 } },
    pitch: {
      scales: [
        ["major", 0.8],
        ["mixolydian", 0.2],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["axis", 0.5],
        ["fifties", 0.3],
        ["mixolydian-rock", 0.2],
      ],
      rhythm: [[1, 1]],
    },
    melody: { repetition: 0.8, chordToneRate: 0.75, density: [1, 2] },
    bass: {
      behaviour: [
        ["root", 0.6],
        ["root-fifth", 0.4],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
        shaker: grid("xxxxxxxxxxxxxxxx"),
        clap: grid("....x.......x..."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "snare", "hat", "shaker"], ["clap"]),
        chords: role("steel", "piano:0.3"),
        bass: role("bassguitar"),
        lead: role("glockenspiel", "whistle:0.4", "xylophone:0.3"),
      },
    },
    form: {
      plans: [[["intro", "verse", "chorus", "verse", "chorus", "outro"], 1]],
      archetype: "edit blocks",
    },
    mix: { space: 0.35 },
  }),
  card({
    id: "incidental",
    summary:
      "underscore and cue: short phrases that sit under dialogue, a sustained bed with a motif that enters and exits, half cadences that leave the scene open",
    tempo: { bpm: [60, 110], typical: 84 },
    pitch: {
      scales: [
        ["major", 0.4],
        ["minor", 0.4],
        ["dorian", 0.2],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["sad-pop", 0.4],
        ["axis", 0.3],
        ["aeolian", 0.3],
      ],
      cadences: [
        ["half", 0.7],
        ["IV-I", 0.3],
      ],
    },
    melody: { density: [0.5, 1.5], chordToneRate: 0.7, range: [55, 79] },
    rhythm: { onsets: { kick: grid("x...............") } },
    texture: {
      roles: {
        kick: null,
        snare: null,
        chords: role("strings", "piano:0.5"),
        bass: role("cello", "contrabass:0.5"),
        lead: role("clarinet", "oboe:0.5", "piano:0.4"),
      },
    },
    expression: { dynamics: [0.15, 0.6] },
    mix: { space: 0.6 },
  }),
  card({
    id: "sound-design",
    summary:
      "designed sound rather than music: risers, impacts and whooshes built from noise and granular clouds, a sub hit on the cut, no tune",
    tempo: { bpm: [60, 120], typical: 90 },
    pitch: {
      scales: [
        ["phrygian", 0.5],
        ["locrian", 0.5],
      ],
    },
    harmony: { model: "drone", rhythm: [[4, 1]] },
    melody: {
      density: [0.5, 1],
      contour: [
        ["ascending", 0.6],
        ["descending", 0.4],
      ],
      chordToneRate: 0.4,
      intervals: ANGULAR,
    },
    bass: { behaviour: [["pedal", 1]], range: [24, 36] },
    rhythm: { onsets: { kick: grid("x...........x...") } },
    texture: {
      roles: {
        ...kitRoles("syn808", ["kick"]),
        snare: null,
        chords: null,
        pad: role("swarm", "granular:0.6"),
        drone: role("cloud", "grains:0.5"),
        bass: role("saw", "triangle:0.5"),
        lead: role("granular", "swarm:0.5", "gong:0.4"),
      },
    },
    mix: { fx: { lead: { autofilter: "hpf-rise" } }, space: 0.7 },
  }),
  card({
    id: "musical-theatre-golden",
    summary:
      "the golden-age show tune: 32-bar AABA refrain with a verse, I-vi-ii-V turnarounds, a pit orchestra with brass punctuation, the bridge modulating up",
    meter: {
      signatures: [
        ["4/4", 0.7],
        ["3/4", 0.3],
      ],
    },
    tempo: { bpm: [90, 160], typical: 120 },
    groove: { swingRatio: [1, 1.5] },
    pitch: { scales: [["major", 1]] },
    harmony: {
      model: "functional",
      presets: [
        ["turnaround", 0.5],
        ["fifties", 0.3],
        ["ii-v-i", 0.2],
      ],
      sevenths: 0.6,
      cadences: [
        ["V-I", 0.6],
        ["ii-V-I", 0.4],
      ],
    },
    melody: {
      intervals: intervals(4, 2, 1, 0.6),
      chordToneRate: 0.7,
      repetition: 0.6,
    },
    bass: {
      behaviour: [
        ["root-fifth", 0.7],
        ["walking", 0.3],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("....x.......x..."),
      },
    },
    texture: {
      roles: {
        kick: role("drums"),
        snare: role("drums"),
        chords: role("piano", "strings:0.5"),
        counter: maybe("trumpet", "trombone:0.5", "clarinet:0.4"),
        bass: role("upright", "tuba:0.3"),
        lead: role("vocal", "violins:0.4"),
      },
    },
    form: {
      plans: [
        [
          ["intro", "verse", "chorus", "chorus", "bridge", "chorus", "outro"],
          1,
        ],
      ],
      archetype: "aaba",
    },
    mix: { space: 0.5 },
  }),
  card({
    id: "contemporary-musical",
    summary:
      "the pop and rock musical: verse-chorus songs with a key change for the eleven-o'clock number, rhythm section plus strings, belt range in the lead",
    meter: { signatures: [["4/4", 1]] },
    tempo: { bpm: [66, 132], typical: 92 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["axis", 0.4],
        ["sad-pop", 0.3],
        ["canon", 0.3],
      ],
    },
    melody: {
      chordToneRate: 0.65,
      contour: [
        ["ascending", 0.5],
        ["arch", 0.5],
      ],
      range: [57, 81],
    },
    bass: {
      behaviour: [
        ["root", 0.6],
        ["root-fifth", 0.4],
      ],
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
        ...kitRoles("acoustic", ["kick", "snare", "hat"]),
        chords: role("piano", "strings:0.5"),
        pad: maybe("strings"),
        bass: role("bassguitar"),
        lead: role("vocal"),
      },
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
            "bridge",
            "chorus",
            "outro",
          ],
          1,
        ],
      ],
    },
    mix: { space: 0.45 },
  }),
  card({
    id: "cabaret",
    summary:
      "Weimar cabaret: a sardonic minor-key song over an oom-pah piano, chromatic passing chords and added sixths, a muted trumpet and clarinet commentary",
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["3/4", 0.4],
      ],
    },
    tempo: { bpm: [80, 140], typical: 108 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["harmonic-minor", 0.5],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["minor-ii-v", 0.5],
        ["andalusian", 0.5],
      ],
      sevenths: 0.6,
      cadences: [["V-i", 1]],
    },
    melody: { intervals: intervals(3, 2, 1.2, 0.8), chordToneRate: 0.6 },
    bass: { behaviour: [["root-fifth", 1]] },
    rhythm: { onsets: { chords: grid("....x.......x...") } },
    texture: {
      roles: {
        kick: null,
        snare: null,
        chords: role("honkytonk", "piano:0.6"),
        counter: maybe("clarinet", "trumpet:0.5"),
        bass: role("tuba", "upright:0.5"),
        lead: role("vocal", "violin:0.4"),
      },
    },
    expression: { dynamics: [0.3, 0.85] },
    mix: { space: 0.3 },
  }),
  card({
    id: "vaudeville",
    summary:
      "the variety stage: a bright two-beat in major, ragtime syncopation in the melody, oom-pah tuba and banjo, stop-time breaks for the act",
    meter: {
      signatures: [
        ["2/4", 0.5],
        ["4/4", 0.5],
      ],
    },
    tempo: { bpm: [100, 170], typical: 132 },
    groove: { humanize: { timingMs: 8, velocity: 0.1 } },
    pitch: { scales: [["major", 1]] },
    harmony: {
      model: "functional",
      presets: [
        ["turnaround", 0.6],
        ["fifties", 0.4],
      ],
      sevenths: 0.5,
      cadences: [["V-I", 1]],
    },
    melody: {
      intervals: intervals(3, 2.5, 1, 0.8),
      chordToneRate: 0.65,
      repetition: 0.6,
    },
    bass: { behaviour: [["root-fifth", 1]] },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("....x.......x..."),
      },
    },
    texture: {
      roles: {
        kick: role("drums"),
        snare: maybe("drums"),
        chords: role("banjo", "honkytonk:0.6"),
        counter: maybe("trombone", "clarinet:0.5"),
        bass: role("tuba"),
        lead: role("cornet", "clarinet:0.5", "vocal:0.4"),
      },
    },
    mix: { space: 0.25 },
  }),
  card({
    id: "ballet-score",
    summary:
      "music for dance: square eight-bar phrases a dancer can count, waltz and march numbers, a celesta or harp solo variation, the grand pas building to a coda",
    meter: {
      signatures: [
        ["3/4", 0.5],
        ["4/4", 0.3],
        ["2/4", 0.2],
      ],
    },
    tempo: { bpm: [72, 150], typical: 112 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["canon", 0.4],
        ["turnaround", 0.3],
        ["axis", 0.3],
      ],
      cadences: [
        ["V-I", 0.7],
        ["half", 0.3],
      ],
    },
    melody: {
      intervals: intervals(4, 2, 1.2, 0.4),
      chordToneRate: 0.7,
      repetition: 0.55,
    },
    bass: {
      behaviour: [
        ["root", 0.5],
        ["root-fifth", 0.5],
      ],
    },
    rhythm: { onsets: { kick: grid("x...............") } },
    texture: {
      roles: {
        kick: maybe("timpani"),
        snare: null,
        chords: role("strings", "harp:0.5"),
        bass: role("contrabass", "cellos:0.5"),
        lead: role("violins", "celeste:0.4", "oboe:0.4", "flute:0.4"),
      },
    },
    expression: { dynamics: [0.3, 0.9] },
    mix: { space: 0.65 },
  }),
  card({
    id: "orchestral-game",
    summary:
      "the adaptive game score: loopable sections that layer up with the action (stems in, stems out), an ostinato bed under a heroic theme, seamless loop points",
    tempo: { bpm: [110, 160], typical: 132 },
    pitch: {
      scales: [
        ["minor", 0.4],
        ["dorian", 0.3],
        ["lydian", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.4],
        ["axis", 0.3],
        ["dorian-vamp", 0.3],
      ],
    },
    melody: { chordToneRate: 0.7, repetition: 0.6 },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x......."),
        snare: grid("....x.......x..."),
      },
    },
    texture: {
      roles: {
        kick: role("timpani"),
        snare: maybe("drums"),
        arp: role("strings", "harp:0.3"),
        chords: role("strings", "choir:0.4"),
        bass: role("contrabasses", "trombone:0.4"),
        lead: role("frenchhorn", "violins:0.5", "flute:0.4"),
      },
    },
    form: {
      plans: [[["intro", "verse", "chorus", "verse", "chorus"], 1]],
      archetype: "loop",
    },
    mix: { space: 0.6 },
  }),
  card({
    id: "jrpg",
    summary:
      "the console RPG: a fast battle theme on a driving eighth-note bass ostinato, the vi-IV-I-V loop and aeolian i-VI-III-VII, a soaring lead over sixteenth-note arpeggios",
    meter: { signatures: [["4/4", 1]] },
    tempo: { bpm: [110, 170], typical: 144 },
    groove: { humanize: { timingMs: 3, velocity: 0.06 } },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["major", 0.3],
        ["harmonic-minor", 0.2],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["sad-pop", 0.4],
        ["aeolian", 0.3],
        ["canon", 0.3],
      ],
      sevenths: 0.4,
      rhythm: [[1, 1]],
    },
    melody: {
      density: [2, 4],
      chordToneRate: 0.65,
      contour: [
        ["arch", 0.5],
        ["ascending", 0.5],
      ],
    },
    bass: {
      behaviour: [
        ["ostinato", 0.6],
        ["octave", 0.4],
      ],
      onsets: grid("x.x.x.x.x.x.x.x."),
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x......."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
        arp: grid("xxxxxxxxxxxxxxxx"),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "snare", "hat"]),
        arp: role("piano", "harp:0.5", "square:0.4"),
        chords: role("strings"),
        bass: role("bassguitar", "square:0.4"),
        lead: role("violins", "square:0.5", "electric@lead:0.4"),
      },
    },
    mix: { space: 0.45 },
  }),
  card({
    id: "anime-score",
    summary:
      "the anime opening and score: royal-road changes (IV-V-iii-vi), fast verses into a soaring chorus a fourth up, piano and strings over a busy kit",
    meter: { signatures: [["4/4", 1]] },
    tempo: { bpm: [120, 180], typical: 150 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      model: "functional",
      presets: [
        ["sad-pop", 0.4],
        ["canon", 0.3],
        ["axis", 0.3],
      ],
      // The royal road (oudou shinkou): IV-V-iii-vi.
      forms: [[["IV", "V", "iii", "vi"], 1]],
      sources: { presets: 1, forms: 2 },
      sevenths: 0.5,
      rhythm: [[1, 1]],
    },
    melody: {
      density: [2, 4],
      chordToneRate: 0.6,
      range: [60, 84],
      contour: [["ascending", 1]],
    },
    bass: {
      behaviour: [
        ["octave", 0.6],
        ["root", 0.4],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x......."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        ...kitRoles("acoustic", ["kick", "snare", "hat"]),
        chords: role("piano", "electric@crunch:0.5"),
        pad: maybe("strings"),
        bass: role("bassguitar"),
        lead: role("vocal", "violins:0.4"),
      },
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
            "outro",
          ],
          1,
        ],
      ],
    },
    mix: { space: 0.4 },
  }),
]);

// @@EXPORT
export const ART_CARDS: readonly StyleCard[] = Object.freeze([
  ...BRANCH_CARDS,
  ...EARLY_LEAVES,
  ...BAROQUE_LEAVES,
  ...ROMANTIC_LEAVES,
  ...MODERN_LEAVES,
  ...CONTEMPORARY_LEAVES,
  ...EXPERIMENTAL_LEAVES,
  ...SCREEN_LEAVES,
  ...BAND_LEAVES,
  ...CHILDRENS_LEAVES,
]);
