/**
 * A small virtual terminal for replaying dawg's recorded highway.
 *
 * It interprets the subset of VT/xterm output dawg's renderer emits: printable
 * text, CR/LF, cursor position (CUP), erase in display and line (ED, EL),
 * SGR with truecolor, and DEC private modes, which it ignores. Every glyph in
 * the recording is one cell wide, so a code point is one cell.
 * `tests/vt.test.ts` replays the whole recording through this and through the
 * repo's own test terminal (`test/vt.ts`) and requires the same screen at
 * every frame.
 */

export interface CellStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  reverse?: boolean;
}

export interface Cell {
  ch: string;
  style: CellStyle;
}

export interface CastHeader {
  width: number;
  height: number;
  title?: string;
}

export interface CastFrame {
  time: number;
  data: string;
}

export interface Cast {
  header: CastHeader;
  frames: CastFrame[];
}

/** Parses an asciinema v2 cast, keeping only output events. */
export function parseCast(text: string): Cast {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const first = lines.shift();
  if (first === undefined) throw new Error("empty cast");
  const header: unknown = JSON.parse(first);
  if (typeof header !== "object" || header === null)
    throw new Error("bad cast header");
  const { width, height, title } = header as Record<string, unknown>;
  if (typeof width !== "number" || typeof height !== "number")
    throw new Error("cast header needs width and height");
  const frames: CastFrame[] = [];
  for (const line of lines) {
    const event: unknown = JSON.parse(line);
    if (!Array.isArray(event) || event[1] !== "o") continue;
    const [time, , data] = event as [unknown, unknown, unknown];
    if (typeof time === "number" && typeof data === "string")
      frames.push({ time, data });
  }
  return {
    header: { width, height, ...(typeof title === "string" ? { title } : {}) },
    frames,
  };
}

export class Screen {
  readonly cols: number;
  readonly rows: number;
  cells: Cell[][] = [];
  private x = 0;
  private y = 0;
  private style: CellStyle = {};

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.cells = Array.from({ length: rows }, () => this.blankRow());
  }

  private blank(): Cell {
    return { ch: " ", style: { ...this.style } };
  }

  private blankRow(): Cell[] {
    return Array.from({ length: this.cols }, () => this.blank());
  }

  write(data: string): void {
    let i = 0;
    while (i < data.length) {
      const c = data[i]!;
      if (c === "\x1b") {
        if (data[i + 1] === "[") {
          let j = i + 2;
          while (j < data.length && !/[@-~]/.test(data[j]!)) j += 1;
          this.csi(data.slice(i + 2, j), data[j] ?? "");
          i = j + 1;
        } else {
          i += 2;
        }
        continue;
      }
      if (c === "\r") this.x = 0;
      else if (c === "\n") this.lineFeed();
      else if (c >= " ") {
        const cp = data.codePointAt(i)!;
        const ch = String.fromCodePoint(cp);
        this.print(ch);
        i += ch.length;
        continue;
      }
      i += 1;
    }
  }

  private lineFeed(): void {
    if (this.y < this.rows - 1) {
      this.y += 1;
      return;
    }
    this.cells.shift();
    this.cells.push(this.blankRow());
  }

  private print(ch: string): void {
    if (this.x >= this.cols) {
      this.x = 0;
      this.lineFeed();
    }
    this.cells[this.y]![this.x] = { ch, style: { ...this.style } };
    this.x += 1;
  }

  private csi(params: string, final: string): void {
    if (params.startsWith("?")) return;
    const nums =
      params === ""
        ? []
        : params.split(";").map((n) => (n === "" ? 0 : Number(n)));
    switch (final) {
      case "H":
      case "f":
        this.y = Math.min(this.rows - 1, Math.max(0, (nums[0] || 1) - 1));
        this.x = Math.min(this.cols - 1, Math.max(0, (nums[1] || 1) - 1));
        break;
      case "J": {
        const mode = nums[0] ?? 0;
        if (mode === 2 || mode === 3) {
          this.cells = Array.from({ length: this.rows }, () => this.blankRow());
        } else if (mode === 0) {
          for (let x = this.x; x < this.cols; x += 1)
            this.cells[this.y]![x] = this.blank();
          for (let y = this.y + 1; y < this.rows; y += 1)
            this.cells[y] = this.blankRow();
        }
        break;
      }
      case "K": {
        const mode = nums[0] ?? 0;
        const row = this.cells[this.y]!;
        const [from, to] =
          mode === 1
            ? [0, this.x + 1]
            : mode === 2
              ? [0, this.cols]
              : [this.x, this.cols];
        for (let x = from; x < to; x += 1) row[x] = this.blank();
        break;
      }
      case "m":
        this.sgr(nums.length === 0 ? [0] : nums);
        break;
      default:
        break;
    }
  }

  private sgr(nums: number[]): void {
    for (let i = 0; i < nums.length; i += 1) {
      const n = nums[i]!;
      if (n === 0) this.style = {};
      else if (n === 1) this.style.bold = true;
      else if (n === 2) this.style.dim = true;
      else if (n === 3) this.style.italic = true;
      else if (n === 4) this.style.underline = true;
      else if (n === 7) this.style.reverse = true;
      else if (n === 22) this.style.bold = this.style.dim = false;
      else if (n === 23) this.style.italic = false;
      else if (n === 24) this.style.underline = false;
      else if (n === 27) this.style.reverse = false;
      else if (n === 39) delete this.style.fg;
      else if (n === 49) delete this.style.bg;
      else if (n === 38 || n === 48) {
        const key = n === 38 ? "fg" : "bg";
        if (nums[i + 1] === 2) {
          this.style[key] = `rgb(${nums[i + 2]},${nums[i + 3]},${nums[i + 4]})`;
          i += 4;
        } else if (nums[i + 1] === 5) {
          i += 2;
        }
      }
    }
  }

  /** Screen text, one string per row, trailing spaces trimmed. */
  lines(): string[] {
    return this.cells.map((row) =>
      row
        .map((cell) => cell.ch)
        .join("")
        .replace(/\s+$/u, ""),
    );
  }
}

/** Index of the last frame at or before `time`, or -1. */
export function frameAt(frames: readonly CastFrame[], time: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.time <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The screen after replaying every frame up to and including `index`. */
export function screenAt(cast: Cast, index: number): Screen {
  const screen = new Screen(cast.header.width, cast.header.height);
  for (let i = 0; i <= index && i < cast.frames.length; i += 1)
    screen.write(cast.frames[i]!.data);
  return screen;
}

/** Foreground and background a cell paints with, after reverse video. */
export function cellColors(
  style: CellStyle,
  defaults: { fg: string; bg: string },
): { fg: string; bg: string } {
  const fg = style.fg ?? defaults.fg;
  const bg = style.bg ?? defaults.bg;
  return style.reverse ? { fg: bg, bg: fg } : { fg, bg };
}
