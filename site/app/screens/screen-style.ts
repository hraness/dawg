import type { CSSProperties } from "react";

/**
 * How a captured terminal cell is drawn. Shared by the server-rendered
 * screen and the client player, so this file must not touch node APIs.
 */
export interface ScreenStyle {
  readonly fg?: string;
  readonly bg?: string;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly reverse?: boolean;
}

/** One row: runs of text, each with an index into the screen's styles. */
export type ScreenRow = readonly (readonly [string, number])[];

/** The TUI's default theme surface (tui/theme.ts). */
const TERM = { fg: "rgb(225,231,239)", bg: "rgb(24,28,37)" } as const;

function rgb(value: string): [number, number, number] {
  const m = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/u);
  if (m === null) throw new Error(`bad color "${value}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** SGR 2 as a terminal shows it: the color halfway to the background. */
function dimmed(fg: string, bg: string): string {
  const [a, b] = [rgb(fg), rgb(bg)];
  return `rgb(${a.map((v, i) => Math.round((v + b[i]!) / 2)).join(",")})`;
}

/** Inline CSS for one style; exported for tests. */
export function cellStyle(style: ScreenStyle): CSSProperties {
  let fg = style.fg ?? TERM.fg;
  let bg = style.bg ?? TERM.bg;
  if (style.reverse) [fg, bg] = [bg, fg];
  if (style.dim) fg = dimmed(fg, bg);
  const css: CSSProperties = {};
  if (fg !== TERM.fg) css.color = fg;
  if (bg !== TERM.bg) css.backgroundColor = bg;
  if (style.bold) css.fontWeight = 700;
  if (style.italic) css.fontStyle = "italic";
  if (style.underline) css.textDecoration = "underline";
  return css;
}

/** The same style as a `style` attribute value, for the client player. */
export function cellStyleText(style: ScreenStyle): string {
  const css = cellStyle(style);
  const parts: string[] = [];
  if (css.color) parts.push(`color:${css.color}`);
  if (css.backgroundColor)
    parts.push(`background-color:${css.backgroundColor}`);
  if (css.fontWeight) parts.push(`font-weight:${css.fontWeight}`);
  if (css.fontStyle) parts.push(`font-style:${css.fontStyle}`);
  if (css.textDecoration) parts.push(`text-decoration:${css.textDecoration}`);
  return parts.join(";");
}
