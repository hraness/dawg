/** Velvet Circuit: the UK garage demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import { Composer, hall, orbit, preset, room, voice } from "./build.ts";
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
