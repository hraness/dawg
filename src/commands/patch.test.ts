import { describe, expect, test } from "bun:test";
import { diffScores } from "../../core/diff.ts";
import { createScore, type TrackScore } from "../../core/score.ts";
import {
  applyPatchBatch,
  applyPatchCommand,
  isReadOnlyPatchCommand,
  parsePatchCommand,
  patchCommandError,
  PATCH_VERBS,
} from "./patch.ts";

const empty = () =>
  createScore({ bars: 1, tracks: [{ id: "lead", instrument: "saw" }] });

/** A score whose lead track plays a small osc → svf → out patch. */
function base(): TrackScore {
  const result = applyPatchBatch(empty(), "lead", [
    "patch new mine",
    "patch add osc as tone wave=saw",
    "patch add svf as vcf mode=lp cutoff=800",
    "patch wire voice.pitch tone.pitch",
    "patch wire tone.out vcf.in",
    "patch wire vcf.out out.audio",
  ]);
  expect(result.ok, result.message).toBe(true);
  return result.next!;
}

const run = (line: string, score = base()) =>
  applyPatchBatch(score, "lead", [line]);

describe("parse", () => {
  const forms: Record<string, unknown> = {
    "patch new pad": { type: "patch-new", name: "pad" },
    "patch new wob effect": { type: "patch-new", name: "wob", role: "effect" },
    "patch new acid instrument from acid-bass": {
      type: "patch-new",
      name: "acid",
      role: "instrument",
      from: "acid-bass",
    },
    "patch add svf as vcf mode=lp cutoff=800": {
      type: "patch-add",
      nodeType: "svf",
      id: "vcf",
      params: { mode: "lp", cutoff: 800 },
    },
    "patch add osc": { type: "patch-add", nodeType: "osc", params: {} },
    "patch set vcf q=0.6": { type: "patch-set", id: "vcf", params: { q: 0.6 } },
    "patch wire lfo1.out vcf.cutoff 0.4": {
      type: "patch-wire",
      from: "lfo1.out",
      to: "vcf.cutoff",
      amount: 0.4,
    },
    "patch wire tone.out vcf.in": {
      type: "patch-wire",
      from: "tone.out",
      to: "vcf.in",
    },
    "patch unwire tone.out vcf.in": {
      type: "patch-unwire",
      a: "tone.out",
      b: "vcf.in",
    },
    "patch knob cutoff 900": {
      type: "patch-knob",
      macro: "cutoff",
      value: 900,
    },
    "patch rate lfo global": { type: "patch-rate", id: "lfo", rate: "global" },
    "patch rm vcf": { type: "patch-rm", id: "vcf" },
    "patch convert": { type: "patch-convert" },
    "patch detach": { type: "patch-detach" },
    "patch load acid-bass": { type: "patch-load", source: "acid-bass" },
    "patch save mine": { type: "patch-save", name: "mine", scope: "project" },
    "patch save mine --user": {
      type: "patch-save",
      name: "mine",
      scope: "user",
    },
    "patch show": { type: "patch-show" },
    "patch nodes filter": { type: "patch-nodes", family: "filter" },
    "patch wire in.audio crush.in --fx wide": {
      type: "patch-wire",
      from: "in.audio",
      to: "crush.in",
      fx: "wide",
    },
  };
  for (const [line, expected] of Object.entries(forms))
    test(line, () => {
      expect(parsePatchCommand(line)).toMatchObject(expected as object);
    });

  test("macro with ranges and a label", () => {
    expect(
      parsePatchCommand(
        'patch macro bright vcf.cutoff:200..6000 drive.drive:0..0.4 label "Bright"',
      ),
    ).toMatchObject({
      type: "patch-macro",
      id: "bright",
      label: "Bright",
      targets: [
        { port: "vcf.cutoff", min: 200, max: 6000 },
        { port: "drive.drive", min: 0, max: 0.4 },
      ],
    });
  });

  test("every verb parses, and a bad verb names the verbs", () => {
    expect(PATCH_VERBS.length).toBeGreaterThan(10);
    expect(patchCommandError("patch frob")).toContain("new add set wire");
    expect(parsePatchCommand("patch frob")).toBeUndefined();
    expect(parsePatchCommand("patchy")).toBeUndefined();
    expect(patchCommandError("instrument saw")).toBeUndefined();
  });

  test("show and nodes are read-only", () => {
    expect(isReadOnlyPatchCommand("patch show")).toBe(true);
    expect(isReadOnlyPatchCommand("patch nodes")).toBe(true);
    expect(isReadOnlyPatchCommand("patch add osc")).toBe(false);
  });
});

describe("errors name the port and the nearest word", () => {
  test("a misspelled input", () => {
    const result = run("patch wire tone.out vcf.inn");
    expect(result.ok).toBe(false);
    expect(result.message).toContain('no input "inn" on vcf (svf)');
    expect(result.message).toContain("did you mean in?");
  });
  test("a misspelled param", () => {
    const result = run("patch set vcf cutof=100");
    expect(result.message).toContain('no param "cutof" on svf');
    expect(result.message).toContain("did you mean cutoff?");
  });
  test("a misspelled node type", () => {
    expect(run("patch add oscc").message).toContain("did you mean osc?");
  });
  test("an enum value lists the choices", () => {
    expect(run("patch set vcf mode=lpp").message).toContain(
      "lp, hp, bp, notch",
    );
  });
  test("an unknown macro", () => {
    expect(run("patch knob nope 1").message).toContain("no macro nope");
  });
});

describe("apply", () => {
  test("an edit travels as node and cable ops, never a whole-patch write", () => {
    const before = base();
    for (const line of [
      "patch add lfo as wob",
      "patch set vcf q=0.6",
      "patch wire tone.out out.right",
      "patch unwire tone.out vcf.in",
      "patch rate vcf global",
      "patch rm vcf",
      'patch macro cut vcf.cutoff range 80..4000 label "Cut"',
    ]) {
      const result = run(line, before);
      expect(result.ok, `${line}: ${result.message}`).toBe(true);
      const types = diffScores(before, result.next!).map((op) => op.type);
      expect(types.length, line).toBeGreaterThan(0);
      expect(types, line).not.toContain("setPatch");
    }
  });

  test("node IDs without `as` come from newId, not call order", () => {
    const a = run("patch add lfo").next!;
    const b = run("patch add lfo").next!;
    const id = (score: TrackScore) =>
      (
        score.tracks[0]!.patch as unknown as {
          nodes: { id: string; type: string }[];
        }
      ).nodes.find((node) => node.type === "lfo")!.id;
    expect(id(a)).toMatch(/^lfo-/);
    expect(id(a)).not.toBe(id(b));
  });

  test("the receipt names a change of rate", () => {
    const result = run("patch rate vcf global");
    expect(result.message).toContain("vcf runs once per track");
  });

  test("re-wiring with an amount sets the amount", () => {
    let score = run("patch add lfo as wob").next!;
    score = run("patch wire wob.out vcf.cutoff 0.5", score).next!;
    const again = run("patch wire wob.out vcf.cutoff 0.25", score);
    expect(again.ok).toBe(true);
    const types = diffScores(score, again.next!).map((op) => op.type);
    expect(types).toEqual(["setPatchCable"]);
  });

  test("a batch is atomic: one bad line applies nothing and is named", () => {
    const before = base();
    const result = applyPatchBatch(before, "lead", [
      "patch add lfo as wob",
      "patch wire wob.out vcf.cutof",
      "patch rm tone",
    ]);
    expect(result.ok).toBe(false);
    expect(result.next).toBeUndefined();
    expect(result.message).toContain("line 2");
    expect(result.message).toContain("nothing applied");
  });

  test("show and nodes read without a revision", () => {
    const show = applyPatchCommand(
      base(),
      "lead",
      parsePatchCommand("patch show")!,
    );
    expect(show.ok).toBe(true);
    expect(show.next).toBeUndefined();
    expect(show.message).toContain("patch wire tone.out vcf.in");
    const nodes = applyPatchCommand(
      base(),
      "lead",
      parsePatchCommand("patch nodes filter")!,
    );
    expect(nodes.message).toContain("svf");
  });

  test("an effect patch is edited with --fx", () => {
    let score = applyPatchBatch(empty(), "lead", [
      "patch new wide effect",
      "patch add fx.crush as crush --fx wide",
      "patch wire in.audio crush.in --fx wide",
      "patch wire crush.out out.audio --fx wide",
    ]);
    expect(score.ok, score.message).toBe(true);
    expect(score.next!.tracks[0]!.fxPatch?.length).toBe(1);
    const edit = run("patch set crush bits=4 --fx wide", score.next!);
    expect(edit.ok, edit.message).toBe(true);
    expect(diffScores(score.next!, edit.next!).map((op) => op.type)).toEqual([
      "setPatchNode",
    ]);
  });

  test("load, knob, save, load as a shared ref, detach", () => {
    let result = run("patch load acid-bass", empty());
    expect(result.ok, result.message).toBe(true);
    result = run("patch knob cutoff 900", result.next!);
    expect(result.ok, result.message).toBe(true);
    result = run("patch save mine", result.next!);
    expect(result.ok, result.message).toBe(true);
    result = run("patch load mine", result.next!);
    expect(result.ok, result.message).toBe(true);
    result = run("patch knob cutoff 1200", result.next!);
    expect(result.ok, result.message).toBe(true);
    const detached = run("patch detach", result.next!);
    expect(detached.ok, detached.message).toBe(true);
    const patch = detached.next!.tracks[0]!.patch as unknown as {
      nodes: unknown[];
      macros: { id: string; default: number }[];
    };
    expect(patch.nodes.length).toBeGreaterThan(3);
    expect(patch.macros.find((m) => m.id === "cutoff")!.default).toBe(1200);
  });

  test("convert turns the current instrument into a patch", () => {
    const result = run("patch convert", empty());
    expect(result.ok, result.message).toBe(true);
    expect(result.next!.tracks[0]!.instrument).toBe("patch");
  });

  test("save --user comes back as an effect for the window to write", () => {
    const result = run("patch save mine --user");
    expect(result.ok, result.message).toBe(true);
    expect(result.effects?.[0]).toMatchObject({
      kind: "save-user",
      name: "mine",
    });
  });
});

describe("receipts surface the compiler's dropped cables", () => {
  test("a post-voice node into a voice node", () => {
    const result = applyPatchBatch(empty(), "lead", [
      "patch new x",
      "patch add osc as tone",
      "patch add voicesum as sum",
      "patch add fx.distort as drive",
      "patch wire voice.pitch tone.pitch",
      "patch wire tone.out sum.in",
      "patch wire sum.out drive.in",
      "patch wire drive.out out.audio",
      "patch add osc as t2",
      "patch add svf as vcf",
      "patch wire voice.pitch t2.pitch",
      "patch wire t2.out vcf.in",
      "patch wire vcf.out out.right",
      "patch wire drive.out vcf.cutoff",
    ]);
    expect(result.ok, result.message).toBe(true);
    expect(result.message.split("\n").at(-1)).toContain(
      "⚠ drive.out → vcf.cutoff dropped: drive runs after the voices",
    );
  });

  // Without voice.pitch feeding the chain everything runs per track, so
  // the only reason to cut the cable is the loop itself.
  const globalChain = () =>
    applyPatchBatch(empty(), "lead", [
      "patch new x",
      "patch add osc as tone",
      "patch add svf as vcf",
      "patch add fx.distort as drive",
      "patch wire tone.out vcf.in",
      "patch wire vcf.out out.audio",
    ]).next!;

  test("a feedback loop through a buffer node", () => {
    const score = globalChain();
    const wired = applyPatchBatch(score, "lead", [
      "patch wire vcf.out drive.in",
      "patch wire drive.out vcf.cutoff",
    ]);
    expect(wired.ok).toBe(true);
    expect(wired.message).toContain(
      "dropped: a feedback loop through an engine or effect node is cut",
    );
  });

  test("a warning already present is not repeated", () => {
    const score = applyPatchBatch(globalChain(), "lead", [
      "patch wire vcf.out drive.in",
      "patch wire drive.out vcf.cutoff",
    ]).next!;
    expect(run("patch set vcf q=0.3", score).message).not.toContain("⚠");
  });
});
