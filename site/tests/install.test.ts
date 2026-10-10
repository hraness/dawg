/**
 * Runs the real install script (site/install.sh) end to end against a tarball
 * packed from this checkout, served from a file:// URL. Bun is the one on PATH;
 * BUN_INSTALL and the tarball directory point into a temp dir, so nothing on
 * the machine running the test changes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const site = resolve(import.meta.dir, "..");
const repo = resolve(site, "..");
const script = join(site, "install.sh");
const version: string = JSON.parse(
  readFileSync(join(repo, "package.json"), "utf8"),
).version;
const asset = `hraness-dawg-${version}.tgz`;
const shells = [
  "sh",
  ...(existsSync("/bin/dash") || existsSync("/usr/bin/dash") ? ["dash"] : []),
];

let work = "";
let release = "";

function run(shell: string, env: Record<string, string>) {
  const home = mkdtempSync(join(work, "home-"));
  const result = Bun.spawnSync([shell, script], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      BUN_INSTALL: join(home, "bun"),
      DAWG_INSTALL_DIR: join(home, "releases"),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    home,
    code: result.exitCode,
    out: result.stdout.toString() + result.stderr.toString(),
  };
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "dawg-install-test-"));
  release = join(work, "release");
  const pack = Bun.spawnSync(
    ["bun", "pm", "pack", "--destination", release, "--quiet"],
    { cwd: repo, stdout: "pipe", stderr: "pipe" },
  );
  if (pack.exitCode !== 0)
    throw new Error(`bun pm pack failed: ${pack.stderr.toString()}`);
  const sum = createHash("sha256")
    .update(readFileSync(join(release, asset)))
    .digest("hex");
  // A release also lists its native sink libraries; the installer reads only
  // the tarball's line.
  writeFileSync(
    join(release, "SHA256SUMS"),
    `${sum}  ${asset}\n${"b".repeat(64)}  libdawg_sink-linux-x64.so\n`,
  );
}, 60_000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("install.sh", () => {
  for (const shell of shells) {
    test(`${shell}: verifies the sha256 and installs a working dawg`, () => {
      // BUN_INSTALL's own bin is not on PATH yet: the script must warn, not fail.
      // The Bun on PATH runs `bun add -g`; BUN_INSTALL sends the global install to the temp home.
      const { home, code, out } = run(shell, {
        DAWG_VERSION: version,
        DAWG_INSTALL_BASE_URL: `file://${release}`,
      });
      expect(out).toContain("verified sha256");
      expect(code).toBe(0);
      expect(existsSync(join(home, "releases", asset))).toBe(true);
      const dawg = join(home, "bun", "bin", "dawg");
      expect(existsSync(dawg)).toBe(true);
      const help = Bun.spawnSync([dawg, "--help"], {
        env: { ...process.env, HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(help.exitCode).toBe(0);
      expect(help.stdout.toString() + help.stderr.toString()).toContain("dawg");
    }, 120_000);
  }

  test("refuses a tarball whose sha256 does not match, and installs nothing", () => {
    const bad = join(work, "bad");
    Bun.spawnSync(["cp", "-R", release, bad]);
    writeFileSync(join(bad, "SHA256SUMS"), `${"0".repeat(64)}  ${asset}\n`);
    const { home, code, out } = run("sh", {
      DAWG_VERSION: version,
      DAWG_INSTALL_BASE_URL: `file://${bad}`,
    });
    expect(code).toBe(1);
    expect(out).toContain("checksum mismatch");
    expect(existsSync(join(home, "releases", asset))).toBe(false);
    expect(existsSync(join(home, "bun", "bin", "dawg"))).toBe(false);
  });

  test("refuses SHA256SUMS without an entry for the tarball", () => {
    const bad = join(work, "missing");
    Bun.spawnSync(["cp", "-R", release, bad]);
    writeFileSync(
      join(bad, "SHA256SUMS"),
      `${"a".repeat(64)}  something-else.tgz\n`,
    );
    const { code, out } = run("sh", {
      DAWG_VERSION: version,
      DAWG_INSTALL_BASE_URL: `file://${bad}`,
    });
    expect(code).toBe(1);
    expect(out).toContain("no entry for");
  });

  test("says the first release is coming soon when there is no release", () => {
    // GitHub sends /releases/latest to /releases when nothing is published; any
    // URL that does not end on /releases/tag/v<version> is treated the same way.
    const page = join(work, "releases");
    writeFileSync(page, "no releases\n");
    const { home, code, out } = run("sh", {
      DAWG_INSTALL_LATEST_URL: `file://${page}`,
    });
    expect(code).toBe(1);
    expect(out).toContain("first release of dawg is coming soon");
    expect(out).toContain("git clone https://github.com/hraness/dawg.git");
    // Nothing was touched before the release check.
    expect(existsSync(join(home, "bun"))).toBe(false);
  });

  test("rejects a base URL override without a version", () => {
    const { code, out } = run("sh", {
      DAWG_INSTALL_BASE_URL: `file://${release}`,
    });
    expect(code).toBe(1);
    expect(out).toContain("needs DAWG_VERSION");
  });
});
