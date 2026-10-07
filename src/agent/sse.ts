/**
 * Minimal, bounded Server-Sent Events reader for streamed chat completions.
 *
 * It yields the `data:` payload of each event (multi-line data is joined with
 * `\n`), skips comments and other fields, and stops at `[DONE]`. Every byte
 * read counts against `maxBytes`, and an abort signal cancels the underlying
 * reader even when the fetch implementation does not observe the signal.
 */

export class SseBudgetError extends Error {
  constructor(readonly maxBytes: number) {
    super(`agent response exceeded ${maxBytes} bytes`);
    this.name = "SseBudgetError";
  }
}

export async function* readSseData(
  body: ReadableStream<Uint8Array>,
  options: { maxBytes: number; signal?: AbortSignal },
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let total = 0;
  const signal = options.signal;
  let onAbort: (() => void) | undefined;
  const aborted =
    signal === undefined
      ? undefined
      : new Promise<never>((_, reject) => {
          onAbort = () => reject(abortReason(signal));
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        });
  // Avoid an unhandled rejection when the stream finishes before an abort.
  aborted?.catch(() => undefined);
  try {
    while (true) {
      const chunk = aborted
        ? await Promise.race([reader.read(), aborted])
        : await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > options.maxBytes) throw new SseBudgetError(options.maxBytes);
      buffer += decoder.decode(chunk.value, { stream: true });
      // Scan forward with indexOf and slice the consumed prefix once per
      // chunk. A trailing "\r" is held back: it may be the first half of a
      // "\r\n" split across chunks, and dispatching it early would double
      // an empty line and end the event too soon.
      let start = 0;
      while (true) {
        const next = lineBreak(buffer, start);
        if (next === undefined) break;
        const line = buffer.slice(start, next.index);
        start = next.index + next.width;
        if (line === "") {
          if (data.length > 0) {
            const payload = data.join("\n");
            data = [];
            if (payload === "[DONE]") return;
            yield payload;
          }
        } else if (line.startsWith("data:")) {
          data.push(line.slice(line[5] === " " ? 6 : 5));
        }
      }
      if (start > 0) buffer = buffer.slice(start);
    }
    buffer += decoder.decode();
    if (buffer.endsWith("\r")) buffer = buffer.slice(0, -1);
    if (buffer.startsWith("data:"))
      data.push(buffer.slice(buffer[5] === " " ? 6 : 5));
    if (data.length > 0) {
      const payload = data.join("\n");
      if (payload !== "[DONE]") yield payload;
    }
  } finally {
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      // A pending read is rejected by cancel(); the lock is already moot.
    }
  }
}

/**
 * The next line terminator at or after `from`: "\n", "\r\n", or a lone
 * "\r" that is already followed by another character. A "\r" at the very
 * end of the buffer is not a terminator yet.
 */
function lineBreak(
  buffer: string,
  from: number,
): { index: number; width: number } | undefined {
  const newline = buffer.indexOf("\n", from);
  const carriage = buffer.indexOf("\r", from);
  if (carriage < 0 || (newline >= 0 && newline < carriage))
    return newline < 0 ? undefined : { index: newline, width: 1 };
  if (carriage === buffer.length - 1) return undefined;
  return buffer[carriage + 1] === "\n"
    ? { index: carriage, width: 2 }
    : { index: carriage, width: 1 };
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  const error = new Error("agent request was aborted");
  error.name = "AbortError";
  return error;
}
