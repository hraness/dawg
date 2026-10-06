import { describe, expect, test } from "bun:test";
import { TransportClock } from "./clock.ts";

describe("TransportClock", () => {
  test("advances beats deterministically at a fixed BPM", () => {
    const clock = new TransportClock(120);
    clock.play(1_000);
    expect(clock.beatAt(1_500)).toBe(1);
    clock.pause(1_750);
    expect(clock.beatAt(2_000)).toBe(1.5);
  });

  test("converges to a timestamped remote event", () => {
    const clock = new TransportClock(60);
    clock.sync(4, true, 1_000, 2_000, 500);
    expect(clock.beatAt(500)).toBeCloseTo(5);
    clock.sync(7, false, 3_000, 3_000, 1_500);
    expect(clock.beatAt(1_500)).toBeCloseTo(7);
    expect(clock.playing).toBe(false);
  });
});
