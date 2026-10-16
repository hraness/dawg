import type { TrackScore } from "../../core/score.ts";
import { ScoreValidationError } from "../../core/score.ts";
import type { SampleBank } from "./samples.ts";
import type { ExportAudio } from "./export-audio.ts";
import type { ResampleRequest, ResampleRender } from "./resample.ts";
import { sampleBankData, type LiveSampleData } from "./live-samples.ts";
import type { RenderedAudio } from "./wav.ts";
import type { SoundStats } from "./preview.ts";
import type { ScoreMeasurement } from "./measure.ts";
import { chopComputer, type ChopComputation } from "./chop/compute.ts";

export const DEFAULT_CHOP_BUFFER_LIMIT_BYTES = 512 * 1024 * 1024;
export type AudioComputeOptions = Readonly<{
  /** Internal orchestration only: channels support length and forwarding, not local sample access. */
  retainChopBuffers?: boolean;
  /** Retained PCM budget; individual DSP operations can require additional transient memory. */
  chopBufferLimitBytes?: number;
}>;
export type ChopBufferHandle = Readonly<{
  __dawgAudioBuffer: number;
  owner: string;
  length: number;
  byteLength: number;
}>;
export type ChopBufferMemory = Readonly<{
  retainedBytes: number;
  buffers: number;
  limitBytes: number;
}>;
export type ComputeTask =
  | {
      kind: "export";
      score: unknown;
      samples?: LiveSampleData;
      sampleRate: number;
      cues: boolean;
      measure: boolean;
      comment?: string;
    }
  | {
      kind: "resample";
      score: unknown;
      request: ResampleRequest;
      samples?: LiveSampleData;
    }
  | {
      kind: "preview";
      score: unknown;
      samples?: LiveSampleData;
      sampleRate: number;
    }
  | {
      kind: "measure";
      score: unknown;
      samples?: LiveSampleData;
      options: { sampleRate?: number; loop?: boolean };
    }
  | {
      kind: "chop";
      name: ChopComputation;
      args: unknown[];
      retain?: { owner: string; limitBytes: number };
    }
  | { kind: "chop-memory" }
  | { kind: "chop-clear" };
export type ComputeReply =
  | { id: number; ok: true; value: unknown }
  | {
      id: number;
      ok: false;
      error: string;
      validation?: ScoreValidationError["code"];
    };

/** One foreground job owns one lazy worker. Cancellation never falls back to the UI thread. */
export class AudioCompute {
  private worker?: Bun.Worker;
  private nextId = 0;
  private disposed = false;
  private workerOpen = false;
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private readonly owner = crypto.randomUUID();
  private handles = new WeakMap<object, ChopBufferHandle>();
  private readonly options: AudioComputeOptions;
  private readonly abort = () =>
    this.dispose(new DOMException("audio job cancelled", "AbortError"));
  constructor(
    private readonly signal?: AbortSignal,
    options: AudioComputeOptions = {},
  ) {
    const limit =
      options.chopBufferLimitBytes ?? DEFAULT_CHOP_BUFFER_LIMIT_BYTES;
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("audio buffer limit must be a positive integer");
    this.options = { ...options, chopBufferLimitBytes: limit };
    signal?.addEventListener("abort", this.abort, { once: true });
  }

  readonly chop = chopComputer((name, args) =>
    this.run({
      kind: "chop",
      name,
      args: this.pack(args) as unknown[],
      ...(this.options.retainChopBuffers
        ? {
            retain: {
              owner: this.owner,
              limitBytes: this.options.chopBufferLimitBytes!,
            },
          }
        : {}),
    }),
  );

  async export(
    score: TrackScore,
    samples: SampleBank | undefined,
    sampleRate: number,
    cues: boolean,
    measure: boolean,
    comment?: string,
  ): Promise<ExportAudio> {
    return this.run({
      kind: "export",
      score: score.toJSON(),
      samples: samples ? await sampleBankData(samples, this.signal) : undefined,
      sampleRate,
      cues,
      measure,
      comment,
    }) as Promise<ExportAudio>;
  }

  async resample(
    score: TrackScore,
    request: ResampleRequest,
    samples?: SampleBank,
  ): Promise<ResampleRender> {
    return this.run({
      kind: "resample",
      score: score.toJSON(),
      request,
      samples: samples ? await sampleBankData(samples, this.signal) : undefined,
    }) as Promise<ResampleRender>;
  }

  async preview(
    score: TrackScore,
    samples: SampleBank | undefined,
    sampleRate: number,
  ): Promise<RenderedAudio & { stats: SoundStats }> {
    return this.run({
      kind: "preview",
      score: score.toJSON(),
      samples: samples ? await sampleBankData(samples, this.signal) : undefined,
      sampleRate,
    }) as Promise<RenderedAudio & { stats: SoundStats }>;
  }

  async measure(
    score: TrackScore,
    samples?: SampleBank,
    options: { sampleRate?: number; loop?: boolean } = {},
  ): Promise<ScoreMeasurement> {
    return this.run({
      kind: "measure",
      score: score.toJSON(),
      samples: samples ? await sampleBankData(samples, this.signal) : undefined,
      options,
    }) as Promise<ScoreMeasurement>;
  }

  chopMemory(): Promise<ChopBufferMemory> {
    return this.run({ kind: "chop-memory" }) as Promise<ChopBufferMemory>;
  }

  /** Invalidates all retained channels. Jobs normally release them together on dispose. */
  async clearChopBuffers(): Promise<void> {
    if (this.pending.size)
      throw new Error(
        "wait for audio computations before clearing their buffers",
      );
    await this.run({ kind: "chop-clear" });
    this.handles = new WeakMap();
  }

  private pack(value: unknown): unknown {
    if (
      !value ||
      typeof value !== "object" ||
      ArrayBuffer.isView(value) ||
      value instanceof ArrayBuffer
    )
      return value;
    const handle = this.handles.get(value);
    if (handle) return handle;
    if ("__dawgAudioBuffer" in value)
      throw new Error("audio buffer belongs to another or disposed job");
    if (Array.isArray(value)) return value.map((child) => this.pack(child));
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, this.pack(child)]),
    );
  }

  private unpack(value: unknown): unknown {
    if (
      !value ||
      typeof value !== "object" ||
      ArrayBuffer.isView(value) ||
      value instanceof ArrayBuffer
    )
      return value;
    if ("__dawgAudioBuffer" in value) {
      const handle = value as ChopBufferHandle;
      if (
        handle.owner !== this.owner ||
        !Number.isSafeInteger(handle.__dawgAudioBuffer) ||
        !Number.isSafeInteger(handle.length) ||
        handle.length < 0 ||
        handle.byteLength !== handle.length * 4
      )
        throw new Error("invalid retained audio buffer reply");
      // Opaque, frozen channel descriptors are confined to opted-in chop orchestration.
      // Numeric sample access must happen through the same worker's computations.
      const channel = new Proxy(Object.freeze({ ...handle }), {
        get(target, key, receiver) {
          if (
            !(key in target) &&
            (key === Symbol.iterator ||
              (typeof key === "string" &&
                (/^\d+$/.test(key) || key in Float32Array.prototype)))
          )
            throw new Error(
              "retained audio samples are worker-owned; use compute.chop operations",
            );
          return Reflect.get(target, key, receiver);
        },
      });
      this.handles.set(channel, handle);
      return channel;
    }
    if (Array.isArray(value)) return value.map((child) => this.unpack(child));
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, this.unpack(child)]),
    );
  }

  private run(task: ComputeTask): Promise<unknown> {
    if (this.signal?.aborted)
      return Promise.reject(
        new DOMException("audio job cancelled", "AbortError"),
      );
    if (this.disposed) return Promise.reject(new Error("audio job disposed"));
    if (!this.worker) {
      try {
        const worker = new Worker(
          new URL("./compute-worker.ts", import.meta.url).href,
        ) as unknown as Bun.Worker;
        worker.addEventListener("message", (event: Event) => {
          const reply = (event as MessageEvent<ComputeReply>).data;
          const pending = this.pending.get(reply.id);
          if (!pending) return;
          this.pending.delete(reply.id);
          if (reply.ok) {
            try {
              pending.resolve(this.unpack(reply.value));
            } catch (error) {
              pending.reject(
                error instanceof Error ? error : new Error(String(error)),
              );
            }
          } else
            pending.reject(
              reply.validation
                ? new ScoreValidationError(reply.error, reply.validation)
                : new Error(reply.error),
            );
        });
        worker.addEventListener("error", (event: Event) =>
          this.dispose(
            new Error((event as ErrorEvent).message || "audio worker failed"),
          ),
        );
        worker.addEventListener("close", () => {
          if (!this.disposed) this.dispose(new Error("audio worker closed"));
        });
        // Bun 1.3 can segfault when a worker is terminated while its modules
        // are still transpiling, so dispose waits for `open` to terminate.
        worker.addEventListener("open", () => {
          this.workerOpen = true;
          if (this.disposed) worker.terminate();
        });
        this.worker = worker;
      } catch (error) {
        this.dispose(error instanceof Error ? error : new Error(String(error)));
        return Promise.reject(error);
      }
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker!.postMessage({ id, task });
      } catch (error) {
        this.dispose(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose(error = new Error("audio job disposed")): void {
    if (this.disposed) return;
    this.disposed = true;
    this.signal?.removeEventListener("abort", this.abort);
    if (this.workerOpen) this.worker?.terminate();
    this.worker = undefined;
    this.handles = new WeakMap();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export async function withAudioCompute<T>(
  signal: AbortSignal | undefined,
  work: (compute: AudioCompute) => Promise<T>,
  options: AudioComputeOptions = {},
): Promise<T> {
  const compute = new AudioCompute(signal, options);
  try {
    return await work(compute);
  } finally {
    compute.dispose();
  }
}
