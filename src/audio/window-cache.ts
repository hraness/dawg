import { createHash } from "node:crypto";
import type { TrackScore } from "../../core/score.ts";
import { loopCacheKey } from "./loop-cache.ts";
import type { RenderedAudio, RenderOptions } from "./wav.ts";

/** An additional bounded cache, separate from finished loops and track stems. */
export const DEFAULT_WINDOW_CACHE_BYTES = 64 * 1024 * 1024;
/** Bump when window DSP or its serialized dependencies change. */
const WINDOW_RENDER_VERSION = 1;

/** The complete effective window, including foreign-track and asset dependencies. */
export function windowCacheKey(
  score: TrackScore,
  options: RenderOptions,
): string {
  return createHash("sha256")
    .update(loopCacheKey(score, options.sampleRate ?? 22_050, options.samples))
    .update(
      JSON.stringify([
        WINDOW_RENDER_VERSION,
        options.loop === true,
        options.guide === true,
        options.maxSeconds,
        options.seedTick,
        options.seedSeconds,
        options.seedState,
        options.quantChord?.tick,
        options.quantChord?.score.toJSON(),
      ]),
    )
    .digest("hex");
}

function copy(audio: RenderedAudio): RenderedAudio {
  return {
    ...audio,
    pcm: audio.pcm.slice(),
    ...(audio.master ? { master: { ...audio.master } } : {}),
    ...(audio.nonFinite
      ? {
          nonFinite: {
            samples: audio.nonFinite.samples,
            tracks: [...audio.nonFinite.tracks],
          },
        }
      : {}),
  };
}

/** LRU owns its buffers. Neither a caller mutation nor a worker transfer escapes. */
export class WindowCache {
  private readonly entries = new Map<string, RenderedAudio>();
  private retained = 0;
  public hits = 0;
  public misses = 0;

  public constructor(private readonly maxBytes = DEFAULT_WINDOW_CACHE_BYTES) {}
  public get bytes(): number {
    return this.retained;
  }
  public get size(): number {
    return this.entries.size;
  }
  public clear(): void {
    this.entries.clear();
    this.retained = 0;
  }

  public get(key: string): RenderedAudio | undefined {
    const audio = this.entries.get(key);
    if (!audio) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    this.entries.delete(key);
    this.entries.set(key, audio);
    return copy(audio);
  }

  public set(key: string, audio: RenderedAudio): void {
    const old = this.entries.get(key);
    if (old) {
      this.retained -= old.pcm.byteLength;
      this.entries.delete(key);
    }
    if (!(this.maxBytes > 0) || audio.pcm.byteLength > this.maxBytes) return;
    while (this.retained + audio.pcm.byteLength > this.maxBytes) {
      const first = this.entries.keys().next().value;
      if (first === undefined) break;
      this.retained -= this.entries.get(first)!.pcm.byteLength;
      this.entries.delete(first);
    }
    const owned = copy(audio);
    this.entries.set(key, owned);
    this.retained += owned.pcm.byteLength;
  }
}
