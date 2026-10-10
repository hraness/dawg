import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CSSProperties } from "react";

/**
 * A real dawg screen, captured from the TUI in a PTY by
 * `bun test/screens/capture.ts` into ../docs/screens/<id>.json. It renders as
 * text, so it can be selected, searched and read by a screen reader; nothing
 * here draws a frame by hand. test/screens/screens.test.ts fails when a
 * committed screen no longer matches the TUI.
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

export interface ScreenFile {
  readonly id: string;
  readonly title: string;
  readonly cols: number;
  readonly rows: number;
  readonly styles: readonly ScreenStyle[];
  readonly lines: readonly (readonly [string, number])[][];
}

/** The TUI's default theme surface (tui/theme.ts). */
const TERM = { fg: "rgb(225,231,239)", bg: "rgb(24,28,37)" } as const;

export const screensDirectory = join(process.cwd(), "..", "docs", "screens");

const cache = new Map<string, ScreenFile>();

export function loadScreen(id: string): ScreenFile {
  if (!/^[a-z0-9-]+$/u.test(id)) throw new Error(`bad screen id "${id}"`);
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const screen = JSON.parse(
    readFileSync(join(screensDirectory, `${id}.json`), "utf8"),
  ) as ScreenFile;
  cache.set(id, screen);
  return screen;
}

function rgb(value: string): [number, number, number] {
  const m = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/u);
  if (m === null) throw new Error(`bad colour "${value}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** SGR 2 as a terminal shows it: the colour halfway to the background. */
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

/** The screen's text, one row per line, for alt text and tests. */
export function screenText(screen: ScreenFile): string {
  return screen.lines
    .map((row) => row.map(([text]) => text).join("").trimEnd())
    .join("\n");
}

export function Screen({
  id,
  caption,
  chrome = true,
  className,
}: Readonly<{
  id: string;
  /** Shown under the frame; defaults to the screen's own title. */
  caption?: string | false;
  /** The window bar with the size, as on the hero. */
  chrome?: boolean;
  className?: string;
}>) {
  const screen = loadScreen(id);
  const label = `${screen.title}. A real dawg screen, ${screen.cols} by ${screen.rows} characters.`;
  const text = caption === undefined ? screen.title : caption;
  return (
    <figure
      className={["dawg-screen", className].filter(Boolean).join(" ")}
      style={{ "--cols": screen.cols, "--rows": screen.rows } as CSSProperties}
    >
      {chrome ? (
        <div className="dawg-demo__chrome" aria-hidden="true">
          <span className="dawg-demo__lights">
            <span />
            <span />
            <span />
          </span>
          <span className="dawg-demo__title">
            dawg — {screen.cols}×{screen.rows}
          </span>
        </div>
      ) : null}
      <div className="dawg-screen__frame">
        <pre className="dawg-screen__grid" role="img" aria-label={label}>
          {screen.lines.map((row, y) => (
            <span key={y} className="dawg-screen__row">
              {row.map(([chars, style], x) => (
                <span key={x} style={cellStyle(screen.styles[style] ?? {})}>
                  {chars}
                </span>
              ))}
              {"\n"}
            </span>
          ))}
        </pre>
      </div>
      {text === false ? null : (
        <figcaption className="dawg-demo__caption">{text}</figcaption>
      )}
    </figure>
  );
}
