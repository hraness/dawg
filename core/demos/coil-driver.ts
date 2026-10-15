/** Coil Driver: the acid techno demo song. */
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
