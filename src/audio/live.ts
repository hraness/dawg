/**
 * Live voices for play mode: one note of one track, rendered through the
 * same offline renderer the loop uses (`renderScorePcm`), so a key sounds
 * exactly like the note it records as: the track's instrument voice (synth,
 * drum kit or sampler), filter, pan, delay and reverb. Nothing is forked;
 * this module only builds a one-note score and caches the result.
 *
 * The offline renderer is untouched, so loop renders and exports stay
 * byte-identical. Live audio never reaches a render or an export: the engine
 * mixes it into the stream only.
 */
import {
  SCORE_LIMITS,
  TrackScore,
  isSamplerInstrument,
  type Track,
} from "../../core/score.ts";
import { sampleKey, type SampleBank } from "./samples.ts";
import { RENDER_CHANNELS, renderScorePcm } from "./wav.ts";

/** A rendered live note: interleaved stereo 16-bit PCM. */
export type LiveNotePcm = Readonly<{ pcm: Int16Array; frames: number }>;

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
}>;

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

  public render(request: LiveNoteRequest): LiveNotePcm | undefined {
    const track = request.score.tracks.find(
      (candidate) => candidate.id === request.trackId,
    );
    if (!track) return undefined;
    const { score } = request;
    const ticksPerSecond = (score.ticksPerBeat * score.tempoBpm) / 60;
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
      score.tempoBpm,
      score.ticksPerBeat,
      this.sampleRate,
      samplerDigest(track, request.samples),
    ]);
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
      tempoBpm: score.tempoBpm,
      beatsPerBar: score.beatsPerBar,
      bars,
      ticksPerBeat: score.ticksPerBeat,
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
    const audio = renderScorePcm(single, {
      sampleRate: this.sampleRate,
      maxSeconds: MAX_LIVE_NOTE_SECONDS + 4,
      ...(request.samples ? { samples: request.samples } : {}),
    });
    const frames = audibleFrames(audio.pcm);
    const rendered: LiveNotePcm = {
      pcm: audio.pcm.subarray(0, frames * RENDER_CHANNELS),
      frames,
    };
    this.cache.set(key, rendered);
    while (this.cache.size > CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return rendered;
  }
}

/** The track as it sounds live: audible regardless of mute and solo. */
function liveTrack(track: Track): Track {
  const { solo: _solo, ...rest } = track;
  return { ...rest, muted: false };
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
