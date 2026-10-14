/** A single optional measurement, deferred until the foreground stays idle. */
export class IdleMeasurement<K, V> {
  private entry?: {
    key: K;
    complete: boolean;
    value?: V;
    timer?: ReturnType<typeof setTimeout>;
    controller?: AbortController;
  };
  private stopped = false;
  constructor(
    private readonly delayMs = 1000,
    private readonly changed: () => void = () => {},
  ) {}

  read(
    key: K,
    eligible: boolean,
    work: (signal: AbortSignal) => Promise<V>,
  ): V | undefined {
    if (this.stopped) return undefined;
    if (!this.entry || this.entry.key !== key) {
      this.clear();
      this.entry = { key, complete: false };
    }
    const entry = this.entry;
    if (entry.complete) return entry.value;
    if (!eligible) {
      this.pause();
      return undefined;
    }
    if (!entry.timer && !entry.controller) {
      entry.timer = setTimeout(() => {
        entry.timer = undefined;
        const controller = new AbortController();
        entry.controller = controller;
        void Promise.resolve()
          .then(() => {
            controller.signal.throwIfAborted();
            return work(controller.signal);
          })
          .then((value) => {
            if (this.entry === entry && !controller.signal.aborted)
              entry.value = value;
          })
          .catch(() => undefined)
          .finally(() => {
            if (this.entry === entry && entry.controller === controller) {
              entry.controller = undefined;
              // A failure is not retried every frame. A new score retries it.
              entry.complete = !controller.signal.aborted;
              this.changed();
            }
          });
      }, this.delayMs);
      entry.timer.unref();
    }
    return undefined;
  }

  /** Preempt optional work immediately when input or a foreground job arrives. */
  pause(): void {
    const entry = this.entry;
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.controller?.abort();
    entry.controller = undefined;
  }
  clear(): void {
    this.pause();
    this.entry = undefined;
  }
  dispose(): void {
    this.clear();
    this.stopped = true;
  }
}
