import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetRefreshedAccounts } from "../agent/xcb.ts";
import { storeKey, type AuthEnv } from "./credentials.ts";
import { discover, withDeadline } from "./discover.ts";
import {
  scriptedRunner,
  type CommandRunner,
  type ScriptedCall,
} from "./runner.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dawg-discover-"));
  resetRefreshedAccounts();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function env(
  runner: CommandRunner,
  vars: Record<string, string> = {},
): AuthEnv {
  return { env: vars, runner, platform: "linux", dir };
}

const KEY = "vck_test1234567890abcdWXYZ";
const OR_KEY = "sk-or-v1-0123456789abcdef0123";

const has =
  (...parts: string[]) =>
  (_c: string, args: readonly string[]) =>
    parts.every((part) => args.includes(part));

const whoami = (user = "ben"): ScriptedCall => ({
  match: has("whoami"),
  result: {
    stdout: JSON.stringify({ username: user, team: { slug: "hraness" } }),
  },
});

type Row = Record<string, unknown>;
const account = (id: string, provider: string, extra: Row = {}): Row => ({
  id,
  name: `${id}@${provider}`,
  provider,
  connected: true,
  available: true,
  reason: null,
  admission: "qualified",
  models: [{ key: `${provider}/model`, admission: "qualified" }],
  ...extra,
});

function xcbCalls(accounts: Row[], version = "0.20.0"): ScriptedCall[] {
  return [
    {
      match: has("--capabilities"),
      result: {
        stdout: JSON.stringify({ version: 1, supported: true, accounts }),
      },
    },
    {
      match: (_c, args) => args.join(" ") === "--json accounts",
      result: { stdout: JSON.stringify({ accounts: [] }) },
    },
    { match: has("--version"), result: { stdout: `xcb ${version}\n` } },
  ];
}

describe("discovery", () => {
  test("nothing installed: every option says not set up", async () => {
    const found = await discover(env(scriptedRunner([])), { cwd: dir });
    expect(found.options.map((o) => o.id)).toEqual([
      "gateway",
      "openrouter",
      "codex",
      "claude",
    ]);
    expect(found.options.every((o) => !o.ready && !o.detected)).toBe(true);
    expect(found.vercel.state).toBe("missing");
    expect(found.xcb.state).toBe("missing");
  });

  test("env keys and the logged-in vercel CLI are found, keys masked", async () => {
    const found = await discover(
      env(scriptedRunner([whoami()], ["vercel"]), {
        AI_GATEWAY_API_KEY: KEY,
        OPENROUTER_API_KEY: OR_KEY,
      }),
      { cwd: dir },
    );
    const [gateway, openrouter] = found.options;
    expect(gateway).toMatchObject({
      ready: true,
      summary: "✓ found AI_GATEWAY_API_KEY",
    });
    expect(openrouter).toMatchObject({
      ready: true,
      summary: "✓ found OPENROUTER_API_KEY",
    });
    expect(found.vercel).toMatchObject({
      loggedIn: true,
      user: "ben (team hraness)",
    });
    expect(JSON.stringify(found.options)).not.toContain(KEY);
  });

  test("a logged-in vercel CLI without a key is detected, one step from ready", async () => {
    const found = await discover(env(scriptedRunner([whoami()], ["vercel"])), {
      cwd: dir,
    });
    expect(found.options[0]).toMatchObject({
      ready: false,
      detected: true,
      summary: "✓ vercel CLI logged in as ben (team hraness); creates a key",
    });
  });

  test("a stored OpenRouter key shows its mask; a linked project is noted", async () => {
    const runner = scriptedRunner(
      [{ match: has("whoami"), result: { code: 1 } }],
      ["vercel"],
    );
    await storeKey(
      { ...env(runner), env: { DAWG_CREDENTIAL_STORE: "file" } },
      "openrouter",
      OR_KEY,
    );
    await mkdir(join(dir, "proj", ".vercel"), { recursive: true });
    await writeFile(join(dir, "proj", ".vercel", "project.json"), "{}");
    const found = await discover(
      { ...env(runner), env: { DAWG_CREDENTIAL_STORE: "file" } },
      { cwd: join(dir, "proj") },
    );
    expect(found.options[1]?.summary).toBe("✓ saved key sk-or-…0123");
    expect(found.linkedProject).toBe(true);
    expect(found.options[0]?.summary).toContain("project linked");
  });

  test("xcb accounts split by provider with ready / pending / signed-out counts", async () => {
    const found = await discover(
      env(
        scriptedRunner(
          xcbCalls([
            account("c1", "codex"),
            account("c2", "codex", {
              admission: "pending",
              models: [{ key: "codex/model", admission: "pending" }],
            }),
            account("c3", "codex", {
              available: false,
              connected: false,
              reason: "not_connected",
              admission: null,
              models: [],
            }),
            account("a1", "claude", {
              available: false,
              reason: "application_disabled",
              admission: null,
              models: [],
            }),
          ]),
          ["xcb"],
        ),
      ),
      { cwd: dir },
    );
    expect(found.xcb).toMatchObject({
      state: "ok",
      version: "0.20.0",
      outdated: false,
    });
    const [, , codex, claude] = found.options;
    expect(codex?.ready).toBe(true);
    expect(codex?.summary).toContain("1 Codex account ready");
    expect(codex?.summary).toContain("1 admission pending");
    expect(codex?.summary).toContain("1 not signed in");
    expect(claude?.ready).toBe(false);
  });

  test("xcb older than 0.20 is flagged outdated", async () => {
    const found = await discover(
      env(
        scriptedRunner(
          xcbCalls(
            [
              {
                id: "c1",
                provider: "codex",
                connected: true,
                available: false,
                reason: "application_not_qualified",
                models: [{ key: "codex/model" }],
              },
            ],
            "0.17.11",
          ),
          ["xcb"],
        ),
      ),
      { cwd: dir },
    );
    expect(found.xcb).toMatchObject({ version: "0.17.11", outdated: true });
    expect(found.options[2]?.summary).toContain("0.20.0");
  });

  test("models_unavailable accounts are refreshed once, in parallel, then re-read", async () => {
    const stale = account("c1", "codex", {
      available: false,
      reason: "models_unavailable",
      admission: null,
      models: [],
    });
    const fresh = account("c1", "codex", {
      admission: "pending",
      models: [{ key: "codex/model", admission: "pending" }],
    });
    const progress: string[] = [];
    const runner = scriptedRunner(
      [
        ...xcbCalls([stale]),
        { match: has("refresh", "c1"), result: { code: 0 } },
        {
          match: has("--capabilities"),
          result: { stdout: JSON.stringify({ version: 1, accounts: [fresh] }) },
        },
      ],
      ["xcb"],
    );
    const found = await discover(env(runner), {
      cwd: dir,
      refreshXcb: true,
      onProgress: (line) => void progress.push(line),
    });
    expect(progress).toEqual(["refreshing 1 codex account…"]);
    expect(found.options[2]?.ready).toBe(true);
    const refresh = runner.calls.find((call) => call.args.includes("refresh"));
    expect(refresh?.options.timeoutMs).toBe(10_000);

    // A second discovery in the same process never refreshes c1 again.
    const again = scriptedRunner(xcbCalls([stale]), ["xcb"]);
    await discover(env(again), { cwd: dir, refreshXcb: true });
    expect(again.calls.some((call) => call.args.includes("refresh"))).toBe(
      false,
    );
  });

  test("startup discovery never refreshes", async () => {
    const runner = scriptedRunner(
      xcbCalls([
        account("c1", "codex", {
          available: false,
          reason: "models_unavailable",
          admission: null,
          models: [],
        }),
      ]),
      ["xcb"],
    );
    await discover(env(runner), { cwd: dir });
    expect(runner.calls.some((call) => call.args.includes("refresh"))).toBe(
      false,
    );
  });

  test("a hung vercel or xcb is cut off at the deadline", async () => {
    const hang = (
      _c: string,
      _a: readonly string[],
      options: { signal?: AbortSignal },
    ) =>
      new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    const runner = scriptedRunner(
      [
        { match: has("whoami"), respond: hang },
        { match: has("--capabilities"), respond: hang },
        { match: has("accounts"), respond: hang },
        { match: has("--version"), respond: hang },
      ],
      ["vercel", "xcb"],
    );
    const started = performance.now();
    const found = await discover(env(runner, { AI_GATEWAY_API_KEY: KEY }), {
      cwd: dir,
      timeoutMs: 120,
    });
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(found.vercel.state).toBe("timeout");
    expect(found.xcb.state).toBe("timeout");
    // The key found in the environment still makes the gateway ready.
    expect(found.options[0]?.ready).toBe(true);
    expect(found.options[0]?.summary).toBe("✓ found AI_GATEWAY_API_KEY");
  });

  test("withDeadline resolves undefined on a miss and the value otherwise", async () => {
    expect(
      await withDeadline(
        Bun.sleep(200).then(() => 1),
        20,
      ),
    ).toBeUndefined();
    expect(await withDeadline(Promise.resolve(2), 20)).toEqual({ value: 2 });
  });
});
