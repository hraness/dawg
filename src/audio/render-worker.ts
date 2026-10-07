/**
 * Off-thread loop renderer for the audio engine. One worker per engine
 * keeps a stem cache across renders, so an edit re-renders only the tracks
 * it touched while the daemon loop keeps serving windows and pumping audio.
 */
import { scoreFromJSON } from "../../core/score.ts";
import { StemRenderer } from "./wav.ts";

export type RenderRequest = Readonly<{
  id: number;
  score: unknown;
  sampleRate: number;
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
    }>
  | Readonly<{ id: number; ok: false; error: string }>;

declare const self: Worker;

const renderer = new StemRenderer();

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const { id, score, sampleRate } = event.data;
  try {
    const started = performance.now();
    const audio = renderer.render(scoreFromJSON(score), {
      sampleRate,
      loop: true,
    });
    const reply: RenderReply = {
      id,
      ok: true,
      frames: audio.frames,
      sampleRate: audio.sampleRate,
      pcm: audio.pcm,
      renderMs: performance.now() - started,
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
