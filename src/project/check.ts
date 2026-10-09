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
import { isProject } from "./init.ts";
import { typecheckProject } from "./typecheck.ts";

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
  const diagnostics = [
    ...types.diagnostics,
    ...(evaluated.ok ? [] : evaluated.diagnostics),
  ];
  return Object.freeze({
    ok: types.ok && evaluated.ok,
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

export async function runCheckCommand(
  argv: readonly string[],
  cwd: string,
  stdout: { write(text: string): unknown },
  stderr: { write(text: string): unknown },
  deps: CheckDeps = {},
): Promise<number> {
  const project = cwd;
  if (!(await isProject(project))) {
    stderr.write(
      "not a dawg project (no dawg.json here); run `dawg init` first\n",
    );
    return 1;
  }
  const report = await checkProject(project, deps);
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
  void argv;
  return 1;
}
