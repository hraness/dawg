import type { TrackScore } from "../../core/score.ts";
import type { MasterReport } from "./master.ts";
import type { RenderReply, RenderRequest } from "./render-worker.ts";
import { SampleLibrary, hasSamplerTracks } from "./samples.ts";
import { renderArranged } from "./arrange.ts";
import { StemRenderer } from "./wav.ts";

export type LoopRender = Readonly<{
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
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (render: LoopRender) => void; reject: (error: Error) => void }
  >();
  private disposed = false;

  public constructor(options: LoopRendererOptions) {
    this.sampleRate = options.sampleRate;
    this.useWorker = options.worker ?? true;
    this.projectRoot = options.projectRoot;
  }

  /** True while renders run in the worker. */
  public get offThread(): boolean {
    return this.useWorker && !this.workerBroken;
  }

  public async render(score: TrackScore): Promise<LoopRender> {
    if (this.disposed) throw new Error("renderer disposed");
    if (this.offThread) {
      try {
        return await this.renderInWorker(score);
      } catch (error) {
        if (!(error instanceof WorkerLostError)) throw error;
      }
    }
    return this.renderInline(score);
  }

  /** Stops the worker; in-flight renders fall back inline on their callers. */
  public dispose(): void {
    this.disposed = true;
    this.failWorker(new WorkerLostError("renderer disposed"));
  }

  private async renderInline(score: TrackScore): Promise<LoopRender> {
    this.inline ??= new StemRenderer();
    const started = performance.now();
    let samples;
    if (this.projectRoot !== undefined && hasSamplerTracks(score)) {
      this.library ??= new SampleLibrary({ projectRoot: this.projectRoot });
      samples = await this.library.load(score);
    }
    const audio = renderArranged(this.inline, score, {
      sampleRate: this.sampleRate,
      loop: true,
      samples,
    });
    return {
      pcm: audio.pcm,
      frames: audio.frames,
      sampleRate: audio.sampleRate,
      renderMs: performance.now() - started,
      ...(audio.master ? { master: audio.master } : {}),
    };
  }

  private renderInWorker(score: TrackScore): Promise<LoopRender> {
    const worker = this.ensureWorker();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<LoopRender>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const request: RenderRequest = {
        id,
        score: score.toJSON(),
        sampleRate: this.sampleRate,
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
          pcm: reply.pcm,
          frames: reply.frames,
          sampleRate: reply.sampleRate,
          renderMs: reply.renderMs,
          ...(reply.master ? { master: reply.master } : {}),
        });
      else waiter.reject(new Error(reply.error));
    });
    worker.addEventListener("error", (event: Event) => {
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

  private failWorker(error: WorkerLostError): void {
    this.workerBroken = true;
    const worker = this.worker;
    this.worker = undefined;
    worker?.terminate();
    const waiters = [...this.pending.values()];
    this.pending.clear();
    for (const waiter of waiters) waiter.reject(error);
  }
}

class WorkerLostError extends Error {}
