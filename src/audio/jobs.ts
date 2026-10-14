import { AudioCompute } from "./compute.ts";

export type AudioJob = Readonly<{
  label: string;
  signal: AbortSignal;
  compute: AudioCompute;
  progress: (stage: string) => void;
}>;

/** Interactive CPU jobs are bounded and owned until their file/child cleanup settles. */
export class AudioJobs {
  private active?: {
    label: string;
    controller: AbortController;
    compute: AudioCompute;
    settled: Promise<void>;
  };
  private stopped = false;
  constructor(
    private readonly status: (label: string | undefined) => void = () => {},
  ) {}
  get busy(): boolean {
    return this.active !== undefined;
  }
  get label(): string | undefined {
    return this.active?.label;
  }
  cancel(): boolean {
    if (!this.active) return false;
    this.active.controller.abort();
    this.status(`canceling ${this.active.label}`);
    return true;
  }
  /** Reject new work and wait for every temporary-file cleanup before exit. */
  async shutdown(): Promise<void> {
    this.stopped = true;
    const active = this.active;
    try {
      this.cancel();
    } finally {
      await active?.settled;
    }
  }
  async run<T>(label: string, work: (job: AudioJob) => Promise<T>): Promise<T> {
    if (this.stopped) throw new Error("audio jobs stopped");
    if (this.active)
      throw new Error(`${this.active.label} is running · Esc cancels`);
    const controller = new AbortController();
    const compute = new AudioCompute(controller.signal, {
      retainChopBuffers: true,
    });
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const active = { label, controller, compute, settled };
    this.active = active;
    const progress = (stage: string) => {
      if (this.active === active && !controller.signal.aborted)
        this.status(`${label} · ${stage} · Esc cancels`);
    };
    try {
      progress("working");
      return await work({
        label,
        signal: controller.signal,
        compute,
        progress,
      });
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      try {
        compute.dispose();
        if (this.active === active) {
          this.active = undefined;
          this.status(undefined);
        }
      } finally {
        settle();
      }
    }
  }
}
