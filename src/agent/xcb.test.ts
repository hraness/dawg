import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore, type TrackScore } from "../../core/score.ts";
import {
  storeGatewayKey,
  writeConfig,
  type AuthEnv,
} from "../auth/credentials.ts";
import { login, type LoginIO } from "../auth/login.ts";
import {
  scriptedRunner,
  type CommandRunner,
  type ScriptedCall,
} from "../auth/runner.ts";
import {
  StaleRevisionError,
  type AgentEvent,
  type AgentHost,
} from "./agent.ts";
import {
  generateText,
  providerFingerprint,
  providerLabel,
  runProviderTurn,
  selectProvider,
} from "./provider.ts";
import { runTextAgentTurn, type TextGenerate } from "./xcb-agent.ts";
import {
  extractFirstJsonObject,
  parseCapabilities,
  parseTextReply,
  readCapabilities,
  xcbGenerate,
  XcbError,
} from "./xcb.ts";

const ACCOUNT = "a_9ddef4bdeded45468148d4c6502f27c2";
const capabilities = (available: boolean) => ({
  version: 1,
  supported: true,
  zeroTools: true,
  accounts: [
    {
      id: "a_014c386628b94953bb36b39668ca210a",
      name: "slop@pm.me",
      provider: "codex",
      connected: true,
      available: false,
      reason: "application_not_qualified",
      models: [],
    },
    {
      id: ACCOUNT,
      name: "devin/a_9ddef4bd",
      provider: "devin",
      connected: true,
      available,
      reason: available ? null : "application_not_qualified",
      models: available ? [{ key: "devin/swe-2-high", label: "SWE-2" }] : [],
    },
  ],
});

const capsCall = (available: boolean): ScriptedCall => ({
  match: (_c, args) => args.includes("--capabilities"),
  result: { stdout: JSON.stringify(capabilities(available)) },
});

describe("xcb capabilities", () => {
  test("parses accounts, availability and models", () => {
    const parsed = parseCapabilities(capabilities(true));
    expect(parsed.supported).toBe(true);
    expect(parsed.accounts).toHaveLength(2);
    expect(parsed.accounts[1]).toEqual({
      id: ACCOUNT,
      label: "devin/a_9ddef4bd",
      provider: "devin",
      available: true,
      connected: true,
      reason: null,
      models: [{ key: "devin/swe-2-high", label: "SWE-2" }],
    });
    expect(parsed.accounts[0]?.reason).toBe("application_not_qualified");
  });

  test("drops malformed rows and never trusts available without models", () => {
    const parsed = parseCapabilities({
      version: 1,
      accounts: [
        null,
        { id: "bad id with spaces", available: true },
        { id: "ok", available: true, models: [{ key: "a b" }, 4] },
        { id: "x".repeat(500) },
        { id: "ctl", name: "evil\u001b[2Jname", available: false, models: [] },
      ],
    });
    expect(parsed.accounts.map((row) => row.id)).toEqual(["ok", "ctl"]);
    expect(parsed.accounts[0]?.available).toBe(false);
    expect(parsed.accounts[1]?.label).not.toContain("\u001b");
    expect(() => parseCapabilities({ version: 2 })).toThrow(XcbError);
    expect(() => parseCapabilities("nope")).toThrow(XcbError);
  });

  test("a pending automatic admission is usable; denied never is", () => {
    const row = (extra: Record<string, unknown>) => ({
      id: "acct",
      provider: "devin",
      connected: true,
      available: false,
      reason: "application_not_qualified",
      models: [{ key: "devin/swe-2-high" }],
      ...extra,
    });
    const parsed = parseCapabilities({
      version: 1,
      accounts: [
        row({ id: "p", admission: "pending" }),
        row({ id: "o", admission: { state: "pending" } }),
        row({ id: "d", available: true, admission: "denied" }),
        row({ id: "x", admission: "weird" }),
        row({ id: "n" }),
        row({ id: "e", admission: "pending", models: [] }),
      ],
    });
    const by = Object.fromEntries(parsed.accounts.map((a) => [a.id, a]));
    expect(by.p).toMatchObject({ available: true, admission: "pending" });
    expect(by.o).toMatchObject({ available: true, admission: "pending" });
    expect(by.d).toMatchObject({ available: false, admission: "denied" });
    expect(by.x?.available).toBe(false);
    expect(by.x && "admission" in by.x).toBe(false);
    expect(by.n?.available).toBe(false);
    expect(by.e?.available).toBe(false);
  });

  test("readCapabilities surfaces non-JSON and failures", async () => {
    await expect(
      readCapabilities(
        "xcb",
        scriptedRunner([{ match: () => true, result: { stdout: "<html>" } }]),
      ),
    ).rejects.toThrow("not valid JSON");
    await expect(
      readCapabilities(
        "xcb",
        scriptedRunner([{ match: () => true, result: { code: 2 } }]),
      ),
    ).rejects.toThrow("exit 2");
  });
});

describe("xcb generate", () => {
  test("sends one bounded JSON request on stdin and returns text", async () => {
    const runner = scriptedRunner([
      {
        match: (_c, args) => args.join(" ") === "--json generate",
        result: {
          stdout: JSON.stringify({
            version: 1,
            status: "completed",
            text: "hi",
          }),
        },
      },
    ]);
    const text = await xcbGenerate({
      bin: "xcb",
      runner,
      account: ACCOUNT,
      model: "devin/swe-2-high",
      prompt: "say hi",
      timeoutMs: 999_999,
      maxOutputBytes: 10_000_000,
    });
    expect(text).toBe("hi");
    const body = JSON.parse(runner.calls[0]!.options.stdin!);
    expect(body).toEqual({
      version: 1,
      account: ACCOUNT,
      model: "devin/swe-2-high",
      prompt: "say hi",
      timeoutMs: 300_000,
      maxOutputBytes: 262_144,
    });
  });

  test("maps fixed-shape failures to codes and rejects bad ids", async () => {
    const runner = scriptedRunner([
      {
        match: () => true,
        result: {
          code: 1,
          stdout: JSON.stringify({
            status: "failed",
            code: "busy",
            requestId: "r_1",
          }),
        },
      },
    ]);
    const request = {
      bin: "xcb",
      runner,
      account: ACCOUNT,
      model: "m",
      prompt: "p",
      timeoutMs: 5000,
      maxOutputBytes: 100,
    };
    await expect(xcbGenerate(request)).rejects.toMatchObject({ code: "busy" });
    await expect(
      xcbGenerate({ ...request, account: "--evil arg" }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});

describe("text reply parsing", () => {
  test("extracts the first balanced object around prose and code fences", () => {
    const reply = parseTextReply(
      'Sure! ```json\n{"ops":[{"tool":"set_tempo","args":{"bpm":96}}],"say":"Slower {groove}","done":true}\n``` and {"ops":[]}',
    );
    expect(reply).toEqual({
      ops: [{ tool: "set_tempo", args: { bpm: 96 } }],
      say: "Slower {groove}",
      done: true,
    });
  });

  test("skips unbalanced or invalid candidates", () => {
    expect(extractFirstJsonObject('{bad} then {"a":"}"}')).toBe('{"a":"}"}');
    expect(extractFirstJsonObject("{ never closes")).toBeUndefined();
  });

  test("rejects garbage, oversized and malformed replies", () => {
    expect(() => parseTextReply("I cannot help with that.")).toThrow(
      "did not contain",
    );
    expect(() => parseTextReply(`${"x".repeat(70_000)}{"ops":[]}`)).toThrow(
      "64 KiB",
    );
    expect(() => parseTextReply('{"ops":"nope"}')).toThrow("array");
    expect(() => parseTextReply('{"ops":[{"args":{}}]}')).toThrow("tool name");
    expect(() => parseTextReply('{"ops":[{"tool":"x","args":[1]}]}')).toThrow(
      "args",
    );
    const many = JSON.stringify({
      ops: Array.from({ length: 40 }, () => ({ tool: "set_tempo", args: {} })),
    });
    expect(() => parseTextReply(many)).toThrow("at most 16");
    expect(parseTextReply('{"done":false}')).toEqual({ ops: [], done: false });
    expect(
      parseTextReply(JSON.stringify({ say: "s".repeat(2000) })).say?.length,
    ).toBe(400);
  });
});

function memoryHost(
  initial: TrackScore = createScore({ tracks: [{ id: "main" }] }),
) {
  const state = { score: initial, revision: 3, commits: 0 };
  const host: AgentHost = {
    snapshot: () => ({
      score: state.score,
      revision: state.revision,
      focusedTrackId: "main",
      recentOperations: [],
    }),
    commit: (change) => {
      if (change.baseRevision !== state.revision)
        return Promise.reject(
          new StaleRevisionError(change.baseRevision, state.revision),
        );
      state.score = change.next;
      state.revision += 1;
      state.commits += 1;
      return Promise.resolve({ revision: state.revision });
    },
  };
  return { state, host };
}

function scriptedGenerate(replies: string[]) {
  const prompts: string[] = [];
  const generate: TextGenerate = async (prompt) => {
    prompts.push(prompt);
    const next = replies.shift();
    if (next === undefined) throw new Error("no more replies");
    return next;
  };
  return { prompts, generate };
}

describe("text agent loop", () => {
  test("applies ops through the shared validation and commits each as a revision", async () => {
    const { state, host } = memoryHost();
    const events: AgentEvent[] = [];
    const { generate, prompts } = scriptedGenerate([
      JSON.stringify({
        ops: [
          { tool: "set_tempo", args: { bpm: 96 } },
          {
            tool: "add_notes",
            args: {
              trackId: "main",
              notes: [{ pitch: "C3", start: 0, duration: 1 }],
            },
          },
        ],
        say: "Slowed it and added a root note.",
        done: true,
      }),
    ]);
    const result = await runTextAgentTurn({
      prompt: "slower with a root",
      generate,
      host,
      onEvent: (e) => events.push(e),
    });
    expect(result).toMatchObject({
      type: "done",
      reason: "stop",
      applied: 2,
      revision: 5,
    });
    expect(state.commits).toBe(2);
    expect(state.score.tempoBpm).toBe(96);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("add_notes");
    expect(prompts[0]).toContain("slower with a root");
    const types = events.map((event) => event.type);
    expect(types).toContain("text-delta");
    expect(types.filter((type) => type === "tool-applied")).toHaveLength(2);
  });

  test("retries with diagnostics after rejected ops and garbage, up to 3 calls", async () => {
    const { state, host } = memoryHost();
    const events: AgentEvent[] = [];
    const { generate, prompts } = scriptedGenerate([
      "no json here",
      JSON.stringify({
        ops: [
          { tool: "set_tempo", args: { bpm: 9000 } },
          { tool: "fly", args: {} },
        ],
        done: true,
      }),
      JSON.stringify({
        ops: [{ tool: "set_tempo", args: { bpm: 120 } }],
        done: true,
      }),
    ]);
    const result = await runTextAgentTurn({
      prompt: "faster",
      generate,
      host,
      onEvent: (e) => events.push(e),
    });
    expect(result).toMatchObject({ type: "done", reason: "stop", applied: 1 });
    expect(state.score.tempoBpm).toBe(120);
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toContain("did not contain a JSON object");
    expect(prompts[2]).toContain("ops[0] set_tempo");
    expect(prompts[2]).toContain("ops[1] fly");
    expect(
      events.filter((event) => event.type === "tool-rejected"),
    ).toHaveLength(3);
  });

  test("stops at the step limit when the model never finishes", async () => {
    const { host } = memoryHost();
    const reply = JSON.stringify({ ops: [], done: false });
    const { generate, prompts } = scriptedGenerate([
      reply,
      reply,
      reply,
      reply,
      reply,
    ]);
    const result = await runTextAgentTurn({ prompt: "x", generate, host });
    expect(result).toMatchObject({ type: "done", reason: "max-steps" });
    expect(prompts).toHaveLength(3);
  });

  test("cancellation kills the xcb child and keeps the last accepted revision", async () => {
    const { state, host } = memoryHost();
    const controller = new AbortController();
    let call = 0;
    let killedWith: AbortSignal | undefined;
    const runner: CommandRunner = {
      which: () => "/bin/xcb",
      run: (_command, _args, options = {}) => {
        call += 1;
        if (call === 1)
          return Promise.resolve({
            code: 0,
            killed: false,
            stderr: "",
            stdout: JSON.stringify({
              status: "completed",
              text: JSON.stringify({
                ops: [{ tool: "set_tempo", args: { bpm: 100 } }],
                done: false,
              }),
            }),
          });
        // Second call hangs until aborted, like a real child receiving SIGTERM.
        return new Promise((resolve) => {
          killedWith = options.signal;
          options.signal?.addEventListener("abort", () =>
            setTimeout(
              () =>
                resolve({ code: 143, stdout: "", stderr: "", killed: true }),
              10,
            ),
          );
          setTimeout(() => controller.abort(), 20);
        });
      },
    };
    const result = await runProviderTurn({
      selection: {
        kind: "xcb",
        choice: "xcb",
        bin: "/bin/xcb",
        account: ACCOUNT,
        accountLabel: "devin",
        model: "devin/swe-2-high",
      },
      prompt: "x",
      model: "opus-5.5",
      host,
      runner,
      signal: controller.signal,
    });
    expect(killedWith?.aborted).toBe(true);
    expect(result).toMatchObject({
      type: "error",
      code: "aborted",
      revision: 4,
      applied: 1,
    });
    expect(state.score.tempoBpm).toBe(100);
  });
});

describe("provider selection", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "track-provider-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const auth = (
    runner: CommandRunner,
    env: Record<string, string> = {},
  ): AuthEnv => ({
    env,
    runner,
    platform: "linux",
    dir,
  });
  const KEY = "vck_test1234567890abcdWXYZ";

  test("auto prefers a gateway key", async () => {
    const selection = await selectProvider(
      auth(scriptedRunner([]), { AI_GATEWAY_API_KEY: KEY }),
    );
    expect(selection).toMatchObject({
      kind: "gateway",
      source: "env",
      choice: "auto",
    });
    expect(providerLabel(selection, "sol-6.1")).toBe("sol-6.1 · gateway");
  });

  test("auto falls back to an available xcb account, then offline", async () => {
    const xcbSelection = await selectProvider(
      auth(scriptedRunner([capsCall(true)], ["xcb"])),
    );
    expect(xcbSelection).toMatchObject({
      kind: "xcb",
      account: ACCOUNT,
      model: "devin/swe-2-high",
    });
    expect(providerLabel(xcbSelection, "opus-5.5")).toBe(
      "devin/swe-2-high · xcb",
    );
    const none = await selectProvider(
      auth(scriptedRunner([capsCall(false)], ["xcb"])),
    );
    expect(none).toMatchObject({ kind: "offline" });
    expect(none.kind === "offline" && none.reason).toContain("track login");
    expect(await selectProvider(auth(scriptedRunner([])))).toMatchObject({
      kind: "offline",
    });
  });

  test("TRACK_PROVIDER and the saved choice override auto", async () => {
    const runner = scriptedRunner([capsCall(true)], ["xcb"]);
    await storeGatewayKey(auth(runner), KEY);
    expect(
      await selectProvider(auth(runner, { TRACK_PROVIDER: "xcb" })),
    ).toMatchObject({ kind: "xcb" });
    await writeConfig(auth(runner), { provider: "gateway" });
    expect(
      await selectProvider(auth(scriptedRunner([], ["xcb"]))),
    ).toMatchObject({ kind: "gateway", choice: "gateway" });
    // Explicit gateway without a key never silently uses xcb.
    expect(
      await selectProvider({
        ...auth(scriptedRunner([], ["xcb"]), { TRACK_PROVIDER: "gateway" }),
        dir: join(dir, "empty"),
      }),
    ).toMatchObject({ kind: "offline", choice: "gateway" });
  });

  test("a saved xcb account that lost qualification is reported, not swapped", async () => {
    await writeConfig(auth(scriptedRunner([])), {
      provider: "xcb",
      xcb: { account: ACCOUNT, model: "devin/swe-2-high" },
    });
    const selection = await selectProvider(
      auth(scriptedRunner([capsCall(false)], ["xcb"])),
    );
    expect(selection).toMatchObject({ kind: "offline", choice: "xcb" });
    expect(selection.kind === "offline" && selection.reason).toContain(
      "application_not_qualified",
    );
  });

  test("track login --xcb saves the account or explains qualification", async () => {
    const lines: string[] = [];
    const io: LoginIO = {
      interactive: true,
      print: (l) => void lines.push(l),
      readSecret: async () => "",
      ask: async () => "",
    };
    expect(
      await login("xcb", {
        auth: auth(scriptedRunner([capsCall(false)], ["xcb"])),
        io,
        hostname: "h",
      }),
    ).toBe(1);
    expect(lines.join("\n")).toContain("application qualification");
    expect(lines.join("\n")).toContain(
      `qualify-application --inspect --account ${ACCOUNT}`,
    );
    lines.length = 0;
    expect(
      await login("xcb", {
        auth: auth(scriptedRunner([capsCall(true)], ["xcb"])),
        io,
        hostname: "h",
      }),
    ).toBe(0);
    expect(lines[0]).toContain("devin/swe-2-high");
    const selection = await selectProvider(
      auth(scriptedRunner([capsCall(true)], ["xcb"])),
    );
    expect(selection).toMatchObject({
      kind: "xcb",
      choice: "xcb",
      account: ACCOUNT,
    });
    lines.length = 0;
    expect(
      await login("xcb", { auth: auth(scriptedRunner([])), io, hostname: "h" }),
    ).toBe(1);
    expect(lines.join("\n")).toContain(
      "curl -fsSL https://xcb.sh/install.sh | sh",
    );
  });

  test("pending accounts select with admissionPending; a preset login saves that pair", async () => {
    const caps = {
      version: 1,
      supported: true,
      accounts: [
        {
          id: "a1",
          name: "first",
          provider: "claude",
          available: true,
          models: [{ key: "claude/sonnet" }, { key: "claude/opus" }],
        },
        {
          id: ACCOUNT,
          name: "devin",
          provider: "devin",
          available: false,
          admission: "pending",
          models: [{ key: "devin/swe-2-high" }],
        },
      ],
    };
    const call: ScriptedCall = {
      match: (_c, args) => args.includes("--capabilities"),
      result: { stdout: JSON.stringify(caps) },
    };
    const lines: string[] = [];
    const io: LoginIO = {
      interactive: false,
      print: (l) => void lines.push(l),
      readSecret: async () => "",
      ask: async () => "",
    };
    const deps = () => ({
      auth: auth(scriptedRunner([call], ["xcb"])),
      io,
      hostname: "h",
    });
    expect(
      await login("xcb", deps(), {
        xcb: { account: ACCOUNT, model: "devin/swe-2-high" },
      }),
    ).toBe(0);
    expect(lines.join("\n")).toContain("first request");
    const selection = await selectProvider(
      auth(scriptedRunner([call], ["xcb"])),
    );
    expect(selection).toMatchObject({
      kind: "xcb",
      account: ACCOUNT,
      admissionPending: true,
    });
    lines.length = 0;
    expect(
      await login("xcb", deps(), { xcb: { account: "gone", model: "m" } }),
    ).toBe(1);
    expect(lines.join("\n")).toContain("no longer available");
    // The saved pair is unchanged by the failed preset.
    expect(
      await selectProvider(auth(scriptedRunner([call], ["xcb"]))),
    ).toMatchObject({ account: ACCOUNT });
  });

  test("providerFingerprint changes when config or credentials change", async () => {
    const before = providerFingerprint(dir, {});
    await writeConfig(auth(scriptedRunner([])), { provider: "gateway" });
    const after = providerFingerprint(dir, {});
    expect(after).not.toBe(before);
    expect(providerFingerprint(dir, {})).toBe(after);
    expect(providerFingerprint(dir, { AI_GATEWAY_API_KEY: KEY })).not.toContain(
      KEY,
    );
    expect(providerFingerprint(dir, { AI_GATEWAY_API_KEY: KEY })).not.toBe(
      after,
    );
  });

  test("generateText uses a small xcb output cap and throws offline", async () => {
    const runner = scriptedRunner([
      {
        match: () => true,
        result: {
          stdout: JSON.stringify({
            status: "completed",
            text: "  Dusty Groove \n",
          }),
        },
      },
    ]);
    const text = await generateText("name this", {
      maxTokens: 12,
      runner,
      selection: {
        kind: "xcb",
        choice: "auto",
        bin: "xcb",
        account: ACCOUNT,
        accountLabel: "d",
        model: "devin/swe-2-high",
      },
    });
    expect(text).toBe("Dusty Groove");
    expect(JSON.parse(runner.calls[0]!.options.stdin!).maxOutputBytes).toBe(96);
    await expect(
      generateText("x", {
        maxTokens: 12,
        selection: { kind: "offline", choice: "auto", reason: "nope" },
      }),
    ).rejects.toThrow("nope");
  });
});
