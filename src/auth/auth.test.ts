import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearGatewayKey,
  maskKey,
  parseConfig,
  readConfig,
  resolveGatewayKey,
  storeGatewayKey,
  writeConfig,
  type AuthEnv,
} from "./credentials.ts";
import {
  authStatus,
  login,
  logout,
  safeHostname,
  saveModelChoice,
  type LoginIO,
} from "./login.ts";
import { selectProvider } from "../agent/provider.ts";
import {
  scriptedRunner,
  systemRunner,
  type CommandRunner,
  type ScriptedCall,
} from "./runner.ts";

const KEY = "vck_test1234567890abcdWXYZ";
const OTHER = "vck_other0000000000000zzzz";
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dawg-auth-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function env(
  runner: CommandRunner,
  overrides: { env?: Record<string, string>; platform?: string } = {},
): AuthEnv {
  return {
    env: overrides.env ?? {},
    runner,
    platform: overrides.platform ?? "linux",
    dir,
  };
}

function io(answers: string[] = [], interactive = true) {
  const lines: string[] = [];
  const queue = [...answers];
  const value: LoginIO & { lines: string[] } = {
    lines,
    interactive,
    print: (line) => void lines.push(line),
    readSecret: async () => queue.shift() ?? "",
    ask: async () => queue.shift() ?? "",
  };
  return value;
}

const okFetch = async () => new Response("{}", { status: 200 });
const rejectFetch = async () => new Response("no", { status: 401 });
const offlineFetch = async (): Promise<Response> => {
  throw new Error("offline");
};

const is =
  (cmd: string, ...prefix: string[]) =>
  (command: string, args: readonly string[]) =>
    command.endsWith(cmd) &&
    prefix.every((part, index) => args[index] === part);

/** A fake keychain backed by a variable, driven through `security`. */
function keychain(initial?: string): {
  calls: ScriptedCall[];
  value: () => string | undefined;
} {
  let stored = initial;
  const step: ScriptedCall = {
    match: is("security"),
    respond: (_command, args, options) => {
      if (args[0] === "-i") {
        const match = options.stdin?.match(/-w "([^"]+)"/);
        stored = match?.[1];
        return { code: 0 };
      }
      if (args[0] === "find-generic-password")
        return stored ? { code: 0, stdout: `${stored}\n` } : { code: 44 };
      if (args[0] === "delete-generic-password") {
        const had = stored !== undefined;
        stored = undefined;
        return { code: had ? 0 : 44 };
      }
      return { code: 1 };
    },
  };
  return { calls: Array.from({ length: 20 }, () => step), value: () => stored };
}

describe("credentials", () => {
  test("masks keys and never reveals the middle", () => {
    expect(maskKey(KEY)).toBe("vck_…WXYZ");
    expect(maskKey("abcdefghijklmnopqrst")).toBe("…qrst");
    expect(maskKey(KEY)).not.toContain("1234567890");
  });

  test("env wins over keychain wins over file", async () => {
    const chain = keychain(OTHER);
    const runner = scriptedRunner(chain.calls, ["security"]);
    await writeConfig(env(runner), {});
    // File first.
    const fileAuth = env(runner, { platform: "linux" });
    await storeGatewayKey(fileAuth, KEY);
    expect(await resolveGatewayKey(fileAuth)).toEqual({
      key: KEY,
      source: "file",
    });
    // Keychain beats file on darwin.
    expect(
      await resolveGatewayKey(env(runner, { platform: "darwin" })),
    ).toEqual({
      key: OTHER,
      source: "keychain",
    });
    // Env beats both.
    const envKey = "vck_envkey00000000000000001";
    expect(
      await resolveGatewayKey(
        env(runner, {
          platform: "darwin",
          env: { AI_GATEWAY_API_KEY: envKey },
        }),
      ),
    ).toEqual({ key: envKey, source: "env" });
  });

  test("keychain store passes the secret on stdin, never argv, and drops the file copy", async () => {
    const chain = keychain();
    const runner = scriptedRunner(chain.calls, ["security"]);
    await storeGatewayKey(env(runner), KEY); // linux → file
    const auth = env(runner, { platform: "darwin" });
    expect(await storeGatewayKey(auth, OTHER)).toBe("keychain");
    expect(chain.value()).toBe(OTHER);
    for (const call of runner.calls)
      expect(call.args.join(" ")).not.toContain(OTHER);
    expect(await Bun.file(join(dir, "credentials.json")).exists()).toBe(false);
  });

  test("falls back to a 0600 file under a 0700 dir when the keychain fails", async () => {
    const runner = scriptedRunner(
      [
        { match: is("security"), result: { code: 1 } },
        { match: is("security"), result: { code: 44 } },
      ],
      ["security"],
    );
    const auth = env(runner, { platform: "darwin" });
    expect(await storeGatewayKey(auth, KEY)).toBe("file");
    const file = join(dir, "credentials.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(file, "utf8")).aiGateway).toBe(KEY);
  });

  test("DAWG_CREDENTIAL_STORE=file skips the keychain", async () => {
    const runner = scriptedRunner([], ["security"]);
    const auth = env(runner, {
      platform: "darwin",
      env: { DAWG_CREDENTIAL_STORE: "file" },
    });
    expect(await storeGatewayKey(auth, KEY)).toBe("file");
    expect(runner.calls).toHaveLength(0);
  });

  test("rejects malformed keys and ignores garbage files", async () => {
    const auth = env(scriptedRunner([]));
    await expect(storeGatewayKey(auth, "short")).rejects.toThrow();
    await expect(storeGatewayKey(auth, `${KEY}" ; rm -rf /`)).rejects.toThrow();
    await Bun.write(join(dir, "credentials.json"), "{not json");
    expect(await resolveGatewayKey(auth)).toBeUndefined();
    await Bun.write(
      join(dir, "credentials.json"),
      JSON.stringify({ aiGateway: 42 }),
    );
    expect(await resolveGatewayKey(auth)).toBeUndefined();
    await Bun.write(join(dir, "credentials.json"), "x".repeat(20_000));
    expect(await resolveGatewayKey(auth)).toBeUndefined();
  });

  test("config is bounded and validated from unknown", async () => {
    expect(
      parseConfig({
        provider: "xcb",
        xcb: { account: "acct_1", model: "claude/sonnet" },
      }),
    ).toEqual({
      provider: "xcb",
      xcb: { account: "acct_1", model: "claude/sonnet" },
    });
    expect(
      parseConfig({ provider: "evil", xcb: { account: "a b", model: 3 } }),
    ).toEqual({});
    expect(parseConfig(null)).toEqual({});
    const auth = env(scriptedRunner([]));
    await writeConfig(auth, { provider: "gateway" });
    expect((await readConfig(auth)).provider).toBe("gateway");
    expect((await stat(join(dir, "config.json"))).mode & 0o777).toBe(0o600);
  });

  test("clear removes both backends", async () => {
    const chain = keychain(OTHER);
    const runner = scriptedRunner(chain.calls, ["security"]);
    await storeGatewayKey(env(runner), KEY);
    expect(await clearGatewayKey(env(runner, { platform: "darwin" }))).toEqual([
      "keychain",
      "file",
    ]);
    expect(
      await resolveGatewayKey(env(runner, { platform: "darwin" })),
    ).toBeUndefined();
  });
});

describe("dawg login (gateway)", () => {
  const whoami = (code = 0): ScriptedCall => ({
    match: is("vercel", "whoami"),
    result:
      code === 0
        ? {
            code,
            stdout: JSON.stringify({
              username: "ben",
              team: { slug: "hraness" },
            }),
          }
        : { code, stderr: "Error: not logged in" },
  });
  const create = (stdout = `${KEY}\n`, code = 0): ScriptedCall => ({
    match: is("vercel", "ai-gateway", "api-keys", "create"),
    result: { code, stdout, stderr: "> Created key" },
  });

  test("already logged in: creates a key, stores it, validates it", async () => {
    const runner = scriptedRunner([whoami(), create()], ["vercel"]);
    const out = io();
    const code = await login(
      "gateway",
      {
        auth: env(runner),
        io: out,
        hostname: "Bens-MBP.local",
        fetcher: okFetch,
      },
      { budget: 25 },
    );
    expect(code).toBe(0);
    const createCall = runner.calls.find(
      (call) => call.args[0] === "ai-gateway",
    )!;
    expect(createCall.args).toEqual([
      "ai-gateway",
      "api-keys",
      "create",
      "--name",
      "dawg-bens-mbp",
      "--non-interactive",
      "--limit",
      "25",
    ]);
    expect(out.lines.join("\n")).not.toContain(KEY);
    expect(out.lines).toContain("Vercel: ben (team hraness)");
    expect(out.lines.join("\n")).toContain("✓ AI Gateway accepted the key");
    expect((await resolveGatewayKey(env(runner)))?.key).toBe(KEY);
    expect((await readConfig(env(runner))).provider).toBe("gateway");
  });

  test("not logged in: hands the terminal to vercel login, then continues", async () => {
    const runner = scriptedRunner(
      [
        whoami(1),
        { match: is("vercel", "login"), result: { code: 0 } },
        whoami(),
        create(),
      ],
      ["vercel"],
    );
    const out = io();
    expect(
      await login("gateway", {
        auth: env(runner),
        io: out,
        hostname: "h",
        fetcher: okFetch,
      }),
    ).toBe(0);
    expect(
      runner.calls.find((call) => call.args[0] === "login")?.options.inherit,
    ).toBe(true);
    expect(out.lines).toContain(
      "Not logged in to Vercel; starting `vercel login` (opens your browser)…",
    );
  });

  test("not logged in and non-interactive: does not start a login", async () => {
    const runner = scriptedRunner([whoami(1)], ["vercel"]);
    const out = io([], false);
    expect(
      await login("gateway", { auth: env(runner), io: out, hostname: "h" }),
    ).toBe(1);
    expect(runner.calls).toHaveLength(1);
  });

  test("aborted vercel login saves nothing", async () => {
    const runner = scriptedRunner(
      [whoami(1), { match: is("vercel", "login"), result: { code: 1 } }],
      ["vercel"],
    );
    expect(
      await login("gateway", { auth: env(runner), io: io(), hostname: "h" }),
    ).toBe(1);
    expect(await resolveGatewayKey(env(runner))).toBeUndefined();
  });

  test("key creation failure redacts anything key-shaped", async () => {
    const runner = scriptedRunner(
      [
        whoami(),
        {
          match: is("vercel", "ai-gateway"),
          result: { code: 1, stderr: `boom ${KEY}` },
        },
      ],
      ["vercel"],
    );
    const out = io();
    expect(
      await login("gateway", { auth: env(runner), io: out, hostname: "h" }),
    ).toBe(1);
    expect(out.lines.join("\n")).not.toContain(KEY);
  });

  test("no vercel CLI: prints the install hint and takes a pasted key", async () => {
    const runner = scriptedRunner([]);
    const out = io(["not a key!", KEY]);
    expect(
      await login("gateway", {
        auth: env(runner),
        io: out,
        hostname: "h",
        fetcher: okFetch,
      }),
    ).toBe(0);
    expect(out.lines[0]).toContain("Vercel CLI is not installed");
    expect(out.lines[1]).toContain("bun add -g vercel");
    expect(out.lines.some((line) => line.includes("does not look like"))).toBe(
      true,
    );
    expect((await resolveGatewayKey(env(runner)))?.key).toBe(KEY);
  });

  test("pasted key rejected by the gateway is not saved; blank input opens the key page", async () => {
    const runner = scriptedRunner(
      [{ match: is("xdg-open"), result: { code: 0 } }],
      ["xdg-open"],
    );
    const out = io(["", KEY, KEY, KEY]);
    expect(
      await login("key", {
        auth: env(runner),
        io: out,
        hostname: "h",
        fetcher: rejectFetch,
      }),
    ).toBe(1);
    expect(runner.calls[0]?.args[0]).toContain("vercel.com/d?to=");
    expect(await resolveGatewayKey(env(runner))).toBeUndefined();
  });

  test("offline validation still saves with a warning", async () => {
    const runner = scriptedRunner([]);
    const out = io([KEY]);
    expect(
      await login("key", {
        auth: env(runner),
        io: out,
        hostname: "h",
        fetcher: offlineFetch,
      }),
    ).toBe(0);
    expect(out.lines.join("\n")).toContain("Could not reach AI Gateway");
  });

  test("hostname is sanitized for the key name", () => {
    expect(safeHostname("Ben's MacBook Pro.local")).toMatch(/^[a-z0-9-]+$/);
    expect(safeHostname("")).toBe("host");
  });
});

describe("logout and status", () => {
  test("status masks the key and reports its source", async () => {
    const runner = scriptedRunner([]);
    const auth = env(runner);
    await storeGatewayKey(auth, KEY);
    const lines = await authStatus(
      { auth, fetcher: okFetch },
      { verify: true },
    );
    expect(lines.join("\n")).not.toContain(KEY);
    expect(lines[0]).toBe("active: opus-5.5 · gateway (auto)");
    expect(lines[1]).toMatch(/^● Vercel AI Gateway .*vck_…WXYZ.* · valid$/);
    expect(lines.at(-1)).toStartWith("xcb: not installed");
  });

  test("status with nothing configured points at dawg login", async () => {
    const lines = await authStatus({ auth: env(scriptedRunner([])) });
    expect(lines[0]).toContain("offline");
    expect(lines[0]).toContain("dawg login");
    expect(lines[1]).toContain("not set up");
    expect(lines).toHaveLength(6);
  });

  test("logout clears key and provider choice", async () => {
    const runner = scriptedRunner([]);
    const auth = env(runner);
    await storeGatewayKey(auth, KEY);
    await writeConfig(auth, { provider: "gateway" });
    const out = io();
    expect(await logout({ auth, io: out })).toBe(0);
    expect(await resolveGatewayKey(auth)).toBeUndefined();
    expect(await readConfig(auth)).toEqual({});
  });
});

describe("system runner", () => {
  test("captures output, feeds stdin, and bounds output", async () => {
    const result = await systemRunner.run("/bin/cat", [], {
      stdin: "hello",
      maxOutputBytes: 3,
    });
    expect(result).toEqual({
      code: 0,
      stdout: "hel",
      stderr: "",
      killed: false,
    });
  });

  test("abort sends SIGTERM and waits for the child", async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 50);
    const result = await systemRunner.run("/bin/sleep", ["30"], {
      signal: controller.signal,
    });
    expect(result.killed).toBe(true);
    expect(result.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("timeout kills the child", async () => {
    const result = await systemRunner.run("/bin/sleep", ["30"], {
      timeoutMs: 50,
    });
    expect(result.killed).toBe(true);
  });
});

describe("saved provider and model", () => {
  test("a valid saved choice is reused silently, without discovery", async () => {
    const runner = scriptedRunner([]);
    const auth = env(runner);
    await storeGatewayKey(auth, KEY);
    await saveModelChoice(auth, await selectProvider(auth), "sol-6.1");
    const out = io();
    expect(await login("auto", { auth, io: out, hostname: "h" })).toBe(0);
    expect(out.lines.join("\n")).toContain("Signed in · sol-6.1 · gateway");
    expect(out.lines.join("\n")).not.toContain("Looking for existing setups");
    const raw = await readFile(join(dir, "config.json"), "utf8");
    expect(raw).not.toContain(KEY);
    expect(JSON.parse(raw)).toMatchObject({
      provider: "gateway",
      gatewayModel: "openai/gpt-6.1-sol",
    });
    expect((await stat(join(dir, "config.json"))).mode & 0o777).toBe(0o600);
  });

  test("a revoked saved choice is reported once and never swapped", async () => {
    const auth = env(scriptedRunner([]));
    await writeConfig(auth, {
      provider: "gateway",
      gatewayModel: "openai/gpt-6.1-sol",
    });
    const selection = await selectProvider(auth);
    expect(selection).toMatchObject({ kind: "offline", invalidSaved: true });
    const out = io([], false);
    await login("auto", { auth, io: out, hostname: "h" });
    expect(out.lines.join("\n")).toContain(
      "Your saved sign-in stopped working",
    );
  });

  test("logout clears the saved model; logout <other> keeps the active choice", async () => {
    const auth = env(scriptedRunner([]));
    await storeGatewayKey(auth, KEY);
    await writeConfig(auth, {
      provider: "gateway",
      gatewayModel: "openai/gpt-6.1-sol",
      openrouterModel: "anthropic/claude-opus-5.5",
    });
    await logout({ auth, io: io() }, "openrouter");
    expect(await readConfig(auth)).toEqual({
      provider: "gateway",
      gatewayModel: "openai/gpt-6.1-sol",
    });
    await logout({ auth, io: io() });
    expect(await readConfig(auth)).toEqual({});
  });
});
