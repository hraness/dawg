/** Amber Room: the neo soul demo song. */
import { Composer, hall, preset, room, voice, type Phrase } from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

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
