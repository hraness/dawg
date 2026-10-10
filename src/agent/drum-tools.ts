/**
 * Agent tools for the drum pattern library and the synthesized kits:
 * `list_drum_patterns`, `apply_drum_pattern`, `set_drum_kit`. Patterns land
 * as rhythm rows (`set_rhythm` edits them afterwards), so a groove stays a
 * few parameters per voice instead of dozens of notes.
 */
import { diffScores } from "../../core/diff.ts";
import { SYNTH_KITS } from "../../core/kits.ts";
import { SCORE_LIMITS } from "../../core/score.ts";
import {
  applyDrumPattern,
  applySynthKit,
  DRUM_PATTERNS,
  patternLine,
} from "../commands/drums.ts";
import type { AgentTool, ToolContext } from "./tools.ts";
import { ToolArgumentError } from "./tools.ts";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function trackIdOf(args: Record<string, unknown>, context: ToolContext) {
  const trackId = args.trackId ?? context.focusedTrackId;
  if (typeof trackId !== "string" || !ID_PATTERN.test(trackId))
    throw new ToolArgumentError(
      "trackId must be 1-64 letters, digits, dot, dash, or underscore",
    );
  return trackId;
}

const trackId = {
  type: "string",
  maxLength: SCORE_LIMITS.maxIdLength,
  description:
    "Drum track id (created when missing). Defaults to the focused track.",
} as const;

export const DRUM_TOOLS: readonly AgentTool[] = Object.freeze([
  {
    name: "list_drum_patterns",
    description:
      "List the built-in grooves (name · tempo range · style tags · drums). Filter by a word such as house, trap or 2-step.",
    parameters: {
      type: "object",
      properties: { filter: { type: "string", maxLength: 40 } },
      additionalProperties: false,
    },
    plan(args) {
      const needle =
        typeof args.filter === "string" ? args.filter.trim().toLowerCase() : "";
      const lines = DRUM_PATTERNS.filter(
        (entry) =>
          !needle ||
          entry.name.includes(needle) ||
          entry.tags.some((tag) => tag.includes(needle)),
      ).map(patternLine);
      return {
        kind: "action",
        summary: needle ? `patterns ${needle}` : "list patterns",
        run: async () => ({
          content: JSON.stringify({
            ok: true,
            patterns: lines,
            hint: "apply_drum_pattern puts one on a drum track; set_rhythm then edits its rows",
          }),
          summary: `${lines.length} patterns`,
        }),
      };
    },
  },
  {
    name: "apply_drum_pattern",
    description:
      "Replace a drum track's notes with a library pattern as Euclidean/grid rhythm rows (one per voice). Moves the tempo into the pattern's range unless tempo is keep.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 40 },
        trackId,
        tempo: { type: "string", enum: ["auto", "keep", "set"] },
      },
      required: ["name"],
      additionalProperties: false,
    },
    plan(args, context) {
      if (typeof args.name !== "string" || !args.name.trim())
        throw new ToolArgumentError("name must be a pattern name");
      const id = trackIdOf(args, context);
      const tempo =
        args.tempo === "keep" || args.tempo === "set" ? args.tempo : "auto";
      const result = applyDrumPattern(
        context.score,
        id,
        args.name.trim().toLowerCase(),
        tempo,
      );
      if (!result.ok || !result.next)
        throw new ToolArgumentError(result.message);
      return {
        kind: "score",
        operations: diffScores(context.score, result.next),
        trackId: id,
        summary: result.message,
      };
    },
  },
  {
    name: "set_drum_kit",
    description: `Choose the synthesized kit of a drum track: ${SYNTH_KITS.map((kit) => kit.name).join(", ")}, or default. Offline and instant; sample kits (909, 808, linn, …) go through use_sound.`,
    parameters: {
      type: "object",
      properties: {
        kit: {
          type: "string",
          enum: ["default", ...SYNTH_KITS.map((kit) => kit.name)],
        },
        trackId,
      },
      required: ["kit"],
      additionalProperties: false,
    },
    plan(args, context) {
      if (typeof args.kit !== "string")
        throw new ToolArgumentError("kit must be a synth kit name");
      const id = trackIdOf(args, context);
      const result = applySynthKit(context.score, id, args.kit);
      if (!result.ok) throw new ToolArgumentError(result.message);
      return {
        kind: "score",
        operations: result.next ? diffScores(context.score, result.next) : [],
        trackId: id,
        summary: result.message,
      };
    },
  },
]);
