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

export const nightRelay: DemoDefinition = {
  info: demoInfo({
    id: "night-relay",
    title: "Night Relay",
    style: "Deep techno",
    description:
      "A patient minor-key relay: dub chords, answering metal and a low rolling pulse open into a wide final refrain.",
    tempoBpm: 122,
    key: "Fm",
    bars: 64,
    highlightBar: 40,
    trackId: "chords",
    features: [
      "909 pulse",
      "dub-chord automation",
      "FM bass",
      "metal sampler",
      "kick-triggered ducking",
    ],
    arrangement: [
      "Signal 8",
      "Pulse 8",
      "Weave 8",
      "Open 8",
      "Air 8",
      "Return 8",
      "Crest 8",
      "Dissolve 8",
    ],
    mixNotes: [
      "Kick and bass stay centered; the bass yields to the kick's bus trigger.",
      "Chord echoes alternate across the stereo field; cutoff and send grow through each ascent.",
      "Metal occupies the upper register; the final eight bars remove parts in reverse entry order.",
    ],
  }),
  build() {
    const s = new Composer(nightRelay.info);
    [
      "Signal",
      "Pulse",
      "Weave",
      "Open",
      "Air",
      "Return",
      "Crest",
      "Dissolve",
    ].forEach((name, i) => s.section(name, i * 8, 8));
    machineTracks(s, "syn909", 0.8);
    s.track(preset("bass", "Undercurrent", "fm-bass", 0.56, { fx: orbit }));
    s.track(
      voice("chords", "Dub chords", "saw", 0.31, {
        pan: -0.14,
        synth: {
          attack: 0.006,
          decay: 0.16,
          sustain: 0.1,
          release: 0.22,
          lpf: 1750,
          lpq: 2.5,
          detune: 0.08,
        },
        delay: {
          beats: 0.75,
          feedback: 0.38,
          mix: 0.23,
          pingpong: true,
          highcut: 3800,
        },
        reverb: hall,
        filterAutomation: lanes(
          [0, 650],
          [15, 1800],
          [31, 4600],
          [32, 750],
          [39, 1900],
          [48, 5200],
          [55, 3600],
          [63, 500],
        ),
        delayMixAutomation: lanes(
          [0, 0.15],
          [31, 0.29],
          [32, 0.46],
          [39, 0.38],
          [40, 0.23],
          [63, 0.4],
        ),
        fx: orbit,
      }),
    );
    s.track(
      voice("metal", "Metal reply", "sampler", 0.29, {
        pan: 0.28,
        sampler: {
          mode: "keyed",
          voices: {
            metal: { ...bundledSampleRef("metal-hit"), fadeTime: 0.025 },
          },
        },
        delay: { beats: 1.5, feedback: 0.25, mix: 0.17, pingpong: true },
        reverb: room,
      }),
    );
    s.track(
      voice("air", "Soft horizon", "granular", 0.2, {
        granular: {
          src: "synth:pad",
          grain: 0.14,
          overlap: 3,
          spread: 0.7,
          scan: 0.09,
          gain: 0.5,
        },
        reverb: hall,
        volumeAutomation: lanes(
          [0, 0.12],
          [24, 0.2],
          [32, 0.31],
          [40, 0.15],
          [56, 0.18],
          [63, 0.02],
        ),
        fx: orbit,
      }),
    );
    const chords = [
      [53, 60, 63, 67],
      [53, 58, 63, 65],
      [55, 60, 63, 67],
      [53, 58, 62, 65],
    ];
    for (let b = 0; b < 64; b++) {
      const breaking = b >= 32 && b < 40,
        exiting = b >= 60;
      if (b >= 4 && !breaking && !exiting)
        fourFloor(s, b, b < 8 ? 0.5 : b < 16 ? 0.75 : 1, b % 4);
      if (b >= 8 && !breaking && b < 60) {
        const root = [29, 34, 32, 34][Math.floor(b / 2) % 4]!;
        s.phrase("bass", b, [
          [0.5, root, 0.38, 0.78],
          [1.75, root, 0.18, 0.6],
          [2.5, root, 0.32, 0.75],
          [3.5, root + 12, 0.21, 0.55],
        ]);
      }
      const chord = chords[Math.floor(b / 2) % 4]!;
      if (b < 60 && (b % 2 === 0 || (!breaking && b >= 16))) {
        s.chord(
          "chords",
          b,
          b % 2 ? 0.75 : 0,
          chord,
          breaking ? 1.5 : 0.3,
          breaking ? 0.46 : 0.7,
        );
        if (b >= 24 && !breaking && b % 2 === 1)
          s.chord("chords", b, 2.75, chord, 0.22, 0.5);
      }
      if (b % 4 === 0)
        s.chord(
          "air",
          b,
          0,
          [65, 72, 79],
          3.7,
          b >= 32 && b < 40 ? 0.63 : 0.37,
        );
      if ((b >= 16 && b < 32) || (b >= 40 && b < 56)) {
        s.phrase("metal", b, [
          [0.75, 77, 0.3, 0.5],
          [2.5, b % 4 === 3 ? 75 : 72, 0.25, 0.37],
        ]);
        if (b >= 48 && b % 2) s.note("metal", b, 3.25, 84, 0.2, 0.33);
      }
      if ([15, 31, 47, 55].includes(b)) s.fill(b, "drums", 0.63);
    }
    return s.finish();
  },
};

export const coilDriver: DemoDefinition = {
  info: demoInfo({
    id: "coil-driver",
    title: "Coil Driver",
    style: "Acid techno",
    description:
      "A sliding F-minor acid cell grows from a low murmur to a bright warehouse coil, then drops back onto a dry kick.",
    tempoBpm: 134,
    key: "Fm",
    bars: 64,
    highlightBar: 40,
    trackId: "acid",
    features: [
      "ladder-filter acid",
      "accents & slides",
      "808 + 909 percussion",
      "cutoff automation",
      "dropout and re-entry",
    ],
    arrangement: [
      "Ignition 8",
      "Circuit 8",
      "Pressure 8",
      "Sparks 8",
      "Vacuum 8",
      "Re-entry 8",
      "Overdrive 8",
      "Power down 8",
    ],
    mixNotes: [
      "The resonant line lives above the kick fundamental; a high-pass removes subsonic filter energy.",
      "Velocity accents open the ladder envelope; destination-note slides connect selected sixteenths.",
      "One nearly empty bar precedes the return. The second peak changes the cell instead of only adding volume.",
    ],
  }),
  build() {
    const s = new Composer(coilDriver.info);
    [
      "Ignition",
      "Circuit",
      "Pressure",
      "Sparks",
      "Vacuum",
      "Re-entry",
      "Overdrive",
      "Power down",
    ].forEach((name, i) => s.section(name, i * 8, 8));
    machineTracks(s, "syn909", 0.84);
    s.track(
      voice("acid", "Acid circuit", "saw", 0.4, {
        synth: {
          attack: 0.002,
          decay: 0.2,
          sustain: 0.5,
          release: 0.05,
          lpf: 380,
          lpq: 14,
          lpenv: 3.5,
          lpdecay: 0.18,
          lpsustain: 0,
          ftype: "ladder",
          faccent: 1.5,
        },
        glide: { time: 0.07, mode: "legato" },
        filter: { type: "hpf", cutoff: 45, resonance: 0.4 },
        delay: { beats: 0.75, feedback: 0.3, mix: 0.14, highcut: 3200 },
        fxAutomation: {
          "synth-lpf": lanes(
            [0, 160],
            [15, 500],
            [23, 950],
            [31, 1900],
            [32, 220],
            [36, 330],
            [39, 1100],
            [40, 350],
            [47, 1400],
            [55, 2200],
            [63, 120],
          ),
        },
        fx: {
          ...orbit,
          distort: { type: "diode", drive: 0.7, mix: 0.24, tone: 5000 },
        },
      }),
    );
    s.track(
      voice("rim", "Rim machine", "kit", 0.31, {
        kit: "syn808",
        pan: -0.28,
        delay: { beats: 0.75, feedback: 0.2, mix: 0.12 },
      }),
    );
    s.track(
      voice("bell", "Steel alarm", "modal", 0.18, {
        modal: { preset: "crotales" },
        pan: 0.26,
        reverb: hall,
      }),
    );
    s.track(
      voice("noise", "Pressure release", "white", 0.12, {
        synth: { attack: 0.3, decay: 0.2, sustain: 0.5, release: 0.7 },
        filter: { type: "hpf", cutoff: 2800, resonance: 1 },
        reverb: room,
        volumeAutomation: lanes(
          [0, 0.01],
          [28, 0.02],
          [31, 0.16],
          [32, 0.02],
          [36, 0.01],
          [39, 0.17],
          [40, 0.01],
          [52, 0.02],
          [55, 0.16],
          [56, 0.01],
        ),
      }),
    );
    const cell: Phrase = [
      [0, 41, 0.19, 0.73],
      [0.75, 41, 0.18, 0.5],
      [1.25, 48, 0.44, 0.88],
      [2, 41, 0.2, 0.68],
      [2.5, 39, 0.18, 0.54],
      [3, 44, 0.2, 0.83],
      [3.75, 48, 0.22, 0.63],
    ];
    for (let b = 0; b < 64; b++) {
      const drop = b >= 32 && b < 40;
      if (!drop && b < 62) fourFloor(s, b, b < 8 ? 0.53 : 1, b % 4);
      if (b >= 4 && b < 63 && b !== 39) {
        for (let i = 0; i < cell.length; i++) {
          if ((b < 8 && i % 2) || (drop && b % 2)) continue;
          const [beat, pitch, length, velocity] = cell[i]!;
          const shift = b >= 48 && b % 4 >= 2 && (i === 2 || i === 6) ? 12 : 0;
          s.note(
            "acid",
            b,
            beat,
            pitch + shift,
            length,
            velocity,
            (i === 2 || i === 6) && b % 2 ? { glide: 0.085 } : {},
          );
        }
        if (b % 8 === 7 && !drop)
          s.phrase("acid", b, [
            [2.75, 46, 0.15, 0.68],
            [3.25, 44, 0.19, 0.76],
          ]);
      }
      if (b >= 16 && !drop && b < 56)
        s.grid(
          "rim",
          b,
          37,
          b % 2 ? "...4..3....5..2." : "..3....5..3....4",
          0.8,
        );
      if ([24, 28, 40, 44, 48, 52].includes(b))
        s.note("bell", b, 0, b >= 48 ? 84 : 77, 1.8, 0.52);
      if ([30, 38, 54].includes(b)) s.note("noise", b, 0, 72, 7.4, 0.7);
      if ([15, 23, 31, 47, 55].includes(b)) s.fill(b, "drums", 0.55);
    }
    return s.finish();
  },
};

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
