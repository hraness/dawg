import { systemRunner } from "../auth/runner.ts";
import { discoverVocalBackend, probeVocalBackend } from "./index.ts";
import { singVocalFile } from "./tools.ts";

type Output = { write(text: string): unknown };
export const VOCALS_HELP =
  "dawg vocals setup|doctor [--json] · dawg vocals sing <spec.json> [--track <slug>] [--name <id>] [--json]";

export async function runVocalsCommand(
  argv: readonly string[],
  projectRoot: string,
  stdout: Output,
  stderr: Output,
  signal?: AbortSignal,
): Promise<number> {
  try {
    const [verb, ...rest] = argv.slice(1);
    if (!verb || verb === "--help" || verb === "-h") {
      stdout.write(`${VOCALS_HELP}\n`);
      return 0;
    }
    let file: string | undefined,
      track = "vocals",
      name: string | undefined,
      json = false;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!;
      if (arg === "--json") json = true;
      else if (arg === "--track" || arg === "--name") {
        const value = rest[++i];
        if (!value || value.startsWith("--"))
          throw new Error(`${arg} needs a value`);
        if (arg === "--track") track = value;
        else name = value;
      } else if (!arg.startsWith("-") && !file) file = arg;
      else throw new Error(`unexpected argument: ${arg.slice(0, 80)}`);
    }
    if (verb === "setup" || verb === "doctor") {
      const discovery = await discoverVocalBackend();
      const probe =
        verb === "doctor" && discovery.available
          ? await probeVocalBackend(discovery.backend, { signal })
          : undefined;
      stdout.write(
        json
          ? `${JSON.stringify({ ...discovery, ...(probe ? { probe } : {}) })}\n`
          : `${discovery.available ? "Vocal Python found" : discovery.reason}\n${discovery.setup}\n${probe ? JSON.stringify(probe) + "\n" : ""}`,
      );
      return verb === "setup" || discovery.available ? 0 : 1;
    }
    if (verb !== "sing" || !file) throw new Error(VOCALS_HELP);
    if (
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(track) ||
      (name !== undefined && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name))
    )
      throw new Error("track and name must be short lowercase identifiers");
    const result = await singVocalFile(
      file,
      {
        projectRoot,
        trackSlug: track,
        runner: systemRunner,
        env: process.env,
        signal: signal ?? new AbortController().signal,
        progress: (line) => stderr.write(`${line}\n`),
      },
      name,
    );
    stdout.write(
      json
        ? `${JSON.stringify(result)}\n`
        : `${result.summary}\n${result.outputs.join("\n")}\n`,
    );
    return 0;
  } catch (error) {
    stderr.write(
      `dawg vocals: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return signal?.aborted ? 130 : 1;
  }
}
