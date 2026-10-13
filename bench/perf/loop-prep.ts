/**
 * `bun bench/perf/loop-prep.ts [--no-cache] [demo-id ...]`
 * Finished-loop preparation: cold, repeat, reconstructed score, edit, repeat.
 * Emits JSON lines; PCM hashes expose changes separately from timings.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createDemo } from "../../core/demos/index.ts";
import { TrackScore } from "../../core/score.ts";
import { LoopRenderer } from "../../src/audio/renderer.ts";

const args = process.argv.slice(2);
const cache = !args.includes("--no-cache");
const ids = args.filter((arg) => arg !== "--no-cache");
const sampleRate = 22_050;
console.log(
  JSON.stringify({
    bun: Bun.version,
    platform: `${process.platform}-${process.arch}`,
    sampleRate,
    cache,
    note: "wallMs covers render request to returned PCM, excluding hashing; each cold row has a fresh worker",
  }),
);
for (const id of ids.length ? ids : ["signal-bloom", "glass-arc"]) {
  const score = createDemo(id);
  const renderer = new LoopRenderer({
    sampleRate,
    projectRoot: resolve(import.meta.dir, "../.."),
    ...(cache ? {} : { maxLoopCacheBytes: 0 }),
  });
  const hashes = new Map<string, string>();
  try {
    for (const action of [
      "cold",
      "replay",
      "recreated",
      "edit",
      "edit-replay",
    ]) {
      const json = score.toJSON();
      const changed = action.startsWith("edit");
      const next = changed
        ? new TrackScore({
            ...json,
            notes: json.notes?.map((note, index) =>
              index === 0 ? { ...note, velocity: note.velocity * 0.8 } : note,
            ),
          })
        : action === "recreated"
          ? new TrackScore(json)
          : score;
      const started = performance.now();
      const audio = await renderer.render(next);
      const wallMs = performance.now() - started;
      const sha256 = createHash("sha256")
        .update(
          Buffer.from(
            audio.pcm.buffer,
            audio.pcm.byteOffset,
            audio.pcm.byteLength,
          ),
        )
        .digest("hex");
      const key = changed ? "changed" : "original";
      if (hashes.has(key) && hashes.get(key) !== sha256)
        throw new Error(`${id}: ${action} changed exact PCM`);
      hashes.set(key, sha256);
      console.log(
        JSON.stringify({
          id,
          action,
          wallMs,
          renderMs: audio.renderMs,
          bytes: audio.pcm.byteLength,
          sha256,
          rss: process.memoryUsage().rss,
        }),
      );
    }
  } finally {
    renderer.dispose();
  }
}
