/**
 * Off-thread full pass for live guitar-rig notes. The key path renders only
 * the first `LIVE_RIG_WINDOW_SECONDS` of a rig note; this worker renders the
 * whole note so the TUI thread never blocks on an oversampled 8 s render.
 * Requests are handled in arrival order, so a strummed chord's strings swap
 * in the order they were played.
 */
import { scoreFromJSON } from "../../core/score.ts";
import { LiveSynth, type LiveNotePcm } from "./live.ts";
import type { SampleBank } from "./samples.ts";

export type LiveFullRequest = Readonly<{
  id: number;
  sampleRate: number;
  score: unknown;
  trackId: string;
  pitch: number;
  velocity: number;
  seconds: number;
  tick?: number;
  samples?: SampleBank;
}>;

export type LiveFullReply = Readonly<{
  id: number;
  pcm?: LiveNotePcm;
  error?: string;
}>;

declare const self: Worker;

let synth: LiveSynth | undefined;

self.onmessage = (event: MessageEvent<LiveFullRequest>) => {
  const { id, sampleRate, score, samples, tick, ...note } = event.data;
  try {
    if (synth?.rate !== sampleRate) synth = new LiveSynth(sampleRate);
    const pcm = synth.render({
      ...note,
      score: scoreFromJSON(score),
      full: true,
      ...(samples ? { samples } : {}),
      ...(tick === undefined ? {} : { tick }),
    });
    const reply: LiveFullReply = pcm ? { id, pcm } : { id };
    self.postMessage(reply);
  } catch (error) {
    const reply: LiveFullReply = {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(reply);
  }
};
