/**
 * `download_audio(url, name?)`: YouTube only. With yt-dlp installed the audio
 * is extracted straight to `tracks/<slug>/downloads/<name>.wav`; without it a
 * running StemDeck does the download and separation, the stems land in
 * `<name>.stems/` and ffmpeg (when present) sums them back into `<name>.wav`.
 * A `<name>.json` sidecar records title, duration, source URL and sha256 so
 * later tools (and the brief) never fetch the same thing twice.
 */
import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { detectStemDeck, missingTool } from "./backend.ts";
import {
  downloadsDir,
  ensureDir,
  exists,
  formatBytes,
  formatSeconds,
  freshPath,
  projectPath,
  readJson,
  sha256File,
  trackSlug,
  writeJsonAtomic,
} from "./paths.ts";
import {
  MediaToolError,
  runHelper,
  throwIfAborted,
  withTempDir,
} from "./process.ts";
import { readSidecar, sidecarPath, type MediaSidecar } from "./sidecar.ts";
import {
  STEM_NAMES,
  createStemDeck,
  type StemDeckOptions,
} from "./stemdeck.ts";
import {
  MEDIA_LIMITS,
  type MediaResult,
  type MediaRunContext,
} from "./types.ts";
import {
  finiteNumber,
  isRecord,
  optionalString,
  validateYoutubeUrl,
} from "./vendor/util.ts";

export type { MediaSidecar } from "./sidecar.ts";

export type DownloadArgs = Readonly<{ url: string; name?: string }>;

export type DownloadOptions = Readonly<{
  stemdeck?: StemDeckOptions;
  now?: () => Date;
}>;

function ytdlpProgress(chunk: string): string | undefined {
  if (/\[ExtractAudio\]/.test(chunk)) return "yt-dlp converting to wav";
  const match = chunk.match(/\[download\]\s+(\d{1,3}(?:\.\d)?)%/g)?.at(-1);
  if (!match) return undefined;
  const percent = Math.min(
    100,
    Math.round(parseFloat(match.replace(/.*\]\s+/, ""))),
  );
  return `yt-dlp ${percent}%`;
}

export async function downloadAudio(
  args: DownloadArgs,
  context: MediaRunContext,
  options: DownloadOptions = {},
): Promise<MediaResult> {
  const url = validateYoutubeUrl(args.url);
  const dir = await ensureDir(downloadsDir(context));
  const now = options.now ?? (() => new Date());
  // Reuse an earlier download of the same source.
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    const wav = join(dir, name.replace(/\.json$/, ".wav"));
    const sidecar = await readSidecar(wav);
    if (sidecar?.source === url && (await exists(wav))) {
      const relativePath = projectPath(context.projectRoot, wav);
      return {
        summary: `already downloaded: ${relativePath}`,
        outputs: [
          relativePath,
          projectPath(context.projectRoot, sidecarPath(wav)),
        ],
        content: { reused: true, wav: relativePath, ...sidecar },
      };
    }
  }
  if (context.runner.which("yt-dlp")) {
    if (!context.runner.which("ffmpeg"))
      throw new MediaToolError(missingTool("ffmpeg"));
    return downloadWithYtDlp(url, args.name, dir, context, now);
  }
  const health = await detectStemDeck(context);
  if (!health)
    throw new MediaToolError(
      `${missingTool("yt-dlp")}; no StemDeck answered at the configured URL either`,
    );
  return downloadWithStemDeck(
    url,
    args.name,
    dir,
    context,
    health,
    options,
    now,
  );
}

async function downloadWithYtDlp(
  url: string,
  requestedName: string | undefined,
  dir: string,
  context: MediaRunContext,
  now: () => Date,
): Promise<MediaResult> {
  return withTempDir("download", async (temp) => {
    context.progress("yt-dlp starting");
    await runHelper(
      context,
      [
        "yt-dlp",
        "--no-playlist",
        "--newline",
        "--no-colors",
        "--no-progress",
        "--progress",
        "--max-filesize",
        `${Math.floor(MEDIA_LIMITS.downloadMaxBytes / (1024 * 1024))}m`,
        "--write-info-json",
        "--no-write-playlist-metafiles",
        "-x",
        "--audio-format",
        "wav",
        "-o",
        join(temp, "audio.%(ext)s"),
        "--",
        url,
      ],
      { timeoutMs: MEDIA_LIMITS.downloadTimeoutMs, progress: ytdlpProgress },
    );
    throwIfAborted(context.signal);
    const wavTemp = join(temp, "audio.wav");
    if (!(await exists(wavTemp)))
      throw new MediaToolError(
        "yt-dlp finished without producing audio.wav (over the 500 MiB cap, or no audio stream)",
      );
    const size = Bun.file(wavTemp).size;
    if (size > MEDIA_LIMITS.downloadMaxBytes)
      throw new MediaToolError(
        `downloaded audio is ${formatBytes(size)}, over the 500 MiB cap`,
      );
    const info = await readJson(join(temp, "audio.info.json"));
    const title =
      (isRecord(info) ? optionalString(info.title, 200) : undefined) ??
      "download";
    const duration = isRecord(info) ? finiteNumber(info.duration) : undefined;
    const base = trackSlug(requestedName ?? title);
    const { path: wav, base: finalBase } = await freshPath(dir, base, ".wav");
    await rename(wavTemp, wav).catch(async () => {
      // Temp dir may sit on another volume.
      await Bun.write(wav, Bun.file(wavTemp));
      await rm(wavTemp, { force: true });
    });
    const sha256 = await sha256File(wav);
    const sidecar: MediaSidecar = {
      title,
      ...(duration !== undefined ? { durationSeconds: duration } : {}),
      source: url,
      sha256,
      bytes: size,
      backend: "yt-dlp",
      downloadedAt: now().toISOString(),
    };
    await writeJsonAtomic(sidecarPath(wav), sidecar);
    const relativePath = projectPath(context.projectRoot, wav);
    return {
      summary: `downloaded ${finalBase}.wav (${duration !== undefined ? formatSeconds(duration) : formatBytes(size)})`,
      outputs: [
        relativePath,
        projectPath(context.projectRoot, sidecarPath(wav)),
      ],
      content: { wav: relativePath, ...sidecar },
    };
  });
}

async function downloadWithStemDeck(
  url: string,
  requestedName: string | undefined,
  dir: string,
  context: MediaRunContext,
  health: NonNullable<Awaited<ReturnType<typeof detectStemDeck>>>,
  options: DownloadOptions,
  now: () => Date,
): Promise<MediaResult> {
  const client = createStemDeck(health, context, options.stemdeck);
  context.progress("stemdeck submitting");
  const jobId = await client.submit(url);
  const job = await client.wait(jobId, MEDIA_LIMITS.downloadTimeoutMs);
  if (job.stems.length === 0)
    throw new MediaToolError("StemDeck finished the job but offered no stems");
  const base = trackSlug(requestedName ?? job.title ?? "download");
  const { path: wav, base: finalBase } = await freshPath(dir, base, ".wav");
  const stemsDir = await ensureDir(join(dir, `${finalBase}.stems`));
  const stemPaths = await client.fetchStems(
    job,
    stemsDir,
    MEDIA_LIMITS.downloadMaxBytes,
  );
  const outputs = stemPaths.map((path) =>
    projectPath(context.projectRoot, path),
  );
  let mixed = false;
  if (context.runner.which("ffmpeg")) {
    context.progress("ffmpeg mixing stems");
    const inputs = stemPaths.flatMap((path) => ["-i", path]);
    await runHelper(
      context,
      [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        ...inputs,
        "-filter_complex",
        `amix=inputs=${stemPaths.length}:normalize=0`,
        "-c:a",
        "pcm_s16le",
        wav,
      ],
      { timeoutMs: MEDIA_LIMITS.sampleTimeoutMs },
    );
    mixed = true;
  }
  const sidecar: MediaSidecar = {
    title: job.title ?? finalBase,
    ...(job.durationSeconds !== undefined
      ? { durationSeconds: job.durationSeconds }
      : {}),
    source: url,
    ...(mixed
      ? { sha256: await sha256File(wav), bytes: Bun.file(wav).size }
      : {}),
    backend: "stemdeck",
    downloadedAt: now().toISOString(),
    stemdeck: { url: health.url, jobId },
    ...(job.bpm !== undefined ? { bpm: job.bpm } : {}),
    ...(job.key ? { key: job.key } : {}),
  };
  await writeJsonAtomic(sidecarPath(wav), sidecar);
  const relativeWav = projectPath(context.projectRoot, wav);
  return {
    summary: `stemdeck downloaded ${finalBase} (${job.stems.length} stems${mixed ? " + mix" : ""})`,
    outputs: [
      ...(mixed ? [relativeWav] : []),
      projectPath(context.projectRoot, sidecarPath(wav)),
      ...outputs,
    ],
    content: {
      ...(mixed
        ? { wav: relativeWav }
        : {
            wav: null,
            note: "ffmpeg is not installed, so no mixed wav was written; the stems are complete",
          }),
      stems: Object.fromEntries(
        job.stems.map((stem, index) => [stem.name, outputs[index]]),
      ),
      expectedStems: STEM_NAMES,
      ...sidecar,
    },
  };
}
