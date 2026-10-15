/** Signal Bloom: the synth pop demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import {
  Composer,
  hall,
  lanes,
  orbit,
  preset,
  room,
  voice,
  type Phrase,
} from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

export const signalBloom: DemoDefinition = {
  info: demoInfo({
    id: "signal-bloom",
    title: "Signal Bloom",
    style: "Synth pop",
    description:
      "An expansive synth-pop song: a glass hook, original sung refrain and chopped responses evolve across twelve scenes and thirteen independently mixed parts.",
    tempoBpm: 108,
    key: "Am",
    bars: 64,
    highlightBar: 24,
    trackId: "vocal",
    features: [
      "four Linn drum lanes",
      "original sung hook",
      "analog bass",
      "arpeggiated bridge",
      "vocal double",
      "original vocal chops",
      "wavetable halo",
      "transition automation",
    ],
    arrangement: [
      "Glass intro 4",
      "Pulse 4",
      "Verse 8",
      "Prechorus 4",
      "Lift 4",
      "Chorus 8",
      "Bridge 8",
      "Verse return 4",
      "Second lift 4",
      "Final chorus 8",
      "Bloom 4",
      "Last light 4",
    ],
    mixNotes: [
      "The kick alone triggers ducking; dry centered bass and high-passed harmony leave room for each other.",
      "The vocal leaves space at phrase ends for a four-note synth reply; its quiet high double appears only in the last chorus.",
      "Half-time bridge drums and a filtered arpeggio reset the energy; chopped responses occupy the singer's gaps and the high halo enters only at structural peaks.",
    ],
  }),
  build() {
    const s = new Composer(signalBloom.info);
    for (const [name, start, bars] of [
      ["Glass intro", 0, 4],
      ["Pulse", 4, 4],
      ["Verse", 8, 8],
      ["Prechorus", 16, 4],
      ["Lift", 20, 4],
      ["Chorus", 24, 8],
      ["Bridge", 32, 8],
      ["Verse return", 40, 4],
      ["Second lift", 44, 4],
      ["Final chorus", 48, 8],
      ["Bloom", 56, 4],
      ["Last light", 60, 4],
    ] as const)
      s.section(name, start, bars);
    s.track(
      voice("kick", "Linn kick", "kit", 0.8, {
        kit: "synlinn",
        fx: { duck: { orbit: 2, depth: 0.32, attack: 0.16 } },
      }),
    );
    s.track(
      voice("snare", "Linn snare", "kit", 0.59, {
        kit: "synlinn",
        reverb: room,
      }),
    );
    s.track(
      voice("hats", "Linn hats", "kit", 0.48, { kit: "synlinn", pan: 0.12 }),
    );
    s.track(
      voice("perc", "Toms & clap", "kit", 0.37, {
        kit: "synlinn",
        pan: -0.17,
        reverb: room,
      }),
    );
    s.track(preset("bass", "Analog bass", "moog-bass", 0.55, { fx: orbit }));
    s.track(
      voice("chords", "Warm polysynth", "saw", 0.26, {
        fx: orbit,
        synth: {
          attack: 0.08,
          decay: 0.25,
          sustain: 0.6,
          release: 0.35,
          lpf: 2400,
          detune: 0.09,
        },
        reverb: room,
        filterAutomation: lanes(
          [0, 800],
          [15, 1300],
          [23, 4000],
          [31, 3500],
          [32, 900],
          [39, 1600],
          [48, 3900],
          [59, 4700],
          [63, 650],
        ),
      }),
    );
    s.track(
      preset("hook", "Glass hook", "fm-bells", 0.36, {
        pan: 0.19,
        delay: { beats: 0.75, feedback: 0.25, mix: 0.16, pingpong: true },
        reverb: room,
      }),
    );
    s.track(
      voice("vocal", "Signal singer", "sing", 0.57, {
        sing: {
          preset: "aah",
          voice: "alto",
          articulate: 1,
          breath: 0.11,
          jitter: 0.12,
          vib: 4.8,
          vibmod: 0.09,
          ring: 0.15,
        },
        reverb: room,
        delay: { beats: 0.5, feedback: 0.17, mix: 0.08 },
        filter: { type: "hpf", cutoff: 150, resonance: 0 },
      }),
    );
    s.track(
      voice("double", "High reply", "sing", 0.16, {
        pan: -0.22,
        sing: { preset: "choir", vowel: "o", breath: 0.2 },
        reverb: hall,
      }),
    );
    s.track(
      voice("stay", "Stay chop", "sampler", 0.23, {
        pan: -0.2,
        sampler: {
          mode: "keyed",
          voices: {
            stay: {
              ...bundledSampleRef("stay-up"),
              begin: 0,
              end: 0.25,
              fadeTime: 0.012,
            },
          },
        },
        delay: { beats: 0.75, feedback: 0.22, mix: 0.16, pingpong: true },
        reverb: room,
        filter: { type: "hpf", cutoff: 180, resonance: 0 },
      }),
    );
    s.track(
      voice("up", "Up reply", "sampler", 0.25, {
        pan: 0.22,
        sampler: {
          mode: "keyed",
          voices: {
            up: {
              ...bundledSampleRef("stay-up"),
              begin: 0.25,
              end: 0.5,
              fadeTime: 0.012,
            },
          },
        },
        delay: { beats: 0.5, feedback: 0.26, mix: 0.13, pingpong: true },
        reverb: room,
        filter: { type: "hpf", cutoff: 180, resonance: 0 },
      }),
    );
    s.track(
      voice("halo", "Wavetable halo", "wavetable", 0.12, {
        wavetable: {
          table: { src: "builtin:basic" },
          wt: 0.19,
          wtrate: 0.18,
          wtdepth: 0.1,
        },
        synth: { attack: 0.6, release: 1.25, lpf: 2300 },
        filter: { type: "hpf", cutoff: 310, resonance: 0 },
        wtAutomation: lanes(
          [0, 0.1],
          [23, 0.2],
          [31, 0.34],
          [32, 0.1],
          [47, 0.2],
          [56, 0.4],
          [63, 0.05],
        ),
        pan: -0.1,
        reverb: hall,
        fx: orbit,
      }),
    );
    s.track(
      voice("lift", "Breath lifts", "white", 0.09, {
        synth: { attack: 0.35, release: 0.1 },
        reverb: hall,
        filter: { type: "hpf", cutoff: 1800, resonance: 0.1 },
        filterAutomation: lanes(
          [0, 800],
          [15, 1700],
          [19, 1100],
          [23, 6200],
          [24, 1000],
          [31, 5000],
          [32, 800],
          [43, 1000],
          [47, 6500],
          [48, 1200],
          [55, 7000],
          [56, 1400],
          [59, 4700],
          [60, 1800],
        ),
      }),
    );
    const chords = [
        [57, 60, 64, 71],
        [57, 60, 65, 69],
        [55, 60, 64, 67],
        [55, 59, 62, 67],
      ],
      roots = [33, 29, 36, 31];
    const hook: Phrase = [
      [0, 76, 0.43, 0.7],
      [0.75, 72, 0.4, 0.58],
      [1.5, 71, 0.4, 0.67],
      [2.5, 69, 0.8, 0.74],
    ];
    const sung: Phrase = [
      [0, 69, 0.7, 0.72, "We"],
      [1, 72, 0.7, 0.76, "keep"],
      [2, 74, 0.7, 0.8, "the"],
      [3, 76, 1.5, 0.84, "light"],
    ];
    for (let b = 0; b < 64; b++) {
      const chorus = (b >= 24 && b < 32) || (b >= 48 && b < 60),
        bridge = b >= 32 && b < 40;
      const c = b >= 60 ? 0 : Math.floor(b / 2) % 4,
        chord = chords[c]!,
        root = roots[c]!;
      if (b >= 4 && b < 60) {
        if (b < 36 || b >= 40)
          s.grid(
            "kick",
            b,
            36,
            bridge
              ? "8.......5......."
              : b % 2
                ? "8.....5.7..5...."
                : "8.......7.5.....",
          );
        s.grid(
          "snare",
          b,
          38,
          bridge ? "........8......." : "....7.......8...",
        );
        s.grid("hats", b, 42, chorus ? "5.3.6.3.5.3.6.4." : "4...5...4...5...");
        if (chorus) s.grid("hats", b, 46, "......4.......5.");
        if (chorus && b % 2 === 1) s.grid("perc", b, 39, "....4.......4...");
        s.phrase(
          "bass",
          b,
          bridge
            ? [
                [0, root, 1.7, 0.61],
                [2.5, root, 0.9, 0.5],
              ]
            : [
                [0, root, 0.7, 0.8],
                [1.5, root, 0.35, 0.62],
                [2, root, 0.7, 0.73],
                [3.5, root + 12, 0.3, 0.58],
              ],
        );
        if (b >= 44 && b < 48)
          s.grid(
            "perc",
            b,
            38,
            b >= 46 ? ".......2...3.456" : "...........2...3",
            0.55,
          );
      }
      if (bridge) {
        for (let i = 0; i < 8; i++)
          s.note(
            "hook",
            b,
            i * 0.5,
            chord[i % 4]! + 12,
            0.25,
            0.44 + (i % 4 === 0 ? 0.13 : 0),
          );
      } else if (b % 2 === 0)
        s.chord("chords", b, 0, chord, 7.5, chorus ? 0.69 : 0.52);
      if (
        b < 4 ||
        (b >= 16 && b < 24) ||
        (chorus && b % 4 >= 2) ||
        (b >= 60 && b < 63)
      )
        s.phrase("hook", b, hook, c === 3 ? -2 : 0, chorus ? 0.73 : 1);
      if (b === 63) s.note("hook", b, 0, 69, 3.7, 0.48);
      if (chorus && b % 4 === 0) {
        s.phrase("vocal", b, sung);
        s.phrase("vocal", b + 1, [
          [1, 74, 0.7, 0.76, "a"],
          [2, 72, 0.75, 0.75, "live"],
          [3, 69, 1.5, 0.76, "oh"],
        ]);
        if (b >= 48)
          s.phrase("double", b, [
            [2, 81, 1.7, 0.45],
            [4, 79, 1.5, 0.4],
          ]);
      } else if ((b >= 8 && b < 16) || (b >= 40 && b < 48)) {
        if (b % 4 === 0)
          s.phrase("vocal", b, [
            [0.5, 64, 0.65, 0.58, "Small"],
            [1.5, 67, 0.65, 0.64, "sparks"],
            [2.5, 69, 1.2, 0.69, "rise"],
          ]);
        if (b % 4 === 2)
          s.phrase("vocal", b, [
            [0, 67, 0.7, 0.6, "through"],
            [1, 64, 0.7, 0.6, "the"],
            [2, 62, 1.35, 0.64, "night"],
          ]);
      }
      // Late responses leave the main singer two clear bars for each line.
      if ((chorus && b % 4 === 3) || [18, 22, 46].includes(b)) {
        s.phrase("stay", b, [
          [0.5, 69, 0.35, 0.68],
          [2.5, 72, 0.3, 0.49],
        ]);
        s.phrase("up", b, [
          [1.5, 71, 0.32, 0.66],
          [3.25, 69, 0.48, 0.59],
        ]);
      }
      if ([0, 20, 28, 36, 48, 56, 60].includes(b))
        s.chord(
          "halo",
          b,
          0,
          chord.map((p) => p + 12),
          b === 60 ? 12 : 7.5,
          0.45,
        );
      if ([15, 23, 31, 47, 55, 59].includes(b)) {
        s.fill(b, "perc", 0.57);
        s.note("lift", b, 0, 60, 3.8, 0.6);
      }
    }
    return s.finish();
  },
};
