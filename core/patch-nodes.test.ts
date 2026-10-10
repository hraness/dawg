import { describe, expect, test } from "bun:test";
import { FX_CHAIN } from "./fx.ts";
import {
  BOUNDARY_IDS,
  BOUNDARY_SPECS,
  NODE_SPECS,
  NODE_TYPES,
  nodeSpec,
  findPort,
} from "./patch-nodes.ts";

describe("NODE_SPECS", () => {
  test("every chain stage but the mix stages has an fx node", () => {
    // Pan and the mix stages (bus routing, duck) are the track's job.
    const missing = FX_CHAIN.filter((stage) => !nodeSpec(`fx.${stage}`));
    expect(missing).toEqual(["pan", "orbit", "duck"]);
    const fx = NODE_TYPES.filter((type) => type.startsWith("fx."));
    expect(fx.length).toBeGreaterThan(10);
    for (const type of fx)
      expect(FX_CHAIN as readonly string[]).toContain(type.slice(3));
  });

  test("every engine node binds an engine field or instrument", () => {
    const engines = NODE_TYPES.filter((type) => type.startsWith("engine."));
    expect(engines).toEqual([
      "engine.synth",
      "engine.modal",
      "engine.string",
      "engine.wind",
      "engine.sing",
      "engine.granular",
      "engine.keys",
      "engine.vocoder",
    ]);
    for (const type of engines) {
      const spec = NODE_SPECS[type]!;
      expect(spec.family).toBe("engine");
      expect(spec.rate).toBe("global");
      expect(
        spec.engine!.fields.length + spec.engine!.instruments.length,
      ).toBeGreaterThan(0);
      expect(spec.inputs[0]!.kind).toBe("notes");
    }
  });

  test("port names are unique per side, ids never shadow boundaries", () => {
    for (const spec of [
      ...Object.values(NODE_SPECS),
      ...Object.values(BOUNDARY_SPECS),
    ]) {
      const ins = spec.inputs.map((port) => port.name);
      const outs = spec.outputs.map((port) => port.name);
      expect(new Set(ins).size).toBe(ins.length);
      expect(new Set(outs).size).toBe(outs.length);
      expect(Number.isFinite(spec.cost)).toBe(true);
      expect(spec.doc.length).toBeGreaterThan(0);
    }
    for (const id of BOUNDARY_IDS) expect(NODE_TYPES).not.toContain(id);
  });

  test("number params sit inside their range", () => {
    for (const spec of Object.values(NODE_SPECS))
      for (const [name, param] of Object.entries(spec.params))
        if (param.kind === "number") {
          expect([
            spec.type,
            name,
            param.min <= param.default && param.default <= param.max,
          ]).toEqual([spec.type, name, true]);
        }
  });

  test("findPort looks up a side", () => {
    const osc = NODE_SPECS.osc!;
    expect(findPort(osc, "pitch", "in")?.kind).toBe("control");
    expect(findPort(osc, "out", "out")?.kind).toBe("audio");
    expect(findPort(osc, "out", "in")).toBeUndefined();
  });
});
