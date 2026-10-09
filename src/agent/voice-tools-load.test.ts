import { expect, test } from "bun:test";
import { join } from "node:path";

// Each entry point loaded first, in a fresh process: an import cycle back
// into tools.ts would throw "Cannot access ... before initialization".
for (const entry of ["voice-tools.ts", "clip-tools.ts"])
  test(`${entry} loads on its own before tools.ts`, () => {
    const file = join(import.meta.dir, entry);
    const tools = join(import.meta.dir, "tools.ts");
    const run = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        `await import(${JSON.stringify(file)}); const t = await import(${JSON.stringify(tools)}); if (!t.ToolArgumentError) process.exit(3);`,
      ],
      stderr: "pipe",
    });
    expect(run.stderr.toString()).not.toContain("before initialization");
    expect(run.exitCode).toBe(0);
  });
