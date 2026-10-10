import { describe, expect, test } from "bun:test";
import {
  FrameGate,
  IDLE_HEARTBEAT_MS,
  MIN_FRAME_GAP_MS,
} from "./frame-gate.ts";

/** Seeded xorshift32: the fuzz below is reproducible. */
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x1_0000_0000;
  };
}

describe("FrameGate", () => {
  test("an idle editor builds no view between heartbeats", () => {
    const gate = new FrameGate();
    const score = {};
    expect(gate.shouldBuild({ nowMs: 0, keys: [score, "idle"] })).toBe(true);
    // 30 fps for just under one heartbeat: nothing changed, nothing built.
    const ticks = Math.floor((IDLE_HEARTBEAT_MS - 1) / 33);
    for (let i = 1; i <= ticks; i += 1)
      expect(gate.shouldBuild({ nowMs: i * 33, keys: [score, "idle"] })).toBe(
        false,
      );
    expect(gate.built).toBe(1);
    expect(gate.skipped).toBe(ticks);
    // One heartbeat frame catches anything nothing reported.
    expect(
      gate.shouldBuild({ nowMs: IDLE_HEARTBEAT_MS, keys: [score, "idle"] }),
    ).toBe(true);
  });

  test("force, dirty, a changed key and animation each build", () => {
    const gate = new FrameGate(1000);
    const a = {};
    gate.shouldBuild({ nowMs: 0, keys: [a] });
    expect(gate.shouldBuild({ nowMs: 1, keys: [a], force: true })).toBe(true);
    expect(gate.shouldBuild({ nowMs: 2, keys: [a] })).toBe(false);
    gate.markDirty();
    expect(gate.shouldBuild({ nowMs: 3, keys: [a] })).toBe(true);
    expect(gate.shouldBuild({ nowMs: 4, keys: [a] })).toBe(false);
    // A new score object (an edit) is a change even if it looks the same.
    expect(gate.shouldBuild({ nowMs: 5, keys: [{}] })).toBe(true);
    expect(gate.shouldBuild({ nowMs: 6, keys: [a, "x"] })).toBe(true);
    expect(gate.shouldBuild({ nowMs: 7, keys: [a, "x"] })).toBe(false);
    for (let t = 8; t < 20; t += 1)
      expect(
        gate.shouldBuild({ nowMs: t, keys: [a, "x"], animating: true }),
      ).toBe(true);
  });

  test("fuzz: never misses a change, never builds an unchanged idle tick early", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = rng(seed);
      const gate = new FrameGate(500);
      let now = 0;
      let lastBuilt = Number.NEGATIVE_INFINITY;
      let keys: unknown[] = ["a"];
      let lastKeys: unknown[] | undefined;
      let dirty = false;
      for (let step = 0; step < 300; step += 1) {
        now += Math.floor(random() * 80);
        const roll = random();
        if (roll < 0.05) keys = [String(Math.floor(random() * 3))];
        if (roll > 0.95) {
          gate.markDirty();
          dirty = true;
        }
        const force = random() < 0.03;
        const animating = random() < 0.1;
        const changed =
          lastKeys === undefined || keys[0] !== lastKeys[0] || dirty;
        const due = now - lastBuilt >= 500;
        const built = gate.shouldBuild({ nowMs: now, keys, force, animating });
        expect(built).toBe(changed || force || animating || due);
        if (built) {
          lastBuilt = now;
          lastKeys = keys;
          dirty = false;
        }
      }
    }
  });
  test("a burst of forced frames builds at most ~31 a second, dropping none", () => {
    const gate = new FrameGate(IDLE_HEARTBEAT_MS, MIN_FRAME_GAP_MS);
    const built: number[] = [];
    // One second: tick(true) every 2 ms (keystrokes, agent events) beside
    // the 33 ms timer tick, as src/main.ts runs it.
    for (let now = 0; now < 1000; now += 1) {
      if (now % 2 === 0 && gate.shouldBuild({ nowMs: now, force: true }))
        built.push(now);
      if (now % 33 === 0 && gate.shouldBuild({ nowMs: now })) built.push(now);
    }
    expect(built.length).toBeLessThanOrEqual(31);
    expect(built.length).toBeGreaterThanOrEqual(28);
    for (let index = 1; index < built.length; index += 1)
      expect(built[index]! - built[index - 1]!).toBeGreaterThanOrEqual(
        MIN_FRAME_GAP_MS,
      );
    // The last forced frame was deferred, not dropped: the next timer tick
    // builds it.
    expect(gate.shouldBuild({ nowMs: 1056 })).toBe(true);
  });
});
