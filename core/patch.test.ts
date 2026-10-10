import { describe, expect, test } from "bun:test";
import { applyScoreOperations, diffScores } from "./diff.ts";
import { BOUNDARY_SPECS, NODE_SPECS, nodeSpec } from "./patch-nodes.ts";
import {
  applyPatchEdit,
  findCycles,
  inferRates,
  macroAt,
  macroPosition,
  newCableId,
  newNodeId,
  patchDepth,
  patchEdits,
  PatchValidationError,
  validateLibrary,
  validatePatch,
  type Patch,
} from "./patch.ts";
import { routingOrder } from "./routing.ts";
import {
  applyScoreOperation,
  automationPoints,
  createScore,
  removeTrack,
  scoreFromJSON,
  ScoreValidationError,
  type ScoreOperation,
  type TrackScore,
} from "./score.ts";

const SIMPLE = {
  kind: "patch",
  role: "instrument",
  name: "simple",
  nodes: [
    { id: "osc1", type: "osc", params: { wave: "saw" } },
    { id: "env", type: "adsr" },
    { id: "amp", type: "vca" },
  ],
  cables: [
    { id: "c1", from: "voice.pitch", to: "osc1.pitch" },
    { id: "c2", from: "osc1.out", to: "amp.in" },
    { id: "c3", from: "voice.gate", to: "env.gate" },
    { id: "c4", from: "env.out", to: "amp.gain" },
    { id: "c5", from: "amp.out", to: "out.audio" },
  ],
  macros: [
    { id: "level", min: 0, max: 1, default: 0.8, to: [{ port: "osc1.level" }] },
    {
      id: "attack",
      min: 0,
      max: 2,
      default: 0.01,
      to: [{ port: "env.attack" }],
    },
  ],
} as const;

const ECHO = {
  kind: "patch",
  role: "effect",
  name: "echo",
  nodes: [{ id: "lp", type: "onepole", params: { cutoff: 2000 } }],
  cables: [
    { id: "a", from: "in.audio", to: "lp.in" },
    { id: "b", from: "lp.out", to: "out.audio" },
  ],
  macros: [],
} as const;

function err(make: () => unknown): string {
  try {
    make();
  } catch (error) {
    expect(
      error instanceof PatchValidationError ||
        error instanceof ScoreValidationError,
    ).toBe(true);
    return (error as Error).message;
  }
  throw new Error("expected a validation error");
}

function scoreWith(patch: unknown = SIMPLE): TrackScore {
  return createScore({
    tracks: [
      { id: "lead", name: "lead", instrument: "patch", patch },
      { id: "drums", name: "drums", instrument: "drums" },
    ],
  } as never);
}

const op = (value: unknown) => value as ScoreOperation;

describe("node specs", () => {
  test("every spec has unique ports and a cost", () => {
    for (const spec of [
      ...Object.values(NODE_SPECS),
      ...Object.values(BOUNDARY_SPECS),
    ]) {
      const names = [...spec.inputs, ...spec.outputs].map(
        (port) => `${port.name}`,
      );
      expect(new Set(spec.inputs.map((p) => p.name)).size).toBe(
        spec.inputs.length,
      );
      expect(new Set(spec.outputs.map((p) => p.name)).size).toBe(
        spec.outputs.length,
      );
      expect(names.length).toBeGreaterThan(0);
      expect(spec.cost).toBeGreaterThanOrEqual(0);
    }
    expect(nodeSpec("osc")?.type).toBe("osc");
    expect(nodeSpec("toString")).toBeUndefined();
    expect(nodeSpec("fx.reverb")).toBeDefined();
  });
});

describe("validatePatch", () => {
  test("normalizes and sorts cables canonically", () => {
    const patch = validatePatch(SIMPLE);
    expect(patch.nodes.map((node) => node.id)).toEqual(["osc1", "env", "amp"]);
    const again = validatePatch({
      ...SIMPLE,
      cables: [...SIMPLE.cables].reverse(),
    });
    expect(again).toEqual(patch);
    expect(Object.isFrozen(patch.cables)).toBe(true);
  });

  test("rejects unknown types, ports and kinds with a suggestion", () => {
    expect(
      err(() =>
        validatePatch({
          ...SIMPLE,
          nodes: [...SIMPLE.nodes, { id: "f", type: "svff" }],
        }),
      ),
    ).toContain("svf");
    expect(
      err(() =>
        validatePatch({
          ...SIMPLE,
          cables: [
            ...SIMPLE.cables,
            { id: "x", from: "osc1.out", to: "amp.gian" },
          ],
        }),
      ),
    ).toContain("gain");
    // Notes never feed an audio input.
    expect(
      err(() =>
        validatePatch({
          ...SIMPLE,
          cables: [
            ...SIMPLE.cables,
            { id: "x", from: "in.notes", to: "amp.in" },
          ],
        }),
      ),
    ).toMatch(/notes/);
  });

  test("rejects duplicate ids, duplicate wiring and reserved ids", () => {
    expect(
      err(() =>
        validatePatch({
          ...SIMPLE,
          nodes: [...SIMPLE.nodes, { id: "amp", type: "vca" }],
        }),
      ),
    ).toContain("two nodes");
    expect(
      err(() =>
        validatePatch({
          ...SIMPLE,
          cables: [
            ...SIMPLE.cables,
            { id: "dup", from: "osc1.out", to: "amp.in" },
          ],
        }),
      ),
    ).toContain("already wired");
    expect(
      err(() =>
        validatePatch({ ...SIMPLE, nodes: [{ id: "voice", type: "osc" }] }),
      ),
    ).toMatch(/voice/);
  });

  test("role rules: effects have no voices or engines, instruments no audio in", () => {
    expect(
      err(() =>
        validatePatch({
          ...ECHO,
          cables: [
            ...ECHO.cables,
            { id: "v", from: "voice.gate", to: "lp.cutoff" },
          ],
        }),
      ),
    ).toContain("effect patch");
    expect(
      err(() =>
        validatePatch({
          ...SIMPLE,
          cables: [
            ...SIMPLE.cables,
            { id: "v", from: "in.audio", to: "amp.in" },
          ],
        }),
      ),
    ).toContain("instrument patch");
  });

  test("bounded: node, cable and macro limits", () => {
    const nodes = Array.from({ length: 65 }, (_, i) => ({
      id: `n${i}`,
      type: "const",
    }));
    expect(
      err(() => validatePatch({ ...SIMPLE, nodes, cables: [], macros: [] })),
    ).toContain("at most");
  });
});

describe("rates and cycles", () => {
  test("voice sources colour downstream nodes; forced global sums", () => {
    const { rates, voiceSums } = inferRates(validatePatch(SIMPLE));
    expect(rates.get("osc1")).toBe("voice");
    expect(rates.get("amp")).toBe("voice");
    expect(voiceSums).toEqual(["c5"]);
    const forced = validatePatch({
      ...SIMPLE,
      nodes: SIMPLE.nodes.map((node) =>
        node.id === "amp" ? { ...node, rate: "global" } : node,
      ),
    });
    expect(inferRates(forced).rates.get("amp")).toBe("global");
    expect([...inferRates(forced).voiceSums].sort()).toEqual(["c2", "c4"]);
  });

  test("a feedback loop is found and broken at one deterministic cable", () => {
    const patch = validatePatch({
      ...SIMPLE,
      nodes: [...SIMPLE.nodes, { id: "fb", type: "onepole" }],
      cables: [
        ...SIMPLE.cables,
        { id: "loop1", from: "amp.out", to: "fb.in" },
        { id: "loop2", from: "fb.out", to: "osc1.fm" },
      ],
    });
    const report = findCycles(patch);
    expect(report.cycles).toEqual([["amp", "fb", "osc1"]]);
    // The loop's lowest node id is amp; its in-loop input is c2.
    expect(report.breaks).toEqual(["c2"]);
    const reordered = validatePatch({
      ...patch,
      nodes: [...patch.nodes].reverse(),
      cables: [...patch.cables].reverse(),
    });
    expect(findCycles(reordered)).toEqual(report);
    expect(findCycles(validatePatch(SIMPLE)).cycles).toEqual([]);
  });

  test("macro curves map position to value and back", () => {
    const macro = validatePatch(SIMPLE).macros[1]!;
    expect(macroAt(macro, 0)).toBe(0);
    expect(macroAt(macro, 1)).toBe(2);
    expect(macroPosition(macro, macroAt(macro, 0.25))).toBeCloseTo(0.25, 12);
  });
});

describe("library", () => {
  test("nested patches resolve, cycle and depth are rejected", () => {
    const inner = { ...ECHO, name: "inner" };
    const outer = {
      ...ECHO,
      name: "outer",
      nodes: [{ id: "sub", type: "patch.inner" }],
      cables: [
        { id: "a", from: "in.audio", to: "sub.audio" },
        { id: "b", from: "sub.audio", to: "out.audio" },
      ],
    };
    const library = validateLibrary({ outer, inner });
    expect(Object.keys(library)).toEqual(["inner", "outer"]);
    expect(patchDepth(library.outer!, library)).toBe(1);
    const loop = {
      ...inner,
      nodes: [{ id: "sub", type: "patch.outer" }],
      cables: [],
    };
    expect(err(() => validateLibrary({ outer, inner: loop }))).toContain(
      "nests itself",
    );
  });
});

describe("score integration", () => {
  test("a patch track round-trips through JSON", () => {
    const score = scoreWith();
    const json = JSON.parse(JSON.stringify(score.toJSON()));
    expect(scoreFromJSON(json).toJSON()).toEqual(score.toJSON());
    expect(score.tracks[0]!.patch).toEqual(validatePatch(SIMPLE));
  });

  test("a patch needs the patch instrument; leaving it drops the patch", () => {
    expect(
      err(() =>
        createScore({
          tracks: [{ id: "x", name: "x", instrument: "sine", patch: SIMPLE }],
        } as never),
      ),
    ).toContain("instrument");
    const next = applyScoreOperation(
      scoreWith(),
      op({
        type: "updateTrack",
        trackId: "lead",
        patch: { instrument: "saw" },
      }),
    );
    expect(next.tracks[0]!.patch).toBeUndefined();
  });

  test("node removal unplugs its cables and macro targets", () => {
    const next = applyScoreOperation(
      scoreWith(),
      op({
        type: "setPatchNode",
        target: { trackId: "lead" },
        nodeId: "env",
        node: null,
      }),
    );
    const patch = next.tracks[0]!.patch as Patch;
    expect(patch.cables.map((cable) => cable.id).sort()).toEqual([
      "c1",
      "c2",
      "c5",
    ]);
    expect(patch.macros[1]!.to).toEqual([]);
  });

  test("an invalid edit is rejected; an edit to a gone target is a no-op", () => {
    expect(
      err(() =>
        applyScoreOperation(
          scoreWith(),
          op({
            type: "setPatchCable",
            target: { trackId: "lead" },
            cableId: "bad",
            cable: { id: "bad", from: "in.notes", to: "env.gate" },
          }),
        ),
      ),
    ).toMatch(/notes/);
    const score = scoreWith();
    for (const target of [
      { trackId: "nope" },
      { trackId: "drums" },
      { library: "x" },
    ])
      expect(
        applyScoreOperation(
          score,
          op({
            type: "setPatchNode",
            target,
            nodeId: "q",
            node: { id: "q", type: "const" },
          }),
        ),
      ).toBe(score);
  });

  test("concurrent edits to different cables of one patch both land", () => {
    const base = scoreWith();
    const mine = applyScoreOperation(
      base,
      op({
        type: "setPatchCable",
        target: { trackId: "lead" },
        cableId: "c4",
        cable: { id: "c4", from: "env.out", to: "amp.gain", amount: 0.5 },
      }),
    );
    const theirs = applyScoreOperation(
      base,
      op({
        type: "setPatchCable",
        target: { trackId: "lead" },
        cableId: "c9",
        cable: { id: "c9", from: "voice.velocity", to: "osc1.level" },
      }),
    );
    const mineOps = diffScores(base, mine);
    const theirOps = diffScores(base, theirs);
    expect(mineOps.map((o) => o.type)).toEqual(["setPatchCable"]);
    expect(theirOps.map((o) => o.type)).toEqual(["setPatchCable"]);
    const ab = applyScoreOperations(
      applyScoreOperations(base, mineOps),
      theirOps,
    );
    const ba = applyScoreOperations(
      applyScoreOperations(base, theirOps),
      mineOps,
    );
    expect(ab.toJSON()).toEqual(ba.toJSON());
    const ids = (ab.tracks[0]!.patch as Patch).cables.map((cable) => cable.id);
    expect(ids).toContain("c9");
    expect(
      (ab.tracks[0]!.patch as Patch).cables.find((c) => c.id === "c4")!.amount,
    ).toBe(0.5);
  });

  test("a cable whose node a concurrent writer removed is dropped on replay", () => {
    const base = scoreWith();
    const removed = applyScoreOperation(
      base,
      op({
        type: "setPatchNode",
        target: { trackId: "lead" },
        nodeId: "env",
        node: null,
      }),
    );
    const next = applyScoreOperation(
      removed,
      op({
        type: "setPatchCable",
        target: { trackId: "lead" },
        cableId: "c9",
        cable: { id: "c9", from: "env.out", to: "osc1.level" },
      }),
    );
    expect(next).toBe(removed);
  });

  test("macros keep their order; index moves one", () => {
    const next = applyScoreOperation(
      scoreWith(),
      op({
        type: "setPatchMacro",
        target: { trackId: "lead" },
        macroId: "cut",
        macro: {
          id: "cut",
          min: 0,
          max: 1,
          default: 0,
          to: [{ port: "osc1.detune" }],
        },
        index: 0,
      }),
    );
    expect((next.tracks[0]!.patch as Patch).macros.map((m) => m.id)).toEqual([
      "cut",
      "level",
      "attack",
    ]);
  });

  test("macro automation lanes are patch-<macro>, 0..1", () => {
    const score = createScore({
      tracks: [
        {
          id: "lead",
          name: "lead",
          instrument: "patch",
          patch: SIMPLE,
          fxAutomation: { "patch-level": [{ tick: 0, value: 0.25 }] },
        },
      ],
    } as never);
    expect(automationPoints(score.tracks[0], "patch-level" as never)).toEqual([
      { tick: 0, value: 0.25 },
    ]);
    expect(
      err(() =>
        createScore({
          tracks: [
            {
              id: "lead",
              name: "lead",
              instrument: "patch",
              patch: SIMPLE,
              fxAutomation: { "patch-level": [{ tick: 0, value: 2 }] },
            },
          ],
        } as never),
      ),
    ).toBeTruthy();
  });

  test("effect patches: unique names, ordered, sidechain is a routing edge", () => {
    const score = createScore({
      tracks: [
        { id: "kick", name: "kick", instrument: "drums" },
        {
          id: "pad",
          name: "pad",
          instrument: "sine",
          fxPatch: [{ ...ECHO, side: "kick" }],
        },
      ],
    } as never);
    expect(routingOrder(score)).toEqual(["kick", "pad"]);
    const dropped = removeTrack(score, "kick");
    expect(dropped.tracks[0]!.fxPatch![0]!.side).toBeUndefined();
    expect(
      err(() =>
        createScore({
          tracks: [
            {
              id: "pad",
              name: "pad",
              instrument: "sine",
              fxPatch: [ECHO, ECHO],
            },
          ],
        } as never),
      ),
    ).toContain("two effect patches");
    expect(
      err(() =>
        createScore({
          tracks: [
            { id: "pad", name: "pad", instrument: "sine", fxPatch: [SIMPLE] },
          ],
        } as never),
      ),
    ).toContain("effect patch");
  });

  test("removing a library patch inlines it into the tracks that used it", () => {
    let score = createScore({
      patches: { simple: SIMPLE },
      tracks: [
        {
          id: "lead",
          name: "lead",
          instrument: "patch",
          patch: { kind: "patch", ref: "simple", macros: { level: 0.3 } },
        },
      ],
    } as never);
    score = applyScoreOperation(
      score,
      op({ type: "setPatch", target: { library: "simple" }, patch: null }),
    );
    expect(score.patches).toEqual({});
    const inline = score.tracks[0]!.patch as Patch;
    expect(inline.nodes).toHaveLength(3);
    expect(inline.macros[0]!.default).toBe(0.3);
  });

  test("removing a library macro forgets track settings for it", () => {
    let score = createScore({
      patches: { simple: SIMPLE },
      tracks: [
        {
          id: "lead",
          name: "lead",
          instrument: "patch",
          patch: {
            kind: "patch",
            ref: "simple",
            macros: { level: 0.3, attack: 1 },
          },
        },
      ],
    } as never);
    score = applyScoreOperation(
      score,
      op({
        type: "setPatchMacro",
        target: { library: "simple" },
        macroId: "attack",
        macro: null,
      }),
    );
    expect(score.tracks[0]!.patch).toEqual({
      kind: "patch",
      ref: "simple",
      macros: { level: 0.3 },
    });
  });
});

describe("diff", () => {
  const roundTrip = (a: TrackScore, b: TrackScore) => {
    const ops = diffScores(a, b);
    expect(applyScoreOperations(a, ops).toJSON()).toEqual(b.toJSON());
    return ops;
  };

  test("edits inside a patch diff as node, cable and macro ops", () => {
    const a = scoreWith();
    const b = scoreWith({
      ...SIMPLE,
      nodes: [
        ...SIMPLE.nodes.filter((n) => n.id !== "env"),
        { id: "vcf", type: "svf" },
      ],
      cables: [
        { id: "c1", from: "voice.pitch", to: "osc1.pitch" },
        { id: "c2", from: "osc1.out", to: "vcf.in" },
        { id: "c6", from: "vcf.out", to: "amp.in" },
        { id: "c5", from: "amp.out", to: "out.audio" },
      ],
      macros: [SIMPLE.macros[0]],
    });
    const ops = roundTrip(a, b);
    expect(new Set(ops.map((o) => o.type))).toEqual(
      new Set(["setPatchNode", "setPatchCable", "setPatchMacro"]),
    );
  });

  test("whole writes when edits cannot express the change; every direction round-trips", () => {
    const plain = createScore({
      tracks: [
        { id: "lead", name: "lead", instrument: "sine" },
        { id: "drums", name: "drums", instrument: "drums" },
      ],
    });
    const ref = createScore({
      patches: { simple: SIMPLE, echo: ECHO },
      tracks: [
        {
          id: "lead",
          name: "lead",
          instrument: "patch",
          patch: { kind: "patch", ref: "simple" },
        },
        {
          id: "drums",
          name: "drums",
          instrument: "drums",
          fxPatch: [ECHO, { ...ECHO, name: "two" }],
        },
      ],
    } as never);
    const moved = createScore({
      patches: {
        simple: { ...SIMPLE, voices: 4 },
        echo: { ...ECHO, role: "effect" },
      },
      tracks: [
        {
          id: "lead",
          name: "lead",
          instrument: "patch",
          patch: { ...SIMPLE, name: "x" },
        },
        {
          id: "drums",
          name: "drums",
          instrument: "drums",
          fxPatch: [{ ...ECHO, name: "two" }, ECHO],
        },
      ],
    } as never);
    const scores = [plain, scoreWith(), ref, moved];
    for (const a of scores) for (const b of scores) roundTrip(a, b);
  });

  test("patchEdits reproduces the target or declines", () => {
    const a = validatePatch(SIMPLE);
    const b = validatePatch({ ...SIMPLE, voices: 3 });
    expect(patchEdits(a, b)).toBeUndefined();
    const c = validatePatch({
      ...SIMPLE,
      macros: [...SIMPLE.macros].reverse(),
    });
    let work = a;
    for (const edit of patchEdits(a, c)!) work = applyPatchEdit(work, edit);
    expect(work).toEqual(c);
  });
});

describe("ids", () => {
  test("new node and cable ids are valid, distinct and typed", () => {
    const a = newNodeId("fx.reverb");
    const b = newNodeId("fx.reverb");
    expect(a).not.toBe(b);
    expect(a.startsWith("reverb-")).toBe(true);
    expect(newCableId().startsWith("c-")).toBe(true);
    const patch = validatePatch({
      ...SIMPLE,
      nodes: [...SIMPLE.nodes, { id: a, type: "const" }],
      cables: [
        ...SIMPLE.cables,
        { id: newCableId(), from: `${a}.out`, to: "osc1.detune" },
      ],
    });
    expect(patch.nodes).toHaveLength(4);
  });
});

test("PATCH_LIMITS and SCORE_LIMITS agree", async () => {
  const { SCORE_LIMITS } = await import("./score.ts");
  const { PATCH_LIMITS } = await import("./patch.ts");
  expect([
    SCORE_LIMITS.maxPatchNodes,
    SCORE_LIMITS.maxPatchCables,
    SCORE_LIMITS.maxPatchMacros,
    SCORE_LIMITS.maxPatches,
    SCORE_LIMITS.maxPatchDepth,
  ]).toEqual([
    PATCH_LIMITS.maxNodes,
    PATCH_LIMITS.maxCables,
    PATCH_LIMITS.maxMacros,
    PATCH_LIMITS.maxPatches,
    PATCH_LIMITS.maxDepth,
  ]);
});
