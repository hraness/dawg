/** Low Battery: half-time hyperpop with a ramped saw bass and a hard-saw solo. */
import { Composer, orbit } from "./build.ts";
import {
  chop,
  chopTrack,
  drop,
  dropout,
  drums,
  flick,
  hold,
  line,
  loop,
  merge,
  ramps,
  rhythm,
  sounds,
  steps,
  stutter,
  swells,
  throws,
  vocalSynthTrack,
  vocalTrack,
  type Chord,
  type DrumFamily,
} from "./hyperpop.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

const BPM = 140;
const BARS = 110;

// vi-IV-I-V in F, one chord a bar.
const LOOP: readonly Chord[] = [
  { bass: 38, tones: [57, 62, 65] }, // Dm
  { bass: 46, tones: [58, 62, 65] }, // Bb
  { bass: 41, tones: [57, 60, 65] }, // F
  { bass: 36, tones: [55, 60, 64] }, // C
];
// The breakdown borrows the minor four (Bb minor) for its plagal fall to F.
const BREAK_LOOP: readonly Chord[] = [
  LOOP[0]!,
  { bass: 46, tones: [58, 61, 65] }, // Bbm
  LOOP[2]!,
  LOOP[3]!,
];
const chordAt = (bar: number) =>
  (bar >= 56 && bar < 76 ? BREAK_LOOP : LOOP)[bar % 4]!;

type Scene = Readonly<{
  name: string;
  start: number;
  bars: number;
  drums: DrumFamily;
}>;
const SCENES: readonly Scene[] = [
  { name: "Low power", start: 0, bars: 8, drums: "none" },
  { name: "Taps", start: 8, bars: 16, drums: "taps" },
  { name: "Chops & drums", start: 24, bars: 8, drums: "half" },
  { name: "Drop", start: 32, bars: 16, drums: "trap" },
  { name: "Ride", start: 48, bars: 8, drums: "half" },
  { name: "Breakdown", start: 56, bars: 20, drums: "none" },
  { name: "Return", start: 76, bars: 8, drums: "broken" },
  { name: "Saw drop", start: 84, bars: 16, drums: "trap" },
  { name: "Power down", start: 100, bars: 10, drums: "none" },
];
const sceneAt = (bar: number) =>
  SCENES.find((s) => bar >= s.start && bar < s.start + s.bars)!;
const inBars = (from: number, to: number, fn: (bar: number) => void) => {
  for (let bar = from; bar < to; bar++) fn(bar);
};

// The soft high figure: a 3-3-2 cell falling over the chord tones, lifted
// above the gangsa (C6 to Bb6).
const PLUCK_GRID = "5..3..4.5..3..4.";
const pluckNotes = (c: Chord) => {
  const [a, b, d] = c.tones
    .map((t) => t + (t < 60 ? 36 : 24))
    .sort((x, y) => x - y);
  return [d!, b!, a!, d!, b!, a!];
};
// Gangsa: an interlocking F-major pentatonic cell in the upper mids, under
// the plucks.
const GANGSA: readonly (readonly [beat: number, pitch: number])[] = [
  [0, 72],
  [0.5, 74],
  [0.75, 77],
  [1.5, 79],
  [2, 77],
  [2.75, 74],
  [3, 72],
  [3.5, 74],
  [4, 77],
  [4.5, 79],
  [4.75, 81],
  [5.5, 79],
  [6, 77],
  [6.5, 74],
  [7, 72],
  [7.75, 69],
];
// Stabs fall between the half-time kicks (steps 0, 7, 10) and the snare (8).
const STAB_GRID = "...6..6....6..6.";
const STAB_ACCENTS = [1, 0.8, 0.92, 0.78] as const;
/**
 * The sung hook (line A, then B two bars later) carries the long intro and
 * returns every eight bars of the drops; the chop cell loops underneath,
 * quieter while a line sings. The solo (84-91) has the top line to itself.
 */
const HOOK_BARS = [8, 12, 16, 20, 32, 40, 48, 60, 68, 76, 92] as const;
const singing = (bar: number) =>
  HOOK_BARS.some((b) => bar >= b && bar < b + 4);
/** Builds: a stutter bar, crushed chops and a noise sweep into each drop. */
const BUILDS = [31, 47, 83] as const;
/** Bars where the drums run without a break. */
const DRUM_RUNS: readonly (readonly [from: number, to: number])[] = [
  [24, 56],
  [76, 100],
];
const drumming = (bar: number) =>
  DRUM_RUNS.some(([a, b]) => bar >= a && bar < b);

export const lowBattery: DemoDefinition = {
  info: demoInfo({
    id: "low-battery",
    title: "Low Battery",
    style: "Hyperpop",
    description:
      "Half-time hyperpop in F at 140: a long drumless opening where the sung hook rides the looped-vowel voice synth, strings and bare hat taps for twenty-four bars, chopped vocals alone over a half-time kit, a trap-hat drop with syncopated stabs, a thirty-two-bar drum run, a twenty-bar breakdown on reverb strings and gangsa over a borrowed minor chord, a broken-beat return, a ramped saw-bass drop with a distorted hard-saw solo, and a ten-bar power-down that echoes out.",
    tempoBpm: BPM,
    key: "F",
    bars: BARS,
    highlightBar: 32,
    trackId: "chops",
    features: [
      "a sung hook (two lines) plus three chop syllables from the studio-v1 lights-out sample",
      "a twenty-four-bar drumless opening: the hook over voice synth, strings and hat taps",
      "a one-bar chop cell looped under the drum runs, the chops as an instrument",
      "chopped vocals alone over half-time drums before the bed comes in",
      "half-time, trap and broken drum families with hat rolls, rim clicks and open hats",
      "a ramped saw bass with glides in the saw drop and a soft, driven gliding sub elsewhere",
      "a hard-saw solo with octave scoops, wobble flicks, a tape-stop dive and automated distortion",
      "deep sidechain: pad, stabs, plucks, gangsa, bass and chops pump on the kick",
      "beat-long to bar-long dropouts and a twenty-bar drumless breakdown",
      "a ten-bar ending where plucks, chops and strings ride out on delay and reverb",
    ],
    arrangement: [
      "Low power 8",
      "Taps 16",
      "Chops & drums 8",
      "Drop 16",
      "Ride 8",
      "Breakdown 20",
      "Return 8",
      "Saw drop 16",
      "Power down 10",
    ],
    mixNotes: [
      "The harmony never leaves one loop (Dm Bb F C, a chord a bar); the breakdown swaps the Bb for Bb minor. The song moves by layers: the kick arrives at bar 24 with only the chops over it, then sub and stabs, then the pad, plucks and trap hats.",
      "Half time at 140 leaves room between the kicks for the stabs, which sit on the off-sixteenths around the kick and snare. Everything melodic except the strings and the sung lines pumps on the kick, about 12 dB.",
      "The saw drop swaps the sub's single held roots for a saw bass that swells in on each note and slides between them, with its drive opening across the section. The solo's distortion climbs to its peak and pulls back.",
    ],
  }),
  build() {
    const s = new Composer(lowBattery.info);
    for (const { name, start, bars } of SCENES) s.section(name, start, bars);

    s.track(sounds.kick(BPM, "syn909", 0.86, 0.6));
    s.track(
      sounds.snare(0.5, "lofi", {
        fxAutomation: {
          "distort-drive": ramps(
            [24, 2.6],
            [47, 4.6],
            [48, 3],
            [55, 5],
            [76, 3],
            [99, 5.5],
            [100, 3.6],
          ),
        },
      }),
    );
    s.track(sounds.hats(0.85, "electro"));
    s.track(sounds.drops(0.22));
    s.track(
      sounds.sub(0.46, {
        // Under the saw bass the sub only holds the roots.
        volumeAutomation: steps([0, 1], [84, 0.78], [100, 1]),
      }),
    );
    s.track(
      sounds.sawBass(0.3, {
        fx: { ...orbit, distort: { type: "soft", drive: 2.2, mix: 0 } },
        fxAutomation: {
          "distort-mix": ramps([84, 0], [92, 0.2], [98, 0.45], [99.9, 0.45]),
        },
      }),
    );
    s.track(
      sounds.pad(0.15, {
        volumeAutomation: steps([0, 0.8], [28, 1], [56, 0.85], [84, 1]),
      }),
    );
    s.track(
      sounds.stabs(0.2, {
        fxAutomation: {
          // Distortion fades in over each build bar, clean on the downbeat.
          "distort-mix": swells(
            0,
            0.6,
            BUILDS.map((b) => [b, b + 1] as const),
          ),
        },
      }),
    );
    s.track(
      sounds.pluck(0.11, {
        delayFeedbackAutomation: ramps([0, 0.28], [100, 0.28], [103, 0.62]),
        delayMixAutomation: ramps([0, 0.16], [100, 0.16], [102, 0.42]),
      }),
    );
    s.track(sounds.bells(0.11));
    s.track(
      sounds.strings(0.2, {
        volumeAutomation: merge(
          steps([0, 0.85], [56, 1], [100, 1]),
          ramps([103, 1], [109.9, 0]),
        ),
      }),
    );
    s.track(
      sounds.lead(0.2, {
        fxAutomation: {
          // The solo starts nearly clean and tears open at its peak.
          "distort-drive": ramps([84, 1.5], [87, 3], [89, 6.5], [91.9, 2]),
        },
      }),
    );
    s.track(
      vocalTrack("lights-out", 0.58, {
        // Quarter-note throws on "out" and "on".
        delayMixAutomation: throws(
          HOOK_BARS.flatMap((b) => [b + 0.875, b + 2.625]),
          0.04,
          0.36,
          1.25,
        ),
      }),
    );
    s.track(
      chopTrack("lights-out", 0.4, {
        fxAutomation: {
          "crush-bits": swells(
            16,
            5,
            BUILDS.map((b) => [b, b + 1] as const),
          ),
          "crush-mix": swells(
            0,
            0.7,
            BUILDS.map((b) => [b, b + 1] as const),
          ),
        },
        delayFeedbackAutomation: ramps([0, 0.28], [100, 0.28], [103, 0.6]),
        delayMixAutomation: ramps([0, 0.07], [100, 0.07], [101, 0.38]),
      }),
    );
    s.track(vocalSynthTrack("lights-out", 2, 67, 0.22));
    s.track(
      sounds.sweep(0.11, {
        filterAutomation: merge(
          ...[...BUILDS, 75].map((b) =>
            ramps([0, 500], [b - 3, 500], [b + 0.99, 7000], [b + 1, 500]),
          ),
        ),
      }),
    );

    // ----------------------------------------------------------- drums
    const roll = (bar: number, beat: number, count: number, step: number) => {
      for (let i = 0; i < count; i++)
        s.note("hats", bar, beat + i * step, 42, 0.08, 0.3 + (0.3 * i) / count);
    };
    inBars(0, BARS, (bar) => {
      const scene = sceneAt(bar);
      if (scene.drums === "none") return;
      const into = bar - scene.start;
      const last = into === scene.bars - 1;
      const variant = into % 4 === 3 ? 1 : 0;
      if (scene.name === "Taps" && into < 4)
        // The first taps are rim clicks alone.
        drums(s, bar, "taps", 0.8, variant, ["rim"]);
      else if (scene.name === "Chops & drums" && into < 4)
        // Kick and hats only under the first chops.
        drums(s, bar, "half", 0.95, 0, ["kick", "hat"]);
      else if (scene.name === "Ride" && into >= 4) {
        // The open hats come back over the half-time kit.
        drums(s, bar, "half", 1, variant);
        s.grid("hats", bar, 46, "..5...5...5...5.", 0.9);
      } else drums(s, bar, scene.drums, into < 2 ? 0.9 : 1, variant);
      if (scene.drums === "trap" && into % 4 === 1)
        // A triplet roll into beat four.
        roll(bar, 3, 6, 1 / 6);
      if (scene.drums === "trap" && into % 8 === 7) roll(bar, 2, 8, 0.125);
      if (scene.name === "Saw drop" && into >= 8)
        s.grid("hats", bar, 46, "......5.......5.", 0.85);
      if (last && scene.drums !== "taps" && bar !== 99)
        // A muted snare pickup run into the next scene.
        for (const [beat, v] of [
          [3, 0.5],
          [3.25, 0.6],
          [3.5, 0.7],
          [3.75, 0.85],
        ] as const)
          s.note("snare", bar, beat, 38, 0.1, v);
    });
    // Water drops wander over the taps and the breakdown.
    for (const [bar, beat, pitch] of [
      [9, 1.75, 89],
      [10, 3.25, 96],
      [11, 2.5, 93],
      [13, 0.75, 91],
      [14, 3.5, 96],
      [15, 2.25, 89],
      [18, 1.5, 93],
      [21, 3.25, 89],
      [23, 0.5, 96],
      [59, 2.75, 96],
      [63, 1.25, 91],
      [66, 3.5, 93],
      [71, 0.5, 89],
      [73, 1.5, 93],
      [74, 3.25, 89],
      [103, 2.75, 96],
    ] as const)
      drop(s, bar, beat, pitch, 0.55);
    // Hat taps return under the end of the breakdown.
    inBars(72, 76, (bar) => drums(s, bar, "taps", 0.7 + (bar - 72) * 0.08));
    // Noise sweeps under the last bars of each build, tucked into the hats.
    for (const bar of [...BUILDS, 75]) s.note("sweep", bar - 3, 0, 60, 16, 0.5);

    // ------------------------------------------------------------ bass
    const subBar = (bar: number, busy: boolean) => {
      const { bass } = chordAt(bar);
      const next = chordAt(bar + 1).bass;
      if (!busy) {
        // A held root that slides into the next one.
        s.note("sub", bar, 0, bass, 4.05, 0.72, { glide: 0.35 });
        return;
      }
      // Follow the half-time kick (beats 0, 1.75, 2.5), then slide on.
      s.note("sub", bar, 0, bass, 1.7, 0.75, { glide: 0.2 });
      s.note("sub", bar, 1.75, bass, 0.7, 0.62);
      const hop = bass + 12 <= 52 ? bass + 12 : bass + 7;
      s.note("sub", bar, 2.5, hop, 1, 0.62, { glide: 0.09 });
      s.note("sub", bar, 3.5, next, 0.55, 0.62, { glide: 0.16 });
    };
    inBars(12, 24, (bar) => subBar(bar, false));
    inBars(24, 56, (bar) => subBar(bar, bar >= 32 && bar < 48));
    inBars(60, 76, (bar) => subBar(bar, false));
    inBars(76, 100, (bar) => subBar(bar, bar >= 92));
    s.note("sub", 100, 0, 38, 6, 0.6, {
      glide: 0.3,
      ...flick.fall(-1200, 0.6),
    });
    // The saw: quiet harmonics over the sub through the drum runs, then the
    // featured bass of the saw drop, swelling into each note and sliding.
    inBars(28, 100, (bar) => {
      if (!drumming(bar)) return;
      const { bass } = chordAt(bar);
      const next = chordAt(bar + 1).bass;
      if (bar < 84) {
        s.note("saw", bar, 0, bass + 12, 3.4, 0.4, { glide: 0.2 });
        s.note("saw", bar, 3.5, next + 12, 0.5, 0.34, { glide: 0.16 });
        return;
      }
      s.note("saw", bar, 0, bass, 1.6, 0.72);
      s.note("saw", bar, 1.75, bass + 12, 0.6, 0.6, { glide: 0.06 });
      s.note("saw", bar, 2.5, bass, 0.9, 0.66, { glide: 0.08 });
      s.note("saw", bar, 3.5, next, 0.45, 0.6, { glide: 0.12 });
    });

    // ---------------------------------------------------------- chords
    inBars(0, 100, (bar) => {
      const c = chordAt(bar);
      // The pad sits out the first chops, the ride's start and the solo.
      const padded =
        (bar >= 4 && bar < 24) ||
        (bar >= 28 && bar < 48) ||
        (bar >= 52 && bar < 56) ||
        (bar >= 56 && bar < 84) ||
        bar >= 92;
      if (padded) hold(s, "pad", bar, 0, c.tones, 4, 0.44 + 0.03 * (bar % 4));
      if (drumming(bar) && !(bar >= 24 && bar < 28) && !(bar >= 76 && bar < 80)) {
        const lift = bar % 4 === 3 ? 1.1 : 1;
        let hitIndex = 0;
        [...STAB_GRID].forEach((hit, step) => {
          if (hit === ".") return;
          const accent = STAB_ACCENTS[hitIndex++ % STAB_ACCENTS.length]!;
          hold(
            s,
            "stabs",
            bar,
            step / 4,
            c.tones,
            0.3,
            (Number(hit) / 10) * accent * lift,
          );
        });
      }
    });
    // Plucks: from bar 8, out for the chops-over-drums, the breakdown's
    // first half, the return and the solo.
    inBars(8, 103, (bar) => {
      if ((bar >= 24 && bar < 32) || (bar >= 56 && bar < 64)) return;
      if ((bar >= 76 && bar < 80) || (bar >= 84 && bar < 92)) return;
      rhythm(s, "pluck", bar, PLUCK_GRID, pluckNotes(chordAt(bar)), {
        hold: 1,
        velocity: bar >= 100 ? 0.8 : 1,
      });
    });
    // Gangsa: the second half of the taps, the drop's lift, the ride, the
    // breakdown's middle and the last eight bars of the saw drop.
    inBars(16, 100, (bar) => {
      const on =
        (bar >= 16 && bar < 24) ||
        (bar >= 40 && bar < 56) ||
        (bar >= 64 && bar < 72) ||
        bar >= 92;
      if (!on || bar % 2) return;
      for (const [beat, pitch] of GANGSA)
        s.note("bells", bar, beat, pitch, 0.4, beat % 1 === 0 ? 0.6 : 0.45);
    });
    // Strings: the opening, the breakdown and the ending, swelling.
    inBars(0, 101, (bar) => {
      if (!(bar < 24 || (bar >= 56 && bar < 76) || bar === 100)) return;
      const c = chordAt(bar);
      const voicing = [
        c.bass + (c.bass > 40 ? 12 : 24),
        ...c.tones.map((t) => t + 12),
      ];
      hold(
        s,
        "strings",
        bar,
        0,
        voicing,
        bar === 100 ? 16 : 4,
        0.4 + 0.03 * (bar % 4),
      );
    });
    // The voice synth carries the opening chords and a breakdown riff.
    inBars(0, 76, (bar) => {
      if (!(bar < 16 || bar >= 56)) return;
      const top = chordAt(bar).tones.map((t) => t + 12);
      if (bar < 16 || (bar >= 60 && bar < 64) || (bar >= 68 && bar < 72)) {
        // Held under the opening and under the breakdown's hook.
        hold(s, "vsynth", bar, 0, top, 3.6, bar < 16 ? 0.5 : 0.36);
        return;
      }
      for (const [beat, len] of [
        [0, 0.75],
        [0.75, 0.75],
        [1.5, 1],
        [3, 0.5],
        [3.5, 0.5],
      ] as const)
        hold(s, "vsynth", bar, beat, top, len * 0.9, 0.5);
    });

    // ----------------------------------------------------------- voice
    line(s, 4, "a", 0.7);
    for (const bar of HOOK_BARS) {
      line(s, bar, "a");
      line(s, bar + 2, "b");
    }
    // The chop cell: lights / lights / out / on / out, one bar, looped; every
    // repitch diatonic. Under a sung line it sits back.
    const cell = (bar: number, lift = 0) => {
      const v = singing(bar) ? 0.62 : 1;
      chop(s, bar, 0, 0, 0.5, 0.8 * v);
      chop(s, bar, 0.75, 0, 0.25, 0.6 * v);
      chop(s, bar, 1.5, 1, 0.5, 0.75 * v, { cents: 300 + lift });
      chop(s, bar, 2.5, 2, 1, 0.8 * v, flick.up(-300, 0.1));
      chop(s, bar, 3.5, 1, 0.25, 0.6 * v, { cents: -200 });
    };
    // The turnaround: lights (down) / out / on-on-on-on / lights (wobble).
    const turn = (bar: number) => {
      const v = singing(bar) ? 0.66 : 1;
      chop(s, bar, 0, 0, 0.75, 0.75 * v, { cents: -300 });
      chop(s, bar, 1, 1, 0.25, 0.6 * v);
      stutter(s, bar, 1.5, 2, 4, 0.25, 0.5 * v, 0.8 * v, (i) =>
        i < 2 ? 0 : 200,
      );
      chop(s, bar, 2.5, 0, 1.25, 0.7 * v, flick.wobble(200, 6, 0.3));
    };
    // The cell enters quietly under the second half of the taps, plays alone
    // over the first kicks, then loops under the drum runs.
    loop(16, 24, (bar) => cell(bar), turn, 8);
    loop(24, 31, (bar) => cell(bar, bar >= 28 ? 200 : 0), turn, 8);
    loop(32, 47, cell, turn, 8);
    loop(48, 55, cell, turn, 8);
    loop(80, 83, cell, turn, 8);
    loop(92, 99, cell, turn, 8);
    // Stutter builds into each drop.
    for (const bar of BUILDS) {
      stutter(s, bar, 0, 0, 8, 0.25, 0.45, 0.8);
      stutter(s, bar, 2, 2, 8, 0.125, 0.5, 0.85, (i) => i * 100);
    }
    // The last bar of the drums: a tape-stop on the cell.
    chop(s, 99, 0, 0, 0.5, 0.8);
    chop(s, 99, 1, 1, 0.5, 0.75, { cents: 300 });
    chop(s, 99, 2, 2, 2, 0.8, flick.dive(-1200, 0.3));
    // Power down: one last "out" that the delay carries away.
    chop(s, 100, 0, 1, 2, 0.8, flick.fall(-500, 0.7));
    chop(s, 101, 2, 1, 1, 0.55, { cents: -200 });
    line(s, 101, "a", 0.7);

    // ------------------------------------------------------------ solo
    const solo: readonly (readonly [
      bar: number,
      beat: number,
      pitch: number,
      len: number,
      extra?: Partial<Parameters<Composer["note"]>[6]>,
    ])[] = [
      [84, 0, 81, 0.75, flick.up(-1200, 0.08)],
      [84, 0.75, 84, 0.75, { glide: 0.06 }],
      [84, 1.5, 86, 1.5, flick.wobble(200, 8, 0.25)],
      [84, 3, 84, 0.5, { glide: 0.05 }],
      [84, 3.5, 81, 0.5, { glide: 0.05 }],
      [85, 0, 86, 1.75, flick.fall(-500, 0.7)],
      [85, 2, 77, 0.5],
      [85, 2.5, 79, 0.5, { glide: 0.05 }],
      [85, 3, 82, 1, { glide: 0.08 }],
      [86, 0, 81, 0.5, flick.up(-700, 0.15)],
      [86, 0.5, 84, 0.25, { glide: 0.03 }],
      [86, 0.75, 86, 0.25, { glide: 0.03 }],
      [86, 1, 89, 2, flick.wobble(300, 10, 0.2)],
      [86, 3, 88, 1, { glide: 0.12 }],
      [87, 0, 91, 1, { glide: 0.08 }],
      [87, 1, 88, 0.5, { glide: 0.05 }],
      [87, 1.5, 86, 0.5, { glide: 0.05 }],
      [87, 2, 84, 2, flick.fall(-1200, 0.6)],
      [88, 0, 89, 0.25, flick.up(-1200, 0.3)],
      [88, 0.25, 88, 0.25],
      [88, 0.5, 89, 0.25],
      [88, 0.75, 91, 0.25, { glide: 0.03 }],
      [88, 1, 93, 1.5, flick.wobble(150, 12, 0.15)],
      [88, 2.5, 91, 0.5, { glide: 0.06 }],
      [88, 3, 89, 1, { glide: 0.1 }],
      [89, 0, 86, 1, flick.up(-200, 0.2)],
      [89, 1, 82, 0.5, { glide: 0.05 }],
      [89, 1.5, 86, 0.5, { glide: 0.05 }],
      [89, 2, 89, 2, flick.wobble(400, 8, 0.4)],
      [90, 0, 93, 0.5, flick.up(-1200, 0.2)],
      [90, 0.5, 91, 0.25],
      [90, 0.75, 89, 0.25],
      [90, 1, 84, 0.5, { glide: 0.04 }],
      [90, 1.5, 89, 1, { glide: 0.06 }],
      [90, 2.5, 93, 1.5, flick.wobble(200, 10, 0.2)],
      [91, 0, 96, 0.5, { glide: 0.04 }],
      [91, 0.5, 93, 0.5, { glide: 0.04 }],
      [91, 1, 91, 3, flick.dive(-2400, 0.35)],
    ];
    for (const [bar, beat, pitch, len, extra] of solo)
      s.note("lead", bar, beat, pitch, len, 0.7, extra ?? {});

    // -------------------------------------------------------- dropouts
    // Short holes for interest: half a beat to a whole bar.
    const band = [
      "kick",
      "snare",
      "hats",
      "sub",
      "saw",
      "stabs",
      "pad",
      "pluck",
      "bells",
    ];
    const floor = ["kick", "snare", "hats", "sub", "saw"];
    dropout(s, 39, 3, 1, band);
    dropout(s, 43, 2, 2, [...floor, "stabs"]);
    dropout(s, 47, 0, 4, [...floor, "pad", "pluck", "bells"]);
    dropout(s, 51, 3.5, 0.5, floor);
    dropout(s, 55, 2, 2, [...floor, "stabs", "bells"]);
    // The return opens on drums, bass and pad under line A; the stabs and
    // plucks come back with line B.
    dropout(s, 87, 3, 1, band);
    dropout(s, 91, 3.5, 0.5, floor);
    dropout(s, 95, 2, 2, [...floor, "stabs"]);
    dropout(s, 99, 2, 2, [...floor, "stabs", "pad", "pluck", "bells"]);
    return s.finish();
  },
};
