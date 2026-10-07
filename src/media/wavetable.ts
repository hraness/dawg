/**
 * `make_wavetable(file, name, {...})`: turns any audio file in the project
 * (a download, a stem, an imported sample) into a wavetable at
 * `tracks/<slug>/wavetables/<name>.wav` — float32 frames of 2048 samples
 * with a `clm ` chunk, the format Serum, Vital and uzu-wavetables use — and
 * reports how the timbre moves across it so the model can pick a position.
 *
 * WAV inputs are read directly; anything else goes through ffmpeg to
 * 48 kHz mono float. The extraction itself is `src/audio/wavetable-maker.ts`.
 */
import { rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { SCORE_LIMITS } from "../../core/score.ts";
import {
  MAKE_FRAME_SIZE,
  WavetableMakeError,
  encodeWavetableWav,
  makeWavetable,
  type MakeMethod,
  type MakeNormalize,
} from "../audio/wavetable-maker.ts";
import { missingTool } from "./backend.ts";
import {
  ensureDir,
  formatBytes,
  projectPath,
  resolveInput,
  sha256File,
} from "./paths.ts";
import { MediaToolError, runHelper } from "./process.ts";
import {
  MEDIA_LIMITS,
  type MediaHost,
  type MediaResult,
  type MediaRunContext,
} from "./types.ts";
import { parseWav } from "./vendor/wav.ts";

/** Longest source read; the maker only analyses a bounded region of it. */
const MAX_SOURCE_SECONDS = 10 * 60;
const DECODE_RATE = 48_000;

export type MakeWavetableArgs = Readonly<{
  file: string;
  name: string;
  frames?: number;
  start?: number;
  end?: number;
  method?: MakeMethod;
  smooth?: number;
  normalize?: MakeNormalize;
}>;

export function wavetablesDir(
  host: Pick<MediaHost, "projectRoot" | "trackSlug">,
): string {
  return join(host.projectRoot, "tracks", host.trackSlug, "wavetables");
}

function mixdown(
  wav: ReturnType<typeof parseWav>,
  maxFrames: number,
): Float32Array {
  const frames = Math.min(wav.sampleCount, maxFrames);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < wav.channels; c += 1) sum += wav.sample(i, c);
    out[i] = sum / wav.channels;
  }
  return out;
}

async function readSource(
  context: MediaRunContext,
  absolute: string,
  size: number,
): Promise<{ mono: Float32Array; sampleRate: number }> {
  const options = {
    maximumBytes: 2 ** 31,
    maximumDurationSeconds: 24 * 3600,
    maximumChannels: 32,
  };
  if (/\.wav$/i.test(absolute) && size <= MEDIA_LIMITS.downloadMaxBytes) {
    try {
      const wav = parseWav(
        new Uint8Array(await Bun.file(absolute).arrayBuffer()),
        options,
      );
      return {
        mono: mixdown(wav, MAX_SOURCE_SECONDS * wav.sampleRate),
        sampleRate: wav.sampleRate,
      };
    } catch {
      // Unusual WAV (ADPCM, extensible quirks): let ffmpeg read it.
    }
  }
  if (!context.runner.which("ffmpeg"))
    throw new MediaToolError(missingTool("ffmpeg"));
  const temp = join(
    await ensureDir(wavetablesDir(context)),
    `.decode-${process.pid}-${Date.now()}.part.wav`,
  );
  context.progress("ffmpeg → mono 48 kHz");
  try {
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
        absolute,
        "-vn",
        "-t",
        String(MAX_SOURCE_SECONDS),
        "-ar",
        String(DECODE_RATE),
        "-ac",
        "1",
        "-c:a",
        "pcm_f32le",
        temp,
      ],
      { timeoutMs: MEDIA_LIMITS.sampleTimeoutMs },
    );
    const wav = parseWav(
      new Uint8Array(await Bun.file(temp).arrayBuffer()),
      options,
    );
    return { mono: mixdown(wav, wav.sampleCount), sampleRate: wav.sampleRate };
  } finally {
    await Bun.file(temp)
      .delete()
      .catch(() => undefined);
  }
}

export async function makeWavetableFile(
  args: MakeWavetableArgs,
  context: MediaRunContext,
): Promise<MediaResult> {
  const input = await resolveInput(context, args.file);
  const { mono, sampleRate } = await readSource(
    context,
    input.absolute,
    input.size,
  );
  context.progress(`analysing ${input.relative}`);
  let made;
  try {
    made = makeWavetable(mono, sampleRate, {
      ...(args.frames !== undefined ? { frames: args.frames } : {}),
      ...(args.start !== undefined ? { start: args.start } : {}),
      ...(args.end !== undefined ? { end: args.end } : {}),
      ...(args.method !== undefined ? { method: args.method } : {}),
      ...(args.smooth !== undefined ? { smooth: args.smooth } : {}),
      ...(args.normalize !== undefined ? { normalize: args.normalize } : {}),
    });
  } catch (error) {
    if (error instanceof WavetableMakeError)
      throw new MediaToolError(error.message);
    throw error;
  }
  const bytes = encodeWavetableWav(made.frames);
  if (bytes.byteLength > SCORE_LIMITS.maxSampleFileBytes)
    throw new MediaToolError(
      `${formatBytes(bytes.byteLength)} is over the sample file limit; use fewer frames`,
    );
  const dir = await ensureDir(wavetablesDir(context));
  const target = join(dir, `${args.name}.wav`);
  const temp = `${target}.part`;
  await Bun.write(temp, bytes);
  await rename(temp, target);
  const sha256 = await sha256File(target);
  const path = projectPath(context.projectRoot, target);
  const size = (await stat(target)).size;
  const region = `${made.region.start.toFixed(2)}–${made.region.end.toFixed(2)} s${made.region.auto ? " (auto)" : ""}`;
  return {
    summary: `wavetable ${args.name} · ${made.frames.length} frames · ${made.method} · ${region}`,
    outputs: [path],
    content: {
      wavetable: {
        name: args.name,
        path,
        sha256,
        frames: made.frames.length,
        frameSize: MAKE_FRAME_SIZE,
        bytes: size,
        source: input.relative,
        method: made.method,
        region: made.region,
        ...(made.pitch ? { pitch: made.pitch } : {}),
      },
      sweep: made.sweep,
      next: `set_wavetable with table "${path}" plays it on a track (wt 0..1 picks the frame; wtenv or set_automation wt sweeps it). In track.ts: instrument: wavetable("./wavetables/${args.name}.wav").`,
    },
  };
}
