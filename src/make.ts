/**
 * `dawg make "<brief>"`: Claude Opus 5.5, through the AI Gateway or
 * OpenRouter key, writes a whole chart (form, chords, tunes, words, sounds,
 * moves) at the demos' level, the critic sends back what's wrong, and the
 * performer writes a `.track.json` loop (and a WAV with `--wav`). Every
 * round prints its cost. `--local` or `--seed` runs the genome path instead:
 * the local model writes a song card and a seeded genome draws the rest, and
 * `--seed` with no brief composes without a model. `--classic` runs the
 * demo-sheet loop; `--from` replays a saved chart, card or sheet.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  compileSheet,
  critique,
  generateSong,
  validateSheet,
  type SongSheet,
} from "../core/distill/hyperpop/index.ts";
import {
  compileGenome,
  describeGenome,
  generateGenomeSong,
  randomSeed,
  sampleGenome,
  songFromCard,
  validateCard,
  type SongCard,
} from "../core/distill/hyperpop/genome/index.ts";
import {
  checkChart,
  type Chart,
} from "../core/distill/hyperpop/chart/format.ts";
import { performChart } from "../core/distill/hyperpop/chart/perform.ts";
import {
  writeChart,
  type ChatTurn,
} from "../core/distill/hyperpop/chart/write.ts";
import { encodeLoop } from "../core/loop.ts";
import {
  defaultAuthEnv,
  resolveGatewayKey,
  resolveOpenRouterKey,
  type AuthEnv,
} from "./auth/credentials.ts";
import { systemRunner } from "./auth/runner.ts";
import { MAX_OUTPUT_TOKENS } from "./agent/gateway.ts";
import { resolveModelChoice } from "./agent/models.ts";
import { apiClient } from "./agent/provider.ts";
import type { TrackScore } from "../core/score.ts";
import {
  findLocalModel,
  isLocalModel,
  localComplete,
  stopLocalServers,
} from "./agent/local.ts";
import { runRenderCommand } from "./render.ts";

export const MAKE_USAGE =
  'usage: dawg make "<brief>" [--model <alias>] [--out <song.track.json>] [--wav <song.wav>] [--sheet <chart.json>] [--rounds <1-6>] [--effort low|medium|high] · dawg make "<brief>" --local|--seed <n> · dawg make "<brief>" --classic · dawg make --seed <n> · dawg make --from <chart-card-or-sheet.json> [--out …] [--wav …]';

/** The model that writes charts unless `--model` names another. */
export const CHART_MODEL = "opus-5.5";
/**
 * How hard the model thinks per round unless `--effort` says. Low writes a
 * chart as clean as high for a third of the cost (about $0.45 a song against
 * $1.25 in two rounds), since the critic and the count repair catch the rest.
 */
export const CHART_EFFORT = "low";
const EFFORTS = ["low", "medium", "high"] as const;

type Output = { write(text: string): unknown };

const VALUE = new Set([
  "--out",
  "--wav",
  "--sheet",
  "--rounds",
  "--from",
  "--seed",
  "--model",
  "--effort",
]);
const FLAGS = new Set(["--classic", "--local"]);

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "song";

export async function runMakeCommand(
  argv: readonly string[],
  workspace: string,
  stdout: Output,
  stderr: Output,
  signal?: AbortSignal,
  auth?: AuthEnv,
): Promise<number> {
  const rest = argv.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) {
    stdout.write(`${MAKE_USAGE}\n`);
    return 0;
  }
  const options = new Map<string, string>();
  const words: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (VALUE.has(arg)) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith("--")) {
        stderr.write(`dawg make: ${arg} needs a value · ${MAKE_USAGE}\n`);
        return 2;
      }
      options.set(arg, value);
      i++;
    } else if (FLAGS.has(arg)) options.set(arg, "1");
    else if (arg.startsWith("--")) {
      stderr.write(
        `dawg make: unknown option ${arg.slice(0, 40)} · ${MAKE_USAGE}\n`,
      );
      return 2;
    } else words.push(arg);
  }
  const brief = words.join(" ").trim();
  const from = options.get("--from");
  const seedArg = options.get("--seed");
  const seed = seedArg === undefined ? undefined : Number(seedArg);
  if (
    seed !== undefined &&
    (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31)
  ) {
    stderr.write(
      "dawg make: --seed takes a whole number from 0 to 2147483647\n",
    );
    return 2;
  }
  if (!from && !brief && seed === undefined) {
    stderr.write(`${MAKE_USAGE}\n`);
    return 2;
  }
  const chartPath =
    !options.has("--classic") &&
    !options.has("--local") &&
    seed === undefined &&
    (brief !== "" || (from !== undefined && (await isChart(workspace, from))));
  const rounds = Number(options.get("--rounds") ?? (chartPath ? 4 : 3));
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 6) {
    stderr.write("dawg make: --rounds takes 1 to 6\n");
    return 2;
  }

  const effort = options.get("--effort") ?? CHART_EFFORT;
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    stderr.write("dawg make: --effort takes low, medium or high\n");
    return 2;
  }

  if (options.has("--classic") && !from && !brief) {
    stderr.write(
      `dawg make: --classic needs a brief or --from · ${MAKE_USAGE}\n`,
    );
    return 2;
  }
  if (chartPath)
    return makeChart({
      brief,
      from,
      rounds,
      options,
      workspace,
      stdout,
      stderr,
      signal,
      auth: auth ?? defaultAuthEnv(systemRunner),
    });
  if (!options.has("--classic"))
    return makeGenome({
      brief,
      from,
      seed,
      rounds,
      options,
      workspace,
      stdout,
      stderr,
      signal,
    });

  let sheet: SongSheet;
  let score: TrackScore;
  if (from) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(resolve(workspace, from), "utf8"));
    } catch (error) {
      stderr.write(
        `dawg make: cannot read ${from} · ${(error as Error).message.slice(0, 160)}\n`,
      );
      return 1;
    }
    const checked = validateSheet(raw);
    if (!checked.ok) {
      stderr.write(
        `dawg make: ${from} is not a valid sheet\n  - ${checked.errors.join("\n  - ")}\n`,
      );
      return 1;
    }
    for (const warning of checked.warnings)
      stderr.write(`  note: ${warning}\n`);
    sheet = checked.sheet;
    score = compileSheet(sheet);
    const review = critique(sheet);
    stdout.write(
      `critic ${review.score}${review.notes.length ? `\n  - ${review.notes.join("\n  - ")}` : ""}\n`,
    );
  } else {
    const model = findLocalModel();
    if (!isLocalModel(model)) {
      stderr.write(`dawg make: ${model.reason}\n`);
      return 1;
    }
    stdout.write(
      `writing "${brief}" with ${model.alias} (local; the first run loads the model)\n`,
    );
    try {
      const song = await generateSong(
        brief,
        (chat, schema) =>
          localComplete(model, {
            messages: chat,
            schema,
            temperature: 0.8,
            maxTokens: 12_000,
            ...(signal ? { signal } : {}),
          }),
        {
          rounds,
          onRound: (r) =>
            stdout.write(
              `  round ${r.round}: ${r.ok ? `critic ${r.score}` : "invalid sheet"} · ${(r.ms / 1000).toFixed(0)} s\n`,
            ),
        },
      );
      sheet = song.sheet;
      score = song.score;
      if (song.notes.length)
        stdout.write(
          `  still to improve:\n  - ${song.notes.slice(0, 5).join("\n  - ")}\n`,
        );
    } catch (error) {
      stderr.write(`dawg make: ${(error as Error).message.slice(0, 400)}\n`);
      return 1;
    } finally {
      stopLocalServers();
    }
  }

  const out = resolve(
    workspace,
    options.get("--out") ?? `${slug(sheet.title)}.track.json`,
  );
  await writeFile(out, encodeLoop(score), "utf8");
  stdout.write(
    `"${sheet.title}" · ${sheet.key} · ${sheet.bpm} bpm · ${score.bars} bars → ${out}\n`,
  );
  const sheetOut = options.get("--sheet");
  if (sheetOut && !from) {
    await writeFile(
      resolve(workspace, sheetOut),
      `${JSON.stringify(sheet, null, 2)}\n`,
      "utf8",
    );
    stdout.write(`sheet → ${resolve(workspace, sheetOut)}\n`);
  }
  const wav = options.get("--wav");
  if (wav)
    return runRenderCommand(
      ["render", wav, "--import", out],
      workspace,
      stdout,
      stderr,
    );
  return 0;
}

type GenomeRun = Readonly<{
  brief: string;
  from: string | undefined;
  seed: number | undefined;
  rounds: number;
  options: ReadonlyMap<string, string>;
  workspace: string;
  stdout: Output;
  stderr: Output;
  signal: AbortSignal | undefined;
}>;

/** The genome path: a card from the model (or a file), a seed, a song. */
async function makeGenome(run: GenomeRun): Promise<number> {
  const { brief, from, rounds, options, workspace, stdout, stderr, signal } =
    run;
  let seed = run.seed ?? randomSeed();
  let card: SongCard | undefined;
  let song: ReturnType<typeof compileGenome>;
  if (from) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(
        await readFile(resolve(workspace, from), "utf8"),
      ) as Record<string, unknown>;
    } catch (error) {
      stderr.write(
        `dawg make: cannot read ${from} · ${(error as Error).message.slice(0, 160)}\n`,
      );
      return 1;
    }
    // A saved card is {seed, card}; a bare card works too. Anything else is a classic sheet.
    const inner = raw.card && typeof raw.card === "object" ? raw.card : raw;
    if (typeof (inner as Record<string, unknown>).hook !== "string")
      return runMakeCommand(
        ["make", "--classic", "--from", from, ...forward(options)],
        workspace,
        stdout,
        stderr,
        signal,
      );
    const checked = validateCard(inner);
    if (!checked.ok) {
      stderr.write(
        `dawg make: ${from} is not a valid card\n  - ${checked.errors.join("\n  - ")}\n`,
      );
      return 1;
    }
    for (const warning of checked.warnings)
      stderr.write(`  note: ${warning}\n`);
    if (run.seed === undefined && typeof raw.seed === "number") seed = raw.seed;
    card = checked.card;
    song = songFromCard(card, seed);
  } else if (!brief) {
    song = compileGenome(sampleGenome(seed));
  } else {
    const model = findLocalModel();
    if (!isLocalModel(model)) {
      stderr.write(`dawg make: ${model.reason}\n`);
      return 1;
    }
    stdout.write(
      `writing "${brief}" with ${model.alias} (local; the first run loads the model) · seed ${seed}\n`,
    );
    try {
      const made = await generateGenomeSong(
        brief,
        (chat, schema) =>
          localComplete(model, {
            messages: chat,
            schema,
            temperature: 0.9,
            maxTokens: 2_000,
            ...(signal ? { signal } : {}),
          }),
        {
          seed,
          rounds,
          onRound: (r) =>
            stdout.write(
              `  card ${r.round}: ${r.ok ? "ok" : `invalid (${r.notes.slice(0, 2).join("; ")})`} · ${(r.ms / 1000).toFixed(0)} s\n`,
            ),
        },
      );
      card = made.card;
      song = made;
    } catch (error) {
      stderr.write(`dawg make: ${(error as Error).message.slice(0, 400)}\n`);
      return 1;
    } finally {
      stopLocalServers();
    }
  }
  const out = resolve(
    workspace,
    options.get("--out") ?? `${slug(song.title)}.track.json`,
  );
  await writeFile(out, encodeLoop(song.score), "utf8");
  stdout.write(
    `"${song.title}" · seed ${seed} · ${song.score.bars} bars → ${out}\n  ${describeGenome(song.genome).join("\n  ")}\n`,
  );
  const sheetOut = options.get("--sheet");
  if (sheetOut && card) {
    await writeFile(
      resolve(workspace, sheetOut),
      `${JSON.stringify({ seed, card }, null, 2)}\n`,
      "utf8",
    );
    stdout.write(
      `card → ${resolve(workspace, sheetOut)} (replay with --from)\n`,
    );
  }
  const wav = options.get("--wav");
  if (wav)
    return runRenderCommand(
      ["render", wav, "--import", out],
      workspace,
      stdout,
      stderr,
    );
  return 0;
}

type ChartRun = Omit<GenomeRun, "seed"> & Readonly<{ auth: AuthEnv }>;

async function isChart(workspace: string, from: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(resolve(workspace, from), "utf8"));
    return Array.isArray(raw?.sections) && typeof raw?.sounds === "object";
  } catch {
    return false;
  }
}

/** The chart path: Opus writes and revises a chart, or a saved one replays. */
async function makeChart(run: ChartRun): Promise<number> {
  const { brief, from, rounds, options, workspace, stdout, stderr, signal } =
    run;
  let chart: Chart;
  let score: TrackScore;
  if (from) {
    chart = JSON.parse(await readFile(resolve(workspace, from), "utf8"));
    const problems = checkChart(chart);
    if (problems.length) {
      stderr.write(
        `dawg make: ${from} is not a valid chart\n  - ${problems.slice(0, 8).join("\n  - ")}\n`,
      );
      return 1;
    }
    try {
      score = performChart(chart).score;
    } catch (error) {
      stderr.write(`dawg make: ${(error as Error).message.slice(0, 400)}\n`);
      return 1;
    }
  } else {
    const gateway = await resolveGatewayKey(run.auth);
    const service = gateway ? "gateway" : "openrouter";
    const key = gateway ?? (await resolveOpenRouterKey(run.auth));
    if (!key) {
      stderr.write(
        "dawg make: writing a song needs an AI Gateway or OpenRouter key; run `dawg model key gateway`, or use --local for the local model\n",
      );
      return 1;
    }
    const alias = options.get("--model") ?? CHART_MODEL;
    const model = resolveModelChoice(service, alias);
    if (!model) {
      stderr.write(`dawg make: unknown model ${alias.slice(0, 40)}\n`);
      return 2;
    }
    const client = apiClient({
      kind: service,
      choice: service,
      apiKey: key.key,
      source: key.source,
      modelId: model,
    });
    stdout.write(`writing "${brief}" with ${model} (${service})\n`);
    try {
      const song = await writeChart(
        brief,
        async (turns: readonly ChatTurn[]) => {
          let text = "";
          let usage;
          for await (const event of client.stream(
            {
              model,
              messages: turns,
              maxTokens: Math.min(32_000, MAX_OUTPUT_TOKENS),
              maxResponseBytes: 4_000_000,
              effort: (options.get("--effort") ??
                CHART_EFFORT) as (typeof EFFORTS)[number],
            },
            signal,
          )) {
            if (event.type === "text") text += event.delta;
            else if (event.type === "usage") usage = event;
          }
          return { text, ...(usage ? { usage } : {}) };
        },
        {
          rounds,
          onDraft: (d) =>
            stdout.write(
              `  round ${d.round}: ${d.problems.length ? `${d.problems.length} to fix` : "clean"} · $${d.costUsd.toFixed(2)} · ${(d.ms / 1000).toFixed(0)} s${d.problems.length ? `\n    - ${d.problems.slice(0, 4).join("\n    - ")}` : ""}\n`,
            ),
        },
      );
      chart = song.chart;
      score = song.score;
      if (song.stopped)
        stderr.write(`  ${song.stopped}; kept the best draft\n`);
      stdout.write(
        `  cost $${song.costUsd.toFixed(2)} · ${song.inputTokens} in (${song.cachedInputTokens} cached) · ${song.outputTokens} out\n`,
      );
      if (song.problems.length)
        stdout.write(
          `  still to improve:\n  - ${song.problems.slice(0, 5).join("\n  - ")}\n`,
        );
    } catch (error) {
      stderr.write(`dawg make: ${(error as Error).message.slice(0, 400)}\n`);
      return 1;
    }
  }
  const out = resolve(
    workspace,
    options.get("--out") ?? `${slug(chart.title)}.track.json`,
  );
  await writeFile(out, encodeLoop(score), "utf8");
  stdout.write(
    `"${chart.title}" · ${chart.key} ${chart.mode} · ${chart.bpm} bpm · ${score.bars} bars → ${out}\n`,
  );
  const sheetOut = options.get("--sheet");
  if (sheetOut && !from) {
    await writeFile(
      resolve(workspace, sheetOut),
      `${JSON.stringify(chart, null, 2)}\n`,
      "utf8",
    );
    stdout.write(
      `chart → ${resolve(workspace, sheetOut)} (replay with --from)\n`,
    );
  }
  const wav = options.get("--wav");
  if (wav)
    return runRenderCommand(
      ["render", wav, "--import", out],
      workspace,
      stdout,
      stderr,
    );
  return 0;
}

/** Options passed through when a --from file turns out to be a classic sheet. */
function forward(options: ReadonlyMap<string, string>): string[] {
  return ["--out", "--wav"].flatMap((k) =>
    options.has(k) ? [k, options.get(k)!] : [],
  );
}
