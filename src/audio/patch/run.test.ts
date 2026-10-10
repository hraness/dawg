import { describe, expect, test } from "bun:test";
import { validatePatch } from "../../../core/patch.ts";
import { compilePatch } from "./compile.ts";
import { BLOCK, runPatch, type PatchNote } from "./run.ts";

const SR = 48_000;

const note = (
  seed: string,
  start: number,
  end: number,
  pitch = 440,
): PatchNote => ({
  seed,
  start,
  end,
  pitch,
  note: 69,
  velocity: 1,
});

function bytes(buffer: Float64Array): Buffer {
  return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("runPatch", () => {
  test("a sine voice matches the reference phase accumulator within 1e-12", () => {
    const program = compilePatch(
      validatePatch({
        kind: "patch",
        role: "instrument",
        name: "sine",
        nodes: [{ id: "o", type: "osc", params: { wave: "sine", level: 0.5 } }],
        cables: [
          { id: "a", from: "voice.pitch", to: "o.pitch" },
          { id: "b", from: "o.out", to: "out.audio" },
        ],
        macros: [],
      }),
    );
    const frames = 9_600;
    const { left } = runPatch(program, {
      frames,
      sampleRate: SR,
      notes: [note("n:0", 0, frames, 440)],
    });
    let ph = 0;
    let worst = 0;
    for (let i = 0; i < frames; i += 1) {
      worst = Math.max(
        worst,
        Math.abs(left[i]! - 0.5 * Math.sin(2 * Math.PI * ph)),
      );
      ph += 440 / SR;
      if (ph >= 1) ph -= 1;
    }
    expect(worst).toBeLessThan(1e-12);
    // And against the closed form, over the first 100 ms.
    for (let i = 0; i < 4_800; i += 1)
      expect(
        Math.abs(left[i]! - 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR)),
      ).toBeLessThan(1e-9);
  });

  test("an LFO moves the cutoff once per block", () => {
    const filter = (lfoShape: "square" | "const") =>
      validatePatch({
        kind: "patch",
        role: "effect",
        name: "wah",
        nodes: [
          lfoShape === "square"
            ? { id: "mod", type: "lfo", params: { shape: "square", rate: 10 } }
            : { id: "mod", type: "const", params: { value: 1 } },
          {
            id: "span",
            type: "scale",
            params: { inmin: -1, inmax: 1, min: 300, max: 4000 },
          },
          { id: "vcf", type: "svf", params: { q: 0.5 } },
        ],
        cables: [
          { id: "a", from: "in.audio", to: "vcf.in" },
          { id: "b", from: "mod.out", to: "span.in" },
          { id: "c", from: "span.out", to: "vcf.cutoff" },
          { id: "d", from: "vcf.out", to: "out.audio" },
        ],
        macros: [],
      });
    const frames = 9_600;
    const audio = new Float64Array(frames);
    let seed = 1;
    for (let i = 0; i < frames; i += 1) {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      audio[i] = seed / 0x7fffffff - 0.5;
    }
    const moving = runPatch(compilePatch(filter("square")), {
      frames,
      sampleRate: SR,
      audio,
    }).left;
    const still = runPatch(compilePatch(filter("const")), {
      frames,
      sampleRate: SR,
      audio,
    }).left;
    // The square is high through sample 2399 (block 74 ends there): the
    // cutoff holds 4000 Hz exactly; block 75 reads the low half and ramps.
    const flip = 75 * BLOCK;
    expect(bytes(moving.subarray(0, flip))).toEqual(
      bytes(still.subarray(0, flip)),
    );
    expect(moving[flip + 1]).not.toBe(still[flip + 1]);
    let after = 0;
    let before = 0;
    for (let i = flip + BLOCK; i < flip + 2_000; i += 1)
      after += moving[i]! ** 2;
    for (let i = flip + BLOCK; i < flip + 2_000; i += 1)
      before += still[i]! ** 2;
    // At 300 Hz the noise is darker (quieter) than at 4 kHz.
    expect(after).toBeLessThan(before * 0.5);
  });

  test("a feedback loop is delayed exactly one block", () => {
    const program = compilePatch(
      validatePatch({
        kind: "patch",
        role: "effect",
        name: "loop",
        nodes: [
          { id: "blend", type: "mix" },
          { id: "amp", type: "vca", params: { gain: 0.5 } },
        ],
        cables: [
          { id: "x1", from: "in.audio", to: "blend.a" },
          { id: "x2", from: "blend.out", to: "amp.in" },
          { id: "x3", from: "amp.out", to: "blend.b" },
          { id: "x4", from: "blend.out", to: "out.audio" },
        ],
        macros: [],
      }),
    );
    const frames = 256;
    const audio = new Float64Array(frames);
    audio[0] = 1;
    const { left } = runPatch(program, { frames, sampleRate: SR, audio });
    const expected = new Float64Array(frames);
    for (let k = 0; k * BLOCK < frames; k += 1) expected[k * BLOCK] = 0.5 ** k;
    expect([...left]).toEqual([...expected]);
  });

  const PLUCK = validatePatch({
    kind: "patch",
    role: "instrument",
    name: "pluck",
    voices: 2,
    nodes: [
      { id: "o", type: "osc", params: { wave: "saw" } },
      { id: "hiss", type: "noise" },
      {
        id: "env",
        type: "adsr",
        params: { attack: 0.001, decay: 0.1, sustain: 0.5, release: 0.05 },
      },
      { id: "amp", type: "vca" },
      { id: "blend", type: "mix" },
    ],
    cables: [
      { id: "a", from: "voice.pitch", to: "o.pitch" },
      { id: "b", from: "o.out", to: "blend.a" },
      { id: "c", from: "hiss.out", to: "blend.b" },
      // Reading a voice source makes the noise per voice (seeded per note).
      { id: "h", from: "voice.velocity", to: "hiss.level", amount: 0.2 },
      { id: "d", from: "blend.out", to: "amp.in" },
      { id: "e", from: "voice.gate", to: "env.gate" },
      { id: "f", from: "env.out", to: "amp.gain" },
      { id: "g", from: "amp.out", to: "out.audio" },
    ],
    macros: [],
  });
  const NOTES = [
    note("a:0", 0, 24_000, 220),
    note("b:480", 4_000, 24_000, 330),
    note("c:960", 8_000, 24_000, 440),
    note("d:1440", 30_000, 34_000, 550),
  ];

  test("steals the oldest voice deterministically, with a short fade", () => {
    const program = compilePatch(PLUCK);
    expect(program.voices).toBe(2);
    const a = runPatch(program, { frames: SR, sampleRate: SR, notes: NOTES });
    const b = runPatch(program, {
      frames: SR,
      sampleRate: SR,
      notes: [...NOTES].reverse(),
    });
    expect(a.stolen).toBe(1);
    expect(bytes(b.left)).toEqual(bytes(a.left));
    // Without the third note the first keeps sounding; with it, the first
    // fades out within 2 ms of the steal.
    const two = runPatch(program, {
      frames: SR,
      sampleRate: SR,
      notes: NOTES.slice(0, 2),
    });
    const three = runPatch(program, {
      frames: SR,
      sampleRate: SR,
      notes: NOTES.slice(0, 3),
    });
    const solo = runPatch(program, {
      frames: SR,
      sampleRate: SR,
      notes: NOTES.slice(1, 3),
    });
    expect(bytes(three.left.subarray(0, 8_000))).toEqual(
      bytes(two.left.subarray(0, 8_000)),
    );
    // After the fade, only notes b and c sound: the same as rendering them alone.
    const fade = Math.round(0.002 * SR);
    const tail = 8_000 + fade + BLOCK;
    expect(bytes(three.left.subarray(tail, 20_000))).toEqual(
      bytes(solo.left.subarray(tail, 20_000)),
    );
  });

  test("renders byte-identically every time, with per-note seeds", () => {
    const program = compilePatch(PLUCK);
    const once = runPatch(program, {
      frames: SR,
      sampleRate: SR,
      notes: NOTES,
    });
    const again = runPatch(compilePatch(PLUCK), {
      frames: SR,
      sampleRate: SR,
      notes: NOTES,
    });
    expect(bytes(again.left)).toEqual(bytes(once.left));
    expect(once.scrubbed).toBe(0);
    // A different note id reseeds the noise.
    const reseeded = runPatch(program, {
      frames: SR,
      sampleRate: SR,
      notes: [{ ...NOTES[0]!, seed: "z:0" }, ...NOTES.slice(1)],
    });
    expect(bytes(reseeded.left)).not.toEqual(bytes(once.left));
  });

  test("a voice ends after its release, so the render goes silent", () => {
    const program = compilePatch(PLUCK);
    const { left } = runPatch(program, {
      frames: SR,
      sampleRate: SR,
      notes: [note("only:0", 0, 4_800)],
    });
    let late = 0;
    for (let i = 4_800 + Math.round(0.3 * SR); i < SR; i += 1)
      late = Math.max(late, Math.abs(left[i]!));
    expect(late).toBe(0);
  });

  test("scrubs non-finite values to zero", () => {
    const program = compilePatch(
      validatePatch({
        kind: "patch",
        role: "effect",
        name: "pass",
        nodes: [{ id: "amp", type: "vca" }],
        cables: [
          { id: "a", from: "in.audio", to: "amp.in" },
          { id: "b", from: "amp.out", to: "out.audio" },
        ],
        macros: [],
      }),
    );
    const audio = new Float64Array(64).fill(0.25);
    audio[3] = Number.NaN;
    audio[40] = Infinity;
    const render = runPatch(program, { frames: 64, sampleRate: SR, audio });
    expect(render.left.every(Number.isFinite)).toBe(true);
    expect(render.scrubbed).toBeGreaterThan(0);
    expect(render.left[0]).toBe(0.25);
  });
});
