import { describe, expect, test } from "bun:test";
import {
  Delight,
  downbeatGlint,
  GHOST_MS,
  SWEEP_MS,
  sweepProgress,
} from "./delight.ts";

const at120 = { playing: true, bpm: 120, beatsPerBar: 4, reducedMotion: false };

describe("downbeat glint", () => {
  test("lights for 120 ms after each bar downbeat at a fixed clock", () => {
    // 120 BPM: one beat is 500 ms, so 0.2 beats is 100 ms and 0.3 is 150 ms.
    expect(downbeatGlint({ ...at120, beat: 0 })).toBe(true);
    expect(downbeatGlint({ ...at120, beat: 0.2 })).toBe(true);
    expect(downbeatGlint({ ...at120, beat: 0.3 })).toBe(false);
    expect(downbeatGlint({ ...at120, beat: 1 })).toBe(false);
    expect(downbeatGlint({ ...at120, beat: 4.1 })).toBe(true);
    expect(downbeatGlint({ ...at120, beat: 6 })).toBe(false);
  });

  test("follows the loop and meter changes", () => {
    expect(downbeatGlint({ ...at120, beat: 16.1, loopBeats: 16 })).toBe(true);
    const barBeats = [0, 3, 7];
    expect(downbeatGlint({ ...at120, beat: 3.1, barBeats })).toBe(true);
    expect(downbeatGlint({ ...at120, beat: 4.1, barBeats })).toBe(false);
  });

  test("is dark when paused or with motion off", () => {
    expect(downbeatGlint({ ...at120, beat: 0, playing: false })).toBe(false);
    expect(downbeatGlint({ ...at120, beat: 0, reducedMotion: true })).toBe(
      false,
    );
  });
});

describe("first loop", () => {
  const playing = { playing: true, loopBeats: 16, empty: false };

  test("fires once on the first wrap and sweeps for SWEEP_MS", () => {
    const delight = new Delight();
    delight.song("s1", false);
    expect(delight.observe({ ...playing, beat: 15.9 }, 1000)).toBe(false);
    expect(delight.observe({ ...playing, beat: 16.05 }, 1010)).toBe(true);
    expect(delight.observe({ ...playing, beat: 32.05 }, 9000)).toBe(false);
    expect(sweepProgress(delight.sweepStartedAtMs, 1010, false)).toBe(0);
    expect(
      sweepProgress(delight.sweepStartedAtMs, 1010 + SWEEP_MS / 2, false),
    ).toBe(0.5);
    expect(
      sweepProgress(delight.sweepStartedAtMs, 1010 + SWEEP_MS, false),
    ).toBeUndefined();
    expect(delight.animating(1010 + 10)).toBe(true);
    expect(delight.animating(1010 + SWEEP_MS)).toBe(false);
  });

  test("never repeats for a song the session remembers", () => {
    const delight = new Delight();
    delight.song("s1", true);
    expect(delight.observe({ ...playing, beat: 16.05 }, 0)).toBe(false);
    // A new song starts fresh.
    delight.song("s2", false);
    expect(delight.observe({ ...playing, beat: 16.05 }, 0)).toBe(true);
  });

  test("waits for notes and a playing transport", () => {
    const delight = new Delight();
    expect(delight.observe({ ...playing, beat: 17, empty: true }, 0)).toBe(
      false,
    );
    expect(delight.observe({ ...playing, beat: 17, playing: false }, 0)).toBe(
      false,
    );
    expect(delight.observe({ ...playing, beat: 17 }, 0)).toBe(true);
  });

  test("motion off keeps the moment but drops the sweep", () => {
    expect(sweepProgress(0, 10, true)).toBeUndefined();
  });
});

describe("ghost lanes", () => {
  test("glow for 150 ms and fade", () => {
    const delight = new Delight();
    delight.ghost(60, 1000);
    delight.ghost(64, 1075);
    const glows = delight.glows(1075, false);
    expect(glows.map((glow) => glow.pitch)).toEqual([64, 60]);
    expect(glows[1]!.strength).toBeCloseTo(0.5);
    expect(delight.glows(1000 + GHOST_MS, false).map((g) => g.pitch)).toEqual([
      64,
    ]);
    expect(delight.glows(1075 + GHOST_MS, false)).toEqual([]);
    expect(delight.animating(2000)).toBe(false);
  });

  test("motion off shows none", () => {
    const delight = new Delight();
    delight.ghost(60, 0);
    expect(delight.glows(10, true)).toEqual([]);
  });
});
