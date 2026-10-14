import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AudioCompute } from "./compute.ts";
import {
  decodeWavBytes,
  encodeWav24,
  peak,
  rms,
  type Pcm,
} from "./chop/pcm.ts";
import { gain, filter } from "./chop/ops.ts";
import { runChop } from "./chop/run.ts";
import type { CommandRunner } from "../auth/runner.ts";

const noTools: CommandRunner = {
  which: () => undefined,
  run: async () => {
    throw new Error("unexpected external tool");
  },
};
const source = (): Pcm => ({
  sampleRate: 8000,
  channels: [
    Float32Array.from(
      { length: 16000 },
      (_, i) => Math.sin(i / 8) * Math.exp(-(i % 4000) / 350) * 0.7,
    ),
    Float32Array.from(
      { length: 16000 },
      (_, i) => Math.cos(i / 11) * Math.exp(-(i % 4000) / 350) * 0.5,
    ),
  ],
});

test("retained chop keeps PCM in worker and only transfers final WAV bytes", async () => {
  const compute = new AudioCompute(undefined, { retainChopBuffers: true });
  const bytes = encodeWav24(source());
  const expected = decodeWavBytes(bytes);
  try {
    const pcm = await compute.chop.decodeWavBytes(bytes);
    expect(pcm.channels).toHaveLength(2);
    expect(pcm.channels[0]!.length).toBe(16000);
    expect(ArrayBuffer.isView(pcm.channels[0])).toBe(false);
    expect(Object.isFrozen(pcm.channels[0])).toBe(true);
    expect(() => pcm.channels[0]![0]).toThrow("use compute.chop operations");
    expect(() => pcm.channels[0]!.map((value) => value)).toThrow(
      "use compute.chop operations",
    );
    const baseline = await compute.chopMemory();
    expect(baseline.retainedBytes).toBe(2 * 16000 * 4);
    expect(await compute.chop.peak(pcm)).toBe(peak(expected));
    expect(await compute.chop.rms(pcm)).toBe(rms(expected));
    expect(await compute.chopMemory()).toEqual(baseline);
    const result = await compute.chop.filter(
      await compute.chop.gain(pcm, -3),
      "lowpass",
      1200,
    );
    const encoded = await compute.chop.encodeWav24(result);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(
      Buffer.from(encoded).equals(
        Buffer.from(encodeWav24(filter(gain(expected, -3), "lowpass", 1200))),
      ),
    ).toBe(true);
    expect(bytes.length).toBeGreaterThan(0);
    expect(await compute.chopMemory()).toMatchObject({
      retainedBytes: baseline.retainedBytes * 3,
      buffers: 6,
    });
    await compute.clearChopBuffers();
    expect(await compute.chopMemory()).toMatchObject({
      retainedBytes: 0,
      buffers: 0,
    });
    const stale = await compute.chop.peak(pcm).catch((error) => error);
    expect(stale.message).toContain("another or disposed job");
  } finally {
    compute.dispose();
  }
});

test("retained handles cannot cross owners or be forged by copying descriptors", async () => {
  const first = new AudioCompute(undefined, { retainChopBuffers: true });
  const second = new AudioCompute(undefined, { retainChopBuffers: true });
  try {
    const pcm = await first.chop.decodeWavBytes(encodeWav24(source()));
    const foreign = await second.chop.peak(pcm).catch((error) => error);
    expect(foreign.message).toContain("another or disposed job");
    const forged = {
      ...pcm,
      channels: [{ ...pcm.channels[0] }],
    } as unknown as Pcm;
    const failure = await first.chop.peak(forged).catch((error) => error);
    expect(failure.message).toContain("another or disposed job");
    expect(await first.chop.peak(pcm)).toBeGreaterThan(0);
  } finally {
    first.dispose();
    second.dispose();
  }
});

test("retained buffer limit rejects atomically and permits bounded recovery", async () => {
  const bytes = encodeWav24(source());
  const compute = new AudioCompute(undefined, {
    retainChopBuffers: true,
    chopBufferLimitBytes: 128000,
  });
  try {
    const pcm = await compute.chop.decodeWavBytes(bytes);
    const before = await compute.chopMemory();
    const failure = await compute.chop.gain(pcm, -3).catch((error) => error);
    expect(failure.message).toContain("shorten the input or split");
    expect(await compute.chopMemory()).toEqual(before);
    expect(await compute.chop.peak(pcm)).toBeGreaterThan(0);
    // Returning an alias needs no additional backing storage.
    const same = await compute.chop.resample(pcm, pcm.sampleRate);
    expect(await compute.chopMemory()).toEqual(before);
    expect(await compute.chop.peak(same)).toBe(await compute.chop.peak(pcm));
    await compute.clearChopBuffers();
    expect((await compute.chop.decodeWavBytes(bytes)).channels[0]!.length).toBe(
      16000,
    );
  } finally {
    compute.dispose();
  }
});

test("cancellation rejects retained computations and destroys their owner", async () => {
  const controller = new AbortController();
  const compute = new AudioCompute(controller.signal, {
    retainChopBuffers: true,
  });
  const pcm = await compute.chop.decodeWavBytes(encodeWav24(source()));
  const pending = compute.chop.gain(pcm, -3);
  controller.abort();
  const failure = await pending.catch((error) => error);
  expect(failure.name).toBe("AbortError");
  expect((await compute.chopMemory().catch((error) => error)).name).toBe(
    "AbortError",
  );
  compute.dispose();
});

test("real chop workflows have identical outputs with retained worker PCM", async () => {
  const root = await mkdtemp(join(tmpdir(), "dawg-retained-"));
  await writeFile(join(root, "input.wav"), encodeWav24(source()));
  const ctx = {
    root,
    runner: noTools,
    history: undefined,
    signal: new AbortController().signal,
  };
  const cases = [
    ["info", {}],
    ["peaks", { count: 16 }],
    ["cut", { from: 0.12, to: 1.6 }],
    ["slice", { method: "grid", count: 4 }],
    ["trim", {}],
    ["split", {}],
    ["convert", { channels: 1, rate: 16000 }],
    ["convert", { channels: 2 }],
    ["gain", { db: -3 }],
    ["filter", { kind: "lowpass", hz: 1200 }],
    ["reverse", {}],
    ["loop", { from: 0, to: 1, crossfadeMs: 10 }],
  ] as const;
  try {
    for (const [op, args] of cases) {
      const compute = new AudioCompute(undefined, { retainChopBuffers: true });
      try {
        const inline = await runChop(op, { input: "input.wav", ...args }, ctx);
        const worker = await runChop(
          op,
          { input: "input.wav", ...args },
          { ...ctx, compute: compute.chop },
        );
        expect(worker.outputs.map((output) => output.sha256)).toEqual(
          inline.outputs.map((output) => output.sha256),
        );
        expect(worker.info).toEqual(inline.info);
        expect(worker.peaks).toEqual(inline.peaks);
        for (let i = 0; i < worker.outputs.length; i++) {
          const a = await readFile(join(root, worker.outputs[i]!.path));
          const b = await readFile(join(root, inline.outputs[i]!.path));
          expect(a.equals(b)).toBe(true);
        }
        expect((await compute.chopMemory()).retainedBytes).toBeGreaterThan(0);
      } finally {
        compute.dispose();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
