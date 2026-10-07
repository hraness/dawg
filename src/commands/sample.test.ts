import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyScoreOperation, createScore } from "../../core/score.ts";
import { printTrack } from "../../core/sdk/print.ts";
import { dc, wavBytes } from "../audio/sample-fixtures.ts";
import {
  addSampleVoice,
  freeVoiceName,
  listSampleVoices,
  parseSampleCommand,
  placeSampleFile,
  samplerTarget,
  voiceNameFrom,
} from "./sample.ts";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe("/sample", () => {
  test("parses list, path and `as <voice>`", () => {
    expect(parseSampleCommand("/sample")).toEqual({ kind: "list" });
    expect(parseSampleCommand("/samples")).toEqual({ kind: "list" });
    expect(parseSampleCommand("/sample kick.wav")).toEqual({
      kind: "add",
      path: "kick.wav",
    });
    expect(parseSampleCommand('/sample "My Kick.wav" as kick')).toEqual({
      kind: "add",
      path: "My Kick.wav",
      voice: "kick",
    });
    expect(parseSampleCommand("sample kick.wav")).toBeUndefined();
    expect(voiceNameFrom("/x/Kick 01.WAV")).toBe("kick_01");
    expect(voiceNameFrom("808.wav")).toBe("sample");
  });

  test("adds voices, keeps existing hits on their voice, prints sampler()", () => {
    let score = createScore({
      tracks: [{ id: "main", name: "main", instrument: "sine" }],
    });
    expect(samplerTarget(score, "main")).toBe("main");
    const first = addSampleVoice(score, "main", "snare", {
      src: "samples/snare.wav",
    });
    if (!first.ok) throw new Error(first.message);
    expect(first.message).toContain("slot 36");
    score = applyScoreOperation(first.next, {
      type: "addNote",
      note: {
        id: "n",
        trackId: "main",
        pitch: 36,
        startTick: 0,
        durationTicks: 120,
        velocity: 1,
      },
    });
    // `kick` sorts first and takes slot 36; the snare hit moves to 37.
    const second = addSampleVoice(score, "main", "kick", {
      src: "samples/kick.wav",
    });
    if (!second.ok) throw new Error(second.message);
    expect(second.next.notes[0]!.pitch).toBe(37);
    const track = second.next.tracks[0]!;
    expect(track.instrument).toBe("sampler");
    expect(listSampleVoices(track)).toEqual([
      "kick · samples/kick.wav · slot 36",
      "snare · samples/snare.wav · slot 37",
    ]);
    expect(printTrack(second.next, track)).toContain("sampler(");
    expect(freeVoiceName(second.next, "main", "kick")).toBe("kick_2");
    const duplicate = addSampleVoice(second.next, "main", "kick", {
      src: "samples/x.wav",
    });
    expect(duplicate.ok).toBe(false);
    expect(addSampleVoice(score, "main", "Bad-Name", { src: "a.wav" }).ok).toBe(
      false,
    );
  });

  test("a focused synth track with notes gets a new samples track", () => {
    const score = createScore({
      tracks: [{ id: "lead", name: "lead", instrument: "saw" }],
      notes: [
        {
          id: "n",
          trackId: "lead",
          pitch: 60,
          startTick: 0,
          durationTicks: 120,
          velocity: 1,
        },
      ],
    });
    const target = samplerTarget(score, "lead");
    expect(target).toBe("samples");
    const result = addSampleVoice(score, target, "kick", { src: "a.wav" });
    if (!result.ok) throw new Error(result.message);
    expect(result.next.tracks.map((t) => [t.id, t.instrument])).toEqual([
      ["lead", "saw"],
      ["samples", "sampler"],
    ]);
  });

  test("copies outside files into the track's samples/ and enforces limits", async () => {
    const root = await mkdtemp(join(tmpdir(), "dawg-sample-cmd-"));
    roots.push(root);
    const source = join(root, "Kick.wav");
    const bytes = wavBytes(dc(32));
    await writeFile(source, bytes);
    const score = createScore({
      tracks: [{ id: "drums", name: "Drums", instrument: "sine" }],
    });
    const placed = await placeSampleFile({
      projectRoot: root,
      cwd: root,
      input: "Kick.wav",
      score,
      trackId: "drums",
      voice: "kick",
    });
    expect(placed).toMatchObject({ src: "samples/kick.wav", copied: true });
    expect(await readFile(join(root, "tracks/drums/samples/kick.wav"))).toEqual(
      Buffer.from(bytes),
    );
    // A file already in the track directory is referenced in place.
    await mkdir(join(root, "tracks/drums/one-shots"));
    await writeFile(join(root, "tracks/drums/one-shots/hat.wav"), bytes);
    const inPlace = await placeSampleFile({
      projectRoot: root,
      cwd: root,
      input: "tracks/drums/one-shots/hat.wav",
      score,
      trackId: "drums",
      voice: "hat",
    });
    expect(inPlace).toMatchObject({ src: "one-shots/hat.wav", copied: false });
    await expect(
      placeSampleFile({
        projectRoot: root,
        cwd: root,
        input: "missing.wav",
        score,
        trackId: "drums",
        voice: "x",
      }),
    ).rejects.toThrow("no such file");
  });
});
