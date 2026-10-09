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
import { engineFor, RING_OUT_FADE_SECONDS } from "./instruments.ts";
import { chordDigest, chordTimeline } from "./granular.ts";
import { resolveGranular } from "../../core/granular.ts";
import { noteHz, resolveTuning } from "../../core/tuning.ts";
import { liveFitPending, withLiveFit } from "./fit.ts";
import { isOrganFamily } from "../../core/keys.ts";
import type { LiveFullReply, LiveFullRequest } from "./live-worker.ts";
import { isBowed, liveStringTrack } from "./strings/engine.ts";
import { resolveString } from "../../core/strings.ts";
import { singTrack } from "../../core/sing.ts";
import { warmGlottal } from "./dsp/glottal.ts";
import { withSingHorizon } from "./sing/engine.ts";

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
   * True when this is only the first window of a guitar-rig or bowed note
   * (`LIVE_RIG_WINDOW_SECONDS`): call `LiveSynth.render` again with
   * `full: true` off the key path and swap the result in by voice id.
   */
  partial?: boolean;
  /**
   * The organ clock tick a first window rendered at: pass it back as the
   * request's `clock` for the full pass so the wheels and rotors continue.
   */
  clock?: number;
  /**
   * The key's release does not fade the voice: it rings to the end of its
   * rendered tail (0.6.1 modal `damp 0`), which ends in a `RING_OUT_FADE_SECONDS`
   * fade when the length cap cut it.
   */
  ringOut?: true;
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
  /** An organ note's clock tick from its first window (`LiveNotePcm.clock`). */
  clock?: number;
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
  /** f061-organ: the live organ clock's origin (performance.now ms). */
  private readonly organEpoch = performance.now();

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
    // f061-organ: one rotating speaker and one set of free-running wheels
    // per organ track. Each key renders from the song tick it sounds at
    // (or the synth's own clock when stopped), so successive notes share
    // the track's rotor and wheel phases instead of restarting them.
    const organTick =
      track.keys && isOrganFamily(track.instrument)
        ? Math.max(
            0,
            Math.round(
              request.clock ??
                request.tick ??
                ((performance.now() - this.organEpoch) / 1000) * ticksPerSecond,
            ),
          )
        : undefined;
    // Granular `quant chord` (0.6.1): a live note snaps to the song's
    // chords at the played tick, as the offline render of the same note.
    const quantChord =
      track.granular !== undefined &&
      liveEngine?.id === "granular" &&
      resolveGranular(track.granular).quant === "chord"
        ? { score, tick: request.tick ?? 0 }
        : undefined;
    const chord = quantChord
      ? chordDigest(
          chordTimeline(score),
          quantChord.tick,
          quantChord.tick +
            durationTicks +
            Math.ceil(liveEngine!.tailSeconds(track, pitch) * ticksPerSecond),
        )
      : undefined;
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
      ...(organTick !== undefined ? [`organ:${organTick}`] : []),
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
      ...(chord ? [chord] : []),
    ]);
    return {
      track,
      score,
      bpm,
      seconds,
      durationTicks,
      velocity,
      pitch,
      key,
      organTick,
      quantChord,
    };
  }

  public render(request: LiveNoteRequest): LiveNotePcm | undefined {
    const plan = this.plan(request);
    if (!plan) return undefined;
    const {
      track,
      score,
      bpm,
      seconds,
      durationTicks,
      velocity,
      pitch,
      key,
      organTick,
      quantChord,
    } = plan;
    const liveEngine = engineFor(track);
    // The first window of a rig note: its own cache entry, swapped for the
    // whole note once the background pass has rendered it.
    // Organs too: wheels, rotors and drive cost 4-8 ms per note-second.
    const windowed =
      request.full !== true &&
      (hasRig(track) ||
        organTick !== undefined ||
        bowedTrack(track) ||
        hasFormant(track) ||
        singTrack(track)) &&
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
    const tail = liveEngine
      ? Math.max(0, liveEngine.tailSeconds(track, pitch))
      : 0;
    // Fitted sample windows over 8 s fit in the background (silent until
    // ready, never at the wrong pitch); shorter ones fit synchronously.
    const windowFrames = Math.round(LIVE_RIG_WINDOW_SECONDS * this.sampleRate);
    const horizon = windowed ? windowFrames : Infinity;
    const audio = withLiveFit(() =>
      withSingHorizon(horizon, () =>
        renderScorePcm(single, {
          sampleRate: this.sampleRate,
          // The renderer's shortest one-shot is 1 s; the window is cut below.
          maxSeconds: windowed
            ? 1
            : Math.max(MAX_LIVE_NOTE_SECONDS + 4, seconds + tail),
          ...(request.samples ? { samples: request.samples } : {}),
          ...(organTick ? { seedTick: organTick } : {}),
          ...(quantChord ? { quantChord } : {}),
        }),
      ),
    );
    const frames = windowed
      ? Math.min(audibleFrames(audio.pcm), windowFrames)
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
    const ringOut = !windowed && liveEngine?.ringOut?.(track) === true;
    const pcm = audio.pcm.subarray(0, frames * RENDER_CHANNELS);
    if (ringOut) fadeCutTail(pcm, frames, this.sampleRate);
    const rendered: LiveNotePcm = {
      pcm,
      frames,
      ...(ringOut ? { ringOut: true as const } : {}),
      ...(liveEngine
        ? {
            releaseSeconds: Math.min(
              Math.max(0, release),
              MAX_LIVE_NOTE_SECONDS,
            ),
          }
        : {}),
      ...(windowed ? { partial: true } : {}),
      ...(windowed && organTick !== undefined ? { clock: organTick } : {}),
    };
    if (liveFitPending()) return { ...rendered, fitting: true };
    // Organ keys render at their song tick: caching them would only evict.
    if (organTick !== undefined) return rendered;
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
 * Pays a voice's one-off costs before a key can sound (formant.md 4.5): the
 * sing engine builds its LF glottal tables (about 50 ms) on first use and
 * its inner loops need a pass to compile, so the first sing key of a session
 * would miss the 15 ms first-window budget by 4x. Play mode calls this when
 * it opens on a track; a no-op for every other voice. The warm render goes
 * through a throwaway synth, so no cache entry or state is left behind.
 */
export function warmLive(
  score: TrackScore,
  trackId: string,
  sampleRate: number,
): void {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track || !singTrack(track)) return;
  warmGlottal();
  const synth = new LiveSynth(sampleRate);
  for (const pitch of [48, 60])
    synth.render({ score, trackId, pitch, velocity: 0.8, seconds: 0.3 });
}

/**
 * The track as it sounds live: audible regardless of mute and solo, and
 * without track `time`, so a key sounds once, as played, not re-placed.
 */
function liveTrack(track: Track): Track {
  // A held key is the performance: the recorded pedals and the render-time
  // humanize stay out of it. The velocity curve stays, so a key sounds like
  // the note it records as.
  const {
    solo: _solo,
    time: _time,
    pedal: _pedal,
    softPedal: _softPedal,
    sostenuto: _sostenuto,
    humanize: _humanize,
    ...rest
  } = track;
  // A bowed section plays two players live (f061-bowed render budget).
  return liveStringTrack({ ...rest, muted: false });
}

/**
 * Whether the track is a bowed string: a held bow costs about 5 ms per
 * second, so it windows like a rig (the bow loop is causal too).
 */
function bowedTrack(track: Track): boolean {
  return (
    track.instrument === "string" &&
    track.string !== undefined &&
    isBowed(resolveString(track.string))
  );
}

/**
 * Whether the track plays through the 0.7 formant fx. It is not causal (one
 * STFT frame of lookahead), but the window renders a 1 s source, well past
 * the 0.75 s window plus one frame, so the window is an exact prefix.
 */
function hasFormant(track: Track): boolean {
  return Boolean(track.fx?.formant);
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
/**
 * A ring-out note cut by the render length still sounds at its last frame:
 * fade its final `RING_OUT_FADE_SECONDS` linearly to zero so the cap never
 * clicks (each step stays under -60 dB of full scale). A tail that already
 * decayed to silence is left alone.
 */
export function fadeCutTail(
  pcm: Int16Array,
  frames: number,
  sampleRate: number,
): void {
  if (frames === 0) return;
  const last = (frames - 1) * RENDER_CHANNELS;
  // Below -60 dBFS the cut is inaudible.
  if (Math.abs(pcm[last]!) < 33 && Math.abs(pcm[last + 1]!) < 33) return;
  const fade = Math.min(frames, Math.round(RING_OUT_FADE_SECONDS * sampleRate));
  for (let i = 0; i < fade; i += 1) {
    const frame = frames - fade + i;
    const gain = (fade - 1 - i) / fade;
    for (let c = 0; c < RENDER_CHANNELS; c += 1) {
      const at = frame * RENDER_CHANNELS + c;
      pcm[at] = Math.round(pcm[at]! * gain);
    }
  }
}

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
        ...(request.clock === undefined ? {} : { clock: request.clock }),
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
