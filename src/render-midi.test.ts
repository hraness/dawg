import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeLoop } from "../core/loop.ts";
import { createScore } from "../core/score.ts";
import { runRenderCommand } from "./render.ts";

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

test("dawg render out.mid writes a Standard MIDI File with the tempo map", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dawg-midi-"));
  dirs.push(dir);
  const score = createScore({
    tempoBpm: 90,
    bars: 2,
    time: { tempo: [{ tick: 1920, bpm: 120 }] },
    tracks: [{ id: "p", name: "piano", instrument: "piano" }],
    notes: [
      {
        id: "a",
        trackId: "p",
        startTick: 0,
        durationTicks: 480,
        pitch: 60,
        velocity: 0.8,
      },
    ],
  });
  await writeFile(join(dir, "in.track.json"), encodeLoop(score), "utf8");
  let out = "";
  let err = "";
  const code = await runRenderCommand(
    ["render", "out.mid", "--import", "in.track.json"],
    dir,
    { write: (text: string) => (out += text) },
    { write: (text: string) => (err += text) },
  );
  expect(err).toBe("");
  expect(code).toBe(0);
  expect(out).toMatch(/^rendered · out\.mid · \d+ bytes · [0-9a-f]{64}\n$/);
  const bytes = await readFile(join(dir, "out.mid"));
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("MThd");
  // Two tempo meta events: 90 then 120 bpm.
  const hex = bytes.toString("hex");
  expect(hex).toContain("ff51030a2c2b");
  expect(hex).toContain("ff510307a120");
});
