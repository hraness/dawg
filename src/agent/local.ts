/**
 * The local model: a GGUF served by llama.cpp's `llama-server` on loopback.
 * dawg finds the model file and the server binary, starts the server on the
 * first request (one per process, on a free 127.0.0.1 port), and stops its
 * whole process group when dawg exits. `DAWG_LOCAL_BASE_URL` points at a
 * server that is already running instead.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/** The model alias the server answers to; the id dawg's agent loop sends. */
export const LOCAL_ALIAS = "gemma-4-26b-a4b";
export const LOCAL_MODEL_ID = `local/${LOCAL_ALIAS}`;
/** Gemma 4 26B-A4B at Unsloth's Q4_K_M: the model the hyperpop sheets were tuned on. */
export const PREFERRED_MODEL = "gemma-4-26B-A4B-it-UD-Q4_K_M.gguf";
// Enough for the playbook, two example sheets, a retry and the reply.
const CONTEXT = 32_768;
const READY_TIMEOUT_MS = 240_000;

type Env = Readonly<Record<string, string | undefined>>;

export type LocalModel = Readonly<{
  /** The GGUF path, or undefined when an external server is used. */
  path?: string;
  /** The llama-server binary, or undefined when an external server is used. */
  bin?: string;
  /** An already-running OpenAI-compatible server. */
  baseUrl?: string;
  alias: string;
}>;

/** Where GGUF files are looked for, in order. */
export function modelDirs(env: Env = process.env): string[] {
  const home = env.HOME ?? homedir();
  return [
    join(home, ".cache", "dawg", "models"),
    join(home, ".cache", "sponge-llm"),
    join(home, ".lmstudio", "models"),
  ];
}

function ggufs(dir: string, depth: number): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const path = join(dir, name);
    let info;
    try {
      info = statSync(path);
    } catch {
      continue;
    }
    if (info.isDirectory() && depth > 0) out.push(...ggufs(path, depth - 1));
    else if (
      info.isFile() &&
      name.toLowerCase().endsWith(".gguf") &&
      !name.toLowerCase().includes("mmproj")
    )
      out.push(path);
  }
  return out;
}

/** The GGUF to serve: `DAWG_LOCAL_MODEL`, else the preferred Gemma, else any Gemma 4. */
export function findLocalModelFile(env: Env = process.env): string | undefined {
  const explicit = env.DAWG_LOCAL_MODEL?.trim();
  if (explicit) return existsSync(explicit) ? explicit : undefined;
  const found = modelDirs(env).flatMap((dir) => ggufs(dir, 3));
  return (
    found.find((path) => basename(path) === PREFERRED_MODEL) ??
    found.find((path) => /gemma-?4/i.test(basename(path)))
  );
}

/** `DAWG_LLAMA_SERVER`, else `llama-server` on PATH. */
export function findLlamaServer(env: Env = process.env): string | undefined {
  const explicit = env.DAWG_LLAMA_SERVER?.trim();
  if (explicit) return existsSync(explicit) ? explicit : undefined;
  for (const dir of (env.PATH ?? "").split(":")) {
    if (!dir) continue;
    const path = join(dir, "llama-server");
    if (existsSync(path)) return path;
  }
  return undefined;
}

/** The local model when one can run here, or why not. */
export function findLocalModel(
  env: Env = process.env,
): LocalModel | { reason: string } {
  const alias = env.DAWG_LOCAL_ALIAS?.trim() || LOCAL_ALIAS;
  const baseUrl = env.DAWG_LOCAL_BASE_URL?.trim();
  if (baseUrl) return { baseUrl: baseUrl.replace(/\/$/, ""), alias };
  const path = findLocalModelFile(env);
  if (!path)
    return {
      reason: `no local model; put ${PREFERRED_MODEL} in ~/.cache/dawg/models or set DAWG_LOCAL_MODEL`,
    };
  const bin = findLlamaServer(env);
  if (!bin)
    return {
      reason: "llama-server is not installed; run `brew install llama.cpp`",
    };
  return { path, bin, alias };
}

export const isLocalModel = (
  value: LocalModel | { reason: string },
): value is LocalModel => !("reason" in value);

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => ok(port));
    });
  });
}

const running = new Map<string, Promise<string>>();
const children = new Set<ChildProcess>();
let exitHook = false;

function stopAll(): void {
  for (const child of children)
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {}
  children.clear();
  tails.clear();
}

/**
 * The base URL (`http://127.0.0.1:PORT/v1`) of a server for `model`,
 * starting it on first use. The model loads once per dawg process.
 */
export function ensureLocalServer(
  model: LocalModel,
  signal?: AbortSignal,
): Promise<string> {
  if (model.baseUrl)
    return Promise.resolve(
      model.baseUrl.endsWith("/v1") ? model.baseUrl : `${model.baseUrl}/v1`,
    );
  const key = `${model.bin}\0${model.path}`;
  let pending = running.get(key);
  if (!pending) {
    pending = start(model, signal);
    running.set(key, pending);
    pending.catch(() => running.delete(key));
  }
  return pending;
}

/** The last stderr of each server this process started, by base URL. */
const tails = new Map<string, string>();

async function start(model: LocalModel, signal?: AbortSignal): Promise<string> {
  const port = await freePort();
  const child = spawn(
    model.bin!,
    [
      "-m",
      model.path!,
      "--alias",
      model.alias,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "-c",
      String(CONTEXT),
      "-np",
      "1",
      "--jinja",
      "--reasoning",
      "off",
      "--offline",
      "--no-webui",
    ],
    { detached: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  let tail = "";
  let exited = false;
  const url = `http://127.0.0.1:${port}`;
  child.stderr!.on("data", (chunk: Buffer) => {
    tail = (tail + chunk.toString("utf8")).slice(-4096);
    tails.set(`${url}/v1`, tail);
  });
  child.once("exit", () => {
    exited = true;
    children.delete(child);
  });
  children.add(child);
  if (!exitHook) {
    exitHook = true;
    process.once("exit", stopAll);
  }
  // Never keep dawg alive for the server alone.
  child.unref();
  (child.stderr as { unref?: () => void }).unref?.();
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) break;
    if (exited)
      throw new Error(
        `llama-server exited while loading: ${tail.trim().split("\n").slice(-3).join(" ").slice(0, 400)}`,
      );
    try {
      const health = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (health.ok) return `${url}/v1`;
    } catch {}
    await Bun.sleep(250);
  }
  try {
    process.kill(-child.pid!, "SIGTERM");
  } catch {}
  throw new Error(
    signal?.aborted
      ? "local model start canceled"
      : `the local model did not load within ${READY_TIMEOUT_MS / 1000} s`,
  );
}

/** Stop every server this process started (tests, `dawg make`). */
export function stopLocalServers(): void {
  stopAll();
  running.clear();
}

export type JsonCompletion = Readonly<{
  messages: readonly {
    role: "system" | "user" | "assistant";
    content: string;
  }[];
  /** A JSON schema the reply must match (llama.cpp grammar-constrained). */
  schema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}>;

/**
 * One non-streaming chat completion on the local server, constrained to
 * `schema` when given. Returns the reply text.
 */
export async function localComplete(
  model: LocalModel,
  request: JsonCompletion,
): Promise<string> {
  const base = await ensureLocalServer(model, request.signal);
  const body: Record<string, unknown> = {
    model: model.alias,
    messages: request.messages,
    temperature: request.temperature ?? 0.7,
    max_tokens: request.maxTokens ?? 8192,
  };
  if (request.schema)
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "sheet", schema: request.schema },
    };
  const post = () =>
    fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(request.signal ? { signal: request.signal } : {}),
    });
  let response = await post();
  // A server error is often transient GPU pressure (llama.cpp's "Compute
  // error."): one retry after a pause before giving up.
  if (response.status >= 500 && !request.signal?.aborted) {
    await response.text();
    await Bun.sleep(2_000);
    response = await post();
  }
  const text = await response.text();
  if (!response.ok) {
    const log = (tails.get(base) ?? "")
      .trim()
      .split("\n")
      .filter((line) => /error|fail|memory/i.test(line))
      .slice(-2)
      .join(" ");
    // llama.cpp says "Compute error." when the GPU cannot fit the work,
    // most often because another model is loaded beside this one.
    const hint = /compute error/i.test(text)
      ? " · the GPU ran out of memory; close other local model servers (`pgrep -fl llama-server`) and retry"
      : "";
    throw new Error(
      `local model error ${response.status}: ${text.slice(0, 300)}${hint}${log ? ` · server: ${log.slice(0, 300)}` : ""}`,
    );
  }
  const reply = JSON.parse(text) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = reply.choices?.[0]?.message?.content;
  if (typeof content !== "string")
    throw new Error("local model returned no message");
  return content;
}
