/**
 * Live voices for play mode: one note of one track, rendered through the
 * same offline renderer the loop uses (`renderScorePcm`), so a key sounds
 * exactly like the note it records as: the track's instrument voice (synth,
 * drum kit or sampler), filter, pan, delay and reverb. Nothing is forked;
 * this module only builds a one-note score and caches the result.
 *
 * The offline renderer is untouched, so loop renders and exports stay
 * byte-identical. Live audio never reaches a render or an export: the engine
 * mixes it into the stream only. Like auditions, live notes are pre-master
 * (see `audition.ts`): the song master is a whole-mix stage.
 */
import {
  SCORE_LIMITS,
  TrackScore,
  isSamplerInstrument,
  type Track,
} from "../../core/score.ts";
import { bpmAtTick } from "../../core/tempo.ts";
import { EMPTY_SAMPLE_BANK, sampleKey, type SampleBank } from "./samples.ts";
import { RENDER_CHANNELS, renderScorePcm } from "./wav.ts";
import { engineFor } from "./instruments.ts";
import { noteHz, resolveTuning } from "../../core/tuning.ts";
import { liveFitPending, withLiveFit } from "./fit.ts";
import type { LiveFullReply, LiveFullRequest } from "./live-worker.ts";

/** A rendered live note: interleaved stereo 16-bit PCM. */
export type LiveNotePcm = Readonly<{
  pcm: Int16Array;
  frames: number;
  /** Release fade on note-off, in seconds; absent is the 10 ms default. */
  releaseSeconds?: number;
  /**
   * A fitted sample window (0.6 `bpm`/`len`/`fitmode`) longer than 8 s is
   * still being computed: the note is silent and not cached; play it again
   * once its background fit (fit.ts `onFitReady`) lands.
   */
  fitting?: true;
  /**
   * True when this is only the first window of a guitar-rig note
   * (`LIVE_RIG_WINDOW_SECONDS`): call `LiveSynth.render` again with
   * `full: true` off the key path and swap the result in by voice id.
   */
  partial?: boolean;
}>;

export type LiveNoteRequest = Readonly<{
  score: TrackScore;
  trackId: string;
  pitch: number;
  /** 0..1, as score notes store it. */
  velocity: number;
  /** How long the key is held. */
  seconds: number;
  /** Decoded sampler voices; without it sampler tracks are silent. */
  samples?: SampleBank;
  /** Song tick being played: the tempo there sets length and synced effects. */
  tick?: number;
  /** Render the whole note even through a guitar rig (the background pass). */
  full?: boolean;
}>;

/**
 * A guitar rig (stomp, head, cab) is oversampled and costs 15-25 ms per
 * track-second, so a held note through one first renders only this window,
 * at render quality, and the rest follows in the background. Every rig stage
 * is causal, so the window is the exact prefix of the full note.
 */
export const LIVE_RIG_WINDOW_SECONDS = 0.75;

/** Longest a single live note is rendered for (a held sustain pedal). */
export const MAX_LIVE_NOTE_SECONDS = 8;
const CACHE_ENTRIES = 96;

/**
 * Renders and caches live notes. Repeated keys hit the cache, so the key
 * handler only pays for a render the first time a pitch/length is played.
 */
export class LiveSynth {
  private readonly cache = new Map<string, LiveNotePcm>();

  public constructor(private readonly sampleRate: number) {}

  public get rate(): number {
    return this.sampleRate;
  }

  public get cached(): number {
    return this.cache.size;
  }

  /**
   * Stores a whole rig note rendered elsewhere (the background worker) so the
   * next press of that key hits the cache and skips the window.
   */
  public adopt(request: LiveNoteRequest, pcm: LiveNotePcm): void {
    const plan = this.plan(request);
    if (!plan || pcm.partial) return;
    this.cache.set(plan.key, pcm);
    this.trim();
  }

  private plan(request: LiveNoteRequest) {
    const track = request.score.tracks.find(
      (candidate) => candidate.id === request.trackId,
    );
    if (!track) return undefined;
    const { score } = request;
    const liveEngine = engineFor(track);
    const bpm =
      request.tick === undefined
        ? score.tempoBpm
        : bpmAtTick(score, request.tick);
    const ticksPerSecond = (score.ticksPerBeat * bpm) / 60;
    const seconds = Math.max(
      0.01,
      Math.min(MAX_LIVE_NOTE_SECONDS, request.seconds),
    );
    const durationTicks = Math.max(
      1,
      Math.min(SCORE_LIMITS.maxTick, Math.round(seconds * ticksPerSecond)),
    );
    const velocity = Math.max(0, Math.min(1, request.velocity));
    const pitch = Math.max(0, Math.min(127, Math.round(request.pitch)));
    const key = JSON.stringify([
      liveTrack(track),
      pitch,
      velocity,
      durationTicks,
      bpm,
      score.ticksPerBeat,
      this.sampleRate,
      samplerDigest(track, request.samples),
      // Assets a 0.6 engine reads (a granular sample source).
      ...engineDigest(track, request.samples),
      // The song tuning and key (the default tuning root) retune live notes.
      ...(score.tuning || track.tuning
        ? [score.tuning ?? null, score.key]
        : []),
      // A 0.6 engine's assets, and the key it may tune to.
      ...(liveEngine
        ? [
            liveEngine.assetDigests?.(
              track,
              request.samples ?? EMPTY_SAMPLE_BANK,
            ) ?? [],
            score.key ?? null,
          ]
        : []),
    ]);
    return { track, score, bpm, seconds, durationTicks, velocity, pitch, key };
  }

  public render(request: LiveNoteRequest): LiveNotePcm | undefined {
    const plan = this.plan(request);
    if (!plan) return undefined;
    const { track, score, bpm, seconds, durationTicks, velocity, pitch, key } =
      plan;
    const liveEngine = engineFor(track);
    // The first window of a rig note: its own cache entry, swapped for the
    // whole note once the background pass has rendered it.
    const windowed =
      request.full !== true &&
      hasRig(track) &&
      seconds > LIVE_RIG_WINDOW_SECONDS &&
      !this.cache.has(key);
    if (windowed) {
      const first = this.cache.get(`${key}#window`);
      if (first) return first;
    }
    const hit = this.cache.get(key);
    if (hit) {
      // Refresh LRU order.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const beats = durationTicks / score.ticksPerBeat;
    const bars = Math.max(
      1,
      Math.min(SCORE_LIMITS.maxBars, Math.ceil(beats / score.beatsPerBar)),
    );
    const single = new TrackScore({
      tempoBpm: bpm,
      beatsPerBar: score.beatsPerBar,
      bars,
      ticksPerBeat: score.ticksPerBeat,
      // The song tuning, and the key whose tonic is the default root.
      ...(score.tuning ? { tuning: score.tuning } : {}),
      ...(score.tuning || track.tuning || liveEngine ? { key: score.key } : {}),
      tracks: [liveTrack(track)],
      notes: [
        {
          id: "live",
          trackId: track.id,
          startTick: 0,
          durationTicks,
          pitch,
          velocity,
        },
      ],
    });
    // A 0.6 engine's ring-out sets the one-note length and the key release.
    const tail = liveEngine ? Math.max(0, liveEngine.tailSeconds(track)) : 0;
    // Fitted sample windows over 8 s fit in the background (silent until
    // ready, never at the wrong pitch); shorter ones fit synchronously.
    const audio = withLiveFit(() =>
      renderScorePcm(single, {
        sampleRate: this.sampleRate,
        // The renderer's shortest one-shot is 1 s; the window is cut below.
        maxSeconds: windowed
          ? 1
          : Math.max(MAX_LIVE_NOTE_SECONDS + 4, seconds + tail),
        ...(request.samples ? { samples: request.samples } : {}),
      }),
    );
    const frames = windowed
      ? Math.min(
          audibleFrames(audio.pcm),
          Math.round(LIVE_RIG_WINDOW_SECONDS * this.sampleRate),
        )
      : audibleFrames(audio.pcm);
    const release = liveEngine?.releaseSeconds
      ? liveEngine.releaseSeconds(
          track,
          pitch,
          noteHz(
            pitch,
            undefined,
            resolveTuning(score.tuning, track.tuning, score.key),
          ),
        )
      : tail;
    const rendered: LiveNotePcm = {
      pcm: audio.pcm.subarray(0, frames * RENDER_CHANNELS),
      frames,
      ...(liveEngine
        ? {
            releaseSeconds: Math.min(
              Math.max(0, release),
              MAX_LIVE_NOTE_SECONDS,
            ),
          }
        : {}),
      ...(windowed ? { partial: true } : {}),
    };
    if (liveFitPending()) return { ...rendered, fitting: true };
    this.cache.set(windowed ? `${key}#window` : key, rendered);
    this.trim();
    return rendered;
  }

  private trim(): void {
    while (this.cache.size > CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

/**
 * The track as it sounds live: audible regardless of mute and solo, and
 * without track `time`, so a key sounds once, as played, not re-placed.
 */
function liveTrack(track: Track): Track {
  // A held key is the performance: the recorded pedal and the render-time
  // humanize stay out of it. The velocity curve stays, so a key sounds like
  // the note it records as.
  const {
    solo: _solo,
    time: _time,
    pedal: _pedal,
    humanize: _humanize,
    ...rest
  } = track;
  return { ...rest, muted: false };
}

/** Whether the track plays through a guitar rig stage. */
function hasRig(track: Track): boolean {
  return Boolean(track.fx?.stomp || track.fx?.head || track.fx?.cab);
}

function engineDigest(track: Track, bank: SampleBank | undefined): string[] {
  const engine = engineFor(track);
  if (!engine?.assetDigests || !bank) return [];
  return [...engine.assetDigests(track, bank)];
}

function samplerDigest(track: Track, bank: SampleBank | undefined): string[] {
  if (!isSamplerInstrument(track.instrument) || !track.sampler || !bank)
    return [];
  return Object.keys(track.sampler.voices)
    .sort()
    .map((voice) => bank.voices.get(sampleKey(track.id, voice))?.sha256 ?? "-");
}

/** Frames up to the last non-silent sample, so mixing skips the dead tail. */
function audibleFrames(pcm: Int16Array): number {
  let last = pcm.length - 1;
  while (last >= 0 && pcm[last] === 0) last -= 1;
  return Math.ceil((last + 1) / RENDER_CHANNELS);
}

/**
 * Renders whole guitar-rig notes on a worker (`live-worker.ts`), in request
 * order. When a worker cannot start, `full` falls back to rendering on the
 * calling thread in a later tick, as before.
 */
export class LiveFullRenderer {
  private worker: Bun.Worker | undefined;
  private broken = false;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    (pcm: LiveNotePcm | undefined) => void
  >();

  public full(
    synth: LiveSynth,
    request: LiveNoteRequest,
  ): Promise<LiveNotePcm | undefined> {
    const worker = this.ensure();
    if (!worker)
      return new Promise((resolve) =>
        setTimeout(() => resolve(synth.render({ ...request, full: true })), 0),
      );
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve) => {
      this.pending.set(id, (pcm) => {
        if (pcm) synth.adopt(request, pcm);
        resolve(pcm);
      });
      const message: LiveFullRequest = {
        id,
        sampleRate: synth.rate,
        score: request.score.toJSON(),
        trackId: request.trackId,
        pitch: request.pitch,
        velocity: request.velocity,
        seconds: request.seconds,
        ...(request.tick === undefined ? {} : { tick: request.tick }),
        ...(request.samples ? { samples: request.samples } : {}),
      };
      try {
        worker.postMessage(message);
      } catch {
        this.pending.delete(id);
        this.fail();
        setTimeout(() => resolve(synth.render({ ...request, full: true })), 0);
      }
    });
  }

  /** Stops the worker; pending notes resolve without a full pass. */
  public close(): void {
    this.fail();
  }

  private ensure(): Bun.Worker | undefined {
    if (this.worker) return this.worker;
    if (this.broken) return undefined;
    try {
      // The DOM lib's Worker type lacks Bun's `unref`; the runtime is Bun's.
      const worker = new Worker(
        new URL("./live-worker.ts", import.meta.url).href,
      ) as unknown as Bun.Worker;
      worker.addEventListener("message", (event: Event) => {
        const reply = (event as MessageEvent<LiveFullReply>).data;
        const done = this.pending.get(reply.id);
        if (!done) return;
        this.pending.delete(reply.id);
        done(reply.pcm);
      });
      worker.addEventListener("error", () => this.fail());
      worker.unref();
      this.worker = worker;
      return worker;
    } catch {
      this.broken = true;
      return undefined;
    }
  }

  private fail(): void {
    this.broken = true;
    const worker = this.worker;
    this.worker = undefined;
    worker?.terminate();
    const waiters = [...this.pending.values()];
    this.pending.clear();
    for (const done of waiters) done(undefined);
  }
}
