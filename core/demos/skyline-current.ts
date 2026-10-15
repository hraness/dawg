/** Skyline Current: the melodic EDM demo song. */
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
