/** Bounded HTTP helpers shared by web search and URL fetching. */

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/** A refused or failed web request; safe to show to the model. */
export class WebError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebError";
  }
}

/** An abort signal that fires after `timeoutMs` or when `parent` aborts. */
export function timeoutSignal(
  timeoutMs: number,
  parent?: AbortSignal,
): { signal: AbortSignal; dispose: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    controller.abort(new WebError(`timed out after ${timeoutMs / 1000}s`));
  }, timeoutMs);
  const signal = parent
    ? AbortSignal.any([parent, controller.signal])
    : controller.signal;
  return {
    signal,
    dispose: () => clearTimeout(timer),
    timedOut: () => fired,
  };
}

/** Read at most `maxBytes` of a response body, cancelling the rest. */
export async function readBounded(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const body = response.body;
  if (!body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,10});/gi,
    (whole, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff)
          return whole;
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    },
  );
}

/** Strip tags from a fragment and collapse whitespace. */
export function stripTags(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]{0,500}>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Describe a fetch failure without echoing request details. */
export function describeFetchError(error: unknown): string {
  if (error instanceof WebError) return error.message;
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError")
      return "request aborted";
    return error.message.slice(0, 160) || "request failed";
  }
  return "request failed";
}
