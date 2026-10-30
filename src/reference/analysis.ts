import type { TimedNote } from "../media/types.ts";
import { numberIn, record, VocalError } from "../vocals/spec.ts";

export class ReferenceError extends VocalError {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceError";
  }
}
export const REFERENCE_LIMITS = Object.freeze({
  maxSeconds: 600,
  maxInputBytes: 500 * 1024 * 1024,
  maxArtifactBytes: 768 * 1024 * 1024,
  maxJsonBytes: 4 * 1024 * 1024,
  maxLines: 512,
  maxLineSeconds: 20,
  maxWords: 8192,
});
export type ReferenceLyric = Readonly<{
  start: number;
  end: number;
  text: string;
  wordCenters?: readonly number[];
  timing?: "supplied" | "whisper-dtw" | "segment-interpolation";
}>;
export const lyricWords = (text: string) =>
  text
    .toLowerCase()
    .replaceAll("’", "'")
    .match(/[a-z]+(?:'[a-z]+)?/g) ?? [];

export function parseReferenceLyrics(
  value: unknown,
  duration: number,
): ReferenceLyric[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > REFERENCE_LIMITS.maxLines
  )
    throw new ReferenceError(
      "lyrics must contain 1–512 timed English lyric lines",
    );
  let previous = -1,
    count = 0;
  return value.map((raw: unknown) => {
    const line = record(raw, "lyric line");
    if (
      Object.keys(line).some(
        (key) =>
          !["start", "end", "text", "wordCenters", "timing"].includes(key),
      )
    )
      throw new ReferenceError("Unsupported lyric line fields");
    const start = numberIn(line.start, 0, duration, "lyric.start"),
      end = numberIn(line.end, 0, duration, "lyric.end");
    if (
      start < previous ||
      end - start < 0.12 ||
      end - start > REFERENCE_LIMITS.maxLineSeconds
    )
      throw new ReferenceError(
        "Lyric lines must be chronological, 0.12–20 seconds long and inside the source",
      );
    previous = start;
    if (
      typeof line.text !== "string" ||
      line.text.length > 1000 ||
      /[\x00-\x1f\x7f]/.test(line.text)
    )
      throw new ReferenceError("Each lyric line needs bounded plain text");
    const text = line.text.trim().replaceAll("’", "'");
    const words = lyricWords(text);
    count += words.length;
    if (!words.length || words.length > 64 || count > REFERENCE_LIMITS.maxWords)
      throw new ReferenceError(
        "Lyrics exceed the 64 words per line or 8192 words per reference budget",
      );
    let wordCenters: number[] | undefined;
    if (line.wordCenters !== undefined) {
      if (
        !Array.isArray(line.wordCenters) ||
        line.wordCenters.length !== words.length
      )
        throw new ReferenceError(
          "wordCenters must have one timestamp per lyric word",
        );
      wordCenters = line.wordCenters.map((time: unknown) =>
        numberIn(time, start, end, "word center"),
      );
      if (
        wordCenters.some(
          (time, index) => index > 0 && time <= wordCenters![index - 1]!,
        )
      )
        throw new ReferenceError("wordCenters must increase");
    }
    if (
      line.timing !== undefined &&
      !["supplied", "whisper-dtw", "segment-interpolation"].includes(
        String(line.timing),
      )
    )
      throw new ReferenceError("Invalid lyric timing evidence");
    return {
      start,
      end,
      text,
      ...(wordCenters ? { wordCenters } : {}),
      timing: (line.timing ?? "supplied") as ReferenceLyric["timing"],
    };
  });
}

/** Whisper's token DTW timestamps are centiseconds; segment offsets are ms. */
export function referenceLyricsFromWhisper(
  value: unknown,
  duration: number,
): ReferenceLyric[] {
  const input = record(value, "Whisper transcript");
  if (!Array.isArray(input.transcription) || input.transcription.length > 4000)
    throw new ReferenceError("Whisper returned no bounded transcript");
  const lines: ReferenceLyric[] = [];
  for (const raw of input.transcription) {
    const segment = record(raw, "Whisper segment");
    const offsets = record(segment.offsets, "Whisper offsets");
    const start = Math.max(0, Number(offsets.from) / 1000),
      end = Math.min(duration, Number(offsets.to) / 1000);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      typeof segment.text !== "string"
    )
      continue;
    const textWords = lyricWords(segment.text);
    if (!textWords.length) continue;
    const tokens = Array.isArray(segment.tokens)
      ? segment.tokens.slice(0, 16000)
      : [];
    const recognized: { word: string; time: number; weight: number }[] = [];
    for (const rawToken of tokens) {
      const token = record(rawToken, "Whisper token");
      if (typeof token.text !== "string" || token.text.startsWith("[_"))
        continue;
      const words = lyricWords(token.text),
        time = Number(token.t_dtw) / 100;
      if (
        words.length !== 1 ||
        !Number.isFinite(time) ||
        time < start ||
        time > end
      )
        continue;
      const previous = recognized.at(-1);
      if (!token.text.startsWith(" ") && previous) {
        const weight = words[0]!.length;
        previous.time =
          (previous.time * previous.weight + time * weight) /
          (previous.weight + weight);
        previous.weight += weight;
        previous.word += words[0];
      } else
        recognized.push({ word: words[0]!, time, weight: words[0]!.length });
    }
    const exact =
      recognized.map((word) => word.word).join(" ") === textWords.join(" ") &&
      recognized.every(
        (word, index) => index === 0 || word.time > recognized[index - 1]!.time,
      );
    const centers = exact
      ? recognized.map((word) => word.time)
      : textWords.map(
          (_, index) =>
            start + ((index + 0.5) * (end - start)) / textWords.length,
        );
    let first = 0;
    while (first < textWords.length) {
      let last = first + 1;
      while (
        last < textWords.length &&
        last - first < 48 &&
        centers[last]! - centers[first]! < 15
      )
        last++;
      const a =
        first === 0 ? start : (centers[first - 1]! + centers[first]!) / 2;
      const z =
        last === textWords.length
          ? end
          : (centers[last - 1]! + centers[last]!) / 2;
      if (z - a <= 20 && z - a >= 0.12)
        lines.push({
          start: a,
          end: z,
          text: textWords.slice(first, last).join(" "),
          wordCenters: centers.slice(first, last),
          timing: exact ? "whisper-dtw" : "segment-interpolation",
        });
      first = last;
    }
  }
  return parseReferenceLyrics(lines, duration);
}

export type ReferenceGrid = Readonly<{
  bpm: number;
  offsetSeconds: number;
  beats: readonly number[];
  intervalCv: number;
  linearResidualSeconds: number;
  driftSecondsPerMinute: number;
  evidence: string;
}>;
const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Preserve observed beat times; report how much a fixed tempo would drift. */
export function fitReferenceGrid(
  value: unknown,
  duration: number,
  bpmHint?: number,
): ReferenceGrid {
  let beats: number[];
  if (Array.isArray(value) && value.length >= 2 && value.length <= 10000) {
    beats = value.map((time: unknown) =>
      numberIn(time, 0, duration, "reference beat"),
    );
    if (beats.some((time, index) => index > 0 && time <= beats[index - 1]!))
      throw new ReferenceError("Reference beat times must increase");
  } else {
    const bpm = numberIn(bpmHint, 40, 300, "reference bpm hint");
    beats = Array.from(
      { length: Math.floor((duration * bpm) / 60) + 1 },
      (_, index) => (index * 60) / bpm,
    );
    if (beats.length < 2) beats.push(60 / bpm);
  }
  const intervals = beats.slice(1).map((time, index) => time - beats[index]!);
  const interval = median(intervals),
    bpm = 60 / interval;
  if (bpm < 40 || bpm > 300)
    throw new ReferenceError(
      "Reference tempo is outside 40–300 BPM; supply corrected beat evidence",
    );
  const offsetSeconds = median(
    beats.map((time, index) => time - index * interval),
  );
  const residuals = beats.map(
    (time, index) => time - offsetSeconds - index * interval,
  );
  const mean =
    intervals.reduce((sum, time) => sum + time, 0) / intervals.length;
  const intervalCv =
    Math.sqrt(
      intervals.reduce((sum, time) => sum + (time - mean) ** 2, 0) /
        intervals.length,
    ) / mean;
  const window = Math.max(1, Math.floor(intervals.length / 4));
  return {
    bpm,
    offsetSeconds,
    beats,
    intervalCv,
    linearResidualSeconds: Math.sqrt(
      residuals.reduce((sum, residual) => sum + residual ** 2, 0) /
        residuals.length,
    ),
    driftSecondsPerMinute:
      ((median(intervals.slice(-window)) - median(intervals.slice(0, window))) /
        interval) *
      60,
    evidence: Array.isArray(value)
      ? "detected beat times; bar origin is unverified"
      : "supplied tempo; beat phase and downbeat are unverified",
  };
}

export type ReferenceSection = Readonly<{
  label: string;
  start: number;
  end: number;
  similarity: number;
  evidence: string;
}>;
export function referenceSections(
  value: unknown,
  duration: number,
): ReferenceSection[] {
  if (!Array.isArray(value) || value.length > 600)
    throw new ReferenceError("Reference helper returned invalid form blocks");
  const prototypes: number[][] = [];
  return value.map((raw: unknown) => {
    const block = record(raw, "form block");
    const start = numberIn(block.start, 0, duration, "block.start"),
      end = numberIn(block.end, start, duration, "block.end");
    if (end <= start)
      throw new ReferenceError("Form blocks must have positive duration");
    if (!Array.isArray(block.features) || block.features.length !== 14)
      throw new ReferenceError("Invalid form feature vector");
    const features = block.features.map((feature: unknown) =>
      numberIn(feature, 0, 1, "form feature"),
    );
    const distances = prototypes.map((prototype) =>
      Math.sqrt(
        features.reduce(
          (sum, feature, index) => sum + (feature - prototype[index]!) ** 2,
          0,
        ) / features.length,
      ),
    );
    const nearest = distances.length ? Math.min(...distances) : 1;
    let label = distances.indexOf(nearest);
    if (nearest > 0.18 || label < 0) {
      label = prototypes.length;
      prototypes.push(features);
    }
    return {
      label: `section-${label + 1}`,
      start,
      end,
      similarity: Math.max(0, 1 - nearest),
      evidence:
        "four-bar energy/pitch-content similarity; section function is unverified",
    };
  });
}

export function parseReferenceNotes(
  value: unknown,
  duration: number,
): TimedNote[] {
  if (!Array.isArray(value) || value.length > 4096)
    throw new ReferenceError("Reference helper returned too many melody notes");
  return value.map((raw: unknown) => {
    const note = record(raw, "reference note");
    const startSeconds = numberIn(note.startSeconds, 0, duration, "note.start"),
      endSeconds = numberIn(
        note.endSeconds,
        startSeconds,
        duration,
        "note.end",
      );
    if (endSeconds <= startSeconds)
      throw new ReferenceError("Reference notes must have positive duration");
    return {
      startSeconds,
      endSeconds,
      pitch: Math.round(numberIn(note.pitch, 0, 127, "note.pitch")),
      velocity: numberIn(note.velocity, 0, 1, "note.velocity"),
      confidence: numberIn(note.confidence, 0, 1, "note.confidence"),
    };
  });
}
