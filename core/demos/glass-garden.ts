/** Glass Garden: tresillo hyperpop with a gamelan shimmer and a breathy hook. */
import { Composer } from "./build.ts";
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

const BPM = 136;
const BARS = 112;

// IV-I-V-vi in A, one chord a bar: the hook's "need" lands on the tonic.
const LOOP: readonly Chord[] = [
  { bass: 38, tones: [57, 62, 66] }, // D
  { bass: 45, tones: [57, 61, 64] }, // A
  { bass: 40, tones: [56, 59, 64] }, // E
  { bass: 42, tones: [57, 61, 66] }, // F#m
];
// The breakdown borrows the minor four (D minor) so its first fall to A is
// plagal and dark, the one outside colour the references' loops tend to hold.
const BREAK_LOOP: readonly Chord[] = [
  { bass: 38, tones: [57, 62, 65] }, // Dm
  LOOP[1]!,
  LOOP[2]!,
  LOOP[3]!,
];
const chordAt = (bar: number) =>
  (bar >= 64 && bar < 76 ? BREAK_LOOP : LOOP)[bar % 4]!;

type Scene = Readonly<{
  name: string;
  start: number;
  bars: number;
  drums: DrumFamily;
}>;
const SCENES: readonly Scene[] = [
  { name: "Glass", start: 0, bars: 8, drums: "none" },
  { name: "Taps", start: 8, bars: 16, drums: "taps" },
  { name: "Light drums", start: 24, bars: 16, drums: "broken" },
  { name: "Drop", start: 40, bars: 16, drums: "tresillo" },
  { name: "Broken", start: 56, bars: 8, drums: "broken" },
  { name: "Breakdown", start: 64, bars: 12, drums: "none" },
  { name: "House drop", start: 76, bars: 16, drums: "house" },
  { name: "Last drop", start: 92, bars: 8, drums: "tresillo" },
  { name: "Glass fade", start: 100, bars: 12, drums: "none" },
];
const sceneAt = (bar: number) =>
  SCENES.find((s) => bar >= s.start && bar < s.start + s.bars)!;
const inBars = (from: number, to: number, fn: (bar: number) => void) => {
  for (let bar = from; bar < to; bar++) fn(bar);
};
const within = (
  bar: number,
  ...spans: readonly (readonly [number, number])[]
) => spans.some(([from, to]) => bar >= from && bar < to);

// Plucks in 3-3-2 groups, echoing the tresillo kick an octave of air above.
const PLUCK_GRID = "5..3..4.5..3..4.";
const pluckNotes = (c: Chord) => {
  const [a, b, d] = c.tones.map((t) => t + 24);
  return [d!, b!, a!, d!, b!, a!];
};
/**
 * Gangsa: an interlocking A-pentatonic cell over two bars. The first bar
 * (D or E) leans on E, F# and B, which suit both; the second (A or F#m) on
 * A, C# and E.
 */
const GANGSA: readonly (readonly [beat: number, pitch: number])[] = [
  [0, 83],
  [0.5, 78],
  [0.75, 76],
  [1.5, 78],
  [2, 83],
  [2.75, 78],
  [3, 76],
  [3.5, 78],
  [4, 81],
  [4.5, 85],
  [4.75, 81],
  [5.5, 76],
  [6, 81],
  [6.5, 85],
  [7, 85],
  [7.75, 81],
];
// Stabs push off the tresillo kick (0, 3, 7, 10, 13): never on a kick step.
const TRES_STABS = "..6..6.....6..6.";
// Over the house groove they sit between the kicks and the open hats.
const HOUSE_STABS = ".6...6...6..6...";
/** The first stab of each pair speaks, the answer sits back. */
const STAB_ACCENTS = [1, 0.8, 0.92, 0.76] as const;
/**
 * The hook (line A, line B two bars later) rides the long light-drums
 * stretch and returns every eight bars of the drops; the chop cell loops
 * underneath, quieter while a line sings. Bars 88-91 belong to the lead.
 */
const HOOK_BARS = [
  8, 12, 16, 20, 24, 32, 40, 48, 56, 68, 76, 84, 92, 96,
] as const;
const singing = (bar: number) => HOOK_BARS.some((b) => bar >= b && bar < b + 4);
/** Bars where the drums run without a break. */
const DRUM_RUNS: readonly (readonly [from: number, to: number])[] = [
  [24, 64],
  [76, 100],
];
const drumming = (bar: number) =>
  DRUM_RUNS.some(([a, b]) => bar >= a && bar < b);

export const glassGarden: DemoDefinition = {
  info: demoInfo({
    id: "glass-garden",
    title: "Glass Garden",
    style: "Hyperpop",
    description:
      "Tresillo hyperpop in A: a drumless gamelan-and-voice opening, sixteen bars of bare hat taps under the breathy sung hook, sixteen more over a light broken kick, then the full 3-3-2 kit for a pumping drop with stabs pushed off the kick, a broken-beat stretch on a ramped saw bass, a twelve-bar string breakdown over a borrowed minor chord, a house-hat drop with a restrained gliding lead, a last tresillo drop, and a twelve-bar glass fade.",
    tempoBpm: BPM,
    key: "A",
    bars: BARS,
    highlightBar: 40,
    trackId: "chops",
    features: [
      "a breathy sung hook (two lines) plus need / name / oh chops from the studio-v1 all-i-need sample",
      "a forty-bar drum run that starts light (a broken kick under the hook) and only fills out at bar 40",
      "a one-bar chop cell looped under the drum runs, the chops as an instrument",
      "chopped vocals alone over the first kicks before the bed comes in",
      "four drum families: tresillo, broken, house open hats and bare hat taps",
      "a gangsa cell over the tresillo drops, trading the top register with 3-3-2 plucks",
      "a ramped saw bass with automated drive over the broken beat, and saw harmonics under the sub",
      "a restrained hard-saw lead with glides, scoops and a small wobble",
      "beat- to bar-long dropouts and a twelve-bar drumless breakdown",
      "a twelve-bar ending where the hook, plucks and strings ring out",
    ],
    arrangement: [
      "Glass 8",
      "Taps 16",
      "Light drums 16",
      "Drop 16",
      "Broken 8",
      "Breakdown 12",
      "House drop 16",
      "Last drop 8",
      "Glass fade 12",
    ],
    mixNotes: [
      "Harmony never leaves the loop (D A E F#m, a chord a bar); the breakdown swaps the D for D minor. Contrast comes from the drums: a light broken kick under the hook for sixteen bars, tresillo for the drops, a broken beat over the saw bass, a house drop with open hats, and hat taps around the hook.",
      "Pad, stabs, plucks, gangsa, sub, saw bass, chops, voice synth and lead pump on the kick's orbit, about 12 dB; the strings and the sung lines stay steady on top. The sub is soft, driven and slides; the saw bass swells in and its drive climbs across the broken section.",
      "The sung lines throw a beat of delay on 'need' and 'name'. The chop cell loops bar after bar with a turnaround every eighth bar, repitched, stuttered and flicked, and crushes into each drop. The last twelve bars hold IV then I while delay feedback rises and reverb carries the hook out.",
    ],
  }),
  build() {
    const s = new Composer(glassGarden.info);
    for (const { name, start, bars } of SCENES) s.section(name, start, bars);

    s.track(sounds.kick(BPM, "syn909", 0.86, 0.6));
    s.track(
      sounds.snare(0.5, "lofi", {
        fxAutomation: {
          "distort-drive": ramps(
            [24, 2.4],
            [39, 3.2],
            [40, 2.8],
            [55, 4.6],
            [56, 3],
            [76, 2.8],
            [91, 4.6],
            [92, 3.4],
            [100, 3.4],
          ),
        },
      }),
    );
    s.track(
      sounds.hats(1, "syn606", {
        // The 3-3-2 and broken grids hold fewer hats than the four-floor
        // songs', so this kit gets a little more makeup to carry the air.
        fx: {
          compressor: {
            threshold: -18,
            ratio: 1.6,
            attack: 0.002,
            release: 0.08,
            makeup: 9,
          },
          eq: { high: 8, highfreq: 8000 },
        },
      }),
    );
    s.track(sounds.drops(0.22));
    s.track(sounds.sub(0.46));
    s.track(
      sounds.sawBass(0.28, {
        fx: {
          orbit: { orbit: 2 },
          distort: { type: "soft", drive: 1.4, mix: 0.35 },
        },
        // Drive climbs through the broken section, then lets go.
        fxAutomation: {
          "distort-drive": ramps([56, 1.4], [63.9, 4], [64, 1.4]),
        },
      }),
    );
    s.track(
      sounds.pad(0.15, {
        volumeAutomation: steps([0, 0.8], [40, 1], [56, 0.85], [76, 1]),
      }),
    );
    s.track(
      sounds.stabs(0.2, {
        fxAutomation: {
          "distort-mix": swells(0, 0.55, [
            [39, 40],
            [75, 76],
            [91, 92],
          ]),
        },
      }),
    );
    s.track(
      sounds.pluck(0.11, {
        delayFeedbackAutomation: ramps([0, 0.28], [100, 0.28], [104, 0.64]),
        delayMixAutomation: ramps([0, 0.16], [100, 0.16], [102, 0.44]),
      }),
    );
    s.track(sounds.bells(0.11));
    s.track(
      sounds.strings(0.2, {
        volumeAutomation: merge(
          steps([0, 0.75], [64, 1], [76, 0.8], [100, 1]),
          ramps([107, 1], [111.9, 0]),
        ),
      }),
    );
    s.track(
      sounds.lead(0.2, {
        fxAutomation: {
          // A little grit that opens on the last phrase, then backs off.
          "distort-drive": ramps([88, 1.4], [90, 2.2], [91.5, 3.4], [92, 1.6]),
        },
      }),
    );
    s.track(
      vocalTrack("all-i-need", 0.56, {
        // Throws catch the tails of "need" and "name", after their consonants,
        // so the echo repeats the vowel; the last "need" rings long.
        delayMixAutomation: merge(
          throws(
            HOOK_BARS.flatMap((b) => [b + 0.65, b + 3.125]),
            0.04,
            0.34,
            1.25,
          ),
          ramps([104.99, 0.04], [105, 0.44], [108, 0.44]),
        ),
        delayFeedbackAutomation: ramps([0, 0.38], [104, 0.38], [105, 0.58]),
      }),
    );
    s.track(
      chopTrack("all-i-need", 0.4, {
        fxAutomation: {
          "crush-bits": swells(16, 5, [
            [39, 40],
            [55, 56],
            [91, 92],
          ]),
          "crush-mix": swells(0, 0.7, [
            [39, 40],
            [55, 56],
            [91, 92],
          ]),
        },
        delayFeedbackAutomation: ramps([0, 0.28], [100, 0.28], [103, 0.6]),
        delayMixAutomation: ramps([0, 0.07], [100, 0.07], [101, 0.38]),
      }),
    );
    s.track(vocalSynthTrack("all-i-need", 2, 76, 0.22));
    s.track(
      sounds.sweep(0.1, {
        filterAutomation: merge(
          ...[
            [36, 40],
            [72, 76],
            [88, 92],
          ].map(([a, b]) =>
            ramps([0, 500], [a!, 500], [b! - 0.01, 6500], [b!, 500]),
          ),
        ),
      }),
    );

    // ----------------------------------------------------------- drums
    inBars(0, BARS, (bar) => {
      const scene = sceneAt(bar);
      if (scene.drums === "none") return;
      const into = bar - scene.start;
      const last = into === scene.bars - 1;
      const variant = into % 4 === 3 ? 1 : 0;
      if (scene.name === "Taps" && into < 4)
        // The first taps are rim clicks alone.
        drums(s, bar, "taps", 0.8, variant, ["rim"]);
      else if (scene.name === "Light drums" && into < 4)
        // Kick and hats only under the first chops.
        drums(s, bar, "broken", 0.66, 0, ["kick", "hat"]);
      else if (scene.name === "Light drums")
        // The broken kick stays light under the hook; the snare joins late.
        drums(
          s,
          bar,
          "broken",
          0.7,
          variant,
          into < 8 ? ["kick", "hat", "rim"] : ["kick", "snare", "hat", "rim"],
        );
      else drums(s, bar, scene.drums, into < 2 ? 0.9 : 1, variant);
      if (last && scene.drums !== "taps" && scene.drums !== "tresillo")
        // A muted snare pickup into the next scene.
        for (const [beat, v] of [
          [3, 0.5],
          [3.25, 0.6],
          [3.5, 0.7],
          [3.75, 0.85],
        ] as const)
          s.note("snare", bar, beat, 38, 0.1, v);
    });
    // Hat taps creep back under the end of the breakdown.
    inBars(72, 76, (bar) => drums(s, bar, "taps", 0.66 + (bar - 72) * 0.08));
    // Water drops over the glass intro, the taps, the breakdown and the fade.
    for (const [bar, beat, pitch] of [
      [2, 1.75, 88],
      [3, 3.25, 93],
      [5, 0.75, 90],
      [6, 2.5, 85],
      [7, 3.5, 93],
      [9, 2.25, 88],
      [11, 1.25, 93],
      [14, 3.25, 90],
      [17, 1.75, 88],
      [19, 3.5, 93],
      [22, 0.75, 90],
      [65, 1.5, 85],
      [67, 3.25, 90],
      [70, 0.75, 93],
      [73, 2.5, 88],
      [101, 2.25, 90],
      [103, 0.75, 93],
      [105, 3.5, 88],
    ] as const)
      drop(s, bar, beat, pitch, 0.55);
    // Noise sweeps under each build, tucked into the hats.
    for (const [from, bars] of [
      [36, 4],
      [72, 4],
      [88, 4],
    ] as const)
      s.note("sweep", from, 0, 60, bars * 4, 0.5);

    // ------------------------------------------------------------ bass
    const subBar = (bar: number, mode: "held" | "tresillo" | "house") => {
      const { bass } = chordAt(bar);
      const next = chordAt(bar + 1).bass;
      // The octave hop stays under the pad (a fifth when it would reach it).
      const hop = bass + 12 <= 52 ? bass + 12 : bass + 7;
      if (mode === "held") {
        // Softer under the light drums, so the drop has somewhere to go.
        const v = bar < 40 ? 0.56 : 0.7;
        s.note("sub", bar, 0, bass, 4.05, v, { glide: 0.35 });
        return;
      }
      if (mode === "tresillo") {
        // Follows the 3-3-2 kick, sliding between hits.
        s.note("sub", bar, 0, bass, 1.7, 0.76, { glide: 0.15 });
        s.note("sub", bar, 1.75, bass, 0.7, 0.66);
        s.note("sub", bar, 2.5, hop, 0.7, 0.64, { glide: 0.08 });
        s.note("sub", bar, 3.25, next, 0.8, 0.64, { glide: 0.14 });
        return;
      }
      s.note("sub", bar, 0, bass, 2.55, 0.75, { glide: 0.2 });
      s.note("sub", bar, 2.5, hop, 1, 0.62, { glide: 0.09 });
      s.note("sub", bar, 3.5, next, 0.55, 0.62, { glide: 0.16 });
    };
    inBars(12, 40, (bar) => subBar(bar, "held"));
    inBars(40, 56, (bar) => subBar(bar, "tresillo"));
    inBars(56, 64, (bar) => subBar(bar, "held"));
    inBars(68, 76, (bar) => subBar(bar, "held"));
    inBars(76, 92, (bar) => subBar(bar, "house"));
    inBars(92, 100, (bar) => subBar(bar, "tresillo"));
    s.note("sub", 100, 0, 38, 6, 0.58, {
      glide: 0.3,
      ...flick.fall(-1200, 0.6),
    });
    // The saw: quiet harmonics over the sub through the full-kit bars, and
    // the featured bass of the broken section, swelling in an octave up.
    inBars(40, 100, (bar) => {
      if (!drumming(bar)) return;
      const { bass } = chordAt(bar);
      const next = chordAt(bar + 1).bass;
      const featured = bar >= 56 && bar < 64;
      s.note("saw", bar, 0, bass + 12, 3.4, featured ? 0.72 : 0.4, {
        glide: 0.2,
      });
      if (bar !== 63)
        s.note("saw", bar, 3.5, next + 12, 0.5, featured ? 0.6 : 0.34, {
          glide: 0.12,
        });
    });

    // ---------------------------------------------------------- chords
    inBars(0, 100, (bar) => {
      const c = chordAt(bar);
      // The pad: the taps, the hook's bars of the light drums, the drops,
      // the breakdown and the house drop; out for the first kicks.
      if (within(bar, [12, 24], [28, 64], [64, 76], [76, 100]))
        hold(s, "pad", bar, 0, c.tones, 4, 0.42 + 0.03 * (bar % 4));
      const grid = within(bar, [40, 64], [92, 100])
        ? TRES_STABS
        : within(bar, [76, 92])
          ? HOUSE_STABS
          : undefined;
      if (!grid) return;
      const lift = bar % 4 === 3 ? 1.1 : 1;
      let hitIndex = 0;
      [...grid].forEach((hit, step) => {
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
    });
    // Plucks from bar 8. They hand the top register to the gangsa in the
    // tresillo drops and to the lead in its bars, and sit out the first kicks
    // and the breakdown's start.
    inBars(8, 104, (bar) => {
      if (within(bar, [24, 28], [44, 56], [64, 68], [88, 92], [96, 100]))
        return;
      rhythm(s, "pluck", bar, PLUCK_GRID, pluckNotes(chordAt(bar)), {
        hold: 1,
        velocity: bar >= 100 ? 0.8 - (bar - 100) * 0.1 : 1,
      });
    });
    // Gangsa: the glass intro, the light drums' second half, the tresillo
    // drops' second halves and the end of the breakdown.
    inBars(0, 100, (bar) => {
      if (bar % 2) return;
      if (!within(bar, [0, 8], [32, 40], [44, 56], [68, 72], [96, 100])) return;
      const soft = bar < 40 ? 0.82 : 1;
      for (const [beat, pitch] of GANGSA)
        s.note(
          "bells",
          bar,
          beat,
          pitch,
          0.4,
          (beat % 1 === 0 ? 0.6 : 0.45) * soft,
        );
    });
    // Strings: the opening, the breakdown and the ending, IV then I.
    const stringChord = (bar: number, beats: number, velocity: number) => {
      const c = chordAt(bar);
      hold(
        s,
        "strings",
        bar,
        0,
        [c.bass + (c.bass > 40 ? 12 : 24), ...c.tones.map((t) => t + 12)],
        beats,
        velocity,
      );
    };
    inBars(0, 24, (bar) => stringChord(bar, 4, 0.42 + 0.03 * (bar % 4)));
    inBars(64, 76, (bar) => stringChord(bar, 4, 0.42 + 0.03 * (bar % 4)));
    inBars(100, 104, (bar) => stringChord(bar, 4, 0.42));
    stringChord(104, 4, 0.44);
    stringChord(105, 12, 0.42);
    // The voice synth holds the opening chords and riffs the breakdown.
    inBars(0, 76, (bar) => {
      if (!(bar < 8 || bar >= 64)) return;
      const top = chordAt(bar).tones.map((t) => t + 12);
      if (bar < 8) hold(s, "vsynth", bar, 0, top, 3.6, 0.56);
      else
        for (const [beat, len] of [
          [0, 1.25],
          [1.5, 0.5],
          [2.25, 0.5],
          [2.75, 1],
        ] as const)
          hold(s, "vsynth", bar, beat, top, len * 0.9, 0.48);
    });
    hold(s, "vsynth", 104, 0, [69, 74, 78], 3.6, 0.38);
    hold(s, "vsynth", 105, 0, [69, 73, 76], 10, 0.36);

    // ----------------------------------------------------------- voice
    line(s, 4, "a", 0.7);
    for (const bar of HOOK_BARS) {
      line(s, bar, "a");
      line(s, bar + 2, "b");
    }
    // The chop cell: need / need / name / oh / name in 3-3-2, one bar,
    // looped. Over E the first "need" lifts a tone to B. Under a sung line
    // it sits back.
    const cell = (bar: number) => {
      const v = singing(bar) ? 0.62 : 1;
      const first = chordAt(bar).bass === 40 ? 200 : 0;
      chop(s, bar, 0, 0, 0.5, 0.8 * v, first ? { cents: first } : {});
      chop(s, bar, 0.75, 0, 0.5, 0.6 * v, { cents: -500 });
      chop(s, bar, 1.5, 1, 0.5, 0.75 * v);
      chop(s, bar, 2.5, 2, 0.5, 0.8 * v, flick.up(-300, 0.1));
      chop(s, bar, 3.25, 1, 0.5, 0.6 * v);
    };
    // The turnaround: oh-oh-oh-oh climbing / need (wobble) / name / oh (fall).
    const turn = (bar: number) => {
      const v = singing(bar) ? 0.66 : 1;
      stutter(
        s,
        bar,
        0,
        2,
        4,
        0.25,
        0.5 * v,
        0.8 * v,
        (i) => [0, 200, 400, 500][i]!,
      );
      chop(s, bar, 1, 0, 1.25, 0.75 * v, flick.wobble(200, 6, 0.3));
      chop(s, bar, 2.75, 1, 0.5, 0.6 * v, { cents: -400 });
      chop(s, bar, 3.25, 2, 0.75, 0.7 * v, flick.fall(-500, 0.6));
    };
    // The cell enters under the second half of the taps, plays alone over
    // the first kicks, then loops under the drum runs.
    loop(16, 24, cell, turn, 8);
    loop(24, 39, cell, turn, 8);
    loop(40, 55, cell, turn, 8);
    loop(56, 64, cell, turn, 8);
    loop(76, 88, cell, turn, 8);
    loop(92, 99, cell, turn, 8);
    // Stutter builds into each change of groove; "oh" climbs the A scale.
    const RISE = [0, 200, 400, 500, 700, 900, 1000, 1200] as const;
    for (const bar of [39, 55, 75, 91]) {
      stutter(s, bar, 0, 0, 8, 0.25, 0.45, 0.8);
      stutter(s, bar, 2, 2, 8, 0.125, 0.5, 0.85, (i) => RISE[i]!);
    }
    // The last bar of the drums: a tape-stop on the cell.
    chop(s, 99, 0, 0, 0.5, 0.8);
    chop(s, 99, 1, 1, 0.5, 0.75);
    chop(s, 99, 2, 2, 2, 0.8, flick.dive(-1200, 0.3));
    // The ending: "oh" falls away, then "all I need" over IV to I.
    chop(s, 100, 0, 2, 2, 0.75, flick.fall(-500, 0.7));
    chop(s, 102, 2, 0, 1, 0.5, { cents: -500 });
    line(s, 104, "a", 0.72);

    // ------------------------------------------------------------ lead
    // A restrained four-bar answer to the hook in the house drop.
    const lead: readonly (readonly [
      bar: number,
      beat: number,
      pitch: number,
      len: number,
      extra?: Partial<Parameters<Composer["note"]>[6]>,
    ])[] = [
      [88, 0, 78, 1.5, flick.up(-200, 0.15)],
      [88, 1.5, 76, 0.5, { glide: 0.05 }],
      [88, 2, 74, 1.5, { glide: 0.08 }],
      [88, 3.5, 76, 0.5, { glide: 0.05 }],
      [89, 0, 81, 2.5, flick.wobble(100, 6, 0.4)],
      [89, 2.5, 80, 0.5, { glide: 0.05 }],
      [89, 3, 78, 1, { glide: 0.06 }],
      [90, 0, 76, 1, flick.up(-500, 0.1)],
      [90, 1, 80, 0.5, { glide: 0.04 }],
      [90, 1.5, 83, 2, flick.wobble(150, 8, 0.3)],
      [90, 3.5, 81, 0.5, { glide: 0.05 }],
      [91, 0, 85, 2, { glide: 0.08 }],
      [91, 2, 81, 2, flick.fall(-700, 0.6)],
    ];
    for (const [bar, beat, pitch, len, extra] of lead)
      s.note("lead", bar, beat, pitch, len, 0.66, extra ?? {});

    // -------------------------------------------------------- dropouts
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
    dropout(s, 35, 3, 1, ["kick", "hats", "pad", "pluck", "bells"]);
    dropout(s, 47, 3, 1, band);
    dropout(s, 51, 2, 2, [...floor, "stabs"]);
    dropout(s, 55, 0, 4, band);
    dropout(s, 61, 2, 2, ["kick", "snare", "hats", "saw"]);
    dropout(s, 83, 3, 1, band);
    dropout(s, 87, 2, 2, [...floor, "stabs"]);
    dropout(s, 91, 3.5, 0.5, floor);
    dropout(s, 95, 3, 1, band);
    dropout(s, 99, 2, 2, [...floor, "stabs", "bells"]);
    return s.finish();
  },
};
