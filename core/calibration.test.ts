import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject } from "../src/project/init.ts";
import { diffScores } from "./diff.ts";
import { decodeLoop, encodeLoop } from "./loop.ts";
import {
  applyScoreOperation,
  CALIBRATION_LATEST,
  createScore,
  scoreFromJSON,
} from "./score.ts";
import { evaluateProject } from "./sdk/eval.ts";
import { printSong } from "./sdk/print.ts";
import { SONG_CALIBRATION_LATEST, song } from "./sdk/v1.ts";

describe("song calibration", () => {
  test("absent and 0 store nothing, so older scores serialize unchanged", () => {
    const plain = createScore({ bars: 2 });
    expect("calibration" in plain).toBe(false);
    expect(encodeLoop(plain)).not.toContain("calibration");
    expect(encodeLoop(createScore({ bars: 2, calibration: 0 }))).toBe(
      encodeLoop(plain),
    );
    expect(printSong(plain)).not.toContain("calibration");
  });

  test("round-trips through JSON, the loop codec, diff and print", async () => {
    const base = createScore({ bars: 2 });
    const tuned = applyScoreOperation(base, {
      type: "setCalibration",
      calibration: CALIBRATION_LATEST,
    });
    expect(tuned.calibration).toBe(CALIBRATION_LATEST);
    expect(scoreFromJSON(tuned.toJSON()).calibration).toBe(CALIBRATION_LATEST);
    expect(decodeLoop(encodeLoop(tuned)).calibration).toBe(CALIBRATION_LATEST);
    const ops = diffScores(base, tuned);
    expect(ops).toEqual([
      { type: "setCalibration", calibration: CALIBRATION_LATEST },
    ]);
    const back = applyScoreOperation(tuned, {
      type: "setCalibration",
      calibration: null,
    });
    expect(encodeLoop(back)).toBe(encodeLoop(base));
    const text = printSong(tuned);
    expect(text).toContain(`calibration: ${CALIBRATION_LATEST},`);
    expect(await prettier.format(text, { parser: "typescript" })).toBe(text);
  });

  test("rejects out-of-range values in the score and the SDK", () => {
    for (const bad of [-1, 1.5, CALIBRATION_LATEST + 1, "1"])
      expect(() => createScore({ calibration: bad as number })).toThrow(
        /calibration/,
      );
    expect(SONG_CALIBRATION_LATEST).toBe(CALIBRATION_LATEST);
    expect(() => song({ tracks: [], calibration: 9 })).toThrow(/calibration/);
    expect(song({ tracks: [], calibration: 1 }).calibration).toBe(1);
    expect("calibration" in song({ tracks: [] })).toBe(false);
  });

  test("dawg init starts new songs at the latest calibration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-calibration-"));
    try {
      await initProject(dir);
      expect(await readFile(join(dir, "song.ts"), "utf8")).toContain(
        `calibration: ${CALIBRATION_LATEST},`,
      );
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      expect(evaluated.score.calibration).toBe(CALIBRATION_LATEST);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
