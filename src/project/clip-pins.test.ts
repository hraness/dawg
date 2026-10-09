import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore } from "../../core/score.ts";
import { clipPinDiagnostics } from "./clip-pins.ts";

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("dawg check re-hashes clips", () => {
  test("reports a changed or missing clip and an unused missing take only as fine", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-clip-pins-"));
    try {
      await mkdir(join(dir, "tracks/vox/samples"), { recursive: true });
      const good = new Uint8Array([1, 2, 3]);
      await writeFile(join(dir, "tracks/vox/samples/a.wav"), good);
      await writeFile(join(dir, "tracks/vox/samples/b.wav"), good);
      const score = createScore({
        tracks: [
          {
            id: "vox",
            name: "vox",
            instrument: "vocal",
            takes: [
              {
                name: "t1",
                src: "tracks/vox/takes/t1.wav",
                sha256: "c".repeat(64),
                startTick: 0,
                offset: 0,
                latency: 0,
                inTick: 0,
                outTick: 960,
              },
            ],
            clips: [
              {
                id: "a",
                src: "tracks/vox/samples/a.wav",
                sha256: sha(good),
                startTick: 0,
              },
              {
                id: "b",
                src: "tracks/vox/samples/b.wav",
                sha256: "d".repeat(64),
                startTick: 0,
              },
              {
                id: "c",
                src: "tracks/vox/samples/gone.wav",
                sha256: "e".repeat(64),
                startTick: 0,
              },
            ],
          },
        ],
      } as never);
      const found = await clipPinDiagnostics(dir, score);
      expect(found.map((d) => d.message)).toEqual([
        expect.stringContaining(
          "clip b: tracks/vox/samples/b.wav does not match its sha256 pin",
        ),
        expect.stringContaining(
          "clip c: tracks/vox/samples/gone.wav is missing",
        ),
      ]);
      expect(found.every((d) => d.file === "tracks/vox/track.ts")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
