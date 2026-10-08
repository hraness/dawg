import { describe, expect, test } from "bun:test";
import {
  createScore,
  type NoteInput,
  type TrackInput,
} from "../../core/score.ts";
import { planSamplerVoices } from "./sampler.ts";
import { sampleKey, type DecodedSample, type SampleBank } from "./samples.ts";
import { renderScorePcm } from "./wav.ts";

/** 120 BPM: one beat is 0.5 s = 4000 frames at 8 kHz, 480 ticks. */
const RATE = 8_000;
const BEAT = 4_000;
const TPB = 480;

/** Test notes are written in beats; scores store ticks. */
type BeatNote = Omit<NoteInput, "trackId" | "start" | "duration"> & {
  start?: number;
  duration?: number;
};

function ticks(notes: BeatNote[], trackId: string): NoteInput[] {
  return notes.map(({ start = 0, duration = 1, ...rest }) => ({
    ...rest,
    trackId,
    startTick: Math.round(start * TPB),
    durationTicks: Math.round(duration * TPB),
  }));
}

function render(track: Partial<TrackInput>, notes: BeatNote[]): Int16Array {
  const score = createScore({
    tempoBpm: 120,
    bars: 2,
    ticksPerBeat: TPB,
    tracks: [{ id: "t", instrument: "sine", ...track }],
    notes: ticks(notes, "t"),
  });
  return renderScorePcm(score, { sampleRate: RATE, maxSeconds: 6 }).pcm;
}

/** Mean absolute level of the left channel over frames [from, to). */
function level(pcm: Int16Array, from: number, to: number): number {
  let sum = 0;
  for (let frame = from; frame < to; frame += 1)
    sum += Math.abs(pcm[frame * 2] ?? 0);
  return sum / Math.max(1, to - from);
}

/** Zero crossings of the left channel over frames [from, to). */
function crossings(pcm: Int16Array, from: number, to: number): number {
  let count = 0;
  for (let frame = from + 1; frame < to; frame += 1) {
    const a = pcm[(frame - 1) * 2]!;
    const b = pcm[frame * 2]!;
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) count += 1;
  }
  return count;
}

const note = (extra: Partial<BeatNote> = {}): BeatNote => ({
  id: "a",
  start: 0,
  duration: 1,
  pitch: 69,
  velocity: 0.8,
  ...extra,
});

describe("expression at render", () => {
  test("a plain note is untouched by the performance pass", () => {
    const plain = render({}, [note()]);
    // A track with every performance field at its neutral value renders the
    // same samples as one without them.
    const neutral = render({ humanize: { seed: 1 } }, [note()]);
    expect(neutral).toEqual(plain);
  });

  test("staccato sounds for half the written length", () => {
    const legato = render({}, [note()]);
    const staccato = render({}, [note({ articulation: "staccato" })]);
    const late = [BEAT * 0.6, BEAT * 0.9] as const;
    expect(level(legato, ...late)).toBeGreaterThan(1_000);
    expect(level(staccato, ...late)).toBeLessThan(level(legato, ...late) / 20);
  });

  test("accent is louder and ghost is quieter", () => {
    const plain = level(render({}, [note()]), 0, BEAT / 4);
    const accent = level(
      render({}, [note({ articulation: "accent" })]),
      0,
      BEAT / 4,
    );
    const ghost = level(
      render({}, [note({ articulation: "ghost" })]),
      0,
      BEAT / 4,
    );
    expect(accent).toBeGreaterThan(plain * 1.15);
    expect(ghost).toBeLessThan(plain * 0.5);
  });

  test("a bend of +1200 cents doubles the pitch by the end", () => {
    const flat = render({}, [note()]);
    const bent = render({}, [
      note({
        bend: [
          { at: 0, cents: 1200 },
          { at: 1, cents: 1200 },
        ],
      }),
    ]);
    const window = [BEAT * 0.2, BEAT * 0.8] as const;
    const ratio = crossings(bent, ...window) / crossings(flat, ...window);
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
  });

  test("vibrato changes the waveform but keeps the mean pitch", () => {
    const flat = render({}, [note()]);
    const vibrato = render({}, [note({ vibrato: { rate: 6, depth: 50 } })]);
    expect(vibrato).not.toEqual(flat);
    const window = [BEAT * 0.25, BEAT] as const;
    const ratio = crossings(vibrato, ...window) / crossings(flat, ...window);
    expect(Math.abs(ratio - 1)).toBeLessThan(0.05);
  });

  test("a note glide slides from the previous pitch", () => {
    const notes = [
      note({ id: "a", pitch: 57, duration: 1 }),
      note({ id: "b", start: 1, pitch: 69, duration: 1, glide: 0.4 }),
    ];
    const plain = render({}, [notes[0]!, { ...notes[1]!, glide: undefined }]);
    const glided = render({}, notes);
    // During the glide the second note sits below its target pitch.
    const window = [BEAT + 200, BEAT + 1_200] as const;
    expect(crossings(glided, ...window)).toBeLessThan(
      crossings(plain, ...window) * 0.9,
    );
  });

  test("legato glide (303) slides only into overlapping notes", () => {
    const glide = { time: 0.3, mode: "legato" as const };
    const gap = [
      note({ id: "a", pitch: 57, duration: 0.9 }),
      note({ id: "b", start: 1, pitch: 69, duration: 1 }),
    ];
    const tied = [
      note({ id: "a", pitch: 57, duration: 1.1 }),
      note({ id: "b", start: 1, pitch: 69, duration: 1 }),
    ];
    const window = [BEAT + 200, BEAT + 1_000] as const;
    const gapPlain = crossings(render({}, gap), ...window);
    const gapGlide = crossings(render({ glide }, gap), ...window);
    expect(gapGlide).toBe(gapPlain);
    const tiedGlide = crossings(render({ glide }, tied), ...window);
    expect(tiedGlide).toBeLessThan(gapPlain * 0.9);
  });

  test("the sustain pedal holds a released note until it lifts", () => {
    const notes = [note({ duration: 0.5 })];
    const dry = render({}, notes);
    const held = render(
      {
        pedal: [
          { tick: 0, state: "down" },
          { tick: 960, state: "up" },
        ],
      },
      notes,
    );
    // Between the key release (0.5 beat) and the pedal lift (2 beats).
    const between = [BEAT * 0.8, BEAT * 1.6] as const;
    expect(level(dry, ...between)).toBeLessThan(50);
    expect(level(held, ...between)).toBeGreaterThan(1_000);
    // After the lift it releases.
    expect(level(held, BEAT * 2.5, BEAT * 3)).toBeLessThan(50);
  });

  test("half pedal decays faster than a full pedal", () => {
    const notes = [note({ duration: 0.5 })];
    const full = render({ pedal: [{ tick: 0, state: "down" }] }, notes);
    const half = render({ pedal: [{ tick: 0, state: "half" }] }, notes);
    const late = [BEAT * 2, BEAT * 2.5] as const;
    expect(level(half, ...late)).toBeLessThan(level(full, ...late) * 0.5);
    expect(level(half, ...late)).toBeGreaterThan(0);
  });

  test("humanize is seeded and deterministic", () => {
    const notes = [
      note({ id: "a" }),
      note({ id: "b", start: 1 }),
      note({ id: "c", start: 2 }),
    ];
    const human = { timing: 20, velocity: 10, length: 10, seed: 7 };
    const first = render({ humanize: human }, notes);
    const again = render({ humanize: human }, notes);
    const other = render({ humanize: { ...human, seed: 8 } }, notes);
    const plain = render({}, notes);
    expect(again).toEqual(first);
    expect(first).not.toEqual(plain);
    expect(other).not.toEqual(first);
  });

  test("a fixed velocity curve plays every note at one level", () => {
    const notes = [
      note({ id: "a", velocity: 0.2 }),
      note({ id: "b", start: 2, velocity: 1 }),
    ];
    const curved = render({ velocityCurve: { curve: "fixed" } }, notes);
    const first = level(curved, 0, BEAT / 2);
    const second = level(curved, BEAT * 2, BEAT * 2.5);
    expect(Math.abs(first - second) / second).toBeLessThan(0.01);
    const plain = render({}, notes);
    expect(level(plain, 0, BEAT / 2)).toBeLessThan(
      level(plain, BEAT * 2, BEAT * 2.5) * 0.3,
    );
  });

  test("a soft curve lifts quiet notes, a hard curve lowers them", () => {
    const notes = [note({ velocity: 0.25 })];
    const plain = level(render({}, notes), 0, BEAT / 2);
    const soft = level(
      render({ velocityCurve: { curve: "soft" } }, notes),
      0,
      BEAT / 2,
    );
    const hard = level(
      render({ velocityCurve: { curve: "hard" } }, notes),
      0,
      BEAT / 2,
    );
    expect(soft).toBeGreaterThan(plain * 1.8);
    expect(hard).toBeLessThan(plain * 0.3);
  });
});

describe("expression on sampler voices", () => {
  const sample: DecodedSample = {
    sha256: "a".repeat(64),
    sampleRate: RATE,
    channels: 1,
    frames: RATE * 4,
    mono: Float32Array.from({ length: RATE * 4 }, (_, i) =>
      Math.sin((2 * Math.PI * 440 * i) / RATE),
    ),
  };
  const bank: SampleBank = {
    voices: new Map([[sampleKey("s", "tone"), sample]]),
    problems: [],
  };
  const scoreWith = (
    extra: Partial<BeatNote>,
    track: Partial<TrackInput> = {},
  ) =>
    createScore({
      tempoBpm: 120,
      bars: 2,
      ticksPerBeat: TPB,
      tracks: [
        {
          id: "s",
          instrument: "sampler",
          sampler: {
            mode: "keyed",
            voices: { tone: { src: "tone.wav", root: 69 } },
          },
          ...track,
        },
      ],
      notes: ticks(
        [{ id: "a", start: 0, duration: 1, pitch: 69, velocity: 1, ...extra }],
        "s",
      ),
    });

  test("a bend repitches the sample", () => {
    const flat = renderScorePcm(scoreWith({}), {
      sampleRate: RATE,
      samples: bank,
    }).pcm;
    const bent = renderScorePcm(
      scoreWith({
        bend: [
          { at: 0, cents: 1200 },
          { at: 1, cents: 1200 },
        ],
      }),
      { sampleRate: RATE, samples: bank },
    ).pcm;
    const window = [BEAT * 0.2, BEAT * 0.8] as const;
    const ratio = crossings(bent, ...window) / crossings(flat, ...window);
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
  });

  test("the pedal extends a keyed sample voice", () => {
    const timing = { score: scoreWith({ duration: 0.5 }), sampleRate: RATE };
    const plainEnd = planSamplerVoices(
      timing.score.tracks[0]!,
      timing.score.notes,
      bank,
      timing,
    )[0]!.end;
    const pedalled = renderScorePcm(
      scoreWith(
        { duration: 0.5 },
        {
          pedal: [
            { tick: 0, state: "down" },
            { tick: 1440, state: "up" },
          ],
        },
      ),
      { sampleRate: RATE, samples: bank },
    ).pcm;
    expect(plainEnd).toBeLessThan(BEAT * 0.6);
    expect(level(pedalled, BEAT, BEAT * 2.5)).toBeGreaterThan(1_000);
  });
});
