/**
 * `/vocal pitch` and `/vocal notes` (0.7, pitch lane): read-only pitch
 * analysis of the focused track's audio clip or sampler voice, and a
 * guide-notes track made from it. Neither adds a Track field: `pitch` only
 * reports, and `notes` adds an ordinary note track.
 *
 * The detected key uses the note durations (Krumhansl-Schmuckler profiles
 * through `core/key.ts`, the same estimator `/media analyze` uses), so a
 * long held tonic weighs more than a passing tone.
 */
import {
  TrackScore,
  SCORE_LIMITS,
  addTrack,
  isSamplerInstrument,
  type AudioClip,
  type NoteInput,
  type Track,
  type TrackInput,
} from "../../core/score.ts";
import { clipSongTick } from "../../core/clips.ts";
import { estimateKey } from "../../core/key.ts";
import { barTicks } from "../../core/sections.ts";
import { secondsAtTick, tickAtSeconds } from "../../core/tempo.ts";
import { pitchCurve } from "../audio/analysis.ts";
import {
  centsOfHz,
  isPitchVoice,
  pitchNotes,
  PITCH_VOICE_NAMES,
  type PitchCurve,
  type PitchNote,
  type PitchVoice,
} from "../audio/dsp/pitch.ts";
import {
  SampleLibrary,
  granularSample,
  sampleKey,
  type DecodedSample,
} from "../audio/samples.ts";
import type { PitchTracePoint } from "../../tui/highway.ts";
import { freeTrackId } from "./resample.ts";
import type { VocalContext, VocalResult, VocalVerb } from "./vocal.ts";

/** Something on a track that has audio to analyse. */
export type PitchTarget = Readonly<{
  /** `clip <id>` or `voice <name>`. */
  label: string;
  kind: "clip" | "voice";
  /** Clip id or sampler voice name. */
  name: string;
  clip?: AudioClip;
}>;

/** Clips first (unmuted ones before muted), then sampler voices. */
export function pitchTargets(track: Track): PitchTarget[] {
  const out: PitchTarget[] = [];
  const clips = [...(track.clips ?? [])].sort(
    (a, b) => Number(a.mute ?? false) - Number(b.mute ?? false),
  );
  for (const clip of clips)
    out.push({ label: `clip ${clip.id}`, kind: "clip", name: clip.id, clip });
  if (isSamplerInstrument(track.instrument) && track.sampler)
    for (const voice of Object.keys(track.sampler.voices).sort())
      out.push({ label: `voice ${voice}`, kind: "voice", name: voice });
  if (granularSample(track))
    out.push({ label: "granular source", kind: "voice", name: "granular:src" });
  return out;
}

export type PitchReport = Readonly<{
  trackId: string;
  target: PitchTarget;
  voice: PitchVoice;
  curve: PitchCurve;
  /** Notes inside the played window, times in file seconds. */
  notes: readonly PitchNote[];
  /** e.g. `A minor`, or null when there are too few notes. */
  key: string | null;
  /** Median, lowest and highest voiced pitch in Hz (0 when silent). */
  median: number;
  low: number;
  high: number;
  /** Voiced share of the analysed window, 0..1. */
  voiced: number;
  /** The analysed window in file seconds. */
  from: number;
  to: number;
}>;

export type AnalyzeOptions = Readonly<{
  /** Only clips, or only sample voices. */
  kind?: "clip" | "voice";
  /** Clip id or voice name (exact, then any case); default the first target. */
  target?: string;
  voice?: PitchVoice;
  library?: SampleLibrary;
}>;

/** A clear failure message the commands print as is. */
export class PitchTargetError extends Error {}

async function decodeTarget(
  score: TrackScore,
  track: Track,
  target: PitchTarget,
  library: SampleLibrary,
): Promise<DecodedSample> {
  if (target.kind === "clip") return library.decodeFile(target.clip!.src);
  const only = new TrackScore({
    ...score.toJSON(),
    tracks: [track],
    notes: [],
  } as never);
  const bank = await library.load(only);
  const sample = bank.voices.get(sampleKey(track.id, target.name));
  if (sample) return sample;
  const problem = bank.problems.find((p) => p.voice === target.name);
  throw new PitchTargetError(
    problem?.message ?? `${target.label} could not be loaded`,
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1]!;
}

/** Key from note durations, pitch class 0 = C. */
export function keyOfNotes(notes: readonly PitchNote[]): string | null {
  if (notes.length < 3) return null;
  const histogram = new Array<number>(12).fill(0);
  for (const note of notes)
    histogram[((note.midi % 12) + 12) % 12]! += note.end - note.start;
  return estimateKey(histogram);
}

/** Tracks (or reads from the cache) the focused track's audio. */
export async function analyzeTrackPitch(
  score: TrackScore,
  trackId: string,
  cwd: string,
  options: AnalyzeOptions = {},
): Promise<PitchReport> {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new PitchTargetError(`no track ${trackId}`);
  const targets = pitchTargets(track);
  if (targets.length === 0)
    throw new PitchTargetError(
      `${trackId} has no audio clip or sample voice · import one with /vocal import <file> or /sample <file>`,
    );
  const pool = options.kind
    ? targets.filter((candidate) => candidate.kind === options.kind)
    : targets;
  const wanted = options.target;
  const target = wanted
    ? (pool.find((candidate) => candidate.name === wanted) ??
      pool.find(
        (candidate) => candidate.name.toLowerCase() === wanted.toLowerCase(),
      ))
    : pool[0];
  if (!target)
    throw new PitchTargetError(
      `${trackId} has no ${options.kind ?? "clip or voice"}${wanted ? ` ${wanted}` : ""} · try ${targets.map((t) => t.label).join(", ")}`,
    );
  const library = options.library ?? new SampleLibrary({ projectRoot: cwd });
  const sample = await decodeTarget(score, track, target, library);
  const voice = options.voice ?? "auto";
  const curve = await pitchCurve(sample, { voice, projectRoot: cwd });
  const length = sample.frames / sample.sampleRate;
  const from = Math.min(length, target.clip?.offset ?? 0);
  const to = Math.min(length, from + (target.clip?.dur ?? length));
  const notes = pitchNotes(curve).filter(
    (note) => note.end > from && note.start < to,
  );
  const hz: number[] = [];
  let frames = 0;
  for (let f = 0; f < curve.f0.length; f += 1) {
    const t = curve.t0 + f * curve.hop;
    if (t < from || t > to) continue;
    frames += 1;
    if (curve.f0[f]! > 0) hz.push(curve.f0[f]!);
  }
  hz.sort((a, b) => a - b);
  return {
    trackId,
    target,
    voice,
    curve,
    notes,
    key: keyOfNotes(notes),
    median: median(hz),
    low: hz.length ? hz[Math.floor(hz.length * 0.02)]! : 0,
    high: hz.length ? hz[Math.ceil(hz.length * 0.98) - 1]! : 0,
    voiced: frames ? hz.length / frames : 0,
    from,
    to,
  };
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** `A4 +12c` for a frequency. */
export function hzName(hz: number): string {
  if (!(hz > 0)) return "-";
  const cents = centsOfHz(hz) + 6900;
  const midi = Math.round(cents / 100);
  const off = Math.round(cents - midi * 100);
  const name = `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  return off === 0 ? name : `${name} ${off > 0 ? "+" : ""}${off}c`;
}

/** The lines `/vocal pitch` prints. */
export function pitchReportLines(report: PitchReport): string[] {
  const seconds = report.to - report.from;
  return [
    `${report.trackId} · ${report.target.label} · ${seconds.toFixed(1)} s · voice ${report.voice}`,
    `key · ${report.key ?? "unclear (too few notes)"}`,
    report.median > 0
      ? `pitch · median ${hzName(report.median)} (${report.median.toFixed(1)} Hz) · range ${hzName(report.low)} to ${hzName(report.high)}`
      : "pitch · no voiced audio found",
    `voiced · ${Math.round(report.voiced * 100)}% · ${report.notes.length} note${report.notes.length === 1 ? "" : "s"}`,
    "/vocal notes makes a guide-notes track from it",
  ];
}

/**
 * One receipt line for the prompt (cards show a single line): key, median,
 * range and note count; the agent tool returns the full lines.
 */
export function pitchReportSummary(
  report: PitchReport,
  trace: boolean | undefined,
): string {
  const parts = [`${report.trackId} · ${report.target.label}`];
  parts.push(`key · ${report.key ?? "unclear"}`);
  if (report.median > 0)
    parts.push(
      `median ${hzName(report.median)}`,
      `range ${hzName(report.low)} to ${hzName(report.high)}`,
    );
  else parts.push("no voiced audio");
  parts.push(
    `${report.notes.length} note${report.notes.length === 1 ? "" : "s"}`,
  );
  if (trace === true) parts.push("trace · on");
  if (trace === false) parts.push("trace · off");
  return parts.join(" · ");
}

/** Score seconds of file time `t` for the report's target. */
/** The analysed clip as it stands in `score` now (it may have moved). */
function currentClip(
  score: TrackScore,
  report: PitchReport,
): AudioClip | undefined {
  const clip = report.target.clip;
  if (!clip) return undefined;
  const track = score.tracks.find((t) => t.id === report.trackId);
  return track?.clips?.find((c) => c.id === clip.id) ?? clip;
}

function songSeconds(
  score: TrackScore,
  report: PitchReport,
  t: number,
  voiceStart: number,
): number {
  const clip = currentClip(score, report);
  if (!clip) return voiceStart + t;
  // As renderClips places it: track time, the take's nudge and clock drift,
  // and a reversed clip playing its window backwards.
  const track = score.tracks.find((item) => item.id === report.trackId);
  const take = clip.take
    ? track?.takes?.find((item) => item.name === clip.take)
    : undefined;
  const drift = 1 + (take?.ppm ?? 0) / 1e6;
  const into = clip.rev ? report.to - t : t - report.from;
  return (
    secondsAtTick(score, clipSongTick(clip, track?.time)) +
    (take?.nudge ?? 0) / 1000 +
    into / drift
  );
}

/**
 * Adds a note track with one note per detected note, placed through the
 * tempo map where the audio plays (a clip's start, or the first note that
 * plays a sampler voice, else bar 1).
 */
export function guideNotesScore(
  score: TrackScore,
  report: PitchReport,
  options: Readonly<{ as?: string }> = {},
): { next: TrackScore; trackId: string; count: number } {
  if (score.tracks.length >= SCORE_LIMITS.maxTracks)
    throw new PitchTargetError(
      `the song already has ${SCORE_LIMITS.maxTracks} tracks`,
    );
  const trackId = options.as ?? freeTrackId(score, `${report.trackId}-notes`);
  if (score.tracks.some((track) => track.id === trackId))
    throw new PitchTargetError(`track ${trackId} already exists`);
  let voiceStart = 0;
  if (report.target.kind === "voice") {
    const first = score.notes
      .filter((note) => note.trackId === report.trackId)
      .sort((a, b) => a.startTick - b.startTick)[0];
    if (first) voiceStart = secondsAtTick(score, first.startTick);
  }
  const end = score.bars * barTicks(score);
  const room = SCORE_LIMITS.maxNotes - score.notes.length;
  const notes: NoteInput[] = [];
  for (const note of report.notes) {
    if (notes.length >= room) break;
    const a = Math.max(note.start, report.from);
    const b = Math.min(note.end, report.to);
    const at = songSeconds(score, report, a, voiceStart);
    const until = songSeconds(score, report, b, voiceStart);
    const startTick = Math.round(tickAtSeconds(score, Math.min(at, until)));
    const endTick = Math.min(
      end,
      Math.round(tickAtSeconds(score, Math.max(at, until))),
    );
    if (startTick < 0 || startTick >= end) continue;
    notes.push({
      id: `${trackId}-${notes.length + 1}`,
      trackId,
      startTick,
      durationTicks: Math.max(1, endTick - startTick),
      pitch: Math.max(0, Math.min(127, note.midi)),
      velocity: Math.round((0.55 + 0.4 * note.confidence) * 100) / 100,
    });
  }
  const track: TrackInput = { id: trackId, name: trackId };
  const added = addTrack(score, track);
  const next = new TrackScore({
    ...added.toJSON(),
    notes: [...added.notes, ...notes],
  } as never);
  return { next, trackId, count: notes.length };
}

/** Trace points kept per track, at most this many. */
export const MAX_TRACE_POINTS = 4096;

/**
 * The trace the highway draws: one point per 20 ms of voiced audio (sparser
 * on long takes so the whole window fits MAX_TRACE_POINTS), in score beats
 * through the tempo map, fractional MIDI pitch.
 */
export function pitchTracePoints(
  score: TrackScore,
  report: PitchReport,
): PitchTracePoint[] {
  const { curve } = report;
  let voiceStart = 0;
  if (report.target.kind === "voice") {
    const first = score.notes
      .filter((note) => note.trackId === report.trackId)
      .sort((a, b) => a.startTick - b.startTick)[0];
    if (first) voiceStart = secondsAtTick(score, first.startTick);
  }
  const first = Math.max(0, Math.ceil((report.from - curve.t0) / curve.hop));
  const last = Math.min(
    curve.f0.length - 1,
    Math.floor((report.to - curve.t0) / curve.hop),
  );
  let voiced = 0;
  for (let f = first; f <= last; f += 1) if (curve.f0[f]! > 0) voiced += 1;
  const step = Math.max(
    1,
    Math.round(0.02 / curve.hop),
    Math.ceil(voiced / MAX_TRACE_POINTS),
  );
  const points: PitchTracePoint[] = [];
  for (let f = 0; f < curve.f0.length; f += step) {
    const hz = curve.f0[f]!;
    const t = curve.t0 + f * curve.hop;
    if (!(hz > 0) || t < report.from || t > report.to) continue;
    const seconds = songSeconds(score, report, t, voiceStart);
    points.push({
      beat: tickAtSeconds(score, seconds) / score.ticksPerBeat,
      pitch: 69 + 12 * Math.log2(hz / 440),
    });
    if (points.length >= MAX_TRACE_POINTS) break;
  }
  // A reversed clip plays its window backwards; the highway wants beat order.
  if (report.target.clip?.rev) points.reverse();
  return points;
}

/** What the session remembers of a track's last analysis (menu, highway). */
export type PitchSummary = Readonly<{
  label: string;
  key: string | null;
  median: number;
  /** Present while the highway trace is on. */
  trace?: readonly PitchTracePoint[];
  /** The analysis behind the trace, to re-place it after timing edits. */
  report?: PitchReport;
  /** The score the trace was placed against. */
  placedOn?: TrackScore;
}>;

const summaries = new Map<string, PitchSummary>();

/** The last `/vocal pitch` result for a track in this session. */
export function pitchSummary(trackId: string): PitchSummary | undefined {
  return summaries.get(trackId);
}

/**
 * The highway trace for a track, when it is on. Given the current score, the
 * trace is re-placed whenever the score changed since it was placed (tempo
 * map, clip start, the first note of a sampler voice).
 */
export function pitchTraceFor(
  trackId: string,
  score?: TrackScore,
): readonly PitchTracePoint[] | undefined {
  const summary = summaries.get(trackId);
  if (!summary?.trace) return undefined;
  if (!score || !summary.report || summary.placedOn === score)
    return summary.trace;
  const trace = pitchTracePoints(score, summary.report);
  summaries.set(trackId, { ...summary, trace, placedOn: score });
  return trace;
}

/** Forgets every remembered analysis (tests). */
export function clearPitchSummaries(): void {
  summaries.clear();
}

function remember(
  score: TrackScore,
  report: PitchReport,
  trace: boolean,
): void {
  summaries.set(report.trackId, {
    label: report.target.label,
    key: report.key,
    median: report.median,
    ...(trace
      ? { trace: pitchTracePoints(score, report), report, placedOn: score }
      : {}),
  });
  if (summaries.size > 64)
    summaries.delete(summaries.keys().next().value as string);
}

export type PitchArgs = Readonly<{
  /** Only clips, or only sample voices. */
  kind?: "clip" | "voice";
  target?: string;
  voice?: PitchVoice;
  as?: string;
}>;

/** The usage line both pitch verbs print for a word they do not know. */
export const PITCH_USAGE = `[clip|voice] [<name>] [${PITCH_VOICE_NAMES.join("|")}] [as <track id>]`;

/**
 * `[clip|voice] [<name>] [<range>] [as <track id>]`, words in any order and
 * any case. `clip` and `voice` pick the source kind (`voice` = a sampler
 * voice) and may be followed by its name; `voice <range>` and `range <range>`
 * also set the search range.
 */
export function parsePitchArgs(args: string): PitchArgs | string {
  const words = args.split(/\s+/).filter(Boolean);
  const out: {
    kind?: "clip" | "voice";
    target?: string;
    voice?: PitchVoice;
    as?: string;
  } = {};
  const usage = (word: string): string =>
    `unexpected ${word} · usage: ${PITCH_USAGE}`;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    const lower = word.toLowerCase();
    if (lower === "as") {
      const id = words[++i];
      if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id))
        return "as needs a track id (letters, digits, - and _)";
      out.as = id;
    } else if (lower === "range") {
      const name = words[++i]?.toLowerCase();
      if (!isPitchVoice(name))
        return `range is one of ${PITCH_VOICE_NAMES.join(", ")} · usage: ${PITCH_USAGE}`;
      out.voice = name;
    } else if (
      lower === "voice" &&
      isPitchVoice(words[i + 1]?.toLowerCase()) &&
      out.voice === undefined
    ) {
      out.voice = words[++i]!.toLowerCase() as PitchVoice;
    } else if ((lower === "clip" || lower === "voice") && !out.kind) {
      out.kind = lower;
    } else if (isPitchVoice(lower) && out.voice === undefined) {
      out.voice = lower;
    } else if (out.target === undefined) {
      out.target = word;
    } else return usage(word);
  }
  return out;
}

async function runPitch(
  args: string,
  context: VocalContext,
): Promise<VocalResult> {
  const traceWord = /^\s*trace(?:\s+(on|off))?\b(.*)$/i.exec(args);
  const before = summaries.get(context.trackId);
  if (traceWord && traceWord[1]?.toLowerCase() === "off") {
    if (before)
      summaries.set(context.trackId, {
        label: before.label,
        key: before.key,
        median: before.median,
      });
    return {
      ok: true,
      message: `vocal pitch: trace off for ${context.trackId}`,
    };
  }
  const trace = traceWord !== null || before?.trace !== undefined;
  const parsed = parsePitchArgs(traceWord ? traceWord[2]! : args);
  if (typeof parsed === "string")
    return { ok: false, message: `vocal pitch: ${parsed}` };
  try {
    const report = await analyzeTrackPitch(
      context.score,
      context.trackId,
      context.cwd,
      parsed,
    );
    remember(context.score, report, trace);
    return {
      ok: true,
      message: pitchReportSummary(report, trace || undefined),
    };
  } catch (error) {
    if (error instanceof PitchTargetError)
      return { ok: false, message: `vocal pitch: ${error.message}` };
    throw error;
  }
}

async function runNotes(
  args: string,
  context: VocalContext,
): Promise<VocalResult> {
  const parsed = parsePitchArgs(args);
  if (typeof parsed === "string")
    return { ok: false, message: `vocal notes: ${parsed}` };
  try {
    const report = await analyzeTrackPitch(
      context.score,
      context.trackId,
      context.cwd,
      parsed,
    );
    if (report.notes.length === 0)
      return {
        ok: false,
        message: `vocal notes: no notes found in ${report.trackId} · ${report.target.label}`,
      };
    const made = guideNotesScore(context.score, report, parsed);
    return {
      ok: true,
      message: `vocal notes: ${made.count} note${made.count === 1 ? "" : "s"} from ${report.target.label} on new track ${made.trackId}${report.key ? ` · key ${report.key}` : ""} · /mute it if it is only a guide`,
      next: made.next,
      kind: "pitch.notes",
      payload: { trackId: made.trackId, from: report.trackId },
    };
  } catch (error) {
    if (error instanceof PitchTargetError)
      return { ok: false, message: `vocal notes: ${error.message}` };
    throw error;
  }
}

/** The pitch lane's `/vocal` verbs. */
export const PITCH_VERBS: readonly VocalVerb[] = [
  {
    verb: "pitch",
    usage:
      "pitch [trace on|off] [clip|voice] [<name>] [bass|tenor|alto|soprano]",
    summary: "detected key, median pitch and range of the focused audio",
    lane: "pitch",
    run: runPitch,
  },
  {
    verb: "notes",
    usage: "notes [clip|voice] [<name>] [bass|tenor|alto|soprano] [as <track>]",
    summary: "turn the focused audio's melody into a guide-notes track",
    lane: "pitch",
    run: runNotes,
  },
];
