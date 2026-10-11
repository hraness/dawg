/**
 * The `docs` tool: the agent docs lens (src/docs/agent-docs.ts) from inside
 * a turn. No args → the index (≤ 2 KiB); `page` → one page, 6 KiB at a time
 * (`cursor` continues); `search` → matching page ids with the hit line.
 *
 * The generator imports the tool list, so it is loaded lazily here to keep
 * tools.ts free of an import cycle.
 */
import type { AgentTool, ActionResult } from "./tools.ts";
import { ToolArgumentError } from "./tool-error.ts";

export const DOCS_PAGE_BYTES = 6 * 1024;

const docsTool: AgentTool = {
  name: "docs",
  description:
    "Read the agent docs: no args for the index, page for one tool, recipe or guide (cursor pages), search for matching pages.",
  parameters: {
    type: "object",
    properties: {
      page: { type: "string", maxLength: 80 },
      search: { type: "string", maxLength: 80 },
      cursor: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
  plan(args) {
    const page = optional(args.page, "page");
    const search = optional(args.search, "search");
    if (page !== undefined && search !== undefined)
      throw new ToolArgumentError("pass page or search, not both");
    const cursor = args.cursor === undefined ? 0 : args.cursor;
    if (!Number.isInteger(cursor) || (cursor as number) < 0)
      throw new ToolArgumentError("cursor must be a non-negative integer");
    return {
      kind: "action",
      summary: page
        ? `docs · ${page}`
        : search
          ? `docs · search ${search}`
          : "docs · index",
      async run(): Promise<ActionResult> {
        const docs = await import("../docs/agent-docs.ts");
        if (search !== undefined) {
          return { content: docs.searchAgentDocs(search), summary: "docs search" };
        }
        if (page === undefined)
          return { content: docs.agentDocsIndex(), summary: "docs index" };
        const found = docs.findAgentDoc(page);
        if (!found)
          throw new ToolArgumentError(
            `no docs page "${page}" · call docs with no args for the index`,
          );
        return {
          content: docs.pageSlice(found.body, cursor as number, DOCS_PAGE_BYTES),
          summary: `docs ${found.id}`,
        };
      },
    };
  },
};

function optional(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim())
    throw new ToolArgumentError(`${name} must be a non-empty string`);
  return value.trim();
}

export const DOCS_TOOLS: readonly AgentTool[] = [docsTool];
