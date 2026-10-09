import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { diffScores } from "../diff.ts";
import {
  RIG_ADDED,
  RIG_PRESETS as CORE_RIGS,
  RIG_STAGES,
  applyRigPreset,
  normalizeFx,
  rigReverb as coreRigReverb,
} from "../fx.ts";
import { createScore, type TrackScore } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import { printProject, printTrack } from "./print.ts";
import {
  DawgSdkError,
  RIG_PRESETS,
  SDK_VERSION,
  rig,
  rigReverb,
  track as sdkTrack,
} from "./v1.ts";

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
    {
      id: "jangle",
      name: "jangle",
      instrument: "pluck",
      fx: applyRigPreset(undefined, "jangle"),
    },
    {
      // A 0.6.0 jangle: no double.
      id: "jangle060",
      name: "jangle060",
      instrument: "pluck",
      fx: normalizeFx({
        head: { type: "chime", gain: 3, treble: 7 },
        cab: { type: "2x12", mic: 0.2 },
        compressor: { threshold: -20, ratio: 4, attack: 0.01, release: 0.15 },
      }),
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
      // Effects a rig gained later (jangle's double) stay out of rig().
      const { reverb: _reverb, ...fx } = preset as Record<string, unknown>;
      for (const added of RIG_ADDED[name] ?? []) delete fx[added];
      const sdk = Object.fromEntries(
        Object.entries(RIG_PRESETS[name]!).filter(([, v]) => v !== undefined),
      );
      expect(sdk as Record<string, unknown>).toEqual(fx);
      // rig() gives what the `rig` command stores, less those additions.
      const stored: Record<string, unknown> = {
        ...applyRigPreset(undefined, name),
      };
      for (const added of RIG_ADDED[name] ?? []) delete stored[added];
      expect(normalizeFx(rig(name))).toEqual(stored);
      // The track wash matches the `rig` command's.
      expect(rigReverb(name) === undefined).toBe(
        coreRigReverb(name) === undefined,
      );
      if (rigReverb(name))
        expect(coreRigReverb(name)).toMatchObject(rigReverb(name)!);
    }
  });

  test("rig() spreads stages with overrides and rejects unknown names", () => {
    expect(Number(SDK_VERSION.split(".")[1])).toBeGreaterThanOrEqual(23);
    expect(rig("crunch")).toEqual({
      head: { type: "crunch", gain: 5 },
      cab: { type: "4x12" },
    });
    expect(rig("metal", { head: { gain: 9 } }).head?.gain).toBe(9);
    expect(() => rig("nope")).toThrow(DawgSdkError);
  });
});

describe("0.6.1 rigs in song.ts", () => {
  test("a 0.6.0 jangle song.ts keeps its 0.6.0 stages (no double)", () => {
    expect(rig("jangle")).not.toHaveProperty("double");
    expect(sdkTrack({ name: "g", instrument: "jangle" }).fx).not.toHaveProperty(
      "double",
    );
    // Exactly the stored 0.6.0 jangle, so it renders as it did.
    const legacy = rigged.tracks[4]!.fx;
    expect(normalizeFx(rig("jangle"))).toEqual(legacy);
    expect(
      normalizeFx(sdkTrack({ name: "g", instrument: "jangle" }).fx as never),
    ).toEqual(legacy);
  });

  test("instrument: shoegaze brings the wash the prompt sets", () => {
    const sdk = sdkTrack({ name: "g", instrument: "shoegaze" });
    expect(sdk.reverb).not.toBeNull();
    expect(coreRigReverb("shoegaze")).toMatchObject(sdk.reverb!);
    expect(normalizeFx(sdk.fx as never)).toEqual(
      applyRigPreset(undefined, "shoegaze"),
    );
    // Its own reverb wins; null keeps it dry.
    expect(
      sdkTrack({ name: "g", instrument: "shoegaze", reverb: null }).reverb,
    ).toBeNull();
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
    // 0.6.1 jangle: the spread plus its double; 0.6.0 jangle: the spread
    // alone, as 0.6.0 printed it.
    const jangle = printTrack(rigged, rigged.tracks[3]!);
    expect(jangle).toContain('...rig("jangle"),');
    expect(jangle).toContain("double: { time: 12, drift: 1.5, width: 0.5 },");
    const legacy = printTrack(rigged, rigged.tracks[4]!);
    expect(legacy).toContain('...rig("jangle"),');
    expect(legacy).not.toContain("double");
    expect(legacy).not.toContain("compressor");
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
