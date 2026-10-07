#!/usr/bin/env bun
import { resolve } from "node:path";
import { runDaemon } from "./session/daemon.ts";
import { assertSessionId } from "./session/store.ts";

process.title = "dawgd";

/**
 * dawgd entry point. `dawg` spawns this detached when no daemon is alive:
 *   bun src/daemon.ts --workspace <dir> --session <id> [--grace-ms <ms>]
 */
function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

const workspace = resolve(option("--workspace") ?? process.cwd());
const sessionId = option("--session");
assertSessionId(sessionId);
const graceText = option("--grace-ms");
const graceMs = graceText === undefined ? undefined : Number(graceText);
if (graceMs !== undefined && (!Number.isFinite(graceMs) || graceMs < 0)) {
  process.stderr.write("dawgd: --grace-ms must be a non-negative number\n");
  process.exit(2);
}
await runDaemon(
  graceMs === undefined
    ? { workspace, sessionId }
    : { workspace, sessionId, graceMs },
);
