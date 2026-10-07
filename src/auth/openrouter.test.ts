import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore, type TrackScore } from "../../core/score.ts";
import {
  runAgentTurn,
  type AgentEvent,
  type AgentHost,
} from "../agent/agent.ts";
import { createOpenRouterClient } from "../agent/gateway.ts";
import { loadLiveCatalog } from "../agent/models.ts";
import {
  finishChunk,
  textChunk,
  toolCallChunks,
} from "../agent/sse-fixtures.ts";
import {
  readConfig,
  resolveOpenRouterKey,
  type AuthEnv,
} from "./credentials.ts";
import { login, type LoginIO } from "./login.ts";
import {
  authorizeUrl,
  checkOpenRouterKey,
  createPkce,
  exchangeCode,
  startCallbackServer,
} from "./openrouter.ts";
import { scriptedRunner, type ScriptedCall } from "./runner.ts";

const KEY = "sk-or-v1-fake0123456789abcdefWXYZ";
const CODE = "auth-code-0123456789";

/**
 * A fake OpenRouter: the PKCE key exchange, `/key`, `/models`, and a chat
 * endpoint that streams one tool call, then a short reply, each with usage.
 */
function fakeOpenRouter() {
  const seen: {
    path: string;
    body?: Record<string, unknown>;
    auth?: string;
  }[] = [];
  let challenge = "";
  let chatCalls = 0;
  const sse = (chunks: unknown[]) =>
    new Response(
      chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
        "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body =
        request.method === "POST"
          ? ((await request.json()) as Record<string, unknown>)
          : undefined;
      seen.push({
        path: url.pathname,
        ...(body ? { body } : {}),
        ...(request.headers.get("authorization")
          ? { auth: request.headers.get("authorization")! }
          : {}),
      });
      const authorized =
        request.headers.get("authorization") === `Bearer ${KEY}`;
      switch (url.pathname) {
        case "/api/v1/auth/keys": {
          const verifier = String(body?.code_verifier ?? "");
          const expected = createHash("sha256")
            .update(verifier)
            .digest("base64url");
          if (body?.code !== CODE || expected !== challenge)
            return new Response("{}", { status: 403 });
          return Response.json({ key: KEY, user_id: "u1" });
        }
        case "/api/v1/key":
          return authorized
            ? Response.json({ data: { label: "dawg", usage: 0 } })
            : new Response("{}", { status: 401 });
        case "/api/v1/models":
          return Response.json({
            data: [
              {
                id: "anthropic/claude-opus-5.5",
                name: "Claude Opus 5.5",
                supported_parameters: ["tools", "temperature"],
                pricing: { prompt: "0.000005", completion: "0.000025" },
              },
              {
                id: "some/image-model",
                name: "No tools",
                supported_parameters: ["temperature"],
                pricing: { prompt: "0", completion: "0" },
              },
            ],
          });
        case "/api/v1/chat/completions": {
          if (!authorized) return new Response("{}", { status: 401 });
          chatCalls += 1;
          if (chatCalls === 1)
            return sse([
              ...toolCallChunks(0, "c1", "set_tempo", { bpm: 96 }),
              finishChunk("tool_calls"),
              {
                choices: [],
                usage: {
                  prompt_tokens: 2600,
                  completion_tokens: 40,
                  cost: 0.0141,
                },
              },
            ]);
          return sse([
            textChunk("Tempo set to 96."),
            finishChunk("stop"),
            {
              choices: [],
              usage: {
                prompt_tokens: 2700,
                completion_tokens: 12,
                prompt_tokens_details: { cached_tokens: 2400 },
                cost: "0.0021",
              },
            },
          ]);
        }
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    base: `http://127.0.0.1:${server.port}/api/v1`,
    seen,
    setChallenge: (value: string) => void (challenge = value),
    stop: () => void server.stop(true),
  };
}

let dir: string;
let fake: ReturnType<typeof fakeOpenRouter>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dawg-openrouter-"));
  fake = fakeOpenRouter();
});
afterEach(async () => {
  fake.stop();
  await rm(dir, { recursive: true, force: true });
});

function auth(runner = scriptedRunner([])): AuthEnv {
  return {
    env: { DAWG_CREDENTIAL_STORE: "file" },
    runner,
    platform: "linux",
    dir,
  };
}

function io(
  secrets: string[] = [],
  interactive = true,
): LoginIO & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    interactive,
    print: (line) => void lines.push(line),
    readSecret: async () => secrets.shift() ?? "",
    ask: async () => "",
  };
}

describe("PKCE", () => {
  test("S256 challenge and URL carry the callback, challenge and state", () => {
    const pkce = createPkce();
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createHash("sha256").update(pkce.verifier).digest("base64url")).toBe(
      pkce.challenge,
    );
    const url = new URL(authorizeUrl("http://127.0.0.1:5555/callback", pkce));
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    expect(url.searchParams.get("callback_url")).toBe(
      "http://127.0.0.1:5555/callback",
    );
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(pkce.state);
    expect(url.toString()).not.toContain(pkce.verifier);
  });

  test("the callback server refuses a wrong state and accepts the right one", async () => {
    const server = startCallbackServer("good-state", { timeoutMs: 5_000 });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const bad = await fetch(`${server.url}?code=${CODE}&state=evil`);
    expect(bad.status).toBe(400);
    const ok = await fetch(`${server.url}?code=${CODE}&state=good-state`);
    expect(ok.status).toBe(200);
    expect(await server.code).toBe(CODE);
  });

  test("the callback server times out", async () => {
    const server = startCallbackServer("s", { timeoutMs: 50 });
    await expect(server.code).rejects.toThrow("timed out");
  });

  test("exchange posts the verifier; a bad verifier is refused", async () => {
    const pkce = createPkce();
    fake.setChallenge(pkce.challenge);
    expect(await exchangeCode(CODE, pkce, { baseUrl: fake.base })).toBe(KEY);
    expect(fake.seen.at(-1)?.body).toEqual({
      code: CODE,
      code_verifier: pkce.verifier,
      code_challenge_method: "S256",
    });
    await expect(
      exchangeCode(CODE, { verifier: "x".repeat(43) }, { baseUrl: fake.base }),
    ).rejects.toThrow("refused the code");
  });

  test("key check: valid, rejected, unverified", async () => {
    expect(await checkOpenRouterKey(KEY, { baseUrl: fake.base })).toBe("valid");
    expect(
      await checkOpenRouterKey("sk-or-v1-wrongwrongwrong", {
        baseUrl: fake.base,
      }),
    ).toBe("rejected");
    expect(
      await checkOpenRouterKey(KEY, { baseUrl: "http://127.0.0.1:9/api/v1" }),
    ).toBe("unverified");
  });
});

describe("dawg login openrouter", () => {
  test("opens the browser, receives the code, exchanges it, stores the key", async () => {
    let authUrl = "";
    // The "browser": OpenRouter redirects to callback_url with code and state.
    const browser: ScriptedCall = {
      match: (command) => command === "xdg-open",
      respond: async (_c, args) => {
        authUrl = args[0]!;
        const url = new URL(authUrl);
        fake.setChallenge(url.searchParams.get("code_challenge")!);
        const callback = new URL(url.searchParams.get("callback_url")!);
        callback.searchParams.set("code", CODE);
        callback.searchParams.set("state", url.searchParams.get("state")!);
        void fetch(callback);
        return { code: 0 };
      },
    };
    const out = io();
    const code = await login("openrouter", {
      auth: auth(scriptedRunner([browser], ["xdg-open"])),
      io: out,
      hostname: "h",
      openrouterBaseUrl: fake.base,
      oauthTimeoutMs: 5_000,
    });
    expect(code).toBe(0);
    expect(new URL(authUrl).searchParams.get("callback_url")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );
    expect(out.lines.join("\n")).toContain("If the browser did not open");
    expect(out.lines.join("\n")).not.toContain(KEY);
    expect((await resolveOpenRouterKey(auth()))?.key).toBe(KEY);
    expect((await readConfig(auth())).provider).toBe("openrouter");
    // The key never lands in config.json.
    expect(await readFile(join(dir, "config.json"), "utf8")).not.toContain(KEY);
  });

  test("a browser that never returns falls back to a hidden paste", async () => {
    const out = io([KEY]);
    const code = await login("openrouter", {
      auth: auth(scriptedRunner([], [])),
      io: out,
      hostname: "h",
      openrouterBaseUrl: fake.base,
      oauthTimeoutMs: 60,
    });
    expect(code).toBe(0);
    expect(out.lines.join("\n")).toContain("timed out");
    expect(out.lines.join("\n")).toContain("paste a key");
    expect((await resolveOpenRouterKey(auth()))?.key).toBe(KEY);
  });

  test("non-interactive without a key exits with a hint", async () => {
    const out = io([], false);
    expect(
      await login("openrouter", { auth: auth(), io: out, hostname: "h" }),
    ).toBe(1);
    expect(out.lines.join("\n")).toContain("OPENROUTER_API_KEY");
  });
});

describe("OpenRouter provider", () => {
  test("the live catalog keeps tool-capable models with per-token prices", async () => {
    const catalog = await loadLiveCatalog("openrouter", {
      configDir: dir,
      apiKey: KEY,
      baseUrl: fake.base,
    });
    expect(catalog?.models.map((m) => m.id)).toEqual([
      "anthropic/claude-opus-5.5",
    ]);
    expect(catalog?.models[0]?.price).toEqual({
      input: 0.000005,
      output: 0.000025,
    });
    expect(await readdir(join(dir, "cache"))).toContain(
      "models-openrouter.json",
    );
  });

  test("a streamed tool-calling turn applies the tool and reports usage and cost", async () => {
    const state = {
      score: createScore({ tracks: [{ id: "main" }] }) as TrackScore,
      revision: 1,
    };
    const host: AgentHost = {
      snapshot: () => ({
        score: state.score,
        revision: state.revision,
        focusedTrackId: "main",
        recentOperations: [],
      }),
      commit: async (change) => {
        state.score = change.next;
        state.revision += 1;
        return { revision: state.revision };
      },
    };
    const events: AgentEvent[] = [];
    const result = await runAgentTurn({
      prompt: "tempo 96",
      model: "anthropic/claude-opus-5.5",
      client: createOpenRouterClient({ apiKey: KEY, baseUrl: fake.base }),
      host,
      onEvent: (event) => events.push(event),
    });
    expect(result).toMatchObject({ type: "done", applied: 1 });
    expect(state.score.tempoBpm).toBe(96);
    const usage = events.filter((event) => event.type === "usage");
    expect(usage).toEqual([
      { type: "usage", inputTokens: 2600, outputTokens: 40, costUsd: 0.0141 },
      {
        type: "usage",
        inputTokens: 2700,
        outputTokens: 12,
        cachedInputTokens: 2400,
        costUsd: 0.0021,
      },
    ]);
    const chat = fake.seen.find(
      (call) => call.path === "/api/v1/chat/completions",
    )!;
    expect(chat.body).toMatchObject({
      model: "anthropic/claude-opus-5.5",
      stream: true,
      stream_options: { include_usage: true },
      tool_choice: "auto",
    });
    expect((chat.body?.tools as unknown[]).length).toBeGreaterThan(5);
  });
});
