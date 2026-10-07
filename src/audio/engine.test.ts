import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore, type TrackScore } from "../../core/score.ts";
import {
  AudioEngine,
  detectAudioBackend,
  type AudioBackendInfo,
} from "./engine.ts";
import { renderScorePcm } from "./wav.ts";

const FAKE_PLAYER = join(import.meta.dir, "fixtures", "fake-player.ts");
const RATE = 8_000;
const INFO: AudioBackendInfo = {
  backend: "command",
  streaming: true,
  command: ["fake"],
  detail: "test",
};

function score(pitch = 60, tempoBpm = 120): TrackScore {
  return createScore({
    tempoBpm,
    bars: 1,
    tracks: [{ id: "main", name: "main", instrument: "sine", pan: -0.5 }],
    notes: [
      {
        id: "a",
        trackId: "main",
        pitch,
        startTick: 0,
        durationTicks: 480,
        velocity: 0.8,
      },
      {
        id: "b",
        trackId: "main",
        pitch: pitch + 7,
        startTick: 960,
        durationTicks: 480,
        velocity: 0.8,
      },
    ],
  });
}

/** An in-memory player: every chunk the engine writes, in order. */
function fakeSpawn() {
  const starts: number[] = [];
  const chunks: Uint8Array[] = [];
  let exit: (code: number) => void = () => undefined;
  const spawn = () => {
    starts.push(starts.length);
    return {
      pid: 1,
      stdin: { write: (chunk: Uint8Array) => void chunks.push(chunk.slice()) },
      exited: new Promise<number>((resolve) => (exit = resolve)),
      kill: () => exit(0),
    };
  };
  const bytes = (): Int16Array => {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return new Int16Array(out.buffer);
  };
  return { spawn, starts, bytes };
}

function engineAt(
  clock: { ms: number },
  spawn: ReturnType<typeof fakeSpawn>["spawn"],
) {
  return new AudioEngine({
    info: INFO,
    sampleRate: RATE,
    leadMs: 100,
    timer: false,
    now: () => clock.ms,
    spawn,
  });
}

describe("backend detection", () => {
  const which = (found: string[]) => (binary: string) =>
    found.includes(binary) ? `/bin/${binary}` : null;

  test("prefers ffplay, then sox play, then afplay on macOS", () => {
    expect(
      detectAudioBackend({
        env: {},
        which: which(["ffplay", "play", "afplay"]),
        platform: "darwin",
      }),
    ).toMatchObject({ backend: "ffplay", streaming: true });
    expect(
      detectAudioBackend({
        env: {},
        which: which(["play", "afplay"]),
        platform: "darwin",
      }),
    ).toMatchObject({ backend: "sox", streaming: true });
    expect(
      detectAudioBackend({
        env: {},
        which: which(["afplay"]),
        platform: "darwin",
      }),
    ).toMatchObject({ backend: "afplay", streaming: false });
    expect(
      detectAudioBackend({ env: {}, which: which([]), platform: "linux" })
        .backend,
    ).toBe("none");
  });

  test("streams raw s16le stereo at the render rate", () => {
    const ffplay = detectAudioBackend({
      env: {},
      which: which(["ffplay"]),
      sampleRate: 22_050,
    });
    expect(ffplay.command).toContain("s16le");
    expect(ffplay.command).toContain("22050");
    expect(ffplay.command!.at(-1)).toBe("-");
    const sox = detectAudioBackend({
      env: {},
      which: which(["play"]),
      sampleRate: 22_050,
    });
    expect(sox.command).toEqual([
      "/bin/play",
      "-q",
      "-t",
      "raw",
      "-r",
      "22050",
      "-e",
      "signed-integer",
      "-b",
      "16",
      "-c",
      "2",
      "-L",
      "-",
    ]);
  });

  test("honors DAWG_AUDIO=0, DAWG_AUDIO_PLAYER, and DAWG_AUDIO_BACKEND", () => {
    const all = which(["ffplay", "play", "afplay"]);
    expect(
      detectAudioBackend({
        env: { DAWG_AUDIO: "0", DAWG_AUDIO_PLAYER: "x" },
        which: all,
      }).backend,
    ).toBe("none");
    expect(
      detectAudioBackend({
        env: { DAWG_AUDIO_PLAYER: "rec '/tmp/a b' {rate} {channels}" },
        which: all,
        sampleRate: 8000,
      }),
    ).toMatchObject({
      backend: "command",
      command: ["rec", "/tmp/a b", "8000", "2"],
    });
    expect(
      detectAudioBackend({ env: { DAWG_AUDIO_BACKEND: "sox" }, which: all })
        .backend,
    ).toBe("sox");
    expect(
      detectAudioBackend({
        env: { DAWG_AUDIO_BACKEND: "afplay" },
        which: all,
        platform: "darwin",
      }).backend,
    ).toBe("afplay");
  });
});

describe("gapless streaming engine", () => {
  test("streams the loop-folded render, paced by the clock", async () => {
    const clock = { ms: 0 };
    const fake = fakeSpawn();
    const engine = engineAt(clock, fake.spawn);
    const loop = renderScorePcm(score(), { sampleRate: RATE, loop: true });
    await engine.play(score(), 0);
    // Only the lead is queued at start.
    expect(fake.bytes().length).toBe(800 * 2);
    for (let ms = 0; ms <= 2_500; ms += 20) {
      clock.ms = ms;
      engine.pump();
    }
    const stream = fake.bytes();
    expect(stream.length).toBe((20_000 + 800) * 2);
    // One loop is 2 s = 16000 frames at 120 bpm; the stream repeats it.
    expect(loop.frames).toBe(16_000);
    expect(stream.subarray(0, loop.pcm.length)).toEqual(loop.pcm);
    expect(stream.subarray(loop.pcm.length, loop.pcm.length + 1000)).toEqual(
      loop.pcm.subarray(0, 1000),
    );
    await engine.stopAsync();
    expect(engine.streaming).toBe(false);
  });

  test("edits swap the buffer in place without restarting the player", async () => {
    const clock = { ms: 0 };
    const fake = fakeSpawn();
    const engine = engineAt(clock, fake.spawn);
    await engine.play(score(60), 0);
    clock.ms = 500;
    engine.pump();
    const before = fake.bytes().length / 2;
    // The transport says beat 1.0 (500 ms at 120 bpm).
    await engine.play(score(64), 1);
    clock.ms = 1_000;
    engine.pump();
    expect(fake.starts.length).toBe(1);
    expect(engine.playerStarts).toBe(1);
    const stream = fake.bytes();
    const next = renderScorePcm(score(64), { sampleRate: RATE, loop: true });
    // Frames after the swap continue from the same loop position in the new render.
    const after = stream.subarray(before * 2, before * 2 + 4000 * 2);
    expect(after).toEqual(next.pcm.subarray(before * 2, before * 2 + 4000 * 2));
    await engine.stopAsync();
  });

  test("tempo changes keep the musical beat and seeks re-anchor", async () => {
    const clock = { ms: 0 };
    const fake = fakeSpawn();
    const engine = engineAt(clock, fake.spawn);
    await engine.play(score(60, 120), 0);
    clock.ms = 500;
    engine.pump();
    const written = fake.bytes().length / 2; // 4000 + 800 lead
    // Halve the tempo: beat 1 is now frame 8000 at 60 bpm.
    await engine.play(score(60, 60), 1);
    clock.ms = 520;
    engine.pump();
    const slow = renderScorePcm(score(60, 60), {
      sampleRate: RATE,
      loop: true,
    });
    const stream = fake.bytes();
    // The transport is at beat 1 and the write head is 0.1 s ahead of it,
    // which is 0.1 beat at the new tempo: frame 8800.
    const head = 8_800;
    expect(stream.subarray(written * 2, written * 2 + 200)).toEqual(
      slow.pcm.subarray(head * 2, head * 2 + 200),
    );
    // Seek to beat 0 at 520 ms: 800 frames are queued, so the head reads
    // from 0.1 beat (frame 800) and lines up with the transport.
    engine.seek(0);
    const mark = fake.bytes().length / 2;
    clock.ms = 540;
    engine.pump();
    expect(fake.bytes().subarray(mark * 2, mark * 2 + 200)).toEqual(
      slow.pcm.subarray(800 * 2, 800 * 2 + 200),
    );
    expect(fake.starts.length).toBe(1);
    await engine.stopAsync();
  });

  test("respects the session audio lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-engine-"));
    try {
      const lockPath = join(dir, "audio.lock");
      const a = fakeSpawn();
      const b = fakeSpawn();
      const clock = { ms: 0 };
      const first = new AudioEngine({
        info: INFO,
        sampleRate: RATE,
        timer: false,
        now: () => clock.ms,
        spawn: a.spawn,
        lockPath,
      });
      const second = new AudioEngine({
        info: INFO,
        sampleRate: RATE,
        timer: false,
        now: () => clock.ms,
        spawn: b.spawn,
        lockPath,
      });
      await first.play(score(), 0);
      await second.play(score(), 0);
      expect(a.starts.length).toBe(1);
      expect(b.starts.length).toBe(0);
      await first.stopAsync();
      expect(existsSync(lockPath)).toBe(false);
      await second.play(score(), 0);
      expect(b.starts.length).toBe(1);
      await second.stopAsync();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("engine resilience", () => {
  test("renders in flight coalesce and the newest score wins", async () => {
    const clock = { ms: 0 };
    const fake = fakeSpawn();
    const engine = new AudioEngine({
      info: INFO,
      sampleRate: RATE,
      leadMs: 100,
      timer: false,
      now: () => clock.ms,
      spawn: fake.spawn,
      worker: false,
    });
    await engine.play(score(60), 0);
    clock.ms = 500;
    engine.pump();
    const before = fake.bytes().length / 2;
    // Three edits before the first re-render lands: one render of the last.
    const edits = [62, 64, 67].map((pitch) => engine.play(score(pitch), 1));
    await Promise.all(edits);
    clock.ms = 1_000;
    engine.pump();
    expect(engine.playerStarts).toBe(1);
    const next = renderScorePcm(score(67), { sampleRate: RATE, loop: true });
    const after = fake.bytes().subarray(before * 2, before * 2 + 4000 * 2);
    expect(after).toEqual(next.pcm.subarray(before * 2, before * 2 + 4000 * 2));
    expect(engine.lead).toBe(800);
    await engine.dispose();
  });

  test("a dying player is respawned with backoff, then playback stops", async () => {
    const clock = { ms: 0 };
    const exits: ((code: number) => void)[] = [];
    const starts: number[] = [];
    const spawn = () => {
      starts.push(starts.length);
      return {
        pid: 1,
        stdin: { write: () => undefined },
        exited: new Promise<number>((resolve) => exits.push(resolve)),
        kill: () => exits[starts.length - 1]?.(0),
      };
    };
    const statuses: string[] = [];
    const engine = new AudioEngine({
      info: INFO,
      sampleRate: RATE,
      timer: false,
      now: () => clock.ms,
      spawn,
      worker: false,
      respawnMs: 1,
      onStatus: (status) => statuses.push(`${status.state}: ${status.message}`),
    });
    const until = async (ready: () => boolean) => {
      for (let i = 0; i < 200 && !ready(); i += 1) await Bun.sleep(2);
      expect(ready()).toBe(true);
    };
    await engine.play(score(), 0);
    expect(starts.length).toBe(1);
    for (let death = 1; death <= 3; death += 1) {
      exits[death - 1]!(1);
      await until(() => starts.length === death + 1);
      expect(engine.streaming).toBe(true);
      expect(statuses.at(-1)).toContain(`restarting (${death}/3)`);
    }
    exits[3]!(1);
    await until(() => statuses.length === 4);
    expect(statuses.at(-1)).toContain("playback stopped");
    expect(engine.streaming).toBe(false);
    expect(starts.length).toBe(4);
    // A later play starts fresh with a new budget.
    await engine.play(score(), 0);
    expect(starts.length).toBe(5);
    await engine.dispose();
  });
});

describe("real player process", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0))
      await rm(dir, { recursive: true, force: true });
  });

  test("a long-lived stdin player records one continuous stream across edits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-player-"));
    dirs.push(dir);
    const out = join(dir, "out");
    const info = detectAudioBackend({
      env: { DAWG_AUDIO_PLAYER: `${process.execPath} ${FAKE_PLAYER} ${out}` },
      sampleRate: RATE,
    });
    const engine = new AudioEngine({
      info,
      sampleRate: RATE,
      leadMs: 50,
      tickMs: 10,
    });
    await engine.play(score(60), 0);
    await Bun.sleep(200);
    await engine.play(score(62), 1);
    await Bun.sleep(200);
    await engine.play(score(65), 2);
    await Bun.sleep(200);
    await engine.stopAsync();
    const starts = (await readFile(`${out}.starts`, "utf8")).trim().split("\n");
    expect(starts.length).toBe(1);
    const pcm = new Int16Array((await readFile(`${out}.pcm`)).buffer);
    // ~600 ms of stereo audio plus lead, continuous (even, whole frames).
    expect(pcm.length % 2).toBe(0);
    expect(pcm.length / 2).toBeGreaterThan(RATE * 0.4);
    expect(pcm.length / 2).toBeLessThan(RATE * 1.5);
    // Stereo: the track is panned left, so the left channel is louder.
    let left = 0;
    let right = 0;
    for (let i = 0; i < pcm.length; i += 2) {
      left += Math.abs(pcm[i]!);
      right += Math.abs(pcm[i + 1]!);
    }
    expect(left).toBeGreaterThan(right);
  });
});
