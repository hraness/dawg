/**
 * The published package is closed under imports: every relative import in
 * a file `package.json` `files` ships resolves to a file it also ships.
 * (guides/marks.ts once went missing from the tarball and `dawg --help`
 * failed after install; site/tests/install.test.ts caught it late.)
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const patterns = (
  JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    files: string[];
  }
).files;

function shipped(): Set<string> {
  // npm always packs package.json (and README/LICENSE).
  const out = new Set<string>(["package.json"]);
  for (const pattern of patterns.filter((p) => !p.startsWith("!")))
    for (const path of new Bun.Glob(pattern).scanSync({ cwd: root }))
      out.add(path);
  for (const pattern of patterns.filter((p) => p.startsWith("!"))) {
    const glob = new Bun.Glob(pattern.slice(1));
    for (const path of out) if (glob.match(path)) out.delete(path);
  }
  return out;
}

test("every relative import in a shipped file is shipped too", () => {
  const files = shipped();
  expect(files.has("guides/marks.ts")).toBe(true);
  const missing: string[] = [];
  const spec = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;
  for (const file of files) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(join(root, file), "utf8");
    for (const [, target] of source.matchAll(spec)) {
      const path = relative(root, resolve(root, dirname(file), target!));
      if (!existsSync(join(root, path))) continue; // not a file import
      if (!files.has(path)) missing.push(`${file} → ${path}`);
    }
  }
  expect(missing).toEqual([]);
});
