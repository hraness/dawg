/** Glass Arc: the future garage demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import { Composer, hall, lanes, orbit, preset, room, voice } from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

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
