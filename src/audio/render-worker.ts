/**
 * Off-thread loop renderer for the audio engine. One worker per engine
 * keeps a stem cache across renders, so an edit re-renders only the tracks
 * it touched while the daemon loop keeps serving windows and pumping audio.
 */
import { scoreFromJSON } from "../../core/score.ts";
import { SampleLibrary, hasSamplerTracks } from "./samples.ts";
import type { MasterReport } from "./master.ts";
import { StemRenderer } from "./wav.ts";

export type RenderRequest = Readonly<{
  id: number;
  score: unknown;
  sampleRate: number;
  /** Project root sampler voices resolve under; omitted = samplers silent. */
  projectRoot?: string;
}>;

export type RenderReply =
  | Readonly<{
      id: number;
      ok: true;
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

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const { id, score, sampleRate, projectRoot } = event.data;
  try {
    const started = performance.now();
    const parsed = scoreFromJSON(score);
    let samples;
    if (projectRoot !== undefined && hasSamplerTracks(parsed)) {
      if (library?.projectRoot !== projectRoot)
        library = new SampleLibrary({ projectRoot });
      samples = await library.load(parsed);
    }
    const audio = renderer.render(parsed, {
      sampleRate,
      loop: true,
      samples,
    });
    const reply: RenderReply = {
      id,
      ok: true,
      frames: audio.frames,
      sampleRate: audio.sampleRate,
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
