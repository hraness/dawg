/** Soft Reboot: four-floor hyperpop with a pumping bed and a chopped hook. */
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

const BPM = 130;
const BARS = 104;

// I-V-vi-IV in D, one chord a bar.
const LOOP: readonly Chord[] = [
  { bass: 38, tones: [57, 62, 66] }, // D
  { bass: 45, tones: [57, 61, 64] }, // A
  { bass: 47, tones: [59, 62, 66] }, // Bm
  { bass: 43, tones: [59, 62, 67] }, // G
];
// The breakdown borrows the minor four (G minor): the same loop, one colour
// darker, the way the references' loops carry one chord from outside the key.
const BREAK_LOOP: readonly Chord[] = [
  LOOP[0]!,
  LOOP[1]!,
  LOOP[2]!,
  { bass: 43, tones: [58, 62, 67] }, // Gm
];
const chordAt = (bar: number) =>
  (bar >= 56 && bar < 72 ? BREAK_LOOP : LOOP)[bar % 4]!;

type Scene = Readonly<{
  name: string;
  start: number;
  bars: number;
  drums: DrumFamily;
}>;
const SCENES: readonly Scene[] = [
  { name: "Boot", start: 0, bars: 8, drums: "none" },
  { name: "Taps", start: 8, bars: 8, drums: "taps" },
  { name: "Chops & drums", start: 16, bars: 8, drums: "four" },
  { name: "Drop", start: 24, bars: 16, drums: "four" },
  { name: "Ride", start: 40, bars: 16, drums: "house" },
  { name: "Breakdown", start: 56, bars: 16, drums: "none" },
  { name: "Second drop", start: 72, bars: 16, drums: "four" },
  { name: "Last drop", start: 88, bars: 8, drums: "house" },
  { name: "Afterglow", start: 96, bars: 8, drums: "none" },
];
const sceneAt = (bar: number) =>
  SCENES.find((s) => bar >= s.start && bar < s.start + s.bars)!;
const inBars = (from: number, to: number, fn: (bar: number) => void) => {
  for (let bar = from; bar < to; bar++) fn(bar);
};

// The soft high repeated figure: chord tones two octaves up, a 16th cell.
const PLUCK_GRID = "5.3.4.3..4.3.4.3";
const pluckNotes = (c: Chord) => {
  const [a, b, d] = c.tones.map((t) => t + 24);
  return [d!, b!, a!, b!, d!, a!, b!, a!];
};
// Gangsa: an interlocking pentatonic cell in the upper mids (two bars).
const GANGSA: readonly (readonly [beat: number, pitch: number])[] = [
  [0, 74],
  [0.5, 76],
  [0.75, 78],
  [1.5, 81],
  [2, 78],
  [2.75, 76],
  [3, 74],
  [3.5, 76],
  [4, 78],
  [4.5, 81],
  [4.75, 83],
  [5.5, 81],
  [6, 78],
  [6.5, 76],
  [7, 74],
  [7.75, 71],
];
// Stabs ride the offbeats around the four-floor kick.
const STAB_GRID = "..6..6....6..6..";
/**
 * The sung hook (line A, then B two bars later) returns every eight bars of
 * the drops; the chop cell loops underneath it, quieter while a line sings.
 * The solo (80-87) has the top line to itself.
 */
const HOOK_BARS = [8, 12, 24, 32, 40, 48, 60, 64, 72, 88, 92] as const;
const singing = (bar: number) => HOOK_BARS.some((b) => bar >= b && bar < b + 4);
/** The first stab of each half bar speaks, the answer sits back. */
const STAB_ACCENTS = [1, 0.82, 0.94, 0.78] as const;
/** Bars where the drums run without a break. */
const DRUM_RUNS: readonly (readonly [from: number, to: number])[] = [
  [16, 56],
  [72, 96],
];
const drumming = (bar: number) =>
  DRUM_RUNS.some(([a, b]) => bar >= a && bar < b);

export const softReboot: DemoDefinition = {
  info: demoInfo({
    id: "soft-reboot",
    title: "Soft Reboot",
    style: "Hyperpop",
    description:
      "Four-on-the-floor hyperpop in D: an eight-bar drumless boot, a section of bare hat taps under the sung hook, chopped vocals alone over the kick before the bed comes in, a forty-bar drum run that rotates its layers every eight bars, a sixteen-bar breakdown on reverb strings and a looped-vowel voice synth over a borrowed minor chord, a second drop with a gliding hard-saw solo, and a long echo fade.",
    tempoBpm: BPM,
    key: "D",
    bars: BARS,
    highlightBar: 32,
    trackId: "chops",
    features: [
      "a sung hook (two lines) plus three chop syllables from the studio-v1 stay-tonight sample",
      "a one-bar chop cell looped under the whole drop, the chops as an instrument",
      "chopped vocals alone over the drums before the other layers enter",
      "deep sidechain: pad, stabs, plucks, gangsa, sub and chops pump on the kick",
      "a looped-vowel voice synth playing the chords",
      "a forty-bar drum run with one-beat to one-bar dropouts, then a sixteen-bar drumless breakdown",
      "a hard-saw solo with glides, wobble flicks and automated distortion",
      "a muted, distorted snare and water-drop percussion",
      "an ending that leaves eight bars for delay and reverb to fade",
    ],
    arrangement: [
      "Boot 8",
      "Taps 8",
      "Chops & drums 8",
      "Drop 16",
      "Ride 16",
      "Breakdown 16",
      "Second drop 16",
      "Last drop 8",
      "Afterglow 8",
    ],
    mixNotes: [
      "Harmony stays on one loop (D A Bm G, a chord a bar); the breakdown swaps the G for G minor. The interest is in which layers play: the kick arrives at bar 16 with only the chops over it, then sub and stabs join, then the pad, plucks and gangsa, and the ride strips the pad back out before the breakdown.",
      "Everything melodic except the strings and the sung lines sits on the kick's orbit, so it pumps about 12 dB and recovers in a little over half a beat. The sub has a soft 50 ms attack, slides between roots and is driven for harmonics.",
      "The sung lines get quarter-note delay throws on their last word. The chop cell loops bar after bar with a turnaround every fourth bar; it stutters, jumps by note cents and crushes in the build bars. The ending lets the plucks, chops and strings ring into rising delay feedback and reverb for eight bars.",
    ],
  }),
  build() {
    const s = new Composer(softReboot.info);
    for (const { name, start, bars } of SCENES) s.section(name, start, bars);

    s.track(sounds.kick(BPM, "syn909", 0.86, 0.6));
    s.track(
      sounds.snare(0.5, "lofi", {
        fxAutomation: {
          // The snare grits up through each drop and relaxes after it.
          "distort-drive": ramps(
            [16, 2.4],
            [39, 4.5],
            [40, 3],
            [55, 5],
            [72, 2.8],
            [87, 5],
            [88, 3.5],
            [96, 3.5],
          ),
        },
      }),
    );
    s.track(sounds.hats(1, "syn606"));
    s.track(sounds.drops(0.22));
    s.track(sounds.sub(0.46));
    // The saw doubles the sub an octave up, low-passed: the bass's harmonics.
    s.track(sounds.sawBass(0.14));
    s.track(
      sounds.pad(0.15, {
        volumeAutomation: steps([0, 0.85], [24, 1], [56, 0.9], [96, 1]),
      }),
    );
    s.track(
      sounds.stabs(0.2, {
        fxAutomation: {
          // Distortion fades in over each build bar, clean on the downbeat.
          "distort-mix": swells(0, 0.6, [
            [38, 40],
            [54, 56],
            [86, 88],
          ]),
        },
      }),
    );
    s.track(
      sounds.pluck(0.11, {
        delayFeedbackAutomation: ramps([0, 0.28], [96, 0.28], [99, 0.62]),
        delayMixAutomation: ramps([0, 0.16], [96, 0.16], [98, 0.42]),
      }),
    );
    s.track(sounds.bells(0.11));
    s.track(
      sounds.strings(0.2, {
        volumeAutomation: merge(
          steps([0, 0.9], [56, 1], [72, 0.75], [96, 1]),
          ramps([98, 1], [103.9, 0]),
        ),
      }),
    );
    s.track(
      sounds.lead(0.2, {
        fxAutomation: {
          // The solo starts clean-ish and tears open at its peak.
          "distort-drive": ramps([80, 1.6], [83, 3], [85, 6.5], [87.9, 2]),
        },
      }),
    );
    s.track(
      vocalTrack("stay-tonight", 0.58, {
        // Quarter-note throws on "night" and "go".
        delayMixAutomation: throws(
          HOOK_BARS.flatMap((b) => [b + 0.75, b + 2.625]),
          0.04,
          0.36,
          1.25,
        ),
      }),
    );
    s.track(
      chopTrack("stay-tonight", 0.4, {
        fxAutomation: {
          "crush-bits": swells(16, 5, [
            [23, 24],
            [39, 40],
            [55, 56],
            [87, 88],
          ]),
          "crush-mix": swells(0, 0.7, [
            [23, 24],
            [39, 40],
            [55, 56],
            [87, 88],
          ]),
        },
        delayFeedbackAutomation: ramps([0, 0.28], [96, 0.28], [99, 0.6]),
        delayMixAutomation: ramps([0, 0.07], [96, 0.07], [97, 0.38]),
      }),
    );
    s.track(vocalSynthTrack("stay-tonight", 2, 74, 0.22));
    s.track(
      sounds.sweep(0.11, {
        filterAutomation: merge(
          ...[
            [20, 24],
            [52, 56],
            [68, 72],
            [84, 88],
          ].map(([a, b]) =>
            ramps([0, 500], [a!, 500], [b! - 0.01, 7000], [b!, 500]),
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
      if (scene.name === "Chops & drums" && into < 4)
        // Kick and hats only under the first chops.
        drums(s, bar, "four", 0.95, 0, ["kick", "hat"]);
      else
        drums(s, bar, scene.drums, into < 2 ? 0.9 : 1, into % 4 === 3 ? 1 : 0);
      // A muted snare pickup run into the next scene, where the drums go on
      // or the floor drops away.
      if (last && scene.drums !== "taps" && bar !== 95)
        for (const [beat, v] of [
          [3, 0.5],
          [3.25, 0.6],
          [3.5, 0.7],
          [3.75, 0.85],
        ] as const)
          s.note("snare", bar, beat, 38, 0.1, v);
    });
    // Water drops wander over the taps and the breakdown's end.
    for (const [bar, beat, pitch] of [
      [9, 1.75, 86],
      [10, 3.25, 93],
      [11, 2.5, 90],
      [13, 0.75, 88],
      [14, 3.5, 93],
      [15, 2.25, 86],
      [45, 3.25, 86],
      [47, 1.5, 93],
      [53, 1.5, 90],
      [54, 3.25, 86],
      [69, 2.75, 93],
      [70, 1.25, 88],
      [71, 3.5, 90],
      [99, 0.5, 86],
      [100, 3.75, 93],
    ] as const)
      drop(s, bar, beat, pitch, 0.55);
    // Hat taps return under the end of the breakdown.
    inBars(68, 72, (bar) => drums(s, bar, "taps", 0.7 + (bar - 68) * 0.08));

    // Noise sweeps under the last bars of each build, tucked into the hats.
    for (const [from, bars] of [
      [20, 4],
      [52, 4],
      [68, 4],
      [84, 4],
    ] as const)
      s.note("sweep", from, 0, 60, bars * 4, 0.5);

    // ------------------------------------------------------------ bass
    const subBar = (bar: number, busy: boolean) => {
      const { bass } = chordAt(bar);
      const next = chordAt(bar + 1).bass;
      if (!busy) {
        // Held root that slides into the next one.
        s.note("sub", bar, 0, bass, 4.05, 0.72, { glide: 0.35 });
        return;
      }
      s.note("sub", bar, 0, bass, 2.55, 0.75, { glide: 0.2 });
      // Up the octave on the "and" of three, then slide home for the next bar.
      // The octave hop stays under the pad (a fifth when it would reach it).
      const hop = bass + 12 <= 52 ? bass + 12 : bass + 7;
      s.note("sub", bar, 2.5, hop, 1, 0.62, { glide: 0.09 });
      s.note("sub", bar, 3.5, next, 0.55, 0.62, { glide: 0.16 });
    };
    inBars(4, 16, (bar) => subBar(bar, false));
    inBars(20, 56, (bar) => subBar(bar, bar >= 24 && !(bar >= 40 && bar < 44)));
    inBars(60, 72, (bar) => subBar(bar, false));
    inBars(72, 96, (bar) => subBar(bar, !(bar >= 80 && bar < 88)));
    s.note("sub", 96, 0, 38, 6, 0.6, { glide: 0.3, ...flick.fall(-1200, 0.6) });
    inBars(24, 96, (bar) => {
      if (!drumming(bar) || (bar >= 40 && bar < 44)) return;
      const { bass } = chordAt(bar);
      s.note("saw", bar, 0, bass + 12, 3.4, 0.7, { glide: 0.2 });
      s.note("saw", bar, 3.5, chordAt(bar + 1).bass + 12, 0.5, 0.6, {
        glide: 0.16,
      });
    });

    // ---------------------------------------------------------- chords
    inBars(0, 96, (bar) => {
      const c = chordAt(bar);
      // The pad: the boot, the drops, the breakdown and the end; the ride
      // strips it out for eight bars so its return at 48 is a lift.
      const padded =
        bar < 16 ||
        (bar >= 24 && bar < 40) ||
        (bar >= 48 && bar < 56) ||
        bar >= 60;
      if (padded)
        // Each pass of the loop leans into its last chord.
        hold(s, "pad", bar, 0, c.tones, 4, 0.44 + 0.03 * (bar % 4));
      // Stabs ride the offbeats around the kick, at chord pitch.
      if (drumming(bar) && !(bar >= 16 && bar < 20)) {
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
    // Plucks: from bar 4, out for the chops-over-drums, the stripped ride
    // bars and the first half of the breakdown. The solo has the top to itself.
    inBars(4, 98, (bar) => {
      if ((bar >= 16 && bar < 24) || (bar >= 40 && bar < 44)) return;
      if ((bar >= 56 && bar < 64) || (bar >= 80 && bar < 88)) return;
      rhythm(s, "pluck", bar, PLUCK_GRID, pluckNotes(chordAt(bar)), {
        hold: 1,
        velocity: bar >= 96 ? 0.8 : 1,
      });
    });
    // Gangsa: the second half of each drop, and the ride's lift.
    inBars(28, 96, (bar) => {
      const on =
        (bar >= 32 && bar < 40) ||
        (bar >= 44 && bar < 56) ||
        (bar >= 76 && bar < 80) ||
        bar >= 88;
      if (!on || bar % 2) return;
      for (const [beat, pitch] of GANGSA)
        s.note("bells", bar, beat, pitch, 0.4, beat % 1 === 0 ? 0.6 : 0.45);
    });
    // Strings: the intro, the whole breakdown and the ending, swelling.
    inBars(0, 100, (bar) => {
      if (!(bar < 16 || (bar >= 56 && bar < 72) || bar === 96)) return;
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
        bar === 96 ? 16 : 4,
        0.4 + 0.03 * (bar % 4),
      );
    });
    // The voice synth carries the boot and the breakdown chords.
    inBars(0, 72, (bar) => {
      if (!(bar < 8 || bar >= 56)) return;
      const c = chordAt(bar);
      const top = c.tones.map((t) => t + 12);
      if (bar < 8) hold(s, "vsynth", bar, 0, top, 3.6, 0.5);
      else
        // A syncopated vowel riff in the breakdown.
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
    // One sung line over the boot, then the two lines as a four-bar hook.
    line(s, 4, "a", 0.7);
    for (const bar of HOOK_BARS) {
      line(s, bar, "a");
      line(s, bar + 2, "b");
    }
    // The chop cell: stay / stay / night / go / go, one bar, looped. Under
    // a sung line it sits back; `lift` raises the repitch in the builds.
    const cell = (bar: number, lift = 0) => {
      const v = singing(bar) ? 0.62 : 1;
      chop(s, bar, 0, 0, 0.5, 0.8 * v);
      chop(s, bar, 0.75, 0, 0.25, 0.6 * v);
      chop(s, bar, 1.5, 1, 0.5, 0.75 * v, { cents: 200 + lift });
      chop(s, bar, 2.5, 2, 1, 0.8 * v, flick.up(-300, 0.1));
      chop(s, bar, 3.5, 2, 0.25, 0.6 * v, { cents: -300 });
    };
    // The turnaround: night / stay / go-go-go-go / night (wobble).
    const turn = (bar: number) => {
      const v = singing(bar) ? 0.66 : 1;
      chop(s, bar, 0, 1, 0.75, 0.75 * v);
      chop(s, bar, 1, 0, 0.25, 0.6 * v, { cents: -300 });
      stutter(s, bar, 1.5, 2, 4, 0.25, 0.5 * v, 0.8 * v, (i) =>
        i < 2 ? 0 : -500,
      );
      chop(s, bar, 2.5, 1, 1.25, 0.7 * v, flick.wobble(200, 6, 0.3));
    };
    // Chops alone over the kick, then looped under the drum runs.
    loop(16, 23, (bar) => cell(bar, bar >= 20 ? 300 : 0), turn, 8);
    loop(24, 39, cell, turn, 8);
    loop(40, 55, cell, turn, 8);
    loop(72, 80, cell, turn, 8);
    loop(88, 95, cell, turn, 8);
    // Stutter builds into each drop.
    for (const bar of [23, 39, 55, 87]) {
      stutter(s, bar, 0, 0, 8, 0.25, 0.45, 0.8);
      stutter(s, bar, 2, 2, 8, 0.125, 0.5, 0.85, (i) => i * 100);
    }
    // The last bar of the last drop: a tape-stop on the cell.
    chop(s, 95, 0, 0, 0.5, 0.8);
    chop(s, 95, 1, 1, 0.5, 0.75, { cents: 200 });
    chop(s, 95, 2, 2, 2, 0.8, flick.dive(-1200, 0.3));
    // The ending: one last "go" that the delay carries away.
    chop(s, 96, 0, 2, 2, 0.8, flick.fall(-500, 0.7));
    chop(s, 97, 2, 2, 1, 0.55, { cents: -500 });
    line(s, 97, "a", 0.7);

    // ------------------------------------------------------------ solo
    const solo: readonly (readonly [
      bar: number,
      beat: number,
      pitch: number,
      len: number,
      extra?: Partial<Parameters<Composer["note"]>[6]>,
    ])[] = [
      [80, 0, 81, 0.75, flick.up(-1200, 0.08)],
      [80, 0.75, 83, 0.75, { glide: 0.06 }],
      [80, 1.5, 86, 1.5, flick.wobble(200, 8, 0.25)],
      [80, 3, 85, 0.5, { glide: 0.05 }],
      [80, 3.5, 83, 0.5, { glide: 0.05 }],
      [81, 0, 81, 1.75, flick.fall(-500, 0.7)],
      [81, 2, 76, 0.5],
      [81, 2.5, 78, 0.5, { glide: 0.05 }],
      [81, 3, 81, 1, { glide: 0.08 }],
      [82, 0, 78, 0.5, flick.up(-700, 0.15)],
      [82, 0.5, 81, 0.25, { glide: 0.03 }],
      [82, 0.75, 83, 0.25, { glide: 0.03 }],
      [82, 1, 86, 2, flick.wobble(300, 10, 0.2)],
      [82, 3, 88, 1, { glide: 0.12 }],
      [83, 0, 86, 1, { glide: 0.08 }],
      [83, 1, 83, 0.5, { glide: 0.05 }],
      [83, 1.5, 81, 0.5, { glide: 0.05 }],
      [83, 2, 79, 2, flick.fall(-1200, 0.6)],
      [84, 0, 86, 0.25, flick.up(-1200, 0.3)],
      [84, 0.25, 85, 0.25],
      [84, 0.5, 86, 0.25],
      [84, 0.75, 88, 0.25, { glide: 0.03 }],
      [84, 1, 90, 1.5, flick.wobble(150, 12, 0.15)],
      [84, 2.5, 88, 0.5, { glide: 0.06 }],
      [84, 3, 86, 1, { glide: 0.1 }],
      [85, 0, 85, 1, flick.up(-200, 0.2)],
      [85, 1, 81, 0.5, { glide: 0.05 }],
      [85, 1.5, 85, 0.5, { glide: 0.05 }],
      [85, 2, 88, 2, flick.wobble(400, 8, 0.4)],
      [86, 0, 90, 0.5, flick.up(-1200, 0.2)],
      [86, 0.5, 88, 0.25],
      [86, 0.75, 86, 0.25],
      [86, 1, 83, 0.5, { glide: 0.04 }],
      [86, 1.5, 86, 1, { glide: 0.06 }],
      [86, 2.5, 90, 1.5, flick.wobble(200, 10, 0.2)],
      [87, 0, 91, 0.5, { glide: 0.04 }],
      [87, 0.5, 90, 0.5, { glide: 0.04 }],
      [87, 1, 86, 3, flick.dive(-2400, 0.35)],
    ];
    for (const [bar, beat, pitch, len, extra] of solo)
      s.note("lead", bar, beat, pitch, len, 0.7, extra ?? {});

    // -------------------------------------------------------- dropouts
    // Short holes for interest: a beat, half a bar, a whole bar.
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
    dropout(s, 31, 3, 1, band);
    dropout(s, 35, 2, 2, [...floor, "stabs"]);
    dropout(s, 39, 0, 4, [...floor, "pad", "pluck", "bells"]);
    dropout(s, 47, 3, 1, band);
    dropout(s, 51, 3.5, 0.5, floor);
    dropout(s, 55, 2, 2, [...floor, "stabs", "bells"]);
    dropout(s, 79, 3, 1, band);
    dropout(s, 83, 3.5, 0.5, floor);
    dropout(s, 87, 2, 2, [...floor, "stabs", "pad", "bells"]);
    dropout(s, 95, 2, 2, [...floor, "stabs", "pad", "pluck", "bells"]);
    return s.finish();
  },
};
