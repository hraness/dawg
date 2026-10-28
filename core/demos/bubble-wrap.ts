/**
 * Bubble Wrap: bubblegum glitch-pop in Bb major at 100. Stop-start blocks of
 * metallic hits and a rubbery folded bass open on a deadpan low chant; the
 * verse is sung plainly, low and conversational, over a loop that starts on
 * IV and never lands on I. The chorus snaps to a double-time break with
 * plastic stabs and chipmunk "pop" chops, the list chant grows a term each
 * pass, a false ending cuts to silence, and a ballad breakdown on held pads
 * and a music box slams back into the last chorus, which stops dead.
 * Free-form: written bar by bar on the composer. No key change.
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

export const BPM = 100;
const BARS = 64;

/** The vocal book: lines in beats (scripts/vox/songs.py bubble-wrap-vox). */
export const BOOK: VoxBank = {
  sample: "bubble-wrap-vox",
  root: 70,
  syllables: ["pop", "up", "oh", "ah", "hey", "mm"],
  lines: {
    v1: 8,
    v2: 8,
    v3: 8,
    v4: 8,
    v5: 8,
    v6: 8,
    v7: 8,
    v8: 8,
    chant1: 4,
    chant2: 4,
    chant3: 4,
    chant4: 4,
    ch1: 8,
    ch2: 8,
    ch3: 8,
    ch4: 8,
    br1: 8,
    br2: 8,
  },
};
/** Beat (from the line's downbeat) where each line's last word lands. */
const ENDS: Record<string, number> = {
  v1: 3,
  v2: 2.25,
  v3: 2.25,
  v4: 2,
  v5: 2.5,
  v6: 2.25,
  v7: 2.75,
  v8: 2.75,
  ch1: 2.75,
  ch2: 2.5,
  ch3: 2.5,
  ch4: 2.25,
  br1: 3,
  br2: 3,
};

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
const Ebmaj9 = c(39, 55, 58, 62, 65);
const Fadd9 = c(41, 57, 60, 65, 67);
const Gm7 = c(43, 55, 58, 62, 65);
const Dm7 = c(38, 57, 60, 62, 65);
const Ebmaj7 = c(39, 55, 58, 62, 67);
const BbOverD = c(38, 58, 62, 65, 70);
const F = c(41, 57, 60, 65, 69);
const Cm7 = c(36, 55, 58, 60, 63);
const Fsus = c(41, 58, 60, 65, 70);
const VERSE = [Ebmaj9, Fadd9, Gm7, Dm7];
const CHORUS = [Gm7, Ebmaj7, BbOverD, F, Gm7, Ebmaj7, BbOverD, Fsus];
const BREAK = [Ebmaj7, BbOverD, Cm7, Fsus];

type Kind =
  "intro" | "verse" | "chant" | "chorus" | "stop" | "ballad" | "final" | "end";
const SECTIONS: readonly (readonly [string, Kind, number, number])[] = [
  ["Intro", "intro", 0, 4],
  ["Verse 1", "verse", 4, 8],
  ["Chant 1", "chant", 12, 4],
  ["Chorus 1", "chorus", 16, 8],
  ["Verse 2", "verse", 24, 8],
  ["Chant 2", "chant", 32, 4],
  ["Chorus 2", "chorus", 36, 8],
  ["False end", "stop", 44, 2],
  ["Breakdown", "ballad", 46, 8],
  ["Last chorus", "final", 54, 8],
  ["End", "end", 62, 2],
];

const chordsFor = (kind: Kind): readonly Chord[] =>
  kind === "chorus" || kind === "final"
    ? CHORUS
    : kind === "ballad"
      ? BREAK
      : VERSE;

// Folded bass: verse bounce with an octave pop, chorus 16ths.
const BASS = {
  verse: "0.....2...0..2..",
  chant: "0.........0.....",
  chorus: "0.2.0.2.0.2.0.20",
} as const;

export const bubbleWrap: DemoDefinition = {
  info: demoInfo({
    id: "bubble-wrap",
    title: "Bubble Wrap",
    style: "Hyperpop",
    description:
      "Bubblegum glitch-pop in Bb major at 100: stop-start metallic hits and a rubbery folded bass, a plain low verse over a loop that never lands on I, a deadpan low chant that grows a term each pass, a double-time chorus with plastic stabs and chipmunk chops, a false ending, a ballad breakdown, and a last chorus that stops dead.",
    tempoBpm: BPM,
    key: "Bb",
    bars: BARS,
    highlightBar: 16,
    trackId: "stab",
    features: [
      "a conversational verse sung low, F3 to Eb4, with pickups and rests",
      "a deadpan low male chant, a word list that grows each pass",
      "stop-start blocks: hits and silences under the chant",
      "a double-time chorus break with plastic stabs and chipmunk chops",
      "a verse loop on IV-V-vi-iii that never lands on I; a suspended V closing the chorus",
      "a false ending, then a ballad breakdown on pads and music box",
      "a last chorus that stops dead",
    ],
    arrangement: SECTIONS.map(([name, , , bars]) => `${name} ${bars}`),
    mixNotes: [
      "the singer is dry and close in the verse; the chorus opens up with throws",
      "the chant sits low and centered, darker than the lead",
      "the kick is sub-heavy and cuts to true silence on the stops",
      "the stabs and pad pump from the kick in the choruses",
      "the breakdown is drumless and wide; the slam back is full",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    // The lead 1.5 dB under the shelf's level, conversational.
    const vox = vocalTrack(BOOK, 0.84);

    const chant = vocalTrack(BOOK, 0.85 * UNDER_WORDS, {
      id: "chant",
      name: "Low chant",
      filter: { type: "lpf", cutoff: 4200, resonance: 0 },
      fx: { distort: { type: "soft", drive: 1.8, tone: 4000, mix: 0.3 } },
      delay: { beats: 0.5, feedback: 0.25, mix: 0.12, pingpong: true },
    });
    for (const track of [
      sounds.kick(BPM, "syn808", 0.9, 0.5),
      sounds.snare(0.5, "syn909"),
      sounds.hats(0.3, "syn909", { name: "Hats & clicks" }),
      preset("bass", "Latex bass", "fold-bass", 0.3, {
        fx: { ...orbit },
        glide: { time: 0.05, mode: "legato" },
      }),
      preset("stab", "Plastic stabs", "house-pluck", 0.4, {
        pan: 0.15,
        fx: { ...orbit },
        delay: { beats: 0.75, feedback: 0.3, mix: 0.14, pingpong: true },
      }),
      preset("metal", "Metal hits", "fm-bells", 0.3, {
        pan: -0.2,
        fx: { distort: { type: "hard", drive: 3, tone: 6000, mix: 0.35 } },
        reverb: { mix: 0.18, size: 0.4, fade: 0.9 },
      }),
      preset("pad", "Glass pad", "glass-pad", 0.16, {
        fx: { ...orbit },
        reverb: { mix: 0.25, size: 0.8, fade: 2.6, lowpass: 7000 },
      }),
      preset("shine", "Evolving pad", "evolving-pad", 0.07, {
        reverb: { mix: 0.35, size: 0.9, fade: 3.6, lowpass: 7000 },
      }),
      preset("box", "Music box", "music-box", 0.25, {
        pan: 0.25,
        delay: { beats: 0.75, feedback: 0.4, mix: 0.24, pingpong: true },
        reverb: { mix: 0.3, size: 0.8, fade: 2.6 },
        humanize: { timing: 5, velocity: 8, seed: 71 },
      }),
      preset("strings", "Strings", "synth-strings", 0.14, {
        reverb: { mix: 0.3, size: 0.85, fade: 3 },
      }),
      vox,
      chant,
      chopTrack(BOOK, 1, { humanize: { timing: 3, velocity: 6, seed: 72 } }),
      grainTrack(BOOK, 0.4),
      preset("laser", "Zaps", "laser", 0.14),
      preset("riser", "Riser", "pitch-riser", 0.14),
      preset("impact", "Impact", "impact", 0.3),
      preset("drop", "Sub drop", "sub-drop", 0.3),
      preset("steel", "Steel pan", "steelpan", 0.22, {
        pan: 0.3,
        delay: { beats: 0.75, feedback: 0.3, mix: 0.18, pingpong: true },
        reverb: { mix: 0.2, size: 0.6, fade: 1.4 },
        humanize: { timing: 6, velocity: 10, seed: 72 },
      }),
    ])
      s.track(track);

    const throwsAt: number[] = [];
    const sing = (id: string, part: string, bar: number, beat = 0, v = 0.9) => {
      const track = id === "chant" ? chant : vox;
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
    // A chipmunk "pop": the chop an octave and more above its root.
    const pop = (bar: number, beat: number, pitch = 82, v = 0.7) =>
      s.note("chops", bar, beat, pitch, 0.4, v);

    for (const [name, kind, start, bars] of SECTIONS) {
      s.section(name, start, bars);
      const chords = chordsFor(kind);
      for (let b = 0; b < bars; b++) {
        const bar = start + b;
        const ch = chords[b % chords.length]!;
        const odd = b % 2;
        const top = ladder(ch, 70, 94);

        if (kind === "intro" || kind === "chant") {
          // Stop-start: hits on 1 and the and of 3, silence between.
          s.grid("kick", bar, 36, "9.........8.....");
          if (kind === "chant" && odd)
            s.grid("snare", bar, 39, "............9...");
          bassLine(s, "bass", bar, BASS.chant, ch.bass, 0.85);
          hold(s, "metal", bar, 0, top.slice(0, 3), 0.5, 0.7);
          hold(s, "metal", bar, 2.5, top.slice(1, 4), 0.4, 0.6);
          if (kind === "chant")
            s.grid("hats", bar, 37, "..4...4...4..44.", 0.9);
        } else if (kind === "verse") {
          s.grid(
            "kick",
            bar,
            36,
            odd ? "9.....8...9....." : "9.....8...9..7..",
          );
          s.grid("snare", bar, 39, "....9.......9...");
          s.grid("hats", bar, 42, "5.4.5.4.5.4.5.4.", 0.9, 0.04);
          s.grid("hats", bar, 37, "..3......3....4.", 0.9);
          bassLine(s, "bass", bar, BASS.verse, ch.bass, 0.8);
          hold(s, "pad", bar, 0, ch.tones, 3.9, 0.35);
          // Steel pan answers in the line gaps.
          cell(
            s,
            "steel",
            bar,
            odd ? "..2.1..3..2.4..." : "0.....2...1..3..",
            ladder(ch, 65, 89),
            { velocity: odd ? 0.6 : 0.45 },
          );
          // Quiet stabs under the verse, between the lines.
          for (const beat of odd ? [0.5, 2.5] : [1.5, 3.5])
            hold(
              s,
              "stab",
              bar,
              beat,
              ch.tones.map((p) => p + 12),
              0.25,
              0.45,
            );
          // Metal answers in the bar after each sung line.
          if (odd) {
            hold(s, "metal", bar, 2, top.slice(0, 3), 0.4, 0.6);
            hold(s, "metal", bar, 3.5, top.slice(1, 4), 0.3, 0.5);
          }
        } else if (kind === "chorus" || kind === "final") {
          // Double time: the snare on every off-beat of the half bar.
          s.grid("kick", bar, 36, "9....8..9....8..");
          s.grid("snare", bar, 38, "..9...9...9...9.");
          s.grid("hats", bar, 42, "7575757575757575", 0.9, 0.02);
          s.grid("hats", bar, 46, ".......5.......5", 0.8);
          bassLine(s, "bass", bar, BASS.chorus, ch.bass, 0.8);
          // Ghost stabs between the off-beats.
          for (const beat of odd ? [1.75, 3.25] : [0.75, 2.25, 3.75])
            hold(
              s,
              "stab",
              bar,
              beat,
              ch.tones.map((p) => p + 12),
              0.2,
              0.5,
            );
          for (const beat of [0.5, 1.5, 2.5, 3.5])
            hold(
              s,
              "stab",
              bar,
              beat,
              ch.tones.map((p) => p + 12),
              0.3,
              0.7,
            );
          hold(s, "pad", bar, 0, ch.tones, 3.9, 0.45);
          // The last chorus adds strings on top and more pops.
          if (kind === "final") {
            hold(s, "strings", bar, 0, top.slice(0, 3), 3.9, 0.55);
            if (!odd) {
              pop(bar, 3, 84, 0.55);
              pop(bar, 3.5, 86, 0.5);
            }
          }
          // Chipmunk pops answering the hook in the second half of each line.
          if (odd) {
            pop(bar, 1, 82);
            pop(bar, 1.5, 82);
            pop(bar, 2.5, 86, 0.6);
          }
        } else if (kind === "ballad") {
          hold(
            s,
            "shine",
            bar,
            0,
            ch.tones.map((p) => p + 12),
            3.9,
            0.5,
          );
          cell(
            s,
            "box",
            bar,
            odd ? "0.2.4.2.1.3.5..." : "0.2.4.21.3.5.4.2",
            ladder(ch, 70, 96),
            {
              velocity: 0.45,
            },
          );
          if (b >= 4)
            hold(s, "strings", bar, 0, ch.tones, 3.9, 0.45 + (b - 4) * 0.06);
          s.note("bass", bar, 0, ch.bass, 3.8, 0.6);
        }
      }
    }

    // Intro: the hook's pops over the hits, then the first chant.
    pop(0, 1.5);
    pop(0, 2, 84);
    pop(1, 1.5);
    pop(1, 3, 86, 0.6);
    sing("chant", "chant1", 2);
    sing("chant", "chant2", 3);

    // Verses.
    const lines = (bar: number, parts: readonly string[], step = 2) =>
      parts.forEach((part, i) => sing("vox", part, bar + i * step));
    lines(4, ["v1", "v2", "v3", "v4"]);
    lines(24, ["v5", "v6", "v7", "v8"]);
    // The list grows: two terms, then four, then all four under the last chorus.
    for (const [bar, part] of [
      [12, "chant1"],
      [13, "chant2"],
      [14, "chant1"],
      [15, "chant2"],
      [32, "chant1"],
      [33, "chant2"],
      [34, "chant3"],
      [35, "chant4"],
    ] as const)
      sing("chant", part, bar);
    for (const bar of [16, 36, 54]) lines(bar, ["ch1", "ch2", "ch3", "ch4"]);
    for (const [i, part] of ["chant1", "chant2", "chant3", "chant4"].entries())
      sing("chant", part, 55 + i * 2, 2, 0.6);
    lines(46, ["br1", "br2", "br1", "br2"]);

    // Verse 2 stutters: the beat drops out on the back half of every odd bar.
    for (let bar = 25; bar < 32; bar += 2)
      dropout(s, bar, 2, 2, ["kick", "snare", "hats", "bass", "pad"]);

    // The false end: two bars of nothing but one pop.
    pop(45, 2, 82, 0.8);
    // The breakdown's held vowel; the riser back into the slam.
    hold(s, "vgrain", 46, 0, [70, 77], 32, 0.45);
    s.note("riser", 52, 0, 60, 8, 0.7);
    for (const bar of [16, 36, 54]) {
      s.note("impact", bar, 0, 36, 2, 0.8);
      s.note("laser", bar - 1, 3, 84, 1, 0.6);
    }
    // Stop dead: one last pop and the sub falling away.
    pop(62, 0, 82, 0.85);
    s.note("drop", 62, 0, 36, 4, 0.7);

    s.tracks.forEach((t, i) => {
      if (t.id === "vox")
        s.tracks[i] = {
          ...t,
          delayMixAutomation: throws(throwsAt, VOCAL_ECHO.mix, THROW_PEAK, 1),
        };
      if (t.id === "pad")
        s.tracks[i] = {
          ...t,
          filterAutomation: lanes(
            [0, 1600],
            [15.9, 1600],
            [16, 3200],
            [24, 1600],
            [36, 3200],
            [44, 1600],
            [54, 3600],
          ),
        };
    });
    return s.finish();
  },
};
