/**
 * The user guides: one Markdown file per feature in this directory, each with
 * a tiny frontmatter block (`id`, `title`, `order`, optional `parent`). The
 * TUI's `/guide` pane and the dawg.sh docs render the same files.
 *
 * Only `node:fs`, `node:path` and `node:url`, so the site can import it too:
 * `listGuides(join(process.cwd(), "..", "guides"))`.
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

/**
 * The docs' marks: one symbol per kind of line, shared by the TUI's `/guide`
 * pane, `/help` and the dawg.sh docs. The symbol carries the meaning, so a
 * page reads the same under NO_COLOR, the mono theme and ASCII; color only
 * repeats it. `role` names a tui/theme.ts role and never a knob color
 * (knob1-4 are reserved for the four knobs).
 */
export interface DocMark {
  /** The symbol in a Unicode terminal and on the site. */
  readonly mark: string;
  /** The symbol when the terminal has no Unicode (TERM=dumb). */
  readonly ascii: string;
  readonly role:
    | "agent"
    | "transport"
    | "loopRule"
    | "track"
    | "success"
    | "warning"
    | "borderFocus"
    | "promptText";
}

/** `## <heading>` → its mark. Other headings get the plain rule. */
export const SECTION_MARKS: Readonly<Record<string, DocMark>> = {
  Ask: { mark: "✦", ascii: "*", role: "agent" },
  "Type it yourself": { mark: "›", ascii: ">", role: "transport" },
  Menu: { mark: "≡", ascii: "=", role: "loopRule" },
  Keys: { mark: "⌃", ascii: "^", role: "track" },
  Next: { mark: "→", ascii: "->", role: "borderFocus" },
};

/** A heading with no mark of its own (Mouse, Try). */
export const RULE_MARK: DocMark = {
  mark: "──",
  ascii: "--",
  role: "borderFocus",
};

/** `- Tip: …` and `- Careful: …` bullets. */
export const NOTE_MARKS: Readonly<Record<"Tip" | "Careful", DocMark>> = {
  Tip: { mark: "✓", ascii: "+", role: "success" },
  Careful: { mark: "!", ascii: "!", role: "warning" },
};

/**
 * A typed command (a `code` span): no symbol of its own, so it is drawn
 * bold in this role; where bold is unavailable (TERM=dumb) the backticks
 * stay in the text.
 */
export const CODE_ROLE: DocMark["role"] = "promptText";
