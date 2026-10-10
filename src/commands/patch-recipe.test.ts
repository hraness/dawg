import { describe, expect, test } from "bun:test";
import type { Patch } from "../../core/patch.ts";
import { BUILTIN_PATCH_NAMES, builtinPatch } from "../../core/patches/index.ts";
import { createScore } from "../../core/score.ts";
import { applyPatchBatch, locatePatch, patchRecipe } from "./patch.ts";

/**
 * A patch with cable ids dropped (they come from newId(), so a replay mints
 * new ones) and cables in a stable order; everything else must match.
 */
function shape(patch: Patch): unknown {
  const { from: _from, ...rest } = patch as Patch & { from?: unknown };
  return {
    ...rest,
    cables: patch.cables
      .map(({ id: _id, ...cable }) => cable)
      .sort((a, b) => `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`)),
  };
}

describe("patch show replays (design §6.2: the output is the input language)", () => {
  test("there are built-ins to replay", () => {
    expect(BUILTIN_PATCH_NAMES.length).toBeGreaterThan(0);
  });

  for (const name of BUILTIN_PATCH_NAMES)
    test(name, () => {
      const patch = builtinPatch(name)!;
      const recipe = patchRecipe(patch);
      expect(recipe[0]).toStartWith(`patch new ${patch.name}`);
      const effect = patch.role === "effect";
      const score = createScore({
        bars: 1,
        tracks: [{ id: "lead", instrument: "saw" }],
      });
      const lines = effect ? recipe : recipe;
      const result = applyPatchBatch(score, "lead", lines);
      expect(result.ok, result.message).toBe(true);
      const replayed = locatePatch(
        result.next!,
        "lead",
        effect ? patch.name : undefined,
      );
      expect(typeof replayed, String(replayed)).toBe("object");
      expect(shape(replayed as Patch)).toEqual(shape(patch));
      // Printing the replay gives the same lines again.
      expect(patchRecipe(replayed as Patch)).toEqual(recipe);
    });
});
