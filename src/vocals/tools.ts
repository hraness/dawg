import { readFile } from "node:fs/promises";
import type { AgentTool } from "../agent/tools.ts";
import { resolveInput } from "../media/paths.ts";
import type { MediaRunContext } from "../media/types.ts";
import { generateVocalBook, VOCAL_LIMITS } from "./index.ts";

export async function singVocalFile(
  file: string,
  context: MediaRunContext,
  name?: string,
) {
  const input = await resolveInput(context, file);
  if (input.size > VOCAL_LIMITS.maxSpecBytes)
    throw new Error("vocal spec exceeds 512 KiB");
  const spec: unknown = JSON.parse(await readFile(input.absolute, "utf8"));
  const take = await generateVocalBook({
    projectRoot: context.projectRoot,
    trackSlug: context.trackSlug,
    id: name,
    spec,
    backendOptions: { env: context.env },
    runner: context.runner,
    signal: context.signal,
    writeScope: context.writeScope,
    onProgress: (event) =>
      context.progress(
        `${event.stage}${event.part ? ` · ${event.part}` : ""}${event.completed !== undefined ? ` · ${event.completed}/${event.total ?? "?"}` : ""}`,
      ),
  });
  return {
    summary: `${take.reused ? "Reused" : "Sang"} bf_emma · ${take.seconds.toFixed(1)}s`,
    content: { ...take, provenance: take.provenance },
    outputs: [take.wavPath, take.specPath, take.bookPath, take.metadataPath],
  };
}

export const VOCAL_TOOLS: readonly AgentTool[] = [
  {
    name: "generate_vocals",
    description:
      "Sing the actual words and authored notes of a project JSON vocal-book spec with stock bf_emma/Kokoro+WORLD. Returns immutable project-local pinned audio, slices and a book for the song performer or sampler. Read workflow original-house references/vocals.md for the spec. Never silently replaces words with filler. Saved takes replay offline without Python.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          maxLength: 1024,
          description: "Project-relative JSON vocal-book spec.",
        },
        name: {
          type: "string",
          maxLength: 64,
          description: "Optional take identifier.",
        },
      },
      required: ["file"],
      additionalProperties: false,
    },
    plan: (args) => {
      if (
        typeof args.file !== "string" ||
        !args.file.trim() ||
        args.file.length > 1024
      )
        throw new Error("file must name a project JSON vocal spec");
      if (
        args.name !== undefined &&
        (typeof args.name !== "string" ||
          !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(args.name))
      )
        throw new Error("name must be a short lowercase identifier");
      const file = args.file;
      const name = args.name as string | undefined;
      return {
        kind: "media",
        summary: "Sing bf_emma vocal take",
        run: (context) => singVocalFile(file, context, name),
      };
    },
  },
];
