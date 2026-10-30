/**
 * The README and the site are one system: the README opens with the
 * approved medium description, and its install commands name the version
 * in package.json, so a release bump cannot leave a stale tarball behind.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { cliVersion, productMessaging } from "../app/messaging";

const repo = resolve(import.meta.dir, "..", "..");
const readme = readFileSync(join(repo, "README.md"), "utf8");

describe("README", () => {
  test("opens with the site's approved product description", () => {
    const opener = readme.split("\n\n")[1]!.replace(/\s+/gu, " ").trim();
    expect(opener).toBe(productMessaging.medium);
  });

  test("install commands name the current version", () => {
    const versions = new Set(
      [...readme.matchAll(/hraness-dawg-(\d+\.\d+\.\d+)\.tgz/gu)].map(
        (match) => match[1],
      ),
    );
    expect([...versions]).toEqual([cliVersion]);
    expect(readme).toContain(`releases/download/v${cliVersion}/`);
    expect(readme).toContain(`gh release download v${cliVersion}`);
  });

  test("keeps internal vocabulary out of the prose", () => {
    // Fenced blocks are real screens and commands, not prose.
    const prose = readme.replace(/```[\s\S]*?```/gu, "");
    const words =
      /\b(bounded|canonical|admission|provenance|qualified|custody|workstream|steel thread)\b/giu;
    expect(prose.match(words)).toBeNull();
    expect(prose).not.toContain("—");
  });
});
