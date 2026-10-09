import { describe, expect, test } from "bun:test";
import { diffScores } from "./diff.ts";
import { decodeLoop, encodeLoop } from "./loop.ts";
import {
  applyScoreOperation,
  createScore,
  ScoreValidationError,
} from "./score.ts";
import { printSong } from "./sdk/print.ts";
import { song, style } from "./sdk/v1.ts";
import { normalizeSongStyle } from "./style-provenance.ts";

describe("song style provenance", () => {
  test("is absent by default and older scores encode unchanged", () => {
    const score = createScore({ bars: 4 });
    expect(score.style).toBeUndefined();
    expect(encodeLoop(score)).not.toContain("style");
    expect("style" in score.toJSON()).toBe(false);
  });

  test("round-trips through the loop file and the setStyle operation", () => {
    const record = { id: "deep-house", seed: 3, bars: 8 };
    const score = applyScoreOperation(createScore(), {
      type: "setStyle",
      style: record,
    });
    expect(score.style).toEqual(record);
    expect(decodeLoop(encodeLoop(score)).style).toEqual(record);
    const cleared = applyScoreOperation(score, {
      type: "setStyle",
      style: null,
    });
    expect(cleared.style).toBeUndefined();
    const blended = createScore({
      style: { ...record, blend: { id: "bebop", weight: 0.25 } },
    });
    expect(decodeLoop(encodeLoop(blended)).style?.blend).toEqual({
      id: "bebop",
      weight: 0.25,
    });
  });

  test("diff emits setStyle and applying it reaches the target", () => {
    const a = createScore();
    const b = createScore({ style: { id: "bebop", seed: 9, bars: 4 } });
    const ops = diffScores(a, b);
    expect(ops).toContainEqual({ type: "setStyle", style: b.style! });
    let next = a;
    for (const op of ops) next = applyScoreOperation(next, op);
    expect(next.style).toEqual(b.style!);
    expect(diffScores(b, a)).toContainEqual({ type: "setStyle", style: null });
  });

  test("rejects malformed records", () => {
    for (const bad of [
      "deep-house",
      { id: "Deep House", seed: 1, bars: 8 },
      { id: "x", seed: -1, bars: 8 },
      { id: "x", seed: 1.5, bars: 8 },
      { id: "x", seed: 1, bars: 0 },
      { id: "x", seed: 1, bars: 8, extra: 1 },
      { id: "x", seed: 1, bars: 8, blend: { id: "y", weight: 2 } },
    ])
      expect(() => createScore({ style: bad as never })).toThrow(
        ScoreValidationError,
      );
    expect(normalizeSongStyle(null)).toBeUndefined();
  });

  test("prints style() and the SDK reads it back", () => {
    const score = createScore({
      style: {
        id: "bebop",
        seed: 7,
        bars: 8,
        blend: { id: "bossa-nova", weight: 0.3 },
      },
    });
    const text = printSong(score);
    expect(text).toContain('import { song, style } from "dawg";');
    expect(text).toContain(
      'style: style("bebop", { seed: 7, bars: 8, blend: ["bossa-nova", 0.3] }),',
    );
    const built = song({
      tracks: [],
      bars: 4,
      style: style("bebop", { seed: 7, bars: 8, blend: ["bossa-nova", 0.3] }),
    });
    expect(built.style).toEqual(score.style!);
    expect(createScore(built as never).style).toEqual(score.style!);
    expect(printSong(createScore())).not.toContain("style");
  });

  test("style() checks its arguments", () => {
    expect(style("deep-house")).toEqual({ id: "deep-house", seed: 1, bars: 8 });
    expect(() => style("Deep House")).toThrow();
    expect(() => style("x", { seed: -1 })).toThrow();
    expect(() => style("x", { bars: 0 })).toThrow();
    expect(() => style("x", { blend: ["y", 2] })).toThrow();
  });
});
