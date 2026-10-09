import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyScoreOperation,
  createScore,
  type TrackScore,
} from "../../core/score.ts";
import { encodeWav } from "../audio/wav.ts";
import type { ToolContext, ToolPlan } from "./tools.ts";
import { CLIPS_TOOLS, VOICE_PREVIEWABLE_TOOLS } from "./voice-tools.ts";

const tool = (name: string) => CLIPS_TOOLS.find((t) => t.name === name)!;
const context = (score: TrackScore): ToolContext => ({
  score,
  focusedTrackId: "vox",
  revision: 0,
  newNoteId: (_t, i) => `x${i}`,
});
const apply = (score: TrackScore, plan: ToolPlan) => {
  if (plan.kind !== "score") throw new Error(plan.kind);
  return plan.operations.reduce(applyScoreOperation, score);
};
const base = () =>
  createScore({
    ticksPerBeat: 480,
    tracks: [{ id: "vox", name: "vox", instrument: "vocal" }],
    notes: [0, 1, 2].map((i) => ({
      id: `n${i}`,
      trackId: "vox",
      startTick: i * 480,
      durationTicks: 480,
      pitch: 60 + i,
      velocity: 0.8,
    })),
  } as never);

describe("clip tools", () => {
  test("registered and previewable", () => {
    expect(CLIPS_TOOLS.map((t) => t.name)).toEqual([
      "place_clip",
      "edit_clip",
      "set_lyrics",
    ]);
    expect(VOICE_PREVIEWABLE_TOOLS).toContain("place_clip");
  });

  test("place_clip pins sha256, sets -6 dBFS gain, edit_clip edits and repeats", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-place-clip-"));
    try {
      const pcm = new Int16Array(4800);
      for (let i = 0; i < pcm.length; i += 1) pcm[i] = i % 2 ? 16384 : -16384;
      await mkdir(join(dir, "tracks/vox/samples"), { recursive: true });
      await writeFile(
        join(dir, "tracks/vox/samples/hook.wav"),
        encodeWav(pcm, 48_000),
      );
      const plan = tool("place_clip").plan(
        { src: "tracks/vox/samples/hook.wav", at: 4 },
        context(base()),
      );
      expect(plan.kind).toBe("prepare");
      if (plan.kind !== "prepare") return;
      const score = apply(base(), await plan.run({ workspace: { root: dir } }));
      const clip = score.tracks[0]!.clips![0]!;
      expect(clip).toMatchObject({ id: "hook", startTick: 1920 });
      expect(clip.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(20 * Math.log10(0.5 * clip.gain!)).toBeCloseTo(-6, 1);

      // split at beat 4.1 (2.05 s) cuts the 0.1 s clip in half.
      const splitPlan = tool("edit_clip").plan(
        { id: "hook", split: 4.1 },
        context(score),
      );
      if (splitPlan.kind !== "prepare") throw new Error(splitPlan.kind);
      const halves = apply(
        score,
        await splitPlan.run({ workspace: { root: dir } }),
      ).tracks[0]!.clips!;
      expect(halves.map((c) => c.id)).toEqual(["hook", "hook2"]);
      expect(halves[0]!.dur).toBeCloseTo(0.05, 6);
      expect(halves[1]).toMatchObject({ offset: 0.05, startTick: 1968 });
      expect(() =>
        tool("edit_clip").plan(
          { id: "hook", split: 4.1, rev: true },
          context(score),
        ),
      ).toThrow("split on its own");

      const edited = apply(
        score,
        tool("edit_clip").plan(
          { id: "hook", gain: 0, rev: true, repeat: { every: 4, until: 16 } },
          context(score),
        ),
      );
      const clips = edited.tracks[0]!.clips!;
      expect(clips[0]!.gain).toBeUndefined();
      expect(clips[0]!.rev).toBe(true);
      expect(clips.map((c) => c.startTick)).toEqual([1920, 3840, 5760]);
      const removed = apply(
        edited,
        tool("edit_clip").plan({ id: "hook", remove: true }, context(edited)),
      );
      expect(removed.tracks[0]!.clips!.map((c) => c.id)).toEqual([
        "hook-r2",
        "hook-r3",
      ]);
      const missing = tool("place_clip").plan(
        { src: "nope.wav" },
        context(base()),
      );
      if (missing.kind === "prepare")
        await expect(missing.run({ workspace: { root: dir } })).rejects.toThrow(
          "does not exist",
        );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("set_lyrics writes and clears", () => {
    const sung = apply(
      base(),
      tool("set_lyrics").plan({ text: "hel-lo _" }, context(base())),
    );
    expect(sung.notes.map((n) => n.lyric)).toEqual(["hel", "lo", "_"]);
    const cleared = apply(
      sung,
      tool("set_lyrics").plan({ clear: true }, context(sung)),
    );
    expect(cleared.notes.every((n) => n.lyric === undefined)).toBe(true);
    expect(() =>
      tool("edit_clip").plan({ id: "zz", rev: true }, context(base())),
    ).toThrow("no clip zz");
  });
});
