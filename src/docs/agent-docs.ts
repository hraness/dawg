/**
 * The agent docs lens (design §8): one generator over three sources that
 * feeds the in-app `docs` tool, `dawg docs --agent` and the project
 * AGENTS.md.
 *
 * - Tool reference: generated from `AGENT_TOOLS` (name, one-line
 *   description, JSON schema) plus the prose in `AGENT_TOOL_DOCS`.
 * - Recipes: `docs/agent/recipes/*.md`, frontmatter `id, title, tools`,
 *   steps with ```tool JSON examples and ```dawg shell examples.
 * - Guides: the human guides (`guides/*.md`) seen through their ```agent
 *   blocks first, then the human text.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listGuides } from "../../guides/index.ts";
import { AGENT_TOOLS, type AgentTool } from "../agent/tools.ts";
import { AGENT_TOOL_DOCS } from "../agent/tool-docs.ts";
export {
  AGENTS_BEGIN,
  AGENTS_END,
  renderAgentsMd,
  upsertAgentsMd,
} from "./agents-md.ts";

export type AgentDocPage = Readonly<{
  id: string;
  title: string;
  kind: "tool" | "recipe" | "guide" | "index";
  body: string;
}>;

export type Recipe = Readonly<{
  id: string;
  title: string;
  tools: readonly string[];
  body: string;
}>;

/** One fenced example in a recipe: ```tool JSON or a ```dawg command line. */
export type RecipeExample =
  | Readonly<{
      kind: "tool";
      recipe: string;
      tool: string;
      args: Record<string, unknown>;
    }>
  | Readonly<{ kind: "dawg"; recipe: string; argv: readonly string[] }>;

export const RECIPES_DIR = fileURLToPath(
  new URL("../../docs/agent/recipes/", import.meta.url),
);

export const AGENT_DOCS_INDEX_BYTES = 2 * 1024;

/** Parses one recipe file; throws with the file name on a bad header. */
export function parseRecipe(text: string, file = "recipe"): Recipe {
  const match = text
    .replace(/\r\n/g, "\n")
    .match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: missing frontmatter`);
  const fields = new Map<string, string>();
  // Prettier may fold a long `tools: [...]` onto indented lines; join
  // continuation lines onto their field first.
  const lines: string[] = [];
  for (const line of match[1]!.split("\n")) {
    if (/^\s/.test(line) && lines.length > 0)
      lines[lines.length - 1] += ` ${line.trim()}`;
    else lines.push(line);
  }
  for (const line of lines) {
    const field = line.match(/^([a-z]+):\s*(.*)$/);
    if (!field) throw new Error(`${file}: bad frontmatter line "${line}"`);
    fields.set(field[1]!, field[2]!.trim());
  }
  const id = fields.get("id");
  const title = fields.get("title");
  const tools = fields.get("tools");
  if (!id || !/^[a-z0-9-]+$/.test(id)) throw new Error(`${file}: bad id`);
  if (!title) throw new Error(`${file}: missing title`);
  const list = tools?.match(/^\[(.*)\]$/);
  if (!list) throw new Error(`${file}: tools must be [a, b]`);
  return {
    id,
    title,
    tools: list[1]!
      .split(",")
      .map((word) => word.trim())
      .filter(Boolean),
    body: match[2]!.replace(/^\n+|\s+$/g, ""),
  };
}

let recipeCache: readonly Recipe[] | undefined;

/** Every recipe, sorted by id. */
export function listRecipes(dir: string = RECIPES_DIR): readonly Recipe[] {
  if (dir === RECIPES_DIR && recipeCache) return recipeCache;
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".md"));
  } catch {
    files = [];
  }
  const recipes = files
    .map((file) => parseRecipe(readFileSync(join(dir, file), "utf8"), file))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (dir === RECIPES_DIR) recipeCache = recipes;
  return recipes;
}

/** The fenced ```tool and ```dawg examples in a recipe body. */
export function recipeExamples(recipe: Recipe): RecipeExample[] {
  const out: RecipeExample[] = [];
  for (const block of recipe.body.matchAll(
    /^```(tool|dawg)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm,
  )) {
    const text = block[2]!.trim();
    if (block[1] === "tool") {
      const value = JSON.parse(text) as { tool?: unknown; args?: unknown };
      if (typeof value.tool !== "string")
        throw new Error(`${recipe.id}: tool example without "tool"`);
      out.push({
        kind: "tool",
        recipe: recipe.id,
        tool: value.tool,
        args: (value.args ?? {}) as Record<string, unknown>,
      });
    } else
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        out.push({
          kind: "dawg",
          recipe: recipe.id,
          argv: shellWords(trimmed),
        });
      }
  }
  return out;
}

/** Splits a command line on spaces, honouring "double" and 'single' quotes. */
export function shellWords(line: string): string[] {
  const words: string[] = [];
  for (const match of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g))
    words.push(match[1] ?? match[2] ?? match[3]!);
  return words;
}

function advertised(): readonly AgentTool[] {
  return AGENT_TOOLS.filter((tool) => !tool.hidden);
}

type Schema = {
  type?: unknown;
  enum?: unknown[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  description?: string;
  minimum?: number;
  maximum?: number;
};

function typeLabel(schema: Schema): string {
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.map(String);
    return values.length > 12
      ? `${values.slice(0, 12).join("|")}|… (${values.length})`
      : values.join("|");
  }
  const type = Array.isArray(schema.type)
    ? schema.type.join("|")
    : String(schema.type ?? "any");
  if (type === "array" && schema.items) return `${typeLabel(schema.items)}[]`;
  if (type === "object" && schema.properties)
    return `{${Object.keys(schema.properties).join(", ")}}`;
  const range =
    schema.minimum !== undefined || schema.maximum !== undefined
      ? ` ${schema.minimum ?? ""}..${schema.maximum ?? ""}`
      : "";
  return `${type}${range}`;
}

/** The argument list of one tool, one line per property. */
export function toolArgLines(tool: AgentTool): string[] {
  const schema = tool.parameters as Schema;
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, prop]) => {
    const desc = prop.description ? ` · ${prop.description}` : "";
    return `- ${name}${required.has(name) ? "" : "?"}: ${typeLabel(prop)}${desc}`;
  });
}

function toolPage(tool: AgentTool, recipes: readonly Recipe[]): AgentDocPage {
  const doc = AGENT_TOOL_DOCS[tool.name];
  const args = toolArgLines(tool);
  const used = recipes.filter((recipe) => recipe.tools.includes(tool.name));
  const lines = [
    `# ${tool.name}`,
    "",
    tool.description,
    "",
    "## Arguments",
    ...(args.length > 0 ? args : ["(none)"]),
  ];
  if (doc?.details) lines.push("", "## Details", doc.details);
  if (doc?.example)
    lines.push(
      "",
      "## Example",
      "```tool",
      JSON.stringify({ tool: tool.name, args: doc.example }),
      "```",
    );
  if (used.length > 0)
    lines.push(
      "",
      `Recipes: ${used.map((recipe) => `recipe/${recipe.id}`).join(", ")}`,
    );
  return {
    id: `tool/${tool.name}`,
    title: tool.name,
    kind: "tool",
    body: lines.join("\n"),
  };
}

/** Every page: tools, recipes, guides (each kind sorted by id). */
export function agentDocs(): readonly AgentDocPage[] {
  const recipes = listRecipes();
  const tools = [...advertised()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => toolPage(tool, recipes));
  const recipePages = recipes.map<AgentDocPage>((recipe) => ({
    id: `recipe/${recipe.id}`,
    title: recipe.title,
    kind: "recipe",
    body: `# ${recipe.title}\n\nTools: ${recipe.tools.join(", ")}\n\n${recipe.body}`,
  }));
  const guides = listGuides().map<AgentDocPage>((guide) => ({
    id: `guide/${guide.id}`,
    title: guide.title,
    kind: "guide",
    body: [
      `# ${guide.title}`,
      ...(guide.agentBody ? ["", "## For the agent", guide.agentBody] : []),
      "",
      "## Guide",
      guide.body,
    ].join("\n"),
  }));
  return [...recipePages, ...tools, ...guides];
}

/** ≤ 2 KiB: how to read the docs, every recipe, guide ids and the tool count. */
export function agentDocsIndex(): string {
  const recipes = listRecipes();
  const tools = advertised();
  const guides = listGuides();
  const lines = [
    "dawg agent docs · docs {page} reads one page (cursor pages long ones), docs {search} finds pages.",
    `Pages: tool/<name> (${tools.length} tools, same names as your tool list), recipe/<id>, guide/<id>.`,
    "Recipes:",
    ...recipes.map((recipe) => `- recipe/${recipe.id}: ${recipe.title}`),
    `Guides: ${guides.map((guide) => guide.id).join(" ")}`,
  ];
  let text = lines.join("\n");
  while (Buffer.byteLength(text) > AGENT_DOCS_INDEX_BYTES)
    text = text.slice(0, text.lastIndexOf(" "));
  return text;
}

/** A page by id (`tool/audio`) or bare name (`audio`, `chop-a-break`). */
export function findAgentDoc(ref: string): AgentDocPage | undefined {
  const pages = agentDocs();
  const key = ref
    .trim()
    .toLowerCase()
    .replace(/^tool:/, "tool/");
  if (key === "index")
    return {
      id: "index",
      title: "index",
      kind: "index",
      body: agentDocsIndex(),
    };
  return (
    pages.find((page) => page.id === key) ??
    pages.find((page) => page.id === `tool/${key}`) ??
    pages.find((page) => page.id === `recipe/${key}`) ??
    pages.find((page) => page.id === `guide/${key}`)
  );
}

/** Pages whose title or body mention `query`, with the first hit line. */
export function searchAgentDocs(query: string, max = 12): string {
  const needle = query.trim().toLowerCase();
  if (!needle) return agentDocsIndex();
  const hits: string[] = [];
  for (const page of agentDocs()) {
    const lower = page.body.toLowerCase();
    const at = lower.indexOf(needle);
    if (at < 0 && !page.id.includes(needle)) continue;
    const lineStart = at < 0 ? 0 : lower.lastIndexOf("\n", at) + 1;
    const lineEnd = at < 0 ? -1 : lower.indexOf("\n", at);
    const line = page.body
      .slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
      .trim()
      .slice(0, 120);
    hits.push(`${page.id}: ${line}`);
  }
  if (hits.length === 0) return `no docs mention "${query.slice(0, 40)}"`;
  const shown = hits.slice(0, max);
  if (hits.length > max)
    shown.push(`(${hits.length - max} more; narrow the search)`);
  return shown.join("\n");
}

/** `maxBytes` of `body` from line `cursor`, ending "(cursor=N for more)". */
export function pageSlice(
  body: string,
  cursor: number,
  maxBytes: number,
): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let bytes = 0;
  let index = cursor;
  for (; index < lines.length; index += 1) {
    const size = Buffer.byteLength(lines[index]!) + 1;
    if (bytes + size > maxBytes - 32 && out.length > 0) break;
    out.push(
      size > maxBytes - 32
        ? lines[index]!.slice(0, maxBytes - 64)
        : lines[index]!,
    );
    bytes += size;
  }
  if (index < lines.length) out.push(`(cursor=${index} for more)`);
  return out.join("\n");
}

export const DOCS_USAGE =
  "usage: dawg docs --agent [page | --search words | --write] · page: tool/<name>, recipe/<id>, guide/<id>";
