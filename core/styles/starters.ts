/**
 * A small, edited shelf of reusable grooves. These are original patterns,
 * not transcriptions: the listening references describe pocket and timbre.
 * A starter keeps its full band throughout the loop, has no lead, and puts
 * each supporting part on its own track so it can be muted or replaced.
 * The historical taxonomy remains available separately.
 */
import { grid, kitRoles, role } from "./parts.ts";
import { card, type ResolvedStyle, type StyleCard } from "./schema.ts";

export const GROOVE_GROUPS = Object.freeze([
  { id: "machines", title: "Machines", detail: "four-floor · electro · disco" },
  { id: "breaks", title: "Breaks", detail: "garage · jungle · hip hop · trap" },
  { id: "pocket", title: "Pocket", detail: "funk · rock · shuffle · swing" },
  { id: "cycles", title: "Cycles", detail: "dub · bossa · clave · odd meter" },
] as const);

export type GrooveGroup = (typeof GROOVE_GROUPS)[number]["id"];
export type GrooveStarter = Readonly<{
  id: string;
  title: string;
  group: GrooveGroup;
  detail: string;
  /** Listening orientation, never a claim of an exact reproduction. */
  touchstone: string;
  card: StyleCard;
}>;

const BACK = grid("....x.......x...");
const FLOOR = grid("x...x...x...x...");
const EIGHTHS = grid("x.x.x.x.x.x.x.x.");
const OFF = grid("..x...x...x...x.");

function starter(
  id: string,
  title: string,
  group: GrooveGroup,
  detail: string,
  touchstone: string,
  bpm: number,
  patch: Omit<StyleCard, "id">,
): GrooveStarter {
  return Object.freeze({
    id,
    title,
    group,
    detail,
    touchstone,
    card: card({
      id,
      summary: `${detail}. Original groove; listening cue: ${touchstone}.`,
      tempo: { bpm: [bpm, bpm], typical: bpm },
      ...patch,
    }),
  });
}

export const GROOVE_STARTERS: readonly GrooveStarter[] = Object.freeze([
  // Machines and breaks.
  starter(
    "warehouse",
    "Warehouse",
    "machines",
    "122 BPM · 909 + Rhodes",
    "early Chicago house: steady floor, open offbeats, short warm stabs",
    122,
    {
      pitch: { scales: [["dorian", 1]], tonic: [[5, 1]] },
      rhythm: {
        onsets: {
          kick: FLOOR,
          snare: null,
          clap: BACK,
          // Shuffled closed hats on the e and a, the open hat owns the and.
          hat: grid("3x.x3x.x3x.x3x.x"),
          openhat: OFF,
          // Minor-ninth stabs planed between two chords, pushed off the beat.
          chords: grid("..x..6....x..x.."),
        },
      },
      groove: {
        swingRatio: [1.25, 1.25],
        velocity: [1, 0.5, 0.82, 0.64],
        humanize: { timingMs: 2, velocity: 0.04 },
      },
      harmony: {
        model: "functional",
        presets: null,
        forms: [
          [["i9", "IV9"], 2],
          [["i9", "v9"], 1],
        ],
        rhythm: [[0.5, 1]],
        sevenths: 0,
        cadences: [],
        voicing: { types: [["close", 1]], range: [53, 72], notes: [3, 5] },
      },
      texture: {
        roles: {
          ...kitRoles("syn909", ["kick", "clap", "hat", "openhat"]),
          snare: null,
          chords: role("rhodes"),
        },
      },
      expression: { articulation: { chords: [["staccato", 1]] } },
      mix: { levels: { chords: -9, openhat: -14 }, space: 0.18 },
    },
  ),
  starter(
    "motor-city",
    "Motor City",
    "machines",
    "130 BPM · 909 + pad",
    "Detroit techno: dry machine drive and a distant sustained chord",
    130,
    {
      pitch: { scales: [["minor", 1]], tonic: [[2, 1]] },
      rhythm: {
        onsets: {
          kick: FLOOR,
          snare: null,
          clap: BACK,
          hat: grid("x5.xx5.xx5.xx5.x"),
          openhat: OFF,
          // A three-step rim loop that turns over against the four-bar.
          rim: grid("..5..x..5..x..5."),
        },
      },
      groove: {
        velocity: [1, 0.5, 0.9, 0.62],
        humanize: { timingMs: 1.5, velocity: 0.05 },
      },
      harmony: {
        model: "functional",
        presets: null,
        forms: [
          [["i9", "bVImaj7"], 2],
          [["i7", "iv9"], 1],
        ],
        rhythm: [[0.5, 1]],
        sevenths: 0,
        cadences: [],
        voicing: { types: [["open", 1]], range: [55, 79], notes: [3, 5] },
      },
      bass: {
        behaviour: [
          ["root", 3],
          ["octave", 1],
        ],
        range: [33, 45],
        onsets: grid("..x...x...x...xx"),
      },
      texture: {
        roles: {
          ...kitRoles("syn909", ["kick", "clap", "hat", "openhat", "rim"]),
          snare: null,
          pad: role("strings"),
          bass: role("bass"),
        },
      },
      expression: { articulation: { bass: [["staccato", 1]] } },
      mix: { levels: { pad: -15, bass: -7 }, space: 0.22 },
    },
  ),
  starter(
    "wire-step",
    "Wire Step",
    "machines",
    "114 BPM · 808 + sub",
    "Planet Rock-era electro: broken kick and clipped machine backbeat",
    114,
    {
      pitch: { scales: [["phrygian", 1]], tonic: [[4, 1]] },
      rhythm: {
        onsets: {
          kick: grid("x......x..x...6."),
          snare: BACK,
          clap: grid("............x..."),
          hat: grid("x.x.x.xxx.x.x.xx"),
          // Cold stabs that answer the kick.
          chords: grid("...x..x......4.."),
        },
      },
      groove: {
        velocity: [1, 0.7, 0.85, 0.8],
        humanize: { timingMs: 1, velocity: 0.03 },
      },
      harmony: {
        model: "functional",
        presets: null,
        forms: [
          [["i", "bII"], 2],
          [["i", "bvii", "bVI", "bII"], 1],
        ],
        rhythm: [[0.5, 1]],
        sevenths: 0,
        cadences: [],
        voicing: { types: [["close", 1]], range: [60, 76], notes: [3, 3] },
      },
      bass: {
        behaviour: [
          ["root", 2],
          ["octave", 1],
        ],
        // E2: an octave above the 808 kick's G1 boom, so the two never smear.
        range: [31, 43],
        onsets: grid("x......x..x...6."),
        kickLock: 0.8,
      },
      texture: {
        roles: {
          ...kitRoles("syn808", ["kick", "snare", "hat", "clap"]),
          bass: role("bass"),
          chords: role("saw"),
        },
      },
      expression: {
        articulation: { bass: [["staccato", 1]], chords: [["staccato", 1]] },
      },
      mix: { levels: { chords: -14, bass: -5 }, space: 0.1 },
    },
  ),
  starter(
    "disco-dusk",
    "Disco Dusk",
    "machines",
    "118 BPM · kit + octave bass",
    "Chic-era disco: even kick, lifted offbeat hats and octave propulsion",
    118,
    {
      pitch: { scales: [["dorian", 1]], tonic: [[4, 1]] },
      rhythm: {
        onsets: {
          kick: FLOOR,
          snare: grid("....x..2....x..."),
          hat: grid("x..6x..6x..6x..6"),
          openhat: OFF,
          chords: grid("....x..4....x..."),
        },
      },
      groove: {
        velocity: [1, 0.5, 0.86, 0.6],
        roleOffset: { snare: 0.03 },
        humanize: { timingMs: 4, velocity: 0.06 },
      },
      harmony: {
        model: "functional",
        presets: null,
        forms: [
          [["i7", "IV7"], 2],
          [["i7", "i7", "IV7", "bVII"], 1],
        ],
        rhythm: [[1, 1]],
        sevenths: 0,
        cadences: [],
        voicing: { types: [["close", 1]], range: [55, 74], notes: [3, 4] },
      },
      bass: {
        behaviour: [["octave", 1]],
        range: [28, 47],
        onsets: grid("x.x.x.x.x.x.x.x."),
      },
      texture: {
        roles: {
          ...kitRoles("acoustic", ["kick", "snare", "hat", "openhat"]),
          bass: role("fender"),
          chords: role("funk"),
        },
      },
      expression: {
        articulation: {
          bass: [
            ["staccato", 3],
            ["tenuto", 1],
          ],
          chords: [["staccato", 1]],
        },
      },
      mix: { levels: { chords: -12, bass: -5 }, space: 0.14 },
    },
  ),
  starter(
    "night-garage",
    "Night Garage",
    "breaks",
    "132 BPM · swung 2-step",
    "late-90s UK garage: skipped kicks, swung hats and a firm backbeat",
    132,
    {
      pitch: { scales: [["minor", 1]], tonic: [[5, 1]] },
      rhythm: {
        onsets: {
          kick: grid("x.....x..x......"),
          snare: BACK,
          hat: grid("..x...x7..x...x7"),
          openhat: grid("...x.......x...."),
          rim: grid(".4.....6.....4.."),
          chords: grid("...x.....x......"),
        },
      },
      groove: {
        swingRatio: [1.5, 1.5],
        velocity: [1, 0.72, 0.85, 0.6],
        humanize: { timingMs: 3, velocity: 0.05 },
      },
      harmony: {
        model: "functional",
        presets: null,
        forms: [
          [["i9", "iv9"], 2],
          [["i9", "bVImaj7", "iv9", "v7"], 1],
        ],
        rhythm: [[0.5, 1]],
        sevenths: 0,
        cadences: [],
        voicing: { types: [["close", 1]], range: [55, 72], notes: [3, 5] },
      },
      bass: {
        behaviour: [
          ["root", 3],
          ["octave", 1],
        ],
        range: [29, 41],
        onsets: grid("x.....x..x....4."),
        kickLock: 0.75,
      },
      texture: {
        roles: {
          ...kitRoles("syn909", ["kick", "snare", "hat", "openhat", "rim"]),
          bass: role("bass"),
          chords: role("hammond"),
        },
      },
      expression: { articulation: { chords: [["staccato", 1]] } },
      mix: { levels: { chords: -12, bass: -6 }, space: 0.12 },
    },
  ),
  starter(
    "jungle-cut",
    "Jungle Cut",
    "breaks",
    "164 BPM · chopped break + sub",
    "early jungle: displaced snares, sixteenth ghosts and roomy sub notes",
    164,
    {
      pitch: { scales: [["minor", 1]], tonic: [[7, 1]] },
      rhythm: {
        onsets: {
          kick: grid("x.x.......x6...."),
          // Backbeat with the break's pickups; the last snare sometimes
          // jumps to the and of four.
          snare: grid("....x..x.x..7.3x"),
          hat: grid("x.x.x.x.x.x.x.x."),
          openhat: grid("..........3....."),
        },
      },
      groove: {
        microtiming: [0, 0.08, 0.03, 0.1],
        velocity: [1, 0.5, 0.82, 0.62],
        humanize: { timingMs: 3, velocity: 0.06 },
      },
      harmony: {
        model: "functional",
        presets: null,
        forms: [
          [["i9", "bVImaj7"], 2],
          [["i9", "iv9"], 1],
        ],
        rhythm: [[0.5, 1]],
        sevenths: 0,
        cadences: [],
        voicing: { types: [["open", 1]], range: [55, 79], notes: [3, 5] },
      },
      bass: {
        behaviour: [
          ["root", 3],
          ["ostinato", 1],
        ],
        range: [28, 40],
        onsets: grid("x.........x....."),
      },
      texture: {
        roles: {
          ...kitRoles("breaks", ["kick", "snare", "hat", "openhat"]),
          bass: role("triangle"),
          pad: role("aah"),
        },
      },
      expression: { articulation: { bass: [["tenuto", 1]] } },
      mix: { levels: { bass: -3, pad: -16, hat: -14 }, space: 0.1 },
    },
  ),
  starter(
    "dust-pocket",
    "Dust Pocket",
    "breaks",
    "88 BPM · dusty kit + keys",
    "90s boom bap: laid-back snare, sparse kick and soft electric-piano punctuation",
    88,
    {
      pitch: { scales: [["minor", 1]], tonic: [[9, 1]] },
      rhythm: {
        onsets: {
          kick: grid("x......x..x...3."),
          snare: grid("....x.....2.x..2"),
          hat: grid("x.7.x.8.x.7.x.86"),
          chords: grid("x.....3...x....."),
        },
      },
      groove: {
        swingRatio: [1.45, 1.45],
        velocity: [1, 0.45, 0.72, 0.66],
        roleOffset: { snare: 0.09, hat: -0.04 },
        humanize: { timingMs: 5, velocity: 0.07 },
      },
      harmony: {
        model: "functional",
        presets: null,
        forms: [
          [["i9", "iv9"], 2],
          [["i9", "bVII", "bVImaj7", "v7"], 1],
        ],
        rhythm: [[1, 1]],
        sevenths: 0,
        cadences: [],
        voicing: { types: [["close", 1]], range: [55, 72], notes: [3, 5] },
      },
      bass: {
        behaviour: [
          ["root", 3],
          ["root-fifth", 1],
        ],
        range: [33, 47],
        onsets: grid("x......x..x...3."),
        kickLock: 0.8,
      },
      texture: {
        roles: {
          ...kitRoles("lofi"),
          chords: role("wurli"),
          bass: role("doublebass"),
        },
      },
      expression: {
        articulation: {
          bass: [
            ["tenuto", 2],
            ["staccato", 1],
          ],
        },
      },
      mix: { levels: { chords: -12, bass: -4 }, space: 0.12 },
    },
  ),
  starter(
    "trap-door",
    "Trap Door",
    "breaks",
    "142 BPM · half-time 808",
    "early Southern trap: long kick tails, half-time clap and short hat bursts",
    142,
    {
      // The kit's long 808 rings near F1 (43 Hz): the key sits on it.
      pitch: { scales: [["harmonic-minor", 1]], tonic: [[5, 1]] },
      rhythm: {
        onsets: {
          kick: grid("x.....x....x..6."),
          snare: null,
          clap: grid("........x......."),
          // 32nd steps: eighths, a sixteenth pair on beat 3, and a roll
          // into the next bar that only sometimes fills in.
          hat: grid("x...x...|x...x...|x...x.x.|x.x.x6x6"),
          chords: grid("x..x..x........."),
        },
      },
      texture: {
        roles: {
          ...kitRoles("trap", ["kick", "clap", "hat"]),
          snare: null,
          chords: role("celesta"),
        },
      },
      harmony: {
        model: "functional",
        presets: null,
        forms: [
          [["i", "bVI"], 2],
          [["i", "iv"], 1],
        ],
        rhythm: [[0.5, 1]],
        sevenths: 0,
        cadences: [],
        voicing: { types: [["close", 1]], range: [60, 79], notes: [3, 3] },
      },
      groove: {
        subdivision: 8,
        velocity: [1, 0.55, 0.72, 0.55, 0.88, 0.6, 0.82, 0.62],
        humanize: { timingMs: 1, velocity: 0.04 },
      },
      mix: { levels: { chords: -12 }, space: 0.08 },
    },
  ),
  // Pocket and cycles.
  starter(
    "pocket-one",
    "Pocket One",
    "pocket",
    "102 BPM · funk kit + muted bass",
    "James Brown-era funk: weight on the one, syncopated kick and dry ghost notes",
    102,
    {
      rhythm: {
        onsets: {
          kick: grid("x..x..x...x..x.."),
          snare: grid("...2x..2...3x..."),
          hat: grid("xxxxxxxxxxxxxxxx"),
        },
      },
      bass: {
        behaviour: [["root-fifth", 1]],
        range: [33, 48],
        onsets: grid("x..x..x...x..x.."),
        kickLock: 1,
      },
      texture: { roles: { ...kitRoles("acoustic"), bass: role("motown") } },
      groove: {
        velocity: [1, 0.4, 0.7, 0.4],
        humanize: { timingMs: 2, velocity: 0.05 },
      },
    },
  ),
  starter(
    "half-stack",
    "Half Stack",
    "pocket",
    "76 BPM · roomy rock kit",
    "When the Levee Breaks-era weight: broad half-time backbeat and a patient kick",
    76,
    {
      rhythm: {
        onsets: {
          kick: grid("x..x......x..x.."),
          snare: grid("........x......."),
          hat: EIGHTHS,
          tom: grid("..............2."),
        },
      },
      texture: {
        roles: { ...kitRoles("acoustic", ["kick", "snare", "hat", "tom"]) },
      },
      groove: {
        roleOffset: { snare: 0.06 },
        humanize: { timingMs: 3, velocity: 0.04 },
      },
      mix: { space: 0.4, levels: { hat: -13, snare: -1 } },
    },
  ),
  starter(
    "blue-shuffle",
    "Blue Shuffle",
    "pocket",
    "108 BPM · triplet shuffle",
    "Chicago blues shuffle: triplet ride, backbeat and an unhurried low pulse",
    108,
    {
      groove: { subdivision: 3, velocity: [1, 0.5, 0.7] },
      rhythm: {
        onsets: {
          kick: grid("x.....x....."),
          snare: grid("...x.....x.."),
          hat: grid("x.xx.xx.xx.x"),
        },
      },
      texture: { roles: { ...kitRoles("acoustic") } },
    },
  ),
  starter(
    "small-hours",
    "Small Hours",
    "pocket",
    "156 BPM · swing + upright",
    "small-group jazz: skip-beat cymbal, quiet snare and four walking bass notes",
    156,
    {
      groove: {
        subdivision: 3,
        velocity: [1, 0.4, 0.65],
        humanize: { timingMs: 3, velocity: 0.05 },
      },
      rhythm: {
        onsets: {
          kick: grid("3.....3....."),
          snare: grid("...3.....3.."),
          hat: grid("x..x.xx..x.x"),
        },
      },
      harmony: {
        model: "functional",
        presets: [["ii-v-i", 1]],
        rhythm: [[0.5, 1]],
        sevenths: 1,
      },
      bass: {
        behaviour: [["walking", 1]],
        range: [33, 52],
        walk: { chordToneOnOne: 1, chromaticApproach: 0.12 },
      },
      texture: { roles: { ...kitRoles("acoustic"), bass: role("doublebass") } },
      mix: {
        levels: { kick: -15, snare: -16, hat: -9, bass: -3 },
        space: 0.15,
      },
    },
  ),
  starter(
    "tape-skank",
    "Tape Skank",
    "cycles",
    "72 BPM · one-drop + bass + skank",
    "70s roots dub: empty downbeat, one-drop on three and clipped offbeat guitar",
    72,
    {
      rhythm: {
        onsets: {
          kick: grid("........x......."),
          snare: null,
          rim: grid("........x......."),
          hat: EIGHTHS,
          chords: OFF,
        },
      },
      bass: {
        behaviour: [["root-fifth", 1]],
        range: [31, 47],
        onsets: grid("..x...x.x....x.."),
      },
      texture: {
        roles: {
          ...kitRoles("acoustic", ["kick", "rim", "hat"]),
          snare: null,
          bass: role("fender"),
          chords: role("nylon"),
        },
      },
      mix: { levels: { bass: -3, chords: -12, hat: -16 }, space: 0.24 },
    },
  ),
  starter(
    "bossa-side",
    "Bossa Side",
    "cycles",
    "126 BPM · bossa + nylon",
    "classic bossa nova: soft low pulse, cross-stick syncopation and nylon comping",
    126,
    {
      rhythm: {
        onsets: {
          kick: grid("x.....x.x.....x."),
          snare: null,
          rim: grid("x.....x.....x..x"),
          hat: OFF,
          chords: grid("x.....x...x..x.."),
        },
      },
      harmony: {
        model: "functional",
        presets: [["ii-v-i", 1]],
        rhythm: [[0.5, 1]],
        sevenths: 1,
        voicing: { types: [["close", 1]], range: [52, 72], notes: [4, 4] },
      },
      texture: {
        roles: {
          ...kitRoles("acoustic", ["kick", "rim", "hat"]),
          snare: null,
          chords: role("nylon"),
        },
      },
      mix: {
        levels: { kick: -12, rim: -10, hat: -17, chords: -5 },
        space: 0.1,
      },
    },
  ),
  starter(
    "clave-club",
    "Clave Club",
    "cycles",
    "104 BPM · two-bar son clave",
    "Afro-Cuban son: a 3-2 clave against a repeating low tumbao pulse",
    104,
    {
      rhythm: {
        onsets: {
          kick: grid("......x.......x.......x.......x."),
          snare: null,
          rim: grid("x.....x.....x.......x...x......."),
          hat: grid("x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x."),
          bell: grid("x...x.x...x.x...x...x.x...x.x..."),
        },
      },
      // An 8/4 loop preserves the two-bar relationship rather than squeezing
      // a 32-step clave into one bar of sixteenths.
      meter: { signatures: [["8/4", 1]], hypermeter: [[1, 1]] },
      texture: {
        roles: {
          ...kitRoles("acoustic", ["kick", "rim", "hat"]),
          snare: null,
          bell: role("bell"),
        },
      },
      mix: { levels: { kick: -10, rim: -6, hat: -16, bell: -17 }, space: 0.06 },
    },
  ),
  starter(
    "frame-seven",
    "Frame Seven",
    "cycles",
    "112 BPM · 2+2+3 frame drum",
    "Balkan dance meters: a clear short-short-long cycle with contrasting low and high strokes",
    112,
    {
      meter: {
        signatures: [["7/8", 1]],
        grouping: [[[2, 2, 3], 1]],
        hypermeter: [[2, 1]],
      },
      groove: { subdivision: 2, velocity: [1, 0.7] },
      rhythm: {
        onsets: { kick: null, snare: null, hat: null, perc: grid("x.xx.xx") },
      },
      texture: {
        roles: { kick: null, snare: null, hat: null, perc: role("bodhran") },
      },
      mix: { levels: { perc: -1 }, space: 0.14 },
    },
  ),
]);

export const GROOVE_CARDS: readonly StyleCard[] = Object.freeze([
  card({
    id: "grooves",
    abstract: true,
    summary:
      "Reusable drum grooves with room for your own melody; supporting parts stay on separate tracks",
    tempo: { bpm: [120, 120], typical: 120 },
    groove: { humanize: { timingMs: 1, velocity: 0.025 } },
    rhythm: { onsets: { kick: FLOOR, snare: BACK, hat: EIGHTHS }, fills: null },
    pitch: { scales: [["dorian", 1]], tonic: [[0, 1]] },
    harmony: { model: "modal", rhythm: [[0.25, 1]], cadences: [] },
    form: {
      plans: [[["verse"], 1]],
      energy: { verse: 0.8 },
      archetype: "loop",
    },
    texture: {
      roles: {
        ...kitRoles("syn909"),
        lead: null,
        counter: null,
        arp: null,
        bass: null,
        chords: null,
      },
    },
    expression: { dynamics: [0.55, 0.85] },
    mix: {
      levels: { kick: -3, snare: -5, clap: -7, hat: -13, rim: -8, bass: -6 },
      space: 0.08,
    },
  }),
  ...GROOVE_STARTERS.map((entry) => entry.card),
]);

/** Keep legacy solo styles playable; accompaniment styles leave melody space. */
export function accompanimentStyle(style: ResolvedStyle): ResolvedStyle {
  const roles = { ...style.texture.roles };
  delete roles.lead;
  delete roles.counter;
  delete roles.arp;
  if (!Object.values(roles).some((role) => role?.voices.length)) return style;
  return { ...style, texture: { ...style.texture, roles } };
}
