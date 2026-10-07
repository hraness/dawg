/**
 * `split_stems(file)`: six stems (vocals, drums, bass, guitar, piano, other)
 * into `<file>.stems/<stem>.wav` next to the input. A download that came
 * through StemDeck (sidecar has a job id) or that has a source URL and a
 * running StemDeck is separated there; otherwise `demucs -n htdemucs_6s`
 * runs locally (`uv tool run demucs` or a PATH binary).
 */
import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  detectStemDeck,
  missingTool,
  toolCommand,
  uvInstalledTools,
  FIRST_RUN_NOTES,
} from "./backend.ts";
import { readSidecar, sidecarPath, writeSidecarField } from "./sidecar.ts";
import { ensureDir, exists, projectPath, resolveInput } from "./paths.ts";
import {
  MediaToolError,
  percentProgress,
  runHelper,
  throwIfAborted,
  withTempDir,
} from "./process.ts";
import {
  STEM_NAMES,
  createStemDeck,
  type StemDeckOptions,
} from "./stemdeck.ts";
import {
  MEDIA_LIMITS,
  type MediaResult,
  type MediaRunContext,
} from "./types.ts";

export const DEMUCS_MODEL = "htdemucs_6s";

export type SplitStemsArgs = Readonly<{ file: string }>;
export type SplitStemsOptions = Readonly<{ stemdeck?: StemDeckOptions }>;

export function stemsDirFor(wavPath: string): string {
  return wavPath.replace(/\.wav$/i, "") + ".stems";
}

async function existingStems(
  dir: string,
): Promise<readonly string[] | undefined> {
  if (!(await exists(dir))) return undefined;
  const present = new Set(await readdir(dir));
  const all = STEM_NAMES.every((name) => present.has(`${name}.wav`));
  return all ? STEM_NAMES.map((name) => join(dir, `${name}.wav`)) : undefined;
}

export async function splitStems(
  args: SplitStemsArgs,
  context: MediaRunContext,
  options: SplitStemsOptions = {},
): Promise<MediaResult> {
  const input = await resolveInput(context, args.file);
  const dir = stemsDirFor(input.absolute);
  const cached = await existingStems(dir);
  if (cached)
    return result(context, input.relative, cached, "already split", "cache");
  const sidecar = await readSidecar(input.absolute);
  const health = sidecar?.source ? await detectStemDeck(context) : undefined;
  if (health && sidecar?.source) {
    const client = createStemDeck(health, context, options.stemdeck);
    let jobId = sidecar.stemdeck?.jobId;
    if (!jobId || sidecar.stemdeck?.url !== health.url) {
      context.progress("stemdeck submitting");
      jobId = await client.submit(sidecar.source);
      await writeSidecarField(input.absolute, "stemdeck", {
        url: health.url,
        jobId,
      });
    }
    const job = await client.wait(jobId, MEDIA_LIMITS.stemsTimeoutMs);
    if (job.stems.length === 0)
      throw new MediaToolError(
        "StemDeck finished the job but offered no stems",
      );
    await ensureDir(dir);
    const paths = await client.fetchStems(
      job,
      dir,
      MEDIA_LIMITS.downloadMaxBytes,
    );
    return result(context, input.relative, paths, "stemdeck split", "stemdeck");
  }
  const demucs = toolCommand(
    "demucs",
    context.runner,
    await uvInstalledTools(context.runner, context.signal),
  );
  if (!demucs) throw new MediaToolError(missingTool("demucs"));
  context.progress(FIRST_RUN_NOTES.demucs ?? "demucs starting");
  const paths = await withTempDir("stems", async (temp) => {
    await runHelper(
      context,
      [
        ...demucs,
        "-n",
        DEMUCS_MODEL,
        "-o",
        temp,
        "--filename",
        "{stem}.{ext}",
        input.absolute,
      ],
      {
        timeoutMs: MEDIA_LIMITS.stemsTimeoutMs,
        progress: percentProgress("demucs"),
        env: { PYTHONUNBUFFERED: "1" },
      },
    );
    throwIfAborted(context.signal);
    const produced = join(temp, DEMUCS_MODEL);
    const missing = [];
    for (const name of STEM_NAMES)
      if (!(await exists(join(produced, `${name}.wav`)))) missing.push(name);
    if (missing.length > 0)
      throw new MediaToolError(`demucs did not write ${missing.join(", ")}`);
    await rm(dir, { recursive: true, force: true });
    await ensureDir(dir);
    const moved: string[] = [];
    for (const name of STEM_NAMES) {
      const from = join(produced, `${name}.wav`);
      const to = join(dir, `${name}.wav`);
      await rename(from, to).catch(async () => {
        await Bun.write(to, Bun.file(from));
      });
      moved.push(to);
    }
    return moved;
  });
  return result(
    context,
    input.relative,
    paths,
    `demucs ${DEMUCS_MODEL} split`,
    "demucs",
  );
}

function result(
  context: MediaRunContext,
  inputRelative: string,
  paths: readonly string[],
  verb: string,
  backend: string,
): MediaResult {
  const outputs = paths.map((path) => projectPath(context.projectRoot, path));
  const stems = Object.fromEntries(
    paths.map((path) => [
      path
        .split("/")
        .at(-1)!
        .replace(/\.wav$/, ""),
      projectPath(context.projectRoot, path),
    ]),
  );
  return {
    summary: `${verb}: ${inputRelative} → ${outputs.length} stems`,
    outputs,
    content: {
      file: inputRelative,
      backend,
      stems,
      sidecar: projectPath(context.projectRoot, sidecarPath(inputRelative)),
    },
  };
}
