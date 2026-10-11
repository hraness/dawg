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
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { projectSourceFiles } from "./sync.ts";
import { cleanActor, sha256, writeHeartbeat } from "../dev/attribution.ts";

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
  "usage: dawg check [--as <name>] · typecheck and evaluate the project in this directory; exit 1 on problems · --as (or DAWG_ACTOR) credits the running editor's reload of these files to <name>";

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

/** Hashes of the project's sources, as the running editor's sync sees them. */
async function sourceHashes(project: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const path of await projectSourceFiles(project)) {
    try {
      out.set(path, sha256(await readFile(join(project, path), "utf8")));
    } catch {
      // vanished between the walk and the read
    }
  }
  return out;
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
  const report = await checkProject(project, deps);
  // The heartbeat credits the editor's next reload of exactly these
  // contents to this actor (design §5.3); a human's later save differs.
  const actor = checkActor(as);
  if (actor !== undefined)
    await writeHeartbeat(project, actor, await sourceHashes(project)).catch(
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
