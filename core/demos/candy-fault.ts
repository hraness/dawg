/** Candy Fault: the hyperpop demo song. */
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

export const candyFault: DemoDefinition = {
  info: demoInfo({
    id: "candy-fault",
    title: "Candy Fault",
    style: "Hyperpop",
    description:
      "A bright, broken-pop hook flips from clipped 808 half-time into a rushing chorus. An original machine singer trades lines with tiny high-pitched vocal cuts.",
    tempoBpm: 156,
    key: "E",
    bars: 56,
    highlightBar: 44,
    trackId: "chops",
    features: [
      "pitched vocal stutters",
      "original synthetic chorus",
      "808 slides",
      "pulse-wave distortion",
      "half-time contrast",
      "bitcrushed ear candy",
    ],
    arrangement: [
      "Boot sparkle 4",
      "Half-time 8",
      "Sugar lift 4",
      "Bright fault 8",
      "Soft reset 8",
      "Rebuild 4",
      "Fault return 8",
      "Overload 8",
      "Last pixel 4",
    ],
    mixNotes: [
      "The centered sub bends between roots while the brighter pulse lead stays above it; both briefly yield to the kick.",
      "Shortened, pitched Stay Up syllables answer the singer instead of masking the lyric. The last chorus adds sixteenth-note stutters only at phrase ends.",
      "A quiet electric-piano middle removes the distorted layers. The return changes the hook's ending and places a silent beat before the final overload.",
    ],
  }),
  build() {
    const s = new Composer(candyFault.info);
    for (const [name, start, bars] of [
      ["Boot sparkle", 0, 4],
      ["Half-time", 4, 8],
      ["Sugar lift", 12, 4],
      ["Bright fault", 16, 8],
      ["Soft reset", 24, 8],
      ["Rebuild", 32, 4],
      ["Fault return", 36, 8],
      ["Overload", 44, 8],
      ["Last pixel", 52, 4],
    ] as const)
      s.section(name, start, bars);
    s.track(
      voice("kick", "Rubber kick", "kit", 0.74, {
        kit: "syn808",
        fx: { duck: { orbit: 2, depth: 0.5, attack: 0.105 } },
      }),
    );
    s.track(
      voice("snap", "Snap & clap", "kit", 0.49, {
        kit: "synlinn",
        reverb: { mix: 0.07, size: 0.25, fade: 0.5 },
      }),
    );
    s.track(
      voice("hats", "Needle hats", "kit", 0.31, { kit: "syn808", pan: 0.14 }),
    );
    s.track(
      voice("sub", "Bending sub", "sine", 0.58, {
        synth: {
          attack: 0.003,
          decay: 0.35,
          sustain: 0.63,
          release: 0.075,
          lpf: 950,
        },
        fx: {
          ...orbit,
          distort: { type: "soft", drive: 1.8, tone: 1700, mix: 0.38 },
        },
      }),
    );
    s.track(
      voice("hook", "Plastic hook", "pulse", 0.21, {
        synth: {
          attack: 0.003,
          decay: 0.085,
          sustain: 0.28,
          release: 0.07,
          pw: 0.22,
          lpf: 6500,
        },
        filter: { type: "hpf", cutoff: 260, resonance: 0 },
        fx: {
          ...orbit,
          distort: { type: "fold", drive: 1.1, mix: 0.25, tone: 5900 },
        },
        delay: { beats: 0.75, feedback: 0.22, mix: 0.13, pingpong: true },
        reverb: room,
        fxAutomation: {
          "synth-pw": lanes(
            [0, 0.22],
            [16, 0.37],
            [23, 0.18],
            [36, 0.28],
            [44, 0.42],
            [51, 0.2],
          ),
        },
      }),
    );
    s.track(
      voice("keys", "Soft reset keys", "rhodes", 0.39, {
        pan: -0.18,
        reverb: hall,
      }),
    );
    s.track(
      voice("chords", "Sugar stack", "supersaw", 0.14, {
        synth: {
          attack: 0.008,
          decay: 0.12,
          sustain: 0.24,
          release: 0.09,
          unison: 3,
          detune: 0.22,
          lpf: 4800,
        },
        filter: { type: "hpf", cutoff: 330, resonance: 0 },
        reverb: room,
        fx: orbit,
      }),
    );
    s.track(
      voice("vocal", "Candy singer", "sing", 0.49, {
        sing: {
          preset: "aah",
          voice: "alto",
          articulate: 1,
          breath: 0.05,
          jitter: 0.035,
          vib: 5.4,
          vibmod: 0.045,
          ring: 0.21,
        },
        filter: { type: "hpf", cutoff: 230, resonance: 0 },
        delay: { beats: 0.5, feedback: 0.13, mix: 0.09 },
        reverb: room,
      }),
    );
    s.track(
      voice("chops", "Up pixels", "sampler", 0.31, {
        sampler: {
          mode: "keyed",
          voices: {
            up: {
              ...bundledSampleRef("stay-up"),
              begin: 0.25,
              end: 0.5,
              fit: true,
              fadeTime: 0.007,
              fadeInTime: 0.002,
            },
          },
        },
        pan: 0.22,
        filter: { type: "hpf", cutoff: 650, resonance: 0 },
        fx: { crush: { bits: 10, coarse: 2, mix: 0.19 } },
        delay: { beats: 0.75, feedback: 0.2, mix: 0.12, pingpong: true },
      }),
    );
    s.track(
      voice("spark", "Glass pixels", "sampler", 0.18, {
        sampler: {
          mode: "keyed",
          voices: {
            glass: { ...bundledSampleRef("glass-hit"), fadeTime: 0.012 },
          },
        },
        pan: -0.31,
        reverb: hall,
        fx: { crush: { bits: 7, coarse: 2, mix: 0.24 } },
      }),
    );
    s.track(
      voice("tear", "Tape tears", "sampler", 0.26, {
        sampler: {
          mode: "keyed",
          voices: {
            tape: { ...bundledSampleRef("tape-hit"), fadeTime: 0.006 },
          },
        },
        filter: { type: "hpf", cutoff: 190, resonance: 0 },
      }),
    );
    const roots = [28, 35, 37, 33],
      harmony = [
        [56, 59, 63],
        [54, 59, 63],
        [56, 61, 64],
        [57, 61, 64],
      ];
    const hook: Phrase = [
      [0, 76, 0.32, 0.78],
      [0.75, 75, 0.2, 0.63],
      [1.25, 71, 0.42, 0.75],
      [2, 68, 0.34, 0.64],
      [2.75, 71, 0.7, 0.76],
    ];
    const reply: Phrase = [
      [0.5, 80, 0.24, 0.62],
      [1, 78, 0.36, 0.66],
      [2, 76, 0.6, 0.72],
      [3, 71, 0.65, 0.63],
    ];
    for (let b = 0; b < 56; b++) {
      const chorus = (b >= 16 && b < 24) || (b >= 36 && b < 52),
        soft = b >= 24 && b < 32,
        build = (b >= 12 && b < 16) || (b >= 32 && b < 36),
        last = b >= 52,
        c = last ? 0 : Math.floor(b / 2) % 4,
        root = roots[c]!,
        chord = harmony[c]!;
      if (b >= 4 && !soft && !last) {
        s.grid(
          "kick",
          b,
          36,
          chorus
            ? b % 2
              ? "8...8...8..58..."
              : "8...7...8...7..."
            : b % 2
              ? "8......5...6...."
              : "8.....6...5.....",
        );
        s.grid("snap", b, 38, chorus ? "....8.......8..." : "........8.......");
        if (chorus) s.grid("snap", b, 39, "....5.......5...");
        s.grid("hats", b, 42, chorus ? "4.3.5.3.4.3.5.23" : "4...3.2.4...3...");
        if (b % 4 === 3 && !build)
          s.grid("hats", b, 42, "............2345", 0.75);
        s.phrase("sub", b, [
          [0, root, 1.35, 0.83],
          [1.75, root, 0.48, 0.64],
          [2.5, root, 1.13, 0.76],
        ]);
        if (b % 2 === 1)
          s.note("sub", b, 3.75, root + 12, 0.2, 0.65, { glide: 0.065 });
      }
      if (b % 2 === 0 && (b < 16 || soft || last))
        s.chord("keys", b, 0, chord, 7.4, soft ? 0.63 : 0.45);
      if (chorus) {
        s.chord(
          "chords",
          b,
          0.5,
          chord.map((n) => n + 12),
          0.34,
          0.6,
        );
        s.chord(
          "chords",
          b,
          2.5,
          chord.map((n) => n + 12),
          0.42,
          0.53,
        );
        // Singer takes the opening two bars; the pulse hook takes the answer.
        if (b % 4 >= 2)
          s.phrase(
            "hook",
            b,
            b >= 44 && b % 4 === 3 ? reply : hook,
            0,
            b >= 44 ? 1 : 0.91,
          );
        if (b % 4 === 0) {
          s.phrase("vocal", b, [
            [0, 68, 0.6, 0.74, "We"],
            [0.75, 71, 0.85, 0.78, "glow"],
            [2, 75, 0.6, 0.8, "in"],
            [2.75, 76, 1.1, 0.86, "the"],
          ]);
          s.phrase("vocal", b + 1, [
            [0, 78, 1.25, 0.82, "sta"],
            [1.5, 76, 0.6, 0.78, "tic"],
            [2.5, 71, 0.95, 0.78, "oh"],
          ]);
        }
        if (b % 4 === 3) {
          s.phrase("chops", b, [
            [0.25, 83, 0.19, 0.68],
            [1.25, 80, 0.2, 0.64],
            [2.75, 78, 0.22, 0.69],
          ]);
          if (b >= 44)
            for (let i = 0; i < 4; i++)
              s.note(
                "chops",
                b,
                3 + i * 0.25,
                76 + (i % 2) * 7,
                0.12,
                0.64 - i * 0.065,
              );
        }
      } else if (b < 4 || build || last) {
        s.phrase("hook", b, hook, 0, b < 4 ? 0.68 : last ? 0.45 : 0.65);
        if (build)
          s.grid(
            "snap",
            b,
            38,
            b % 4 >= 2 ? "2.2.3.3.4.4.5678" : "....2.......3...",
            0.61,
          );
      }
      if (soft && b % 4 === 0) {
        s.phrase("vocal", b, [
          [0.5, 64, 1.4, 0.49, "Slow"],
          [2.5, 68, 2.6, 0.53, "down"],
        ]);
        s.note("sub", b, 0, root, 3.2, 0.42);
        s.grid("hats", b, 42, "4.......2.......", 0.5);
      }
      if ([0, 12, 16, 24, 32, 36, 44, 52].includes(b))
        s.note("spark", b, 0.5, 88, 1.2, 0.61);
      if ([15, 23, 35, 43, 51].includes(b)) {
        s.note("tear", b, 3, 60, 0.45, 0.8);
        for (let i = 0; i < 3; i++)
          s.note(
            "chops",
            b,
            3.25 + i * 0.25,
            84 - i * 2,
            0.105,
            0.61 - i * 0.12,
          );
      }
      if (b === 55) {
        s.note("keys", b, 0, 64, 3.5, 0.37);
        s.note("spark", b, 0, 88, 1.5, 0.4);
      }
    }
    // A deliberate final beat of empty space makes the last return land.
    const gapBegin = 44 * 1920 - 480,
      gapEnd = 44 * 1920;
    for (let i = s.notes.length - 1; i >= 0; i--) {
      const n = s.notes[i]!;
      if (n.startTick! >= gapBegin && n.startTick! < gapEnd)
        s.notes.splice(i, 1);
    }
    return s.finish();
  },
};
