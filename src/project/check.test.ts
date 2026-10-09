import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore } from "../../core/score.ts";
import { printProject } from "../../core/sdk/print.ts";
import { runCheckCommand } from "./check.ts";
import { initProject, writeAtomic } from "./init.ts";

function sink() {
  let text = "";
  return {
    stream: { write: (chunk: string) => (text += chunk) },
    read: () => text,
  };
}

describe("dawg check", () => {
  test("refuses outside a project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-check-"));
    try {
      const out = sink();
      const err = sink();
      expect(
        await runCheckCommand(["check"], dir, out.stream, err.stream),
      ).toBe(1);
      expect(err.read()).toContain("dawg init");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("passes a printed project and fails with file:line:col on errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-check-"));
    try {
      await initProject(dir);
      const score = createScore({
        tracks: [{ id: "bass", name: "bass", instrument: "bass" }],
        notes: [
          {
            id: "n",
            trackId: "bass",
            startTick: 0,
            durationTicks: 480,
            pitch: 36,
            velocity: 0.8,
          },
        ],
      });
      for (const file of printProject(score).files)
        await writeAtomic(join(dir, file.path), file.text);
      const out = sink();
      const err = sink();
      expect(
        await runCheckCommand(["check"], dir, out.stream, err.stream),
      ).toBe(0);
      expect(out.read()).toMatch(
        /^ok · 1 track, 1 note · types \d+ ms · eval \d+ ms\n$/,
      );
      expect(err.read()).toBe("");

      await writeAtomic(
        join(dir, "tracks/bass/track.ts"),
        `import { track, note } from "dawg";\n\nexport default track({\n  id: "bass",\n  name: "bass",\n  notes: [note("C2", "now"), note("H2", 0)],\n});\n`,
      );
      const out2 = sink();
      const err2 = sink();
      expect(
        await runCheckCommand(["check"], dir, out2.stream, err2.stream),
      ).toBe(1);
      const lines = err2.read().trim().split("\n");
      expect(lines[0]).toMatch(
        /^tracks\/bass\/track\.ts:6:\d+ Argument of type 'string'/,
      );
      expect(lines[1]).toMatch(
        /^tracks\/bass\/track\.ts:6:\d+ note start must be a finite number/,
      );
      expect(lines.at(-1)).toBe("2 problems");
      expect(out2.read()).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("warns, without failing, on legacy marimba and bare modal tracks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-check-"));
    try {
      await initProject(dir);
      const score = createScore({
        tracks: [
          { id: "old", name: "old", instrument: "marimba" },
          {
            id: "vib",
            name: "vib",
            instrument: "modal",
            modal: { preset: "vibes" },
          },
        ],
        notes: [],
      } as never);
      for (const file of printProject(score).files)
        await writeAtomic(join(dir, file.path), file.text);
      const out = sink();
      const err = sink();
      expect(
        await runCheckCommand(["check"], dir, out.stream, err.stream),
      ).toBe(0);
      expect(err.read()).toContain('warning: track old: instrument "marimba"');
      expect(err.read()).not.toContain("track vib");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
