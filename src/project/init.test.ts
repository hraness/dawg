import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SDK_VERSION } from "../../core/sdk/v1.ts";
import {
  initProject,
  isProject,
  readManifest,
  runInitCommand,
  sdkVersionOf,
  SHIPPED_SDK_PATH,
} from "./init.ts";

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dawg-init-"));
}

describe("initProject", () => {
  test("creates the layout once and is idempotent", async () => {
    const dir = await scratch();
    try {
      const first = await initProject(dir);
      expect(first.wrote).toEqual([
        ".dawg/sdk/v1.ts",
        ".dawg/sdk/tsconfig.json",
        "dawg.json",
        "tsconfig.json",
        "song.ts",
        ".gitignore",
      ]);
      expect(first.sdkVersion).toBe(SDK_VERSION);
      expect(await isProject(dir)).toBe(true);
      expect(await readManifest(dir)).toEqual({
        format: "dawg.project/v1",
        sdk: 1,
      });
      expect(await readFile(join(dir, ".dawg/sdk/v1.ts"), "utf8")).toBe(
        await readFile(SHIPPED_SDK_PATH, "utf8"),
      );
      expect((await readdir(join(dir, "tracks"))).length).toBe(0);
      expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe(
        ".dawg/*\n!.dawg/sdk/\n",
      );
      const second = await initProject(dir);
      expect(second.wrote).toEqual([]);
      // Nothing outside the project.
      expect((await readdir(dir)).sort()).toEqual([
        ".dawg",
        ".gitignore",
        "dawg.json",
        "song.ts",
        "tracks",
        "tsconfig.json",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps user files and appends missing .gitignore lines", async () => {
    const dir = await scratch();
    try {
      await writeFile(join(dir, "song.ts"), "// mine\n");
      await writeFile(join(dir, ".gitignore"), "node_modules/");
      const result = await initProject(dir);
      expect(result.wrote).not.toContain("song.ts");
      expect(await readFile(join(dir, "song.ts"), "utf8")).toBe("// mine\n");
      expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe(
        "node_modules/\n.dawg/*\n!.dawg/sdk/\n",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("refreshes the vendored SDK only for a newer same-major copy", async () => {
    const dir = await scratch();
    try {
      const shipped = await readFile(SHIPPED_SDK_PATH, "utf8");
      const older = shipped.replace(
        /SDK_VERSION = "1\.\d+\.\d+"/,
        'SDK_VERSION = "1.0.0"',
      );
      const newer = shipped.replace(
        /SDK_VERSION = "1\.\d+\.\d+"/,
        'SDK_VERSION = "1.99.0"',
      );
      const nextMajor = shipped.replace(
        /SDK_VERSION = "1\.\d+\.\d+"/,
        'SDK_VERSION = "2.0.0"',
      );
      await initProject(dir, { sdkSource: older });
      expect(
        sdkVersionOf(await readFile(join(dir, ".dawg/sdk/v1.ts"), "utf8")),
      ).toBe("1.0.0");
      const refreshed = await initProject(dir, { sdkSource: newer });
      expect(refreshed.wrote).toEqual([".dawg/sdk/v1.ts"]);
      expect(refreshed.sdkVersion).toBe("1.99.0");
      const downgrade = await initProject(dir, { sdkSource: older });
      expect(downgrade.wrote).toEqual([]);
      const major = await initProject(dir, { sdkSource: nextMajor });
      expect(major.wrote).toEqual([]);
      expect(major.sdkVersion).toBe("1.99.0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("dawg init prints each file once, then reports up to date", async () => {
    const dir = await scratch();
    try {
      let out = "";
      const stdout = { write: (text: string) => (out += text) };
      expect(await runInitCommand(["init"], dir, stdout, stdout)).toBe(0);
      expect(out.split("\n").filter(Boolean).length).toBe(6);
      expect(out).toContain("wrote song.ts\n");
      out = "";
      expect(await runInitCommand(["init"], dir, stdout, stdout)).toBe(0);
      expect(out).toMatch(/^project up to date \(sdk 1\.\d+\.\d+\)\n$/);
      // An absolute target is used as given, a relative one under cwd.
      const nested = join(dir, "nested");
      expect(await runInitCommand(["init", nested], "/", stdout, stdout)).toBe(
        0,
      );
      expect(await isProject(nested)).toBe(true);
      expect(await runInitCommand(["init", "rel"], dir, stdout, stdout)).toBe(
        0,
      );
      expect(await isProject(join(dir, "rel"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("readManifest rejects foreign or malformed manifests", async () => {
    const dir = await scratch();
    try {
      await writeFile(join(dir, "dawg.json"), '{"format":"other","sdk":1}');
      expect(await readManifest(dir)).toBeUndefined();
      await writeFile(join(dir, "dawg.json"), "{nope");
      expect(await isProject(dir)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
