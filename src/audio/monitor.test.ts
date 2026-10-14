import { expect, spyOn, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import {
  loopSecondsOf,
  secondsAtTick,
  tickAtSeconds,
} from "../../core/tempo.ts";
import { normalizeMaster } from "../../core/master.ts";
import { renderArranged } from "./arrange.ts";
import { StemRenderer } from "./wav.ts";
import { applyMaster, applyMasterPcm, applyMonitorMaster } from "./master.ts";
import { MonitorBuffer } from "./monitor-buffer.ts";
import { WindowCache } from "./window-cache.ts";
import { LoopRenderer, type LoopRender } from "./renderer.ts";
import { AudioEngine } from "./engine.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RATE = 8000;
const song = () =>
  createScore({
    tempoBpm: 120,
    bars: 32,
    master: { target: -14 },
    tracks: [{ id: "a", name: "A", instrument: "sine" }],
    notes: Array.from({ length: 32 }, (_, bar) => ({
      id: `n${bar}`,
      trackId: "a",
      pitch: 60 + (bar % 12),
      startTick: bar * 1920,
      durationTicks: 960,
      velocity: 0.4,
    })),
  });
const block = (
  start: number,
  length: number,
  value: number,
  total = 100,
): LoopRender => ({
  pcm: new Int16Array(length * 2).fill(value),
  sampleRate: RATE,
  frames: length,
  renderMs: 0,
  monitor: { startFrame: start, loopFrames: total },
});

test("direct PCM master input preserves the old float input exactly", () => {
  const pcm = Int16Array.from({ length: RATE * 2 }, (_, i) =>
    Math.round(Math.sin(i * 0.14) * 10000),
  );
  const left = Float64Array.from(
    { length: RATE },
    (_, i) => pcm[i * 2]! / 32767,
  );
  const right = Float64Array.from(
    { length: RATE },
    (_, i) => pcm[i * 2 + 1]! / 32767,
  );
  const master = normalizeMaster({ target: -16, limiter: {} })!;
  for (const loop of [false, true]) {
    const expected = applyMaster(left, right, RATE, RATE, master, loop)!;
    const actual = applyMasterPcm(pcm, RATE, RATE, master, loop)!;
    expect(actual.left).toEqual(expected.left);
    expect(actual.right).toEqual(expected.right);
    expect(actual.report).toEqual(expected.report);
  }
});

test("monitoring ignores the global target and retains fixed master controls", () => {
  const pcm = Int16Array.from({ length: RATE }, (_, i) =>
    Math.round(Math.sin(i * 0.14) * 10000),
  );
  expect(
    applyMonitorMaster(pcm, RATE, normalizeMaster({ target: -14 })),
  ).toEqual(applyMonitorMaster(pcm, RATE, normalizeMaster({ target: -24 })));
  const fixed = normalizeMaster({ target: -14, limiter: { gain: 6 } })!;
  expect(applyMonitorMaster(pcm, RATE, fixed)).not.toEqual(pcm);
});

test("cursor monitoring bounds work and skips unrelated early windows", () => {
  const render = spyOn(StemRenderer.prototype, "render");
  try {
    const score = song(),
      cache = new WindowCache();
    const first = renderArranged(
      new StemRenderer({ maxCacheBytes: 0 }),
      score,
      {
        sampleRate: RATE,
        loop: true,
        guide: true,
        monitorFrame: 40 * RATE,
        windowCache: cache,
      },
    );
    expect(first.monitor!.startFrame).toBeLessThanOrEqual(40 * RATE);
    expect(first.monitor!.startFrame + first.frames).toBeGreaterThan(40 * RATE);
    expect(first.frames).toBeLessThanOrEqual(4.1 * RATE);
    expect(first.monitor!.loopFrames).toBe(64 * RATE);
    expect(first.master).toBeUndefined();
    expect(render.mock.calls.length).toBeLessThanOrEqual(2);
    const calls = render.mock.calls.length;
    const again = renderArranged(
      new StemRenderer({ maxCacheBytes: 0 }),
      score,
      {
        sampleRate: RATE,
        loop: true,
        guide: true,
        monitorFrame: 40 * RATE,
        windowCache: cache,
      },
    );
    expect(again.pcm).toEqual(first.pcm);
    expect(render.mock.calls.length).toBe(calls);
  } finally {
    render.mockRestore();
  }
});

test("monitor buffers blend overlap, zero gaps and retain a bounded number of chunks", () => {
  const buffer = new MonitorBuffer(100, 40 * 4);
  buffer.add(block(0, 20, 1000));
  buffer.add(block(15, 20, 2000));
  const pcm = new Int16Array(40 * 2);
  expect(buffer.copy(0, 40, pcm)).toBe(false);
  expect(pcm[0]).toBe(1000);
  expect(pcm[34 * 2]).toBe(2000);
  expect(pcm[39 * 2]).toBe(0);
  expect(Math.abs(pcm[15 * 2]! - 1000)).toBeLessThan(400);
  buffer.add(block(35, 20, 3000));
  expect(buffer.bytes).toBeLessThanOrEqual(160);
  expect(buffer.at(0)).toBeUndefined();
});

test("near-seam monitoring retains a full window of runway, including the loop boundary", () => {
  for (const bars of [32, 33]) {
    const score = createScore({ ...song().toJSON(), bars });
    const total = bars * 2 * RATE;
    for (const target of [
      4 * RATE - 1,
      40 * RATE - 1,
      64 * RATE - 1,
      total - 1,
    ]) {
      const render = renderArranged(new StemRenderer(), score, {
        sampleRate: RATE,
        loop: true,
        monitorFrame: target,
        windowCache: new WindowCache(),
      });
      const buffer = new MonitorBuffer(total);
      buffer.add({ ...render, renderMs: 0 });
      const beforeWrap = Math.min(4 * RATE, total - target);
      const out = new Int16Array(4 * RATE * 2);
      expect(buffer.copy(target, beforeWrap, out)).toBe(true);
      if (beforeWrap < 4 * RATE)
        expect(buffer.copy(0, 4 * RATE - beforeWrap, out, beforeWrap)).toBe(
          true,
        );
      expect(render.frames).toBeLessThanOrEqual(8.1 * RATE);
      expect(buffer.bytes).toBe(render.pcm.byteLength);
    }
  }
});

test("wrapped monitor chunks own bounded allocations and preserve their samples", () => {
  const buffer = new MonitorBuffer(100, 40 * 4);
  const render = block(90, 20, 1234);
  buffer.add(render);
  expect(buffer.bytes).toBe(20 * 4);
  expect(buffer.at(90)!.end).toBe(100);
  expect(buffer.at(0)!.end).toBe(10);
  render.pcm.fill(0);
  expect(buffer.sample(99, 0)).toBe(1234);
  expect(buffer.sample(0, 0)).toBe(1234);
  expect(buffer.at(90)!.pcm.buffer.byteLength).toBe(10 * 4);
  expect(buffer.at(0)!.pcm.buffer.byteLength).toBe(10 * 4);
});

test("worker monitoring preserves range metadata without caching a partial loop as complete", async () => {
  const renderer = new LoopRenderer({ sampleRate: RATE });
  try {
    const score = song();
    const partial = await renderer.render(score, 32 * RATE);
    expect(partial.monitor!.loopFrames).toBe(64 * RATE);
    expect(partial.frames).toBeLessThan(5 * RATE);
    const exact = await renderer.render(score);
    expect(exact.monitor).toBeUndefined();
    expect(exact.frames).toBe(64 * RATE);
    expect(exact.master).toBeDefined();
  } finally {
    renderer.dispose();
  }
});

test("a superseded first result cannot start the sink", async () => {
  const pending: ((render: LoopRender) => void)[] = [];
  const render = spyOn(LoopRenderer.prototype, "render").mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  let starts = 0,
    end = () => {};
  const engine = new AudioEngine({
    sampleRate: RATE,
    worker: false,
    timer: false,
    lockPath: join(tmpdir(), `dawg-monitor-stale-${process.pid}.lock`),
    info: {
      backend: "command",
      streaming: true,
      command: ["fake"],
      detail: "test",
    },
    spawn: () => {
      starts++;
      return {
        pid: 1,
        stdin: { write: () => {} },
        exited: new Promise<number>((resolve) => {
          end = () => resolve(0);
        }),
        kill: () => end(),
      };
    },
  });
  try {
    const first = engine.play(createScore({ bars: 1 }), 0);
    const latest = engine.play(createScore({ bars: 2 }), 0);
    pending.shift()!({
      pcm: new Int16Array(4),
      frames: 2,
      sampleRate: RATE,
      renderMs: 0,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(starts).toBe(0);
    pending.shift()!({
      pcm: new Int16Array(4),
      frames: 2,
      sampleRate: RATE,
      renderMs: 0,
    });
    await Promise.all([first, latest]);
    expect(starts).toBe(1);
  } finally {
    await engine.dispose();
    render.mockRestore();
  }
});

test("native-clock monitoring reads ahead, seeks by cursor and stops pending refill", async () => {
  const requests: number[] = [];
  const render = spyOn(LoopRenderer.prototype, "render").mockImplementation(
    async (_score, frame) => {
      expect(frame).toBeDefined();
      requests.push(frame!);
      const start = Math.floor(frame! / (4 * RATE)) * 4 * RATE;
      return block(start, 4 * RATE, 1000, 64 * RATE);
    },
  );
  const chunks: Int16Array[] = [];
  let end = () => {};
  const engine = new AudioEngine({
    sampleRate: RATE,
    leadMs: 100,
    timer: false,
    now: () => 0,
    lockPath: join(tmpdir(), `dawg-monitor-native-${process.pid}.lock`),
    info: { backend: "native", streaming: true, detail: "test" },
    spawn: () => ({
      pid: 1,
      stdin: {
        write: (chunk) => {
          chunks.push(
            new Int16Array(
              chunk.buffer.slice(
                chunk.byteOffset,
                chunk.byteOffset + chunk.byteLength,
              ),
            ),
          );
        },
      },
      exited: new Promise<number>((resolve) => {
        end = () => resolve(0);
      }),
      kill: () => end(),
      clock: {
        queuedFrames: () => 0,
        slipFrames: () => 0,
        frameMs: (frame) => (frame * 1000) / RATE,
        timing: () => ({
          callbackMs: 0,
          heardMs: 0,
          frame: 0,
          outputLatencyMs: 0,
          underruns: 0,
          queuedFrames: 0,
          bufferFrames: 0,
          deviceRate: RATE,
        }),
      },
    }),
  });
  try {
    await engine.play(song(), 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(requests.slice(0, 2)).toEqual([0, 4 * RATE]);
    expect(chunks[0]!.some((sample) => sample !== 0)).toBe(true);
    expect(engine.audioNote).toContain("causal monitor");
    expect(engine.loudness).toBeUndefined();
    engine.seek(120);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(requests.some((frame) => frame >= 60 * RATE)).toBe(true);
    engine.pump();
    expect(chunks.at(-1)!.some((sample) => sample !== 0)).toBe(true);
    await engine.stopAsync();
    const stopped = requests.length;
    await Promise.resolve();
    engine.pump();
    await Promise.resolve();
    expect(requests.length).toBe(stopped);
  } finally {
    await engine.dispose();
    render.mockRestore();
  }
});

test("sub-bar monitor windows cover slow, compound, changing-tempo and held-beat cursors", () => {
  const scores = [
    createScore({ tempoBpm: 20, beatsPerBar: 16, bars: 4 }),
    createScore({
      tempoBpm: 20,
      beatsPerBar: 16,
      bars: 2,
      time: { meter: [{ bar: 0, beatsPerBar: 16, beatUnit: 1 }] },
    }),
    createScore({
      tempoBpm: 20,
      beatsPerBar: 16,
      bars: 4,
      time: {
        tempo: [{ tick: 7200, bpm: 40, ramp: "exp" }],
        fermatas: [{ tick: 14400, beats: 3 }],
      },
    }),
    createScore({
      tempoBpm: 20,
      beatsPerBar: 16,
      bars: 2,
      time: {
        meter: [{ bar: 0, beatsPerBar: 16, beatUnit: 1 }],
        fermatas: [{ tick: 11000, beats: 0.25 }],
      },
    }),
    createScore({
      tempoBpm: 20,
      beatsPerBar: 16,
      bars: 4,
      time: {
        meter: [
          { bar: 0, beatsPerBar: 16, beatUnit: 1 },
          { bar: 2, beatsPerBar: 3, beatUnit: 8 },
        ],
      },
    }),
  ];
  const render = spyOn(StemRenderer.prototype, "render");
  try {
    for (const score of scores) {
      const frames = Math.round(loopSecondsOf(score) * RATE);
      for (const target of [0, 40 * RATE, 80 * RATE, frames - 1]) {
        const audio = renderArranged(
          new StemRenderer({ maxCacheBytes: 0 }),
          score,
          { sampleRate: RATE, loop: true, monitorFrame: target },
        );
        expect(audio.monitor!.loopFrames).toBe(frames);
        expect(audio.monitor!.startFrame).toBeLessThanOrEqual(target);
        expect(audio.monitor!.startFrame + audio.frames).toBeGreaterThan(
          target,
        );
        expect(audio.frames).toBeLessThanOrEqual(8.1 * RATE);
      }
    }
    // Real notes at distant cursors must sound, including after a meter
    // transition and inside a held beat, rather than only reporting a range.
    for (const base of scores) {
      for (const seconds of [80, loopSecondsOf(base) - 4]) {
        const score = createScore({
          ...base.toJSON(),
          tracks: [{ id: "a", name: "A", instrument: "sine" }],
          notes: [
            {
              id: "n",
              trackId: "a",
              pitch: 60,
              startTick: Math.floor(tickAtSeconds(base, seconds + 0.2)),
              durationTicks: base.ticksPerBeat,
              velocity: 0.5,
            },
          ],
        });
        const audio = renderArranged(new StemRenderer(), score, {
          sampleRate: RATE,
          loop: true,
          monitorFrame: Math.floor(seconds * RATE),
        });
        const first = audio.pcm.findIndex((sample) => sample !== 0);
        expect(first).toBeGreaterThanOrEqual(0);
        const onset = Math.floor(first / 2) + audio.monitor!.startFrame;
        const expected = Math.round(
          secondsAtTick(score, score.notes[0]!.startTick) * RATE,
        );
        expect(Math.abs(onset - expected)).toBeLessThanOrEqual(2);
      }
    }
    for (const [, options] of render.mock.calls)
      expect(options!.maxSeconds).toBeLessThanOrEqual(60);
  } finally {
    render.mockRestore();
  }
});

test("sub-bar monitor slices keep odd-meter note, automation and form ticks integral", () => {
  const base = createScore({
    tempoBpm: 39,
    beatsPerBar: 5,
    ticksPerBeat: 96,
    bars: 32,
    tracks: [
      {
        id: "a",
        name: "A",
        instrument: "sine",
        volumeAutomation: [
          { tick: 0, value: 0.5 },
          { tick: 1000, value: 1 },
        ],
      },
    ],
    notes: [
      {
        id: "n",
        trackId: "a",
        pitch: 60,
        startTick: 800,
        durationTicks: 240,
        velocity: 0.5,
      },
    ],
  });
  for (const score of [
    base,
    createScore({
      ...base.toJSON(),
      sections: [{ name: "A", startBar: 0, bars: 32 }],
      form: [{ section: "A", repeat: 1 }],
    }),
  ]) {
    const result = renderArranged(new StemRenderer(), score, {
      sampleRate: RATE,
      loop: true,
      monitorFrame: 12 * RATE,
    });
    expect(result.monitor!.startFrame).toBeLessThanOrEqual(12 * RATE);
    expect(result.monitor!.startFrame + result.frames).toBeGreaterThan(
      12 * RATE,
    );
    expect(result.pcm.some((sample) => sample !== 0)).toBe(true);
  }
});

function monitorEngine(
  name: string,
  overrides: Partial<ConstructorParameters<typeof AudioEngine>[0]> = {},
) {
  const chunks: Int16Array[] = [];
  let close = () => {};
  const engine = new AudioEngine({
    sampleRate: RATE,
    worker: false,
    timer: false,
    now: () => 0,
    lockPath: join(tmpdir(), `dawg-monitor-${name}-${process.pid}.lock`),
    info: {
      backend: "command",
      streaming: true,
      command: ["fake"],
      detail: "test",
    },
    spawn: () => ({
      pid: 1,
      stdin: {
        write: (chunk) => {
          chunks.push(
            new Int16Array(
              chunk.buffer.slice(
                chunk.byteOffset,
                chunk.byteOffset + chunk.byteLength,
              ),
            ),
          );
        },
      },
      exited: new Promise<number>((resolve) => {
        close = () => resolve(0);
      }),
      kill: () => close(),
    }),
    ...overrides,
  });
  return { engine, chunks };
}

test("a newer seek wins when the initial render or an edited render completes", async () => {
  const pcm = new Int16Array(64 * RATE * 2).fill(1000);
  pcm.fill(3000, 32 * RATE * 2);
  const audio: LoopRender = {
    pcm,
    frames: 64 * RATE,
    sampleRate: RATE,
    renderMs: 0,
  };
  const pending: ((render: LoopRender) => void)[] = [];
  const render = spyOn(LoopRenderer.prototype, "render").mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  let now = 0;
  const { engine, chunks } = monitorEngine("seek-render", {
    progressive: false,
    now: () => now,
  });
  try {
    const first = engine.play(song(), 0);
    engine.seek(120);
    pending.shift()!(audio);
    await first;
    expect(chunks[0]!.every((sample) => sample === 3000)).toBe(true);
    engine.seek(0);
    const edit = engine.play(song(), 0);
    now = 10;
    engine.seek(120);
    now = 20;
    pending.shift()!(audio);
    await edit;
    now = 250;
    engine.pump();
    expect(chunks.at(-1)!.at(-1)).toBe(3000);
  } finally {
    await engine.dispose();
    render.mockRestore();
  }
});

test("non-covering monitor replies fail once instead of recursively refilling", async () => {
  let calls = 0;
  const render = spyOn(LoopRenderer.prototype, "render").mockImplementation(
    async () => {
      calls++;
      return block(0, 4 * RATE, 1000, 64 * RATE);
    },
  );
  const { engine } = monitorEngine("missing-coverage");
  try {
    await engine.play(song(), 0);
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    expect(calls).toBe(2);
    expect(engine.audioNote).toContain("unavailable");
    engine.pump();
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    expect(calls).toBe(2);
    await engine.stopAsync();
    await expect(engine.play(song(), 120)).rejects.toThrow("did not cover");
    expect(calls).toBe(3);
  } finally {
    await engine.dispose();
    render.mockRestore();
  }
});
