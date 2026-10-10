/**
 * The user guides: one Markdown file per feature in this directory, each with
 * a tiny frontmatter block (`id`, `title`, `order`, optional `parent`). The
 * TUI's `/guide` pane and the dawg.sh docs render the same files.
 *
 * Only `node:fs`, `node:path` and `node:url`, so the site can import it too:
 * `listGuides(join(process.cwd(), "..", "guides"))`. The marks live in
 * ./marks.ts, which imports nothing, so client code can share them.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Guide {
  id: string;
  title: string;
  /** The parent guide's id; undefined for a top-level guide. */
  parent: string | undefined;
  /** Position among its siblings, smallest first. */
  order: number;
  /** Markdown after the frontmatter, without leading or trailing blank lines. */
  body: string;
}

/** This directory, where the `.md` guides live next to this file. */
export const GUIDES_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Parse one guide file; throws with the file name on a malformed header. */
export function parseGuide(text: string, file = "guide"): Guide {
  const match = text
    .replace(/\r\n/g, "\n")
    .match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: missing frontmatter`);
  const fields = new Map<string, string>();
  for (const line of match[1]!.split("\n")) {
    const field = line.match(/^([a-z]+):\s*(.*)$/);
    if (!field) throw new Error(`${file}: bad frontmatter line "${line}"`);
    fields.set(field[1]!, field[2]!.trim());
  }
  const id = fields.get("id");
  const title = fields.get("title");
  const order = Number(fields.get("order"));
  if (!id || !/^[a-z0-9-]+$/.test(id)) throw new Error(`${file}: bad id`);
  if (!title) throw new Error(`${file}: missing title`);
  if (!Number.isFinite(order)) throw new Error(`${file}: bad order`);
  return {
    id,
    title,
    parent: fields.get("parent") || undefined,
    order,
    body: match[2]!.replace(/^\n+|\s+$/g, ""),
  };
}

/**
 * Every guide in tree order: each top-level guide by `order`, followed by its
 * children by `order` (depth first).
 */
export function listGuides(dir: string = GUIDES_DIR): Guide[] {
  const guides = readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => parseGuide(readFileSync(join(dir, name), "utf8"), name));
  const byOrder = (a: Guide, b: Guide) =>
    a.order - b.order || a.id.localeCompare(b.id);
  const out: Guide[] = [];
  const visit = (parent: string | undefined) => {
    for (const guide of guides
      .filter((g) => g.parent === parent)
      .sort(byOrder)) {
      out.push(guide);
      visit(guide.id);
    }
  };
  visit(undefined);
  return out;
}

export * from "./marks.ts";
