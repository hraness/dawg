/**
 * `analyze_audio(file)`: ffprobe for format and duration, a beat grid from
 * StemDeck when the file came through it, otherwise a TypeScript onset
 * autocorrelation tempo estimate; key from a pitch-class histogram (the same
 * scale fit the session namer uses); and 240 waveform peaks. Everything is
 * written to `<name>.analysis.json` next to the file and summarised for the
 * model.
 */
import { join } from "node:path";
import { detectStemDeck, missingTool } from "./backend.ts";
import {
  estimateTempo,
  keyFromHistogram,
  monoSignal,
  onsetEnvelope,
  pitchClassHistogram,
  waveformPeaks,
} from "./dsp.ts";
import {
  formatSeconds,
  projectPath,
  readJson,
  resolveInput,
  writeJsonAtomic,
} from "./paths.ts";
import {
  MediaToolError,
  runHelper,
  throwIfAborted,
  withTempDir,
} from "./process.ts";
import { readSidecar } from "./sidecar.ts";
import { createStemDeck, type StemDeckOptions } from "./stemdeck.ts";
import {
  MEDIA_LIMITS,
  type BeatGrid,
  type MediaResult,
  type MediaRunContext,
} from "./types.ts";
import { beatIntervalCv, fixedBeatGrid, gridMedianBpm } from "./vendor/grid.ts";
import { finiteNumber, isRecord, optionalString } from "./vendor/util.ts";
import { parseWav, type ParsedWav } from "./vendor/wav.ts";

export type AudioAnalysis = Readonly<{
  file: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  codec: string;
  bytes: number;
  bpm?: number;
  bpmConfidence?: number;
  key?: string;
  grid?: BeatGrid;
  peaks: readonly number[];
  analyzedAt: string;
}>;

export type AnalyzeArgs = Readonly<{ file: string }>;
export type AnalyzeOptions = Readonly<{
  stemdeck?: StemDeckOptions;
  now?: () => Date;
}>;

export function analysisPath(filePath: string): string {
  return filePath.replace(/\.[A-Za-z0-9]{1,5}$/, "") + ".analysis.json";
}

type Probe = Readonly<{
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  codec: string;
  bytes: number;
}>;

export async function ffprobe(
  context: MediaRunContext,
  path: string,
): Promise<Probe> {
  if (!context.runner.which("ffprobe"))
    throw new MediaToolError(missingTool("ffprobe"));
  const result = await runHelper(
    context,
    [
      "ffprobe",
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      "-select_streams",
      "a:0",
      path,
    ],
    { timeoutMs: 60_000 },
  );
  let body: unknown;
  try {
    body = JSON.parse(result.stdout) as unknown;
  } catch {
    throw new MediaToolError("ffprobe did not return JSON");
  }
  if (!isRecord(body))
    throw new MediaToolError("ffprobe output was not an object");
  const format = isRecord(body.format) ? body.format : {};
  const stream =
    Array.isArray(body.streams) && isRecord(body.streams[0])
      ? body.streams[0]
      : {};
  const duration = Number(
    optionalString(format.duration ?? stream.duration, 40),
  );
  const sampleRate = Number(optionalString(stream.sample_rate, 20));
  const channels = finiteNumber(stream.channels);
  const bytes = Number(optionalString(format.size, 30));
  if (!Number.isFinite(duration) || duration <= 0)
    throw new MediaToolError(
      "ffprobe found no audio duration (not an audio file?)",
    );
  return {
    durationSeconds: Math.round(duration * 1000) / 1000,
    sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 0,
    channels: channels !== undefined && channels > 0 ? channels : 0,
    codec: optionalString(stream.codec_name, 40) ?? "unknown",
    bytes: Number.isFinite(bytes) ? bytes : Bun.file(path).size,
  };
}

/** Parse a wav directly, or decode anything else to 22.05 kHz mono via ffmpeg. */
export async function loadWav(
  context: MediaRunContext,
  path: string,
): Promise<ParsedWav> {
  const file = Bun.file(path);
  if (file.size > MEDIA_LIMITS.maxWavBytes)
    throw new MediaToolError(
      `${path.split("/").at(-1)} is over the 256 MiB analysis cap`,
    );
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const riff = String.fromCharCode(...head.subarray(0, 4)) === "RIFF";
  if (riff) return parseWav(new Uint8Array(await file.arrayBuffer()));
  if (!context.runner.which("ffmpeg"))
    throw new MediaToolError(missingTool("ffmpeg"));
  return withTempDir("decode", async (temp) => {
    const out = join(temp, "decoded.wav");
    context.progress("ffmpeg decoding");
    await runHelper(
      context,
      [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-i",
        path,
        "-vn",
        "-t",
        "600",
        "-ar",
        "22050",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        out,
      ],
      { timeoutMs: MEDIA_LIMITS.analyzeTimeoutMs },
    );
    return parseWav(new Uint8Array(await Bun.file(out).arrayBuffer()));
  });
}

export async function readAnalysis(
  filePath: string,
): Promise<AudioAnalysis | undefined> {
  const value = await readJson(analysisPath(filePath));
  if (!isRecord(value)) return undefined;
  const duration = finiteNumber(value.durationSeconds);
  if (duration === undefined) return undefined;
  const grid =
    isRecord(value.grid) && Array.isArray(value.grid.beats)
      ? parseGrid(value.grid)
      : undefined;
  const bpm = finiteNumber(value.bpm);
  const key = optionalString(value.key, 20);
  return {
    file: optionalString(value.file, 1024) ?? "",
    durationSeconds: duration,
    sampleRate: finiteNumber(value.sampleRate) ?? 0,
    channels: finiteNumber(value.channels) ?? 0,
    codec: optionalString(value.codec, 40) ?? "unknown",
    bytes: finiteNumber(value.bytes) ?? 0,
    ...(bpm !== undefined ? { bpm } : {}),
    ...(key ? { key } : {}),
    ...(grid ? { grid } : {}),
    peaks: Array.isArray(value.peaks)
      ? value.peaks.slice(0, 240).map((entry) => finiteNumber(entry) ?? 0)
      : [],
    analyzedAt: optionalString(value.analyzedAt, 40) ?? "",
  };
}

function parseGrid(value: Record<string, unknown>): BeatGrid | undefined {
  const beats = (value.beats as unknown[])
    .slice(0, 20_000)
    .map((entry) => finiteNumber(entry));
  if (beats.length < 2 || beats.some((beat) => beat === undefined))
    return undefined;
  const clean = beats as number[];
  for (let index = 1; index < clean.length; index += 1)
    if (clean[index]! <= clean[index - 1]!) return undefined;
  const bars = Array.isArray(value.bars)
    ? value.bars.slice(0, 2_000).flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const beat = finiteNumber(entry.beat);
        const beatsPerBar = finiteNumber(entry.beatsPerBar);
        return beat === undefined || beatsPerBar === undefined
          ? []
          : [{ beat, beatsPerBar }];
      })
    : [];
  const bpm = finiteNumber(value.bpm);
  const detector = optionalString(value.detector, 80);
  return {
    beats: clean,
    bars,
    durationSeconds: finiteNumber(value.durationSeconds) ?? clean.at(-1)!,
    ...(bpm !== undefined ? { bpm } : {}),
    ...(detector ? { detector } : {}),
    intervalCv: beatIntervalCv(clean),
  };
}

export async function analyzeAudio(
  args: AnalyzeArgs,
  context: MediaRunContext,
  options: AnalyzeOptions = {},
): Promise<MediaResult> {
  const input = await resolveInput(context, args.file);
  context.progress("ffprobe");
  const probe = await ffprobe(context, input.absolute);
  if (probe.durationSeconds > 7_200)
    throw new MediaToolError("analysis is limited to files under two hours");
  throwIfAborted(context.signal);

  // Beat grid from StemDeck when this file (or the download it was split from) went through it.
  let grid: BeatGrid | undefined;
  let bpm: number | undefined;
  let bpmConfidence: number | undefined;
  let key: string | undefined;
  const sidecar =
    (await readSidecar(input.absolute)) ??
    (await readSidecar(parentDownload(input.absolute)));
  if (sidecar?.stemdeck) {
    const health = await detectStemDeck(context);
    if (health && health.url === sidecar.stemdeck.url) {
      context.progress("stemdeck beat grid");
      const client = createStemDeck(health, context, options.stemdeck);
      grid = await client.beats(sidecar.stemdeck.jobId);
      if (grid) {
        bpm = gridMedianBpm(grid);
        bpmConfidence =
          grid.confidence !== undefined
            ? Math.min(1, grid.confidence / 100)
            : 1 - Math.min(1, grid.intervalCv ?? 0);
      }
    }
    if (sidecar.key) key = sidecar.key.toLowerCase();
    if (bpm === undefined && sidecar.bpm !== undefined) bpm = sidecar.bpm;
  }

  context.progress("decoding");
  const wav = await loadWav(context, input.absolute);
  throwIfAborted(context.signal);
  const mono = monoSignal(wav);
  if (grid === undefined) {
    context.progress("tempo");
    const { envelope, hopSeconds } = onsetEnvelope(mono, wav.sampleRate);
    const tempo = estimateTempo(envelope, hopSeconds);
    if (tempo) {
      bpm = bpm ?? tempo.bpm;
      bpmConfidence = tempo.confidence;
      grid = fixedBeatGrid(bpm, probe.durationSeconds, tempo.offsetSeconds);
    }
  }
  throwIfAborted(context.signal);
  if (key === undefined) {
    context.progress("key");
    key =
      keyFromHistogram(pitchClassHistogram(mono, wav.sampleRate)) ?? undefined;
  }
  context.progress("waveform");
  const peaks = waveformPeaks(wav);
  const analysis: AudioAnalysis = {
    file: input.relative,
    ...probe,
    ...(bpm !== undefined ? { bpm: Math.round(bpm * 10) / 10 } : {}),
    ...(bpmConfidence !== undefined
      ? { bpmConfidence: Math.round(bpmConfidence * 100) / 100 }
      : {}),
    ...(key ? { key } : {}),
    ...(grid ? { grid } : {}),
    peaks,
    analyzedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  const out = analysisPath(input.absolute);
  await writeJsonAtomic(out, analysis);
  const relativeOut = projectPath(context.projectRoot, out);
  return {
    summary: `analyzed ${input.relative}: ${formatSeconds(probe.durationSeconds)}${bpm !== undefined ? ` · ${analysis.bpm} bpm` : ""}${key ? ` · ${key}` : ""}`,
    outputs: [relativeOut],
    content: {
      file: input.relative,
      analysis: relativeOut,
      durationSeconds: probe.durationSeconds,
      sampleRate: probe.sampleRate,
      channels: probe.channels,
      codec: probe.codec,
      ...(analysis.bpm !== undefined ? { bpm: analysis.bpm } : {}),
      ...(analysis.bpmConfidence !== undefined
        ? { bpmConfidence: analysis.bpmConfidence }
        : {}),
      ...(key ? { key } : {}),
      ...(grid
        ? {
            grid: {
              detector: grid.detector ?? "unknown",
              beats: grid.beats.length,
              firstBeatSeconds: Math.round(grid.beats[0]! * 1000) / 1000,
              bars: grid.bars.length,
            },
          }
        : {}),
      peaks: downsample(peaks, 48),
    },
  };
}

/** `<x>.stems/<stem>.wav` → `<x>.wav`, so stems inherit the download's sidecar. */
function parentDownload(path: string): string {
  const match = /^(.*)\.stems\/[^/]+\.wav$/.exec(path);
  return match ? `${match[1]}.wav` : path;
}

function downsample(values: readonly number[], buckets: number): number[] {
  if (values.length <= buckets) return [...values];
  const out: number[] = [];
  const per = values.length / buckets;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor(bucket * per);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * per));
    let maximum = 0;
    for (let index = start; index < end; index += 1)
      maximum = Math.max(maximum, values[index] ?? 0);
    out.push(Math.round(maximum * 100) / 100);
  }
  return out;
}

export { analysisPath as analysisPathFor };
