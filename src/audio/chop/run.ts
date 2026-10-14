/**
 * `runChop(op, args, ctx)`: resolve inputs → load → op → write a 24-bit WAV
 * (temp then rename) → sha256 → register the output (a `.json` sidecar with
 * the op and input hashes, plus a history `asset` row when a history handle
 * is wired) → one-line summary. The single implementation behind the agent
 * `audio` tool, typed `/chop` and `dawg media chop`.
 */
import { historySink } from "../../history/sink.ts";
import { bundledSample } from "../../../core/bundled-samples.ts";
import { readBundledSample } from "../bundled-samples.ts";
import { parsePackRef } from "../../../core/score.ts";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  projectPath,
  resolveInput,
  sha256File,
  writeJsonAtomic,
} from "../../media/paths.ts";
import {
  FFMPEG_HINT,
  detectBackends,
  ffmpegConvertArgv,
  rubberbandArgv,
  runBackend,
} from "./backends.ts";
import * as ops from "./ops.ts";
import { chopComputer, type ChopComputer } from "./compute.ts";
const inlineComputer = chopComputer();
import {
  ChopError,
  frames,
  mono,
  peak,
  readAudio,
  rms,
  seconds,
  slicePcm,
  toDb,
  writeAudio,
  type Pcm,
} from "./pcm.ts";
import {
  fmtSeconds,
  parseTime,
  parseTimeInFile,
  type TimeSpec,
} from "./time.ts";
import {
  CHOP_ANALYSIS_OPS,
  CHOP_OPS,
  type AudioInfo,
  type ChopArgs,
  type ChopContext,
  type ChopOp,
  type ChopOutput,
  type ChopPoint,
  type ChopResult,
} from "./types.ts";

export const CHOP_LIMITS = Object.freeze({
  maxSlices: 64,
  maxPoints: 256,
  maxInputs: 16,
  maxPeakBins: ops.MAX_PEAK_BINS,
});

const DENIED_PREFIXES = [".dawg/", ".git/", "node_modules/"];

export function defaultWriteScope(rel: string): boolean {
  const lower = rel.toLowerCase();
  return !DENIED_PREFIXES.some(
    (p) => lower === p.slice(0, -1) || lower.startsWith(p),
  );
}

export function isChopOp(value: unknown): value is ChopOp {
  return (
    typeof value === "string" && (CHOP_OPS as readonly string[]).includes(value)
  );
}

type Resolved = Readonly<{ absolute: string; relative: string }>;

async function resolveIn(
  ctx: ChopContext,
  file: string | undefined,
  label = "input",
): Promise<Resolved> {
  if (!file) throw new ChopError(`${label} is required`);
  try {
    if (file.startsWith("pack:studio/")) {
      const ref = parsePackRef(file);
      const sample =
        ref?.pack === "studio" ? bundledSample(ref.sound) : undefined;
      if (!sample) throw new ChopError("unknown bundled studio sample");
      const verified = await readBundledSample(sample.id);
      return { absolute: verified.path, relative: `pack:studio/${sample.id}` };
    }
    const found = await resolveInput(
      { projectRoot: ctx.root, trackSlug: ctx.trackSlug ?? "main" },
      file,
    );
    return { absolute: found.absolute, relative: found.relative };
  } catch (error) {
    throw new ChopError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * An output path inside the project and the write scope. Parents are
 * created; every existing ancestor must realpath inside the project, and an
 * existing target must be a regular file (never a symlink).
 */
export async function resolveOutput(
  ctx: ChopContext,
  rel: string,
): Promise<Resolved & { exists: boolean }> {
  if (rel.includes("\0"))
    throw new ChopError("output contains an invalid character");
  const root = await realpath(ctx.root);
  const candidate = isAbsolute(rel) ? resolve(rel) : resolve(root, rel);
  const relPath = relative(root, candidate);
  if (!relPath || relPath.startsWith("..") || isAbsolute(relPath))
    throw new ChopError(`${rel} is outside the project`);
  const posix = relPath.split(sep).join("/");
  if (!(ctx.writeScope ?? defaultWriteScope)(posix))
    throw new ChopError(`${posix} is outside the write scope`);
  // Walk up to the first existing ancestor and confirm it stays inside.
  let probe = dirname(candidate);
  for (;;) {
    try {
      const real = await realpath(probe);
      if (real !== root && !real.startsWith(root + sep))
        throw new ChopError(`${rel} escapes the project through a symlink`);
      break;
    } catch (error) {
      if (error instanceof ChopError) throw error;
      const parent = dirname(probe);
      if (parent === probe)
        throw new ChopError(`${rel} has no existing parent`);
      probe = parent;
    }
  }
  let exists = false;
  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink() || !info.isFile())
      throw new ChopError(`${posix} exists and is not a regular file`);
    exists = true;
  } catch (error) {
    if (error instanceof ChopError) throw error;
  }
  await mkdir(dirname(candidate), { recursive: true });
  const parentReal = await realpath(dirname(candidate));
  if (parentReal !== root && !parentReal.startsWith(root + sep))
    throw new ChopError(`${rel} escapes the project through a symlink`);
  return {
    absolute: join(parentReal, basename(candidate)),
    relative: posix,
    exists,
  };
}

/** Default output folder: the focused track's samples/, else `samples`. */
export function outDirOf(ctx: ChopContext): string {
  return (
    ctx.outDir ??
    (ctx.trackSlug ? `tracks/${ctx.trackSlug}/samples` : "samples")
  );
}

export function stemOf(rel: string): string {
  const base = basename(rel, extname(rel))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "audio").slice(0, 40);
}

/** `<outDir>/<stem>-<op>[-n].<ext>` that does not exist yet. */
async function freshOutput(
  ctx: ChopContext,
  stem: string,
  suffix: string,
  ext = "wav",
): Promise<Resolved & { exists: boolean }> {
  const dir = outDirOf(ctx);
  for (let n = 1; n <= 999; n += 1) {
    const rel = `${dir}/${stem}-${suffix}${n === 1 ? "" : `-${n}`}.${ext}`;
    const out = await resolveOutput(ctx, rel);
    if (!out.exists) return out;
  }
  throw new ChopError(`too many ${stem}-${suffix} files in ${dir}`);
}

async function trash(
  ctx: ChopContext,
  target: Resolved,
): Promise<{ path: string; copy: string; sha256: string }> {
  const sha256 = await sha256File(target.absolute);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const copyRel = `.dawg/trash/${stamp}/${target.relative}`;
  const copy = join(ctx.root, copyRel);
  await mkdir(dirname(copy), { recursive: true });
  await copyFile(target.absolute, copy);
  return { path: target.relative, copy: copyRel, sha256 };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const dbOf = (v: number) => Math.round(toDb(v) * 10) / 10;

type Loaded = Readonly<{ file: Resolved; pcm: Pcm; sha256: string }>;

function num(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new ChopError(`${label} must be a number from ${min} to ${max}`);
  return value;
}

/** Range [from, to) in frames, optionally snapped. */
async function range(
  pcm: Pcm,
  args: ChopArgs,
  ctx: ChopContext,
  defaultSnap: "zero" | "none",
): Promise<{ start: number; end: number }> {
  const compute = ctx.compute ?? inlineComputer;
  const total = seconds(pcm);
  const from =
    args.from !== undefined
      ? parseTimeInFile(args.from, total, "from", ctx.tempo)
      : 0;
  const to =
    args.to !== undefined ? parseTime(args.to, total, ctx.tempo) : total;
  if (to <= from)
    throw new ChopError(
      `to (${fmtSeconds(to)}) must be after from (${fmtSeconds(from)})`,
    );
  let start = Math.round(from * pcm.sampleRate);
  let end = Math.round(to * pcm.sampleRate);
  const snap = args.snap ?? defaultSnap;
  if (snap === "zero") {
    const signal = await compute.mono(pcm);
    start = await compute.snapToZero(signal, start, pcm.sampleRate);
    end = await compute.snapToZero(signal, end, pcm.sampleRate);
  } else if (snap === "onset") {
    const points = await compute.onsets(pcm, args.sensitivity ?? 1);
    const radius = Math.round(ops.ONSET_SNAP_SECONDS * pcm.sampleRate);
    start = await compute.snapToList(start, points, radius);
    end =
      end === frames(pcm) ? end : await compute.snapToList(end, points, radius);
  } else if (snap === "beat") {
    const grid = await compute.beats(pcm);
    if (grid) {
      const marks = grid.beats.map((t) => Math.round(t * pcm.sampleRate));
      const radius = Math.round((30 / grid.bpm) * pcm.sampleRate);
      start = await compute.snapToList(start, marks, radius);
      end =
        end === frames(pcm)
          ? end
          : await compute.snapToList(end, marks, radius);
    }
  }
  if (end <= start) throw new ChopError("the range is empty after snapping");
  return { start, end };
}

async function info(
  file: Resolved,
  pcm: Pcm,
  sha256: string,
  format: string,
  compute: ChopComputer,
): Promise<AudioInfo> {
  const grid = seconds(pcm) >= 4 ? await compute.beats(pcm) : undefined;
  return {
    path: file.relative,
    seconds: round3(seconds(pcm)),
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.length,
    format,
    peakDb: dbOf(await compute.peak(pcm)),
    rmsDb: dbOf(await compute.rms(pcm)),
    ...(grid ? { bpm: grid.bpm } : {}),
    sha256,
  };
}

function framesOf(
  spec: TimeSpec | undefined,
  pcm: Pcm,
  ctx: ChopContext,
  fallback = 0,
): number {
  if (spec === undefined) return fallback;
  if (typeof spec === "number" && spec < 0)
    return -Math.round(-spec * pcm.sampleRate);
  if (typeof spec === "string" && spec.trim().startsWith("-"))
    return -Math.round(
      parseTime(spec.trim().slice(1), Number.MAX_SAFE_INTEGER, ctx.tempo) *
        pcm.sampleRate,
    );
  return Math.round(
    parseTime(spec, Number.MAX_SAFE_INTEGER, ctx.tempo) * pcm.sampleRate,
  );
}

function pointsFromFrames(
  list: readonly number[],
  sampleRate: number,
): ChopPoint[] {
  return list
    .slice(0, CHOP_LIMITS.maxPoints)
    .map((f) => ({ t: round3(f / sampleRate) }));
}

async function segmentsFor(
  pcm: Pcm,
  args: ChopArgs,
  compute: ChopComputer,
): Promise<ops.Segment[]> {
  const method = args.method ?? "silence";
  const minFrames = Math.round(((args.minMs ?? 80) / 1000) * pcm.sampleRate);
  const count = Math.round(
    num(args.count, "count", 1, CHOP_LIMITS.maxSlices) ?? 8,
  );
  switch (method) {
    case "silence":
      return await compute.silenceSegments(
        pcm,
        args.thresholdDb ?? -40,
        minFrames,
      );
    case "onset":
      return await compute.onsetSegments(pcm, minFrames, args.sensitivity ?? 1);
    case "section":
      return await compute.sectionSegments(pcm, Math.min(16, count));
    case "beats":
      return await compute.beatSegments(pcm, 1);
    case "grid":
      return await compute.gridSegments(pcm, count);
  }
}

export async function runChop(
  op: ChopOp,
  args: ChopArgs,
  ctx: ChopContext,
): Promise<ChopResult> {
  if (!isChopOp(op))
    throw new ChopError(`unknown op · one of ${CHOP_OPS.join(", ")}`);
  const signal = ctx.signal;
  const compute = ctx.compute ?? inlineComputer;
  const backends = detectBackends(ctx.runner);
  const loaded = new Map<string, Loaded>();
  const load = async (
    file: string | undefined,
    label = "input",
  ): Promise<Loaded> => {
    const resolved = await resolveIn(ctx, file, label);
    const hit = loaded.get(resolved.absolute);
    if (hit) return hit;
    ctx.progress?.(`read ${resolved.relative}`);
    const pcm = await readAudio(
      resolved.absolute,
      ctx.runner,
      signal,
      compute.decodeWavBytes,
    );
    const value = {
      file: resolved,
      pcm,
      sha256: await sha256File(resolved.absolute),
    };
    loaded.set(resolved.absolute, value);
    return value;
  };
  if (signal.aborted) throw new ChopError("cancelled");

  const outputs: ChopOutput[] = [];
  const trashed: { path: string; copy: string; sha256: string }[] = [];
  let backend: ChopResult["backend"] = "ts";
  // All DSP and external tools write private staging files. Cancellation is
  // accepted until publication begins; commit then completes without calling
  // the cancellable worker, including sidecars and the history receipt.
  const staged: {
    final: Resolved & { exists?: boolean };
    temporary: Resolved;
  }[] = [];
  const stage = (out: Resolved & { exists?: boolean }): Resolved => {
    const ext = extname(out.absolute);
    const temporary = {
      ...out,
      absolute: join(
        dirname(out.absolute),
        `.${basename(out.absolute, ext)}.dawg-chop-${randomUUID()}${ext}`,
      ),
    };
    staged.push({ final: out, temporary });
    return temporary;
  };

  const target = async (
    stem: string,
    suffix: string,
    ext = "wav",
  ): Promise<Resolved> => {
    if (args.output) {
      const out = await resolveOutput(ctx, args.output);
      return stage(out);
    }
    return stage(await freshOutput(ctx, stem, suffix, ext));
  };
  const emit = async (
    out: Resolved,
    pcm: Pcm,
    extra: { from?: number; to?: number } = {},
    sources: readonly Loaded[] = [],
  ): Promise<ChopOutput> => {
    if (signal.aborted) throw new ChopError("cancelled");
    if (frames(pcm) === 0) throw new ChopError("the result is empty");
    await writeAudio(out.absolute, pcm, compute.encodeWav24, signal);
    return record(out, pcm, extra, sources);
  };
  const record = async (
    out: Resolved,
    pcm: Pcm | undefined,
    extra: { from?: number; to?: number },
    sources: readonly Loaded[],
  ): Promise<ChopOutput> => {
    const sha256 = await sha256File(out.absolute);
    const output: ChopOutput = {
      path: out.relative,
      sha256,
      seconds: pcm ? round3(seconds(pcm)) : 0,
      peakDb: pcm ? dbOf(await compute.peak(pcm)) : 0,
      ...(extra.from !== undefined ? { from: round3(extra.from) } : {}),
      ...(extra.to !== undefined ? { to: round3(extra.to) } : {}),
    };
    // Sample asset registration: a sidecar next to the file (op, args digest,
    // input hashes), so `info`, the agent and later lanes can trace lineage.
    if (out.relative.toLowerCase().endsWith(".wav"))
      await writeJsonAtomic(out.absolute.replace(/\.wav$/i, ".chop.json"), {
        op,
        sha256,
        inputs: sources.map((s) => ({
          path: s.file.relative,
          sha256: s.sha256,
        })),
        args: digestArgs(args),
        ...(output.from !== undefined
          ? { from: output.from, to: output.to }
          : {}),
      });
    outputs.push(output);
    return output;
  };

  let points: ChopPoint[] | undefined;
  let peaksResult: ChopResult["peaks"];
  let infoResult: AudioInfo | undefined;
  let bpm: number | undefined;
  let summary = "";

  try {
    if (op === "concat" || op === "mix") {
      const list = args.inputs ?? [];
      if (list.length < 2 || list.length > CHOP_LIMITS.maxInputs)
        throw new ChopError(`${op} needs 2 to ${CHOP_LIMITS.maxInputs} inputs`);
      const parts: Loaded[] = [];
      for (const item of list) parts.push(await load(item, "inputs"));
      const pcm =
        op === "concat"
          ? await compute.concat(
              parts.map((p) => p.pcm),
              Math.round(
                ((num(args.crossfadeMs, "crossfadeMs", 0, 5000) ?? 0) / 1000) *
                  parts[0]!.pcm.sampleRate,
              ),
            )
          : await compute.mix(
              parts.map((p) => p.pcm),
              (args.gains ?? []).map((g, i) => num(g, `gains[${i}]`, -60, 24)!),
              (args.offsets ?? []).map((o) => framesOf(o, parts[0]!.pcm, ctx)),
            );
      const out = await target(stemOf(parts[0]!.file.relative), op);
      const written = await emit(out, pcm, {}, parts);
      summary = `${op} ${parts.length} files → ${written.path} (${fmtSeconds(written.seconds)})`;
    } else {
      const src = await load(args.input);
      const pcm = src.pcm;
      const sr = pcm.sampleRate;
      const stem = stemOf(src.file.relative);
      const ext = extname(src.file.relative).slice(1).toLowerCase() || "wav";
      switch (op) {
        case "info": {
          infoResult = await info(src.file, pcm, src.sha256, ext, compute);
          summary = `${src.file.relative}: ${fmtSeconds(infoResult.seconds)} · ${sr} Hz · ${infoResult.channels} ch · peak ${infoResult.peakDb} dB · rms ${infoResult.rmsDb} dB${infoResult.bpm ? ` · ~${infoResult.bpm} bpm` : ""}`;
          break;
        }
        case "peaks": {
          const { start, end } = await range(pcm, args, ctx, "none");
          const bins = await compute.peakBins(
            await compute.slicePcm(pcm, start, end),
            Math.round(
              num(args.count, "count", 1, CHOP_LIMITS.maxPeakBins) ?? 80,
            ),
          );
          peaksResult = {
            bins,
            text: await compute.peakStrip(bins, ctx.ascii),
          };
          summary = `${src.file.relative} ${fmtSeconds(start / sr)}–${fmtSeconds(end / sr)}: ${bins.length} bins`;
          break;
        }
        case "onsets": {
          const { start, end } = await range(pcm, args, ctx, "none");
          const found = (
            await compute.onsets(
              await compute.slicePcm(pcm, start, end),
              num(args.sensitivity, "sensitivity", 0.1, 10) ?? 1,
            )
          ).map((f) => f + start);
          points = pointsFromFrames(found, sr);
          summary = `${found.length} onsets in ${src.file.relative}${found.length > CHOP_LIMITS.maxPoints ? ` (first ${CHOP_LIMITS.maxPoints} listed)` : ""}`;
          break;
        }
        case "beats": {
          const grid = await compute.beats(pcm);
          if (!grid)
            throw new ChopError(
              `no steady tempo found in ${src.file.relative}`,
            );
          bpm = grid.bpm;
          points = grid.beats.slice(0, CHOP_LIMITS.maxPoints).map((t, i) => ({
            t,
            ...(i % 4 === 0 ? { label: `bar ${i / 4 + 1}` } : {}),
          }));
          summary = `${src.file.relative}: ${grid.bpm} bpm (confidence ${grid.confidence}) · first beat ${fmtSeconds(grid.offset)} · ${grid.beats.length} beats`;
          break;
        }
        case "segments": {
          const list = (await segmentsFor(pcm, args, compute)).slice(
            0,
            CHOP_LIMITS.maxSlices,
          );
          points = list.map((s, i) => ({
            t: round3(s.start / sr),
            end: round3(s.end / sr),
            label: `${i + 1}`,
          }));
          summary = `${list.length} ${args.method ?? "silence"} segments in ${src.file.relative}`;
          break;
        }
        case "find": {
          const reference = args.reference;
          if (!reference)
            throw new ChopError(
              "find needs reference {from, to} (and optional input)",
            );
          const refSrc = reference.input
            ? await load(reference.input, "reference.input")
            : src;
          const refTotal = seconds(refSrc.pcm);
          const a = Math.round(
            parseTime(reference.from, refTotal, ctx.tempo) *
              refSrc.pcm.sampleRate,
          );
          const b = Math.round(
            parseTime(reference.to, refTotal, ctx.tempo) *
              refSrc.pcm.sampleRate,
          );
          if (b <= a)
            throw new ChopError("reference.to must be after reference.from");
          if (refSrc.pcm.sampleRate !== sr)
            throw new ChopError(
              "reference and input sample rates differ · resample first",
            );
          const matches = await compute.findSimilar(
            pcm,
            await compute.slicePcm(refSrc.pcm, a, b),
            Math.round(num(args.count, "count", 1, 32) ?? 8),
          );
          points = matches.map((m) => ({
            t: round3(m.start / sr),
            end: round3(m.end / sr),
            score: m.score,
          }));
          summary = `${matches.length} regions like ${fmtSeconds(a / sr)}–${fmtSeconds(b / sr)} in ${src.file.relative}`;
          break;
        }
        case "audition": {
          const total = seconds(pcm);
          const from =
            args.from !== undefined
              ? parseTime(args.from, total, ctx.tempo)
              : undefined;
          const to =
            args.to !== undefined
              ? parseTime(args.to, total, ctx.tempo)
              : undefined;
          if (!ctx.audition)
            summary = `audio is off · nothing played (${src.file.relative})`;
          else {
            await ctx.audition(src.file.absolute, from, to);
            summary = `playing ${src.file.relative}${from !== undefined || to !== undefined ? ` ${fmtSeconds(from ?? 0)}–${fmtSeconds(to ?? total)}` : ""}`;
          }
          break;
        }
        case "cut": {
          const { start, end } = await range(pcm, args, ctx, "zero");
          const out = await target(stem, "cut");
          const w = await emit(
            out,
            await compute.slicePcm(pcm, start, end),
            { from: start / sr, to: end / sr },
            [src],
          );
          summary = `cut ${fmtSeconds(start / sr)}–${fmtSeconds(end / sr)} → ${w.path}`;
          break;
        }
        case "trim": {
          const bounds = await compute.trimBounds(
            pcm,
            num(args.thresholdDb, "thresholdDb", -120, 0) ?? -40,
          );
          if (bounds.end <= bounds.start)
            throw new ChopError(
              `${src.file.relative} is silent below ${args.thresholdDb ?? -40} dB`,
            );
          const signal = await compute.mono(pcm);
          const snapped = (args.snap ?? "zero") === "zero";
          const start = snapped
            ? await compute.snapToZero(signal, bounds.start, sr)
            : bounds.start;
          const end = snapped
            ? await compute.snapToZero(signal, bounds.end, sr)
            : bounds.end;
          const out = await target(stem, "trim");
          const w = await emit(
            out,
            await compute.slicePcm(pcm, start, Math.max(start + 1, end)),
            { from: start / sr, to: end / sr },
            [src],
          );
          summary = `trimmed ${fmtSeconds(start / sr)} head, ${fmtSeconds((frames(pcm) - end) / sr)} tail → ${w.path}`;
          break;
        }
        case "pad":
        case "shift": {
          const offset = framesOf(args.offset, pcm, ctx);
          if (offset === 0)
            throw new ChopError(
              `${op} needs a non-zero offset (positive adds silence before, negative drops the head)`,
            );
          const out = await target(stem, op);
          const w = await emit(
            out,
            await compute.pad(pcm, offset, op === "pad" ? 0 : 0),
            {},
            [src],
          );
          summary = `${op} ${offset > 0 ? "+" : "-"}${fmtSeconds(Math.abs(offset) / sr)} → ${w.path}`;
          break;
        }
        case "loop": {
          const { start, end } = await range(pcm, args, ctx, "zero");
          const x = Math.round(
            ((num(args.crossfadeMs, "crossfadeMs", 0, 2000) ?? 10) / 1000) * sr,
          );
          const out = await target(stem, "loop");
          const w = await emit(
            out,
            await compute.loopSeam(await compute.slicePcm(pcm, start, end), x),
            { from: start / sr, to: end / sr },
            [src],
          );
          summary = `loop ${fmtSeconds(start / sr)}–${fmtSeconds(end / sr)} (${fmtSeconds(x / sr)} seam) → ${w.path}`;
          break;
        }
        case "stretch":
        case "pitch": {
          let ratio: number | undefined;
          let semitones: number | undefined;
          if (op === "stretch") {
            if (args.fromBpm !== undefined || args.toBpm !== undefined) {
              const a = num(args.fromBpm, "fromBpm", 20, 400);
              const b = num(args.toBpm, "toBpm", 20, 400);
              if (a === undefined || b === undefined)
                throw new ChopError("stretch by tempo needs fromBpm and toBpm");
              ratio = a / b;
            } else ratio = num(args.ratio, "ratio", 0.25, 4);
            if (ratio === undefined)
              throw new ChopError(
                "stretch needs ratio (0.25..4) or fromBpm and toBpm",
              );
            if (ratio < 0.25 || ratio > 4)
              throw new ChopError("stretch ratio must be 0.25..4");
          } else {
            semitones = num(args.semitones, "semitones", -24, 24);
            if (semitones === undefined)
              throw new ChopError("pitch needs semitones (-24..24)");
          }
          const formant = args.preserve === "formant";
          const out = await target(
            stem,
            op === "stretch"
              ? `x${round3(ratio!)}`
              : `${semitones! >= 0 ? "up" : "down"}${Math.abs(round3(semitones!))}`,
          );
          if (
            backends.rubberband &&
            src.file.relative.toLowerCase().endsWith(".wav")
          ) {
            backend = "rubberband";
            await runBackend(
              ctx.runner,
              "rubberband",
              rubberbandArgv(src.file.absolute, out.absolute, {
                ...(ratio !== undefined ? { ratio } : {}),
                ...(semitones !== undefined ? { semitones } : {}),
                formant,
              }),
              signal,
            );
            const result = await readAudio(
              out.absolute,
              ctx.runner,
              signal,
              compute.decodeWavBytes,
            );
            await record(out, result, {}, [src]);
          } else {
            const result =
              op === "stretch"
                ? await compute.stretchTs(pcm, ratio!)
                : await compute.pitchTs(pcm, semitones!, formant);
            await emit(out, result, {}, [src]);
          }
          const w = outputs[outputs.length - 1]!;
          summary = `${op === "stretch" ? `stretch ×${round3(ratio!)}` : `pitch ${semitones! > 0 ? "+" : ""}${semitones} st${formant ? " (formant kept)" : ""}`} [${backend}] → ${w.path}`;
          break;
        }
        case "fade": {
          const total = seconds(pcm);
          const fin =
            args.fadeIn !== undefined
              ? parseTime(args.fadeIn, total, ctx.tempo)
              : 0;
          const fout =
            args.fadeOut !== undefined
              ? parseTime(args.fadeOut, total, ctx.tempo)
              : 0;
          if (fin === 0 && fout === 0)
            throw new ChopError("fade needs fadeIn and/or fadeOut");
          const out = await target(stem, "fade");
          const w = await emit(
            out,
            await compute.fade(
              pcm,
              Math.round(fin * sr),
              Math.round(fout * sr),
              args.curve ?? "linear",
            ),
            {},
            [src],
          );
          summary = `fade in ${fmtSeconds(fin)} out ${fmtSeconds(fout)} (${args.curve ?? "linear"}) → ${w.path}`;
          break;
        }
        case "normalize": {
          const targetDb = num(args.targetDb, "targetDb", -60, 0) ?? -1;
          const out = await target(stem, "norm");
          const w = await emit(
            out,
            await compute.normalize(pcm, targetDb, args.rms ? "rms" : "peak"),
            {},
            [src],
          );
          summary = `normalize ${args.rms ? "rms" : "peak"} → ${targetDb} dB → ${w.path}`;
          break;
        }
        case "gain": {
          const db = num(args.db, "db", -60, 24);
          if (db === undefined) throw new ChopError("gain needs db (-60..24)");
          const out = await target(stem, "gain");
          const w = await emit(out, await compute.gain(pcm, db), {}, [src]);
          summary = `gain ${db > 0 ? "+" : ""}${db} dB → ${w.path} (peak ${w.peakDb} dB${w.peakDb > 0 ? ", clips" : ""})`;
          break;
        }
        case "reverse": {
          const out = await target(stem, "rev");
          const w = await emit(out, await compute.reverse(pcm), {}, [src]);
          summary = `reversed → ${w.path}`;
          break;
        }
        case "filter": {
          const kind = args.type ?? "lowpass";
          const hz = num(args.hz, "hz", 20, 20_000);
          if (hz === undefined)
            throw new ChopError("filter needs hz (20..20000)");
          const q = num(args.q, "q", 0.1, 20) ?? 0.707;
          const out = await target(stem, kind);
          const w = await emit(
            out,
            await compute.filter(pcm, kind, hz, q),
            {},
            [src],
          );
          summary = `${kind} ${hz} Hz q ${q} → ${w.path}`;
          break;
        }
        case "resample": {
          const rate = num(args.sampleRate, "sampleRate", 8000, 192_000);
          if (rate === undefined)
            throw new ChopError("resample needs sampleRate (8000..192000)");
          const out = await target(stem, `${Math.round(rate / 1000)}k`);
          const w = await emit(
            out,
            await compute.resample(pcm, Math.round(rate)),
            {},
            [src],
          );
          summary = `resample ${sr} → ${Math.round(rate)} Hz → ${w.path}`;
          break;
        }
        case "convert": {
          const format = args.format ?? "wav";
          const rate = num(args.sampleRate, "sampleRate", 8000, 192_000);
          if (format !== "wav" && !backends.ffmpeg)
            throw new ChopError(
              `convert to ${format} needs ffmpeg · ${FFMPEG_HINT}`,
            );
          const out = await target(stem, "conv", format);
          if (format === "wav" && !backends.ffmpeg) {
            let result = rate
              ? await compute.resample(pcm, Math.round(rate))
              : pcm;
            if (args.channels === 1)
              result = {
                sampleRate: result.sampleRate,
                channels: [await compute.mono(result)],
              };
            if (args.channels === 2 && result.channels.length === 1)
              result = {
                sampleRate: result.sampleRate,
                channels: [result.channels[0]!, result.channels[0]!],
              };
            await emit(out, result, {}, [src]);
          } else {
            backend = "ffmpeg";
            await runBackend(
              ctx.runner,
              "ffmpeg",
              ffmpegConvertArgv(src.file.absolute, out.absolute, {
                format,
                ...(rate ? { sampleRate: rate } : {}),
                ...(args.channels ? { channels: args.channels } : {}),
              }),
              signal,
            );
            await record(
              out,
              format === "wav"
                ? await readAudio(
                    out.absolute,
                    ctx.runner,
                    signal,
                    compute.decodeWavBytes,
                  )
                : undefined,
              {},
              [src],
            );
          }
          summary = `convert → ${outputs[0]!.path} [${backend}]`;
          break;
        }
        case "split": {
          if (pcm.channels.length < 2)
            throw new ChopError(
              `${src.file.relative} is mono · nothing to split`,
            );
          if (args.output)
            throw new ChopError(
              "split writes one file per channel · leave output unset",
            );
          const parts = await compute.split(pcm);
          for (let i = 0; i < parts.length; i += 1)
            await emit(
              stage(await freshOutput(ctx, stem, `ch${i + 1}`)),
              parts[i]!,
              {},
              [src],
            );
          summary = `split ${parts.length} channels → ${outputs.map((o) => o.path).join(", ")}`;
          break;
        }
        case "slice": {
          if (args.output)
            throw new ChopError(
              "slice writes one file per piece · leave output unset",
            );
          const total = frames(pcm);
          const span =
            args.from !== undefined || args.to !== undefined
              ? await range(pcm, args, ctx, "none")
              : { start: 0, end: total };
          const region = await compute.slicePcm(pcm, span.start, span.end);
          const method = args.method ?? "onset";
          let list = await segmentsFor(region, { ...args, method }, compute);
          const cap = Math.round(
            num(args.count, "count", 1, CHOP_LIMITS.maxSlices) ??
              CHOP_LIMITS.maxSlices,
          );
          if (method !== "grid") list = list.slice(0, cap);
          if (list.length === 0)
            throw new ChopError(
              "no slices found · try method grid with count, or a lower thresholdDb",
            );
          const signal2 = await compute.mono(region);
          const snapped = (args.snap ?? "zero") === "zero";
          for (let i = 0; i < list.length; i += 1) {
            const s = list[i]!;
            const a = snapped
              ? await compute.snapToZero(signal2, s.start, sr)
              : s.start;
            const b = snapped
              ? await compute.snapToZero(signal2, s.end, sr)
              : s.end;
            if (b - a < 16) continue;
            // A 2 ms fade on each edge so a hard cut never clicks.
            const piece = await compute.fade(
              await compute.slicePcm(region, a, b),
              Math.min(96, Math.floor((b - a) / 4)),
              Math.min(96, Math.floor((b - a) / 4)),
            );
            const out = stage(
              await freshOutput(
                ctx,
                stem,
                `s${String(i + 1).padStart(2, "0")}`,
              ),
            );
            await emit(
              out,
              piece,
              { from: (span.start + a) / sr, to: (span.start + b) / sr },
              [src],
            );
          }
          summary = `sliced ${src.file.relative} into ${outputs.length} pieces (${method}) → ${outDirOf(ctx)}/${stem}-sNN.wav`;
          break;
        }
      }
    }

    // Preflight every sidecar before publishing any prepared audio. A directory,
    // symlink or independently created orphan must not turn a successful audio
    // replacement into a metadata failure halfway through the commit.
    for (const { final } of staged) {
      if (!final.absolute.toLowerCase().endsWith(".wav")) continue;
      const sidecar = final.absolute.replace(/\.wav$/i, ".chop.json");
      const existing = await lstat(sidecar).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      });
      if (
        existing &&
        (!existing.isFile() || existing.isSymbolicLink() || !final.exists)
      )
        throw new ChopError(
          `output metadata is occupied: ${final.relative.replace(/\.wav$/i, ".chop.json")} · choose a different output`,
        );
    }
    if (signal.aborted) throw new ChopError("cancelled");
    for (const { final, temporary } of staged) {
      if (final.exists) {
        trashed.push(await trash(ctx, final));
        await rename(temporary.absolute, final.absolute);
      } else {
        // An independently created destination wins; never overwrite it.
        await link(temporary.absolute, final.absolute);
        await rm(temporary.absolute);
      }
      if (final.absolute.toLowerCase().endsWith(".wav"))
        await rename(
          temporary.absolute.replace(/\.wav$/i, ".chop.json"),
          final.absolute.replace(/\.wav$/i, ".chop.json"),
        );
    }

    const history = ctx.history ?? historySink();
    if (history && outputs.length > 0) {
      for (const output of outputs) {
        try {
          history.append({
            kind: "asset",
            sub: `audio.${op}`,
            actor: ctx.actor ?? { kind: "system" },
            summary: `${op} → ${output.path}`.slice(0, 160),
            payload: {
              op,
              path: output.path,
              sha256: output.sha256,
              args: digestArgs(args),
              inputs: [...loaded.values()].map((l) => ({
                path: l.file.relative,
                sha256: l.sha256,
              })),
            },
            targets: [
              { type: "sample", key: output.sha256 },
              { type: "file", key: output.path },
              ...(args.track
                ? [
                    {
                      type: "track" as const,
                      key: args.track,
                      trackId: args.track,
                    },
                  ]
                : []),
            ],
          });
        } catch {
          // History is an index; a failed append never fails the edit.
        }
      }
    }

    return {
      op,
      outputs,
      ...(points ? { points } : {}),
      ...(peaksResult ? { peaks: peaksResult } : {}),
      ...(infoResult ? { info: infoResult } : {}),
      ...(bpm !== undefined ? { bpm } : {}),
      ...(trashed.length ? { trashed } : {}),
      backend,
      summary: summary.slice(0, 300),
    };
  } finally {
    for (const { temporary } of staged) {
      await rm(temporary.absolute, { force: true }).catch(() => undefined);
      if (temporary.absolute.toLowerCase().endsWith(".wav"))
        await rm(temporary.absolute.replace(/\.wav$/i, ".chop.json"), {
          force: true,
        }).catch(() => undefined);
    }
  }
}

/** Args without bulky arrays, for sidecars and history payloads. */
export function digestArgs(args: ChopArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) out[key] = value.slice(0, 16);
    else out[key] = value;
  }
  return out;
}

export { CHOP_ANALYSIS_OPS };
