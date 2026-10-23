import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthEnv } from "../auth/credentials.ts";
import {
  ensureLocalServer,
  findLocalModel,
  isLocalModel,
  localComplete,
  PREFERRED_MODEL,
  stopLocalServers,
} from "./local.ts";
import { selectProvider } from "./provider.ts";

let home: string;
let bin: string;

// A stand-in llama-server: answers /health and echoes the request's
// response_format back as the completion.
const FAKE_SERVER = `#!${process.execPath}
const argv = process.argv;
const port = Number(argv[argv.indexOf("--port") + 1]);
const alias = argv[argv.indexOf("--alias") + 1];
Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ status: "ok" });
    const body = await request.json();
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ model: body.model, alias, schema: body.response_format?.json_schema?.name ?? null }) } }],
    });
  },
});
`;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "dawg-local-"));
  bin = join(home, "bin");
  await mkdir(join(home, ".cache", "dawg", "models"), { recursive: true });
  await mkdir(bin);
  await writeFile(
    join(home, ".cache", "dawg", "models", PREFERRED_MODEL),
    "gguf",
  );
  await writeFile(
    join(home, ".cache", "dawg", "models", "mmproj-gemma-4.gguf"),
    "gguf",
  );
  await writeFile(join(bin, "llama-server"), FAKE_SERVER);
  await chmod(join(bin, "llama-server"), 0o755);
});

afterAll(async () => {
  stopLocalServers();
  await rm(home, { recursive: true, force: true });
});

const auth = (env: Record<string, string>): AuthEnv => ({
  env: { HOME: home, ...env },
  runner: {
    run: async () => ({ code: 1, stdout: "", stderr: "", killed: false }),
    which: () => undefined,
  },
  platform: "linux",
  dir: join(home, "config"),
});

describe("the local model", () => {
  test("finds the preferred GGUF and llama-server, skipping projector files", () => {
    const found = findLocalModel({ HOME: home, PATH: bin });
    if (!isLocalModel(found)) throw new Error(found.reason);
    expect(found.path).toBe(
      join(home, ".cache", "dawg", "models", PREFERRED_MODEL),
    );
    expect(found.bin).toBe(join(bin, "llama-server"));
    const noServer = findLocalModel({ HOME: home, PATH: "" });
    expect(isLocalModel(noServer)).toBe(false);
    if (!isLocalModel(noServer)) expect(noServer.reason).toContain("llama.cpp");
    const noModel = findLocalModel({ HOME: join(home, "nowhere"), PATH: bin });
    if (!isLocalModel(noModel))
      expect(noModel.reason).toContain("no local model");
    expect(
      findLocalModel({ DAWG_LOCAL_BASE_URL: "http://127.0.0.1:9/" }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:9",
      alias: "gemma-4-26b-a4b",
    });
  });

  test("auto selection prefers the local model over a saved key", async () => {
    const selection = await selectProvider(
      auth({ PATH: bin, AI_GATEWAY_API_KEY: "vck_test1234567890abcdWXYZ" }),
    );
    expect(selection.kind).toBe("local");
  });

  test("an explicit local choice without a model goes offline with the reason", async () => {
    const selection = await selectProvider(
      auth({ PATH: "", DAWG_PROVIDER: "local" }),
    );
    expect(selection.kind).toBe("offline");
    if (selection.kind === "offline")
      expect(selection.reason).toContain("llama-server");
  });

  test("starts the server once, completes with a schema and stops it", async () => {
    const model = findLocalModel({ HOME: home, PATH: bin });
    if (!isLocalModel(model)) throw new Error(model.reason);
    const [a, b] = await Promise.all([
      ensureLocalServer(model),
      ensureLocalServer(model),
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    const reply = JSON.parse(
      await localComplete(model, {
        messages: [{ role: "user", content: "hi" }],
        schema: { type: "object" },
      }),
    );
    expect(reply).toEqual({
      model: "gemma-4-26b-a4b",
      alias: "gemma-4-26b-a4b",
      schema: "sheet",
    });
    stopLocalServers();
  });
});
