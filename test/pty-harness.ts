/**
 * Shared PTY launcher for the play-mode and menu tests: the real `dawg`
 * binary in a Bun pseudo-terminal, rendered through test/vt.ts.
 */
import { afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { VirtualTerminal } from "./vt.ts";

export const MAIN = resolve(import.meta.dir, "../src/main.ts");
export const supported =
  process.platform !== "win32" &&
  typeof (Bun as unknown as { Terminal?: unknown }).Terminal === "function";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

interface PtyTerminal {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export async function launch(
  cols: number,
  rows: number,
  env: Record<string, string>,
  argv: string[] = ["--track", "bass"],
  dir?: string,
  /** Runtime flags before the script (`--preload <file>`). */
  bunArgs: string[] = [],
) {
  const cwd = dir ?? (await mkdtemp(join(tmpdir(), "dawg-pty-")));
  if (!dir) dirs.push(cwd);
  const vt = new VirtualTerminal(cols, rows);
  const decoder = new TextDecoder();
  const proc = Bun.spawn([process.execPath, ...bunArgs, MAIN, ...argv], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: cwd,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      DAWG_DAEMON: "0",
      DAWG_AUDIO: "0",
      // A configured (fake) provider: the agent prompt and STEER pill show,
      // and the first-run sign-in picker stays out of the way.
      AI_GATEWAY_API_KEY: "vck_ptytest0000000000000000",
      DAWG_CREDENTIAL_STORE: "file",
      DAWG_CONFIG_DIR: join(cwd, ".config", "dawg"),
      ...env,
    },
    terminal: {
      cols,
      rows,
      data(_terminal: unknown, data: Uint8Array) {
        vt.write(decoder.decode(data, { stream: true }));
      },
    },
  } as Parameters<typeof Bun.spawn>[1]);
  const terminal = (proc as unknown as { terminal: PtyTerminal }).terminal;
  const until = async (
    predicate: () => boolean,
    label: string,
    timeoutMs = 5000,
  ) => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline)
        throw new Error(`timed out waiting for ${label}\n${vt.text()}`);
      await Bun.sleep(20);
    }
  };
  const send = async (data: string) => {
    terminal.write(data);
    await Bun.sleep(60);
  };
  return { proc, terminal, vt, until, send, cwd };
}
