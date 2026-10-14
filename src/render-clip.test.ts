import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeLoop } from "../core/loop.ts";
import { createScore } from "../core/score.ts";
import { clippedSamples, runRenderCommand } from "./render.ts";
import { AudioCompute } from "./audio/compute.ts";

describe("render clip warning", () => {
  test("counts samples on the 16-bit rails only", () => {
    expect(clippedSamples(new Int16Array([0, 100, -32_767, 32_766]))).toBe(0);
    expect(clippedSamples(new Int16Array([32_767, -32_768, 5, 32_767]))).toBe(
      3,
    );
  });
});

describe("render rate note", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });
  const run = async (args: string[], master: boolean, worker = false) => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-rate-"));
    dirs.push(dir);
    const score = createScore({
      bars: 1,
      ...(master ? { master: { limiter: {} } } : {}),
      tracks: [{ id: "p", name: "piano", instrument: "piano" }],
    });
    await writeFile(join(dir, "in.track.json"), encodeLoop(score), "utf8");
    let out = "";
    let err = "";
    const compute = worker ? new AudioCompute() : undefined;
    let code: number;
    try {
      code = await runRenderCommand(
        ["render", "out.wav", "--import", "in.track.json", ...args],
        dir,
        { write: (text: string) => ((out += text), true) },
        { write: (text: string) => ((err += text), true) },
        compute ? { compute, signal: new AbortController().signal } : undefined,
      );
    } finally {
      compute?.dispose();
    }
    expect(code).toBe(0);
    expect(err).toBe("");
    return out;
  };

  test("a plain song says it renders at 22050 Hz and how to get 48 kHz", async () => {
    expect(await run([], false)).toMatch(
      / · 22050 Hz \(--rate 48000 for full band\) · /,
    );
  });

  test("--measure reports loudness without sample attribution for inline and worker exports", async () => {
    for (const worker of [false, true]) {
      expect(
        await run(["--rate", "8000", "--measure"], false, worker),
      ).toContain("loudness · ");
      expect(await run(["--rate", "8000"], false, worker)).not.toContain(
        "loudness · ",
      );
    }
  });

  test("an explicit rate or a master shows the rate alone", async () => {
    expect(await run(["--rate", "48000"], false)).toMatch(/ · 48000 Hz · /);
    expect(await run([], true)).toMatch(/ · 48000 Hz · /);
  });
});
