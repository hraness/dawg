/**
 * `dawg check`: typecheck the project, evaluate `song.ts`, print every
 * diagnostic as `file:line:col message`, exit 1 on any failure.
 */

import {
  evaluateProject,
  formatDiagnostic,
  type Diagnostic,
} from "../../core/sdk/eval.ts";
import {
  legacyResonatorWarnings,
  modalPairWarnings,
} from "../../core/resonators.ts";
import { plainSineWarnings } from "../audio/instrument-check.ts";
import { clipPinDiagnostics } from "./clip-pins.ts";
import { isProject } from "./init.ts";
import { parseSimpleArgv } from "../argv.ts";
import { typecheckProject } from "./typecheck.ts";
import {
  cleanActor,
  projectSourceHashes,
  writeHeartbeat,
} from "../dev/attribution.ts";

export type CheckDeps = Readonly<{
  typecheck?: typeof typecheckProject;
  evaluate?: typeof evaluateProject;
}>;

export type CheckReport = Readonly<{
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  typesMs: number;
  evalMs: number;
  tracks: number;
  notes: number;
  /** Advice that does not fail the check (0.6: legacy instrument words). */
  warnings: readonly string[];
}>;

/** Runs both checks on `project`; never throws for project problems. */
export async function checkProject(
  project: string,
  deps: CheckDeps = {},
): Promise<CheckReport> {
  const [types, evaluated] = await Promise.all([
    (deps.typecheck ?? typecheckProject)(project),
    (deps.evaluate ?? evaluateProject)(project),
  ]);
  // 0.7: a clip or take whose file no longer matches its pinned sha256
  // fails like a type error.
  const pins = evaluated.ok
    ? await clipPinDiagnostics(project, evaluated.score)
    : [];
  const diagnostics = [
    ...types.diagnostics,
    ...(evaluated.ok ? [] : evaluated.diagnostics),
    ...pins,
  ];
  return Object.freeze({
    ok: types.ok && evaluated.ok && pins.length === 0,
    diagnostics: Object.freeze(diagnostics),
    typesMs: types.ms,
    evalMs: evaluated.ms,
    tracks: evaluated.ok ? evaluated.score.tracks.length : 0,
    notes: evaluated.ok ? evaluated.score.notes.length : 0,
    warnings: Object.freeze(
      evaluated.ok
        ? [
            ...legacyResonatorWarnings(evaluated.score.tracks),
            ...modalPairWarnings(evaluated.score.tracks),
            ...plainSineWarnings(evaluated.score.tracks),
          ]
        : [],
    ),
  });
}

export const CHECK_USAGE =
  "usage: dawg check [--as <name>] [--files <path,...>] · typecheck and evaluate the project in this directory; exit 1 on problems · --as (or DAWG_ACTOR) credits the running editor's reload of these files to <name> · --files names the files you changed, so a reload that already happened is credited too";

/**
 * Who is running `dawg check`: `--as`, else DAWG_ACTOR, else `claude-code`
 * inside Claude Code (CLAUDECODE=1). Undefined: nobody is credited.
 */
export function checkActor(
  as: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  return (
    cleanActor(as) ??
    cleanActor(env.DAWG_ACTOR) ??
    (env.CLAUDECODE === "1" ? "claude-code" : undefined)
  );
}

export async function runCheckCommand(
  argv: readonly string[],
  cwd: string,
  stdout: { write(text: string): unknown },
  stderr: { write(text: string): unknown },
  deps: CheckDeps = {},
): Promise<number> {
  // `--as <name>` is lifted out before the shared contract sees the rest.
  const rest = [...argv.slice(1)];
  let as: string | undefined;
  const asAt = rest.indexOf("--as");
  if (asAt >= 0) {
    const value = rest[asAt + 1];
    if (value === undefined || value.startsWith("-") || !cleanActor(value)) {
      stderr.write(`--as needs a name · ${CHECK_USAGE}\n`);
      return 2;
    }
    as = value;
    rest.splice(asAt, 2);
  }
  // `--files a,b`: the files this actor changed. Only these may claim a
  // reload that already landed as a plain save (design §5.3).
  let files: string[] | undefined;
  const filesAt = rest.indexOf("--files");
  if (filesAt >= 0) {
    const value = rest[filesAt + 1];
    const list = (value ?? "")
      .split(",")
      .map((path) => path.trim().replace(/\\/g, "/").replace(/^\.\//, ""))
      .filter((path) => path.length > 0);
    if (value === undefined || value.startsWith("-") || list.length === 0) {
      stderr.write(`--files needs a comma-separated list · ${CHECK_USAGE}\n`);
      return 2;
    }
    files = list;
    rest.splice(filesAt, 2);
  }
  const parsed = parseSimpleArgv(rest, 0);
  if (parsed.kind === "help") {
    stdout.write(`${CHECK_USAGE}\n`);
    return 0;
  }
  if (parsed.kind === "error") {
    stderr.write(`${parsed.problem} · ${CHECK_USAGE}\n`);
    return 2;
  }
  const project = cwd;
  if (!(await isProject(project))) {
    stderr.write(
      "not a dawg project (no dawg.json here); run `dawg init` first\n",
    );
    return 1;
  }
  const hashes = await projectSourceHashes(project);
  if (files !== undefined) {
    const unknown = files.filter((path) => !hashes.has(path));
    if (unknown.length > 0) {
      stderr.write(
        `--files: not a project source: ${unknown.slice(0, 4).join(", ")} · ${CHECK_USAGE}\n`,
      );
      return 2;
    }
  }
  const report = await checkProject(project, deps);
  // The heartbeat credits the editor's next reload of exactly these
  // contents to this actor (design §5.3); a human's later save differs.
  // Only `--files` may claim a reload that already happened: a plain check
  // hashes every source, including saves the actor never made.
  const actor = checkActor(as);
  if (actor !== undefined)
    await writeHeartbeat(project, actor, hashes, new Date(), files).catch(
      () => undefined,
    );
  for (const diagnostic of report.diagnostics)
    stderr.write(`${formatDiagnostic(diagnostic)}\n`);
  for (const warning of report.warnings) stderr.write(`warning: ${warning}\n`);
  if (report.ok) {
    stdout.write(
      `ok · ${report.tracks} track${report.tracks === 1 ? "" : "s"}, ${report.notes} note${
        report.notes === 1 ? "" : "s"
      } · types ${report.typesMs} ms · eval ${report.evalMs} ms\n`,
    );
    return 0;
  }
  const count = report.diagnostics.length;
  stderr.write(`${count} problem${count === 1 ? "" : "s"}\n`);
  return 1;
}
