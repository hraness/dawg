/**
 * Off-thread full pass for live keys. The key path renders only the first
 * `LIVE_RIG_WINDOW_SECONDS`; this worker renders the whole note so the TUI
 * thread never blocks on a sustained voice or a long effect tail.
 * Requests are handled in arrival order, so a strummed chord's strings swap
 * in the order they were played.
 */
import { scoreFromJSON } from "../../core/score.ts";
import { LiveSynth, type LiveNotePcm } from "./live.ts";
import type { SampleBank } from "./samples.ts";
import { liveSamplesFromData, type LiveSampleData } from "./live-samples.ts";

export type LiveFullRequest = Readonly<{
  id: number;
  sampleRate: number;
  score: unknown;
  trackId: string;
  pitch: number;
  velocity: number;
  seconds: number;
  tick?: number;
  clock?: number;
  sampleVersion: number;
  samples?: LiveSampleData;
}>;

export type LiveFullReply = Readonly<{
  id: number;
  pcm?: LiveNotePcm;
  error?: string;
}>;

declare const self: Worker;

let synth: LiveSynth | undefined;
let sampleVersion = 0;
let samples: SampleBank | undefined;

self.onmessage = (event: MessageEvent<LiveFullRequest>) => {
  const {
    id,
    sampleRate,
    score,
    tick,
    clock,
    samples: nextSamples,
    sampleVersion: nextVersion,
    ...note
  } = event.data;
  try {
    if (sampleVersion !== nextVersion) {
      sampleVersion = nextVersion;
      samples = nextSamples ? liveSamplesFromData(nextSamples) : undefined;
    }
    if (synth?.rate !== sampleRate) synth = new LiveSynth(sampleRate);
    const pcm = synth.render({
      ...note,
      score: scoreFromJSON(score),
      full: true,
      ...(samples ? { samples } : {}),
      ...(tick === undefined ? {} : { tick }),
      ...(clock === undefined ? {} : { clock }),
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
