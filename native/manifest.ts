/**
 * Write `native/prebuilt/manifest.json` for the prebuilt sink libraries the
 * release packs: one entry per target with its file and sha256. The loader
 * (src/audio/native.ts) refuses any library whose bytes do not match.
 *
 *   bun native/manifest.ts [dir=native/prebuilt] [--all]
 *
 * `--all` (the release) fails unless every shipped target is present.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  NATIVE_TARGETS,
  SINK_ABI_VERSION,
  libraryFileName,
  type NativeManifest,
} from "../src/audio/native.ts";

export function buildManifest(dir: string): NativeManifest {
  const libraries: Record<string, { file: string; sha256: string }> = {};
  for (const target of NATIVE_TARGETS) {
    const file = `${target}/${libraryFileName(target.split("-")[0])}`;
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    libraries[target] = {
      file,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    };
  }
  return { abi: SINK_ABI_VERSION, libraries };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dir = args.find((arg) => !arg.startsWith("--")) ?? "native/prebuilt";
  const manifest = buildManifest(dir);
  const missing = NATIVE_TARGETS.filter((t) => !manifest.libraries[t]);
  if (args.includes("--all") && missing.length > 0) {
    console.error(`missing prebuilt sink for ${missing.join(", ")}`);
    process.exit(1);
  }
  writeFileSync(
    join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const [target, entry] of Object.entries(manifest.libraries))
    console.log(`${entry.sha256}  ${target}  ${entry.file}`);
}
