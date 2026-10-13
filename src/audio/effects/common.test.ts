import { describe, expect, test } from "bun:test";
import type { AutomationPoint } from "../../../core/score.ts";
import { interpolateAutomation, Param } from "./common.ts";

/** The original scan is the exact-output oracle for the faster lookup. */
function linear(
  points: readonly AutomationPoint[],
  tick: number,
  fallback: number,
): number {
  if (points.length === 0 || !Number.isFinite(tick)) return fallback;
  if (tick < points[0]!.tick) return fallback;
  const last = points[points.length - 1]!;
  if (tick >= last.tick) return last.value;
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index]!;
    if (tick > right.tick) continue;
    const left = points[index - 1]!;
    const span = right.tick - left.tick;
    const ratio = span <= 0 ? 1 : (tick - left.tick) / span;
    return left.value + (right.value - left.value) * ratio;
  }
  return last.value;
}

describe("automation lookup", () => {
  test("short and dense lanes exactly retain ramps, holds and out-of-order reads", () => {
    for (const length of [0, 1, 2, 7, 8, 9, 1024]) {
      const points = Array.from({ length }, (_, index) => ({
        tick: 13 + index * 64,
        value: Math.sin(index * 0.43),
      }));
      const ticks = [
        -Infinity,
        -1,
        0,
        13,
        13 + (length - 1) * 64,
        13 + length * 64,
        Infinity,
        Number.NaN,
        ...Array.from(
          { length: 512 },
          (_, index) => ((index * 0.754877666) % 1) * length * 64,
        ),
      ];
      for (const tick of ticks)
        expect(interpolateAutomation(points, tick, 0.4)).toBe(
          linear(points, tick, 0.4),
        );
    }
  });

  test("duplicate endpoints select the same segment as the original scan", () => {
    const points = Array.from({ length: 32 }, (_, index) => ({
      tick: Math.floor(index / 2) * 64,
      value: index * 0.17,
    }));
    for (let tick = -1; tick <= 1024; tick += 0.5)
      expect(interpolateAutomation(points, tick, 0.4)).toBe(
        linear(points, tick, 0.4),
      );
  });

  test("Param can seek backwards and observe replaced lane values", () => {
    const points = Array.from({ length: 32 }, (_, index) => ({
      tick: index * 64,
      value: index % 3,
    }));
    const param = new Param(0.4, points, 16);
    expect(param.at(2000)).toBe(linear(points, 125, 0.4));
    expect(param.at(100)).toBe(linear(points, 6.25, 0.4));
    points[1] = { tick: 64, value: 0.75 };
    expect(param.at(1024)).toBe(0.75);
    expect(param.at(100)).toBe(linear(points, 6.25, 0.4));
  });
});
