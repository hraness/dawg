/**
 * Render a score and measure the result: the shared path behind
 * `master measure`, `dawg render`'s loudness line and the measure_mix agent
 * tool. The loop is measured as a loop playing forever (its steady state),
 * a one-shot as rendered, so every reading matches what playback and export
 * produce. Measuring never changes the score.
 */
import type { TrackScore } from "../../core/score.ts";
import type { MeasureReply, MeasureRequest } from "./measure-worker.ts";
import { measureMix, pcmChannels, type MixMeasurement } from "./loudness.ts";
import type { MasterReport } from "./master.ts";
import {
  DEFAULT_SAMPLE_RATE,
  renderScorePcm,
  type RenderedAudio,
  type RenderOptions,
} from "./wav.ts";

/** The rate a song with a master exports (and is measured) at. */
export const MASTER_SAMPLE_RATE = 48_000;

/**
 * The rate `dawg render` writes and measurements use, so a reading matches
 * the exported file: 48 kHz once the song has a master (a deliverable, with
 * room for the high shelf and a true peak a platform's resampler will not
 * raise), the engine's 22,050 Hz otherwise (dawg 0.4 exports unchanged).
 */
export function exportSampleRate(score: TrackScore): number {
  return score.master ? MASTER_SAMPLE_RATE : DEFAULT_SAMPLE_RATE;
}

export type ScoreMeasurement = Readonly<{
  mix: MixMeasurement;
  master?: MasterReport;
  sampleRate: number;
  seconds: number;
  loop: boolean;
}>;

/** Measure audio rendered elsewhere (the export, a preview). */
export function measureRendered(
  audio: RenderedAudio,
  loop: boolean,
): ScoreMeasurement {
  const [left, right] = pcmChannels(audio.pcm);
  return Object.freeze({
    mix: measureMix(left, right, audio.sampleRate, { loop }),
    ...(audio.master ? { master: audio.master } : {}),
    sampleRate: audio.sampleRate,
    seconds: audio.frames / audio.sampleRate,
    loop,
  });
}

/** Render `score` (as a loop by default) and measure it. */
export function measureScore(
  score: TrackScore,
  options: RenderOptions = {},
): ScoreMeasurement {
  const loop = options.loop ?? true;
  const audio = renderScorePcm(score, {
    sampleRate: exportSampleRate(score),
    ...options,
    loop,
  });
  return measureRendered(audio, loop);
}

/**
 * `measureScore` in a worker, so the caller's thread keeps running; falls
 * back to measuring inline if the worker cannot start or fails.
 */
export async function measureScoreOffThread(
  score: TrackScore,
  options: Readonly<{
    sampleRate?: number;
    loop?: boolean;
    projectRoot?: string;
  }> = {},
): Promise<ScoreMeasurement> {
  let worker: Worker | undefined;
  try {
    worker = new Worker(new URL("./measure-worker.ts", import.meta.url).href);
    const running = worker;
    const reply = await new Promise<MeasureReply>((resolve, reject) => {
      running.addEventListener("message", (event) =>
        resolve((event as MessageEvent<MeasureReply>).data),
      );
      running.addEventListener("error", (event) =>
        reject(new Error((event as ErrorEvent).message ?? "worker error")),
      );
      const request: MeasureRequest = {
        score: score.toJSON(),
        ...options,
      };
      running.postMessage(request);
    });
    if (reply.ok) return reply.measured;
    throw new Error(reply.error);
  } catch {
    return measureScore(score, {
      ...(options.sampleRate === undefined
        ? {}
        : { sampleRate: options.sampleRate }),
      ...(options.loop === undefined ? {} : { loop: options.loop }),
    });
  } finally {
    worker?.terminate();
  }
}
