/** Writing a whole hyperpop song as a distilled song sheet. */
import {
  compileSheet,
  critique,
  exampleSheets,
  PLAYBOOK,
  validateSheet,
} from "../../core/distill/hyperpop/index.ts";
import {
  briefConstraints,
  CARD_GUIDE,
  cardSchema,
  compileGenome,
  describeGenome,
  randomSeed,
  sampleGenome,
  songFromCard,
  validateCard,
} from "../../core/distill/hyperpop/genome/index.ts";
import type { AgentTool } from "./tools.ts";
import { ToolArgumentError } from "./tool-error.ts";

function invalid(message: string): never {
  throw new ToolArgumentError(message);
}

export const SONG_TOOLS = Object.freeze([
  {
    name: "song_guide",
    hidden: true,
    description:
      "Read-only. The song card guide, the hyperpop sheet playbook and a worked example sheet. Pass a brief and a seed to also get the constraints that seed draws for that brief, so the card's music can be written for them. Read it before compose_song or write_song.",
    parameters: {
      type: "object",
      properties: {
        brief: { type: "string", maxLength: 400 },
        seed: { type: "integer", minimum: 0, maximum: 2147483647 },
      },
      additionalProperties: false,
    },
    plan(args) {
      if (Object.keys(args).some((key) => key !== "brief" && key !== "seed"))
        invalid("song_guide accepts only brief and seed");
      if ((args.brief === undefined) !== (args.seed === undefined))
        invalid("pass brief and seed together, or neither");
      const seed = Number(args.seed);
      if (
        args.seed !== undefined &&
        (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31)
      )
        invalid("seed must be a whole number from 0 to 2147483647");
      const summary = "song guide · hyperpop sheet";
      const content = JSON.stringify({
        ...(typeof args.brief === "string"
          ? {
              constraints: briefConstraints(args.brief, seed),
              constraints_usage: `Write the card's music for these constraints, put "brief": the same brief in the card, and pass the same seed to compose_song.`,
            }
          : {}),
        playbook: PLAYBOOK,
        example: exampleSheets()[0],
        usage:
          "compose_song is the default for a new song: write a song card (see card_guide) and the composer draws a fresh arrangement from a seed, a different song every time. write_song takes a sheet like the example for a song shaped like the three demos. Both replace the current song in one undoable edit; use only when asked to write or start a new song.",
        card_guide: CARD_GUIDE,
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
    hidden: true,
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
  {
    name: "compose_song",
    hidden: true,
    description:
      "Replace the current song with a newly composed hyperpop track: a seeded genome picks groove, harmony, sounds, form and moves, and your song card (see song_guide card_guide) supplies the words, mood and any axes the user named. Omit card for an instrumental-word sketch; pass seed to repeat a song. One undoable edit.",
    parameters: {
      type: "object",
      properties: {
        card: cardSchema(),
        seed: { type: "integer", minimum: 0, maximum: 2147483647 },
      },
      additionalProperties: false,
    },
    plan(args) {
      if (Object.keys(args).some((key) => key !== "card" && key !== "seed"))
        invalid("compose_song accepts only card and seed");
      const seed = args.seed === undefined ? randomSeed() : Number(args.seed);
      if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31)
        invalid("seed must be a whole number from 0 to 2147483647");
      let song;
      let warnings: readonly string[] = [];
      if (args.card === undefined) song = compileGenome(sampleGenome(seed));
      else {
        const checked = validateCard(args.card);
        if (!checked.ok)
          invalid(`the card needs fixes: ${checked.errors.join("; ")}`);
        warnings = checked.warnings;
        song = songFromCard(checked.card, seed);
      }
      const summary = `song · ${song.title} · seed ${seed} · ${describeGenome(song.genome).slice(0, 3).join(" · ")}${warnings.length ? ` · notes: ${warnings.slice(0, 3).join("; ")}` : ""}`;
      return { kind: "replace", next: song.score, summary };
    },
  },
] satisfies AgentTool[]);
