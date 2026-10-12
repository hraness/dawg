/** Browsing and loading the same editable demo library as the TUI. */
import { createDemo } from "../../core/demos/index.ts";
import { findDemo, searchDemos } from "../commands/demo.ts";
import type { AgentTool } from "./tools.ts";
import { ToolArgumentError } from "./tool-error.ts";

function invalid(message: string): never {
  throw new ToolArgumentError(message);
}

export const DEMO_TOOLS = Object.freeze([
  {
    name: "list_demos",
    description:
      "Browse complete editable demo songs (read-only). Returns style, instruments, arrangement and mix notes; query searches styles and techniques.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", maxLength: 160 } },
      additionalProperties: false,
    },
    plan(args) {
      if (Object.keys(args).some((key) => key !== "query"))
        invalid("list_demos accepts only query");
      if (
        args.query !== undefined &&
        (typeof args.query !== "string" || args.query.length > 160)
      )
        invalid("query must be a string up to 160 characters");
      const demos = searchDemos((args.query as string | undefined) ?? "");
      const summary = `demos · ${demos.length} complete songs`;
      const content = JSON.stringify({
        demos,
        usage:
          "load_demo replaces the current song in one undoable edit; use only when asked to load or start from a demo.",
      });
      return {
        kind: "action",
        summary,
        async run() {
          return { content, summary };
        },
      };
    },
  },
  {
    name: "load_demo",
    description:
      "Replace the current song with a complete editable demo in one undoable edit. Use when the user asks to load or start from a demo; list_demos finds IDs and production notes. Every sound works offline.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", maxLength: 120 } },
      required: ["id"],
      additionalProperties: false,
    },
    plan(args) {
      if (Object.keys(args).some((key) => key !== "id"))
        invalid("load_demo accepts only id");
      if (typeof args.id !== "string" || args.id.length > 120)
        invalid("id must be a demo id; use list_demos");
      const demo = findDemo(args.id as string);
      if (!demo) invalid("unknown demo; use list_demos");
      const next = createDemo(demo.id);
      const summary = `demo · ${demo.title} · ${demo.style}`;
      return { kind: "replace", next, summary };
    },
  },
] satisfies AgentTool[]);
