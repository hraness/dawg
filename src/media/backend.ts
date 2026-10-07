/**
 * Which backend a media tool can use. A local StemDeck
 * (`DAWG_STEMDECK_URL`, default http://127.0.0.1:8000) answers `/api/health`
 * within a second, or the tools run the binaries directly: `yt-dlp`,
 * `ffmpeg`, `ffprobe`, `uv` (for `uv tool run demucs` / `basic-pitch`) and
 * `whisper-cli`. Nothing here installs anything; `doctor()` prints the exact
 * command for each missing piece instead.
 */
import type { CommandRunner } from "../auth/runner.ts";
import type { MediaHost } from "./types.ts";
import {
  finiteNumber,
  isRecord,
  normalizeServiceBaseUrl,
  optionalString,
} from "./vendor/util.ts";

export const DEFAULT_STEMDECK_URL = "http://127.0.0.1:8000";
const HEALTH_TIMEOUT_MS = 1_000;
const UV_LIST_TIMEOUT_MS = 10_000;

export const MEDIA_TOOL_NAMES = [
  "yt-dlp",
  "ffmpeg",
  "ffprobe",
  "uv",
  "demucs",
  "basic-pitch",
  "whisper-cli",
] as const;
export type MediaToolName = (typeof MEDIA_TOOL_NAMES)[number];

export const INSTALL_COMMANDS: Readonly<Record<MediaToolName, string>> = {
  "yt-dlp": "brew install yt-dlp ffmpeg whisper-cpp",
  ffmpeg: "brew install yt-dlp ffmpeg whisper-cpp",
  ffprobe: "brew install yt-dlp ffmpeg whisper-cpp",
  "whisper-cli": "brew install yt-dlp ffmpeg whisper-cpp",
  uv: "curl -LsSf https://astral.sh/uv/install.sh | sh",
  demucs: "uv tool install demucs",
  "basic-pitch": "uv tool install basic-pitch",
};

/** What each tool is for, in the doctor report. */
const PURPOSE: Readonly<Record<MediaToolName, string>> = {
  "yt-dlp": "download_audio",
  ffmpeg: "import_sample, decoding for analysis",
  ffprobe: "analyze_audio",
  uv: "runs demucs and basic-pitch",
  demucs: "split_stems (direct backend)",
  "basic-pitch": "transcribe_notes for pitched stems",
  "whisper-cli": "transcribe_lyrics",
};

export type ToolStatus = Readonly<{
  name: MediaToolName;
  available: boolean;
  /** How the tool is started: a PATH binary or `uv tool run <name>`. */
  command?: readonly string[];
  install: string;
  purpose: string;
  /** First-run model download the tool performs on its own. */
  firstRun?: string;
}>;

export type StemDeckHealth = Readonly<{
  url: string;
  version?: string;
  demucsModel?: string;
  demucsDevice?: string;
}>;

export type MediaBackend =
  | Readonly<{ kind: "stemdeck"; stemdeck: StemDeckHealth }>
  /** `checked` is the StemDeck origin that did not answer (no credentials). */
  | Readonly<{ kind: "direct"; checked?: string }>;

export const FIRST_RUN_NOTES: Readonly<Partial<Record<MediaToolName, string>>> =
  {
    demucs:
      "demucs downloads the htdemucs_6s model (~80 MB) into ~/.cache/torch on its first run",
    "basic-pitch":
      "basic-pitch ships its model in the package; the first run compiles it and is slower",
    "whisper-cli":
      "dawg downloads ggml-base.en.bin (~148 MB) into ~/.cache/dawg/whisper before the first transcription",
  };

/** The StemDeck base URL from the environment, or the default. Never logged with credentials. */
export function stemdeckUrl(
  env: Readonly<Record<string, string | undefined>> | undefined,
): URL {
  const raw = env?.DAWG_STEMDECK_URL?.trim();
  return normalizeServiceBaseUrl(raw ? raw : DEFAULT_STEMDECK_URL);
}

/** `GET /api/health` with a one-second budget; undefined when StemDeck is not there. */
export async function detectStemDeck(
  host: Pick<MediaHost, "fetch" | "env"> & { signal?: AbortSignal },
): Promise<StemDeckHealth | undefined> {
  let base: URL;
  try {
    base = stemdeckUrl(host.env);
  } catch {
    return undefined;
  }
  const prefix = `${base.origin}${base.pathname.replace(/\/+$/u, "")}`;
  const fetcher = host.fetch ?? fetch;
  const timeout = AbortSignal.timeout(HEALTH_TIMEOUT_MS);
  const signal = host.signal
    ? AbortSignal.any([host.signal, timeout])
    : timeout;
  try {
    const response = await fetcher(`${prefix}/api/health`, {
      signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    if (text.length > 64 * 1024) return undefined;
    const body: unknown = JSON.parse(text);
    if (!isRecord(body) || body.status !== "ok") return undefined;
    const name = optionalString(body.name, 40);
    if (name !== undefined && name.toLowerCase() !== "stemdeck")
      return undefined;
    const version = optionalString(body.version, 40);
    const demucsModel = optionalString(body.demucs_model, 40);
    const demucsDevice = optionalString(body.demucs_device, 40);
    return {
      url: prefix,
      ...(version ? { version } : {}),
      ...(demucsModel ? { demucsModel } : {}),
      ...(demucsDevice ? { demucsDevice } : {}),
    };
  } catch {
    return undefined;
  }
}

export async function detectBackend(
  host: Pick<MediaHost, "fetch" | "env"> & { signal?: AbortSignal },
): Promise<MediaBackend> {
  const stemdeck = await detectStemDeck(host);
  if (stemdeck) return { kind: "stemdeck", stemdeck };
  try {
    return { kind: "direct", checked: stemdeckUrl(host.env).origin };
  } catch {
    return { kind: "direct" };
  }
}

/** Names `uv tool list` reports as installed (never installs anything). */
export async function uvInstalledTools(
  runner: CommandRunner,
  signal?: AbortSignal,
): Promise<ReadonlySet<string>> {
  if (!runner.which("uv")) return new Set();
  try {
    const result = await runner.run("uv", ["tool", "list"], {
      timeoutMs: UV_LIST_TIMEOUT_MS,
      maxOutputBytes: 64 * 1024,
      ...(signal ? { signal } : {}),
    });
    if (result.code !== 0) return new Set();
    const names = new Set<string>();
    for (const line of result.stdout.split("\n")) {
      // `demucs v4.0.1` heads each block; indented lines are entry points.
      const match = /^([A-Za-z0-9_.-]+) v\S+/.exec(line);
      if (match) names.add(match[1]!.toLowerCase());
    }
    return names;
  } catch {
    return new Set();
  }
}

/** Resolve one tool to the argv prefix that starts it, or undefined. */
export function toolCommand(
  name: MediaToolName,
  runner: CommandRunner,
  uvTools: ReadonlySet<string>,
): readonly string[] | undefined {
  const direct = runner.which(name);
  if (direct) return [name];
  if ((name === "demucs" || name === "basic-pitch") && runner.which("uv")) {
    if (uvTools.has(name)) return ["uv", "tool", "run", name];
  }
  return undefined;
}

export async function probeTools(
  runner: CommandRunner,
  signal?: AbortSignal,
): Promise<readonly ToolStatus[]> {
  const uvTools = await uvInstalledTools(runner, signal);
  return MEDIA_TOOL_NAMES.map((name) => {
    const command = toolCommand(name, runner, uvTools);
    const firstRun = FIRST_RUN_NOTES[name];
    return {
      name,
      available: command !== undefined,
      ...(command ? { command } : {}),
      install: INSTALL_COMMANDS[name],
      purpose: PURPOSE[name],
      ...(firstRun ? { firstRun } : {}),
    };
  });
}

export type DoctorReport = Readonly<{
  backend: MediaBackend;
  tools: readonly ToolStatus[];
}>;

export async function doctor(
  host: Pick<MediaHost, "runner" | "fetch" | "env"> & { signal?: AbortSignal },
): Promise<DoctorReport> {
  const [backend, tools] = await Promise.all([
    detectBackend(host),
    probeTools(host.runner, host.signal),
  ]);
  return { backend, tools };
}

/** Human lines for `dawg media doctor` and activity cards. */
export function formatDoctor(report: DoctorReport): readonly string[] {
  const lines: string[] = [];
  if (report.backend.kind === "stemdeck") {
    const s = report.backend.stemdeck;
    lines.push(
      `✓ StemDeck at ${s.url}${s.version ? ` v${s.version}` : ""}${s.demucsModel ? ` · ${s.demucsModel}` : ""}${s.demucsDevice ? ` on ${s.demucsDevice}` : ""}`,
    );
  } else {
    lines.push(
      `· no StemDeck at ${report.backend.checked ?? DEFAULT_STEMDECK_URL} (set DAWG_STEMDECK_URL); using local binaries`,
    );
  }
  for (const tool of report.tools) {
    lines.push(
      tool.available
        ? `✓ ${tool.name} · ${tool.purpose}${tool.command && tool.command.length > 1 ? ` · via ${tool.command.join(" ")}` : ""}`
        : `✗ ${tool.name} · ${tool.purpose} · install: ${tool.install}`,
    );
  }
  for (const tool of report.tools)
    if (tool.available && tool.firstRun) lines.push(`  ${tool.firstRun}`);
  return lines;
}

/** Error text for a tool a run needs but could not find. */
export function missingTool(name: MediaToolName): string {
  return `${name} is not installed; install it with: ${INSTALL_COMMANDS[name]} (dawg never installs tools itself; run \`dawg media doctor\`)`;
}

export { finiteNumber };
