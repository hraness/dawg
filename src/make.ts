/**
 * `dawg make "<brief>"`: the local model writes a song card (title, hook,
 * verses, mood, the axes the brief names), a seeded genome draws every
 * other axis, and the composer writes a `.track.json` loop (and a WAV with
 * `--wav`). Every seed is a different song; `--seed` repeats one, and
 * `--seed` with no brief composes without a model. `--classic` runs the
 * demo-sheet loop instead; `--from` replays a saved card or sheet.
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
import { encodeLoop } from "../core/loop.ts";
import type { TrackScore } from "../core/score.ts";
import {
  findLocalModel,
  isLocalModel,
  localComplete,
  stopLocalServers,
} from "./agent/local.ts";
import { runRenderCommand } from "./render.ts";

export const MAKE_USAGE =
  'usage: dawg make "<brief>" [--seed <n>] [--out <song.track.json>] [--wav <song.wav>] [--sheet <card.json>] [--rounds <1-6>] [--classic] · dawg make --seed <n> · dawg make --from <card-or-sheet.json> [--out …] [--wav …]';

type Output = { write(text: string): unknown };

const VALUE = new Set([
  "--out",
  "--wav",
  "--sheet",
  "--rounds",
  "--from",
  "--seed",
]);
const FLAGS = new Set(["--classic"]);

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
  const rounds = Number(options.get("--rounds") ?? 3);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 6) {
    stderr.write("dawg make: --rounds takes 1 to 6\n");
    return 2;
  }

  if (options.has("--classic") && !from && !brief) {
    stderr.write(
      `dawg make: --classic needs a brief or --from · ${MAKE_USAGE}\n`,
    );
    return 2;
  }
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

/** Options passed through when a --from file turns out to be a classic sheet. */
function forward(options: ReadonlyMap<string, string>): string[] {
  return ["--out", "--wav"].flatMap((k) =>
    options.has(k) ? [k, options.get(k)!] : [],
  );
}
