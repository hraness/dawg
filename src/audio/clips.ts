/**
 * Audio clips (0.7): files placed on a track's timeline, summed into the
 * track's dry buffer before its effect chain (sources.md section 7). The
 * pure placement and section cuts live in core/clips.ts; this module reads
 * the decoded audio, places it through the tempo map, resamples it to the
 * render rate (4-point Hermite), applies the take's clock-drift stretch,
 * reverse, gain and equal-power fades, and multiplies by the track's
 * volume the way every voice does. A clip whose audio did not load renders
 * silence (the loader reported it as a warning).
 */
import {
  CLIP_VOICE_PREFIX,
  DEFAULT_CLIP_FADE,
  clipSongTick,
  resolveClipLengths,
} from "../../core/clips.ts";
import type { AudioClip, Take, Track, TrackScore } from "../../core/score.ts";
import { autotuneClip } from "./autotune.ts";
import { sampleKey, type DecodedSample, type SampleBank } from "./samples.ts";
import type { SampleWarp } from "./warp.ts";

/** What clip rendering reads of the render context. */
export type ClipContext = Readonly<{
  sampleRate: number;
  samples: number;
  samplesPerTick: number;
  warp?: SampleWarp;
}>;

/** True when a track has clips that sound. */
export function hasClips(track: Track | undefined): boolean {
  return track?.clips?.some((clip) => !clip.mute) ?? false;
}

/** The decoded audio of a clip, if it loaded. */
export function clipAudio(
  bank: SampleBank | undefined,
  trackId: string,
  clip: AudioClip,
): DecodedSample | undefined {
  if (!bank) return undefined;
  const exact = bank.voices.get(
    sampleKey(trackId, `${CLIP_VOICE_PREFIX}${clip.id}`),
  );
  if (exact) return exact;
  // A section or form pass of a clip is `<id>~<n>`: it plays the audio
  // the bank loaded for `<id>` from the unsliced score.
  const pass = clip.id.lastIndexOf("~");
  return pass > 0
    ? bank.voices.get(
        sampleKey(trackId, `${CLIP_VOICE_PREFIX}${clip.id.slice(0, pass)}`),
      )
    : undefined;
}

/**
 * `score` with each loaded clip's missing `dur` resolved from its file
 * (`resolveClipLengths`), so section, form and window cuts see its real
 * end. A score without clips, or without a bank, comes back as it is.
 */
export function withClipLengths(
  score: TrackScore,
  bank: SampleBank | undefined,
): TrackScore {
  if (!bank || !score.tracks.some((track) => track.clips)) return score;
  return resolveClipLengths(score, (trackId, clip) => {
    const audio = clipAudio(bank, trackId, clip);
    return audio && audio.frames > 0
      ? audio.frames / audio.sampleRate
      : undefined;
  });
}

/** Fractional render sample where a score tick sounds. */
function sampleAt(context: ClipContext, tick: number): number {
  return context.warp
    ? context.warp.sample(tick)
    : tick * context.samplesPerTick;
}

/** The take a clip plays from, if any. */
function takeOf(track: Track, clip: AudioClip): Take | undefined {
  if (clip.take === undefined) return undefined;
  return track.takes?.find((take) => take.name === clip.take);
}

/** Catmull-Rom (4-point Hermite) read at a fractional frame, 0 outside. */
function readHermite(data: Float32Array, position: number): number {
  const base = Math.floor(position);
  const t = position - base;
  const at = (index: number) =>
    index >= 0 && index < data.length ? data[index]! : 0;
  const y0 = at(base - 1);
  const y1 = at(base);
  const y2 = at(base + 1);
  const y3 = at(base + 2);
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}

/** Equal-power fade gain for `x` in 0..1 (sin of a quarter turn). */
export function equalPowerFade(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return Math.sin((x * Math.PI) / 2);
}

/**
 * Sum `track`'s clips into `target` (the mono dry buffer). `gainAt(tick)`
 * is the track volume with automation; `tickAt(sample)` maps a render
 * sample back to a score tick for it. Returns the clips that did not
 * load (they stay silent). With `score` and a `Track.autotune` (0.7), each
 * clip plays retuned (`autotuneClip`, keyed by its offset and nudge);
 * reversed clips play untuned.
 */
export function renderClips(
  target: Float64Array,
  track: Track,
  context: ClipContext,
  bank: SampleBank | undefined,
  gainAt: (tick: number) => number,
  score?: TrackScore,
): string[] {
  const missing: string[] = [];
  if (!track.clips) return missing;
  const { sampleRate, samples } = context;
  const tickAt = (index: number) =>
    context.warp ? context.warp.tick(index) : index / context.samplesPerTick;
  for (const clip of track.clips) {
    if (clip.mute) continue;
    const audio = clipAudio(bank, track.id, clip);
    if (!audio || audio.frames === 0) {
      missing.push(clip.id);
      continue;
    }
    const take = takeOf(track, clip);
    // A take recorded on a drifting clock (`ppm`) plays slightly faster or
    // slower so it stays on the grid; `nudge` moves it in milliseconds.
    const drift = 1 + (take?.ppm ?? 0) / 1e6;
    const nudge = (take?.nudge ?? 0) / 1000;
    const fileSeconds = audio.frames / audio.sampleRate;
    const offset = Math.min(fileSeconds, clip.offset ?? 0);
    const length = Math.max(
      0,
      Math.min(
        clip.dur ?? Number.POSITIVE_INFINITY,
        (fileSeconds - offset) / drift,
      ),
    );
    if (length <= 0) continue;
    const start =
      sampleAt(context, clipSongTick(clip, track.time)) + nudge * sampleRate;
    const total = length * sampleRate;
    const first = Math.max(0, Math.ceil(start));
    const last = Math.min(samples, Math.ceil(start + total));
    if (first >= last) continue;
    const step = (audio.sampleRate / sampleRate) * drift;
    const begin = offset * audio.sampleRate;
    const span = length * audio.sampleRate * drift;
    const fadeIn = Math.min(clip.fadeInTime ?? DEFAULT_CLIP_FADE, length / 2);
    const fadeOut = Math.min(clip.fadeTime ?? DEFAULT_CLIP_FADE, length / 2);
    const fadeInFrames = fadeIn * sampleRate;
    const fadeOutFrames = fadeOut * sampleRate;
    const gain = clip.gain ?? 1;
    // 0.7 autotune: the clip's audio retuned at the song second its
    // offset sounds (`start` already holds the nudge).
    const tuned =
      track.autotune && score && !clip.rev
        ? autotuneClip(
            score,
            track,
            {
              sha256: audio.sha256,
              sampleRate: audio.sampleRate,
              mono: audio.mono,
            },
            start / sampleRate,
            offset,
            clip.id,
            0,
            nudge,
          )
        : undefined;
    const data = tuned ? tuned.mono : audio.mono;
    const shiftFrom = tuned ? tuned.from : 0;
    // Track volume (with automation) is read once per 32-sample block.
    let blockGain = 0;
    for (let index = first; index < last; index += 1) {
      if ((index - first) % 32 === 0) blockGain = gainAt(tickAt(index));
      const elapsed = index - start;
      let position = elapsed * step;
      if (position >= span) break;
      position = clip.rev ? begin + span - 1 - position : begin + position;
      let shape = gain * blockGain;
      if (fadeInFrames > 0 && elapsed < fadeInFrames)
        shape *= equalPowerFade(elapsed / fadeInFrames);
      const remaining = total - elapsed;
      if (fadeOutFrames > 0 && remaining < fadeOutFrames)
        shape *= equalPowerFade(remaining / fadeOutFrames);
      target[index]! += readHermite(data, position - shiftFrom) * shape;
    }
  }
  return missing;
}

/**
 * Stem-cache key part for a track's clips: each clip's sha256 (the one
 * loaded, so an edited file re-renders), placement, cut, gain, fades and
 * reverse, and the drift of the take it plays from.
 */
export function clipsDigest(
  track: Track,
  bank: SampleBank | undefined,
  guide = false,
): string | undefined {
  if (!track.clips || track.clips.length === 0) return undefined;
  return (
    (guide ? "guide|" : "") +
    track.clips
      .map((clip) => {
        const take = takeOf(track, clip);
        return [
          clip.id,
          clipAudio(bank, track.id, clip)?.sha256 ?? `missing:${clip.sha256}`,
          clip.startTick,
          clip.offset ?? "",
          clip.dur ?? "",
          clip.gain ?? "",
          clip.fadeInTime ?? "",
          clip.fadeTime ?? "",
          clip.rev ? "r" : "",
          clip.mute ? "m" : "",
          take ? `${take.ppm ?? 0}/${take.nudge ?? 0}` : "",
        ].join(",");
      })
      .join(";")
  );
}
