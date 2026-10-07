/**
 * Key estimation from a 12-bin pitch-class histogram. Shared by session
 * auto-naming (`src/session/naming.ts`) and audio analysis
 * (`src/media/analyze.ts`), so both agree on what "a minor" means.
 */
export const KEY_NOTE_NAMES = [
  "c",
  "c#",
  "d",
  "eb",
  "e",
  "f",
  "f#",
  "g",
  "ab",
  "a",
  "bb",
  "b",
] as const;
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** Best-fitting major or minor scale for a pitch-class histogram, or null. */
export function estimateKey(histogram: readonly number[]): string | null {
  if (histogram.length < 12) return null;
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  let best: { key: string; score: number } | undefined;
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const [mode, scale] of [
      ["major", MAJOR],
      ["minor", MINOR],
    ] as const) {
      let fit = 0;
      for (const step of scale) fit += histogram[(tonic + step) % 12]!;
      // Tonic and fifth weigh extra so relative keys separate.
      fit += histogram[tonic]! * 0.75 + histogram[(tonic + 7) % 12]! * 0.25;
      if (!best || fit > best.score + 1e-9)
        best = { key: `${KEY_NOTE_NAMES[tonic]} ${mode}`, score: fit };
    }
  }
  return best!.key;
}
