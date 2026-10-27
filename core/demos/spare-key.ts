/**
 * Spare Key: deadpan two-step garage in C major at 132. The verses are almost
 * spoken, low repeated notes over a skipping kick, swung hats and organ stabs;
 * the chorus is two words chanted over a growling bass and pitched chops of
 * the same two words. The break drops the bass and sings the plainest lines
 * twice, and the last chorus runs sixteen bars. No key change.
 * Free-form: written bar by bar on the composer.
 */
import { Composer, lanes, orbit, preset } from "./build.ts";
import {
  bassLine,
  cell,
  chopTrack,
  dropout,
  grainTrack,
  hold,
  ladder,
  LINE_LEAD,
  roll,
  slot,
  sounds,
  stab,
  throws,
  vocalTrack,
  type Chord,
  type VoxBank,
} from "./hyperpop.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

export const BPM = 132;
const BARS = 68;
/** Two-step swing on the sixteenths. */
const SWING = 0.16;

/** The vocal book: lines in beats (scripts/vox/songs.py spare-key-vox). */
export const BOOK: VoxBank = {
  sample: "spare-key-vox",
  root: 60,
  syllables: ["key", "oh", "ah", "spare", "mm"],
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
    br1: 8,
    br2: 8,
    last: 12,
  },
};
/** Beat (from the line's downbeat) where each line's last word lands. */
const ENDS: Record<string, number> = {
  v1: 2.5,
  v2: 3,
  v3: 3.5,
  v4: 2.5,
  v5: 2.5,
  v6: 3,
  v7: 3.5,
  v8: 2.5,
  ch1: 2.75,
  ch2: 1.5,
  ch3: 2.75,
  ch4: 2.5,
  br1: 2,
  br2: 2.5,
  last: 6,
};

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
const Am9 = c(45, 55, 59, 60, 64);
const Fmaj7 = c(41, 57, 60, 64, 65);
const Dm9 = c(38, 53, 57, 60, 64);
const Em7 = c(40, 55, 59, 62, 64);
const Dm7 = c(38, 57, 60, 62, 65);
const G = c(43, 55, 59, 62, 67);
const Cmaj7 = c(36, 55, 59, 64, 67);
const Am7 = c(45, 55, 60, 64, 67);
const VERSE = [Am9, Fmaj7, Dm9, Em7];
const CHORUS = [Dm7, G, Cmaj7, Am7];
const BREAK = [Fmaj7, Em7, Dm7, Am7];
const OUTRO = [Dm7, G, Cmaj7, Cmaj7];

type Kind = "intro" | "verse" | "chorus" | "break" | "final" | "outro";
const SECTIONS: readonly (readonly [string, Kind, number, number])[] = [
  ["Intro", "intro", 0, 8],
  ["Verse 1", "verse", 8, 8],
  ["Chorus 1", "chorus", 16, 8],
  ["Verse 2", "verse", 24, 8],
  ["Chorus 2", "chorus", 32, 8],
  ["Break", "break", 40, 8],
  ["Last chorus", "final", 48, 16],
  ["Outro", "outro", 64, 4],
];

const chordsFor = (kind: Kind): readonly Chord[] =>
  kind === "verse" || kind === "intro"
    ? VERSE
    : kind === "break"
      ? BREAK
      : kind === "outro"
        ? OUTRO
        : CHORUS;

export const spareKey: DemoDefinition = {
  info: demoInfo({
    id: "spare-key",
    title: "Spare Key",
    style: "Hyperpop",
    description:
      "Deadpan two-step garage in C major at 132: low, nearly spoken verses over a skipping kick, swung hats and organ stabs, a two-word chorus over a growling bass and pitched chops of the same words, a bassless break and a sixteen-bar last chorus.",
    tempoBpm: BPM,
    key: "C",
    bars: BARS,
    highlightBar: 16,
    trackId: "organ",
    features: [
      "a two-step kick that skips the third beat, with swung hats and rim",
      "verses sung low and flat, G3 to D4, almost spoken",
      "organ stabs on the offbeats, garage style",
      "a two-word chorus chanted over a growling bass",
      "pitched chops of the chorus words answering the chant",
      "a break with no bass, then a sixteen-bar last chorus",
    ],
    arrangement: SECTIONS.map(([name, , , bars]) => `${name} ${bars}`),
    mixNotes: [
      "the voice is dry and close, the deadpan lead on top",
      "the bass growls under 300 Hz and ducks hard from the kick",
      "the hats swing; the kick and clap stay straight",
      "the chops sit wide and wet, the organ narrow",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    const vox = vocalTrack(BOOK, 0.63, {
      reverb: { mix: 0.1, size: 0.4, fade: 1.2, lowpass: 8000 },
    });
    // Chorus doubles: the lead a few cents sharp and flat, panned wide.
    const double = (id: string, cents: number, pan: number, seed: number) =>
      vocalTrack(BOOK, 0.23, {
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
        reverb: { mix: 0.18, size: 0.55, fade: 1.6, lowpass: 7500 },
      });
    for (const track of [
      sounds.kick(BPM, "syn808", 0.9, 0.27),
      sounds.snare(0.8, "syn808", { name: "Clap" }),
      sounds.hats(0.55, "syn808"),
      preset("bass", "Growl bass", "growl-bass", 0.25, {
        filter: { type: "lpf", cutoff: 1200, resonance: 0.15 },
        fx: { ...orbit },
      }),
      preset("organ", "Jazz organ", "jazz-organ", 0.17, {
        filter: { type: "lpf", cutoff: 4000, resonance: 0.05 },
        fx: { ...orbit },
        reverb: { mix: 0.14, size: 0.45, fade: 1.2 },
        humanize: { timing: 3, velocity: 6, seed: 111 },
      }),
      preset("pad", "PWM pad", "pwm-pad", 0.08, {
        fx: { ...orbit },
        reverb: { mix: 0.3, size: 0.8, fade: 2.8, lowpass: 6000 },
      }),
      vox,
      double("dblhi", 9, -0.55, 1),
      double("dbllo", -9, 0.55, 2),
      chopTrack(BOOK, 0.48, {
        humanize: { timing: 3, velocity: 6, seed: 112 },
        delay: { beats: 0.75, feedback: 0.3, mix: 0.2, pingpong: true },
      }),
      grainTrack(BOOK, 0.22),
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
    const twoStep = (bar: number, odd: number, gain = 1) => {
      s.grid(
        "kick",
        bar,
        36,
        odd ? "9......7..9....." : "9.........9.....",
        gain,
      );
      s.grid("snare", bar, 39, "....9.......9...", gain);
      s.grid("hats", bar, 42, "..7...7...7...7.", gain, SWING);
      s.grid("hats", bar, 42, "4.3.4.3.4.3.4.3.", 0.6 * gain, SWING);
      s.grid("hats", bar, 37, "...5..5....5..5.", 0.7 * gain, SWING);
    };

    for (const [name, kind, start, bars] of SECTIONS) {
      s.section(name, start, bars);
      const chords = chordsFor(kind);
      for (let b = 0; b < bars; b++) {
        const bar = start + b;
        const ch = chords[b % chords.length]!;
        const odd = b % 2;

        if (kind === "intro" || kind === "outro") {
          // Organ stabs and swung hats; the kick waits for the verse.
          stab(s, "organ", bar, "..7..5....7...5.", ch.tones, 0.45);
          s.grid("hats", bar, 42, "..6...6...6...6.", 0.8, SWING);
          if (kind === "intro" && b >= 4)
            cell(s, "chops", bar, "........0..1.2..", ladder(ch, 64, 76), {
              velocity: 0.4,
            });
          continue;
        }
        if (kind === "break") {
          // No bass: the pad, slow organ, the clap only.
          hold(s, "pad", bar, 0, ch.tones, 3.9, 0.5);
          stab(s, "organ", bar, "..6.......6.....", ch.tones, 0.4);
          s.grid("snare", bar, 39, "....7.......7...", 0.7);
          if (b >= 4) s.grid("hats", bar, 42, "..6...6...6...6.", 0.8, SWING);
          continue;
        }

        twoStep(bar, odd);
        if (kind === "verse") {
          stab(
            s,
            "organ",
            bar,
            odd ? "..7..6....7..6.." : "..7...7..6...7..",
            ch.tones,
            0.5,
          );
          if (start >= 24)
            bassLine(
              s,
              "bass",
              bar,
              odd ? "0.......0.2....." : "0.........0.....",
              ch.bass,
              0.6,
            );
        } else {
          stab(s, "organ", bar, "..7..7....7..7..", ch.tones, 0.45);
          bassLine(
            s,
            "bass",
            bar,
            odd ? "0..0..2...0.1.0." : "0..0......2.0...",
            ch.bass,
            0.85,
          );
          hold(s, "pad", bar, 0, ch.tones, 3.9, 0.4);
          // "spare key" chops answering the chant, clear of the held "key".
          if (b % 4 === 3)
            cell(s, "chops", bar, "........3.0.3.0.", ladder(ch, 64, 76), {
              velocity: 0.55,
            });
          if (kind === "final" && b >= 8 && !odd)
            cell(s, "chops", bar, "..........2.1.0.", ladder(ch, 72, 84), {
              velocity: 0.4,
            });
        }
      }
    }

    // Intro: the held hum.
    hold(s, "vgrain", 0, 0, [48, 55], 16, 0.34);

    const verses = [
      ["v1", 8, 0],
      ["v2", 10, 0],
      ["v3", 12, -0.5],
      ["v4", 14, 0.5],
      ["v5", 24, 0],
      ["v6", 26, 0],
      ["v7", 28, -0.5],
      ["v8", 30, 0.5],
    ] as const;
    for (const [part, bar, beat] of verses) sing(part, bar, beat);
    for (const bar of [16, 32, 48, 56]) {
      // The chant leans in half a beat so "spare" lands on the beat, off the hats.
      sing("ch1", bar, -0.5, true);
      sing("ch2", bar + 2, 0, true);
      sing("ch3", bar + 4, -0.5, true);
      if (bar !== 56) sing("ch4", bar + 6, 0, true);
    }
    sing("last", 62, 0, true);
    for (const bar of [15, 31]) roll(s, bar, 0.2, 0.6);

    // The break: the plainest lines, twice.
    sing("br1", 40);
    sing("br2", 42, 0.5);
    sing("br1", 44);
    sing("br2", 46, 0.5);
    s.note("riser", 44, 0, 60, 15.9, 0.6);
    roll(s, 47, 0.15, 0.7);
    dropout(s, 47, 3, 1, ["organ", "pad", "hats"]);
    s.note("drop", 48, 0, 36, 4, 0.55);

    // Outro: one last hum under the organ.
    hold(s, "vgrain", 64, 0, [48, 55], 16, 0.3);

    s.tracks.forEach((t, i) => {
      if (t.id === "vox")
        s.tracks[i] = {
          ...t,
          delayMixAutomation: throws(throwsAt, 0.03, 0.24, 1),
        };
      if (t.id === "organ")
        s.tracks[i] = {
          ...t,
          filterAutomation: lanes(
            [0, 1400],
            [7.9, 1400],
            [8, 4000],
            [40, 1800],
            [48, 5000],
          ),
        };
    });
    return s.finish();
  },
};
