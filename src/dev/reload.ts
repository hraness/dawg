/**
 * `dawg dev --reload` (design §5.5): a thin supervisor that restarts the
 * editor when dawg's own source changes, for working on dawg itself with a
 * coding agent in another terminal.
 *
 * The supervisor never reads the terminal: the editor runs as its child
 * with inherited stdio. A change under `<checkout>/{src,core,tui}` (300 ms
 * debounce) is first smoke-imported in a separate child (`DAWG_SMOKE=1`
 * returns before any terminal work); only when that passes is the running
 * editor stopped (SIGTERM, which restores the terminal) and a new one
 * started. A broken edit therefore never takes the working editor down.
 * The session lives in the session store and dawgd, so it survives; the
 * new editor reopens the newest session in the folder.
 *
 * The smoke import catches syntax errors and module-load throws, not type
 * errors. A reloaded editor therefore typechecks the checkout itself in the
 * background (`DAWG_RELOAD_CHECKOUT`, `reloadTypecheck`) and reports errors
 * as a card and a `reload` log row; it never blocks the reload.
 *
 * An editor that dies on its own (not stopped by us) leaves the terminal
 * restored, a one-line notice, and the supervisor waiting for the next
 * source change to retry. A clean quit (exit 0) ends the supervisor. A
 * SIGTERM/SIGHUP to the supervisor waits (up to 3 s) for the editor to
 * restore the terminal before it resolves, so the shell never redraws over
 * a raw-mode alternate screen.
 */
import { existsSync, watch as fsWatch } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const RELOAD_DEBOUNCE_MS = 300;
/** An editor that exits within this long after a start crashed on startup. */
export const STARTUP_CRASH_MS = 5000;
export const WATCHED_DIRS = ["src", "core", "tui"] as const;
/** How long `stop` waits for the editor to exit before restoring anyway. */
export const STOP_GRACE_MS = 3000;
/** Env var naming the checkout a reloaded editor typechecks. */
export const RELOAD_CHECKOUT_ENV = "DAWG_RELOAD_CHECKOUT";

export type ChildHandle = Readonly<{
  exited: Promise<number>;
  kill(signal: "SIGTERM" | "SIGHUP"): void;
}>;

export type ReloadDeps = Readonly<{
  /** Starts the editor with inherited stdio. */
  spawnEditor(): ChildHandle;
  /** Smoke-imports the entry in a separate process; resolves with the error text, or undefined when it imports. */
  smoke(): Promise<string | undefined>;
  /** Calls `changed` with a relative path whenever a watched file changes; returns a stop function. */
  watch(changed: (path: string) => void): () => void;
  /** Leaves the terminal usable (cooked mode, cursor, main screen). */
  restoreTerminal(): void;
  /** One line for the person at the terminal. */
  notice(text: string): void;
  now?: () => number;
  debounceMs?: number;
  stopGraceMs?: number;
}>;

export type Supervisor = Readonly<{
  /** Resolves with the exit code when the editor quits cleanly or `stop` runs. */
  done: Promise<number>;
  /**
   * Forwards a signal to the editor and ends the supervisor once the editor
   * exited (or the grace period passed), with the terminal restored.
   */
  stop(signal: "SIGTERM" | "SIGHUP"): void;
  /** Tests: resolves once a pending change has been handled. */
  idle(): Promise<void>;
}>;

/** Only TypeScript sources trigger a reload; tests and dotfiles do not. */
export function triggersReload(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (!/\.tsx?$/.test(normalized)) return false;
  if (/\.test\.tsx?$/.test(normalized)) return false;
  return !normalized.split("/").some((part) => part.startsWith("."));
}

export function startSupervisor(deps: ReloadDeps): Supervisor {
  const now = deps.now ?? (() => Date.now());
  const debounceMs = deps.debounceMs ?? RELOAD_DEBOUNCE_MS;
  let child: ChildHandle | undefined;
  let startedAt = 0;
  let restarting = false;
  let ended = false;
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let changes: string[] = [];
  let work: Promise<void> = Promise.resolve();
  let finish: (code: number) => void = () => undefined;
  const done = new Promise<number>((resolveDone) => {
    finish = resolveDone;
  });

  const end = (code: number) => {
    if (ended) return;
    ended = true;
    if (timer !== undefined) clearTimeout(timer);
    stopWatching();
    finish(code);
  };

  const start = () => {
    const handle = deps.spawnEditor();
    child = handle;
    startedAt = now();
    void handle.exited.then((code) => {
      if (child !== handle) return;
      child = undefined;
      if (restarting || ended || stopping) return;
      if (code === 0) return end(0);
      deps.restoreTerminal();
      const early = now() - startedAt < STARTUP_CRASH_MS;
      deps.notice(
        `dawg dev: the editor ${early ? "crashed on startup" : "exited"} (code ${code}) · fix the source and save to retry · Ctrl-C quits`,
      );
    });
  };

  const reload = async () => {
    const batch = changes;
    changes = [];
    if (batch.length === 0 || ended) return;
    const failure = await deps.smoke();
    if (ended || stopping) return;
    if (failure !== undefined) {
      // The running editor keeps going; only a terminal-less notice when
      // nothing runs (a running editor owns the screen).
      if (!child)
        deps.notice(
          `dawg dev: reload failed · ${failure.split("\n")[0]!.slice(0, 200)}`,
        );
      return;
    }
    const running = child;
    if (running) {
      restarting = true;
      running.kill("SIGTERM");
      await running.exited;
      restarting = false;
    }
    if (!ended && !stopping) start();
  };

  const stopWatching = deps.watch((path) => {
    if (!triggersReload(path) || ended || stopping) return;
    changes.push(path);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      work = work.then(reload, reload);
    }, debounceMs);
  });

  start();
  return {
    done,
    stop(signal) {
      const code = signal === "SIGTERM" ? 143 : 129;
      if (ended || stopping) return;
      stopping = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const running = child;
      if (!running) return end(code);
      running.kill(signal);
      let grace: ReturnType<typeof setTimeout> | undefined;
      void Promise.race([
        running.exited.then(() => undefined),
        new Promise<void>((resolveGrace) => {
          grace = setTimeout(resolveGrace, deps.stopGraceMs ?? STOP_GRACE_MS);
        }),
      ]).then(() => {
        if (grace !== undefined) clearTimeout(grace);
        // The editor restores the terminal on SIGTERM; a hung or killed
        // one may not have, so restore again (idempotent escapes).
        deps.restoreTerminal();
        end(code);
      });
    },
    async idle() {
      while (timer !== undefined) await new Promise((r) => setTimeout(r, 5));
      await work;
    },
  };
}

/** The dawg checkout `entry` lives in, or undefined when not run from git. */
export function sourceCheckout(entry: string): string | undefined {
  let dir = dirname(resolve(entry));
  for (let depth = 0; depth < 4; depth += 1) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

const RESTORE =
  "\u001b[?1000l\u001b[?1002l\u001b[?1006l\u001b[0m\u001b[?2004l\u001b[?25h\u001b[?1049l";

/** Runs the real supervisor for `dawg dev --reload [options]`. */
export async function runReload(
  entry: string,
  editorArgs: readonly string[],
  err: { write(text: string): unknown },
): Promise<number> {
  const checkout = sourceCheckout(entry);
  if (checkout === undefined) {
    err.write(
      "dawg dev --reload: dawg is not running from a source checkout · use dawg dev\n",
    );
    return 2;
  }
  const bun = process.execPath;
  const supervisor = startSupervisor({
    spawnEditor() {
      const proc = Bun.spawn([bun, entry, "--dev", ...editorArgs], {
        stdio: ["inherit", "inherit", "inherit"],
        env: {
          ...process.env,
          DAWG_DEV: "1",
          [RELOAD_CHECKOUT_ENV]: checkout,
        },
      });
      return {
        exited: proc.exited,
        kill: (signal) => proc.kill(signal),
      };
    },
    async smoke() {
      const proc = Bun.spawn(
        [bun, "-e", `await import(${JSON.stringify(entry)})`],
        {
          stdio: ["ignore", "ignore", "pipe"],
          env: { ...process.env, DAWG_SMOKE: "1" },
        },
      );
      const [code, text] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
      ]);
      return code === 0 ? undefined : text.trim() || `exit ${code}`;
    },
    watch(changed) {
      const watchers = WATCHED_DIRS.filter((dir) =>
        existsSync(join(checkout, dir)),
      ).map((dir) =>
        fsWatch(join(checkout, dir), { recursive: true }, (_event, name) => {
          if (typeof name === "string") changed(`${dir}/${name}`);
        }),
      );
      return () => {
        for (const watcher of watchers) watcher.close();
      };
    },
    restoreTerminal() {
      try {
        process.stdin.setRawMode?.(false);
      } catch {
        // not a terminal
      }
      try {
        process.stdout.write(RESTORE);
      } catch {
        // the terminal is gone
      }
    },
    notice(text) {
      err.write(`${text}\n`);
    },
  });
  const onSignal = (signal: "SIGTERM" | "SIGHUP") => () =>
    supervisor.stop(signal);
  process.once("SIGTERM", onSignal("SIGTERM"));
  process.once("SIGHUP", onSignal("SIGHUP"));
  // Ctrl-C reaches the supervisor only while no editor holds raw mode.
  process.once("SIGINT", () => supervisor.stop("SIGTERM"));
  return supervisor.done;
}

export type TypecheckRunner = (
  argv: readonly string[],
  cwd: string,
) => Promise<{ code: number; output: string }>;

const bunRunner: TypecheckRunner = async (argv, cwd) => {
  const proc = Bun.spawn([...argv], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [code, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, output: `${out}${err}` };
};

/**
 * Typechecks dawg's own checkout after a reload (the smoke import cannot
 * see type errors). Uses the checkout's installed `tsc` only, never an
 * install: undefined when it is missing or the check passes, otherwise
 * `types ✗ N · <first error>`.
 */
export async function reloadTypecheck(
  checkout: string,
  run: TypecheckRunner = bunRunner,
): Promise<string | undefined> {
  const tsc = join(checkout, "node_modules", ".bin", "tsc");
  if (!existsSync(tsc)) return undefined;
  let result: { code: number; output: string };
  try {
    result = await run([tsc, "--noEmit", "--pretty", "false"], checkout);
  } catch {
    return undefined;
  }
  if (result.code === 0) return undefined;
  const errors = result.output
    .split("\n")
    .filter((line) => /error TS\d+/.test(line));
  const first = (errors[0] ?? result.output.trim().split("\n")[0] ?? "")
    .trim()
    .slice(0, 160);
  return `types ✗ ${Math.max(errors.length, 1)} · ${first}`;
}
