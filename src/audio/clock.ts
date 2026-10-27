import { loopTicksOf, timeMapFor, type TimeScore } from "../../core/tempo.ts";

/**
 * Beats and seconds through a song's tempo map, one loop at a time: the
 * transport runs in score beats, and the map says how long each loop pass
 * takes. Absent, the clock keeps its constant-tempo arithmetic.
 */
export type TransportMap = Readonly<{
  loopBeats: number;
  loopSeconds: number;
  /** Seconds into a loop pass at `beat` (0..loopBeats). */
  seconds(beat: number): number;
  /** Beat inside a loop pass at `seconds` (0..loopSeconds). */
  beat(seconds: number): number;
}>;

/** The transport map for a score, or undefined at a constant tempo. */
export function transportMapFor(score: TimeScore): TransportMap | undefined {
  const map = timeMapFor(score);
  if (!map) return undefined;
  const tpb = score.ticksPerBeat;
  const loopBeats = loopTicksOf(score) / tpb;
  const loopSeconds = map.seconds(loopTicksOf(score));
  if (!(loopBeats > 0) || !(loopSeconds > 0)) return undefined;
  return Object.freeze({
    loopBeats,
    loopSeconds,
    seconds: (beat: number) => map.seconds(beat * tpb),
    beat: (seconds: number) => map.tick(seconds) / tpb,
  });
}

export class TransportClock {
  private startedAtMs: number | undefined;
  private pausedBeat = 0;
  /** Playing, held at `pausedBeat` until the audio is heard (`cue`). */
  private holding = false;
  private bpm: number;
  private map: TransportMap | undefined;

  constructor(bpm = 120) {
    this.bpm = bpm;
  }

  /**
   * Start moving from the paused (or cued) beat as of `nowMs`. Releasing a
   * cue passes the time its first frame is heard, which may be a device
   * latency in the future.
   */
  play(nowMs = performance.now()): void {
    this.holding = false;
    if (this.startedAtMs === undefined)
      this.startedAtMs = nowMs - this.beatToMs(this.pausedBeat);
  }

  /**
   * Play, but hold the beat until `play` releases it: the audio engine is
   * still rendering its first windows, and a playhead that moved now would
   * run ahead of the sound by however long that takes.
   */
  cue(): void {
    if (this.startedAtMs === undefined) this.holding = true;
  }

  pause(nowMs = performance.now()): void {
    this.pausedBeat = this.beatAt(nowMs);
    this.startedAtMs = undefined;
    this.holding = false;
  }

  toggle(nowMs = performance.now()): void {
    if (!this.playing) this.play(nowMs);
    else this.pause(nowMs);
  }

  beatAt(nowMs = performance.now()): number {
    if (this.startedAtMs === undefined) return this.pausedBeat;
    if (this.map) return Math.max(0, this.msToBeat(nowMs - this.startedAtMs));
    return Math.max(0, (nowMs - this.startedAtMs) / this.beatToMs(1));
  }

  /** True while running or cued. */
  get playing(): boolean {
    return this.startedAtMs !== undefined || this.holding;
  }

  /** True while cued: playing, held until the audio is heard. */
  get cued(): boolean {
    return this.holding;
  }

  setTempo(bpm: number, nowMs = performance.now()): void {
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    const beat = this.beatAt(nowMs);
    this.bpm = bpm;
    if (this.startedAtMs !== undefined)
      this.startedAtMs = nowMs - this.beatToMs(beat);
    else this.pausedBeat = beat;
  }

  /**
   * Follow a song's tempo map (`transportMapFor`), keeping the current
   * beat; undefined returns to the constant `bpm`.
   */
  setTimeMap(map: TransportMap | undefined, nowMs = performance.now()): void {
    if (map === this.map) return;
    const beat = this.beatAt(nowMs);
    this.map = map;
    if (this.startedAtMs !== undefined)
      this.startedAtMs = nowMs - this.beatToMs(beat);
    else this.pausedBeat = beat;
  }

  /** Follow a score's start tempo and tempo map. */
  follow(score: TimeScore, nowMs = performance.now()): void {
    this.setTempo(score.tempoBpm, nowMs);
    this.setTimeMap(transportMapFor(score), nowMs);
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
    if (playing && this.holding) {
      // A seek while cued moves the hold; nothing is sounding yet.
      this.pausedBeat = beat;
      return;
    }
    this.holding = false;
    const elapsedMs = playing ? Math.max(0, nowWallMs - eventAtMs) : 0;
    const currentBeat = this.map
      ? this.msToBeat(this.beatToMs(beat) + elapsedMs)
      : beat + elapsedMs / this.beatToMs(1);
    if (playing) {
      this.startedAtMs = nowMonotonicMs - this.beatToMs(currentBeat);
    } else {
      this.pausedBeat = currentBeat;
      this.startedAtMs = undefined;
    }
  }

  private beatToMs(beats: number): number {
    const map = this.map;
    if (!map) return (beats * 60_000) / this.bpm;
    const loops = Math.floor(beats / map.loopBeats);
    const inner = beats - loops * map.loopBeats;
    return (loops * map.loopSeconds + map.seconds(inner)) * 1000;
  }

  private msToBeat(ms: number): number {
    const map = this.map;
    if (!map) return ms / this.beatToMs(1);
    const seconds = ms / 1000;
    const loops = Math.floor(seconds / map.loopSeconds);
    const inner = seconds - loops * map.loopSeconds;
    return loops * map.loopBeats + map.beat(inner);
  }
}
