/**
 * Play mode's two fixed rows: the header (`PLAY  C3–F4  vel 100  ● REC
 * click ✓` plus a beat flash) and a one-line keyboard strip with the keys
 * that are sounding lit. Both repaint in place every frame, so playing never
 * scrolls the transcript.
 */
import type { CellBuffer } from "./screen.ts";
import { displayWidth, truncate } from "./text.ts";
import { onBackground, type Theme } from "./theme.ts";

export type PlayStripKey = Readonly<{
  key: string;
  label: string;
  black: boolean;
  lit: boolean;
}>;

export type PlayHeaderView = Readonly<{
  /** `C3–F4`. */
  range: string;
  velocity: number;
  /** Record armed. */
  armed: boolean;
  /** Recording right now (armed and the transport is running). */
  recording: boolean;
  replace: boolean;
  click: boolean;
  sustain: boolean;
  /** `count-in 3` while counting in. */
  countIn?: string | undefined;
  /** Beat within the bar (1-based) and whether it is the flash window. */
  beat?: Readonly<{ index: number; of: number; flash: boolean }> | undefined;
  /** `grid 1/16`. */
  grid: string;
  /** Short status (`octave C2`, `no audio`). */
  status?: string | undefined;
  keys: readonly PlayStripKey[];
}>;

/** Text of the header row, for tests and narrow terminals. */
export function playHeaderText(view: PlayHeaderView, unicode = true): string {
  const parts = [
    "PLAY",
    view.range,
    `vel ${view.velocity}`,
    view.armed
      ? `${unicode ? "●" : "*"} ${view.recording ? "REC" : "rec armed"}${view.replace ? " replace" : ""}`
      : "",
    `click ${view.click ? (unicode ? "✓" : "on") : "off"}`,
    view.sustain ? "SUSTAIN" : "",
    view.grid,
    view.countIn ?? "",
  ].filter(Boolean);
  return parts.join("  ");
}

export function paintPlayHeader(
  buffer: CellBuffer,
  y: number,
  width: number,
  view: PlayHeaderView,
  theme: Theme,
  unicode: boolean,
): void {
  const roles = theme.roles;
  const panel = roles.panel;
  buffer.fill(0, y, width, 1, panel);
  let x = 1;
  const put = (text: string, style = roles.text) => {
    if (x >= width - 1) return;
    x += buffer.text(
      x,
      y,
      truncate(text, Math.max(1, width - x - 1)),
      onBackground(style, panel),
    );
    x += buffer.text(x, y, "  ", panel);
  };
  put(" PLAY ", roles.pillSteer);
  put(view.range, { ...roles.text, bold: true });
  put(`vel ${view.velocity}`);
  if (view.armed)
    put(
      `${unicode ? "●" : "*"} ${view.recording ? "REC" : "rec armed"}${view.replace ? " replace" : ""}`,
      view.recording ? roles.error : roles.warning,
    );
  put(
    `click ${view.click ? (unicode ? "✓" : "on") : "off"}`,
    view.click ? roles.success : roles.muted,
  );
  if (view.sustain) put("SUSTAIN", roles.pillQueue);
  if (view.countIn) put(view.countIn, roles.warning);
  if (view.beat) {
    const cells = Array.from({ length: view.beat.of }, (_, index) =>
      index + 1 === view.beat!.index
        ? unicode
          ? "●"
          : "o"
        : unicode
          ? "·"
          : ".",
    ).join("");
    put(
      cells,
      view.beat.flash
        ? view.beat.index === 1
          ? roles.error
          : roles.hit
        : roles.muted,
    );
  }
  put(view.grid, roles.muted);
  if (view.status) put(view.status, roles.muted);
  // Mode keys at the right edge while there is room.
  const hint = "z/x oct · c/v vel · r rec · m click · esc exit";
  const room = width - 1 - displayWidth(hint);
  if (room > x) buffer.text(room, y, hint, onBackground(roles.faint, panel));
}

/** `a C3 │ w C#3 …`: each key with its note; lit keys reversed. */
export function paintPlayStrip(
  buffer: CellBuffer,
  y: number,
  width: number,
  keys: readonly PlayStripKey[],
  theme: Theme,
): void {
  const roles = theme.roles;
  buffer.fill(0, y, width, 1, roles.canvas);
  let x = 1;
  for (const key of keys) {
    const cell = `${key.key.toUpperCase()} ${key.label}`;
    const cellWidth = displayWidth(cell) + 1;
    if (x + cellWidth > width - 1) break;
    const style = key.lit
      ? { ...(key.black ? roles.selected : roles.hit), reverse: true }
      : key.black
        ? roles.muted
        : roles.text;
    buffer.text(x, y, cell, style);
    x += cellWidth;
  }
}
