/** After Hours: the deep house demo song. */
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
