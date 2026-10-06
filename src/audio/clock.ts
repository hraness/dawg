export class TransportClock {
  private startedAtMs: number | undefined;
  private pausedBeat = 0;
  private readonly bpm: number;

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

  private beatToMs(beats: number): number {
    return (beats * 60_000) / this.bpm;
  }
}
