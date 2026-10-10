/**
 * Typed `patch` lines end to end in the window: a recipe builds the bass
 * track's patch, `patch save --user` writes the user library file, and a
 * second track loads it back by name.
 */
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

test.skipIf(!supported)(
  "real PTY: typed patch lines build, save to the user library and load",
  async () => {
    const t = await launch(110, 34, {});
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.settle("prompt");
      const lines = [
        "patch new mine",
        "patch add osc as tone wave=saw",
        "patch add svf as vcf cutoff=900",
        "patch wire voice.pitch tone.pitch",
        "patch wire tone.out vcf.in",
        "patch wire vcf.out out.audio",
        "patch macro bright vcf.cutoff:200..6000",
        "patch knob bright 0.25",
      ];
      for (const line of lines) await t.type(`${line}\r`, line);
      expect(t.vt.text()).toContain("bright 0.25");
      await t.type("patch save mine --user\r", "save");
      expect(t.vt.text()).toContain("saved mine to your patch library");
      const file = JSON.parse(
        await readFile(
          join(t.cwd, ".local", "share", "dawg", "patches", "mine.json"),
          "utf8",
        ),
      ) as {
        patch: { nodes: { id: string }[] };
        macros?: Record<string, number>;
      };
      expect(file.patch.nodes.map((node) => node.id)).toEqual(["tone", "vcf"]);
      await t.type("patch load acid-bass\r", "builtin");
      expect(t.vt.text()).toContain("replaced with patch acid-bass");
      await t.type("patch load mine\r", "user load");
      expect(t.vt.text()).toContain("replaced with patch mine");
      await t.type("patch show\r", "show");
      expect(t.vt.text()).toContain("patch wire tone.out vcf.in");
    } finally {
      t.terminal.close();
      t.proc.kill();
      await t.proc.exited;
    }
  },
  45_000,
);
