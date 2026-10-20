/**
 * Off-thread loop renderer for the audio engine. One worker per engine
 * keeps a stem cache across renders, so an edit re-renders only the tracks
 * it touched while the daemon loop keeps serving windows and pumping audio.
 */
import { scoreFromJSON } from "../../core/score.ts";
import { SampleLibrary, hasSamplerTracks } from "./samples.ts";
import type { MasterReport } from "./master.ts";
import { renderArranged } from "./arrange.ts";
import { StemRenderer, type MonitorRange } from "./wav.ts";
import { LoopCache, loopCacheKey } from "./loop-cache.ts";
import { WindowCache } from "./window-cache.ts";

export type RenderRequest = Readonly<{
  monitorFrame?: number;
  /** Monitor window shape (see `MonitorJob`). */
  monitorSeconds?: number;
  monitorQuick?: boolean;
  id: number;
  score: unknown;
  sampleRate: number;
  /** Project root sampler voices resolve under; omitted = samplers silent. */
  projectRoot?: string;
  maxLoopCacheBytes?: number;
  maxWindowCacheBytes?: number;
}>;

export type RenderReply =
  | Readonly<{
      id: number;
      ok: true;
      monitor?: MonitorRange;
      frames: number;
      sampleRate: number;
      pcm: Int16Array;
      /** Milliseconds spent rendering, excluding transfer. */
      renderMs: number;
      /** Loudness after the song master; absent without one. */
      master?: MasterReport;
    }>
  | Readonly<{ id: number; ok: false; error: string }>;

declare const self: Worker;

const renderer = new StemRenderer();
let library: SampleLibrary | undefined;
let loopCache: LoopCache | undefined;
let windowCache: WindowCache | undefined;

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const {
    id,
    score,
    sampleRate,
    projectRoot,
    maxLoopCacheBytes,
    maxWindowCacheBytes,
    monitorFrame,
    monitorSeconds,
    monitorQuick,
  } = event.data;
  try {
    const started = performance.now();
    const parsed = scoreFromJSON(score);
    let samples;
    if (projectRoot !== undefined && hasSamplerTracks(parsed)) {
      if (library?.projectRoot !== projectRoot)
        library = new SampleLibrary({ projectRoot });
      samples = await library.load(parsed);
    }
    loopCache ??= new LoopCache(maxLoopCacheBytes);
    windowCache ??= new WindowCache(maxWindowCacheBytes);
    const key =
      monitorFrame === undefined
        ? loopCacheKey(parsed, sampleRate, samples)
        : undefined;
    const cached = key === undefined ? undefined : loopCache.get(key);
    const audio =
      cached ??
      renderArranged(renderer, parsed, {
        sampleRate,
        loop: true,
        // The live loop sounds a vocal track's guide notes (0.7 clips).
        guide: true,
        samples,
        windowCache,
        monitorFrame,
        ...(monitorSeconds === undefined ? {} : { monitorSeconds }),
        ...(monitorQuick ? { monitorQuick } : {}),
      });
    if (!cached && key !== undefined) loopCache.set(key, audio);
    const reply: RenderReply = {
      id,
      ok: true,
      frames: audio.frames,
      sampleRate: audio.sampleRate,
      ...(audio.monitor ? { monitor: audio.monitor } : {}),
      pcm: audio.pcm,
      renderMs: performance.now() - started,
      ...(audio.master ? { master: audio.master } : {}),
    };
    self.postMessage(reply, [audio.pcm.buffer]);
  } catch (error) {
    const reply: RenderReply = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(reply);
  }
};
