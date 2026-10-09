import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("wall-clock assertions", () => {
  test("every test that times work goes through test/perf.ts", () => {
    // A raw ms bound fails on a loaded shared host; test/perf.ts scales it
    // and keeps the strict figure for DAWG_PERF=1. A test that only compares
    // two timings in the same run (no budget) says so with `perf-exempt:`.
    const offenders = ["core", "src", "tui", "test"]
      .flatMap((dir) => testFiles(join(ROOT, dir)))
      .filter((path) => {
        const text = readFileSync(path, "utf8");
        if (!text.includes("performance.now()")) return false;
        return !(
          /from "(?:\.\.?\/)+(?:test\/)?perf\.ts"/.test(text) ||
          text.includes("DAWG_PERF") ||
          text.includes("perf-exempt:")
        );
      })
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });
});
