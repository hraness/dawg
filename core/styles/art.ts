/**
 * Art, experimental, screen and functional styles (quality-08 family
 * `art`). Root and branch cards set the theory each branch shares; the
 * family lane adds a leaf by appending a card whose id is a taxonomy leaf.
 */

import { grid, intervals, maybe, role } from "./parts.ts";
import { card, type StyleCard } from "./schema.ts";

const CONJUNCT = intervals(5, 2, 0.6, 0.6);

export const ART_CARDS: readonly StyleCard[] = Object.freeze([
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
