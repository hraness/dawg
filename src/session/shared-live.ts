/**
 * A pane's handle on the machine's one live engine (design §12.3). It looks
 * like the local `LiveEngine` to play mode, but notes go to dawgd as note
 * events (`remoteNote`) and the click as a structured request
 * (`remoteClick`): no audio crosses the socket. dawgd renders each voice
 * from the score it holds and mixes every pane into one stream and one
 * click.
 *
 * Times cross the seam on the authority's clock: local monotonic ms plus
 * `performance.timeOrigin` plus the port's clock offset (0 on one machine).
 */
import type { ClickBus } from "../audio/engine.ts";
import type { LiveNotePcm } from "../audio/live.ts";
import type { LiveClick, LiveMessage, LiveStatus } from "./protocol.ts";

/** What the shared engine needs from the session connection. */
export interface LiveLink {
  liveMonitor(on: boolean): Promise<LiveStatus>;
  live(message: Exclude<LiveMessage, { action: "monitor" }>): void;
  /** Authority clock minus this machine's, in ms. */
  readonly clockOffsetMs: number;
}

/** A played note as play mode hands it to a shared engine. */
export type RemoteNote = Readonly<{
  trackId: string;
  pitch: number;
  /** 0..1. */
  velocity: number;
  seconds: number;
  /** Transport beat of the press (unwrapped). */
  beat: number;
  /** Monotonic ms of the press. */
  atMs: number;
}>;

/** A structured click request (a shared engine cannot take closures). */
export type RemoteClick = Readonly<{
  on: boolean;
  volume: number;
  countIn?: Readonly<{
    /** Monotonic ms the count-in starts. */
    startMs: number;
    startBeat: number;
    beats: number;
    barBeats: number;
    clickBeats: number;
    bpm: number;
  }>;
}>;

export class SharedLiveEngine {
  public sampleRate = 48_000;
  public canMonitor = true;
  public leadMs = 15;
  public playLeadMs: number | undefined;
  public audioNote: string | undefined = "shared engine";
  /** Notes sent (tests and the status line read it). */
  public sent = 0;

  public constructor(private readonly link: LiveLink) {}

  public async monitor(on: boolean): Promise<void> {
    try {
      const status = await this.link.liveMonitor(on);
      this.sampleRate = status.sampleRate;
      this.canMonitor = status.canMonitor;
      this.leadMs = status.leadMs;
      this.playLeadMs = status.leadMs;
      this.audioNote = status.note ?? "shared engine";
    } catch {
      // dawgd is reconnecting; the link resends monitor once it is back.
    }
  }

  /** The lead is dawgd's: a pane never retimes the shared engine. */
  public setLeadMs(_ms: number | undefined): void {}

  /** Local PCM never reaches a shared engine; play mode uses `remoteNote`. */
  public noteOn(_id: number, _note: LiveNotePcm): number {
    return performance.now() + this.leadMs;
  }

  public remoteNote(id: number, note: RemoteNote): number {
    this.sent += 1;
    this.link.live({
      v: 1,
      type: "live",
      action: "on",
      voice: id,
      trackId: note.trackId,
      pitch: note.pitch,
      velocity: Math.max(0, Math.min(1, note.velocity)),
      seconds: Math.max(0, Math.min(600, note.seconds)),
      beat: note.beat,
      atMs: this.authority(note.atMs),
    });
    return performance.now() + this.leadMs;
  }

  public noteOff(id: number): void {
    this.link.live({
      v: 1,
      type: "live",
      action: "off",
      voice: id,
      atMs: this.authority(performance.now()),
    });
  }

  /** A pane cannot hand dawgd a click closure; see `remoteClick`. */
  public setClick(click: ClickBus | undefined): void {
    if (!click) this.remoteClick({ on: false, volume: 0 });
  }

  public remoteClick(click: RemoteClick): void {
    const message: LiveClick = {
      on: click.on,
      volume: Math.max(0, Math.min(1, click.volume)),
    };
    if (click.countIn) {
      const { startMs, ...rest } = click.countIn;
      message.countIn = { ...rest, startAtMs: this.authority(startMs) };
    }
    this.link.live({ v: 1, type: "live", action: "click", ...message });
  }

  private authority(monotonicMs: number): number {
    return performance.timeOrigin + monotonicMs + this.link.clockOffsetMs;
  }
}
