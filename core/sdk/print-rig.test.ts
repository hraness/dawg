import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { diffScores } from "../diff.ts";
import {
  RIG_PRESETS as CORE_RIGS,
  RIG_STAGES,
  applyRigPreset,
  normalizeFx,
} from "../fx.ts";
import { createScore, type TrackScore } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import { printProject, printTrack } from "./print.ts";
import { DawgSdkError, RIG_PRESETS, SDK_VERSION, rig } from "./v1.ts";

const rigged = createScore({
  tempoBpm: 100,
  bars: 1,
  tracks: [
    {
      id: "gtr",
      name: "gtr",
      instrument: "pluck",
      fx: { ...applyRigPreset(undefined, "crunch"), chorus: {} },
    },
    {
      id: "custom",
      name: "custom",
      instrument: "pluck",
      fx: {
        ...applyRigPreset(undefined, "metal")!,
        head: { ...applyRigPreset(undefined, "metal")!.head!, gain: 9 },
      },
    },
    {
      id: "funky",
      name: "funky",
      instrument: "pluck",
      fx: applyRigPreset(undefined, "funk"),
    },
  ],
} as never);

async function writeProject(dir: string, score: TrackScore): Promise<void> {
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
}

describe("rig in the SDK", () => {
  test("the SDK rig table matches core/fx.ts RIG_PRESETS", () => {
    expect(Object.keys(RIG_PRESETS)).toEqual(Object.keys(CORE_RIGS));
    for (const [name, preset] of Object.entries(CORE_RIGS)) {
      for (const stage of RIG_STAGES)
        expect(RIG_PRESETS[name]![stage]).toEqual(preset[stage]);
      // Companion effects too (spring's reverb is a track field).
      const { reverb: _reverb, ...fx } = preset as Record<string, unknown>;
      const sdk = Object.fromEntries(
        Object.entries(RIG_PRESETS[name]!).filter(([, v]) => v !== undefined),
      );
      expect(sdk as Record<string, unknown>).toEqual(fx);
      // rig() gives what the `rig` command stores.
      expect(normalizeFx(rig(name))).toEqual(applyRigPreset(undefined, name));
    }
  });

  test("rig() spreads stages with overrides and rejects unknown names", () => {
    expect(SDK_VERSION).toBe("1.22.0");
    expect(rig("crunch")).toEqual({
      head: { type: "crunch", gain: 5 },
      cab: { type: "4x12" },
    });
    expect(rig("metal", { head: { gain: 9 } }).head?.gain).toBe(9);
    expect(() => rig("nope")).toThrow(DawgSdkError);
  });
});

describe("rig in the printer", () => {
  test("a preset rig prints as ...rig(name); a tweaked one prints stages", () => {
    const gtr = printTrack(rigged, rigged.tracks[0]!);
    expect(gtr).toContain('...rig("crunch"),');
    expect(gtr).toContain("chorus: {},");
    expect(gtr).toMatch(/import \{[^}]*\brig\b[^}]*\} from "dawg"/);
    const custom = printTrack(rigged, rigged.tracks[1]!);
    expect(custom).not.toContain("rig(");
    expect(custom).toContain("head: {");
    const funky = printTrack(rigged, rigged.tracks[2]!);
    expect(funky).toContain('...rig("funk"),');
    expect(funky).not.toContain("autofilter");
  });

  test("output is prettier-stable", async () => {
    for (const file of printProject(rigged).files)
      expect(await prettier.format(file.text, { parser: "typescript" })).toBe(
        file.text,
      );
  });

  test("print → eval → print is the identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-rig-"));
    try {
      await initProject(dir);
      await writeProject(dir, rigged);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      expect(diffScores(rigged, evaluated.score)).toEqual([]);
      expect(printProject(evaluated.score).files).toEqual(
        printProject(rigged).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
