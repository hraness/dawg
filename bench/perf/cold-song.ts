/**
 * `bun bench/perf/cold-song.ts [source-root] [demo-id] [playback|export]`
 * One fresh-process, offline full-song render. Run alternating baseline and
 * candidate source roots; compare PCM hashes separately from timings.
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [rootArg, id = "signal-bloom", mode = "playback"] = process.argv.slice(2);
if (mode !== "playback" && mode !== "export")
  throw new Error("mode must be playback or export");
const root = resolve(rootArg ?? join(import.meta.dir, "../.."));
const moduleUrl = (path: string) => pathToFileURL(join(root, path)).href;
const { createDemo } = (await import(
  moduleUrl("core/demos/index.ts")
)) as typeof import("../../core/demos/index.ts");
const { SampleLibrary } = (await import(
  moduleUrl("src/audio/samples.ts")
)) as typeof import("../../src/audio/samples.ts");
const { PackStore } = (await import(
  moduleUrl("src/audio/packs.ts")
)) as typeof import("../../src/audio/packs.ts");
const { renderArranged, renderArrangedPcm } = (await import(
  moduleUrl("src/audio/arrange.ts")
)) as typeof import("../../src/audio/arrange.ts");
const { StemRenderer } = (await import(
  moduleUrl("src/audio/wav.ts")
)) as typeof import("../../src/audio/wav.ts");
const temporary = await mkdtemp(join(tmpdir(), "dawg-cold-song-"));
try {
  const score = createDemo(id);
  const sampleRate = 22_050;
  const library = new SampleLibrary({
    projectRoot: root,
    cacheDir: join(temporary, "assets"),
    packs: new PackStore({
      dir: join(temporary, "packs"),
      offline: true,
      fetch: async () => {
        throw new Error("cold-song must remain offline");
      },
    }),
  });
  const started = performance.now();
  const samples = await library.load(score);
  if (samples.problems.length)
    throw new Error(JSON.stringify(samples.problems));
  const sampleLoadMs = performance.now() - started;
  const renderStart = performance.now();
  const audio =
    mode === "playback"
      ? renderArranged(new StemRenderer(), score, {
          sampleRate,
          samples,
          loop: true,
          guide: true,
        })
      : renderArrangedPcm(score, { sampleRate, samples, loop: false });
  const renderMs = performance.now() - renderStart;
  // Bun 1.3 on Darwin exposes getrusage's bytes; Linux exposes KiB.
  const peakRssBytes =
    process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024);
  console.log(
    JSON.stringify({
      root,
      id,
      mode,
      bun: Bun.version,
      platform: `${process.platform}-${process.arch}`,
      sampleRate,
      sampleLoadMs,
      renderMs,
      peakRssBytes,
      frames: audio.frames,
      bytes: audio.pcm.byteLength,
      scoreSha256: createHash("sha256")
        .update(JSON.stringify(score.toJSON()))
        .digest("hex"),
      pcmSha256: createHash("sha256")
        .update(
          new Uint8Array(
            audio.pcm.buffer,
            audio.pcm.byteOffset,
            audio.pcm.byteLength,
          ),
        )
        .digest("hex"),
      master: audio.master,
    }),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
