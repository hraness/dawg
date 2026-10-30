import { readFile, writeFile, lstat, access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScore, type TrackScoreData } from "../../core/score.ts";
import { encodeLoop, encodeLoopDocument } from "../../core/loop.ts";
import { analyzeAudio } from "../media/analyze.ts";
import { downloadAudio } from "../media/download.ts";
import { splitStems } from "../media/stems.ts";
import { readSidecar, sidecarPath } from "../media/sidecar.ts";
import { resolveInput, sha256File } from "../media/paths.ts";
import { runHelper } from "../media/process.ts";
import { secondsToBeat } from "../media/vendor/grid.ts";
import { validateYoutubeUrl } from "../media/vendor/util.ts";
import { parseWav } from "../media/vendor/wav.ts";
import type { MediaRunContext } from "../media/types.ts";
import {
  discoverVocalBackend,
  vocalBackendSetup,
  type VocalBackend,
} from "../vocals/backend.ts";
import { checkVocalCancellation } from "../vocals/backend.ts";
import { VOCAL_MODEL, numberIn, record } from "../vocals/spec.ts";
import { vocalHelperIdentity } from "../vocals/store.ts";
import { importReferenceFile } from "./import.ts";
import {
  fitReferenceGrid,
  parseReferenceLyrics,
  parseReferenceNotes,
  referenceLyricsFromWhisper,
  referenceSections,
  REFERENCE_LIMITS,
  ReferenceError,
  type ReferenceGrid,
  type ReferenceLyric,
  type ReferenceSection,
} from "./analysis.ts";
import {
  copyReferenceInput,
  loadReference,
  projectRelative,
  readReferenceJson,
  referenceHash,
  referenceLocation,
  withReferenceStage,
  type ReferenceArtifact,
} from "./store.ts";

export const REFERENCE_HELPER = fileURLToPath(
  new URL("./python/reference.py", import.meta.url),
);
export const REFERENCE_REQUIREMENTS = fileURLToPath(
  new URL("./python/requirements.txt", import.meta.url),
);
export type ReferenceMedia = Readonly<{
  download: typeof downloadAudio;
  split: typeof splitStems;
  analyze: typeof analyzeAudio;
}>;
const media: ReferenceMedia = {
  download: downloadAudio,
  split: splitStems,
  analyze: analyzeAudio,
};
export type ReferenceOptions = Readonly<{
  backend?: VocalBackend;
  media?: Partial<ReferenceMedia>;
  whisperModel?: string;
}>;
export type PreparedReference = ReferenceArtifact &
  Readonly<{
    sourcePath: string;
    sourceHash: string;
    vocalPath: string;
    vocalHash: string;
    isolation: "provided-vocal" | "separated-vocal";
    duration: number;
    grid: ReferenceGrid;
    sections: readonly ReferenceSection[];
    analysisPath: string;
    controlsPath: string;
    scorePath: string;
    stems: Readonly<Record<string, string>>;
  }>;
export type RecreatedReference = ReferenceArtifact &
  Readonly<{
    preparedPath: string;
    stockPath: string;
    scorePath: string;
    lyricsPath: string;
    reportPath: string;
    comparison: Readonly<{
      sourcePath: string;
      stockPath: string;
      offsetSeconds: 0;
      sampleRate: 24000;
      frames: number;
    }>;
    quality: Record<string, unknown>;
  }>;

async function helperIdentity() {
  return referenceHash({
    version: 1,
    stock: await vocalHelperIdentity(),
    files: await Promise.all(
      [
        REFERENCE_HELPER,
        REFERENCE_REQUIREMENTS,
        ...[
          "./analysis.ts",
          "./import.ts",
          "./backend.ts",
          "./store.ts",
          "../media/analyze.ts",
          "../media/vendor/grid.ts",
        ].map((path) => fileURLToPath(new URL(path, import.meta.url))),
      ].map(sha256File),
    ),
  });
}

function qualityOf(value: unknown): Record<string, unknown> {
  const quality = record(value, "reference quality report");
  if (
    quality.voice !== "bf_emma" ||
    quality.finite !== true ||
    quality.referenceAudioUsedAsSamples !== false ||
    quality.sampleRate !== 24000
  )
    throw new ReferenceError(
      "Reference helper did not identify an intact stock-voice reconstruction",
    );
  numberIn(quality.frames, 1, 600 * 24000, "reference output frames");
  numberIn(quality.peak, 0.00001, 0.501, "reference output peak");
  const provenance = record(quality.provenance, "reference stock provenance");
  const model = record(provenance.model, "reference stock model");
  const files = record(model.files, "reference stock model files");
  if (
    model.repository !== VOCAL_MODEL.repository ||
    model.revision !== VOCAL_MODEL.revision ||
    Object.entries(VOCAL_MODEL.files).some(
      ([name, digest]) => files[name] !== digest,
    )
  )
    throw new ReferenceError(
      "Reference synthesis did not use the pinned stock model and voice",
    );
  const clarity = record(quality.wordClarity, "word clarity evidence");
  if (clarity.status !== "unverified")
    throw new ReferenceError(
      "Reference helper cannot certify word clarity without an independent word check",
    );
  return quality;
}

async function backendFor(
  context: MediaRunContext,
  options: ReferenceOptions,
): Promise<VocalBackend> {
  if (options.backend) return options.backend;
  const selected = await discoverVocalBackend({
    python: context.env?.DAWG_REFERENCE_PYTHON,
    env: context.env,
  });
  if (!selected.available)
    throw new ReferenceError(
      `${selected.reason}\n${selected.setup}\nReference analysis additionally needs scipy; install ${REFERENCE_REQUIREMENTS}.`,
    );
  return selected.backend;
}

async function helper(
  context: MediaRunContext,
  backend: VocalBackend,
  args: readonly string[],
): Promise<Record<string, unknown>> {
  checkVocalCancellation(context.signal);
  let pending = "";
  const result = await context.runner.run(
    backend.python,
    ["-I", REFERENCE_HELPER, ...args],
    {
      signal: context.signal,
      timeoutMs: 20 * 60_000,
      maxOutputBytes: 64 * 1024,
      env: {
        HF_HUB_OFFLINE: "1",
        HF_HUB_DISABLE_TELEMETRY: "1",
        TRANSFORMERS_OFFLINE: "1",
        OMP_NUM_THREADS: "1",
        ...(backend.modelCache ? { HF_HUB_CACHE: backend.modelCache } : {}),
      },
      onOutput(stream, chunk) {
        if (stream !== "stderr") return;
        pending = (pending + chunk).slice(-8192);
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines)
          if (line.startsWith("DAWG_REFERENCE_PROGRESS "))
            context.progress(
              line
                .slice(24)
                .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
                .slice(0, 160),
            );
      },
    },
  );
  checkVocalCancellation(context.signal);
  if (result.killed)
    throw new ReferenceError(
      "Reference helper exceeded its 20 minute budget; work in shorter sections",
    );
  if (result.code !== 0)
    throw new ReferenceError(
      `Reference helper failed: ${result.stderr.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(-900)}. Install ${REFERENCE_REQUIREMENTS}; cached models are required and never downloaded implicitly.`,
    );
  if (Buffer.byteLength(result.stdout) > 64 * 1024)
    throw new ReferenceError("Reference helper output exceeded its budget");
  try {
    return record(JSON.parse(result.stdout), "reference helper result");
  } catch {
    throw new ReferenceError("Reference helper returned invalid JSON");
  }
}

async function decode(
  context: MediaRunContext,
  input: string,
  out: string,
  sampleRate = 24000,
): Promise<void> {
  if (!context.runner.which("ffmpeg"))
    throw new ReferenceError("Install ffmpeg for local reference decoding");
  await runHelper(
    context,
    [
      "ffmpeg",
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-n",
      "-i",
      input,
      "-vn",
      "-t",
      "601",
      "-ar",
      String(sampleRate),
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      out,
    ],
    { timeoutMs: 120_000 },
  );
}

async function wavInfo(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024)
    throw new ReferenceError(
      "Normalized reference audio exceeds the bounded regular-file budget",
    );
  const bytes = await readFile(path);
  const wav = parseWav(bytes, {
    maximumBytes: 32 * 1024 * 1024,
    maximumDurationSeconds: 601,
    maximumChannels: 1,
  });
  if (
    wav.sampleRate !== 24000 ||
    wav.encoding !== "pcm16" ||
    wav.channels !== 1 ||
    wav.sampleCount / wav.sampleRate > 600
  )
    throw new ReferenceError(
      "Reference audio must fit a complete 600 second 24 kHz mono PCM16 window; split a longer source explicitly",
    );
  return {
    duration: wav.sampleCount / wav.sampleRate,
    frames: wav.sampleCount,
  };
}

function preparedOf(artifact: ReferenceArtifact): PreparedReference {
  const data = artifact.data;
  if (
    data.isolation !== "provided-vocal" &&
    data.isolation !== "separated-vocal"
  )
    throw new ReferenceError(
      "Reference manifest has no isolated vocal evidence",
    );
  const ownFile = (key: string) => {
    const path = data[key];
    if (typeof path !== "string" || !artifact.files[path])
      throw new ReferenceError(`Reference manifest is missing ${key}`);
    return `${dirname(artifact.manifestPath)}/${path}`;
  };
  const duration = numberIn(data.duration, 0.01, 600, "reference duration");
  const rawGrid = record(data.grid, "reference grid");
  const grid = {
    ...fitReferenceGrid(
      rawGrid.beats,
      duration,
      typeof rawGrid.bpm === "number" ? rawGrid.bpm : undefined,
    ),
    ...(typeof rawGrid.evidence === "string" && rawGrid.evidence.length < 160
      ? { evidence: rawGrid.evidence }
      : {}),
  };
  const stems: Record<string, string> = {};
  for (const [name, path] of Object.entries(
    record(data.stems, "reference stems"),
  )) {
    if (
      !/^[a-z]+$/.test(name) ||
      typeof path !== "string" ||
      !artifact.files[path]
    )
      throw new ReferenceError("Invalid reference stem identity");
    stems[name] = `${dirname(artifact.manifestPath)}/${path}`;
  }
  if (!Array.isArray(data.sections) || data.sections.length > 600)
    throw new ReferenceError("Invalid reference sections");
  const sections: ReferenceSection[] = data.sections.map((raw: unknown) => {
    const section = record(raw, "reference section");
    if (
      typeof section.label !== "string" ||
      !/^section-\d{1,3}$/.test(section.label) ||
      typeof section.evidence !== "string" ||
      section.evidence.length > 160
    )
      throw new ReferenceError("Invalid reference section evidence");
    const start = numberIn(section.start, 0, duration, "section.start");
    return {
      label: section.label,
      start,
      end: numberIn(section.end, start, duration, "section.end"),
      similarity: numberIn(section.similarity, 0, 1, "section.similarity"),
      evidence: section.evidence,
    };
  });
  const sourcePath = ownFile("source"),
    vocalPath = ownFile("vocal");
  return {
    ...artifact,
    sourcePath,
    vocalPath,
    sourceHash: artifact.files[data.source as string]!,
    vocalHash: artifact.files[data.vocal as string]!,
    isolation: data.isolation,
    duration,
    grid,
    sections,
    controlsPath: ownFile("controls"),
    analysisPath: ownFile("analysis"),
    scorePath: ownFile("score"),
    stems,
  };
}

function scoreFor(
  notes: ReturnType<typeof parseReferenceNotes>,
  grid: ReferenceGrid,
  duration: number,
): TrackScoreData {
  const ticksPerBeat = 960;
  const originBeat = secondsToBeat(grid, 0);
  const bars = Math.max(
    1,
    Math.ceil(
      Math.max(
        (duration * grid.bpm) / 60,
        ...notes.map(
          (note) => secondsToBeat(grid, note.endSeconds) - originBeat,
        ),
      ) / 4,
    ),
  );
  if (bars > 256)
    throw new ReferenceError(
      "This reference exceeds DAWG's 256 bar editable score; prepare shorter sections",
    );
  return encodeLoopDocument(
    createScore({
      tempoBpm: grid.bpm,
      bars,
      ticksPerBeat,
      tracks: [
        {
          id: "reference-melody",
          name: "Reference melody",
          instrument: "sine",
          volume: 0.4,
        },
      ],
      notes: notes.map((note, index) => ({
        id: `reference-${index}`,
        trackId: "reference-melody",
        pitch: note.pitch,
        startTick: Math.max(
          0,
          Math.round(
            (secondsToBeat(grid, note.startSeconds) - originBeat) *
              ticksPerBeat,
          ),
        ),
        durationTicks: Math.max(
          1,
          Math.round(
            (secondsToBeat(grid, note.endSeconds) -
              secondsToBeat(grid, note.startSeconds)) *
              ticksPerBeat,
          ),
        ),
        velocity: note.velocity,
      })),
    }),
  );
}

/** URL and project-file routes converge before analysis; source files stay intact. */
export async function prepareReference(
  request: unknown,
  context: MediaRunContext,
  options: ReferenceOptions = {},
): Promise<PreparedReference> {
  const args = record(request, "reference request");
  if (
    Object.keys(args).some(
      (key) =>
        !["file", "url", "vocalFile", "sourceIsVocal", "bpm"].includes(key),
    ) ||
    (args.file === undefined) === (args.url === undefined)
  )
    throw new ReferenceError(
      "Supply one file or YouTube url, with optional vocalFile, sourceIsVocal and bpm",
    );
  if (
    args.sourceIsVocal !== undefined &&
    typeof args.sourceIsVocal !== "boolean"
  )
    throw new ReferenceError("sourceIsVocal must be a boolean");
  const bpmHint =
    args.bpm === undefined
      ? undefined
      : numberIn(args.bpm, 40, 300, "reference bpm");
  const operations = { ...media, ...options.media };
  let inputPath: unknown = args.file;
  let sourceUrl: string | undefined;
  const downloadedStems: Record<string, { absolute: string; sha256: string }> =
    {};
  if (args.url !== undefined) {
    if (typeof args.url !== "string" || args.url.length > 4096)
      throw new ReferenceError("url must be a bounded YouTube URL");
    const url = validateYoutubeUrl(args.url);
    sourceUrl = url;
    const download = await operations.download({ url }, context);
    inputPath = download.content.wav;
    if (typeof inputPath !== "string" || !download.outputs.includes(inputPath))
      throw new ReferenceError(
        "The download operation did not return an admitted audio artifact path",
      );
    if (download.content.stems !== undefined) {
      const stems = record(download.content.stems, "downloaded stems");
      if (Object.keys(stems).length > 8)
        throw new ReferenceError("Too many downloaded stems");
      for (const [name, path] of Object.entries(stems)) {
        if (
          !/^[a-z]{1,20}$/.test(name) ||
          typeof path !== "string" ||
          !download.outputs.includes(path)
        )
          throw new ReferenceError(
            "Download returned an unadmitted stem artifact",
          );
        const input = await resolveInput(context, path);
        downloadedStems[name] = {
          absolute: input.absolute,
          sha256: await sha256File(input.absolute),
        };
      }
    }
  }
  const source = await importReferenceFile(inputPath, context);
  if (source.size > REFERENCE_LIMITS.maxInputBytes)
    throw new ReferenceError("Reference source exceeds 500 MiB");
  const vocal =
    args.vocalFile === undefined
      ? undefined
      : await importReferenceFile(args.vocalFile, context);
  const sourceHash = await sha256File(source.absolute),
    vocalHash = vocal ? await sha256File(vocal.absolute) : undefined;
  const requestHash = referenceHash({
    version: 1,
    sourceHash,
    sourceUrl: sourceUrl ?? null,
    downloadedStems: Object.fromEntries(
      Object.entries(downloadedStems).map(([name, file]) => [
        name,
        file.sha256,
      ]),
    ),
    vocalHash: vocalHash ?? null,
    sourceIsVocal: args.sourceIsVocal === true,
    bpmHint: bpmHint ?? null,
    helper: await helperIdentity(),
  });
  const location = await referenceLocation(
    context.projectRoot,
    context.trackSlug,
    "prepared",
    requestHash,
    context.writeScope,
  );
  const artifact = await withReferenceStage(
    location,
    context.signal,
    async (stage) => {
      await copyReferenceInput(
        source.absolute,
        join(stage, "source.audio"),
        sourceHash,
      );
      const sourceSidecar = await readSidecar(source.absolute);
      if (sourceSidecar)
        await writeFile(
          sidecarPath(join(stage, "source.audio")),
          JSON.stringify(sourceSidecar),
        );
      let selectedVocal: string, isolation: PreparedReference["isolation"];
      const stemPaths: Record<string, string> = {};
      if (vocal || args.sourceIsVocal === true) {
        const selected = vocal ?? source;
        selectedVocal = join(stage, "source-vocal.audio");
        await copyReferenceInput(
          selected.absolute,
          selectedVocal,
          vocalHash ?? sourceHash,
        );
        isolation = "provided-vocal";
      } else if (downloadedStems.vocals) {
        await mkdir(join(stage, "stems"));
        for (const [name, file] of Object.entries(downloadedStems)) {
          const path = join(stage, "stems", `${name}.wav`);
          await copyReferenceInput(file.absolute, path, file.sha256);
          stemPaths[name] = projectRelative(stage, path);
        }
        selectedVocal = join(stage, stemPaths.vocals!);
        isolation = "separated-vocal";
      } else {
        const result = await operations.split(
          { file: projectRelative(location.root, join(stage, "source.audio")) },
          context,
        );
        const rawStems = record(result.content.stems, "separation artifacts");
        for (const [name, path] of Object.entries(rawStems)) {
          if (
            !/^[a-z]+$/.test(name) ||
            typeof path !== "string" ||
            !result.outputs.includes(path)
          )
            throw new ReferenceError(
              "Separation returned an invalid stem artifact",
            );
          const input = await resolveInput(context, path);
          if (!input.absolute.startsWith(stage + "/"))
            throw new ReferenceError(
              "Separation returned a stem outside the owned staging directory",
            );
          stemPaths[name] = projectRelative(stage, input.absolute);
        }
        if (!stemPaths.vocals)
          throw new ReferenceError(
            "Separation produced no vocal artifact; a full mix is not an isolated vocal",
          );
        selectedVocal = join(stage, stemPaths.vocals);
        isolation = "separated-vocal";
      }
      await decode(
        context,
        join(stage, "source.audio"),
        join(stage, "mix.wav"),
      );
      await decode(context, selectedVocal, join(stage, "reference.wav"));
      const info = await wavInfo(join(stage, "reference.wav"));
      const mix = await wavInfo(join(stage, "mix.wav"));
      if (Math.abs(mix.duration - info.duration) > 0.1)
        throw new ReferenceError(
          "The isolated vocal and source mix must have the same aligned duration",
        );
      const analyzed = await operations.analyze(
        { file: projectRelative(location.root, join(stage, "mix.wav")) },
        context,
      );
      if (
        typeof analyzed.content.analysis !== "string" ||
        !analyzed.outputs.includes(analyzed.content.analysis)
      )
        throw new ReferenceError("Analysis did not return its artifact path");
      const analysisInput = await resolveInput(
        context,
        analyzed.content.analysis,
      );
      if (!analysisInput.absolute.startsWith(stage + "/"))
        throw new ReferenceError("Analysis artifact escaped staging");
      const audioAnalysis = record(
        await readReferenceJson(analysisInput.absolute),
        "audio analysis",
      );
      const rawGrid =
        audioAnalysis.grid && typeof audioAnalysis.grid === "object"
          ? record(audioAnalysis.grid, "beat grid")
          : {};
      const grid = fitReferenceGrid(
        rawGrid.beats,
        info.duration,
        bpmHint ??
          (typeof audioAnalysis.bpm === "number"
            ? audioAnalysis.bpm
            : undefined),
      );
      await writeFile(
        join(stage, "config.json"),
        JSON.stringify({ bpm: grid.bpm, offsetSeconds: grid.offsetSeconds }),
      );
      const backend = await backendFor(context, options);
      await helper(context, backend, [
        "--analyze",
        join(stage, "reference.wav"),
        join(stage, "controls.npz"),
        join(stage, "analysis.json"),
        join(stage, "config.json"),
      ]);
      const measured = record(
        await readReferenceJson(join(stage, "analysis.json")),
        "reference analysis",
      );
      const notes = parseReferenceNotes(measured.notes, info.duration),
        sections = referenceSections(measured.blocks, info.duration);
      await writeFile(
        join(stage, "notes.json"),
        JSON.stringify({
          sourceHash,
          notes,
          grid,
          evidence:
            "WORLD monophonic pitch segmentation; review notes and octave errors",
        }),
      );
      await writeFile(
        join(stage, "score.json"),
        JSON.stringify(scoreFor(notes, grid, info.duration)),
      );
      return {
        source: "source.audio",
        vocal: projectRelative(stage, selectedVocal),
        normalized: "reference.wav",
        controls: "controls.npz",
        analysis: "analysis.json",
        score: "score.json",
        duration: info.duration,
        isolation,
        stems: stemPaths,
        grid,
        sections,
        helperHash: await helperIdentity(),
        sourceHash,
        originalSource: source.relative,
        ...(source.imported
          ? {
              import: {
                file: source.relative,
                metadata: source.metadataPath,
                sha256: source.sha256,
              },
            }
          : {}),
        ...(vocal?.imported
          ? {
              vocalImport: {
                file: vocal.relative,
                metadata: vocal.metadataPath,
                sha256: vocal.sha256,
              },
            }
          : {}),
        ...(sourceUrl ? { url: sourceUrl } : {}),
        limitations: [
          "Source separation is an estimate",
          "Detected beat phase and section function need review",
          "The editable score contains the monophonic vocal melody; rebuild accompaniment from retained stems with transcribe_notes",
        ],
      };
    },
    context.writeScope,
  );
  return preparedOf(artifact);
}

export async function readPreparedReference(
  file: unknown,
  context: MediaRunContext,
): Promise<PreparedReference> {
  const input = await resolveInput(context, file);
  const match = new RegExp(
    `^tracks/${context.trackSlug}/references/prepared-([a-f0-9]{64})/manifest\\.json$`,
  ).exec(input.relative);
  if (!match)
    throw new ReferenceError(
      "prepared must name an accepted reference manifest for this track",
    );
  const location = await referenceLocation(
    context.projectRoot,
    context.trackSlug,
    "prepared",
    match[1]!,
  );
  const accepted = await loadReference(location);
  if (!accepted) throw new ReferenceError("Prepared reference is missing");
  return preparedOf(accepted);
}

async function whisperIdentity(
  context: MediaRunContext,
  options: ReferenceOptions,
): Promise<{ path: string; sha256: string }> {
  const model =
    options.whisperModel ??
    context.env?.DAWG_REFERENCE_WHISPER_MODEL ??
    join(
      context.homeDir ?? context.env?.HOME ?? homedir(),
      ".cache",
      "dawg",
      "whisper",
      "ggml-small.en.bin",
    );
  if (!isAbsolute(model) || /[\x00-\x1f]/.test(model))
    throw new ReferenceError("Whisper model must be a local absolute path");
  try {
    await access(model, constants.R_OK);
  } catch {
    throw new ReferenceError(
      "The reference Whisper model is not cached. Set DAWG_REFERENCE_WHISPER_MODEL to a local ggml-small.en.bin/ggml-base.en.bin, or supply timed actual lyrics. No model is downloaded automatically.",
    );
  }
  const modelInfo = await lstat(model);
  if (!modelInfo.isFile() || modelInfo.size > 1024 * 1024 * 1024)
    throw new ReferenceError("Whisper model must be a bounded local file");
  return { path: model, sha256: await sha256File(model) };
}

async function transcribe(
  context: MediaRunContext,
  reference: string,
  stage: string,
  identity: { path: string; sha256: string },
  duration: number,
): Promise<ReferenceLyric[]> {
  if (!context.runner.which("whisper-cli"))
    throw new ReferenceError(
      "Install whisper.cpp whisper-cli or supply timed lyrics in the recreation request",
    );
  const model = identity.path;
  const input16k = join(stage, "transcription.wav");
  await decode(context, reference, input16k, 16000);
  const output = join(stage, "transcript");
  const preset = /small\.en/.test(model)
    ? "small.en"
    : /base\.en/.test(model)
      ? "base.en"
      : undefined;
  await runHelper(
    context,
    [
      "whisper-cli",
      "-m",
      model,
      "-f",
      input16k,
      ...(preset ? ["-dtw", preset] : []),
      "-ng",
      "-nfa",
      "-ojf",
      "-of",
      output,
      "-sns",
      "-np",
      "-t",
      "2",
    ],
    { timeoutMs: 10 * 60_000 },
  );
  if ((await sha256File(model)) !== identity.sha256)
    throw new ReferenceError(
      "Whisper model changed during transcription; the result was not accepted",
    );
  await writeFile(
    join(stage, "transcription-model.json"),
    JSON.stringify({
      sha256: identity.sha256,
      preset: preset ?? "none",
      evidence:
        "automatic English transcription; verify actual words against the source",
    }),
  );
  return referenceLyricsFromWhisper(
    await readReferenceJson(`${output}.json`),
    duration,
  );
}

function recreatedOf(artifact: ReferenceArtifact): RecreatedReference {
  const data = artifact.data,
    prefix = dirname(artifact.manifestPath);
  const path = (key: string) => {
    const name = data[key];
    if (typeof name !== "string" || !artifact.files[name])
      throw new ReferenceError(`Recreation is missing ${key}`);
    return `${prefix}/${name}`;
  };
  return {
    ...artifact,
    preparedPath: String(data.prepared),
    stockPath: path("stock"),
    scorePath: path("score"),
    lyricsPath: path("lyrics"),
    reportPath: path("report"),
    comparison: {
      sourcePath: path("comparisonSource"),
      stockPath: path("comparisonStock"),
      offsetSeconds: 0,
      sampleRate: 24000,
      frames: numberIn(data.frames, 1, 600 * 24000, "comparison frames"),
    },
    quality: qualityOf(data.quality),
  };
}

/** Preserve source performance controls, re-singing supplied/transcribed words with stock bf_emma. */
export async function recreateReference(
  request: unknown,
  context: MediaRunContext,
  options: ReferenceOptions = {},
): Promise<RecreatedReference> {
  const args = record(request, "recreation request");
  if (Object.keys(args).some((key) => !["prepared", "lyrics"].includes(key)))
    throw new ReferenceError(
      "Recreation accepts prepared and optional timed lyrics",
    );
  const prepared = await readPreparedReference(args.prepared, context);
  const supplied =
    args.lyrics === undefined
      ? undefined
      : parseReferenceLyrics(args.lyrics, prepared.duration);
  const whisperModel = supplied
    ? null
    : await whisperIdentity(context, options);
  const requestHash = referenceHash({
    version: 1,
    prepared: prepared.requestHash,
    supplied: supplied ?? null,
    whisperModel,
    helper: await helperIdentity(),
    model: VOCAL_MODEL,
  });
  const location = await referenceLocation(
    context.projectRoot,
    context.trackSlug,
    "recreated",
    requestHash,
    context.writeScope,
  );
  const artifact = await withReferenceStage(
    location,
    context.signal,
    async (stage) => {
      const normalized = await resolveInput(
        context,
        `${dirname(prepared.manifestPath)}/reference.wav`,
      );
      const controls = await resolveInput(context, prepared.controlsPath);
      const lyrics =
        supplied ??
        (await transcribe(
          context,
          normalized.absolute,
          stage,
          whisperModel!,
          prepared.duration,
        ));
      await writeFile(join(stage, "lyrics.json"), JSON.stringify(lyrics));
      await writeFile(
        join(stage, "config.json"),
        JSON.stringify({
          reference: normalized.absolute,
          controls: controls.absolute,
          lyrics,
          outputDirectory: stage,
        }),
      );
      const selected = await backendFor(context, options);
      await helper(context, selected, [
        "--synthesize",
        join(stage, "config.json"),
      ]);
      await writeFile(
        join(stage, "config.json"),
        JSON.stringify({
          reference: `${dirname(prepared.manifestPath)}/reference.wav`,
          controls: prepared.controlsPath,
          lyrics,
          outputDirectory: location.relativeDir,
        }),
      );
      const stock = await wavInfo(join(stage, "stock.wav")),
        sourceAb = await wavInfo(join(stage, "comparison-source.wav")),
        stockAb = await wavInfo(join(stage, "comparison-stock.wav"));
      if (
        Math.abs(stock.duration - prepared.duration) > 1 / 24000 ||
        sourceAb.frames !== stock.frames ||
        stockAb.frames !== stock.frames
      )
        throw new ReferenceError(
          "Reference reconstruction/comparison lost source alignment or held tails",
        );
      const quality = qualityOf(
        await readReferenceJson(join(stage, "report.json")),
      );
      if (quality.frames !== stock.frames)
        throw new ReferenceError(
          "Reference quality report has the wrong output frame count",
        );
      const rawScore = record(
        await readReferenceJson(
          (await resolveInput(context, prepared.scorePath)).absolute,
        ),
        "editable reference score",
      );
      const score = createScore(rawScore as TrackScoreData);
      const stockPath = `${location.relativeDir}/stock.wav`;
      const stockHash = await sha256File(join(stage, "stock.wav"));
      const rebuilt = createScore({
        ...score.toJSON(),
        tracks: [
          ...score.tracks.map((track) => ({ ...track, muted: true })),
          {
            id: "stock-vocal",
            name: "Stock vocal",
            instrument: "vocal",
            clips: [
              {
                id: "stock-vocal",
                src: stockPath,
                sha256: stockHash,
                startTick: 0,
                dur: stock.duration,
                fadeTime: 0.01,
                fadeInTime: 0.01,
              },
            ],
          },
        ],
      });
      await writeFile(join(stage, "score.json"), encodeLoop(rebuilt));
      return {
        prepared: prepared.manifestPath,
        stock: "stock.wav",
        score: "score.json",
        lyrics: "lyrics.json",
        report: "report.json",
        comparisonSource: "comparison-source.wav",
        comparisonStock: "comparison-stock.wav",
        frames: stock.frames,
        quality,
        helperHash: await helperIdentity(),
        limitations: [
          "Stock-voice approximation; review words, pitch, timing and tone independently",
          "Unlabelled wordless passages remain explicitly reported rather than invented",
          "The accompaniment still needs rebuilding from the retained separated stems",
        ],
      };
    },
    context.writeScope,
  );
  return recreatedOf(artifact);
}

export function referenceSetup(): string {
  return `${vocalBackendSetup()}\nuv pip install --python <selected-python> -r '${REFERENCE_REQUIREMENTS}'\nReference ingestion needs ffmpeg; full mixes need the existing split_stems backend. Automatic lyric capture needs whisper-cli and an explicitly cached English ggml model.`;
}
