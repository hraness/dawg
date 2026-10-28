/**
 * Window Seat: liquid drum and bass in G major at 170, sung half time. Felt
 * piano and nylon guitar carry the verses over a ticking breakbeat with only
 * a kick on the one; the full two-step break, a reese bass and a warm pad
 * arrive with the chorus. Every sung line spans four bars, slow and low over
 * the fast drums. The break drops to electric piano and one plain line, the
 * drums roll back in, and the outro is the piano alone.
 * Free-form: written bar by bar on the composer. No key change.
 */
import { Composer, lanes, orbit, preset } from "./build.ts";
import {
  cell,
  chopTrack,
  dropout,
  grainTrack,
  hold,
  ladder,
  LEAD_FX,
  LINE_LEAD,
  roll,
  slot,
  sounds,
  stab,
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

export const BPM = 170;
const BARS = 112;

/** The vocal book: lines in beats (scripts/vox/songs.py window-seat-vox). */
export const BOOK: VoxBank = {
  sample: "window-seat-vox",
  root: 67,
  syllables: ["oh", "ah", "seat", "hey", "mm"],
  lines: {
    v1: 16,
    v2: 16,
    v3: 16,
    v4: 16,
    v5: 16,
    v6: 16,
    v7: 16,
    v8: 16,
    ch1: 16,
    ch2: 16,
    ch3: 16,
    ch4: 16,
    br1: 16,
    br2: 16,
    last: 24,
  },
};
/** Beat (from the line's downbeat) where each line's last word lands. */
const ENDS: Record<string, number> = {
  v1: 8,
  v2: 8,
  v3: 7,
  v4: 8,
  v5: 8,
  v6: 7,
  v7: 8,
  v8: 7,
  ch1: 2,
  ch2: 6,
  ch3: 2,
  ch4: 6,
  br1: 6,
  br2: 5,
  last: 12,
};

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
const Em9 = c(40, 59, 62, 66, 67);
const Cmaj7 = c(36, 59, 64, 67, 71);
const GoverB = c(35, 59, 62, 67, 71);
const D = c(38, 57, 62, 66, 69);
const Bm7 = c(35, 57, 62, 66, 69);
const Em7 = c(40, 59, 62, 67, 71);
const Am7 = c(45, 57, 60, 64, 67);
const Dsus = c(38, 57, 62, 67, 69);
const G = c(43, 59, 62, 67, 71);
const VERSE = [Em9, Cmaj7, GoverB, D];
const CHORUS = [Cmaj7, D, Bm7, Em7];
const BREAK = [Am7, Bm7, Cmaj7, Dsus];
const OUTRO = [Cmaj7, D, Em7, G];
/** The flute's long notes over each chorus chord, two bars each: B, A, F#, G. */
const TOPLINE = [83, 81, 78, 79];

type Kind = "intro" | "verse" | "chorus" | "break" | "final" | "outro";
const SECTIONS: readonly (readonly [string, Kind, number, number])[] = [
  ["Intro", "intro", 0, 8],
  ["Verse 1", "verse", 8, 16],
  ["Chorus 1", "chorus", 24, 16],
  ["Verse 2", "verse", 40, 16],
  ["Chorus 2", "chorus", 56, 16],
  ["Break", "break", 72, 16],
  ["Last chorus", "final", 88, 16],
  ["Outro", "outro", 104, 8],
];

const chordsFor = (kind: Kind): readonly Chord[] =>
  kind === "verse" || kind === "intro"
    ? VERSE
    : kind === "break"
      ? BREAK
      : kind === "outro"
        ? OUTRO
        : CHORUS;

export const windowSeat: DemoDefinition = {
  info: demoInfo({
    id: "window-seat",
    title: "Window Seat",
    style: "Hyperpop",
    description:
      "Liquid drum and bass in G major at 170, sung half time: felt piano and nylon guitar over a ticking breakbeat in the verses, the full two-step break with a reese bass and warm pad in the chorus, four-bar vocal lines low and slow over fast drums, an electric-piano break and a piano-only outro.",
    tempoBpm: BPM,
    key: "G",
    bars: BARS,
    highlightBar: 24,
    trackId: "piano",
    features: [
      "half-time singing over 170 drums: every line spans four bars",
      "verses sung low, G3 to E4, on felt piano and fingerpicked nylon guitar",
      "a ticking breakbeat with only a kick on the one until the chorus",
      "the chorus brings the full two-step break, a reese bass and a warm pad",
      "ghost snares and shuffled hats from the breaks kit",
      "a drumless electric-piano break, then a snare roll back in",
      "a flute line over the last chorus and a piano-only outro",
    ],
    arrangement: SECTIONS.map(([name, , , bars]) => `${name} ${bars}`),
    mixNotes: [
      "the voice sits close and warm on top; the drums are fast but light",
      "the reese stays under 200 Hz and ducks gently from the kick",
      "the piano carries the harmony; the pad only fills the choruses",
      "the break is drumless and wide; the drums roll back in two bars early",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    // The book reads quiet in this mix: 3 dB more makeup puts the words
    // about 7 dB over the bed where consonants live.
    const vox = vocalTrack(BOOK, 1, {
      fx: { ...LEAD_FX, compressor: { ...VOCAL_COMP, makeup: 19 } },
    });

    // Chorus doubles: the lead a few cents sharp and flat, panned wide.
    const double = (id: string, cents: number, pan: number, seed: number) =>
      vocalTrack(BOOK, 0.36 * UNDER_WORDS, {
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
          chorus: { rate: 0.8 + seed * 0.1, depth: 0.5, mix: 0.5 },
        },
        reverb: { mix: 0.26, size: 0.75, fade: 2.6, lowpass: 7500 },
      });
    for (const track of [
      sounds.kick(BPM, "breaks", 0.55, 0.38),
      sounds.snare(0.42, "breaks"),
      sounds.hats(0.4, "breaks", { pan: -0.12 }),
      preset("bass", "Reese", "reese", 0.3, {
        filter: { type: "lpf", cutoff: 900, resonance: 0.1 },
        fx: { ...orbit },
      }),
      // The piano is the bed's loudest voice in the words' band: quiet,
      // with a dip at 2.5 kHz so consonants cut through it.
      preset("piano", "Felt piano", "felt-piano", 0.022, {
        fx: { ...orbit, eq: { mid: -4, midfreq: 2500 } },
        reverb: { mix: 0.24, size: 0.7, fade: 2.4, lowpass: 6500 },
        humanize: { timing: 6, velocity: 8, seed: 91 },
      }),
      preset("guitar", "Nylon guitar", "nylon-guitar", 0.11, {
        pan: 0.28,
        fx: { ...orbit },
        reverb: { mix: 0.16, size: 0.5, fade: 1.6 },
        humanize: { timing: 7, velocity: 10, seed: 92 },
      }),
      preset("pad", "Warm pad", "warm-pad", 0.16, {
        fx: { ...orbit },
        reverb: { mix: 0.3, size: 0.85, fade: 3.2, lowpass: 6000 },
      }),
      preset("rhodes", "Rhodes", "rhodes", 0.08, {
        pan: -0.15,
        fx: { ...orbit, chorus: { rate: 0.5, depth: 0.5, mix: 0.35 } },
        reverb: { mix: 0.26, size: 0.75, fade: 2.6 },
      }),
      preset("flute", "Flute", "flute-pipes", 0.16, {
        pan: -0.25,
        fx: { ...orbit },
        delay: { beats: 1.5, feedback: 0.3, mix: 0.18, pingpong: true },
        reverb: { mix: 0.32, size: 0.85, fade: 3 },
      }),
      vox,
      double("dblhi", 9, -0.55, 1),
      double("dbllo", -9, 0.55, 2),
      chopTrack(BOOK, 0.7, { humanize: { timing: 4, velocity: 6, seed: 93 } }),
      grainTrack(BOOK, 0.36),
      preset("riser", "Riser", "noise-riser", 0.12),
      preset("drop", "Sub drop", "sub-drop", 0.26),
    ])
      s.track(track);

    const throwsAt: number[] = [];
    const sing = (part: string, bar: number, beat = 0, doubled = false) => {
      for (const id of doubled ? ["vox", "dblhi", "dbllo"] : ["vox"])
        s.note(
          id,
          bar,
          beat - LINE_LEAD + (id === "vox" ? 0 : 0.03),
          slot(vox, part),
          BOOK.lines![part]! + LINE_LEAD,
          id === "vox" ? 0.9 : 0.8,
        );
      throwsAt.push(bar + (beat + ENDS[part]!) / 4);
    };

    for (const [name, kind, start, bars] of SECTIONS) {
      s.section(name, start, bars);
      const chords = chordsFor(kind);
      for (let b = 0; b < bars; b++) {
        const bar = start + b;
        const ch = chords[Math.floor(b / 2) % chords.length]!;
        const second = b % 2;
        const rungs = ladder(ch, 55, 79);

        if (kind === "intro" || kind === "outro") {
          // Piano alone: a slow broken chord, the bass note on the one.
          if (!second) s.note("piano", bar, 0, ch.bass + 12, 7.8, 0.5);
          cell(
            s,
            "piano",
            bar,
            second ? "..2...3...4.3..." : "0...1...2...1...",
            rungs,
            {
              velocity: 0.42,
            },
          );
          continue;
        }
        if (kind === "break") {
          // Electric piano and pad, no drums: chords that breathe for two bars.
          if (!second) {
            hold(s, "rhodes", bar, 0, ch.tones, 7.6, 0.45);
            hold(s, "pad", bar, 0, ch.tones, 7.8, 0.4);
            s.note("bass", bar, 0, ch.bass, 7.6, 0.4);
          }
          if (b >= 8)
            cell(s, "guitar", bar, "0.1.2.3.4.3.2.1.", ladder(ch, 59, 79), {
              velocity: 0.3 + (b - 8) * 0.03,
            });
          continue;
        }

        if (kind === "verse") {
          // The tick: shuffled hats, rim, and only a kick on the one.
          const late = start >= 40 || b >= 8;
          s.grid(
            "kick",
            bar,
            36,
            late ? "9.........6....." : "9...............",
          );
          s.grid("hats", bar, 42, "6.3.5.3.6.3.5.34", 0.8);
          s.grid("hats", bar, 37, "......4.......4.", 0.7);
          if (late) s.grid("snare", bar, 38, "....8.......8...", 0.75);
          // Piano on the downbeats, the guitar picking eighths across both bars.
          if (!second) hold(s, "piano", bar, 0, ch.tones, 3.6, 0.42);
          cell(
            s,
            "piano",
            bar,
            second ? "....2.....3....." : "........2...1...",
            rungs,
            {
              velocity: 0.36,
            },
          );
          cell(
            s,
            "guitar",
            bar,
            second ? "0.2.1.3.2.4.3.1." : "0.1.2.3.1.2.4.2.",
            ladder(ch, 52, 76),
            { velocity: start >= 40 ? 0.42 : 0.36 },
          );
          if (b >= 8 && !second) s.note("bass", bar, 0, ch.bass, 7.4, 0.5);
        } else {
          // The chorus: the full two-step, ghost snares, open hats, reese, pad.
          s.grid(
            "kick",
            bar,
            36,
            second ? "9.........9..6.." : "9.........9.....",
          );
          s.grid("snare", bar, 38, "....9..3....9..3", 0.9);
          s.grid("hats", bar, 42, "7.5.7.5.7.5.7.55");
          s.grid("hats", bar, 46, "..6.......6.....", 0.7);
          if (!second) {
            s.note("bass", bar, 0, ch.bass, 4.4, 0.8);
            s.note("bass", bar + 1, 0.5, ch.bass + 12, 0.5, 0.6);
            s.note("bass", bar + 1, 1.5, ch.bass, 2.3, 0.7);
            hold(s, "pad", bar, 0, ch.tones, 7.8, 0.5);
          }
          stab(
            s,
            "piano",
            bar,
            "..7.....7.....5.",
            ch.tones.map((p) => p + 12),
            0.5,
          );
          cell(s, "guitar", bar, "0.2.4.2.1.3.5.3.", ladder(ch, 59, 83), {
            velocity: 0.3,
          });
          if (kind === "final" && !second)
            s.note("flute", bar, 0, TOPLINE[Math.floor(b / 2) % 4]!, 7.4, 0.45);
          // "seat" chops answering the hook in the line gaps.
          if (b % 4 === 2)
            cell(s, "chops", bar, "........2.1.0...", ladder(ch, 67, 79), {
              velocity: 0.5,
            });
        }
      }
    }

    // Intro: the held vowel and a flute line over the piano.
    hold(s, "vgrain", 0, 0, [55, 62], 32, 0.36);
    [79, 78, 76, 74].forEach((p, i) => s.note("flute", 4 + i, 0, p, 3.6, 0.38));

    // Verses: one line every four bars, pickups and late starts.
    const verses = [
      ["v1", 8, -0.5],
      ["v2", 12, 0],
      ["v3", 16, -0.5],
      ["v4", 20, 0.5],
      ["v5", 40, -0.5],
      ["v6", 44, 0],
      ["v7", 48, -0.5],
      ["v8", 52, 0.5],
    ] as const;
    for (const [part, bar, beat] of verses) sing(part, bar, beat);
    for (const bar of [24, 56, 88]) {
      sing("ch1", bar, 0, true);
      sing("ch2", bar + 4, -0.5, true);
      sing("ch3", bar + 8, 0, true);
      if (bar !== 88) sing("ch4", bar + 12, -0.5, true);
    }
    sing("last", 100, -0.5, true);
    for (const bar of [23, 55]) roll(s, bar, 0.2, 0.65);

    // The break: one plain line and its answer, twice; the drums roll back.
    sing("br1", 72);
    sing("br2", 76, -0.5);
    sing("br1", 80);
    sing("br2", 84, -0.5);
    hold(s, "vgrain", 72, 0, [57, 64], 48, 0.32);
    s.grid("hats", 86, 42, "5.3.5.3.5.3.5.3.");
    s.grid("hats", 87, 42, "6.4.6.4.6.4.6464");
    roll(s, 87, 0.15, 0.7);
    s.note("riser", 84, 0, 60, 15.9, 0.6);
    dropout(s, 87, 3, 1, ["hats", "snare", "rhodes", "pad", "guitar"]);
    s.note("drop", 88, 0, 36, 4, 0.55);

    // Outro: the last line's tail over the piano, then the vowel alone.
    hold(s, "vgrain", 106, 0, [55, 62], 24, 0.3);
    hold(s, "piano", 110, 0, G.tones, 7.6, 0.4);

    s.tracks.forEach((t, i) => {
      if (t.id === "vox")
        s.tracks[i] = {
          ...t,
          delayMixAutomation: throws(throwsAt, VOCAL_ECHO.mix, THROW_PEAK, 1),
        };
      if (t.id === "bass")
        s.tracks[i] = {
          ...t,
          filterAutomation: lanes(
            [0, 400],
            [24, 900],
            [40, 500],
            [56, 900],
            [72, 500],
            [88, 1000],
          ),
        };
    });
    return s.finish();
  },
};
