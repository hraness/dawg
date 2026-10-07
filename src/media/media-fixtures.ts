/**
 * Test helpers for the media tools: a temporary project, synthetic wavs, a
 * run context that records progress lines, and a scripted StemDeck server
 * behind an injectable `fetch`. Not a test file (`*-fixtures.ts` is excluded).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWav } from "../audio/wav.ts";
import type { CommandRunner } from "../auth/runner.ts";
import { downloadsDir, ensureDir } from "./paths.ts";
import type { MediaHost, MediaRunContext } from "./types.ts";

export async function tempProject(trackSlug = "main") {
  const root = await mkdtemp(join(tmpdir(), "dawg-media-"));
  const host = { projectRoot: root, trackSlug };
  const downloads = await ensureDir(downloadsDir(host));
  return {
    root,
    downloads,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** Mono 16-bit wav from a sample generator `render(t seconds) → -1..1`. */
export function syntheticWav(
  seconds: number,
  render: (t: number) => number,
  sampleRate = 22_050,
  channels = 1,
): Uint8Array {
  const frames = Math.round(seconds * sampleRate);
  const pcm = new Int16Array(frames * channels);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.max(-1, Math.min(1, render(frame / sampleRate)));
    for (let channel = 0; channel < channels; channel += 1)
      pcm[frame * channels + channel] = Math.round(value * 32_767);
  }
  return encodeWav(pcm, sampleRate, channels);
}

/** Short decaying noise bursts on every beat at `bpm`. */
export function clickTrack(bpm: number, seconds: number, sampleRate = 22_050) {
  const period = 60 / bpm;
  let seed = 7;
  const noise = () => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  return syntheticWav(
    seconds,
    (t) => {
      const phase = t % period;
      return phase < 0.03 ? noise() * Math.exp(-phase * 150) : 0;
    },
    sampleRate,
  );
}

export function runContext(
  host: Pick<MediaHost, "projectRoot" | "trackSlug"> & Partial<MediaHost>,
  runner: CommandRunner,
  extra: Partial<MediaRunContext> = {},
): MediaRunContext & { lines: string[] } {
  const lines: string[] = [];
  return {
    ...host,
    runner,
    signal: new AbortController().signal,
    progress: (line) => {
      lines.push(line);
    },
    ...extra,
    lines,
  };
}

/** ffprobe JSON for a pcm_s16le wav. */
export function ffprobeJson(
  durationSeconds: number,
  sampleRate = 22_050,
  channels = 1,
) {
  return JSON.stringify({
    streams: [
      {
        codec_name: "pcm_s16le",
        sample_rate: String(sampleRate),
        channels,
      },
    ],
    format: {
      duration: durationSeconds.toFixed(6),
      size: String(44 + durationSeconds * sampleRate * channels * 2),
    },
  });
}

export type StemDeckScript = Readonly<{
  stemBytes: Uint8Array;
  beats?: unknown;
  /** Job polls before `done` (each reports `separating`). */
  pollsBeforeDone?: number;
  health?: Record<string, unknown>;
}>;

/** An in-memory StemDeck at http://stemdeck.test; records every request path. */
export function stemdeckFetch(script: StemDeckScript) {
  const calls: string[] = [];
  let polls = 0;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/api/health")
      return json(
        script.health ?? {
          status: "ok",
          name: "StemDeck",
          version: "test",
          demucs_model: "htdemucs_6s",
          demucs_device: "mps",
        },
      );
    if (url.pathname === "/api/jobs" && init?.method === "POST")
      return json({ job_id: "job1" });
    if (url.pathname === "/api/jobs/job1/beats")
      return script.beats === undefined
        ? json({ error: "no beats" }, 404)
        : json(script.beats);
    if (url.pathname === "/api/jobs/job1/cancel") return json({ ok: true });
    if (url.pathname === "/api/jobs/job1") {
      polls += 1;
      if (polls <= (script.pollsBeforeDone ?? 1))
        return json({
          status: "separating",
          progress: 0.42,
          stage: "separating",
        });
      return json({
        status: "done",
        progress: 1,
        title: "Test Song",
        duration: 9.9,
        bpm: 102,
        key: "A minor",
        stems: ["vocals", "drums", "bass", "guitar", "piano", "other"].map(
          (name) => ({
            name,
            url: `/api/jobs/job1/stems/${name}.wav`,
          }),
        ),
      });
    }
    const stem = /^\/api\/jobs\/job1\/stems\/([a-z]+)\.wav$/.exec(url.pathname);
    if (stem)
      return new Response(new Blob([script.stemBytes as BlobPart]), {
        status: 200,
        headers: {
          "content-type": "audio/wav",
          "content-length": String(script.stemBytes.byteLength),
        },
      });
    return json({ error: "not found" }, 404);
  }) as typeof fetch;
  return { fetcher, calls, env: { DAWG_STEMDECK_URL: "http://stemdeck.test" } };
}

export const DRUM_FIXTURE_DIR = join(
  import.meta.dir,
  "fixtures",
  "election-time-drums-excerpt",
);
