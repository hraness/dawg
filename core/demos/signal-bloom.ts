/** Signal Bloom: the synth pop demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import type { NoteInput } from "../score.ts";
import {
  Composer,
  hall,
  lanes,
  orbit,
  preset,
  room,
  voice,
  type Phrase,
} from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

/*
 * Arranged from a synth-pop style sheet (LinnDrum and DX-era records, Kate
 * Bush, Tears for Fears, Depeche Mode, CHVRCHES, The Weeknd): a gated Linn
 * snare on 2 and 4 with a clap 15 ms behind it, dry kick and swung hats,
 * an octave-pulse bass in the chorus, 4-note arpeggios, a pre-chorus whose
 * bass climbs D-E-F-G, a VI-VII-i chorus that pushes into the VII with the
 * singer, a half-time tom bridge that turns to E major, and a final chorus
 * where the double sings a third above. Every lyric is original.
 */

// Voicings sit between F3 and B4 so the singer owns the octave above them.
const AM9 = [57, 60, 64, 67, 71],
  FMAJ9 = [53, 57, 60, 64, 67],
  CADD9 = [55, 60, 62, 64, 67],
  G_B = [55, 59, 62, 67],
  DM7 = [57, 60, 62, 65],
  EM7 = [55, 59, 62, 64, 67],
  FMAJ7 = [57, 60, 64, 65],
  GSUS4 = [55, 60, 62, 67],
  G = [55, 59, 62, 67],
  FADD9 = [57, 60, 65, 67],
  AM7 = [57, 60, 64, 67],
  C_G = [55, 60, 64, 67],
  DM9 = [57, 60, 64, 65],
  AM_C = [57, 60, 64, 69],
  ESUS4 = [57, 59, 64, 69],
  E = [56, 59, 64, 68],
  E7 = [56, 59, 62, 64],
  G6 = [55, 59, 62, 64];
// Bass roots in the A1..E2 octave; the chorus pulse adds the octave above.
const A = 33,
  B = 35,
  C = 36,
  D = 38,
  EB = 40,
  F = 29,
  GB = 31;

type Harmony = readonly [
  voicing: readonly number[],
  root: number,
  /** A second chord from beat 2 (suspension resolving). */
  then?: readonly number[],
];
const VERSE: readonly Harmony[] = [
  [AM9, A],
  [FMAJ9, F],
  [CADD9, C],
  [G_B, B],
];
const PRE: readonly Harmony[] = [
  [DM7, D],
  [EM7, EB],
  [FMAJ7, F],
  [GSUS4, GB, G],
];
const CHORUS: readonly Harmony[] = [
  [FADD9, F],
  [G, GB],
  [AM7, A],
  [C_G, GB],
];
const POST: readonly Harmony[] = [
  [FADD9, F],
  [G, GB],
  [AM7, A],
  [AM7, A],
];
const BRIDGE: readonly Harmony[] = [
  [DM9, D],
  [AM_C, C],
  [FMAJ7, F],
  [ESUS4, EB, E],
  [DM9, D],
  [AM_C, C],
  [FMAJ7, F],
  [E7, EB],
];
const OUTRO: readonly Harmony[] = [
  [FADD9, F],
  [G6, GB],
  [AM9, A],
  [AM9, A],
];

type Part =
  "intro" | "pulse" | "verse" | "pre" | "chorus" | "post" | "bridge" | "outro";
const partOf = (bar: number): Part =>
  bar < 4
    ? "intro"
    : bar < 8
      ? "pulse"
      : bar < 16
        ? "verse"
        : bar < 20
          ? "pre"
          : bar < 28
            ? "chorus"
            : bar < 32
              ? "post"
              : bar < 40
                ? "bridge"
                : bar < 44
                  ? "verse"
                  : bar < 48
                    ? "pre"
                    : bar < 56
                      ? "chorus"
                      : bar < 60
                        ? "post"
                        : "outro";
const harmonyAt = (bar: number): Harmony => {
  const part = partOf(bar);
  if (part === "bridge") return BRIDGE[(bar - 32) % 8]!;
  const table =
    part === "pre"
      ? PRE
      : part === "chorus"
        ? CHORUS
        : part === "post"
          ? POST
          : part === "outro"
            ? OUTRO
            : VERSE;
  return table[bar % 4]!;
};

// The glass riff: one head, four tails that land on each pair of chords.
const RIFF_HEAD: Phrase = [
  [0, 76, 0.4, 0.74],
  [0.5, 72, 0.4, 0.56],
  [1, 74, 0.4, 0.62],
  [1.5, 76, 0.9, 0.72],
  [2.5, 79, 0.4, 0.66],
  [3, 76, 0.4, 0.58],
  [3.5, 74, 0.4, 0.6],
];
const riff = (tail: readonly (readonly [number, number])[]): Phrase => [
  ...RIFF_HEAD,
  [4, tail[0]![1], 0.9, 0.7],
  [5, tail[1]![1], 0.4, 0.56],
  [5.5, tail[2]![1], 0.4, 0.6],
  [6, tail[3]![1], 1.8, 0.66],
];
const RIFF_AM_F = riff([
  [4, 72],
  [5, 74],
  [5.5, 72],
  [6, 69],
]);
const RIFF_C_G = riff([
  [4, 74],
  [5, 71],
  [5.5, 72],
  [6, 67],
]);
const RIFF_F_G = riff([
  [4, 74],
  [5, 71],
  [5.5, 74],
  [6, 79],
]);
const RIFF_AM = riff([
  [4, 72],
  [5, 71],
  [5.5, 72],
  [6, 69],
]);

// Verse: syllabic, about one note per beat, inside a ninth (C4..C5).
const LATE_NIGHT: Phrase = [
  [0.5, 64, 0.45, 0.62, "Late"],
  [1.5, 67, 0.45, 0.68, "night"],
  [2.5, 64, 0.4, 0.56, "and"],
  [3, 62, 0.4, 0.54, "the"],
  [3.5, 60, 0.45, 0.6, "ci"],
  [4, 62, 0.45, 0.58, "ty"],
  [4.5, 64, 1.9, 0.68, "hums"],
];
const STATIC_WHERE: Phrase = [
  [0.5, 67, 0.45, 0.64, "stat"],
  [1, 64, 0.45, 0.56, "ic"],
  [1.5, 67, 0.45, 0.62, "where"],
  [2, 69, 0.4, 0.58, "your"],
  [2.5, 69, 0.9, 0.72, "voice"],
  [3.5, 67, 0.45, 0.6, "comes"],
  [4.5, 62, 1.8, 0.64, "from"],
];
const WINDOW_WIDE: Phrase = [
  [0.5, 64, 0.45, 0.62, "I"],
  [1, 67, 0.45, 0.64, "keep"],
  [1.5, 69, 0.45, 0.6, "the"],
  [2, 72, 0.45, 0.74, "win"],
  [2.5, 71, 0.45, 0.62, "dow"],
  [3, 69, 0.45, 0.62, "o"],
  [3.5, 67, 0.45, 0.58, "pen"],
  [4.5, 69, 1.9, 0.7, "wide"],
];
const LIGHT_OUTSIDE: Phrase = [
  [0.5, 67, 0.45, 0.64, "wait"],
  [1, 64, 0.45, 0.56, "ing"],
  [1.5, 62, 0.45, 0.56, "for"],
  [2, 64, 0.4, 0.58, "a"],
  [2.5, 67, 0.9, 0.72, "light"],
  [3.5, 64, 0.45, 0.6, "out"],
  [4.5, 62, 1.6, 0.64, "side"],
];
const words = (shape: Phrase, lyric: readonly string[]): Phrase =>
  shape.map(([beat, pitch, length, velocity], i) => [
    beat,
    pitch,
    length,
    velocity,
    lyric[i],
  ]);
const TURNS_TO_GOLD = words(LATE_NIGHT, [
  "Now",
  "the",
  "stat",
  "ic",
  "turns",
  "to",
  "gold",
]);
const COLOR_I_HOLD = words(STATIC_WHERE, [
  "ev",
  "ery",
  "col",
  "or",
  "I",
  "can",
  "hold",
]);

// Pre-chorus: sixteenth syncopation and a climb to a held D5 over the
// suspended V, written from the bar before (beat 3.5 is the pickup).
const FLICKER: Phrase = [
  [3.5, 65, 0.4, 0.6, "Ev"],
  [4, 65, 0.4, 0.6, "ery"],
  [4.75, 67, 0.4, 0.66, "flick"],
  [5.25, 69, 0.4, 0.64, "er"],
  [5.75, 69, 0.4, 0.62, "on"],
  [6.25, 67, 0.4, 0.6, "the"],
  [6.75, 69, 2.6, 0.74, "line"],
];
const COMING_THROUGH = (
  first: string,
  fifth: string,
  sixth: string,
): Phrase => [
  [2.5, 67, 0.45, 0.62, first],
  [3, 69, 0.45, 0.66, "I"],
  [3.5, 72, 0.75, 0.74, "feel"],
  [4.75, 69, 0.4, 0.64, "you"],
  [5.25, 72, 0.4, 0.7, fifth],
  [5.75, 72, 0.4, 0.68, sixth],
  [6.25, 74, 3.2, 0.8, "through"],
];

// Chorus: the highest part of the song (G4..E5), pushing "bloom" an eighth
// ahead of the VII chord so the band and the singer land together.
const SIGNAL: Phrase = [
  [0, 72, 0.7, 0.84, "Send"],
  [0.75, 69, 0.25, 0.64, "me"],
  [1, 72, 0.45, 0.72, "your"],
  [1.5, 76, 0.7, 0.9, "sig"],
  [2.25, 74, 0.25, 0.68, "nal"],
  [2.5, 72, 0.45, 0.7, "let"],
  [3, 69, 0.45, 0.66, "it"],
  [3.5, 74, 2.6, 0.84, "bloom"],
];
const INTO_THE_ROOM: Phrase = [
  [0, 72, 0.45, 0.78, "out"],
  [0.5, 71, 0.25, 0.6, "of"],
  [0.75, 69, 0.25, 0.58, "the"],
  [1, 72, 0.45, 0.74, "stat"],
  [1.5, 69, 0.45, 0.62, "ic"],
  [2.5, 69, 0.45, 0.68, "in"],
  [3, 67, 0.45, 0.64, "to"],
  [3.5, 64, 0.45, 0.6, "the"],
  [4, 67, 2.4, 0.74, "room"],
];
const LIGHT_UP: Phrase = [
  [0, 76, 0.7, 0.88, "light"],
  [0.75, 74, 0.25, 0.66, "up"],
  [1, 72, 0.45, 0.7, "the"],
  [1.5, 74, 0.45, 0.74, "win"],
  [2, 72, 0.45, 0.68, "dow"],
  [2.5, 76, 0.45, 0.86, "light"],
  [3, 74, 0.45, 0.72, "up"],
  [3.5, 71, 0.45, 0.66, "the"],
  [4, 72, 2.9, 0.8, "room"],
];

// Bridge: lower, longer notes over half-time drums, turning to E major.
const LIGHTS_GO_OUT: Phrase = [
  [1, 62, 0.45, 0.56, "If"],
  [1.5, 64, 0.45, 0.58, "the"],
  [2, 65, 0.9, 0.66, "lights"],
  [3, 64, 0.45, 0.58, "go"],
  [3.5, 62, 0.45, 0.58, "out"],
  [4, 64, 0.45, 0.6, "to"],
  [4.5, 60, 2.4, 0.64, "night"],
];
const FADES_TO_WHITE: Phrase = [
  [1, 65, 0.45, 0.58, "and"],
  [1.5, 67, 0.45, 0.6, "the"],
  [2, 69, 0.9, 0.7, "sig"],
  [3, 67, 0.45, 0.6, "nal"],
  [3.5, 65, 0.45, 0.6, "fades"],
  [4, 64, 0.45, 0.62, "to"],
  [4.5, 64, 1.4, 0.66, "white"],
  [6, 68, 1.8, 0.68, "oh"],
];
const BY_YOUR_LIGHT: Phrase = [
  [1, 69, 0.45, 0.64, "I"],
  [1.5, 69, 0.45, 0.64, "will"],
  [2, 72, 0.9, 0.76, "find"],
  [3, 71, 0.45, 0.66, "you"],
  [3.5, 69, 0.45, 0.64, "by"],
  [4, 71, 0.45, 0.66, "your"],
  [4.5, 72, 2.4, 0.78, "light"],
];
const BRIDGE_CRY: Phrase = [
  [0.5, 76, 1.4, 0.76, "oh"],
  [2, 74, 0.45, 0.64],
  [2.5, 72, 0.45, 0.62],
  [3, 71, 0.9, 0.64],
  [4, 68, 2.6, 0.68, "oh"],
];

export const signalBloom: DemoDefinition = {
  info: demoInfo({
    id: "signal-bloom",
    title: "Signal Bloom",
    style: "Synth pop",
    description:
      "A synth-pop song in A minor: gated Linn snare, octave-pulse bass and glass arpeggios carry an original sung hook through a climbing pre-chorus, a half-time tom bridge and a final chorus with a harmony double.",
    tempoBpm: 108,
    key: "Am",
    bars: 64,
    highlightBar: 20,
    trackId: "vocal",
    features: [
      "gated Linn snare with a late clap",
      "original sung hook",
      "octave-pulse analog bass",
      "sequenced arpeggios",
      "climbing pre-chorus",
      "half-time tom bridge",
      "harmony double",
      "original vocal chops",
      "wavetable halo",
    ],
    arrangement: [
      "Glass intro 4",
      "Pulse 4",
      "Verse 8",
      "Prechorus 4",
      "Chorus 8",
      "Signal 4",
      "Bridge 8",
      "Verse return 4",
      "Second lift 4",
      "Final chorus 8",
      "Bloom 4",
      "Last light 4",
    ],
    mixNotes: [
      "Only the snare gets ambience, a short gated room; the kick and hats stay dry and the kick alone ducks the bass, chords and halo.",
      "Chords sit below B4 with a stereo chorus, so the singer owns the octave above; the double sings a third higher, quieter and panned, only in the last chorus.",
      "The arpeggio moves an octave up whenever the singer rests, the glass riff is kept for the intro and post-choruses, and chops answer in the gaps after each held word.",
    ],
  }),
  build() {
    const s = new Composer(signalBloom.info);
    for (const [name, start, bars] of [
      ["Glass intro", 0, 4],
      ["Pulse", 4, 4],
      ["Verse", 8, 8],
      ["Prechorus", 16, 4],
      ["Chorus", 20, 8],
      ["Signal", 28, 4],
      ["Bridge", 32, 8],
      ["Verse return", 40, 4],
      ["Second lift", 44, 4],
      ["Final chorus", 48, 8],
      ["Bloom", 56, 4],
      ["Last light", 60, 4],
    ] as const)
      s.section(name, start, bars);

    s.track(
      voice("kick", "Linn kick", "kit", 0.64, {
        kit: "synlinn",
        fx: { duck: { orbit: 2, depth: 0.3, attack: 0.16 } },
        humanize: { timing: 2, velocity: 3, seed: 11 },
      }),
    );
    s.track(
      voice("snare", "Gated snare", "kit", 0.48, {
        kit: "synlinn",
        reverb: {
          mix: 0.34,
          size: 0.5,
          predelay: 0.01,
          lowpass: 7000,
          ir: { src: "builtin:gate" },
        },
        humanize: { timing: 4, velocity: 4, seed: 12 },
      }),
    );
    s.track(
      voice("hats", "Linn hats", "kit", 0.56, {
        kit: "synlinn",
        pan: 0.2,
        humanize: { timing: 5, velocity: 7, seed: 13 },
      }),
    );
    s.track(
      voice("perc", "Toms, clap & crash", "kit", 0.4, {
        kit: "synlinn",
        pan: -0.16,
        reverb: { ...room, mix: 0.16 },
        humanize: { timing: 5, velocity: 5, seed: 14 },
      }),
    );
    s.track(
      preset("bass", "Analog bass", "moog-bass", 0.5, {
        fx: orbit,
        humanize: { timing: 3, velocity: 4, length: 6, seed: 15 },
      }),
    );
    s.track(
      voice("chords", "Warm polysynth", "saw", 0.48, {
        fx: { ...orbit, chorus: { rate: 0.55, depth: 0.5, mix: 0.45 } },
        synth: {
          attack: 0.06,
          decay: 0.3,
          sustain: 0.62,
          release: 0.4,
          lpf: 2400,
          detune: 0.1,
        },
        reverb: room,
        humanize: { timing: 6, velocity: 4, seed: 16 },
        filterAutomation: lanes(
          [0, 700],
          [7, 1100],
          [8, 1000],
          [15, 1500],
          [16, 1300],
          [19.9, 3400],
          [20, 3600],
          [31, 3300],
          [32, 1000],
          [39, 2000],
          [40, 1200],
          [44, 1400],
          [47.9, 3800],
          [48, 4200],
          [59, 4600],
          [60, 2600],
          [63.9, 600],
        ),
      }),
    );
    s.track(
      preset("arp", "Glass arpeggio", "pulse-seq", 0.3, {
        pan: -0.24,
        delay: { beats: 0.75, feedback: 0.3, mix: 0.2, pingpong: true },
        filter: { type: "hpf", cutoff: 220, resonance: 0 },
        humanize: { timing: 2, velocity: 5, seed: 18 },
      }),
    );
    s.track(
      preset("hook", "Glass hook", "fm-bells", 0.34, {
        pan: 0.22,
        delay: { beats: 0.75, feedback: 0.28, mix: 0.18, pingpong: true },
        reverb: room,
        humanize: { timing: 4, velocity: 5, seed: 17 },
      }),
    );
    s.track(
      voice("vocal", "Signal singer", "sing", 0.8, {
        sing: {
          preset: "aah",
          voice: "alto",
          articulate: 1,
          breath: 0.12,
          jitter: 0.14,
          vib: 5,
          vibmod: 0.08,
          ring: 0.15,
        },
        reverb: { ...hall, mix: 0.16, predelay: 0.03 },
        delay: { beats: 0.75, feedback: 0.2, mix: 0.1, pingpong: true },
        filter: { type: "hpf", cutoff: 150, resonance: 0 },
        humanize: { timing: 9, velocity: 4, length: 4, seed: 19 },
      }),
    );
    s.track(
      voice("double", "Harmony double", "sing", 0.2, {
        pan: -0.26,
        sing: { preset: "choir", vowel: "o", breath: 0.2 },
        reverb: hall,
        filter: { type: "hpf", cutoff: 240, resonance: 0 },
        humanize: { timing: 14, velocity: 5, seed: 20 },
      }),
    );
    s.track(
      voice("stay", "Stay chop", "sampler", 0.24, {
        pan: -0.3,
        sampler: {
          mode: "keyed",
          voices: {
            stay: {
              ...bundledSampleRef("stay-up"),
              begin: 0,
              end: 0.25,
              fadeTime: 0.012,
            },
          },
        },
        delay: { beats: 0.75, feedback: 0.24, mix: 0.18, pingpong: true },
        reverb: room,
        filter: { type: "hpf", cutoff: 180, resonance: 0 },
        humanize: { timing: 4, velocity: 5, seed: 21 },
      }),
    );
    s.track(
      voice("up", "Up reply", "sampler", 0.25, {
        pan: 0.3,
        sampler: {
          mode: "keyed",
          voices: {
            up: {
              ...bundledSampleRef("stay-up"),
              begin: 0.25,
              end: 0.5,
              fadeTime: 0.012,
            },
          },
        },
        delay: { beats: 0.5, feedback: 0.26, mix: 0.14, pingpong: true },
        reverb: room,
        filter: { type: "hpf", cutoff: 180, resonance: 0 },
        humanize: { timing: 4, velocity: 5, seed: 22 },
      }),
    );
    s.track(
      voice("halo", "Wavetable halo", "wavetable", 0.2, {
        wavetable: {
          table: { src: "builtin:basic" },
          wt: 0.19,
          wtrate: 0.18,
          wtdepth: 0.1,
        },
        synth: { attack: 0.7, release: 1.4, lpf: 2600 },
        filter: { type: "hpf", cutoff: 330, resonance: 0 },
        fx: { ...orbit, chorus: { rate: 0.3, depth: 0.6, mix: 0.5 } },
        wtAutomation: lanes(
          [0, 0.08],
          [19, 0.16],
          [27, 0.3],
          [32, 0.1],
          [39, 0.24],
          [48, 0.22],
          [59, 0.42],
          [63, 0.05],
        ),
        pan: 0.08,
        reverb: hall,
      }),
    );
    // Risers sweep a high-passed noise bed up into each arrival.
    const risers = [3, 19, 31, 39, 47, 55];
    s.track(
      voice("lift", "Breath lifts", "white", 0.09, {
        synth: { attack: 0.5, release: 0.08 },
        reverb: hall,
        filter: { type: "hpf", cutoff: 1800, resonance: 0.1 },
        filterAutomation: lanes(
          [0, 900],
          ...risers.flatMap(
            (bar) =>
              [
                [bar, 900],
                [bar + 0.97, 7200],
                [bar + 1, 1200],
              ] as const,
          ),
          [62, 1600],
          [63.9, 5200],
        ),
      }),
    );

    const note = (
      track: string,
      bar: number,
      beat: number,
      pitch: number,
      length: number,
      velocity: number,
      extra: Partial<NoteInput> = {},
    ) => s.note(track, bar, beat, pitch, length, velocity, extra);
    const sing = (bar: number, phrase: Phrase, track = "vocal", gain = 1) => {
      for (const [beat, pitch, length, velocity = 0.7, lyric] of phrase) {
        const extra: Partial<NoteInput> = {};
        if (lyric) Object.assign(extra, { lyric });
        // Held words bloom into vibrato; stressed words scoop up from below.
        if (length >= 1.4)
          Object.assign(extra, {
            vibrato: { rate: 5.2, depth: 22, delay: 0.32 },
          });
        if (velocity >= 0.8 && track === "vocal")
          Object.assign(extra, {
            bend: [
              { at: 0, cents: -70 },
              { at: 0.14, cents: 0 },
            ],
          });
        note(track, bar, beat, pitch, length, velocity * gain, extra);
      }
    };
    const chord = (
      bar: number,
      beat: number,
      voicing: readonly number[],
      length: number,
      velocity: number,
    ) => s.chord("chords", bar, beat, voicing, length, velocity);

    // ---- Drums --------------------------------------------------------
    const kick = (bar: number, hits: readonly (readonly [number, number])[]) =>
      hits.forEach(([beat, velocity]) =>
        note("kick", bar, beat, 36, 0.2, velocity),
      );
    // The gated snare sits 5 ms late for weight; the clap trails it by 15 ms.
    const backbeat = (
      bar: number,
      beats: readonly number[],
      clap: boolean,
      gain = 1,
    ) =>
      beats.forEach((beat) => {
        note(
          "snare",
          bar,
          beat + 0.01,
          38,
          0.2,
          Math.min(1, (beat === 3 ? 0.94 : 0.9) * gain),
        );
        if (clap) note("perc", bar, beat + 0.027, 39, 0.2, 0.64);
      });
    const roll = (bar: number, from: number, to: number, low: number) => {
      const steps = Math.round((to - from) * 4);
      for (let i = 0; i < steps; i++)
        note(
          "snare",
          bar,
          from + i / 4,
          38,
          0.12,
          low + ((0.96 - low) * i) / Math.max(1, steps - 1),
        );
    };
    // Sixteenth hats with on-beat accents and a 55% swing on the offs.
    const HAT_16 = [
      0.6, 0.26, 0.44, 0.3, 0.56, 0.26, 0.44, 0.32, 0.6, 0.26, 0.44, 0.3, 0.56,
      0.28, 0.46, 0.36,
    ];
    const hats = (bar: number, mode: "8" | "16" | "open" | "soft") => {
      for (let i = 0; i < 16; i++) {
        const offbeat8 = i % 4 === 2,
          beat = i / 4 + (i % 2 ? 0.025 : 0);
        if (mode === "8" && i % 2) {
          if (i === 15 && bar % 2) note("hats", bar, beat, 42, 0.1, 0.3);
          continue;
        }
        if (mode === "soft" && i % 2) continue;
        if (mode === "open" && offbeat8) {
          note("hats", bar, beat, 46, 0.4, 0.5);
          continue;
        }
        const scale = mode === "soft" ? 0.62 : mode === "8" ? 1.08 : 1;
        note("hats", bar, beat, 42, 0.1, HAT_16[i]! * scale);
      }
    };
    const crash = (bar: number, velocity: number) =>
      note("perc", bar, 0, 49, 2, velocity);
    const toms = (bar: number, hits: readonly (readonly number[])[]) =>
      hits.forEach(([beat, pitch, velocity]) =>
        note("perc", bar, beat!, pitch!, 0.25, velocity!),
      );
    const FILL_SHORT = [
      [3, 48, 0.72],
      [3.25, 47, 0.6],
      [3.5, 45, 0.66],
      [3.75, 43, 0.62],
    ];
    const FILL_LONG = [
      [2, 50, 0.78],
      [2.25, 48, 0.58],
      [2.5, 48, 0.66],
      [2.75, 47, 0.58],
      [3, 45, 0.72],
      [3.25, 45, 0.58],
      [3.5, 43, 0.7],
      [3.75, 41, 0.66],
    ];
    const TOM_RIDE = [
      [0, 45, 0.62],
      [0.75, 43, 0.44],
      [1.5, 45, 0.5],
      [2.5, 41, 0.56],
      [3.25, 43, 0.46],
    ];

    for (let b = 0; b < 64; b++) {
      const part = partOf(b),
        odd = b % 2 === 1,
        phraseEnd = b % 4 === 3;
      if (part === "intro") {
        if (b === 3)
          toms(b, [
            [3, 45, 0.5],
            [3.5, 43, 0.62],
          ]);
      } else if (part === "pulse") {
        kick(b, [
          [0, 0.9],
          [2, 0.82],
        ]);
        hats(b, "soft");
        note("perc", b, 1, 37, 0.1, 0.42);
        note("perc", b, 3, 37, 0.1, 0.46);
        if (b === 7) toms(b, FILL_SHORT);
      } else if (part === "verse") {
        const stripped = b === 40 || b === 41;
        kick(b, [
          [0, 0.92],
          [1.5, 0.66],
          [2, 0.84],
          ...(odd ? ([[3.5, 0.6]] as const) : []),
        ]);
        if (stripped) {
          note("perc", b, 1, 37, 0.1, 0.5);
          note("perc", b, 3, 37, 0.1, 0.54);
          hats(b, "soft");
        } else {
          backbeat(b, [1, 3], false, b < 12 ? 0.82 : 0.88);
          if (odd) note("snare", b, 3.75, 38, 0.1, 0.2);
          hats(b, "8");
        }
        if (b === 8 || b === 40) crash(b, 0.5);
        if (b === 15) toms(b, FILL_LONG.slice(2));
        if (b === 43) toms(b, FILL_SHORT);
      } else if (part === "pre") {
        const last = b === 19 || b === 47,
          first = b === 16 || b === 44;
        kick(
          b,
          last
            ? [
                [0, 0.92],
                [1, 0.8],
                [2, 0.86],
                [3, 0.84],
              ]
            : [
                [0, 0.92],
                [2, 0.86],
                [3.5, 0.64],
              ],
        );
        if (last) {
          backbeat(b, [1], false);
          roll(b, 2, b === 47 ? 3.5 : 4, 0.3);
        } else if (b % 4 < 2) backbeat(b, [2], false);
        else backbeat(b, [1, 3], false);
        hats(b, b % 4 < 2 ? "8" : "16");
        if (first) crash(b, 0.42);
        if (last) toms(b, [[3, 45, 0.5]]);
      } else if (part === "chorus" || part === "post") {
        kick(b, [
          [0, 0.95],
          [1, 0.8],
          [2, 0.9],
          [3, 0.8],
          ...(phraseEnd ? ([[3.5, 0.6]] as const) : []),
        ]);
        backbeat(b, [1, 3], true, part === "chorus" ? 1.05 : 1);
        hats(b, part === "post" && !odd ? "16" : "open");
        if (b % 4 === 0) crash(b, b === 20 || b === 48 ? 0.85 : 0.6);
        if (b === 27 || b === 55) toms(b, FILL_SHORT);
        if (b === 31 || b === 59) toms(b, FILL_LONG);
      } else if (part === "bridge") {
        // The first half is a breakdown: one kick, the toms and the snare.
        kick(
          b,
          b < 36
            ? [[0, 0.8]]
            : [
                [0, 0.9],
                [1.5, 0.54],
                [2.5, 0.5],
              ],
        );
        backbeat(b, [2], false, b < 36 ? 0.88 : 0.96);
        if (b === 32) crash(b, 0.55);
        if (b >= 36) hats(b, "soft");
        toms(b, b === 39 ? TOM_RIDE.slice(0, 3) : TOM_RIDE);
        if (b === 39) {
          roll(b, 3, 4, 0.36);
          toms(b, [
            [2.5, 47, 0.6],
            [3, 45, 0.66],
          ]);
        }
      } else if (b === 60 || b === 61) {
        kick(b, [[0, b === 60 ? 0.84 : 0.66]]);
        hats(b, "soft");
        if (b === 60) crash(b, 0.5);
      }
    }

    // ---- Harmony: bass, chords, arpeggio, halo -------------------------
    const OCTAVE_PULSE = [0.86, 0.58, 0.72, 0.58, 0.82, 0.58, 0.72, 0.62];
    const ROOT_PULSE = [0.78, 0.46, 0.6, 0.46, 0.72, 0.46, 0.62, 0.52];
    for (let b = 0; b < 64; b++) {
      const part = partOf(b),
        [voicing, root, then] = harmonyAt(b),
        next = b < 63 ? harmonyAt(b + 1) : harmonyAt(b);
      // Chorus pushes: the VII arrives an eighth early with the word "bloom".
      const push = part === "chorus" && b % 4 === 0 ? next[1] : undefined;

      // Bass
      if (part === "pulse" || part === "verse") {
        ROOT_PULSE.forEach((velocity, i) => {
          const octave = part === "verse" && i === 7 && b % 2 === 1;
          note(
            "bass",
            b,
            i / 2,
            root + (octave ? 12 : 0),
            i % 2 ? 0.28 : 0.36,
            velocity * (part === "pulse" ? 0.82 : b < 12 ? 0.86 : 0.92),
          );
        });
      } else if (part === "pre") {
        const last = b === 19 || b === 47;
        for (let i = 0; i < 8; i++) {
          if (b === 47 && i === 7) break;
          note(
            "bass",
            b,
            i / 2,
            root + (last && i >= 6 ? 12 : 0),
            0.42,
            ROOT_PULSE[i]! * (0.9 + (b % 4) * 0.04),
          );
        }
      } else if (part === "chorus" || part === "post") {
        OCTAVE_PULSE.forEach((velocity, i) => {
          const bass = push !== undefined && i === 7 ? push : root;
          note("bass", b, i / 2, bass + (i % 2 ? 12 : 0), 0.4, velocity);
        });
      } else if (part === "bridge") {
        note("bass", b, 0, root, 3.3, b < 36 ? 0.62 : 0.74);
        note("bass", b, 3.5, b === 39 ? A : root + 12, 0.4, b < 36 ? 0.5 : 0.6);
      } else if (b >= 60) {
        if (b < 62) note("bass", b, 0, root, 3.8, 0.74);
        else if (b === 62) note("bass", b, 0, A, 7.8, 0.7);
      }

      // Chords
      const level =
        part === "intro"
          ? 0.4
          : part === "pulse"
            ? 0.44
            : part === "verse"
              ? b < 12
                ? 0.38
                : 0.44
              : part === "bridge"
                ? b < 36
                  ? 0.4
                  : 0.5
                : part === "chorus"
                  ? b >= 48
                    ? 0.7
                    : 0.64
                  : 0.58;
      if (part === "pre") {
        // Off-beat stabs build momentum under the climbing bass.
        for (let i = 0; i < 8; i++) {
          if (b === 47 && i === 7) break;
          const chordNow = then && i >= 4 ? then : voicing;
          chord(
            b,
            i / 2,
            chordNow,
            i % 2 ? 0.3 : 0.4,
            (i % 2 ? 0.5 : 0.42) + (b % 4) * 0.04,
          );
        }
      } else if (part === "outro") {
        if (b < 62) chord(b, 0, voicing, 3.85, 0.5);
        else if (b === 62) chord(b, 0, AM9, 7.8, 0.46);
      } else if (then) {
        chord(b, 0, voicing, 1.9, level);
        chord(b, 2, then, 1.9, level);
      } else if (push !== undefined) {
        chord(b, 0, voicing, 3.4, level);
      } else {
        const pushed = part === "chorus" && b % 4 === 1;
        chord(b, pushed ? -0.5 : 0, voicing, pushed ? 4.4 : 3.85, level);
      }

      // Arpeggio: 4-note runs, an octave up whenever the singer rests.
      const high = ["intro", "post", "bridge", "outro"].includes(part);
      const tones = [...voicing]
        .sort((x, y) => x - y)
        .slice(0, 4)
        .map((p) => p + (high ? 12 : 0));
      // Verse 1 opens with no arpeggio; the bridge starts in eighths and
      // doubles back to sixteenths for its second half.
      const sixteenths =
        part === "pulse" ||
        part === "pre" ||
        part === "chorus" ||
        part === "post" ||
        (part === "bridge" && b >= 36);
      const arpGain =
        part === "bridge"
          ? b < 36
            ? 0.46
            : 0.44 + (b - 36) * 0.05
          : part === "post"
            ? 0.6
            : part === "pre"
              ? 0.44 + (b % 4) * 0.05
              : part === "chorus"
                ? 0.5
                : part === "verse"
                  ? 0.36
                  : 0.5;
      if (!(b >= 62) && !(b === 47) && !(b >= 8 && b < 12)) {
        const steps = sixteenths ? 16 : 8;
        for (let i = 0; i < steps; i++) {
          const beat = (i * 4) / steps,
            chordNow = then && beat >= 2 ? then : voicing,
            arp =
              then && beat >= 2
                ? [...chordNow]
                    .sort((x, y) => x - y)
                    .slice(0, 4)
                    .map((p) => p + (high ? 12 : 0))
                : tones;
          note(
            "arp",
            b,
            beat,
            arp[i % 4]!,
            sixteenths ? 0.2 : 0.4,
            arpGain * (i % 4 === 0 ? 1 : 0.72),
          );
        }
      }
      if (b === 47)
        for (let i = 0; i < 14; i++)
          note(
            "arp",
            b,
            i / 4,
            tones[i % 4]! + (i >= 8 ? 12 : 0),
            0.2,
            0.4 + i * 0.025,
          );
      if (b === 62)
        [0, 1, 2, 3, 4, 5, 6, 7].forEach((i) =>
          note("arp", b, i / 2, AM9[i % 5]! + 12, 0.45, 0.5 - i * 0.04),
        );

      // Halo: the wavetable shimmer opens only at the peaks.
      if (
        (part === "chorus" && b % 4 === 0) ||
        (part === "post" && b % 4 === 0) ||
        (part === "bridge" && b % 4 === 0) ||
        b === 0 ||
        b === 60
      ) {
        const top = [...voicing]
          .sort((x, y) => x - y)
          .slice(-3)
          .map((p) => p + 12);
        s.chord(
          "halo",
          b,
          0,
          top,
          b === 60 ? 15.5 : 15.6,
          part === "chorus" ? 0.5 : 0.44,
        );
      }
    }

    // ---- Glass riff and chorus answers -------------------------------
    s.phrase("hook", 0, RIFF_AM_F, 0, 0.92);
    s.phrase("hook", 2, RIFF_C_G, 0, 0.96);
    for (const bar of [28, 56]) {
      s.phrase("hook", bar, RIFF_F_G);
      s.phrase("hook", bar + 2, RIFF_AM);
    }
    s.phrase("hook", 60, RIFF_F_G, 0, 0.78);
    s.phrase(
      "hook",
      62,
      [
        [0, 76, 0.4, 0.6],
        [0.5, 72, 0.4, 0.5],
        [1, 74, 0.4, 0.52],
        [1.5, 69, 6.2, 0.58],
      ],
      0,
      1,
    );
    // After "room" the bells cascade down; chorus 2 adds a high answer.
    for (const bar of [23, 27, 51, 55]) {
      s.phrase(
        "hook",
        bar,
        [
          [2.5, 79, 0.25, 0.56],
          [2.75, 76, 0.25, 0.5],
          [3, 72, 0.25, 0.52],
          [3.25, 74, 0.5, 0.56],
        ],
        0,
        bar >= 48 ? 1.08 : 1,
      );
    }

    // ---- Vocal ---------------------------------------------------------
    sing(8, LATE_NIGHT);
    sing(10, STATIC_WHERE);
    sing(12, WINDOW_WIDE);
    sing(14, LIGHT_OUTSIDE);
    sing(15, FLICKER);
    sing(15, COMING_THROUGH("I", "com", "ing"));
    for (const bar of [20, 48]) {
      sing(bar, SIGNAL);
      sing(bar + 2, INTO_THE_ROOM);
      sing(bar + 4, SIGNAL);
      sing(bar + 6, LIGHT_UP);
    }
    sing(32, LIGHTS_GO_OUT);
    sing(34, FADES_TO_WHITE);
    sing(36, BY_YOUR_LIGHT);
    sing(38, BRIDGE_CRY);
    sing(40, TURNS_TO_GOLD);
    sing(42, COLOR_I_HOLD);
    sing(43, FLICKER);
    sing(43, COMING_THROUGH("now", "break", "ing"));
    // Bloom: the title phrase twice, the second reaching the top E.
    sing(56, [
      [0.5, 72, 0.4, 0.66, "let"],
      [1, 69, 0.4, 0.6, "it"],
      [1.5, 74, 2.2, 0.76, "bloom"],
    ]);
    sing(58, [
      [0.5, 72, 0.4, 0.68, "let"],
      [1, 71, 0.4, 0.62, "it"],
      [1.5, 76, 2.4, 0.82, "bloom"],
    ]);
    sing(60, [
      [0.5, 64, 0.45, 0.56, "light"],
      [1, 67, 0.45, 0.56, "up"],
      [1.5, 69, 0.45, 0.56, "the"],
      [2, 69, 5.6, 0.6, "room"],
    ]);

    // ---- Final-chorus double: a third above on the long words ----------
    const THIRD_ABOVE_SIGNAL: Phrase = [
      [0, 76, 0.7, 0.52],
      [1.5, 79, 0.7, 0.56],
      [3.5, 77, 2.6, 0.54],
    ];
    sing(48, THIRD_ABOVE_SIGNAL, "double");
    sing(
      50,
      [
        [0, 76, 0.45, 0.5],
        [1, 76, 0.45, 0.5],
        [4, 72, 2.4, 0.52],
      ],
      "double",
    );
    sing(52, THIRD_ABOVE_SIGNAL, "double");
    sing(
      54,
      [
        [0, 79, 0.7, 0.56],
        [2.5, 79, 0.45, 0.54],
        [4, 76, 2.9, 0.56],
      ],
      "double",
    );
    // Bloom and last light: a rising "oh" line behind the title.
    sing(
      56,
      [
        [0, 69, 3.8, 0.44],
        [4, 71, 3.8, 0.46],
        [8, 72, 3.8, 0.48],
        [12, 76, 3.8, 0.5],
        [16, 72, 3.8, 0.4],
        [20, 71, 3.8, 0.34],
      ],
      "double",
    );

    // ---- Chops answer the held words ----------------------------------
    const answer = (bar: number, stay: number, up: number, at = 2.5) => {
      note("stay", bar, at, stay, 0.35, 0.66);
      note("up", bar, at + 0.75, up, 0.32, 0.6);
    };
    for (const bar of [21, 25, 49, 53]) answer(bar, 67, 71);
    for (const bar of [17, 45]) answer(bar, 64, 67, 1.75);
    for (const bar of [28, 29, 30, 31, 56, 57, 58, 59]) {
      const [voicing] = harmonyAt(bar),
        top = Math.max(...voicing);
      note("stay", bar, 0.5, top, 0.3, 0.6);
      note("up", bar, 1.75, top + (bar % 2 ? 2 : 0), 0.3, 0.52);
      if (bar % 2) note("stay", bar, 3.25, top, 0.25, 0.5);
    }
    note("stay", 35, 3, 68, 0.35, 0.5);
    note("up", 39, 2.5, 68, 0.35, 0.5);

    // ---- Risers --------------------------------------------------------
    for (const bar of risers) note("lift", bar, 0, 60, 3.9, 0.62);
    note("lift", 62, 0, 60, 7.8, 0.4);

    return s.finish();
  },
};
