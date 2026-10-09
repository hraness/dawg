import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { melody, synthVoice } from "./fixtures/voice.ts";
import {
  analysisCounters,
  analysisFileName,
  clearAnalysisMemory,
  decodeCurve,
  encodeCurve,
  pitchCurve,
  pruneAnalysisCache,
} from "./analysis.ts";

const dirs: string[] = [];
async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dawg-analysis-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  clearAnalysisMemory();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true });
});

const voice = synthVoice(melody(57).slice(0, 4), { sr: 22_050, seed: 5 });
const source = {
  sha256: "a".repeat(64),
  sampleRate: voice.sr,
  mono: Float32Array.from(voice.x),
};
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("pitchCurve cache", () => {
  test("cold, warm-memory and warm-disk curves are byte-identical", async () => {
    const projectRoot = await temp();
    const before = analysisCounters();
    const cold = encodeCurve(await pitchCurve(source, { projectRoot }));
    const memory = encodeCurve(await pitchCurve(source, { projectRoot }));
    clearAnalysisMemory();
    const disk = encodeCurve(await pitchCurve(source, { projectRoot }));
    const after = analysisCounters();
    expect(after.tracks - before.tracks).toBe(1);
    expect(after.memoryHits - before.memoryHits).toBe(1);
    expect(after.diskHits - before.diskHits).toBe(1);
    expect(hash(memory)).toBe(hash(cold));
    expect(hash(disk)).toBe(hash(cold));
    // deleting the cache re-tracks to the same bytes
    clearAnalysisMemory();
    await rm(join(projectRoot, ".dawg"), { recursive: true });
    expect(hash(encodeCurve(await pitchCurve(source, { projectRoot })))).toBe(
      hash(cold),
    );
  });

  test("the file round-trips and lives under .dawg/analysis", async () => {
    const projectRoot = await temp();
    const curve = await pitchCurve(source, { projectRoot });
    const name = analysisFileName(source.sha256, "auto");
    expect(name).toMatch(/^a{64}\.auto\.v\d+\.f0$/);
    const bytes = new Uint8Array(
      await readFile(join(projectRoot, ".dawg", "analysis", name)),
    );
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("DWF0");
    const back = decodeCurve(bytes)!;
    expect(back.t0).toBe(curve.t0);
    expect(back.hop).toBe(curve.hop);
    expect([...back.f0]).toEqual([...curve.f0]);
    expect([...back.prob]).toEqual([...curve.prob]);
    expect(await readdir(join(projectRoot, ".dawg", "analysis"))).toEqual([
      name,
    ]);
  });

  test("a truncated or bit-flipped file is a miss and is re-tracked", async () => {
    const projectRoot = await temp();
    const good = encodeCurve(await pitchCurve(source, { projectRoot }));
    const path = join(
      projectRoot,
      ".dawg",
      "analysis",
      analysisFileName(source.sha256, "auto"),
    );
    expect(decodeCurve(good.subarray(0, good.length - 1))).toBeUndefined();
    for (const at of [2, 5, 40, good.length - 3]) {
      const bad = Uint8Array.from(good);
      bad[at]! ^= 0x10;
      expect(decodeCurve(bad)).toBeUndefined();
    }
    await writeFile(path, good.subarray(0, 100));
    clearAnalysisMemory();
    const before = analysisCounters().tracks;
    const again = encodeCurve(await pitchCurve(source, { projectRoot }));
    expect(analysisCounters().tracks - before).toBe(1);
    expect(hash(again)).toBe(hash(good));
    expect(hash(new Uint8Array(await readFile(path)))).toBe(hash(good));
  });

  test("concurrent writers leave one valid file and no temporaries", async () => {
    const projectRoot = await temp();
    const curves = await Promise.all(
      [0, 1, 2, 3].map(async () => {
        clearAnalysisMemory();
        return encodeCurve(await pitchCurve(source, { projectRoot }));
      }),
    );
    for (const c of curves) expect(hash(c)).toBe(hash(curves[0]!));
    const files = await readdir(join(projectRoot, ".dawg", "analysis"));
    expect(files.length).toBe(1);
    expect(files[0]!.endsWith(".f0")).toBe(true);
  });

  test("voices are cached apart", async () => {
    const projectRoot = await temp();
    await pitchCurve(source, { projectRoot });
    await pitchCurve(source, { projectRoot, voice: "bass" });
    expect(
      (await readdir(join(projectRoot, ".dawg", "analysis"))).sort(),
    ).toEqual(
      [
        analysisFileName(source.sha256, "auto"),
        analysisFileName(source.sha256, "bass"),
      ].sort(),
    );
  });

  test("pruning keeps the protected curves", async () => {
    const dir = await temp();
    const other = { ...source, sha256: "b".repeat(64) };
    await pitchCurve(source, { dir });
    await pitchCurve(other, { dir });
    const removed = await pruneAnalysisCache(dir, 0, new Set(["b".repeat(64)]));
    expect(removed.removed).toBe(1);
    expect(await readdir(dir)).toEqual([
      analysisFileName(other.sha256, "auto"),
    ]);
  });
});
