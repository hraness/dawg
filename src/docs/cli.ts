/**
 * `dawg docs --agent [page | --search words | --write]`: the agent docs lens
 * from a shell, the same pages the in-app `docs` tool reads.
 *
 *   dawg docs --agent                    the index
 *   dawg docs --agent tool/audio         one page, printed whole
 *   dawg docs --agent --search slice     matching pages
 *   dawg docs --agent --write            refresh AGENTS.md's dawg block here
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { durableWrite } from "../fs/durable.ts";

type Output = { write(text: string): unknown };

export type DocsArgv =
  | { kind: "help" }
  | { kind: "error"; problem: string }
  | { kind: "index" }
  | { kind: "page"; page: string }
  | { kind: "search"; query: string }
  | { kind: "write" };

/** Parses `docs …` (with or without the leading `docs`). */
export function parseDocsArgv(argv: readonly string[]): DocsArgv {
  const args = argv[0] === "docs" ? argv.slice(1) : [...argv];
  let agent = false;
  let write = false;
  let search: string | undefined;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") return { kind: "help" };
    if (arg === "--agent") agent = true;
    else if (arg === "--write") write = true;
    else if (arg === "--search") {
      const value = args
        .slice(index + 1)
        .join(" ")
        .trim();
      if (!value) return { kind: "error", problem: "--search needs words" };
      search = value;
      break;
    } else if (arg.startsWith("-"))
      return { kind: "error", problem: `unknown option ${arg.slice(0, 40)}` };
    else positional.push(arg);
  }
  if (!agent)
    return {
      kind: "error",
      problem:
        "only the agent lens is here; humans read /guide in dawg or DAWG.md",
    };
  if (positional.length > 1)
    return { kind: "error", problem: "one page at a time" };
  if (write && (search !== undefined || positional.length > 0))
    return { kind: "error", problem: "--write takes no page" };
  if (write) return { kind: "write" };
  if (search !== undefined) return { kind: "search", query: search };
  if (positional[0] !== undefined) return { kind: "page", page: positional[0] };
  return { kind: "index" };
}

export async function runDocsCommand(
  argv: readonly string[],
  cwd: string,
  stdout: Output,
  stderr: Output,
): Promise<number> {
  const parsed = parseDocsArgv(argv);
  const docs = await import("./agent-docs.ts");
  switch (parsed.kind) {
    case "help":
      stdout.write(`${docs.DOCS_USAGE}\n`);
      return 0;
    case "error":
      stderr.write(`dawg docs: ${parsed.problem} · ${docs.DOCS_USAGE}\n`);
      return 2;
    case "index":
      stdout.write(`${docs.agentDocsIndex()}\n`);
      return 0;
    case "search":
      stdout.write(`${docs.searchAgentDocs(parsed.query, 40)}\n`);
      return 0;
    case "page": {
      const page = docs.findAgentDoc(parsed.page);
      if (!page) {
        stderr.write(
          `dawg docs: no page "${parsed.page.slice(0, 60)}" · dawg docs --agent lists them\n`,
        );
        return 1;
      }
      stdout.write(`${page.body}\n`);
      return 0;
    }
    case "write": {
      const path = join(cwd, "AGENTS.md");
      let existing: string | undefined;
      try {
        existing = await readFile(path, "utf8");
      } catch {
        existing = undefined;
      }
      const next = docs.upsertAgentsMd(existing);
      if (next === existing) {
        stdout.write("AGENTS.md up to date\n");
        return 0;
      }
      await durableWrite(path, next);
      stdout.write(
        `${existing === undefined ? "wrote" : "refreshed"} AGENTS.md\n`,
      );
      return 0;
    }
  }
}
