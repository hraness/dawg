import { hostname } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { defaultAuthEnv } from "./credentials.ts";
import {
  authStatus,
  login,
  logout,
  type LoginIO,
  type LoginMode,
} from "./login.ts";
import { systemRunner } from "./runner.ts";
import { audioStatusLine } from "../audio/engine.ts";

export const AUTH_USAGE = `Usage:
  dawg login            create an AI Gateway key with the Vercel CLI (default)
  dawg login --key      paste an existing AI Gateway key (hidden input)
  dawg login --xcb      use a Claude/Codex/Devin subscription through xcb
  dawg login --budget <dollars>   spend limit for the created key
  dawg logout           remove the stored key and provider choice
  dawg auth status [--check]      show provider, key, xcb account, audio backend`;

/** Entry for `dawg login|logout|auth`. Returns the process exit code. */
export async function runAuthCommand(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const io = terminalIO();
  const deps = { auth: defaultAuthEnv(systemRunner), io, hostname: hostname() };
  if (rest.includes("--help") || rest.includes("-h")) {
    io.print(AUTH_USAGE);
    return 0;
  }
  if (command === "logout") return logout(deps);
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
    }))
      io.print(line);
    io.print(audioStatusLine());
    return 0;
  }
  const flags = new Set(rest.filter((arg) => arg.startsWith("--")));
  const mode: LoginMode = flags.has("--xcb")
    ? "xcb"
    : flags.has("--key")
      ? "key"
      : "gateway";
  let budget: number | undefined;
  const budgetIndex = rest.indexOf("--budget");
  if (budgetIndex >= 0) {
    budget = Number(rest[budgetIndex + 1]);
    if (!Number.isFinite(budget) || budget < 1 || budget > 1_000_000) {
      io.print("--budget takes a dollar amount of at least 1");
      return 2;
    }
  }
  return login(mode, deps, budget === undefined ? {} : { budget });
}

function terminalIO(): LoginIO {
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
