/**
 * Retained cell buffer and differential screen writer.
 *
 * Components paint into a `CellBuffer` with semantic `Style` objects.  The
 * `ScreenWriter` keeps the previously emitted buffer and only rewrites rows
 * whose cells changed, so an idle highway costs a handful of bytes per frame
 * and a slow terminal never sees a full-screen flood.
 */

import { graphemes, graphemeWidth } from "./text.ts";
import {
  foregroundSgr,
  styleSgr,
  type Style,
  type TerminalCapabilities,
} from "./theme.ts";

export interface Cell {
  /** Grapheme text; "" marks the trailing half of a wide character. */
  ch: string;
  style: Style | undefined;
}

const EMPTY: Style = {};
/** Unchanged cells that split a row into two writes (a CUP is ~8 bytes). */
const SPAN_GAP = 6;

export class CellBuffer {
  readonly width: number;
  readonly height: number;
  private readonly cells: Cell[];

  constructor(width: number, height: number, fill: Style = EMPTY) {
    this.width = Math.max(0, Math.floor(width));
    this.height = Math.max(0, Math.floor(height));
    const count = this.width * this.height;
    this.cells = new Array<Cell>(count);
    for (let index = 0; index < count; index += 1)
      this.cells[index] = { ch: " ", style: fill };
  }

  get(x: number, y: number): Cell | undefined {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return undefined;
    return this.cells[y * this.width + x];
  }

  /** Set one single-width cell, repairing any wide character it overlaps. */
  set(x: number, y: number, ch: string, style: Style | undefined): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.clearWide(x, y);
    const cell = this.cells[y * this.width + x]!;
    cell.ch = ch;
    cell.style = style;
  }

  /** Change only the style of a cell (used for glows and backgrounds). */
  restyle(x: number, y: number, style: Style | undefined): void {
    const cell = this.get(x, y);
    if (cell) cell.style = style;
  }

  fill(
    x: number,
    y: number,
    width: number,
    height: number,
    style: Style | undefined,
    ch = " ",
  ): void {
    for (let row = y; row < y + height; row += 1)
      for (let column = x; column < x + width; column += 1)
        this.set(column, row, ch, style);
  }

  /**
   * Write text starting at (x, y), clipped to `maxWidth` cells.  Wide
   * graphemes occupy two cells; one that would straddle the clip edge is
   * replaced by a space so columns never shift.  Returns cells written.
   */
  text(
    x: number,
    y: number,
    value: string,
    style: Style | undefined,
    maxWidth = this.width - x,
  ): number {
    let column = x;
    const limit = Math.min(this.width, x + Math.max(0, maxWidth));
    for (const cluster of graphemes(value)) {
      if (cluster.width === 0) continue;
      if (column + cluster.width > limit) {
        if (cluster.width === 2 && column < limit)
          this.set(column, y, " ", style);
        break;
      }
      this.set(column, y, cluster.text, style);
      if (cluster.width === 2) {
        this.set(column + 1, y, "", style);
      }
      column += cluster.width;
    }
    return column - x;
  }

  /** Plain text rows (wide-character continuations omitted). */
  lines(): string[] {
    const rows: string[] = [];
    for (let y = 0; y < this.height; y += 1) {
      let row = "";
      for (let x = 0; x < this.width; x += 1)
        row += this.cells[y * this.width + x]!.ch;
      rows.push(row);
    }
    return rows;
  }

  /**
   * The columns `[from, to)` of row `y` that differ from `other`, widened so
   * neither edge splits a wide character, or undefined when the row matches.
   */
  rowSpan(
    other: CellBuffer,
    y: number,
  ): Readonly<{ from: number; to: number }> | undefined {
    if (other.width !== this.width) return { from: 0, to: this.width };
    const offset = y * this.width;
    const differs = (x: number) => {
      const left = this.cells[offset + x]!;
      const right = other.cells[offset + x]!;
      if (left.ch !== right.ch) return true;
      // Two blanks look the same whatever their foreground.
      if (isBlank(left) && isBlank(right)) return false;
      return !sameStyle(left.style, right.style);
    };
    let from = 0;
    while (from < this.width && !differs(from)) from += 1;
    if (from === this.width) return undefined;
    let to = this.width;
    while (to > from && !differs(to - 1)) to -= 1;
    // A continuation cell ("") belongs to the wide character on its left.
    while (from > 0 && this.cells[offset + from]!.ch === "") from -= 1;
    while (to < this.width && this.cells[offset + to]!.ch === "") to += 1;
    return { from, to };
  }

  /**
   * The changed runs of row `y`, split wherever at least `gap` unchanged
   * cells separate them (a cursor move is cheaper than repainting those),
   * each widened so no edge splits a wide character.
   */
  rowSpans(
    other: CellBuffer,
    y: number,
    gap = SPAN_GAP,
  ): Array<{ from: number; to: number }> {
    const whole = this.rowSpan(other, y);
    if (!whole) return [];
    if (other.width !== this.width) return [whole];
    const offset = y * this.width;
    const spans: Array<{ from: number; to: number }> = [];
    let start = -1;
    let lastDiff = -1;
    for (let x = whole.from; x < whole.to; x += 1) {
      const left = this.cells[offset + x]!;
      const right = other.cells[offset + x]!;
      const changed =
        left.ch !== right.ch ||
        (!(isBlank(left) && isBlank(right)) &&
          !sameStyle(left.style, right.style));
      if (!changed) continue;
      if (start < 0) start = x;
      else if (x - lastDiff - 1 >= gap) {
        spans.push({ from: start, to: lastDiff + 1 });
        start = x;
      }
      lastDiff = x;
    }
    if (start >= 0) spans.push({ from: start, to: lastDiff + 1 });
    for (const span of spans) {
      while (span.from > 0 && this.cells[offset + span.from]!.ch === "")
        span.from -= 1;
      while (span.to < this.width && this.cells[offset + span.to]!.ch === "")
        span.to += 1;
    }
    return spans;
  }

  rowEquals(other: CellBuffer, y: number): boolean {
    if (other.width !== this.width) return false;
    const offset = y * this.width;
    for (let x = 0; x < this.width; x += 1) {
      const left = this.cells[offset + x]!;
      const right = other.cells[offset + x]!;
      if (left.ch !== right.ch || !sameStyle(left.style, right.style))
        return false;
    }
    return true;
  }

  private clearWide(x: number, y: number): void {
    const offset = y * this.width;
    const cell = this.cells[offset + x]!;
    // Fast path: one UTF-16 unit below U+1100 is never wide (nor a wide
    // character's empty trail), and it is nearly every cell of a frame.
    if (cell.ch.length === 1 && cell.ch.charCodeAt(0) < 0x1100) return;
    if (cell.ch === "" && x > 0) {
      const lead = this.cells[offset + x - 1]!;
      if (graphemeWidth(lead.ch) === 2) lead.ch = " ";
    } else if (graphemeWidth(cell.ch) === 2 && x + 1 < this.width) {
      const trail = this.cells[offset + x + 1]!;
      if (trail.ch === "") trail.ch = " ";
    }
  }
}

export function sameStyle(
  left: Style | undefined,
  right: Style | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.bold === right.bold &&
    left.dim === right.dim &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.reverse === right.reverse &&
    sameColor(left.fg, right.fg) &&
    sameColor(left.bg, right.bg)
  );
}

function sameColor(left: Style["fg"], right: Style["fg"]): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.r === right.r && left.g === right.g && left.b === right.b;
}

/** True when only the foreground could differ and none of it shows. */
function invisibleStyle(style: Style | undefined): boolean {
  return !style || (!style.bg && !style.reverse && !style.underline);
}

/** A space whose style draws nothing: its foreground never shows. */
export function isBlank(cell: Cell): boolean {
  return cell.ch === " " && invisibleStyle(cell.style);
}

/**
 * Serialise one row with minimal SGR changes: a blank keeps the current
 * colour instead of resetting, and a colour-only change writes just the
 * foreground code. Playback rows are mostly dim rules between spaces, so
 * this halves the bytes a frame costs.
 */
export function encodeRow(
  buffer: CellBuffer,
  y: number,
  capabilities: TerminalCapabilities,
  from = 0,
  to = buffer.width,
): string {
  return encodeSpans(buffer, y, capabilities, [{ from, to }], false);
}

/**
 * Serialise several runs of one row; each run after the first (or every
 * run, with `address`) starts with a cursor move. The colour state carries
 * across runs, since a cursor move leaves it alone.
 */
export function encodeSpans(
  buffer: CellBuffer,
  y: number,
  capabilities: TerminalCapabilities,
  spans: ReadonlyArray<{ from: number; to: number }>,
  address = true,
): string {
  let out = "";
  let current: Style | undefined | null = null;
  for (const [index, span] of spans.entries()) {
    if (address || index > 0) out += `\u001b[${y + 1};${span.from + 1}H`;
    for (let x = span.from; x < span.to; x += 1) {
      const cell = buffer.get(x, y)!;
      if (cell.ch === "") continue;
      if (current !== null && isBlank(cell) && invisibleStyle(current)) {
        out += " ";
        continue;
      }
      if (current === null || !sameStyle(current, cell.style)) {
        const next = cell.style ?? EMPTY;
        out +=
          (current !== null &&
            foregroundSgr(current ?? EMPTY, next, capabilities)) ||
          styleSgr(next, capabilities);
        current = cell.style;
      }
      out += cell.ch;
    }
  }
  if (capabilities.attributes !== false) out += "\u001b[0m";
  return out;
}

/** Render a buffer as plain-or-styled text lines (for demo and snapshots). */
export function encodeBuffer(
  buffer: CellBuffer,
  capabilities: TerminalCapabilities,
): string {
  const rows: string[] = [];
  for (let y = 0; y < buffer.height; y += 1)
    rows.push(encodeRow(buffer, y, capabilities));
  return rows.join("\n");
}

export interface CursorPosition {
  x: number;
  y: number;
}

/**
 * Differential writer: emits one cursor-addressed rewrite per changed row,
 * covering only that row's changed run of cells. Each frame is one string
 * wrapped in synchronized-update markers, which capable terminals use to
 * avoid tearing and others ignore.
 */
export class ScreenWriter {
  private previous: CellBuffer | undefined;
  private lastCursor: string | undefined;
  /** Bytes emitted by the last `frame` call; used by tests and diagnostics. */
  lastBytes = 0;
  /** Rows rewritten by the last `frame` call. */
  lastRows = 0;

  constructor(private capabilities: TerminalCapabilities) {}

  setCapabilities(capabilities: TerminalCapabilities): void {
    this.capabilities = capabilities;
    this.invalidate();
  }

  /** Force the next frame to repaint every row (resize, theme change). */
  invalidate(): void {
    this.previous = undefined;
    this.lastCursor = undefined;
  }

  frame(buffer: CellBuffer, cursor?: CursorPosition): string {
    const full =
      !this.previous ||
      this.previous.width !== buffer.width ||
      this.previous.height !== buffer.height;
    let body = "";
    let rows = 0;
    if (full) body += "\u001b[0m\u001b[2J";
    for (let y = 0; y < buffer.height; y += 1) {
      if (full) {
        body += `\u001b[${y + 1};1H${encodeRow(buffer, y, this.capabilities)}`;
        rows += 1;
        continue;
      }
      // Only the changed run of cells: a moving playhead or a ticking meter
      // rewrites a few columns, not the whole row.
      const spans = buffer.rowSpans(this.previous!, y);
      if (spans.length === 0) continue;
      body += encodeSpans(buffer, y, this.capabilities, spans);
      rows += 1;
    }
    const cursorKey = cursor ? `${cursor.x},${cursor.y}` : "hidden";
    let out = "";
    if (rows > 0 || cursorKey !== this.lastCursor) {
      out = `\u001b[?2026h\u001b[?25l${body}`;
      if (cursor) out += `\u001b[${cursor.y + 1};${cursor.x + 1}H\u001b[?25h`;
      out += "\u001b[?2026l";
    }
    this.previous = buffer;
    this.lastCursor = cursorKey;
    this.lastBytes = out.length;
    this.lastRows = rows;
    return out;
  }
}
