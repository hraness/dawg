/**
 * One vocabulary matcher for every "did you mean" in dawg: instruments,
 * effects, styles, kits, rigs, sections, presets, params and verbs.
 */

/**
 * Optimal-string-alignment distance: insert, delete, substitute, and an
 * adjacent swap (`/hlep` → `/help`) each cost one edit.
 */
export function editDistance(a: string, b: string): number {
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        previous[j]! + 1,
        row[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, before[j - 2]! + 1);
      row.push(best);
    }
    before = previous;
    previous = row;
  }
  return previous[b.length]!;
}

/**
 * The word in `vocabulary` nearest to `word` (edit distance, adjacent swaps
 * cost one), within one edit for words of four letters or fewer and two
 * otherwise; undefined when nothing is that close or `word` is itself in it.
 */
export function nearest(
  word: string,
  vocabulary: Iterable<string>,
): string | undefined {
  const typed = word.trim().toLowerCase();
  if (!typed) return undefined;
  const limit = typed.length <= 4 ? 1 : 2;
  let best: { word: string; distance: number } | undefined;
  for (const candidate of vocabulary) {
    const lower = candidate.toLowerCase();
    if (lower === typed) return undefined;
    const distance = editDistance(typed, lower);
    if (distance <= limit && (!best || distance < best.distance))
      best = { word: candidate, distance };
  }
  return best?.word;
}
