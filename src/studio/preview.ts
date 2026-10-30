import type { AudioPlaybackStatus } from "../session/protocol.ts";
import type { PreviewRequest } from "../workflows/tools.ts";
import type { BufferedRegion } from "../workflows/state.ts";

/** Transport events can advance the session log without changing its musical PCM. */
export function equivalentPlaybackRevision(
  revision: number | null,
  current: number,
  events: readonly Readonly<{ revision: number; kind: string }>[],
): number | null {
  if (revision === null || revision >= current) return revision;
  const later = events.filter((event) => event.revision > revision);
  return later.length === current - revision &&
    later.every((event) => event.kind === "transport")
    ? current
    : revision;
}

/** Observe a real output receipt; a saved score or completed render request is insufficient. */
export async function waitForAudibleRegion(
  options: Readonly<{
    request: PreviewRequest;
    observe: () => AudioPlaybackStatus | undefined;
    currentRevision: () => number;
    controlsCurrent: () => boolean;
    renderedNotes: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  }>,
): Promise<BufferedRegion> {
  const started = performance.now();
  const { request } = options;
  while (true) {
    options.signal?.throwIfAborted();
    if (!options.controlsCurrent())
      throw new Error(
        "Preview changed by the listener; accepted music was kept",
      );
    if (options.currentRevision() !== request.ticket.writtenRevision)
      throw new Error("Preview score changed; request the current revision");
    const status = options.observe();
    if (status?.error) throw new Error(status.error);
    if (
      status?.audibleRevision === request.ticket.writtenRevision &&
      !status.buffering &&
      status.buffered.some(
        (range) =>
          range.fromBeat <= request.range.from &&
          range.toBeat >= request.range.to,
      )
    ) {
      if (options.renderedNotes < 1)
        throw new Error("Preview region has no sounding notes");
      return {
        renderId: crypto.randomUUID(),
        writtenRevision: request.ticket.writtenRevision,
        range: request.range,
        trackIds: request.trackIds,
        renderedNotes: options.renderedNotes,
        missingAssets: [],
      };
    }
    if (performance.now() - started >= (options.timeoutMs ?? 30_000))
      throw new Error(
        "Preview is still preparing; no audible-ready claim was recorded",
      );
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        options.signal?.removeEventListener("abort", aborted);
        resolve();
      };
      const timer = setTimeout(done, 30);
      const aborted = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", aborted);
        reject(options.signal?.reason ?? new Error("Preview cancelled"));
      };
      options.signal?.addEventListener("abort", aborted, { once: true });
    });
  }
}
