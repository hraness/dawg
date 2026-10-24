import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMakeCommand } from "./make.ts";

const sink = () => {
  let text = "";
  return { write: (t: string) => (text += t), get text() { return text; } };
};

describe("dawg make", () => {
  test("--seed composes a song with no model, and the same seed repeats it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dawg-make-"));
    const run = async (out: string) => {
      const stdout = sink();
      const stderr = sink();
      const code = await runMakeCommand(["make", "--seed", "1234", "--out", out], dir, stdout, stderr);
      expect(stderr.text).toBe("");
      expect(code).toBe(0);
      return { stdout: stdout.text, file: readFileSync(join(dir, out), "utf8") };
    };
    const a = await run("a.track.json");
    const b = await run("b.track.json");
    expect(a.stdout).toContain("seed 1234");
    expect(a.stdout).toContain("no key change");
    expect(a.file).toBe(b.file);
  });

  test("--from replays a saved card", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dawg-make-"));
    const card = { title: "Paper Comet", hook: "pa-per co-met, burn-ing through", verses: ["fold the sky in half", "light it at the end"], mood: { energy: 0.7, brightness: 0.8 }, pins: { voice: "chopped" } };
    writeFileSync(join(dir, "card.json"), JSON.stringify({ seed: 9, card }));
    const stdout = sink();
    const code = await runMakeCommand(["make", "--from", "card.json", "--out", "c.track.json"], dir, stdout, sink());
    expect(code).toBe(0);
    expect(stdout.text).toContain('"Paper Comet" · seed 9');
    expect(stdout.text).toContain("voice: chopped");
  });

  test("rejects a bad seed", async () => {
    const stderr = sink();
    expect(await runMakeCommand(["make", "--seed", "x"], tmpdir(), sink(), stderr)).toBe(2);
    expect(stderr.text).toContain("--seed");
  });
});
