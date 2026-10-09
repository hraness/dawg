/**
 * The largest score `SCORE_LIMITS` allows survives print → evaluate → parse,
 * and an output overflow is reported as such, never as a timeout.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { applyFiles } from "../../src/project/sync.ts";
import {
  AUTOMATION_LANES,
  AUTOMATION_PARAMETERS,
  automationRange,
  createScore,
  SCORE_LIMITS,
  type TrackScore,
} from "../score.ts";
import { evaluateProject, type EvalSpawn } from "./eval.ts";
import { printProject } from "./print.ts";

/** Seeded PRNG (mulberry32). */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every track and note slot filled, `lanes` automation lanes full per track. */
function maximal(seed: number, lanes: readonly string[]): TrackScore {
  const random = rng(seed);
  const tracks = Array.from({ length: SCORE_LIMITS.maxTracks }, (_, i) => ({
    id: `t${i}`,
    name: `track ${i}`,
    instrument: "sine",
  }));
  const notes = Array.from({ length: SCORE_LIMITS.maxNotes }, (_, i) => ({
    id: `n${i}`,
    trackId: `t${i % SCORE_LIMITS.maxTracks}`,
    startTick: Math.floor(random() * 480 * 64),
    durationTicks: 1 + Math.floor(random() * 960),
    pitch: 24 + Math.floor(random() * 72),
    velocity: Math.round(random() * 1000) / 1000 || 0.5,
  }));
  const lane = (parameter: string) => {
    const { min, max } = automationRange(parameter as never);
    return Array.from({ length: SCORE_LIMITS.maxAutomationPoints }, (_, i) => ({
      tick: i * 120,
      value: Math.round((min + (max - min) * random()) * 1e4) / 1e4,
    }));
  };
  const trackLanes = Object.keys(
    AUTOMATION_LANES,
  ) as (keyof typeof AUTOMATION_LANES)[];
  return createScore({
    tracks: tracks.map((track) => {
      const out: Record<string, unknown> = { ...track };
      for (const name of lanes)
        if ((trackLanes as string[]).includes(name))
          out[AUTOMATION_LANES[name as keyof typeof AUTOMATION_LANES].field] =
            lane(name);
      const fx = lanes.filter(
        (name) => !(trackLanes as string[]).includes(name),
      );
      if (fx.length > 0)
        out.fxAutomation = Object.fromEntries(
          fx.map((name) => [name, lane(name)]),
        );
      return out as never;
    }),
    notes,
  });
}

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dawg-eval-limits-"));
  await initProject(dir);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function roundTrip(score: TrackScore) {
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
  const result = await evaluateProject(dir, { timeoutMs: 60_000 });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  // Evaluation names notes by content; adopting the session ids leaves
  // nothing to apply when the files say exactly what the score says.
  const ops = applyFiles(score, result.score).operations;
  expect(ops).toEqual([]);
}

describe("negative zero", () => {
  test("-0 and 0 are the same score value", () => {
    const pan = (value: number) =>
      createScore({
        tracks: [
          {
            id: "a",
            name: "a",
            instrument: "sine",
            panAutomation: [{ tick: 0, value }],
          },
        ],
      });
    expect(applyFiles(pan(-0), pan(0)).operations).toEqual([]);
    expect(applyFiles(pan(0), pan(-0)).operations).toEqual([]);
    expect(applyFiles(pan(0), pan(0.5)).operations.length).toBe(1);
  });
});

describe("evaluation output bound", () => {
  test("a score over 1 MiB of JSON (volume and pan full) round-trips", async () => {
    const score = maximal(1, ["volume", "pan"]);
    expect(JSON.stringify(score.toJSON()).length).toBeGreaterThan(1024 * 1024);
    await roundTrip(score);
  }, 90_000);

  test("every track automation lane full on every track still round-trips", async () => {
    // The session store keeps records under 4 MiB, so this is the largest
    // score a session can hold, with a few fx lanes on top.
    const fxLanes = AUTOMATION_PARAMETERS.filter(
      (lane) => !(lane in AUTOMATION_LANES),
    ).slice(0, 2);
    const score = maximal(2, [...Object.keys(AUTOMATION_LANES), ...fxLanes]);
    expect(JSON.stringify(score.toJSON()).length).toBeGreaterThan(
      2 * 1024 * 1024,
    );
    await roundTrip(score);
  }, 120_000);

  test("an output overflow is reported as output, not as a timeout", async () => {
    const spawn: EvalSpawn = async () => ({
      code: 143,
      stdout: "",
      stderr: "",
      killed: true,
      reason: "output",
    });
    const result = await evaluateProject(dir, { spawn });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]!.message).toMatch(/printed more than/);
    expect(result.diagnostics[0]!.message).not.toMatch(/timed out/);
  });
});
