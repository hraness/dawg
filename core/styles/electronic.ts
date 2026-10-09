/**
 * Electronic dance, ambient and experimental electronic (quality-08 family
 * `electronic`, every branch except `breakbeat-family`).
 *
 * The root card holds what all machine music shares: a quantised 16-step
 * grid, 8-bar hypermeter, loop harmony, a build/drop form whose breakdown
 * drops the kit, synth voices and a club master. Each family card holds its
 * defining pattern (four-on-the-floor with off-beat hats for house, a
 * rolling off-beat bass for trance, distorted kicks for hardcore, no kit
 * for ambient) and each leaf holds only its deltas. The `summary` of every
 * card is its theory note: the concepts that define the style, searchable
 * from `/style search`.
 *
 * Theory, not material: every rhythm is an abstract step grid and every
 * progression a functional grammar or a modal vamp. No melody, bassline,
 * lyric or sample of any record is encoded.
 *
 * Reference (root): Mark J. Butler, "Unlocking the Groove: Rhythm, Meter,
 * and Musical Design in Electronic Dance Music" (Indiana UP, 2006).
 */

import { grid, intervals, kit, maybe, role } from "./parts.ts";
import {
  card,
  type RoleName,
  type RoleTexture,
  type SectionKind,
  type StyleCard,
} from "./schema.ts";

// ---------------------------------------------------------------------------
// Shared grids (16 steps = one 4/4 bar of 16ths)

/** Four-on-the-floor: a kick on every beat. */
const FOUR_FLOOR = grid("x...x...x...x...");
/** Backbeat: beats 2 and 4. */
const BACKBEAT = grid("....x.......x...");
/** Half-time backbeat: beat 3 only. */
const HALF_TIME = grid("........x.......");
/** Off-beat 8th: the "and" of every beat. */
const OFFBEAT = grid("..x...x...x...x.");
const EIGHTHS = grid("x.x.x.x.x.x.x.x.");
const SIXTEENTHS = grid("xxxxxxxxxxxxxxxx");
/** Rolling kick-bass: three 16ths after each kick, never on it. */
const ROLLING = grid(".xxx.xxx.xxx.xxx");
/** Tresillo: 3+3+2 sixteenths, twice per bar. */
const TRESILLO = grid("x..x..x.x..x..x.");
/** Syncopated electro kick (the 808 "boom ... boom-boom" shape). */
const ELECTRO_KICK = grid("x.....x...x.x...");
/** Two-step broken kick for downtempo and breaks. */
const BROKEN_KICK = grid("x.....x...x.....");
/**
 * Gallop: the off-beat 8th plus the 16th after it, the rolling bass of
 * progressive trance and melodic techno.
 */
const GALLOP = grid("..xx..xx..xx..xx");
/** Pedal: one held note from the downbeat of each bar. */
const DOWNBEAT = grid("x...............");
/** Gated offbeat 16th shaker for house. */
const SHAKER_16 = grid("x.xxx.xxx.xxx.xx");

// ---------------------------------------------------------------------------
// Kits and voices

const voicesOf = (...kits: [string, number][]) =>
  Object.freeze(kits.map(([name, w]) => kit(name, w)));
const machine = (required: boolean, ...kits: [string, number][]) =>
  Object.freeze({ required, voices: voicesOf(...kits) });
const MACHINE = machine(true, ["syn909", 1], ["syn808", 0.4]);
const MACHINE_OPT = machine(false, ["syn909", 1], ["syn808", 0.4]);
const K808 = machine(true, ["syn808", 1]);
const K808_OPT = machine(false, ["syn808", 1]);
const ELECTRO = machine(true, ["electro", 1], ["syn808", 0.5]);
const LOFI = machine(true, ["lofi", 1]);
const LOFI_OPT = machine(false, ["lofi", 1]);
const TRAP = machine(true, ["trap", 1]);
const ACOUSTIC = machine(true, ["acoustic", 1]);
const ACOUSTIC_OPT = machine(false, ["acoustic", 1]);

/** Kit roles on one kit voice; the drum track takes the first role's kit. */
function kitOn(
  voice: RoleTexture,
  roles: readonly RoleName[],
  optional: readonly RoleName[] = [],
): Record<string, RoleTexture> {
  const out: Record<string, RoleTexture> = {};
  for (const r of roles) out[r] = voice;
  for (const r of optional)
    out[r] = Object.freeze({ required: false, voices: voice.voices });
  return out;
}

/** No kit at all (ambient textures). */
const NO_KIT = Object.freeze({
  kick: null,
  snare: null,
  clap: null,
  rim: null,
  tom: null,
  hat: null,
  openhat: null,
  perc: null,
  shaker: null,
});

/**
 * Dance form: the breakdown drops the kit and bass (the defining tension
 * of build-drop music), the intro is kit and bass for DJ mixing.
 */
const DANCE_ROLEMAP: Readonly<Partial<Record<SectionKind, RoleName[]>>> =
  Object.freeze({
    breakdown: ["pad", "chords", "lead", "arp", "drone", "counter"],
    intro: ["kick", "hat", "openhat", "perc", "shaker", "rim", "bass", "pad"],
  });

const MINOR_SCALES = Object.freeze([
  ["minor", 0.6],
  ["dorian", 0.25],
  ["phrygian", 0.15],
] as const);

// ---------------------------------------------------------------------------
// Cards

const ROOT: readonly StyleCard[] = [
  card({
    id: "electronic",
    abstract: true,
    summary:
      "loop-based machine music: quantised 16-step grid, 8-bar hypermeter, loop harmony, build and drop",
    tempo: { bpm: [100, 140], typical: 124 },
    meter: { hypermeter: [[8, 1]] },
    groove: { subdivision: 4, humanize: { timingMs: 0, velocity: 0.02 } },
    rhythm: {
      onsets: { kick: FOUR_FLOOR, clap: BACKBEAT, hat: OFFBEAT },
      fills: { every: 8, density: [0.3, 0.6] },
    },
    pitch: { scales: MINOR_SCALES },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["dorian-vamp", 0.3],
        ["sad-pop", 0.2],
      ],
      cadences: [
        ["bVII-I", 0.5],
        ["V-I", 0.3],
        ["iv-I", 0.2],
      ],
      rhythm: [
        [1, 0.5],
        [0.5, 0.5],
      ],
      sevenths: 0.4,
    },
    melody: {
      repetition: 0.8,
      density: [2, 3],
      phraseBars: [
        [2, 0.5],
        [4, 0.5],
      ],
      intervals: intervals(4, 3, 1.2, 1.2),
    },
    bass: {
      behaviour: [
        ["ostinato", 0.5],
        ["octave", 0.3],
        ["root", 0.2],
      ],
      onsets: OFFBEAT,
      kickLock: 0,
    },
    form: {
      plans: [
        [["intro", "build", "drop", "breakdown", "build", "drop", "outro"], 1],
      ],
      archetype: "build-drop",
    },
    texture: {
      roles: {
        snare: null,
        kick: MACHINE,
        clap: MACHINE,
        hat: MACHINE,
        openhat: MACHINE_OPT,
        bass: role("bass", "saw:0.4", "square:0.3"),
        chords: role("keys", "saw:0.5"),
        pad: maybe("strings", "granular:0.4"),
        lead: role("lead", "pluck:0.6"),
      },
    },
    expression: { dynamics: [0.6, 1] },
    mix: {
      levels: {
        kick: 0,
        clap: -5,
        hat: -9,
        openhat: -11,
        bass: -3,
        chords: -8,
        pad: -12,
        lead: -4,
      },
      space: 0.3,
      loudness: "club",
    },
  }),
];

// ---------------------------------------------------------------------------
// Disco and its heirs.
// Refs: Tim Lawrence, "Love Saves the Day" (Duke UP, 2003); Alice Echols,
// "Hot Stuff: Disco and the Remaking of American Culture" (2010).

const DISCO: readonly StyleCard[] = [
  card({
    id: "disco-family",
    abstract: true,
    summary:
      "four-on-the-floor kick, open hat on every off-beat, octave-leaping 8th bass, string and horn pads over extended diatonic sevenths",
    tempo: { bpm: [110, 130], typical: 120 },
    rhythm: {
      onsets: { hat: EIGHTHS, openhat: OFFBEAT },
      locks: [{ kind: "avoid", a: "kick", b: "openhat" }],
    },
    pitch: {
      scales: [
        ["minor", 0.4],
        ["dorian", 0.3],
        ["major", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["dorian-vamp", 0.35],
        ["ii-v-i", 0.25],
        ["fifties", 0.2],
        ["aeolian", 0.2],
      ],
      sevenths: 0.6,
    },
    bass: { behaviour: [["octave", 1]], onsets: EIGHTHS },
    form: { roleMap: DANCE_ROLEMAP },
    texture: {
      roles: {
        openhat: MACHINE,
        chords: role("strings", "epiano:0.5"),
        lead: role("strings", "lead:0.5"),
      },
    },
  }),
  card({
    id: "disco",
    summary:
      "Philadelphia-rooted disco: live four-on-the-floor, 16th hi-hat lift, octave bass, string-section pads, ii-V and dorian vamps",
    tempo: { bpm: [112, 128], typical: 118 },
    groove: { humanize: { timingMs: 6, velocity: 0.06 } },
    rhythm: { onsets: { hat: SIXTEENTHS, perc: grid("..x...x...x...x.") } },
    texture: {
      roles: {
        kick: ACOUSTIC,
        clap: ACOUSTIC,
        hat: ACOUSTIC,
        openhat: ACOUSTIC,
        perc: maybe("bell"),
        bass: role("ebass", "slap:0.5"),
        chords: role("strings", "rhodes:0.4"),
        lead: role("violins", "trumpet:0.5"),
      },
    },
    mix: { loudness: "streaming" },
  }),
  card({
    id: "euro-disco",
    summary:
      "European disco: sequenced 8th octave bass, minor-key pop progressions, string synth chords, steady drum machine",
    tempo: { bpm: [115, 130], typical: 122 },
    pitch: { scales: [["minor", 1]] },
    harmony: {
      presets: [
        ["aeolian", 0.4],
        ["sad-pop", 0.4],
        ["andalusian", 0.2],
      ],
      sevenths: 0.2,
    },
    texture: {
      roles: {
        bass: role("saw", "bass:0.5"),
        lead: role("lead", "strings:0.4"),
      },
    },
  }),
  card({
    id: "italo-disco",
    summary:
      "Italo-disco: drum machine, 8th octave bass, arpeggiated minor triads, melancholic aeolian loops and square-wave hooks",
    tempo: { bpm: [110, 125], typical: 118 },
    pitch: { scales: [["minor", 1]] },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["sad-pop", 0.5],
      ],
      sevenths: 0.1,
    },
    rhythm: { onsets: { hat: OFFBEAT, arp: SIXTEENTHS } },
    texture: {
      roles: {
        kick: K808,
        arp: role("pluck", "square:0.5"),
        bass: role("saw"),
        lead: role("square", "lead:0.5"),
      },
    },
  }),
  card({
    id: "hi-nrg",
    summary:
      "Hi-NRG: fast 128-140 bpm four-on-the-floor, relentless 8th octave bass, minor triads, handclap backbeat",
    tempo: { bpm: [128, 140], typical: 134 },
    pitch: { scales: [["minor", 1]] },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["andalusian", 0.3],
        ["sad-pop", 0.2],
      ],
      rhythm: [[1, 1]],
      sevenths: 0,
    },
    rhythm: { onsets: { clap: grid("....x.......x..x") } },
    texture: { roles: { bass: role("saw", "square:0.5"), lead: role("lead") } },
  }),
  card({
    id: "space-disco",
    summary:
      "Space disco: 16th sequencer bass and arpeggios instead of the octave bass, sweeping filter pads, dorian vamps, long phrases",
    tempo: { bpm: [110, 122], typical: 116 },
    meter: { hypermeter: [[16, 1]] },
    harmony: { model: "modal", rhythm: [[0.5, 1]] },
    bass: { behaviour: [["ostinato", 1]], onsets: SIXTEENTHS },
    rhythm: { onsets: { arp: SIXTEENTHS } },
    texture: {
      roles: {
        arp: role("pluck", "saw:0.5"),
        pad: role("strings", "cloud:0.4"),
        bass: role("saw"),
        lead: role("lead", "square:0.4"),
      },
    },
    mix: { fx: { pad: { autofilter: "slow-sweep" } }, space: 0.5 },
  }),
  card({
    id: "nu-disco",
    summary:
      "Nu-disco: disco octave bass and off-beat hat at house tempo, filtered ninth chords, sidechain pump",
    tempo: { bpm: [110, 124], typical: 118 },
    groove: { swingRatio: [1, 1.2] },
    harmony: { sevenths: 0.8 },
    texture: {
      roles: {
        chords: role("rhodes", "keys:0.5"),
        bass: role("ebass", "saw:0.5"),
        lead: role("pluck", "lead:0.5"),
      },
    },
    mix: { fx: { chords: { duck: "pump" } } },
  }),
  card({
    id: "disco-polo",
    summary:
      "Disco polo: simple major-key I-V-vi-IV and I-vi-IV-V loops, oom-pah off-beat bass, bright keyboard lead",
    tempo: { bpm: [120, 140], typical: 128 },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["fifties", 0.5],
      ],
      cadences: [["V-I", 1]],
      sevenths: 0,
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: FOUR_FLOOR },
    texture: {
      roles: {
        chords: role("keys", "organ:0.4"),
        lead: role("lead", "square:0.5"),
      },
    },
  }),
  card({
    id: "freestyle",
    summary:
      "Latin freestyle: electro syncopated 808 kick, clave-like stabs, minor progressions, 16th hats",
    tempo: { bpm: [108, 122], typical: 116 },
    rhythm: {
      onsets: {
        kick: ELECTRO_KICK,
        hat: SIXTEENTHS,
        openhat: null,
        perc: grid("x..x..x...x.x..."),
      },
      locks: [],
    },
    bass: { behaviour: [["ostinato", 1]], onsets: ELECTRO_KICK, kickLock: 0.8 },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["andalusian", 0.5],
      ],
    },
    texture: {
      roles: {
        kick: ELECTRO,
        openhat: null,
        perc: MACHINE_OPT,
        bass: role("saw", "square:0.5"),
        chords: role("keys"),
        lead: role("lead", "square:0.5"),
      },
    },
  }),
  card({
    id: "eurobeat",
    summary:
      "Eurobeat: 150-160 bpm four-on-the-floor, 8th octave bass, minor key with modal-interchange bVI-bVII-i climbs, brass-synth stabs",
    tempo: { bpm: [148, 162], typical: 155 },
    pitch: { scales: [["minor", 1]] },
    harmony: {
      presets: [
        ["aeolian", 0.6],
        ["andalusian", 0.4],
      ],
      cadences: [["bVII-I", 1]],
      sevenths: 0,
    },
    texture: {
      roles: {
        bass: role("saw"),
        chords: role("saw", "keys:0.5"),
        lead: role("lead"),
      },
    },
  }),
  card({
    id: "eurodance",
    summary:
      "Eurodance: 130-145 bpm four-on-the-floor, off-beat bass stabs, minor vi-IV-I-V loops, piano and supersaw hooks",
    tempo: { bpm: [128, 145], typical: 138 },
    pitch: { scales: [["minor", 1]] },
    harmony: {
      presets: [
        ["sad-pop", 0.6],
        ["aeolian", 0.4],
      ],
      sevenths: 0,
    },
    bass: { behaviour: [["root", 1]], onsets: OFFBEAT },
    texture: {
      roles: {
        chords: role("piano", "saw:0.6"),
        bass: role("saw"),
        lead: role("saw", "lead:0.5"),
      },
    },
  }),
  card({
    id: "electro-swing",
    summary:
      "Electro swing: triplet-swung 8ths over a four-on-the-floor kick, harmonic-minor ii-V-i, walking upright bass, clarinet and muted horns",
    tempo: { bpm: [115, 130], typical: 124 },
    groove: { subdivision: 2, swingRatio: [1.8, 2.2] },
    rhythm: {
      onsets: {
        kick: grid("x.x.x.x."),
        clap: grid("..x...x."),
        hat: grid("x.x.x.x."),
        openhat: grid(".x.x.x.x"),
      },
    },
    pitch: {
      scales: [
        ["harmonic-minor", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["minor-ii-v", 0.7],
        ["andalusian", 0.3],
      ],
      cadences: [["V-I", 1]],
    },
    bass: {
      behaviour: [["walking", 1]],
      walk: { chordToneOnOne: 0.9, chromaticApproach: 0.3 },
    },
    texture: {
      roles: {
        bass: role("upright"),
        chords: role("piano", "keys:0.3"),
        lead: role("clarinet", "mutedtrumpet:0.6", "sax:0.4"),
      },
    },
  }),
];

// ---------------------------------------------------------------------------
// House.
// Refs: Hillegonda Rietveld, "This Is Our House" (Ashgate, 1998); Mark J.
// Butler (2006) on four-on-the-floor and off-beat hi-hat interlock.

const HOUSE: readonly StyleCard[] = [
  card({
    id: "house",
    abstract: true,
    summary:
      "house: 118-130 bpm four-on-the-floor, clap on 2 and 4, open hat on every off-beat, piano or organ stabs, 8-bar loops",
    tempo: { bpm: [118, 130], typical: 124 },
    rhythm: {
      onsets: { openhat: OFFBEAT, hat: grid("x.x.x.x.x.x.x.x.") },
      locks: [{ kind: "avoid", a: "kick", b: "openhat" }],
    },
    form: { roleMap: DANCE_ROLEMAP },
    texture: {
      roles: { kick: MACHINE, chords: role("piano", "organ:0.5", "keys:0.5") },
    },
  }),
  card({
    id: "chicago-house",
    summary:
      "Chicago jack: raw 909/808 four-on-the-floor, swung 16th hats, clap on 2 and 4, two-chord piano vamp",
    tempo: { bpm: [118, 128], typical: 122 },
    groove: { swingRatio: [1.1, 1.3] },
    rhythm: { onsets: { hat: SIXTEENTHS } },
    harmony: {
      presets: [["dorian-vamp", 1]],
      rhythm: [[1, 1]],
    },
    texture: { roles: { kick: K808, chords: role("piano", "organ:0.4") } },
  }),
  card({
    id: "acid-house",
    summary:
      "Acid house: 303 squelch bass as a 16th-note ostinato with resonant filter and accents, one-chord modal vamp, 909 jack",
    tempo: { bpm: [118, 128], typical: 122 },
    pitch: {
      scales: [
        ["phrygian", 0.4],
        ["minor", 0.4],
        ["dorian", 0.2],
      ],
    },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    bass: {
      behaviour: [["ostinato", 1]],
      onsets: grid("x.xxx.x.xx.xx.x."),
      range: [33, 57],
    },
    texture: {
      roles: { bass: role("saw", "square:0.4"), chords: null, pad: null },
    },
    expression: {
      articulation: {
        bass: [
          ["staccato", 0.6],
          ["accent", 0.4],
        ],
      },
    },
    mix: { fx: { bass: { autofilter: "env-follow" } } },
  }),
  card({
    id: "deep-house",
    summary:
      "Deep house: minor 7th and 9th dorian loops, swung 16ths (54-58 %), off-beat hat, syncopated bass that avoids the kick",
    seedSalt: 1986,
    tempo: { bpm: [118, 125], typical: 122 },
    groove: { swingRatio: [1.18, 1.38], velocity: [1, 0.55, 0.8, 0.6] },
    rhythm: {
      onsets: {
        kick: FOUR_FLOOR,
        clap: BACKBEAT,
        hat: grid("..x...x...x...x."),
        openhat: grid("..1...1...1...1."),
        shaker: SHAKER_16,
      },
    },
    pitch: {
      scales: [
        ["dorian", 0.55],
        ["minor", 0.45],
      ],
    },
    harmony: {
      presets: [
        ["dorian-vamp", 0.6],
        ["aeolian", 0.4],
      ],
      forms: [
        [["i7", "iv7"], 0.5],
        [["i9", "bVII", "iv7", "i7"], 0.5],
      ],
      sources: { presets: 1, forms: 2 },
      rhythm: [
        [1, 0.6],
        [0.5, 0.4],
      ],
      sevenths: 0.9,
      voicing: {
        types: [
          ["open", 0.6],
          ["shell", 0.4],
        ],
        range: [52, 74],
        notes: [4, 5],
      },
    },
    melody: { density: [1, 2], ambitus: [5, 10], repetition: 0.85 },
    bass: {
      behaviour: [["ostinato", 1]],
      range: [31, 48],
      onsets: grid("..x..x....x..x.."),
      kickLock: 0,
    },
    texture: {
      roles: {
        shaker: MACHINE_OPT,
        chords: role("epiano", "organ:0.5"),
        pad: maybe("strings"),
        lead: maybe("pluck", "vibes:0.4"),
      },
    },
    mix: { space: 0.4 },
  }),
  card({
    id: "garage-house",
    summary:
      "Garage (NY) house: gospel organ and piano, major ii-V-I and turnaround changes with sevenths, swung hats, soulful lead",
    tempo: { bpm: [118, 126], typical: 122 },
    groove: { swingRatio: [1.15, 1.35] },
    pitch: {
      scales: [
        ["major", 0.6],
        ["mixolydian", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["ii-v-i", 0.5],
        ["turnaround", 0.5],
      ],
      cadences: [
        ["V-I", 0.7],
        ["IV-I", 0.3],
      ],
      sevenths: 0.8,
    },
    texture: {
      roles: {
        chords: role("hammond", "piano:0.6"),
        lead: role("choir", "rhodes:0.4"),
      },
    },
  }),
  card({
    id: "hip-house",
    summary:
      "Hip house: four-on-the-floor under a hip-hop snare backbeat, rapped phrasing as dense 16th lead, sampled stab chords",
    tempo: { bpm: [115, 126], typical: 120 },
    rhythm: { onsets: { snare: BACKBEAT, clap: null } },
    melody: { density: [3, 4], ambitus: [3, 7], repetition: 0.9 },
    texture: {
      roles: {
        snare: K808,
        clap: null,
        kick: K808,
        lead: role("lead", "vocoder:0.4"),
      },
    },
  }),
  card({
    id: "italo-house",
    summary:
      "Italo house: rolling major piano stabs on off-beats, bright I-V-vi-IV loops, euphoric diva-style lead",
    tempo: { bpm: [120, 128], typical: 124 },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["fifties", 0.5],
      ],
      cadences: [["V-I", 1]],
      sevenths: 0.2,
    },
    rhythm: { onsets: { chords: grid("..x..x..x..x..x.") } },
    texture: {
      roles: { chords: role("piano"), lead: role("choir", "lead:0.5") },
    },
  }),
  card({
    id: "euro-house",
    summary:
      "Euro house: pop song form on four-on-the-floor, minor vi-IV-I-V loops, off-beat bass, synth riff hook",
    tempo: { bpm: [122, 132], typical: 126 },
    harmony: {
      presets: [
        ["sad-pop", 0.6],
        ["aeolian", 0.4],
      ],
      sevenths: 0.1,
    },
    bass: { behaviour: [["root", 1]] },
    texture: {
      roles: {
        chords: role("piano", "saw:0.4"),
        lead: role("lead", "saw:0.4"),
      },
    },
  }),
  card({
    id: "progressive-house",
    summary:
      "Progressive house: 16-bar hypermeter, syncopated rolling bass with 16th pickups, 16th shaker, layered plucked arpeggios, slow filter builds",
    tempo: { bpm: [122, 128], typical: 126 },
    meter: { hypermeter: [[16, 1]] },
    rhythm: {
      onsets: { arp: grid("x.xxx.xxx.xxx.xx"), shaker: SHAKER_16 },
    },
    bass: { onsets: grid("..x..xx...x..xx.") },
    harmony: {
      presets: [
        ["aeolian", 0.6],
        ["sad-pop", 0.4],
      ],
      rhythm: [[0.5, 1]],
    },
    texture: {
      roles: {
        shaker: MACHINE,
        arp: role("pluck"),
        pad: role("strings", "cloud:0.4"),
        chords: role("saw"),
      },
    },
    mix: { fx: { pad: { autofilter: "hpf-rise" } }, space: 0.45 },
  }),
  card({
    id: "tribal-house",
    summary:
      "Tribal house: tom and conga polyrhythm over four-on-the-floor, tresillo perc, minimal one-chord harmony",
    tempo: { bpm: [124, 130], typical: 127 },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    rhythm: {
      onsets: { tom: grid("..x..x....x..x.."), perc: TRESILLO, clap: null },
    },
    texture: {
      roles: {
        tom: MACHINE,
        clap: null,
        perc: role("framedrum", "tabla:0.3"),
        chords: null,
      },
    },
  }),
  card({
    id: "french-house",
    summary:
      "French house: filtered disco loop with sidechain pump, swung 16ths, dorian and major seventh vamps, phaser sweeps",
    tempo: { bpm: [118, 126], typical: 123 },
    groove: { swingRatio: [1.1, 1.3] },
    harmony: {
      presets: [
        ["dorian-vamp", 0.5],
        ["ii-v-i", 0.5],
      ],
      sevenths: 0.8,
    },
    bass: { behaviour: [["octave", 1]], onsets: EIGHTHS },
    texture: {
      roles: {
        chords: role("rhodes", "strings:0.5"),
        bass: role("ebass", "saw:0.5"),
      },
    },
    mix: { fx: { chords: { djf: "dark", duck: "pump", phaser: "slow" } } },
  }),
  card({
    id: "tech-house",
    summary:
      "Tech house: rolling 16th bass groove, percussive tops, shuffled hats, one-chord minimal harmony",
    tempo: { bpm: [124, 128], typical: 126 },
    groove: { swingRatio: [1.05, 1.25] },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    rhythm: {
      onsets: { perc: grid("...x..x....x..x."), rim: grid("......x.......x.") },
    },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("..xx..x...xx..x.") },
    texture: {
      roles: {
        perc: MACHINE_OPT,
        rim: MACHINE_OPT,
        chords: null,
        lead: maybe("pluck"),
      },
    },
  }),
  card({
    id: "hard-house",
    summary:
      "Hard house: 140-150 bpm, off-beat donk bass, distorted kick, minor riff stabs, hoover leads",
    tempo: { bpm: [138, 152], typical: 145 },
    bass: { behaviour: [["root", 1]], onsets: OFFBEAT },
    texture: {
      roles: { bass: role("square", "saw:0.5"), chords: role("saw") },
    },
    mix: { fx: { kick: { distort: "crunch" } }, loudness: "loud" },
  }),
  card({
    id: "electro-house",
    summary:
      "Electro and big room house: distorted saw bass on off-beats, sparse big-room kick drop, simple minor hook, snare-roll builds",
    tempo: { bpm: [126, 130], typical: 128 },
    rhythm: {
      fills: { every: 8, density: [0.6, 1] },
      onsets: { snare: grid("....x.......x...") },
    },
    melody: { density: [1, 2], repetition: 0.95, ambitus: [3, 7] },
    texture: {
      roles: {
        snare: MACHINE,
        bass: role("saw"),
        lead: role("saw", "lead:0.5"),
      },
    },
    mix: { fx: { bass: { distort: "fold" } }, loudness: "loud" },
  }),
  card({
    id: "minimal-house",
    summary:
      "Microhouse: clicks and micro-samples, sparse probabilistic perc, one-chord dub stab, low pitched density",
    tempo: { bpm: [118, 126], typical: 122 },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    rhythm: {
      onsets: {
        clap: grid("....5.......x..."),
        rim: grid("..3..4...3...5.."),
        hat: grid("..x...x...x...x."),
      },
    },
    melody: { density: [0.5, 1] },
    texture: {
      roles: {
        rim: MACHINE_OPT,
        chords: role("keys"),
        lead: maybe("grains", "microloop:0.5"),
      },
    },
    mix: { fx: { rim: { crush: "lofi" } } },
  }),
  card({
    id: "future-house",
    summary:
      "Future and bass house: metallic wobbling bass on syncopated off-beats, minor riffs, swung hats",
    tempo: { bpm: [124, 128], typical: 126 },
    groove: { swingRatio: [1.05, 1.2] },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("..x..x....x..xx.") },
    texture: {
      roles: { bass: role("saw", "square:0.5"), chords: maybe("pluck") },
    },
    mix: { fx: { bass: { autofilter: "wobble", distort: "fold" } } },
  }),
  card({
    id: "tropical-house",
    summary:
      "Tropical house: 100-115 bpm, marimba and steelpan plucks, major I-V-vi-IV, soft four-on-the-floor",
    tempo: { bpm: [100, 115], typical: 108 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["major-pentatonic", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.6],
        ["sad-pop", 0.4],
      ],
      cadences: [["IV-I", 1]],
      sevenths: 0.2,
    },
    texture: {
      roles: {
        chords: role("keys", "nylon:0.5"),
        lead: role("marimba", "steelpan:0.6", "flute:0.3"),
      },
    },
    mix: { loudness: "streaming" },
  }),
  card({
    id: "lofi-house",
    summary:
      "Lo-fi and outsider house: saturated lofi kit, tape wobble, swung 16ths, dorian seventh loops",
    tempo: { bpm: [115, 125], typical: 120 },
    groove: { swingRatio: [1.15, 1.35] },
    harmony: { presets: [["dorian-vamp", 1]], sevenths: 0.8 },
    texture: {
      roles: {
        kick: LOFI,
        chords: role("epiano", "lofi:0.6"),
        lead: maybe("pluck"),
      },
    },
    mix: {
      fx: { chords: { wobble: "tape", crush: "lofi" } },
      loudness: "streaming",
    },
  }),
  card({
    id: "ghetto-house",
    summary:
      "Ghetto house: fast 808 four-on-the-floor, clap on every beat, 16th hats, chant-like repeated minor riff",
    tempo: { bpm: [128, 140], typical: 132 },
    rhythm: { onsets: { clap: FOUR_FLOOR, hat: SIXTEENTHS } },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    melody: { repetition: 0.95, ambitus: [2, 5] },
    texture: { roles: { kick: K808, chords: null } },
  }),
  card({
    id: "ambient-house",
    summary:
      "Ambient house and Balearic: soft four-on-the-floor under long lydian and major-seventh pads, spacious reverb",
    tempo: { bpm: [100, 118], typical: 110 },
    pitch: {
      scales: [
        ["lydian", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["canon", 0.5],
      ],
      cadences: [["IV-I", 1]],
      rhythm: [[0.5, 1]],
      sevenths: 0.7,
    },
    melody: { density: [0.5, 1.5] },
    texture: {
      roles: {
        pad: role("strings", "cloud:0.6"),
        lead: maybe("pluck", "nylon:0.4"),
      },
    },
    mix: { space: 0.7, loudness: "streaming" },
  }),
  card({
    id: "afro-house",
    summary:
      "Afro house: 3-3-2 bell timeline and conga interlock over four-on-the-floor, minor modal chant harmony",
    tempo: { bpm: [118, 124], typical: 121 },
    harmony: { model: "modal", rhythm: [[0.5, 1]] },
    rhythm: {
      onsets: {
        bell: grid("x..x..x.x..x..x."),
        perc: grid("..x..xx...x..xx."),
        shaker: SHAKER_16,
      },
    },
    texture: {
      roles: {
        bell: role("bell"),
        perc: role("framedrum", "tabla:0.3"),
        shaker: MACHINE_OPT,
        chords: maybe("marimba", "keys:0.5"),
        lead: role("marimba", "flute:0.4"),
      },
    },
  }),
  card({
    id: "amapiano",
    summary:
      "Amapiano: 110-116 bpm, log-drum bass in tresillo syncopation, 16th shakers, jazzy major-seventh piano, sparse kick",
    tempo: { bpm: [110, 116], typical: 113 },
    groove: { swingRatio: [1.05, 1.25] },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        clap: grid("....x.......x..."),
        shaker: SIXTEENTHS,
      },
    },
    pitch: {
      scales: [
        ["major", 0.5],
        ["dorian", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["ii-v-i", 0.6],
        ["dorian-vamp", 0.4],
      ],
      sevenths: 0.9,
    },
    bass: { behaviour: [["ostinato", 1]], onsets: TRESILLO },
    texture: {
      roles: {
        shaker: MACHINE,
        bass: role("marimba", "bass:0.4"),
        chords: role("piano", "rhodes:0.5"),
        lead: maybe("flute", "sax:0.4"),
      },
    },
  }),
  card({
    id: "gqom",
    summary:
      "Gqom: no four-on-the-floor; broken 3-3-4-3-3 kick cells, dark minor drones, sparse metallic perc",
    tempo: { bpm: [120, 128], typical: 124 },
    rhythm: {
      onsets: {
        kick: grid("x..x..x...x..x.."),
        clap: grid("........x......."),
        hat: grid("..x...x...x...x."),
        tom: grid("...x.....x....x."),
        openhat: null,
      },
      locks: [],
    },
    pitch: {
      scales: [
        ["phrygian", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: { model: "drone" },
    texture: {
      roles: {
        tom: MACHINE,
        openhat: null,
        chords: null,
        drone: role("organ", "cloud:0.5"),
      },
    },
  }),
  card({
    id: "kwaito",
    summary:
      "Kwaito: slowed-down house at 100-115 bpm, heavy synth bass, call-and-response chant, minor loops",
    tempo: { bpm: [100, 115], typical: 108 },
    harmony: {
      presets: [
        ["aeolian", 0.6],
        ["dorian-vamp", 0.4],
      ],
    },
    bass: {
      behaviour: [["ostinato", 1]],
      onsets: grid("x..x..x...x....."),
      kickLock: 0,
    },
    texture: {
      roles: { kick: K808, bass: role("saw"), lead: role("lead", "choir:0.4") },
    },
  }),
];

// ---------------------------------------------------------------------------
// Techno.
// Refs: Dan Sicko, "Techno Rebels" (Billboard, 1999); Kodwo Eshun, "More
// Brilliant than the Sun" (Quartet, 1998).

const TECHNO: readonly StyleCard[] = [
  card({
    id: "techno",
    abstract: true,
    summary:
      "techno: 125-140 bpm relentless four-on-the-floor, ride and hat ostinati, minimal modal harmony, timbre over chord change",
    tempo: { bpm: [125, 140], typical: 132 },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    rhythm: {
      onsets: {
        clap: grid("....1.......x..."),
        perc: grid("..x..x..x...x..x"),
      },
    },
    form: { roleMap: DANCE_ROLEMAP },
    texture: {
      roles: {
        perc: MACHINE_OPT,
        chords: maybe("saw", "keys:0.5"),
        lead: role("saw", "square:0.5"),
      },
    },
    melody: { repetition: 0.9, density: [2, 4] },
  }),
  card({
    id: "detroit-techno",
    summary:
      "Detroit techno: string-pad minor ninth chords, syncopated 808/909 programming, dorian melancholy over a machine pulse",
    tempo: { bpm: [125, 135], typical: 130 },
    pitch: {
      scales: [
        ["dorian", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["dorian-vamp", 0.6],
        ["aeolian", 0.4],
      ],
      rhythm: [[0.5, 1]],
      sevenths: 0.9,
    },
    rhythm: { onsets: { hat: SIXTEENTHS } },
    texture: {
      roles: {
        kick: K808,
        chords: role("strings", "saw:0.5"),
        pad: role("strings"),
      },
    },
  }),
  card({
    id: "minimal-techno",
    summary:
      "Minimal techno: reduction to kick, clicks and one evolving tone; probabilistic rim and perc, very low pitched density",
    tempo: { bpm: [124, 132], typical: 128 },
    rhythm: {
      onsets: {
        clap: grid("............5..."),
        rim: grid("...3..x....3..4."),
        perc: grid(".....3.....4...."),
      },
    },
    melody: { density: [0.5, 1], ambitus: [2, 5], repetition: 0.95 },
    texture: {
      roles: {
        rim: MACHINE_OPT,
        chords: null,
        pad: null,
        lead: role("pluck", "triangle:0.5"),
      },
    },
  }),
  card({
    id: "dub-techno",
    summary:
      "Dub techno: off-beat minor seventh chord stab drowned in dub delay and reverb, sub-bass pulse, hiss and space",
    tempo: { bpm: [115, 125], typical: 120 },
    harmony: {
      model: "functional",
      presets: [["dorian-vamp", 1]],
      sevenths: 1,
      rhythm: [[0.25, 1]],
    },
    rhythm: { onsets: { chords: grid("..x.......x....."), clap: null } },
    bass: { behaviour: [["root", 1]], onsets: grid("x.......x.......") },
    texture: {
      roles: {
        clap: null,
        chords: role("keys", "epiano:0.5"),
        lead: null,
        pad: maybe("cloud"),
      },
    },
    mix: { fx: { chords: { autofilter: "slow-sweep" } }, space: 0.7 },
  }),
  card({
    id: "hard-techno",
    summary:
      "Hard techno and schranz: 140-155 bpm distorted kick, looping 16th hat and perc stabs, atonal phrygian riffs",
    tempo: { bpm: [140, 155], typical: 148 },
    pitch: { scales: [["phrygian", 1]] },
    rhythm: { onsets: { hat: SIXTEENTHS, perc: grid("x.xx.xx.x.xx.xx.") } },
    texture: { roles: { chords: null, lead: role("square", "saw:0.5") } },
    mix: {
      fx: { kick: { distort: "crunch" }, perc: { distort: "fuzz" } },
      loudness: "loud",
    },
  }),
  card({
    id: "acid-techno",
    summary:
      "Acid techno: 303 resonant-filter bass ostinato with accents and slides, 135-145 bpm, phrygian one-chord vamp",
    tempo: { bpm: [133, 145], typical: 138 },
    pitch: {
      scales: [
        ["phrygian", 0.6],
        ["minor", 0.4],
      ],
    },
    bass: {
      behaviour: [["ostinato", 1]],
      onsets: grid("x.xxx.xxx.x.xx.x"),
      range: [33, 57],
    },
    texture: { roles: { chords: null, bass: role("saw", "square:0.4") } },
    expression: {
      articulation: {
        bass: [
          ["staccato", 0.5],
          ["accent", 0.5],
        ],
      },
    },
    mix: { fx: { bass: { autofilter: "env-follow", distort: "warm" } } },
  }),
  card({
    id: "industrial-techno",
    summary:
      "Industrial and warehouse techno: distorted rumble kick, metallic perc, dark phrygian drone, huge reverb",
    tempo: { bpm: [128, 140], typical: 134 },
    pitch: {
      scales: [
        ["phrygian", 0.6],
        ["locrian", 0.4],
      ],
    },
    harmony: { model: "drone" },
    texture: {
      roles: {
        chords: null,
        drone: role("organ", "swarm:0.5"),
        lead: maybe("square"),
      },
    },
    mix: {
      fx: { kick: { distort: "fuzz" }, perc: { distort: "crunch" } },
      space: 0.55,
      loudness: "loud",
    },
  }),
  card({
    id: "bleep-techno",
    summary:
      "Bleep techno: pure sine-like bleep melodies, deep sub-bass, sparse 808 kit, minor pentatonic cells",
    tempo: { bpm: [120, 130], typical: 125 },
    pitch: { scales: [["minor-pentatonic", 1]] },
    rhythm: { onsets: { hat: OFFBEAT } },
    bass: { behaviour: [["root", 1]], onsets: grid("x.....x...x.....") },
    texture: {
      roles: {
        kick: K808,
        chords: null,
        bass: role("triangle"),
        lead: role("triangle", "bell:0.4"),
      },
    },
  }),
  card({
    id: "new-beat",
    summary:
      "New beat: EBM slowed to 100-115 bpm, heavy snare backbeat, sequenced 8th bass, dark minor",
    tempo: { bpm: [98, 115], typical: 108 },
    rhythm: { onsets: { snare: BACKBEAT, clap: null, hat: EIGHTHS } },
    bass: { behaviour: [["ostinato", 1]], onsets: EIGHTHS },
    texture: { roles: { snare: MACHINE, clap: null, chords: maybe("saw") } },
  }),
  card({
    id: "ebm",
    summary:
      "EBM: sequenced 8th or 16th bass ostinato, militant snare backbeat, minor/phrygian riffs, barked short phrases",
    tempo: { bpm: [115, 130], typical: 122 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["phrygian", 0.5],
      ],
    },
    rhythm: { onsets: { snare: BACKBEAT, clap: null, hat: EIGHTHS } },
    bass: { behaviour: [["ostinato", 1]], onsets: SIXTEENTHS },
    texture: {
      roles: {
        snare: MACHINE,
        clap: null,
        bass: role("saw", "square:0.5"),
        chords: null,
      },
    },
  }),
  card({
    id: "electroclash",
    summary:
      "Electroclash: electro kit backbeat, square-wave bass, punk-simple two-chord minor riffs, deadpan short phrases",
    tempo: { bpm: [118, 130], typical: 124 },
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.5],
        ["dorian-vamp", 0.5],
      ],
    },
    rhythm: { onsets: { snare: BACKBEAT, clap: null, hat: EIGHTHS } },
    texture: {
      roles: {
        kick: ELECTRO,
        snare: ELECTRO,
        clap: null,
        bass: role("square"),
        lead: role("square", "vocoder:0.3"),
      },
    },
  }),
  card({
    id: "electro",
    summary:
      "Electro: syncopated 808 kick (not four-on-the-floor), snare on 2 and 4, 16th hats, vocoder and phrygian bass riffs",
    tempo: { bpm: [120, 135], typical: 128 },
    pitch: {
      scales: [
        ["phrygian", 0.5],
        ["minor", 0.5],
      ],
    },
    rhythm: {
      onsets: {
        kick: ELECTRO_KICK,
        snare: BACKBEAT,
        clap: null,
        hat: SIXTEENTHS,
        perc: null,
      },
    },
    bass: { behaviour: [["ostinato", 1]], onsets: ELECTRO_KICK, kickLock: 0.8 },
    texture: {
      roles: {
        kick: ELECTRO,
        snare: ELECTRO,
        clap: null,
        perc: null,
        lead: role("vocoder", "square:0.5"),
      },
    },
  }),
  card({
    id: "ghettotech",
    summary:
      "Ghettotech: 140-160 bpm 808 four-on-the-floor, rapid 16th hats and claps, chanted one-note hooks",
    tempo: { bpm: [140, 160], typical: 150 },
    rhythm: { onsets: { hat: SIXTEENTHS, clap: grid("....x..x....x.x.") } },
    melody: { repetition: 0.95, ambitus: [2, 4] },
    texture: { roles: { kick: K808, chords: null } },
  }),
  card({
    id: "skweee",
    summary:
      "Skweee: slow funky 90-110 bpm, square-wave leads, swung 16ths, sparse funk kick, chromatic-free minor pentatonic",
    tempo: { bpm: [90, 110], typical: 100 },
    groove: { swingRatio: [1.2, 1.5] },
    pitch: {
      scales: [
        ["minor-pentatonic", 0.6],
        ["dorian", 0.4],
      ],
    },
    rhythm: {
      onsets: { kick: BROKEN_KICK, snare: BACKBEAT, clap: null, perc: null },
    },
    texture: {
      roles: {
        snare: MACHINE,
        clap: null,
        perc: null,
        bass: role("square"),
        lead: role("square", "triangle:0.5"),
      },
    },
  }),
  card({
    id: "makina",
    summary:
      "Makina: 160-180 bpm four-on-the-floor, off-beat bass, hoover and piano riffs, bright minor-to-major hooks",
    tempo: { bpm: [160, 180], typical: 170 },
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.6],
        ["andalusian", 0.4],
      ],
      rhythm: [[1, 1]],
    },
    bass: { behaviour: [["root", 1]], onsets: OFFBEAT },
    texture: {
      roles: {
        chords: role("piano", "saw:0.5"),
        lead: role("saw", "lead:0.5"),
      },
    },
    mix: { loudness: "loud" },
  }),
  card({
    id: "bouncy-techno",
    summary:
      "Bouncy techno and scouse house: 150-170 bpm, off-beat donk bass, cheerful major riffs, four-on-the-floor",
    tempo: { bpm: [150, 170], typical: 160 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["axis", 0.5],
        ["sad-pop", 0.5],
      ],
      cadences: [["V-I", 1]],
    },
    bass: { behaviour: [["root", 1]], onsets: OFFBEAT },
    texture: { roles: { bass: role("square"), lead: role("lead", "saw:0.4") } },
    mix: { loudness: "loud" },
  }),
  card({
    id: "melodic-techno",
    summary:
      "Melodic techno: 120-126 bpm, galloping 8th-plus-16th bass ostinato, closed 16th hats, minor and phrygian arpeggio sequences, long pads, one-chord modal stasis with dramatic builds",
    tempo: { bpm: [120, 126], typical: 123 },
    meter: { hypermeter: [[16, 1]] },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["phrygian", 0.4],
      ],
    },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    bass: { behaviour: [["ostinato", 1]], onsets: GALLOP, range: [31, 45] },
    rhythm: { onsets: { hat: SIXTEENTHS, arp: SIXTEENTHS } },
    texture: {
      roles: {
        arp: role("pluck", "saw:0.5"),
        pad: role("strings", "cloud:0.5"),
        lead: maybe("lead"),
      },
    },
    mix: { fx: { arp: { autofilter: "slow-sweep" } }, space: 0.6 },
  }),
];

// ---------------------------------------------------------------------------
// Trance.
// Refs: Graham St John, "Global Tribe: Technology, Spirituality and
// Psytrance" (Equinox, 2012); Butler (2006) on breakdown-buildup form.

const TRANCE: readonly StyleCard[] = [
  card({
    id: "trance-family",
    abstract: true,
    summary:
      "trance: 130-145 bpm, rolling off-beat bass, gated supersaw chords, 16th arpeggios, long breakdown and build",
    tempo: { bpm: [130, 145], typical: 138 },
    meter: { hypermeter: [[16, 1]] },
    pitch: { scales: [["minor", 1]] },
    harmony: {
      presets: [
        ["aeolian", 0.6],
        ["sad-pop", 0.4],
      ],
      rhythm: [[0.5, 1]],
    },
    bass: {
      behaviour: [
        ["octave", 0.5],
        ["ostinato", 0.5],
      ],
      onsets: OFFBEAT,
    },
    form: { roleMap: DANCE_ROLEMAP },
    texture: { roles: { chords: role("saw"), arp: role("pluck") } },
    rhythm: { onsets: { arp: SHAKER_16 } },
  }),
  card({
    id: "trance",
    summary:
      "Classic and uplifting trance: aeolian vi-IV-I-V supersaw loops, off-beat bass, 16th gated pads, soaring stepwise lead",
    tempo: { bpm: [136, 140], typical: 138 },
    harmony: {
      presets: [
        ["sad-pop", 0.5],
        ["aeolian", 0.5],
      ],
      cadences: [
        ["bVII-I", 0.6],
        ["V-I", 0.4],
      ],
    },
    melody: {
      density: [1, 2],
      ambitus: [7, 12],
      intervals: intervals(4, 2.5, 1.5, 0.8, 1.2),
    },
    texture: {
      roles: { pad: role("strings", "saw:0.5"), lead: role("saw", "lead:0.5") },
    },
    mix: { fx: { chords: { tremolo: "eighth-chop" } }, space: 0.45 },
  }),
  card({
    id: "progressive-trance",
    summary:
      "Progressive trance: 128-134 bpm, galloping 8th-plus-16th bass, closed 16th hats, slow-evolving filtered arpeggio, sparse harmonic rhythm, restrained lead",
    tempo: { bpm: [128, 134], typical: 132 },
    rhythm: { onsets: { hat: SIXTEENTHS } },
    bass: { onsets: GALLOP },
    harmony: { rhythm: [[0.25, 1]] },
    melody: { density: [1, 2] },
    texture: { roles: { lead: maybe("pluck", "saw:0.4") } },
    mix: { fx: { arp: { autofilter: "slow-sweep" } } },
  }),
  card({
    id: "tech-trance",
    summary:
      "Tech trance: techno drive at trance tempo, percussive 16th stabs, modal one-chord harmony, minimal melody",
    tempo: { bpm: [135, 142], typical: 138 },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    rhythm: { onsets: { hat: SIXTEENTHS, perc: grid("..x..x..x..x..x.") } },
    texture: {
      roles: {
        perc: MACHINE_OPT,
        chords: null,
        lead: role("saw", "square:0.5"),
      },
    },
  }),
  card({
    id: "hard-trance",
    summary:
      "Hard trance: 145-155 bpm, distorted kick, driving off-beat bass, harsh minor supersaw riffs",
    tempo: { bpm: [145, 155], typical: 150 },
    harmony: {
      presets: [
        ["aeolian", 0.6],
        ["andalusian", 0.4],
      ],
    },
    texture: { roles: { lead: role("saw") } },
    mix: { fx: { kick: { distort: "crunch" } }, loudness: "loud" },
  }),
  card({
    id: "goa-trance",
    summary:
      "Goa trance: phrygian and harmonic-minor modal riffs, 16th acid-like lead lines, rolling kick-bass, no chord changes",
    tempo: { bpm: [138, 150], typical: 145 },
    pitch: {
      scales: [
        ["phrygian", 0.5],
        ["harmonic-minor", 0.3],
        ["phrygian-dominant", 0.2],
      ],
    },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    bass: { behaviour: [["ostinato", 1]], onsets: ROLLING },
    melody: {
      density: [3, 4],
      repetition: 0.9,
      intervals: intervals(5, 2, 0.8, 1),
    },
    texture: {
      roles: { chords: null, arp: role("saw", "pluck:0.5"), lead: role("saw") },
    },
    mix: { fx: { lead: { autofilter: "env-follow" } } },
  }),
  card({
    id: "psytrance",
    summary:
      "Psytrance: rolling kick-bass (three 16th bass notes after each kick, never on it), phrygian one-chord riffs, 140-148 bpm",
    tempo: { bpm: [140, 148], typical: 144 },
    pitch: {
      scales: [
        ["phrygian", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    bass: { behaviour: [["ostinato", 1]], onsets: ROLLING, range: [31, 45] },
    rhythm: { onsets: { hat: OFFBEAT, perc: grid("..x...x...x..xx.") } },
    texture: {
      roles: {
        perc: MACHINE_OPT,
        chords: null,
        lead: role("saw", "square:0.5"),
      },
    },
  }),
  card({
    id: "progressive-psy",
    summary:
      "Progressive psytrance: 134-140 bpm, rolling kick-bass in a shorter two-note 16th pattern, minor not phrygian, hypnotic filtered riffs, sparser and deeper than full-on",
    tempo: { bpm: [134, 140], typical: 137 },
    meter: { hypermeter: [[16, 1]] },
    pitch: {
      scales: [
        ["minor", 0.7],
        ["dorian", 0.3],
      ],
    },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    bass: {
      behaviour: [["ostinato", 1]],
      onsets: grid(".xx..xx..xx..xx."),
      range: [31, 45],
    },
    rhythm: { onsets: { hat: OFFBEAT, perc: grid("......x.......x.") } },
    texture: {
      roles: {
        perc: MACHINE_OPT,
        chords: null,
        pad: maybe("cloud"),
        lead: role("pluck", "saw:0.5"),
      },
    },
    mix: { fx: { lead: { autofilter: "slow-sweep" } }, space: 0.5 },
  }),
  card({
    id: "dark-psy",
    summary:
      "Dark psytrance and forest: 148-165 bpm rolling kick-bass, locrian and phrygian dissonance, chaotic perc",
    tempo: { bpm: [148, 165], typical: 155 },
    pitch: {
      scales: [
        ["locrian", 0.5],
        ["phrygian", 0.5],
      ],
    },
    harmony: { model: "drone" },
    bass: { behaviour: [["ostinato", 1]], onsets: ROLLING, range: [31, 45] },
    rhythm: { onsets: { perc: grid("x.3x.x3.x..x3.x.") } },
    texture: {
      roles: {
        perc: MACHINE_OPT,
        chords: null,
        arp: null,
        drone: role("swarm", "organ:0.5"),
      },
    },
  }),
  card({
    id: "suomisaundi",
    summary:
      "Suomisaundi: playful psytrance with mixolydian quirks, rolling bass, absurd stop-start perc",
    tempo: { bpm: [138, 150], typical: 145 },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["dorian", 0.5],
      ],
    },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    bass: { behaviour: [["ostinato", 1]], onsets: ROLLING },
    rhythm: { onsets: { perc: grid("x..x.x....x.x..x") } },
    texture: {
      roles: {
        perc: MACHINE_OPT,
        chords: null,
        lead: role("square", "organ:0.4"),
      },
    },
  }),
  card({
    id: "psybient",
    summary:
      "Psybient and psydub: half-tempo psychedelic ambient, dub delays, phrygian drones, sparse kit",
    tempo: { bpm: [80, 110], typical: 95 },
    meter: { hypermeter: [[8, 1]] },
    pitch: {
      scales: [
        ["phrygian", 0.5],
        ["dorian", 0.5],
      ],
    },
    harmony: { model: "drone" },
    rhythm: { onsets: { kick: BROKEN_KICK, clap: HALF_TIME, hat: OFFBEAT } },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      roles: {
        chords: null,
        arp: null,
        drone: role("cloud", "organ:0.5"),
        pad: role("granular"),
      },
    },
    mix: { space: 0.75, loudness: "streaming" },
  }),
];

// ---------------------------------------------------------------------------
// Hardcore and hard dance.
// Refs: Simon Reynolds, "Energy Flash" (Picador, 1998); Butler (2006).

const HARDCORE: readonly StyleCard[] = [
  card({
    id: "hardcore-family",
    abstract: true,
    summary:
      "hardcore: 150-200 bpm, distorted overdriven kick as the lead instrument, minor riffs, loud master",
    tempo: { bpm: [150, 200], typical: 170 },
    harmony: {
      presets: [
        ["aeolian", 0.6],
        ["andalusian", 0.4],
      ],
      sevenths: 0,
    },
    form: { roleMap: DANCE_ROLEMAP },
    mix: { fx: { kick: { distort: "crunch" } }, loudness: "loud" },
    texture: { roles: { kick: MACHINE } },
  }),
  card({
    id: "rave-hardcore",
    summary:
      "Breakbeat hardcore: syncopated break snare against a four-floor-free kick, major piano stabs, rave hoover",
    tempo: { bpm: [140, 160], typical: 150 },
    rhythm: {
      onsets: {
        kick: BROKEN_KICK,
        snare: grid("....x..1.x..x..1"),
        clap: null,
        hat: EIGHTHS,
      },
    },
    pitch: {
      scales: [
        ["major", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["aeolian", 0.5],
      ],
    },
    texture: {
      roles: {
        snare: MACHINE,
        clap: null,
        chords: role("piano"),
        lead: role("saw", "lead:0.5"),
      },
    },
    mix: { fx: { kick: { distort: "warm" } } },
  }),
  card({
    id: "happy-hardcore",
    summary:
      "Happy hardcore: 165-180 bpm, bright major I-V-vi-IV piano, off-beat bass stabs, euphoric stepwise leads",
    tempo: { bpm: [165, 180], typical: 172 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["axis", 0.6],
        ["fifties", 0.4],
      ],
      cadences: [["V-I", 1]],
    },
    bass: { behaviour: [["root", 1]], onsets: OFFBEAT },
    texture: {
      roles: { chords: role("piano"), lead: role("saw", "lead:0.5") },
    },
  }),
  card({
    id: "gabber",
    summary:
      "Gabber: 160-200 bpm fuzz-distorted kick on every beat that is also the bass (no separate bassline), off-beat hats, dark minor stabs",
    tempo: { bpm: [160, 200], typical: 180 },
    bass: { behaviour: [["none", 1]] },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    texture: { roles: { chords: maybe("saw"), lead: role("saw") } },
    mix: { fx: { kick: { distort: "fuzz" } } },
  }),
  card({
    id: "doomcore",
    summary:
      "Doomcore: slow hardcore 140-170 bpm, phrygian and locrian drones, distorted kick, dread over melody",
    tempo: { bpm: [140, 170], typical: 155 },
    pitch: {
      scales: [
        ["phrygian", 0.5],
        ["locrian", 0.5],
      ],
    },
    harmony: { model: "drone" },
    melody: { density: [0.5, 1.5] },
    texture: { roles: { chords: null, drone: role("organ", "swarm:0.5") } },
    mix: { space: 0.5 },
  }),
  card({
    id: "speedcore",
    summary:
      "Speedcore and extratone: 250-300 bpm, kick drum as a pitched buzz, 8th or 16th kick streams, atonal",
    tempo: { bpm: [250, 300], typical: 280 },
    harmony: { model: "drone" },
    rhythm: {
      onsets: { kick: EIGHTHS, clap: null, hat: null },
      fills: { every: 8, density: [0, 0.1] },
    },
    melody: { density: [0.5, 1] },
    texture: {
      roles: { clap: null, hat: null, chords: null, lead: maybe("square") },
    },
    mix: { fx: { kick: { distort: "fuzz" } } },
  }),
  card({
    id: "hardstyle",
    summary:
      "Hardstyle: 145-155 bpm, reverse bass tail on every off-beat, pitched distorted kick, epic minor supersaw leads",
    tempo: { bpm: [145, 155], typical: 150 },
    bass: { behaviour: [["root", 1]], onsets: OFFBEAT },
    texture: {
      roles: {
        bass: role("saw"),
        chords: role("saw"),
        lead: role("saw", "lead:0.5"),
      },
    },
    mix: { fx: { bass: { distort: "shape" } } },
  }),
  card({
    id: "jumpstyle",
    summary:
      "Jumpstyle: 138-145 bpm hard kick with off-beat bass, no hi-hat bed (off-beat percussion instead), two-chord minor stabs, shuffle-dance groove",
    tempo: { bpm: [138, 145], typical: 142 },
    groove: { swingRatio: [1.1, 1.3] },
    rhythm: { onsets: { hat: null, perc: grid("..x...x...x...x.") } },
    harmony: { presets: [["dorian-vamp", 1]] },
    bass: { behaviour: [["root", 1]], onsets: OFFBEAT },
    texture: { roles: { bass: role("square"), perc: MACHINE } },
  }),
  card({
    id: "frenchcore",
    summary:
      "Frenchcore and uptempo: 190-210 bpm distorted kick with an off-beat bass jump, harmonic-minor riffs",
    tempo: { bpm: [190, 210], typical: 200 },
    pitch: {
      scales: [
        ["harmonic-minor", 0.6],
        ["minor", 0.4],
      ],
    },
    bass: { behaviour: [["root", 1]], onsets: OFFBEAT },
    texture: { roles: { lead: role("saw", "violins:0.4") } },
    mix: { fx: { kick: { distort: "fuzz" } } },
  }),
  card({
    id: "j-core",
    summary:
      "J-core: 170-200 bpm, major anime-pop changes (canon and I-V-vi-IV), bright 16th arps, chopped breaks",
    tempo: { bpm: [170, 200], typical: 185 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["canon", 0.5],
        ["axis", 0.5],
      ],
      cadences: [["V-I", 1]],
    },
    rhythm: { onsets: { arp: SIXTEENTHS } },
    texture: {
      roles: {
        arp: role("square", "pluck:0.5"),
        chords: role("piano", "saw:0.5"),
        lead: role("lead", "square:0.5"),
      },
    },
  }),
  card({
    id: "lento-violento",
    summary:
      "Lento violento: hardcore slowed to 90-110 bpm, heavy distorted kick, sludgy phrygian riffs",
    tempo: { bpm: [90, 110], typical: 100 },
    pitch: { scales: [["phrygian", 1]] },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    texture: { roles: { chords: null, lead: role("saw") } },
    mix: { fx: { kick: { distort: "fuzz" } } },
  }),
  card({
    id: "freetekno",
    summary:
      "Freetekno: free-party 160-180 bpm, acid 303 bass, relentless four-on-the-floor, minimal modal harmony",
    tempo: { bpm: [160, 180], typical: 170 },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x.xxx.xxx.xxx.xx") },
    texture: { roles: { chords: null, bass: role("saw") } },
    mix: {
      fx: { bass: { autofilter: "env-follow" }, kick: { distort: "warm" } },
    },
  }),
];

// ---------------------------------------------------------------------------
// Downtempo and chill.
// Refs: Reynolds (1998) on trip hop; Adam Harper, "Infinite Music"
// (Zero, 2011) on vaporwave and hypnagogic pop.

const DOWNTEMPO: readonly StyleCard[] = [
  card({
    id: "downtempo-family",
    abstract: true,
    summary:
      "downtempo: 70-110 bpm, broken half-step beats, jazz-tinged seventh chords, dub space",
    tempo: { bpm: [70, 110], typical: 90 },
    groove: { swingRatio: [1, 1.3], humanize: { timingMs: 4, velocity: 0.05 } },
    rhythm: {
      onsets: {
        kick: BROKEN_KICK,
        snare: BACKBEAT,
        clap: null,
      },
    },
    harmony: { sevenths: 0.8 },
    form: {
      plans: [
        [
          ["intro", "verse", "chorus", "breakdown", "verse", "chorus", "outro"],
          1,
        ],
      ],
      archetype: "verse-chorus",
    },
    texture: {
      roles: { snare: MACHINE, clap: null, chords: role("epiano", "keys:0.5") },
    },
    mix: { space: 0.5, loudness: "streaming" },
  }),
  card({
    id: "downtempo",
    summary:
      "Downtempo: relaxed broken beat at 85-100 bpm, minor ninth loops, warm electric piano, dub delay",
    tempo: { bpm: [85, 100], typical: 92 },
    texture: { roles: { kick: LOFI } },
    mix: { space: 0.6 },
  }),
  card({
    id: "trip-hop",
    summary:
      "Trip hop: slow swung boom-bap backbeat under 100 bpm, minor and harmonic-minor strings, vinyl-crackle space",
    tempo: { bpm: [70, 95], typical: 84 },
    groove: { swingRatio: [1.2, 1.5] },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["harmonic-minor", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["andalusian", 0.5],
        ["aeolian", 0.5],
      ],
    },
    texture: {
      roles: {
        kick: LOFI,
        chords: role("strings", "rhodes:0.5"),
        lead: role("violins", "lead:0.4"),
      },
    },
    mix: { fx: { chords: { crush: "lofi" } } },
  }),
  card({
    id: "illbient",
    summary:
      "Illbient: dub-wise dark urban ambient, half-time sparse beat, drone pedal, delay and reverb as form",
    tempo: { bpm: [70, 90], typical: 80 },
    harmony: { model: "drone" },
    rhythm: { onsets: { kick: grid("x.........5....."), snare: HALF_TIME } },
    bass: { behaviour: [["pedal", 1]] },
    texture: { roles: { chords: null, drone: role("organ", "swarm:0.5") } },
    mix: { space: 0.75 },
  }),
  card({
    id: "leftfield",
    summary:
      "Leftfield: eclectic genre-blending electronica at 100-120 bpm, dub bass, unusual timbres over four-on-the-floor",
    tempo: { bpm: [100, 120], typical: 112 },
    rhythm: { onsets: { kick: FOUR_FLOOR, hat: OFFBEAT } },
    harmony: { model: "modal", rhythm: [[0.5, 1]] },
    texture: {
      roles: { lead: role("granular", "pluck:0.5"), chords: maybe("organ") },
    },
  }),
  card({
    id: "chillwave",
    summary:
      "Chillwave: hazy major-seventh loops, chorused synths, tape wobble, soft backbeat at 80-110 bpm",
    tempo: { bpm: [80, 110], typical: 96 },
    pitch: {
      scales: [
        ["major", 0.7],
        ["lydian", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["canon", 0.5],
      ],
      cadences: [["IV-I", 1]],
    },
    rhythm: { onsets: { kick: grid("x.......x......."), hat: EIGHTHS } },
    texture: {
      roles: {
        kick: LOFI,
        chords: role("keys", "dreampop:0.5"),
        lead: role("lead"),
      },
    },
    mix: { fx: { chords: { chorus: "wide", wobble: "tape" } } },
  }),
  card({
    id: "vaporwave",
    summary:
      "Vaporwave: slowed smooth-jazz and muzak ii-V major ninths, pitched-down loop repetition, tape wobble, reverb wash",
    tempo: { bpm: [60, 90], typical: 75 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["ii-v-i", 0.7],
        ["turnaround", 0.3],
      ],
      cadences: [["V-I", 1]],
      sevenths: 1,
    },
    melody: { repetition: 0.95 },
    texture: {
      roles: {
        chords: role("epiano", "sax:0.3"),
        lead: role("sax", "epiano:0.4"),
      },
    },
    mix: { fx: { chords: { wobble: "tape" } }, space: 0.7 },
  }),
  card({
    id: "future-funk",
    summary:
      "Future funk: chopped disco loops at 110-125 bpm, four-on-the-floor, major ninth ii-V vamps, slap bass, sidechain pump",
    tempo: { bpm: [110, 125], typical: 118 },
    groove: { swingRatio: [1, 1.15] },
    pitch: {
      scales: [
        ["major", 0.6],
        ["dorian", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["ii-v-i", 0.5],
        ["dorian-vamp", 0.5],
      ],
      sevenths: 0.9,
    },
    rhythm: { onsets: { kick: FOUR_FLOOR, snare: BACKBEAT, hat: OFFBEAT } },
    bass: { behaviour: [["octave", 1]], onsets: EIGHTHS },
    texture: {
      roles: { bass: role("slap"), chords: role("rhodes", "strings:0.5") },
    },
    mix: { fx: { chords: { duck: "pump" } }, loudness: "club" },
  }),
  card({
    id: "witch-house",
    summary:
      "Witch house: half-time at 60-80 bpm (snare only on beat 3), triplet hats, dark phrygian drones, 808 sub",
    tempo: { bpm: [60, 80], typical: 70 },
    groove: { subdivision: 3, swingRatio: [1, 1] },
    pitch: {
      scales: [
        ["phrygian", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: { model: "drone" },
    rhythm: {
      onsets: {
        kick: grid("x.....x....."),
        snare: grid("......x....."),
        hat: grid("xxxxxxxxxxxx"),
      },
      fills: { every: 8, density: [0, 0] },
    },
    bass: { behaviour: [["pedal", 1]] },
    texture: {
      roles: { kick: TRAP, chords: null, drone: role("choir", "organ:0.5") },
    },
    mix: { space: 0.7 },
  }),
];

// ---------------------------------------------------------------------------
// Ambient and synthesizer music.
// Refs: Brian Eno, liner notes to "Ambient 1: Music for Airports" (1978);
// Mark Prendergast, "The Ambient Century" (Bloomsbury, 2000).

const AMBIENT: readonly StyleCard[] = [
  card({
    id: "ambient-family",
    abstract: true,
    summary:
      "ambient: no kit, pedal-point drones and slow pads, modal stasis instead of cadence, long reverb tails",
    tempo: { bpm: [60, 100], typical: 80 },
    harmony: { model: "modal", rhythm: [[0.25, 1]] },
    melody: { density: [0, 1], repetition: 0.5 },
    bass: { behaviour: [["pedal", 1]], onsets: DOWNBEAT },
    form: {
      plans: [[["intro", "verse", "bridge", "verse", "outro"], 1]],
      archetype: "through-composed",
    },
    texture: {
      roles: {
        ...NO_KIT,
        chords: null,
        pad: role("strings", "granular:0.6"),
        drone: role("organ", "cloud:0.5"),
        lead: maybe("bell", "pluck:0.5"),
      },
    },
    mix: { space: 0.85, loudness: "ambient" },
  }),
  card({
    id: "ambient",
    summary:
      "Ambient: tonic pedal with slow major and lydian modal pads, sparse bell tones, music as environment",
    pitch: {
      scales: [
        ["major", 0.5],
        ["lydian", 0.5],
      ],
    },
    texture: { roles: { lead: maybe("bell", "celesta:0.5") } },
  }),
  card({
    id: "dark-ambient",
    summary:
      "Dark ambient: phrygian and locrian drones, low swarming textures, no pulse, dread through dissonant pedal",
    tempo: { bpm: [50, 80], typical: 65 },
    pitch: {
      scales: [
        ["phrygian", 0.5],
        ["locrian", 0.5],
      ],
    },
    harmony: { model: "drone" },
    melody: { density: [0, 0.5], range: [48, 72] },
    texture: {
      roles: {
        pad: role("swarm", "granular:0.5"),
        drone: role("organ"),
        lead: maybe("gong", "bowl:0.5"),
      },
    },
  }),
  card({
    id: "space-ambient",
    summary:
      "Space ambient: lydian raised-fourth shimmer over a sub pedal, slow cloud textures, vast reverb",
    pitch: { scales: [["lydian", 1]] },
    texture: {
      roles: {
        pad: role("cloud", "strings:0.5"),
        lead: maybe("sparkle", "bell:0.5"),
      },
    },
    mix: { space: 0.95 },
  }),
  card({
    id: "berlin-school",
    summary:
      "Berlin school: interlocking 16th sequencer arpeggios over an 8th sequencer bass ostinato, no kit, slow filter evolution, long modal sections",
    tempo: { bpm: [100, 130], typical: 115 },
    meter: { hypermeter: [[16, 1]] },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["dorian", 0.4],
      ],
    },
    rhythm: { onsets: { arp: SIXTEENTHS } },
    bass: { behaviour: [["ostinato", 1]], onsets: EIGHTHS },
    melody: { density: [1, 2] },
    texture: {
      roles: {
        arp: role("saw", "pluck:0.5"),
        pad: role("strings"),
        lead: maybe("lead"),
      },
    },
    mix: { fx: { arp: { autofilter: "slow-sweep" } } },
  }),
  card({
    id: "new-age",
    summary:
      "New age: consonant major and pentatonic modes, harp and piano arpeggio over pads, gentle functional cadences",
    tempo: { bpm: [60, 90], typical: 72 },
    pitch: {
      scales: [
        ["major", 0.5],
        ["major-pentatonic", 0.5],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["canon", 0.5],
        ["axis", 0.5],
      ],
      cadences: [
        ["IV-I", 0.6],
        ["V-I", 0.4],
      ],
      rhythm: [[0.5, 1]],
    },
    texture: {
      roles: {
        chords: role("harp", "piano:0.6"),
        lead: role("flute", "piano:0.5"),
      },
    },
  }),
  card({
    id: "dungeon-synth",
    summary:
      "Dungeon synth: lo-fi organ and string synth in harmonic minor, i-iv-V and Andalusian descents, medieval drone",
    tempo: { bpm: [60, 100], typical: 80 },
    pitch: {
      scales: [
        ["harmonic-minor", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["andalusian", 0.5],
        ["aeolian", 0.5],
      ],
      cadences: [["V-I", 1]],
      rhythm: [[1, 1]],
      sevenths: 0,
    },
    melody: { density: [1, 2] },
    texture: {
      roles: {
        chords: role("organ", "strings:0.5"),
        lead: role("flute", "organ:0.5"),
        drone: null,
      },
    },
    mix: { fx: { chords: { crush: "lofi" } } },
  }),
  card({
    id: "ambient-techno",
    summary:
      "Ambient techno: soft four-on-the-floor and off-beat hat under long dorian pads, dub chord echoes",
    tempo: { bpm: [110, 125], typical: 118 },
    pitch: {
      scales: [
        ["dorian", 0.6],
        ["minor", 0.4],
      ],
    },
    rhythm: { onsets: { kick: FOUR_FLOOR, hat: OFFBEAT } },
    texture: { roles: { kick: K808, hat: K808_OPT } },
    mix: { space: 0.7, loudness: "streaming" },
  }),
  card({
    id: "japanese-ambient",
    summary:
      "Kankyo ongaku: environmental music in major pentatonic, sparse marimba and piano cells, silence as structure",
    tempo: { bpm: [60, 90], typical: 72 },
    pitch: { scales: [["major-pentatonic", 1]] },
    melody: { density: [0.5, 1], repetition: 0.7 },
    texture: {
      roles: {
        pad: role("felt", "strings:0.4"),
        lead: role("marimba", "piano:0.5", "vibes:0.3"),
        drone: null,
      },
    },
    mix: { space: 0.6 },
  }),
];

// ---------------------------------------------------------------------------
// IDM and experimental electronic.
// Refs: Kim Cascone, "The Aesthetics of Failure" (Computer Music Journal
// 24:4, 2000); S. Alexander Reed, "Assimilate: A Critical History of
// Industrial Music" (Oxford UP, 2013).

const IDM: readonly StyleCard[] = [
  card({
    id: "idm-family",
    abstract: true,
    summary:
      "IDM: irregular programmed beats, additive 7/8 and 5/4 groupings, probabilistic ghost hits, modal colour",
    meter: {
      signatures: [
        ["4/4", 0.6],
        ["7/8", 0.2],
        ["5/4", 0.2],
      ],
    },
    harmony: { model: "modal" },
    rhythm: {
      onsets: {
        kick: grid("x..1..x...1.x..."),
        clap: grid("....x..1....x.1."),
        hat: grid("x1x1x1x1x1x1x1x1"),
      },
    },
  }),
  card({
    id: "idm",
    summary:
      "IDM: displaced kick and snare, 16th ghost-note programming, additive meters, warm modal pads",
    texture: {
      roles: {
        pad: role("strings", "granular:0.4"),
        lead: role("pluck", "bell:0.4"),
      },
    },
  }),
  card({
    id: "glitch",
    summary:
      "Glitch electronica: clicks, skips and bit-crushed micro-edits as rhythm, aesthetics of failure, sparse modal pitch",
    rhythm: {
      onsets: { rim: grid("3.3..4.3.3..4..3"), perc: grid(".4..3.4...3.4..3") },
    },
    melody: { density: [0.5, 1.5] },
    texture: {
      roles: {
        rim: MACHINE_OPT,
        perc: MACHINE_OPT,
        lead: role("microloop", "grains:0.5"),
      },
    },
    mix: { fx: { rim: { crush: "destroy" }, perc: { crush: "8-bit" } } },
  }),
  card({
    id: "folktronica",
    summary:
      "Folktronica: fingerpicked acoustic guitar and folk modes (mixolydian, dorian) over programmed beats",
    tempo: { bpm: [85, 120], typical: 100 },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["dorian", 0.5],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["mixolydian-rock", 0.5],
        ["dorian-vamp", 0.5],
      ],
    },
    texture: {
      roles: {
        chords: role("nylon", "steel:0.5"),
        lead: role("flute", "kalimba:0.5"),
      },
    },
  }),
  card({
    id: "electronica",
    summary:
      "Electronica: song-length electronic pop structures, minor and dorian loops, clean programmed beats",
    meter: { signatures: [["4/4", 1]] },
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.5],
        ["sad-pop", 0.5],
      ],
    },
    texture: {
      roles: {
        chords: role("keys", "saw:0.5"),
        lead: role("lead", "pluck:0.5"),
      },
    },
  }),
  card({
    id: "industrial",
    summary:
      "Industrial: metallic perc and noise loops, distorted machine beats, phrygian and locrian riffs, harsh timbre",
    tempo: { bpm: [100, 130], typical: 115 },
    meter: { signatures: [["4/4", 1]] },
    pitch: {
      scales: [
        ["phrygian", 0.5],
        ["locrian", 0.5],
      ],
    },
    rhythm: {
      onsets: {
        kick: FOUR_FLOOR,
        snare: BACKBEAT,
        clap: null,
        perc: grid("x..x..x...x..x.."),
      },
    },
    texture: {
      roles: {
        snare: MACHINE,
        clap: null,
        perc: MACHINE_OPT,
        lead: role("saw"),
      },
    },
    mix: {
      fx: { snare: { distort: "fuzz" }, perc: { distort: "crunch" } },
      loudness: "loud",
    },
  }),
  card({
    id: "aggrotech",
    summary:
      "Aggrotech and dark electro: distorted four-on-the-floor EBM drive, harmonic-minor supersaw riffs, harsh snare",
    tempo: { bpm: [125, 140], typical: 132 },
    meter: { signatures: [["4/4", 1]] },
    pitch: {
      scales: [
        ["harmonic-minor", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.5],
        ["andalusian", 0.5],
      ],
    },
    rhythm: {
      onsets: { kick: FOUR_FLOOR, snare: BACKBEAT, clap: null, hat: OFFBEAT },
    },
    texture: { roles: { snare: MACHINE, clap: null, lead: role("saw") } },
    mix: { fx: { kick: { distort: "crunch" } }, loudness: "loud" },
  }),
  card({
    id: "dark-wave",
    summary:
      "Darkwave: post-punk backbeat on drum machine, chorused minor bass melodies, aeolian loops, cold synth pads",
    tempo: { bpm: [100, 130], typical: 116 },
    meter: { signatures: [["4/4", 1]] },
    pitch: { scales: [["minor", 1]] },
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.6],
        ["andalusian", 0.4],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x.x....."),
        snare: BACKBEAT,
        clap: null,
        hat: EIGHTHS,
      },
    },
    bass: { behaviour: [["ostinato", 1]], onsets: EIGHTHS },
    texture: {
      roles: {
        snare: MACHINE,
        clap: null,
        bass: role("ebass"),
        chords: role("strings", "saw:0.5"),
      },
    },
    mix: { fx: { bass: { chorus: "wide" } } },
  }),
  card({
    id: "minimal-wave",
    summary:
      "Minimal synth: one or two monophonic synths over a bare drum machine, square bass ostinato, aeolian two-chord loops",
    tempo: { bpm: [100, 125], typical: 112 },
    meter: { signatures: [["4/4", 1]] },
    pitch: { scales: [["minor", 1]] },
    harmony: {
      model: "functional",
      presets: [
        ["dorian-vamp", 0.5],
        ["aeolian", 0.5],
      ],
      sevenths: 0,
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: BACKBEAT,
        clap: null,
        hat: OFFBEAT,
      },
    },
    bass: { behaviour: [["ostinato", 1]], onsets: EIGHTHS },
    texture: {
      roles: {
        snare: MACHINE,
        clap: null,
        bass: role("square"),
        chords: null,
        lead: role("square", "triangle:0.5"),
      },
    },
  }),
  card({
    id: "neofolk",
    summary:
      "Neofolk: strummed acoustic guitar, martial snare and tom tattoo, aeolian and dorian modes, often in 3/4",
    tempo: { bpm: [70, 110], typical: 90 },
    meter: {
      signatures: [
        ["4/4", 0.5],
        ["3/4", 0.5],
      ],
    },
    groove: { humanize: { timingMs: 8, velocity: 0.08 } },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["dorian", 0.5],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.5],
        ["andalusian", 0.5],
      ],
      voicing: {
        types: [["open", 1]],
        range: [45, 69],
        notes: [4, 6],
        strokes: [["folk", 1]],
      },
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("x.xx....x.xx...."),
        tom: grid("....x.......x..."),
        clap: null,
        hat: null,
      },
    },
    texture: {
      roles: {
        kick: ACOUSTIC,
        snare: ACOUSTIC,
        tom: ACOUSTIC_OPT,
        clap: null,
        hat: null,
        chords: role("steel", "nylon:0.5"),
        lead: role("violin", "flute:0.4"),
      },
    },
    mix: { loudness: "streaming" },
  }),
];

// ---------------------------------------------------------------------------
// Synthwave and chip.
// Refs: Karen Collins, "Game Sound" (MIT Press, 2008) on chip voices;
// synthwave as retro-futurist pastiche per Harper (2011).

const SYNTHWAVE: readonly StyleCard[] = [
  card({
    id: "synthwave-family",
    abstract: true,
    summary:
      "synthwave and chip: gated backbeat snare, 16th-note octave bass, minor pop vi-IV-I-V and aeolian loops",
    tempo: { bpm: [80, 120], typical: 100 },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: BACKBEAT,
        clap: null,
        hat: EIGHTHS,
      },
    },
    harmony: {
      presets: [
        ["sad-pop", 0.5],
        ["aeolian", 0.5],
      ],
    },
    bass: { behaviour: [["octave", 1]], onsets: SIXTEENTHS },
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
      archetype: "verse-chorus",
    },
    texture: {
      roles: {
        snare: MACHINE,
        clap: null,
        chords: role("saw"),
        lead: role("square", "lead:0.6"),
      },
    },
    mix: { loudness: "streaming" },
  }),
  card({
    id: "synthwave",
    summary:
      "Synthwave: retro 80s gated-reverb backbeat, 16th octave bass, aeolian and vi-IV-I-V pads, chorused saw leads",
    tempo: { bpm: [80, 118], typical: 100 },
    texture: {
      roles: {
        kick: K808,
        pad: role("strings", "saw:0.5"),
        lead: role("saw", "lead:0.5"),
      },
    },
    mix: { fx: { chords: { chorus: "wide" } } },
  }),
  card({
    id: "darksynth",
    summary:
      "Darksynth: aggressive synthwave with distorted bass, phrygian riffs, four-on-the-floor drive at 100-130 bpm",
    tempo: { bpm: [100, 130], typical: 118 },
    pitch: {
      scales: [
        ["phrygian", 0.5],
        ["minor", 0.5],
      ],
    },
    rhythm: { onsets: { kick: FOUR_FLOOR } },
    texture: { roles: { lead: role("saw") } },
    mix: { fx: { bass: { distort: "crunch" } }, loudness: "loud" },
  }),
  card({
    id: "chiptune",
    summary:
      "Chiptune: two pulse waves, a triangle bass and noise drums; fast arpeggios stand in for chords",
    tempo: { bpm: [120, 160], typical: 140 },
    pitch: {
      scales: [
        ["major", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.4],
        ["canon", 0.3],
        ["aeolian", 0.3],
      ],
    },
    rhythm: {
      onsets: { arp: SIXTEENTHS, kick: grid("x.......x.x....."), hat: EIGHTHS },
    },
    bass: { behaviour: [["octave", 1]], onsets: EIGHTHS },
    texture: {
      roles: {
        chords: null,
        pad: null,
        arp: role("square"),
        bass: role("triangle"),
        lead: role("square"),
      },
    },
    mix: { fx: { lead: { crush: "8-bit" }, arp: { crush: "8-bit" } } },
  }),
  card({
    id: "future-pop",
    summary:
      "Future pop: EBM drive meets trance pads, four-on-the-floor at 120-135 bpm, minor vi-IV-I-V supersaw chords",
    tempo: { bpm: [120, 135], typical: 128 },
    rhythm: { onsets: { kick: FOUR_FLOOR, hat: OFFBEAT } },
    bass: { behaviour: [["ostinato", 1]], onsets: OFFBEAT },
    texture: {
      roles: {
        pad: role("strings", "saw:0.5"),
        lead: role("lead", "vocoder:0.3"),
      },
    },
  }),
];

export const ELECTRONIC_CARDS: readonly StyleCard[] = Object.freeze([
  ...ROOT,
  ...DISCO,
  ...HOUSE,
  ...TECHNO,
  ...TRANCE,
  ...HARDCORE,
  ...DOWNTEMPO,
  ...AMBIENT,
  ...IDM,
  ...SYNTHWAVE,
]);
