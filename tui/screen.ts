/**
 * Retained cell buffer and differential screen writer.
 *
 * Components paint into a `CellBuffer` with semantic `Style` objects.  The
 * `ScreenWriter` keeps the previously emitted buffer and only rewrites rows
 * whose cells changed, so an idle highway costs a handful of bytes per frame
 * and a slow terminal never sees a full-screen flood.
 */

import { graphemes, graphemeWidth } from "./text.ts";
import { styleSgr, type Style, type TerminalCapabilities } from "./theme.ts";

export interface Cell {
  /** Grapheme text; "" marks the trailing half of a wide character. */
  ch: string;
  style: Style | undefined;
}

const EMPTY: Style = {};

export class CellBuffer {
  readonly width: number;
  readonly height: number;
  private readonly cells: Cell[];

  constructor(width: number, height: number, fill: Style = EMPTY) {
    this.width = Math.max(0, Math.floor(width));
    this.height = Math.max(0, Math.floor(height));
    this.cells = Array.from({ length: this.width * this.height }, () => ({
      ch: " ",
      style: fill,
    }));
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

/** Serialise one row with minimal SGR changes. */
export function encodeRow(
  buffer: CellBuffer,
  y: number,
  capabilities: TerminalCapabilities,
): string {
  let out = "";
  let current: Style | undefined | null = null;
  for (let x = 0; x < buffer.width; x += 1) {
    const cell = buffer.get(x, y)!;
    if (cell.ch === "") continue;
    if (current === null || !sameStyle(current, cell.style)) {
      out += styleSgr(cell.style ?? EMPTY, capabilities);
      current = cell.style;
    }
    out += cell.ch;
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
 * Differential writer: emits cursor-addressed rewrites for changed rows only.
 * Output is wrapped in synchronized-update markers, which capable terminals
 * use to avoid tearing and others ignore.
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
      if (!full && this.previous!.rowEquals(buffer, y)) continue;
      body += `\u001b[${y + 1};1H${encodeRow(buffer, y, this.capabilities)}`;
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
