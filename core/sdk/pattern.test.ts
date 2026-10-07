import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { applyDrumPattern, applySynthKit } from "../../src/commands/drums.ts";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { diffScores } from "../diff.ts";
import { createScore } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import { printProject } from "./print.ts";

test("kit and pattern() round-trip through song.ts", async () => {
  let score = createScore({
    bars: 1,
    tracks: [{ id: "drums", name: "drums", instrument: "kit" }],
  });
  score = applyDrumPattern(score, "drums", "boom-bap", "set").next!;
  score = applySynthKit(score, "drums", "lofi").next!;
  const files = printProject(score).files;
  const trackFile = files.find((file) => file.path.endsWith("track.ts"))!;
  expect(trackFile.text).toContain('kit: "lofi"');
  for (const printed of files)
    expect(await prettier.format(printed.text, { parser: "typescript" })).toBe(
      printed.text,
    );

  const dir = await mkdtemp(join(tmpdir(), "dawg-pattern-"));
  try {
    await initProject(dir);
    for (const printed of files)
      await writeAtomic(join(dir, printed.path), printed.text);
    const printedBack = await evaluateProject(dir);
    if (!printedBack.ok)
      throw new Error(JSON.stringify(printedBack.diagnostics));
    expect(printedBack.score.tracks[0]!.kit).toBe("lofi");
    expect(diffScores(score, printedBack.score)).toEqual([]);

    // The same track written by hand with pattern() evaluates identically.
    await writeAtomic(
      join(dir, trackFile.path),
      [
        'import { track, pattern } from "dawg";',
        "",
        "export default track({",
        '  id: "drums",',
        '  name: "drums",',
        '  instrument: "kit",',
        '  kit: "dusty",',
        '  rhythm: pattern("boom-bap"),',
        "});",
        "",
      ].join("\n"),
    );
    const handWritten = await evaluateProject(dir);
    if (!handWritten.ok)
      throw new Error(JSON.stringify(handWritten.diagnostics));
    expect(diffScores(score, handWritten.score)).toEqual([]);
    expect(printProject(handWritten.score).files).toEqual(files);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
