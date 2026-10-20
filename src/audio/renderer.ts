import { availableParallelism } from "node:os";
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
  /** Background monitor workers (default: by core count). */
  backgroundWorkers?: number;
}>;

/**
 * The shape of one monitor window: how many seconds it keeps beyond its
 * cursor, whether it trades pre-roll for speed, and whether it may run on a
 * background worker beside the foreground render.
 */
export type MonitorJob = Readonly<{
  seconds?: number;
  quick?: boolean;
  background?: boolean;
}>;

type Waiter = {
  resolve: (render: LoopRender) => void;
  reject: (error: Error) => void;
};

type Slot = {
  worker: Bun.Worker | undefined;
  broken: boolean;
  readonly pending: Map<number, Waiter>;
};

/**
 * Background monitor workers for this machine: up to three, leaving a core
 * for the main thread and one for the foreground render.
 */
export function defaultBackgroundWorkers(): number {
  return Math.max(1, Math.min(3, availableParallelism() - 2));
}

/**
 * Renders loops for the engine off the main thread. A long-lived foreground
 * worker owns a stem cache; background workers render monitor windows ahead
 * of the playhead in parallel, so a song that synthesizes slower than real
 * time on one core still streams without gaps. PCM comes back transferred,
 * not copied. If a worker cannot start or crashes, its work moves to the
 * foreground worker, then to the calling thread, so sound never depends on
 * a worker.
 */
export class LoopRenderer {
  private readonly sampleRate: number;
  private readonly useWorker: boolean;
  private readonly slots: Slot[];
  private readonly backgroundCount: number;
  private inline: StemRenderer | undefined;
  private library: SampleLibrary | undefined;
  private readonly projectRoot: string | undefined;
  private readonly maxLoopCacheBytes: number | undefined;
  private readonly loopCache: LoopCache;
  private readonly windowCache: WindowCache;
  private readonly maxWindowCacheBytes: number | undefined;
  private nextId = 1;
  private epoch = 0;
  private disposed = false;

  public constructor(options: LoopRendererOptions) {
    this.sampleRate = options.sampleRate;
    this.useWorker = options.worker ?? true;
    this.projectRoot = options.projectRoot;
    this.maxLoopCacheBytes = options.maxLoopCacheBytes;
    this.loopCache = new LoopCache(options.maxLoopCacheBytes);
    this.maxWindowCacheBytes = options.maxWindowCacheBytes;
    this.windowCache = new WindowCache(options.maxWindowCacheBytes);
    this.backgroundCount = Math.max(
      0,
      Math.floor(
        options.backgroundWorkers ??
          (this.useWorker ? defaultBackgroundWorkers() : 1),
      ),
    );
    const count = this.useWorker ? 1 + this.backgroundCount : 0;
    this.slots = Array.from({ length: count }, () => ({
      worker: undefined,
      broken: false,
      pending: new Map<number, Waiter>(),
    }));
  }

  /** True while renders run in the worker. */
  public get offThread(): boolean {
    return this.useWorker && !this.slots[0]!.broken;
  }

  /**
   * Monitor windows that can render at once in the background. Inline
   * rendering is serial, but honors a configured count so tests can model a
   * pool behind a mocked `render`.
   */
  public get backgroundSlots(): number {
    if (!this.useWorker) return Math.max(1, this.backgroundCount);
    const live = this.slots.slice(1).filter((slot) => !slot.broken).length;
    return Math.max(1, live);
  }

  public async render(
    score: TrackScore,
    monitorFrame?: number,
    job?: MonitorJob,
  ): Promise<LoopRender> {
    if (this.disposed) throw new Error("renderer disposed");
    const epoch = this.epoch;
    for (const slot of this.candidates(job)) {
      try {
        return await this.renderInWorker(slot, score, monitorFrame, job);
      } catch (error) {
        if (this.disposed) throw error;
        if (!(error instanceof WorkerLostError)) throw error;
      }
    }
    return this.renderInline(score, epoch, monitorFrame, job);
  }

  /** Cancel pending foreground work without discarding an idle cache. */
  public cancelPending(): void {
    this.epoch += 1;
    const foreground = this.slots[0];
    if (foreground && foreground.pending.size > 0)
      this.failSlot(
        foreground,
        new RenderCancelledError("render cancelled"),
        false,
      );
  }

  /** Drop background windows nobody will hear (a stop, seek or new song). */
  public cancelBackground(): void {
    for (const slot of this.slots.slice(1))
      if (slot.pending.size > 0)
        this.failSlot(
          slot,
          new RenderCancelledError("render cancelled"),
          false,
        );
  }

  /** Stops the workers and rejects in-flight renders without starting new work. */
  public dispose(): void {
    this.disposed = true;
    for (const slot of this.slots)
      this.failSlot(slot, new WorkerLostError("renderer disposed"));
    this.loopCache.clear();
  }

  private candidates(job: MonitorJob | undefined): Slot[] {
    const [foreground, ...background] = this.slots;
    if (!foreground) return [];
    const usable = [foreground].filter((slot) => !slot.broken);
    if (!job?.background) return usable;
    const idle = background
      .filter((slot) => !slot.broken)
      .sort((a, b) => a.pending.size - b.pending.size)[0];
    return idle ? [idle, ...usable] : usable;
  }

  private async renderInline(
    score: TrackScore,
    epoch: number,
    monitorFrame?: number,
    job?: MonitorJob,
  ): Promise<LoopRender> {
    this.inline ??= new StemRenderer();
    const started = performance.now();
    let samples;
    if (this.projectRoot !== undefined && hasSamplerTracks(score)) {
      this.library ??= new SampleLibrary({ projectRoot: this.projectRoot });
      samples = await this.library.load(score);
    }
    if (this.disposed) throw new Error("renderer disposed");
    if (epoch !== this.epoch && !job?.background)
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
        ...(job?.seconds === undefined ? {} : { monitorSeconds: job.seconds }),
        ...(job?.quick ? { monitorQuick: true } : {}),
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
    slot: Slot,
    score: TrackScore,
    monitorFrame?: number,
    job?: MonitorJob,
  ): Promise<LoopRender> {
    const worker = this.ensureWorker(slot);
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<LoopRender>((resolve, reject) => {
      slot.pending.set(id, { resolve, reject });
      const request: RenderRequest = {
        id,
        monitorFrame,
        ...(job?.seconds === undefined ? {} : { monitorSeconds: job.seconds }),
        ...(job?.quick ? { monitorQuick: true } : {}),
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
        this.failSlot(
          slot,
          new WorkerLostError(
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    });
  }

  private ensureWorker(slot: Slot): Bun.Worker {
    if (slot.worker) return slot.worker;
    let worker: Bun.Worker;
    try {
      // The DOM lib's Worker type lacks Bun's `unref`; the runtime object is Bun's.
      worker = new Worker(
        new URL("./render-worker.ts", import.meta.url).href,
      ) as unknown as Bun.Worker;
    } catch (error) {
      slot.broken = true;
      throw new WorkerLostError(
        error instanceof Error ? error.message : String(error),
      );
    }
    worker.addEventListener("message", (event: Event) => {
      const reply = (event as MessageEvent<RenderReply>).data;
      const waiter = slot.pending.get(reply.id);
      if (!waiter) return;
      slot.pending.delete(reply.id);
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
      if (slot.worker !== worker) return;
      const message = (event as Partial<ErrorEvent>).message;
      this.failSlot(
        slot,
        new WorkerLostError(
          typeof message === "string" ? message : "worker error",
        ),
      );
    });
    // A render worker never keeps the process alive on its own.
    worker.unref();
    slot.worker = worker;
    return worker;
  }

  private failSlot(slot: Slot, error: Error, broken = true): void {
    if (broken) slot.broken = true;
    const worker = slot.worker;
    slot.worker = undefined;
    worker?.terminate();
    const waiters = [...slot.pending.values()];
    slot.pending.clear();
    for (const waiter of waiters) waiter.reject(error);
  }
}

class WorkerLostError extends Error {}

/** An intentional cancellation must never trigger a costly inline fallback. */
export class RenderCancelledError extends Error {}
