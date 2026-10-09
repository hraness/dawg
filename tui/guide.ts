/**
 * The `/guide` pane: the user guides (`guides/*.md`) as a tree that opens a
 * guide into a page. Pure: keys go in, rows come out; `tui/app.ts` paints.
 *
 *   tree   ↑↓ (j k) move · → l enter expand, then open · ← h collapse or
 *          go to the parent · / filter (title and text) · esc back
 *   page   ↑↓ (j k) scroll · pgup pgdn home end · ← h esc back to the tree
 */
import type { Guide } from "../guides/index.ts";
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
}>;

export type GuideView = Readonly<{
  title: string;
  rows: readonly GuideRow[];
  /** First row shown and the total, for a page longer than the pane. */
  scroll: number;
  hint: string;
}>;

export const GUIDE_HINTS = {
  tree: " ↑↓ move · → open · ← close · / filter · esc back · ? keys ",
  filtering: " type to filter · enter open · esc clear · ? keys ",
  page: " ↑↓ scroll · ← back · esc back · ? keys ",
} as const;

/**
 * `## Ask` → `── Ask`, `- x` → `• x`, code spans lose their backticks. The
 * blank line Markdown wants after a heading is dropped: in a pane the rule
 * already separates it.
 */
export function guideLines(body: string, unicode = true): GuideRow[] {
  const lines = body
    .split("\n")
    .filter(
      (line, index, all) =>
        line.trim() !== "" || !/^#{1,6}\s/.test(all[index - 1] ?? ""),
    );
  return lines.map((line) => {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading)
      return { text: `${unicode ? "──" : "--"} ${heading[1]}`, heading: true };
    const plain = line.replace(/`([^`]*)`/g, "$1");
    return { text: plain.replace(/^- /, unicode ? "• " : "- ") };
  });
}

/** Word-wrap rows to `width` columns; continuation lines indent under bullets. */
export function wrapRows(rows: readonly GuideRow[], width: number): GuideRow[] {
  const out: GuideRow[] = [];
  for (const row of rows) {
    if (displayWidth(row.text) <= width || width < 10) {
      out.push(row);
      continue;
    }
    const indent = /^[•-] /.test(row.text) ? "  " : "";
    let line = "";
    for (const word of row.text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && displayWidth(next) > width) {
        out.push({ ...row, text: line });
        line = indent + word;
      } else line = next;
    }
    if (line) out.push({ ...row, text: line });
  }
  return out;
}

/**
 * Words that open a child guide rather than their topic's root guide
 * (`/guide expression` is the performance guide, not Sound).
 */
const GUIDE_ALIASES: Readonly<Record<string, string>> = {
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
  genre: "styles",
  style: "styles",
  sections: "music",
  form: "music",
  automate: "automation",
  showme: "show-me",
  model: "providers",
  models: "providers",
  login: "providers",
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
  scroll = 0;

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
    this.page = guide.id;
    this.scroll = 0;
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
    if (this.visible().some((row) => row.guide.id === this.selected)) {
      this.page = this.selected;
      this.scroll = 0;
    }
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
      const total = this.pageLength();
      const max = Math.max(0, total - pageRows);
      const step =
        nav === "down" || value === "j"
          ? 1
          : nav === "up" || value === "k"
            ? -1
            : nav === "pgdn" || value === " "
              ? pageRows
              : nav === "pgup"
                ? -pageRows
                : nav === "home"
                  ? -total
                  : nav === "end"
                    ? total
                    : 0;
      if (step !== 0) {
        this.scroll = Math.max(0, Math.min(max, this.scroll + step));
        return "handled";
      }
      if (esc || left || value === "h" || value === "\u007f") {
        this.page = undefined;
        this.scroll = 0;
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

  private pageWidth = 72;

  private pageLength(): number {
    const guide = this.byId(this.page ?? "");
    return guide ? wrapRows(guideLines(guide.body), this.pageWidth).length : 0;
  }

  /** What to paint in a pane `width` columns wide and `height` rows tall. */
  view(width: number, height: number, unicode = true): GuideView {
    this.pageWidth = width;
    const page = this.page === undefined ? undefined : this.byId(this.page);
    if (page) {
      const rows = wrapRows(guideLines(page.body, unicode), width);
      const max = Math.max(0, rows.length - height);
      this.scroll = Math.max(0, Math.min(max, this.scroll));
      const crumb = page.parent ? `${this.byId(page.parent)?.title} › ` : "";
      return {
        title: `guide · ${crumb}${page.title}`.replace(
          "›",
          unicode ? "›" : ">",
        ),
        rows: rows.slice(this.scroll, this.scroll + height),
        scroll: this.scroll,
        hint: GUIDE_HINTS.page,
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
