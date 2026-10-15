/** Low Tide: the trip hop demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import {
  Composer,
  hall,
  lanes,
  preset,
  room,
  voice,
  type Phrase,
} from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

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
