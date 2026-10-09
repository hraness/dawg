import { describe, expect, test } from "bun:test";
import { clippedSamples } from "./render.ts";

describe("render clip warning", () => {
  test("counts samples on the 16-bit rails only", () => {
    expect(clippedSamples(new Int16Array([0, 100, -32_767, 32_766]))).toBe(0);
    expect(clippedSamples(new Int16Array([32_767, -32_768, 5, 32_767]))).toBe(
      3,
    );
  });
});
