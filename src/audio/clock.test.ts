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

  test("a cue holds the beat until the sound starts, then runs from it", () => {
    const clock = new TransportClock(120);
    clock.sync(8, false, 0, 0, 0);
    clock.cue();
    expect(clock.playing).toBe(true);
    expect(clock.cued).toBe(true);
    // The engine is still rendering: the playhead must not move.
    expect(clock.beatAt(2_000)).toBe(8);
    // A seek while cued moves the hold.
    clock.sync(4, true, 2_000, 2_000, 2_000);
    expect(clock.beatAt(2_500)).toBe(4);
    // Released at the time the first frame is heard.
    clock.play(3_000);
    expect(clock.cued).toBe(false);
    expect(clock.beatAt(3_000)).toBe(4);
    expect(clock.beatAt(3_500)).toBe(5);
  });

  test("pausing or toggling a cue stops it where it held", () => {
    const clock = new TransportClock(120);
    clock.cue();
    clock.toggle(1_000);
    expect(clock.playing).toBe(false);
    expect(clock.cued).toBe(false);
    expect(clock.beatAt(5_000)).toBe(0);
    clock.cue();
    clock.pause(1_000);
    expect(clock.playing).toBe(false);
    clock.play(2_000);
    expect(clock.beatAt(2_500)).toBe(1);
  });
});
