/**
 * The one place dawg starts helper CLIs (`vercel`, `security`, `xcb`).
 * Everything above it takes a `CommandRunner`, so tests script the
 * subprocesses instead of touching real accounts or the keychain.
 */
export type RunOptions = Readonly<{
  /** Written to the child's stdin, then stdin is closed. */
  stdin?: string;
  /** Hand the terminal to the child (for `vercel login`). Output is not captured. */
  inherit?: boolean;
  timeoutMs?: number;
  /** Aborting sends SIGTERM and still waits for the child to exit. */
  signal?: AbortSignal;
  /** Bound on captured stdout/stderr; excess is dropped. */
  maxOutputBytes?: number;
  env?: Readonly<Record<string, string | undefined>>;
}>;

export type RunResult = Readonly<{
  code: number;
  stdout: string;
  stderr: string;
  /** True when the child was stopped by `signal` or `timeoutMs`. */
  killed: boolean;
}>;

export type CommandRunner = Readonly<{
  run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult>;
  /** Absolute path of an executable on PATH, or undefined. */
  which(command: string): string | undefined;
}>;

const DEFAULT_MAX_OUTPUT = 1024 * 1024;
const KILL_GRACE_MS = 15_000;

export const systemRunner: CommandRunner = {
  which: (command) => Bun.which(command) ?? undefined,
  async run(command, args, options = {}) {
    const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    const env = options.env ? { ...process.env, ...options.env } : process.env;
    if (options.inherit) {
      const child = Bun.spawn([command, ...args], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env,
      });
      const stop = watchKill(child, options);
      try {
        const code = await child.exited;
        return { code, stdout: "", stderr: "", killed: stop.killed() };
      } finally {
        stop.dispose();
      }
    }
    const child = Bun.spawn([command, ...args], {
      stdin: options.stdin === undefined ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const stop = watchKill(child, options);
    try {
      if (options.stdin !== undefined && child.stdin) {
        try {
          child.stdin.write(options.stdin);
          await child.stdin.end();
        } catch {
          // The child may exit before reading its input; its exit code reports why.
        }
      }
      const [stdout, stderr, code] = await Promise.all([
        readBounded(child.stdout, maxBytes),
        readBounded(child.stderr, maxBytes),
        child.exited,
      ]);
      return { code, stdout, stderr, killed: stop.killed() };
    } finally {
      stop.dispose();
    }
  },
};

function watchKill(
  child: { kill(signal?: number | NodeJS.Signals): void },
  options: RunOptions,
): { killed(): boolean; dispose(): void } {
  let killed = false;
  let escalate: ReturnType<typeof setTimeout> | undefined;
  const kill = () => {
    if (killed) return;
    killed = true;
    try {
      child.kill("SIGTERM");
    } catch {
      // Already exited.
    }
    // Callers still await exit; a child that ignores SIGTERM gets SIGKILL.
    escalate = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    }, KILL_GRACE_MS);
  };
  const timer =
    options.timeoutMs !== undefined
      ? setTimeout(kill, options.timeoutMs)
      : undefined;
  if (options.signal?.aborted) kill();
  options.signal?.addEventListener("abort", kill, { once: true });
  return {
    killed: () => killed,
    dispose() {
      if (timer) clearTimeout(timer);
      if (escalate) clearTimeout(escalate);
      options.signal?.removeEventListener("abort", kill);
    },
  };
}

async function readBounded(
  stream: ReadableStream<Uint8Array> | undefined | null,
  maxBytes: number,
): Promise<string> {
  if (!stream) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for await (const chunk of stream) {
    if (bytes >= maxBytes) continue; // Keep draining so the child never blocks.
    const room = maxBytes - bytes;
    const part = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
    bytes += part.byteLength;
    text += decoder.decode(part, { stream: true });
  }
  return text + decoder.decode();
}

/** A scripted runner for tests: each call is matched in order by a predicate. */
export type ScriptedCall = Readonly<{
  match: (command: string, args: readonly string[]) => boolean;
  result?: Partial<RunResult>;
  respond?: (
    command: string,
    args: readonly string[],
    options: RunOptions,
  ) => Promise<Partial<RunResult>> | Partial<RunResult>;
}>;

export function scriptedRunner(
  script: readonly ScriptedCall[],
  installed: readonly string[] = [],
): CommandRunner & {
  calls: { command: string; args: readonly string[]; options: RunOptions }[];
} {
  const calls: {
    command: string;
    args: readonly string[];
    options: RunOptions;
  }[] = [];
  const remaining = [...script];
  return {
    calls,
    which: (command) =>
      installed.includes(command) ? `/usr/local/bin/${command}` : undefined,
    async run(command, args, options = {}) {
      calls.push({ command, args, options });
      const index = remaining.findIndex((step) => step.match(command, args));
      if (index < 0)
        throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
      const [step] = remaining.splice(index, 1);
      const partial = step!.respond
        ? await step!.respond(command, args, options)
        : (step!.result ?? {});
      return { code: 0, stdout: "", stderr: "", killed: false, ...partial };
    },
  };
}
