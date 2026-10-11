import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CSSProperties } from "react";

import { ScreenPlayer } from "./screen-player";
import { cellStyle, type ScreenStyle } from "./screen-style";

export { cellStyle, type ScreenStyle };

/**
 * A real dawg screen, captured from the TUI in a PTY by
 * `bun test/screens/capture.ts` into ../docs/screens/<id>.json. It renders as
 * text, so it can be selected, searched and read by a screen reader; nothing
 * here draws a frame by hand. test/screens/screens.test.ts fails when a
 * committed screen no longer matches the TUI.
 */
export interface ScreenFile {
  readonly id: string;
  readonly title: string;
  readonly cols: number;
  readonly rows: number;
  readonly styles: readonly ScreenStyle[];
  readonly lines: readonly (readonly [string, number])[][];
}

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

/** The screen's text, one row per line, for alt text and tests. */
export function screenText(screen: ScreenFile): string {
  return screen.lines
    .map((row) =>
      row
        .map(([text]) => text)
        .join("")
        .trimEnd(),
    )
    .join("\n");
}

/** Whether `id` has committed animation frames (docs/screens/frames). */
export function hasFrames(id: string): boolean {
  return existsSync(join(screensDirectory, "frames", `${id}.json`));
}

export function Screen({
  id,
  caption,
  chrome = true,
  animate = false,
  className,
}: Readonly<{
  /** Replay the frames dawg drew on the way to this screen, if captured. */
  animate?: boolean;
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
  const grid = (
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
  );
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
        {animate && hasFrames(id) ? (
          <ScreenPlayer id={id}>{grid}</ScreenPlayer>
        ) : (
          grid
        )}
      </div>
      {text === false ? null : (
        <figcaption className="dawg-demo__caption">{text}</figcaption>
      )}
    </figure>
  );
}
