/**
 * Highway clip-row snapshots (0.7 clips lane): each clip on the focused
 * track as song beats on the tempo map, its waveform peaks over the clip's
 * window and whether it continues another clip (a comp seam).
 *
 * Peaks (`MEDIA_LIMITS.waveformBuckets` per file) come from a per-file cache filled off the frame path: the first
 * frame shows flat blocks, and `loadClipPeaks` fills the cache and asks for
 * a redraw.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { clipEndTick, clipLength, clipSongTick } from "../core/clips.ts";
import type { TrackScore, Track } from "../core/score.ts";
import { SCORE_LIMITS } from "../core/score.ts";
import { waveformPeaks } from "../src/media/dsp.ts";
import { parseWav } from "../src/media/vendor/wav.ts";
import type { ClipSnapshot } from "./highway.ts";

type FilePeaks = Readonly<{ seconds: number; peaks: readonly number[] }>;

const cache = new Map<string, FilePeaks | null>();
const pending = new Set<string>();

/** Cache key: the clip's pin, or its path when not hashed yet. */
function keyOf(src: string, sha256: string | undefined): string {
  return sha256 ?? `path:${src}`;
}

/** Cached peaks for a file, without reading it. */
export function cachedPeaks(
  src: string,
  sha256?: string,
): FilePeaks | null | undefined {
  return cache.get(keyOf(src, sha256));
}

/**
 * Read and analyse every clip file of `track` not cached yet. Resolves true
 * when anything new was cached (the caller redraws).
 */
export async function loadClipPeaks(
  root: string,
  track: Track | undefined,
): Promise<boolean> {
  let changed = false;
  for (const clip of track?.clips ?? []) {
    const key = keyOf(clip.src, clip.sha256);
    if (cache.has(key) || pending.has(key) || clip.src.startsWith("pack:"))
      continue;
    pending.add(key);
    try {
      const wav = parseWav(
        new Uint8Array(await readFile(join(root, clip.src))),
        {
          maximumBytes: SCORE_LIMITS.maxSampleFileBytes,
          maximumDurationSeconds: SCORE_LIMITS.maxClipSeconds + 1,
          maximumChannels: 2,
        },
      );
      cache.set(key, {
        seconds: wav.sampleCount / wav.sampleRate,
        peaks: waveformPeaks(wav),
      });
    } catch {
      cache.set(key, null);
    } finally {
      pending.delete(key);
    }
    changed = true;
  }
  return changed;
}

/** The peaks inside a clip's window (`offset .. offset + dur`), reversed for `rev`. */
function windowPeaks(
  file: FilePeaks,
  offset: number,
  seconds: number,
  rev: boolean,
): number[] {
  const count = file.peaks.length;
  const from = Math.floor((offset / file.seconds) * count);
  const to = Math.max(
    from + 1,
    Math.ceil(((offset + seconds) / file.seconds) * count),
  );
  const slice = file.peaks.slice(Math.max(0, from), Math.min(count, to));
  return rev ? slice.reverse() : slice;
}

/** Clip-row snapshots for `trackId`, undefined when it has no clips. */
export function clipSnapshots(
  score: TrackScore,
  trackId: string,
): ClipSnapshot[] | undefined {
  const track = score.tracks.find((t) => t.id === trackId);
  const clips = track?.clips;
  if (!clips || clips.length === 0) return undefined;
  const tpb = score.ticksPerBeat;
  const ends = new Set<number>();
  const shaped = clips.map((clip) => {
    const file = cachedPeaks(clip.src, clip.sha256) ?? undefined;
    const startTick = clipSongTick(clip, track.time);
    const endTick = clipEndTick(score, clip, file?.seconds);
    return { clip, file, startTick, endTick };
  });
  for (const item of shaped) ends.add(Math.round(item.endTick));
  return shaped.map(({ clip, file, startTick, endTick }) => ({
    id: clip.id,
    startBeat: startTick / tpb,
    durationBeats: Math.max(0, endTick - startTick) / tpb,
    ...(file
      ? {
          peaks: windowPeaks(
            file,
            clip.offset ?? 0,
            clipLength(clip, file.seconds),
            clip.rev === true,
          ),
        }
      : {}),
    ...(clip.take !== undefined ? { take: clip.take } : {}),
    ...(clip.text !== undefined ? { text: clip.text } : {}),
    ...(clip.mute || track.muted ? { muted: true } : {}),
    ...(startTick > 0 && ends.has(Math.round(startTick)) ? { seam: true } : {}),
  }));
}

/** Test hook: forget cached peaks. */
export function clearClipPeaks(): void {
  cache.clear();
}
