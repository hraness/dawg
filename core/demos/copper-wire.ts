/** Copper Wire: the jungle demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import { Composer, hall, lanes, orbit, preset, room, voice } from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

export const copperWire: DemoDefinition = {
  info: demoInfo({
    id: "copper-wire",
    title: "Copper Wire",
    style: "Jungle",
    description:
      "An original chopped drum-machine break races around a half-speed reese line; glass accents and a clipped vocal answer mark the turns.",
    tempoBpm: 170,
    key: "Em",
    bars: 80,
    highlightBar: 48,
    trackId: "break",
    features: [
      "authored break edits",
      "reese bass",
      "vocal stutters",
      "half-time contrast",
      "modular pad",
    ],
    arrangement: [
      "Wire up 8",
      "Motor 16",
      "First run 16",
      "Vacuum 8",
      "Chase 16",
      "Live wire 8",
      "Coast 8",
    ],
    mixNotes: [
      "The break uses acoustic and machine timbres but contains no borrowed recording.",
      "Kick and snare transients stay dry; the wide detuned bass is high-passed below its useful fundamental.",
      "The first run swaps drum cells every two bars. The chase adds displaced snares and a higher bass answer.",
    ],
  }),
  build() {
    const s = new Composer(copperWire.info);
    for (const [name, start, bars] of [
      ["Wire up", 0, 8],
      ["Motor", 8, 16],
      ["First run", 24, 16],
      ["Vacuum", 40, 8],
      ["Chase", 48, 16],
      ["Live wire", 64, 8],
      ["Coast", 72, 8],
    ] as const)
      s.section(name, start, bars);
    s.track(
      voice("break", "Wire break", "kit", 0.69, {
        kit: "acoustic",
        filter: { type: "hpf", cutoff: 45, resonance: 0.2 },
      }),
    );
    s.track(
      voice("kick", "Machine weight", "kit", 0.44, {
        kit: "syn808",
        fx: { duck: { orbit: 2, depth: 0.3, attack: 0.1 } },
      }),
    );
    s.track(
      preset("bass", "Reese current", "reese", 0.53, {
        filter: { cutoff: 550, resonance: 0.15 },
        fx: orbit,
        filterAutomation: lanes(
          [0, 550],
          [23, 1400],
          [39, 2600],
          [40, 400],
          [47, 1000],
          [63, 3600],
          [71, 2100],
          [79, 350],
        ),
      }),
    );
    s.track(
      preset("pad", "Indigo bed", "string-pad", 0.25, {
        reverb: hall,
        fx: orbit,
      }),
    );
    s.track(
      voice("chop", "Up fragments", "sampler", 0.47, {
        sampler: {
          mode: "keyed",
          voices: {
            up: {
              ...bundledSampleRef("stay-up"),
              begin: 0.25,
              end: 0.5,
              fit: true,
              fadeTime: 0.008,
              fadeInTime: 0.003,
            },
          },
        },
        filter: { type: "hpf", cutoff: 230, resonance: 0.2 },
        delay: { beats: 0.75, feedback: 0.2, mix: 0.16, pingpong: true },
        reverb: room,
      }),
    );
    s.track(
      voice("glass", "Signal glass", "sampler", 0.3, {
        pan: 0.3,
        sampler: {
          mode: "keyed",
          voices: { glass: bundledSampleRef("glass-hit") },
        },
        delay: { beats: 0.75, feedback: 0.32, mix: 0.2, pingpong: true },
      }),
    );
    s.track(
      voice("rise", "Noise marker", "sampler", 0.21, {
        sampler: {
          mode: "keyed",
          voices: {
            rise: { ...bundledSampleRef("riser"), fit: true, fadeTime: 0.02 },
          },
        },
        pan: -0.1,
      }),
    );
    const kick = [
      "8.....5...7.....",
      "8..4......7..5..",
      "8.....6.4.....6.",
      "8.......6..5....",
    ];
    const snare = [
      "....8..2....9.3.",
      "....8.....2.9...",
      "....8..2..4.9...",
      "....8.3.....9.24",
    ];
    const roots = [28, 28, 31, 26],
      chords = [
        [55, 59, 64, 66],
        [55, 59, 62, 66],
        [55, 59, 62, 67],
        [54, 57, 62, 66],
      ];
    for (let b = 0; b < 80; b++) {
      const vacuum = b >= 40 && b < 48,
        active = b >= 4 && !vacuum && b < 76,
        index = Math.floor(b / 2) % 4;
      if (active) {
        s.grid("break", b, 36, kick[b % 4]!, b < 8 ? 0.62 : 1);
        s.grid("break", b, 38, snare[b % 4]!, b < 8 ? 0.62 : 1);
        s.grid(
          "break",
          b,
          42,
          b >= 24 ? "5.3.6.345.3.6.24" : "5.2.6.2.5.2.6.23",
          1,
          0.012,
        );
        if (b >= 48 && b % 4 === 2) s.grid("break", b, 37, "..3....2.3....3.");
        s.grid("kick", b, 36, "8.......6.......");
      } else if (vacuum && b % 2 === 0) {
        s.note("break", b, 2, 38, 0.15, 0.52);
        s.note("break", b, 3, 42, 0.1, 0.25);
      }
      if (b >= 8 && !vacuum && b < 76) {
        const root = roots[index]!;
        s.phrase(
          "bass",
          b,
          b % 2
            ? [
                [0.5, root, 1.3, 0.8],
                [2.5, root + 7, 0.7, 0.64],
              ]
            : [
                [0, root, 2.3, 0.8],
                [3, root + (b >= 48 ? 12 : 0), 0.7, 0.67],
              ],
        );
      }
      if (b % 4 === 0)
        s.chord(
          "pad",
          b,
          0,
          chords[index]!,
          vacuum ? 14 : 7.2,
          vacuum ? 0.5 : 0.38,
        );
      if ((b >= 24 && b < 40) || (b >= 48 && b < 72)) {
        if (b % 4 === 0)
          s.phrase("chop", b, [
            [1.5, 64, 0.4, 0.66],
            [3.25, 67, 0.35, 0.72],
          ]);
        if (b % 4 === 3)
          s.phrase("chop", b, [
            [2.5, 62, 0.2, 0.6],
            [2.75, 62, 0.2, 0.5],
            [3.25, 64, 0.35, 0.7],
          ]);
        if (b % 2 === 0)
          s.phrase("glass", b, [
            [0.75, 83, 0.35, 0.4],
            [2.75, 78, 0.4, 0.33],
          ]);
      }
      if ([7, 23, 39, 47, 63, 71].includes(b))
        s.note("rise", b, 0, 60, 3.9, 0.62);
      if ([15, 31, 55, 63, 71].includes(b)) {
        for (let i = 0; i < 6; i++)
          s.note(
            "break",
            b,
            3 + i / 8,
            i < 4 ? 38 : 45,
            0.08,
            0.36 + i * 0.055,
          );
      }
    }
    return s.finish();
  },
};
