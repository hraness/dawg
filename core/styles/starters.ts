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
  starter(
    "warehouse",
    "Warehouse",
    "machines",
    "122 BPM · 909 + Rhodes",
    "early Chicago house: steady floor, open offbeats, short warm stabs",
    122,
    {
      rhythm: {
        onsets: {
          kick: FLOOR,
          snare: null,
          clap: BACK,
          hat: grid(".2.x.2.x.2.x.2.x"),
          openhat: OFF,
          chords: OFF,
        },
      },
      texture: {
        roles: {
          ...kitRoles("syn909", ["kick", "clap", "hat", "openhat"]),
          snare: null,
          chords: role("rhodes"),
        },
      },
      harmony: {
        voicing: { types: [["close", 1]], range: [52, 69], notes: [3, 3] },
      },
      mix: { levels: { chords: -10, openhat: -14 }, space: 0.16 },
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
      rhythm: {
        onsets: {
          kick: FLOOR,
          snare: BACK,
          hat: grid("x.xx..xxx.xx..xx"),
          tom: grid("...x......x...x."),
        },
      },
      texture: {
        roles: {
          ...kitRoles("syn909", ["kick", "snare", "hat", "tom"]),
          pad: role("strings"),
        },
      },
      mix: { levels: { pad: -18, tom: -10 }, space: 0.24 },
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
      rhythm: {
        onsets: {
          kick: grid("x.....x...x.x..."),
          snare: BACK,
          hat: grid("x.x.xx..x.x.x.xx"),
          clap: grid("............x..."),
        },
      },
      bass: {
        behaviour: [["root", 1]],
        range: [31, 43],
        onsets: grid("x.....x...x..x.."),
      },
      texture: {
        roles: {
          ...kitRoles("syn808", ["kick", "snare", "hat", "clap"]),
          bass: role("bass"),
        },
      },
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
      rhythm: {
        onsets: { kick: FLOOR, snare: BACK, hat: EIGHTHS, openhat: OFF },
      },
      bass: {
        behaviour: [["octave", 1]],
        range: [33, 52],
        onsets: grid("x.x.x.xx..x.x.xx"),
      },
      groove: { humanize: { timingMs: 3, velocity: 0.045 } },
      texture: {
        roles: {
          ...kitRoles("acoustic", ["kick", "snare", "hat", "openhat"]),
          bass: role("fender"),
        },
      },
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
      rhythm: {
        onsets: {
          kick: grid("x.....x....x...."),
          snare: BACK,
          hat: grid("x.xx..x.x.xx..x."),
          rim: grid("...2......2....x"),
        },
      },
      groove: { swingRatio: [1.5, 1.5], velocity: [1, 0.45, 0.8, 0.55] },
      texture: {
        roles: { ...kitRoles("syn909", ["kick", "snare", "hat", "rim"]) },
      },
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
      rhythm: {
        onsets: {
          kick: grid("x.........x..x.."),
          snare: grid("....x..3....x..x"),
          hat: grid("x.xxx.x.x.xxxx.x"),
          openhat: grid("......x........."),
        },
      },
      bass: {
        behaviour: [["root", 1]],
        range: [28, 40],
        onsets: grid("x.......x......."),
      },
      texture: {
        roles: {
          ...kitRoles("lofi", ["kick", "snare", "hat", "openhat"]),
          bass: role("triangle"),
        },
      },
      mix: { levels: { bass: -8, hat: -14 }, space: 0.06 },
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
      rhythm: {
        onsets: {
          kick: grid("x..2..x...x....."),
          snare: BACK,
          hat: grid("x.6.x.8.x.6.x.8."),
          chords: grid("x.........x....."),
        },
      },
      groove: {
        swingRatio: [1.45, 1.45],
        roleOffset: { snare: 0.09 },
        humanize: { timingMs: 4, velocity: 0.06 },
      },
      texture: { roles: { ...kitRoles("lofi"), chords: role("wurli") } },
      mix: { levels: { chords: -11 }, space: 0.12 },
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
      rhythm: {
        onsets: {
          kick: grid("x.....x....x..x."),
          snare: null,
          clap: grid("........x......."),
          hat: grid("x.x.xx.xx.x.xxxx"),
        },
      },
      texture: {
        roles: { ...kitRoles("trap", ["kick", "clap", "hat"]), snare: null },
      },
      groove: { velocity: [1, 0.45, 0.7, 0.38] },
      mix: { space: 0.04 },
    },
  ),
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
