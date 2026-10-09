/**
 * Resample (0.6.1): render one track, one orbit or the whole mix, over the
 * song, a section or a bar range, to a 16-bit WAV a new sampler or granular
 * track plays. The render is the same offline path `dawg render` writes
 * (`renderArrangedPcm`), with the source soloed and, unless `master` is
 * asked for, the song master left out (a pre-master stem), so the same score
 * always gives the same bytes and the same sha256.
 *
 * Level: the sampler plays a resampled stereo file (a ref with `from`) as
 * stereo, each channel scaled by SAMPLE_LEVEL and the centre pan's
 * equal-power gain, so the file is written RESAMPLE_FILE_SCALE louder than
 * the stem (about +0.09 dB) for the new track, at voice gain RESAMPLE_GAIN
 * and pan 0, to match the source in both channels (panned sources and
 * stereo effects keep their image). A granular track reads the mono
 * mixdown. Peaks past full scale clamp.
 *
 * A section or bar range renders from PREROLL_BARS before it (or from the
 * earliest source note still sounding at its start) and drops those
 * frames, so held notes and effect tails cross into the range as in the
 * song.
 */
import { withClipLengths } from "./clips.ts";
import { createHash } from "node:crypto";
import {
  SCORE_LIMITS,
  TrackScore,
  ScoreValidationError,
  type SampleProvenance,
  type Track,
} from "../../core/score.ts";
import { barTicks, findSection, sectionScore } from "../../core/sections.ts";
import { secondsAtTick } from "../../core/tempo.ts";
import { renderArrangedPcm } from "./arrange.ts";
import { orbitOf } from "./effects/duck.ts";
import { exportSampleRate } from "./measure.ts";
import { SAMPLE_LEVEL } from "./sampler.ts";
import type { SampleBank } from "./samples.ts";
import { RENDER_CHANNELS, encodeWav } from "./wav.ts";

/** Bars rendered before a section or bar range for effect tails. */
export const PREROLL_BARS = 2;

/** Voice gain the new sampler track plays the file at. */
export const RESAMPLE_GAIN = 2;
/** File level over the rendered stem so the voice reproduces it. */
export const RESAMPLE_FILE_SCALE =
  Math.SQRT1_2 / (SAMPLE_LEVEL * RESAMPLE_GAIN * 0.5);

export type ResampleSource =
  | Readonly<{ kind: "track"; trackId: string }>
  | Readonly<{ kind: "orbit"; orbit: number }>
  | Readonly<{ kind: "master" }>;

export type ResampleRange =
  | Readonly<{ kind: "song" }>
  | Readonly<{ kind: "section"; name: string }>
  | Readonly<{ kind: "bars"; from: number; to: number }>;

export type ResampleRequest = Readonly<{
  source: ResampleSource;
  range: ResampleRange;
  /** Keep the song master on the render (always on for `master`). */
  post?: boolean;
}>;

export type ResampleRender = Readonly<{
  wav: Uint8Array;
  sha256: string;
  sampleRate: number;
  seconds: number;
  /** Score tick the rendered range starts at (where the new note goes). */
  startTick: number;
  /** Ticks the range covers (the new note's length). */
  durationTicks: number;
  from: SampleProvenance;
}>;

/** `track:<id>`, `orbit:<n>` or `master`: the provenance source name. */
export function resampleSourceName(source: ResampleSource): string {
  if (source.kind === "track") return `track:${source.trackId}`;
  if (source.kind === "orbit") return `orbit:${source.orbit}`;
  return "master";
}

/** sha256 of the score's canonical JSON (the provenance pin). */
export function scoreSha256(score: TrackScore): string {
  return createHash("sha256")
    .update(JSON.stringify(score.toJSON()))
    .digest("hex");
}

/** The tracks a source plays (throws for an unknown track or empty orbit). */
export function resampleTracks(
  score: TrackScore,
  source: ResampleSource,
): readonly Track[] {
  if (source.kind === "master") return score.tracks;
  const tracks =
    source.kind === "track"
      ? score.tracks.filter((track) => track.id === source.trackId)
      : score.tracks.filter((track) => orbitOf(track) === source.orbit);
  if (tracks.length === 0)
    throw new ScoreValidationError(
      source.kind === "track"
        ? `no track ${source.trackId}`
        : `no track plays on orbit ${source.orbit}`,
      "invalid-track",
    );
  return tracks;
}

/**
 * The score the render plays: the source soloed (every other track muted),
 * the master removed unless `post`, cut to the range. Returns where the
 * range sits in the song.
 */
export function resampleScore(
  score: TrackScore,
  request: ResampleRequest,
): Readonly<{
  score: TrackScore;
  startTick: number;
  durationTicks: number;
  /** Ticks of lead-in the render plays before the range (sliced off). */
  leadTicks: number;
}> {
  const sources = new Set(
    resampleTracks(score, request.source).map((track) => track.id),
  );
  const post = request.post === true || request.source.kind === "master";
  const json = { ...score.toJSON() } as Record<string, unknown>;
  json.tracks = score.tracks.map((track) => {
    const copy = { ...track } as Record<string, unknown>;
    delete copy.solo;
    // Solo, not mute, the others: a granular `quant chord` source still
    // hears the song's harmony (muted tracks leave the chord).
    if (request.source.kind !== "master" && sources.has(track.id)) {
      delete copy.muted;
      copy.solo = true;
    }
    return copy;
  });
  if (!post) delete json.master;
  let played = new TrackScore(json as never);
  const ticks = barTicks(played);
  const range = request.range;
  if (range.kind === "song")
    return {
      score: played,
      startTick: 0,
      durationTicks: played.bars * ticks,
      leadTicks: 0,
    };
  let section;
  if (range.kind === "section") {
    section = findSection(played, range.name);
    if (!section)
      throw new ScoreValidationError(
        `no section named ${range.name}${played.sections.length > 0 ? ` (sections: ${played.sections.map((s) => s.name).join(", ")})` : ""}`,
        "invalid-track",
      );
  } else {
    if (
      !Number.isInteger(range.from) ||
      !Number.isInteger(range.to) ||
      range.from < 1 ||
      range.to < range.from ||
      range.to > played.bars
    )
      throw new ScoreValidationError(
        `bars must be a-b inside 1-${played.bars}`,
        "invalid-track",
      );
    section = {
      name: "resample",
      startBar: range.from - 1,
      bars: range.to - range.from + 1,
    };
  }
  // Lead-in: notes still sounding at the range start, and the effect tails
  // of the bars before it, play from where they began (PREROLL_BARS back at
  // least); the render then drops the lead-in frames.
  const from = section.startBar * ticks;
  let leadBar = Math.max(0, section.startBar - PREROLL_BARS);
  for (const note of played.notes)
    if (
      sources.has(note.trackId) &&
      note.startTick < from &&
      note.startTick + note.durationTicks > from
    )
      leadBar = Math.min(leadBar, Math.floor(note.startTick / ticks));
  const lead = section.startBar - leadBar;
  played = sectionScore(played, {
    ...section,
    startBar: leadBar,
    bars: section.bars + lead,
  });
  return {
    score: played,
    startTick: from,
    durationTicks: section.bars * ticks,
    leadTicks: lead * ticks,
  };
}

/**
 * Render a resample to WAV bytes. `samples` is the source score's loaded
 * bank (needed when the source plays samples).
 */
export function renderResample(
  score: TrackScore,
  request: ResampleRequest,
  samples?: SampleBank,
): ResampleRender {
  const {
    score: played,
    startTick,
    durationTicks,
    leadTicks,
  } = resampleScore(withClipLengths(score, samples), request);
  // The song's export rate (48 kHz once it has a master), so the new
  // track nulls against the source when both play at that rate.
  const sampleRate = exportSampleRate(score);
  const rendered = renderArrangedPcm(played, {
    sampleRate,
    loop: false,
    ...(samples ? { samples } : {}),
  });
  const skip = Math.min(
    rendered.frames,
    Math.round(secondsAtTick(played, leadTicks) * rendered.sampleRate),
  );
  const audio =
    skip === 0
      ? rendered
      : {
          ...rendered,
          frames: rendered.frames - skip,
          pcm: rendered.pcm.subarray(skip * RENDER_CHANNELS),
        };
  const full = new Int16Array(audio.pcm.length);
  for (let index = 0; index < full.length; index += 1)
    full[index] = Math.max(
      -32_768,
      Math.min(32_767, Math.round(audio.pcm[index]! * RESAMPLE_FILE_SCALE)),
    );
  // Trim the tail that rounds to digital silence (within 1 LSB): the new
  // track's note length comes from the range, not from the file.
  let end = full.length;
  while (end > 0 && Math.abs(full[end - 1]!) <= 1) end -= 1;
  if (end === 0)
    throw new ScoreValidationError(
      `${resampleSourceName(request.source)} is silent here · nothing to resample (add notes, unmute it or pick other bars)`,
    );
  // Keep 20 ms of silence so the sampler's end fade lands on nothing.
  const frames = Math.min(
    audio.frames,
    Math.ceil(end / RENDER_CHANNELS) + Math.round(0.02 * audio.sampleRate),
  );
  const pcm = full.subarray(0, frames * RENDER_CHANNELS);
  const seconds = frames / audio.sampleRate;
  if (seconds > SCORE_LIMITS.maxResampleSeconds)
    throw new ScoreValidationError(
      `the resample is ${Math.round(seconds)} s; the limit is ${SCORE_LIMITS.maxResampleSeconds} s · pick a section or bars`,
      "score-limit",
    );
  const wav = encodeWav(pcm, audio.sampleRate, RENDER_CHANNELS);
  const range = request.range;
  const from: SampleProvenance = {
    source: resampleSourceName(request.source),
    ...(range.kind === "section"
      ? { section: findSection(score, range.name)?.name ?? range.name }
      : {}),
    ...(range.kind === "bars" ? { bars: [range.from, range.to] as const } : {}),
    score: scoreSha256(score),
  };
  return {
    wav,
    sha256: createHash("sha256").update(wav).digest("hex"),
    sampleRate: audio.sampleRate,
    seconds,
    startTick,
    durationTicks,
    from,
  };
}
