import { createHash } from "node:crypto";
import { withWavComment } from "./packs.ts";
import { scoreFromJSON } from "../../core/score.ts";
import { renderArrangedPcm, sectionCues } from "./arrange.ts";
import { encodeWav, withWavCues, RENDER_CHANNELS } from "./wav.ts";
import { measureRendered } from "./measure.ts";
import type { SampleBank } from "./samples.ts";

/** All full-buffer passes belong on the same side of the worker boundary. */
export function renderExportAudio(
  json: unknown,
  samples: SampleBank | undefined,
  sampleRate: number,
  cues: boolean,
  measure: boolean,
  comment?: string,
) {
  const score = scoreFromJSON(json);
  const audio = renderArrangedPcm(score, { samples, sampleRate });
  let wav = encodeWav(audio.pcm, audio.sampleRate, RENDER_CHANNELS);
  if (cues) wav = withWavCues(wav, sectionCues(score, audio.sampleRate));
  if (comment) wav = withWavComment(wav, comment);
  const sha256 = createHash("sha256").update(wav).digest("hex");
  let clipped = 0;
  for (const sample of audio.pcm)
    if (sample === -32768 || sample === 32767) clipped += 1;
  return {
    wav,
    clipped,
    sha256,
    frames: audio.frames,
    sampleRate: audio.sampleRate,
    master: audio.master,
    nonFinite: audio.nonFinite,
    measurement: measure ? measureRendered(audio, false).mix : undefined,
  };
}
export type ExportAudio = ReturnType<typeof renderExportAudio>;
