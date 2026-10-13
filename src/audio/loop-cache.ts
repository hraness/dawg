import { createHash } from "node:crypto";
import type { TrackScore } from "../../core/score.ts";
import type { SampleBank } from "./samples.ts";
import type { RenderedAudio } from "./wav.ts";

/** One finished loop, separate from the renderer's bounded stem cache. */
export const DEFAULT_LOOP_CACHE_BYTES = 64 * 1024 * 1024;

/** Check current assets before calling this: a score alone cannot identify PCM. */
export function loopCacheKey(
  score: TrackScore,
  sampleRate: number,
  samples?: SampleBank,
): string {
  return createHash("sha256")
    .update(JSON.stringify(score.toJSON()))
    .update(
      JSON.stringify([
        sampleRate,
        [...(samples?.voices ?? [])].map(([key, sample]) => [
          key,
          sample.sha256,
        ]),
        [...(samples?.wavetables ?? [])].map(([key, table]) => [key, table.id]),
        [...(samples?.irs ?? [])].map(([key, sample]) => [key, sample.sha256]),
      ]),
    )
    .digest("hex");
}

/**
 * Cache only the latest complete loop (loop:true, guide:true). Own its PCM:
 * callers may mutate their result, and worker transfers detach their buffer.
 */
export class LoopCache {
  private entry: { key: string; audio: RenderedAudio } | undefined;

  public constructor(private readonly maxBytes = DEFAULT_LOOP_CACHE_BYTES) {}

  public get bytes(): number {
    return this.entry?.audio.pcm.byteLength ?? 0;
  }

  public clear(): void {
    this.entry = undefined;
  }

  public get(key: string): RenderedAudio | undefined {
    const audio = this.entry?.key === key ? this.entry.audio : undefined;
    return audio ? copy(audio) : undefined;
  }

  public set(key: string, audio: RenderedAudio): void {
    this.entry = undefined;
    if (audio.pcm.byteLength <= this.maxBytes && this.maxBytes > 0)
      this.entry = { key, audio: copy(audio) };
  }
}

function copy(audio: RenderedAudio): RenderedAudio {
  return {
    ...audio,
    pcm: audio.pcm.slice(),
    ...(audio.master ? { master: { ...audio.master } } : {}),
  };
}
