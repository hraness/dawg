/**
 * Minimal StemDeck client (the local separation service soundfish also talks
 * to): submit a YouTube URL, poll the job, fetch its beat grid and stems. All
 * bodies are validated from `unknown`, stem URLs must be same-origin
 * `/api/jobs/<id>/stems/<name>.wav`, and every read is size-capped.
 */
import { join } from "node:path";
import type { BeatGrid, MediaRunContext } from "./types.ts";
import type { StemDeckHealth } from "./backend.ts";
import {
  MediaAbortError,
  MediaToolError,
  downloadToFile,
  fetchJson,
  throwIfAborted,
} from "./process.ts";
import { parseBeatGrid } from "./vendor/grid.ts";
import { finiteNumber, isRecord, optionalString } from "./vendor/util.ts";

export const STEM_NAMES = [
  "vocals",
  "drums",
  "bass",
  "guitar",
  "piano",
  "other",
] as const;
export type StemName = (typeof STEM_NAMES)[number];

const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const TERMINAL = new Set(["done", "error", "cancelled", "unavailable"]);
const STAGES = new Set([
  "queued",
  "downloading",
  "analyzing",
  "separating",
  "processing",
]);

export type StemDeckJob = Readonly<{
  jobId: string;
  title?: string;
  durationSeconds?: number;
  bpm?: number;
  key?: string;
  stems: readonly Readonly<{ name: StemName; url: string }>[];
}>;

export type StemDeckOptions = Readonly<{
  /** Poll spacing; tests pass 0. */
  pollIntervalMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}>;

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new MediaAbortError());
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new MediaAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createStemDeck(
  health: StemDeckHealth,
  context: MediaRunContext,
  options: StemDeckOptions = {},
) {
  const base = new URL(health.url);
  // `URL` keeps "/" for an empty path; drop it so paths join without "//".
  const basePath = base.pathname.replace(/\/+$/u, "");
  const fetcher = context.fetch ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const sleep = options.sleep ?? defaultSleep;
  const api = (path: string) => `${base.origin}${basePath}${path}`;

  async function submit(sourceUrl: string): Promise<string> {
    const body = await fetchJson(fetcher, api("/api/jobs"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ url: sourceUrl, stems: [...STEM_NAMES] }),
      signal: context.signal,
      maxBytes: 64 * 1024,
    });
    const jobId = isRecord(body) ? optionalString(body.job_id, 80) : undefined;
    if (!jobId || !JOB_ID_PATTERN.test(jobId))
      throw new MediaToolError("StemDeck did not return a job id");
    return jobId;
  }

  async function cancel(jobId: string): Promise<void> {
    try {
      await fetcher(api(`/api/jobs/${jobId}/cancel`), {
        method: "POST",
        signal: AbortSignal.timeout(2_000),
      });
    } catch {
      // Best effort; the job times out on its own.
    }
  }

  function parseJob(jobId: string, body: unknown): StemDeckJob {
    if (!isRecord(body))
      throw new MediaToolError("StemDeck job body was not an object");
    const stems = Array.isArray(body.stems)
      ? body.stems.slice(0, 16).flatMap((entry) => {
          if (!isRecord(entry)) return [];
          const name = optionalString(entry.name, 20);
          const url = optionalString(entry.url, 512);
          if (
            !name ||
            !url ||
            !(STEM_NAMES as readonly string[]).includes(name)
          )
            return [];
          const expected = `${basePath}/api/jobs/${jobId}/stems/${name}.wav`;
          let resolved: URL;
          try {
            resolved = new URL(url, base.origin);
          } catch {
            return [];
          }
          if (resolved.origin !== base.origin || resolved.pathname !== expected)
            return [];
          return [{ name: name as StemName, url: resolved.toString() }];
        })
      : [];
    const title = optionalString(body.title, 200);
    const duration = finiteNumber(body.duration);
    const bpm = finiteNumber(body.bpm);
    const key = optionalString(body.key, 20);
    return {
      jobId,
      ...(title ? { title } : {}),
      ...(duration !== undefined && duration > 0
        ? { durationSeconds: duration }
        : {}),
      ...(bpm !== undefined && bpm > 0 ? { bpm } : {}),
      ...(key ? { key } : {}),
      stems,
    };
  }

  /** Poll until the job ends; progress lines read `stemdeck separating 42%`. */
  async function wait(jobId: string, timeoutMs: number): Promise<StemDeckJob> {
    const deadline = Date.now() + timeoutMs;
    let lastLine = "";
    for (;;) {
      throwIfAborted(context.signal);
      if (Date.now() > deadline) {
        await cancel(jobId);
        throw new MediaToolError(
          `StemDeck job ${jobId} exceeded its ${Math.round(timeoutMs / 60_000)} min budget`,
        );
      }
      let body: unknown;
      try {
        body = await fetchJson(fetcher, api(`/api/jobs/${jobId}`), {
          signal: context.signal,
          maxBytes: 256 * 1024,
        });
      } catch (error) {
        if (context.signal.aborted) {
          await cancel(jobId);
          throw new MediaAbortError();
        }
        throw error;
      }
      const status = isRecord(body)
        ? optionalString(body.status, 20)
        : undefined;
      if (status === "done") return parseJob(jobId, body);
      if (status !== undefined && TERMINAL.has(status)) {
        const detail = isRecord(body)
          ? optionalString(body.error, 200)
          : undefined;
        throw new MediaToolError(
          `StemDeck job ${status}${detail ? `: ${detail}` : ""}`,
        );
      }
      const stage =
        status !== undefined && STAGES.has(status)
          ? status
          : ((isRecord(body) ? optionalString(body.stage, 20) : undefined) ??
            "working");
      const progress = isRecord(body) ? finiteNumber(body.progress) : undefined;
      const line =
        progress === undefined
          ? `stemdeck ${stage}`
          : `stemdeck ${stage} ${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
      if (line !== lastLine) {
        lastLine = line;
        context.progress(line);
      }
      try {
        await sleep(pollIntervalMs, context.signal);
      } catch (error) {
        await cancel(jobId);
        throw error;
      }
    }
  }

  async function beats(jobId: string): Promise<BeatGrid | undefined> {
    try {
      const response = await fetcher(api(`/api/jobs/${jobId}/beats`), {
        signal: context.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) return undefined;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 4 * 1024 * 1024) return undefined;
      return parseBeatGrid(bytes);
    } catch (error) {
      if (context.signal.aborted) throw new MediaAbortError();
      return undefined;
    }
  }

  /** Download every stem into `dir` as `<name>.wav`. */
  async function fetchStems(
    job: StemDeckJob,
    dir: string,
    maxBytesPerStem: number,
  ): Promise<readonly string[]> {
    const written: string[] = [];
    for (const [index, stem] of job.stems.entries()) {
      throwIfAborted(context.signal);
      context.progress(
        `stemdeck fetching ${stem.name} (${index + 1}/${job.stems.length})`,
      );
      const path = join(dir, `${stem.name}.wav`);
      await downloadToFile(fetcher, stem.url, path, {
        maxBytes: maxBytesPerStem,
        signal: context.signal,
      });
      written.push(path);
    }
    return written;
  }

  return { health, submit, wait, beats, fetchStems, cancel };
}

export type StemDeckClient = ReturnType<typeof createStemDeck>;
