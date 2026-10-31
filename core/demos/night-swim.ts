/**
 * Night Swim: Balearic trance-pop in D major at 122. A chorused clean
 * guitar jangles in 16ths over a four-floor kick, swung shaker and a
 * rolling analog bass; the verses sit low in the singer's chest (A3 to F#4)
 * and the chorus lifts an octave, a low second voice answering "night swim"
 * from under the mix and two detuned doubles widening the hook. The break
 * turns to marimba and a squelching acid line, the bridge climbs G, A and
 * F#m over a D pedal, and the last chorus adds a choir and a whistled
 * counter-melody before the guitar plays out alone. Everything stays in
 * D major: no borrowed or chromatic notes. Free-form: the song is written
 * bar by bar on the composer, not on the kit engine. No key change.
 */
import { Composer, lanes, orbit, preset } from "./build.ts";
import {
  filterArc,
  bassLine,
  cell,
  chopTrack,
  dropout,
  grainTrack,
  hold,
  ladder,
  LAYER_COMP,
  LINE_LEAD,
  roll,
  slot,
  sounds,
  THROW_PEAK,
  throws,
  type Chord,
  type VoxBank,
  UNDER_WORDS,
  VOCAL_ECHO,
  vocalTrack,
} from "./hyperpop.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

export const BPM = 122;
const BARS = 84;

/** The vocal book: lines in beats (scripts/vox/songs.py night-swim-vox). */
/**
 * Lines that open on unstressed words start early, so those words are a
 * pickup and the first stressed syllable lands where the line used to
 * start (Hannah Diamond's lines start off the beat 75-80% of the time).
 */
const PICKUP: Readonly<Record<string, number>> = { v3: -0.25, v4: -0.5, br: -0.25 };

export const BOOK: VoxBank = {
  sample: "night-swim-vox",
  root: 62,
  syllables: ["swim", "night", "stay", "oh", "ah", "mm"],
  lines: {
    v1: 4,
    v2: 4,
    v3: 4,
    v4: 4,
    v5: 4,
    v6: 4,
    v7: 4,
    v8: 4,
    pre1: 4,
    pre2: 4,
    ch1: 8,
    ch2: 8,
    ch3: 8,
    ch4: 8,
    br: 8,
    echo: 4,
  },
};
/** Beat (from the line's downbeat) where each line's last word lands. */
const ENDS: Record<string, number> = {
  v1: 2,
  v2: 2.25,
  v3: 2.25,
  v4: 2,
  v5: 2,
  v6: 3,
  v7: 3,
  v8: 2,
  pre1: 1.75,
  pre2: 3,
  ch1: 3.25,
  ch2: 2.5,
  ch3: 3.75,
  ch4: 4.5,
  br: 3.25,
  echo: 0.75,
};

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
// Open voicings kept under the singer; ninths and sevenths for the haze.
const Gmaj9 = c(43, 54, 57, 59, 62);
const Fsm7 = c(42, 54, 57, 61, 64);
const Em9 = c(40, 54, 55, 59, 62);
const Asus = c(45, 55, 57, 62, 64);
const Bm7 = c(47, 54, 57, 59, 62);
const G = c(43, 55, 59, 62, 66);
const A = c(45, 52, 57, 61, 64);
// The chorus is plain triads (no seconds) so the jangle's arpeggio stays
// clean under the hook.
const Bm = c(47, 54, 59, 62, 66);
const Gadd = c(43, 55, 59, 62, 67);
const DoverFs = c(42, 54, 57, 62, 66);
// The bridge rides a D pedal under G, A and F#m, all inside D major.
const GoverD = c(38, 55, 59, 62, 67);
const AoverD = c(38, 57, 61, 64, 69);
const FsmOverD = c(38, 54, 57, 61, 64);
const D = c(38, 54, 57, 62, 66);
const VERSE = [Gmaj9, Fsm7, Em9, Asus];
const PRE = [Bm7, G, Bm7, A];
const CHORUS = [Bm, Gadd, DoverFs, A];
const BRIDGE = [GoverD, AoverD, FsmOverD, D];

type Kind =
  "intro" | "verse" | "pre" | "chorus" | "break" | "bridge" | "final" | "outro";
const SECTIONS: readonly (readonly [string, Kind, number, number])[] = [
  ["Intro", "intro", 0, 8],
  ["Verse 1", "verse", 8, 8],
  ["Pre 1", "pre", 16, 4],
  ["Chorus 1", "chorus", 20, 8],
  ["Break", "break", 28, 8],
  ["Verse 2", "verse", 36, 8],
  ["Pre 2", "pre", 44, 4],
  ["Chorus 2", "chorus", 48, 8],
  ["Bridge", "bridge", 56, 8],
  ["Last chorus", "final", 64, 16],
  ["Outro", "outro", 80, 4],
];

const chordsFor = (kind: Kind): readonly Chord[] =>
  kind === "pre"
    ? PRE
    : kind === "chorus" || kind === "final"
      ? CHORUS
      : kind === "bridge"
        ? BRIDGE
        : VERSE;

// The jangle: 16th cells over the chord's tones from A3 up. Verses play
// sparse under a sung bar and answer in full in the bar after it.
const JANGLE = {
  intro: ["0.21.3.20.21.3.4", "0.21.3.24.3.2.1."],
  under: ["0...2...1...3...", "0...2..31...2..."],
  answer: ["0.21.3.24.3.2.1.", "4.3.2.3.0.21.3.5"],
  pre: ["0.0.2.0.3.0.2.0.", "0.0.2.0.3.0.4.5."],
  chorus: ["4.3.2.3.4.3.5.4.", "4.3.2.3.5.4.3.2."],
  bridge: ["0...1...2...3...", "2...1...0......."],
} as const;
// Bass steps over the root (0 root, 1 fifth, 2 octave). No flat seventh:
// over the G chords it would be an F natural.
const BASS = {
  intro: "0.......0.....2.",
  verse: "0.....2.0..1..2.",
  pre: "0.0.0.0.0.0.0.2.",
  chorus: "0..20..20..2012.",
  bridge: "0-------0-----1.",
} as const;
const ACID = ["0.20.2.10.2.0.12", "0.2.02.10.212.1.", "02.0.2.1-0.2.1.2"];

// The whistle's counter-melody over the last pass: long notes above the
// singer, on the chorus chords' upper tones.
const WHISTLE: readonly (readonly [number, number, number, number])[] = [
  [72, 0, 78, 1.4],
  [72, 1.5, 81, 2.4],
  [73, 0, 79, 3.4],
  [74, 0, 78, 1.4],
  [74, 1.5, 74, 2.4],
  [75, 0, 76, 3.4],
  [76, 0, 81, 1.4],
  [76, 1.5, 83, 2.4],
  [77, 0, 83, 1.9],
  [77, 2, 79, 1.9],
  [78, 0, 81, 2.9],
  [79, 0, 76, 3.8],
];

export const nightSwim: DemoDefinition = {
  info: demoInfo({
    id: "night-swim",
    title: "Night Swim",
    style: "Hyperpop",
    description:
      "Balearic trance-pop in D major at 122: a chorused guitar jangling in 16ths over a four-floor kick and rolling analog bass, a low, close verse that lifts an octave into the chorus, a low second voice answering from under the mix, detuned doubles on the chorus, a marimba and acid break, a bridge over a D pedal, and a last chorus with choir and whistled counter-melody.",
    tempoBpm: BPM,
    key: "D",
    bars: BARS,
    highlightBar: 20,
    trackId: "gtr",
    features: [
      "verses sung low in the chest, A3 to F#4, the chorus an octave up",
      "lines sung on speech rhythm with pickups, rests and one melisma",
      "a low second voice answering the chorus hook",
      "two doubles detuned a few cents either side widening the chorus",
      "a chorused clean guitar jangling 16ths, sparse under the words",
      "a marimba and acid-bass break between the choruses",
      "a bridge climbing G, A and F#m over a D pedal, all in key",
      "choir and a whistled counter-melody in the last chorus",
    ],
    arrangement: SECTIONS.map(([name, , , bars]) => `${name} ${bars}`),
    mixNotes: [
      "the singer sits dry and close in the verses and opens up on the chorus throws",
      "the low echo voice sits under the lead, darker and wider",
      "the chorus doubles sit hard left and right, 9 cents apart either side, through a chorus",
      "guitar and pads pump from the kick on orbit 2; the shaker stays loose",
      "the acid line's filter opens across the break and closes for the verse",
      "one beat of silence before the last chorus",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    // The lead 3 dB under the shelf's level: inside the water, not over it.
    const vox = vocalTrack(BOOK, 0.71);

    const echo = vocalTrack(BOOK, 0.8 * UNDER_WORDS, {
      id: "echo",
      fx: { compressor: LAYER_COMP },
      name: "Low echo",
      pan: -0.22,
      filter: { type: "lpf", cutoff: 3200, resonance: 0 },
      delay: { beats: 0.75, feedback: 0.45, mix: 0.22, pingpong: true },
      reverb: { mix: 0.3, size: 0.8, fade: 3, lowpass: 5000 },
    });
    // Chorus doubles: the same lines a few cents sharp and flat, panned wide
    // and a hair late, through a chorus. They never duck the bed.
    const double = (id: string, cents: number, pan: number, seed: number) =>
      vocalTrack(BOOK, 0.42 * UNDER_WORDS, {
        id,
        name: cents > 0 ? "Double high" : "Double low",
        pan,
        sampler: {
          mode: "oneshot",
          voices: Object.fromEntries(
            Object.entries(vox.sampler!.voices).map(([k, v]) => [
              k,
              { ...v, speed: 2 ** (cents / 1200) },
            ]),
          ),
        },
        filter: { type: "hpf", cutoff: 260, resonance: 0 },
        fx: {
          compressor: {
            threshold: -24,
            ratio: 4,
            attack: 0.004,
            release: 0.1,
            makeup: 8,
          },
          chorus: { rate: 0.9 + seed * 0.1, depth: 0.5, mix: 0.5 },
        },
        reverb: { mix: 0.22, size: 0.7, fade: 2.4, lowpass: 9000 },
      });
    const dblHi = double("dblhi", 9, -0.55, 1);
    const dblLo = double("dbllo", -9, 0.55, 2);
    for (const track of [
      sounds.kick(BPM, "syn909", 0.8, 0.26),
      sounds.snare(0.4, "syn909"),
      sounds.hats(0.3, "syn707", { name: "Shaker & hats" }),
      preset("bass", "Analog bass", "moog-bass", 0.26, {
        fx: { ...orbit },
        glide: { time: 0.06, mode: "legato" },
      }),
      preset("acid", "Acid line", "acid-squelch", 0.2, {
        pan: 0.12,
        filter: { type: "lpf", cutoff: 900, resonance: 0.2 },
        fx: { ...orbit },
        delay: { beats: 0.75, feedback: 0.35, mix: 0.12, pingpong: true },
      }),
      preset("gtr", "Jangle guitar", "clean-electric", 0.32, {
        pan: 0.18,
        filter: { type: "hpf", cutoff: 220, resonance: 0 },
        fx: { ...orbit, chorus: { rate: 0.7, depth: 0.55, mix: 0.45 } },
        delay: { beats: 0.75, feedback: 0.38, mix: 0.18, pingpong: true },
        reverb: { mix: 0.14, size: 0.5, fade: 1.6, lowpass: 7000 },
        humanize: { timing: 5, velocity: 7, seed: 51 },
      }),
      preset("pad", "PWM pad", "pwm-pad", 0.15, {
        filter: { type: "lpf", cutoff: 2200, resonance: 0.1 },
        fx: { ...orbit },
        reverb: { mix: 0.25, size: 0.8, fade: 3, lowpass: 6000 },
      }),
      preset("mar", "Marimba", "marimba", 0.3, {
        pan: -0.3,
        fx: { ...orbit },
        delay: { beats: 0.5, feedback: 0.3, mix: 0.16, pingpong: true },
        reverb: { mix: 0.14, size: 0.5, fade: 1.5 },
        humanize: { timing: 4, velocity: 6, seed: 52 },
      }),
      preset("choir", "Choir", "aah-choir", 0.3, {
        fx: { ...orbit },
        reverb: { mix: 0.3, size: 0.85, fade: 3.2, lowpass: 6000 },
      }),
      preset("whistle", "Whistle lead", "whistle-lead", 0.3, {
        pan: 0.25,
        glide: { time: 0.08, mode: "legato" },
        delay: { beats: 0.75, feedback: 0.4, mix: 0.2, pingpong: true },
        reverb: { mix: 0.22, size: 0.7, fade: 2.4 },
      }),
      vox,
      dblHi,
      dblLo,
      echo,
      chopTrack(BOOK, 1, { humanize: { timing: 5, velocity: 7, seed: 53 } }),
      grainTrack(BOOK, 0.45),
      preset("riser", "Riser", "noise-riser", 0.16),
      preset("impact", "Sub drop", "sub-drop", 0.3),
    ])
      s.track(track);

    const throwsAt: number[] = [];
    const sing = (id: string, part: string, bar: number, beat = 0, v = 0.9) => {
      beat += PICKUP[part] ?? 0;
      const track =
        id === "echo"
          ? echo
          : id === "dblhi"
            ? dblHi
            : id === "dbllo"
              ? dblLo
              : vox;
      s.note(
        id,
        bar,
        beat - LINE_LEAD,
        slot(track, part),
        BOOK.lines![part]! + LINE_LEAD,
        v,
      );
      if (id === "vox") throwsAt.push(bar + (beat + ENDS[part]!) / 4);
    };

    for (const [name, kind, start, bars] of SECTIONS) {
      s.section(name, start, bars);
      const chords = chordsFor(kind);
      for (let b = 0; b < bars; b++) {
        const bar = start + b;
        const ch = chords[b % chords.length]!;
        const odd = b % 2;
        const rungs = ladder(ch, 57, 86);

        // Guitar: in the verses it thins out under a sung bar.
        const jangle =
          kind === "intro" || kind === "outro"
            ? JANGLE.intro[odd]!
            : kind === "verse"
              ? odd
                ? JANGLE.answer[(b >> 1) % 2]!
                : JANGLE.under[(b >> 1) % 2]!
              : kind === "pre"
                ? JANGLE.pre[odd]!
                : kind === "bridge"
                  ? JANGLE.bridge[odd]!
                  : kind === "break"
                    ? b < 4
                      ? null
                      : JANGLE.under[odd]!
                    : JANGLE.chorus[odd]!;
        if (jangle && !(kind === "outro" && b === 3))
          cell(s, "gtr", bar, jangle, rungs, {
            velocity: kind === "chorus" || kind === "final" ? 0.72 : 0.62,
          });
        if (kind === "outro" && b === 3)
          cell(s, "gtr", bar, "0.21.3.2", rungs, { velocity: 0.6 });

        // Pad: a held chord every bar except the bare intro and outro.
        if (kind !== "outro" && !(kind === "intro" && b < 4))
          hold(s, "pad", bar, 0, ch.tones, 3.9, kind === "verse" ? 0.4 : 0.5);

        // Bass.
        const bass =
          kind === "intro"
            ? b >= 6
              ? BASS.intro
              : null
            : kind === "outro"
              ? null
              : kind === "verse" || kind === "break"
                ? BASS.verse
                : kind === "pre"
                  ? BASS.pre
                  : kind === "bridge"
                    ? BASS.bridge
                    : BASS.chorus;
        if (bass) bassLine(s, "bass", bar, bass, ch.bass, 0.8);

        // Acid: the break, quieter under the second verse, and the choruses.
        if (kind === "break" || kind === "chorus" || kind === "final")
          bassLine(s, "acid", bar, ACID[b % 3]!, ch.bass + 12, 0.75);
        if (kind === "verse" && start === 36 && odd)
          bassLine(s, "acid", bar, "....0.2.....2.1.", ch.bass + 12, 0.6);

        // Drums.
        const kick =
          kind === "intro"
            ? b >= 4
              ? "9...8...9...8..."
              : null
            : kind === "pre"
              ? b < 2
                ? "9.......9......."
                : "9...8...9...8..."
              : kind === "bridge"
                ? b < 4
                  ? null
                  : "7...6...7...6..."
                : kind === "outro"
                  ? null
                  : "9...8...9...8...";
        if (kick) s.grid("kick", bar, 36, kick);
        const shaker =
          kind === "chorus" || kind === "final"
            ? "4635463546354636"
            : kind === "outro"
              ? null
              : kind === "intro" && b < 2
                ? null
                : "3.4.3.453.4.3.45";
        if (shaker) s.grid("hats", bar, 42, shaker, 0.9, 0.035);
        if (kind === "chorus" || kind === "final" || kind === "break")
          s.grid("hats", bar, 46, "..6...6...6...6.", 0.8);
        if (kind === "chorus" || kind === "final")
          s.grid("snare", bar, 39, "....8.......8...");
        if (kind === "verse" || kind === "break")
          s.grid("hats", bar, 37, "....3.......3..4", 0.9);
        if (kind === "pre" && b === 3) roll(s, bar, 0.25, 0.8);

        // Marimba: the break's arp, then an echo of it in the bridge.
        if (kind === "break")
          cell(
            s,
            "mar",
            bar,
            odd ? "0.2.4.2.1.3.5.3." : "0.2.4.21.3.5.4.2",
            rungs,
            {
              velocity: 0.6,
            },
          );
        if (kind === "bridge" && b >= 4)
          cell(s, "mar", bar, "....2.4.....3.5.", rungs, { velocity: 0.5 });

        // Choir in the bridge and the second half of the last chorus.
        if (kind === "bridge" || (kind === "final" && b >= 8))
          hold(
            s,
            "choir",
            bar,
            0,
            ch.tones.map((p) => p + 12),
            3.9,
            0.45,
          );
      }
    }

    // Chops: a syllable riff through the break's second half.
    for (let bar = 32; bar < 36; bar++)
      cell(
        s,
        "chops",
        bar,
        bar % 2 ? "4..3..2..3..1..." : "2..4..5..4..3...",
        ladder(VERSE[bar % 4]!, 62, 86),
        { velocity: 0.7 },
      );
    // The held vowel as a cloud under the break and the bridge.
    for (const [bar, beats] of [
      [28, 32],
      [56, 32],
    ] as const)
      hold(s, "vgrain", bar, 0, [62, 69], beats, 0.5);

    // Vocals.
    const verse = (bar: number, lines: readonly string[]) =>
      lines.forEach((part, i) => sing("vox", part, bar + i * 2));
    verse(8, ["v1", "v2", "v3", "v4"]);
    verse(36, ["v5", "v6", "v7", "v8"]);
    for (const bar of [16, 44]) {
      sing("vox", "pre1", bar);
      sing("vox", "pre2", bar + 2);
    }
    for (const [bar, last] of [
      [20, "ch2"],
      [48, "ch2"],
      [64, "ch2"],
      [72, "ch4"],
    ] as const) {
      const lines = ["ch1", "ch2", "ch3", last] as const;
      lines.forEach((part, i) => {
        sing("vox", part, bar + i * 2);
        // The doubles land 12 and 20 ms late so they thicken, not flam.
        sing("dblhi", part, bar + i * 2, 0.025, 0.8);
        sing("dbllo", part, bar + i * 2, 0.04, 0.8);
      });
    }
    for (const bar of [27, 55, 71]) sing("echo", "echo", bar, 2, 0.85);
    sing("echo", "echo", 80, 1, 0.9);
    sing("vox", "br", 58, 0, 0.85);
    sing("echo", "br", 62, 0, 0.6);

    // Whistle counter-melody over the last pass.
    for (const [bar, beat, pitch, len] of WHISTLE)
      s.note("whistle", bar, beat, pitch, len, 0.6);

    // Builds: risers into each chorus, a sub drop on each landing.
    for (const bar of [18, 46, 62]) s.note("riser", bar, 0, 60, 8, 0.7);
    for (const bar of [20, 48, 64]) s.note("impact", bar, 0, 36, 2, 0.8);

    // One beat of silence before the last chorus.
    dropout(s, 63, 3, 1, [
      "kick",
      "snare",
      "hats",
      "bass",
      "acid",
      "gtr",
      "pad",
      "mar",
      "choir",
      "riser",
      "vgrain",
    ]);

    // Lanes: delay throws on the last word of every line; the acid opens
    // across the break; the pad follows the filter arc.
    const acidOpen = lanes(
      [0, 700],
      [20, 1200],
      [28, 600],
      [35.9, 3200],
      [36, 700],
      [48, 1400],
      [56, 900],
      [64, 1600],
      [80, 2600],
    );
    s.tracks.forEach((t, i) => {
      if (t.id === "vox")
        s.tracks[i] = {
          ...t,
          delayMixAutomation: throws(throwsAt, VOCAL_ECHO.mix, THROW_PEAK, 1),
        };
      if (t.id === "acid") s.tracks[i] = { ...t, filterAutomation: acidOpen };
      if (t.id === "pad")
        s.tracks[i] = {
          ...t,
          filterAutomation: filterArc(s.sections, 1300, 4200),
        };
    });
    return s.finish();
  },
};
