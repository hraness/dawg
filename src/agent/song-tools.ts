/** Writing a whole hyperpop song as a distilled song sheet. */
import {
  compileSheet,
  critique,
  exampleSheets,
  PLAYBOOK,
  validateSheet,
} from "../../core/distill/hyperpop/index.ts";
import type { AgentTool } from "./tools.ts";
import { ToolArgumentError } from "./tool-error.ts";

function invalid(message: string): never {
  throw new ToolArgumentError(message);
}

export const SONG_TOOLS = Object.freeze([
  {
    name: "song_guide",
    description:
      "Read-only. The hyperpop song-sheet playbook (form, harmony, melody, patterns) and a worked example sheet. Read it before write_song.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    plan(args) {
      if (Object.keys(args).length > 0)
        invalid("song_guide takes no arguments");
      const summary = "song guide · hyperpop sheet";
      const content = JSON.stringify({
        playbook: PLAYBOOK,
        example: exampleSheets()[0],
        usage:
          "write_song takes a sheet like the example and replaces the current song in one undoable edit; use only when asked to write or start a new song.",
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
    name: "write_song",
    description:
      "Replace the current song with a complete hyperpop track compiled from a song sheet (see song_guide), in one undoable edit. Use when the user asks for a new song.",
    parameters: {
      type: "object",
      properties: { sheet: { type: "object" } },
      required: ["sheet"],
      additionalProperties: false,
    },
    plan(args) {
      if (Object.keys(args).some((key) => key !== "sheet"))
        invalid("write_song accepts only sheet");
      const checked = validateSheet(args.sheet);
      if (!checked.ok)
        invalid(
          `the sheet needs fixes: ${checked.errors.slice(0, 8).join("; ")}`,
        );
      const next = compileSheet(checked.sheet);
      const review = critique(checked.sheet);
      const notes = [...review.notes, ...checked.warnings].slice(0, 6);
      const summary = `song · ${checked.sheet.title} · ${checked.sheet.key} · critic ${review.score}${notes.length ? ` · could improve: ${notes.join("; ")}` : ""}`;
      return { kind: "replace", next, summary };
    },
  },
] satisfies AgentTool[]);
