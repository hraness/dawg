/**
 * dawgd's live path: every pane's played notes and the click mix on the one
 * engine this machine runs (design §12.3). A pane sends note events, never
 * audio; dawgd renders each voice from the score it already holds, through
 * the same `LiveSynth` a solo window uses, so a key sounds the same either
 * way.
 *
 * Voice ids are window-local, so they are namespaced by client. The click is
 * on while any pane wants it and follows dawgd's own transport clock; a
 * count-in comes from the pane that armed last.
 */
import type { ClickBus } from "../audio/engine.ts";
import { countInClicks, meterClickGrid } from "../audio/click.ts";
import { LiveSynth, type LiveNotePcm } from "../audio/live.ts";
import type { SampleBank } from "../audio/samples.ts";
import { hasMeterChanges, loopTickAt } from "../../core/tempo.ts";
import type { TrackScore } from "../../core/score.ts";
import type { LiveClick, LiveMessage, LiveStatus } from "./protocol.ts";

/** The part of AudioEngine the live host drives. */
export interface LiveSink {
  readonly sampleRate: number;
  readonly canMonitor: boolean;
  readonly leadMs: number;
  readonly playLeadMs?: number;
  readonly audioNote?: string;
  monitor(on: boolean): Promise<void>;
  setLeadMs(ms: number | undefined): void;
  noteOn(id: number, note: LiveNotePcm): number;
  noteOff(id: number): void;
  voicePosition?(id: number): number | undefined;
  setClick(click: ClickBus | undefined): void;
}

export type LiveHostOptions = {
  sink: LiveSink;
  score(): TrackScore;
  samples?(): SampleBank | undefined;
  /** Transport beat at monotonic `ms`, or undefined while stopped. */
  transportBeatAt(ms: number): number | undefined;
  /** Authority clock (epoch ms) to local monotonic ms. */
  toMonotonic(epochMs: number): number;
  log?(line: string): void;
};

/** Longest a held live note renders before its key-up arrives. */
const MAX_SECONDS = 8;

export class LiveHost {
  private readonly monitors = new Set<string>();
  private readonly clicks = new Map<string, LiveClick>();
  private readonly voices = new Map<string, number>();
  private nextVoice = 1;
  private synth: LiveSynth | undefined;
  /** Notes played since start, by client (tests and the log read it). */
  public readonly played = new Map<string, number>();

  public constructor(private readonly options: LiveHostOptions) {}

  public status(): LiveStatus {
    const sink = this.options.sink;
    const status: LiveStatus = {
      canMonitor: sink.canMonitor,
      sampleRate: sink.sampleRate,
      leadMs: sink.playLeadMs ?? sink.leadMs,
    };
    if (sink.audioNote) status.note = `shared engine · ${sink.audioNote}`;
    return status;
  }

  public async handle(
    client: string,
    message: LiveMessage,
  ): Promise<LiveStatus | undefined> {
    if (message.action === "monitor") {
      await this.monitor(client, message.on);
      return this.status();
    }
    if (message.action === "on") this.noteOn(client, message);
    else if (message.action === "off") this.noteOff(client, message.voice);
    else {
      const { on, volume } = message;
      const click: LiveClick = { on, volume };
      if (message.countIn) click.countIn = message.countIn;
      if (on || click.countIn) this.clicks.set(client, click);
      else this.clicks.delete(client);
      this.applyClick();
    }
    return undefined;
  }

  /** A pane left: its voices stop, its click and monitor drop out. */
  public async drop(client: string): Promise<void> {
    for (const [key, id] of this.voices)
      if (key.startsWith(`${client}:`)) {
        this.options.sink.noteOff(id);
        this.voices.delete(key);
      }
    this.clicks.delete(client);
    this.applyClick();
    if (this.monitors.delete(client) && this.monitors.size === 0)
      await this.release();
  }

  public get monitoring(): number {
    return this.monitors.size;
  }

  private async monitor(client: string, on: boolean): Promise<void> {
    const sink = this.options.sink;
    if (on) {
      const first = this.monitors.size === 0;
      this.monitors.add(client);
      if (first) {
        sink.setLeadMs(sink.playLeadMs);
        await sink.monitor(true);
        this.options.log?.("live: monitor on");
      }
      return;
    }
    if (this.monitors.delete(client) && this.monitors.size === 0)
      await this.release();
  }

  private async release(): Promise<void> {
    const sink = this.options.sink;
    sink.setLeadMs(undefined);
    await sink.monitor(false);
    this.options.log?.("live: monitor off");
  }

  private noteOn(
    client: string,
    message: Extract<LiveMessage, { action: "on" }>,
  ): void {
    this.played.set(client, (this.played.get(client) ?? 0) + 1);
    this.options.log?.(
      `live: note ${client} ${message.trackId} ${message.pitch} beat ${message.beat.toFixed(2)}`,
    );
    const sink = this.options.sink;
    if (!sink.canMonitor) return;
    const score = this.options.score();
    if (!score.tracks.some((track) => track.id === message.trackId)) return;
    if (this.synth?.rate !== sink.sampleRate)
      this.synth = new LiveSynth(sink.sampleRate);
    const samples = this.options.samples?.();
    const request = {
      score,
      trackId: message.trackId,
      pitch: message.pitch,
      velocity: message.velocity,
      seconds: Math.min(message.seconds, MAX_SECONDS),
      ...(samples ? { samples } : {}),
      ...(score.time?.tempo ? { tick: loopTickAt(score, message.beat) } : {}),
    };
    const synth = this.synth;
    const pcm = synth.render(request);
    if (!pcm || pcm.fitting) return;
    const key = `${client}:${message.voice}`;
    const previous = this.voices.get(key);
    const id = previous ?? this.nextVoice++;
    this.voices.set(key, id);
    sink.noteOn(id, pcm);
    // A rig's first window sounds now; the whole note follows off the key
    // path and swaps in place while the voice still sounds.
    if (pcm.partial)
      setTimeout(() => {
        if (this.voices.get(key) !== id) return;
        const full = synth.render({
          ...request,
          full: true,
          ...(pcm.clock === undefined ? {} : { clock: pcm.clock }),
        });
        if (full && sink.voicePosition?.(id) !== undefined)
          sink.noteOn(id, full);
      }, 0);
  }

  private noteOff(client: string, voice: number): void {
    const key = `${client}:${voice}`;
    const id = this.voices.get(key);
    if (id === undefined) return;
    this.voices.delete(key);
    this.options.sink.noteOff(id);
  }

  /** The one click: on while any pane wants it. */
  private applyClick(): void {
    const sink = this.options.sink;
    let wanted: LiveClick | undefined;
    for (const click of this.clicks.values())
      if (click.on || click.countIn) wanted = click;
    if (!wanted) {
      sink.setClick(undefined);
      return;
    }
    const score = this.options.score;
    const count = wanted.countIn;
    const startMs = count
      ? this.options.toMonotonic(count.startAtMs)
      : undefined;
    const on = [...this.clicks.values()].some((click) => click.on);
    let grid: ClickBus["grid"];
    if (count && hasMeterChanges(score()))
      grid = (from, to) =>
        countInClicks(
          count.startBeat,
          count.beats / count.barBeats,
          count.barBeats,
          count.clickBeats,
          from,
          to,
        );
    else if (!count && hasMeterChanges(score())) grid = meterClickGrid(score);
    sink.setClick({
      volume: wanted.volume,
      beatsPerBar: score().beatsPerBar,
      subdivision: 1,
      beatAt: (ms) => {
        if (count && startMs !== undefined) {
          const beat =
            count.startBeat -
            count.beats +
            (ms - startMs) / (60_000 / count.bpm);
          if (beat < count.startBeat) return beat;
        }
        return on ? this.options.transportBeatAt(ms) : undefined;
      },
      ...(grid ? { grid } : {}),
    });
  }
}
