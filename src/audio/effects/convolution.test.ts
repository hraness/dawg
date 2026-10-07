import { describe, expect, test } from "bun:test";
import { builtinImpulse, convolveStereo } from "./convolution.ts";

describe("convolution", () => {
  test("partitioned FFT convolution matches direct convolution", () => {
    let seed = 1;
    const rand = () =>
      ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const input = Float64Array.from({ length: 3000 }, rand);
    const left = Float64Array.from({ length: 1100 }, rand);
    const right = Float64Array.from({ length: 1100 }, rand);
    const outL = new Float64Array(input.length);
    const outR = new Float64Array(input.length);
    convolveStereo(input, { id: "t", left, right }, outL, outR, 0.5);
    for (const index of [0, 1, 511, 512, 1099, 1100, 2047, 2999]) {
      let l = 0;
      let r = 0;
      for (let k = 0; k <= index && k < left.length; k += 1) {
        l += input[index - k]! * left[k]!;
        r += input[index - k]! * right[k]!;
      }
      expect(outL[index]!).toBeCloseTo(0.5 * l, 9);
      expect(outR[index]!).toBeCloseTo(0.5 * r, 9);
    }
  });

  test("built-in impulses are deterministic and ordered by length", () => {
    const a = builtinImpulse("hall", 8000)!;
    expect(builtinImpulse("hall", 8000)!.left).toEqual(a.left);
    expect(builtinImpulse("room", 8000)!.left.length).toBeLessThan(
      builtinImpulse("plate", 8000)!.left.length,
    );
    expect(builtinImpulse("plate", 8000)!.left.length).toBeLessThan(
      a.left.length,
    );
  });
});
