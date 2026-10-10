/**
 * `model key` is the one word for adding an agent (design §8.2): the shell
 * usage pages and the TUI receipts never say login or sign in.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AUTH_USAGE } from "../src/auth/cli.ts";

const retired = /\bdawg login\b|\bsign(ed)?[- ]in\b/i;

test("the auth usage page names model key, not login", () => {
  expect(AUTH_USAGE).toContain("dawg model key gateway");
  expect(AUTH_USAGE).not.toMatch(retired);
});

for (const argv of [
  ["model", "--help"],
  ["model", "key", "--help"],
]) {
  test(`dawg ${argv.join(" ")} shows model key and no login`, async () => {
    const proc = Bun.spawn(
      ["bun", new URL("../src/main.ts", import.meta.url).pathname, ...argv],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, DAWG_AI: "0" } },
    );
    const text = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(text).toContain("dawg model key");
    expect(text).not.toMatch(retired);
  }, 30_000);
}

test("the TUI's agent-key receipts say agent key", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  expect(main).toContain("no agent key · model key adds one");
  expect(main).toContain("`agent key · ${providerName}`");
  expect(main).toContain("`agent key stopped working · ");
  for (const phrase of [
    "not signed in · direct",
    "`signed in · ",
    "sign-in stopped working ·",
    "run `dawg login`",
  ])
    expect(main, phrase).not.toContain(phrase);
});
