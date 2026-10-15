/** Night Relay: the deep techno demo song. */
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
