/**
 * Light One: cathedral pop in F major at 122. Church organ and tubular bells
 * open the song; the verses run on a sixteenth-note pluck arpeggio under a
 * plain low vocal, and the chorus brings a choir, an 808 and the full kit.
 * The break is a small fugue: one two-bar subject enters on the organ, then
 * the pluck, the bass and the sung "ah" chops, each a few scale steps apart,
 * until the kick comes back under it and the voice sings over the counterpoint.
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
  throws,
  vocalTrack,
  type Chord,
  type VoxBank,
} from "./hyperpop.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

export const BPM = 122;
const BARS = 74;

/** The vocal book: lines in beats (scripts/vox/songs.py light-one-vox). */
export const BOOK: VoxBank = {
  sample: "light-one-vox",
  root: 65,
  syllables: ["light", "oh", "ah", "one", "mm"],
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
  v1: 4,
  v2: 4,
  v3: 4,
  v4: 4,
  v5: 4,
  v6: 4,
  v7: 4,
  v8: 4,
  ch1: 2,
  ch2: 3,
  ch3: 2,
  ch4: 2,
  br1: 2.5,
  br2: 3,
  last: 6,
};

const c = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
const F = c(41, 57, 60, 65, 69);
const Am7 = c(45, 57, 60, 64, 67);
const Bbmaj7 = c(46, 58, 62, 65, 69);
const C = c(48, 55, 60, 64, 67);
const Dm = c(38, 57, 62, 65, 69);
const CoverE = c(40, 55, 60, 64, 67);
const Bb = c(46, 58, 62, 65, 70);
const VERSE = [F, Am7, Bbmaj7, C];
const CHORUS = [Dm, CoverE, F, Bb];
const OUTRO = [Bb, C, Dm, F];

/** F major, for moving the fugue subject by scale steps. */
const SCALE = [0, 2, 4, 5, 7, 9, 11];
const degree = (pitch: number, steps: number): number => {
  const pc = (((pitch - 5) % 12) + 12) % 12;
  const i = SCALE.indexOf(pc);
  if (i < 0) throw new Error(`not in F major: ${pitch}`);
  const k = i + steps;
  const oct = Math.floor(k / 7);
  return pitch - SCALE[i]! + SCALE[((k % 7) + 7) % 7]! + oct * 12;
};
/** The fugue subject: two bars of eighths, tonic to tonic. */
const SUBJECT = [
  65, 69, 72, 69, 70, 67, 69, 65, 64, 67, 72, 70, 69, 67, 65, 64,
];

type Kind = "intro" | "verse" | "chorus" | "fugue" | "final" | "outro";
const SECTIONS: readonly (readonly [string, Kind, number, number])[] = [
  ["Intro", "intro", 0, 8],
  ["Verse 1", "verse", 8, 8],
  ["Chorus 1", "chorus", 16, 8],
  ["Verse 2", "verse", 24, 8],
  ["Chorus 2", "chorus", 32, 8],
  ["Fugue", "fugue", 40, 16],
  ["Last chorus", "final", 56, 12],
  ["Outro", "outro", 68, 6],
];

export const lightOne: DemoDefinition = {
  info: demoInfo({
    id: "light-one",
    title: "Light One",
    style: "Hyperpop",
    description:
      "Cathedral pop in F major at 122: church organ and tubular bells, a sixteenth-note pluck arpeggio under low plain verses, a choir and 808 in the chorus, and a sixteen-bar fugue break where one subject passes from organ to pluck to bass to sung chops before the voice returns over the counterpoint.",
    tempoBpm: BPM,
    key: "F",
    bars: BARS,
    highlightBar: 40,
    trackId: "organ",
    features: [
      "church organ and tubular bells for the intro, the hook sung once over them",
      "verses sung low, G3 to F4, over a sixteenth-note pluck arpeggio",
      "the chorus brings a soprano choir, an 808 and the full kit",
      "a sixteen-bar fugue: one subject entering on organ, pluck, bass and sung chops",
      "each entry a few scale steps from the last, so the voices stack into chords",
      "the kick returns under the fugue and the voice sings over it",
      "a twelve-bar last chorus and an organ-only outro",
    ],
    arrangement: SECTIONS.map(([name, , , bars]) => `${name} ${bars}`),
    mixNotes: [
      "the voice sits on top and close; the organ stays under it",
      "the pluck arpeggio pumps from the kick on orbit 2",
      "the fugue voices are panned apart so each entry is heard",
      "the 808 plays only in the choruses",
    ],
  }),
  build() {
    const s = new Composer(this.info);
    const vox = vocalTrack(BOOK, 1, {
      reverb: { mix: 0.16, size: 0.7, fade: 2.4, lowpass: 8500 },
    });
    // Chorus doubles: the lead a few cents sharp and flat, panned wide.
    const double = (id: string, cents: number, pan: number, seed: number) =>
      vocalTrack(BOOK, 0.38, {
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
        reverb: { mix: 0.26, size: 0.8, fade: 2.8, lowpass: 7500 },
      });
    for (const track of [
      sounds.kick(BPM, "syn707", 0.85, 0.55),
      sounds.snare(1, "syn707", { name: "Clap" }),
      sounds.hats(0.34, "syn707"),
      preset("bass", "808", "808-boom", 0.19, { fx: { ...orbit } }),
      preset("organ", "Church organ", "church-organ", 0.14, {
        pan: -0.2,
        reverb: { mix: 0.34, size: 0.9, fade: 3.6, lowpass: 6000 },
      }),
      preset("arp", "Pluck arp", "pluck-arp", 0.15, {
        pan: 0.22,
        filter: { type: "lpf", cutoff: 4200, resonance: 0.1 },
        fx: { ...orbit },
        delay: { beats: 0.75, feedback: 0.25, mix: 0.14, pingpong: true },
        reverb: { mix: 0.18, size: 0.6, fade: 1.8 },
      }),
      preset("choir", "Soprano choir", "soprano", 0.18, {
        fx: { ...orbit },
        reverb: { mix: 0.38, size: 0.9, fade: 3.4, lowpass: 6500 },
      }),
      preset("bells", "Tubular bells", "tubular-bells", 0.2, {
        pan: 0.3,
        reverb: { mix: 0.34, size: 0.9, fade: 3.4 },
      }),
      vox,
      double("dblhi", 9, -0.55, 1),
      double("dbllo", -9, 0.55, 2),
      chopTrack(BOOK, 0.7, {
        pan: 0.35,
        humanize: { timing: 3, velocity: 6, seed: 101 },
      }),
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
    /** One fugue entry: the subject `steps` scale steps away, `octave` octaves off. */
    const entry = (
      track: string,
      bar: number,
      steps: number,
      octave = 0,
      velocity = 0.5,
      every = 1,
    ) =>
      SUBJECT.forEach((p, i) => {
        if (i % every) return;
        s.note(
          track,
          bar + Math.floor(i / 8),
          (i % 8) / 2,
          degree(p, steps) + octave * 12,
          every / 2 - 0.05,
          velocity * (i % 4 === 0 ? 1 : 0.85),
        );
      });

    for (const [name, kind, start, bars] of SECTIONS) {
      s.section(name, start, bars);
      if (kind === "fugue") continue;
      const chords =
        kind === "verse" || kind === "intro"
          ? VERSE
          : kind === "outro"
            ? OUTRO
            : CHORUS;
      for (let b = 0; b < bars; b++) {
        const bar = start + b;
        const ch = chords[b % chords.length]!;
        const odd = b % 2;
        const arp = ladder(ch, 60, 84);

        if (kind === "intro" || kind === "outro") {
          hold(s, "organ", bar, 0, [ch.bass + 12, ...ch.tones], 3.9, 0.45);
          if (b % 4 === 0)
            s.note("bells", bar, 0, ch.tones.at(-1)! + 12, 3, 0.4);
          if (kind === "intro" && b >= 4)
            cell(s, "arp", bar, "0.1.2.3.0.1.2.3.", arp, {
              velocity: 0.3 + (b - 4) * 0.05,
            });
          continue;
        }

        if (kind === "verse") {
          const second = start >= 24;
          // The arpeggio runs the whole verse; the kit ticks, the kick waits.
          cell(s, "arp", bar, "0123210123432101", arp, { velocity: 0.42 });
          hold(s, "organ", bar, 0, ch.tones, 3.9, 0.3);
          s.grid("hats", bar, 42, "..5...5...5...5.", 0.8);
          if (second || b >= 4) {
            s.grid("kick", bar, 36, "9.......9.......");
            s.grid("snare", bar, 39, "....7.......7...", 0.8);
          }
          if (second) s.grid("hats", bar, 42, "3.3.3.3.3.3.3.3.", 0.6);
        } else {
          // The chorus: the choir, the 808, the full kit, bells on the one.
          s.grid(
            "kick",
            bar,
            36,
            odd ? "9.....9...9....." : "9.....9.....9...",
          );
          s.grid("snare", bar, 39, "....9.......9...");
          s.grid("hats", bar, 42, "5.7.5.7.5.7.5.75");
          s.grid("hats", bar, 46, "..6.......6.....", 0.7);
          bassLine(
            s,
            "bass",
            bar,
            odd ? "0-----0---2-0---" : "0-----0-----1---",
            ch.bass,
            0.85,
          );
          cell(s, "arp", bar, "0123432101234321", ladder(ch, 64, 88), {
            velocity: 0.5,
          });
          hold(
            s,
            "choir",
            bar,
            0,
            ch.tones.map((p) => p + 12),
            3.9,
            0.45,
          );
          hold(s, "organ", bar, 0, ch.tones, 3.9, 0.3);
          if (!odd) s.note("bells", bar, 0, ch.tones.at(-1)! + 12, 2, 0.35);
          if (kind === "final" && b % 4 === 3)
            cell(s, "chops", bar, "........0.1.2.1.", ladder(ch, 65, 77), {
              velocity: 0.5,
            });
        }
      }
    }

    // Intro: the hook once over organ and bells.
    hold(s, "vgrain", 0, 0, [53, 60], 16, 0.36);
    sing("ch1", 4, -0.5);
    sing("ch4", 6);

    // Verses: a line every two bars, a pickup or a late start each time.
    const verses = [
      ["v1", 8, -0.5],
      ["v2", 10, 0],
      ["v3", 12, -0.5],
      ["v4", 14, 0.5],
      ["v5", 24, -0.5],
      ["v6", 26, 0],
      ["v7", 28, -0.5],
      ["v8", 30, 0.5],
    ] as const;
    for (const [part, bar, beat] of verses) sing(part, bar, beat);
    for (const bar of [16, 32, 56]) {
      sing("ch1", bar, 0, true);
      sing("ch2", bar + 2, -0.5, true);
      sing("ch3", bar + 4, 0, true);
      sing("ch4", bar + 6, -0.5, true);
    }
    sing("ch1", 64, 0, true);
    sing("last", 66, -0.5, true);
    for (const bar of [15, 31]) roll(s, bar, 0.2, 0.6);

    // The fugue. Organ alone, then the pluck a fifth up, the bass, the sung
    // chops; each voice keeps the subject going, a few scale steps apart.
    const F0 = 40;
    for (let k = 0; k < 8; k++) {
      const bar = F0 + k * 2;
      entry("organ", bar, k % 2 ? 2 : 0, 0, 0.5);
      if (k >= 1) entry("arp", bar, 4, 0, 0.42);
      if (k >= 2) entry("bass", bar, 0, -2, 0.7, 2);
      if (k >= 3) entry("chops", bar, k % 2 ? 4 : 2, 0, 0.5, 2);
      if (k >= 4) {
        s.grid("kick", bar, 36, "9.......9.......", 0.8);
        s.grid("kick", bar + 1, 36, "9.......9.......", 0.8);
      }
      if (k >= 5) {
        s.grid("hats", bar, 42, "..5...5...5...5.", 0.7);
        s.grid("hats", bar + 1, 42, "..5...5...5...5.", 0.7);
        hold(s, "choir", bar, 0, [77, 81], 7.8, 0.3);
      }
    }
    sing("br1", 48, -0.5);
    sing("br2", 50, 0);
    sing("br1", 52, -0.5);
    sing("br2", 54, 0);
    s.note("bells", 40, 0, 77, 4, 0.4);
    s.note("riser", 52, 0, 60, 15.9, 0.6);
    roll(s, 55, 0.2, 0.7);
    dropout(s, 55, 3, 1, ["organ", "arp", "bass", "chops", "choir"]);
    s.note("drop", 56, 0, 36, 4, 0.55);

    // Outro: the organ alone under the held vowel.
    hold(s, "vgrain", 68, 0, [53, 60], 20, 0.32);
    hold(s, "organ", 72, 0, [41, ...F.tones], 7.6, 0.4);

    s.tracks.forEach((t, i) => {
      if (t.id === "vox")
        s.tracks[i] = {
          ...t,
          delayMixAutomation: throws(throwsAt, 0.04, 0.28, 1),
        };
      if (t.id === "arp")
        s.tracks[i] = {
          ...t,
          filterAutomation: lanes(
            [0, 1800],
            [8, 2600],
            [16, 5200],
            [24, 3000],
            [32, 5200],
            [40, 3600],
            [56, 6000],
          ),
        };
    });
    return s.finish();
  },
};
