/** Only catalogued studio-v1 URLs resolve locally; arbitrary URLs never do. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  BUNDLED_SAMPLE_BASE,
  BUNDLED_SAMPLES,
  bundledSample,
  type BundledSample,
} from "../../core/bundled-samples.ts";

export function bundledSampleForUrl(url: string): BundledSample | undefined {
  return BUNDLED_SAMPLES.find(
    (sample) => url === `${BUNDLED_SAMPLE_BASE}${sample.id}.wav`,
  );
}

export async function readBundledSample(id: string, expectSha256?: string) {
  const sample = bundledSample(id);
  if (!sample) throw new Error(`Unknown studio sample: ${id.slice(0, 80)}`);
  const path = fileURLToPath(
    new URL(`../../assets/samples/studio/${sample.id}.wav`, import.meta.url),
  );
  const bytes = new Uint8Array(await readFile(path));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== sample.sha256 || (expectSha256 && sha256 !== expectSha256))
    throw new Error(`studio/${sample.id} failed its bundled SHA-256 check`);
  return { path, bytes, sha256, sample };
}
