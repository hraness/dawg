import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import type { Chart } from "../../core/distill/hyperpop/chart/format.ts";
import { performChart } from "../../core/distill/hyperpop/chart/perform.ts";
import { decodeLoop, encodeLoop } from "../../core/loop.ts";
import type { TrackScore } from "../../core/score.ts";
import { durableWrite, syncDirectory } from "../fs/durable.ts";
import {
  CHART_VOCAL_ID,
  CHART_VOCAL_TRACK,
  instrumentalChart,
  parseSongChart,
  singSongChart,
} from "../studio/song.ts";
export { assertHouseChart } from "../studio/song.ts";
import type {
  AcceptedVocalBook,
  GenerateVocalBookOptions,
} from "../vocals/index.ts";
import { HOUSE_PROFILE } from "./catalog.ts";
import {
  verifyArtifact,
  WorkflowCoordinator,
  type StageCompletion,
} from "./coordinator.ts";
import {
  relativePath,
  WorkflowConflictError,
  type ArtifactInput,
  type StageTicket,
  type TrackReadiness,
  type WorkflowJob,
} from "./state.ts";

type StockOptions = Omit<
  GenerateVocalBookOptions,
  "projectRoot" | "trackSlug" | "spec" | "signal" | "onProgress"
>;
export type OriginalSongOptions = Readonly<{
  workspace: string;
  brief?: string;
  chart?: Chart;
  /** A saved chart path identifies the particular job selected for --from resume. */
  chartSource?: string;
  /** CLI/UI drivers may continue a job they already created explicitly. */
  jobId?: string;
  /** Used only for a new plan; --from never requests a fresh authored chart. */
  createChart?: (signal: AbortSignal) => Promise<Chart>;
  output?: string;
  chartOutput?: string;
  signal?: AbortSignal;
  coordinator?: WorkflowCoordinator;
  vocal?: StockOptions;
  onProgress?: (message: string) => void;
  /** Optional independent words/mix qualification, distinct from file integrity. */
  qualify?: (
    score: TrackScore,
    take: AcceptedVocalBook,
    signal: AbortSignal,
  ) => Promise<Readonly<Record<string, unknown>>>;
}>;

export type OriginalSongResult = Readonly<{
  job: WorkflowJob;
  score: TrackScore;
  chartPath: string;
  draftPath: string;
  scorePath: string;
  outputPath: string;
  qualityAssessed: boolean;
}>;

const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "song";

/** Project-local orchestration; generation never registers a public demo or sample. */
export async function runOriginalSong(
  options: OriginalSongOptions,
): Promise<OriginalSongResult> {
  const coordinator =
    options.coordinator ?? new WorkflowCoordinator(options.workspace);
  const root = await realpath(options.workspace);
  if (
    options.output &&
    !projectPath(root, options.output).endsWith(".track.json")
  )
    throw new Error("stock song output must end in .track.json");
  if ((await realpath(coordinator.workspace)) !== root)
    throw new Error(
      "original workflow coordinator belongs to a different project",
    );
  let authoredChart = options.chart
    ? parseSongChart(options.chart, { house: true })
    : undefined;
  const sourceText = authoredChart
    ? `${JSON.stringify(authoredChart)}\n`
    : undefined;
  const sourceHash = sourceText ? hash(sourceText) : undefined;
  const configHash = hash(
    JSON.stringify({
      driver: 1,
      voice: HOUSE_PROFILE.voice,
      profile: HOUSE_PROFILE.version,
    }),
  );
  const sourcePath = options.chartSource
    ? projectPath(root, options.chartSource)
    : undefined;
  let current = options.jobId
    ? await coordinator.inspect(options.jobId)
    : sourceHash && sourcePath
      ? (await coordinator.list()).find(
          (job) =>
            job.workflowId === "original-house" &&
            job.artifacts.some(
              (artifact) =>
                artifact.id === "chart" &&
                artifact.path === sourcePath &&
                artifact.sha256 === sourceHash &&
                artifact.producer.configHash === configHash,
            ),
        )
      : undefined;
  if (current && current.workflowId !== "original-house")
    throw new Error("selected job is not an original-house workflow");
  if (current) {
    const admitted = current.artifacts.find(
      (artifact) => artifact.id === "chart",
    );
    const acceptedPlan =
      current.stages.find((stage) => stage.id === "plan")?.status ===
      "complete";
    if (admitted || acceptedPlan) {
      const prefix = `songs/${current.id}/`;
      const checkpoint = admitted?.path.startsWith(prefix)
        ? admitted.path.slice(prefix.length)
        : "";
      if (
        !admitted ||
        !(
          checkpoint === "chart.json" ||
          /^chart-e\d+-a\d+\.json$/.test(checkpoint)
        )
      )
        throw new WorkflowConflictError(
          "selected original job has no canonical admitted chart",
        );
      if (
        admitted.producer.name !== "original-song" ||
        admitted.producer.version !== "1.0.0" ||
        admitted.producer.configHash !== configHash
      )
        throw new WorkflowConflictError(
          "selected original job chart configuration differs from this driver",
        );
      if (sourceHash !== undefined && sourceHash !== admitted.sha256)
        throw new WorkflowConflictError(
          "supplied chart differs from the selected job's admitted chart",
        );
      if (admitted.bytes > 256 * 1024 + 1)
        throw new WorkflowConflictError(
          "admitted original chart exceeds 256 KiB",
        );
      await verifyArtifact(root, admitted);
      const saved = await readFile(resolve(root, admitted.path), "utf8");
      if (hash(saved) !== admitted.sha256)
        throw new WorkflowConflictError(
          "admitted original chart changed while reading",
        );
      authoredChart = parseSongChart(JSON.parse(saved) as unknown, {
        house: true,
      });
      if (hash(`${JSON.stringify(authoredChart)}\n`) !== admitted.sha256)
        throw new WorkflowConflictError(
          "admitted original chart is not canonical",
        );
    }
  }
  if (current && current.status !== "complete" && current.status !== "queued")
    current = await coordinator.resume(current.id);
  if (!current)
    current = await coordinator.create({
      workflowId: "original-house",
      brief: options.brief ?? "Replay an authored original chart",
    });
  const jobId = current.id;
  const base = `songs/${jobId}`;
  // Each attempt writes to its own immutable slot; a stale file can never block a successor.
  let chartPath = current.artifacts.find(
    (artifact) => artifact.id === "chart",
  )?.path;
  const draftPath = `${base}/instrumental.track.json`;
  const scorePath = `${base}/song.track.json`;
  const announce = (message: string) => {
    try {
      options.onProgress?.(message);
    } catch {
      /* Observers never invalidate output. */
    }
  };
  announce(`workflow ${jobId} · original-house`);
  let active: StageTicket | undefined;
  let executionEpoch = current.epoch;
  const complete = async (ticket: StageTicket, result?: StageCompletion) => {
    const committed = await coordinator.completeStage(ticket, result);
    // Only this execution's own successful commit can advance its between-stage fence.
    executionEpoch = committed.epoch;
    active = undefined;
    return committed;
  };
  const interrupt = () => {
    void coordinator
      .cancel(jobId, active?.epoch ?? executionEpoch)
      .catch(() => undefined);
  };
  options.signal?.addEventListener("abort", interrupt, { once: true });
  const begin = async (stageId: string) => {
    options.signal?.throwIfAborted();
    current = await coordinator.inspect(jobId);
    if (
      current.stages.find((stage) => stage.id === stageId)?.status ===
      "complete"
    )
      return undefined;
    active = await coordinator.startStage(jobId, stageId);
    announce(
      `${stageId} · ${current.stages.find((stage) => stage.id === stageId)?.title ?? stageId}`,
    );
    return active;
  };
  const stageSignal = (ticket?: StageTicket) =>
    ticket
      ? options.signal
        ? AbortSignal.any([options.signal, coordinator.signal(ticket)])
        : coordinator.signal(ticket)
      : (options.signal ?? new AbortController().signal);
  const artifact = async (
    id: string,
    path: string,
    kind: ArtifactInput["kind"],
  ): Promise<ArtifactInput> => {
    const absolute = await ownedOutput(root, path);
    const info = await stat(absolute);
    if (info.size > 64 * 1024 * 1024)
      throw new Error("original workflow artifact exceeds 64 MiB");
    const bytes = await readFile(absolute);
    return {
      id,
      path,
      kind,
      bytes: bytes.byteLength,
      sha256: hash(bytes),
      producer: { name: "original-song", version: "1.0.0", configHash },
    };
  };
  try {
    options.signal?.throwIfAborted();
    let chart = authoredChart;
    const plan = await begin("plan");
    if (plan) {
      if (!chart) {
        if (!options.createChart)
          throw new Error(
            "original workflow needs an authored chart or a configured chart writer",
          );
        chart = await options.createChart(stageSignal(plan));
      }
      // Providers may ignore AbortSignal. Check both local cancellation and durable ownership.
      stageSignal(plan).throwIfAborted();
      chart = parseSongChart(chart, { house: true });
      if (Buffer.byteLength(JSON.stringify(chart)) > 256 * 1024)
        throw new Error("authored chart exceeds 256 KiB");
      current = await coordinator.progress(plan, "authored chart validated");
      stageSignal(plan).throwIfAborted();
      chartPath = `${base}/chart-e${plan.epoch}-a${plan.attempt}.json`;
      await immutableWrite(root, chartPath, `${JSON.stringify(chart)}\n`);
      current = await complete(plan, {
        artifacts: [await artifact("chart", chartPath, "analysis")],
      });
      active = undefined;
    }
    if (!chart)
      throw new Error(
        "saved authored chart is required to resume this workflow",
      );
    if (!chartPath)
      throw new WorkflowConflictError(
        "saved plan has no admitted chart checkpoint",
      );
    if (options.chartOutput) {
      const target = projectPath(root, options.chartOutput);
      if (
        target ===
        projectPath(root, options.output ?? `${slug(chart.title)}.track.json`)
      )
        throw new Error("chart and score outputs must be different files");
      await selectedOutput(
        root,
        target,
        `${JSON.stringify(chart, null, 2)}\n`,
        coordinator,
        false,
      );
    }
    announce(
      `chart → ${chartPath} · resume with dawg make --from ${chartPath}`,
    );
    const compose = await begin("compose");
    if (compose) {
      const draft = instrumentalChart(chart);
      await immutableWrite(root, draftPath, encodeLoop(draft));
      const revision = current!.writtenRevision + 1;
      current = await complete(compose, {
        artifacts: [await artifact("instrumental", draftPath, "score")],
        writtenRevision: revision,
        readiness: scoreReadiness(draft, revision),
      });
      active = undefined;
    }
    announce(
      `instrumental draft → ${draftPath} · ready before stock vocal generation`,
    );
    const output = projectPath(
      root,
      options.output ?? `${slug(chart.title)}.track.json`,
    );
    if ([chartPath, draftPath].includes(output))
      throw new Error(
        "score output must not overwrite its authored chart or instrumental checkpoint",
      );
    if (current!.status === "complete") {
      for (const accepted of current!.artifacts)
        await verifyArtifact(root, accepted);
      const score = decodeLoop(
        await readFile(resolve(root, scorePath), "utf8"),
      );
      await selectedOutput(root, output, encodeLoop(score), coordinator, true);
      announce(`replayed accepted song → ${output}`);
      const report = JSON.parse(
        await readFile(resolve(root, `${base}/quality.json`), "utf8"),
      ) as { perceptualAssessed?: boolean };
      return {
        job: current!,
        score,
        chartPath,
        draftPath,
        scorePath,
        outputPath: output,
        qualityAssessed: report.perceptualAssessed === true,
      };
    }
    const vocals = await begin("vocals");
    // The vocal runtime revalidates and reuses accepted takes before probing Python.
    const take = await singSongChart(chart, {
      ...options.vocal,
      projectRoot: root,
      trackSlug: CHART_VOCAL_TRACK,
      id: CHART_VOCAL_ID,
      signal: stageSignal(vocals),
      onProgress: (event) =>
        announce(
          `vocals · ${event.stage}${event.part ? ` · ${event.part}` : ""}`,
        ),
    });
    if (vocals) {
      const paths = [
        take.wavPath,
        take.specPath,
        take.bookPath,
        take.metadataPath,
      ];
      const additions = await Promise.all(
        paths.map((path, index) =>
          artifact(
            ["vocal-audio", "vocal-spec", "vocal-book", "vocal-metadata"][
              index
            ]!,
            path,
            index === 0 ? "vocal" : "analysis",
          ),
        ),
      );
      current = await complete(vocals, {
        artifacts: additions,
      });
      active = undefined;
    }
    const arrange = await begin("arrange");
    const score = performChart(chart, take.book).score;
    if (arrange) {
      await immutableWrite(root, scorePath, encodeLoop(score));
      const revision = current!.writtenRevision + 1;
      current = await complete(arrange, {
        artifacts: [await artifact("final-score", scorePath, "score")],
        writtenRevision: revision,
        readiness: scoreReadiness(score, revision, "vocal-audio"),
      });
      active = undefined;
    }
    const verify = await begin("verify");
    let assessed = false;
    if (verify) {
      const evidence = options.qualify
        ? await options.qualify(score, take, stageSignal(verify))
        : {
            words: "unassessed",
            pitch: "unassessed",
            timing: "unassessed",
            tone: "unassessed",
          };
      assessed = options.qualify !== undefined;
      const report = {
        format: "dawg.original-quality/v1",
        technical: { score: "valid", acceptedVocal: "hash-verified" },
        perceptualAssessed: assessed,
        evidence,
        limitations: assessed
          ? "See the independent evidence; technical checks do not establish exact voice or performance."
          : "Word clarity, timing, pitch and tone have not been perceptually qualified. This is a generated listening draft, not an approved public demo.",
      };
      const contents = `${JSON.stringify(report, null, 2)}\n`;
      if (contents.length > 16 * 1024)
        throw new Error("qualification report exceeds 16 KiB");
      await immutableWrite(root, `${base}/quality.json`, contents);
      current = await complete(verify, {
        artifacts: [
          await artifact("quality-report", `${base}/quality.json`, "analysis"),
        ],
      });
      active = undefined;
    } else {
      const report = JSON.parse(
        await readFile(resolve(root, `${base}/quality.json`), "utf8"),
      ) as { perceptualAssessed?: boolean };
      assessed = report.perceptualAssessed === true;
    }
    const finish = await begin("export");
    await selectedOutput(root, output, encodeLoop(score), coordinator, true);
    if (finish) {
      // The immutable final score is canonical; named outputs may be replaced on request.
      current = await complete(finish);
      active = undefined;
    }
    announce(
      `stock bf_emma song → ${output}${assessed ? "" : " · words/tone review pending"}`,
    );
    return {
      job: current!,
      score,
      chartPath,
      draftPath,
      scorePath,
      outputPath: output,
      qualityAssessed: assessed,
    };
  } catch (error) {
    if (
      options.signal?.aborted ||
      (error instanceof Error &&
        ["AbortError", "VocalCancelledError"].includes(error.name))
    )
      await coordinator
        .cancel(jobId, active?.epoch ?? executionEpoch)
        .catch(() => undefined);
    else if (active && !(error instanceof WorkflowConflictError))
      await coordinator
        .failStage(
          active,
          error instanceof Error
            ? error.message.slice(0, 2_000)
            : "original workflow failed",
        )
        .catch(() => undefined);
    const saved = await coordinator.inspect(jobId).catch(() => undefined);
    const acceptedChartPath = saved?.artifacts.find(
      (artifact) => artifact.id === "chart",
    )?.path;
    announce(
      acceptedChartPath
        ? `saved workflow ${jobId}; resume the authored chart with --from ${acceptedChartPath}`
        : `saved workflow ${jobId}; no authored chart checkpoint was admitted`,
    );
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", interrupt);
    if (!options.coordinator) coordinator.dispose();
  }
}

function scoreReadiness(
  score: TrackScore,
  writtenRevision: number,
  vocalArtifact?: string,
): TrackReadiness[] {
  const range = { from: 0, to: score.bars * score.beatsPerBar };
  return score.tracks.map((track) => ({
    trackId: track.id,
    writtenRevision,
    state: track.muted ? "planned" : "ready",
    range,
    requiredArtifacts:
      vocalArtifact && (track.sampler || track.granular) ? [vocalArtifact] : [],
    audibleNotes: track.muted
      ? 0
      : score.notes.filter((note) => note.trackId === track.id).length,
  }));
}

function projectPath(root: string, path: string): string {
  const candidate = relative(root, resolve(root, path)).split(sep).join("/");
  return relativePath(candidate);
}

async function ownedOutput(root: string, path: string): Promise<string> {
  const safe = relativePath(path);
  let current = root;
  for (const part of dirname(safe)
    .split("/")
    .filter((part) => part !== ".")) {
    current = resolve(current, part);
    await mkdir(current, { recursive: true });
    const info = await lstat(current);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      !(await realpath(current)).startsWith(root + sep)
    )
      throw new Error(
        "song output must stay in project-owned directories without symlinks",
      );
  }
  const target = resolve(root, safe);
  const info = await lstat(target).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (info && (!info.isFile() || info.isSymbolicLink()))
    throw new Error("song output must be a regular project file");
  return target;
}

async function immutableWrite(
  root: string,
  path: string,
  contents: string,
): Promise<void> {
  const target = await ownedOutput(root, path);
  const info = await stat(target).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (info && info.size > 2 * 1024 * 1024)
    throw new Error(
      "existing checkpoint exceeds its bounded size; it was preserved",
    );
  const existing = await readFile(target, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (existing !== undefined) {
    if (existing !== contents)
      throw new Error(
        "accepted song checkpoint differs; preserve it and start a new job",
      );
    return;
  }
  const temporary = resolve(
    dirname(target),
    `.${basename(target)}.${randomUUID()}.pending`,
  );
  try {
    await durableWrite(temporary, contents, { mode: 0o600 });
    try {
      // Atomic create-if-absent: a rename could clobber a concurrent writer.
      await link(temporary, target);
      await syncDirectory(dirname(target));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await ownedOutput(root, path);
      const info = await stat(target);
      if (info.size > 2 * 1024 * 1024)
        throw new Error(
          "concurrent output exceeds its size bound; existing data was preserved",
        );
      if ((await readFile(target, "utf8")) !== contents)
        throw new Error(
          "another writer published different output; existing data was preserved",
        );
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Selected destinations never replace admitted assets or other existing data. */
async function selectedOutput(
  root: string,
  path: string,
  contents: string,
  coordinator: WorkflowCoordinator,
  score: boolean,
): Promise<void> {
  const safe = relativePath(path);
  if (score && !safe.endsWith(".track.json"))
    throw new Error("stock song output must end in .track.json");
  if (
    /^tracks\/[^/]+\/samples\/vocals(?:\/|$)/.test(safe) ||
    /^tracks\/[^/]+\/references(?:\/|$)/.test(safe)
  )
    throw new Error(
      "output must not replace accepted vocal or reference assets",
    );
  const expected = hash(contents);
  for (const job of await coordinator.list())
    for (const artifact of job.artifacts)
      if (artifact.path === safe && artifact.sha256 !== expected)
        throw new Error(
          "output must not replace an admitted workflow artifact; choose a new path",
        );
  await immutableWrite(root, safe, contents);
}
