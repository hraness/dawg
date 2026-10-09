import { describe, expect, test } from "bun:test";
import { createScore, type SampleRef } from "../../core/score.ts";
import { printTrack } from "../../core/sdk/print.ts";
import { planSamplerVoices } from "./sampler.ts";
import { sampleKey, type DecodedSample, type SampleBank } from "./samples.ts";

/** Sampler velocity layers and round robin (0.6.1, f061-bowed). */
const RATE = 8_000;

function sample(): DecodedSample {
  const mono = new Float32Array(100).fill(0.5);
  return {
    sha256: "a".repeat(64),
    sampleRate: RATE,
    channels: 1,
    frames: 100,
    mono,
  };
}

function plan(
  voices: Record<string, SampleRef>,
  notes: { pitch: number; velocity: number }[],
  mode: "oneshot" | "keyed" = "oneshot",
  id = "s",
): string[] {
  const score = createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [
      {
        id,
        name: id,
        instrument: "sampler",
        sampler: { mode, voices },
      },
    ],
    notes: notes.map((n, i) => ({
      id: `n${i}`,
      trackId: id,
      startTick: i * 240,
      durationTicks: 120,
      ...n,
    })),
  });
  const bank: SampleBank = {
    voices: new Map(
      Object.keys(voices).map((name) => [sampleKey(id, name), sample()]),
    ),
    problems: [],
  };
  return planSamplerVoices(score.tracks[0]!, score.notes, bank, {
    score,
    sampleRate: RATE,
  }).map((v) => v.voice);
}

describe("sampler velocity layers and round robin", () => {
  test("keyed layers switch at the boundary velocity", () => {
    const voices = {
      soft: { src: "soft.wav", root: 60, vel: [0, 63] as const },
      hard: { src: "hard.wav", root: 60, vel: [64, 127] as const },
    };
    // 63/127 and 64/127: the last soft and the first hard velocity.
    expect(
      plan(
        voices,
        [
          { pitch: 60, velocity: 63 / 127 },
          { pitch: 62, velocity: 64 / 127 },
          { pitch: 55, velocity: 0.2 },
          { pitch: 55, velocity: 1 },
        ],
        "keyed",
      ),
    ).toEqual(["soft", "hard", "soft", "hard"]);
  });

  test("keyed multisample: layers pick per root, highest root at or below", () => {
    const voices = {
      c3p: { src: "a.wav", root: 48, vel: [0, 80] as const },
      c3f: { src: "b.wav", root: 48, vel: [81, 127] as const },
      c4p: { src: "c.wav", root: 60, vel: [0, 80] as const },
      c4f: { src: "d.wav", root: 60, vel: [81, 127] as const },
    };
    expect(
      plan(
        voices,
        [
          { pitch: 50, velocity: 0.3 },
          { pitch: 50, velocity: 0.9 },
          { pitch: 64, velocity: 0.3 },
          { pitch: 64, velocity: 0.9 },
        ],
        "keyed",
      ),
    ).toEqual(["c3p", "c3f", "c4p", "c4f"]);
  });

  /** True when the picks alternate between the two names, in order. */
  function alternates(picks: string[], a: string, b: string): boolean {
    const first = picks[0];
    if (first !== a && first !== b) return false;
    const other = first === a ? b : a;
    return picks.every((pick, i) => pick === (i % 2 === 0 ? first : other));
  }

  test("round robin cycles A, B, A, B in note order", () => {
    const voices = {
      snA: { src: "a.wav", rr: "sn" },
      snB: { src: "b.wav", rr: "sn" },
    };
    // snA is slot 36, snB 37: either slot plays the group.
    const notes = [36, 36, 37, 36, 37].map((pitch) => ({
      pitch,
      velocity: 0.8,
    }));
    const picks = plan(voices, notes);
    expect(picks).toHaveLength(5);
    expect(alternates(picks, "snA", "snB")).toBe(true);
    // Deterministic: the same track picks the same samples every render.
    expect(plan(voices, notes)).toEqual(picks);
  });

  test("round robin starts at a turn seeded by the track id", () => {
    const voices = {
      snA: { src: "a.wav", rr: "sn" },
      snB: { src: "b.wav", rr: "sn" },
    };
    const notes = [{ pitch: 36, velocity: 0.8 }];
    const firsts = new Set(
      ["s", "t", "u", "v", "w", "x", "y", "z"].map(
        (id) => plan(voices, notes, "oneshot", id)[0],
      ),
    );
    expect(firsts).toEqual(new Set(["snA", "snB"]));
  });

  test("velocity layers with round robin per layer (keyed)", () => {
    const voices = {
      pA: { src: "a.wav", vel: [0, 63] as const, rr: "x" },
      pB: { src: "b.wav", vel: [0, 63] as const, rr: "x" },
      f: { src: "c.wav", vel: [64, 127] as const, rr: "x" },
    };
    const picks = plan(
      voices,
      [0.2, 0.2, 0.9, 0.2, 0.9].map((velocity) => ({ pitch: 60, velocity })),
      "keyed",
    );
    expect([picks[2], picks[4]]).toEqual(["f", "f"]);
    expect(alternates([picks[0]!, picks[1]!, picks[3]!], "pA", "pB")).toBe(
      true,
    );
  });

  test("one-shot layers in an rr group: each pad plays the in-layer sibling", () => {
    const voices = {
      snSoft: { src: "a.wav", vel: [0, 63] as const, rr: "sn" },
      snHard: { src: "b.wav", vel: [64, 127] as const, rr: "sn" },
    };
    // Slot 36 is snHard, 37 snSoft (name order): both follow velocity.
    expect(
      plan(voices, [
        { pitch: 36, velocity: 0.2 },
        { pitch: 36, velocity: 1 },
        { pitch: 37, velocity: 0.2 },
        { pitch: 37, velocity: 1 },
      ]),
    ).toEqual(["snSoft", "snHard", "snSoft", "snHard"]);
  });

  test("a group with a velocity gap plays the nearest layer", () => {
    const voices = {
      lo: { src: "a.wav", vel: [0, 40] as const, rr: "g" },
      hi: { src: "b.wav", vel: [100, 127] as const, rr: "g" },
    };
    expect(
      plan(voices, [
        { pitch: 36, velocity: 50 / 127 },
        { pitch: 36, velocity: 90 / 127 },
      ]),
    ).toEqual(["lo", "hi"]);
  });

  test("a one-shot voice with vel and no rr keeps its pad; no fields: unchanged", () => {
    expect(
      plan({ hit: { src: "a.wav", vel: [100, 127] } }, [
        { pitch: 36, velocity: 0.5 },
        { pitch: 36, velocity: 1 },
      ]),
    ).toEqual(["hit", "hit"]);
    expect(
      plan({ hit: { src: "a.wav" } }, [
        { pitch: 36, velocity: 0.1 },
        { pitch: 36, velocity: 1 },
      ]),
    ).toEqual(["hit", "hit"]);
  });

  test("validation rejects bad ranges and group names", () => {
    const bad = (ref: unknown) => () =>
      createScore({
        tracks: [
          {
            id: "s",
            name: "s",
            instrument: "sampler",
            sampler: { voices: { a: ref } },
          },
        ],
      } as never);
    expect(bad({ src: "a.wav", vel: [64, 63] })).toThrow(/vel/);
    expect(bad({ src: "a.wav", vel: [0, 128] })).toThrow(/vel/);
    expect(bad({ src: "a.wav", vel: [0.5, 1] })).toThrow(/vel/);
    expect(bad({ src: "a.wav", rr: "a b" })).toThrow(/rr/);
  });

  test("print: vel and rr are printed only when set", () => {
    const score = createScore({
      tracks: [
        {
          id: "s",
          name: "s",
          instrument: "sampler",
          sampler: {
            mode: "keyed",
            voices: {
              soft: { src: "soft.wav", vel: [0, 63], rr: "a" },
              hard: { src: "hard.wav" },
            },
          },
        },
      ],
    } as never);
    const text = printTrack(score, score.tracks[0]!);
    expect(text).toContain('vel: [0, 63], rr: "a"');
    expect(text).toContain('hard: "hard.wav"');
  });
});
