import { cellColors, type Screen } from "./vt";

/** The terminal's own colors: the TUI's default theme panel. */
export const TERMINAL = {
  fg: "rgb(225,231,239)",
  bg: "rgb(24,28,37)",
} as const;

export const CELL_W = 10;
export const CELL_H = 20;
const FONT =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * Glyphs drawn as geometry instead of text, so the highway's lanes and note
 * blocks meet edge to edge at any size, whatever monospace font is installed.
 */
function drawBlock(
  ctx: CanvasRenderingContext2D,
  ch: string,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const thin = Math.max(1, Math.round(h / 16));
  const thick = thin * 2 + 1;
  const midY = y + Math.floor(h / 2);
  const midX = x + Math.floor(w / 2);
  const hline = (weight: number, from = x, to = x + w) =>
    ctx.fillRect(from, midY - Math.floor(weight / 2), to - from, weight);
  const vline = (weight: number, from = y, to = y + h) =>
    ctx.fillRect(midX - Math.floor(weight / 2), from, weight, to - from);
  switch (ch) {
    case "█":
      ctx.fillRect(x, y, w, h);
      return true;
    case "▓":
    case "▒":
    case "░": {
      const alpha = ch === "▓" ? 0.75 : ch === "▒" ? 0.5 : 0.25;
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * alpha;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = prev;
      return true;
    }
    case "─":
      hline(thin);
      return true;
    case "━":
      hline(thick);
      return true;
    case "═":
      ctx.fillRect(x, midY - thin * 2, w, thin);
      ctx.fillRect(x, midY + thin, w, thin);
      return true;
    case "┈":
      hline(thin, x + Math.round(w * 0.3), x + Math.round(w * 0.7));
      return true;
    case "│":
      vline(thin);
      return true;
    case "┃":
      vline(thick);
      return true;
    case "╎":
      vline(thin, y, y + Math.round(h * 0.4));
      vline(thin, y + Math.round(h * 0.6), y + h);
      return true;
    case "╻":
      vline(thick, midY, y + h);
      return true;
    case "╭":
      hline(thin, midX, x + w);
      vline(thin, midY, y + h);
      return true;
    case "╮":
      hline(thin, x, midX + 1);
      vline(thin, midY, y + h);
      return true;
    case "╰":
      hline(thin, midX, x + w);
      vline(thin, y, midY + 1);
      return true;
    case "╯":
      hline(thin, x, midX + 1);
      vline(thin, y, midY + 1);
      return true;
    default:
      return false;
  }
}

/** Paints a whole screen onto a canvas sized cols*CELL_W by rows*CELL_H (times scale). */
export function drawScreen(
  ctx: CanvasRenderingContext2D,
  screen: Screen,
  scale: number,
): void {
  const w = CELL_W * scale;
  const h = CELL_H * scale;
  ctx.save();
  ctx.fillStyle = TERMINAL.bg;
  ctx.fillRect(0, 0, screen.cols * w, screen.rows * h);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (let row = 0; row < screen.rows; row += 1) {
    const cells = screen.cells[row]!;
    for (let col = 0; col < screen.cols; col += 1) {
      const cell = cells[col]!;
      const { fg, bg } = cellColors(cell.style, TERMINAL);
      const x = col * w;
      const y = row * h;
      if (bg !== TERMINAL.bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, w, h);
      }
      if (cell.ch === " ") continue;
      ctx.fillStyle = fg;
      ctx.globalAlpha = cell.style.dim ? 0.6 : 1;
      if (!drawBlock(ctx, cell.ch, x, y, w, h)) {
        ctx.font = `${cell.style.italic ? "italic " : ""}${cell.style.bold ? "700" : "400"} ${Math.round(h * 0.72)}px ${FONT}`;
        ctx.fillText(cell.ch, x + w / 2, y + h / 2 + scale * 0.5);
      }
      if (cell.style.underline) ctx.fillRect(x, y + h - scale * 2, w, scale);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}
