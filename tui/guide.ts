/**
 * The `/guide` pane: the user guides (`guides/*.md`) as a tree that opens a
 * guide into a page. Pure: keys go in, rows come out; `tui/app.ts` paints.
 *
 *   tree   ↑↓ (j k) move · → l enter expand, then open · ← h collapse or
 *          go to the parent · / filter (title and text) · esc back
 *   page   ↑↓ (j k) scroll · pgup pgdn home end · ← h esc back to the tree
 */
import {
  NOTE_MARKS,
  RULE_MARK,
  SECTION_MARKS,
  type DocMark,
  type Guide,
} from "../guides/index.ts";
import { resolveTopic } from "../src/lang/glossary.ts";
import { overlayKey } from "./keys.ts";
import { displayWidth } from "./text.ts";

export type GuideRow = Readonly<{
  text: string;
  /** The highlighted tree row. */
  selected?: boolean;
  /** A `##` heading in a page. */
  heading?: boolean;
  /** Secondary text (a filter line, an empty result). */
  muted?: boolean;
  /**
   * The row's leading mark (guides/index.ts DOC_MARKS): its length in
   * characters and the theme role that colors it. The symbol itself is in
   * `text`, so it reads without color.
   */
  mark?: Readonly<{ length: number; role: DocMark["role"] }>;
  /** Typed commands (`code` spans): [start, end) character ranges in `text`. */
  code?: readonly (readonly [number, number])[];
}>;

export type GuideView = Readonly<{
  title: string;
  rows: readonly GuideRow[];
  /** First row shown, for a page taller than the pane. */
  scroll: number;
  hint: string;
}>;

export const GUIDE_HINTS = {
  tree: " ↑↓ move · → open · ← close · / filter · esc back · ? keys ",
  filtering: " type to filter · enter open · esc clear · ? keys ",
  page: " n next · p prev · ← guides · esc back · ? keys ",
} as const;

const symbol = (mark: DocMark, unicode: boolean) =>
  unicode ? mark.mark : mark.ascii;

/** Strip code-span backticks, keeping where each span sat. */
function spans(
  line: string,
  offset: number,
  strip = true,
): {
  text: string;
  code: [number, number][];
} {
  if (!strip) return { text: line, code: [] };
  const code: [number, number][] = [];
  let text = "";
  for (const part of line.split(/(`[^`]*`)/)) {
    if (/^`[^`]*`$/.test(part)) {
      const inner = part.slice(1, -1);
      code.push([offset + text.length, offset + text.length + inner.length]);
      text += inner;
    } else text += part;
  }
  return { text, code };
}

/**
 * One row per source line. `## Ask` → `✦ Ask` (each template heading has its
 * own mark, others get `──`), `- x` → `• x`, `- Tip: x` → `✓ Tip: x`, and
 * code spans lose their backticks but keep their ranges. The blank line
 * Markdown wants after a heading is dropped: the mark already separates it.
 */
export function guideLines(body: string, unicode = true): GuideRow[] {
  const lines = body
    .split("\n")
    .filter(
      (line, index, all) =>
        line.trim() !== "" || !/^#{1,6}\s/.test(all[index - 1] ?? ""),
    );
  return lines.map((line): GuideRow => {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      const mark = SECTION_MARKS[heading[1]!] ?? RULE_MARK;
      const sign = symbol(mark, unicode);
      return {
        text: `${sign} ${heading[1]}`,
        heading: true,
        mark: { length: sign.length, role: mark.role },
      };
    }
    const note = line.match(/^- (Tip|Careful): /);
    if (note) {
      const mark = NOTE_MARKS[note[1] as keyof typeof NOTE_MARKS];
      const sign = symbol(mark, unicode);
      const rest = spans(line.slice(2), sign.length + 1, unicode);
      return {
        text: `${sign} ${rest.text}`,
        mark: { length: sign.length, role: mark.role },
        ...(rest.code.length > 0 ? { code: rest.code } : {}),
      };
    }
    const bullet = line.startsWith("- ");
    const rest = bullet
      ? spans(line.slice(2), 2, unicode)
      : spans(line, 0, unicode);
    const text = bullet ? `${unicode ? "•" : "-"} ${rest.text}` : rest.text;
    return rest.code.length > 0 ? { text, code: rest.code } : { text };
  });
}

/**
 * Word-wrap rows to `width` columns; continuation lines indent under a
 * bullet or mark, and code ranges follow their words onto the next line.
 */
export function wrapRows(rows: readonly GuideRow[], width: number): GuideRow[] {
  const out: GuideRow[] = [];
  for (const row of rows) {
    if (displayWidth(row.text) <= width || width < 10) {
      out.push(row);
      continue;
    }
    const lead = row.text.match(/^(\S{1,2}) /);
    const indent =
      lead && (row.mark !== undefined || /^[•-]$/.test(lead[1]!))
        ? " ".repeat(displayWidth(lead[1]!) + 1)
        : "";
    const words = row.text.split(" ");
    const starts: number[] = [];
    let at = 0;
    for (const word of words) {
      starts.push(at);
      at += word.length + 1;
    }
    let first = 0;
    const flush = (last: number) => {
      const from = starts[first]!;
      const to = starts[last]! + words[last]!.length;
      const prefix = first === 0 ? "" : indent;
      const shift = prefix.length - from;
      const code = (row.code ?? [])
        .filter(([a, b]) => b > from && a < to)
        .map(
          ([a, b]) =>
            [Math.max(a, from) + shift, Math.min(b, to) + shift] as const,
        );
      const { code: _drop, mark, ...rest } = row;
      out.push({
        ...rest,
        text: prefix + row.text.slice(from, to),
        ...(first === 0 && mark ? { mark } : {}),
        ...(code.length > 0 ? { code } : {}),
      });
    };
    for (let index = 1; index < words.length; index += 1) {
      const from = starts[first]!;
      const end = starts[index]! + words[index]!.length;
      const prefix = first === 0 ? 0 : displayWidth(indent);
      if (displayWidth(row.text.slice(from, end)) + prefix > width) {
        flush(index - 1);
        first = index;
      }
    }
    flush(words.length - 1);
  }
  return out;
}

/**
 * A guide as pages for a pane `height` rows tall: whole `##` sections packed
 * in order, a new page when the next section would not fit. A section taller
 * than the pane gets a page of its own, which scrolls.
 */
export function paginate(
  rows: readonly GuideRow[],
  height: number,
): GuideRow[][] {
  const trim = (block: GuideRow[]) => {
    let a = 0;
    let b = block.length;
    while (a < b && block[a]!.text.trim() === "") a += 1;
    while (b > a && block[b - 1]!.text.trim() === "") b -= 1;
    return block.slice(a, b);
  };
  const blocks: GuideRow[][] = [];
  for (const row of rows) {
    if (row.heading || blocks.length === 0) blocks.push([]);
    blocks.at(-1)!.push(row);
  }
  const pages: GuideRow[][] = [];
  let page: GuideRow[] = [];
  for (const block of blocks) {
    const body = trim(block);
    if (body.length === 0) continue;
    const joined = page.length > 0 ? [...page, { text: "" }, ...body] : body;
    if (page.length > 0 && joined.length > height) {
      pages.push(page);
      page = body;
    } else page = joined;
  }
  if (page.length > 0) pages.push(page);
  return pages.length > 0 ? pages : [[]];
}

/**
 * Words that open a child guide rather than their topic's root guide
 * (`/guide expression` is the performance guide, not Sound).
 */
export const GUIDE_ALIASES: Readonly<Record<string, string>> = {
  expression: "performance",
  instrument: "sounds",
  instruments: "sounds",
  presets: "sounds",
  samples: "media",
  stems: "media",
  grains: "resample",
  granular: "resample",
  scl: "tuning",
  edo: "tuning",
  meter: "tempo",
  time: "tempo",
  style: "styles",
  sections: "music",
  form: "music",
  automate: "automation",
  showme: "show-me",
  model: "providers",
  models: "providers",
  search: "web-search",
  web: "web-search",
  mouse: "faders",
  menu: "audition",
};

export class GuideBrowser {
  readonly guides: readonly Guide[];
  /** Expanded parents in the tree. */
  readonly expanded = new Set<string>();
  /** Highlighted guide id in the tree. */
  selected: string;
  query = "";
  filtering = false;
  /** The guide open as a page, or undefined in the tree. */
  page: string | undefined;
  /** Which page of the open guide shows (0 first); clamped when drawn. */
  sheet = 0;
  scroll = 0;
  /** At the end of the last page: resizes keep the end in view. */
  private atEnd = false;
  /** The pane size from the last view(), so keys page the same way. */
  private paneWidth = 72;
  private paneHeight = 0;

  constructor(guides: readonly Guide[], open?: string) {
    this.guides = guides;
    this.selected = guides[0]?.id ?? "";
    if (open) this.open(open);
  }

  /**
   * Open a guide by id, topic alias or title word (`/guide chords`,
   * `/guide scale`, `/guide using`); false if unknown.
   */
  open(name: string): boolean {
    const word = name.trim().toLowerCase().replace(/^\//, "");
    const alias = GUIDE_ALIASES[word] ?? resolveTopic(word);
    const guide =
      this.guides.find((g) => g.id === word) ??
      (alias ? this.guides.find((g) => g.id === alias) : undefined) ??
      (word.length >= 3
        ? (this.guides.find((g) => g.title.toLowerCase().startsWith(word)) ??
          this.guides.find((g) => g.id.includes(word)))
        : undefined);
    if (!guide) return false;
    for (let p = guide.parent; p; p = this.byId(p)?.parent)
      this.expanded.add(p);
    this.selected = guide.id;
    this.show(guide.id, 0);
    return true;
  }

  get typing(): boolean {
    return this.page === undefined && this.filtering;
  }

  private byId(id: string): Guide | undefined {
    return this.guides.find((g) => g.id === id);
  }

  private children(id: string | undefined): Guide[] {
    return this.guides.filter((g) => g.parent === id);
  }

  /** Guides matching the filter, plus their ancestors; all when no filter. */
  private matches(): Set<string> | undefined {
    const query = this.query.trim().toLowerCase();
    if (!query) return undefined;
    const keep = new Set<string>();
    for (const guide of this.guides) {
      const text = `${guide.title}\n${guide.body}`.toLowerCase();
      if (!text.includes(query)) continue;
      for (let g: Guide | undefined = guide; g; g = this.byId(g.parent ?? ""))
        keep.add(g.id);
    }
    return keep;
  }

  /** The tree rows shown now, in order, with their depth. */
  visible(): { guide: Guide; depth: number }[] {
    const keep = this.matches();
    const out: { guide: Guide; depth: number }[] = [];
    const visit = (parent: string | undefined, depth: number) => {
      for (const guide of this.children(parent)) {
        if (keep && !keep.has(guide.id)) continue;
        out.push({ guide, depth });
        if (keep || this.expanded.has(guide.id)) visit(guide.id, depth + 1);
      }
    };
    visit(undefined, 0);
    return out;
  }

  private move(step: number): void {
    const rows = this.visible();
    if (rows.length === 0) return;
    const at = Math.max(
      0,
      rows.findIndex((row) => row.guide.id === this.selected),
    );
    const next = Math.max(0, Math.min(rows.length - 1, at + step));
    this.selected = rows[next]!.guide.id;
  }

  /** Keep the selection on a visible row after the filter changes. */
  private settle(): void {
    const rows = this.visible();
    if (!rows.some((row) => row.guide.id === this.selected))
      this.selected = rows[0]?.guide.id ?? this.selected;
  }

  private openSelected(): void {
    if (this.visible().some((row) => row.guide.id === this.selected))
      this.show(this.selected, 0);
  }

  /** Show page `sheet` of a guide (Infinity: its last page) from the top. */
  private show(id: string, sheet: number): void {
    this.page = id;
    this.sheet = sheet;
    this.scroll = 0;
    this.atEnd = false;
  }

  /** The open guide's pages for the pane, and the clamped current one. */
  private sheets(unicode = true): GuideRow[][] {
    const guide = this.byId(this.page ?? "");
    if (!guide) return [[]];
    const height = Math.max(1, this.paneHeight);
    const pages = paginate(
      wrapRows(guideLines(guide.body, unicode), this.paneWidth),
      height,
    );
    this.sheet = Math.max(0, Math.min(pages.length - 1, this.sheet));
    return pages;
  }

  /** The guide after (1) or before (-1) the open one, in tree order. */
  private neighbour(step: 1 | -1): Guide | undefined {
    const at = this.guides.findIndex((g) => g.id === this.page);
    return at < 0 ? undefined : this.guides[at + step];
  }

  /** Next page, or the first page of the next guide; false at the very end. */
  private turn(step: 1 | -1): void {
    const pages = this.sheets();
    const sheet = this.sheet + step;
    if (sheet >= 0 && sheet < pages.length) {
      this.sheet = sheet;
      this.scroll = 0;
      this.atEnd = false;
      return;
    }
    const next = this.neighbour(step);
    if (!next) return;
    for (let p = next.parent; p; p = this.byId(p)?.parent) this.expanded.add(p);
    this.selected = next.id;
    this.show(next.id, step > 0 ? 0 : Infinity);
  }

  /**
   * One key. `close` means Esc at the top level; `handled` that it changed
   * (or deliberately swallowed) something; `ignored` that it was not ours.
   * `pageRows` is the page height, for pgup/pgdn and clamping.
   */
  key(value: string, pageRows = 10): "handled" | "close" | "ignored" {
    const nav = overlayKey(value);
    const left = value === "\u001b[D" || value === "\u001bOD";
    const right = value === "\u001b[C" || value === "\u001bOC";
    const esc = value === "\u001b";
    if (this.page !== undefined) {
      if (this.paneHeight === 0) this.paneHeight = pageRows;
      const rows = this.paneHeight;
      const pages = this.sheets();
      const total = pages[this.sheet]!.length;
      const max = Math.max(0, total - rows);
      const scrollTo = (scroll: number) => {
        this.scroll = Math.max(0, Math.min(max, scroll));
        this.atEnd = max > 0 && this.scroll === max;
        return "handled" as const;
      };
      if (nav === "down" || value === "j") return scrollTo(this.scroll + 1);
      if (nav === "up" || value === "k") return scrollTo(this.scroll - 1);
      // Space and pgdn read on through a tall page, then turn it.
      if ((nav === "pgdn" || value === " ") && this.scroll < max)
        return scrollTo(this.scroll + rows);
      if (nav === "pgup" && this.scroll > 0)
        return scrollTo(this.scroll - rows);
      if (nav === "pgdn" || value === " " || value === "n" || right) {
        this.turn(1);
        return "handled";
      }
      if (nav === "pgup" || value === "p") {
        this.turn(-1);
        return "handled";
      }
      if (nav === "home") {
        this.sheet = 0;
        this.atEnd = false;
        this.scroll = 0;
        return "handled";
      }
      if (nav === "end") {
        this.sheet = pages.length - 1;
        const last = pages[this.sheet]!.length;
        this.scroll = Math.max(0, last - rows);
        this.atEnd = last > rows;
        return "handled";
      }
      if (esc || left || value === "h" || value === "\u007f") {
        this.page = undefined;
        this.sheet = 0;
        this.scroll = 0;
        this.atEnd = false;
        return "handled";
      }
      return "handled";
    }
    if (this.filtering) {
      if (esc) {
        this.query = "";
        this.filtering = false;
        this.settle();
        return "handled";
      }
      if (value === "\u007f" || value === "\b") {
        this.query = this.query.slice(0, -1);
        if (!this.query) this.filtering = false;
        this.settle();
        return "handled";
      }
      if (nav === "enter") {
        this.filtering = false;
        this.openSelected();
        return "handled";
      }
      if (nav === "up" || nav === "down") {
        this.filtering = false;
        this.move(nav === "up" ? -1 : 1);
        return "handled";
      }
      if (!value.startsWith("\u001b") && value >= " " && value.length <= 4) {
        this.query = (this.query + value).slice(0, 40);
        this.settle();
        return "handled";
      }
      return "handled";
    }
    if (nav === "up" || value === "k") return this.moved(-1);
    if (nav === "down" || value === "j") return this.moved(1);
    if (nav === "pgup") return this.moved(-pageRows);
    if (nav === "pgdn") return this.moved(pageRows);
    if (nav === "home") return this.moved(-this.guides.length);
    if (nav === "end") return this.moved(this.guides.length);
    if (value === "/") {
      this.filtering = true;
      return "handled";
    }
    const hasChildren = this.children(this.selected).length > 0;
    const open = this.query !== "" || this.expanded.has(this.selected);
    if (right || value === "l" || nav === "enter") {
      if (hasChildren && !open) this.expanded.add(this.selected);
      else this.openSelected();
      return "handled";
    }
    if (left || value === "h") {
      if (hasChildren && this.expanded.has(this.selected) && !this.query)
        this.expanded.delete(this.selected);
      else {
        const parent = this.byId(this.selected)?.parent;
        if (parent) this.selected = parent;
      }
      return "handled";
    }
    if (esc) {
      if (this.query) {
        this.query = "";
        this.settle();
        return "handled";
      }
      return "close";
    }
    return "ignored";
  }

  private moved(step: number): "handled" {
    this.move(step);
    return "handled";
  }

  /** What to paint in a pane `width` columns wide and `height` rows tall. */
  view(width: number, height: number, unicode = true): GuideView {
    this.paneWidth = width;
    this.paneHeight = Math.max(1, height);
    const page = this.page === undefined ? undefined : this.byId(this.page);
    if (page) {
      const pages = this.sheets(unicode);
      const rows = pages[this.sheet]!;
      const max = Math.max(0, rows.length - height);
      // Pinned to the end at the last page: a resize keeps the end in view.
      this.scroll = this.atEnd ? max : Math.max(0, Math.min(max, this.scroll));
      const crumb = page.parent ? `${this.byId(page.parent)?.title} › ` : "";
      const count =
        pages.length > 1 ? ` · ${this.sheet + 1}/${pages.length}` : "";
      const next = this.neighbour(1);
      const last = this.sheet === pages.length - 1;
      return {
        title: `guide · ${crumb}${page.title}${count}`.replace(
          "›",
          unicode ? "›" : ">",
        ),
        rows: rows.slice(this.scroll, this.scroll + height),
        scroll: this.scroll,
        hint:
          last && next
            ? ` n next: ${next.title} · p prev · ← guides · ? keys `
            : GUIDE_HINTS.page,
      };
    }
    const visible = this.visible();
    const rows: GuideRow[] = visible.map(({ guide, depth }) => {
      const parent = this.children(guide.id).length > 0;
      const open = this.query !== "" || this.expanded.has(guide.id);
      const marker = parent
        ? open
          ? unicode
            ? "▾"
            : "v"
          : unicode
            ? "▸"
            : ">"
        : " ";
      return {
        text: `${"  ".repeat(depth)}${marker} ${guide.title}`,
        selected: guide.id === this.selected,
      };
    });
    if (rows.length === 0) rows.push({ text: "no guide matches", muted: true });
    const filter = this.filtering || this.query;
    if (filter)
      rows.unshift({
        text: `/ ${this.query}${this.filtering ? "_" : ""}`,
        muted: true,
      });
    const body = Math.max(1, height);
    const at = rows.findIndex((row) => row.selected);
    const scroll = Math.max(0, Math.min(rows.length - body, at - body + 2));
    return {
      title: "guide",
      rows: rows.slice(scroll, scroll + body),
      scroll,
      hint: this.filtering ? GUIDE_HINTS.filtering : GUIDE_HINTS.tree,
    };
  }
}
