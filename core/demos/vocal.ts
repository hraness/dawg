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

export const velvetCircuit: DemoDefinition = {
  info: demoInfo({
    id: "velvet-circuit",
    title: "Velvet Circuit",
    style: "UK garage",
    description:
      "A shuffling two-step pocket carries a chopped 'hold on' refrain, warm ninths and a bass answer that dodges the kick.",
    tempoBpm: 130,
    key: "Gm",
    bars: 64,
    highlightBar: 24,
    trackId: "hold",
    features: [
      "two-step swing",
      "pitched vocal chops",
      "Rhodes ninths",
      "sub-bass call and response",
      "reverse swell",
    ],
    arrangement: [
      "Warm-up 8",
      "Pocket 8",
      "Lift 8",
      "Hold on 8",
      "Suspended 8",
      "Turnaround 8",
      "Last call 8",
      "Afterglow 8",
    ],
    mixNotes: [
      "Two separate syllable tracks expose the edit points; both use the same original content-pinned phrase.",
      "The bass leaves the snare's second and fourth beats open. Rhodes voicings retain common tones.",
      "The breakdown holds the original phrase longer; the returning hook chops it into offbeat replies.",
    ],
  }),
  build() {
    const s = new Composer(velvetCircuit.info);
    [
      "Warm-up",
      "Pocket",
      "Lift",
      "Hold on",
      "Suspended",
      "Turnaround",
      "Last call",
      "Afterglow",
    ].forEach((name, i) => s.section(name, i * 8, 8));
    s.track(
      voice("kick", "Skip kick", "kit", 0.78, {
        kit: "syn909",
        fx: { duck: { orbit: 2, depth: 0.37, attack: 0.14 } },
      }),
    );
    s.track(
      voice("drums", "Shuffle hats", "kit", 0.51, {
        kit: "synlinn",
        reverb: { mix: 0.05, size: 0.25, fade: 0.7 },
      }),
    );
    s.track(preset("bass", "Round sub", "sub-sine", 0.61, { fx: orbit }));
    s.track(
      voice("keys", "Velvet ninths", "rhodes", 0.48, {
        pan: -0.12,
        reverb: room,
        delay: { beats: 0.75, feedback: 0.18, mix: 0.1 },
        fx: orbit,
      }),
    );
    for (const [id, name, begin, end, pan] of [
      ["hold", "Hold", 0, 0.25, -0.08],
      ["on", "On", 0.25, 0.5, 0.12],
    ] as const)
      s.track(
        voice(id, name, "sampler", 0.63, {
          pan,
          sampler: {
            mode: "keyed",
            voices: {
              [id]: {
                ...bundledSampleRef("hold-on"),
                begin,
                end,
                fit: true,
                fadeTime: 0.014,
                fadeInTime: 0.003,
              },
            },
          },
          filter: { type: "hpf", cutoff: 170, resonance: 0.3 },
          reverb: room,
          delay: { beats: 0.75, feedback: 0.23, mix: 0.13, pingpong: true },
          fx: orbit,
        }),
      );
    s.track(
      voice("swell", "Reverse breath", "sampler", 0.22, {
        sampler: {
          mode: "keyed",
          voices: {
            ah: {
              ...bundledSampleRef("vowel-ah"),
              speed: -1,
              fit: true,
              fadeInTime: 0.15,
              fadeTime: 0.015,
            },
          },
        },
        reverb: hall,
      }),
    );
    const chords = [
        [58, 62, 65, 69],
        [58, 60, 65, 69],
        [57, 60, 65, 67],
        [57, 60, 63, 67],
      ],
      roots = [31, 34, 29, 36];
    for (let b = 0; b < 64; b++) {
      const breakdown = b >= 32 && b < 40,
        hook = (b >= 24 && b < 32) || (b >= 48 && b < 56),
        active = b >= 4 && !breakdown && b < 60;
      const c = Math.floor(b / 2) % 4,
        chord = chords[c]!,
        root = roots[c]!;
      if (active) {
        s.grid("kick", b, 36, b % 2 ? "8......6..7....." : "9.....5...7..4..");
        s.grid("drums", b, 38, "....8.......8...");
        s.grid(
          "drums",
          b,
          42,
          b >= 16 ? "5.3.6.254.3.6.24" : "5...6.2.4...6.2.",
          1,
          0.065,
        );
        if (b % 2) s.grid("drums", b, 37, "...3......2....4", 0.8, 0.065);
      }
      if (b >= 8 && !breakdown && b < 60)
        s.phrase("bass", b, [
          [0.5, root, 0.48, 0.78],
          [1.75, root + 12, 0.2, 0.57],
          [2.5, root, 0.45, 0.79],
          [3.5, root + 7, 0.23, 0.56],
        ]);
      if (b % 2 === 0 || hook)
        s.chord(
          "keys",
          b,
          breakdown ? 0 : 0.5,
          chord,
          breakdown ? 6.5 : 0.68,
          breakdown ? 0.42 : 0.66,
        );
      if (active && b % 2) s.chord("keys", b, 2.75, chord, 0.4, 0.46);
      if (hook || (b >= 16 && b < 24 && b % 2 === 0)) {
        s.phrase("hold", b, [
          [0.5, 67, 0.44, 0.75],
          [2.5, 65, 0.25, 0.63],
        ]);
        s.phrase("on", b, [
          [1.75, 69, 0.31, 0.74],
          [3.25, b % 4 === 3 ? 62 : 67, 0.6, 0.78],
        ]);
        if (b >= 48 && b % 2)
          s.phrase("hold", b, [
            [0, 74, 0.2, 0.5],
            [3.75, 72, 0.2, 0.55],
          ]);
      } else if (breakdown && b % 4 === 0) {
        s.note("hold", b, 0, 67, 1.5, 0.58);
        s.note("on", b, 2, 65, 2.5, 0.58);
      } else if (b >= 8 && b < 60 && b % 4 === 3)
        s.note("on", b, 3.5, 67, 0.4, 0.53);
      if ([15, 23, 39, 47, 55].includes(b)) s.note("swell", b, 2, 67, 1.9, 0.7);
      if ([23, 47, 55].includes(b)) s.fill(b, "drums", 0.46);
    }
    return s.finish();
  },
};

export const glassArc: DemoDefinition = {
  info: demoInfo({
    id: "glass-arc",
    title: "Glass Arc",
    style: "Future garage",
    description:
      "Half-time drums, pitched glass and an original 'stay up' vocal float over a breathing chord bed; the final arc doubles the hat motion.",
    tempoBpm: 138,
    key: "Dm",
    bars: 64,
    highlightBar: 40,
    trackId: "chop",
    features: [
      "half-time pocket",
      "granular vowel bed",
      "vocal pitch edits",
      "glass sampler",
      "reverse transitions",
    ],
    arrangement: [
      "Rain glass 8",
      "Half-step 8",
      "Gather 8",
      "First arc 8",
      "Weightless 8",
      "Second arc 8",
      "Open sky 8",
      "Mist 8",
    ],
    mixNotes: [
      "The glass and vowel grains fill the sides while kick, snare and sub stay in the center.",
      "Two-bar vocal phrases alternate a rising call with a descending answer; the final refrain adds a high echo.",
      "A reversed vowel leads into each arc; the bridge removes the sub and kick completely.",
    ],
  }),
  build() {
    const s = new Composer(glassArc.info);
    [
      "Rain glass",
      "Half-step",
      "Gather",
      "First arc",
      "Weightless",
      "Second arc",
      "Open sky",
      "Mist",
    ].forEach((name, i) => s.section(name, i * 8, 8));
    s.track(
      voice("kick", "Low pulse", "kit", 0.81, {
        kit: "syn808",
        fx: { duck: { orbit: 2, depth: 0.42, attack: 0.24 } },
      }),
    );
    s.track(
      voice("drums", "Half-step kit", "kit", 0.57, {
        kit: "lofi",
        reverb: room,
      }),
    );
    s.track(preset("bass", "Sub floor", "sub-sine", 0.64, { fx: orbit }));
    s.track(
      voice("grains", "Vowel clouds", "granular", 0.33, {
        granular: {
          src: bundledSampleRef("vowel-ah"),
          root: 60,
          grain: 0.18,
          overlap: 4,
          pos: 0.48,
          scan: 0.07,
          spread: 0.78,
          spray: 0.035,
          jitter: 0.12,
          gain: 0.5,
        },
        reverb: hall,
        fx: orbit,
        filterAutomation: lanes(
          [0, 800],
          [23, 2200],
          [31, 3500],
          [32, 900],
          [39, 1600],
          [48, 4300],
          [63, 550],
        ),
      }),
    );
    s.track(
      voice("chop", "Stay up", "sampler", 0.6, {
        sampler: {
          mode: "keyed",
          voices: {
            stay: {
              ...bundledSampleRef("stay-up"),
              begin: 0,
              end: 0.5,
              fit: true,
              fadeTime: 0.015,
            },
          },
        },
        delay: {
          beats: 0.75,
          feedback: 0.3,
          mix: 0.18,
          pingpong: true,
          highcut: 4800,
        },
        reverb: room,
        filter: { type: "hpf", cutoff: 180, resonance: 0.3 },
        fx: orbit,
      }),
    );
    s.track(
      voice("glass", "Glass bells", "sampler", 0.36, {
        pan: 0.27,
        sampler: {
          mode: "keyed",
          voices: {
            glass: { ...bundledSampleRef("glass-hit"), fadeTime: 0.025 },
          },
        },
        delay: { beats: 1.5, feedback: 0.25, mix: 0.24, pingpong: true },
        reverb: hall,
      }),
    );
    s.track(
      voice("reverse", "Reverse vowel", "sampler", 0.26, {
        pan: -0.2,
        sampler: {
          mode: "keyed",
          voices: {
            oh: {
              ...bundledSampleRef("vowel-oh"),
              speed: -1,
              fit: true,
              fadeInTime: 0.12,
              fadeTime: 0.02,
            },
          },
        },
        reverb: hall,
      }),
    );
    const chords = [
        [62, 65, 69, 72],
        [60, 64, 67, 72],
        [58, 62, 65, 69],
        [60, 64, 67, 70],
      ],
      roots = [26, 33, 34, 36];
    for (let b = 0; b < 64; b++) {
      const air = b >= 32 && b < 40,
        full = (b >= 24 && b < 32) || (b >= 40 && b < 56);
      const c = Math.floor(b / 2) % 4,
        root = roots[c]!;
      if (b % 2 === 0)
        s.chord("grains", b, 0, chords[c]!, 7.1, air ? 0.43 : 0.57);
      if (b >= 8 && !air && b < 60) {
        s.grid("kick", b, 36, b % 2 ? "9.....4...6....." : "9.........6..4..");
        s.grid("drums", b, 38, "........8.......");
        s.grid(
          "drums",
          b,
          42,
          b >= 48 ? "3.2.4.234.2.3.24" : "3...4.2.3...4.2.",
          1,
          0.045,
        );
        if (b % 4 === 3) s.grid("drums", b, 37, "...2...3.....2..", 1, 0.045);
        s.phrase("bass", b, [
          [0, root, 1.35, 0.8],
          [2.75, root, 0.7, 0.73],
        ]);
      }
      if (b % 2 === 0)
        s.phrase("glass", b, [
          [0.75, 81, 0.6, 0.46],
          [2.25, 77, 0.45, 0.37],
          [3.5, 76, 0.65, 0.4],
        ]);
      if (full) {
        s.phrase(
          "chop",
          b,
          b % 2
            ? [
                [0.75, 65, 0.7, 0.7],
                [2.5, 62, 1.1, 0.8],
              ]
            : [
                [0.5, 62, 0.65, 0.75],
                [2, 69, 0.8, 0.8],
              ],
        );
        if (b >= 48 && b % 4 === 3) s.note("chop", b, 3.5, 74, 0.43, 0.52);
      } else if ((air || b >= 16) && b % 4 === 0 && b < 60)
        s.note("chop", b, 1, 65, 2.8, 0.53);
      if ([7, 23, 39, 47, 55].includes(b))
        s.note("reverse", b, 1, 62, 2.9, 0.72);
      if ([31, 55].includes(b)) s.fill(b, "drums", 0.42);
    }
    return s.finish();
  },
};

export const lowTide: DemoDefinition = {
  info: demoInfo({
    id: "low-tide",
    title: "Low Tide",
    style: "Trip hop",
    description:
      "A dusty, late snare frames muted bass, suspended electric piano and a close synthetic voice. The middle opens into a sparse dub room.",
    tempoBpm: 84,
    key: "Cm",
    bars: 48,
    highlightBar: 16,
    trackId: "vocal",
    features: [
      "laid-back drums",
      "physical muted bass",
      "electric piano",
      "original sung couplet",
      "tape percussion",
    ],
    arrangement: [
      "Room tone 4",
      "Low water 12",
      "Refrain 8",
      "Dub room 8",
      "Refrain return 12",
      "Shore 4",
    ],
    mixNotes: [
      "The snare lands slightly late; soft ghost strokes carry the pocket rather than a rigid grid.",
      "Muted bass occupies the low octave; rootless Rhodes voicings keep its register clear.",
      "The voice is deliberately dry and close. Long echoes appear in the middle and ending.",
    ],
  }),
  build() {
    const s = new Composer(lowTide.info);
    for (const [name, start, bars] of [
      ["Room tone", 0, 4],
      ["Low water", 4, 12],
      ["Refrain", 16, 8],
      ["Dub room", 24, 8],
      ["Refrain return", 32, 12],
      ["Shore", 44, 4],
    ] as const)
      s.section(name, start, bars);
    s.track(
      voice("drums", "Dust kit", "kit", 0.63, {
        kit: "lofi",
        reverb: { mix: 0.065, size: 0.25, fade: 0.8 },
      }),
    );
    s.track(
      voice("bass", "Muted bass", "motown", 0.57, {
        string: { preset: "motown", mute: 0.3, bright: 0.33 },
      }),
    );
    s.track(
      voice("keys", "Soft ninths", "rhodes", 0.49, {
        pan: -0.13,
        reverb: room,
        delay: { beats: 0.75, feedback: 0.23, mix: 0.12, highcut: 3000 },
      }),
    );
    s.track(
      voice("vocal", "Low tide singer", "sing", 0.58, {
        sing: {
          preset: "airy",
          voice: "alto",
          articulate: 1,
          vib: 4.7,
          vibmod: 0.14,
          breath: 0.16,
          jitter: 0.13,
          attack: 0.045,
        },
        reverb: { mix: 0.085, size: 0.3, fade: 1.5 },
        delay: { beats: 1.5, feedback: 0.22, mix: 0.11 },
        filter: { type: "hpf", cutoff: 130, resonance: 0 },
        delayMixAutomation: lanes(
          [0, 0.08],
          [23, 0.1],
          [24, 0.32],
          [31, 0.32],
          [32, 0.1],
          [43, 0.12],
          [47, 0.4],
        ),
      }),
    );
    s.track(
      voice("vibes", "Amber reply", "vibes", 0.33, {
        pan: 0.28,
        reverb: hall,
        delay: { beats: 0.75, feedback: 0.22, mix: 0.12 },
      }),
    );
    s.track(
      voice("tape", "Tape knocks", "sampler", 0.32, {
        pan: -0.31,
        sampler: {
          mode: "keyed",
          voices: { tape: { ...bundledSampleRef("tape-hit"), fadeTime: 0.03 } },
        },
        delay: { beats: 1.5, feedback: 0.32, mix: 0.25, pingpong: true },
      }),
    );
    const chords = [
        [58, 62, 63, 67],
        [56, 60, 63, 67],
        [55, 58, 62, 65],
        [55, 59, 62, 65],
      ],
      roots = [36, 32, 34, 31];
    const refrain: Phrase = [
      [0.5, 67, 0.9, 0.65, "Let"],
      [1.75, 65, 0.8, 0.66, "the"],
      [3, 63, 1.5, 0.7, "tide"],
      [5, 62, 0.7, 0.6, "roll"],
      [6, 60, 1.5, 0.68, "slow"],
    ];
    for (let b = 0; b < 48; b++) {
      const dub = b >= 24 && b < 32,
        c = Math.floor(b / 2) % 4,
        root = roots[c]!;
      if (b >= 4 && b < 44 && !dub) {
        s.grid("drums", b, 36, b % 2 ? "8.....4.6......." : "8.........6..4..");
        s.note("drums", b, 1.035, 38, 0.14, 0.73);
        s.note("drums", b, 3.04, 38, 0.14, 0.8);
        s.grid("drums", b, 42, "4.2.5.2.3.2.5.23", 1, 0.035);
        if (b % 2) s.note("drums", b, 2.77, 38, 0.11, 0.22);
      } else if (dub && b % 2 === 0) s.grid("drums", b, 36, "7.......4.......");
      if (b >= 4 && b < 44)
        s.phrase(
          "bass",
          b,
          [
            [0, root, 1.3, 0.78],
            [1.75, root + 7, 0.35, 0.57],
            [2.5, root, 0.78, 0.75],
            [3.5, root + (b % 2 ? 10 : 7), 0.35, 0.55],
          ],
          0,
          dub ? 0.7 : 1,
        );
      if (b % 2 === 0)
        s.chord(
          "keys",
          b,
          0.05,
          chords[c]!,
          dub ? 3.2 : 6.9,
          dub ? 0.42 : 0.64,
        );
      if ((b >= 16 && b < 24) || (b >= 32 && b < 44)) {
        if (b % 4 === 0) s.phrase("vocal", b, refrain);
        if (b % 4 === 2)
          s.phrase("vibes", b, [
            [1.5, 79, 0.65, 0.43],
            [2.5, 77, 0.65, 0.46],
            [3.25, 75, 0.9, 0.5],
          ]);
      } else if (b >= 8 && b < 16 && b % 4 === 0)
        s.phrase("vocal", b, [
          [0.5, 60, 1, 0.58, "Night"],
          [2, 63, 0.8, 0.6, "turns"],
          [3.25, 62, 1.5, 0.62, "blue"],
        ]);
      if (dub || b >= 44) {
        if (b % 2 === 0) s.note("tape", b, 1.5, 60, 0.2, 0.57);
        if (b % 4 === 2)
          s.phrase("vibes", b, [
            [0.75, 75, 1.3, 0.45],
            [2.5, 74, 1.2, 0.38],
          ]);
      }
      if ([15, 23, 43].includes(b)) s.fill(b, "drums", 0.35);
    }
    return s.finish();
  },
};
