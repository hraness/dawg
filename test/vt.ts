/**
 * Minimal virtual terminal for tests.
 *
 * Interprets the subset of VT/xterm output dawg emits (printable graphemes,
 * CR/LF, CUP, ED, EL, SGR, DEC private modes) into a cell grid that records
 * each cell's character and SGR attributes.  Tests assert on what a user
 * would see rather than on escape-sequence strings.
 */

import { graphemes } from "../tui/text.ts";

export interface VtStyle {
  fg?: string | undefined;
  bg?: string | undefined;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  reverse?: boolean;
}

export interface VtCell {
  ch: string;
  style: VtStyle;
}

export class VirtualTerminal {
  cols: number;
  rows: number;
  cells: VtCell[][] = [];
  cursorX = 0;
  cursorY = 0;
  cursorVisible = true;
  altScreen = false;
  bracketedPaste = false;
  /** DEC mouse modes on (1000 clicks, 1002 drags, 1006 SGR). */
  mouseModes = new Set<string>();
  private style: VtStyle = {};
  private pending = "";

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.clear();
  }

  resize(cols: number, rows: number): void {
    const old = this.cells;
    this.cols = cols;
    this.rows = rows;
    this.clear();
    for (let y = 0; y < Math.min(rows, old.length); y += 1)
      for (let x = 0; x < Math.min(cols, old[y]!.length); x += 1)
        this.cells[y]![x] = old[y]![x]!;
    this.cursorX = Math.min(this.cursorX, cols - 1);
    this.cursorY = Math.min(this.cursorY, rows - 1);
  }

  private blank(): VtCell {
    return { ch: " ", style: { ...this.style } };
  }

  private clear(): void {
    this.cells = Array.from({ length: this.rows }, () =>
      Array.from({ length: this.cols }, () => ({ ch: " ", style: {} })),
    );
  }

  write(data: string): void {
    let input = this.pending + data;
    this.pending = "";
    let text = "";
    const flushText = () => {
      if (text) this.print(text);
      text = "";
    };
    while (input.length > 0) {
      const ch = input[0]!;
      if (ch === "\u001b") {
        flushText();
        const match = input.match(
          /^\u001b\[([0-9;?]*)([\x20-\x2f]*)([\x40-\x7e])/,
        );
        if (!match) {
          if (/^\u001b(\[[0-9;?]*)?$/.test(input)) {
            this.pending = input;
            return;
          }
          // Unknown two-byte escape: skip it.
          input = input.slice(2);
          continue;
        }
        this.csi(match[1]!, match[3]!);
        input = input.slice(match[0].length);
        continue;
      }
      if (ch === "\r") {
        flushText();
        this.cursorX = 0;
      } else if (ch === "\n") {
        flushText();
        this.lineFeed();
      } else if (ch === "\b") {
        flushText();
        this.cursorX = Math.max(0, this.cursorX - 1);
      } else if (ch.charCodeAt(0) >= 0x20) text += ch;
      input = input.slice(1);
    }
    flushText();
  }

  private lineFeed(): void {
    if (this.cursorY < this.rows - 1) this.cursorY += 1;
    else {
      this.cells.shift();
      this.cells.push(Array.from({ length: this.cols }, () => this.blank()));
    }
  }

  private print(text: string): void {
    for (const g of graphemes(text)) {
      if (this.cursorX + g.width > this.cols) {
        this.cursorX = 0;
        this.lineFeed();
      }
      const row = this.cells[this.cursorY]!;
      row[this.cursorX] = { ch: g.text, style: { ...this.style } };
      for (let i = 1; i < g.width; i += 1)
        row[this.cursorX + i] = { ch: "", style: { ...this.style } };
      this.cursorX += g.width;
      if (this.cursorX >= this.cols) this.cursorX = this.cols; // pending wrap
    }
  }

  private csi(params: string, final: string): void {
    if (params.startsWith("?")) {
      const on = final === "h";
      for (const mode of params.slice(1).split(";")) {
        if (mode === "25") this.cursorVisible = on;
        if (mode === "1049") {
          this.altScreen = on;
          this.clear();
        }
        if (mode === "2004") this.bracketedPaste = on;
        if (mode === "1000" || mode === "1002" || mode === "1006") {
          if (on) this.mouseModes.add(mode);
          else this.mouseModes.delete(mode);
        }
      }
      return;
    }
    const nums = params.split(";").map((value) => Number(value || "0"));
    switch (final) {
      case "H":
      case "f":
        this.cursorY = Math.min(this.rows - 1, Math.max(0, (nums[0] || 1) - 1));
        this.cursorX = Math.min(this.cols - 1, Math.max(0, (nums[1] || 1) - 1));
        break;
      case "J":
        if (nums[0] === 2 || nums[0] === 3) this.clear();
        break;
      case "K": {
        const row = this.cells[this.cursorY]!;
        for (let x = this.cursorX; x < this.cols; x += 1) row[x] = this.blank();
        break;
      }
      case "m":
        this.sgr(nums);
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
      else if (n === 27) this.style.reverse = false;
      else if (n === 39) this.style.fg = undefined;
      else if (n === 49) this.style.bg = undefined;
      else if (n === 38 || n === 48) {
        const key = n === 38 ? "fg" : "bg";
        if (nums[i + 1] === 2) {
          this.style[key] = `rgb(${nums[i + 2]},${nums[i + 3]},${nums[i + 4]})`;
          i += 4;
        } else if (nums[i + 1] === 5) {
          this.style[key] = `256:${nums[i + 2]}`;
          i += 2;
        }
      } else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97))
        this.style.fg = `16:${n}`;
      else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107))
        this.style.bg = `16:${n}`;
    }
  }

  /** Screen text, one string per row, trailing spaces trimmed. */
  lines(): string[] {
    return this.cells.map((row) =>
      row
        .map((cell) => cell.ch)
        .join("")
        .replace(/\s+$/, ""),
    );
  }

  text(): string {
    return this.lines().join("\n");
  }

  cell(x: number, y: number): VtCell {
    return this.cells[y]![x]!;
  }

  /** Find the first row containing `needle`. */
  findRow(needle: string): number {
    return this.lines().findIndex((line) => line.includes(needle));
  }
}
