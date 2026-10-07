/**
 * `<name>.json` next to a downloaded wav: title, duration, source URL, hash,
 * which backend fetched it and, for StemDeck downloads, the job id that later
 * tools reuse for stems and beat grids.
 */
import { readJson, writeJsonAtomic } from "./paths.ts";
import { finiteNumber, isRecord, optionalString } from "./vendor/util.ts";

export type MediaSidecar = Readonly<{
  title: string;
  durationSeconds?: number;
  source: string;
  sha256?: string;
  bytes?: number;
  backend: "yt-dlp" | "stemdeck";
  downloadedAt: string;
  stemdeck?: Readonly<{ url: string; jobId: string }>;
  bpm?: number;
  key?: string;
}>;

export function sidecarPath(wavPath: string): string {
  return wavPath.replace(/\.wav$/i, "") + ".json";
}

export async function readSidecar(
  wavPath: string,
): Promise<MediaSidecar | undefined> {
  const value = await readJson(sidecarPath(wavPath));
  if (!isRecord(value)) return undefined;
  const title = optionalString(value.title, 200);
  const source = optionalString(value.source, 2048);
  const backend = value.backend;
  if (!title || !source || (backend !== "yt-dlp" && backend !== "stemdeck"))
    return undefined;
  const stemdeck = isRecord(value.stemdeck)
    ? {
        url: optionalString(value.stemdeck.url, 2048),
        jobId: optionalString(value.stemdeck.jobId, 80),
      }
    : undefined;
  const duration = finiteNumber(value.durationSeconds);
  const bpm = finiteNumber(value.bpm);
  const key = optionalString(value.key, 20);
  const sha256 = optionalString(value.sha256, 64);
  const bytes = finiteNumber(value.bytes);
  return {
    title,
    source,
    backend,
    downloadedAt: optionalString(value.downloadedAt, 40) ?? "",
    ...(duration !== undefined ? { durationSeconds: duration } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(bytes !== undefined ? { bytes } : {}),
    ...(stemdeck?.url && stemdeck.jobId
      ? { stemdeck: { url: stemdeck.url, jobId: stemdeck.jobId } }
      : {}),
    ...(bpm !== undefined ? { bpm } : {}),
    ...(key ? { key } : {}),
  };
}

/** Merge one field into an existing sidecar (no-op when there is none). */
export async function writeSidecarField(
  wavPath: string,
  field: string,
  value: unknown,
): Promise<void> {
  const current = await readJson(sidecarPath(wavPath));
  if (!isRecord(current)) return;
  await writeJsonAtomic(sidecarPath(wavPath), { ...current, [field]: value });
}
