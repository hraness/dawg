import { expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { AudioCompute } from "./compute.ts";
import { renderScorePcm } from "./wav.ts";
import { analyzePcm } from "./preview.ts";
import { measureScore } from "./measure.ts";
import { renderExportAudio } from "./export-audio.ts";
import { renderResample } from "./resample.ts";
import { Wavetable, wavetableFromWav } from "./wavetable.ts";
import { sampleBankData, liveSamplesFromData } from "./live-samples.ts";
import type { SampleBank } from "./samples.ts";
import { wavBytes, withClm } from "./sample-fixtures.ts";

const score = (instrument = "pad", bars = 1) =>
  createScore({
    tempoBpm: 120,
    bars,
    tracks: [
      {
        id: "keys",
        name: "Keys",
        instrument,
        ...(instrument === "wavetable"
          ? {
              wavetable: { table: { src: "tracks/keys/custom.wav" }, wt: 0.4 },
            }
          : { reverb: { mix: 0.3, size: 0.8 } }),
      },
    ],
    notes: [
      {
        id: "n",
        trackId: "keys",
        pitch: 60,
        startTick: 0,
        durationTicks: bars * 1920,
        velocity: 0.7,
      },
    ],
  } as never);

test("preview worker preserves exact PCM, metadata and stats while timers run", async () => {
  const value = score("pad", 4);
  const expected = renderScorePcm(value, { sampleRate: 8000 });
  const stats = analyzePcm(expected.pcm, expected.sampleRate);
  const compute = new AudioCompute();
  let ticks = 0;
  const timer = setInterval(() => (ticks += 1), 1);
  try {
    const actual = await compute.preview(value, undefined, 8000);
    expect(actual).toEqual({ ...expected, stats });
    expect(ticks).toBeGreaterThan(0);
  } finally {
    clearInterval(timer);
    compute.dispose();
  }
});

test("preview, export and resample preserve captured file wavetable banks", async () => {
  const bytes = withClm(
    wavBytes(
      Array.from(
        { length: 4096 },
        (_, i) =>
          Math.sin((i * 2 * Math.PI) / 2048) * 0.7 +
          Math.sin((i * 6 * Math.PI) / 2048) * 0.2,
      ),
    ),
    2048,
  );
  const table = wavetableFromWav("custom", "captured-sha256", bytes);
  const bank: SampleBank = {
    voices: new Map(),
    problems: [],
    wavetables: new Map([["keys", table]]),
  };
  const value = score("wavetable");
  const source = table.spectrum(0).im.slice();
  const compute = new AudioCompute();
  try {
    const expected = renderScorePcm(value, { sampleRate: 8000, samples: bank });
    const preview = await compute.preview(value, bank, 8000);
    expect(preview).toEqual({
      ...expected,
      stats: analyzePcm(expected.pcm, expected.sampleRate),
    });
    expect(await compute.export(value, bank, 8000, false, false)).toEqual(
      renderExportAudio(value.toJSON(), bank, 8000, false, false),
    );
    const request = {
      source: { kind: "track" as const, trackId: "keys" },
      range: { kind: "song" as const },
    };
    expect(await compute.resample(value, request, bank)).toEqual(
      renderResample(value, request, bank),
    );
    expect(
      await compute.measure(value, bank, { sampleRate: 8000, loop: true }),
    ).toEqual(
      measureScore(value, { sampleRate: 8000, loop: true, samples: bank }),
    );
    expect(table.spectrum(0).im).toEqual(source);
    expect(table.gain()).toBeGreaterThan(0);
  } finally {
    compute.dispose();
  }
});

test("full-bank serialization yields between cold spectra and cancels promptly", async () => {
  let read = 0;
  const table = new Wavetable("custom", "captured", 512, () => {
    read += 1;
    return { re: new Float64Array([0, 0]), im: new Float64Array([0, 1]) };
  });
  const bank: SampleBank = {
    voices: new Map(),
    problems: [],
    wavetables: new Map([["keys", table]]),
  };
  const controller = new AbortController();
  const pending = sampleBankData(bank, controller.signal);
  setImmediate(() => controller.abort());
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(read).toBeGreaterThan(0);
  expect(read).toBeLessThan(512);
  const data = await sampleBankData(bank);
  const restored = liveSamplesFromData(structuredClone(data));
  expect(restored.wavetables!.get("keys")!.spectrum(511)).toEqual(
    table.spectrum(511),
  );
});

test("preview worker rejects abort before launch and in flight without a late result", async () => {
  for (const immediate of [true, false]) {
    const controller = new AbortController();
    if (immediate) controller.abort();
    const compute = new AudioCompute(controller.signal);
    try {
      const pending = compute.preview(score("pad", 4), undefined, 48000);
      if (!immediate) setTimeout(() => controller.abort(), 5);
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await expect(compute.preview(score(), undefined, 8000)).rejects.toThrow();
    } finally {
      compute.dispose();
    }
  }
});

test("measure worker preserves mastered loop and one-shot results", async () => {
  const mastered = score().withMaster({
    target: -14,
    limiter: { ceiling: -1 },
  });
  const compute = new AudioCompute();
  try {
    for (const loop of [true, false]) {
      expect(
        await compute.measure(mastered, undefined, { sampleRate: 8000, loop }),
      ).toEqual(measureScore(mastered, { sampleRate: 8000, loop }));
    }
  } finally {
    compute.dispose();
  }
});

test("measurement abort rejects queued and active workers without a late result", async () => {
  for (const immediate of [true, false]) {
    const controller = new AbortController();
    if (immediate) controller.abort();
    const compute = new AudioCompute(controller.signal);
    let resolved = false;
    try {
      if (!immediate)
        await compute.measure(score(), undefined, { sampleRate: 8000 });
      const pending = compute
        .measure(score("pad", 4), undefined, { sampleRate: 48000 })
        .then((value) => {
          resolved = true;
          return value;
        });
      if (!immediate) setTimeout(() => controller.abort(), 5);
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await Bun.sleep(10);
      expect(resolved).toBe(false);
      await expect(compute.measure(score())).rejects.toMatchObject({
        name: "AbortError",
      });
    } finally {
      compute.dispose();
    }
  }
});
