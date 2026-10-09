import { describe, expect, test } from "bun:test";
import {
  FX_CHAIN,
  RIG_PRESETS,
  RIG_STAGES,
  applyRigPreset,
  rigPresetOf,
} from "../../core/fx.ts";
import { resolveInstrumentWord } from "../../core/instruments.ts";
import { createScore } from "../../core/score.ts";
import { findAgentTool } from "../agent/tools.ts";
import { rig as sdkRig, track as sdkTrack } from "../../core/sdk/v1.ts";
import { parsePrompt } from "../agent/ops.ts";
import {
  applyRigCommand,
  parseRigCommand,
  rigTrackFields,
  rigWordPatch,
} from "./rig.ts";

const score = () =>
  createScore({ bars: 1, tracks: [{ id: "gtr", instrument: "pluck" }] });

const run = (text: string, base = score()) => {
  const command = parseRigCommand(text);
  if (!command) throw new Error(`did not parse: ${text}`);
  return applyRigCommand(base, "gtr", command);
};

describe("rig chain", () => {
  test("stomp, head and cab sit together in the fixed chain", () => {
    const at = RIG_STAGES.map((stage) => FX_CHAIN.indexOf(stage));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect(at[1]).toBe(at[0]! + 1);
    expect(at[2]).toBe(at[1]! + 1);
    // Shoegaze effects belong to another lane.
    for (const name of ["wobble", "bloom", "swell", "double"])
      expect(FX_CHAIN as readonly string[]).not.toContain(name);
  });

  test("every rig preset normalizes and is recognised back", () => {
    for (const name of Object.keys(RIG_PRESETS)) {
      const fx = applyRigPreset(undefined, name);
      expect(fx).toBeDefined();
      expect(rigPresetOf(fx)).toBe(name);
    }
  });
});

describe("rig commands", () => {
  test("rig <preset> sets the stages, rig reset removes only them", () => {
    const base = createScore({
      bars: 1,
      tracks: [{ id: "gtr", instrument: "pluck", fx: { chorus: {} } }],
    });
    const crunch = run("rig crunch", base);
    expect(crunch.ok).toBe(true);
    const fx = crunch.next!.tracks[0]!.fx!;
    expect(fx.head?.type).toBe("crunch");
    expect(fx.cab).toBeDefined();
    expect(fx.chorus).toBeDefined();
    expect(crunch.message).toContain("head crunch");
    const reset = run("rig reset", crunch.next!);
    const after = reset.next!.tracks[0]!.fx!;
    for (const stage of RIG_STAGES) expect(after[stage]).toBeUndefined();
    expect(after.chorus).toBeDefined();
  });

  test("stage commands take a type, a preset or params", () => {
    expect(parseRigCommand("stomp fuzz")).toEqual({
      type: "rig-stage",
      stage: "stomp",
      fx: { type: "fx-set", effect: "stomp", values: { type: "fuzz" } },
    });
    const cab = run("cab 4x12");
    expect(cab.next!.tracks[0]!.fx!.cab?.type).toBe("4x12");
    const gain = run("head gain 7", cab.next!);
    expect(gain.next!.tracks[0]!.fx!.head?.gain).toBe(7);
    const gate = run("head gate -55", gain.next!);
    expect(gate.next!.tracks[0]!.fx!.head?.gate).toBe(-55);
  });

  test("amp points at head and stays Strudel gain", () => {
    for (const text of ["amp", "fx amp", "fx amp crunch"]) {
      const result = run(text);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("did you mean head (guitar amp)?");
    }
  });

  test("unknown rigs answer with the list; bare rig lists them", () => {
    const typo = run("rig crunh");
    expect(typo.ok).toBe(false);
    expect(typo.message).toContain("did you mean crunch?");
    expect(typo.message).toContain("metal");
    expect(parseRigCommand("rig some heavy thing")?.type).toBe("rig-hint");
    expect(run("rig nonsense").message).not.toContain("did you mean");
    const shown = run("rig");
    expect(shown.ok).toBe(true);
    expect(shown.message).toContain("crunch");
  });

  test("spring also sets a track reverb", () => {
    const spring = run("rig spring");
    expect(spring.next!.tracks[0]!.reverb).toBeDefined();
  });

  test("switching rigs drops the previous rig's untouched companions", () => {
    const funkThenMetal = applyRigPreset(
      applyRigPreset(undefined, "funk"),
      "metal",
    );
    expect(Object.keys(funkThenMetal!).sort()).toEqual(
      ["cab", "head", "stomp"].sort(),
    );
    expect(applyRigPreset(applyRigPreset(undefined, "jangle"), "reset")).toBe(
      undefined,
    );
    // A compressor the user changed after `rig jangle` stays.
    const jangle = applyRigPreset(undefined, "jangle")!;
    const edited = {
      ...jangle,
      compressor: { ...jangle.compressor!, ratio: 8 },
    };
    expect(applyRigPreset(edited, "crunch")?.compressor?.ratio).toBe(8);
    // Command path: spring's room goes when another rig loads.
    const spring = run("rig spring");
    const after = run("rig crunch", spring.next!);
    expect(after.next!.tracks[0]!.reverb).toBeUndefined();
    const reset = run("rig reset", spring.next!);
    expect(reset.next!.tracks[0]!.reverb).toBeUndefined();
  });
});

describe("rig track aliases", () => {
  test("aliases write a guitar voice plus their rig; lead and bass stay legacy", () => {
    for (const word of [
      "jangle",
      "punk",
      "funk",
      "ragged",
      "gtr-lead",
      "gtr-metal",
      "bachata",
    ]) {
      const row = resolveInstrumentWord(word);
      expect(row?.fx).toBeDefined();
      const patch = rigWordPatch(word, undefined);
      expect(patch.fx).toBeTruthy();
      expect(RIG_STAGES.some((stage) => patch.fx?.[stage])).toBe(true);
    }
    expect(resolveInstrumentWord("jangle")?.fx).toBe("jangle");
    for (const word of ["lead", "bass", "pluck", "piano"])
      expect(rigWordPatch(word, undefined)).toEqual({});
  });

  test("the voice is the strings electric preset (jangle: the 12-string)", () => {
    // One fixed choice per dawg version: the strings engine's guitars.
    for (const [word, preset] of [
      ["jangle", "jangle"],
      ["punk", "electric"],
      ["gtr-metal", "electric"],
      ["bachata", "electric"],
    ] as const) {
      expect(resolveInstrumentWord(word)).toMatchObject({
        instrument: "string",
        field: "string",
        preset,
      });
      expect(rigTrackFields(word)).toMatchObject({
        instrument: "string",
        string: { preset },
      });
    }
  });

  test("every word path loads the rig: prompt, agent tools, SDK", () => {
    const jangle = applyRigPreset(undefined, "jangle")!;
    const stages = (fx: unknown) =>
      Object.fromEntries(
        RIG_STAGES.map((stage) => [
          stage,
          (fx as Record<string, unknown> | undefined)?.[stage],
        ]),
      );
    // New track (`track jangle`, `dawg jangle`).
    expect(stages(rigTrackFields("jangle").fx)).toEqual(stages(jangle));
    expect(rigTrackFields("piano")).toEqual({});
    // `instrument jangle` keeps the typed word so the rig can be loaded.
    const op = parsePrompt("instrument jangle");
    expect(op).toMatchObject({ type: "track", word: "jangle" });
    expect(parsePrompt("instrument piano")).not.toHaveProperty("word");
    const context = {
      score: score(),
      focusedTrackId: "gtr",
      revision: 1,
      newNoteId: (_trackId: string, index: number) => `n${index}`,
    };
    const set = findAgentTool("set_instrument")!.plan(
      { instrument: "jangle" },
      context,
    );
    if (set.kind !== "score") throw new Error("score plan");
    const setPatch = (set.operations[0] as { patch: { fx?: unknown } }).patch;
    expect(stages(setPatch.fx)).toEqual(stages(jangle));
    const created = findAgentTool("create_track")!.plan(
      { id: "g2", instrument: "gtr-metal" },
      context,
    );
    if (created.kind !== "score") throw new Error("score plan");
    const newTrack = (created.operations[0] as { track: { fx?: unknown } })
      .track;
    expect(stages(newTrack.fx)).toEqual(
      stages(applyRigPreset(undefined, "metal")),
    );
    // SDK: `instrument: "jangle"` spreads rig("jangle"); own fx wins.
    const sdk = sdkTrack({ name: "g", instrument: "jangle" });
    expect(sdk.fx?.head).toEqual(sdkRig("jangle").head);
    const own = sdkTrack({
      name: "g",
      instrument: "jangle",
      fx: { head: { type: "high" } },
    });
    expect(own.fx?.head).toEqual({ type: "high" });
  });
});

describe("set_rig agent tool", () => {
  const tool = findAgentTool("set_rig")!;
  const context = {
    score: score(),
    focusedTrackId: "gtr",
    revision: 1,
    newNoteId: (_trackId: string, index: number) => `n${index}`,
  };

  test("plans one updateTrack for a rig plus stage tweaks", () => {
    const plan = tool.plan({ rig: "metal", head: { gain: 9 } }, context);
    expect(plan.kind).toBe("score");
    if (plan.kind !== "score") return;
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({
      type: "updateTrack",
      trackId: "gtr",
      patch: { fx: { head: { gain: 9 } } },
    });
  });

  test("rejects unknown rigs", () => {
    expect(() => tool.plan({ rig: "nope" }, context)).toThrow();
  });
});
