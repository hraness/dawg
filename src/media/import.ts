/**
 * `import_sample(file, name, {begin?, end?, root?})`: ffmpeg converts any
 * audio file to a 48 kHz PCM16 wav at `tracks/<slug>/samples/<name>.wav`
 * and the result carries the `sampler({...})` snippet for `track.ts`. The
 * sampler schema itself belongs to the project-format lane; this tool only
 * copies the file and returns the snippet.
 */
import { SCORE_LIMITS } from "../../core/score.ts";
import { join } from "node:path";
import { missingTool } from "./backend.ts";
import { MediaToolError, runHelper } from "./process.ts";
import {
  ensureDir,
  formatBytes,
  projectPath,
  resolveInput,
  samplesDir,
  sha256File,
} from "./paths.ts";
import {
  MEDIA_LIMITS,
  type MediaResult,
  type MediaRunContext,
} from "./types.ts";
import { parseWav } from "./vendor/wav.ts";

export const SAMPLE_LIMITS = Object.freeze({
  maxBytes: SCORE_LIMITS.maxSampleFileBytes,
  maxSeconds: SCORE_LIMITS.maxSampleSeconds,
  sampleRate: 48_000,
});

export type ImportSampleArgs = Readonly<{
  file: string;
  name: string;
  /** Loop/playback window as fractions 0..1 of the file. */
  begin?: number;
  end?: number;
  /** Root note name or MIDI number the sample is pitched at (default C4). */
  root?: string | number;
}>;

export async function importSample(
  args: ImportSampleArgs,
  context: MediaRunContext,
): Promise<MediaResult> {
  if (!context.runner.which("ffmpeg"))
    throw new MediaToolError(missingTool("ffmpeg"));
  const input = await resolveInput(context, args.file);
  const dir = await ensureDir(samplesDir(context));
  const target = join(dir, `${args.name}.wav`);
  context.progress(`ffmpeg → samples/${args.name}.wav`);
  const temp = `${target}.part.wav`;
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
      input.absolute,
      "-vn",
      "-t",
      String(SAMPLE_LIMITS.maxSeconds),
      "-ar",
      String(SAMPLE_LIMITS.sampleRate),
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      temp,
    ],
    { timeoutMs: MEDIA_LIMITS.sampleTimeoutMs },
  );
  const file = Bun.file(temp);
  if (file.size > SAMPLE_LIMITS.maxBytes) {
    await file.delete().catch(() => undefined);
    throw new MediaToolError(
      `${args.name}.wav would be ${formatBytes(file.size)}, over the ${formatBytes(SAMPLE_LIMITS.maxBytes)} sample cap; trim with begin/end on a shorter source`,
    );
  }
  const wav = parseWav(new Uint8Array(await file.arrayBuffer()), {
    maximumBytes: SAMPLE_LIMITS.maxBytes,
    maximumDurationSeconds: SAMPLE_LIMITS.maxSeconds + 1,
    maximumChannels: 2,
  });
  const { rename } = await import("node:fs/promises");
  await rename(temp, target);
  const sha256 = await sha256File(target);
  const durationSeconds =
    Math.round((wav.sampleCount / wav.sampleRate) * 1000) / 1000;
  const src = `samples/${args.name}.wav`;
  const ref: Record<string, unknown> = { src };
  if (args.root !== undefined) ref.root = args.root;
  if (args.begin !== undefined) ref.begin = args.begin;
  if (args.end !== undefined) ref.end = args.end;
  const inner =
    Object.keys(ref).length === 1
      ? JSON.stringify(src)
      : `{ ${Object.entries(ref)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join(", ")} }`;
  // A root means the sample is pitched: keyed mode resamples it across notes.
  const snippet = `instrument: sampler({ ${args.name}: ${inner} }${args.root !== undefined ? ', { mode: "keyed" }' : ""})`;
  const relativePath = projectPath(context.projectRoot, target);
  return {
    summary: `imported ${src} (${durationSeconds}s, ${formatBytes(file.size)})`,
    outputs: [relativePath],
    content: {
      sample: {
        name: args.name,
        src,
        path: relativePath,
        sha256,
        durationSeconds,
        sampleRate: wav.sampleRate,
        channels: wav.channels,
        bytes: file.size,
        ...(args.root !== undefined ? { root: args.root } : {}),
        ...(args.begin !== undefined ? { begin: args.begin } : {}),
        ...(args.end !== undefined ? { end: args.end } : {}),
      },
      snippet,
      note: "Paste the snippet into the track's instrument in track.ts; the sampler schema (voices, root, begin, end, gain, loop, choke) is defined in DAWG.md.",
    },
  };
}
