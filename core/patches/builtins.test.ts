/**
 * The built-in patch library: each patch validates, has four named macros,
 * compiles without warnings and under the cost budget, and renders
 * non-silent and deterministic in a song.
 */
import { describe, expect, test } from "bun:test";
import {
  compilePatch,
  PATCH_COST_BUDGET,
} from "../../src/audio/patch/compile.ts";
import { renderScorePcm } from "../../src/audio/wav.ts";
import { validatePatch } from "../patch.ts";
import { createScore, type TrackInput } from "../score.ts";
import { BUILTIN_PATCH_NAMES, BUILTIN_PATCHES, builtinPatch } from "./index.ts";

const options = { sampleRate: 16_000 };

function song(track: Record<string, unknown>) {
  return createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [track as TrackInput],
    notes: [0, 240, 480, 720, 960, 1440].map((startTick, i) => ({
      id: `n${i}`,
      trackId: "t",
      startTick,
      durationTicks: 200,
      pitch: [40, 52, 45, 57, 43, 48][i]!,
      velocity: 0.8,
    })),
  });
}

const energy = (pcm: Int16Array) => {
  let sum = 0;
  for (const v of pcm) sum += v * v;
  return sum;
};
const equal = (a: Int16Array, b: Int16Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe("built-in patches", () => {
  test("eight or more, named by their keys, resolvable", () => {
    expect(BUILTIN_PATCH_NAMES.length).toBeGreaterThanOrEqual(8);
    for (const name of BUILTIN_PATCH_NAMES) {
      expect(BUILTIN_PATCHES[name]!.name).toBe(name);
      expect(builtinPatch(name)).toBe(BUILTIN_PATCHES[name]);
    }
    expect(builtinPatch("toString")).toBeUndefined();
  });

  for (const name of BUILTIN_PATCH_NAMES) {
    const patch = BUILTIN_PATCHES[name]!;
    test(`${name} validates with four named macros`, () => {
      const valid = validatePatch(patch, { label: name });
      expect(valid.macros.map((m) => m.id)).toEqual(
        patch.macros.map((m) => m.id),
      );
      expect(valid.macros).toHaveLength(4);
      for (const macro of valid.macros) expect(macro.label).toBeTruthy();
    });

    test(`${name} compiles clean and under budget`, () => {
      const program = compilePatch(validatePatch(patch));
      expect(program.warnings).toEqual([]);
      expect(program.cost).toBeLessThanOrEqual(PATCH_COST_BUDGET);
      // No voice cap ever bites (engine-only patches run no voice nodes).
      if (program.voices > 0) expect(program.voices).toBe(patch.voices ?? 16);
    });

    test(`${name} renders non-silent and deterministic`, () => {
      const track =
        patch.role === "instrument"
          ? { id: "t", name: "t", instrument: "patch", patch }
          : { id: "t", name: "t", instrument: "pluck", fxPatch: [patch] };
      const score = song(track);
      const a = renderScorePcm(score, options).pcm;
      expect(energy(a)).toBeGreaterThan(0);
      expect(equal(a, renderScorePcm(score, options).pcm)).toBe(true);
      if (patch.role === "effect") {
        const dry = renderScorePcm(
          song({ id: "t", name: "t", instrument: "pluck" }),
          options,
        ).pcm;
        expect(equal(a, dry)).toBe(false);
      }
    });
  }
});
