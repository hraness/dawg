import { performChart } from "../../core/distill/hyperpop/chart/perform.ts";
import type { AgentTool } from "../agent/tools.ts";
import { ToolArgumentError } from "../agent/tool-error.ts";
import { systemRunner } from "../auth/runner.ts";
import {
  CHART_VOCAL_ID,
  CHART_VOCAL_TRACK,
  instrumentalChart,
  readSongChart,
  singSongChart,
} from "./song.ts";

const properties = {
  file: {
    type: "string",
    maxLength: 1024,
    description: "Project-relative chart JSON.",
  },
  name: {
    type: "string",
    maxLength: 64,
    description:
      "Vocal take identifier; use the same name for sing_chart and perform_chart.",
  },
};
function input(args: Record<string, unknown>) {
  if (
    typeof args.file !== "string" ||
    !args.file.trim() ||
    args.file.length > 1024
  )
    throw new ToolArgumentError("file must name a chart JSON");
  if (
    args.name !== undefined &&
    (typeof args.name !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(args.name))
  )
    throw new ToolArgumentError("name must be a short lowercase identifier");
  return { file: args.file, name: args.name as string | undefined };
}

export const SONG_TOOLS: readonly AgentTool[] = [
  {
    name: "sing_chart",
    description:
      "Generate the actual original lyrics of an authored house-hyperpop chart with stock bf_emma. Returns immutable local audio and book in tracks/vocals independently of inspection focus. Use perform_chart instrumental=true first for a listenable early draft; sing_chart does not change the score. Follow with perform_chart using the same file and name to attach the accepted take.",
    parameters: {
      type: "object",
      properties,
      required: ["file"],
      additionalProperties: false,
    },
    plan(args) {
      const { file, name } = input(args);
      return {
        kind: "media",
        summary: "Sing chart with bf_emma",
        async run(context) {
          const chart = await readSongChart(file, context, { house: true });
          const take = await singSongChart(chart, {
            projectRoot: context.projectRoot,
            trackSlug: CHART_VOCAL_TRACK,
            id: name ?? CHART_VOCAL_ID,
            runner: context.runner,
            backendOptions: { env: context.env },
            signal: context.signal,
            writeScope: context.writeScope,
            onProgress: (event) =>
              context.progress(
                `${event.stage} bf_emma${event.part ? ` · ${event.part}` : ""}`,
              ),
          });
          return {
            summary: `bf_emma ready · ${chart.title}`,
            content: {
              takeId: take.takeId,
              book: take.book,
              bookPath: take.bookPath,
              wavPath: take.wavPath,
              sha256: take.sha256,
              reused: take.reused,
            },
            outputs: [
              take.wavPath,
              take.bookPath,
              take.metadataPath,
              take.specPath,
            ],
          };
        },
      };
    },
  },
  {
    name: "perform_chart",
    description:
      "Compile an authored hyperpop chart into the editable song, atomically replacing its musical content. instrumental=true explicitly mutes synthetic vocal placeholders for an early listenable draft. Default attaches the matching accepted stock bf_emma take from sing_chart; it never runs inference or silently substitutes filler. Rejected if the score changed concurrently.",
    parameters: {
      type: "object",
      properties: { ...properties, instrumental: { type: "boolean" } },
      required: ["file"],
      additionalProperties: false,
    },
    plan(args) {
      const { file, name } = input(args);
      if (
        args.instrumental !== undefined &&
        typeof args.instrumental !== "boolean"
      )
        throw new ToolArgumentError("instrumental must be boolean");
      const instrumental = args.instrumental === true;
      return {
        kind: "prepare-replace",
        summary: instrumental
          ? "Play instrumental draft"
          : "Attach bf_emma song",
        async run(context) {
          if (!context.workspace)
            throw new ToolArgumentError(
              "song performer needs a project workspace",
            );
          const host = {
            projectRoot: context.workspace.root,
            trackSlug: CHART_VOCAL_TRACK,
            runner: context.media?.runner ?? systemRunner,
          };
          const chart = await readSongChart(file, host, { house: true });
          const score = instrumental
            ? instrumentalChart(chart)
            : performChart(
                chart,
                (
                  await singSongChart(chart, {
                    projectRoot: host.projectRoot,
                    trackSlug: host.trackSlug,
                    id: name ?? CHART_VOCAL_ID,
                    cachedOnly: true,
                    signal: context.signal,
                    writeScope: context.media?.writeScope,
                  })
                ).book,
              ).score;
          return {
            kind: "replace",
            next: score,
            summary: `${chart.title} · ${instrumental ? "instrumental draft; vocals pending" : "bf_emma lyrics"}`,
            trackId:
              score.tracks.find((track) => track.id === "bvox")?.id ??
              score.tracks[0]?.id,
          };
        },
      };
    },
  },
];
