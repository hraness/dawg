/**
 * Art, experimental, screen and functional styles (quality-08 family
 * `art`). Root and branch cards set the theory each branch shares; the
 * family lane adds a leaf by appending a card whose id is a taxonomy leaf.
 */

import { grid, intervals, kit, maybe, role } from "./parts.ts";
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
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["3/4", 0.5],
      ],
    },
    tempo: { bpm: [60, 112], typical: 84 },
    groove: { swingRatio: [1.4, 1.8] },
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
    melody: { repetition: 0.8, density: [2, 4] },
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

// @@EXPORT
export const ART_CARDS: readonly StyleCard[] = Object.freeze([
  ...BRANCH_CARDS,
  ...EARLY_LEAVES,
  ...BAROQUE_LEAVES,
]);
