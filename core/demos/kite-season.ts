/**
 * Kite Season: seaside dream-pop in E major at 146, felt half-time. A combo
 * organ holds the chords under a slow breakbeat and a plucked bass; a dry,
 * low alto (G#3 to A4) sings the verses close and only climbs a few steps
 * for the chorus, a low male voice answering "higher" from under it. A
 * slide lead plays the hook between the verses, the bridge falls through
 * F#m7 to Bsus over a bloom pad, and the last chorus doubles the drums into a backbeat
 * under a fuzz-guitar wall and choir before everything stops on one organ
 * chord. Free-form: the song is written bar by bar on the composer, not on
 * the kit engine. No key change.
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
  LEAD_FX,
  LINE_LEAD,
  roll,
  slot,
  sounds,
  THROW_PEAK,
  throws,
  type Chord,
  type VoxBank,
  UNDER_WORDS,
  VOCAL_COMP,
  VOCAL_ECHO,
  vocalTrack,
} from "./hyperpop.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

export const BPM = 146;
const BARS = 74;

/** The vocal book: lines in beats (scripts/vox/songs.py kite-season-vox). */
/**
 * Lines that open on unstressed words start early, so those words are a
 * pickup and the first stressed syllable lands where the line used to
 * start (Hannah Diamond's lines start off the beat 75-80% of the time).
 */
const PICKUP: Readonly<Record<string, number>> = {
  v2: -0.25,
  v3: -0.5,
  v4: -0.5,
  v6: -0.25,
  v7: -0.5,
  ch4: -0.25,
  br: -0.25,
};

export const BOOK: VoxBank = {
  sample: "kite-season-vox",
  root: 64,
  syllables: ["high", "go", "kite", "oh", "ah", "mm"],
  lines: {
    v1: 8,
    v2: 8,
    v3: 8,
    v4: 8,
    v5: 8,
    v6: 8,
    v7: 8,
    v8: 8,
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
  v1: 4.5,
  v2: 5,
  v3: 4.5,
  v4: 4,
  v5: 3.5,
  v6: 3.5,
  v7: 4,
  v8: 4,
  ch1: 2.5,
  ch2: 3.5,
  ch3: 2,
  ch4: 3.5,
  br: 3.5,
  echo: 0.75,
};

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
// Organ voicings in the middle, sevenths and added ninths for the haze.
const Emaj7 = c(40, 52, 56, 59, 63);
const Csm7 = c(37, 52, 56, 59, 61);
const Fsm7 = c(42, 54, 57, 61, 64);
const Gsm7 = c(44, 54, 56, 59, 63);
const Aadd9 = c(45, 52, 57, 59, 61);
const EoverGs = c(44, 52, 56, 59, 64);
const Csm = c(37, 52, 56, 61, 64);
const B = c(47, 54, 59, 63, 66);
// The bridge stays in E major: C#m7, Amaj7, F#m7, Bsus.
const Amaj7 = c(45, 52, 56, 57, 61);
const Bsus = c(47, 54, 59, 64, 66);
const VERSE = [Emaj7, Csm7, Fsm7, Gsm7];
const CHORUS = [Aadd9, EoverGs, Csm, B];
const BRIDGE = [Csm7, Amaj7, Fsm7, Bsus];
const E = c(40, 52, 56, 59, 64);

type Kind = "intro" | "verse" | "chorus" | "inter" | "bridge" | "final" | "end";
const SECTIONS: readonly (readonly [string, Kind, number, number])[] = [
  ["Intro", "intro", 0, 8],
  ["Verse 1", "verse", 8, 8],
  ["Chorus 1", "chorus", 16, 8],
  ["Interlude", "inter", 24, 8],
  ["Verse 2", "verse", 32, 8],
  ["Chorus 2", "chorus", 40, 8],
  ["Bridge", "bridge", 48, 8],
  ["Last chorus", "final", 56, 16],
  ["End", "end", 72, 2],
];

const chordsFor = (kind: Kind): readonly Chord[] =>
  kind === "chorus" || kind === "final" || kind === "inter"
    ? CHORUS
    : kind === "bridge"
      ? BRIDGE
      : VERSE;

// Bass steps over the root (0 root, 1 fifth, 2 octave, 7 a tone below).
const BASS = {
  intro: "0.......0.......",
  verse: "0.......0..1....",
  chorus: "0...0.2.0...0.1.",
  bridge: "0-------0-------",
  final: "0.0.0.0.0.0.0.21",
} as const;

// The slide hook, four bars over the chorus chords: [bar, beat, pitch, beats].
const HOOK: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 76, 1.4],
  [0, 1.5, 73, 0.45],
  [0, 2, 71, 1.9],
  [1, 0, 68, 0.9],
  [1, 1, 71, 0.9],
  [1, 2, 76, 1.9],
  [2, 0, 80, 1.4],
  [2, 1.5, 78, 0.45],
  [2, 2, 76, 0.9],
  [2, 3, 73, 0.9],
  [3, 0, 75, 3.4],
];
// Its answer: the same opening, then up to B5 and home.
const HOOK2: readonly (readonly [number, number, number, number])[] = [
  ...HOOK.slice(0, 6),
  [2, 0, 80, 0.9],
  [2, 1, 83, 0.9],
  [2, 2, 80, 0.9],
  [2, 3, 78, 0.9],
  [3, 0, 78, 1.4],
  [3, 2, 75, 1.9],
];

export const kiteSeason: DemoDefinition = {
  info: demoInfo({
    id: "kite-season",
    title: "Kite Season",
    style: "Hyperpop",
    description:
      "Seaside dream-pop in E major at 146, felt half-time: a combo organ over a slow breakbeat and plucked bass, a dry low alto that barely climbs for the chorus, a low male voice answering under it, a slide-lead hook between the verses, a bridge that falls through F#m to a suspended B, and a last chorus that doubles into a backbeat under a fuzz wall before stopping dead on one chord.",
    tempoBpm: BPM,
    key: "E",
    bars: BARS,
    highlightBar: 16,
    trackId: "organ",
    features: [
      "a low alto, G#3 to A4, the chorus only a few steps above the verse",
      "lines written to the speech rhythm: pickups, held stressed vowels, rests",
      "a low male voice answering the hook from under the mix",
      "a combo organ holding the chords, a slide lead playing the hook",
      "half-time breakbeat that doubles into a backbeat for the last chorus",
      "a bridge on C#m7, Amaj7, F#m7 and Bsus over a bloom pad",
      "a fuzz-guitar wall and choir, then a dead stop on one organ chord",
    ],
    arrangement: SECTIONS.map(([name, , , bars]) => `${name} ${bars}`),
    mixNotes: [
      "the singer sits dry and forward; only the line ends throw to the delay",
      "the organ is the bed, the slide lead sits above the singer and to the side",
      "the drums barely pump; the break stays loose and roomy",
      "the fuzz wall comes in under the singer, filtered, and opens over the last pass",
      "two beats of silence before the last chorus; the song ends on a held chord",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    // The words about 5 dB over the bed where consonants live, and no
    // louder than the whole beat.
    const vox = vocalTrack(BOOK, 1, {
      fx: { ...LEAD_FX, compressor: { ...VOCAL_COMP, makeup: 17 } },
    });

    const echo = vocalTrack(BOOK, 0.8 * UNDER_WORDS, {
      id: "echo",
      fx: { compressor: LAYER_COMP },
      name: "Low answer",
      pan: 0.24,
      filter: { type: "lpf", cutoff: 3000, resonance: 0 },
      delay: { beats: 1, feedback: 0.4, mix: 0.22, pingpong: true },
      reverb: { mix: 0.32, size: 0.85, fade: 3.2, lowpass: 5000 },
    });
    for (const track of [
      sounds.kick(BPM, "acoustic", 0.45, 0.9),
      sounds.snare(
        1,
        "acoustic",
        { reverb: { mix: 0.22, size: 0.6, fade: 1.2 } },
        false,
      ),
      sounds.hats(1, "lofi", { name: "Hats & rim" }, 8),
      preset("bass", "Plucked bass", "pluck-bass", 0.16, {
        fx: { ...orbit },
      }),
      preset("sub", "Sub", "sub-sine", 0.15),
      preset("organ", "Combo organ", "combo-organ", 0.19, {
        filter: { type: "lpf", cutoff: 3200, resonance: 0.05 },
        fx: { ...orbit, chorus: { rate: 0.5, depth: 0.5, mix: 0.4 } },
        reverb: { mix: 0.24, size: 0.75, fade: 2.6, lowpass: 6000 },
      }),
      preset("lead", "Slide lead", "saw-lead", 0.28, {
        pan: -0.2,
        filter: { type: "lpf", cutoff: 2600, resonance: 0.1 },
        glide: { time: 0.12, mode: "legato" },
        delay: { beats: 0.75, feedback: 0.42, mix: 0.24, pingpong: true },
        reverb: { mix: 0.3, size: 0.85, fade: 3, lowpass: 7000 },
      }),
      preset("glock", "Glockenspiel", "glockenspiel", 0.43, {
        pan: 0.3,
        delay: { beats: 0.5, feedback: 0.35, mix: 0.2, pingpong: true },
        reverb: { mix: 0.25, size: 0.7, fade: 2 },
        humanize: { timing: 4, velocity: 6, seed: 61 },
      }),
      preset("fuzz", "Fuzz wall", "clean-electric", 0.07, {
        pan: 0.1,
        filter: { type: "lpf", cutoff: 2400, resonance: 0.05 },
        fx: {
          ...orbit,
          distort: { type: "hard", drive: 6, tone: 3200, mix: 0.8 },
          chorus: { rate: 0.4, depth: 0.5, mix: 0.35 },
        },
        reverb: { mix: 0.2, size: 0.7, fade: 2 },
        humanize: { timing: 6, velocity: 8, seed: 62 },
      }),
      preset("bloom", "Bloom pad", "bloom-pad", 0.18, {
        reverb: { mix: 0.3, size: 0.85, fade: 3.4, lowpass: 6000 },
      }),
      preset("choir", "Choir", "ooh-choir", 0.26, {
        fx: { ...orbit },
        reverb: { mix: 0.32, size: 0.85, fade: 3.2, lowpass: 6000 },
      }),
      vox,
      echo,
      chopTrack(BOOK, 1, { humanize: { timing: 5, velocity: 7, seed: 63 } }),
      grainTrack(BOOK, 0.4),
      preset("wind", "Sea wind", "wind-wash", 0.2),
      preset("riser", "Riser", "pitch-riser", 0.14),
      preset("fall", "Downlifter", "downlifter", 0.16),
      preset("impact", "Impact", "impact", 0.3),
    ])
      s.track(track);

    const throwsAt: number[] = [];
    const sing = (id: string, part: string, bar: number, beat = 0, v = 0.9) => {
      beat += PICKUP[part] ?? 0;
      const track = id === "echo" ? echo : vox;
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
    const lead = (
      at: number,
      line: readonly (readonly [number, number, number, number])[],
      shift = 0,
      v = 0.7,
    ) => {
      for (const [bar, beat, pitch, len] of line)
        s.note("lead", at + bar, beat, pitch + shift, len, v);
    };

    for (const [name, kind, start, bars] of SECTIONS) {
      s.section(name, start, bars);
      const chords = chordsFor(kind);
      for (let b = 0; b < bars; b++) {
        const bar = start + b;
        const ch = kind === "end" ? E : chords[b % chords.length]!;
        const odd = b % 2;

        // Organ: the bed, every bar but the end, which holds one chord.
        if (kind === "end") {
          if (b === 0) hold(s, "organ", bar, 0, E.tones, 7, 0.6);
        } else if (kind === "bridge") {
          hold(s, "organ", bar, 0, ch.tones, 3.9, 0.4);
        } else {
          hold(s, "organ", bar, 0, ch.tones, 1.9, 0.5);
          hold(s, "organ", bar, 2, ch.tones, 1.9, odd ? 0.44 : 0.48);
        }

        // Bass.
        const bass =
          kind === "intro"
            ? b >= 4
              ? BASS.intro
              : null
            : kind === "verse"
              ? BASS.verse
              : kind === "chorus" || kind === "inter"
                ? BASS.chorus
                : kind === "bridge"
                  ? BASS.bridge
                  : kind === "final"
                    ? BASS.final
                    : null;
        if (bass) bassLine(s, "bass", bar, bass, ch.bass, 0.8);
        // Sub: the root an octave down until the fuzz wall takes the low end.
        if (bass && (kind === "verse" || kind === "chorus" || kind === "inter"))
          s.note("sub", bar, 0, ch.bass - 12, 3.9, 0.7);

        // Drums: half-time until the last chorus, which doubles to a backbeat.
        if (kind === "final") {
          s.grid(
            "kick",
            bar,
            36,
            odd ? "9.....8.9..7...." : "9.....8.9.......",
          );
          s.grid("snare", bar, 38, "....9.......9...");
          s.grid("hats", bar, 42, "5353635353536353", 0.9, 0.03);
          s.grid("hats", bar, 46, "..............5.", 0.8);
        } else if (kind === "bridge") {
          if (b < 4) s.grid("kick", bar, 36, "9...............");
          else s.grid("kick", bar, 36, "9.......9.......");
          s.grid("hats", bar, 37, "........4.......", 0.9);
          if (b === 7) roll(s, bar, 0.25, 0.75);
        } else if (kind === "intro") {
          if (b >= 6) s.grid("kick", bar, 36, "9......78.......");
          if (b >= 6) s.grid("hats", bar, 42, "4.3.4.3.4.3.4.3.", 0.9, 0.03);
        } else if (kind !== "end") {
          s.grid(
            "kick",
            bar,
            36,
            odd ? "9......78.....6." : "9......78.......",
          );
          s.grid("snare", bar, 38, "........9.......");
          s.grid("snare", bar, 38, "...3......3...3.", 0.5);
          s.grid("hats", bar, 42, "5.3.5.3.5.3.5.3.", 0.9, 0.03);
          if (kind === "chorus" || kind === "inter")
            s.grid("hats", bar, 46, "......5.......5.", 0.8);
        }

        // Glockenspiel sparkle over the choruses.
        if (kind === "chorus" || kind === "final")
          cell(
            s,
            "glock",
            bar,
            odd ? "0.2.4.2.1.3.5..." : "0.2.4.2.0.2.4.2.",
            ladder(ch, 76, 96),
            {
              velocity: 0.42,
            },
          );

        // Fuzz wall: power-chord eighths through the last chorus.
        if (kind === "final")
          for (let e = 0; e < 8; e++)
            hold(
              s,
              "fuzz",
              bar,
              e / 2,
              [ch.bass + 12, ch.bass + 19, ch.bass + 24],
              0.45,
              e % 2 ? 0.55 : 0.7,
            );

        // Bloom pad in the bridge; choir over the last chorus.
        if (kind === "bridge")
          hold(
            s,
            "bloom",
            bar,
            0,
            ch.tones.map((p) => p + 12),
            3.9,
            0.5,
          );
        if (kind === "final")
          hold(
            s,
            "choir",
            bar,
            0,
            ch.tones.map((p) => p + 12),
            3.9,
            0.42,
          );
      }
    }

    // The slide hook: a taste in the intro, the interlude, and over the last pass.
    lead(4, HOOK, 0, 0.6);
    lead(24, HOOK);
    lead(28, HOOK2);
    lead(64, HOOK, 0, 0.62);
    lead(68, HOOK2, 0, 0.62);

    // Chops: a syllable riff through the interlude's second half.
    for (let bar = 28; bar < 32; bar++)
      cell(
        s,
        "chops",
        bar,
        bar % 2 ? "2...1...2.3...1." : "0...2...1.....2.",
        ladder(CHORUS[bar % 4]!, 64, 88),
        { velocity: 0.62 },
      );
    // The held vowel as a cloud under the intro and the bridge.
    for (const [bar, beats] of [
      [0, 32],
      [48, 32],
    ] as const)
      hold(s, "vgrain", bar, 0, [64, 71], beats, 0.5);

    // Vocals.
    const verse = (bar: number, lines: readonly string[]) =>
      lines.forEach((part, i) => sing("vox", part, bar + i * 2));
    verse(8, ["v1", "v2", "v3", "v4"]);
    verse(32, ["v5", "v6", "v7", "v8"]);
    for (const bar of [16, 40, 56, 64])
      verse(bar, ["ch1", "ch2", "ch3", "ch4"]);
    for (const bar of [17, 41, 57, 65, 69]) sing("echo", "echo", bar, 2, 0.85);
    sing("vox", "br", 50);
    sing("echo", "br", 54, 0, 0.6);

    // Sea wind under the intro and the end; builds into the last chorus.
    s.note("wind", 0, 0, 60, 32, 0.6);
    s.note("wind", 72, 0, 60, 8, 0.5);
    s.note("fall", 48, 0, 60, 4, 0.7);
    s.note("riser", 54, 0, 60, 8, 0.7);
    for (const bar of [16, 56, 72]) s.note("impact", bar, 0, 36, 2, 0.8);

    // Two beats of silence before the last chorus.
    dropout(s, 55, 2, 2, [
      "kick",
      "snare",
      "hats",
      "bass",
      "organ",
      "bloom",
      "riser",
      "vgrain",
    ]);

    // Lanes: delay throws on the line ends; the fuzz opens over the last pass.
    s.tracks.forEach((t, i) => {
      if (t.id === "vox")
        s.tracks[i] = {
          ...t,
          delayMixAutomation: throws(throwsAt, VOCAL_ECHO.mix, THROW_PEAK, 1),
        };
      if (t.id === "fuzz")
        s.tracks[i] = {
          ...t,
          filterAutomation: lanes(
            [56, 1400],
            [63.9, 2000],
            [64, 3400],
            [72, 4200],
          ),
        };
      if (t.id === "organ")
        s.tracks[i] = {
          ...t,
          filterAutomation: filterArc(s.sections, 3000, 5000),
        };
    });
    return s.finish();
  },
};
