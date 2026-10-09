import { hostname } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  defaultAuthEnv,
  readConfig,
  writeConfig,
  type DawgConfig,
} from "./credentials.ts";
import {
  authStatus,
  isLogoutTarget,
  login,
  logout,
  modelCommand,
  type LoginIO,
  type LoginOptions,
  type LoginTarget,
} from "./login.ts";
import { LOGIN_OPTIONS } from "./discover.ts";
import { chooseOnTerminal } from "./picker.ts";
import { systemRunner, type CommandRunner } from "./runner.ts";
import { selectProvider } from "../agent/provider.ts";
import { audioStatusLine } from "../audio/engine.ts";

export const AUTH_USAGE = `Usage:
  dawg model key              find existing setups and pick a provider (reuses a saved one)
  dawg model key gateway      Vercel AI Gateway: existing key, or create one with the Vercel CLI
  dawg model key openrouter   OpenRouter: authorize in your browser (OAuth PKCE)
  dawg model key codex        ChatGPT/Codex subscription through xcb
  dawg model key claude       Claude subscription through xcb
  dawg model key --pick       show the picker even when a provider is saved
  dawg model key --key        paste an AI Gateway key (hidden input)
  dawg model key --xcb        any xcb account (Devin included)
  dawg model key gateway --budget <dollars>   spend limit for a created key
  dawg model key codex|claude [--account <id>] [--model <key>]
  dawg model [<alias>|<vendor/model>]     pick the model (cost per prompt shown)
  dawg logout [gateway|openrouter|codex|claude|xcb]   forget keys and the saved choice
  dawg auth status [--check]  every provider: detected, active, validated
The older spelling of \`model key\` still works as an alias.`;

/** Entry for `dawg login|logout|auth|model`. Returns the process exit code. */
export async function runAuthCommand(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const io = terminalIO();
  const deps = { auth: defaultAuthEnv(systemRunner), io, hostname: hostname() };
  if (rest.includes("--help") || rest.includes("-h")) {
    io.print(AUTH_USAGE);
    return 0;
  }
  if (command === "logout") {
    const target = rest[0];
    if (target !== undefined && !isLogoutTarget(target)) {
      io.print(AUTH_USAGE);
      return 2;
    }
    return logout(deps, target);
  }
  if (command === "model") return modelCommand(deps, rest[0]);
  if (command === "auth") {
    if (
      rest[0] !== undefined &&
      rest[0] !== "status" &&
      rest[0] !== "--check"
    ) {
      io.print(AUTH_USAGE);
      return 2;
    }
    for (const line of await authStatus(deps, {
      verify: rest.includes("--check"),
      onProgress: (line) => io.print(line),
    }))
      io.print(line);
    io.print(audioStatusLine());
    return 0;
  }
  const parsed = parseLoginArgs(rest);
  if (typeof parsed === "string") {
    io.print(parsed);
    io.print(AUTH_USAGE);
    return 2;
  }
  return login(parsed.target, deps, parsed.options);
}

/** A one-time card the TUI shows at launch about the agent. */
export type FirstRunCard = Readonly<{
  text: string;
  tone: "info" | "warning";
}>;

/**
 * The launch note about the agent. dawg opens straight into the TUI: music
 * first, sign-in optional. The first session with no provider gets one
 * faint card, `/model key adds an agent · optional`, and records that it was
 * shown so later sessions stay quiet; a saved sign-in that stopped working
 * says so. `dawg login` and `/login` keep the picker.
 */
export async function firstRunCard(
  runner: CommandRunner = systemRunner,
): Promise<FirstRunCard | undefined> {
  const auth = defaultAuthEnv(runner);
  const config = await readConfig(auth).catch(() => ({}) as DawgConfig);
  if (auth.env.DAWG_PROVIDER) return undefined;
  if (!config.provider && config.setup === "skipped") return undefined;
  const selection = await selectProvider(auth).catch(() => undefined);
  if (!selection || selection.kind !== "offline") return undefined;
  if (selection.invalidSaved)
    return {
      text: `saved sign-in stopped working: ${selection.reason} · /login`,
      tone: "warning",
    };
  if (config.provider) return undefined;
  await writeConfig(auth, { setup: "skipped" }).catch(() => undefined);
  return { text: FIRST_RUN_CARD, tone: "info" };
}

/** The first session's agent note. */
export const FIRST_RUN_CARD = "/model key adds an agent · optional";

/** `/login` in the TUI, run while the screen is handed back to the shell. */
export async function runTuiLogin(
  target: LoginTarget,
  options: LoginOptions,
  runner: CommandRunner = systemRunner,
): Promise<number> {
  const io = terminalIO();
  return login(
    target,
    {
      auth: defaultAuthEnv(runner),
      io,
      hostname: hostname(),
    },
    options,
  ).catch((error: unknown) => {
    io.print(
      `sign-in failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
}

export function parseLoginArgs(
  args: readonly string[],
): { target: LoginTarget; options: LoginOptions } | string {
  const options: LoginOptions = {};
  let target: LoginTarget = "auto";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const value = () => {
      const next = args[index + 1];
      index += 1;
      return next && !next.startsWith("--") ? next : undefined;
    };
    if ((LOGIN_OPTIONS as readonly string[]).includes(arg))
      target = arg as LoginTarget;
    else if (arg === "--gateway") target = "gateway";
    else if (arg === "--openrouter") target = "openrouter";
    else if (arg === "--xcb") target = "xcb";
    else if (arg === "--key") target = "key";
    else if (arg === "--pick") target = "pick";
    else if (arg === "--budget") {
      const budget = Number(value());
      if (!Number.isFinite(budget) || budget < 1 || budget > 1_000_000)
        return "--budget takes a dollar amount of at least 1";
      options.budget = budget;
      if (target === "auto") target = "gateway";
    } else if (arg === "--account") {
      const account = value();
      if (!account) return "--account needs an account id";
      options.account = account;
    } else if (arg === "--model") {
      const model = value();
      if (!model) return "--model needs a model key";
      options.model = model;
    } else return `unknown argument: ${arg.slice(0, 40)}`;
  }
  return { target, options };
}

export function terminalIO(): LoginIO {
  return {
    interactive: Boolean(stdin.isTTY && stdout.isTTY),
    print: (line) => void stdout.write(`${line}\n`),
    async ask(prompt) {
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        return (await rl.question(prompt)).slice(0, 200);
      } finally {
        rl.close();
      }
    },
    readSecret: (prompt) => readHidden(prompt),
    ...(stdin.isTTY && stdout.isTTY
      ? {
          choose: (title, items, options) =>
            chooseOnTerminal(title, items, options),
        }
      : {}),
  };
}

/** Read one line in raw mode without echo. Ctrl-C rejects. */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    let value = "";
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    const done = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode?.(wasRaw);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      let text = chunk.toString("utf8");
      // Bracketed paste markers, if the terminal sends them.
      text = text.replace(/\u001b\[20[01]~/g, "");
      for (const char of text) {
        if (char === "\u0003") return done(new Error("cancelled"));
        if (char === "\r" || char === "\n") return done();
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " " && value.length < 512) value += char;
      }
    };
    stdin.on("data", onData);
  });
}
