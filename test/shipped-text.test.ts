/**
 * Shipped text carries no copyrighted lyrics. Help, menu placeholders, SDK
 * docs (vendored into every project by `dawg init`) and guides use original
 * syllables only. The denylist is stored as hashes of normalized three-word
 * phrases, so this test does not itself ship the phrases it guards against.
 */
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
/** Bun.hash of a normalized three-word phrase (see `normalize`). */
const DENYLIST = new Set<bigint>([0xa827e9efeaf54223n, 0x3be63c957227ef6an]);
const TEXT = /\.(ts|tsx|md|json|txt|html|css|js)$/;

/** Lowercase letters only: syllable hyphens join (`gon-na` → `gonna`). */
function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/-/g, "")
    .split(/[^a-z']+/)
    .map((word) => word.replace(/'/g, ""))
    .filter(Boolean);
}

function phraseHashes(text: string): Set<bigint> {
  const words = normalize(text);
  const out = new Set<bigint>();
  for (let i = 0; i + 3 <= words.length; i += 1)
    out.add(BigInt(Bun.hash(words.slice(i, i + 3).join(" "))));
  return out;
}

test("the denylist matcher sees through syllable hyphens and holds", () => {
  // Built from parts so the phrase is not a literal in this file.
  const parts = ["nev-er", "gon-na", "_", "give"];
  const hits = [...phraseHashes(parts.join(" "))].filter((hash) =>
    DENYLIST.has(hash),
  );
  expect(hits.length).toBe(1);
  expect(
    [...phraseHashes("sun-lit morn-ing _ glow")].some((h) => DENYLIST.has(h)),
  ).toBe(false);
});

test("no shipped file contains a denylisted lyric phrase", async () => {
  const listed = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT });
  const files = new TextDecoder()
    .decode(listed.stdout)
    .split("\n")
    .filter(
      (path) =>
        TEXT.test(path) &&
        path !== "bun.lock" &&
        path !== "test/shipped-text.test.ts",
    );
  expect(files.length).toBeGreaterThan(100);
  const offenders: string[] = [];
  for (const path of files) {
    const text = await readFile(join(ROOT, path), "utf8").catch(() => "");
    for (const hash of phraseHashes(text))
      if (DENYLIST.has(hash)) offenders.push(path);
  }
  expect(offenders).toEqual([]);
});
