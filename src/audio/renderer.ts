import type { TrackScore } from "../../core/score.ts";
import type { MasterReport } from "./master.ts";
import type { RenderReply, RenderRequest } from "./render-worker.ts";
import { SampleLibrary, hasSamplerTracks } from "./samples.ts";
import { renderArranged } from "./arrange.ts";
import { StemRenderer, type MonitorRange } from "./wav.ts";
import { LoopCache, loopCacheKey } from "./loop-cache.ts";
import { WindowCache } from "./window-cache.ts";

export type LoopRender = Readonly<{
  monitor?: MonitorRange;
  pcm: Int16Array;
  frames: number;
  sampleRate: number;
  /** Milliseconds the render itself took (worker or inline). */
  renderMs: number;
  /** Loudness after the song master; absent without one. */
  master?: MasterReport;
}>;

export type LoopRendererOptions = Readonly<{
  sampleRate: number;
  /** Set false to render on the calling thread (tests, diagnostics). */
  worker?: boolean;
  /**
   * Project root sampler voices resolve under (decoded in the worker, or
   * inline on fallback). Without it sampler tracks render silent.
   */
  projectRoot?: string;
  /** Retained finished PCM budget; zero disables it (diagnostics). */
  maxLoopCacheBytes?: number;
  maxWindowCacheBytes?: number;
}>;

/**
 * Renders loops for the engine off the main thread. A single long-lived
 * worker owns a stem cache; the PCM buffer comes back transferred, not
 * copied. If the worker cannot start or crashes, rendering falls back to the
 * calling thread with its own cache, so sound never depends on the worker.
 */
export class LoopRenderer {
  private readonly sampleRate: number;
  private readonly useWorker: boolean;
  private worker: Bun.Worker | undefined;
  private workerBroken = false;
  private inline: StemRenderer | undefined;
  private library: SampleLibrary | undefined;
  private readonly projectRoot: string | undefined;
  private readonly maxLoopCacheBytes: number | undefined;
  private readonly loopCache: LoopCache;
  private readonly windowCache: WindowCache;
  private readonly maxWindowCacheBytes: number | undefined;
  private nextId = 1;
  private epoch = 0;
  private readonly pending = new Map<
    number,
    { resolve: (render: LoopRender) => void; reject: (error: Error) => void }
  >();
  private disposed = false;

  public constructor(options: LoopRendererOptions) {
    this.sampleRate = options.sampleRate;
    this.useWorker = options.worker ?? true;
    this.projectRoot = options.projectRoot;
    this.maxLoopCacheBytes = options.maxLoopCacheBytes;
    this.loopCache = new LoopCache(options.maxLoopCacheBytes);
    this.maxWindowCacheBytes = options.maxWindowCacheBytes;
    this.windowCache = new WindowCache(options.maxWindowCacheBytes);
  }

  /** True while renders run in the worker. */
  public get offThread(): boolean {
    return this.useWorker && !this.workerBroken;
  }

  public async render(
    score: TrackScore,
    monitorFrame?: number,
  ): Promise<LoopRender> {
    if (this.disposed) throw new Error("renderer disposed");
    const epoch = this.epoch;
    if (this.offThread) {
      try {
        return await this.renderInWorker(score, monitorFrame);
      } catch (error) {
        if (this.disposed) throw error;
        if (!(error instanceof WorkerLostError)) throw error;
      }
    }
    return this.renderInline(score, epoch, monitorFrame);
  }

  /** Cancel pending work without discarding an idle worker's finished cache. */
  public cancelPending(): void {
    this.epoch += 1;
    if (this.pending.size > 0)
      this.failWorker(new RenderCancelledError("render cancelled"), false);
  }

  /** Stops the worker and rejects in-flight renders without starting new work. */
  public dispose(): void {
    this.disposed = true;
    this.failWorker(new WorkerLostError("renderer disposed"));
    this.loopCache.clear();
    this.windowCache.clear();
    this.inline = undefined;
    this.library = undefined;
  }

  private async renderInline(
    score: TrackScore,
    epoch: number,
    monitorFrame?: number,
  ): Promise<LoopRender> {
    this.inline ??= new StemRenderer();
    const started = performance.now();
    let samples;
    if (this.projectRoot !== undefined && hasSamplerTracks(score)) {
      this.library ??= new SampleLibrary({ projectRoot: this.projectRoot });
      samples = await this.library.load(score);
    }
    if (this.disposed) throw new Error("renderer disposed");
    if (epoch !== this.epoch)
      throw new RenderCancelledError("render cancelled");
    const key =
      monitorFrame === undefined
        ? loopCacheKey(score, this.sampleRate, samples)
        : undefined;
    const cached = key === undefined ? undefined : this.loopCache.get(key);
    const audio =
      cached ??
      renderArranged(this.inline, score, {
        sampleRate: this.sampleRate,
        loop: true,
        // The live loop sounds a vocal track's guide notes (0.7 clips).
        guide: true,
        samples,
        windowCache: this.windowCache,
        monitorFrame,
      });
    if (!cached && key !== undefined) this.loopCache.set(key, audio);
    return {
      ...(audio.monitor ? { monitor: audio.monitor } : {}),
      pcm: audio.pcm,
      frames: audio.frames,
      sampleRate: audio.sampleRate,
      renderMs: performance.now() - started,
      ...(audio.master ? { master: audio.master } : {}),
    };
  }

  private renderInWorker(
    score: TrackScore,
    monitorFrame?: number,
  ): Promise<LoopRender> {
    const worker = this.ensureWorker();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<LoopRender>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const request: RenderRequest = {
        id,
        monitorFrame,
        score: score.toJSON(),
        sampleRate: this.sampleRate,
        maxLoopCacheBytes: this.maxLoopCacheBytes,
        maxWindowCacheBytes: this.maxWindowCacheBytes,
        ...(this.projectRoot === undefined
          ? {}
          : { projectRoot: this.projectRoot }),
      };
      try {
        worker.postMessage(request);
      } catch (error) {
        this.failWorker(
          new WorkerLostError(
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    });
  }

  private ensureWorker(): Bun.Worker {
    if (this.worker) return this.worker;
    let worker: Bun.Worker;
    try {
      // The DOM lib's Worker type lacks Bun's `unref`; the runtime object is Bun's.
      worker = new Worker(
        new URL("./render-worker.ts", import.meta.url).href,
      ) as unknown as Bun.Worker;
    } catch (error) {
      throw new WorkerLostError(
        error instanceof Error ? error.message : String(error),
      );
    }
    worker.addEventListener("message", (event: Event) => {
      const reply = (event as MessageEvent<RenderReply>).data;
      const waiter = this.pending.get(reply.id);
      if (!waiter) return;
      this.pending.delete(reply.id);
      if (reply.ok)
        waiter.resolve({
          ...(reply.monitor ? { monitor: reply.monitor } : {}),
          pcm: reply.pcm,
          frames: reply.frames,
          sampleRate: reply.sampleRate,
          renderMs: reply.renderMs,
          ...(reply.master ? { master: reply.master } : {}),
        });
      else waiter.reject(new Error(reply.error));
    });
    worker.addEventListener("error", (event: Event) => {
      if (this.worker !== worker) return;
      const message = (event as Partial<ErrorEvent>).message;
      this.failWorker(
        new WorkerLostError(
          typeof message === "string" ? message : "worker error",
        ),
      );
    });
    // A render worker never keeps the process alive on its own.
    worker.unref();
    this.worker = worker;
    return worker;
  }

  private failWorker(error: Error, broken = true): void {
    this.workerBroken = broken;
    const worker = this.worker;
    this.worker = undefined;
    worker?.terminate();
    const waiters = [...this.pending.values()];
    this.pending.clear();
    for (const waiter of waiters) waiter.reject(error);
  }
}

class WorkerLostError extends Error {}

/** An intentional cancellation must never trigger a costly inline fallback. */
export class RenderCancelledError extends Error {}
