/**
 * `transcribe_notes(file, {kind, from?, to?})`: pitched stems go through the
 * Basic Pitch CLI with soundfish's per-stem parameters; drums go through the
 * vendored STFT classifier. Both yield `TimedNote[]` in source seconds plus a
 * quantized snippet (`note("A1", startBeat, lengthBeats, velocity)` /
 * `hit("kick", beat)`) aligned to the file's analysis beat grid, capped at
 * 2048 notes, written to `<name>.<kind>.notes.json`.
 */
import { join } from "node:path";
import { analyzeAudio, readAnalysis } from "./analyze.ts";
import {
  FIRST_RUN_NOTES,
  missingTool,
  toolCommand,
  uvInstalledTools,
} from "./backend.ts";
import {
  formatSeconds,
  projectPath,
  resolveInput,
  writeJsonAtomic,
} from "./paths.ts";
import {
  MediaToolError,
  runHelper,
  throwIfAborted,
  withTempDir,
} from "./process.ts";
import {
  MEDIA_LIMITS,
  type BeatGrid,
  type MediaResult,
  type MediaRunContext,
  type TimedNote,
} from "./types.ts";
import {
  BASIC_PITCH_STEM_PARAMETERS,
  PITCHED_KINDS,
  basicPitchOutputBase,
  basicPitchParameterArguments,
  parseBasicPitchNoteCsv,
  type PitchedKind,
} from "./vendor/basic-pitch.ts";
import { classifyDrumWav } from "./vendor/drums.ts";
import { fixedBeatGrid, gridMedianBpm, secondsToBeat } from "./vendor/grid.ts";

export const NOTE_KINDS = ["drums", ...PITCHED_KINDS] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** Beat resolution of the quantized snippet (sixteenths). */
const GRID_DIVISION = 4;
const SNIPPET_LINES = 128;
const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/** Classifier pitches → dawg drum voices (`core/drums.ts`). */
const DRUM_VOICE_FOR_PITCH: Readonly<Record<number, string>> = {
  36: "kick",
  38: "snare",
  39: "clap",
  45: "tom",
  47: "tom",
  42: "hat",
  46: "openhat",
  49: "openhat",
  51: "rim",
};

export type TranscribeNotesArgs = Readonly<{
  file: string;
  kind?: NoteKind;
  from?: number;
  to?: number;
}>;

export type QuantizedNote = Readonly<{
  pitch: number;
  name: string;
  startBeat: number;
  lengthBeats: number;
  velocity: number;
}>;

export function inferKind(fileName: string): NoteKind {
  const base = fileName
    .split("/")
    .at(-1)!
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
  for (const kind of NOTE_KINDS)
    if (
      base === kind ||
      base.startsWith(`${kind}-`) ||
      base.startsWith(`${kind}_`)
    )
      return kind;
  return "other";
}

export function noteName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * Snap notes to the grid: beat 0 is the first downbeat the grid marks (or
 * its first beat), sixteenth resolution, and lengths of at least one step.
 */
export function quantizeNotes(
  notes: readonly TimedNote[],
  grid: BeatGrid,
): { quantized: readonly QuantizedNote[]; originBeat: number } {
  const firstBar = grid.bars.reduce<number | undefined>(
    (best, bar) => (best === undefined || bar.beat < best ? bar.beat : best),
    undefined,
  );
  const originBeat = firstBar ?? 0;
  const snap = (beat: number) =>
    Math.round(beat * GRID_DIVISION) / GRID_DIVISION;
  const quantized = notes.map((note) => {
    const start = secondsToBeat(grid, note.startSeconds) - originBeat;
    const end = secondsToBeat(grid, note.endSeconds) - originBeat;
    const startBeat = Math.max(0, snap(start));
    const lengthBeats = Math.max(1 / GRID_DIVISION, snap(end - start));
    return {
      pitch: note.pitch,
      name: noteName(note.pitch),
      startBeat,
      lengthBeats,
      velocity: note.velocity,
    };
  });
  return { quantized, originBeat };
}

export function snippetLines(
  quantized: readonly QuantizedNote[],
  kind: NoteKind,
): readonly string[] {
  if (kind === "drums") {
    // Two onsets that snap to one voice and step are one hit.
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const note of quantized) {
      const voice = DRUM_VOICE_FOR_PITCH[note.pitch] ?? "rim";
      const key = `${voice}@${note.startBeat}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`hit("${voice}", ${note.startBeat})`);
    }
    return lines;
  }
  return quantized.map(
    (note) =>
      `note("${note.name}", ${note.startBeat}, ${note.lengthBeats}, ${note.velocity})`,
  );
}

async function gridFor(
  context: MediaRunContext,
  input: { absolute: string; relative: string },
  warnings: string[],
): Promise<{ grid: BeatGrid; bpm: number; analysis?: string }> {
  let analysis = await readAnalysis(input.absolute);
  let analysisOutput: string | undefined;
  if (!analysis) {
    context.progress("analyzing beat grid first");
    const result = await analyzeAudio({ file: input.relative }, context);
    analysisOutput = result.outputs[0];
    analysis = await readAnalysis(input.absolute);
  }
  if (analysis?.grid) {
    return {
      grid: analysis.grid,
      bpm: analysis.bpm ?? gridMedianBpm(analysis.grid),
      ...(analysisOutput ? { analysis: analysisOutput } : {}),
    };
  }
  warnings.push(
    "no tempo could be estimated; the snippet assumes 120 bpm from 0 s",
  );
  return {
    grid: fixedBeatGrid(120, analysis?.durationSeconds ?? 60),
    bpm: 120,
    ...(analysisOutput ? { analysis: analysisOutput } : {}),
  };
}

export async function transcribeNotes(
  args: TranscribeNotesArgs,
  context: MediaRunContext,
): Promise<MediaResult> {
  const input = await resolveInput(context, args.file);
  const kind = args.kind ?? inferKind(input.relative);
  const from = args.from ?? 0;
  if (args.to !== undefined && args.to <= from)
    throw new MediaToolError("to must be greater than from");
  const warnings: string[] = [];
  const { grid, bpm, analysis } = await gridFor(context, input, warnings);
  throwIfAborted(context.signal);

  return withTempDir("notes", async (temp) => {
    // Work on a trimmed 22.05 kHz mono copy when a window is set or the
    // input is not a wav; otherwise feed the file itself.
    let wavPath = input.absolute;
    const head = new Uint8Array(
      await Bun.file(input.absolute).slice(0, 4).arrayBuffer(),
    );
    const isWav = String.fromCharCode(...head) === "RIFF";
    if (args.from !== undefined || args.to !== undefined || !isWav) {
      if (!context.runner.which("ffmpeg"))
        throw new MediaToolError(missingTool("ffmpeg"));
      wavPath = join(temp, `${kind}.wav`);
      context.progress("ffmpeg trimming");
      await runHelper(
        context,
        [
          "ffmpeg",
          "-hide_banner",
          "-nostdin",
          "-loglevel",
          "error",
          "-y",
          "-ss",
          String(from),
          ...(args.to !== undefined ? ["-to", String(args.to)] : []),
          "-i",
          input.absolute,
          "-vn",
          "-t",
          "600",
          "-ar",
          "22050",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          wavPath,
        ],
        { timeoutMs: MEDIA_LIMITS.sampleTimeoutMs },
      );
    }
    let method: string;
    let raw: readonly TimedNote[];
    if (kind === "drums") {
      context.progress("classifying drum hits");
      const file = Bun.file(wavPath);
      if (file.size > MEDIA_LIMITS.maxWavBytes)
        throw new MediaToolError("drum stem is over the 256 MiB cap");
      raw = classifyDrumWav(new Uint8Array(await file.arrayBuffer()));
      method = "dawg-stft-drums (vendored from soundfish)";
    } else {
      const basicPitch = toolCommand(
        "basic-pitch",
        context.runner,
        await uvInstalledTools(context.runner, context.signal),
      );
      if (!basicPitch) throw new MediaToolError(missingTool("basic-pitch"));
      context.progress(
        FIRST_RUN_NOTES["basic-pitch"] ?? "basic-pitch starting",
      );
      const outDir = join(temp, "out");
      await Bun.write(join(outDir, ".keep"), "");
      const parameters = BASIC_PITCH_STEM_PARAMETERS[kind as PitchedKind];
      await runHelper(
        context,
        [
          ...basicPitch,
          ...basicPitchParameterArguments(parameters),
          outDir,
          wavPath,
          "--save-note-events",
        ],
        {
          timeoutMs: MEDIA_LIMITS.notesTimeoutMs,
          progress: () => "basic-pitch running",
          env: { PYTHONUNBUFFERED: "1" },
        },
      );
      const csv = Bun.file(
        join(outDir, `${basicPitchOutputBase(wavPath.split("/").at(-1)!)}.csv`),
      );
      if (csv.size === 0)
        throw new MediaToolError("basic-pitch wrote no note CSV");
      if (csv.size > 16 * 1024 * 1024)
        throw new MediaToolError("basic-pitch CSV is over 16 MiB");
      raw = parseBasicPitchNoteCsv(new Uint8Array(await csv.arrayBuffer()));
      method = `basic-pitch (onset ${parameters.onsetThreshold}, min ${parameters.minimumNoteLengthMs} ms${parameters.minimumFrequencyHz !== undefined ? `, ${parameters.minimumFrequencyHz}–${parameters.maximumFrequencyHz} Hz` : ""})`;
    }
    throwIfAborted(context.signal);
    const shifted = raw
      .map((note) => ({
        ...note,
        startSeconds: note.startSeconds + from,
        endSeconds: note.endSeconds + from,
      }))
      .sort(
        (left, right) =>
          left.startSeconds - right.startSeconds || left.pitch - right.pitch,
      );
    const truncated = Math.max(0, shifted.length - MEDIA_LIMITS.maxNotes);
    const notes = shifted.slice(0, MEDIA_LIMITS.maxNotes);
    if (truncated > 0)
      warnings.push(
        `kept the first ${MEDIA_LIMITS.maxNotes} notes; ${truncated} later notes were dropped`,
      );
    if (notes.length === 0)
      warnings.push(
        `no ${kind === "drums" ? "hits" : "notes"} were found${args.to !== undefined ? " in that window" : ""}`,
      );
    const { quantized, originBeat } = quantizeNotes(notes, grid);
    const lines = snippetLines(quantized, kind);
    const base = input.absolute.replace(/\.[A-Za-z0-9]{1,5}$/, "");
    const out = `${base}.${kind}.notes.json`;
    await writeJsonAtomic(out, {
      file: input.relative,
      kind,
      method,
      bpm,
      window: { from, ...(args.to !== undefined ? { to: args.to } : {}) },
      gridOrigin: {
        beat: originBeat,
        seconds: grid.beats[originBeat] ?? grid.beats[0],
      },
      detector: grid.detector ?? "stemdeck",
      notes,
      quantized,
      snippet: lines,
      warnings,
    });
    const relativeOut = projectPath(context.projectRoot, out);
    return {
      summary: `${kind}: ${notes.length} ${kind === "drums" ? "hits" : "notes"} from ${input.relative}${args.to !== undefined ? ` (${formatSeconds(from)}–${formatSeconds(args.to)})` : ""}`,
      outputs: [relativeOut, ...(analysis ? [analysis] : [])],
      content: {
        file: input.relative,
        kind,
        method,
        bpm,
        notesFile: relativeOut,
        notes: notes.length,
        ...(truncated > 0 ? { truncated } : {}),
        gridOriginSeconds: grid.beats[originBeat] ?? grid.beats[0],
        snippet: lines.slice(0, SNIPPET_LINES),
        ...(lines.length > SNIPPET_LINES
          ? { snippetOmitted: lines.length - SNIPPET_LINES }
          : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
      },
    };
  });
}
