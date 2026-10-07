/**
 * `transcribe_lyrics(file, {lang?})`: whisper.cpp (`whisper-cli`) on a 16 kHz
 * mono copy of the file. The ggml model lives in `~/.cache/dawg/whisper/`;
 * when it is missing a progress card names the size and destination before
 * dawg fetches it from Hugging Face. Output: `<name>.lyrics.json` (segments
 * with seconds) and `<name>.lyrics.txt`.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { missingTool } from "./backend.ts";
import {
  ensureDir,
  exists,
  formatBytes,
  projectPath,
  resolveInput,
  writeJsonAtomic,
} from "./paths.ts";
import {
  MediaToolError,
  downloadToFile,
  runHelper,
  throwIfAborted,
  withTempDir,
} from "./process.ts";
import {
  MEDIA_LIMITS,
  type MediaResult,
  type MediaRunContext,
} from "./types.ts";
import { finiteNumber, isRecord, optionalString } from "./vendor/util.ts";

export const WHISPER_MODEL_BASE_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";
const MODEL_MAX_BYTES = 200 * 1024 * 1024;
const MAX_SEGMENTS = 4_000;
const MAX_TEXT_CHARS = 4_000;
const LANGUAGE_PATTERN = /^[a-z]{2,3}$|^auto$/;

export type LyricsArgs = Readonly<{ file: string; lang?: string }>;

export function whisperModelName(lang: string | undefined): string {
  return lang === undefined || lang === "en"
    ? "ggml-base.en.bin"
    : "ggml-base.bin";
}

export function whisperModelDir(homeDir: string | undefined): string {
  return join(homeDir ?? homedir(), ".cache", "dawg", "whisper");
}

export type LyricSegment = Readonly<{
  start: number;
  end: number;
  text: string;
}>;

/** Parse whisper-cli's `-oj` JSON (`transcription[].offsets` are milliseconds). */
export function parseWhisperJson(value: unknown): readonly LyricSegment[] {
  if (!isRecord(value) || !Array.isArray(value.transcription)) return [];
  const segments: LyricSegment[] = [];
  for (const entry of value.transcription.slice(0, MAX_SEGMENTS)) {
    if (!isRecord(entry)) continue;
    const offsets = isRecord(entry.offsets) ? entry.offsets : {};
    const from = finiteNumber(offsets.from);
    const to = finiteNumber(offsets.to);
    const text = optionalString(entry.text, 2_000);
    if (from === undefined || to === undefined || !text) continue;
    segments.push({ start: from / 1000, end: to / 1000, text });
  }
  return segments;
}

export async function transcribeLyrics(
  args: LyricsArgs,
  context: MediaRunContext,
): Promise<MediaResult> {
  if (args.lang !== undefined && !LANGUAGE_PATTERN.test(args.lang))
    throw new MediaToolError(
      "lang must be a two- or three-letter code or auto",
    );
  if (!context.runner.which("whisper-cli"))
    throw new MediaToolError(missingTool("whisper-cli"));
  if (!context.runner.which("ffmpeg"))
    throw new MediaToolError(missingTool("ffmpeg"));
  const input = await resolveInput(context, args.file);
  const modelName = whisperModelName(args.lang);
  const modelDir = whisperModelDir(context.homeDir ?? context.env?.HOME);
  const modelPath = join(modelDir, modelName);
  if (!(await exists(modelPath))) {
    await ensureDir(modelDir);
    context.progress(
      `downloading ${modelName} (~${formatBytes(MEDIA_LIMITS.whisperModelBytes)}) to ${modelDir} from huggingface.co/ggerganov/whisper.cpp`,
    );
    await downloadToFile(
      context.fetch ?? fetch,
      `${WHISPER_MODEL_BASE_URL}${modelName}`,
      modelPath,
      {
        maxBytes: MODEL_MAX_BYTES,
        signal: context.signal,
        progress: (received, total) =>
          context.progress(
            total
              ? `model ${Math.round((received / total) * 100)}%`
              : `model ${formatBytes(received)}`,
          ),
      },
    );
  }
  throwIfAborted(context.signal);
  return withTempDir("lyrics", async (temp) => {
    const pcm = join(temp, "audio16k.wav");
    context.progress("ffmpeg → 16 kHz mono");
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
        "3600",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        pcm,
      ],
      { timeoutMs: MEDIA_LIMITS.sampleTimeoutMs },
    );
    const outBase = join(temp, "transcript");
    context.progress("whisper transcribing");
    await runHelper(
      context,
      [
        "whisper-cli",
        "-m",
        modelPath,
        "-f",
        pcm,
        "-l",
        args.lang ?? "en",
        "-np",
        "-oj",
        "-of",
        outBase,
      ],
      {
        timeoutMs: MEDIA_LIMITS.lyricsTimeoutMs,
        progress: (chunk) => {
          const match = chunk.match(/progress\s*=\s*(\d{1,3})%/);
          return match ? `whisper ${match[1]}%` : undefined;
        },
      },
    );
    const jsonFile = Bun.file(`${outBase}.json`);
    if (jsonFile.size > 32 * 1024 * 1024)
      throw new MediaToolError("whisper output too large");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await jsonFile.text()) as unknown;
    } catch {
      throw new MediaToolError("whisper-cli wrote no JSON transcript");
    }
    const segments = parseWhisperJson(parsed);
    const base = input.absolute.replace(/\.[A-Za-z0-9]{1,5}$/, "");
    const jsonOut = `${base}.lyrics.json`;
    const textOut = `${base}.lyrics.txt`;
    const text = segments.map((segment) => segment.text.trim()).join("\n");
    await writeJsonAtomic(jsonOut, {
      file: input.relative,
      model: modelName,
      language: args.lang ?? "en",
      segments,
    });
    await Bun.write(textOut, `${text}\n`);
    const outputs = [jsonOut, textOut].map((path) =>
      projectPath(context.projectRoot, path),
    );
    return {
      summary: `transcribed ${segments.length} segments from ${input.relative}`,
      outputs,
      content: {
        file: input.relative,
        lyrics: outputs[0],
        text: outputs[1],
        segments: segments.length,
        preview: text.slice(0, MAX_TEXT_CHARS),
        ...(text.length > MAX_TEXT_CHARS ? { truncated: true } : {}),
      },
    };
  });
}
