import {
  cellStyleText,
  type ScreenRow,
  type ScreenStyle,
} from "./screen-style";

/**
 * An animated screen as committed in ../docs/screens/frames/<id>.json:
 * styles shared by all frames, then each frame's clock time in ms and only
 * the rows that changed since the frame before. The last frame is the still
 * in ../docs/screens/<id>.json.
 */
export interface FramesFile {
  readonly id: string;
  readonly cols: number;
  readonly rows: number;
  readonly styles: readonly ScreenStyle[];
  readonly frames: readonly {
    readonly t: number;
    readonly rows: readonly (readonly [number, ScreenRow])[];
  }[];
}

/** A frame ready to paint: every row's inner HTML, and its time. */
export interface PaintFrame {
  readonly t: number;
  readonly rows: readonly string[];
}

const escapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeText(text: string): string {
  return text.replace(/[&<>]/gu, (ch) => escapes[ch]!);
}

/**
 * Expands the row deltas into whole frames of row HTML, matching the markup
 * the server renders for the still: one span per run, a newline at the end.
 */
export function paintFrames(file: FramesFile): PaintFrame[] {
  const css = file.styles.map((style) => cellStyleText(style));
  const current: string[] = Array.from({ length: file.rows }, () => "\n");
  return file.frames.map((frame) => {
    for (const [y, runs] of frame.rows)
      current[y] =
        runs
          .map(([text, style]) => {
            const value = css[style] ?? "";
            return value
              ? `<span style="${value}">${escapeText(text)}</span>`
              : `<span>${escapeText(text)}</span>`;
          })
          .join("") + "\n";
    return { t: frame.t, rows: [...current] };
  });
}

/** How long frame `i` stays up before the next one, in ms. */
export function frameDelay(
  frames: readonly PaintFrame[],
  i: number,
  pace: number,
  hold: number,
): number {
  const next = frames[i + 1];
  if (next === undefined) return hold;
  return Math.max(next.t - frames[i]!.t, pace);
}
