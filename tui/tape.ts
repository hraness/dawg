/**
 * TAPE (op1-ux §6, §8.3): every track across the bars, as a pure painter.
 *
 * The caller (src/tui/tape-view.ts) turns a score into a `TapeView`: one
 * density level per cell and track, the sections, the loop range, the
 * playhead and the knob slots. This module only draws it, so the layout is
 * testable without a session. Colour is never the only cue: the playhead is
 * `▼`/`│`, the loop `[══]`, the focused row `›`, a muted row dim `·`, a
 * form repeat `░` (ASCII `~`), and every knob carries its shape glyph
 * (NO_COLOR and the mono theme).
 */
import type { HitMap } from "./hits.ts";
import { paintKnobStrip, type KnobIndex, type KnobSlots } from "./knobs.ts";
import type { CellBuffer } from "./screen.ts";
import { displayWidth, truncate } from "./text.ts";
import { accentStyle, type Style, type Theme } from "./theme.ts";

/** One track row: its density levels (0 empty … 8 dense), one per cell. */
export type TapeRow = Readonly<{
  id: string;
  name: string;
  muted: boolean;
  levels: readonly number[];
  /** Other panes on this track (§12.7): `B`, `C●`; empty when none. */
  marks: string;
}>;

export type TapeSection = Readonly<{
  name: string;
  startBar: number;
  bars: number;
}>;

/** Cells per bar: half beats, beats or whole bars (`-` / `=` zoom). */
export type TapeZoom = "half" | "beat" | "bar";
export const TAPE_ZOOMS: readonly TapeZoom[] = ["bar", "beat", "half"];

export type TapeView = Readonly<{
  bars: number;
  /** The bar (0-based) each cell belongs to, in order. */
  cellBars: readonly number[];
  /** Cell under the playhead. */
  playheadCell: number;
  /** The loop range (`score.loop`, or the looped section's bars). */
  loop?: Readonly<{ startBar: number; bars: number }> | undefined;
  sections: readonly TapeSection[];
  /**
   * An unrolled form (op1-ux §4): per cell, whether it is a later pass of a
   * section (ghosted `░`, ASCII `~`), and which form pass it belongs to
   * (-1 for bars the form never plays). Absent without a form.
   */
  ghosts?: readonly boolean[] | undefined;
  passes?: readonly number[] | undefined;
  /** Each form pass's label (`chorus ×2`), indexed by `passes`. */
  passNames?: readonly string[] | undefined;
  /** The looped section's name, drawn reversed. */
  loopSection?: string | undefined;
  /** Tempo changes (`♩96` marks); empty when the tempo is constant. */
  tempo: readonly Readonly<{ cell: number; bpm: number }>[];
  rows: readonly TapeRow[];
  focused: number;
  /** `range: bass · bars 5–6 (loop)`. */
  range: string;
  /** `clipboard: drums · 2 bars`, when the pane holds one. */
  clipboard?: string | undefined;
  knobs: KnobSlots;
  selected: KnobIndex;
  /** The gesture row, from the screen's key table. */
  hint: string;
  /** The reels (`◐◓◑◒`, §9.1), turning on beats while playing. */
  reel?: string | undefined;
  /**
   * The loop just wrapped (a recording pass closed, §9.3): the brackets
   * draw reversed and bold and the fill turns `━`, so it reads in mono.
   */
  loopFlash?: boolean | undefined;
}>;

/** Glyph for a density level, 1 … 8. */
const LEVELS = " ▁▂▃▄▅▆▇█";
const ASCII_LEVELS = " .:-=+*#@";
/** A later pass of a section on an unrolled form. */
const GHOST = "░";
const ASCII_GHOST = "~";

/** Columns of the row gutter: ` 2›bass  `. */
export const TAPE_GUTTER = 9;

/** The rows the tape keeps below the tracks: range, knobs, hints. */
const FOOTER_ROWS = 3;

/** First visible cell: pages so the playhead stays on screen. */
export function tapeFirstCell(view: TapeView, cells: number): number {
  if (view.cellBars.length <= cells) return 0;
  const page = Math.floor(view.playheadCell / cells);
  return Math.min(page * cells, view.cellBars.length - cells);
}

/** First visible track row: keeps the focused row on screen. */
export function tapeFirstRow(view: TapeView, rows: number): number {
  if (view.rows.length <= rows) return 0;
  return Math.max(
    0,
    Math.min(view.focused - rows + 1, view.rows.length - rows),
  );
}

export type TapePaintOptions = Readonly<{
  theme: Theme;
  unicode: boolean;
  hits?: HitMap | undefined;
}>;

/** What the painter laid out, for mouse hits and tests. */
export type TapeLayout = Readonly<{
  rulerY: number;
  firstCell: number;
  cells: number;
  firstRow: number;
  rowsY: number;
  rowCount: number;
}>;

export function paintTape(
  buffer: CellBuffer,
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
  view: TapeView,
  options: TapePaintOptions,
): TapeLayout {
  const { theme, unicode } = options;
  const roles = theme.roles;
  // ` B C●`: room for up to three pane letters right of the cells.
  const marksWidth = view.rows.some((row) => row.marks) ? 7 : 0;
  const cells = Math.max(
    0,
    Math.min(view.cellBars.length, rect.width - TAPE_GUTTER - marksWidth),
  );
  const firstCell = tapeFirstCell(view, cells);
  const left = rect.x + TAPE_GUTTER;
  const bottom = rect.y + rect.height;
  const cellBar = (cell: number): number => view.cellBars[cell] ?? view.bars;
  const ghost = (cell: number): boolean => view.ghosts?.[cell] ?? false;
  const passOf = (cell: number): number | undefined => view.passes?.[cell];
  const barStart = (cell: number): boolean =>
    cell === 0 ||
    cellBar(cell) !== cellBar(cell - 1) ||
    passOf(cell) !== passOf(cell - 1);
  const loopStart = view.loop?.startBar;
  const loopEnd = view.loop ? view.loop.startBar + view.loop.bars : undefined;
  // The loop brackets its source bars, never a ghost pass of them.
  const inLoop = (cell: number): boolean =>
    loopStart !== undefined &&
    !ghost(cell) &&
    cellBar(cell) >= loopStart &&
    cellBar(cell) < loopEnd!;

  // Ruler: bar numbers every 4 bars and at the loop edges; `[══]` in green.
  let y = rect.y;
  const ruler = Array.from({ length: cells }, () => " ");
  const rulerStyle: (Style | undefined)[] = Array.from(
    { length: cells },
    () => roles.muted,
  );
  const flash = view.loopFlash === true;
  const bracketStyle: Style = flash
    ? { ...roles.knob2, bold: true, reverse: true }
    : roles.knob2;
  for (let index = 0; index < cells; index += 1) {
    const cell = firstCell + index;
    if (inLoop(cell)) {
      ruler[index] = flash ? (unicode ? "━" : "#") : unicode ? "═" : "=";
      rulerStyle[index] = flash ? { ...roles.knob2, bold: true } : roles.knob2;
    }
  }
  for (let index = 0; index < cells; index += 1) {
    const cell = firstCell + index;
    if (!barStart(cell)) continue;
    const bar = cellBar(cell);
    const edge = !ghost(cell) && (bar === loopStart || bar + 1 === loopEnd);
    if (bar % 4 !== 0 && !edge && bar !== view.bars - 1) continue;
    const label = String(bar + 1);
    const at = index + (edge && bar === loopStart ? 1 : 0);
    // A number never overwrites a neighbour's digits.
    if (ruler.slice(at, at + label.length).some((ch) => /\d/.test(ch)))
      continue;
    for (let k = 0; k < label.length && at + k < cells; k += 1) {
      ruler[at + k] = label[k]!;
      if (!inLoop(cell)) rulerStyle[at + k] = roles.muted;
    }
  }
  if (view.loop) {
    for (let index = 0; index < cells; index += 1) {
      const cell = firstCell + index;
      if (barStart(cell) && cellBar(cell) === loopStart && !ghost(cell)) {
        ruler[index] = "[";
        rulerStyle[index] = bracketStyle;
      }
      if (inLoop(cell) && !inLoop(cell + 1)) {
        ruler[index] = "]";
        rulerStyle[index] = bracketStyle;
      }
    }
  }
  const head = view.playheadCell - firstCell;
  if (head >= 0 && head < cells) {
    // On a loop bracket the bracket stays and the playhead reverses it, so
    // both read without color (the rows still carry the `│` column).
    if (ruler[head] === "[" || ruler[head] === "]")
      rulerStyle[head] = { ...roles.knob1, reverse: true };
    else {
      ruler[head] = unicode ? "▼" : "v";
      rulerStyle[head] = roles.knob1;
    }
  }
  buffer.text(rect.x, y, " bar", roles.faint);
  // The reels sit in the gutter: a glyph that turns, so never color-only.
  if (view.reel) buffer.text(rect.x + 6, y, view.reel, roles.warning);
  ruler.forEach((ch, index) =>
    buffer.set(left + index, y, ch, rulerStyle[index]),
  );
  const rulerY = y;
  options.hits?.add(left, y, cells, 1, { kind: "tape-ruler", left, firstCell });
  y += 1;

  // Sections: `▀name▀▀▀`; the looped one reversed; a form repeat `░name░`.
  if (y < bottom - FOOTER_ROWS) {
    buffer.text(rect.x, y, " sect", roles.faint);
    const sectionAt = (cell: number): TapeSection | undefined => {
      const bar = cellBar(cell);
      return view.sections.find(
        (item) => bar >= item.startBar && bar < item.startBar + item.bars,
      );
    };
    const sectionStyle = (section: TapeSection, cell: number): Style => ({
      ...accentStyle(theme, `section:${section.name}`),
      ...(ghost(cell) ? { dim: true } : {}),
      ...(section.name === view.loopSection && !ghost(cell)
        ? { reverse: true }
        : {}),
    });
    for (let index = 0; index < cells; index += 1) {
      const cell = firstCell + index;
      const section = sectionAt(cell);
      if (!section) {
        buffer.set(left + index, y, " ", undefined);
        continue;
      }
      buffer.set(
        left + index,
        y,
        ghost(cell) ? (unicode ? GHOST : ASCII_GHOST) : unicode ? "▀" : "-",
        sectionStyle(section, cell),
      );
    }
    // A label at each section's first cell (each form pass when unrolled).
    for (let index = 0; index < cells; index += 1) {
      const cell = firstCell + index;
      const section = sectionAt(cell);
      if (!section) continue;
      const pass = passOf(cell);
      const starts =
        cell === firstCell
          ? true
          : sectionAt(cell - 1) !== section || pass !== passOf(cell - 1);
      if (!starts) continue;
      let room = 1;
      while (
        index + room < cells &&
        sectionAt(cell + room) === section &&
        passOf(cell + room) === pass
      )
        room += 1;
      const name =
        pass !== undefined && pass >= 0
          ? (view.passNames?.[pass] ?? section.name)
          : section.name;
      // A ghost keeps a leading `░` so the repeat reads in mono too.
      if (ghost(cell) && room <= 2) continue;
      const offset = ghost(cell) ? 1 : 0;
      const label = truncate(name, room - offset, "");
      buffer.text(left + index + offset, y, label, {
        ...sectionStyle(section, cell),
        bold: true,
      });
    }
    y += 1;
  }

  // Tempo marks, only when the tempo changes.
  if (view.tempo.length > 0 && y < bottom - FOOTER_ROWS) {
    buffer.text(rect.x, y, " tempo", roles.faint);
    for (const mark of view.tempo) {
      const at = mark.cell - firstCell;
      if (at < 0 || at >= cells) continue;
      buffer.text(
        left + at,
        y,
        truncate(`${unicode ? "♩" : "q"}${mark.bpm}`, cells - at, ""),
        roles.knob3,
      );
    }
    y += 1;
  }

  // Track rows.
  const rowsY = y;
  const rowRoom = Math.max(0, bottom - FOOTER_ROWS - y);
  const firstRow = tapeFirstRow(view, rowRoom);
  const levels = unicode ? LEVELS : ASCII_LEVELS;
  const visible = view.rows.slice(firstRow, firstRow + rowRoom);
  visible.forEach((row, offset) => {
    const index = firstRow + offset;
    const focused = index === view.focused;
    const number = index < 9 ? String(index + 1) : " ";
    const accent = accentStyle(theme, row.id);
    buffer.text(rect.x, y, ` ${number}`, roles.faint);
    buffer.text(rect.x + 2, y, focused ? (unicode ? "›" : ">") : " ", {
      ...roles.text,
      bold: true,
    });
    const name = truncate(row.name, 6, "").padEnd(6);
    buffer.text(
      rect.x + 3,
      y,
      name,
      focused
        ? { ...accent, bold: true, reverse: true }
        : row.muted
          ? roles.mutedNote
          : accent,
    );
    for (let column = 0; column < cells; column += 1) {
      const cell = firstCell + column;
      const level = row.levels[cell] ?? 0;
      const repeat = ghost(cell);
      const style: Style | undefined =
        column === head
          ? // Over a note the playhead reverses it: visible in mono too.
            { ...roles.knob1, ...(level > 0 ? { reverse: true } : {}) }
          : row.muted
            ? roles.mutedNote
            : level > 0
              ? repeat
                ? { ...accent, dim: true }
                : accent
              : barStart(cell)
                ? roles.barRule
                : roles.beatRule;
      const ch =
        level > 0
          ? repeat
            ? unicode
              ? GHOST
              : ASCII_GHOST
            : levels[Math.min(8, level)]!
          : column === head
            ? unicode
              ? "│"
              : "|"
            : barStart(cell)
              ? unicode
                ? "┊"
                : ":"
              : "·";
      buffer.set(left + column, y, ch, style);
    }
    // Other panes, dim; a recording pane's `●` in the record red.
    [
      ...truncate(
        unicode ? row.marks : row.marks.replace(/●/g, "*"),
        marksWidth - 1,
        "",
      ),
    ].forEach((ch, k) =>
      buffer.set(
        left + cells + 1 + k,
        y,
        ch,
        ch === "●" || ch === "*" ? roles.error : { ...roles.muted, dim: true },
      ),
    );
    options.hits?.add(rect.x, y, rect.width, 1, {
      kind: "tape-row",
      row: index,
      left,
      firstCell,
    });
    y += 1;
  });

  // Footer: range line with the clipboard chip, knob strip, gesture hints.
  const footerY = bottom - FOOTER_ROWS;
  if (footerY >= rowsY) {
    buffer.text(
      rect.x + 1,
      footerY,
      truncate(view.range, rect.width - 2),
      roles.text,
    );
    if (view.clipboard) {
      const chip = `${unicode ? "◆" : "*"} ${view.clipboard}`;
      const room = rect.width - 2 - displayWidth(view.range) - 3;
      if (room >= 12) {
        const text = truncate(chip, room);
        const x = rect.x + rect.width - 1 - displayWidth(text);
        buffer.text(x, footerY, text, roles.warning);
        options.hits?.add(x, footerY, displayWidth(text), 1, {
          kind: "tape-clipboard",
        });
      }
    }
    paintKnobStrip(
      buffer,
      rect.x + 1,
      footerY + 1,
      rect.width - 2,
      view.knobs,
      view.selected,
      {
        theme,
        unicode,
      },
    );
    buffer.text(
      rect.x + 1,
      footerY + 2,
      truncate(view.hint, rect.width - 2),
      roles.muted,
    );
  }
  return {
    rulerY,
    firstCell,
    cells,
    firstRow,
    rowsY,
    rowCount: visible.length,
  };
}
