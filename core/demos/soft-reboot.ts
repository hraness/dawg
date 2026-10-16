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
const BARS = 96;

// I-V-vi-IV in D, one chord a bar.
const LOOP: readonly Chord[] = [
  { bass: 38, tones: [57, 62, 66] }, // D
  { bass: 45, tones: [57, 61, 64] }, // A
  { bass: 47, tones: [59, 62, 66] }, // Bm
  { bass: 43, tones: [59, 62, 67] }, // G
];
const chordAt = (bar: number) => LOOP[bar % 4]!;

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
  { name: "Breakdown", start: 40, bars: 16, drums: "none" },
  { name: "Second drop", start: 56, bars: 16, drums: "house" },
  { name: "Hats only", start: 72, bars: 8, drums: "taps" },
  { name: "Last drop", start: 80, bars: 8, drums: "four" },
  { name: "Afterglow", start: 88, bars: 8, drums: "none" },
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
 * Call and response: the sung hook (line A, then B two bars later) and the
 * chop riff never overlap, so each stays intelligible. The solo (64-71)
 * has the top line to itself.
 */
const HOOK_BARS = [8, 12, 24, 32, 44, 48, 56, 72, 80] as const;
const RIFF_BARS = [28, 30, 36, 38, 60, 62, 76, 78, 84, 86] as const;
/** The first stab of each half bar speaks, the answer sits back. */
const STAB_ACCENTS = [1, 0.82, 0.94, 0.78] as const;

export const softReboot: DemoDefinition = {
  info: demoInfo({
    id: "soft-reboot",
    title: "Soft Reboot",
    style: "Hyperpop",
    description:
      "Four-on-the-floor hyperpop in D: an eight-bar drumless boot, a section of bare hat taps under the sung hook, chopped vocals alone over the kick before the bed comes in, a pumping drop with offbeat chord stabs, a sixteen-bar breakdown on reverb strings and a looped-vowel voice synth, a house-hat second drop with a gliding hard-saw solo, and a long echo fade.",
    tempoBpm: BPM,
    key: "D",
    bars: BARS,
    highlightBar: 32,
    trackId: "chops",
    features: [
      "a sung hook (two lines) plus three chop syllables from the studio-v1 stay-tonight sample",
      "chopped vocals alone over the drums before the other layers enter",
      "deep sidechain: pad, stabs, plucks, gangsa, sub and chops pump on the kick",
      "a looped-vowel voice synth playing the chords",
      "hat-tap sections, one-beat to one-bar dropouts and a sixteen-bar drumless breakdown",
      "a hard-saw solo with glides, wobble flicks and automated distortion",
      "a muted, distorted snare and water-drop percussion",
      "an ending that leaves eight bars for delay and reverb to fade",
    ],
    arrangement: [
      "Boot 8",
      "Taps 8",
      "Chops & drums 8",
      "Drop 16",
      "Breakdown 16",
      "Second drop 16",
      "Hats only 8",
      "Last drop 8",
      "Afterglow 8",
    ],
    mixNotes: [
      "Harmony stays on one loop (D A Bm G, a chord a bar) the whole song. The interest is in which layers play: the kick arrives at bar 16 with only the chops over it, then sub and stabs join, then the pad, plucks and gangsa.",
      "Everything melodic except the strings and the sung lines sits on the kick's orbit, so it pumps about 9 dB and recovers in roughly half a beat. The sub has a soft 50 ms attack and slides between roots.",
      "The sung lines get quarter-note delay throws on their last word. The chops stutter, jump by note cents and crush in the build bars. The ending lets the plucks, chops and strings ring into rising delay feedback and reverb for eight bars.",
    ],
  }),
  build() {
    const s = new Composer(softReboot.info);
    for (const { name, start, bars } of SCENES) s.section(name, start, bars);

    s.track(sounds.kick(BPM, "syn909", 0.74, 0.44));
    s.track(
      sounds.snare(0.36, "lofi", {
        fxAutomation: {
          // The snare grits up through each drop and relaxes after it.
          "distort-drive": ramps(
            [16, 2.4],
            [39, 4.5],
            [56, 2.8],
            [71, 5],
            [80, 3.5],
            [88, 3.5],
          ),
        },
      }),
    );
    s.track(sounds.hats(1, "syn606"));
    s.track(sounds.drops(0.26));
    s.track(sounds.sub(0.38));
    s.track(
      sounds.pad(0.26, {
        volumeAutomation: steps([0, 0.85], [24, 1], [40, 0.9], [88, 1]),
      }),
    );
    s.track(
      sounds.stabs(0.27, {
        fxAutomation: {
          // Distortion fades in over each build bar, clean on the downbeat.
          "distort-mix": swells(0, 0.6, [
            [38, 40],
            [70, 72],
            [86, 88],
          ]),
        },
      }),
    );
    s.track(
      sounds.pluck(0.22, {
        delayFeedbackAutomation: ramps([0, 0.36], [88, 0.36], [91, 0.62]),
        delayMixAutomation: ramps([0, 0.26], [88, 0.26], [90, 0.42]),
      }),
    );
    s.track(sounds.bells(0.22));
    s.track(
      sounds.strings(0.3, {
        volumeAutomation: merge(
          steps([0, 0.9], [40, 1], [56, 0.75], [88, 1]),
          ramps([90, 1], [95.9, 0]),
        ),
      }),
    );
    s.track(
      sounds.lead(0.25, {
        fxAutomation: {
          // The solo starts clean-ish and tears open at its peak.
          "distort-drive": ramps([64, 1.6], [67, 3], [69, 6.5], [71.9, 2]),
        },
      }),
    );
    s.track(
      vocalTrack("stay-tonight", 0.72, {
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
      chopTrack("stay-tonight", 0.5, {
        fxAutomation: {
          "crush-bits": swells(16, 5, [
            [23, 24],
            [39, 40],
            [79, 80],
          ]),
          "crush-mix": swells(0, 0.7, [
            [23, 24],
            [39, 40],
            [79, 80],
          ]),
        },
        delayFeedbackAutomation: ramps([0, 0.3], [88, 0.3], [91, 0.6]),
        delayMixAutomation: ramps([0, 0.1], [88, 0.1], [89, 0.38]),
      }),
    );
    s.track(vocalSynthTrack("stay-tonight", 2, 74, 0.3));
    s.track(
      sounds.sweep(0.11, {
        filterAutomation: merge(
          ...[
            [20, 24],
            [52, 56],
            [76, 80],
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
      if (last && scene.drums !== "taps")
        // A muted snare pickup run into the next scene.
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
      [53, 1.5, 90],
      [54, 3.25, 86],
      [73, 2.75, 93],
      [75, 1.25, 88],
      [77, 3.5, 90],
      [79, 0.5, 86],
      [84, 3.75, 93],
    ] as const)
      drop(s, bar, beat, pitch, 0.55);
    // Hat taps return under the end of the breakdown.
    inBars(52, 56, (bar) => drums(s, bar, "taps", 0.7 + (bar - 52) * 0.08));

    // Noise sweeps under the last bars of each build, tucked into the hats.
    for (const [from, bars] of [
      [20, 4],
      [52, 4],
      [76, 4],
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
    inBars(20, 40, (bar) => subBar(bar, bar >= 24));
    inBars(44, 56, (bar) => subBar(bar, false));
    inBars(56, 72, (bar) => subBar(bar, true));
    inBars(72, 80, (bar) => subBar(bar, false));
    inBars(80, 88, (bar) => subBar(bar, true));
    s.note("sub", 88, 0, 38, 6, 0.6, { glide: 0.3, ...flick.fall(-1200, 0.6) });

    // ---------------------------------------------------------- chords
    inBars(0, 88, (bar) => {
      const c = chordAt(bar);
      const padded = bar < 16 || (bar >= 24 && bar < 40) || bar >= 56;
      if (padded && !(bar >= 72 && bar < 80))
        // Each pass of the loop leans into its last chord.
        hold(s, "pad", bar, 0, c.tones, 4, 0.44 + 0.03 * (bar % 4));
      // Stabs ride the offbeats around the kick, an octave up.
      if ((bar >= 20 && bar < 40) || (bar >= 56 && bar < 72) || bar >= 80) {
        const lift = bar % 4 === 3 ? 1.1 : 1;
        let hitIndex = 0;
        [...STAB_GRID].forEach((hit, step) => {
          if (hit === ".") return;
          const up = c.tones.map((t) => t + 12);
          const accent = STAB_ACCENTS[hitIndex++ % STAB_ACCENTS.length]!;
          hold(
            s,
            "stabs",
            bar,
            step / 4,
            up,
            0.3,
            (Number(hit) / 10) * accent * lift,
          );
        });
      }
    });
    // Plucks: from bar 4, out for the chops-over-drums and the breakdown.
    inBars(4, 90, (bar) => {
      if ((bar >= 16 && bar < 24) || (bar >= 40 && bar < 48)) return;
      // The solo has the top register to itself.
      if (bar >= 64 && bar < 72) return;
      rhythm(s, "pluck", bar, PLUCK_GRID, pluckNotes(chordAt(bar)), {
        hold: 1,
        velocity: bar >= 88 ? 0.8 : 1,
      });
    });
    // Gangsa in the drops and the hats-only bars.
    inBars(28, 88, (bar) => {
      if (bar >= 40 && bar < 60) return;
      if (bar % 2) return;
      for (const [beat, pitch] of GANGSA)
        s.note("bells", bar, beat, pitch, 0.4, beat % 1 === 0 ? 0.6 : 0.45);
    });
    // Strings: the intro, the whole breakdown and the ending, swelling.
    inBars(0, 92, (bar) => {
      if (!(bar < 16 || (bar >= 40 && bar < 56) || bar >= 88)) return;
      if (bar >= 88 && bar !== 88) return;
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
        bar === 88 ? 16 : 4,
        0.4 + 0.03 * (bar % 4),
      );
    });
    // The voice synth carries the boot and the breakdown chords.
    inBars(0, 56, (bar) => {
      if (!(bar < 8 || bar >= 40)) return;
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
    // The two sung lines as a four-bar hook.
    for (const bar of HOOK_BARS) {
      line(s, bar, "a");
      line(s, bar + 2, "b");
    }
    // The chop riff: stay / night / go, two bars, answering the hook.
    const riff = (bar: number, lift = 0) => {
      chop(s, bar, 0, 0, 0.5, 0.8);
      chop(s, bar, 0.75, 0, 0.25, 0.6);
      chop(s, bar, 1.5, 1, 0.5, 0.75, { cents: 200 + lift });
      chop(s, bar, 2.5, 2, 1, 0.8, flick.up(-300, 0.1));
      chop(s, bar, 3.5, 2, 0.25, 0.6, { cents: -300 });
      chop(s, bar + 1, 0, 1, 0.75, 0.75);
      chop(s, bar + 1, 1, 0, 0.25, 0.6, { cents: -300 });
      stutter(s, bar + 1, 1.5, 2, 4, 0.25, 0.5, 0.8, (i) => (i < 2 ? 0 : -500));
      chop(s, bar + 1, 2.5, 1, 1.25, 0.7, flick.wobble(200, 6, 0.3));
    };
    // Chops alone over the kick, then answering the hook in the drops.
    inBars(16, 24, (bar) => {
      if (bar % 2 === 0) riff(bar, bar >= 20 ? 300 : 0);
    });
    for (const bar of RIFF_BARS) riff(bar);
    // Stutter builds into each drop.
    for (const bar of [23, 39, 79]) {
      stutter(s, bar, 0, 0, 8, 0.25, 0.45, 0.8);
      stutter(s, bar, 2, 2, 8, 0.125, 0.5, 0.85, (i) => i * 100);
    }
    // The ending: one last "go" that the delay carries away.
    chop(s, 88, 0, 2, 2, 0.8, flick.fall(-500, 0.7));
    chop(s, 89, 2, 2, 1, 0.55, { cents: -500 });
    line(s, 89, "a", 0.7);

    // ------------------------------------------------------------ solo
    const solo: readonly (readonly [
      bar: number,
      beat: number,
      pitch: number,
      len: number,
      extra?: Partial<Parameters<Composer["note"]>[6]>,
    ])[] = [
      [64, 0, 81, 0.75, flick.up(-1200, 0.08)],
      [64, 0.75, 83, 0.75, { glide: 0.06 }],
      [64, 1.5, 86, 1.5, flick.wobble(200, 8, 0.25)],
      [64, 3, 85, 0.5, { glide: 0.05 }],
      [64, 3.5, 83, 0.5, { glide: 0.05 }],
      [65, 0, 81, 1.75, flick.fall(-500, 0.7)],
      [65, 2, 76, 0.5],
      [65, 2.5, 78, 0.5, { glide: 0.05 }],
      [65, 3, 81, 1, { glide: 0.08 }],
      [66, 0, 78, 0.5, flick.up(-700, 0.15)],
      [66, 0.5, 81, 0.25, { glide: 0.03 }],
      [66, 0.75, 83, 0.25, { glide: 0.03 }],
      [66, 1, 86, 2, flick.wobble(300, 10, 0.2)],
      [66, 3, 88, 1, { glide: 0.12 }],
      [67, 0, 86, 1, { glide: 0.08 }],
      [67, 1, 83, 0.5, { glide: 0.05 }],
      [67, 1.5, 81, 0.5, { glide: 0.05 }],
      [67, 2, 79, 2, flick.fall(-1200, 0.6)],
      [68, 0, 86, 0.25, flick.up(-1200, 0.3)],
      [68, 0.25, 85, 0.25],
      [68, 0.5, 86, 0.25],
      [68, 0.75, 88, 0.25, { glide: 0.03 }],
      [68, 1, 90, 1.5, flick.wobble(150, 12, 0.15)],
      [68, 2.5, 88, 0.5, { glide: 0.06 }],
      [68, 3, 86, 1, { glide: 0.1 }],
      [69, 0, 85, 1, flick.up(-200, 0.2)],
      [69, 1, 81, 0.5, { glide: 0.05 }],
      [69, 1.5, 85, 0.5, { glide: 0.05 }],
      [69, 2, 88, 2, flick.wobble(400, 8, 0.4)],
      [70, 0, 90, 0.5, flick.up(-1200, 0.2)],
      [70, 0.5, 88, 0.25],
      [70, 0.75, 86, 0.25],
      [70, 1, 83, 0.5, { glide: 0.04 }],
      [70, 1.5, 86, 1, { glide: 0.06 }],
      [70, 2.5, 90, 1.5, flick.wobble(200, 10, 0.2)],
      [71, 0, 91, 0.5, { glide: 0.04 }],
      [71, 0.5, 90, 0.5, { glide: 0.04 }],
      [71, 1, 86, 3, flick.dive(-2400, 0.35)],
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
      "stabs",
      "pad",
      "pluck",
      "bells",
    ];
    dropout(s, 31, 3, 1, band);
    dropout(s, 35, 2, 2, ["kick", "snare", "hats", "sub", "stabs"]);
    dropout(s, 39, 0, 4, [
      "kick",
      "snare",
      "hats",
      "sub",
      "pad",
      "pluck",
      "bells",
    ]);
    dropout(s, 63, 3, 1, band);
    dropout(s, 67, 3.5, 0.5, ["kick", "snare", "hats", "sub"]);
    dropout(s, 83, 2, 2, ["kick", "snare", "hats", "sub", "stabs", "bells"]);
    return s.finish();
  },
};
