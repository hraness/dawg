/**
 * The release manifest for the prebuilt sinks: it records each library's
 * sha256, the loader accepts exactly those bytes, and the package ships the
 * prebuilt directory.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest } from "./manifest.ts";
import {
  NATIVE_TARGETS,
  SINK_ABI_VERSION,
  probeNativeSink,
} from "../src/audio/native.ts";

describe("native sink manifest", () => {
  test("records each present target, and the loader trusts only those bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-manifest-"));
    try {
      await mkdir(join(dir, "linux-x64"));
      await mkdir(join(dir, "darwin-arm64"));
      await writeFile(join(dir, "linux-x64", "libdawg_sink.so"), "linux lib");
      await writeFile(
        join(dir, "darwin-arm64", "libdawg_sink.dylib"),
        "darwin lib",
      );
      const manifest = buildManifest(dir);
      expect(manifest.abi).toBe(SINK_ABI_VERSION);
      expect(Object.keys(manifest.libraries).sort()).toEqual([
        "darwin-arm64",
        "linux-x64",
      ]);
      expect(manifest.libraries["linux-x64"]).toEqual({
        file: "linux-x64/libdawg_sink.so",
        sha256: new Bun.CryptoHasher("sha256")
          .update("linux lib")
          .digest("hex"),
      });
      await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
      let opened: string | undefined;
      const probe = (arch: string, platform = "linux") =>
        probeNativeSink({
          env: {},
          platform,
          arch,
          dir,
          dlopen: (path) => {
            opened = path;
            throw new Error("stop after verification");
          },
        });
      // Verified, then handed to dlopen (which the fake refuses).
      expect(probe("x64")).toMatchObject({ ok: false });
      expect(opened).toBe(join(dir, "linux-x64", "libdawg_sink.so"));
      opened = undefined;
      // Not built for this target: never opened.
      expect(probe("arm64")).toMatchObject({
        ok: false,
        reason: "no native sink for linux-arm64 in manifest",
      });
      expect(opened).toBeUndefined();
      // Bytes changed after the manifest was written: never opened.
      await writeFile(join(dir, "linux-x64", "libdawg_sink.so"), "swapped");
      const swapped = probe("x64");
      expect(!swapped.ok && swapped.reason).toContain("sha256 mismatch");
      expect(opened).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("--all refuses a release missing any shipped target", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-manifest-"));
    try {
      await mkdir(join(dir, "linux-x64"));
      await writeFile(join(dir, "linux-x64", "libdawg_sink.so"), "lib");
      const run = Bun.spawnSync(
        [process.execPath, join(import.meta.dir, "manifest.ts"), dir, "--all"],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(run.exitCode).toBe(1);
      expect(run.stderr.toString()).toContain("darwin-arm64");
      for (const target of NATIVE_TARGETS) {
        const file = target.startsWith("darwin")
          ? "libdawg_sink.dylib"
          : "libdawg_sink.so";
        await mkdir(join(dir, target), { recursive: true });
        await writeFile(join(dir, target, file), target);
      }
      const ok = Bun.spawnSync(
        [process.execPath, join(import.meta.dir, "manifest.ts"), dir, "--all"],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(ok.exitCode).toBe(0);
      const written = JSON.parse(
        await readFile(join(dir, "manifest.json"), "utf8"),
      );
      expect(Object.keys(written.libraries).sort()).toEqual(
        [...NATIVE_TARGETS].sort(),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the package ships the prebuilt libraries and manifest, and no install script", async () => {
    const pkg = JSON.parse(
      await readFile(join(import.meta.dir, "..", "package.json"), "utf8"),
    );
    expect(pkg.files).toContain("native/prebuilt/manifest.json");
    expect(pkg.files).toContain("native/prebuilt/*/libdawg_sink.*");
    // Never compile (or run anything) on install.
    for (const hook of ["preinstall", "install", "postinstall", "prepare"])
      expect(pkg.scripts?.[hook]).toBeUndefined();
  });
});
