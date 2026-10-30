import { systemRunner, type CommandRunner } from "../auth/runner.ts";
import { referenceSetup } from "./backend.ts";
import { prepareReferenceTool, recreateReferenceTool } from "./tools.ts";
import { importReferenceFile } from "./import.ts";

type Output = { write(text: string): unknown };
export const REFERENCE_HELP = `dawg reference prepare <audio-file|youtube-url> [--vocal file|--isolated] [--bpm n]
dawg reference recreate <prepared-manifest> [--lyrics timed-lyrics.json]
dawg reference setup
Options: --track <slug> --json. An explicitly named external audio file is copied
read-only into the project before preparation. Source and accepted takes stay project-local.`;

export type ReferenceCliServices = Readonly<{
  runner?: CommandRunner;
  prepare?: typeof prepareReferenceTool;
  recreate?: typeof recreateReferenceTool;
}>;

export async function runReferenceCommand(
  argv: readonly string[],
  projectRoot: string,
  stdout: Output,
  stderr: Output,
  signal?: AbortSignal,
  services: ReferenceCliServices = {},
): Promise<number> {
  try {
    const [verb, ...rest] = argv.slice(1);
    if (!verb || verb === "--help" || verb === "-h") {
      stdout.write(`${REFERENCE_HELP}\n`);
      return 0;
    }
    if (verb === "setup") {
      stdout.write(`${referenceSetup()}\n`);
      return 0;
    }
    let input: string | undefined,
      vocal: string | undefined,
      lyrics: string | undefined,
      bpm: number | undefined,
      track = "reference",
      json = false,
      isolated = false;
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index]!;
      if (arg === "--json") json = true;
      else if (arg === "--isolated") isolated = true;
      else if (["--track", "--vocal", "--lyrics", "--bpm"].includes(arg)) {
        const value = rest[++index];
        if (!value || value.startsWith("--"))
          throw new Error(`${arg} needs a value`);
        if (arg === "--track") track = value;
        else if (arg === "--vocal") vocal = value;
        else if (arg === "--lyrics") lyrics = value;
        else bpm = Number(value);
      } else if (!arg.startsWith("-") && !input) input = arg;
      else throw new Error("Unexpected reference argument");
    }
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(track))
      throw new Error("track must name one lowercase project track directory");
    if (!input || !["prepare", "recreate"].includes(verb))
      throw new Error(REFERENCE_HELP);
    const context = {
      projectRoot,
      trackSlug: track,
      runner: services.runner ?? systemRunner,
      env: process.env,
      signal: signal ?? new AbortController().signal,
      progress: (line: string) => stderr.write(`${line}\n`),
    };
    if (verb === "recreate" && (vocal || isolated || bpm !== undefined))
      throw new Error(
        "recreate accepts the prepared manifest and optional --lyrics file",
      );
    if (verb === "prepare" && lyrics)
      throw new Error(
        "Pass timed lyrics to the recreate command after preparing the reference",
      );
    // A CLI file argument names one explicit read. This does not modify the
    // agent's persistent read roots or expose this authority as a tool option.
    const isUrl = input.startsWith("http:") || input.startsWith("https:");
    if (verb === "prepare" && !isUrl)
      input = (
        await importReferenceFile(input, context, { explicitFile: true })
      ).relative;
    if (verb === "prepare" && vocal)
      vocal = (
        await importReferenceFile(vocal, context, { explicitFile: true })
      ).relative;
    const result =
      verb === "prepare"
        ? await (services.prepare ?? prepareReferenceTool)(
            {
              ...(isUrl ? { url: input } : { file: input }),
              ...(vocal ? { vocalFile: vocal } : {}),
              ...(isolated ? { sourceIsVocal: true } : {}),
              ...(bpm === undefined ? {} : { bpm }),
            },
            context,
          )
        : await (services.recreate ?? recreateReferenceTool)(
            input,
            lyrics,
            context,
          );
    stdout.write(
      json
        ? `${JSON.stringify(result)}\n`
        : `${result.summary}\n${result.outputs.join("\n")}\n`,
    );
    return 0;
  } catch (error) {
    stderr.write(
      `dawg reference: ${(error instanceof Error ? error.message : String(error)).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 2400)}\n`,
    );
    return signal?.aborted ? 130 : 1;
  }
}
