/**
 * The fader drawer: a panel docked directly above the prompt bar, over the
 * bottom of the piano roll, for editing one or more parameters of a device
 * (Ableton's device view and the OP-1/Elektron "one encoder per value"
 * habit). The piano roll stays visible above it while the terminal is tall
 * enough.
 *
 *   ╭ Effects › filter ─── A/B: 1 change staged · enter keep · esc revert ╮
 *   │ › cutoff           1200 Hz ← 800 Hz               20 … 20000 Hz │
 *   │   [−] ━━━━━━━━━━━━━━━━━━●──────────────────────────────────  [+] │
 *   │   type             lowpass │ highpass │ bandpass │ notch        │
 *   ╰──────────────────── ←→ adjust · ⇧ coarse · enter keep · esc revert ╯
 *
 * Sizes: two rows per field while the drawer takes at most half of the
 * piano roll; one row per field (label, value and a short bar) below that;
 * a window of fields around the focused one when even that does not fit.
 * The smallest is a single borderless row, which fits the 8-row minimum.
 *
 * Painting and hit-testing share `drawerLayout`, and the paint pass records
 * every click target into the frame's HitMap.
 */
import type { CellBuffer } from "./screen.ts";
import type { HitMap } from "./hits.ts";
import { onBackground, type Style, type Theme } from "./theme.ts";
import { displayWidth, truncate } from "./text.ts";
import { asciiHint, fitHint } from "./grammar.ts";

export type DrawerField =
  | Readonly<{
      kind: "number";
      label: string;
      /** Formatted staged (or committed) value; `off` while unset. */
      text: string;
      /** Formatted committed value when it differs from `text`. */
      committed?: string | undefined;
      /** 0…1 along the bar; undefined while the parameter is off. */
      position: number | undefined;
      /** Where the committed value sits, when it differs. */
      committedPosition?: number | undefined;
      minText: string;
      maxText: string;
      /** Just caught by a detent: the bar brightens for one frame. */
      flash?: string | undefined;
    }>
  | Readonly<{
      kind: "choice";
      label: string;
      options: readonly string[];
      index: number;
      committedIndex?: number | undefined;
    }>;

export type DrawerView = Readonly<{
  title: string;
  fields: readonly DrawerField[];
  focus: number;
  /** Digits typed for the focused field (shown in place of its value). */
  typing?: string | undefined;
  /** Edits differ from the committed score. */
  dirty: boolean;
  /** `A/B: 1 change staged · enter keep · esc revert` while dirty. */
  badge?: string | undefined;
  /** `♪ solo · B` while the audition loop plays. */
  status?: string | undefined;
  hint: string;
}>;

export type DrawerMode = "full" | "compact" | "line";

export interface DrawerLayout {
  mode: DrawerMode;
  top: number;
  height: number;
  /** Indexes of the fields shown, top to bottom. */
  first: number;
  count: number;
  /** Rows per field. */
  rowsPerField: 1 | 2;
  bordered: boolean;
}

/** Fewest highway rows the drawer leaves for the piano roll above it. */
export function keepAbove(regionHeight: number): number {
  return Math.max(3, Math.floor(regionHeight * 0.4));
}

/**
 * Where the drawer sits in the highway region (`y`, `height`): docked at
 * its bottom, as tall as its fields need within the budget.
 */
export function drawerLayout(
  view: Pick<DrawerView, "fields" | "focus">,
  region: { y: number; height: number },
): DrawerLayout {
  const total = Math.max(1, view.fields.length);
  const bottom = region.y + region.height;
  const budget = region.height - keepAbove(region.height);
  const window = (rows: number): { first: number; count: number } => {
    const count = Math.max(1, Math.min(total, rows));
    const focus = Math.min(Math.max(0, view.focus), total - 1);
    const first = Math.max(0, Math.min(total - count, focus - count + 1));
    return { first, count };
  };
  if (2 + 2 * total <= Math.floor(region.height / 2)) {
    const height = 2 + 2 * total;
    return {
      mode: "full",
      top: bottom - height,
      height,
      first: 0,
      count: total,
      rowsPerField: 2,
      bordered: true,
    };
  }
  if (budget >= 3) {
    const { first, count } = window(budget - 2);
    const height = 2 + count;
    return {
      mode: "compact",
      top: bottom - height,
      height,
      first,
      count,
      rowsPerField: 1,
      bordered: true,
    };
  }
  const { first, count } = window(1);
  return {
    mode: "line",
    top: bottom - 1,
    height: Math.min(1, region.height),
    first,
    count,
    rowsPerField: 1,
    bordered: false,
  };
}

interface Glyphs {
  box: { tl: string; tr: string; bl: string; br: string; h: string; v: string };
  minus: string;
  plus: string;
  filled: string;
  empty: string;
  knob: string;
  ghost: string;
  marker: string;
  arrow: string;
  sep: string;
}

const UNICODE: Glyphs = {
  box: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
  minus: "[−]",
  plus: "[+]",
  filled: "━",
  empty: "─",
  knob: "●",
  ghost: "┃",
  marker: "›",
  arrow: "←",
  sep: "│",
};
const ASCII: Glyphs = {
  box: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" },
  minus: "[-]",
  plus: "[+]",
  filled: "=",
  empty: "-",
  knob: "O",
  ghost: "|",
  marker: ">",
  arrow: "<-",
  sep: "|",
};

export interface DrawerPaint {
  theme: Theme;
  unicode: boolean;
  /** /motion off: detents still snap, the flash is not drawn. */
  reducedMotion?: boolean;
}

/** Views whose detent flash has been drawn: a flash lasts one frame. */
const flashed = new WeakSet<DrawerView>();

/** Paint the drawer into the highway region; returns its layout. */
export function paintDrawer(
  buffer: CellBuffer,
  region: { y: number; height: number },
  width: number,
  view: DrawerView,
  options: DrawerPaint,
  hits?: HitMap,
): DrawerLayout | undefined {
  if (region.height <= 0 || width < 16 || view.fields.length === 0)
    return undefined;
  const layout = drawerLayout(view, region);
  const flashing = !options.reducedMotion && !flashed.has(view);
  if (view.fields.some((field) => field.kind === "number" && field.flash))
    flashed.add(view);
  const roles = options.theme.roles;
  const glyphs = options.unicode ? UNICODE : ASCII;
  const panel = roles.panel;
  const on = (style: Style): Style => onBackground(style, panel);
  const { top, height } = layout;
  buffer.fill(0, top, width, height, panel);
  let inner = { left: 1, right: width - 1 };
  if (layout.bordered) {
    const border = on(roles.borderFocus);
    const box = glyphs.box;
    buffer.set(0, top, box.tl, border);
    buffer.set(width - 1, top, box.tr, border);
    buffer.set(0, top + height - 1, box.bl, border);
    buffer.set(width - 1, top + height - 1, box.br, border);
    for (let x = 1; x < width - 1; x += 1) {
      buffer.set(x, top, box.h, border);
      buffer.set(x, top + height - 1, box.h, border);
    }
    for (let y = top + 1; y < top + height - 1; y += 1) {
      buffer.set(0, y, box.v, border);
      buffer.set(width - 1, y, box.v, border);
    }
    inner = { left: 2, right: width - 2 };
    // Title left; the status and the staged badge right. The badge's
    // `enter keep` and `esc revert` are click targets; when room is short
    // the breadcrumb truncates first, then the badge drops its key words.
    const room = width - 6;
    const full = view.badge ?? (view.dirty ? "A/B: changes staged" : "");
    // The badge already counts staged changes; the audition status's
    // `B staged N` would say it twice.
    const status = (view.status ?? "")
      .split(" · ")
      .filter((part) => !(full && /^B staged \d+$/.test(part)))
      .join(" · ");
    const short = full.replace(/ · enter keep · esc revert$/, "");
    const join = (badge: string) => [status, badge].filter(Boolean).join(" · ");
    const minTitle = Math.min(displayWidth(view.title), 12) + 2;
    let right = join(full);
    if (displayWidth(right) + 3 + minTitle > room) right = join(short);
    if (displayWidth(right) + 3 + minTitle > room) right = short;
    if (displayWidth(right) + 3 + minTitle > room) right = "";
    const rightWidth = displayWidth(right);
    const titleRoom = Math.max(0, room - (right ? rightWidth + 3 : 0));
    buffer.text(
      2,
      top,
      ` ${truncate(view.title, Math.max(0, titleRoom - 2))} `,
      on({ ...roles.text, bold: true }),
    );
    if (right) {
      const rx = width - 3 - rightWidth;
      buffer.text(
        rx - 1,
        top,
        ` ${right}`,
        on(view.dirty ? roles.warning : roles.muted),
      );
      for (const [word, kind] of [
        ["enter keep", "fader-keep"],
        ["esc revert", "fader-revert"],
      ] as const) {
        const at = right.lastIndexOf(word);
        if (at < 0) continue;
        const x = rx + displayWidth(right.slice(0, at));
        buffer.text(
          x,
          top,
          word,
          on(
            kind === "fader-keep"
              ? { ...roles.success, bold: true }
              : roles.muted,
          ),
        );
        hits?.add(x, top, word.length, 1, { kind });
      }
    }
    const hint = fitHint(
      options.unicode ? view.hint : asciiHint(view.hint),
      width - 6,
    );
    if (hint)
      buffer.text(
        width - 2 - displayWidth(hint),
        top + height - 1,
        hint,
        on(roles.muted),
      );
  }
  const labelWidth = Math.min(
    layout.mode === "full" ? 22 : 16,
    Math.max(...view.fields.map((field) => displayWidth(field.label))),
  );
  const rowTop = layout.bordered ? top + 1 : top;
  for (let offset = 0; offset < layout.count; offset += 1) {
    const index = layout.first + offset;
    const field = view.fields[index]!;
    const focused = index === view.focus;
    const y = rowTop + offset * layout.rowsPerField;
    hits?.add(inner.left, y, inner.right - inner.left, layout.rowsPerField, {
      kind: "fader-row",
      field: index,
    });
    const marker = focused ? glyphs.marker : " ";
    const labelStyle = focused
      ? on({ ...roles.borderFocus, bold: true })
      : on(roles.text);
    buffer.text(inner.left, y, marker, labelStyle);
    buffer.text(
      inner.left + 2,
      y,
      truncate(field.label, labelWidth),
      labelStyle,
    );
    const valueX = inner.left + 2 + labelWidth + 2;
    const typing = focused && view.typing !== undefined;
    if (field.kind === "number") {
      const value = typing ? `${view.typing}▏` : field.text;
      const committed =
        !typing && field.committed !== undefined
          ? ` ${glyphs.arrow} ${field.committed}`
          : "";
      if (layout.rowsPerField === 2) {
        const used = buffer.text(
          valueX,
          y,
          value,
          on({ ...roles.text, bold: true }),
          inner.right - valueX,
        );
        if (committed)
          buffer.text(
            valueX + used,
            y,
            committed,
            on(roles.muted),
            inner.right - valueX - used,
          );
        // For the frame a detent catches, the range gives way to its name.
        const range =
          flashing && field.flash !== undefined
            ? field.flash
            : `${field.minText} … ${field.maxText}`;
        const rangeX = inner.right - displayWidth(range);
        if (rangeX > valueX + used + displayWidth(committed) + 2)
          buffer.text(rangeX, y, range, on(roles.faint));
        paintBar(buffer, y + 1, inner.left + 2, inner.right, field, index, {
          glyphs,
          focused,
          flashing,
          roles,
          on,
          ...(hits ? { hits } : {}),
        });
      } else {
        const valueWidth = Math.min(
          18,
          Math.max(8, Math.floor((inner.right - valueX) / 3)),
        );
        buffer.text(
          valueX,
          y,
          truncate(value, valueWidth),
          on({ ...roles.text, bold: true }),
        );
        paintBar(
          buffer,
          y,
          valueX + valueWidth + 1,
          inner.right,
          field,
          index,
          { glyphs, focused, flashing, roles, on, ...(hits ? { hits } : {}) },
        );
      }
    } else {
      paintOptions(buffer, y, valueX, inner.right, field, index, {
        glyphs,
        focused,
        roles,
        on,
        ...(hits ? { hits } : {}),
      });
      if (layout.rowsPerField === 2 && field.committedIndex !== undefined) {
        const was = field.options[field.committedIndex];
        if (was !== undefined)
          buffer.text(
            valueX,
            y + 1,
            truncate(`${glyphs.arrow} ${was}`, inner.right - valueX),
            on(roles.muted),
          );
      }
    }
  }
  return layout;
}

interface RowPaint {
  glyphs: Glyphs;
  focused: boolean;
  /** Draw this field's detent flash (motion on, first frame only). */
  flashing?: boolean;
  roles: Theme["roles"];
  on: (style: Style) => Style;
  hits?: HitMap;
}

/** `[−] ━━━━━●─────── [+]` from `left` to `right`, with its hit regions. */
function paintBar(
  buffer: CellBuffer,
  y: number,
  left: number,
  right: number,
  field: Extract<DrawerField, { kind: "number" }>,
  index: number,
  paint: RowPaint,
): void {
  const { glyphs, roles, on, hits } = paint;
  const buttonWidth = displayWidth(glyphs.minus);
  const room = right - left;
  if (room < buttonWidth * 2 + 2) return;
  const barLeft = left + buttonWidth + 1;
  const barWidth = right - left - buttonWidth * 2 - 2;
  const button = on({ ...roles.borderFocus, bold: paint.focused });
  buffer.text(left, y, glyphs.minus, button);
  buffer.text(right - buttonWidth, y, glyphs.plus, button);
  hits?.add(left, y, buttonWidth, 1, {
    kind: "fader-step",
    field: index,
    direction: -1,
  });
  hits?.add(right - buttonWidth, y, buttonWidth, 1, {
    kind: "fader-step",
    field: index,
    direction: 1,
  });
  if (barWidth < 3) return;
  hits?.add(barLeft, y, barWidth, 1, {
    kind: "fader-bar",
    field: index,
    left: barLeft,
    width: barWidth,
  });
  const at = (position: number) =>
    Math.round(Math.min(1, Math.max(0, position)) * (barWidth - 1));
  const knob = field.position === undefined ? undefined : at(field.position);
  const ghost =
    field.committedPosition === undefined
      ? undefined
      : at(field.committedPosition);
  // A detent catch brightens the bar for one frame (motion on).
  const flash = paint.flashing === true && field.flash !== undefined;
  const filled = on(
    flash
      ? { ...roles.success, bold: true }
      : paint.focused
        ? roles.borderFocus
        : roles.text,
  );
  const empty = on(roles.faint);
  for (let column = 0; column < barWidth; column += 1) {
    const x = barLeft + column;
    if (column === knob)
      buffer.set(x, y, glyphs.knob, on({ ...roles.warning, bold: true }));
    else if (column === ghost) buffer.set(x, y, glyphs.ghost, on(roles.muted));
    else if (knob !== undefined && column < knob)
      buffer.set(x, y, glyphs.filled, filled);
    else buffer.set(x, y, glyphs.empty, empty);
  }
}

/** `lowpass │ highpass │ bandpass`: a segmented selector, windowed. */
function paintOptions(
  buffer: CellBuffer,
  y: number,
  left: number,
  right: number,
  field: Extract<DrawerField, { kind: "choice" }>,
  index: number,
  paint: RowPaint,
): void {
  const { glyphs, roles, on, hits } = paint;
  const room = right - left;
  // Start far enough left that the selected option is in view.
  let first = 0;
  const widthFrom = (start: number, end: number) =>
    field.options
      .slice(start, end + 1)
      .reduce((sum, option) => sum + displayWidth(option) + 2, 0) +
    (end - start);
  while (first < field.index && widthFrom(first, field.index) + 2 > room)
    first += 1;
  let x = left;
  if (first > 0) x += buffer.text(x, y, "‹ ", on(roles.faint));
  for (let at = first; at < field.options.length; at += 1) {
    const option = field.options[at]!;
    const width = displayWidth(option) + 2;
    if (x + width > right - (at < field.options.length - 1 ? 2 : 0)) {
      buffer.text(x, y, " ›", on(roles.faint));
      break;
    }
    const selected = at === field.index;
    const style = selected
      ? on({
          ...(paint.focused ? roles.borderFocus : roles.text),
          bold: true,
          reverse: true,
        })
      : at === field.committedIndex
        ? on({ ...roles.muted, underline: true })
        : on(roles.muted);
    buffer.text(x, y, ` ${option} `, style);
    hits?.add(x, y, width, 1, {
      kind: "fader-option",
      field: index,
      option: at,
    });
    x += width;
    if (at < field.options.length - 1 && x + 1 < right)
      x += buffer.text(x, y, glyphs.sep, on(roles.faint));
  }
}
