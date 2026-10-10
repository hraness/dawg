/**
 * Pop, hip hop and breakbeat bass (quality-08 family `pop`). Root and
 * branch cards carry what a branch shares; each leaf carries only its
 * deltas and a summary that names the theory it encodes (backbeat
 * placement, half-time feel, two-step kick, dembow, tresillo, royal-road
 * progression, yonanuki minor, ppongjjak two-beat and so on).
 * `breakbeat-family` sits under `electronic` in the tree but belongs to
 * this family's file.
 *
 * References (theory, not quotation):
 * - pop: Philip Tagg, Everyday Tonality (2009); Allan F. Moore, Song Means
 *   (2012), on loops, modal interchange and verse-chorus form.
 * - hip hop: Kyle Adams, "On the Metrical Techniques of Flow in Rap Music"
 *   (Music Theory Online 15.5, 2009); Joseph Schloss, Making Beats (2004).
 * - breakbeat and UK bass: Mark J. Butler, Unlocking the Groove (2006);
 *   Simon Reynolds, Energy Flash (1998), on the hardcore continuum.
 *
 * Every rhythm here is an abstract onset grid and every progression a
 * functional numeral grammar; no melody, lyric or recording is quoted.
 */

import { grid, intervals, kit, maybe, role } from "./parts.ts";
import {
  card,
  type RoleTexture,
  type RoleVoice,
  type StyleCard,
} from "./schema.ts";

// ---------------------------------------------------------------------------
// Shared grids (16 steps = one 4/4 bar of sixteenths unless noted)

const BACKBEAT = grid("....x.......x...");
const HALF_SNARE = grid("........x.......");
const FOUR_FLOOR = grid("x...x...x...x...");
const EIGHTH_HAT = grid("x.x.x.x.x.x.x.x.");
const SIXTEENTH_HAT = grid("xxxxxxxxxxxxxxxx");
const OFFBEAT_HAT = grid("..x...x...x...x.");
/** Trap hats: straight 16ths with probabilistic roll steps. */
const TRAP_HAT = grid("x.x.x.x.x.x.x5xx");
/** Two-step drum and bass: kick on 1 and the "and" of 3, snare on 2 and 4. */
const TWO_STEP_KICK = grid("x.........x.....");
/** Dembow: four-on-the-floor kick under snare on steps 3, 6, 11, 14. */
const DEMBOW_SNARE = grid("...x..x....x..x.");
/** Tresillo 3+3+2 sixteenths, once per half bar (the dembow bass cell). */
const TRESILLO = grid("x..x..x.x..x..x.");
/** Boom bap kick: 1, the "and" of 2-ish, the "a" of 3. */
const BOOM_BAP_KICK = grid("x......x..x.....");

/**
 * Kit choices. The kit roles share one drum track, so every kit role of a
 * card names the same choice (the generator takes the first kit role's).
 */
const kitChoice = (...voices: RoleVoice[]): RoleTexture =>
  Object.freeze({ required: true, voices: Object.freeze(voices) });
const MACHINE = kitChoice(kit("syn808"), kit("trap", 0.6));
const TRAP_KIT = kitChoice(kit("trap"), kit("syn808", 0.4));
const ACOUSTIC_KIT = kitChoice(kit("acoustic"));
const DUSTY_KIT = kitChoice(kit("lofi"), kit("acoustic", 0.4));
const ELECTRO_KIT = kitChoice(kit("electro"), kit("syn808", 0.5));
const CLUB_KIT = kitChoice(kit("syn909"), kit("electro", 0.4));
/** The same kit choice as an optional role. */
const opt = (choice: RoleTexture): RoleTexture =>
  Object.freeze({ required: false, voices: choice.voices });

/** Every kit role on one kit choice (clap and open hat optional). */
function kitAll(choice: RoleTexture): Record<string, RoleTexture> {
  return {
    kick: choice,
    snare: choice,
    hat: choice,
    clap: opt(choice),
    openhat: opt(choice),
  };
}

type LeafBody = Omit<StyleCard, "id" | "summary" | "seedSalt">;

/** A leaf card: id, a summary naming its theory, an origin-year salt. */
function leaf(
  id: string,
  summary: string,
  seedSalt: number,
  body: LeafBody,
): StyleCard {
  return card({ id, summary, seedSalt, ...body });
}

const PIANO_BALLAD = intervals(5, 3, 1, 1.2);
const RAP_FLOW = intervals(4, 2, 0.4, 3);
const HOOKY = intervals(5, 3, 0.8, 1.6);

// ---------------------------------------------------------------------------
// Root and branches

const ROOTS: readonly StyleCard[] = [
  card({
    id: "pop",
    abstract: true,
    summary:
      "song-first: repeating hooks, backbeat on 2 and 4, I-V-vi-IV loops, verse-pre-chorus-chorus",
    tempo: { bpm: [80, 130], typical: 112 },
    rhythm: {
      onsets: {
        kick: grid("x.......x.x....."),
        snare: BACKBEAT,
        hat: EIGHTH_HAT,
      },
    },
    harmony: {
      presets: [
        ["axis", 0.4],
        ["sad-pop", 0.3],
        ["fifties", 0.15],
        ["canon", 0.15],
      ],
    },
    melody: {
      repetition: 0.75,
      ambitus: [7, 12],
      phraseBars: [
        [2, 0.5],
        [4, 0.5],
      ],
      intervals: HOOKY,
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
            "bridge",
            "chorus",
          ],
          1,
        ],
      ],
    },
    texture: {
      roles: {
        chords: role("piano", "acoustic:0.5", "keys:0.5"),
        lead: role("sing", "lead:0.5"),
        pad: maybe("strings"),
      },
    },
    mix: { loudness: "streaming" },
  }),
  card({
    id: "traditional-pop",
    abstract: true,
    summary:
      "crooner and standards pop: 32-bar AABA, ii-V turnarounds, two-beat bass, strings",
    groove: { subdivision: 2, swingRatio: [1, 1.6] },
    rhythm: {
      onsets: {
        kick: grid("x...x..."),
        snare: grid("..x...x."),
        hat: grid("x.x.x.x."),
      },
    },
    harmony: {
      presets: [
        ["turnaround", 0.5],
        ["ii-v-i", 0.5],
      ],
      sevenths: 0.6,
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x...") },
    form: {
      plans: [[["verse", "verse", "bridge", "verse"], 1]],
      archetype: "AABA",
    },
    texture: {
      kind: "homophonic",
      roles: {
        kick: ACOUSTIC_KIT,
        snare: ACOUSTIC_KIT,
        hat: ACOUSTIC_KIT,
        chords: role("strings", "piano:0.6"),
        bass: role("contrabass", "upright:0.5"),
      },
    },
    expression: { dynamics: [0.35, 0.85] },
    mix: { space: 0.35 },
  }),
  card({
    id: "sixties-pop",
    abstract: true,
    summary:
      "1960s pop: fifties progressions, tambourine backbeat, eighth-note feel, vocal harmony",
    groove: { subdivision: 2 },
    rhythm: {
      onsets: {
        kick: grid("x...x.x."),
        snare: grid("..x...x."),
        hat: grid("xxxxxxxx"),
      },
    },
    harmony: {
      presets: [
        ["fifties", 0.6],
        ["axis", 0.4],
      ],
    },
    bass: { onsets: grid("x...x.x.") },
    texture: {
      roles: {
        kick: ACOUSTIC_KIT,
        snare: ACOUSTIC_KIT,
        hat: ACOUSTIC_KIT,
        bass: role("fender", "bass:0.5"),
        chords: role("jangle", "piano:0.5"),
        counter: maybe("choir"),
      },
    },
  }),
  card({
    id: "modern-pop",
    abstract: true,
    summary:
      "modern pop: programmed drums, four-chord loops, sparse verses, big choruses",
    rhythm: { onsets: { clap: BACKBEAT } },
    texture: {
      roles: { ...kitAll(MACHINE), chords: role("keys", "pluck:0.5") },
    },
  }),
  card({
    id: "hip-hop",
    abstract: true,
    summary:
      "beat-first: boom-bap or trap grids, loops of one to four chords, rap-led flow on the 16th grid",
    tempo: { bpm: [70, 100], typical: 90 },
    groove: { swingRatio: [1, 1.3], humanize: { timingMs: 6, velocity: 0.08 } },
    rhythm: {
      onsets: {
        kick: BOOM_BAP_KICK,
        snare: BACKBEAT,
        hat: EIGHTH_HAT,
      },
    },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["dorian", 0.3],
        ["minor-pentatonic", 0.2],
      ],
    },
    harmony: {
      model: "functional",
      presets: [
        ["aeolian", 0.4],
        ["dorian-vamp", 0.3],
        ["sad-pop", 0.3],
      ],
      rhythm: [
        [1, 0.5],
        [0.5, 0.5],
      ],
      sevenths: 0.5,
    },
    melody: {
      density: [1, 2],
      repetition: 0.85,
      ambitus: [3, 8],
      intervals: RAP_FLOW,
    },
    bass: {
      behaviour: [
        ["root", 0.6],
        ["ostinato", 0.4],
      ],
    },
    form: {
      plans: [[["intro", "verse", "chorus", "verse", "chorus", "outro"], 1]],
    },
    texture: {
      roles: {
        kick: MACHINE,
        snare: MACHINE,
        hat: MACHINE,
        chords: role("epiano", "keys:0.5", "strings:0.3"),
        lead: role("vocal", "pluck:0.5"),
      },
    },
    mix: { loudness: "loud" },
  }),
  card({
    id: "old-school",
    abstract: true,
    summary:
      "old-school hip hop: break loops, electro drum machines, one-chord funk vamps",
    tempo: { bpm: [95, 115], typical: 104 },
    harmony: { model: "modal" },
    texture: { roles: kitAll(ELECTRO_KIT) },
  }),
  card({
    id: "regional-rap",
    abstract: true,
    summary: "regional rap: boom-bap swing, bounce, crunk and g-funk grooves",
    groove: { swingRatio: [1.1, 1.4] },
  }),
  card({
    id: "modern-rap",
    abstract: true,
    summary:
      "trap-era rap: half-time snare on 3, rolling 16th hats, 808 sub on the kick",
    tempo: { bpm: [130, 160], typical: 140 },
    groove: { swingRatio: [1, 1.1], humanize: { timingMs: 2, velocity: 0.06 } },
    rhythm: {
      onsets: {
        kick: grid("x.....x.......x."),
        snare: HALF_SNARE,
        hat: TRAP_HAT,
      },
    },
    bass: {
      behaviour: [["root", 1]],
      onsets: grid("x.....x.......x."),
      kickLock: 0.6,
    },
    texture: { roles: kitAll(TRAP_KIT) },
  }),
  card({
    id: "breakbeat-family",
    abstract: true,
    summary:
      "breakbeat and bass: syncopated broken kits off the four-on-the-floor, sub bass, 130-175 bpm",
    tempo: { bpm: [130, 175], typical: 170 },
    meter: { hypermeter: [[8, 1]] },
    groove: { humanize: { timingMs: 1, velocity: 0.05 } },
    rhythm: {
      onsets: {
        kick: TWO_STEP_KICK,
        snare: BACKBEAT,
        hat: EIGHTH_HAT,
        // The electronic root's clap on 2 and 4 would fight half-time
        // snares; leaves that clap name their own grid.
        clap: null,
      },
      fills: { every: 8, density: [0.3, 0.6] },
    },
    pitch: {
      scales: [
        ["minor", 0.7],
        ["phrygian", 0.3],
      ],
    },
    harmony: { presets: [["aeolian", 1]], rhythm: [[0.5, 1]] },
    melody: { repetition: 0.85 },
    bass: {
      behaviour: [
        ["root", 0.5],
        ["octave", 0.5],
      ],
      range: [26, 45],
    },
    form: {
      plans: [[["intro", "build", "drop", "breakdown", "drop", "outro"], 1]],
      archetype: "build-drop",
    },
    texture: {
      roles: {
        ...kitAll(MACHINE),
        bass: role("bass", "saw:0.5"),
        chords: role("keys", "strings:0.5"),
        lead: maybe("lead"),
      },
    },
    mix: { loudness: "club" },
  }),
];

// ---------------------------------------------------------------------------
// Traditional pop (two-beat, swung eighths, standards harmony)

const WALTZ_KICK = grid("x.....");
const WALTZ_SNARE = grid("..x.x.");
const WALTZ_HAT = grid("x.x.x.");

const TRADITIONAL: readonly StyleCard[] = [
  leaf(
    "tin-pan-alley",
    "32-bar AABA standard: I-vi-ii-V turnaround, ii-V-I bridge in the subdominant, swung two-beat",
    1920,
    {
      tempo: { bpm: [100, 150], typical: 126 },
      groove: { swingRatio: [1.5, 2] },
      harmony: {
        presets: [
          ["turnaround", 0.6],
          ["ii-v-i", 0.4],
        ],
        cadences: [
          ["V-I", 0.8],
          ["half", 0.2],
        ],
        sevenths: 0.8,
      },
      melody: { ambitus: [9, 13], chordToneRate: 0.8 },
    },
  ),
  leaf(
    "crooner",
    "crooner ballad: slow swung eighths, sevenths and sixths, rubato phrasing over strings and brushed kit",
    1940,
    {
      tempo: { bpm: [60, 96], typical: 76 },
      groove: { swingRatio: [1.4, 1.8] },
      harmony: { sevenths: 0.85 },
      melody: { density: [0.5, 1.5], intervals: PIANO_BALLAD },
      texture: {
        roles: { chords: role("strings", "grand:0.6"), pad: maybe("violins") },
      },
      expression: { dynamics: [0.3, 0.75] },
    },
  ),
  leaf(
    "lounge",
    "lounge and space-age pop: major sevenths and ninths, latin-tinged straight eights, vibes and organ",
    1958,
    {
      tempo: { bpm: [100, 135], typical: 116 },
      groove: { swingRatio: [1, 1.2] },
      rhythm: { onsets: { kick: grid("x..xx..."), rim: grid("..x..x.x") } },
      harmony: { presets: [["ii-v-i", 1]], sevenths: 0.9 },
      texture: {
        roles: {
          rim: opt(ACOUSTIC_KIT),
          chords: role("vibes", "hammond:0.5", "piano:0.4"),
          lead: role("flute", "vibes:0.5", "ooh:0.4"),
        },
      },
    },
  ),
  leaf(
    "exotica",
    "exotica: phrygian-dominant and lydian color, vibes, bells and hand percussion over a mambo-like ostinato",
    1957,
    {
      tempo: { bpm: [90, 125], typical: 104 },
      groove: { swingRatio: [1, 1] },
      rhythm: {
        onsets: {
          kick: grid("x..x..x."),
          perc: grid("x.xx.xx."),
          bell: grid("..x...x."),
        },
      },
      pitch: {
        scales: [
          ["phrygian-dominant", 0.4],
          ["lydian", 0.3],
          ["major-pentatonic", 0.3],
        ],
      },
      harmony: { model: "modal", sevenths: 0.7 },
      bass: { behaviour: [["ostinato", 1]] },
      texture: {
        roles: {
          perc: role("drums"),
          bell: maybe("bell", "chimes:0.5"),
          chords: role("vibes", "marimba:0.6", "harp:0.4"),
          lead: role("vibes", "flute:0.5"),
        },
      },
      mix: { space: 0.5 },
    },
  ),
  leaf(
    "light-music",
    "light orchestral music: diatonic major, string melody with woodwind countermelody, homophonic, no drums",
    1935,
    {
      groove: { swingRatio: [1, 1] },
      meter: {
        signatures: [
          ["4/4", 0.7],
          ["3/4", 0.3],
        ],
      },
      harmony: {
        presets: [
          ["canon", 0.5],
          ["fifties", 0.5],
        ],
        sevenths: 0.2,
        voicing: { types: [["open", 1]], range: [48, 79], notes: [3, 5] },
      },
      texture: {
        roles: {
          kick: null,
          snare: null,
          hat: null,
          chords: role("strings", "harp:0.4"),
          lead: role("violins", "flute:0.5", "oboe:0.4"),
          counter: maybe("clarinet", "horn:0.5"),
        },
      },
      mix: { space: 0.45, loudness: "classical" },
    },
  ),
  leaf(
    "schlager",
    "schlager: oom-pah two-beat (bass on 1 and 3, chord on 2 and 4), plain I-IV-V major, singalong chorus",
    1960,
    {
      tempo: { bpm: [110, 140], typical: 124 },
      groove: { swingRatio: [1, 1] },
      rhythm: {
        onsets: {
          kick: grid("x...x..."),
          snare: grid("..x...x."),
          hat: grid("x.x.x.x."),
        },
      },
      pitch: { scales: [["major", 1]] },
      harmony: {
        sources: { forms: 1, presets: 0, chain: 0 },
        forms: [
          [["I", "I", "V7", "V7", "V7", "V7", "I", "I"], 0.4],
          [["I", "IV", "V7", "I"], 0.4],
          [["I", "I", "IV", "IV", "V7", "V7", "I", "I"], 0.2],
        ],
        sevenths: 0,
      },
      bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x...") },
      melody: { ambitus: [7, 11], repetition: 0.85 },
      texture: {
        roles: { chords: role("reeds", "keys:0.5"), lead: role("sing") },
      },
    },
  ),
  leaf(
    "chanson",
    "chanson: text-led melody, valse-musette 3/4 or rubato 4/4, minor with harmonic-minor V",
    1930,
    {
      meter: {
        signatures: [
          ["3/4", 0.5],
          ["4/4", 0.5],
        ],
      },
      tempo: { bpm: [80, 160], typical: 120 },
      rhythm: {
        onsets: { kick: WALTZ_KICK, snare: WALTZ_SNARE, hat: WALTZ_HAT },
      },
      pitch: {
        scales: [
          ["harmonic-minor", 0.5],
          ["minor", 0.3],
          ["major", 0.2],
        ],
      },
      harmony: {
        presets: [
          ["minor-ii-v", 0.5],
          ["aeolian", 0.5],
        ],
      },
      melody: { density: [1, 3], chordToneRate: 0.6 },
      bass: { onsets: grid("x.....") },
      texture: {
        roles: {
          chords: role("reeds", "piano:0.6", "nylon:0.4"),
          bass: role("contrabass"),
        },
      },
    },
  ),
  leaf(
    "canzone",
    "canzone italiana: bel-canto melody with wide climaxing leaps, I-vi-IV-V, strings and nylon guitar",
    1951,
    {
      groove: { swingRatio: [1, 1] },
      tempo: { bpm: [70, 120], typical: 92 },
      harmony: {
        presets: [
          ["fifties", 0.5],
          ["canon", 0.3],
          ["minor-ii-v", 0.2],
        ],
      },
      melody: {
        ambitus: [10, 15],
        intervals: intervals(4, 3, 1.6, 1),
        contour: [["arch", 1]],
      },
      texture: { roles: { chords: role("nylon", "strings:0.6", "piano:0.4") } },
    },
  ),
  leaf(
    "european-pop-ballad",
    "Euro ballad: piano-led verse, I-V-vi-IV chorus, final chorus up a step (truck-driver modulation in the form)",
    1975,
    {
      groove: { subdivision: 4, swingRatio: [1, 1] },
      tempo: { bpm: [66, 100], typical: 80 },
      rhythm: {
        onsets: {
          kick: grid("x.......x......."),
          snare: BACKBEAT,
          hat: EIGHTH_HAT,
        },
      },
      harmony: {
        presets: [
          ["axis", 0.5],
          ["canon", 0.5],
        ],
        sevenths: 0.15,
      },
      bass: { behaviour: [["root", 1]], onsets: grid("x.......x.......") },
      melody: { ambitus: [10, 14], intervals: PIANO_BALLAD },
      texture: {
        roles: { chords: role("grand", "strings:0.5"), bass: role("bass") },
      },
    },
  ),
  leaf(
    "musette",
    "bal musette: fast valse 3/4, chromatic passing tones, accordion lead, bass on 1 and chord on 2-3",
    1910,
    {
      meter: { signatures: [["3/4", 1]] },
      tempo: { bpm: [140, 200], typical: 168 },
      groove: { swingRatio: [1.2, 1.5] },
      rhythm: { onsets: { kick: WALTZ_KICK, snare: WALTZ_SNARE, hat: null } },
      pitch: {
        scales: [
          ["harmonic-minor", 0.5],
          ["major", 0.5],
        ],
      },
      harmony: {
        presets: [
          ["minor-ii-v", 0.5],
          ["turnaround", 0.5],
        ],
      },
      melody: { density: [2, 3], intervals: intervals(6, 2, 0.6, 0.6) },
      bass: { onsets: grid("x.....") },
      texture: {
        roles: {
          hat: null,
          chords: role("reeds", "nylon:0.5"),
          lead: role("reeds"),
        },
      },
    },
  ),
  leaf(
    "kayokyoku",
    "kayokyoku: yonanuki minor melody (1 2 b3 5 b6, no 4th or 7th) over harmonic-minor i-iv-V7, strings and guitar, foxtrot or go-go beat",
    1965,
    {
      groove: { subdivision: 4, swingRatio: [1, 1.1] },
      rhythm: {
        onsets: {
          kick: grid("x.......x......."),
          snare: BACKBEAT,
          hat: EIGHTH_HAT,
        },
      },
      pitch: {
        scales: [
          ["yonanuki-minor", 0.8],
          ["harmonic-minor", 0.2],
        ],
      },
      harmony: {
        sources: { forms: 1, presets: 0, chain: 0 },
        forms: [
          [["i", "iv", "V7", "i"], 0.5],
          [["i", "VI", "iv", "V7"], 0.3],
          [["iv", "V7", "i", "i"], 0.2],
        ],
        sevenths: 0.2,
      },
      bass: { onsets: grid("x.......x.......") },
      texture: { roles: { chords: role("strings", "electric@clean:0.5") } },
    },
  ),
  leaf(
    "enka",
    "enka: slow yonanuki minor melody (1 2 b3 5 b6) with kobushi ornament, i-iv-V7 harmonic-minor cadence, shakuhachi and strings",
    1960,
    {
      tempo: { bpm: [60, 90], typical: 72 },
      groove: { swingRatio: [1.3, 1.6] },
      pitch: { scales: [["yonanuki-minor", 1]] },
      harmony: {
        sources: { forms: 1, presets: 0, chain: 0 },
        forms: [
          [["i", "iv", "V7", "i"], 0.6],
          [["i", "i", "iv", "V7"], 0.4],
        ],
        sevenths: 0.2,
        rhythm: [[0.5, 1]],
      },
      melody: { density: [0.5, 1.5], ambitus: [7, 12], finals: [[0, 1]] },
      texture: {
        roles: {
          chords: role("strings", "electric@clean:0.4"),
          counter: maybe("shakuhachi", "koto:0.5"),
          lead: role("sing"),
        },
      },
      expression: { dynamics: [0.3, 0.8] },
    },
  ),
  leaf(
    "shidaiqu",
    "shidaiqu: Chinese pentatonic melody over a jazz-band foxtrot two-beat, sixth chords, erhu and strings",
    1930,
    {
      tempo: { bpm: [90, 130], typical: 110 },
      pitch: { scales: [["major-pentatonic", 1]] },
      harmony: { presets: [["turnaround", 1]], sevenths: 0.3 },
      melody: {
        finals: [
          [0, 0.6],
          [4, 0.4],
        ],
      },
      texture: {
        roles: {
          chords: role("piano", "strings:0.5"),
          counter: maybe("erhu", "violin:0.5"),
          lead: role("sing", "erhu:0.4"),
        },
      },
    },
  ),
  leaf(
    "trot",
    "trot: ppongjjak two-beat (bass on the beat, snare on the off-beats), yonanuki minor melody (1 2 b3 5 b6), i-iv-V7, quick tempo",
    1930,
    {
      tempo: { bpm: [120, 150], typical: 132 },
      groove: { swingRatio: [1, 1.2] },
      rhythm: {
        onsets: {
          kick: grid("x...x..."),
          snare: grid("..x...x."),
          hat: grid("xxxxxxxx"),
        },
      },
      pitch: { scales: [["yonanuki-minor", 1]] },
      harmony: {
        sources: { forms: 1, presets: 0, chain: 0 },
        forms: [
          [["i", "i", "iv", "iv", "V7", "V7", "i", "i"], 0.6],
          [["i", "iv", "V7", "i"], 0.4],
        ],
        sevenths: 0.1,
      },
      bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x...") },
      melody: { repetition: 0.8 },
      texture: {
        roles: {
          chords: role("keys", "electric@clean:0.5"),
          lead: role("sing", "sax:0.4"),
        },
      },
    },
  ),
];

// ---------------------------------------------------------------------------
// Sixties pop

const SIXTIES: readonly StyleCard[] = [
  leaf(
    "brill-building",
    "Brill Building and girl group: baion rhythm (tresillo kick), I-vi-IV-V, wall-of-sound reverb and castanets",
    1960,
    {
      tempo: { bpm: [100, 140], typical: 120 },
      groove: { subdivision: 4 },
      rhythm: {
        onsets: {
          kick: grid("x..x....x......."),
          snare: BACKBEAT,
          hat: EIGHTH_HAT,
          perc: grid("x..x..x........."),
        },
      },
      harmony: { presets: [["fifties", 1]] },
      bass: { onsets: grid("x..x....x..x....") },
      texture: {
        roles: {
          perc: maybe("drums"),
          chords: role("piano", "strings:0.6"),
          counter: role("choir", "ooh:0.5"),
        },
      },
      mix: { space: 0.6 },
    },
  ),
  leaf(
    "sunshine-pop",
    "sunshine and baroque pop: major sevenths, lydian color, harpsichord and strings, stacked vocal harmony",
    1966,
    {
      pitch: {
        scales: [
          ["major", 0.6],
          ["lydian", 0.2],
          ["mixolydian", 0.2],
        ],
      },
      harmony: {
        presets: [
          ["canon", 0.5],
          ["axis", 0.5],
        ],
        sevenths: 0.5,
      },
      texture: {
        roles: {
          chords: role("harpsichord", "jangle:0.6", "piano:0.4"),
          pad: maybe("strings"),
          counter: role("aah", "choir:0.5"),
        },
      },
    },
  ),
  leaf(
    "bubblegum",
    "bubblegum: three-chord I-IV-V, major-pentatonic hook repeated verbatim, bright eighth-note bounce",
    1968,
    {
      tempo: { bpm: [118, 140], typical: 128 },
      pitch: { scales: [["major", 1]] },
      harmony: {
        presets: [
          ["fifties", 0.5],
          ["axis", 0.5],
        ],
        sevenths: 0,
      },
      melody: { repetition: 0.95, ambitus: [5, 9] },
      texture: {
        roles: { chords: role("piano", "organ:0.5"), lead: role("sing") },
      },
    },
  ),
  leaf(
    "ye-ye",
    "ye-ye: twist backbeat with handclaps, minor-major mixture, Farfisa organ and twangy guitar",
    1963,
    {
      tempo: { bpm: [130, 165], typical: 148 },
      rhythm: { onsets: { clap: grid("..x...x.") } },
      pitch: {
        scales: [
          ["major", 0.5],
          ["minor", 0.5],
        ],
      },
      harmony: {
        presets: [
          ["fifties", 0.5],
          ["aeolian", 0.5],
        ],
      },
      texture: {
        roles: {
          clap: opt(ACOUSTIC_KIT),
          chords: role("farfisa", "electric@spring:0.6"),
        },
      },
    },
  ),
  leaf(
    "power-pop",
    "power pop: crunchy power chords, I-IV-V with bVII mixture, driving eighth-note bass, high harmonies",
    1972,
    {
      tempo: { bpm: [125, 160], typical: 140 },
      pitch: {
        scales: [
          ["major", 0.7],
          ["mixolydian", 0.3],
        ],
      },
      harmony: {
        presets: [
          ["mixolydian-rock", 0.4],
          ["axis", 0.6],
        ],
        voicing: {
          types: [
            ["power", 0.6],
            ["close", 0.4],
          ],
        },
      },
      bass: { behaviour: [["root", 1]], onsets: grid("xxxxxxxx") },
      texture: {
        roles: {
          chords: role("electric@crunch", "jangle:0.5"),
          counter: maybe("aah"),
        },
      },
    },
  ),
];

// ---------------------------------------------------------------------------
// Modern pop

const MODERN: readonly StyleCard[] = [
  leaf(
    "new-wave",
    "new wave: motorik eighth-note hats and bass, mixolydian bVII, angular synth and chorus guitar",
    1979,
    {
      tempo: { bpm: [125, 160], typical: 140 },
      rhythm: {
        onsets: { kick: FOUR_FLOOR, hat: EIGHTH_HAT },
      },
      pitch: {
        scales: [
          ["mixolydian", 0.4],
          ["minor", 0.3],
          ["major", 0.3],
        ],
      },
      harmony: {
        presets: [
          ["mixolydian-rock", 0.5],
          ["aeolian", 0.5],
        ],
      },
      bass: {
        behaviour: [
          ["octave", 0.5],
          ["root", 0.5],
        ],
        onsets: grid("x.x.x.x.x.x.x.x."),
      },
      texture: {
        roles: {
          ...kitAll(ELECTRO_KIT),
          chords: role("electric@clean", "saw:0.5"),
          lead: role("sing", "square:0.4"),
        },
      },
    },
  ),
  leaf(
    "synth-pop",
    "synth-pop: sequenced 16th arpeggios, minor loops with bVI-bVII, drum-machine backbeat",
    1981,
    {
      tempo: { bpm: [110, 132], typical: 120 },
      rhythm: {
        onsets: { kick: grid("x.......x.x....."), hat: SIXTEENTH_HAT },
      },
      pitch: {
        scales: [
          ["minor", 0.6],
          ["major", 0.4],
        ],
      },
      harmony: {
        presets: [
          ["aeolian", 0.5],
          ["sad-pop", 0.5],
        ],
      },
      bass: { behaviour: [["ostinato", 1]], onsets: grid("x.x.x.x.x.x.x.x.") },
      texture: {
        roles: {
          ...kitAll(ELECTRO_KIT),
          chords: role("saw", "keys:0.5"),
          arp: role("pluck", "square:0.5"),
          lead: role("sing", "lead:0.4"),
        },
      },
    },
  ),
  leaf(
    "dance-pop",
    "dance-pop: four-on-the-floor kick, off-beat hats, clap backbeat, sidechain pump, I-V-vi-IV",
    1984,
    {
      tempo: { bpm: [115, 130], typical: 122 },
      rhythm: {
        onsets: { kick: FOUR_FLOOR, hat: OFFBEAT_HAT, clap: BACKBEAT },
      },
      bass: { behaviour: [["octave", 1]], onsets: grid("..x...x...x...x.") },
      texture: {
        roles: { ...kitAll(CLUB_KIT), chords: role("saw", "piano:0.5") },
      },
      mix: { fx: { chords: { duck: "pump" } }, loudness: "club" },
    },
  ),
  leaf(
    "teen-pop",
    "teen pop: R&B-swung 16ths, I-V-vi-IV and vi-IV-I-V, stacked harmony on the chorus hook",
    1998,
    {
      tempo: { bpm: [90, 110], typical: 98 },
      groove: { swingRatio: [1.1, 1.3] },
      rhythm: {
        onsets: { kick: grid("x..x..x...x....."), hat: SIXTEENTH_HAT },
      },
      harmony: {
        presets: [
          ["axis", 0.5],
          ["sad-pop", 0.5],
        ],
      },
      texture: {
        roles: { ...kitAll(MACHINE), counter: maybe("aah", "choir:0.5") },
      },
    },
  ),
  leaf(
    "adult-contemporary",
    "adult contemporary and power ballad: piano ostinato, I-V-vi-IV and the canon's stepwise bass descent, half-note kick, slow 4/4",
    1975,
    {
      tempo: { bpm: [60, 84], typical: 72 },
      rhythm: { onsets: { kick: grid("x.......x......."), hat: EIGHTH_HAT } },
      harmony: {
        presets: [
          ["canon", 0.5],
          ["axis", 0.5],
        ],
        sevenths: 0.3,
        rhythm: [
          [1, 0.6],
          [2, 0.4],
        ],
      },
      melody: {
        intervals: PIANO_BALLAD,
        ambitus: [9, 14],
        density: [0.5, 1.5],
      },
      texture: {
        roles: {
          ...kitAll(ACOUSTIC_KIT),
          chords: role("grand", "rhodes:0.4"),
          pad: maybe("strings"),
        },
      },
      expression: { dynamics: [0.3, 0.9] },
    },
  ),
  leaf(
    "electropop",
    "electropop: side-chained synth chords, minor loop, clap backbeat and 16th hats, vocoder hooks",
    2008,
    {
      tempo: { bpm: [112, 130], typical: 124 },
      rhythm: {
        onsets: { kick: FOUR_FLOOR, hat: SIXTEENTH_HAT, clap: BACKBEAT },
      },
      pitch: {
        scales: [
          ["minor", 0.7],
          ["dorian", 0.3],
        ],
      },
      harmony: {
        presets: [
          ["aeolian", 0.5],
          ["sad-pop", 0.5],
        ],
      },
      texture: {
        roles: {
          ...kitAll(CLUB_KIT),
          chords: role("saw", "square:0.4"),
          lead: role("sing", "vocoder:0.4"),
        },
      },
      mix: { fx: { chords: { duck: "pump" } } },
    },
  ),
  leaf(
    "latin-pop",
    "latin pop: tresillo 3+3+2 in kick and bass, nylon guitar, minor i-VI-III-VII, Spanish-language phrasing",
    1980,
    {
      tempo: { bpm: [88, 110], typical: 96 },
      rhythm: {
        onsets: {
          kick: TRESILLO,
          snare: grid("...x..x....x..x."),
          hat: EIGHTH_HAT,
        },
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
          ["andalusian", 0.3],
          ["axis", 0.2],
        ],
      },
      bass: { behaviour: [["root", 1]], onsets: TRESILLO },
      texture: {
        roles: { chords: role("nylon", "piano:0.5"), perc: maybe("drums") },
      },
    },
  ),
  leaf(
    "indie-pop",
    "indie pop and twee: jangly major-key strums, glockenspiel doubling, diary-confessional melody that leans on the sixth",
    1986,
    {
      tempo: { bpm: [110, 150], typical: 128 },
      pitch: {
        scales: [
          ["major", 0.6],
          ["minor", 0.4],
        ],
      },
      harmony: {
        presets: [
          ["axis", 0.4],
          ["sad-pop", 0.3],
          ["canon", 0.3],
        ],
        voicing: { types: [["open", 1]], strokes: [["jangle", 1]] },
      },
      melody: {
        finals: [
          [0, 0.4],
          [5, 0.3],
          [2, 0.3],
        ],
      },
      texture: {
        roles: {
          ...kitAll(ACOUSTIC_KIT),
          chords: role("jangle", "acoustic:0.5"),
          counter: maybe("glock", "celesta:0.5"),
        },
      },
    },
  ),
  leaf(
    "art-pop",
    "art pop: lydian and dorian color, mixed meter with 5/4 and 7/8 (2+2+3), wide intervals, through-composed bridges",
    1977,
    {
      meter: {
        signatures: [
          ["4/4", 0.5],
          ["5/4", 0.2],
          ["7/8", 0.3],
        ],
        grouping: [[[2, 2, 3], 1]],
      },
      pitch: {
        scales: [
          ["lydian", 0.4],
          ["dorian", 0.3],
          ["major", 0.3],
        ],
      },
      harmony: {
        model: "modal",
        sevenths: 0.6,
        voicing: {
          types: [
            ["open", 0.5],
            ["quartal", 0.5],
          ],
        },
      },
      melody: { intervals: intervals(3, 2.5, 1.6, 0.6), ambitus: [10, 17] },
      texture: {
        roles: { chords: role("piano", "strings:0.5", "granular:0.3") },
      },
    },
  ),
  leaf(
    "bedroom-pop",
    "bedroom pop: lo-fi kit, chorused guitar, major-seventh loops, close-miked vocal in a narrow range",
    2016,
    {
      tempo: { bpm: [72, 100], typical: 86 },
      groove: {
        swingRatio: [1.1, 1.3],
        humanize: { timingMs: 10, velocity: 0.1 },
      },
      harmony: {
        presets: [
          ["canon", 0.5],
          ["axis", 0.5],
        ],
        sevenths: 0.8,
      },
      melody: { ambitus: [5, 9] },
      texture: {
        roles: {
          ...kitAll(DUSTY_KIT),
          chords: role("electric@dreampop", "lofi:0.5"),
        },
      },
      mix: { fx: { chords: { chorus: "seasick" } }, space: 0.45 },
    },
  ),
  leaf(
    "alt-pop",
    "alt-pop and dark pop: sparse 808 and half-time snare, minor with iv and bVI, whispered low-register melody",
    2015,
    {
      tempo: { bpm: [80, 110], typical: 94 },
      rhythm: {
        onsets: {
          kick: grid("x.....x...x....."),
          snare: HALF_SNARE,
          clap: null,
          hat: TRAP_HAT,
        },
      },
      pitch: {
        scales: [
          ["minor", 0.7],
          ["phrygian", 0.3],
        ],
      },
      harmony: {
        presets: [
          ["aeolian", 0.6],
          ["sad-pop", 0.4],
        ],
      },
      bass: { behaviour: [["root", 1]], onsets: grid("x.....x...x.....") },
      melody: { range: [55, 76], ambitus: [5, 9] },
      texture: {
        roles: {
          ...kitAll(TRAP_KIT),
          clap: null,
          chords: role("felt", "keys:0.5"),
        },
      },
    },
  ),
  leaf(
    "chamber-pop-modern",
    "orchestral and chamber pop: string quartet voicings, piano, 3/4 or 4/4, secondary dominants and suspensions",
    1997,
    {
      meter: {
        signatures: [
          ["4/4", 0.6],
          ["3/4", 0.4],
        ],
      },
      harmony: {
        presets: [
          ["canon", 0.4],
          ["turnaround", 0.3],
          ["axis", 0.3],
        ],
        sevenths: 0.4,
        voicing: { types: [["open", 1]], notes: [3, 5] },
      },
      texture: {
        roles: {
          ...kitAll(ACOUSTIC_KIT),
          chords: role("strings", "piano:0.6"),
          counter: role("cello", "violin:0.5", "horn:0.3"),
        },
      },
      mix: { space: 0.4 },
    },
  ),
  leaf(
    "hyperpop",
    "hyperpop: maximal bubblegum-I-V-vi-IV over distorted 808s and trap rolls, 150-180 bpm, pitched-up bright formant vocals",
    2019,
    {
      tempo: { bpm: [140, 180], typical: 160 },
      rhythm: {
        onsets: {
          kick: grid("x.....x...x...x."),
          snare: HALF_SNARE,
          clap: HALF_SNARE,
          hat: SIXTEENTH_HAT,
        },
      },
      pitch: {
        scales: [
          ["major", 0.7],
          ["major-pentatonic", 0.3],
        ],
      },
      harmony: {
        presets: [
          ["axis", 0.6],
          ["canon", 0.4],
        ],
      },
      melody: { density: [2, 4], ambitus: [9, 15], range: [64, 88] },
      bass: { behaviour: [["root", 1]], onsets: grid("x.....x...x...x.") },
      texture: {
        roles: {
          ...kitAll(TRAP_KIT),
          chords: role("saw", "sparkle:0.5"),
          lead: role("vocal", "square:0.5"),
        },
      },
      mix: {
        fx: {
          bass: { distort: "fold" },
          lead: { formant: "bright" },
          chords: { crush: "8-bit" },
        },
        loudness: "loud",
      },
    },
  ),
  leaf(
    "pc-music",
    "PC Music bubblegum bass: glossy major I-IV-vi-V, metallic plucks and bell synths, pitched vocals, 128-140 bpm",
    2014,
    {
      tempo: { bpm: [124, 142], typical: 132 },
      rhythm: {
        onsets: { kick: FOUR_FLOOR, snare: BACKBEAT, hat: OFFBEAT_HAT },
      },
      pitch: { scales: [["major", 1]] },
      harmony: {
        sources: { forms: 1, presets: 0, chain: 0 },
        forms: [
          [["I", "IV", "vi", "V"], 0.6],
          [["IV", "I", "V", "vi"], 0.4],
        ],
        sevenths: 0.2,
      },
      texture: {
        roles: {
          ...kitAll(CLUB_KIT),
          chords: role("pluck", "bell:0.5", "sparkle:0.4"),
          lead: role("vocal"),
        },
      },
      mix: { fx: { lead: { formant: "tiny" } } },
    },
  ),
  leaf(
    "shibuya-kei",
    "Shibuya-kei: bossa-nova and lounge collage, ii-V-I with major sevenths and ninths, brisk 16ths, vibes and flute",
    1993,
    {
      tempo: { bpm: [110, 140], typical: 124 },
      rhythm: {
        onsets: {
          kick: grid("x..x..x...x....."),
          rim: grid("x..x..x...x..x.."),
        },
      },
      harmony: {
        presets: [
          ["ii-v-i", 0.6],
          ["turnaround", 0.4],
        ],
        sevenths: 0.9,
      },
      bass: { behaviour: [["root-fifth", 1]] },
      texture: {
        roles: {
          ...kitAll(ACOUSTIC_KIT),
          rim: opt(ACOUSTIC_KIT),
          chords: role("nylon", "rhodes:0.5", "vibes:0.4"),
          counter: maybe("flute", "trumpet:0.4"),
        },
      },
    },
  ),
  leaf(
    "city-pop",
    "city pop: IVmaj7-III7-vi7 and ii-V chains, slap bass and Rhodes, 16th funk guitar, extended sevenths and ninths",
    1980,
    {
      tempo: { bpm: [96, 124], typical: 108 },
      groove: { swingRatio: [1, 1.1] },
      rhythm: { onsets: { hat: SIXTEENTH_HAT } },
      harmony: {
        presets: [
          ["ii-v-i", 0.4],
          ["turnaround", 0.3],
          ["axis", 0.3],
        ],
        forms: [[["IVmaj7", "III7", "vi7", "vi7"], 1]],
        sources: { presets: 1, forms: 1 },
        sevenths: 0.9,
      },
      bass: {
        behaviour: [
          ["octave", 0.6],
          ["root", 0.4],
        ],
        onsets: grid("x..x..x.x.x..x.."),
      },
      texture: {
        roles: {
          ...kitAll(ACOUSTIC_KIT),
          bass: role("slap", "fender:0.5"),
          chords: role("rhodes", "funk:0.5"),
        },
      },
    },
  ),
  leaf(
    "j-pop",
    "J-pop: royal-road progression IVmaj7-V7-iii7-vi, dense syllabic melody across a wide range, 120-170 bpm",
    1995,
    {
      tempo: { bpm: [120, 175], typical: 144 },
      harmony: {
        forms: [[["IVmaj7", "V7", "iii7", "vi"], 1]],
        presets: [["canon", 1]],
        sources: { presets: 1, forms: 2 },
        sevenths: 0.5,
      },
      melody: { density: [2, 4], ambitus: [10, 15] },
      texture: {
        roles: {
          ...kitAll(ACOUSTIC_KIT),
          chords: role("electric@clean", "piano:0.6", "strings:0.4"),
        },
      },
    },
  ),
  leaf(
    "k-pop",
    "K-pop: section-by-section style switches over a minor trap-EDM hybrid, half-time pre-chorus, dance-break drop",
    2010,
    {
      tempo: { bpm: [96, 130], typical: 116 },
      rhythm: { onsets: { kick: grid("x.....x...x....."), hat: TRAP_HAT } },
      pitch: {
        scales: [
          ["minor", 0.6],
          ["dorian", 0.4],
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
              "pre",
              "chorus",
              "verse",
              "pre",
              "chorus",
              "drop",
              "chorus",
            ],
            1,
          ],
        ],
      },
      texture: {
        roles: { ...kitAll(TRAP_KIT), chords: role("saw", "pluck:0.5") },
      },
    },
  ),
  leaf(
    "c-pop",
    "C-pop and Mandopop: pentatonic-leaning ballad melody over the canon bass line (I-V-vi-iii-IV-I-IV-V), piano and strings",
    1980,
    {
      tempo: { bpm: [64, 96], typical: 76 },
      pitch: {
        scales: [
          ["major", 0.6],
          ["major-pentatonic", 0.4],
        ],
      },
      harmony: {
        presets: [
          ["canon", 0.7],
          ["axis", 0.3],
        ],
        sevenths: 0.3,
      },
      melody: { intervals: PIANO_BALLAD },
      texture: {
        roles: {
          ...kitAll(ACOUSTIC_KIT),
          chords: role("grand", "strings:0.6"),
          counter: maybe("erhu", "strings:0.4"),
        },
      },
    },
  ),
  leaf(
    "vocaloid",
    "Vocaloid: synthesized-voice melody too fast and wide for a singer, royal-road and canon loops, 150-200 bpm rock band",
    2008,
    {
      tempo: { bpm: [150, 200], typical: 172 },
      harmony: {
        forms: [[["IVmaj7", "V7", "iii7", "vi"], 1]],
        presets: [["canon", 1]],
        sources: { presets: 1, forms: 2 },
      },
      melody: {
        density: [3, 4],
        ambitus: [12, 19],
        intervals: intervals(4, 3, 1.6, 0.8),
      },
      texture: {
        roles: {
          ...kitAll(ACOUSTIC_KIT),
          chords: role("electric@crunch", "piano:0.5"),
          lead: role("vocoder", "square:0.5"),
        },
      },
    },
  ),
  leaf(
    "v-pop",
    "Southeast Asian pop ballad: minor-key verses on harmonic-minor i-iv-V7 (the bolero and nhac tre ballad), melismatic chorus peak, acoustic guitar and soft kit",
    1985,
    {
      tempo: { bpm: [66, 104], typical: 82 },
      pitch: {
        scales: [
          ["harmonic-minor", 0.6],
          ["minor", 0.4],
        ],
      },
      harmony: {
        sources: { forms: 1, presets: 0, chain: 0 },
        forms: [
          [["i", "iv", "V7", "i"], 0.4],
          [["i", "VI", "iv", "V7"], 0.3],
          [["i", "iv", "VII", "III"], 0.3],
        ],
        sevenths: 0.3,
      },
      melody: { intervals: PIANO_BALLAD },
      texture: {
        roles: {
          ...kitAll(ACOUSTIC_KIT),
          chords: role("acoustic", "piano:0.6"),
        },
      },
    },
  ),
  leaf(
    "russian-pop",
    "Russian estrada pop: minor i-iv-VII-III loop with harmonic-minor V, four-on-the-floor dance verse, singalong chorus",
    1975,
    {
      tempo: { bpm: [110, 132], typical: 124 },
      rhythm: { onsets: { kick: FOUR_FLOOR, hat: OFFBEAT_HAT } },
      pitch: {
        scales: [
          ["harmonic-minor", 0.5],
          ["minor", 0.5],
        ],
      },
      harmony: {
        forms: [[["i", "iv", "bVII", "bIII"], 1]],
        presets: [["aeolian", 1]],
        sources: { presets: 1, forms: 2 },
        cadences: [
          ["V-I", 0.6],
          ["half", 0.4],
        ],
      },
      texture: {
        roles: { ...kitAll(CLUB_KIT), chords: role("keys", "strings:0.5") },
      },
    },
  ),
  leaf(
    "turkish-pop",
    "Turkish pop: hicaz and kurdi makam color in 12-tone pop, darbuka on the duyek-like syncopation, 9/8 roman option (2+2+2+3)",
    1990,
    {
      meter: {
        signatures: [
          ["4/4", 0.7],
          ["9/8", 0.3],
        ],
        grouping: [[[2, 2, 2, 3], 1]],
      },
      rhythm: { onsets: { perc: grid("x..x..x.x.x.....") } },
      pitch: {
        scales: [
          ["hijaz", 0.5],
          ["kurd", 0.3],
          ["nahawand", 0.2],
        ],
      },
      harmony: { model: "modal", sevenths: 0.1 },
      melody: { intervals: intervals(6, 2, 0.6, 0.8) },
      texture: {
        roles: {
          perc: role("daf", "tabla:0.4"),
          chords: role("strings", "keys:0.5"),
          counter: maybe("oud", "kamancheh:0.5"),
        },
      },
    },
  ),
  leaf(
    "arabic-pop",
    "Arabic pop: maqsum iqa' (dum-tak-tak-dum-tak) on darbuka, maqam hijaz or nahawand in 12-tone pop, string-section unisons",
    1990,
    {
      tempo: { bpm: [90, 120], typical: 104 },
      rhythm: {
        onsets: {
          perc: grid("x.x...x.x...x..."),
          kick: grid("x.......x......."),
          hat: null,
        },
      },
      pitch: {
        scales: [
          ["hijaz", 0.5],
          ["nahawand", 0.3],
          ["kurd", 0.2],
        ],
      },
      harmony: { model: "modal", sevenths: 0 },
      melody: { intervals: intervals(6, 2, 0.5, 0.8) },
      texture: {
        kind: "heterophonic",
        roles: {
          hat: null,
          perc: role("daf", "framedrum:0.5"),
          chords: role("strings"),
          counter: maybe("violins", "oud:0.6"),
        },
      },
    },
  ),
  leaf(
    "persian-pop",
    "Persian pop: 6/8 dance rhythm (shesh-o-hasht), dastgah-flavoured harmonic minor, santur and tar fills over synths",
    1970,
    {
      meter: { signatures: [["6/8", 1]] },
      groove: { subdivision: 2 },
      tempo: { bpm: [90, 130], typical: 110 },
      rhythm: {
        onsets: {
          kick: grid("x..x.."),
          snare: grid("...x.."),
          hat: grid("xxxxxx"),
          perc: grid("x.xx.x"),
          clap: null,
        },
      },
      pitch: {
        scales: [
          ["harmonic-minor", 0.5],
          ["nahawand", 0.3],
          ["hijaz", 0.2],
        ],
      },
      harmony: {
        presets: [
          ["aeolian", 0.5],
          ["minor-ii-v", 0.5],
        ],
      },
      bass: { onsets: grid("x..x..") },
      texture: {
        roles: {
          perc: role("daf", "tabla:0.5"),
          chords: role("keys", "strings:0.5"),
          counter: maybe("santur", "tar:0.6"),
        },
      },
    },
  ),
  leaf(
    "indian-pop",
    "Indipop: raga-flavoured kafi or khamaj melody, dholak-tabla kaharwa groove (8 beats), synth strings and bansuri",
    1990,
    {
      tempo: { bpm: [90, 120], typical: 100 },
      rhythm: { onsets: { perc: grid("x..x..x.x..x..x.") } },
      pitch: {
        scales: [
          ["kafi", 0.4],
          ["khamaj", 0.4],
          ["major", 0.2],
        ],
      },
      harmony: { model: "modal", sevenths: 0 },
      melody: { intervals: intervals(6, 2, 0.6, 0.8) },
      texture: {
        roles: {
          perc: role("tabla"),
          chords: role("strings", "keys:0.5"),
          counter: maybe("bansuri", "sitar:0.5"),
        },
      },
    },
  ),
  leaf(
    "nordic-pop",
    "Nordic and dansband pop: foxtrot two-beat bass, bright major I-IV-V-vi, melodic sustained chorus, clean guitar",
    1975,
    {
      tempo: { bpm: [112, 136], typical: 124 },
      groove: { swingRatio: [1, 1] },
      rhythm: {
        onsets: {
          kick: grid("x.......x......."),
          snare: BACKBEAT,
          hat: EIGHTH_HAT,
        },
      },
      harmony: {
        presets: [
          ["axis", 0.4],
          ["fifties", 0.3],
          ["canon", 0.3],
        ],
      },
      bass: {
        behaviour: [["root-fifth", 1]],
        onsets: grid("x.......x......."),
      },
      texture: {
        roles: {
          ...kitAll(ACOUSTIC_KIT),
          chords: role("electric@clean", "keys:0.5"),
        },
      },
    },
  ),
];

// ---------------------------------------------------------------------------
// Old school

const OLD_SCHOOL: readonly StyleCard[] = [
  leaf(
    "old-school-hip-hop",
    "old school hip hop: one-chord funk vamp from a looped break, electro drum-machine backbeat, call-and-response MC",
    1979,
    {
      rhythm: { onsets: { kick: grid("x.....x...x....."), hat: EIGHTH_HAT } },
      pitch: {
        scales: [
          ["dorian", 0.5],
          ["mixolydian", 0.5],
        ],
      },
      harmony: { sevenths: 0.7 },
      bass: { behaviour: [["ostinato", 1]], onsets: grid("x..x..x...x.x...") },
      texture: { roles: { chords: role("funk", "clav:0.5", "keys:0.4") } },
    },
  ),
  leaf(
    "golden-age",
    "golden-age boom bap: swung 16ths (MPC swing), kick-snare backbeat, chopped jazz-soul loop of one or two chords",
    1988,
    {
      tempo: { bpm: [84, 100], typical: 92 },
      groove: { swingRatio: [1.35, 1.7] },
      rhythm: { onsets: { kick: BOOM_BAP_KICK, hat: EIGHTH_HAT } },
      pitch: {
        scales: [
          ["minor", 0.5],
          ["dorian", 0.5],
        ],
      },
      harmony: {
        model: "functional",
        presets: [
          ["dorian-vamp", 0.6],
          ["minor-ii-v", 0.4],
        ],
        sevenths: 0.8,
      },
      texture: {
        roles: {
          ...kitAll(DUSTY_KIT),
          chords: role("rhodes", "upright:0.4", "piano:0.4"),
        },
      },
    },
  ),
  leaf(
    "miami-bass",
    "Miami bass: TR-808 boom with long decaying sub, syncopated kick, 16th hats and claps, 125-140 bpm",
    1986,
    {
      tempo: { bpm: [124, 140], typical: 130 },
      rhythm: {
        onsets: {
          kick: grid("x..x..x...x....."),
          clap: BACKBEAT,
          hat: SIXTEENTH_HAT,
        },
      },
      bass: {
        behaviour: [["root", 1]],
        onsets: grid("x..x..x...x....."),
        kickLock: 0.8,
        range: [24, 40],
      },
      texture: { roles: { ...kitAll(MACHINE), bass: role("bass") } },
    },
  ),
  leaf(
    "toasting",
    "toasting: MC chant over a reggae riddim, one-drop kick and rim on beat 3, off-beat skank chords",
    1970,
    {
      tempo: { bpm: [66, 84], typical: 76 },
      rhythm: {
        onsets: {
          kick: HALF_SNARE,
          rim: HALF_SNARE,
          snare: null,
          hat: EIGHTH_HAT,
        },
      },
      pitch: {
        scales: [
          ["minor", 0.5],
          ["major", 0.5],
        ],
      },
      harmony: {
        model: "functional",
        presets: [
          ["aeolian", 0.5],
          ["axis", 0.5],
        ],
        voicing: { types: [["close", 1]], strokes: [["reggae", 1]] },
      },
      bass: { behaviour: [["ostinato", 1]], onsets: grid("x..x..x.x....x..") },
      texture: {
        roles: {
          ...kitAll(ACOUSTIC_KIT),
          rim: ACOUSTIC_KIT,
          snare: null,
          chords: role("electric@clean", "organ:0.5"),
        },
      },
    },
  ),
];

// ---------------------------------------------------------------------------
// Regional rap

const REGIONAL: readonly StyleCard[] = [
  leaf(
    "g-funk",
    "G-funk: laid-back 90s funk tempo, minor ninths and dorian sevenths, portamento sine lead, live bass on the one",
    1992,
    {
      tempo: { bpm: [86, 100], typical: 94 },
      rhythm: {
        onsets: {
          kick: grid("x......xx.x....."),
          hat: SIXTEENTH_HAT,
          clap: BACKBEAT,
        },
      },
      pitch: {
        scales: [
          ["dorian", 0.5],
          ["minor", 0.5],
        ],
      },
      harmony: {
        presets: [
          ["dorian-vamp", 0.6],
          ["minor-ii-v", 0.4],
        ],
        sevenths: 0.9,
      },
      bass: { behaviour: [["ostinato", 1]], onsets: grid("x..x..x.x.......") },
      texture: {
        roles: {
          ...kitAll(MACHINE),
          chords: role("rhodes", "keys:0.5"),
          lead: role("triangle", "vocal:0.5"),
        },
      },
    },
  ),
  leaf(
    "east-coast-hardcore",
    "East Coast hardcore: dark minor piano loop with a dissonant b2, hard boom-bap kick, dusty swing",
    1994,
    {
      tempo: { bpm: [84, 98], typical: 90 },
      groove: { swingRatio: [1.2, 1.5] },
      pitch: {
        scales: [
          ["minor", 0.6],
          ["phrygian", 0.4],
        ],
      },
      harmony: { presets: [["aeolian", 1]], sevenths: 0.2 },
      texture: {
        roles: { ...kitAll(DUSTY_KIT), chords: role("piano", "strings:0.4") },
      },
    },
  ),
  leaf(
    "horrorcore",
    "horrorcore: harmonic-minor and phrygian dread, tritone-laden bass, music-box and church-organ samples over boom bap",
    1994,
    {
      tempo: { bpm: [76, 96], typical: 86 },
      pitch: {
        scales: [
          ["harmonic-minor", 0.5],
          ["phrygian", 0.5],
        ],
      },
      harmony: {
        presets: [["aeolian", 1]],
        cadences: [
          ["V-I", 0.5],
          ["bII-I", 0.5],
        ],
      },
      texture: {
        roles: { ...kitAll(DUSTY_KIT), chords: role("organ", "musicbox:0.5") },
      },
    },
  ),
  leaf(
    "southern-rap",
    "Southern rap: slow 808 groove with triplet hats, chopped-and-screwed slowdown, organ and minor blues",
    1996,
    {
      tempo: { bpm: [64, 84], typical: 72 },
      groove: { subdivision: 3, swingRatio: [1, 1] },
      rhythm: {
        onsets: {
          kick: grid("x.....x..x.."),
          snare: grid("...x.....x.."),
          hat: grid("x.xx.xx.xx.x"),
        },
      },
      pitch: {
        scales: [
          ["minor-pentatonic", 0.5],
          ["blues", 0.2],
          ["minor", 0.3],
        ],
      },
      bass: { behaviour: [["root", 1]], onsets: grid("x.....x..x..") },
      texture: {
        roles: { ...kitAll(MACHINE), chords: role("organ", "epiano:0.5") },
      },
    },
  ),
  leaf(
    "bounce",
    "New Orleans bounce: Triggerman-style syncopated break at 95-105 bpm, call-and-response chant, sparse harmony",
    1991,
    {
      tempo: { bpm: [94, 108], typical: 100 },
      rhythm: {
        onsets: {
          kick: grid("x..x..x.x.....x."),
          snare: grid("....x..x....x..."),
          hat: SIXTEENTH_HAT,
        },
      },
      harmony: { model: "modal", sevenths: 0 },
      bass: { behaviour: [["root", 1]], onsets: grid("x..x..x.x.....x.") },
      texture: { roles: kitAll(MACHINE) },
    },
  ),
  leaf(
    "crunk",
    "crunk and snap: slow 808 half-time with the snap on 3, chant hooks, minor synth stabs",
    2002,
    {
      tempo: { bpm: [70, 84], typical: 76 },
      rhythm: {
        onsets: {
          kick: grid("x.........x....."),
          snare: null,
          clap: HALF_SNARE,
          hat: EIGHTH_HAT,
        },
      },
      pitch: { scales: [["minor", 1]] },
      bass: { behaviour: [["root", 1]], onsets: grid("x.........x.....") },
      texture: {
        roles: {
          ...kitAll(MACHINE),
          snare: null,
          clap: MACHINE,
          chords: role("square", "saw:0.5"),
        },
      },
    },
  ),
  leaf(
    "hyphy",
    "hyphy: Bay Area bounce at 95-110 bpm, knocking 808, handclaps on 2 and 4, minimal synth riffs",
    2004,
    {
      tempo: { bpm: [94, 110], typical: 102 },
      rhythm: { onsets: { kick: grid("x...x.x...x..x.."), clap: BACKBEAT } },
      harmony: { model: "modal" },
      bass: { behaviour: [["root", 1]], onsets: grid("x...x.x...x..x..") },
      texture: {
        roles: {
          ...kitAll(MACHINE),
          clap: MACHINE,
          chords: role("square", "pluck:0.5"),
        },
      },
    },
  ),
  leaf(
    "jerk",
    "jerk and ratchet: minimal 808 and finger-snaps, sparse kick, synth-whistle hook on one note, 100-120 bpm",
    2009,
    {
      tempo: { bpm: [96, 120], typical: 104 },
      rhythm: {
        onsets: {
          kick: grid("x.....x.x......."),
          clap: BACKBEAT,
          hat: EIGHTH_HAT,
        },
      },
      harmony: { model: "modal" },
      melody: { ambitus: [3, 6], repetition: 0.95 },
      texture: {
        roles: {
          ...kitAll(MACHINE),
          clap: MACHINE,
          chords: role("square"),
          lead: role("vocal", "triangle:0.5"),
        },
      },
    },
  ),
  leaf(
    "memphis-rap",
    "Memphis rap: lo-fi tape 808, cowbell ostinato, triplet hats, phrygian horror-movie keys",
    1992,
    {
      tempo: { bpm: [130, 150], typical: 140 },
      rhythm: {
        onsets: {
          kick: grid("x.....x...x....."),
          snare: HALF_SNARE,
          hat: EIGHTH_HAT,
          bell: grid("x..x..x...x..x.."),
        },
      },
      pitch: {
        scales: [
          ["phrygian", 0.6],
          ["minor", 0.4],
        ],
      },
      harmony: { model: "modal" },
      texture: {
        roles: {
          ...kitAll(DUSTY_KIT),
          bell: role("bell"),
          chords: role("keys", "organ:0.5"),
        },
      },
      mix: { fx: { chords: { crush: "lofi" } } },
    },
  ),
  leaf(
    "phonk",
    "phonk: cowbell melody (drift phonk) over distorted 808, half-time snare, Memphis-sampled phrygian loops, 130-160 bpm",
    2018,
    {
      tempo: { bpm: [130, 160], typical: 144 },
      rhythm: {
        onsets: {
          kick: grid("x.....x.x.....x."),
          snare: HALF_SNARE,
          hat: SIXTEENTH_HAT,
          bell: grid("x..x..x...x.x..."),
        },
      },
      pitch: {
        scales: [
          ["phrygian", 0.7],
          ["minor", 0.3],
        ],
      },
      harmony: { model: "modal" },
      bass: { behaviour: [["root", 1]], onsets: grid("x.....x.x.....x.") },
      texture: {
        roles: {
          ...kitAll(TRAP_KIT),
          bell: role("bell", "steelpan:0.3"),
          chords: role("keys"),
        },
      },
      mix: { fx: { bass: { distort: "crunch" } } },
    },
  ),
];

// ---------------------------------------------------------------------------
// Modern rap

const MODERN_RAP: readonly StyleCard[] = [
  leaf(
    "trap",
    "trap: half-time snare on beat 3 at 130-160 bpm, rolling hat triplets, gliding 808 sub, minor bell or piano loop",
    2005,
    {
      pitch: {
        scales: [
          ["minor", 0.6],
          ["harmonic-minor", 0.4],
        ],
      },
      harmony: { presets: [["aeolian", 1]] },
      texture: { roles: { chords: role("bell", "piano:0.5", "strings:0.3") } },
    },
  ),
  leaf(
    "drill",
    "drill: sliding 808 bass melodies, half-time snare with a late off-beat snare, triplet-skipping hats, 138-145 bpm, phrygian",
    2013,
    {
      tempo: { bpm: [136, 146], typical: 142 },
      rhythm: {
        onsets: {
          kick: grid("x.....x...x....."),
          snare: grid("........x..x...."),
          hat: grid("x..x..x.x..x.x.."),
        },
      },
      pitch: {
        scales: [
          ["phrygian", 0.5],
          ["harmonic-minor", 0.5],
        ],
      },
      harmony: { model: "modal" },
      bass: { behaviour: [["ostinato", 1]], onsets: grid("x.....x...x..x..") },
      texture: { roles: { chords: role("strings", "piano:0.5", "choir:0.3") } },
    },
  ),
  leaf(
    "cloud-rap",
    "cloud rap: hazy reverb pads, slow half-time, major-seventh loops, ethereal sampled vocals",
    2011,
    {
      tempo: { bpm: [60, 80], typical: 70 },
      rhythm: {
        onsets: {
          kick: grid("x.........x....."),
          snare: grid("........x......."),
          hat: EIGHTH_HAT,
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
          ["canon", 0.5],
          ["dorian-vamp", 0.5],
        ],
        sevenths: 0.8,
      },
      texture: {
        roles: {
          pad: role("granular", "strings:0.5"),
          chords: role("keys", "sparkle:0.5"),
        },
      },
      mix: { space: 0.6 },
    },
  ),
  leaf(
    "rage",
    "rage and plugg: detuned distorted saw lead hook, 150-165 bpm half-time, 808 locked to kick; plugg leans major and bouncy",
    2020,
    {
      tempo: { bpm: [148, 168], typical: 156 },
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
          ["axis", 0.5],
        ],
      },
      melody: { repetition: 0.95, ambitus: [5, 9] },
      texture: {
        roles: {
          chords: role("saw", "square:0.5"),
          lead: role("saw", "vocal:0.5"),
        },
      },
      mix: { fx: { chords: { distort: "warm" } } },
    },
  ),
  leaf(
    "abstract-hip-hop",
    "abstract and instrumental hip hop: unquantised 'drunk' feel (snare late, kick early), jazz extensions, sample collage",
    1996,
    {
      tempo: { bpm: [78, 96], typical: 88 },
      groove: {
        swingRatio: [1.3, 1.6],
        roleOffset: { snare: 0.15, kick: -0.08 },
        humanize: { timingMs: 12, velocity: 0.1 },
      },
      rhythm: {
        onsets: { kick: BOOM_BAP_KICK, snare: BACKBEAT, hat: EIGHTH_HAT },
      },
      harmony: {
        presets: [
          ["minor-ii-v", 0.5],
          ["dorian-vamp", 0.5],
        ],
        sevenths: 0.9,
      },
      bass: { behaviour: [["root", 1]], onsets: BOOM_BAP_KICK, kickLock: 0.5 },
      texture: {
        roles: { ...kitAll(DUSTY_KIT), chords: role("rhodes", "vibes:0.5") },
      },
    },
  ),
  leaf(
    "jazz-rap",
    "jazz rap: ii-V-I and minor-ii-V loops, upright bass, muted trumpet and Rhodes over swung boom bap",
    1990,
    {
      tempo: { bpm: [84, 100], typical: 92 },
      groove: { swingRatio: [1.4, 1.8] },
      rhythm: {
        onsets: { kick: BOOM_BAP_KICK, snare: BACKBEAT, hat: EIGHTH_HAT },
      },
      harmony: {
        presets: [
          ["ii-v-i", 0.5],
          ["minor-ii-v", 0.5],
        ],
        sevenths: 0.9,
      },
      bass: {
        behaviour: [["root-fifth", 1]],
        onsets: grid("x.....x.x......."),
      },
      texture: {
        roles: {
          ...kitAll(DUSTY_KIT),
          bass: role("upright"),
          chords: role("rhodes", "piano:0.5"),
          counter: maybe("mutedtrumpet", "sax:0.5"),
        },
      },
    },
  ),
  leaf(
    "lofi-hip-hop",
    "lo-fi hip hop: lazy MPC swing, major-seventh and minor-ninth ii-V loops, tape-crushed Rhodes, vinyl dust",
    2015,
    {
      tempo: { bpm: [70, 90], typical: 80 },
      groove: {
        swingRatio: [1.5, 1.9],
        humanize: { timingMs: 8, velocity: 0.08 },
      },
      rhythm: {
        onsets: { kick: BOOM_BAP_KICK, snare: BACKBEAT, hat: EIGHTH_HAT },
      },
      pitch: {
        scales: [
          ["major", 0.4],
          ["dorian", 0.6],
        ],
      },
      harmony: {
        presets: [
          ["ii-v-i", 0.5],
          ["dorian-vamp", 0.5],
        ],
        sevenths: 1,
      },
      melody: { density: [0.5, 1.5] },
      texture: {
        roles: {
          ...kitAll(DUSTY_KIT),
          chords: role("rhodes", "lofi:0.6"),
          lead: maybe("lofi", "vibes:0.5"),
        },
      },
      mix: { fx: { chords: { crush: "lofi" } }, loudness: "streaming" },
    },
  ),
  leaf(
    "experimental-hip-hop",
    "experimental and industrial hip hop: distorted kits, atonal noise layers, locrian and phrygian, abrupt form cuts",
    2005,
    {
      tempo: { bpm: [80, 150], typical: 110 },
      rhythm: {
        onsets: {
          kick: grid("x..x.....x..x..."),
          snare: grid("....x..x....x..."),
          hat: grid("x.3.x.3.x.3.x.3."),
        },
      },
      pitch: {
        scales: [
          ["phrygian", 0.5],
          ["locrian", 0.5],
        ],
      },
      harmony: { model: "modal" },
      texture: {
        roles: { ...kitAll(ELECTRO_KIT), chords: role("saw", "granular:0.5") },
      },
      mix: { fx: { chords: { distort: "fold" } } },
    },
  ),
  leaf(
    "grime",
    "grime: 140 bpm eskibeat, square-wave stabs, sparse kick and snare on 3, staccato 16th MC flow",
    2003,
    {
      tempo: { bpm: [138, 142], typical: 140 },
      rhythm: {
        onsets: {
          kick: grid("x.....x......x.."),
          snare: HALF_SNARE,
          hat: EIGHTH_HAT,
        },
      },
      pitch: {
        scales: [
          ["minor", 0.5],
          ["phrygian", 0.5],
        ],
      },
      harmony: { model: "modal" },
      bass: { behaviour: [["root", 1]], onsets: grid("x..x..x...x..x..") },
      texture: {
        roles: {
          ...kitAll(ELECTRO_KIT),
          chords: role("square", "pluck:0.5"),
          bass: role("square", "bass:0.5"),
        },
      },
    },
  ),
  leaf(
    "uk-hip-hop",
    "UK hip hop: boom bap with a straighter swing, dusty minor loops, conversational flow",
    1990,
    {
      tempo: { bpm: [86, 98], typical: 92 },
      groove: { swingRatio: [1.1, 1.3] },
      rhythm: {
        onsets: { kick: BOOM_BAP_KICK, snare: BACKBEAT, hat: EIGHTH_HAT },
      },
      harmony: { presets: [["aeolian", 1]] },
      texture: {
        roles: { ...kitAll(DUSTY_KIT), chords: role("piano", "strings:0.5") },
      },
    },
  ),
  leaf(
    "french-rap",
    "French rap: melancholic minor piano and strings, harmonic-minor i-iv-V, boom bap or trap grid",
    1991,
    {
      tempo: { bpm: [84, 145], typical: 92 },
      rhythm: {
        onsets: { kick: BOOM_BAP_KICK, snare: BACKBEAT, hat: EIGHTH_HAT },
      },
      pitch: {
        scales: [
          ["harmonic-minor", 0.5],
          ["minor", 0.5],
        ],
      },
      harmony: {
        presets: [
          ["minor-ii-v", 0.5],
          ["aeolian", 0.5],
        ],
      },
      texture: { roles: { chords: role("piano", "strings:0.6") } },
    },
  ),
  leaf(
    "latin-trap",
    "Latin trap: trap half-time with dembow-tinged rim, minor i-VI-III-VII, nylon or bell loop",
    2016,
    {
      tempo: { bpm: [130, 150], typical: 140 },
      rhythm: { onsets: { rim: DEMBOW_SNARE } },
      pitch: {
        scales: [
          ["minor", 0.7],
          ["harmonic-minor", 0.3],
        ],
      },
      harmony: {
        presets: [
          ["sad-pop", 0.5],
          ["aeolian", 0.5],
        ],
      },
      texture: {
        roles: { rim: opt(TRAP_KIT), chords: role("nylon", "bell:0.5") },
      },
    },
  ),
  leaf(
    "afro-trap",
    "Afrotrap: afrobeats 3+3+2 hat and percussion over trap 808, 100-112 bpm, major-pentatonic hooks",
    2015,
    {
      tempo: { bpm: [100, 114], typical: 106 },
      rhythm: {
        onsets: {
          kick: grid("x.....x...x....."),
          snare: BACKBEAT,
          hat: TRESILLO,
          perc: grid("..x..x..x..x..x."),
        },
      },
      pitch: {
        scales: [
          ["major-pentatonic", 0.4],
          ["minor", 0.6],
        ],
      },
      harmony: {
        presets: [
          ["axis", 0.5],
          ["aeolian", 0.5],
        ],
      },
      texture: {
        roles: { perc: role("drums"), chords: role("pluck", "marimba:0.5") },
      },
    },
  ),
  leaf(
    "rap-rock",
    "rap rock and rapcore: live kit backbeat, drop-tuned power-chord riffs on i and bII, rapped verses, sung chorus",
    1990,
    {
      tempo: { bpm: [86, 110], typical: 96 },
      rhythm: {
        onsets: {
          kick: grid("x.x....x..x....."),
          snare: BACKBEAT,
          hat: EIGHTH_HAT,
        },
      },
      pitch: {
        scales: [
          ["phrygian", 0.5],
          ["minor", 0.5],
        ],
      },
      harmony: {
        presets: [["aeolian", 1]],
        voicing: { types: [["power", 1]] },
        rhythm: [[1, 1]],
      },
      bass: { behaviour: [["root", 1]], onsets: grid("x.x....x..x.....") },
      texture: {
        roles: {
          ...kitAll(ACOUSTIC_KIT),
          chords: role("electric@metal", "electric@crunch:0.5"),
          bass: role("bass@bassdrive"),
        },
      },
    },
  ),
  leaf(
    "turntablism",
    "turntablism: scratch-led break, cut-up stabs on the 16th grid, chirps and transforms as rhythm, one-chord bed",
    1988,
    {
      tempo: { bpm: [88, 104], typical: 96 },
      rhythm: {
        onsets: {
          kick: BOOM_BAP_KICK,
          snare: BACKBEAT,
          hat: grid("x.x.x.xxx.x.x.xx"),
          perc: grid("..xx.x...x.xx.x."),
        },
      },
      harmony: { model: "modal" },
      melody: { density: [2, 4], intervals: intervals(2, 1, 1.2, 2) },
      texture: {
        roles: {
          ...kitAll(DUSTY_KIT),
          perc: role("drums"),
          lead: role("vocal", "square:0.5"),
        },
      },
    },
  ),
  leaf(
    "religious-rap",
    "Christian hip hop: gospel organ and choir over boom bap or trap, major IV-I plagal cadences",
    1990,
    {
      tempo: { bpm: [80, 145], typical: 92 },
      rhythm: {
        onsets: { kick: BOOM_BAP_KICK, snare: BACKBEAT, hat: EIGHTH_HAT },
      },
      pitch: {
        scales: [
          ["major", 0.6],
          ["mixolydian", 0.4],
        ],
      },
      harmony: {
        presets: [
          ["axis", 0.5],
          ["canon", 0.5],
        ],
        cadences: [
          ["IV-I", 0.6],
          ["V-I", 0.4],
        ],
      },
      texture: {
        roles: { chords: role("gospel", "piano:0.5"), counter: maybe("choir") },
      },
    },
  ),
];

// ---------------------------------------------------------------------------
// Breakbeat, drum and bass, UK bass

const BREAKS: readonly StyleCard[] = [
  leaf(
    "breakbeat",
    "breakbeat: syncopated funk-break kick (1, and-of-2, and-of-3), snare 2 and 4 with ghosts, acid stabs, 125-140 bpm",
    1991,
    {
      tempo: { bpm: [125, 140], typical: 132 },
      rhythm: {
        onsets: {
          kick: grid("x.x.......x....."),
          snare: grid("....x..3.3..x..3"),
          hat: EIGHTH_HAT,
        },
      },
      texture: { roles: { chords: role("saw", "keys:0.5") } },
      mix: { fx: { chords: { autofilter: "env-follow" } } },
    },
  ),
  leaf(
    "big-beat",
    "big beat: distorted mid-tempo breaks, one-chord rock riff, build-drop arrangement, 100-130 bpm",
    1995,
    {
      tempo: { bpm: [100, 135], typical: 120 },
      rhythm: {
        onsets: {
          kick: grid("x.x.......x.x..."),
          snare: BACKBEAT,
          hat: EIGHTH_HAT,
        },
      },
      pitch: {
        scales: [
          ["mixolydian", 0.5],
          ["minor", 0.5],
        ],
      },
      harmony: {
        presets: [["mixolydian-rock", 1]],
        voicing: { types: [["power", 1]] },
      },
      texture: { roles: { chords: role("electric@fuzz", "saw:0.5") } },
      mix: { fx: { snare: { distort: "crunch" } } },
    },
  ),
  leaf(
    "jungle",
    "jungle: chopped breakbeat with ghosted snare re-edits at 160-175 bpm, half-speed reggae sub-bass, ragga MC",
    1993,
    {
      tempo: { bpm: [158, 176], typical: 166 },
      rhythm: {
        onsets: {
          kick: grid("x.x.......x....."),
          snare: grid("....x..4.4..x.4."),
          hat: grid("x.x.x.x.x.x.x.x."),
        },
      },
      harmony: { model: "modal" },
      bass: {
        behaviour: [["ostinato", 1]],
        onsets: grid("x.......x.x....."),
        range: [26, 40],
      },
      texture: {
        roles: {
          bass: role("bass", "triangle:0.5"),
          chords: role("strings", "keys:0.5"),
        },
      },
    },
  ),
  leaf(
    "drum-and-bass",
    "drum and bass: two-step kick on 1 and the and-of-3, snare on 2 and 4 at 170-176 bpm, reese bass, minor pads",
    1995,
    {
      tempo: { bpm: [168, 178], typical: 174 },
      rhythm: {
        onsets: { kick: TWO_STEP_KICK, snare: BACKBEAT, hat: EIGHTH_HAT },
      },
      bass: {
        behaviour: [
          ["ostinato", 0.6],
          ["root", 0.4],
        ],
        onsets: grid("x.......x.x....."),
      },
      texture: {
        roles: { bass: role("bass@reese", "saw:0.4"), pad: maybe("strings") },
      },
    },
  ),
  leaf(
    "halftime",
    "halftime: drum-and-bass tempo (160-175) with the snare only on beat 3, heavy sub, sparse minimal stabs",
    2012,
    {
      tempo: { bpm: [160, 176], typical: 170 },
      rhythm: {
        onsets: {
          kick: grid("x.........x....."),
          snare: HALF_SNARE,
          hat: grid("x...x...x...x..."),
        },
      },
      harmony: { model: "modal" },
      bass: { behaviour: [["root", 1]], onsets: grid("x.........x.....") },
      texture: { roles: { bass: role("bass@reese", "bass:0.5") } },
    },
  ),
  leaf(
    "breakcore",
    "breakcore: hyper-chopped amen re-edits at 180-260 bpm, 32nd-note snare rolls, distorted kicks, abrupt collage",
    1997,
    {
      tempo: { bpm: [180, 260], typical: 200 },
      rhythm: {
        onsets: {
          kick: grid("x.x...x...x.x..."),
          snare: grid("....x.5x..5.x5xx"),
          hat: SIXTEENTH_HAT,
        },
      },
      pitch: {
        scales: [
          ["phrygian", 0.5],
          ["minor", 0.5],
        ],
      },
      harmony: { model: "modal" },
      texture: { roles: { chords: role("saw", "granular:0.5") } },
      mix: { fx: { kick: { distort: "fold" } }, loudness: "loud" },
    },
  ),
  leaf(
    "uk-garage",
    "UK garage 2-step: skipping kick that skips beats 2 and 4, snare on 2 and 4, shuffled 16ths, minor-seventh organ stabs",
    1997,
    {
      tempo: { bpm: [130, 138], typical: 134 },
      groove: { swingRatio: [1.25, 1.5] },
      rhythm: {
        onsets: {
          kick: grid("x.........x..5.."),
          snare: BACKBEAT,
          hat: grid("..x...x...x...x."),
        },
      },
      pitch: {
        scales: [
          ["minor", 0.5],
          ["dorian", 0.5],
        ],
      },
      harmony: {
        presets: [
          ["dorian-vamp", 0.5],
          ["minor-ii-v", 0.5],
        ],
        sevenths: 0.9,
        rhythm: [[1, 1]],
      },
      bass: { behaviour: [["ostinato", 1]], onsets: grid("x..x......x..x..") },
      texture: {
        roles: {
          chords: role("organ", "rhodes:0.5"),
          lead: role("vocal", "sing:0.5"),
        },
      },
    },
  ),
  leaf(
    "bassline",
    "bassline (niche): four-on-the-floor at 135-142, wobbling detuned bass riff, organ stabs, garage shuffle",
    2004,
    {
      tempo: { bpm: [134, 142], typical: 138 },
      groove: { swingRatio: [1.15, 1.35] },
      rhythm: {
        onsets: { kick: FOUR_FLOOR, snare: BACKBEAT, hat: OFFBEAT_HAT },
      },
      bass: { behaviour: [["ostinato", 1]], onsets: grid("x.xx..x.x.xx..x.") },
      texture: {
        roles: { bass: role("saw", "square:0.5"), chords: role("organ") },
      },
      mix: { fx: { bass: { autofilter: "wobble" } } },
    },
  ),
  leaf(
    "dubstep",
    "dubstep: 138-142 bpm with half-time snare on beat 3, sub-bass wobbles, phrygian b2, dark space",
    2004,
    {
      tempo: { bpm: [138, 142], typical: 140 },
      rhythm: {
        onsets: {
          kick: grid("x.........x....."),
          snare: HALF_SNARE,
          hat: grid("..x...x...x...x."),
        },
      },
      pitch: {
        scales: [
          ["phrygian", 0.5],
          ["minor", 0.5],
        ],
      },
      harmony: { model: "modal" },
      bass: { behaviour: [["root", 1]], onsets: grid("x.....x...x.....") },
      mix: { fx: { bass: { autofilter: "wobble" } }, space: 0.5 },
    },
  ),
  leaf(
    "brostep",
    "brostep and riddim: 140-150 half-time, formant-growl bass in repeating triplet riddim cells, festival drops",
    2010,
    {
      tempo: { bpm: [140, 150], typical: 145 },
      rhythm: {
        onsets: {
          kick: grid("x.........x....."),
          snare: HALF_SNARE,
          hat: EIGHTH_HAT,
        },
      },
      pitch: {
        scales: [
          ["phrygian", 0.6],
          ["minor", 0.4],
        ],
      },
      harmony: { model: "modal" },
      bass: {
        behaviour: [["ostinato", 1]],
        onsets: grid("x..x..x..x..x..."),
        range: [28, 45],
      },
      texture: { roles: { bass: role("saw", "square:0.5") } },
      mix: {
        fx: { bass: { formant: "giant", distort: "fold" } },
        loudness: "loud",
      },
    },
  ),
  leaf(
    "future-bass",
    "future bass: side-chain-pumped supersaw chords on IV-V-iii-vi, half-time snare, pitched vocal chops, 130-160 bpm",
    2014,
    {
      tempo: { bpm: [130, 160], typical: 150 },
      rhythm: {
        onsets: {
          kick: grid("x.....x...x....."),
          snare: HALF_SNARE,
          hat: TRAP_HAT,
        },
      },
      pitch: { scales: [["major", 1]] },
      harmony: {
        presets: [
          ["canon", 0.4],
          ["axis", 0.6],
        ],
        forms: [[["IVmaj7", "V", "iii7", "vi7"], 1]],
        sources: { presets: 1, forms: 2 },
        sevenths: 0.7,
        rhythm: [[1, 1]],
      },
      texture: {
        roles: {
          chords: role("saw", "sparkle:0.5"),
          lead: role("vocal", "pluck:0.5"),
        },
      },
      mix: { fx: { chords: { duck: "pump" } } },
    },
  ),
  leaf(
    "future-garage",
    "future garage: 2-step skip at 130-140 with heavy reverb, minor-ninth pads, pitched vocal fragments",
    2008,
    {
      tempo: { bpm: [128, 140], typical: 134 },
      groove: { swingRatio: [1.2, 1.4] },
      rhythm: {
        onsets: {
          kick: grid("x.........x....."),
          snare: BACKBEAT,
          hat: grid("..x..x....x..x.."),
        },
      },
      harmony: {
        presets: [
          ["dorian-vamp", 0.5],
          ["aeolian", 0.5],
        ],
        sevenths: 0.9,
      },
      texture: {
        roles: {
          pad: role("granular", "strings:0.5"),
          lead: role("vocal", "pluck:0.5"),
        },
      },
      mix: { space: 0.65 },
    },
  ),
  leaf(
    "uk-funky",
    "UK funky: 128-132 bpm tribal-house syncopation, tresillo kick bias over the floor, soca-derived percussion, minor chords",
    2007,
    {
      tempo: { bpm: [126, 132], typical: 130 },
      rhythm: {
        onsets: {
          kick: grid("x..x..x.x..x..x."),
          snare: BACKBEAT,
          hat: OFFBEAT_HAT,
          perc: grid("x.xx.x.xx.x.x.x."),
        },
      },
      pitch: {
        scales: [
          ["minor", 0.5],
          ["dorian", 0.5],
        ],
      },
      harmony: { presets: [["dorian-vamp", 1]], sevenths: 0.8 },
      texture: {
        roles: { perc: role("drums"), chords: role("keys", "organ:0.5") },
      },
    },
  ),
  leaf(
    "wonky",
    "wonky and glitch hop: off-grid lurching microtiming, crunchy detuned synths, slow 85-110 half-time",
    2007,
    {
      tempo: { bpm: [84, 110], typical: 95 },
      groove: {
        microtiming: [0, 0.2, -0.1, 0.3],
        roleOffset: { snare: 0.12 },
        humanize: { timingMs: 14, velocity: 0.1 },
      },
      rhythm: {
        onsets: { kick: BOOM_BAP_KICK, snare: BACKBEAT, hat: EIGHTH_HAT },
      },
      pitch: {
        scales: [
          ["dorian", 0.5],
          ["minor", 0.5],
        ],
      },
      harmony: { presets: [["dorian-vamp", 1]], sevenths: 0.8 },
      texture: { roles: { chords: role("saw", "square:0.5") } },
      mix: { fx: { chords: { crush: "lofi" } } },
    },
  ),
  leaf(
    "broken-beat",
    "broken beat: jazz-funk chords over a displaced 120-130 kick, snare on 2 and the and-of-3, swung 16ths",
    1999,
    {
      tempo: { bpm: [118, 130], typical: 124 },
      groove: { swingRatio: [1.2, 1.4] },
      rhythm: {
        onsets: {
          kick: grid("x.....x....x...."),
          snare: grid("....x.....x....."),
          hat: SIXTEENTH_HAT,
        },
      },
      pitch: {
        scales: [
          ["dorian", 0.6],
          ["minor", 0.4],
        ],
      },
      harmony: {
        presets: [
          ["minor-ii-v", 0.5],
          ["dorian-vamp", 0.5],
        ],
        sevenths: 0.9,
      },
      texture: { roles: { chords: role("rhodes", "keys:0.5") } },
    },
  ),
  leaf(
    "footwork",
    "footwork and juke: 155-165 bpm, triplet-dotted kick polyrhythm (3 over 4), sparse snare, chopped vocal loop",
    2008,
    {
      tempo: { bpm: [155, 165], typical: 160 },
      groove: { subdivision: 3 },
      rhythm: {
        onsets: {
          kick: grid("x..x..x..x.."),
          snare: grid("......x....."),
          hat: grid("x.x.x.x.x.x."),
        },
      },
      harmony: { model: "modal" },
      bass: { behaviour: [["root", 1]], onsets: grid("x..x..x..x..") },
      texture: { roles: { lead: role("vocal", "pluck:0.5") } },
    },
  ),
  leaf(
    "baltimore-club",
    "Baltimore club: break-derived kick with triplet pick-ups on beat 4, 125-135 bpm, chopped vocal stabs",
    1992,
    {
      tempo: { bpm: [125, 135], typical: 130 },
      rhythm: {
        onsets: {
          kick: grid("x...x...x.x.x..."),
          snare: BACKBEAT,
          hat: OFFBEAT_HAT,
        },
      },
      harmony: { model: "modal" },
      bass: { behaviour: [["root", 1]], onsets: grid("x...x...x.x.x...") },
      texture: { roles: { lead: role("vocal", "pluck:0.5") } },
    },
  ),
  leaf(
    "jersey-club",
    "Jersey club: triplet kick rolls (the five-hit run), 130-145 bpm, sampled vocal chops and bedspring percussion",
    2008,
    {
      tempo: { bpm: [130, 145], typical: 140 },
      groove: { subdivision: 3 },
      rhythm: {
        onsets: {
          kick: grid("x..x..x.xx.x"),
          snare: grid("...x.....x.."),
          hat: grid("..x..x..x..x"),
        },
      },
      harmony: { model: "modal" },
      bass: { behaviour: [["root", 1]], onsets: grid("x..x..x.....") },
      texture: { roles: { lead: role("vocal", "pluck:0.5") } },
    },
  ),
  leaf(
    "moombahton",
    "moombahton: dembow (kick on every beat, snare on 3, 6, 11 and 14 of 16) at 108-112 bpm, minor synth stabs",
    2009,
    {
      tempo: { bpm: [106, 114], typical: 110 },
      rhythm: {
        onsets: { kick: FOUR_FLOOR, snare: DEMBOW_SNARE, hat: EIGHTH_HAT },
      },
      harmony: { presets: [["aeolian", 1]] },
      bass: { behaviour: [["root", 1]], onsets: TRESILLO },
      texture: { roles: { chords: role("saw", "pluck:0.5") } },
    },
  ),
  leaf(
    "deconstructed-club",
    "deconstructed club: fractured grids with no steady downbeat, metallic hits, atonal locrian textures, abrupt silences",
    2015,
    {
      tempo: { bpm: [100, 145], typical: 125 },
      rhythm: {
        onsets: {
          kick: grid("x....4..3..x...."),
          snare: grid("...4.......x..3."),
          hat: grid("..3..4....3...4."),
        },
      },
      pitch: {
        scales: [
          ["locrian", 0.5],
          ["phrygian", 0.5],
        ],
      },
      harmony: { model: "modal" },
      texture: {
        roles: { ...kitAll(ELECTRO_KIT), chords: role("granular", "bell:0.5") },
      },
      mix: { fx: { kick: { distort: "fold" } }, space: 0.55 },
    },
  ),
  leaf(
    "bass-music",
    "festival trap and bass music: half-time trap drums at 140-150, harmonic-minor build-drop, 808 and saw drops",
    2012,
    {
      tempo: { bpm: [140, 152], typical: 146 },
      rhythm: {
        onsets: {
          kick: grid("x.....x...x....."),
          snare: HALF_SNARE,
          hat: TRAP_HAT,
        },
      },
      pitch: {
        scales: [
          ["harmonic-minor", 0.6],
          ["minor", 0.4],
        ],
      },
      texture: {
        roles: { ...kitAll(TRAP_KIT), chords: role("saw", "bell:0.5") },
      },
    },
  ),
  leaf(
    "beatdown",
    "beatdown: slow 90-110 half-time weight, sparse heavy kick, low phrygian riffs, maximal sub",
    2008,
    {
      tempo: { bpm: [88, 110], typical: 100 },
      rhythm: {
        onsets: {
          kick: grid("x.......x..x...."),
          snare: HALF_SNARE,
          hat: grid("x...x...x...x..."),
        },
      },
      pitch: { scales: [["phrygian", 1]] },
      harmony: { model: "modal" },
      bass: { behaviour: [["root", 1]], onsets: grid("x.......x..x....") },
      mix: { fx: { bass: { distort: "warm" } } },
    },
  ),
  leaf(
    "funkot",
    "funkot: Indonesian house at 160-200 bpm, four-on-the-floor with kendang-like off-beat percussion, dangdut phrygian-dominant melody",
    2000,
    {
      tempo: { bpm: [160, 200], typical: 180 },
      rhythm: {
        onsets: {
          kick: FOUR_FLOOR,
          snare: BACKBEAT,
          hat: OFFBEAT_HAT,
          perc: grid("..xx..x...xx..x."),
        },
      },
      pitch: {
        scales: [
          ["phrygian-dominant", 0.6],
          ["harmonic-minor", 0.4],
        ],
      },
      harmony: { model: "modal" },
      texture: {
        roles: {
          perc: role("tabla", "drums:0.5"),
          lead: role("sing", "flute:0.5"),
          chords: role("keys"),
        },
      },
    },
  ),
  leaf(
    "singeli",
    "singeli: Tanzanian street music at 200-300 bpm, frantic sampled hand-drum loops, keyboard ostinatos, rapid MC chant",
    2010,
    {
      tempo: { bpm: [200, 300], typical: 230 },
      rhythm: {
        onsets: {
          kick: FOUR_FLOOR,
          snare: grid("..x...x...x...x."),
          hat: SIXTEENTH_HAT,
          perc: TRESILLO,
        },
      },
      pitch: {
        scales: [
          ["major", 0.5],
          ["mixolydian", 0.5],
        ],
      },
      harmony: { model: "modal" },
      melody: { density: [2, 4] },
      texture: {
        roles: {
          perc: role("drums"),
          chords: role("keys", "marimba:0.5"),
          lead: role("vocal"),
        },
      },
    },
  ),
];

export const POP_CARDS: readonly StyleCard[] = Object.freeze([
  ...ROOTS,
  ...TRADITIONAL,
  ...SIXTIES,
  ...MODERN,
  ...OLD_SCHOOL,
  ...REGIONAL,
  ...MODERN_RAP,
  ...BREAKS,
]);
