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
const BARS = 100;

// IV-I-V-vi in A, one chord a bar: the hook's "need" lands on the tonic.
const LOOP: readonly Chord[] = [
  { bass: 38, tones: [57, 62, 66] }, // D
  { bass: 45, tones: [57, 61, 64] }, // A
  { bass: 40, tones: [56, 59, 64] }, // E
  { bass: 42, tones: [57, 61, 66] }, // F#m
];
const chordAt = (bar: number) => LOOP[bar % 4]!;

type Scene = Readonly<{
  name: string;
  start: number;
  bars: number;
  drums: DrumFamily;
}>;
const SCENES: readonly Scene[] = [
  { name: "Glass", start: 0, bars: 8, drums: "none" },
  { name: "Taps", start: 8, bars: 8, drums: "taps" },
  { name: "Chops & drums", start: 16, bars: 8, drums: "tresillo" },
  { name: "Drop", start: 24, bars: 16, drums: "tresillo" },
  { name: "Broken", start: 40, bars: 8, drums: "broken" },
  { name: "Breakdown", start: 48, bars: 12, drums: "none" },
  { name: "House drop", start: 60, bars: 16, drums: "house" },
  { name: "Hats only", start: 76, bars: 4, drums: "taps" },
  { name: "Last drop", start: 80, bars: 8, drums: "tresillo" },
  { name: "Glass fade", start: 88, bars: 12, drums: "none" },
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
 * The hook (line A, line B two bars later) and the chop riff take turns, so
 * each stays intelligible; bars 72-75 belong to the lead.
 */
const HOOK_BARS = [8, 12, 24, 32, 40, 44, 52, 60, 68, 76, 80] as const;
const RIFF_BARS = [28, 30, 36, 38, 64, 66, 84, 86] as const;

export const glassGarden: DemoDefinition = {
  info: demoInfo({
    id: "glass-garden",
    title: "Glass Garden",
    style: "Hyperpop",
    description:
      "Tresillo hyperpop in A: a drumless gamelan-and-voice opening, bare hat taps under the breathy sung hook, chops alone over a 3-3-2 kick, a pumping drop with stabs pushed off the kick, a broken-beat stretch on a ramped saw bass, a twelve-bar string breakdown, a house-hat drop with a restrained gliding lead, and a twelve-bar glass fade.",
    tempoBpm: BPM,
    key: "A",
    bars: BARS,
    highlightBar: 28,
    trackId: "chops",
    features: [
      "a breathy sung hook (two lines) plus need / name / oh chops from the studio-v1 all-i-need sample",
      "chopped vocals alone over the tresillo kick before the bed comes in",
      "four drum families: tresillo, broken, house open hats and bare hat taps",
      "a gangsa cell over the tresillo drops, trading the top register with 3-3-2 plucks",
      "a ramped saw bass with automated drive over the broken beat",
      "a restrained hard-saw lead with glides, scoops and a small wobble",
      "beat- to bar-long dropouts and a twelve-bar drumless breakdown",
      "a twelve-bar ending where the hook, plucks and strings ring out",
    ],
    arrangement: [
      "Glass 8",
      "Taps 8",
      "Chops & drums 8",
      "Drop 16",
      "Broken 8",
      "Breakdown 12",
      "House drop 16",
      "Hats only 4",
      "Last drop 8",
      "Glass fade 12",
    ],
    mixNotes: [
      "Harmony never leaves the loop (D A E F#m, a chord a bar). Contrast comes from the drums: tresillo for the drops, a broken beat over the saw bass, a house drop with open hats, and hat taps around the hook.",
      "Pad, stabs, plucks, gangsa, sub, saw bass, chops, voice synth and lead pump on the kick's orbit; the strings and the sung lines stay steady on top. The sub is soft and slides; the saw bass swells in and its drive climbs across the broken section.",
      "The sung lines throw a beat of delay on 'need' and 'name'. The chops answer the hook with repitched syllables, stutters and flicks, and crush into each drop. The last eight bars hold IV then I while delay feedback rises and reverb carries the hook out.",
    ],
  }),
  build() {
    const s = new Composer(glassGarden.info);
    for (const { name, start, bars } of SCENES) s.section(name, start, bars);

    s.track(sounds.kick(BPM, "syn909", 0.74, 0.44));
    s.track(
      sounds.snare(0.34, "lofi", {
        fxAutomation: {
          "distort-drive": ramps(
            [16, 2.4],
            [39, 4],
            [40, 3],
            [48, 3],
            [60, 2.8],
            [75, 4.6],
            [80, 3.4],
            [88, 3.4],
          ),
        },
      }),
    );
    s.track(sounds.hats(1, "syn606"));
    s.track(sounds.drops(0.26));
    s.track(sounds.sub(0.38));
    s.track(
      sounds.sawBass(0.28, {
        fx: {
          orbit: { orbit: 2 },
          distort: { type: "soft", drive: 1.4, mix: 0.35 },
        },
        // Drive climbs through the broken section, then lets go.
        fxAutomation: {
          "distort-drive": ramps([40, 1.4], [47.9, 4], [48, 1.4]),
        },
      }),
    );
    s.track(
      sounds.pad(0.26, {
        volumeAutomation: steps([0, 0.8], [24, 1], [40, 0.85], [60, 1]),
      }),
    );
    s.track(
      sounds.stabs(0.26, {
        fxAutomation: {
          "distort-mix": swells(0, 0.55, [
            [23, 24],
            [59, 60],
            [79, 80],
          ]),
        },
      }),
    );
    s.track(
      sounds.pluck(0.22, {
        delayFeedbackAutomation: ramps([0, 0.36], [88, 0.36], [92, 0.64]),
        delayMixAutomation: ramps([0, 0.26], [88, 0.26], [90, 0.44]),
      }),
    );
    s.track(sounds.bells(0.22));
    s.track(
      sounds.strings(0.3, {
        volumeAutomation: merge(
          steps([0, 0.75], [48, 1], [60, 0.8], [88, 1]),
          ramps([95, 1], [99.9, 0]),
        ),
      }),
    );
    s.track(
      sounds.lead(0.22, {
        fxAutomation: {
          // A little grit that opens on the last phrase, then backs off.
          "distort-drive": ramps([72, 1.4], [74, 2.2], [75.5, 3.4], [76, 1.6]),
        },
      }),
    );
    s.track(
      vocalTrack("all-i-need", 0.6, {
        // The breathy take is already bright: less presence lift than the
        // kit's, the same levelling and bed duck.
        fx: {
          eq: { mid: -1.5, midfreq: 3500, high: 2, highfreq: 9000 },
          compressor: {
            threshold: -24,
            ratio: 4,
            attack: 0.004,
            release: 0.1,
            makeup: 8,
          },
          duck: { orbit: 2, depth: 0.25, attack: 0.6, onset: 0.08, hold: true },
        },
        // Throws catch the tails of "need" and "name", after their consonants,
        // so the echo repeats the vowel; the last "need" rings long.
        delayMixAutomation: merge(
          throws(
            HOOK_BARS.map((b) => b + 3.125),
            0.04,
            0.34,
            1.25,
          ),
          ramps([92.99, 0.04], [93, 0.44], [96, 0.44]),
        ),
        delayFeedbackAutomation: ramps([0, 0.38], [92, 0.38], [93, 0.58]),
      }),
    );
    s.track(
      chopTrack("all-i-need", 0.5, {
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
    s.track(vocalSynthTrack("all-i-need", 2, 76, 0.28));
    s.track(
      sounds.sweep(0.1, {
        filterAutomation: merge(
          ...[
            [20, 24],
            [56, 60],
            [76, 80],
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
      if (scene.name === "Chops & drums" && into < 4)
        // Kick and snare only under the first chops.
        drums(s, bar, "tresillo", 0.82, 0, ["kick", "snare"]);
      else if (scene.name === "Chops & drums") drums(s, bar, "tresillo", 0.88);
      else
        drums(s, bar, scene.drums, into < 2 ? 0.9 : 1, into % 4 === 3 ? 1 : 0);
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
    inBars(56, 60, (bar) => drums(s, bar, "taps", 0.66 + (bar - 56) * 0.08));
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
      [49, 1.5, 85],
      [51, 3.25, 90],
      [54, 0.75, 93],
      [57, 2.5, 88],
      [77, 1.75, 93],
      [78, 3.25, 85],
      [89, 2.25, 90],
      [91, 0.75, 93],
      [93, 3.5, 88],
    ] as const)
      drop(s, bar, beat, pitch, 0.55);
    // Noise sweeps under each build, tucked into the hats.
    for (const [from, bars] of [
      [20, 4],
      [56, 4],
      [76, 4],
    ] as const)
      s.note("sweep", from, 0, 60, bars * 4, 0.5);

    // ------------------------------------------------------------ bass
    const subBar = (bar: number, mode: "held" | "tresillo" | "house") => {
      const { bass } = chordAt(bar);
      const next = chordAt(bar + 1).bass;
      // The octave hop stays under the pad (a fifth when it would reach it).
      const hop = bass + 12 <= 52 ? bass + 12 : bass + 7;
      if (mode === "held") {
        s.note("sub", bar, 0, bass, 4.05, 0.7, { glide: 0.35 });
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
    inBars(8, 20, (bar) => subBar(bar, "held"));
    inBars(20, 40, (bar) => subBar(bar, bar >= 24 ? "tresillo" : "held"));
    inBars(40, 48, (bar) => subBar(bar, "held"));
    inBars(52, 60, (bar) => subBar(bar, "held"));
    inBars(60, 76, (bar) => subBar(bar, "house"));
    inBars(76, 80, (bar) => subBar(bar, "held"));
    inBars(80, 88, (bar) => subBar(bar, "tresillo"));
    s.note("sub", 88, 0, 38, 6, 0.58, {
      glide: 0.3,
      ...flick.fall(-1200, 0.6),
    });
    // The saw bass swells in on each root an octave up and slides home.
    inBars(40, 48, (bar) => {
      const { bass } = chordAt(bar);
      const next = chordAt(bar + 1).bass;
      s.note("saw", bar, 0, bass + 12, 3.4, 0.72);
      if (bar < 47)
        s.note("saw", bar, 3.5, next + 12, 0.5, 0.6, { glide: 0.12 });
    });

    // ---------------------------------------------------------- chords
    inBars(0, 88, (bar) => {
      const c = chordAt(bar);
      if (within(bar, [12, 16], [24, 48], [60, 76], [80, 88]))
        hold(s, "pad", bar, 0, c.tones, 4, 0.42 + 0.03 * (bar % 4));
      const grid = within(bar, [20, 40], [80, 88])
        ? TRES_STABS
        : within(bar, [60, 76])
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
          c.tones.map((t) => t + 12),
          0.3,
          (Number(hit) / 10) * accent * lift,
        );
      });
    });
    // Plucks from bar 8. They hand the top register to the gangsa in the
    // tresillo drops and to the lead in its bars, and sit out the
    // chops-over-drums and the breakdown's start.
    inBars(8, 92, (bar) => {
      if (within(bar, [16, 20], [28, 40], [48, 56], [72, 76], [80, 88])) return;
      rhythm(s, "pluck", bar, PLUCK_GRID, pluckNotes(chordAt(bar)), {
        hold: 1,
        velocity: bar >= 88 ? 0.8 - (bar - 88) * 0.1 : 1,
      });
    });
    // Gangsa: the glass intro and the tresillo drops.
    inBars(0, 88, (bar) => {
      if (bar % 2) return;
      if (!within(bar, [0, 8], [28, 40], [80, 88])) return;
      const soft = bar < 8 ? 0.75 : 1;
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
    inBars(0, 16, (bar) => stringChord(bar, 4, 0.36 + 0.03 * (bar % 4)));
    inBars(48, 60, (bar) => stringChord(bar, 4, 0.42 + 0.03 * (bar % 4)));
    inBars(88, 92, (bar) => stringChord(bar, 4, 0.42));
    stringChord(92, 4, 0.44);
    stringChord(93, 12, 0.42);
    // The voice synth holds the opening chords and riffs the breakdown.
    inBars(0, 60, (bar) => {
      if (!(bar < 8 || bar >= 48)) return;
      const top = chordAt(bar).tones.map((t) => t + 12);
      if (bar < 8) hold(s, "vsynth", bar, 0, top, 3.6, 0.48);
      else
        for (const [beat, len] of [
          [0, 1.25],
          [1.5, 0.5],
          [2.25, 0.5],
          [2.75, 1],
        ] as const)
          hold(s, "vsynth", bar, beat, top, len * 0.9, 0.48);
    });
    hold(s, "vsynth", 92, 0, [69, 74, 78], 3.6, 0.38);
    hold(s, "vsynth", 93, 0, [69, 73, 76], 10, 0.36);

    // ----------------------------------------------------------- voice
    for (const bar of HOOK_BARS) {
      line(s, bar, "a");
      line(s, bar + 2, "b");
    }
    // The chop riff: need / name / oh in 3-3-2, answering the hook. Over E
    // the first "need" lifts a tone to B.
    const riff = (bar: number) => {
      const first = chordAt(bar).bass === 40 ? 200 : 0;
      chop(s, bar, 0, 0, 0.5, 0.8, first ? { cents: first } : {});
      chop(s, bar, 0.75, 0, 0.5, 0.6, { cents: -500 });
      chop(s, bar, 1.5, 1, 0.5, 0.75);
      chop(s, bar, 2.5, 2, 0.5, 0.8, flick.up(-300, 0.1));
      chop(s, bar, 3.25, 1, 0.5, 0.6);
      stutter(
        s,
        bar + 1,
        0,
        2,
        4,
        0.25,
        0.5,
        0.8,
        (i) => [0, 200, 400, 500][i]!,
      );
      chop(s, bar + 1, 1, 0, 1.25, 0.75, flick.wobble(200, 6, 0.3));
      chop(s, bar + 1, 2.75, 1, 0.5, 0.6, { cents: -400 });
      chop(s, bar + 1, 3.25, 2, 0.75, 0.7, flick.fall(-500, 0.6));
    };
    // Chops alone over the kick, then answering the hook in the drops.
    inBars(16, 24, (bar) => {
      if (bar % 2 === 0) riff(bar);
    });
    for (const bar of RIFF_BARS) riff(bar);
    // Stutter builds into each change of groove; "oh" climbs the A scale.
    const RISE = [0, 200, 400, 500, 700, 900, 1000, 1200] as const;
    for (const bar of [23, 39, 59, 79]) {
      stutter(s, bar, 0, 0, 8, 0.25, 0.45, 0.8);
      stutter(s, bar, 2, 2, 8, 0.125, 0.5, 0.85, (i) => RISE[i]!);
    }
    // The ending: "oh" falls away, then "all I need" over IV to I.
    chop(s, 88, 0, 2, 2, 0.75, flick.fall(-500, 0.7));
    chop(s, 90, 2, 0, 1, 0.5, { cents: -500 });
    line(s, 92, "a", 0.72);

    // ------------------------------------------------------------ lead
    // A restrained four-bar answer to the hook in the house drop.
    const lead: readonly (readonly [
      bar: number,
      beat: number,
      pitch: number,
      len: number,
      extra?: Partial<Parameters<Composer["note"]>[6]>,
    ])[] = [
      [72, 0, 78, 1.5, flick.up(-200, 0.15)],
      [72, 1.5, 76, 0.5, { glide: 0.05 }],
      [72, 2, 74, 1.5, { glide: 0.08 }],
      [72, 3.5, 76, 0.5, { glide: 0.05 }],
      [73, 0, 81, 2.5, flick.wobble(100, 6, 0.4)],
      [73, 2.5, 80, 0.5, { glide: 0.05 }],
      [73, 3, 78, 1, { glide: 0.06 }],
      [74, 0, 76, 1, flick.up(-500, 0.1)],
      [74, 1, 80, 0.5, { glide: 0.04 }],
      [74, 1.5, 83, 2, flick.wobble(150, 8, 0.3)],
      [74, 3.5, 81, 0.5, { glide: 0.05 }],
      [75, 0, 85, 2, { glide: 0.08 }],
      [75, 2, 81, 2, flick.fall(-700, 0.6)],
    ];
    for (const [bar, beat, pitch, len, extra] of lead)
      s.note("lead", bar, beat, pitch, len, 0.66, extra ?? {});

    // -------------------------------------------------------- dropouts
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
    dropout(s, 39, 0, 4, band);
    dropout(s, 45, 2, 2, ["kick", "snare", "hats", "saw"]);
    dropout(s, 67, 3, 1, band);
    dropout(s, 71, 2, 2, ["kick", "snare", "hats", "sub", "stabs"]);
    dropout(s, 75, 3.5, 0.5, ["kick", "snare", "hats", "sub"]);
    dropout(s, 83, 3, 1, band);
    dropout(s, 87, 2, 2, ["kick", "snare", "hats", "sub", "stabs", "bells"]);
    return s.finish();
  },
};
