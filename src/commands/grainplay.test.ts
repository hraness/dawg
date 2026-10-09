import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffScores } from "../../core/diff.ts";
import { createScore, type TrackScore } from "../../core/score.ts";
import { evaluateProject } from "../../core/sdk/eval.ts";
import { printProject, printTrack } from "../../core/sdk/print.ts";
import { initProject, writeAtomic } from "../project/init.ts";
import { findAgentTool } from "../agent/tools.ts";
import { applyGranularCommand, parseGranularCommand } from "./granular.ts";
import { applyMusicCommand, parseMusicCommand } from "./music.ts";

const base = () =>
  createScore({ bars: 2, tracks: [{ id: "pad", instrument: "bell" }] });
const grain = (text: string, score: TrackScore) => {
  const command = parseGranularCommand(text);
  if (!command) throw new Error(`did not parse: ${text}`);
  const result = applyGranularCommand(score, "pad", command);
  if (!result.ok || !result.next) throw new Error(result.message);
  return result.next;
};
const music = (text: string, score: TrackScore) => {
  const command = parseMusicCommand(text);
  if (!command) throw new Error(`did not parse: ${text}`);
  const result = applyMusicCommand(score, "pad", command, (i) => `n${i}`);
  if (!result.ok || !result.next) throw new Error(result.message);
  return result.next;
};

async function writeProject(dir: string, score: TrackScore): Promise<void> {
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
}

describe("grainplay four ways", () => {
  test("grain sync/quant/mono/pedal commands store the params", () => {
    let score = grain("grain cloud", base());
    for (const text of [
      "grain sync 1/16",
      "grain quant scale",
      "grain mono on",
      "grain pedal on",
    ])
      score = grain(text, score);
    const g = score.tracks[0]!.granular!;
    expect(g.sync).toBe("1/16");
    expect(g.quant).toBe("scale");
    expect(g.mono).toBe(true);
    expect(g.pedal).toBe(true);
    expect(() => grain("grain sync 1/5", score)).toThrow();
  });

  test("set_granular stores the same object as the commands", () => {
    const viaCommand = grain(
      "grain sync 1/8t",
      grain("grain quant chord", grain("grain cloud", base())),
    ).tracks[0]!.granular;
    const tool = findAgentTool("set_granular")!;
    const plan = tool.plan(
      { preset: "cloud", params: { quant: "chord", sync: "1/8t" } },
      {
        score: base(),
        focusedTrackId: "pad",
        revision: 1,
        newNoteId: () => "n",
      } as never,
    );
    if (plan.kind !== "score") throw new Error("expected a score plan");
    expect(
      (plan.operations[0] as { patch: { granular: unknown } }).patch.granular,
    ).toEqual(viaCommand);
  });

  test("grain-pos lane automates and survives print -> eval", async () => {
    let score = grain("grain cloud", base());
    score = grain("grain sync 1/16", score);
    score = grain("grain mono on", score);
    score = music("automate grain-pos at 0 0.1", score);
    score = music("automate grain-pos at 4 0.9", score);
    const track = score.tracks[0]!;
    expect(track.fxAutomation?.["grain-pos"]?.length).toBe(2);
    const printed = printTrack(score, track);
    expect(printed).toContain('sync: "1/16"');
    expect(printed).toContain("grain-pos");
    const dir = await mkdtemp(join(tmpdir(), "dawg-grainplay-"));
    try {
      await initProject(dir);
      await writeProject(dir, score);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      expect(diffScores(score, evaluated.score)).toEqual([]);
      expect(printProject(evaluated.score).files).toEqual(
        printProject(score).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
