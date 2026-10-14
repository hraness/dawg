import { createHash } from "node:crypto";
import { withWavComment } from "./packs.ts";
import { expect, test } from "bun:test";
import { createScore, ScoreValidationError } from "../../core/score.ts";
import { AudioCompute } from "./compute.ts";
import { AudioJobs } from "./jobs.ts";
import { renderExportAudio } from "./export-audio.ts";
import { renderResample } from "./resample.ts";
import { pitchTs, filter } from "./chop/ops.ts";

const song = () =>
  createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [{ id: "bass", name: "Bass", instrument: "bass" }],
    notes: [
      {
        id: "n",
        trackId: "bass",
        pitch: 48,
        startTick: 0,
        durationTicks: 480,
        velocity: 0.6,
      },
    ],
  });

test("worker export preserves complete WAV, cues, meter and caller ownership", async () => {
  const score = song();
  const compute = new AudioCompute();
  try {
    const expected = renderExportAudio(
      score.toJSON(),
      undefined,
      8000,
      true,
      true,
    );
    const actual = await compute.export(score, undefined, 8000, true, true);
    expect(actual).toEqual(expected);
    const attributed = await compute.export(
      score,
      undefined,
      8000,
      true,
      true,
      "samples: original sound",
    );
    const expectedAttributed = withWavComment(
      expected.wav,
      "samples: original sound",
    );
    expect(attributed.wav).toEqual(expectedAttributed);
    expect(attributed.sha256).toBe(
      createHash("sha256").update(expectedAttributed).digest("hex"),
    );
    actual.wav.fill(0);
    expect(
      (await compute.export(score, undefined, 8000, true, false)).wav,
    ).toEqual(expected.wav);
  } finally {
    compute.dispose();
  }
});

test("worker resample preserves PCM and typed validation failures", async () => {
  const compute = new AudioCompute();
  try {
    const request = {
      source: { kind: "track" as const, trackId: "bass" },
      range: { kind: "song" as const },
    };
    const expected = renderResample(song(), request);
    const actual = await compute.resample(song(), request);
    expect({ ...actual, wav: undefined }).toEqual({
      ...expected,
      wav: undefined,
    });
    expect(Buffer.from(actual.wav).equals(Buffer.from(expected.wav))).toBe(
      true,
    );
    const failure = await compute
      .resample(song(), {
        ...request,
        source: { kind: "track", trackId: "missing" },
      })
      .catch((error) => error);
    expect(failure).toBeInstanceOf(ScoreValidationError);
    expect(failure.code).toBe("invalid-track");
  } finally {
    compute.dispose();
  }
});

test("sample computation stays exact and does not detach the source", async () => {
  const compute = new AudioCompute();
  const pcm = {
    sampleRate: 8000,
    channels: [
      Float32Array.from({ length: 800 }, (_, i) => Math.sin(i / 8) / 2),
    ],
  };
  try {
    expect(await compute.chop.filter(pcm, "lowpass", 800)).toEqual(
      filter(pcm, "lowpass", 800),
    );
    expect(await compute.chop.pitchTs(pcm, 3, false)).toEqual(
      pitchTs(pcm, 3, false),
    );
    expect(pcm.channels[0]!.length).toBe(800);
  } finally {
    compute.dispose();
  }
});

test("cancel rejects queued work, releases its owner, and a new job works", async () => {
  const statuses: (string | undefined)[] = [];
  const jobs = new AudioJobs((label) => statuses.push(label));
  const pending = jobs.run("export", async (job) => {
    job.progress("rendering");
    return job.compute.export(song(), undefined, 8000, true, false);
  });
  expect(jobs.busy).toBe(true);
  await expect(jobs.run("another", async () => 0)).rejects.toThrow(
    "export is running",
  );
  expect(jobs.cancel()).toBe(true);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(jobs.busy).toBe(false);
  expect(statuses.at(-1)).toBeUndefined();
  expect(
    await jobs.run(
      "retry",
      async (job) =>
        (await job.compute.export(song(), undefined, 8000, false, false))
          .frames,
    ),
  ).toBeGreaterThan(0);
});

test("shutdown waits for cancelled file cleanup and refuses further work", async () => {
  const jobs = new AudioJobs();
  let cleaned = false;
  let finishCleanup!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    finishCleanup = resolve;
  });
  const work = jobs
    .run("export", async ({ signal }) => {
      try {
        await new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      } finally {
        await cleanup;
        cleaned = true;
      }
    })
    .catch((error) => error);
  let stopped = false;
  const stop = jobs.shutdown().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  expect(cleaned).toBe(false);
  await expect(jobs.run("new", async () => undefined)).rejects.toThrow(
    "audio jobs stopped",
  );
  finishCleanup();
  await stop;
  expect(cleaned).toBe(true);
  expect(jobs.busy).toBe(false);
  expect(await work).toMatchObject({ name: "AbortError" });
  await jobs.shutdown();
});

test("failed status rendering still settles job ownership", async () => {
  const jobs = new AudioJobs((status) => {
    if (status) throw new Error("frame failed");
  });
  await expect(jobs.run("export", async () => undefined)).rejects.toThrow(
    "frame failed",
  );
  expect(jobs.busy).toBe(false);
  await jobs.shutdown();
});
