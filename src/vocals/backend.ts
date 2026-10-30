import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { systemRunner, type CommandRunner } from "../auth/runner.ts";
import {
  VOCAL_LIMITS,
  VocalCancelledError,
  VocalError,
  record,
} from "./spec.ts";

export const VOCAL_HELPER = fileURLToPath(
  new URL("./python/book.py", import.meta.url),
);
export const VOCAL_REQUIREMENTS = fileURLToPath(
  new URL("./python/requirements.txt", import.meta.url),
);

export type VocalBackend = Readonly<{
  python: string;
  source: "configured" | "managed";
  /** Hugging Face cache root, separate from the managed Python environment. */
  modelCache?: string;
}>;
export type VocalBackendOptions = Readonly<{
  python?: string;
  cacheDir?: string;
  modelCache?: string;
  env?: Readonly<Record<string, string | undefined>>;
}>;
export type VocalBackendDiscovery =
  | Readonly<{ available: true; backend: VocalBackend; setup: string }>
  | Readonly<{ available: false; reason: string; setup: string }>;

function configuredPath(value: string, name: string): string {
  if (
    !isAbsolute(value) ||
    value.length > 1024 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new VocalError(
      `${name} must be an absolute path without control characters`,
    );
  return resolve(value);
}

function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Instructions only: discovery and playback never install or download anything. */
export function vocalBackendSetup(options: VocalBackendOptions = {}): string {
  const env = options.env ?? process.env;
  const cache = configuredPath(
    options.cacheDir ??
      env.DAWG_VOCAL_CACHE ??
      join(homedir(), ".cache", "dawg", "vocals"),
    "vocal cache",
  );
  const python =
    options.python ??
    env.DAWG_VOCAL_PYTHON ??
    join(cache, "python", "bin", "python");
  const target = configuredPath(python, "vocal Python");
  const modelCache = options.modelCache ?? env.DAWG_VOCAL_MODEL_CACHE;
  const prefix = modelCache
    ? `HF_HUB_CACHE=${quote(configuredPath(modelCache, "model cache"))} `
    : "";
  return [
    "Stock bf_emma generation needs Python 3.12, Kokoro/WORLD dependencies and the pinned Kokoro model in your local cache.",
    `uv venv --python 3.12 ${quote(join(cache, "python"))}`,
    `uv pip install --python ${quote(target)} -r ${quote(VOCAL_REQUIREMENTS)}`,
    `env ${prefix}HF_HUB_OFFLINE=0 ${quote(target)} -I ${quote(VOCAL_HELPER)} --download-models`,
    `Set DAWG_VOCAL_PYTHON=${quote(target)} to use this environment. Saved-song playback does not need it.`,
  ].join("\n");
}

/** Prefer an explicitly selected Python; otherwise inspect DAWG's managed cache. */
export async function discoverVocalBackend(
  options: VocalBackendOptions = {},
): Promise<VocalBackendDiscovery> {
  const env = options.env ?? process.env;
  const explicit = options.python ?? env.DAWG_VOCAL_PYTHON;
  const cache = configuredPath(
    options.cacheDir ??
      env.DAWG_VOCAL_CACHE ??
      join(homedir(), ".cache", "dawg", "vocals"),
    "vocal cache",
  );
  const python = configuredPath(
    explicit ?? join(cache, "python", "bin", "python"),
    "vocal Python",
  );
  const setup = vocalBackendSetup(options);
  try {
    await access(python, constants.X_OK);
  } catch {
    return {
      available: false,
      reason: explicit
        ? "The configured vocal Python is missing or is not executable."
        : "No local vocal-generation environment was found.",
      setup,
    };
  }
  const modelCache = options.modelCache ?? env.DAWG_VOCAL_MODEL_CACHE;
  return {
    available: true,
    backend: {
      python,
      source: explicit ? "configured" : "managed",
      ...(modelCache
        ? { modelCache: configuredPath(modelCache, "model cache") }
        : {}),
    },
    setup,
  };
}

export type VocalProgress = Readonly<{
  stage: "prepare" | "sing" | "accept" | "cached";
  part?: string;
  completed?: number;
  total?: number;
}>;
export type VocalProcessOptions = Readonly<{
  runner?: CommandRunner;
  signal?: AbortSignal;
  onProgress?: (event: VocalProgress) => void;
}>;

export function checkVocalCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new VocalCancelledError();
}

export function vocalProgress(
  callback: VocalProcessOptions["onProgress"],
  event: VocalProgress,
): void {
  try {
    callback?.(event);
  } catch {
    /* Observers cannot abort an accepted asset write. */
  }
}

/** One bounded process, no shell and no subprocess tree to outlive cancellation. */
export async function runVocalHelper(
  backend: VocalBackend,
  args: readonly string[],
  options: VocalProcessOptions = {},
): Promise<unknown> {
  checkVocalCancellation(options.signal);
  const python = configuredPath(backend.python, "vocal Python");
  let pending = "";
  const runner = options.runner ?? systemRunner;
  let result;
  try {
    result = await runner.run(python, ["-I", VOCAL_HELPER, ...args], {
      signal: options.signal,
      timeoutMs: VOCAL_LIMITS.timeoutMs,
      maxOutputBytes: VOCAL_LIMITS.maxOutputBytes,
      env: {
        HF_HUB_OFFLINE: "1",
        HF_HUB_DISABLE_TELEMETRY: "1",
        TOKENIZERS_PARALLELISM: "false",
        OMP_NUM_THREADS: "1",
        ...(backend.modelCache
          ? { HF_HUB_CACHE: configuredPath(backend.modelCache, "model cache") }
          : {}),
      },
      onOutput(stream, chunk) {
        if (stream !== "stderr") return;
        pending = (pending + chunk).slice(-8192);
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("DAWG_VOCAL_PROGRESS ")) continue;
          try {
            const event = record(JSON.parse(line.slice(20)), "vocal progress");
            if (
              event.stage !== "sing" ||
              typeof event.part !== "string" ||
              !/^[a-z][a-z0-9_-]{0,63}$/.test(event.part) ||
              !Number.isInteger(event.completed) ||
              !Number.isInteger(event.total)
            )
              continue;
            const completed = Number(event.completed),
              total = Number(event.total);
            if (
              completed < 0 ||
              total < 1 ||
              completed > total ||
              total > VOCAL_LIMITS.maxParts
            )
              continue;
            vocalProgress(options.onProgress, {
              stage: "sing",
              part: event.part,
              completed,
              total,
            });
          } catch {
            /* Discard unrecognized helper output. */
          }
        }
      },
    });
  } catch (error) {
    checkVocalCancellation(options.signal);
    throw new VocalError(
      `Could not start the vocal backend: ${error instanceof Error ? error.message.slice(0, 300) : "unknown error"}. Check DAWG_VOCAL_PYTHON and the bundled vocal setup instructions.`,
    );
  }
  checkVocalCancellation(options.signal);
  if (result.killed)
    throw new VocalError(
      "Vocal generation exceeded its 15 minute budget and was stopped; generate a smaller book.",
    );
  if (result.code !== 0) {
    const detail = result.stderr
      .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
      .trim()
      .slice(-900);
    throw new VocalError(
      `The stock vocal backend failed (exit ${result.code})${detail ? `: ${detail}` : ""}. Run vocal setup to install the bundled requirements and explicitly cache the pinned model.`,
    );
  }
  if (Buffer.byteLength(result.stdout) > VOCAL_LIMITS.maxOutputBytes)
    throw new VocalError("Vocal backend returned too much output");
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    throw new VocalError(
      "Vocal backend returned invalid JSON; check the selected Python and installed helper resources.",
    );
  }
}

/** Optional explicit qualification; ordinary saved-song playback never calls it. */
export async function probeVocalBackend(
  backend: VocalBackend,
  options: VocalProcessOptions = {},
): Promise<unknown> {
  return runVocalHelper(backend, ["--probe"], options);
}
