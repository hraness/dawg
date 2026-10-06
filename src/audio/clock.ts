export class TransportClock {
  private startedAtMs: number | undefined;
  private pausedBeat = 0;
  private bpm: number;

  constructor(bpm = 120) {
    this.bpm = bpm;
  }

  play(nowMs = performance.now()): void {
    if (this.startedAtMs === undefined)
      this.startedAtMs = nowMs - this.beatToMs(this.pausedBeat);
  }

  pause(nowMs = performance.now()): void {
    this.pausedBeat = this.beatAt(nowMs);
    this.startedAtMs = undefined;
  }

  toggle(nowMs = performance.now()): void {
    if (this.startedAtMs === undefined) this.play(nowMs);
    else this.pause(nowMs);
  }

  beatAt(nowMs = performance.now()): number {
    if (this.startedAtMs === undefined) return this.pausedBeat;
    return Math.max(0, (nowMs - this.startedAtMs) / this.beatToMs(1));
  }

  get playing(): boolean {
    return this.startedAtMs !== undefined;
  }

  setTempo(bpm: number, nowMs = performance.now()): void {
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    const beat = this.beatAt(nowMs);
    this.bpm = bpm;
    if (this.startedAtMs !== undefined)
      this.startedAtMs = nowMs - this.beatToMs(beat);
    else this.pausedBeat = beat;
  }

  /** Converge to a timestamped transport event from another TUI process. */
  sync(
    beat: number,
    playing: boolean,
    eventAtMs = Date.now(),
    nowWallMs = Date.now(),
    nowMonotonicMs = performance.now(),
  ): void {
    if (!Number.isFinite(beat) || beat < 0) return;
    if (!Number.isFinite(eventAtMs) || !Number.isFinite(nowWallMs)) return;
    const elapsed = playing
      ? Math.max(0, nowWallMs - eventAtMs) / this.beatToMs(1)
      : 0;
    const currentBeat = beat + elapsed;
    if (playing) {
      this.startedAtMs = nowMonotonicMs - this.beatToMs(currentBeat);
    } else {
      this.pausedBeat = currentBeat;
      this.startedAtMs = undefined;
    }
  }

  private beatToMs(beats: number): number {
    return (beats * 60_000) / this.bpm;
  }
}
