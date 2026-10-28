/**
 * Glow Stick: twee house-pop in Db major at 128. The song opens on electric
 * piano and voices alone, the hook sung once over them before any drums. The
 * verses ride a plain four-on-the-floor and clap with no bass at all, sung
 * low and close; the bass arrives only with the chorus, pumping eighths under
 * the whole mix. A harp sweeps into each chorus, the break drops the drums
 * for one plain line, a half-bar stop sets up a sixteen-bar last chorus with
 * strings on top, and the hook changes on its last repeat.
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
  roll,
  slot,
  sounds,
  stab,
  THROW_PEAK,
  throws,
  type Chord,
  type VoxBank,
  UNDER_WORDS,
  VOCAL_ECHO,
  vocalTrack,
} from "./hyperpop.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

export const BPM = 128;
const BARS = 70;

/** The vocal book: lines in beats (scripts/vox/songs.py glow-stick-vox). */
export const BOOK: VoxBank = {
  sample: "glow-stick-vox",
  root: 61,
  syllables: ["glow", "oh", "ah", "hey", "mm"],
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
  v1: 3.5,
  v2: 3,
  v3: 3.5,
  v4: 3,
  v5: 3,
  v6: 3,
  v7: 3.5,
  v8: 3.5,
  ch1: 3.5,
  ch2: 3,
  ch3: 3.5,
  ch4: 3.5,
  br1: 3,
  br2: 2.5,
  last: 6,
};

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
const Bbm7 = c(34, 58, 61, 65, 68);
const Gbadd9 = c(42, 58, 61, 66, 68);
const DbOverF = c(41, 56, 61, 65, 68);
const Ab = c(44, 56, 60, 63, 68);
const Fm7 = c(41, 56, 60, 63, 65);
const Ebm7 = c(39, 58, 61, 63, 66);
const Absus = c(44, 56, 61, 63, 68);
const Db = c(37, 56, 61, 65, 68);
const VERSE = [Bbm7, Gbadd9, DbOverF, Ab];
const CHORUS = [Gbadd9, Ab, Fm7, Bbm7];
const BREAK = [Ebm7, Fm7, Gbadd9, Absus];
const OUTRO = [Gbadd9, Ab, Fm7, Db];
/** The strings' line over each chorus chord: F, Eb, C, Db. */
const TOPLINE = [77, 75, 72, 73];

type Kind = "intro" | "verse" | "chorus" | "break" | "final" | "outro";
const SECTIONS: readonly (readonly [string, Kind, number, number])[] = [
  ["Intro", "intro", 0, 8],
  ["Verse 1", "verse", 8, 8],
  ["Chorus 1", "chorus", 16, 8],
  ["Verse 2", "verse", 24, 8],
  ["Chorus 2", "chorus", 32, 8],
  ["Break", "break", 40, 8],
  ["Last chorus", "final", 48, 16],
  ["Outro", "outro", 64, 6],
];

const chordsFor = (kind: Kind): readonly Chord[] =>
  kind === "verse"
    ? VERSE
    : kind === "break"
      ? BREAK
      : kind === "outro"
        ? OUTRO
        : CHORUS;

export const glowStick: DemoDefinition = {
  info: demoInfo({
    id: "glow-stick",
    title: "Glow Stick",
    style: "Hyperpop",
    description:
      "Twee house-pop in Db major at 128: electric piano and voices alone for the intro hook, plain low verses over a four-on-the-floor with no bass, a bass that arrives only for the chorus and pumps under the whole mix, harp sweeps, a drumless break, a half-bar stop and a long last chorus with strings on top.",
    tempoBpm: BPM,
    key: "Db",
    bars: BARS,
    highlightBar: 16,
    trackId: "ep",
    features: [
      "an intro with no drums: the hook sung once over electric piano and voices",
      "verses sung low and close, Ab3 to F4, with pickups and rests",
      "the bass plays only in the choruses: the lift is the low end arriving",
      "a plain four-on-the-floor kick and clap with a deep whole-mix pump",
      "harp sweeps into every chorus; pizzicato and vibraphone answer the voice",
      "a drumless break with one plain line, then a half-bar stop",
      "a last chorus with strings on top and a hook that changes on its last repeat",
    ],
    arrangement: SECTIONS.map(([name, , , bars]) => `${name} ${bars}`),
    mixNotes: [
      "the voice sits on top, louder than the drums, close and only lightly wet",
      "everything but the vocal pumps hard from the kick on orbit 2",
      "the top end stays soft: gloss comes from reverb and chorus, not brightness",
      "the verses have no bass; the chorus bass is the loudest change in the song",
      "the break and the intro are drumless and wide",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    // The lead sits 7 dB under the shelf's level, inside the dense chorus.
    const vox = vocalTrack(BOOK, 0.45);

    // Chorus doubles: the lead a few cents sharp and flat, panned wide.
    const double = (id: string, cents: number, pan: number, seed: number) =>
      vocalTrack(BOOK, 0.4 * UNDER_WORDS, {
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
        reverb: { mix: 0.22, size: 0.7, fade: 2.4, lowpass: 8000 },
      });
    for (const track of [
      sounds.kick(BPM, "syn909", 0.92, 0.25),
      sounds.snare(0.5, "syn909", { name: "Clap" }),
      sounds.hats(0.2, "syn909", {
        filter: { type: "hpf", cutoff: 600, resonance: 0 },
        fx: { eq: { high: -2, highfreq: 9000 } },
      }),
      preset("bass", "FM bass", "fm-bass", 0.37, { fx: { ...orbit } }),
      preset("ep", "DX piano", "dx-ep", 0.26, {
        filter: { type: "lpf", cutoff: 5200, resonance: 0.05 },
        fx: { ...orbit, chorus: { rate: 0.6, depth: 0.5, mix: 0.4 } },
        reverb: { mix: 0.2, size: 0.6, fade: 2, lowpass: 7000 },
      }),
      preset("pump", "Pumping chords", "pumping-chords", 0.1, {
        filter: { type: "lpf", cutoff: 3600, resonance: 0.1 },
        fx: { ...orbit },
        reverb: { mix: 0.22, size: 0.7, fade: 2.4, lowpass: 6000 },
      }),
      preset("voices", "Glass voices", "glass-voices", 0.11, {
        fx: { ...orbit },
        reverb: { mix: 0.35, size: 0.9, fade: 3.4, lowpass: 6000 },
      }),
      preset("harp", "Harp", "harp", 0.3, {
        pan: 0.2,
        reverb: { mix: 0.3, size: 0.8, fade: 2.6, lowpass: 7000 },
      }),
      preset("pizz", "Pizzicato", "pizzicato", 0.3, {
        pan: -0.25,
        fx: { ...orbit },
        reverb: { mix: 0.18, size: 0.5, fade: 1.4 },
        humanize: { timing: 4, velocity: 8, seed: 81 },
      }),
      preset("kal", "Kalimba", "kalimba", 0.24, {
        pan: 0.3,
        fx: { ...orbit },
        delay: { beats: 0.75, feedback: 0.3, mix: 0.16, pingpong: true },
        reverb: { mix: 0.16, size: 0.5, fade: 1.4 },
        humanize: { timing: 5, velocity: 8, seed: 82 },
      }),
      preset("vibes", "Vibraphone", "vibraphone", 0.24, {
        pan: -0.2,
        fx: { ...orbit },
        delay: { beats: 0.5, feedback: 0.3, mix: 0.14, pingpong: true },
        reverb: { mix: 0.22, size: 0.6, fade: 2 },
      }),
      preset("strings", "Violins", "violin-section", 0.11, {
        fx: { ...orbit },
        reverb: { mix: 0.3, size: 0.85, fade: 3 },
      }),
      vox,
      double("dblhi", 9, -0.55, 1),
      double("dbllo", -9, 0.55, 2),
      chopTrack(BOOK, 0.8, { humanize: { timing: 4, velocity: 6, seed: 83 } }),
      grainTrack(BOOK, 0.26),
      preset("riser", "Riser", "noise-riser", 0.14),
      preset("drop", "Sub drop", "sub-drop", 0.28),
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
    // A harp sweep up the chord in 32nds, landing on the next downbeat.
    const sweep = (bar: number, chord: Chord) => {
      const rungs = ladder(chord, 56, 92).slice(-16);
      rungs.forEach((p, i) =>
        s.note(
          "harp",
          bar,
          4 - (rungs.length - i) * 0.125,
          p,
          0.5,
          0.35 + i * 0.03,
        ),
      );
    };

    for (const [name, kind, start, bars] of SECTIONS) {
      s.section(name, start, bars);
      const chords = chordsFor(kind);
      for (let b = 0; b < bars; b++) {
        const bar = start + b;
        const ch = chords[b % chords.length]!;
        const odd = b % 2;
        const second = start >= 24;

        if (kind === "intro" || kind === "break" || kind === "outro") {
          // Piano and voices alone: held chords, a slow broken figure.
          hold(s, "voices", bar, 0, ch.tones, 3.9, 0.45);
          cell(
            s,
            "ep",
            bar,
            odd ? "0...2...1..3...." : "0..1..2...3..2..",
            ladder(ch, 56, 80),
            { velocity: 0.5 },
          );
          if (kind === "break") {
            s.note("ep", bar, 0, ch.bass + 12, 3.8, 0.45);
            if (b >= 4)
              cell(s, "harp", bar, "0.1.2.3.4.3.2.1.", ladder(ch, 61, 85), {
                velocity: 0.3 + (b - 4) * 0.05,
              });
          }
          continue;
        }

        // The drums: plain four-on-the-floor, clap on 2 and 4.
        s.grid("kick", bar, 36, "9...9...9...9...");
        s.grid("snare", bar, 39, "....9.......9...");
        if (kind === "verse") {
          s.grid(
            "hats",
            bar,
            42,
            second ? "3.7.3.7.3.7.3.7." : "..7...7...7...7.",
          );
          // House stabs on the offbeats, no bass under the verse.
          stab(
            s,
            "ep",
            bar,
            odd ? "..7...6...7..5.." : "..7...6...7...6.",
            ch.tones,
            0.5,
          );
          if (!second && odd)
            cell(s, "pizz", bar, "........0.2.4.2.", ladder(ch, 68, 85), {
              velocity: 0.55,
            });
          if (second)
            cell(
              s,
              "kal",
              bar,
              odd ? "0.1.2.4.2.1.3.2." : "0.2.1.3.2.4.3.1.",
              ladder(ch, 65, 84),
              {
                velocity: 0.4,
              },
            );
        } else {
          // The chorus: the bass arrives, pumping eighths with an octave pop.
          s.grid("hats", bar, 42, "4.6.4.6.4.6.4.6.", 0.9);
          s.grid("hats", bar, 46, "..6...6...6...6.", 0.8);
          s.grid("snare", bar, 38, "....5.......5...", 0.6);
          bassLine(
            s,
            "bass",
            bar,
            odd ? "0.0.2.0.0.0.2.0." : "0.0.0.0.2.0.0.0.",
            ch.bass,
            0.85,
          );
          hold(s, "pump", bar, 0, ch.tones, 3.9, 0.55);
          stab(
            s,
            "ep",
            bar,
            "..7...7...7...7.",
            ch.tones.map((p) => p + 12),
            0.45,
          );
          if (odd)
            cell(s, "vibes", bar, "0..2..4.2..1....", ladder(ch, 72, 89), {
              velocity: 0.45,
            });
          if (kind === "final") {
            s.note("strings", bar, 0, TOPLINE[b % 4]!, 3.9, 0.55);
            hold(s, "voices", bar, 0, ch.tones, 3.9, 0.35);
            // "glow" chops answering the hook in the line gaps.
            if (odd)
              cell(s, "chops", bar, "........0.1.2...", ladder(ch, 73, 85), {
                velocity: 0.55,
              });
          }
        }
      }
    }

    // Intro: the hook once over piano and voices, the held vowel under it.
    hold(s, "vgrain", 0, 0, [61, 68], 16, 0.4);
    sing("ch1", 4, -0.5);
    sing("ch4", 6);
    sweep(7, CHORUS[0]!);

    // Verses: pickups and late starts, never all on beat 1.
    sing("v1", 8, -0.5);
    sing("v2", 10, 0.5);
    sing("v3", 12, -0.25);
    sing("v4", 14, 0.5);
    sing("v5", 24, -0.5);
    sing("v6", 26, 0.5);
    sing("v7", 28, -0.25);
    sing("v8", 30, 0.5);
    for (const bar of [16, 32, 48, 56]) {
      sing("ch1", bar, -0.5, true);
      sing("ch2", bar + 2, 0, true);
      sing("ch3", bar + 4, -0.5, true);
      if (bar !== 56) sing("ch4", bar + 6, 0, true);
    }
    sing("last", 62, 0, true);
    for (const bar of [15, 31]) {
      sweep(bar, VERSE[3]!);
      roll(s, bar, 0.2, 0.6);
    }

    // The break: one plain line, then its echo; the kick returns under a riser.
    sing("br1", 40);
    sing("br2", 42, -0.25);
    sing("br1", 44);
    hold(s, "vgrain", 40, 0, [61, 68], 24, 0.4);
    s.grid("kick", 46, 36, "6...6...6...6...");
    roll(s, 46, 0.15, 0.7);
    s.grid("kick", 47, 36, "8...8...........");
    s.note("riser", 44, 0, 60, 13.9, 0.7);
    sweep(47, CHORUS[0]!);
    // The half-bar stop before the last chorus.
    dropout(s, 47, 2, 2, ["kick", "snare", "hats", "ep", "voices", "harp"]);
    s.note("drop", 48, 0, 36, 4, 0.6);

    // Outro: the last line's tail over piano, then nothing but the vowel.
    hold(s, "vgrain", 64, 0, [61, 68], 20, 0.35);
    hold(s, "voices", 68, 0, Db.tones, 7.9, 0.4);

    s.tracks.forEach((t, i) => {
      if (t.id === "vox")
        s.tracks[i] = {
          ...t,
          delayMixAutomation: throws(throwsAt, VOCAL_ECHO.mix, THROW_PEAK, 1),
        };
      if (t.id === "ep")
        s.tracks[i] = {
          ...t,
          filterAutomation: lanes(
            [0, 2400],
            [7.9, 2400],
            [8, 5200],
            [40, 2600],
            [48, 6000],
          ),
        };
    });
    return s.finish();
  },
};
