/**
 * Grapheme and display-width helpers shared by the prompt editor and the cell
 * buffer.  Offsets exposed to callers stay in Unicode code points so the prompt
 * model's cursor contract does not change; widths are terminal cells.
 */

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

export interface Grapheme {
  /** The grapheme cluster text. */
  text: string;
  /** Offset of the cluster in code points. */
  start: number;
  /** Number of code points in the cluster. */
  length: number;
  /** Display width in terminal cells (0, 1, or 2). */
  width: number;
}

export function graphemeWidth(cluster: string): number {
  if (cluster.length === 0) return 0;
  if (cluster === "\t") return 1;
  const code = cluster.codePointAt(0) ?? 0;
  // Control characters never reach the screen as glyphs.
  if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return 0;
  const width = Bun.stringWidth(cluster, { ambiguousIsNarrow: true });
  return Math.max(0, Math.min(2, width));
}

/** Printable ASCII only: one cell per character, no segmentation needed. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/**
 * Recent segmentations. A frame paints the same strings every tick (help
 * rows, labels, hints), and segmenting them is most of a large frame's
 * cost; the cache holds a frame's worth and is dropped whole when full.
 */
const segmented = new Map<string, readonly Grapheme[]>();
const SEGMENTED_MAX = 4096;

/**
 * Segment text into grapheme clusters with code-point offsets and widths.
 * The result is shared between calls: read it, never mutate it.
 */
export function graphemes(text: string): readonly Grapheme[] {
  const cached = segmented.get(text);
  if (cached) return cached;
  const result = segment(text);
  if (segmented.size >= SEGMENTED_MAX) segmented.clear();
  segmented.set(text, result);
  return result;
}

function segment(text: string): Grapheme[] {
  const result: Grapheme[] = [];
  if (PRINTABLE_ASCII.test(text)) {
    for (let index = 0; index < text.length; index += 1)
      result.push({ text: text[index]!, start: index, length: 1, width: 1 });
    return result;
  }
  let start = 0;
  const clusters = segmenter
    ? Array.from(segmenter.segment(text), (part) => part.segment)
    : Array.from(text);
  for (const cluster of clusters) {
    const length = Array.from(cluster).length;
    result.push({
      text: cluster,
      start,
      length,
      width: graphemeWidth(cluster),
    });
    start += length;
  }
  return result;
}

export function displayWidth(text: string): number {
  if (PRINTABLE_ASCII.test(text)) return text.length;
  let width = 0;
  for (const cluster of graphemes(text)) width += cluster.width;
  return width;
}

/** Truncate to a display width, appending an ellipsis when content is cut. */
export function truncate(text: string, width: number, ellipsis = "…"): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  const room = Math.max(0, width - displayWidth(ellipsis));
  if (PRINTABLE_ASCII.test(text))
    return room === 0
      ? ellipsis.slice(0, width)
      : `${text.slice(0, room)}${ellipsis}`;
  let used = 0;
  let out = "";
  for (const cluster of graphemes(text)) {
    if (used + cluster.width > room) break;
    out += cluster.text;
    used += cluster.width;
  }
  return room === 0 ? ellipsis.slice(0, width) : `${out}${ellipsis}`;
}
