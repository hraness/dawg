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

export const amberRoom: DemoDefinition = {
  info: demoInfo({
    id: "amber-room",
    title: "Amber Room",
    style: "Neo soul",
    description:
      "A six-note sax theme sits in a live-feeling pocket with muted bass and rootless electric-piano voicings; the middle lets the keys lead.",
    tempoBpm: 96,
    key: "F",
    bars: 48,
    highlightBar: 32,
    trackId: "sax",
    features: [
      "physical bass",
      "expressive sax",
      "rootless ninths",
      "ghost-note pocket",
      "electric-piano variation",
    ],
    arrangement: [
      "Doorway 4",
      "Head 12",
      "Pocket 8",
      "Keys alone 8",
      "Head return 12",
      "Goodnight 4",
    ],
    mixNotes: [
      "The bass carries chord roots; piano thirds, sevenths and ninths stay above it and move economically.",
      "Sax phrases breathe for two bars before the answer, using short pickups and a held resolution.",
      "The piano break reduces drums to rim and hats; the returning head adds a restrained high reply and a real ending.",
    ],
  }),
  build() {
    const s = new Composer(amberRoom.info);
    for (const [name, start, bars] of [
      ["Doorway", 0, 4],
      ["Head", 4, 12],
      ["Pocket", 16, 8],
      ["Keys alone", 24, 8],
      ["Head return", 32, 12],
      ["Goodnight", 44, 4],
    ] as const)
      s.section(name, start, bars);
    s.track(
      voice("drums", "Small-room kit", "kit", 0.6, {
        kit: "acoustic",
        reverb: { mix: 0.065, size: 0.25, fade: 0.75 },
      }),
    );
    s.track(
      voice("bass", "Fingered bass", "fender", 0.6, {
        string: { preset: "ebass", mute: 0.13, bright: 0.47 },
        pan: -0.03,
      }),
    );
    s.track(
      voice("keys", "Amber Rhodes", "rhodes", 0.5, { pan: -0.2, reverb: room }),
    );
    s.track(
      voice("sax", "Amber theme", "sax", 0.43, {
        wind: { preset: "sax" },
        pan: 0.14,
        reverb: { mix: 0.12, size: 0.4, fade: 1.8 },
        delay: { beats: 0.75, feedback: 0.14, mix: 0.07 },
        filter: { type: "hpf", cutoff: 170, resonance: 0 },
      }),
    );
    s.track(
      voice("vibes", "High answer", "vibes", 0.23, { pan: 0.34, reverb: hall }),
    );
    const chords = [
        [57, 60, 64, 67],
        [57, 60, 64, 65],
        [58, 62, 65, 69],
        [58, 62, 64, 69],
      ],
      roots = [29, 26, 31, 36];
    const theme: Phrase = [
      [0.5, 69, 0.6, 0.71],
      [1.25, 72, 0.45, 0.69],
      [2, 74, 0.7, 0.78],
      [3, 72, 1.45, 0.7],
      [5, 69, 0.7, 0.63],
      [6.25, 67, 1.2, 0.68],
    ];
    const answer: Phrase = [
      [0.75, 65, 0.6, 0.65],
      [1.5, 67, 0.45, 0.7],
      [2.25, 69, 0.7, 0.74],
      [3.25, 64, 1.5, 0.65],
      [5.25, 62, 0.7, 0.6],
      [6.5, 60, 1.1, 0.65],
    ];
    for (let b = 0; b < 48; b++) {
      const solo = b >= 24 && b < 32,
        root = roots[Math.floor(b / 2) % 4]!,
        chord = chords[Math.floor(b / 2) % 4]!;
      if (b >= 4 && b < 44) {
        s.grid(
          "drums",
          b,
          36,
          b % 2 ? "8......5..6....." : "8.....4.6.......",
          solo ? 0.58 : 1,
        );
        s.note("drums", b, 1.026, solo ? 37 : 38, 0.15, solo ? 0.5 : 0.71);
        s.note("drums", b, 3.03, solo ? 37 : 38, 0.15, solo ? 0.54 : 0.77);
        s.grid("drums", b, 42, "4.2.5.234.2.5.23", solo ? 0.65 : 1, 0.035);
        if (!solo) {
          s.note("drums", b, 1.8, 38, 0.1, 0.2);
          if (b % 2) s.note("drums", b, 2.8, 38, 0.1, 0.24);
        }
        s.phrase(
          "bass",
          b,
          [
            [0, root, 0.82, 0.76],
            [1.5, root + 7, 0.35, 0.57],
            [2.25, root + 12, 0.55, 0.67],
            [3.5, root + (b % 2 ? 2 : 7), 0.31, 0.57],
          ],
          0,
          solo ? 0.82 : 1,
        );
      }
      if (b < 44) {
        s.chord("keys", b, b % 2 ? 0.5 : 0, chord, solo ? 0.65 : 1.05, 0.58);
        s.chord("keys", b, 2.75, chord, 0.42, 0.44);
      }
      if (solo) {
        const p = chord.map((pitch) => pitch + 12);
        s.phrase("keys", b, [
          [1.25, p[0]!, 0.35, 0.6],
          [1.75, p[1]!, 0.4, 0.66],
          [2.5, p[2]!, 0.55, 0.68],
          [3.5, p[3]!, 0.4, 0.62],
        ]);
      }
      if ((b >= 4 && b < 16) || (b >= 32 && b < 44)) {
        if (b % 8 === 4) s.phrase("sax", b, theme, 0, b >= 32 ? 1 : 0.94);
        if (b % 8 === 0) s.phrase("sax", b, answer);
        if (b >= 32 && b % 4 === 2)
          s.phrase("vibes", b, [
            [2.5, 81, 0.5, 0.47],
            [3.25, 79, 0.6, 0.41],
          ]);
      }
      if (b >= 16 && b < 24 && b % 4 === 0)
        s.phrase("sax", b, [
          [0.5, 69, 0.7, 0.58],
          [2, 67, 1, 0.6],
        ]);
      if ([15, 23, 43].includes(b)) s.fill(b, "drums", 0.36);
      if (b === 44) {
        s.chord("keys", b, 0, [57, 60, 64, 67], 11.5, 0.57);
        s.note("bass", b, 0, 29, 7, 0.64);
        s.note("sax", b, 0.5, 65, 6.5, 0.66);
      }
    }
    return s.finish();
  },
};
