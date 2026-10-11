/**
 * Machine vox intelligibility, live: renders a phrase with the `robot`
 * preset and asks whisper-cli what it hears. Opt-in only: set
 * DAWG_LIVE_VOX=1 and DAWG_WHISPER_MODEL to a ggml model file (nothing is
 * downloaded); skipped otherwise and never run in CI. It reports the
 * transcript and passes when at least one word comes back.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createScore } from "../../../core/score.ts";
import { renderScoreWav } from "../wav.ts";

const model = process.env.DAWG_WHISPER_MODEL ?? "";
const live = process.env.DAWG_LIVE_VOX === "1" && model !== "";

test.skipIf(!live)(
  "whisper hears the robot's words",
  () => {
    const words = ["hel-", "lo", "world", "sing", "a", "song", "to", "me"];
    const s = createScore({
      tempoBpm: 100,
      bars: 3,
      tracks: [
        { id: "v", name: "v", instrument: "sing", sing: { preset: "robot" } },
      ],
      notes: words.map((lyric, i) => ({
        id: `n${i}`,
        trackId: "v",
        startTick: i * 480,
        durationTicks: 440,
        pitch: [57, 59, 60, 62, 60, 59, 57, 55][i]!,
        velocity: 0.8,
        lyric,
      })),
    } as never);
    const dir = mkdtempSync(join(tmpdir(), "dawg-vox-live-"));
    try {
      const wav = join(dir, "vox.wav");
      writeFileSync(wav, renderScoreWav(s, { sampleRate: 16_000 }));
      const run = spawnSync(
        "whisper-cli",
        ["-m", model, "-f", wav, "-otxt", "-of", join(dir, "out"), "-l", "en"],
        { timeout: 120_000, encoding: "utf8" },
      );
      expect(run.status).toBe(0);
      const text = readFileSync(join(dir, "out.txt"), "utf8").trim();
      console.log(`whisper heard: ${JSON.stringify(text)}`);
      expect(text.split(/\s+/).filter(Boolean).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  180_000,
);
