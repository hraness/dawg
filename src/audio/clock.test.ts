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
});
