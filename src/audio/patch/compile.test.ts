import { describe, expect, test } from "bun:test";
import { validatePatch, type Patch } from "../../../core/patch.ts";
import {
  compilePatch,
  patchDigest,
  voiceCap,
  PATCH_COST_BUDGET,
} from "./compile.ts";

const SIMPLE = {
  kind: "patch",
  role: "instrument",
  name: "simple",
  nodes: [
    { id: "osc1", type: "osc", params: { wave: "saw" } },
    { id: "env", type: "adsr" },
    { id: "amp", type: "vca" },
    { id: "wobble", type: "lfo", rate: "global", params: { rate: 3 } },
    { id: "room", type: "fx.distort" },
  ],
  cables: [
    { id: "c1", from: "voice.pitch", to: "osc1.pitch" },
    { id: "c2", from: "osc1.out", to: "amp.in" },
    { id: "c3", from: "voice.gate", to: "env.gate" },
    { id: "c4", from: "env.out", to: "amp.gain" },
    { id: "c5", from: "amp.out", to: "room.in" },
    { id: "c6", from: "room.out", to: "out.audio" },
    { id: "c7", from: "wobble.out", to: "osc1.detune", amount: 0.5 },
  ],
  macros: [
    { id: "level", min: 0, max: 1, default: 0.8, to: [{ port: "osc1.level" }] },
  ],
} as const;

/** Same content, every list reversed. */
function reversed(input: typeof SIMPLE): unknown {
  return {
    ...input,
    nodes: [...input.nodes].reverse(),
    cables: [...input.cables].reverse(),
  };
}

describe("compilePatch", () => {
  test("splits voice and global nodes", () => {
    const program = compilePatch(validatePatch(SIMPLE));
    expect(program.voice.ids).toContain("osc1");
    expect(program.voice.ids).toContain("env");
    expect(program.voice.ids).toContain("amp");
    expect(program.global.ids).toContain("wobble");
    expect(program.global.ids).toContain("room");
    expect(program.voice.ids).not.toContain("room");
    // The LFO runs once per track, ahead of the voices, and fans out.
    expect(program.fanOuts.length).toBe(2);
    // amp.out is summed over voices into the reverb.
    expect(program.voiceSums.length).toBe(2);
    expect(program.buffers.map((b) => b.id)).toEqual(["room"]);
    expect(program.pre.length).toBeGreaterThan(0);
    expect(program.post.some((phase) => phase.kind === "buffer")).toBe(true);
    expect(program.macros.map((m) => m.id)).toEqual(["level"]);
  });

  test("schedule order does not depend on node or cable order", () => {
    const a = compilePatch(validatePatch(SIMPLE));
    const b = compilePatch(validatePatch(reversed(SIMPLE)));
    expect(b.voice.ids).toEqual(a.voice.ids);
    expect(b.global.ids).toEqual(a.global.ids);
    expect([...b.voice.slots]).toEqual([...a.voice.slots]);
    expect([...b.voice.inputs]).toEqual([...a.voice.inputs]);
    expect([...b.consts]).toEqual([...a.consts]);
    // Topological: every voice node runs after the nodes it reads.
    const ids = a.voice.ids;
    expect(ids.indexOf("osc1")).toBeLessThan(ids.indexOf("amp"));
    expect(ids.indexOf("env")).toBeLessThan(ids.indexOf("amp"));
  });

  test("breaks a feedback loop at the deterministic cable, one block late", () => {
    const loop = {
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
    } as const;
    const program = compilePatch(validatePatch(loop));
    // The head is the lowest id ("amp"); its cable from inside the loop is x2.
    expect(program.warnings).toContain(
      "feedback: cable x2 is delayed one block (32 samples)",
    );
    expect(program.global.delays.length).toBe(2);
    expect(program.voices).toBe(0);
    const again = compilePatch(
      validatePatch({ ...loop, nodes: [...loop.nodes].reverse() }),
    );
    expect(again.warnings).toEqual(program.warnings);
    expect(again.global.ids).toEqual(program.global.ids);
  });

  test("caches by digest and folds nested patches into the digest", () => {
    const patch = validatePatch(SIMPLE);
    expect(compilePatch(patch)).toBe(compilePatch(validatePatch(SIMPLE)));
    const inner: Patch = validatePatch({
      kind: "patch",
      role: "instrument",
      name: "inner",
      nodes: [{ id: "o", type: "osc" }],
      cables: [
        { id: "a", from: "voice.pitch", to: "o.pitch" },
        { id: "b", from: "o.out", to: "out.audio" },
      ],
      macros: [],
    });
    const outer = validatePatch(
      {
        kind: "patch",
        role: "instrument",
        name: "outer",
        nodes: [{ id: "x", type: "patch.inner" }],
        cables: [{ id: "a", from: "x.audio", to: "out.audio" }],
        macros: [],
      },
      { library: { inner } },
    );
    const changed = validatePatch({
      ...inner,
      nodes: [{ id: "o", type: "osc", params: { wave: "sine" } }],
    });
    expect(patchDigest(outer, { inner })).not.toBe(
      patchDigest(outer, { inner: changed }),
    );
    const program = compilePatch(outer, { inner });
    expect(program.voice.ids).toContain("x/o");
  });

  test("caps voices by cost, deterministically", () => {
    expect(voiceCap(16, 10, 100)).toBe(16);
    expect(voiceCap(16, 100, 100, PATCH_COST_BUDGET)).toBe(10);
    expect(voiceCap(16, 10_000, 0)).toBe(1);
    expect(voiceCap(8, 0, 50)).toBe(8);
  });
});
