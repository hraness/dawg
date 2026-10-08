/**
 * The arrangement strip (0.5): one row under the header that shows the
 * song's sections over the bar timeline, like the arranger track in Logic,
 * Cubase or Studio One. Each section is a block with its name; the looped
 * section is reversed, the one under the playhead is bold, and the playhead
 * is a caret. Bars with no section are a faint rule. The strip is absent
 * when the song has no sections, so a 0.4 screen keeps every row it had.
 *
 * The shape is structural so the TUI does not depend on core.
 */
import type { CellBuffer } from "./screen.ts";
import { displayWidth, truncate } from "./text.ts";
import { accentStyle, onBackground, type Style, type Theme } from "./theme.ts";

export type ArrangeStripSection = Readonly<{
  name: string;
  /** 0-based first bar. */
  startBar: number;
  bars: number;
}>;

export type ArrangeStripView = Readonly<{
  /** Bars on the timeline (the score's `bars`). */
  bars: number;
  sections: readonly ArrangeStripSection[];
  /** The looped section's name, if any. */
  loop?: string | undefined;
  /** Playhead in bars (fractional), score time. */
  playheadBar?: number | undefined;
  /** `intro verse chorus×2`, shown at the right edge when it fits. */
  form?: string | undefined;
}>;

/** One painted cell of the strip, for tests and narrow terminals. */
export type ArrangeStripCell = Readonly<{
  ch: string;
  /** Index into `view.sections`, or -1 for an unmarked bar. */
  section: number;
  playhead: boolean;
}>;

/**
 * Lay the strip out over `width` cells: each cell covers `bars / width`
 * bars and shows the section that starts latest at or before it (a later
 * marker wins where sections overlap). Names start at a section's first
 * cell and are cut at the next boundary.
 */
export function arrangeStripCells(
  view: ArrangeStripView,
  width: number,
  unicode = true,
): ArrangeStripCell[] {
  const cells: ArrangeStripCell[] = [];
  const bars = Math.max(1, view.bars);
  const span = Math.max(1, Math.floor(width));
  const owner = (bar: number): number => {
    let found = -1;
    let start = -1;
    view.sections.forEach((section, index) => {
      if (
        bar >= section.startBar &&
        bar < section.startBar + section.bars &&
        section.startBar >= start
      ) {
        found = index;
        start = section.startBar;
      }
    });
    return found;
  };
  const playCell =
    view.playheadBar === undefined
      ? -1
      : Math.min(span - 1, Math.floor((view.playheadBar / bars) * span));
  for (let x = 0; x < span; x++) {
    const bar = Math.floor((x / span) * bars);
    const section = owner(bar);
    cells.push({
      ch: section < 0 ? (unicode ? "─" : "-") : " ",
      section,
      playhead: x === playCell,
    });
  }
  // Names: from each run's first cell; a run is consecutive cells of one
  // section. A run too short for the name gets its first letters.
  let x = 0;
  while (x < span) {
    const section = cells[x]!.section;
    let end = x;
    while (end < span && cells[end]!.section === section) end++;
    if (section >= 0) {
      const name = view.sections[section]!.name;
      const room = end - x - (end - x > 2 ? 1 : 0);
      const label = room > 0 ? truncate(name, room, unicode ? "…" : "~") : "";
      // A boundary bar: one cell gap between neighbours when there is room.
      let at = x + (end - x > 2 ? 1 : 0);
      for (const ch of label) {
        if (at >= end) break;
        cells[at] = { ...cells[at]!, ch };
        at += Math.max(1, displayWidth(ch));
      }
      if (end - x > 2) cells[x] = { ...cells[x]!, ch: unicode ? "▏" : "|" };
    }
    x = end;
  }
  return cells;
}

/** Plain text of the strip, for tests. */
export function arrangeStripText(
  view: ArrangeStripView,
  width: number,
  unicode = true,
): string {
  return arrangeStripCells(view, width, unicode)
    .map((cell) => (cell.playhead ? (unicode ? "▼" : "v") : cell.ch))
    .join("");
}

export function paintArrangeStrip(
  buffer: CellBuffer,
  y: number,
  width: number,
  view: ArrangeStripView,
  theme: Theme,
  unicode: boolean,
): void {
  const roles = theme.roles;
  buffer.fill(0, y, width, 1, roles.canvas);
  const form = view.form ? `form ${view.form}` : "";
  const formWidth = displayWidth(form);
  // The form goes right when the timeline keeps at least 24 cells.
  const showForm = form !== "" && width - formWidth - 3 >= 24;
  const stripWidth = Math.max(1, width - 2 - (showForm ? formWidth + 2 : 0));
  const cells = arrangeStripCells(view, stripWidth, unicode);
  const playSection =
    view.playheadBar === undefined
      ? -1
      : (cells.find((cell) => cell.playhead)?.section ?? -1);
  cells.forEach((cell, index) => {
    const x = 1 + index;
    if (cell.section < 0) {
      buffer.set(
        x,
        y,
        cell.playhead ? (unicode ? "▼" : "v") : cell.ch,
        cell.playhead ? { ...roles.hit, bold: true } : roles.faint,
      );
      return;
    }
    const section = view.sections[cell.section]!;
    const accent = accentStyle(theme, section.name);
    const looped = view.loop === section.name;
    const style: Style = {
      ...accent,
      reverse: true,
      bold: looped || cell.section === playSection,
      ...(looped ? {} : { dim: cell.section !== playSection }),
    };
    buffer.set(
      x,
      y,
      cell.playhead ? (unicode ? "▼" : "v") : cell.ch,
      cell.playhead ? { ...roles.hit, reverse: true, bold: true } : style,
    );
  });
  if (showForm)
    buffer.text(
      width - 1 - formWidth,
      y,
      form,
      onBackground(roles.muted, roles.canvas),
    );
}
