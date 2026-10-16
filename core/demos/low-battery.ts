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
const BARS = 96;

// vi-IV-I-V in F, one chord a bar.
const LOOP: readonly Chord[] = [
  { bass: 38, tones: [57, 62, 65] }, // Dm
  { bass: 46, tones: [58, 62, 65] }, // Bb
  { bass: 41, tones: [57, 60, 65] }, // F
  { bass: 36, tones: [55, 60, 64] }, // C
];
const chordAt = (bar: number) => LOOP[bar % 4]!;

type Scene = Readonly<{
  name: string;
  start: number;
  bars: number;
  drums: DrumFamily;
}>;
const SCENES: readonly Scene[] = [
  { name: "Low power", start: 0, bars: 8, drums: "none" },
  { name: "Taps", start: 8, bars: 8, drums: "taps" },
  { name: "Chops & drums", start: 16, bars: 8, drums: "half" },
  { name: "Drop", start: 24, bars: 16, drums: "trap" },
  { name: "Breakdown", start: 40, bars: 12, drums: "none" },
  { name: "Saw drop", start: 52, bars: 16, drums: "half" },
  { name: "Hats only", start: 68, bars: 8, drums: "taps" },
  { name: "Last drop", start: 76, bars: 12, drums: "trap" },
  { name: "Power down", start: 88, bars: 8, drums: "none" },
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
 * Call and response: the sung hook (line A, then B two bars later) and the
 * chop riff never overlap. The solo (60-67) has the top line to itself.
 */
const HOOK_BARS = [8, 12, 24, 32, 44, 52, 68, 76, 84] as const;
const RIFF_BARS = [28, 30, 36, 38, 56, 58, 72, 74, 80, 82] as const;
/** Builds: a stutter bar, crushed chops and a noise sweep into each drop. */
const BUILDS = [23, 51, 75] as const;

export const lowBattery: DemoDefinition = {
  info: demoInfo({
    id: "low-battery",
    title: "Low Battery",
    style: "Hyperpop",
    description:
      "Half-time hyperpop in F at 140: a drumless low-power intro on the looped-vowel voice synth, bare clicks and hat taps under the sung hook, chopped vocals alone over a half-time kit, a trap-hat drop with syncopated stabs, a twelve-bar breakdown on reverb strings and gangsa, a ramped saw-bass drop with a distorted hard-saw solo, a hats-only stretch where the open hats come back, and an eight-bar power-down that echoes out.",
    tempoBpm: BPM,
    key: "F",
    bars: BARS,
    highlightBar: 24,
    trackId: "chops",
    features: [
      "a sung hook (two lines) plus three chop syllables from the studio-v1 lights-out sample",
      "chopped vocals alone over half-time drums before the bed comes in",
      "half-time and trap drum families with hat rolls, rim clicks and open hats, plus hat-tap stretches",
      "a ramped saw bass with glides in the saw drop and a soft gliding sub elsewhere",
      "a hard-saw solo with octave scoops, wobble flicks, a tape-stop dive and automated distortion",
      "deep sidechain: pad, stabs, plucks, gangsa, bass and chops pump on the kick",
      "beat-long to bar-long dropouts and a twelve-bar drumless breakdown",
      "an eight-bar ending where plucks, chops and strings ride out on delay and reverb",
    ],
    arrangement: [
      "Low power 8",
      "Taps 8",
      "Chops & drums 8",
      "Drop 16",
      "Breakdown 12",
      "Saw drop 16",
      "Hats only 8",
      "Last drop 12",
      "Power down 8",
    ],
    mixNotes: [
      "The harmony never leaves one loop (Dm Bb F C, a chord a bar). The song moves by layers: the kick arrives at bar 16 with only the chops over it, then sub and stabs, then the pad, plucks and trap hats.",
      "Half time at 140 leaves room between the kicks for the stabs, which sit on the off-sixteenths around the kick and snare. Everything melodic except the strings and the sung lines pumps on the kick.",
      "The saw drop swaps the sub's single held roots for a saw bass that swells in on each note and slides between them, with its drive opening across the section. The solo's distortion climbs to its peak and pulls back.",
    ],
  }),
  build() {
    const s = new Composer(lowBattery.info);
    for (const { name, start, bars } of SCENES) s.section(name, start, bars);

    s.track(sounds.kick(BPM, "syn909", 0.74, 0.5));
    s.track(
      sounds.snare(0.38, "lofi", {
        fxAutomation: {
          "distort-drive": ramps(
            [16, 2.6],
            [39, 4.6],
            [52, 3],
            [67, 5],
            [76, 3.6],
            [88, 3.6],
          ),
        },
      }),
    );
    s.track(sounds.hats(0.95, "electro"));
    s.track(sounds.drops(0.26));
    s.track(
      sounds.sub(0.4, {
        // Under the saw bass the sub only holds the roots.
        volumeAutomation: steps([0, 1], [52, 0.78], [68, 1]),
      }),
    );
    s.track(
      sounds.sawBass(0.3, {
        fx: { ...orbit, distort: { type: "soft", drive: 2.2, mix: 0 } },
        fxAutomation: {
          "distort-mix": ramps([52, 0], [60, 0.2], [66, 0.45], [67.9, 0.45]),
        },
      }),
    );
    s.track(
      sounds.pad(0.25, {
        volumeAutomation: steps([0, 0.8], [24, 1], [52, 0.85], [76, 1]),
      }),
    );
    s.track(
      sounds.stabs(0.26, {
        fxAutomation: {
          // Distortion fades in over each build bar, clean on the downbeat.
          "distort-mix": swells(0, 0.6, [
            [39, 40],
            [67, 68],
            [87, 88],
          ]),
        },
      }),
    );
    s.track(
      sounds.pluck(0.17, {
        delayFeedbackAutomation: ramps([0, 0.36], [88, 0.36], [91, 0.62]),
        delayMixAutomation: ramps([0, 0.26], [88, 0.26], [90, 0.42]),
      }),
    );
    s.track(sounds.bells(0.2));
    s.track(
      sounds.strings(0.3, {
        volumeAutomation: merge(
          steps([0, 0.85], [40, 1], [88, 1]),
          ramps([91, 1], [95.9, 0]),
        ),
      }),
    );
    s.track(
      sounds.lead(0.24, {
        fxAutomation: {
          // The solo starts nearly clean and tears open at its peak.
          "distort-drive": ramps([60, 1.5], [63, 3], [65, 6.5], [67.9, 2]),
        },
      }),
    );
    s.track(
      vocalTrack("lights-out", 0.72, {
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
      chopTrack("lights-out", 0.5, {
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
        delayFeedbackAutomation: ramps([0, 0.3], [88, 0.3], [91, 0.6]),
        delayMixAutomation: ramps([0, 0.1], [88, 0.1], [89, 0.38]),
      }),
    );
    s.track(vocalSynthTrack("lights-out", 2, 67, 0.3));
    s.track(
      sounds.sweep(0.11, {
        filterAutomation: merge(
          ...BUILDS.map((b) =>
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
      if (scene.name === "Chops & drums" && into < 4)
        // Kick and hats only under the first chops.
        drums(s, bar, "half", 0.95, 0, ["kick", "hat"]);
      else if (scene.name === "Last drop" && into < 4)
        // The broken kick under the returning hook, then trap again.
        drums(s, bar, "broken", 1, variant);
      else if (scene.name === "Hats only" && into >= 4) {
        // The open hats come back over the taps.
        drums(s, bar, "taps", 0.9, variant);
        s.grid("hats", bar, 46, "..5...5...5...5.", 0.9);
      } else drums(s, bar, scene.drums, into < 2 ? 0.9 : 1, variant);
      if (scene.drums === "trap" && into % 4 === 1)
        // A triplet roll into beat four.
        roll(bar, 3, 6, 1 / 6);
      if (scene.drums === "trap" && into % 8 === 7) roll(bar, 2, 8, 0.125);
      if (scene.name === "Last drop" && into >= 4)
        s.grid("hats", bar, 46, "......5.......5.", 0.85);
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
    // Water drops wander over the taps and the hats-only bars.
    for (const [bar, beat, pitch] of [
      [9, 1.75, 89],
      [10, 3.25, 96],
      [11, 2.5, 93],
      [13, 0.75, 91],
      [14, 3.5, 96],
      [15, 2.25, 89],
      [49, 1.5, 93],
      [50, 3.25, 89],
      [69, 2.75, 96],
      [71, 1.25, 91],
      [73, 3.5, 93],
      [75, 0.5, 89],
      [90, 2.75, 96],
    ] as const)
      drop(s, bar, beat, pitch, 0.55);
    // Hat taps return under the end of the breakdown.
    inBars(48, 52, (bar) => drums(s, bar, "taps", 0.7 + (bar - 48) * 0.08));
    // Noise sweeps under the last bars of each build, tucked into the hats.
    for (const bar of BUILDS) s.note("sweep", bar - 3, 0, 60, 16, 0.5);

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
    inBars(4, 16, (bar) => subBar(bar, false));
    inBars(20, 40, (bar) => subBar(bar, bar >= 24));
    inBars(44, 68, (bar) => subBar(bar, false));
    inBars(68, 76, (bar) => subBar(bar, false));
    inBars(76, 88, (bar) => subBar(bar, true));
    s.note("sub", 88, 0, 38, 6, 0.6, { glide: 0.3, ...flick.fall(-1200, 0.6) });
    // The saw bass swells into each note and slides between them.
    inBars(52, 68, (bar) => {
      const { bass } = chordAt(bar);
      const next = chordAt(bar + 1).bass;
      s.note("saw", bar, 0, bass, 1.6, 0.72);
      s.note("saw", bar, 1.75, bass + 12, 0.6, 0.6, { glide: 0.06 });
      s.note("saw", bar, 2.5, bass, 0.9, 0.66, { glide: 0.08 });
      s.note("saw", bar, 3.5, next, 0.45, 0.6, { glide: 0.12 });
    });

    // ---------------------------------------------------------- chords
    inBars(0, 88, (bar) => {
      const c = chordAt(bar);
      const padded =
        bar < 16 ||
        (bar >= 24 && bar < 40) ||
        (bar >= 52 && bar < 68) ||
        bar >= 76;
      if (padded) hold(s, "pad", bar, 0, c.tones, 4, 0.44 + 0.03 * (bar % 4));
      if ((bar >= 20 && bar < 40) || (bar >= 52 && bar < 68) || bar >= 76) {
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
            c.tones.map((t) => t + 12),
            0.3,
            (Number(hit) / 10) * accent * lift,
          );
        });
      }
    });
    // Plucks: from bar 4, out for the chops-over-drums, the breakdown's
    // first half and the solo.
    inBars(4, 91, (bar) => {
      if ((bar >= 16 && bar < 24) || (bar >= 40 && bar < 48)) return;
      if (bar >= 60 && bar < 68) return;
      rhythm(s, "pluck", bar, PLUCK_GRID, pluckNotes(chordAt(bar)), {
        hold: 1,
        velocity: bar >= 88 ? 0.8 : 1,
      });
    });
    // Gangsa between the sung lines: the breakdown, the saw drop and the
    // riffs of the last drop.
    inBars(40, 84, (bar) => {
      const on =
        (bar >= 40 && bar < 44) ||
        (bar >= 48 && bar < 52) ||
        (bar >= 56 && bar < 60) ||
        bar >= 80;
      if (!on || bar % 2) return;
      for (const [beat, pitch] of GANGSA)
        s.note("bells", bar, beat, pitch, 0.4, beat % 1 === 0 ? 0.6 : 0.45);
    });
    // Strings: the intro, the breakdown and the ending, swelling.
    inBars(0, 89, (bar) => {
      if (!(bar < 16 || (bar >= 40 && bar < 52) || bar === 88)) return;
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
    // The voice synth carries the intro chords and a breakdown riff.
    inBars(0, 52, (bar) => {
      if (!(bar < 8 || bar >= 40)) return;
      const top = chordAt(bar).tones.map((t) => t + 12);
      if (bar < 8 || (bar >= 44 && bar < 48)) {
        // Held under the intro and under the breakdown's hook.
        hold(s, "vsynth", bar, 0, top, 3.6, bar < 8 ? 0.5 : 0.36);
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
    for (const bar of HOOK_BARS) {
      line(s, bar, "a");
      line(s, bar + 2, "b");
    }
    // The chop riff: lights / out / on over two bars, every repitch diatonic.
    const riff = (bar: number, lift = 0) => {
      chop(s, bar, 0, 0, 0.5, 0.8);
      chop(s, bar, 0.75, 0, 0.25, 0.6);
      chop(s, bar, 1.5, 1, 0.5, 0.75, { cents: 300 + lift });
      chop(s, bar, 2.5, 2, 1, 0.8, flick.up(-300, 0.1));
      chop(s, bar, 3.5, 1, 0.25, 0.6, { cents: -200 });
      chop(s, bar + 1, 0, 0, 0.75, 0.75, { cents: -300 });
      chop(s, bar + 1, 1, 1, 0.25, 0.6);
      stutter(s, bar + 1, 1.5, 2, 4, 0.25, 0.5, 0.8, (i) => (i < 2 ? 0 : 200));
      chop(s, bar + 1, 2.5, 0, 1.25, 0.7, flick.wobble(200, 6, 0.3));
    };
    inBars(16, 24, (bar) => {
      if (bar % 2 === 0) riff(bar, bar >= 20 ? 200 : 0);
    });
    for (const bar of RIFF_BARS) riff(bar);
    // Stutter builds into each drop.
    for (const bar of BUILDS) {
      stutter(s, bar, 0, 0, 8, 0.25, 0.45, 0.8);
      stutter(s, bar, 2, 2, 8, 0.125, 0.5, 0.85, (i) => i * 100);
    }
    // Power down: one last "out" that the delay carries away.
    chop(s, 88, 0, 1, 2, 0.8, flick.fall(-500, 0.7));
    chop(s, 89, 2, 1, 1, 0.55, { cents: -200 });
    line(s, 89, "a", 0.7);

    // ------------------------------------------------------------ solo
    const solo: readonly (readonly [
      bar: number,
      beat: number,
      pitch: number,
      len: number,
      extra?: Partial<Parameters<Composer["note"]>[6]>,
    ])[] = [
      [60, 0, 81, 0.75, flick.up(-1200, 0.08)],
      [60, 0.75, 84, 0.75, { glide: 0.06 }],
      [60, 1.5, 86, 1.5, flick.wobble(200, 8, 0.25)],
      [60, 3, 84, 0.5, { glide: 0.05 }],
      [60, 3.5, 81, 0.5, { glide: 0.05 }],
      [61, 0, 86, 1.75, flick.fall(-500, 0.7)],
      [61, 2, 77, 0.5],
      [61, 2.5, 79, 0.5, { glide: 0.05 }],
      [61, 3, 82, 1, { glide: 0.08 }],
      [62, 0, 81, 0.5, flick.up(-700, 0.15)],
      [62, 0.5, 84, 0.25, { glide: 0.03 }],
      [62, 0.75, 86, 0.25, { glide: 0.03 }],
      [62, 1, 89, 2, flick.wobble(300, 10, 0.2)],
      [62, 3, 88, 1, { glide: 0.12 }],
      [63, 0, 91, 1, { glide: 0.08 }],
      [63, 1, 88, 0.5, { glide: 0.05 }],
      [63, 1.5, 86, 0.5, { glide: 0.05 }],
      [63, 2, 84, 2, flick.fall(-1200, 0.6)],
      [64, 0, 89, 0.25, flick.up(-1200, 0.3)],
      [64, 0.25, 88, 0.25],
      [64, 0.5, 89, 0.25],
      [64, 0.75, 91, 0.25, { glide: 0.03 }],
      [64, 1, 93, 1.5, flick.wobble(150, 12, 0.15)],
      [64, 2.5, 91, 0.5, { glide: 0.06 }],
      [64, 3, 89, 1, { glide: 0.1 }],
      [65, 0, 86, 1, flick.up(-200, 0.2)],
      [65, 1, 82, 0.5, { glide: 0.05 }],
      [65, 1.5, 86, 0.5, { glide: 0.05 }],
      [65, 2, 89, 2, flick.wobble(400, 8, 0.4)],
      [66, 0, 93, 0.5, flick.up(-1200, 0.2)],
      [66, 0.5, 91, 0.25],
      [66, 0.75, 89, 0.25],
      [66, 1, 84, 0.5, { glide: 0.04 }],
      [66, 1.5, 89, 1, { glide: 0.06 }],
      [66, 2.5, 93, 1.5, flick.wobble(200, 10, 0.2)],
      [67, 0, 96, 0.5, { glide: 0.04 }],
      [67, 0.5, 93, 0.5, { glide: 0.04 }],
      [67, 1, 91, 3, flick.dive(-2400, 0.35)],
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
    dropout(s, 55, 3, 1, [...band, "saw"]);
    dropout(s, 63, 3.5, 0.5, ["kick", "snare", "hats", "sub", "saw"]);
    // The last drop opens on drums, bass and pad under line A; the stabs and
    // plucks come back with line B.
    dropout(s, 76, 0, 8, ["stabs", "pluck"]);
    dropout(s, 79, 2, 2, ["kick", "snare", "hats", "sub", "stabs"]);
    dropout(s, 83, 3, 1, band);
    return s.finish();
  },
};
