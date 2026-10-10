import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { VERSION } from "./version.ts";

test("VERSION is package.json's version", () => {
  expect(VERSION).toBe(pkg.version);
});

test("a `bun build --compile` binary reports its version away from the source tree", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dawg-compile-"));
  try {
    const outfile = join(dir, "dawg");
    const build = Bun.spawnSync([
      process.execPath,
      "build",
      "--compile",
      resolve(import.meta.dir, "main.ts"),
      "--outfile",
      outfile,
    ]);
    expect(build.exitCode).toBe(0);
    const run = Bun.spawnSync([outfile, "--version"], { cwd: dir });
    expect(run.stdout.toString()).toBe(`dawg ${pkg.version}\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
