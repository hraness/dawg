/**
 * Off-thread measurement for `master measure` and the measure_mix agent
 * tool: a full render (master chain and target search included) plus the
 * BS.1770 meter can take seconds on a long loop, so the TUI hands it to a
 * worker and keeps painting and scheduling audio meanwhile.
 */
import { scoreFromJSON } from "../../core/score.ts";
import { measureScore, type ScoreMeasurement } from "./measure.ts";
import { SampleLibrary, hasSamplerTracks } from "./samples.ts";

export type MeasureRequest = Readonly<{
  score: unknown;
  sampleRate?: number;
  loop?: boolean;
  /** Project root sampler voices resolve under; omitted = samplers silent. */
  projectRoot?: string;
}>;

export type MeasureReply =
  | Readonly<{ ok: true; measured: ScoreMeasurement }>
  | Readonly<{ ok: false; error: string }>;

declare const self: Worker;

self.onmessage = async (event: MessageEvent<MeasureRequest>) => {
  const { score, sampleRate, loop, projectRoot } = event.data;
  try {
    const parsed = scoreFromJSON(score);
    const samples =
      projectRoot !== undefined && hasSamplerTracks(parsed)
        ? await new SampleLibrary({ projectRoot }).load(parsed)
        : undefined;
    const measured = measureScore(parsed, {
      ...(sampleRate === undefined ? {} : { sampleRate }),
      ...(loop === undefined ? {} : { loop }),
      ...(samples ? { samples } : {}),
    });
    self.postMessage({ ok: true, measured } satisfies MeasureReply);
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies MeasureReply);
  }
};
