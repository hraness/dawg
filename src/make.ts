/**
 * `dawg make "<brief>"`: the local model writes a hyperpop song sheet, the
 * critic sends notes back until it passes, and the sheet compiles to a
 * `.track.json` loop (and a WAV with `--wav`). `--from <sheet.json>`
 * compiles a sheet without a model; `--sheet` keeps the one the model wrote.
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
  'usage: dawg make "<brief>" [--out <song.track.json>] [--wav <song.wav>] [--sheet <sheet.json>] [--rounds <1-6>] · dawg make --from <sheet.json> [--out …] [--wav …]';

type Output = { write(text: string): unknown };

const VALUE = new Set(["--out", "--wav", "--sheet", "--rounds", "--from"]);

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
    } else if (arg.startsWith("--")) {
      stderr.write(
        `dawg make: unknown option ${arg.slice(0, 40)} · ${MAKE_USAGE}\n`,
      );
      return 2;
    } else words.push(arg);
  }
  const brief = words.join(" ").trim();
  const from = options.get("--from");
  if (!from && !brief) {
    stderr.write(`${MAKE_USAGE}\n`);
    return 2;
  }
  const rounds = Number(options.get("--rounds") ?? 3);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 6) {
    stderr.write("dawg make: --rounds takes 1 to 6\n");
    return 2;
  }

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
