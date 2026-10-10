import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { decodeLoopDocument } from "../loop.ts";
import { evaluateProject } from "./eval.ts";
import { printProject } from "./print.ts";
import {
  fxPatch,
  pat,
  patch,
  saw,
  seq,
  sine,
  song,
  track,
  type PatchSpec,
} from "./v1.ts";

/** The §5.2 acid example (distort's knob is `drive` in NODE_SPECS). */
function acid(): PatchSpec {
  return patch("acid-bass", ({ voice, osc, svf, adsr, vca, fx, macro }) => {
    const cutoff = macro("cutoff", {
      min: 80,
      max: 4000,
      default: 600,
      curve: "exp",
    });
    const reso = macro("reso", { min: 0, max: 1, default: 0.7 });
    const env = adsr({
      attack: 0.002,
      decay: 0.18,
      sustain: 0,
      release: 0.05,
    }).gate(voice.gate);
    const amp = adsr({
      attack: 0.001,
      decay: 0.3,
      sustain: 0.6,
      release: 0.08,
    }).gate(voice.gate);
    const tone = osc({ wave: "saw" }).pitch(voice.pitch);
    return tone
      .to(
        svf({ mode: "lp" })
          .cutoff(cutoff.plus(env.times(2400)))
          .q(reso),
      )
      .to(vca().gain(amp.times(voice.velocity)))
      .to(fx.distort({ drive: 0.25 }).global());
  });
}

const wideCrush = () =>
  fxPatch("wide-crush", ({ input, fx, lfo }) =>
    input.to(fx.crush({ bits: 6 }).bits(lfo({ rate: 0.25 }).range(4, 12))),
  );

/** `type` of the node a port belongs to (boundaries name themselves). */
function typeOf(p: PatchSpec, port: string): string {
  const id = port.slice(0, port.lastIndexOf("."));
  const name = port.slice(port.lastIndexOf(".") + 1);
  const node = p.nodes.find((n) => n.id === id);
  return `${node ? node.type : id}.${name}`;
}

describe("patch(name, build)", () => {
  test("the acid example builds the expected plain data", () => {
    const p = acid();
    expect(p.kind).toBe("patch");
    expect(p.role).toBe("instrument");
    expect(p.name).toBe("acid-bass");
    expect(p.nodes.map((n) => n.type).sort()).toEqual(
      ["adsr", "adsr", "osc", "svf", "mul", "add", "vca", "mul", "fx.distort"]
        .slice()
        .sort(),
    );
    const byType = (type: string) => p.nodes.filter((n) => n.type === type);
    expect(byType("osc")[0]!.params).toEqual({ wave: "saw" });
    expect(byType("svf")[0]!.params).toEqual({ mode: "lp" });
    expect(byType("fx.distort")[0]).toMatchObject({
      params: { drive: 0.25 },
      rate: "global",
    });
    expect(byType("adsr").map((n) => n.params)).toContainEqual({
      attack: 0.002,
      decay: 0.18,
      sustain: 0,
      release: 0.05,
    });
    // `env.times(2400)` folds the constant into the mul node's param.
    expect(byType("mul").map((n) => n.params ?? {})).toContainEqual({
      b: 2400,
    });
    const edges = p.cables
      .map((c) => `${typeOf(p, c.from)} -> ${typeOf(p, c.to)}`)
      .sort();
    expect(edges).toEqual(
      [
        "voice.gate -> adsr.gate",
        "voice.gate -> adsr.gate",
        "voice.pitch -> osc.pitch",
        "osc.out -> svf.in",
        "adsr.out -> mul.a",
        "adsr.out -> mul.a",
        "mul.out -> add.b",
        "add.out -> svf.cutoff",
        "voice.velocity -> mul.b",
        "mul.out -> vca.gain",
        "svf.out -> vca.in",
        "vca.out -> fx.distort.in",
        "fx.distort.out -> out.audio",
        "fx.distort.out -> out.right",
      ].sort(),
    );
    expect(
      p.macros.map(({ id, min, max, default: d, curve, to }) => ({
        id,
        min,
        max,
        d,
        curve,
        to: to.map((t) => typeOf(p, t.port)),
      })),
    ).toEqual([
      {
        id: "cutoff",
        min: 80,
        max: 4000,
        d: 600,
        curve: "exp",
        to: ["add.a"],
      },
      {
        id: "reso",
        min: 0,
        max: 1,
        d: 0.7,
        curve: undefined,
        to: ["svf.q"],
      },
    ]);
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.nodes[0])).toBe(true);
  });

  test("auto ids are stable and shaped like newId()", () => {
    const a = acid();
    const b = acid();
    expect(a).toEqual(b);
    for (const node of a.nodes) expect(node.id).toMatch(/^[a-z]+-[a-z2-7]{8}$/);
    for (const cable of a.cables) expect(cable.id).toMatch(/^c-[a-z2-7]{8}$/);
    expect(new Set(a.nodes.map((n) => n.id)).size).toBe(a.nodes.length);
    // A pinned id is kept as given.
    const pinned = patch("pin", ({ voice, osc }) =>
      osc({ id: "tone" }).pitch(voice.pitch),
    );
    expect(pinned.nodes[0]!.id).toBe("tone");
  });

  test("fxPatch builds an effect patch from the track's audio", () => {
    const p = wideCrush();
    expect(p.role).toBe("effect");
    expect(p.nodes.map((n) => n.type).sort()).toEqual([
      "fx.crush",
      "lfo",
      "scale",
    ]);
    expect(p.cables.map((c) => typeOf(p, c.from)).sort()).toContain("in.audio");
  });

  test("the plain-data overload accepts the stored shape", () => {
    const built = acid();
    const plain = patch({
      name: built.name,
      nodes: built.nodes,
      cables: built.cables,
      macros: built.macros,
    });
    expect(plain).toEqual(built);
    expect(patch({ ref: "acid-bass", macros: { cutoff: 900 } })).toEqual({
      kind: "patch",
      ref: "acid-bass",
      macros: { cutoff: 900 },
    });
  });

  test("bad wiring throws a plain-language error", () => {
    expect(() =>
      patch("bad", ({ osc }) => (osc() as never as { to: () => never }).to()),
    ).toThrow();
    expect(() => track({ name: "t", instrument: wideCrush() })).toThrow(
      /effect patch/,
    );
    expect(() =>
      track({ name: "t", fx: { patch: [acid()] } as never }),
    ).toThrow(/fx.patch takes effect patches/);
  });
});

describe("patches in songs", () => {
  test("mods and node signals bake into patch lanes; lanes: into fx lanes", () => {
    const s = song({
      bars: 2,
      tracks: [
        track({
          name: "acid",
          instrument: acid(),
          mods: {
            cutoff: sine.range(300, 2400).slow(4),
            reso: pat("0.5 0.8 0.6 0.9"),
          },
          lanes: { "synth-lpf": saw.range(400, 3000) },
          notes: seq("A1 A1 C2 A1 G1 A1 E2 D2", { step: 0.25 }),
        }),
      ],
    });
    const t = s.tracks[0]!;
    expect(t.instrument).toBe("patch");
    const lanes = (t as { fxAutomation?: Record<string, unknown[]> })
      .fxAutomation!;
    expect(Object.keys(lanes).sort()).toEqual([
      "patch-cutoff",
      "patch-reso",
      "synth-lpf",
    ]);
    // pat("0.5 0.8 0.6 0.9") steps a quarter bar at a time, as knob positions.
    expect(lanes["patch-reso"]!.slice(0, 3)).toEqual([
      { tick: 0, value: 0.5 },
      { tick: 479, value: 0.5 },
      { tick: 480, value: 0.8 },
    ]);
    // Written automation wins over a signal on the same lane.
    const w = song({
      tracks: [
        track({
          name: "acid",
          instrument: acid(),
          mods: { cutoff: sine },
          automation: { fx: { "patch-cutoff": [[0, 0.25]] } },
        }),
      ],
    });
    expect(
      (w.tracks[0] as { fxAutomation?: Record<string, unknown> }).fxAutomation![
        "patch-cutoff"
      ],
    ).toEqual([{ tick: 0, value: 0.25 }]);
    expect(() =>
      song({
        tracks: [
          track({ name: "a", instrument: acid(), mods: { nope: sine } }),
        ],
      }),
    ).toThrow(/mods.nope names no macro/);
  });

  test("song({ patches }) is a library tracks play by name", () => {
    const s = song({
      patches: [acid(), wideCrush()],
      tracks: [
        track({
          name: "lib",
          instrument: patch({ ref: "acid-bass", macros: { cutoff: 900 } }),
        }),
      ],
    });
    expect(Object.keys(s.patches!)).toEqual(["acid-bass", "wide-crush"]);
    const score = decodeLoopDocument(JSON.parse(JSON.stringify(s)));
    expect(Object.keys(score.patches)).toEqual(["acid-bass", "wide-crush"]);
    expect(score.tracks[0]!.patch).toEqual({
      kind: "patch",
      ref: "acid-bass",
      macros: { cutoff: 900 },
    });
    expect(() =>
      song({
        tracks: [track({ name: "x", instrument: patch({ ref: "gone" }) })],
      }),
    ).toThrow(/no patch "gone"/);
  });

  test("the plain form round-trips through print and eval byte-for-byte", async () => {
    const built = song({
      tempo: 120,
      bars: 2,
      patches: [acid(), wideCrush()],
      tracks: [
        track({
          name: "acid",
          instrument: acid(),
          fx: { chorus: {}, patch: [wideCrush()] },
          mods: { cutoff: sine.range(300, 2400).slow(4) },
          notes: seq("A1 C2", { step: 0.5 }),
        }),
        track({
          name: "lib",
          instrument: patch({ ref: "acid-bass", macros: { cutoff: 900 } }),
        }),
        track({
          name: "keys",
          instrument: "piano",
          fx: { patch: [wideCrush()] },
        }),
      ],
    });
    const score = decodeLoopDocument(JSON.parse(JSON.stringify(built)));
    const printed = printProject(score).files;
    const acidFile = printed.find((f) => f.path === "tracks/acid/track.ts")!;
    expect(acidFile.text).toContain(
      'import { track, note, patch, fxPatch } from "dawg";',
    );
    expect(acidFile.text).toContain("instrument: patch({\n");
    expect(acidFile.text).toContain('"patch-cutoff": [');
    expect(printed[0]!.text).toContain("patches: [\n    patch({");
    for (const file of printed)
      expect(await prettier.format(file.text, { parser: "typescript" })).toBe(
        file.text,
      );
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-patch-"));
    try {
      await initProject(dir);
      for (const file of printed)
        await writeAtomic(join(dir, file.path), file.text);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      expect(evaluated.score.tracks).toEqual(score.tracks);
      expect(evaluated.score.patches).toEqual(score.patches);
      expect(printProject(evaluated.score).files).toEqual(printed);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
