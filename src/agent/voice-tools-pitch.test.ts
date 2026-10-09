import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyScoreOperation, createScore } from "../../core/score.ts";
import { melody, synthVoice } from "../audio/fixtures/voice.ts";
import { wavBytes } from "../audio/sample-fixtures.ts";
import { AGENT_TOOLS, type ToolContext } from "./tools.ts";
import { PITCH_TOOLS } from "./voice-tools.ts";

let root = "";
let sha = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dawg-pitch-tools-"));
  const v = synthVoice(melody(57), { sr: 48_000, seed: 9 });
  const bytes = wavBytes(
    Float32Array.from(v.x, (x) => x * 0.7),
    {
      sampleRate: 48_000,
      encoding: "float32",
    },
  );
  sha = createHash("sha256").update(bytes).digest("hex");
  await mkdir(join(root, "tracks", "vox", "samples"), { recursive: true });
  await writeFile(join(root, "tracks", "vox", "samples", "take.wav"), bytes);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function context(): ToolContext {
  return {
    score: createScore({
      bars: 8,
      tracks: [
        {
          id: "vox",
          instrument: "sine",
          clips: [
            {
              id: "take",
              src: "tracks/vox/samples/take.wav",
              sha256: sha,
              startTick: 0,
            },
          ],
        },
      ],
    } as never),
    focusedTrackId: "vox",
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

const tool = (name: string) => PITCH_TOOLS.find((t) => t.name === name)!;

describe("pitch agent tools", () => {
  test("are registered with the agent", () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(names).toContain("analyze_pitch");
    expect(names).toContain("pitch_to_notes");
  });

  test("analyze_pitch reports the key and sung notes read-only", async () => {
    const plan = tool("analyze_pitch").plan({}, context());
    if (plan.kind !== "action") throw new Error("analyze_pitch is an action");
    const result = await plan.run({ workspace: { root } });
    expect(result.mutated).toBeUndefined();
    expect(result.content).toContain("key · a major");
    expect(result.content).toContain("notes (file seconds):");
    // the first sung note is A3 35 cents sharp; the tracker reports it
    expect(result.content).toMatch(/0\.2\d-0\.\d\d A3 \+3\dc/);
    expect(result.summary).toStartWith("vox · a major");
  });

  test("bad arguments are refused before any work", () => {
    expect(() =>
      tool("analyze_pitch").plan({ voice: "kazoo" }, context()),
    ).toThrow("voice is one of");
    expect(() =>
      tool("pitch_to_notes").plan({ as: "../x" }, context()),
    ).toThrow("as must be a track id");
  });

  test("pitch_to_notes adds a guide track as score operations", async () => {
    const ctx = context();
    const plan = tool("pitch_to_notes").plan({ as: "guide" }, ctx);
    if (plan.kind !== "prepare") throw new Error("pitch_to_notes prepares");
    const scored = await plan.run({ workspace: { root } });
    expect(scored.trackId).toBe("guide");
    expect(scored.operations[0]!.type).toBe("addTrack");
    let score = ctx.score;
    for (const op of scored.operations) score = applyScoreOperation(score, op);
    const pitches = score.notes.map((n) => n.pitch);
    expect(pitches.slice(0, 4)).toEqual([57, 59, 61, 64]);
  });

  test("a track without audio gets a clear error", async () => {
    const ctx = { ...context(), focusedTrackId: "none" };
    const plan = tool("analyze_pitch").plan({}, ctx);
    if (plan.kind !== "action") throw new Error("action");
    await expect(plan.run({ workspace: { root } })).rejects.toThrow(
      "no track none",
    );
  });
});
