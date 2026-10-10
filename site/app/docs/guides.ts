import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The TUI's guides, read from ../guides at build time so the docs and the
 * terminal show the same words. Each guide is a Markdown file whose front
 * matter names its place in the tree:
 *
 *   ---
 *   id: sessions
 *   title: Sessions
 *   parent: basics        (optional; omitted for a top-level guide)
 *   order: 2              (optional; sorts siblings, then title)
 *   ---
 *
 * The id defaults to the file name. A build with no guides fails.
 */
export interface Guide {
  readonly id: string;
  readonly title: string;
  readonly parent: string | null;
  readonly order: number;
  readonly body: string;
}

export const guidesDirectory = join(process.cwd(), "..", "guides");

const idPattern = /^[a-z0-9][a-z0-9-]*$/u;

function markdownFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return markdownFiles(path);
      return name.endsWith(".md") && name.toLowerCase() !== "readme.md"
        ? [path]
        : [];
    });
}

function frontMatter(source: string): {
  fields: Map<string, string>;
  body: string;
} {
  const match = source
    .replace(/\r\n/gu, "\n")
    .match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u);
  if (match === null) return { fields: new Map(), body: source };
  const fields = new Map<string, string>();
  for (const line of match[1]!.split("\n")) {
    const field = line.match(/^([A-Za-z]+):\s*(.*)$/u);
    if (field !== null)
      fields.set(field[1]!, field[2]!.trim().replace(/^(["'])(.*)\1$/u, "$2"));
  }
  return { fields, body: match[2]! };
}

/** Parses one guide file; exported for tests. */
export function parseGuide(source: string, fallbackId: string): Guide {
  const { fields, body } = frontMatter(source);
  const id = fields.get("id") ?? fallbackId;
  if (!idPattern.test(id)) throw new Error(`Guide id "${id}" is not a slug`);
  const heading = body.match(/^#\s+(.+)$/mu);
  const title = fields.get("title") ?? heading?.[1]?.trim();
  if (title === undefined || title === "")
    throw new Error(`Guide "${id}" has no title`);
  const parent = fields.get("parent");
  const order = Number(fields.get("order") ?? "0");
  return {
    id,
    title,
    parent: parent === undefined || parent === "" ? null : parent,
    order: Number.isFinite(order) ? order : 0,
    // The page renders the title itself, so a leading title heading is dropped.
    body: body.replace(/^\s*#\s+.+\n/u, "").trim(),
  };
}

/** Every guide, in tree order; empty when ../guides has none. */
export function listGuides(directory = guidesDirectory): Guide[] {
  const guides = markdownFiles(directory).map((path) =>
    parseGuide(
      readFileSync(path, "utf8"),
      relative(directory, path).replace(/\.md$/u, "").split(/[\\/]/u).at(-1)!,
    ),
  );
  const ids = new Set<string>();
  for (const guide of guides) {
    if (ids.has(guide.id))
      throw new Error(`Two guides use the id "${guide.id}"`);
    ids.add(guide.id);
  }
  for (const guide of guides)
    if (guide.parent !== null && !ids.has(guide.parent))
      throw new Error(
        `Guide "${guide.id}" names a missing parent "${guide.parent}"`,
      );
  return orderTree(guides);
}

/** Depth-first order: each parent, then its children by order and title. */
export function orderTree<
  T extends Pick<Guide, "id" | "parent" | "order" | "title">,
>(items: readonly T[]): T[] {
  const byParent = new Map<string | null, T[]>();
  for (const item of items) {
    const siblings = byParent.get(item.parent) ?? [];
    siblings.push(item);
    byParent.set(item.parent, siblings);
  }
  const out: T[] = [];
  const visit = (parent: string | null, seen: Set<string>) => {
    const children = (byParent.get(parent) ?? []).toSorted(
      (a, b) => a.order - b.order || a.title.localeCompare(b.title),
    );
    for (const child of children) {
      if (seen.has(child.id))
        throw new Error(`Guide "${child.id}" is in a cycle`);
      out.push(child);
      visit(child.id, new Set([...seen, child.id]));
    }
  };
  visit(null, new Set());
  if (out.length !== items.length)
    throw new Error("Some guides are unreachable from the top of the tree");
  return out;
}

/** The first paragraph of plain text, for page descriptions. */
export function guideSummary(body: string): string {
  const paragraph = body
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .find(
      (block) => block !== "" && !/^(#|```|[-*]\s|\d+\.\s|\||>)/u.test(block),
    );
  const text = (paragraph ?? "")
    .replace(/\s+/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[`*]/gu, "");
  return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
}
