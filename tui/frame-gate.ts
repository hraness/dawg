/**
 * When the interactive loop builds a frame.  The 30 fps timer used to build
 * the whole view (score snapshot, layout, every panel) on every tick even
 * with nothing moving, only for the differential writer to find no change.
 * The gate builds a frame when something can have changed: a forced frame
 * (input, resize, an edit landing), a change the caller reports (activity,
 * a different score or status key), or a running animation (transport,
 * play mode, an audition, a spinner, a card's glow).  Otherwise it builds
 * one heartbeat frame every `heartbeatMs`, which catches anything slow that
 * nothing reported (a loudness reading, a card ageing out).
 */
export const IDLE_HEARTBEAT_MS = 500;
/**
 * The shortest gap between two built frames in the interactive loop: a
 * burst of forced frames (keystrokes, edits landing, agent events) is
 * coalesced to at most about 30 a second. A deferred frame stays dirty, so
 * the next 33 ms timer tick builds it; nothing is dropped.
 */
export const MIN_FRAME_GAP_MS = 33;

export class FrameGate {
  private dirty = true;
  private lastBuiltMs = Number.NEGATIVE_INFINITY;
  private lastKeys: readonly unknown[] = [];
  /** Frames built and ticks skipped, for tests and diagnostics. */
  built = 0;
  skipped = 0;

  constructor(
    readonly heartbeatMs = IDLE_HEARTBEAT_MS,
    readonly minGapMs = 0,
  ) {}

  /** Something visible changed; the next tick builds. */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * True when this tick should build a frame; counts it as built.  Each of
   * `keys` is compared by identity (a score object) or value (a status
   * string) with the last built frame's: any difference builds.
   */
  shouldBuild(options: {
    nowMs: number;
    force?: boolean;
    animating?: boolean;
    keys?: readonly unknown[];
  }): boolean {
    const keys = options.keys ?? [];
    const keyChanged =
      keys.length !== this.lastKeys.length ||
      keys.some((key, index) => !Object.is(key, this.lastKeys[index]));
    const build =
      options.force === true ||
      options.animating === true ||
      this.dirty ||
      keyChanged ||
      options.nowMs - this.lastBuiltMs >= this.heartbeatMs;
    if (!build) {
      this.skipped += 1;
      return false;
    }
    if (options.nowMs - this.lastBuiltMs < this.minGapMs) {
      // Too soon after the last frame: build on the next tick instead.
      this.dirty = true;
      this.skipped += 1;
      return false;
    }
    this.dirty = false;
    this.lastKeys = keys;
    this.lastBuiltMs = options.nowMs;
    this.built += 1;
    return true;
  }
}
