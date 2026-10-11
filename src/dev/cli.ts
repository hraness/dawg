/**
 * `dawg dev screen [letter]` and `dawg dev --help` (design §5.1, §5.4b).
 * Plain `dawg dev [options]` is the editor with `--dev`; main.ts handles
 * that before this module loads. Read-only: never creates `.dawg/`.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { SCREEN_DIR, screenFile } from "./screen.ts";

type Out = { write(text: string): unknown };

export const DEV_HELP = `usage:
  dawg dev [options]      the editor in dev mode (same as dawg --dev)
  dawg dev --reload       restart the editor when dawg's own source changes
  dawg dev screen [A]     print a dev-mode pane's last frame (newest pane by default)

Dev mode works exactly like the editor and also writes log rows to the
session history: file sync evaluations and typecheck results, agent tool
arguments, and errors with their stack. Read them from another terminal:

  dawg history --follow --kind log
  dawg history --follow            every edit, comment and log row

External edits to song.ts and tracks/** hot-reload into the session as one
revision. \`dawg check --as <name>\` (or DAWG_ACTOR=<name>) credits the next
reload of the checked files to <name>, so the history and the card say who
made the edit.`;

/** Runs `dawg dev screen …` / `dawg dev --help`; returns the exit code. */
export async function runDevCommand(
  argv: readonly string[],
  project: string,
  out: Out,
  err: Out,
): Promise<number> {
  const [verb, ...rest] = argv;
  if (verb === "--help" || verb === "-h" || verb === undefined) {
    out.write(`${DEV_HELP}\n`);
    return 0;
  }
  if (verb !== "screen") {
    err.write(`dawg dev: unknown subcommand · ${verb.slice(0, 40)}\n`);
    return 2;
  }
  if (rest[0] === "--help" || rest[0] === "-h") {
    out.write("usage: dawg dev screen [A] · a dev-mode pane's last frame\n");
    return 0;
  }
  if (rest.length > 1 || (rest[0] !== undefined && !/^[a-z]$/i.test(rest[0]))) {
    err.write("dawg dev screen: usage · dawg dev screen [A]\n");
    return 2;
  }
  const dir = join(project, SCREEN_DIR);
  const path =
    rest[0] !== undefined
      ? join(dir, screenFile(rest[0].toUpperCase()))
      : await newestScreen(dir);
  const text =
    path === undefined
      ? undefined
      : await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) {
    err.write(
      `dawg dev screen: no screen${rest[0] ? ` for pane ${rest[0].toUpperCase()}` : ""} · run dawg dev in this folder first\n`,
    );
    return 1;
  }
  out.write(text.endsWith("\n") ? text : `${text}\n`);
  return 0;
}

async function newestScreen(dir: string): Promise<string | undefined> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return undefined;
  }
  let best: { path: string; at: number } | undefined;
  for (const name of names) {
    if (!/^screen(-[A-Z])?\.txt$/.test(name)) continue;
    const path = join(dir, name);
    const info = await stat(path).catch(() => undefined);
    if (info && (!best || info.mtimeMs > best.at))
      best = { path, at: info.mtimeMs };
  }
  return best?.path;
}
