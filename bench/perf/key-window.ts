/** Compare the original live render policy with the interactive prefix. */
import { createScore } from "../../core/score.ts";
import { LiveFullRenderer, LiveSynth, warmLive } from "../../src/audio/live.ts";
import type { LiveFullRequest } from "../../src/audio/live-worker.ts";
import { sampleKey, type SampleBank } from "../../src/audio/samples.ts";
import { LIVE_CASES } from "./live.ts";
import { metric, table, type Metric } from "./stats.ts";

export function keyWindow(runs = 48): Metric[] {
  const result: Metric[] = [];
  for (const [name, track] of Object.entries(LIVE_CASES)) {
    const score = createScore({
      tempoBpm: 120,
      tracks: [{ id: "t", name, ...track }],
    } as never);
    warmLive(score, "t", 44_100);
    for (const seconds of [0.125, 8]) {
      const legacy = new LiveSynth(44_100);
      const interactive = new LiveSynth(44_100);
      const before: number[] = [];
      const after: number[] = [];
      for (let index = 0; index < runs; index += 1) {
        // Alternate order to keep process temperature/JIT bias symmetric.
        for (const firstWindow of index % 2 ? [true, false] : [false, true]) {
          const synth = firstWindow ? interactive : legacy;
          const started = performance.now();
          synth.render({
            score,
            trackId: "t",
            pitch: 36 + index,
            velocity: 0.8,
            seconds,
            firstWindow,
          });
          (firstWindow ? after : before).push(performance.now() - started);
        }
      }
      const kind = seconds === 8 ? "held" : "tap";
      result.push(
        metric(
          `window.before.${kind}.${name}`,
          `${name} ${kind}, original policy`,
          before,
        ),
        metric(
          `window.after.${kind}.${name}`,
          `${name} ${kind}, bounded prefix`,
          after,
        ),
      );
    }
  }
  return result;
}

/** Sync work handing cold notes to a ready worker with a 64 MiB unrelated sample. */
export async function keyDispatch(runs = 24): Promise<Metric[]> {
  const score = createScore({
    tracks: [{ id: "t", name: "Saw", instrument: "saw" }],
  });
  const mono = new Float32Array(16 * 1024 * 1024).fill(0.1);
  const samples = {
    voices: new Map([
      [
        sampleKey("unrelated", "sample"),
        {
          sha256: "unrelated",
          sampleRate: 8000,
          channels: 1,
          frames: mono.length,
          mono,
        },
      ],
    ]),
    problems: [],
  } satisfies SampleBank;
  const beforeWorker = new Worker(
    new URL("../../src/audio/live-worker.ts", import.meta.url).href,
  );
  const afterWorker = new LiveFullRenderer();
  const synth = new LiveSynth(8000);
  const before: number[] = [];
  const after: number[] = [];
  try {
    // First iteration starts both workers; report only subsequent dispatches.
    for (let i = 0; i <= runs; i += 1) {
      const request = {
        score,
        trackId: "t",
        pitch: 36 + i,
        velocity: 0.8,
        seconds: 0.125,
        samples,
      };
      for (const original of i % 2 ? [true, false] : [false, true]) {
        let ms: number;
        if (original) {
          const message: LiveFullRequest = {
            ...request,
            score: score.toJSON(),
            id: i + 1,
            sampleVersion: i + 1,
            sampleRate: 8000,
          };
          const pending = new Promise<void>((resolve, reject) => {
            beforeWorker.onmessage = () => resolve();
            beforeWorker.onerror = (event) => reject(event.error);
          });
          const start = performance.now();
          beforeWorker.postMessage(message);
          ms = performance.now() - start;
          await pending;
        } else {
          const start = performance.now();
          const pending = afterWorker.full(synth, request);
          ms = performance.now() - start;
          await pending;
        }
        if (i > 0) (original ? before : after).push(ms);
      }
    }
    return [
      metric(
        "dispatch.before.sample-bank",
        "worker dispatch, whole sample bank",
        before,
      ),
      metric(
        "dispatch.after.sample-bank",
        "worker dispatch, active track assets",
        after,
      ),
    ];
  } finally {
    beforeWorker.terminate();
    afterWorker.close();
  }
}

if (import.meta.main)
  console.log(
    table([
      ...(process.argv.includes("--dispatch-only") ? [] : keyWindow()),
      ...(await keyDispatch()),
    ]),
  );
