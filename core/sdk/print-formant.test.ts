/**
 * 0.7 formant lane: `fx.formant` and the vowel filter's `to`/`morph` go
 * through the generic fx printer and survive print → eval, with their lanes.
 */
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { diffScores } from "../diff.ts";
import { createScore, type TrackScore } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import { printProject, printTrack } from "./print.ts";

async function writeProject(dir: string, score: TrackScore): Promise<void> {
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
}

const voiced = createScore({
  tracks: [
    {
      id: "vox",
      name: "vox",
      instrument: "pad",
      fx: {
        formant: { shift: -4, mix: 0.8 },
        vowel: { vowel: "a", to: "o", morph: 0.5 },
      },
      fxAutomation: {
        "formant-shift": [
          { tick: 0, value: -4 },
          { tick: 1920, value: 3 },
        ],
        "vowel-morph": [{ tick: 0, value: 0.2 }],
      },
    },
    { id: "plain", name: "plain", instrument: "pad", fx: { formant: {} } },
  ],
} as never);

test("formant and vowel morph print and survive print → eval", async () => {
  const [vox, plain] = voiced.tracks.map((t) => printTrack(voiced, t));
  expect(vox).toContain("formant: { shift: -4, mix: 0.8 },");
  expect(vox).toContain('vowel: { to: "o", morph: 0.5 },');
  expect(vox).toContain('"formant-shift": [');
  expect(vox).toContain('"vowel-morph": [[0, 0.2]],');
  expect(plain).toContain("formant: {},");
  const dir = await mkdtemp(join(tmpdir(), "dawg-print-formant-"));
  try {
    await initProject(dir);
    await writeProject(dir, voiced);
    const evaluated = await evaluateProject(dir);
    if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
    expect(diffScores(voiced, evaluated.score)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
