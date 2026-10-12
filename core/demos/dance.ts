/** Three dance forms with deliberately different rhythmic and melodic identities. */
import { bundledSampleRef } from "../bundled-samples.ts";
import {
  Composer,
  fourFloor,
  hall,
  lanes,
  machineTracks,
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

export const afterHours: DemoDefinition = {
  info: demoInfo({
    id: "after-hours",
    title: "After Hours",
    style: "Deep house",
    tempoBpm: 122,
    key: "Dm",
    bars: 64,
    highlightBar: 48,
    trackId: "keys",
    description:
      "A warm four-floor room: elastic bass, rootless Rhodes and clipped organ replies settle into a swung percussion pocket, then open into a brighter last refrain.",
    features: [
      "four-floor 909",
      "swung congas and shakers",
      "rootless Rhodes ninths",
      "organ answers",
      "syncopated bass",
      "vocal call and response",
    ],
    arrangement: [
      "Door open 8",
      "Room groove 8",
      "Rhodes refrain 8",
      "Organ reply 8",
      "Low lights 8",
      "Room return 8",
      "Open windows 8",
      "Walk home 8",
    ],
    mixNotes: [
      "The kick is steady and dry. Bass notes arrive just after it or on pickups; subtle ducking leaves the groove elastic instead of heavily pumping.",
      "Rhodes thirds, sevenths and ninths leave roots to the bass. Short organ answers and vocal cuts fill different gaps in the two-bar phrase.",
      "The middle removes kick and organ, lets the chord tails breathe, and adds shaker motion before the return. Final Rhodes voicings rise while the bass keeps its pocket.",
    ],
  }),
  build() {
    const s = new Composer(afterHours.info);
    [
      "Door open",
      "Room groove",
      "Rhodes refrain",
      "Organ reply",
      "Low lights",
      "Room return",
      "Open windows",
      "Walk home",
    ].forEach((name, i) => s.section(name, i * 8, 8));
    machineTracks(s, "syn909", 0.74);
    // House pumps less than the EDM piece: the offbeat bass does most of the work.
    s.tracks[0] = voice("kick", "Room kick", "kit", 0.74, {
      kit: "syn909",
      fx: { duck: { orbit: 2, depth: 0.26, attack: 0.105 } },
    });
    s.track(
      voice("percussion", "Hands & shaker", "kit", 0.33, {
        kit: "acoustic",
        pan: -0.23,
        reverb: { mix: 0.05, size: 0.24, fade: 0.6 },
      }),
    );
    s.track(
      preset("bass", "Elastic bass", "pluck-bass", 0.55, {
        fx: orbit,
        filter: { cutoff: 1500, resonance: 0.16 },
      }),
    );
    s.track(
      voice("keys", "Late Rhodes", "rhodes", 0.47, {
        pan: -0.13,
        reverb: room,
        fx: orbit,
        filterAutomation: lanes(
          [0, 1700],
          [15, 4200],
          [31, 5700],
          [32, 2200],
          [39, 3400],
          [40, 4600],
          [55, 6500],
          [63, 1500],
        ),
      }),
    );
    s.track(
      preset("organ", "Round organ", "jazz-organ", 0.28, {
        pan: 0.2,
        filter: { type: "hpf", cutoff: 210, resonance: 0 },
        delay: { beats: 0.75, feedback: 0.17, mix: 0.11 },
        reverb: room,
        fx: orbit,
      }),
    );
    s.track(
      voice("vocal", "Hold the room", "sampler", 0.31, {
        sampler: {
          mode: "keyed",
          voices: {
            hold: {
              ...bundledSampleRef("hold-on"),
              begin: 0,
              end: 0.25,
              fit: true,
              fadeTime: 0.02,
            },
          },
        },
        filter: { type: "hpf", cutoff: 280, resonance: 0 },
        pan: 0.07,
        delay: { beats: 1.5, feedback: 0.29, mix: 0.2, pingpong: true },
        reverb: room,
      }),
    );
    s.track(
      preset("air", "Soft ceiling", "choir-pad", 0.13, {
        filter: { type: "hpf", cutoff: 500, resonance: 0 },
        reverb: hall,
        fx: orbit,
      }),
    );
    s.track(
      voice("bell", "Window chime", "vibes", 0.18, { pan: 0.31, reverb: hall }),
    );
    const roots = [26, 31, 36, 33],
      chords = [
        [53, 57, 60, 64],
        [53, 57, 59, 64],
        [52, 55, 59, 62],
        [55, 58, 61, 64],
      ];
    const refrain: Phrase = [
      [0.75, 77, 0.4, 0.65],
      [1.5, 76, 0.7, 0.7],
      [3, 72, 0.63, 0.66],
      [4.75, 69, 0.55, 0.59],
      [6, 72, 1.1, 0.68],
    ];
    for (let b = 0; b < 64; b++) {
      const middle = b >= 32 && b < 40,
        outro = b >= 56,
        c = outro ? 0 : Math.floor(b / 2) % 4,
        chord = chords[c]!,
        root = roots[c]!;
      if (!middle && b < 62)
        fourFloor(s, b, b < 4 ? 0.5 : outro ? 0.71 : 0.95, b % 4);
      if (b >= 4 && b < 60) {
        s.grid(
          "percussion",
          b,
          69,
          b % 2 ? ".2.3.2.3.2.3.234" : ".2.3.2.3.2.3.2.3",
          middle ? 0.5 : 1,
          0.042,
        );
        if (!middle || b >= 36) {
          s.grid(
            "percussion",
            b,
            64,
            b % 2 ? "...4.....3....4." : "...4......3..4..",
            0.7,
            0.04,
          );
          s.grid("percussion", b, 63, ".......3.......4", 0.63, 0.04);
        }
      }
      if (b >= 8 && !middle && b < 60) {
        s.phrase("bass", b, [
          [0.5, root, 0.38, 0.8],
          [1.75, root + 7, 0.22, 0.61],
          [2.5, root + 12, 0.4, 0.72],
          [3.5, root + (b % 2 ? 10 : 7), 0.25, 0.58],
        ]);
      } else if (middle && b % 4 === 0) s.note("bass", b, 0, root, 2.6, 0.42);
      if (b < 62) {
        const voicing =
          b >= 48 && b < 56 ? [...chord.slice(1), chord[0]! + 12] : chord;
        s.chord(
          "keys",
          b,
          b % 2 ? 0.56 : 0.04,
          voicing,
          middle ? 2.7 : 0.9,
          middle ? 0.54 : 0.58,
        );
        if (!middle && b >= 8 && !outro)
          s.chord("keys", b, 2.78, voicing, 0.48, 0.43);
      }
      if (((b >= 16 && b < 24) || (b >= 40 && b < 56)) && b % 4 === 0)
        s.phrase("keys", b, refrain, 0, 0.82);
      if (((b >= 24 && b < 32) || (b >= 44 && b < 56)) && b % 2 === 1) {
        s.chord(
          "organ",
          b,
          1.27,
          chord.slice(0, 3).map((n) => n + 12),
          0.31,
          0.59,
        );
        s.chord(
          "organ",
          b,
          3.28,
          chord.slice(0, 3).map((n) => n + 12),
          0.39,
          0.52,
        );
      }
      if (((b >= 16 && b < 32) || (b >= 40 && b < 56)) && b % 4 === 2) {
        s.note("vocal", b, 0.75, 65, 0.52, 0.68);
        s.note("vocal", b, 2.5, 69, 0.48, 0.54);
      }
      if (b % 8 === 0)
        s.chord(
          "air",
          b,
          0,
          [chord[0]! + 12, chord[2]! + 12, chord[3]! + 12],
          middle ? 15 : 7.5,
          0.51,
        );
      if ([0, 16, 32, 40, 48, 60].includes(b))
        s.phrase("bell", b, [
          [0.75, 81, 0.9, 0.42],
          [2.75, 76, 1.2, 0.35],
        ]);
      if ([15, 31, 47, 55].includes(b)) s.fill(b, "drums", 0.38);
      if (b === 62) {
        s.chord("keys", b, 0, chords[0]!, 7.5, 0.45);
        s.note("bass", b, 0, 26, 5, 0.5);
      }
    }
    return s.finish();
  },
};

export const skylineCurrent: DemoDefinition = {
  info: demoInfo({
    id: "skyline-current",
    title: "Skyline Current",
    style: "Melodic EDM",
    tempoBpm: 128,
    key: "Bm",
    bars: 64,
    highlightBar: 48,
    trackId: "lead",
    description:
      "A rising five-note theme grows from a plucked arpeggio into a wide, pumping saw drop. A long vocal-pad break and accelerating snare build set up the developed second peak.",
    features: [
      "wide supersaw drop",
      "kick-triggered sidechain",
      "pluck arpeggio",
      "accelerating snare build",
      "vocal-pad breakdown",
      "second-drop melodic variation",
    ],
    arrangement: [
      "Horizon 8",
      "Gather 8",
      "First rise 4",
      "First drop 8",
      "Afterimage 4",
      "Open air 8",
      "Long rise 8",
      "Second drop 8",
      "High current 4",
      "Home 4",
    ],
    mixNotes: [
      "Bass, chord stack and lead share the kick's ducked orbit. High-passed chord and vocal layers leave the mono kick and sub clear.",
      "The lead's five-note contour is introduced as a quiet pluck. Arpeggios switch off under the densest lead phrase and return as a higher answer late in the second drop.",
      "The snare accelerates from quarter notes to eighths and sixteenths while noise brightens. The last half-bar clears before the drop; the second peak changes phrase endings and doubles the upper answer.",
    ],
  }),
  build() {
    const s = new Composer(skylineCurrent.info);
    for (const [name, start, bars] of [
      ["Horizon", 0, 8],
      ["Gather", 8, 8],
      ["First rise", 16, 4],
      ["First drop", 20, 8],
      ["Afterimage", 28, 4],
      ["Open air", 32, 8],
      ["Long rise", 40, 8],
      ["Second drop", 48, 8],
      ["High current", 56, 4],
      ["Home", 60, 4],
    ] as const)
      s.section(name, start, bars);
    machineTracks(s, "syn909", 0.8);
    s.tracks[0] = voice("kick", "Current kick", "kit", 0.8, {
      kit: "syn909",
      fx: { duck: { orbit: 2, depth: 0.67, attack: 0.19 } },
    });
    s.track(
      voice("build", "Rise snare", "kit", 0.38, {
        kit: "syn909",
        reverb: { mix: 0.13, size: 0.38, fade: 1.1 },
        filterAutomation: lanes(
          [0, 900],
          [16, 1100],
          [19, 6800],
          [20, 900],
          [40, 900],
          [47, 8200],
          [48, 900],
        ),
      }),
    );
    s.track(
      voice("sub", "Root current", "sine", 0.58, {
        synth: { attack: 0.004, decay: 0.16, sustain: 0.82, release: 0.08 },
        fx: {
          ...orbit,
          distort: { type: "soft", drive: 0.8, mix: 0.24, tone: 1000 },
        },
      }),
    );
    s.track(
      voice("chords", "Wide skyline", "supersaw", 0.16, {
        synth: {
          attack: 0.012,
          decay: 0.2,
          sustain: 0.61,
          release: 0.2,
          unison: 5,
          detune: 0.21,
          lpf: 6500,
        },
        filter: { type: "hpf", cutoff: 270, resonance: 0 },
        reverb: room,
        fx: orbit,
      }),
    );
    s.track(
      preset("arp", "Horizon pluck", "house-pluck", 0.28, {
        pan: -0.16,
        delay: { beats: 0.75, feedback: 0.27, mix: 0.18, pingpong: true },
        reverb: room,
        fx: orbit,
        filterAutomation: lanes(
          [0, 950],
          [15, 3700],
          [19, 7100],
          [20, 2700],
          [31, 1700],
          [32, 900],
          [39, 1500],
          [47, 8300],
          [48, 3200],
          [59, 5600],
          [63, 700],
        ),
      }),
    );
    s.track(
      voice("lead", "Skyline theme", "supersaw", 0.19, {
        synth: {
          attack: 0.008,
          decay: 0.14,
          sustain: 0.55,
          release: 0.15,
          unison: 3,
          detune: 0.12,
          lpf: 7800,
        },
        filter: { type: "hpf", cutoff: 450, resonance: 0 },
        delay: { beats: 0.75, feedback: 0.21, mix: 0.12, pingpong: true },
        reverb: room,
        fx: orbit,
      }),
    );
    s.track(
      voice("vowel", "Open-air choir", "sampler", 0.18, {
        sampler: {
          mode: "keyed",
          voices: {
            ah: {
              ...bundledSampleRef("vowel-ah"),
              fit: true,
              fadeTime: 0.15,
              fadeInTime: 0.08,
            },
          },
        },
        filter: { type: "hpf", cutoff: 490, resonance: 0 },
        reverb: hall,
        fx: orbit,
      }),
    );
    s.track(
      voice("rise", "Air lift", "white", 0.08, {
        synth: { attack: 0.7, decay: 0.2, sustain: 0.7, release: 0.15 },
        filter: { type: "hpf", cutoff: 1800, resonance: 0 },
        reverb: room,
        volumeAutomation: lanes(
          [0, 0.01],
          [16, 0.02],
          [19, 0.11],
          [20, 0.01],
          [40, 0.01],
          [43, 0.05],
          [47, 0.14],
          [48, 0.01],
          [63, 0.01],
        ),
        fxAutomation: {
          "synth-lpf": lanes(
            [0, 1800],
            [16, 2400],
            [19, 11000],
            [20, 1800],
            [40, 1600],
            [47, 13000],
            [48, 1800],
          ),
        },
      }),
    );
    s.track(
      voice("impact", "Bright landing", "kit", 0.27, {
        kit: "syn909",
        reverb: hall,
      }),
    );
    s.track(
      voice("bell", "Last horizon", "vibes", 0.2, { pan: 0.27, reverb: hall }),
    );
    const roots = [35, 31, 38, 33],
      chords = [
        [59, 62, 66],
        [59, 62, 67],
        [57, 62, 66],
        [57, 61, 64],
      ];
    const theme: Phrase = [
      [0, 78, 0.75, 0.78],
      [1, 81, 0.45, 0.71],
      [1.75, 83, 0.9, 0.85],
      [3, 81, 0.72, 0.76],
      [4.5, 78, 0.65, 0.72],
      [5.5, 76, 0.5, 0.68],
      [6.5, 74, 1.35, 0.79],
    ];
    const varied: Phrase = [
      [0, 78, 0.7, 0.8],
      [1, 81, 0.42, 0.71],
      [1.75, 83, 0.84, 0.86],
      [3, 86, 0.75, 0.76],
      [4.5, 85, 0.6, 0.73],
      [5.5, 81, 0.48, 0.7],
      [6.25, 78, 1.5, 0.82],
    ];
    for (let b = 0; b < 64; b++) {
      const drop = (b >= 20 && b < 28) || (b >= 48 && b < 60),
        build = (b >= 16 && b < 20) || (b >= 40 && b < 48),
        air = b >= 32 && b < 40,
        last = b >= 60,
        c = last ? 0 : Math.floor(b / 2) % 4,
        chord = chords[c]!,
        root = roots[c]!;
      if ((b >= 8 && b < 16) || drop || (b >= 28 && b < 32))
        fourFloor(s, b, drop ? 1 : 0.73, b % 4);
      if (drop) {
        s.phrase("sub", b, [
          [0, root, 0.94, 0.83],
          [1, root, 0.93, 0.78],
          [2, root, 0.93, 0.82],
          [3, root, 0.84, 0.76],
        ]);
        s.chord("chords", b, 0, chord, 3.65, 0.63);
        if (b % 2 === 0)
          s.phrase("lead", b, b >= 52 && b % 4 === 0 ? varied : theme);
        if (b >= 56 && b % 2 === 1)
          s.phrase("bell", b, [
            [0.5, 90, 0.4, 0.44],
            [1.5, 86, 0.4, 0.48],
            [2.5, 85, 0.6, 0.41],
          ]);
      } else if ((b >= 8 && b < 16) || (b >= 28 && b < 40)) {
        s.note("sub", b, 0, root, air ? 3.5 : 2.1, air ? 0.4 : 0.61);
      }
      if (!drop || b % 4 >= 2) {
        const pitches = [
          chord[0]! + 12,
          chord[2]! + 12,
          chord[1]! + 12,
          chord[2]! + 24,
        ];
        const density = build && b >= 44 ? 16 : 8;
        for (let i = 0; i < density; i++)
          s.note(
            "arp",
            b,
            (i * 4) / density,
            pitches[i % 4]!,
            density === 16 ? 0.18 : 0.3,
            (i % 4 === 0 ? 0.63 : 0.43) * (air ? 0.6 : last ? 0.54 : 1),
          );
      }
      if ((air || b < 8 || build || last) && b % 2 === 0)
        s.chord(
          "vowel",
          b,
          0,
          chord.map((n) => n + 12),
          7.5,
          air ? 0.64 : 0.46,
        );
      if ((b < 8 || air) && b % 4 === 0) s.phrase("bell", b, theme, 0, 0.62);
      if (build) {
        const remaining = (b < 20 ? 20 : 48) - b,
          step = remaining <= 1 ? 0.25 : remaining <= 2 ? 0.5 : 1;
        const end = remaining === 1 ? 3.5 : 4;
        for (let beat = 0; beat < end; beat += step)
          s.note(
            "build",
            b,
            beat,
            38,
            0.12,
            0.29 + (4 - remaining) * 0.035 + beat * 0.025,
          );
        if (b % 2 === 0) s.note("rise", b, 0, 60, 7.6, 0.6);
      }
      if ([8, 20, 28, 48, 56].includes(b)) s.note("impact", b, 0, 49, 2.5, 0.6);
      if ([27, 55, 59].includes(b)) s.fill(b, "drums", 0.45);
      if (b === 62) {
        s.chord("vowel", b, 0, [71, 74, 78], 7.5, 0.37);
        s.note("bell", b, 0, 83, 3.6, 0.45);
      }
    }
    // Dry space before the main landing; any reverb tails remain musical.
    for (let i = s.notes.length - 1; i >= 0; i--) {
      const n = s.notes[i]!;
      if (n.startTick! >= 47 * 1920 + 960 && n.startTick! < 48 * 1920)
        s.notes.splice(i, 1);
    }
    return s.finish();
  },
};
