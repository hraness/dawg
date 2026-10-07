// Vendored from soundfish `lib/song-import/util.ts` (same owner); trimmed to what dawg's media tools use.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error(`${label} was not valid UTF-8.`);
  }
}

export function parseJson(bytes: Uint8Array, label: string): unknown {
  const text = decodeUtf8(bytes, label);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} was not valid JSON.`);
  }
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function optionalString(
  value: unknown,
  maximumLength = 1_000,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maximumLength
    ? trimmed
    : undefined;
}

function boundedUtf8(
  value: string,
  maximumBytes: number,
  fallback: string,
): string {
  const wellFormed = new TextDecoder().decode(new TextEncoder().encode(value));
  const normalized = wellFormed
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return fallback;
  if (encoder.encode(normalized).byteLength <= maximumBytes) return normalized;
  let result = "";
  for (const character of normalized) {
    if (encoder.encode(`${result}${character}`).byteLength > maximumBytes)
      break;
    result += character;
  }
  return result.trim() || fallback;
}

/** Safe for reflecting untrusted service/process text into a terminal line. */
export function terminalSafeText(
  value: string,
  maximumBytes = 2_000,
  fallback = "External tool error",
): string {
  return boundedUtf8(value.replace(/[‪-‮⁦-⁩]/gu, " "), maximumBytes, fallback);
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function fileBaseName(path: string): string {
  return path.replace(/\\/gu, "/").split("/").at(-1) ?? path;
}

/** Absolute HTTP(S) URL without credentials, query, or fragment. */
export function normalizeServiceBaseUrl(value: string): URL {
  if (encoder.encode(value).byteLength > 2_048) {
    throw new Error("DAWG_STEMDECK_URL must be at most 2048 UTF-8 bytes.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DAWG_STEMDECK_URL must be an absolute HTTP(S) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("DAWG_STEMDECK_URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      "DAWG_STEMDECK_URL cannot include credentials, a query, or a fragment.",
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/gu, "");
  return parsed;
}

/**
 * Accepts YouTube hosts only and strips credentials and the fragment, so the
 * value is safe to log and to hand to yt-dlp or StemDeck.
 */
export function validateYoutubeUrl(value: string): string {
  if (value.length > 2_048) throw new Error("The YouTube URL is too long.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The input must be an absolute YouTube URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("The YouTube URL must use HTTP or HTTPS.");
  }
  const host = parsed.hostname.toLowerCase();
  const accepted =
    host === "youtu.be" ||
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com");
  if (!accepted) throw new Error("The input host is not YouTube.");
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  return parsed.toString();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "Unknown error";
  }
}
