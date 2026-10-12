/** Shared, dependency-free ranking for small interactive command catalogs. */

const BOUNDARY = /[\s\-_.:/›]/;

function normalize(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** A higher score is a closer match; zero means the term does not match. */
function termScore(term: string, text: string): number {
  if (!text) return 0;
  if (text === term) return 1200;
  if (text.startsWith(term)) return 900;
  const at = text.indexOf(term);
  if (at >= 0)
    return (BOUNDARY.test(text[at - 1]!) ? 650 : 450) - Math.min(at, 100);

  // Subsequence matching makes "dphs" find "deep house". Consecutive
  // letters and word starts outrank letters scattered through a sentence.
  let cursor = 0;
  let previous = -1;
  let first = -1;
  let bonus = 0;
  for (const char of term) {
    const index = text.indexOf(char, cursor);
    if (index < 0) return 0;
    if (first < 0) first = index;
    if (previous >= 0 && index === previous + 1) bonus += 16;
    if (index === 0 || BOUNDARY.test(text[index - 1]!)) bonus += 24;
    previous = index;
    cursor = index + char.length;
  }
  const gaps = cursor - first - term.length;
  return Math.max(1, 180 + bonus - gaps * 3 - Math.min(first, 80));
}

/**
 * Match every query word, in any order, against a name and optional detail.
 * Names get four times the weight of descriptions. Exact names, prefixes,
 * word boundaries, substrings, then subsequences rank in that order. An
 * empty query keeps every item (score 1); callers preserve source-order ties.
 * Inputs are bounded so a pasted query or a long description cannot turn a
 * keystroke into unbounded work. No timers, I/O, or edit distance matrix.
 */
export function fuzzyScore(
  query: string,
  primary: string,
  secondary = "",
): number {
  const needle = normalize(query.slice(0, 160));
  if (!needle) return 1;
  const name = normalize(primary.slice(0, 2048));
  const detail = normalize(secondary.slice(0, 4096));
  const terms = needle.split(/\s+/).slice(0, 16);
  let total = 0;
  for (const term of terms) {
    const score = Math.max(termScore(term, name) * 4, termScore(term, detail));
    if (!score) return 0;
    total += score;
  }
  return (
    total / terms.length +
    (name === needle ? 1200 : name.startsWith(needle) ? 400 : 0)
  );
}
