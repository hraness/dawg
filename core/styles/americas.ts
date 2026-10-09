/**
 * Caribbean and Latin America (quality-08 family `americas`). Root and
 * branch cards carry the shared patterns (the off-beat skank and one-drop,
 * the clave and tumbao, the sesquialtera of the 3/4 and 6/8 traditions);
 * leaves carry only their deltas. Each card's `summary` is its theory
 * note: the concepts that define the style.
 *
 * Timelines (clave, cinquillo, tresillo, bembe bell) come from cycles.ts.
 * Clave-based styles write one clave cycle (two cut-time bars) as one
 * 16-step bar, so their BPM is the cut-time half note: salsa at 90 here is
 * 180 in the usual quarter count. Samba and bossa write two 2/4 bars as
 * one 16-step bar, so their BPM is the 2/4 quarter.
 *
 * Theory, not material: grids, distributions and functional grammars
 * only; no melody, lyric or recording is transcribed.
 */

import { TIMELINES, timelineCycle, type TimelineName } from "./cycles.ts";
import { grid, intervals, kit, maybe, role } from "./parts.ts";
import { card, type StyleCard } from "./schema.ts";

/** A timeline from cycles.ts as an onset grid. */
const tl = (name: TimelineName) => grid(TIMELINES[name]);

/** Mostly steps, few leaps: sung lines. */
const CONJUNCT = intervals(5, 2, 0.6, 0.6);
/** Chant: repeated notes and steps, call and response. */
const CHANT = intervals(4, 1.5, 0.3, 2);
/** Instrumental lines with arpeggiated leaps (choro, mambo brass). */
const LEAPY = intervals(3, 2.5, 1.2, 0.4);

/** Plain kit voices without a snare (the hand-drum traditions). */
const NO_KIT = Object.freeze({
  kick: null,
  snare: null,
  hat: null,
  rim: null,
  clap: null,
});
const NO_KIT_ONSETS = Object.freeze({
  kick: null,
  snare: null,
  hat: null,
  rim: null,
  clap: null,
});

export const AMERICAS_CARDS: readonly StyleCard[] = Object.freeze([
  // =========================================================================
  // Caribbean. References: Michael Veal, "Dub" (2007); Peter Manuel,
  // "Caribbean Currents" (2006).
  card({
    id: "caribbean",
    abstract: true,
    summary:
      "off-beat skank and one-drop: guitar and keys on the and, bass melodic and heavy",
    tempo: { bpm: [65, 110], typical: 76 },
    groove: { subdivision: 4, swingRatio: [1, 1.25] },
    rhythm: {
      onsets: {
        kick: grid("........x......."),
        rim: grid("........x......."),
        hat: grid("x.x.x.x.x.x.x.x."),
        chords: grid("..x...x...x...x."),
      },
    },
    pitch: {
      scales: [
        ["minor", 0.4],
        ["major", 0.4],
        ["dorian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["dorian-vamp", 0.4],
        ["axis", 0.3],
        ["aeolian", 0.3],
      ],
      rhythm: [
        [1, 0.5],
        [0.5, 0.5],
      ],
    },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x..x..x...x.x...") },
    texture: {
      roles: {
        snare: null,
        rim: role("drums"),
        chords: role("electric", "hammond:0.5"),
        bass: role("ebass"),
      },
    },
  }),
  card({
    id: "jamaican",
    abstract: true,
    summary:
      "Jamaican: one-drop and steppers kicks, skank on the off-beat, dub space",
    mix: { space: 0.5 },
  }),
  card({
    id: "mento",
    summary:
      "mento: rural calypso cousin, light shuffle, banjo strum on the and, rumba-box bass on one and the and of two, I-IV-V7",
    tempo: { bpm: [95, 130], typical: 112 },
    groove: { swingRatio: [1.2, 1.45] },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV", "V7", "I"], 0.6],
        [["I", "I", "V7", "V7"], 0.4],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        kick: null,
        rim: null,
        hat: null,
        shaker: grid("x.x.x.x.x.x.x.x."),
        chords: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: {
      behaviour: [["root-fifth", 1]],
      onsets: grid("x.....x.x......."),
    },
    texture: {
      roles: {
        kick: null,
        rim: null,
        hat: null,
        shaker: role("drums"),
        chords: role("banjo", "acoustic:0.5"),
        bass: role("marimba"),
        lead: role("sing", "clarinet:0.4", "flute:0.3"),
      },
    },
    mix: { space: 0.25 },
  }),
  card({
    id: "ska",
    summary:
      "ska: fast shuffle, guitar and piano chop every off-beat, walking bass on every beat, horn section lead, I-vi-IV-V",
    tempo: { bpm: [110, 170], typical: 138 },
    groove: { swingRatio: [1.2, 1.5] },
    pitch: {
      scales: [
        ["major", 0.8],
        ["minor", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.6],
        ["turnaround", 0.4],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        kick: grid("x...x...x...x..."),
        rim: null,
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: {
      behaviour: [["walking", 1]],
      walk: { chordToneOnOne: 0.95, chromaticApproach: 0.3 },
    },
    texture: {
      roles: {
        rim: null,
        snare: role("drums"),
        chords: role("electric", "piano:0.6"),
        bass: role("doublebass", "ebass:0.6"),
        lead: role("trumpet", "trombone:0.6", "tenorsax:0.5"),
      },
    },
  }),
  card({
    id: "rocksteady",
    summary:
      "rocksteady: ska slowed to a straight one-drop, the melodic bass ostinato with rests leads, guitar skank on two and four",
    tempo: { bpm: [70, 92], typical: 80 },
    groove: { swingRatio: [1, 1.15] },
    rhythm: {
      onsets: {
        chords: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: {
      behaviour: [
        ["ostinato", 0.7],
        ["arpeggio", 0.3],
      ],
      onsets: grid("x..x..x.....x.x."),
    },
    texture: { roles: { lead: role("sing", "hammond:0.4") } },
  }),
  card({
    id: "roots-reggae",
    summary:
      "roots reggae: one drop (kick and rim only on three), off-beat skank, organ bubble, dorian i-IV and i-bVII vamps, heavy bass",
    tempo: { bpm: [62, 82], typical: 72 },
    groove: { swingRatio: [1.1, 1.35] },
    pitch: {
      scales: [
        ["dorian", 0.5],
        ["minor", 0.4],
        ["major", 0.1],
      ],
    },
    harmony: {
      presets: [
        ["dorian-vamp", 0.7],
        ["aeolian", 0.3],
      ],
    },
    // organ bubble: every sixteenth but the beat, the and doubling the skank
    rhythm: { onsets: { counter: grid(".xxx.xxx.xxx.xxx") } },
    texture: {
      roles: {
        counter: maybe("hammond"),
        lead: role("sing", "trombone:0.3"),
      },
    },
  }),
  card({
    id: "lovers-rock",
    summary:
      "lovers rock: London reggae with soul harmony, major key (never dorian), Imaj7-vi7-ii7-V7 and IVmaj7-iii7 turns, rockers kick on one and three under the rim on three, eighth hats, sweet sung lead",
    tempo: { bpm: [70, 88], typical: 78 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: null,
      forms: [
        [["Imaj7", "vi7", "ii7", "V7"], 0.4],
        [["IVmaj7", "iii7", "ii7", "V7"], 0.3],
        [["Imaj7", "IVmaj7", "Imaj7", "V7"], 0.3],
      ],
      sevenths: 0.85,
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: { chords: role("epiano", "electric:0.5"), lead: role("sing") },
    },
    expression: { dynamics: [0.35, 0.75] },
  }),
  card({
    id: "dub",
    summary:
      "dub: the riddim stripped to drum and bass, one-chord modal vamp, echo and reverb as instruments, parts dropping in and out",
    tempo: { bpm: [62, 80], typical: 70 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["dorian", 0.4],
      ],
    },
    harmony: { model: "modal", presets: null, rhythm: [[2, 1]] },
    rhythm: { onsets: { chords: grid("..2...x...2...x.") } },
    form: {
      plans: [
        [["intro", "verse", "breakdown", "verse", "breakdown", "outro"], 1],
      ],
      roleMap: { breakdown: ["kick", "rim", "bass", "chords"] },
    },
    texture: {
      roles: {
        chords: role("electric", "hammond:0.6"),
        lead: maybe("trombone", "flute:0.5"),
      },
    },
    mix: {
      fx: {
        chords: { tremolo: "eighth-chop" },
        bass: { compressor: "gentle" },
      },
      space: 0.85,
    },
  }),
  card({
    id: "early-dancehall",
    summary:
      "early dancehall (rub-a-dub): one-chord riddim, kick on one and three, deejay chant on repeated notes, sparse skank",
    tempo: { bpm: [80, 98], typical: 88 },
    harmony: { model: "modal", presets: null, rhythm: [[4, 1]] },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        rim: grid("....x.......x..."),
        chords: grid("..x.......x....."),
      },
    },
    melody: {
      intervals: CHANT,
      ambitus: [3, 7],
      repetition: 0.75,
      density: [2, 3],
    },
    texture: { roles: { lead: role("sing") } },
  }),
  card({
    id: "ragga",
    summary:
      "ragga and digital dancehall: drum machine riddim on the tresillo (3+3+2), snare on the dembow off-beats, minor one-chord, toasting",
    tempo: { bpm: [88, 106], typical: 96 },
    pitch: {
      scales: [
        ["minor", 0.7],
        ["phrygian", 0.3],
      ],
    },
    harmony: { model: "modal", presets: null, rhythm: [[4, 1]] },
    rhythm: {
      onsets: {
        kick: tl("tresillo"),
        rim: null,
        snare: tl("dembowSnare"),
        hat: grid("x.x.x.x.x.x.x.x."),
        chords: grid("...x......x....."),
      },
    },
    bass: {
      behaviour: [["ostinato", 1]],
      onsets: tl("tresillo"),
      kickLock: 0.8,
    },
    melody: { intervals: CHANT, ambitus: [3, 7], repetition: 0.7 },
    texture: {
      roles: {
        rim: null,
        kick: { required: true, voices: [kit("syn808")] },
        snare: { required: true, voices: [kit("syn808")] },
        hat: { required: false, voices: [kit("syn808")] },
        chords: role("square", "saw:0.5"),
        bass: role("bass"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "reggae-pop",
    summary:
      "reggae-pop: off-beat skank and one-drop under a verse-chorus pop form, I-V-vi-IV, bright major",
    tempo: { bpm: [80, 110], typical: 94 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["minor", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.7],
        ["canon", 0.3],
      ],
    },
    rhythm: { onsets: { kick: grid("x.......x.......") } },
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
    texture: { roles: { lead: role("sing") } },
  }),
  card({
    id: "nyabinghi",
    summary:
      "nyabinghi: Rasta drumming, bass drum on one and three, funde heartbeat on every beat, repeater improvising, slow minor chant",
    tempo: { bpm: [55, 75], typical: 64 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["dorian", 0.4],
      ],
    },
    harmony: { model: "modal", presets: null, rhythm: [[4, 1]] },
    rhythm: {
      onsets: {
        ...NO_KIT_ONSETS,
        perc: grid("x...x...x...x..."),
        bell: grid("..5...5...5...5."),
        chords: null,
      },
    },
    bass: {
      behaviour: [["pedal", 1]],
      onsets: grid("x.......x......."),
    },
    melody: { intervals: CHANT, ambitus: [5, 9], repetition: 0.7 },
    texture: {
      kind: "monophonic",
      roles: {
        ...NO_KIT,
        perc: role("framedrum"),
        bell: maybe("framedrum"),
        chords: null,
        bass: role("timpani"),
        lead: role("sing", "choir:0.5"),
      },
    },
  }),
  card({
    id: "kumina",
    summary:
      "kumina: Afro-Jamaican kbandu and playing cast drums in 12/8, the seven-stroke bell, call-and-response chant over a drone",
    meter: { signatures: [["12/8", 1]] },
    tempo: { bpm: [90, 120], typical: 104 },
    groove: { subdivision: 2, swingRatio: [1, 1] },
    pitch: {
      scales: [
        ["major-pentatonic", 0.5],
        ["minor-pentatonic", 0.5],
      ],
    },
    harmony: { model: "drone", presets: null },
    rhythm: {
      onsets: {
        ...NO_KIT_ONSETS,
        bell: tl("bembe12"),
        perc: grid("x..x..x..x.."),
        chords: null,
      },
    },
    bass: { behaviour: [["none", 1]] },
    melody: { intervals: CHANT, ambitus: [5, 9], repetition: 0.7 },
    texture: {
      kind: "monophonic",
      roles: {
        ...NO_KIT,
        bell: role("bell"),
        perc: role("framedrum"),
        chords: null,
        bass: null,
        lead: role("sing", "choir:0.5"),
      },
    },
  }),

  // --- Trinidad and the Eastern Caribbean
  card({
    id: "trinidad",
    abstract: true,
    summary: "calypso and soca: 2/4 drive, major I-IV-V, steelpan and brass",
    tempo: { bpm: [100, 160], typical: 125 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["axis", 0.5],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x...x...x...x..."),
        snare: grid("...x..x....x..x."),
      },
    },
    texture: {
      roles: { snare: role("drums"), lead: role("steelpan", "trumpet:0.5") },
    },
  }),
  card({
    id: "calypso",
    summary:
      "calypso: 2/4 strum with the tresillo bass (3+3+2), I-IV-V7-I verses, narrative sung lead, brass answers",
    tempo: { bpm: [100, 130], typical: 114 },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV", "V7", "I"], 0.6],
        [["I", "V7", "V7", "I"], 0.4],
      ],
    },
    rhythm: { onsets: { chords: grid("x.xx.xx.x.xx.xx.") } },
    bass: { behaviour: [["root-fifth", 1]], onsets: tl("tresillo") },
    form: {
      plans: [
        [
          [
            "intro",
            "verse",
            "chorus",
            "verse",
            "chorus",
            "verse",
            "chorus",
            "outro",
          ],
          1,
        ],
      ],
    },
    texture: {
      roles: {
        chords: role("acoustic", "steel:0.5"),
        lead: role("sing"),
        counter: maybe("trumpet", "trombone:0.5"),
      },
    },
  }),
  card({
    id: "soca",
    summary:
      "soca: four-on-the-floor kick with calypso snare syncopation, off-beat open hats, driving syncopated bass, major anthem hooks",
    tempo: { bpm: [115, 165], typical: 150 },
    rhythm: {
      onsets: {
        kick: tl("fourFloor"),
        openhat: tl("offbeats"),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: {
      behaviour: [
        ["octave", 0.6],
        ["root-fifth", 0.4],
      ],
      onsets: grid("x..x..x.x..x..x."),
    },
    texture: {
      roles: {
        openhat: role("drums"),
        hat: maybe("drums"),
        chords: role("square", "electric:0.5"),
        bass: role("bass"),
        lead: role("sing", "trumpet:0.4"),
      },
    },
    mix: { loudness: "loud" },
  }),
  card({
    id: "steelband",
    summary:
      "steelband: pans voice lead, strum and bass, engine room of iron (brake drum) and scratcher, major I-IV-V with secondary dominants",
    tempo: { bpm: [100, 140], typical: 120 },
    harmony: {
      presets: null,
      forms: [
        [["I", "VI7", "ii", "V7"], 0.5],
        [["I", "IV", "V7", "I"], 0.5],
      ],
    },
    rhythm: {
      onsets: {
        bell: grid("x.xxx.xxx.xxx.xx"),
        shaker: grid("xxxxxxxxxxxxxxxx"),
        chords: grid("..x...x...x...x."),
      },
    },
    texture: {
      roles: {
        bell: role("bell"),
        shaker: maybe("drums"),
        chords: role("steelpan"),
        bass: role("steelpan"),
        lead: role("steelpan"),
      },
    },
  }),
  card({
    id: "rapso",
    summary:
      "rapso: spoken calypso poetry over a soca and hip-hop beat, chant on two or three notes, one-chord vamp",
    tempo: { bpm: [92, 115], typical: 104 },
    harmony: { model: "modal", presets: null, rhythm: [[4, 1]] },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["mixolydian", 0.5],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x...x....."),
        snare: grid("....x.......x..."),
      },
    },
    melody: {
      intervals: CHANT,
      ambitus: [2, 5],
      repetition: 0.8,
      density: [2, 3],
    },
    texture: { roles: { lead: role("sing"), chords: role("epiano") } },
  }),
  card({
    id: "chutney",
    summary:
      "chutney: Indo-Caribbean dholak on the 3+3+2 kaherva, dhantal iron rod on the beats, harmonium and mixolydian hooks",
    tempo: { bpm: [120, 155], typical: 138 },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "bVII", "I", "V"], 0.5],
        [["I", "IV", "V", "I"], 0.5],
      ],
    },
    rhythm: {
      onsets: {
        kick: null,
        snare: null,
        perc: tl("tresillo"),
        bell: grid("x...x...x...x..."),
      },
    },
    texture: {
      roles: {
        kick: null,
        snare: null,
        perc: role("tabla"),
        bell: role("bell"),
        chords: role("reeds"),
        lead: role("sing", "reeds:0.4"),
      },
    },
  }),
  card({
    id: "junkanoo",
    summary:
      "junkanoo: Bahamian street parade, goatskin bass drum on the beats, cowbells on every eighth, whistles and brass riffs, I-V7",
    tempo: { bpm: [120, 145], typical: 132 },
    harmony: {
      presets: null,
      forms: [
        [["I", "V7"], 0.6],
        [["I", "IV", "V7", "I"], 0.4],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x...x...x...x..."),
        snare: null,
        bell: grid("x.x.x.x.x.x.x.x."),
        perc: grid("x..x..x.x..x..x."),
      },
    },
    texture: {
      roles: {
        snare: null,
        bell: role("bell"),
        perc: role("framedrum"),
        chords: role("trombone", "horn:0.5"),
        lead: role("trumpet", "whistle:0.4"),
      },
    },
  }),
  card({
    id: "bouyon",
    summary:
      "bouyon: Dominican jing ping sped up, four-on-the-floor at 160, keyboard riffs on the off-beat, accordion hook, one-to-two chord vamp",
    tempo: { bpm: [150, 175], typical: 160 },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV"], 0.5],
        [["I", "V"], 0.5],
      ],
    },
    rhythm: {
      onsets: {
        kick: tl("fourFloor"),
        snare: grid("....x.......x..."),
        hat: tl("offbeats"),
        chords: grid("..x...x...x...x."),
      },
    },
    texture: {
      roles: {
        hat: role("drums"),
        chords: role("square"),
        bass: role("bass"),
        lead: role("reeds", "saw:0.5"),
      },
    },
  }),
  card({
    id: "bubbling",
    summary:
      "bubbling: Antillean dancehall riddims pitched up to 140, tresillo kick and dembow snare, minor synth vamp",
    tempo: { bpm: [130, 150], typical: 140 },
    pitch: { scales: [["minor", 1]] },
    harmony: { model: "modal", presets: null, rhythm: [[4, 1]] },
    rhythm: {
      onsets: {
        kick: tl("tresillo"),
        snare: tl("dembowSnare"),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        kick: { required: true, voices: [kit("electro")] },
        snare: { required: true, voices: [kit("electro")] },
        hat: { required: false, voices: [kit("electro")] },
        chords: role("saw"),
        bass: role("bass"),
        lead: role("sing", "square:0.5"),
      },
    },
  }),

  // --- French and Creole Caribbean
  card({
    id: "french-caribbean",
    abstract: true,
    summary: "kompa and zouk: rolling mid-tempo, tanbou and guitar arpeggios",
    tempo: { bpm: [90, 130], typical: 110 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.4],
      ],
    },
  }),
  card({
    id: "zouk",
    summary:
      "zouk: gwo ka rooted kick on the 3+3+2, tom answers, lush major-seventh keyboards and ii-V-I, sung lead",
    tempo: { bpm: [110, 135], typical: 122 },
    harmony: {
      presets: [
        ["ii-v-i", 0.6],
        ["axis", 0.4],
      ],
      sevenths: 0.6,
    },
    rhythm: {
      onsets: {
        kick: tl("tresillo"),
        snare: grid("....x.......x..."),
        tom: grid("......x.......x."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: tl("tresillo") },
    texture: {
      roles: {
        tom: maybe("drums"),
        chords: role("epiano", "square:0.4"),
        bass: role("bass"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "kompa",
    summary:
      "kompa: Haitian konpa direk, cowbell on the cinquillo, steady hi-hat, arpeggiated guitar in thirds, ii-V-I with sevenths",
    tempo: { bpm: [100, 125], typical: 114 },
    harmony: {
      presets: [
        ["ii-v-i", 0.5],
        ["turnaround", 0.5],
      ],
      sevenths: 0.5,
    },
    rhythm: {
      onsets: {
        kick: grid("x...x...x...x..."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
        bell: tl("cinquillo"),
        chords: grid("x.xx.xx.x.xx.xx."),
      },
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x..x..x.x.......") },
    texture: {
      roles: {
        bell: role("bell"),
        chords: role("electric", "epiano:0.5"),
        bass: role("ebass"),
        lead: role("sing", "altosax:0.4"),
      },
    },
  }),
  card({
    id: "rara",
    summary:
      "rara: Haitian processional, vaksen bamboo trumpets in hocket (each one note, interlocking), tanbou and kata, drone pentatonic",
    tempo: { bpm: [115, 140], typical: 126 },
    pitch: {
      scales: [
        ["minor-pentatonic", 0.6],
        ["major-pentatonic", 0.4],
      ],
    },
    harmony: { model: "drone", presets: null },
    rhythm: {
      onsets: {
        ...NO_KIT_ONSETS,
        bell: grid("x.xx.x.xx.xx.x.x"),
        perc: grid("x..x..x...x.x..."),
        chords: null,
      },
    },
    bass: { behaviour: [["pedal", 1]], onsets: grid("x.......x.......") },
    melody: { intervals: CHANT, ambitus: [5, 9], repetition: 0.8 },
    texture: {
      kind: "interlocking",
      roles: {
        ...NO_KIT,
        bell: role("bell"),
        perc: role("framedrum"),
        chords: null,
        bass: role("tuba"),
        lead: role("horn", "trumpet:0.5"),
        counter: role("horn"),
      },
    },
  }),
  card({
    id: "twoubadou",
    summary:
      "twoubadou: Haitian troubadour son, 2-3 son clave on claves, guitar and banjo strum, manouba lamellophone bass anticipations",
    tempo: { bpm: [90, 115], typical: 100 },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV", "V7", "I"], 0.6],
        [["I", "V7"], 0.4],
      ],
    },
    rhythm: {
      onsets: {
        kick: null,
        snare: null,
        bell: tl("sonClave23"),
        shaker: grid("x.xxx.xxx.xxx.xx"),
        chords: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: tl("tumbao") },
    texture: {
      roles: {
        kick: null,
        snare: null,
        bell: role("bell"),
        shaker: role("drums"),
        chords: role("acoustic", "banjo:0.4"),
        bass: role("marimba"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "gwo-ka",
    summary:
      "gwo ka: Guadeloupe boula drums keep the steady 3+3+2, makè lead drum improvises, leader-chorus call and response, no harmony",
    tempo: { bpm: [100, 130], typical: 116 },
    pitch: {
      scales: [
        ["major", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: { model: "drone", presets: null },
    rhythm: {
      onsets: {
        ...NO_KIT_ONSETS,
        perc: tl("tresillo"),
        bell: grid("..5..5.5..5..5.5"),
        chords: null,
      },
    },
    bass: { behaviour: [["none", 1]] },
    melody: { intervals: CHANT, ambitus: [5, 9], repetition: 0.75 },
    texture: {
      kind: "monophonic",
      roles: {
        ...NO_KIT,
        perc: role("framedrum"),
        bell: maybe("framedrum"),
        chords: null,
        bass: null,
        lead: role("sing", "choir:0.5"),
      },
    },
  }),
  card({
    id: "bele",
    summary:
      "bele and chouval bwa: Martinique bele drum with tibwa sticks on bamboo, carousel accordion and flute, fast major dance",
    tempo: { bpm: [115, 145], typical: 128 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: null,
      forms: [
        [["I", "V7"], 0.5],
        [["I", "IV", "V7", "I"], 0.5],
      ],
    },
    rhythm: {
      onsets: {
        kick: null,
        snare: null,
        bell: grid("x.xx.x.xx.xx.x.x"),
        perc: grid("x...x.x.x...x.x."),
      },
    },
    texture: {
      roles: {
        kick: null,
        snare: null,
        bell: role("bell"),
        perc: role("framedrum"),
        chords: role("reeds"),
        lead: role("flute", "reeds:0.5"),
      },
    },
  }),
  card({
    id: "beguine",
    summary:
      "biguine: Martinique 2/4 jazz-band, habanera-derived bass, clarinet lead with trombone counter-line, ii-V and secondary dominants",
    tempo: { bpm: [105, 130], typical: 118 },
    groove: { swingRatio: [1.1, 1.3] },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["turnaround", 0.5],
        ["ii-v-i", 0.5],
      ],
      sevenths: 0.6,
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: tl("habanera"),
        chords: grid("..x...x...x...x."),
      },
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x..x....x..x....") },
    texture: {
      kind: "polyphonic",
      roles: {
        chords: role("banjo", "piano:0.6"),
        bass: role("doublebass"),
        lead: role("clarinet"),
        counter: maybe("trombone"),
      },
    },
    melody: { intervals: LEAPY },
  }),
  card({
    id: "kaseko",
    summary:
      "kaseko: Surinamese street band, skratji bass drum on every beat, snare rolls on the off-beat, brass call and response, major",
    tempo: { bpm: [130, 165], typical: 146 },
    harmony: {
      presets: null,
      forms: [
        [["I", "V7"], 0.6],
        [["I", "IV", "V7", "I"], 0.4],
      ],
    },
    rhythm: {
      onsets: {
        kick: tl("fourFloor"),
        snare: grid("..x.x.x...x.x.xx"),
        hat: null,
      },
    },
    texture: {
      roles: {
        hat: null,
        chords: role("trombone", "electric:0.5"),
        bass: role("bass", "tuba:0.4"),
        lead: role("trumpet", "sing:0.6"),
      },
    },
  }),
  card({
    id: "punta",
    summary:
      "punta and paranda: Garifuna segunda drum ostinato and primero improvising, turtle-shell and shaker, call and response; paranda adds guitar",
    tempo: { bpm: [120, 160], typical: 140 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "V7"], 0.6],
        [["i", "V7"], 0.4],
      ],
    },
    rhythm: {
      onsets: {
        kick: null,
        snare: null,
        perc: grid("x..x.x.xx..x.x.x"),
        shaker: grid("x.x.x.x.x.x.x.x."),
        chords: grid("x..x..x.x..x..x."),
      },
    },
    texture: {
      roles: {
        kick: null,
        snare: null,
        perc: role("framedrum"),
        shaker: role("drums"),
        chords: maybe("acoustic"),
        lead: role("sing", "choir:0.4"),
      },
    },
  }),

  // =========================================================================
  // Latin America. References: Peñalosa, "The Clave Matrix" (2009); Chris
  // Washburne, "Sounding Salsa" (2008); Carlos Sandroni, "Feitiço Decente"
  // (2001).
  card({
    id: "latin-america",
    abstract: true,
    summary:
      "clave-led: the 3-2 or 2-3 clave, tumbao bass anticipations, montuno piano",
    tempo: { bpm: [90, 200], typical: 120 },
    groove: { subdivision: 4 },
    rhythm: {
      onsets: {
        bell: tl("sonClave32"),
        perc: tl("dembowSnare"),
        kick: grid("...x.......x...."),
        snare: null,
        hat: null,
        chords: grid("x.xx.xx.x.xx.xx."),
      },
    },
    pitch: {
      scales: [
        ["minor", 0.4],
        ["major", 0.4],
        ["harmonic-minor", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["andalusian", 0.3],
        ["fifties", 0.3],
        ["minor-ii-v", 0.4],
      ],
      rhythm: [
        [2, 0.5],
        [1, 0.5],
      ],
      sevenths: 0.3,
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: tl("dembowSnare") },
    texture: {
      roles: {
        snare: null,
        hat: null,
        kick: role("drums"),
        bell: role("bell"),
        perc: role("drums"),
        chords: role("piano", "tres:0.5"),
        lead: role("trumpet", "sing:0.6", "flute:0.3"),
      },
    },
  }),

  // --- Cuba
  card({
    id: "cuban",
    abstract: true,
    summary:
      "Cuban son and its heirs: son clave, tres guajeo, anticipated tumbao bass on the and of two and on four, conga tumbao",
    tempo: { bpm: [80, 110], typical: 92 },
    rhythm: {
      onsets: {
        bell: tl("sonClave32"),
        perc: tl("congaTumbao"),
        kick: null,
        chords: grid("x.xx.xx.x.xx.xx."),
      },
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV", "V7", "IV"], 0.4],
        [["ii", "V7", "I", "I"], 0.3],
        [["i", "iv", "V7", "i"], 0.3],
      ],
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: tl("tumbao") },
    texture: { roles: { kick: null, bass: role("doublebass", "ebass:0.5") } },
  }),
  card({
    id: "son-cubano",
    summary:
      "son: 2-3 or 3-2 son clave (onsets 0 3 6 10 12), tres guajeo, bongo martillo, anticipated bass, largo then montuno call and response",
    tempo: { bpm: [75, 105], typical: 88 },
    rhythm: {
      onsets: {
        shaker: tl("scrape"),
        // bongo martillo: every eighth, no congas in the classic septeto
        perc: grid("x5x5x5x5x5x5x5x5"),
      },
    },
    form: {
      plans: [[["intro", "verse", "verse", "chorus", "chorus", "outro"], 1]],
    },
    texture: {
      roles: {
        shaker: maybe("drums"),
        chords: role("tres"),
        lead: role("sing", "trumpet:0.5"),
      },
    },
  }),
  card({
    id: "danzon",
    summary:
      "danzon: cut-time rondo, timbal baqueteo on the cinquillo, guiro, charanga flute and violins, bass on one and the and of two",
    tempo: { bpm: [55, 70], typical: 62 },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    rhythm: {
      onsets: {
        bell: tl("baqueteo"),
        perc: null,
        shaker: grid("x..xx.x.x..xx.x."),
        chords: grid("x...x.x.x...x.x."),
      },
    },
    bass: { onsets: grid("x.....x.x.......") },
    form: {
      plans: [
        [["intro", "verse", "intro", "bridge", "intro", "chorus", "outro"], 1],
      ],
      archetype: "rondo",
    },
    texture: {
      roles: {
        perc: null,
        shaker: role("drums"),
        chords: role("piano", "violins:0.6"),
        lead: role("flute"),
        counter: maybe("violin"),
      },
    },
  }),
  card({
    id: "bolero",
    summary:
      "bolero: slow 4/4, bongo bolero cell and soft 2-3 clave, requinto guitar fills, secondary dominants and borrowed iv, romantic sung lead",
    tempo: { bpm: [62, 88], typical: 74 },
    pitch: {
      scales: [
        ["major", 0.5],
        ["minor", 0.3],
        ["harmonic-minor", 0.2],
      ],
    },
    harmony: {
      forms: [
        [["I", "vi", "ii7", "V7"], 0.35],
        [["I", "I7", "IV", "iv"], 0.35],
        [["i", "iv", "V7", "i"], 0.3],
      ],
      sevenths: 0.6,
      rhythm: [
        [1, 0.6],
        [0.5, 0.4],
      ],
    },
    rhythm: {
      onsets: {
        bell: tl("sonClave23"),
        perc: grid("x.xxx.x.x.xxx.x."),
        chords: grid("x...x.x.x...x.x."),
      },
    },
    bass: { onsets: grid("x.......x.x.....") },
    texture: {
      roles: {
        chords: role("nylon"),
        bass: role("doublebass"),
        lead: role("sing", "requinto:0.4"),
      },
    },
    expression: { dynamics: [0.3, 0.75] },
  }),
  card({
    id: "rumba-cubana",
    summary:
      "rumba: rumba clave (third stroke delayed to 7), palitos on the cascara, tumba and salidor congas with the quinto improvising, voices only",
    tempo: { bpm: [90, 120], typical: 104 },
    harmony: { model: "drone", presets: null, forms: null },
    rhythm: {
      onsets: {
        bell: tl("rumbaClave32"),
        perc: tl("congaTumbao"),
        shaker: tl("cascara32"),
        chords: null,
      },
    },
    bass: { behaviour: [["none", 1]] },
    melody: { intervals: CHANT, ambitus: [5, 10], repetition: 0.65 },
    texture: {
      kind: "monophonic",
      roles: {
        bell: role("bell"),
        perc: role("drums"),
        shaker: role("drums"),
        chords: null,
        bass: null,
        lead: role("sing", "choir:0.4"),
      },
    },
  }),
  card({
    id: "mambo",
    summary:
      "mambo: big band montuno at a run, campana bell on every quarter over the 2-3 clave, timbal ponche on four, trumpets against saxes in riffs, tumbao bass, ii-V vamps",
    tempo: { bpm: [92, 112], typical: 102 },
    harmony: {
      forms: [
        [["ii7", "V7", "ii7", "V7"], 0.5],
        [["I", "IV", "V7", "IV"], 0.5],
      ],
      sevenths: 0.6,
    },
    rhythm: {
      onsets: {
        // the bongocero's campana on every quarter; the clave moves to sticks
        bell: grid("x.x.x.x.x.x.x.x."),
        shaker: tl("sonClave23"),
        kick: grid("......x.......x."),
      },
    },
    melody: { intervals: LEAPY, density: [2, 3] },
    texture: {
      kind: "polyphonic",
      roles: {
        shaker: role("drums"),
        kick: role("drums"),
        chords: role("piano"),
        lead: role("trumpet"),
        counter: role("tenorsax", "barisax:0.5"),
      },
    },
  }),
  card({
    id: "cha-cha",
    summary:
      "cha-cha-cha: guiro long-short-short, cencerro on each beat, the cha-cha-cha on four-and-one, unison flute and violins, I-V7",
    tempo: { bpm: [110, 130], typical: 120 },
    harmony: {
      forms: [
        [["I", "V7", "V7", "I"], 0.5],
        [["ii7", "V7", "I", "I"], 0.5],
      ],
    },
    rhythm: {
      onsets: {
        bell: grid("x...x...x...x..."),
        perc: grid("......x.....x.x."),
        shaker: grid("x.xxx.xxx.xxx.xx"),
        chords: grid("x...x...x...x.x."),
      },
    },
    bass: { onsets: grid("x.....x.....x.x.") },
    texture: {
      roles: {
        shaker: role("drums"),
        chords: role("piano"),
        lead: role("flute", "violins:0.6"),
      },
    },
  }),
  card({
    id: "charanga",
    summary:
      "charanga and pachanga: flute and violins over piano montuno, timbal cascara, guiro, bouncy pachanga 2/4 feel",
    tempo: { bpm: [95, 115], typical: 104 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.4],
      ],
    },
    rhythm: {
      onsets: {
        bell: tl("cascara"),
        shaker: tl("scrape"),
      },
    },
    texture: {
      roles: {
        shaker: role("drums"),
        chords: role("piano"),
        lead: role("flute"),
        counter: role("violins"),
      },
    },
  }),
  card({
    id: "guajira",
    summary:
      "guajira and punto: 6/8 against 3/4 sesquialtera (dotted pulse 0 6 against 0 4 8), laud and tres, decima verse, major I-IV-V7",
    meter: { signatures: [["6/8", 1]] },
    tempo: { bpm: [90, 120], typical: 104 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      forms: [
        [["I", "IV", "V7", "I"], 0.6],
        [["I", "V7", "V7", "I"], 0.4],
      ],
    },
    rhythm: {
      onsets: {
        bell: tl("sixEight12"),
        perc: tl("threeFour12"),
        shaker: grid("x.x.x.x.x.x."),
        chords: grid("x.x...x.x.x."),
      },
    },
    bass: { onsets: tl("sixEight12") },
    form: {
      plans: [[["intro", "verse", "verse", "verse", "outro"], 1]],
      archetype: "strophic",
    },
    texture: {
      roles: {
        shaker: maybe("drums"),
        chords: role("tres", "lute:0.5"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "descarga",
    summary:
      "descarga: Cuban jam on a ii-V montuno vamp, extended sevenths, mambo bell, long improvised solos over clave",
    tempo: { bpm: [90, 110], typical: 100 },
    harmony: {
      presets: [
        ["ii-v-i", 0.6],
        ["minor-ii-v", 0.4],
      ],
      forms: null,
      sevenths: 0.85,
    },
    rhythm: { onsets: { shaker: grid("x.x.x.x.x.x.x.x.") } },
    melody: { intervals: LEAPY, density: [3, 4], repetition: 0.2 },
    form: {
      plans: [[["intro", "verse", "bridge", "bridge", "verse", "outro"], 1]],
    },
    texture: {
      roles: {
        shaker: maybe("drums"),
        chords: role("piano"),
        lead: role("trumpet", "tenorsax:0.6", "flute:0.4"),
      },
    },
  }),
  card({
    id: "timba",
    summary:
      "timba: Havana dance band, kick (bombo) on the clave, gears shifting between bass patterns, minor vamps, piano tumbao, coro and call",
    tempo: { bpm: [92, 110], typical: 100 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["dorian", 0.4],
      ],
    },
    harmony: {
      forms: [
        [["i", "iv", "V7", "iv"], 0.5],
        [["i", "bVII", "bVI", "V7"], 0.5],
      ],
    },
    rhythm: {
      onsets: {
        bell: tl("sonClave23"),
        kick: grid("...x......x....."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: {
      behaviour: [
        ["octave", 0.5],
        ["root-fifth", 0.5],
      ],
      onsets: grid("x...x.x...x..x.."),
    },
    texture: {
      roles: {
        kick: role("drums"),
        snare: role("drums"),
        hat: maybe("drums"),
        chords: role("piano", "epiano:0.4"),
        bass: role("ebass"),
        lead: role("sing", "trumpet:0.5"),
      },
    },
  }),
  card({
    id: "nueva-trova",
    summary:
      "trova and nueva trova: singer with guitar, bolero and son roots, extended chords and secondary dominants, strophic poetic form",
    tempo: { bpm: [70, 105], typical: 86 },
    pitch: {
      scales: [
        ["major", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: {
      forms: [
        [["I", "iii7", "vi7", "ii7", "V7"], 0.4],
        [["i", "VI", "ii", "V7"], 0.3],
        [["I", "IV", "iv", "I"], 0.3],
      ],
      sevenths: 0.5,
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: null,
        chords: grid("x.xxx.xxx.xxx.xx"),
      },
    },
    bass: {
      behaviour: [
        ["arpeggio", 0.6],
        ["root-fifth", 0.4],
      ],
      onsets: grid("x.......x......."),
    },
    form: {
      plans: [[["intro", "verse", "verse", "bridge", "verse", "outro"], 1]],
      archetype: "strophic",
    },
    texture: {
      roles: {
        bell: null,
        perc: null,
        chords: role("nylon"),
        bass: role("nylon"),
        lead: role("sing"),
      },
    },
    expression: { dynamics: [0.3, 0.75] },
  }),
  card({
    id: "santeria",
    summary:
      "bata and santeria: iya, itotele and okonkolo bata drums in 12/8 over the seven-stroke bembe bell, akpwon calls and coro answers, no harmony",
    meter: {
      signatures: [["12/8", 1]],
      cycle: timelineCycle("bembe", TIMELINES.bembe12, [0, 7], [1, 8]),
    },
    tempo: { bpm: [95, 130], typical: 110 },
    groove: { subdivision: 2, swingRatio: [1, 1] },
    pitch: {
      scales: [
        ["major-pentatonic", 0.5],
        ["minor-pentatonic", 0.5],
      ],
    },
    harmony: { model: "drone", presets: null, forms: null },
    rhythm: {
      onsets: {
        bell: null,
        perc: null,
        shaker: grid("x..x..x..x.."),
        chords: null,
      },
    },
    bass: { behaviour: [["none", 1]] },
    melody: { intervals: CHANT, ambitus: [5, 9], repetition: 0.75 },
    texture: {
      kind: "monophonic",
      roles: {
        bell: null,
        perc: role("framedrum"),
        shaker: role("drums"),
        chords: null,
        bass: null,
        lead: role("sing", "choir:0.5"),
      },
    },
  }),
  card({
    id: "changui",
    summary:
      "changui: Guantanamo son ancestor, tres guajeo, marimbula bass anticipating the beat, bongo slapping off-beats, guiro and maracas, I-V7",
    tempo: { bpm: [100, 125], typical: 112 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      forms: [
        [["I", "V7"], 0.6],
        [["I", "IV", "V7", "V7"], 0.4],
      ],
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: tl("offbeats"),
        shaker: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        bell: null,
        shaker: role("drums"),
        chords: role("tres"),
        bass: role("marimba"),
        lead: role("sing"),
      },
    },
  }),

  // --- Puerto Rico and the Dominican Republic
  card({
    id: "puerto-rico-dr",
    abstract: true,
    summary: "salsa, bomba, merengue and bachata: clave, tumbao, guira drive",
  }),
  card({
    id: "salsa",
    summary:
      "salsa: 2-3 son clave, cascara in the verse and campana in the montuno, piano montuno, tumbao bass, trombone and trumpet mambos",
    tempo: { bpm: [85, 108], typical: 96 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["major", 0.4],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["i", "iv", "V7", "i"], 0.4],
        [["ii7", "V7", "I", "I"], 0.3],
        [["i", "bVII", "bVI", "V7"], 0.3],
      ],
    },
    rhythm: {
      onsets: {
        bell: tl("sonClave23"),
        perc: tl("congaTumbao"),
        shaker: tl("cascara"),
        kick: null,
      },
    },
    bass: { onsets: tl("tumbao") },
    form: {
      plans: [[["intro", "verse", "chorus", "bridge", "chorus", "outro"], 1]],
    },
    texture: {
      roles: {
        kick: null,
        shaker: role("drums"),
        chords: role("piano"),
        bass: role("bassguitar", "doublebass:0.5"),
        lead: role("sing", "trombone:0.5"),
        counter: maybe("trumpet", "trombone:0.6"),
      },
    },
  }),
  card({
    id: "boogaloo",
    summary:
      "boogaloo: New York Latin soul, R&B backbeat claps on two and four, cowbell and congas, piano montuno over a mixolydian I-IV vamp",
    tempo: { bpm: [100, 125], typical: 112 },
    groove: { swingRatio: [1, 1.2] },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["dorian", 0.5],
      ],
    },
    harmony: {
      presets: [
        ["mixolydian-rock", 0.5],
        ["dorian-vamp", 0.5],
      ],
      forms: null,
    },
    rhythm: {
      onsets: {
        bell: grid("x...x...x...x..."),
        clap: grid("....x.......x..."),
        kick: grid("x.....x.x......."),
      },
    },
    bass: { onsets: grid("x.....x.x...x...") },
    texture: {
      roles: {
        clap: role("drums"),
        chords: role("piano", "hammond:0.4"),
        bass: role("ebass"),
        lead: role("sing", "trumpet:0.5"),
      },
    },
  }),
  card({
    id: "plena",
    summary:
      "plena: three panderetas (seguidor on the beats, punteador and requinto interlocking), guiro, news-song call and response, I-V7",
    tempo: { bpm: [100, 130], typical: 116 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "V7"], 0.6],
        [["i", "V7"], 0.4],
      ],
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: grid("x...x.x.x...x.x."),
        shaker: grid("x.xxx.xxx.xxx.xx"),
        chords: grid("x...x...x...x..."),
      },
    },
    texture: {
      kind: "interlocking",
      roles: {
        bell: null,
        perc: role("framedrum"),
        shaker: role("drums"),
        chords: role("tres", "acoustic:0.5"),
        lead: role("sing", "choir:0.4"),
      },
    },
  }),
  card({
    id: "bomba",
    summary:
      "bomba: buleador barril holds the sica pattern, subidor answers the dancer, cua sticks on the cinquillo, maraca, sung call and response",
    tempo: { bpm: [100, 135], typical: 118 },
    harmony: { model: "drone", presets: null, forms: null },
    rhythm: {
      onsets: {
        bell: tl("cinquillo"),
        perc: grid("x..x..x.x..x..x."),
        shaker: grid("x.x.x.x.x.x.x.x."),
        chords: null,
      },
    },
    bass: { behaviour: [["none", 1]] },
    melody: { intervals: CHANT, ambitus: [5, 9], repetition: 0.75 },
    texture: {
      kind: "monophonic",
      roles: {
        bell: role("bell"),
        perc: role("framedrum"),
        shaker: role("drums"),
        chords: null,
        bass: null,
        lead: role("sing", "choir:0.5"),
      },
    },
  }),
  card({
    id: "jibaro",
    summary:
      "jibaro and aguinaldo: cuatro puertorriqueno lead, guitar and guiro, 2/4 seis in decima verse, major I-IV-V7",
    meter: { signatures: [["2/4", 1]] },
    tempo: { bpm: [100, 135], typical: 116 },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV", "V7", "I"], 0.6],
        [["i", "iv", "V7", "i"], 0.4],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: null,
        shaker: grid("x.xxx.xx"),
        chords: grid("x.x.x.x."),
      },
    },
    bass: { onsets: grid("x...x...") },
    form: {
      plans: [[["intro", "verse", "verse", "verse", "outro"], 1]],
      archetype: "strophic",
    },
    texture: {
      roles: {
        bell: null,
        perc: null,
        shaker: role("drums"),
        chords: role("acoustic"),
        bass: role("acoustic"),
        lead: role("sing", "tres:0.6"),
      },
    },
  }),
  card({
    id: "reggaeton",
    summary:
      "reggaeton: the dembow (kick on every beat, snare on 3 6 11 14 of the tresillo), minor i-VI-III-VII loop, synth and sung hooks",
    tempo: { bpm: [86, 102], typical: 94 },
    pitch: { scales: [["minor", 1]] },
    harmony: {
      presets: [
        ["sad-pop", 0.6],
        ["aeolian", 0.4],
      ],
      forms: null,
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: null,
        kick: tl("fourFloor"),
        snare: tl("dembowSnare"),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: { behaviour: [["root", 1]], onsets: tl("fourFloor"), kickLock: 0.9 },
    texture: {
      roles: {
        bell: null,
        perc: null,
        kick: { required: true, voices: [kit("syn808")] },
        snare: { required: true, voices: [kit("syn808")] },
        hat: { required: false, voices: [kit("syn808")] },
        chords: role("saw", "square:0.5"),
        bass: role("bass"),
        lead: role("sing"),
      },
    },
    mix: { loudness: "loud" },
  }),
  card({
    id: "merengue",
    summary:
      "merengue: tambora on the 2/4 with its slap on the and, guira scraping long-short-short, accordion lead, jaleo section, I-V7 alternation",
    tempo: { bpm: [120, 160], typical: 140 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["minor", 0.2],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "V7"], 0.7],
        [["I", "IV", "V7", "I"], 0.3],
      ],
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: grid("x..xx.x.x..xx.xx"),
        shaker: tl("scrape"),
        chords: grid("..x...x...x...x."),
      },
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x.x.x...x.x.") },
    form: {
      plans: [
        [["intro", "verse", "chorus", "breakdown", "chorus", "outro"], 1],
      ],
    },
    texture: {
      roles: {
        bell: null,
        perc: role("framedrum"),
        shaker: role("drums"),
        chords: role("reeds", "piano:0.4"),
        lead: role("reeds", "sing:0.6", "altosax:0.4"),
      },
    },
  }),
  card({
    id: "bachata",
    summary:
      "bachata: requinto guitar arpeggios, bongo martillo, guira, bass on one-two-three and the four-and, minor bolero changes",
    tempo: { bpm: [118, 140], typical: 128 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["harmonic-minor", 0.4],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["i", "iv", "V7", "i"], 0.5],
        [["i", "VI", "iv", "V7"], 0.5],
      ],
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: grid("x.xxx.xxx.xxx.xx"),
        shaker: grid("x.x.x.x.x.x.x.x."),
        chords: grid("x.x.x.x.x.x.x.x."),
      },
    },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x...x....xx.") },
    texture: {
      roles: {
        bell: null,
        perc: role("drums"),
        shaker: role("drums"),
        chords: role("bachata"),
        bass: role("ebass"),
        lead: role("sing", "requinto:0.5"),
      },
    },
  }),

  // --- Mexico. Reference: Daniel Sheehy, "Mariachi Music in America"
  // (2006).
  card({
    id: "mexican",
    abstract: true,
    summary:
      "Mexican: 3/4 and 6/8 sesquialtera, I-V7 polka bass, brass and accordion",
    meter: {
      signatures: [
        ["3/4", 0.5],
        ["6/8", 0.3],
        ["2/4", 0.2],
      ],
    },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: { presets: [["fifties", 1]] },
    bass: { behaviour: [["root-fifth", 1]] },
    texture: {
      roles: {
        chords: role("nylon", "acoustic:0.5"),
        lead: role("trumpet", "violin:0.6"),
      },
    },
  }),
  card({
    id: "mariachi",
    summary:
      "mariachi and son jalisciense: 6/8 sesquialtera, vihuela strum, guitarron bass on the dotted pulse, trumpets and violins in thirds, I-IV-V7",
    meter: { signatures: [["6/8", 1]] },
    tempo: { bpm: [110, 145], typical: 128 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV", "V7", "I"], 0.5],
        [["I", "V7", "V7", "I"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: null,
        kick: null,
        chords: grid("x.x.x.x.x.x."),
      },
    },
    bass: { onsets: tl("sixEight12") },
    texture: {
      kind: "homophonic",
      roles: {
        bell: null,
        perc: null,
        kick: null,
        snare: null,
        hat: null,
        chords: role("acoustic"),
        bass: role("doublebass"),
        lead: role("violins", "trumpet:0.7"),
        counter: role("trumpet"),
      },
    },
  }),
  card({
    id: "ranchera",
    summary:
      "ranchera: vals ranchero 3/4 oom-pah-pah (bass on one, chords on two and three) at a stately tempo, sung lead with held fermata cadences, mariachi trumpet answers, I-IV-V7",
    meter: { signatures: [["3/4", 1]] },
    tempo: { bpm: [80, 120], typical: 96 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["minor", 0.2],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "I", "V7", "V7"], 0.5],
        [["I", "IV", "V7", "I"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: null,
        kick: null,
        chords: grid("....x...x..."),
      },
    },
    bass: { onsets: grid("x...........") },
    texture: {
      roles: {
        bell: null,
        perc: null,
        kick: null,
        snare: null,
        hat: null,
        chords: role("acoustic", "violins:0.4"),
        bass: role("doublebass"),
        lead: role("sing"),
        counter: maybe("trumpet", "violins:0.6"),
      },
    },
  }),
  card({
    id: "son-jarocho",
    summary:
      "son jarocho: Veracruz 6/8 sesquialtera, jarana strum, requinto jarocho melody, arpa jarocha, zapateado on the tarima, fast I-IV-V7",
    meter: { signatures: [["6/8", 1]] },
    tempo: { bpm: [140, 180], typical: 160 },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV", "V7", "V7"], 0.5],
        [["i", "iv", "V7", "i"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        kick: null,
        perc: grid("x.xx.xx.x.x."),
        chords: grid("x.x.xxx.x.x."),
      },
    },
    bass: { onsets: tl("threeFour12") },
    texture: {
      roles: {
        bell: null,
        kick: null,
        snare: null,
        hat: null,
        perc: role("framedrum"),
        chords: role("requinto", "acoustic:0.5"),
        bass: role("harp"),
        lead: role("harp", "requinto:0.6", "sing:0.6"),
      },
    },
  }),
  card({
    id: "norteno",
    summary:
      "norteno and conjunto: button accordion lead with bajo sexto, 2/4 polka (bass on the beats, chords on the off-beats), I-V7",
    meter: { signatures: [["2/4", 1]] },
    tempo: { bpm: [100, 135], typical: 118 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: null,
      forms: [
        [["I", "V7", "V7", "I"], 0.6],
        [["I", "IV", "V7", "I"], 0.4],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: null,
        kick: grid("x...x..."),
        snare: grid("..x...x."),
        chords: grid("..x...x."),
      },
    },
    bass: { onsets: grid("x...x...") },
    texture: {
      roles: {
        bell: null,
        perc: null,
        snare: role("drums"),
        chords: role("steel", "acoustic:0.5"),
        bass: role("bassguitar"),
        lead: role("reeds"),
      },
    },
  }),
  card({
    id: "corrido",
    summary:
      "corrido: strophic narrative ballad, no chorus, brisk 3/4 with the guitar strumming every eighth over tololoche on every beat, requinto runs between lines, recitation-like lead on few notes, I-V7",
    meter: { signatures: [["3/4", 1]] },
    tempo: { bpm: [120, 160], typical: 138 },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "V7", "V7", "I"], 0.6],
        [["I", "IV", "V7", "I"], 0.4],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: null,
        kick: null,
        chords: grid("x.x.x.x.x.x."),
        counter: grid("..xxxxxx..xx"),
      },
    },
    bass: { onsets: grid("x...x...x...") },
    melody: { intervals: CHANT, ambitus: [5, 9], repetition: 0.6 },
    form: {
      plans: [[["intro", "verse", "verse", "verse", "verse", "outro"], 1]],
      archetype: "strophic",
    },
    texture: {
      roles: {
        bell: null,
        perc: null,
        kick: null,
        snare: null,
        hat: null,
        chords: role("steel", "acoustic:0.5"),
        bass: role("doublebass", "tuba:0.4"),
        lead: role("sing"),
        counter: role("requinto"),
      },
    },
  }),
  card({
    id: "banda",
    summary:
      "banda sinaloense: brass band, the tuba walking every eighth (not the norteno oom-pah), charcheta horns on the off-beats, clarinets and trumpets in thirds, tambora bass drum on the beats with its cymbal on the off-beats, tarola rolls, 2/4 drive",
    meter: { signatures: [["2/4", 1]] },
    tempo: { bpm: [120, 160], typical: 138 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["minor", 0.2],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "V7", "V7", "I"], 0.5],
        [["I", "IV", "V7", "I"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: null,
        kick: grid("x...x..."),
        openhat: grid("..x...x."),
        snare: grid("5.5.x.x5"),
        chords: grid("..x...x."),
      },
    },
    bass: {
      behaviour: [["arpeggio", 1]],
      onsets: grid("x.x.x.x."),
    },
    texture: {
      roles: {
        bell: null,
        perc: null,
        snare: role("drums"),
        openhat: role("drums"),
        chords: role("horn", "trombone:0.5"),
        bass: role("tuba"),
        lead: role("clarinet", "trumpet:0.7"),
        counter: maybe("trumpet"),
      },
    },
  }),
  card({
    id: "tejano",
    summary:
      "tejano: Texas conjunto meets cumbia and pop, accordion and synth, cumbia off-beat scrape, 4/4 I-IV-V7 with pop chorus",
    meter: { signatures: [["4/4", 1]] },
    tempo: { bpm: [92, 120], typical: 104 },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["axis", 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: tl("offbeats"),
        kick: grid("x.......x......."),
        snare: grid("....x.......x..."),
        shaker: tl("scrape"),
        chords: grid("..x...x...x...x."),
      },
    },
    bass: { onsets: grid("x...x.x.x...x.x.") },
    texture: {
      roles: {
        bell: null,
        snare: role("drums"),
        shaker: maybe("drums"),
        chords: role("square", "reeds:0.5"),
        bass: role("ebass"),
        lead: role("sing", "reeds:0.5"),
      },
    },
  }),
  card({
    id: "marimba-orquesta",
    summary:
      "marimba orquesta: Chiapas and Guatemala marimba playing melody in octaves and tremolo chords, 3/4 against 6/8, saxes and brass",
    meter: { signatures: [["3/4", 1]] },
    tempo: { bpm: [110, 150], typical: 128 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV", "V7", "I"], 0.6],
        [["I", "V7"], 0.4],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        perc: tl("sixEight12"),
        kick: null,
        chords: tl("threeFour12"),
      },
    },
    bass: { onsets: tl("sixEight12") },
    texture: {
      roles: {
        bell: null,
        kick: null,
        snare: null,
        hat: null,
        perc: maybe("drums"),
        chords: role("marimba"),
        bass: role("marimba"),
        lead: role("marimba", "altosax:0.5"),
      },
    },
  }),

  // --- Colombia and Venezuela. Reference: Peter Wade, "Music, Race and
  // Nation" (2000).
  card({
    id: "colombia-venezuela",
    abstract: true,
    summary: "cumbia and joropo: 2/4 cumbia shuffle, 6/8 joropo hemiola",
    rhythm: { onsets: { perc: tl("offbeats") } },
  }),
  card({
    id: "cumbia",
    summary:
      "cumbia: llamador on the off-beats, tambor alegre improvising, guacharaca scrape, bass on one and the and of two, accordion or gaita, i-iv-V7",
    tempo: { bpm: [84, 104], typical: 94 },
    harmony: {
      presets: null,
      forms: [
        [["i", "iv", "V7", "i"], 0.5],
        [["I", "IV", "V7", "I"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        kick: grid("x.......x......."),
        shaker: tl("scrape"),
        chords: tl("offbeats"),
      },
    },
    bass: { onsets: grid("x.....x.x.....x.") },
    texture: {
      roles: {
        bell: null,
        shaker: role("drums"),
        chords: role("reeds", "electric:0.5"),
        bass: role("ebass"),
        lead: role("reeds", "flute:0.5", "sing:0.6"),
      },
    },
  }),
  card({
    id: "vallenato",
    summary:
      "vallenato: accordion, caja and guacharaca; paseo 2/4 with bass on the beat and its anticipation, I-IV-V7 in major",
    tempo: { bpm: [92, 130], typical: 110 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["minor", 0.2],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV", "V7", "I"], 0.6],
        [["I", "V7"], 0.4],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        kick: null,
        perc: grid("x..x..x.x..x..x."),
        shaker: tl("scrape"),
        chords: grid("..x...x...x...x."),
      },
    },
    bass: { onsets: grid("x...x..xx...x..x") },
    texture: {
      roles: {
        bell: null,
        kick: null,
        perc: role("framedrum"),
        shaker: role("drums"),
        chords: role("acoustic"),
        bass: role("ebass"),
        lead: role("reeds"),
      },
    },
  }),
  card({
    id: "porro",
    summary:
      "porro and gaita: banda pelayera brass with bombo on the cut-time beats, clarinet tunes; gaita flutes in minor pentatonic",
    tempo: { bpm: [110, 150], typical: 128 },
    pitch: {
      scales: [
        ["major", 0.5],
        ["minor-pentatonic", 0.5],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "V7"], 0.5],
        [["I", "IV", "V7", "I"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        kick: grid("x...x...x...x..."),
        snare: grid("..x...x...x...x."),
      },
    },
    texture: {
      roles: {
        bell: null,
        snare: role("drums"),
        chords: role("trombone", "horn:0.5"),
        bass: role("tuba"),
        lead: role("clarinet", "flute:0.5"),
      },
    },
  }),
  card({
    id: "champeta",
    summary:
      "champeta: Cartagena picos, soukous-style looping electric guitar riffs, electronic kick on the beat, snare on the off-beats, major",
    tempo: { bpm: [100, 125], typical: 112 },
    pitch: { scales: [["major", 1]] },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV", "V", "IV"], 0.5],
        [["I", "V"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        kick: tl("fourFloor"),
        snare: grid("..x...x...x...x."),
        hat: grid("x.x.x.x.x.x.x.x."),
      },
    },
    melody: { intervals: LEAPY, density: [2, 4] },
    texture: {
      roles: {
        bell: null,
        kick: { required: true, voices: [kit("electro")] },
        snare: { required: true, voices: [kit("electro")] },
        hat: { required: false, voices: [kit("electro")] },
        chords: role("electric"),
        bass: role("bass"),
        lead: role("electric", "sing:0.6"),
      },
    },
  }),
  card({
    id: "currulao",
    summary:
      "currulao: Pacific marimba de chonta in 6/8 with 3:2 hemiola, bombo on the dotted pulse, cununo on the 3/4, guasa shaker, minor",
    meter: { signatures: [["6/8", 1]] },
    tempo: { bpm: [110, 140], typical: 124 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["minor-pentatonic", 0.5],
      ],
    },
    harmony: { model: "modal", presets: null, rhythm: [[2, 1]] },
    rhythm: {
      onsets: {
        bell: null,
        kick: tl("sixEight12"),
        perc: tl("threeFour12"),
        shaker: grid("x.x.x.x.x.x."),
        chords: grid("x.xx.xx.xx.x"),
      },
    },
    bass: { behaviour: [["ostinato", 1]], onsets: tl("sixEight12") },
    texture: {
      kind: "interlocking",
      roles: {
        bell: null,
        snare: null,
        hat: null,
        kick: role("drums"),
        perc: role("framedrum"),
        shaker: role("drums"),
        chords: role("marimba"),
        bass: role("marimba"),
        lead: role("marimba", "sing:0.6"),
      },
    },
  }),
  card({
    id: "bambuco",
    summary:
      "bambuco and pasillo: Andean Colombian 3/4 with 6/8 hemiola, tiple and bandola, harmonic minor with relative-major turns",
    meter: { signatures: [["3/4", 1]] },
    tempo: { bpm: [100, 140], typical: 118 },
    pitch: {
      scales: [
        ["harmonic-minor", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["i", "iv", "V7", "i"], 0.5],
        [["I", "IV", "V7", "I"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        kick: null,
        perc: null,
        chords: tl("threeFour12"),
      },
    },
    bass: { onsets: tl("sixEight12") },
    texture: {
      roles: {
        bell: null,
        kick: null,
        snare: null,
        hat: null,
        perc: null,
        chords: role("steel", "tres:0.5"),
        bass: role("acoustic"),
        lead: role("requinto", "sing:0.6"),
      },
    },
  }),
  card({
    id: "joropo",
    summary:
      "joropo: Venezuelan llanero, arpa llanera and cuatro, maracas on every eighth, bass marking 6/8 against the harp's 3/4, fast I-IV-V7",
    meter: { signatures: [["3/4", 1]] },
    tempo: { bpm: [160, 210], typical: 184 },
    pitch: {
      scales: [
        ["major", 0.6],
        ["minor", 0.4],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV", "V7", "I"], 0.6],
        [["i", "iv", "V7", "i"], 0.4],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        kick: null,
        perc: null,
        shaker: grid("x.x.x.x.x.x."),
        chords: tl("threeFour12"),
      },
    },
    bass: { onsets: tl("sixEight12") },
    texture: {
      roles: {
        bell: null,
        kick: null,
        snare: null,
        hat: null,
        perc: null,
        shaker: role("drums"),
        chords: role("tres"),
        bass: role("harp"),
        lead: role("harp", "sing:0.5"),
      },
    },
  }),

  // --- Andes. Reference: Thomas Turino, "Moving Away from Silence"
  // (1993).
  card({
    id: "andean",
    abstract: true,
    summary:
      "Andean: pentatonic minor, huayno short-long rhythm, charango and quena",
    pitch: {
      scales: [
        ["minor-pentatonic", 0.6],
        ["minor", 0.4],
      ],
    },
    texture: {
      roles: { chords: role("nylon"), lead: role("panpipe", "flute:0.6") },
    },
  }),
  card({
    id: "huayno",
    summary:
      "huayno: 2/4 short-long (sixteenth then dotted eighth) on every beat, minor pentatonic with the relative-major double tonic, quena and charango",
    meter: { signatures: [["2/4", 1]] },
    tempo: { bpm: [100, 135], typical: 116 },
    harmony: {
      presets: null,
      forms: [
        [["i", "III", "VII", "III", "i", "V", "i", "i"], 0.6],
        [["i", "III", "i", "V"], 0.4],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        kick: grid("x...x..."),
        perc: null,
        chords: grid("xx..xx.."),
      },
    },
    bass: { onsets: grid("x...x...") },
    texture: {
      roles: {
        bell: null,
        snare: null,
        hat: null,
        perc: null,
        kick: role("drums"),
        chords: role("tres", "nylon:0.5"),
        bass: role("nylon"),
        lead: role("flute", "sing:0.6"),
      },
    },
  }),
  card({
    id: "andean-folk",
    summary:
      "Andean folk ensemble: sikuri panpipes in hocket (ira and arca halves interlocking), bombo on the beats, charango strum, pentatonic",
    tempo: { bpm: [80, 110], typical: 94 },
    harmony: {
      presets: null,
      forms: [
        [["i", "III", "VII", "i"], 0.5],
        [["i", "VII", "III", "i"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        kick: grid("x...x...x...x..."),
        perc: null,
        chords: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      kind: "interlocking",
      roles: {
        bell: null,
        snare: null,
        hat: null,
        perc: null,
        kick: role("drums"),
        chords: role("tres"),
        bass: role("nylon"),
        lead: role("panpipe"),
        counter: role("panpipe"),
      },
    },
  }),
  card({
    id: "musica-criolla",
    summary:
      "musica criolla and vals peruano: fast 3/4 waltz, guitar bass runs, cajon, minor-major alternation with secondary dominants",
    meter: { signatures: [["3/4", 1]] },
    tempo: { bpm: [150, 190], typical: 168 },
    pitch: {
      scales: [
        ["harmonic-minor", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["i", "iv", "V7", "i"], 0.5],
        [["I", "VI7", "ii", "V7"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: null,
        kick: null,
        perc: grid("x...x.x.x..."),
        chords: grid("....x...x..."),
      },
    },
    bass: {
      behaviour: [
        ["arpeggio", 0.5],
        ["root-fifth", 0.5],
      ],
      onsets: grid("x.......x.x."),
    },
    texture: {
      roles: {
        bell: null,
        kick: null,
        snare: null,
        hat: null,
        perc: role("drums"),
        chords: role("nylon"),
        bass: role("nylon"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "afro-peruvian",
    summary:
      "Afro-Peruvian festejo and lando: 12/8 cajon patterns, quijada jawbone and cajita, minor with call and response",
    meter: { signatures: [["12/8", 1]] },
    tempo: { bpm: [90, 125], typical: 106 },
    groove: { subdivision: 2 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["dorian", 0.4],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["i", "iv", "V7", "i"], 0.5],
        [["i", "VII", "VI", "V7"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: tl("bembe12"),
        kick: null,
        perc: grid("x..x.xx..x.x"),
        chords: grid("x..x..x..x.."),
      },
    },
    bass: { onsets: grid("x.....x.....") },
    texture: {
      roles: {
        bell: role("bell"),
        kick: null,
        snare: null,
        hat: null,
        perc: role("drums"),
        chords: role("nylon"),
        bass: role("ebass"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "saya",
    summary:
      "saya and caporales: Afro-Bolivian saya call and response; caporales brass band with heavy bombo on every beat, minor pentatonic",
    tempo: { bpm: [100, 130], typical: 114 },
    harmony: {
      presets: null,
      forms: [
        [["i", "VII", "III", "i"], 0.5],
        [["i", "iv", "V7", "i"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        bell: grid("x.x.x.x.x.x.x.x."),
        kick: grid("x...x...x...x..."),
        snare: grid("..x...x...x...xx"),
        perc: null,
      },
    },
    texture: {
      roles: {
        snare: role("drums"),
        perc: null,
        kick: role("drums"),
        bell: maybe("bell"),
        chords: role("trombone", "horn:0.5"),
        bass: role("tuba"),
        lead: role("trumpet", "sing:0.5"),
      },
    },
  }),

  // --- Southern Cone. References: Ricardo Salton and others on tango
  // rhythm; Ruben Pérez Bugallo, "Folklore musical argentino" (1996).
  card({
    id: "southern-cone",
    abstract: true,
    summary: "tango and milonga: 3+3+2, harmonic minor, bandoneon marcato",
    pitch: {
      scales: [
        ["harmonic-minor", 0.6],
        ["minor", 0.4],
      ],
    },
    meter: { grouping: [[[3, 3, 2], 1]] },
    rhythm: { onsets: { chords: tl("tresillo") } },
    harmony: {
      presets: [
        ["andalusian", 0.5],
        ["minor-ii-v", 0.5],
      ],
    },
    texture: {
      roles: {
        bell: null,
        perc: null,
        kick: null,
        chords: role("piano"),
        lead: role("violin", "clarinet:0.3"),
      },
    },
  }),
  card({
    id: "tango",
    summary:
      "tango: marcato in four (every beat accented) alternating with the 3+3+2 sincopa, bandoneon and violins, harmonic minor i-iv-V7, arrastre",
    meter: { grouping: null },
    tempo: { bpm: [100, 128], typical: 116 },
    harmony: {
      presets: null,
      forms: [
        [["i", "iv", "V7", "i"], 0.5],
        [["i", "V7", "V7", "i"], 0.25],
        [["iv", "i", "V7", "i"], 0.25],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: { onsets: { chords: grid("x...x...x...x...") } },
    bass: { behaviour: [["root-fifth", 1]], onsets: grid("x...x...x...x...") },
    texture: {
      roles: {
        chords: role("reeds", "piano:0.6"),
        bass: role("doublebass"),
        lead: role("reeds", "violin:0.7"),
      },
    },
    expression: { dynamics: [0.35, 1] },
  }),
  card({
    id: "milonga",
    summary:
      "milonga: habanera-derived 3+3+2 in 2/4, guitar or bandoneon on the tresillo, quick major and minor I-V7",
    tempo: { bpm: [100, 140], typical: 120 },
    pitch: {
      scales: [
        ["major", 0.5],
        ["harmonic-minor", 0.5],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "V7", "V7", "I"], 0.5],
        [["i", "V7", "V7", "i"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    bass: { onsets: tl("tresillo") },
    texture: {
      roles: {
        chords: role("nylon", "reeds:0.5"),
        bass: role("doublebass"),
        lead: role("reeds", "sing:0.5"),
      },
    },
  }),
  card({
    id: "nuevo-tango",
    summary:
      "nuevo tango: 3+3+2 ostinatos, fugal counterpoint between bandoneon and violin, extended and chromatic harmony, jazz-like sevenths",
    tempo: { bpm: [110, 150], typical: 128 },
    harmony: {
      presets: [
        ["minor-ii-v", 0.6],
        ["andalusian", 0.4],
      ],
      sevenths: 0.7,
      rhythm: [
        [1, 0.5],
        [0.5, 0.5],
      ],
    },
    bass: { behaviour: [["ostinato", 1]], onsets: tl("tresillo") },
    melody: { intervals: LEAPY, density: [2, 3] },
    texture: {
      kind: "polyphonic",
      roles: {
        chords: role("piano"),
        bass: role("doublebass"),
        lead: role("reeds"),
        counter: role("violin", "cello:0.5"),
      },
    },
  }),
  card({
    id: "electrotango",
    summary:
      "electrotango: tango harmonic minor over a four-on-the-floor kick and off-beat hats, bandoneon hooks, synth pad",
    tempo: { bpm: [110, 126], typical: 118 },
    meter: { grouping: null },
    rhythm: {
      onsets: {
        kick: tl("fourFloor"),
        hat: tl("offbeats"),
        snare: grid("....x.......x..."),
        pad: grid("x..............."),
      },
    },
    bass: { behaviour: [["root", 1]], onsets: tl("tresillo") },
    texture: {
      roles: {
        kick: { required: true, voices: [kit("syn909")] },
        hat: { required: false, voices: [kit("syn909")] },
        snare: { required: true, voices: [kit("syn909")] },
        pad: maybe("saw"),
        chords: role("piano"),
        bass: role("bass"),
        lead: role("reeds"),
      },
    },
  }),
  card({
    id: "chacarera",
    summary:
      "chacarera and zamba: 6/8 against 3/4 alternation, bombo legüero on the dotted beats with rim answers, guitar strum, major and minor",
    meter: { signatures: [["6/8", 1]], grouping: null },
    tempo: { bpm: [90, 115], typical: 100 },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["i", "iv", "V7", "i"], 0.5],
        [["I", "IV", "V7", "I"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        kick: tl("sixEight12"),
        rim: grid("..x.x...x.x."),
        chords: tl("threeFour12"),
      },
    },
    bass: { onsets: tl("sixEight12") },
    texture: {
      roles: {
        kick: role("drums"),
        rim: role("drums"),
        snare: null,
        hat: null,
        chords: role("acoustic"),
        bass: role("acoustic"),
        lead: role("sing", "violin:0.5"),
      },
    },
  }),
  card({
    id: "chamame",
    summary:
      "chamame: Litoral accordion and guitar in ternary 6/8 with 3/4 superimposed, melody doubled in parallel thirds, major",
    meter: { signatures: [["6/8", 1]], grouping: null },
    tempo: { bpm: [95, 125], typical: 108 },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV", "V7", "I"], 0.6],
        [["I", "V7"], 0.4],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: { onsets: { chords: grid("x.x.x.x.x.x.") } },
    bass: { onsets: tl("threeFour12") },
    texture: {
      roles: {
        chords: role("acoustic"),
        bass: role("acoustic"),
        lead: role("reeds"),
        counter: maybe("reeds"),
      },
    },
  }),
  card({
    id: "guarania",
    summary:
      "guarania and polca paraguaya: slow 3/4 guarania with Paraguayan harp arpeggios, minor and plaintive; polca adds 6/8 hemiola",
    meter: { signatures: [["3/4", 1]], grouping: null },
    tempo: { bpm: [60, 90], typical: 74 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["major", 0.4],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["i", "iv", "V7", "i"], 0.6],
        [["i", "VI", "V7", "i"], 0.4],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: { onsets: { chords: grid("x.x.x.x.x.x.") } },
    bass: { onsets: grid("x.......x...") },
    texture: {
      roles: {
        chords: role("harp"),
        bass: role("acoustic"),
        lead: role("sing", "harp:0.5"),
      },
    },
    expression: { dynamics: [0.3, 0.7] },
  }),
  card({
    id: "candombe",
    summary:
      "candombe: Montevideo drum line, chico on a fixed 16th cell, repique, piano drum bass, sticks on the shell playing the 3-2 madera clave",
    tempo: { bpm: [100, 130], typical: 114 },
    meter: { grouping: null },
    pitch: {
      scales: [
        ["minor", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: { model: "modal", presets: null, rhythm: [[2, 1]] },
    rhythm: {
      onsets: {
        bell: tl("sonClave32"),
        perc: grid(".xx..xx..xx..xx."),
        kick: grid("x.....x.x.....x."),
        chords: null,
      },
    },
    bass: { behaviour: [["pedal", 1]], onsets: grid("x.....x.x.....x.") },
    melody: { intervals: CHANT, repetition: 0.6 },
    texture: {
      kind: "interlocking",
      roles: {
        bell: role("bell"),
        perc: role("framedrum"),
        kick: role("drums"),
        chords: null,
        bass: role("timpani"),
        lead: role("sing", "choir:0.4"),
      },
    },
  }),
  card({
    id: "murga",
    summary:
      "murga: Uruguayan carnival chorus over bombo, platillo and redoblante in a marcha camion, choral lead, major",
    tempo: { bpm: [100, 130], typical: 116 },
    meter: { grouping: null },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.5],
        ["axis", 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x......."),
        snare: grid("..x.x.x...x.x.xx"),
        hat: grid("....x.......x..."),
      },
    },
    texture: {
      kind: "homophonic",
      roles: {
        kick: role("drums"),
        snare: role("drums"),
        hat: role("drums"),
        chords: role("acoustic"),
        lead: role("choir"),
      },
    },
  }),
  card({
    id: "cueca",
    summary:
      "cueca and tonada: Chilean 6/8 sesquialtera with handclaps on the dotted beats, guitar, harp and accordion; tonada slower and strophic",
    meter: { signatures: [["6/8", 1]], grouping: null },
    tempo: { bpm: [120, 160], typical: 138 },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "IV", "V7", "I"], 0.6],
        [["I", "V7"], 0.4],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        clap: tl("sixEight12"),
        chords: tl("threeFour12"),
      },
    },
    bass: { onsets: tl("sixEight12") },
    texture: {
      roles: {
        clap: role("drums"),
        chords: role("acoustic", "harp:0.4"),
        bass: role("acoustic"),
        lead: role("sing", "reeds:0.4"),
      },
    },
  }),
  card({
    id: "nueva-cancion",
    summary:
      "nueva cancion: protest song, guitar, charango and quena, Andean pentatonic colour on folk forms, strophic verses, minor",
    tempo: { bpm: [80, 112], typical: 94 },
    meter: { grouping: null },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["minor-pentatonic", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["aeolian", 0.5],
        ["andalusian", 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        chords: grid("x.xxx.xxx.xxx.xx"),
      },
    },
    form: {
      plans: [[["intro", "verse", "chorus", "verse", "chorus", "outro"], 1]],
    },
    texture: {
      roles: {
        kick: maybe("drums"),
        chords: role("nylon", "tres:0.5"),
        bass: role("nylon"),
        lead: role("sing", "flute:0.4"),
      },
    },
  }),

  // --- Brazil. References: Sandroni (2001); Chris McGowan and Ricardo
  // Pessanha, "The Brazilian Sound" (2009).
  card({
    id: "brazil",
    abstract: true,
    summary:
      "Brazilian: samba 2/4 surdo on two, partido-alto syncopation, bossa harmony",
    groove: { swingRatio: [1, 1.15] },
    rhythm: {
      onsets: {
        kick: grid("....x.......x..."),
        perc: grid("x.xx.x.x..xx.x.x"),
        shaker: grid("xxxxxxxxxxxxxxxx"),
      },
    },
    harmony: { sevenths: 0.7 },
    texture: {
      roles: {
        bell: null,
        shaker: maybe("drums"),
        chords: role("nylon", "piano:0.4"),
        lead: role("flute", "sing:0.6"),
      },
    },
  }),
  card({
    id: "samba",
    summary:
      "samba: 2/4 with surdo accent on two, tamborim teleco-teco on the partido alto, pandeiro sixteenths, cavaquinho comp, major ii-V and secondary dominants",
    tempo: { bpm: [92, 130], typical: 104 },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "VI7", "ii7", "V7"], 0.5],
        [["ii7", "V7", "I", "I"], 0.5],
      ],
    },
    rhythm: {
      onsets: {
        bell: tl("partidoAlto"),
        chords: tl("partidoAlto"),
      },
    },
    bass: { onsets: grid("x...x...x...x...") },
    texture: {
      roles: {
        bell: role("bell"),
        chords: role("requinto", "nylon:0.6"),
        bass: role("nylon"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "pagode",
    summary:
      "pagode: backyard samba with banjo and tanta, repique de mao, relaxed tempo, romantic ii-V-I harmony with major sevenths",
    tempo: { bpm: [84, 104], typical: 94 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["minor", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["ii-v-i", 0.6],
        ["turnaround", 0.4],
      ],
      sevenths: 0.8,
    },
    rhythm: {
      onsets: { chords: tl("partidoAlto"), perc: grid("x.xxx.x.x.xxx.x.") },
    },
    texture: {
      roles: {
        chords: role("banjo", "requinto:0.5"),
        bass: role("ebass"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "choro",
    summary:
      "choro: instrumental rondo, flute or bandolim in running sixteenths, seven-string guitar baixaria counter-lines, chromatic secondary dominants",
    tempo: { bpm: [80, 120], typical: 100 },
    groove: { swingRatio: [1, 1.1] },
    pitch: {
      scales: [
        ["major", 0.6],
        ["harmonic-minor", 0.4],
      ],
    },
    harmony: {
      forms: [
        [["I", "III7", "vi", "II7", "ii", "V7", "I", "I"], 0.5],
        [["i", "V7", "V7", "i", "IV7", "iv", "V7", "i"], 0.5],
      ],
      sevenths: 0.5,
    },
    rhythm: { onsets: { kick: null, chords: grid("x.xx.x.xx.xx.x.x") } },
    bass: {
      behaviour: [["walking", 1]],
      walk: { chordToneOnOne: 0.9, chromaticApproach: 0.4 },
    },
    melody: {
      intervals: LEAPY,
      density: [3, 4],
      phraseBars: [
        [4, 0.6],
        [8, 0.4],
      ],
    },
    form: {
      plans: [[["verse", "verse", "chorus", "verse", "bridge", "verse"], 1]],
      archetype: "rondo",
    },
    texture: {
      kind: "polyphonic",
      roles: {
        kick: null,
        chords: role("requinto", "nylon:0.5"),
        bass: role("nylon"),
        lead: role("flute", "clarinet:0.4"),
        counter: maybe("nylon"),
      },
    },
  }),
  card({
    id: "bossa-nova",
    summary:
      "bossa nova: violao thumb on the beats against the bossa clave (son clave with its last stroke on 13), ii-V-I with tritone substitution, maj7 and 9 chords, soft voice",
    tempo: { bpm: [56, 80], typical: 68 },
    groove: { swingRatio: [1, 1.05] },
    pitch: {
      scales: [
        ["major", 0.6],
        ["dorian", 0.2],
        ["minor", 0.2],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["Imaj7", "bII7", "ii7", "V7"], 0.3],
        [["ii7", "V7", "Imaj7", "Imaj7"], 0.3],
        [["Imaj7", "VI7", "ii7", "bII7"], 0.2],
        [["i", "iv", "bVII7", "bIIImaj7"], 0.2],
      ],
      sevenths: 0.95,
      voicing: {
        types: [
          ["shell", 0.5],
          ["close", 0.5],
        ],
        range: [50, 72],
        notes: [3, 4],
      },
    },
    rhythm: {
      onsets: {
        kick: null,
        bell: tl("bossaClave"),
        perc: null,
        shaker: grid("x.x.x.x.x.x.x.x."),
        chords: tl("bossaClave"),
      },
    },
    bass: { onsets: grid("x.....x.x.....x.") },
    texture: {
      roles: {
        kick: null,
        perc: null,
        bell: maybe("bell"),
        chords: role("nylon"),
        bass: role("nylon", "doublebass:0.5"),
        lead: role("sing", "flute:0.4"),
      },
    },
    expression: { dynamics: [0.25, 0.6] },
  }),
  card({
    id: "mpb",
    summary:
      "MPB: post-bossa song, samba and baiao rhythms under pop forms, rich sevenths and modal interchange, verse-chorus",
    tempo: { bpm: [80, 115], typical: 96 },
    pitch: {
      scales: [
        ["major", 0.5],
        ["mixolydian", 0.25],
        ["dorian", 0.25],
      ],
    },
    harmony: {
      presets: [
        ["ii-v-i", 0.4],
        ["axis", 0.3],
        ["mixolydian-rock", 0.3],
      ],
      sevenths: 0.7,
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x..x...."),
        snare: grid("....x.......x..."),
        chords: tl("partidoAlto"),
      },
    },
    texture: {
      roles: {
        snare: role("drums"),
        chords: role("nylon", "epiano:0.5"),
        bass: role("ebass"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "tropicalia",
    summary:
      "tropicalia: psychedelic rock meets samba and baiao, straight rock kit with eighth hats, fuzz guitar and organ, mixolydian I-bVII and modal collage",
    tempo: { bpm: [95, 130], typical: 112 },
    pitch: { scales: [["mixolydian", 1]] },
    harmony: {
      presets: [
        ["mixolydian-rock", 0.6],
        ["fifties", 0.4],
      ],
      sevenths: 0.3,
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x......."),
        snare: grid("....x.......x..."),
        hat: grid("x.x.x.x.x.x.x.x."),
        perc: null,
      },
    },
    texture: {
      roles: {
        snare: role("drums"),
        hat: role("drums"),
        perc: null,
        chords: role("electric@crunch", "organ:0.5"),
        bass: role("ebass"),
        lead: role("sing", "electric@crunch:0.4"),
      },
    },
  }),
  card({
    id: "forro",
    summary:
      "forro and baiao: zabumba bass on one and the and of two, triangle on the off-beats, accordion in mixolydian with raised fourth (lydian dominant colour)",
    tempo: { bpm: [100, 140], typical: 118 },
    pitch: {
      scales: [
        ["mixolydian", 0.7],
        ["major", 0.3],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["I", "bVII", "IV", "I"], 0.5],
        [["I", "IV", "V7", "I"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x.x.....x."),
        perc: grid("..x...x...x...x."),
        shaker: tl("offbeats"),
        chords: grid("x.xx.xx.x.xx.xx."),
      },
    },
    bass: { onsets: grid("x.....x.x.....x.") },
    texture: {
      roles: {
        kick: role("drums"),
        perc: role("framedrum"),
        shaker: role("bell"),
        chords: role("reeds"),
        bass: role("ebass"),
        lead: role("reeds", "sing:0.6"),
      },
    },
  }),
  card({
    id: "frevo",
    summary:
      "frevo and maracatu: Recife carnival march at speed, brass and saxes in counterpoint, snare drive; maracatu alfaia and gongue bells",
    tempo: { bpm: [130, 170], typical: 150 },
    pitch: {
      scales: [
        ["major", 0.7],
        ["minor", 0.3],
      ],
    },
    harmony: {
      presets: [
        ["turnaround", 0.5],
        ["fifties", 0.5],
      ],
      sevenths: 0.4,
    },
    rhythm: {
      onsets: {
        kick: grid("x...x...x...x..."),
        snare: grid("x.xxx.xxx.xxx.xx"),
        bell: grid("x..x..x.x.x.x..."),
      },
    },
    melody: { intervals: LEAPY, density: [2, 4] },
    texture: {
      kind: "polyphonic",
      roles: {
        snare: role("drums"),
        bell: maybe("bell"),
        chords: role("trombone", "horn:0.5"),
        bass: role("tuba", "bass:0.5"),
        lead: role("trumpet", "altosax:0.6"),
        counter: role("tenorsax", "trombone:0.6"),
      },
    },
  }),
  card({
    id: "axe",
    summary:
      "axe and samba-reggae: Salvador bloco surdos in a reggae-like interlock, timbau slaps, carnival pop hooks in major",
    tempo: { bpm: [100, 130], typical: 116 },
    pitch: {
      scales: [
        ["major", 0.8],
        ["mixolydian", 0.2],
      ],
    },
    harmony: {
      presets: [
        ["axis", 0.5],
        ["fifties", 0.5],
      ],
    },
    rhythm: {
      onsets: {
        kick: grid("x.....x...x....."),
        snare: grid("....x..x....x..x"),
        perc: grid("..x.x..x..x.x..x"),
      },
    },
    texture: {
      kind: "interlocking",
      roles: {
        snare: role("drums"),
        chords: role("electric", "square:0.4"),
        bass: role("ebass"),
        lead: role("sing"),
      },
    },
  }),
  card({
    id: "carimbo",
    summary:
      "carimbo and lambada: Para curimbo drums, maracas, banjo and sax in a swaying 2/4; lambada adds guitarrada and synths",
    tempo: { bpm: [110, 140], typical: 122 },
    pitch: {
      scales: [
        ["major", 0.5],
        ["minor", 0.5],
      ],
    },
    harmony: {
      presets: null,
      forms: [
        [["i", "iv", "V7", "i"], 0.5],
        [["I", "V7"], 0.5],
      ],
      rhythm: [[1, 1]],
    },
    rhythm: {
      onsets: {
        kick: grid("x..x..x.x..x..x."),
        perc: grid("..x...xx..x...xx"),
        shaker: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        kick: role("drums"),
        perc: role("framedrum"),
        shaker: role("drums"),
        chords: role("banjo", "electric:0.5"),
        bass: role("ebass"),
        lead: role("sax", "sing:0.6"),
      },
    },
  }),
  card({
    id: "sertanejo",
    summary:
      "sertanejo and caipira: viola caipira strum, duo singing in parallel thirds, I-IV-V7 country harmony, guarania and toada lilts",
    tempo: { bpm: [80, 120], typical: 96 },
    pitch: {
      scales: [
        ["major", 0.9],
        ["minor", 0.1],
      ],
    },
    harmony: {
      presets: [
        ["fifties", 0.4],
        ["axis", 0.6],
      ],
      sevenths: 0.2,
    },
    rhythm: {
      onsets: {
        kick: grid("x.......x......."),
        snare: grid("....x.......x..."),
        perc: null,
        chords: grid("x.x.x.x.x.x.x.x."),
      },
    },
    texture: {
      roles: {
        snare: role("drums"),
        perc: null,
        chords: role("steel"),
        bass: role("ebass"),
        lead: role("sing"),
        counter: role("sing"),
      },
    },
  }),
  card({
    id: "brega",
    summary:
      "brega and tecnobrega: sentimental Para pop over drum machines, four-on-the-floor kick, keyboard leads, minor ballad changes",
    tempo: { bpm: [120, 150], typical: 132 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["major", 0.4],
      ],
    },
    harmony: {
      presets: [
        ["sad-pop", 0.6],
        ["axis", 0.4],
      ],
      sevenths: 0.2,
    },
    rhythm: {
      onsets: {
        kick: tl("fourFloor"),
        snare: grid("....x.......x..."),
        hat: tl("offbeats"),
        perc: null,
      },
    },
    texture: {
      roles: {
        kick: { required: true, voices: [kit("electro")] },
        snare: { required: true, voices: [kit("electro")] },
        hat: { required: false, voices: [kit("electro")] },
        perc: null,
        chords: role("square"),
        bass: role("bass"),
        lead: role("sing", "saw:0.5"),
      },
    },
  }),
  card({
    id: "baile-funk",
    summary:
      "baile funk: the tamborzao (3+3+2 kick with syncopated hand-drum hits) from the Miami-bass 808, one-chord minor chant",
    tempo: { bpm: [125, 150], typical: 130 },
    pitch: {
      scales: [
        ["minor", 0.6],
        ["phrygian", 0.4],
      ],
    },
    harmony: { model: "modal", presets: null, rhythm: [[4, 1]] },
    rhythm: {
      onsets: {
        kick: tl("tresillo"),
        snare: grid("....x..x....x..."),
        perc: grid("...x..x....x.x.."),
        shaker: null,
      },
    },
    bass: { behaviour: [["root", 1]], onsets: tl("tresillo"), kickLock: 0.9 },
    melody: { intervals: CHANT, ambitus: [3, 7], repetition: 0.8 },
    texture: {
      roles: {
        kick: { required: true, voices: [kit("syn808")] },
        snare: { required: true, voices: [kit("syn808")] },
        perc: role("drums"),
        shaker: null,
        chords: maybe("square"),
        bass: role("bass"),
        lead: role("sing"),
      },
    },
    mix: { loudness: "loud" },
  }),
  card({
    id: "capoeira",
    summary:
      "capoeira: berimbau ostinato (low, high and buzz tones), pandeiro and atabaque, ladainha then call-and-response corridos, drone",
    tempo: { bpm: [80, 130], typical: 100 },
    pitch: {
      scales: [
        ["mixolydian", 0.5],
        ["major", 0.5],
      ],
    },
    harmony: { model: "drone", presets: null, forms: null },
    rhythm: {
      onsets: {
        kick: null,
        perc: grid("x.x...x.x.x...x."),
        shaker: grid("x.xxx.xxx.xxx.xx"),
        chords: null,
      },
    },
    bass: { behaviour: [["ostinato", 1]], onsets: grid("x.x...x.......x.") },
    melody: { intervals: CHANT, ambitus: [5, 9], repetition: 0.7 },
    texture: {
      kind: "monophonic",
      roles: {
        kick: null,
        perc: role("framedrum"),
        shaker: role("drums"),
        chords: null,
        bass: role("pluck"),
        lead: role("sing", "choir:0.5"),
      },
    },
  }),
]);
