/** Low Tide: the trip hop demo song. */
import { bundledSampleRef } from "../bundled-samples.ts";
import type { BendPoint, NoteVibrato, PedalEvent } from "../expression.ts";
import { BAR, Composer, TPB, hall, lanes, voice } from "./build.ts";
import { demoInfo, type DemoDefinition } from "./types.ts";

/**
 * Timing, from the research notes: at 84 BPM a sixteenth is 179 ms. MPC-style
 * swing near 57% delays every second sixteenth by about 25 ms; the backbeat
 * sits about 26 ms behind the grid while the kick stays on it.
 */
const SW = 0.035;
const LATE = 0.036;
const at = (step: number) => step / 4 + (step % 2 ? SW : 0);

/** Seeded, so every render of the song is identical. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Chord = Readonly<{ root: number; keys: readonly number[] }>;
/** Rootless Rhodes voicings, Eb3 to D4; the top voice moves by step. */
const CM9: Chord = { root: 36, keys: [51, 55, 58, 62] };
const AM7B5: Chord = { root: 33, keys: [51, 55, 57, 60] };
const ABMAJ9: Chord = { root: 32, keys: [51, 55, 58, 60] };
const G7ALT: Chord = { root: 31, keys: [51, 53, 56, 59] };
const FM9: Chord = { root: 41, keys: [51, 55, 56, 60] };
const DBMAJ9: Chord = { root: 37, keys: [51, 53, 56, 60] };
/** The lament: C, A, Ab, G under the verses. */
const VERSE = [CM9, AM7B5, ABMAJ9, G7ALT];
/** Fm9 and the Neapolitan Dbmaj9 under the refrain. */
const REFRAIN = [FM9, DBMAJ9, ABMAJ9, G7ALT];
const DUB = [CM9, ABMAJ9, CM9, G7ALT];

/** The chord for each two-bar span, bar 0 to 55. */
const PLAN: readonly Chord[] = [
  CM9,
  ABMAJ9,
  ...VERSE,
  ...VERSE,
  ...REFRAIN,
  ...DUB,
  ...VERSE,
  ...REFRAIN,
  CM9,
  ABMAJ9,
];

type Sung = readonly [
  beat: number,
  pitch: number,
  length: number,
  velocity: number,
  lyric: string,
];

const VERSE_ONE: readonly (readonly Sung[])[] = [
  [
    [0.5, 67, 0.6, 0.66, "Salt"],
    [1.25, 63, 0.25, 0.56, "on"],
    [1.5, 62, 0.25, 0.54, "the"],
    [1.75 + SW, 63, 0.45, 0.62, "win-"],
    [2.25, 60, 1.6, 0.64, "dow"],
  ],
  [
    [0.5, 60, 0.4, 0.6, "no-"],
    [1, 63, 0.6, 0.66, "thing"],
    [1.75 + SW, 62, 0.25, 0.55, "to"],
    [2, 60, 1.8, 0.63, "say"],
  ],
  [
    [0.5, 63, 0.3, 0.58, "I"],
    [0.75 + SW, 67, 0.65, 0.7, "count"],
    [1.5, 65, 0.25, 0.56, "the"],
    [1.75 + SW, 63, 0.6, 0.64, "boats"],
    [2.5, 60, 1.3, 0.62, "out"],
  ],
  [
    [0.5, 62, 0.4, 0.62, "slip-"],
    [1, 63, 0.4, 0.6, "ping"],
    [1.5, 62, 0.4, 0.58, "a-"],
    [2, 59, 2.4, 0.64, "way"],
  ],
];

const VERSE_TWO: readonly (readonly Sung[])[] = [
  [
    [0.5, 70, 0.6, 0.7, "Rope"],
    [1.25, 67, 0.25, 0.58, "on"],
    [1.5, 65, 0.25, 0.56, "the"],
    [1.75 + SW, 63, 0.45, 0.64, "har-"],
    [2.25, 62, 1.6, 0.64, "bour"],
  ],
  [
    [0.5, 63, 0.9, 0.68, "cold"],
    [1.5, 62, 0.25, 0.56, "in"],
    [1.75 + SW, 60, 0.25, 0.55, "the"],
    [2, 63, 1.8, 0.64, "hand"],
  ],
  [
    [0.5, 60, 0.25, 0.58, "you"],
    [0.75 + SW, 63, 0.45, 0.64, "wrote"],
    [1.25, 67, 0.25, 0.6, "your"],
    [1.5, 67, 0.7, 0.7, "name"],
    [2.25, 65, 1.1, 0.62, "in"],
  ],
  [
    [0.5, 63, 0.25, 0.62, "wa-"],
    [0.75 + SW, 62, 0.45, 0.58, "ter"],
    [1.25, 62, 0.4, 0.58, "and"],
    [1.75 + SW, 59, 2, 0.66, "sand"],
  ],
];

const REFRAIN_LINES: readonly (readonly Sung[])[] = [
  [
    [0.5, 67, 0.9, 0.72, "Low"],
    [1.5, 63, 0.8, 0.66, "tide"],
    [2.5, 68, 0.45, 0.7, "low"],
    [3, 67, 1.6, 0.7, "tide"],
  ],
  [
    [0.5, 65, 0.4, 0.64, "don't"],
    [1, 68, 0.6, 0.72, "pull"],
    [1.75 + SW, 65, 0.25, 0.58, "me"],
    [2, 63, 0.5, 0.64, "un-"],
    [2.5, 60, 1.8, 0.64, "der"],
  ],
  [
    [0.5, 63, 0.45, 0.64, "leave"],
    [1, 65, 0.25, 0.58, "the"],
    [1.25, 67, 1.2, 0.72, "light"],
    [2.75 + SW, 63, 1.1, 0.62, "on"],
  ],
  [
    [0.5, 65, 0.25, 0.64, "till"],
    [0.75 + SW, 63, 0.25, 0.58, "the"],
    [1, 62, 0.5, 0.64, "wa-"],
    [1.5, 63, 0.5, 0.62, "ter"],
    [2, 59, 2.5, 0.68, "turns"],
  ],
];

/** The last refrain climbs: the eleventh, then C5 at the top. */
const REFRAIN_HIGH: readonly Sung[] = [
  [0.5, 70, 0.9, 0.76, "Low"],
  [1.5, 68, 0.8, 0.7, "tide"],
  [2.5, 72, 0.45, 0.78, "low"],
  [3, 67, 1.6, 0.72, "tide"],
];

const SCOOP: readonly BendPoint[] = [
  { at: 0, cents: -90 },
  { at: 0.16, cents: 0 },
];
const FALL: readonly BendPoint[] = [
  { at: 0, cents: 0 },
  { at: 0.74, cents: 0 },
  { at: 1, cents: -140 },
];
const LONG_VIBRATO: NoteVibrato = { rate: 5.1, depth: 24, delay: 0.34 };

export const lowTide: DemoDefinition = {
  info: demoInfo({
    id: "low-tide",
    title: "Low Tide",
    style: "Trip hop",
    description:
      "A swung, dusty break with a lazy backbeat under a dub bass, tape-wobbled Rhodes and a close sung voice. The verses walk a lament down from C, the refrain turns to F minor and D flat, strings rise against the voice, and the middle drops into a dub room of echoes.",
    tempoBpm: 84,
    key: "Cm",
    bars: 56,
    highlightBar: 20,
    trackId: "vocal",
    features: [
      "swung break with a late backbeat and ghost notes",
      "dub bass with slides into each chord",
      "tape-wobbled Rhodes over a lament bass",
      "original sung verses and refrain with scoops and falls",
      "bowed strings rising against the refrain",
      "dub room: snare and vocal echo throws",
      "vinyl dust and tape knocks",
    ],
    arrangement: [
      "Room tone 4",
      "Low water 8",
      "First light 8",
      "Refrain 8",
      "Dub room 8",
      "Second tide 8",
      "Refrain return 8",
      "Shore 4",
    ],
    mixNotes: [
      "The kick sits on the grid; the backbeat lands about 26 ms late and the off sixteenths swing near 57%, so the break leans back without dragging.",
      "A side stick carries the first groove and a full snare takes over at the refrain; ghost strokes stay between 0.12 and 0.22.",
      "Bass and kick share their onsets and the centre; the Rhodes stays rootless above C3 with a slow tape wobble and no wobble on the bass.",
      "The voice is close and nearly dry in the verses; its echo opens on line ends, floods the dub room and the shore.",
    ],
  }),
  build() {
    const s = new Composer(lowTide.info);
    for (const [name, start, bars] of [
      ["Room tone", 0, 4],
      ["Low water", 4, 8],
      ["First light", 12, 8],
      ["Refrain", 20, 8],
      ["Dub room", 28, 8],
      ["Second tide", 36, 8],
      ["Refrain return", 44, 8],
      ["Shore", 52, 4],
    ] as const)
      s.section(name, start, bars);
    const pedal: PedalEvent[] = [];
    s.track(
      voice("drums", "Dust break", "kit", 0.62, {
        kit: "lofi",
        reverb: { mix: 0.07, size: 0.24, fade: 0.7 },
        humanize: { timing: 5, velocity: 5, seed: 84 },
      }),
    );
    s.track(
      voice("throws", "Snare throws", "kit", 0.42, {
        kit: "lofi",
        pan: 0.08,
        reverb: { mix: 0.3, size: 0.34, fade: 1.4, predelay: 0.045 },
        delay: {
          beats: 0.75,
          feedback: 0.52,
          mix: 0.42,
          pingpong: true,
          highcut: 2400,
        },
      }),
    );
    s.track(
      voice("bass", "Dub bass", "motown", 0.6, {
        string: { preset: "motown", mute: 0.34, bright: 0.3 },
        glide: { time: 0.07, mode: "legato" },
        humanize: { timing: 4, velocity: 4, seed: 12 },
      }),
    );
    s.track(
      voice("keys", "Tape Rhodes", "rhodes", 0.46, {
        pan: -0.14,
        reverb: { mix: 0.14, size: 0.45, fade: 1.8, lowpass: 6000 },
        delay: { beats: 0.75, feedback: 0.26, mix: 0.1, highcut: 2800 },
        delayMixAutomation: lanes(
          [0, 0.1],
          [27.75, 0.1],
          [28, 0.32],
          [35.75, 0.32],
          [36, 0.1],
          [51.75, 0.1],
          [52, 0.22],
        ),
        fx: { wobble: { depth: 7, rate: 0.42, drift: 0.55 } },
        humanize: { timing: 7, velocity: 4, seed: 33 },
        pedal,
      }),
    );
    s.track(
      voice("vocal", "Low tide singer", "sing", 0.58, {
        sing: {
          preset: "airy",
          voice: "alto",
          articulate: 1,
          vib: 4.9,
          vibmod: 0.1,
          breath: 0.18,
          jitter: 0.12,
          attack: 0.05,
        },
        reverb: { mix: 0.09, size: 0.32, fade: 1.6 },
        delay: { beats: 0.75, feedback: 0.3, mix: 0.08, highcut: 3200 },
        filter: { type: "hpf", cutoff: 140, resonance: 0 },
        humanize: { timing: 12, velocity: 3, length: 4, seed: 7 },
        delayMixAutomation: lanes(
          [0, 0.07],
          [21, 0.07],
          [21.2, 0.2],
          [22, 0.07],
          [26.6, 0.09],
          [27.4, 0.36],
          [28, 0.42],
          [35.5, 0.42],
          [36, 0.08],
          [45, 0.08],
          [45.2, 0.22],
          [46, 0.08],
          [50.6, 0.1],
          [52, 0.3],
          [53, 0.45],
          [56, 0.5],
        ),
        delayFeedbackAutomation: lanes(
          [0, 0.3],
          [27.5, 0.3],
          [28, 0.55],
          [35.5, 0.55],
          [36, 0.3],
          [51.5, 0.3],
          [52.5, 0.5],
        ),
      }),
    );
    s.track(
      voice("strings", "Tide strings", "violins", 0.3, {
        pan: 0.18,
        reverb: { ...hall, mix: 0.26 },
        humanize: { timing: 10, velocity: 3, seed: 21 },
      }),
    );
    s.track(
      voice("vibes", "Amber reply", "vibes", 0.31, {
        pan: 0.3,
        reverb: hall,
        delay: { beats: 0.75, feedback: 0.24, mix: 0.13 },
        fx: { wobble: { depth: 5, rate: 0.37, drift: 0.6 } },
        humanize: { timing: 8, velocity: 5, seed: 5 },
      }),
    );
    s.track(
      voice("tape", "Tape knocks", "sampler", 0.3, {
        pan: -0.31,
        sampler: {
          mode: "keyed",
          voices: { tape: { ...bundledSampleRef("tape-hit"), fadeTime: 0.03 } },
        },
        delay: { beats: 1.5, feedback: 0.34, mix: 0.26, pingpong: true },
      }),
    );
    s.track(
      voice("swell", "Tape swell", "sampler", 0.24, {
        pan: 0.12,
        sampler: {
          mode: "keyed",
          voices: { rise: { ...bundledSampleRef("riser"), fadeTime: 0.2 } },
        },
        filter: { type: "lpf", cutoff: 4200, resonance: 0 },
        reverb: { ...hall, mix: 0.3 },
      }),
    );
    s.track(
      voice("dust", "Vinyl dust", "kit", 0.2, {
        kit: "lofi",
        filter: { type: "hpf", cutoff: 2600, resonance: 0 },
      }),
    );

    const roll = random(1984);
    const shade = (low: number, high: number) => low + (high - low) * roll();

    // ── Rhodes: rolled rootless voicings, a soft restrike, pedal per chord ──
    PLAN.forEach((chord, i) => {
      const bar = i * 2;
      const dub = bar >= 28 && bar < 36;
      const last = bar >= 54;
      if (dub) {
        // Dub skank: short chords on two and four, echoed.
        for (const b of [bar, bar + 1])
          for (const beat of [1, 3]) {
            if (b === 35 && beat === 3) continue;
            chord.keys.forEach((pitch, v) =>
              s.note(
                "keys",
                b,
                beat + 0.012 * v + SW,
                pitch,
                0.32,
                0.4 + 0.03 * v,
                {
                  articulation: "staccato",
                },
              ),
            );
          }
        return;
      }
      const lift =
        bar >= 44 && bar < 52 ? 1.08 : bar < 4 || bar >= 52 ? 0.88 : 1;
      const length = last ? 7.9 : 7.6;
      chord.keys.forEach((pitch, v) =>
        s.note(
          "keys",
          bar,
          0.03 + v * 0.024,
          pitch,
          length,
          Math.min(0.9, (v === 3 ? 0.62 : 0.5 + v * 0.02) * lift),
        ),
      );
      pedal.push({ tick: bar * BAR + 40, state: "down" });
      pedal.push({ tick: (bar + 2) * BAR - 30, state: "up" });
      if (!last) {
        // A soft restrike of the top two voices breathes in the second bar.
        const top = chord.keys.slice(2);
        top.forEach((pitch, v) =>
          s.note("keys", bar + 1, 1.5 + SW + v * 0.02, pitch, 1.6, 0.36 * lift),
        );
      }
    });

    // ── Bass: sustained roots locked to the kick, octave lifts, slides ──
    const bassBars = (bar: number) => bar >= 4 && bar < 52;
    PLAN.forEach((chord, i) => {
      const bar = i * 2;
      if (!bassBars(bar)) return;
      const r = chord.root;
      const next = PLAN[i + 1]?.root ?? 36;
      const dub = bar >= 28 && bar < 36;
      const approach = next < r ? next + 1 : next - 1;
      if (dub) {
        // The dub riff: long root, a climb to the octave, space.
        s.note("bass", bar, 0, r, 1.3, 0.86, { articulation: "tenuto" });
        s.note("bass", bar, 1.5, r + 7, 0.4, 0.6);
        s.note("bass", bar, 2, r + 10, 0.4, 0.62);
        s.note("bass", bar, 2.5, r + 12, 0.85, 0.7);
        s.note("bass", bar, 3.5, r + 7, 0.35, 0.55);
        s.note("bass", bar + 1, 0, r, 2.4, 0.84);
        s.note("bass", bar + 1, 3, r + 3, 0.4, 0.56);
        s.note("bass", bar + 1, 3.5, approach, 0.45, 0.6, {
          articulation: "legato",
        });
        return;
      }
      const busy = bar >= 36;
      s.note("bass", bar, 0, r, 0.62, 0.84, { articulation: "tenuto" });
      s.note("bass", bar, 0.75 + SW, r, 1.45, 0.64);
      s.note("bass", bar, 2.5, i % 2 ? r + 12 : r + 7, 0.42, 0.62);
      s.note("bass", bar, 3, i % 2 ? r + 10 : r + 7, 0.8, 0.58);
      s.note("bass", bar + 1, 0, r, busy ? 1.4 : 1.85, 0.82);
      if (busy) s.note("bass", bar + 1, 1.5, r + 12, 0.4, 0.56);
      s.note("bass", bar + 1, 2.5, r, 0.6, 0.68);
      if (next !== r)
        s.note("bass", bar + 1, 3.25 + SW, approach, 0.7, 0.6, {
          articulation: "legato",
        });
    });
    // The shore: one long low C under the last chords.
    s.note("bass", 52, 0, 36, 7.4, 0.78);
    s.note("bass", 54, 0, 32, 3.6, 0.66);
    s.note("bass", 55, 0, 36, 3.9, 0.6);

    // ── Drums: a four-bar break, side stick first, snare from the refrain ──
    const kicks = [
      "9..6......8.....",
      "8.....5...8..5..",
      "9..6......8....4",
      "8.....5..7......",
    ];
    const ghosts = [
      [7, 15],
      [3, 9],
      [7, 13],
      [5, 11],
    ];
    const kick = (bar: number, pattern: string, gain = 1) =>
      [...pattern].forEach((hit, step) => {
        if (hit !== ".")
          s.note("drums", bar, at(step), 36, 0.2, (Number(hit) / 10) * gain);
      });
    const groove = (bar: number, mode: "rim" | "snare" | "double") => {
      const cycle = bar % 4;
      kick(bar, kicks[cycle]!);
      const backbeat = mode === "rim" ? 37 : 38;
      const strength = mode === "rim" ? 0.62 : 0.8;
      s.note("drums", bar, 1 + LATE, backbeat, 0.14, strength * shade(0.94, 1));
      s.note(
        "drums",
        bar,
        3 + LATE + 0.004,
        backbeat,
        0.14,
        strength * shade(0.98, 1.06),
      );
      for (const step of ghosts[cycle]!)
        s.note("drums", bar, at(step), 38, 0.08, shade(0.12, 0.22));
      const open = cycle === 1 ? 14 : cycle === 3 ? 10 : -1;
      for (let step = 0; step < 16; step++) {
        if (step === open) {
          s.note("drums", bar, at(step), 46, 0.5, shade(0.3, 0.38));
          continue;
        }
        if (step % 2 === 0) {
          const accent = step % 4 === 0 ? 0.08 : 0;
          s.note("drums", bar, at(step), 42, 0.1, shade(0.26, 0.44) + accent);
        } else if (mode === "double" || (step === 15 && cycle === 1))
          s.note("drums", bar, at(step), 42, 0.08, shade(0.14, 0.26));
      }
    };
    for (let bar = 4; bar < 52; bar++) {
      if (bar >= 28 && bar < 36) continue;
      if ([11, 19, 27, 43, 51].includes(bar)) continue;
      groove(
        bar,
        bar < 20 ? "rim" : bar >= 36 && bar < 44 ? "double" : "snare",
      );
    }
    // Bar 11: the side stick hands over with a drag into the verse.
    groove(11, "rim");
    s.note("drums", 11, 3.62, 38, 0.06, 0.2);
    s.note("drums", 11, 3.7, 38, 0.06, 0.28);
    // Bar 19: a tom pickup into the refrain; hats drop out on four.
    kick(19, "8.....5...8.....");
    s.note("drums", 19, 1 + LATE, 37, 0.14, 0.6);
    for (const step of [0, 2, 4, 6, 8, 10])
      s.note("drums", 19, at(step), 42, 0.1, shade(0.26, 0.4));
    for (const [beat, pitch, velocity] of [
      [3, 48, 0.5],
      [3.25 + SW, 47, 0.46],
      [3.5, 45, 0.58],
      [3.75 + SW, 43, 0.66],
    ] as const)
      s.note("drums", 19, beat, pitch, 0.3, velocity);
    // Bar 27: the floor gives way; one snare goes into the echo.
    kick(27, "9..6............");
    s.note("drums", 27, 1 + LATE, 38, 0.14, 0.78);
    s.note("drums", 27, 0, 42, 0.1, 0.34);
    s.note("drums", 27, 0.5, 42, 0.1, 0.3);
    s.note("throws", 27, 3 + LATE, 38, 0.14, 0.8);
    // Bar 43: a rising ghost roll under the tape swell.
    kick(43, "8.....5.........");
    s.note("drums", 43, 1 + LATE, 38, 0.14, 0.76);
    for (let step = 8; step < 16; step++)
      s.note("drums", 43, at(step), 38, 0.07, 0.14 + (step - 8) * 0.07);
    // Bar 51: the break thins to kick and a last open hat.
    kick(51, "9..6......8.....");
    s.note("drums", 51, 1 + LATE, 38, 0.14, 0.72);
    s.note("drums", 51, at(10), 46, 0.6, 0.3);
    // Crashes mark the refrains and the return of the full break.
    for (const [bar, velocity] of [
      [20, 0.5],
      [36, 0.4],
      [44, 0.56],
    ] as const)
      s.note("drums", bar, 0, 49, 2, velocity);

    // Dub room: heartbeat kick, one-drop side stick, skank hats, throws.
    for (let bar = 28; bar < 36; bar++) {
      kick(bar, bar % 2 ? "8.........5....." : "9..5..........");
      if (bar !== 35)
        s.note("drums", bar, 2 + LATE, 37, 0.14, shade(0.5, 0.58));
      for (const step of [6, 14])
        if (!(bar === 35 && step === 14))
          s.note("drums", bar, at(step), 46, 0.3, shade(0.16, 0.24));
      if (bar % 2 === 0) s.note("throws", bar, 3 + LATE, 38, 0.14, 0.72);
      else if (bar === 31 || bar === 33)
        s.note("throws", bar, 3.75 + SW, 38, 0.14, 0.42);
    }
    // Shore: the heartbeat fades.
    kick(52, "8..5............");
    kick(53, "6...............");
    kick(54, "5..3............");
    s.note("throws", 53, 3 + LATE, 37, 0.14, 0.5);

    // ── Vocal ──
    const sing = (bar: number, line: readonly Sung[], gain = 1) =>
      line.forEach(([beat, pitch, length, velocity, lyric], i) => {
        const first = i === 0;
        const final = i === line.length - 1;
        s.note("vocal", bar, beat, pitch, length, velocity * gain, {
          lyric,
          ...(first && length >= 0.4 ? { bend: SCOOP } : {}),
          ...(final ? { bend: FALL, vibrato: LONG_VIBRATO } : {}),
          ...(!final && length >= 1
            ? { vibrato: { rate: 5.3, depth: 16, delay: 0.4 } }
            : {}),
        });
      });
    VERSE_ONE.forEach((line, i) => sing(12 + i * 2, line));
    REFRAIN_LINES.forEach((line, i) => sing(20 + i * 2, line));
    VERSE_TWO.forEach((line, i) => sing(36 + i * 2, line, 1.04));
    sing(44, REFRAIN_HIGH);
    REFRAIN_LINES.slice(1, 3).forEach((line, i) =>
      sing(46 + i * 2, line, 1.06),
    );
    // The last "turns" leans on B and rises to C as the shore arrives.
    const lastLine = REFRAIN_LINES[3]!;
    lastLine
      .slice(0, -1)
      .forEach(([beat, pitch, length, velocity, lyric]) =>
        s.note("vocal", 50, beat, pitch, length, velocity * 1.06, { lyric }),
      );
    s.note("vocal", 50, 2, 59, 10, 0.72, {
      lyric: "turns",
      bend: [
        { at: 0, cents: 0 },
        { at: 0.58, cents: 0 },
        { at: 0.66, cents: 100 },
        { at: 0.86, cents: 100 },
        { at: 1, cents: 60 },
      ],
      vibrato: LONG_VIBRATO,
    });
    // Dub room: fragments of the refrain, each left to echo.
    s.note("vocal", 28, 0.5, 67, 0.9, 0.66, { lyric: "Low", bend: SCOOP });
    s.note("vocal", 28, 1.5, 63, 2.2, 0.62, {
      lyric: "tide",
      bend: FALL,
      vibrato: LONG_VIBRATO,
    });
    s.note("vocal", 32, 2, 63, 0.5, 0.6, { lyric: "un-" });
    s.note("vocal", 32, 2.5, 60, 2.6, 0.6, {
      lyric: "der",
      bend: FALL,
      vibrato: LONG_VIBRATO,
    });
    s.note("vocal", 34, 1.25, 68, 0.6, 0.6, { lyric: "pull", bend: SCOOP });
    // Shore: one last, distant call.
    s.note("vocal", 53, 2.5, 67, 0.9, 0.52, { lyric: "low", bend: SCOOP });
    s.note("vocal", 53, 3.5, 63, 2.6, 0.5, {
      lyric: "tide",
      bend: FALL,
      vibrato: LONG_VIBRATO,
    });

    // ── Strings: a rising line against the refrain, held into the shore ──
    const bow = (
      bar: number,
      beat: number,
      pitch: number,
      length: number,
      velocity: number,
    ) => s.note("strings", bar, beat, pitch, length, velocity);
    for (const [bar, beat, pitch, length, velocity] of [
      [20, 0, 72, 7.8, 0.5],
      [22, 0, 73, 3.9, 0.52],
      [23, 0, 72, 3.9, 0.5],
      [24, 0, 75, 7.8, 0.54],
      [26, 0, 68, 3.9, 0.5],
      [27, 0, 71, 3.9, 0.52],
      // Second tide: a pedal G under the lament.
      [36, 0, 67, 7.8, 0.36],
      [38, 0, 67, 7.8, 0.38],
      [40, 0, 67, 7.8, 0.4],
      [42, 0, 65, 7.8, 0.44],
      // Refrain return: higher, with an octave below.
      [44, 0, 72, 7.8, 0.56],
      [44, 0, 60, 7.8, 0.4],
      [46, 0, 73, 3.9, 0.56],
      [47, 0, 77, 3.9, 0.6],
      [46, 0, 56, 7.8, 0.4],
      [48, 0, 75, 3.9, 0.58],
      [49, 0, 79, 3.9, 0.62],
      [48, 0, 55, 7.8, 0.42],
      [50, 0, 77, 3.9, 0.6],
      [51, 0, 74, 1.9, 0.56],
      [51, 2, 71, 1.9, 0.54],
      [50, 0, 53, 7.8, 0.42],
      // Shore: resolve and fade.
      [52, 0, 72, 7.8, 0.46],
      [52, 0, 60, 7.8, 0.34],
      [54, 0, 72, 7.9, 0.36],
      [54, 0, 63, 7.9, 0.28],
    ] as const)
      bow(bar, beat, pitch, length, velocity);

    // ── Vibes: the hook first, then answers in the refrain's gaps ──
    for (const [bar, beat, pitch, length, velocity] of [
      [8, 0.5, 79, 0.9, 0.44],
      [8, 1.5, 75, 1.1, 0.4],
      [8, 2.5, 80, 0.45, 0.42],
      [8, 3, 79, 1.5, 0.44],
      [10, 0.5, 77, 0.9, 0.42],
      [10, 1.5, 75, 0.9, 0.38],
      [10, 2.5, 74, 1.6, 0.4],
      [21, 1.5 + SW, 80, 0.5, 0.4],
      [21, 2, 79, 0.5, 0.42],
      [21, 2.5, 75, 1.2, 0.44],
      [23, 1.5 + SW, 77, 0.5, 0.4],
      [23, 2, 75, 0.5, 0.42],
      [23, 2.5, 72, 1.2, 0.44],
      [25, 1.5 + SW, 79, 0.5, 0.4],
      [25, 2, 75, 0.5, 0.42],
      [25, 2.5, 72, 1.2, 0.44],
      [29, 0.75, 75, 1.3, 0.42],
      [29, 2.5, 74, 1.2, 0.36],
      [33, 0.75, 79, 1.3, 0.42],
      [33, 2.5, 75, 1.2, 0.36],
      [45, 1.5 + SW, 80, 0.5, 0.42],
      [45, 2, 79, 0.5, 0.44],
      [45, 2.5, 75, 1.2, 0.46],
      [47, 1.5 + SW, 77, 0.5, 0.42],
      [47, 2, 75, 0.5, 0.44],
      [47, 2.5, 72, 1.2, 0.46],
      [49, 1.5 + SW, 79, 0.5, 0.42],
      [49, 2, 75, 0.5, 0.44],
      [49, 2.5, 72, 1.2, 0.46],
      [2, 0.5, 79, 0.9, 0.34],
      [2, 1.5, 75, 1.6, 0.3],
      [54, 0.5, 79, 0.9, 0.36],
      [54, 1.5, 75, 1.1, 0.33],
      [54, 2.5, 74, 0.5, 0.32],
      [54, 3, 72, 4.9, 0.34],
    ] as const)
      s.note("vibes", bar, beat, pitch, length, velocity);

    // ── Tape knocks and the swell ──
    for (const [bar, beat, velocity] of [
      [3, 3.5, 0.5],
      [28, 1.5, 0.56],
      [30, 1.5, 0.52],
      [32, 1.5, 0.56],
      [34, 1.5, 0.5],
      [35, 3.5 + SW, 0.4],
      [51, 3.5, 0.48],
      [53, 1.5, 0.5],
      [55, 1.5, 0.42],
    ] as const)
      s.note("tape", bar, beat, 60, 0.2, velocity);
    s.note("swell", 43, 1.2, 60, 2.8, 0.7);
    s.note("swell", 19, 1.4, 58, 2.6, 0.45);

    // ── Vinyl dust: sparse, quiet, never on the grid ──
    const dust = random(77);
    for (let bar = 0; bar < 56; bar++)
      for (let k = 0; k < 9; k++) {
        const beat = Math.floor(dust() * 3.9 * 32) / 32 + 0.011;
        s.note(
          "dust",
          bar,
          beat,
          dust() < 0.8 ? 42 : 37,
          0.05,
          0.05 + dust() * 0.16,
        );
      }

    return s.finish();
  },
};
