import { describe, expect, spyOn, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore, type TrackScore } from "../../core/score.ts";
import {
  AudioEngine,
  SWAP_FADE_SECONDS,
  type AudioReadiness,
} from "./engine.ts";
import { MonitorBuffer } from "./monitor-buffer.ts";
import { LoopRenderer, type LoopRender } from "./renderer.ts";

const RATE = 8000;
const audio = (value = 1000): LoopRender => ({
  pcm: new Int16Array(RATE * 4).fill(value),
  frames: RATE * 2,
  sampleRate: RATE,
  renderMs: 0,
});
const score = (): TrackScore => createScore({ bars: 1 });
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function host(statuses: AudioReadiness[] = []) {
  const clock = { ms: 0 };
  let end = () => {};
  const engine = new AudioEngine({
    sampleRate: RATE,
    worker: false,
    timer: false,
    leadMs: 100,
    now: () => clock.ms,
    lockPath: join(
      tmpdir(),
      `dawg-readiness-${process.pid}-${Math.random()}.lock`,
    ),
    info: {
      backend: "command",
      streaming: true,
      command: ["fake"],
      detail: "test",
    },
    onReadiness: (status) => statuses.push(status),
    spawn: () => ({
      pid: 1,
      stdin: { write: () => {} },
      exited: new Promise<number>((resolve) => {
        end = () => resolve(0);
      }),
      kill: () => end(),
    }),
  });
  return { clock, engine, statuses };
}

describe("observed audio readiness", () => {
  test("play resolution does not claim an edit audible before queued PCM and its crossfade land", async () => {
    const render = spyOn(LoopRenderer.prototype, "render").mockResolvedValue(
      audio(),
    );
    const { engine, clock, statuses } = host();
    const first = score(),
      next = score();
    try {
      expect(engine.readiness.audibleScore).toBeNull();
      await engine.play(first, 0);
      expect(engine.readiness.audibleScore).toBeNull();
      clock.ms = 1;
      engine.pump();
      expect(engine.readiness.audibleScore).toBe(first);
      await engine.play(next, 0);
      expect(engine.readiness.audibleScore).toBe(first);
      expect(engine.readiness.pendingScore).toBe(next);
      clock.ms += 100 + SWAP_FADE_SECONDS * 1000 + 1;
      engine.pump();
      expect(engine.readiness.audibleScore).toBe(next);
      expect(engine.readiness.pendingScore).toBeNull();
      expect(engine.readiness.buffered).toEqual([{ fromBeat: 0, toBeat: 4 }]);
      expect(
        statuses.some(
          (status) =>
            status.pendingScore === next && status.audibleScore === first,
        ),
      ).toBe(true);
      expect(Object.isFrozen(engine.readiness)).toBe(true);
      expect(Object.isFrozen(engine.readiness.buffered)).toBe(true);
    } finally {
      await engine.dispose();
      render.mockRestore();
    }
  });

  test("a superseded render never appears as audible, even though its play promise resolves", async () => {
    const pending: ((value: LoopRender) => void)[] = [];
    const render = spyOn(LoopRenderer.prototype, "render").mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const { engine, clock, statuses } = host();
    const old = score(),
      latest = score();
    try {
      const a = engine.play(old),
        b = engine.play(latest);
      pending.shift()!(audio());
      await tick();
      expect(engine.readiness.audibleScore).toBeNull();
      pending.shift()!(audio(2000));
      await Promise.all([a, b]);
      clock.ms = 1;
      engine.pump();
      expect(engine.readiness.audibleScore).toBe(latest);
      expect(statuses.some((status) => status.audibleScore === old)).toBe(
        false,
      );
    } finally {
      await engine.dispose();
      render.mockRestore();
    }
  });

  test("stopping clears readiness immediately and a late render cannot restore it", async () => {
    let finish: (value: LoopRender) => void = () => {};
    const render = spyOn(LoopRenderer.prototype, "render").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { engine, statuses } = host();
    const draft = score();
    try {
      const play = engine.play(draft);
      expect(engine.readiness.pendingScore).toBe(draft);
      await engine.stopAsync();
      expect(engine.readiness).toMatchObject({
        pendingScore: null,
        audibleScore: null,
        buffered: [],
        preparing: false,
      });
      finish(audio());
      await play;
      expect(engine.readiness.audibleScore).toBeNull();
      expect(statuses.some((status) => status.audibleScore === draft)).toBe(
        false,
      );
    } finally {
      await engine.dispose();
      render.mockRestore();
    }
  });

  test("an edited render failure keeps the prior audible identity and reports the failure", async () => {
    const render = spyOn(LoopRenderer.prototype, "render").mockResolvedValue(
      audio(),
    );
    const { engine, clock } = host();
    const old = score(),
      next = score();
    try {
      await engine.play(old);
      clock.ms = 1;
      engine.pump();
      render.mockRejectedValueOnce(new Error("missing vocal asset"));
      await expect(engine.play(next)).rejects.toThrow("missing vocal asset");
      expect(engine.readiness).toMatchObject({
        audibleScore: old,
        pendingScore: next,
        preparing: false,
        error: "missing vocal asset",
      });
      await engine.stopAsync();
      expect(engine.readiness.error).toBeUndefined();
    } finally {
      await engine.dispose();
      render.mockRestore();
    }
  });

  test("progressive coverage excludes missing regions and a seek reports buffering honestly", async () => {
    let calls = 0;
    const render = spyOn(LoopRenderer.prototype, "render").mockImplementation(
      () => {
        if (calls++ === 0)
          return Promise.resolve({
            pcm: new Int16Array(RATE).fill(1000),
            frames: RATE / 2,
            sampleRate: RATE,
            renderMs: 0,
            monitor: { startFrame: 0, loopFrames: RATE * 2 },
          });
        return new Promise(() => {});
      },
    );
    const { engine, clock } = host();
    const draft = score();
    try {
      await engine.play(draft);
      clock.ms = 1;
      engine.pump();
      expect(engine.readiness.buffered).toEqual([{ fromBeat: 0, toBeat: 1 }]);
      engine.seek(3);
      clock.ms = 20;
      engine.pump();
      expect(engine.readiness.buffering).toBe(true);
      expect(engine.readiness.buffered).toEqual([{ fromBeat: 0, toBeat: 1 }]);
      expect(engine.readiness.audibleScore).toBe(draft);
    } finally {
      await engine.dispose();
      render.mockRestore();
    }
  });

  test("disabled audio never claims a successful play promise as audible", async () => {
    const engine = new AudioEngine({
      info: { backend: "none", streaming: false, detail: "disabled" },
      timer: false,
      worker: false,
    });
    try {
      await engine.play(score());
      expect(engine.readiness).toMatchObject({
        pendingScore: null,
        audibleScore: null,
        buffered: [],
      });
    } finally {
      await engine.dispose();
    }
  });
});

test("monitor coverage merges overlaps, keeps gaps, and owns immutable range snapshots", () => {
  const buffer = new MonitorBuffer(100, 128);
  const block = (from: number, frames: number): LoopRender => ({
    pcm: new Int16Array(frames * 2),
    frames,
    sampleRate: RATE,
    renderMs: 0,
    monitor: { startFrame: from, loopFrames: 100 },
  });
  buffer.add(block(0, 10));
  buffer.add(block(8, 10));
  buffer.add(block(30, 10));
  const ranges = buffer.ranges();
  expect(ranges).toEqual([
    { fromFrame: 0, toFrame: 18 },
    { fromFrame: 30, toFrame: 40 },
  ]);
  expect(Object.isFrozen(ranges[0])).toBe(true);
  buffer.add(block(60, 10));
  expect(buffer.ranges()).toEqual([
    { fromFrame: 8, toFrame: 18 },
    { fromFrame: 30, toFrame: 40 },
    { fromFrame: 60, toFrame: 70 },
  ]);
  expect(ranges).toEqual([
    { fromFrame: 0, toFrame: 18 },
    { fromFrame: 30, toFrame: 40 },
  ]);
});
