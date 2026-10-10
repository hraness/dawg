/**
 * The Ctrl-K breadcrumb: `≡ Arrange › range`. The menu mark comes first (the
 * same `≡` as a guide's `## Menu`), then each step; the last step is where
 * you are. Pure: steps and a width in, segments out; tui/app.ts and
 * tui/drawer.ts paint them.
 *
 * When the title is too wide it gives way in this order, so the mark and
 * the current step stay readable down to the 60-column minimum:
 *
 *   ≡ Effects › more effects › duck · /query
 *   ≡ Effects › … › duck · /query          middle steps fold into …
 *   ≡ … › duck · /query                    then the first step too
 *   ≡ … › du… · /query                     then the current step truncates
 *
 * Under TERM=dumb the same title reads `= Effects > ... > duck`.
 */
import {
  CRUMB_ELISION,
  CRUMB_SEPARATOR,
  MENU_MARK,
  type DocRole,
} from "../guides/marks.ts";
import type { CellBuffer } from "./screen.ts";
import { displayWidth, truncate } from "./text.ts";
import { onBackground, type SemanticRole, type Style } from "./theme.ts";

export type CrumbSegment = Readonly<{
  text: string;
  /**
   * `mark` is the menu mark (painted in `role`), `step` a parent step or a
   * separator (dim), `here` the current step and `extra` the prefix and
   * suffix (bold text).
   */
  kind: "mark" | "step" | "here" | "extra";
  role?: DocRole;
}>;

export type Crumbs = Readonly<{
  /** Steps below the menu root; the root alone is `["menu"]`. */
  steps: readonly string[];
  /** Before the mark: the staged-changes dot (`● `). */
  prefix?: string;
  /** After the steps: ` · /query`, a value being typed, the loop status. */
  suffix?: string;
}>;

/** The plain title, as tests and logs read it: `≡ Arrange › range`. */
export function crumbText(crumbs: Crumbs, unicode = true): string {
  return crumbSegments(crumbs, Number.POSITIVE_INFINITY, unicode)
    .map((segment) => segment.text)
    .join("");
}

/** At least this much of the current step shows before the suffix gives way. */
const MIN_HERE = 6;

/** The breadcrumb as painted segments, fitting `width` columns. */
export function crumbSegments(
  crumbs: Crumbs,
  width: number,
  unicode = true,
): CrumbSegment[] {
  const mark = unicode ? MENU_MARK.mark : MENU_MARK.ascii;
  const sep = ` ${unicode ? CRUMB_SEPARATOR.mark : CRUMB_SEPARATOR.ascii} `;
  const fold = unicode ? CRUMB_ELISION.mark : CRUMB_ELISION.ascii;
  const prefix = crumbs.prefix ?? "";
  const suffix = crumbs.suffix ?? "";
  const steps = crumbs.steps.length ? crumbs.steps : ["menu"];
  const here = steps.at(-1)!;
  const parents = steps.slice(0, -1);
  const lead = displayWidth(prefix) + displayWidth(mark) + 1;
  // The suffix keeps its room unless the current step would drop below
  // MIN_HERE columns; then the suffix truncates instead. Never past width.
  const room = Math.max(
    0,
    Math.min(
      width - lead,
      Math.max(
        Math.min(displayWidth(here), MIN_HERE) +
          (parents.length ? displayWidth(`${fold}${sep}`) : 0),
        width - lead - displayWidth(suffix),
      ),
    ),
  );
  const fits = (shown: readonly string[]) =>
    displayWidth([...shown, here].join(sep)) <= room;
  // Keep the first step, fold the middle; then fold the first step too;
  // in a very narrow title, only the current step stays.
  let shown: string[] = parents;
  if (!fits(shown) && parents.length > 1) shown = [parents[0]!, fold];
  if (!fits(shown) && parents.length > 0) shown = [fold];
  if (
    shown.length > 0 &&
    room - displayWidth(`${fold}${sep}`) <
      Math.min(displayWidth(here), MIN_HERE)
  )
    shown = [];
  const out: CrumbSegment[] = [];
  if (prefix) out.push({ text: prefix, kind: "extra" });
  out.push({ text: mark, kind: "mark", role: MENU_MARK.role });
  out.push({ text: " ", kind: "step" });
  for (const step of shown) out.push({ text: `${step}${sep}`, kind: "step" });
  const before = displayWidth(shown.map((step) => `${step}${sep}`).join(""));
  const cut = truncate(here, Math.max(0, room - before), unicode ? "…" : "~");
  if (cut) out.push({ text: cut.replace(/\s+(…|~)$/, "$1"), kind: "here" });
  if (suffix) {
    const used = out.reduce(
      (sum, segment) => sum + displayWidth(segment.text),
      0,
    );
    const left = width - used;
    const text = Number.isFinite(left)
      ? truncate(suffix, left, unicode ? "…" : "~")
      : suffix;
    if (text) out.push({ text, kind: "extra" });
  }
  return out;
}

/**
 * Paint the breadcrumb on a box's top border at `x`, padded by a space each
 * side, within `width` columns: the mark in its role, parent steps dim, the
 * current step and the suffix bold. Returns the columns used.
 */
export function paintCrumbs(
  buffer: CellBuffer,
  x: number,
  y: number,
  crumbs: Crumbs,
  width: number,
  paint: Readonly<{
    roles: Readonly<Record<SemanticRole, Style>>;
    unicode: boolean;
    background: Style;
  }>,
): number {
  const { roles, background } = paint;
  if (width < 3) return 0;
  const bold = { ...roles.text, bold: true };
  let at = x;
  const end = x + width;
  const put = (text: string, style: Style) => {
    if (at < end)
      at += buffer.text(at, y, text, onBackground(style, background), end - at);
  };
  put(" ", bold);
  for (const segment of crumbSegments(crumbs, width - 2, paint.unicode))
    put(
      segment.text,
      segment.kind === "mark"
        ? { ...roles[segment.role ?? "text"], bold: true }
        : segment.kind === "step"
          ? roles.muted
          : bold,
    );
  put(" ", bold);
  return at - x;
}
