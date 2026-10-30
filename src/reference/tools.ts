import type { AgentTool } from "../agent/tools.ts";
import { resolveInput } from "../media/paths.ts";
import type { MediaResult, MediaRunContext } from "../media/types.ts";
import { prepareReference, recreateReference } from "./backend.ts";
import { readReferenceJson } from "./store.ts";

export async function prepareReferenceTool(
  args: unknown,
  context: MediaRunContext,
): Promise<MediaResult> {
  const result = await prepareReference(args, context);
  return {
    summary: `${result.reused ? "Reused" : "Prepared"} reference · ${result.duration.toFixed(1)}s · ${result.isolation}`,
    content: { ...result },
    outputs: [
      result.manifestPath,
      result.analysisPath,
      result.scorePath,
      result.sourcePath,
      result.vocalPath,
      ...Object.values(result.stems),
    ],
  };
}

export async function recreateReferenceTool(
  prepared: string,
  lyricsFile: string | undefined,
  context: MediaRunContext,
): Promise<MediaResult> {
  const lyrics =
    lyricsFile === undefined
      ? undefined
      : await readReferenceJson(
          (await resolveInput(context, lyricsFile)).absolute,
        );
  const result = await recreateReference(
    { prepared, ...(lyrics === undefined ? {} : { lyrics }) },
    context,
  );
  return {
    summary: `${result.reused ? "Reused" : "Re-sang"} reference words · stock bf_emma · review word clarity and timing`,
    content: { ...result },
    outputs: [
      result.manifestPath,
      result.stockPath,
      result.scorePath,
      result.lyricsPath,
      result.reportPath,
      result.comparison.sourcePath,
      result.comparison.stockPath,
    ],
  };
}

export const REFERENCE_TOOLS: readonly AgentTool[] = [
  {
    name: "prepare_reference",
    description:
      "Prepare YouTube or audio-file evidence: preserve source/stems, fit timing and repeat evidence, and return editable melody. Uses actual separated or supplied vocals. External agent files require existing read roots. Rebuild accompaniment from retained stems; read workflow_catalog recreate-source.",
    parameters: {
      type: "object",
      properties: {
        file: { type: "string", maxLength: 1024 },
        url: { type: "string", maxLength: 4096 },
        vocalFile: { type: "string", maxLength: 1024 },
        sourceIsVocal: {
          type: "boolean",
          description: "Explicitly identify an already isolated vocal input.",
        },
        bpm: { type: "number", minimum: 40, maximum: 300 },
      },
      additionalProperties: false,
    },
    plan: (args) => ({
      kind: "media",
      summary: "Prepare reference evidence",
      run: (context) => prepareReferenceTool(args, context),
    }),
  },
  {
    name: "recreate_reference_vocal",
    description:
      "Re-sing actual supplied/transcribed words with stock bf_emma from a prepared reference. Retains pitch/dynamics, editable melody and aligned level-matched source/stock A/B. lyricsFile is timed lines; otherwise needs cached Whisper. Reports pitch/coverage/word/tone evidence; no exact-performance claim.",
    parameters: {
      type: "object",
      properties: {
        prepared: { type: "string", maxLength: 1024 },
        lyricsFile: { type: "string", maxLength: 1024 },
      },
      required: ["prepared"],
      additionalProperties: false,
    },
    plan(args) {
      if (
        typeof args.prepared !== "string" ||
        !args.prepared ||
        args.prepared.length > 1024 ||
        (args.lyricsFile !== undefined &&
          (typeof args.lyricsFile !== "string" ||
            args.lyricsFile.length > 1024))
      )
        throw new Error(
          "prepared and optional lyricsFile must name project artifacts",
        );
      const prepared = args.prepared,
        lyricsFile = args.lyricsFile as string | undefined;
      return {
        kind: "media",
        summary: "Re-sing actual reference words",
        run: (context) => recreateReferenceTool(prepared, lyricsFile, context),
      };
    },
  },
];
