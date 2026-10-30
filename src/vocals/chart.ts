import {
  chartScale,
  checkChart,
  type Chart,
} from "../../core/distill/hyperpop/chart/format.ts";
import { performChart } from "../../core/distill/hyperpop/chart/perform.ts";
import {
  VocalError,
  parseVocalBookSpec,
  type VocalBookSpec,
  type VocalPart,
} from "./spec.ts";

const FILLER = new Set([
  "a",
  "an",
  "and",
  "the",
  "to",
  "of",
  "in",
  "on",
  "my",
  "i",
  "it",
  "is",
  "at",
  "for",
  "as",
]);

/** Preserve the authored melody and register; stock singing is an audio realization. */
export function vocalBookForChart(chart: Chart): VocalBookSpec {
  const issues = checkChart(chart);
  if (issues.length)
    throw new VocalError(
      `Cannot sing this chart: ${issues.slice(0, 3).join("; ")}`,
    );
  const performed = performChart(chart);
  if (!performed.phrases.length)
    throw new VocalError(
      "The chart has no worded sung lines; write lyrics before requesting a vocal book",
    );
  const tonic = chartScale(chart).root;
  const root = tonic + 12 * Math.round((60 - tonic) / 12);
  const parts: VocalPart[] = performed.phrases.map((part) => [
    part.key,
    part.beats,
    part.notes.map(([beat, pitch, len, syl], index) => ({
      syl,
      beat,
      len,
      midi: pitch,
      ...(index === part.notes.length - 1 && len >= 1.2 ? { vib: 0.25 } : {}),
    })),
  ]);
  const reserved = new Set([
    ...parts.map(([name]) => name),
    "hold",
    "oh",
    "yeah",
  ]);
  const counts = new Map<string, number>();
  for (const section of chart.sections)
    for (const line of [
      ...(section.chops ?? []),
      ...(section.kind === "chorus" ? (section.sing ?? []) : []),
    ]) {
      const syls = (line.words ?? "")
        .split(/\s+/)
        .filter((word) => word && word !== "_");
      syls.forEach((word, index) => {
        if (word.endsWith("-") || syls[index - 1]?.endsWith("-")) return;
        word = word.toLowerCase().replace(/[^a-z']/g, "");
        if (
          /^[a-z]{2,}$/.test(word) &&
          !FILLER.has(word) &&
          !reserved.has(word)
        )
          counts.set(word, (counts.get(word) ?? 0) + 1);
      });
    }
  const words = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([word]) => word);
  const syllables = [...words, "oh", "yeah"];
  for (const word of syllables)
    parts.push([
      word,
      1,
      [{ syl: word, beat: 0, len: 0.7, midi: root, legato: false, gap: 0.05 }],
    ]);
  parts.push([
    "hold",
    4,
    [{ syl: "ooh", beat: 0, len: 3.8, midi: root, vib: 0.15 }],
  ]);
  return parseVocalBookSpec({
    voice: "bf_emma",
    bpm: chart.bpm,
    root,
    formant: 1,
    parts,
    syllables,
    lines: Object.fromEntries(
      performed.phrases.map((part) => [part.key, part.beats]),
    ),
    heads: performed.phrases
      .filter((part) => part.kind === "chorus")
      .slice(0, 3)
      .map((part) => part.key),
  });
}
