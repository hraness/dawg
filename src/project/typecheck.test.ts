import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore } from "../../core/score.ts";
import { printProject } from "../../core/sdk/print.ts";
import { scriptedRunner } from "../auth/runner.ts";
import { initProject, writeAtomic } from "./init.ts";
import { parseTscOutput, resolveTsc, typecheckProject } from "./typecheck.ts";

let dir = "";

/** The e2e project: drums, bass and keys with a few notes each. */
const score = createScore({
  tracks: [
    { id: "drums", name: "drums", instrument: "kit" },
    { id: "bass", name: "bass", instrument: "bass" },
    { id: "keys", name: "keys", instrument: "piano" },
  ],
  notes: [
    ...[0, 480, 960, 1440].map((tick, i) => ({
      id: `k${i}`,
      trackId: "drums",
      startTick: tick,
      durationTicks: 120,
      pitch: 36,
      velocity: 0.8,
    })),
    {
      id: "b1",
      trackId: "bass",
      startTick: 0,
      durationTicks: 480,
      pitch: 36,
      velocity: 0.8,
    },
    {
      id: "b2",
      trackId: "bass",
      startTick: 960,
      durationTicks: 480,
      pitch: 43,
      velocity: 0.8,
    },
    {
      id: "p1",
      trackId: "keys",
      startTick: 0,
      durationTicks: 960,
      pitch: 64,
      velocity: 0.8,
    },
  ],
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dawg-types-"));
  await initProject(dir);
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("typecheckProject", () => {
  test("resolves the native compiler from the typescript dependency", () => {
    expect(resolveTsc()).toMatch(/typescript-.*\/lib\/tsc$/);
  });

  test("a printed project typechecks; warm checks stay fast", async () => {
    const cold = await typecheckProject(dir);
    expect(cold.diagnostics).toEqual([]);
    expect(cold.ok).toBe(true);
    const warm: number[] = [];
    for (let i = 0; i < 3; i += 1) warm.push((await typecheckProject(dir)).ms);
    console.log(`typecheck: cold ${cold.ms} ms, warm ${warm.join("/")} ms`);
    // Spec target is < 500 ms; the bound is generous for loaded CI machines.
    expect(Math.min(...warm)).toBeLessThan(1_500);
  });

  test("reports type errors as project-relative file:line:col", async () => {
    await writeAtomic(
      join(dir, "tracks/keys/track.ts"),
      `import { track, note } from "dawg";\n\nexport default track({\n  name: "keys",\n  notes: [note("E4", "zero")],\n});\n`,
    );
    try {
      const result = await typecheckProject(dir);
      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBe(1);
      expect(result.diagnostics[0]).toMatchObject({
        file: "tracks/keys/track.ts",
        line: 5,
        col: 22,
      });
      expect(result.diagnostics[0]?.message).toContain("TS2345");
    } finally {
      await writeAtomic(
        join(dir, "tracks/keys/track.ts"),
        printProject(score).files.find(
          (f) => f.path === "tracks/keys/track.ts",
        )!.text,
      );
    }
  });

  test("a missing compiler and a timeout are diagnostics, not throws", async () => {
    const killed = await typecheckProject(dir, {
      tsc: "/bin/tsc",
      runner: scriptedRunner([
        {
          match: (command) => command === "/bin/tsc",
          result: { code: 1, killed: true },
        },
      ]),
    });
    expect(killed.ok).toBe(false);
    expect(killed.diagnostics[0]?.message).toContain("timed out");
  });

  test("parseTscOutput handles file and bare diagnostics", () => {
    const out = parseTscOutput(
      `/p/song.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\nerror TS5083: Cannot read file '/p/tsconfig.json'.\nnoise\n`,
      "/p",
    );
    expect(out).toEqual([
      {
        file: "song.ts",
        line: 3,
        col: 5,
        message: "Type 'string' is not assignable to type 'number'. (TS2322)",
      },
      { message: "Cannot read file '/p/tsconfig.json'. (TS5083)" },
    ]);
  });
});
