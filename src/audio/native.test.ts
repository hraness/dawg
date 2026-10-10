import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore, type TrackScore } from "../../core/score.ts";
import { AudioEngine, detectAudioBackend } from "./engine.ts";
import {
  NativeCapture,
  SINK_ABI_VERSION,
  bindSink,
  libraryFileName,
  nativeTarget,
  probeNativeSink,
  writeTake,
  type SinkLibrary,
  type SinkSymbols,
} from "./native.ts";

const RATE = 8_000;
let locks = 0;
/** A lock per engine: two engines in one test must not wait on each other. */
const lockPath = () =>
  join(tmpdir(), `dawg-native-test-${process.pid}-${(locks += 1)}.lock`);

function score(): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [{ id: "main", name: "main", instrument: "sine", pan: -0.5 }],
    notes: [
      {
        id: "a",
        trackId: "main",
        pitch: 60,
        startTick: 0,
        durationTicks: 480,
        velocity: 0.8,
      },
    ],
  });
}

/**
 * A fake sink library behind fake ffi symbols: pointers are the typed
 * arrays themselves, and `advance` plays frames the way a device callback
 * would (silence and an underrun when the ring runs dry).
 */
function fakeSink(clock: { ms: number }, options: { abi?: number } = {}) {
  const channels = 2;
  const ring: number[] = [];
  const played: number[] = [];
  const state = {
    frames: 0,
    xruns: 0,
    edgeNs: 0,
    framesAtEdge: 0,
    failed: false,
    latencyNs: 3_000_000,
    open: 0,
  };
  const capture: number[] = [];
  const asView = <T>(value: unknown) => value as T;
  const write = (out: unknown, len: number, text: string): number => {
    const bytes = new TextEncoder().encode(text);
    const view = asView<Uint8Array>(out);
    view.set(bytes.subarray(0, Math.max(0, len - 1)));
    return bytes.length;
  };
  const symbols: SinkSymbols = {
    dawg_sink_abi_version: () => options.abi ?? SINK_ABI_VERSION,
    dawg_sink_clock_ns: () => BigInt(Math.round(clock.ms * 1e6)),
    dawg_sink_last_error: (out, len) => write(out, len, "fake error"),
    dawg_sink_devices: (input, out, len) =>
      write(
        out,
        len,
        input
          ? "Mic\t1\t1\t48000\n"
          : "Speakers\t1\t2\t48000\nHeadphones\t0\t2\t44100\n",
      ),
    dawg_sink_open: () => {
      state.open += 1;
      state.failed = false;
      return { output: true };
    },
    dawg_capture_open: () => ({ output: false }),
    dawg_sink_write: (_handle, samples, count) => {
      const view = asView<Float32Array>(samples);
      const free = RATE * 2 * channels - ring.length;
      const take = Math.min(count, free);
      for (let i = 0; i < take; i += 1) ring.push(view[i]!);
      return take;
    },
    dawg_capture_read: (_handle, out, count) => {
      const view = asView<Float32Array>(out);
      const take = Math.min(count, capture.length);
      for (let i = 0; i < take; i += 1) view[i] = capture.shift()!;
      return take;
    },
    dawg_sink_stats: (handle, out) => {
      const view = asView<BigUint64Array>(out);
      const input = !(handle as { output: boolean }).output;
      const values = [
        (input ? capture.length : ring.length) / channels,
        state.frames,
        state.xruns,
        state.latencyNs,
        Math.round(clock.ms * 1e6),
        state.edgeNs,
        state.framesAtEdge,
        64,
        RATE,
        channels,
        48_000,
        state.failed ? 1 : 0,
      ];
      values.forEach((value, index) => (view[index] = BigInt(value)));
      return 0;
    },
    dawg_sink_clear: () => {
      const dropped = ring.length / channels;
      ring.length = 0;
      return dropped;
    },
    dawg_sink_close: () => undefined,
  };
  /** Play `frames` on the device at the current clock. */
  const advance = (frames: number) => {
    state.edgeNs = Math.round((clock.ms + 3) * 1e6);
    state.framesAtEdge = state.frames;
    for (let i = 0; i < frames * channels; i += 1) {
      if (ring.length === 0) {
        if (i % channels === 0) state.xruns += 1;
        played.push(0);
      } else played.push(ring.shift()!);
    }
    state.frames += frames;
  };
  const library = bindSink(symbols, (view) => view);
  return { symbols, library, ring, played, state, capture, advance };
}

describe("native sink loading", () => {
  test("picks a prebuilt target per platform and arch", () => {
    expect(nativeTarget("darwin", "arm64")).toBe("darwin-arm64");
    expect(nativeTarget("linux", "x64")).toBe("linux-x64");
    expect(nativeTarget("win32", "x64")).toBeUndefined();
    expect(libraryFileName("darwin")).toBe("libdawg_sink.dylib");
    expect(libraryFileName("linux")).toBe("libdawg_sink.so");
  });

  test("verifies the sha256 before dlopen and falls back on anything wrong", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-native-"));
    try {
      const fake = fakeSink({ ms: 0 });
      let opened = 0;
      const dlopen = () => {
        opened += 1;
        return fake.symbols;
      };
      const base = { env: {}, platform: "linux", arch: "x64", dir, dlopen };
      expect(probeNativeSink(base)).toEqual({
        ok: false,
        reason: "native sink not installed (no manifest)",
      });
      await mkdir(join(dir, "linux-x64"));
      const bytes = new TextEncoder().encode("not really a library");
      await writeFile(join(dir, "linux-x64", "libdawg_sink.so"), bytes);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const manifest = (hash: string, abi = SINK_ABI_VERSION) =>
        writeFile(
          join(dir, "manifest.json"),
          JSON.stringify({
            abi,
            libraries: {
              "linux-x64": { file: "linux-x64/libdawg_sink.so", sha256: hash },
            },
          }),
        );
      await manifest("0".repeat(64));
      const bad = probeNativeSink(base);
      expect(bad.ok).toBe(false);
      expect(!bad.ok && bad.reason).toContain("sha256 mismatch");
      expect(opened).toBe(0);
      await manifest(sha256);
      const good = probeNativeSink(base);
      expect(good.ok).toBe(true);
      expect(good.ok && good.detail).toContain("verified");
      expect(opened).toBe(1);
      // No prebuilt for this platform: never dlopen, never compile.
      const other = probeNativeSink({ ...base, arch: "arm64" });
      expect(!other.ok && other.reason).toContain("linux-arm64");
      expect(opened).toBe(1);
      // dlopen itself failing (wrong arch, missing system libs).
      const broken = probeNativeSink({
        ...base,
        dlopen: () => {
          throw new Error("dlopen failed: image not found");
        },
      });
      expect(!broken.ok && broken.reason).toContain("failed to load");
      // An ABI the loader does not speak.
      const abi = probeNativeSink({
        ...base,
        dlopen: () => fakeSink({ ms: 0 }, { abi: 99 }).symbols,
      });
      expect(!abi.ok && abi.reason).toContain("ABI 99");
      expect(
        probeNativeSink({ ...base, env: { DAWG_AUDIO_NATIVE: "0" } }).ok,
      ).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a missing library falls back to ffplay and says why", () => {
    const info = detectAudioBackend({
      env: {},
      which: (binary) => (binary === "ffplay" ? "/bin/ffplay" : null),
      native: () =>
        probeNativeSink({ env: {}, dir: "/nonexistent/dawg-prebuilt" }),
    });
    expect(info.backend).toBe("ffplay");
    expect(info.detail).toContain("native sink unavailable");
    expect(info.nativeUnavailable).toBeDefined();
    const none = detectAudioBackend({
      env: {},
      which: () => null,
      platform: "linux",
      native: () => ({ ok: false, reason: "no prebuilt" }),
    });
    expect(none.backend).toBe("none");
    expect(none.detail).toContain("native sink unavailable: no prebuilt");
  });

  test("the native sink comes first when it loads", () => {
    const fake = fakeSink({ ms: 0 });
    const info = detectAudioBackend({
      env: {},
      which: () => "/bin/ffplay",
      native: () => ({
        ok: true,
        library: fake.library,
        path: "x",
        detail: "test",
      }),
    });
    expect(info.backend).toBe("native");
    expect(info.native).toBe(fake.library);
    // A forced stdin backend skips it.
    expect(
      detectAudioBackend({
        env: { DAWG_AUDIO_BACKEND: "ffplay" },
        which: () => "/bin/ffplay",
        native: () => {
          throw new Error("not probed");
        },
      }).backend,
    ).toBe("ffplay");
  });

  test("lists output and input devices", () => {
    const { library } = fakeSink({ ms: 0 });
    expect(library.devices(false)).toEqual([
      { name: "Speakers", default: true, channels: 2, rate: 48_000 },
      { name: "Headphones", default: false, channels: 2, rate: 44_100 },
    ]);
    expect(library.devices(true)[0]?.name).toBe("Mic");
    expect(library.lastError()).toBe("fake error");
  });
});

function nativeEngine(clock: { ms: number }, library: SinkLibrary) {
  return new AudioEngine({
    info: { backend: "native", streaming: true, native: library, detail: "t" },
    sampleRate: RATE,
    lockPath: lockPath(),
    leadMs: 100,
    timer: false,
    worker: false,
    now: () => clock.ms,
  });
}

/** The stdin stream a command player gets for `score()`, `frames` long. */
async function referenceStream(frames: number): Promise<Int16Array> {
  const clock = { ms: 0 };
  const chunks: Buffer[] = [];
  let exit: (code: number) => void = () => undefined;
  const exited = new Promise<number>((resolve) => (exit = resolve));
  const engine = new AudioEngine({
    info: { backend: "command", streaming: true, command: ["x"], detail: "" },
    sampleRate: RATE,
    lockPath: lockPath(),
    leadMs: 0,
    timer: false,
    worker: false,
    now: () => clock.ms,
    spawn: () => ({
      pid: 1,
      stdin: {
        write: (chunk: Uint8Array) => void chunks.push(Buffer.from(chunk)),
      },
      exited,
      kill: () => exit(0),
    }),
  });
  await engine.play(score(), 0);
  clock.ms = (frames * 1000) / RATE + 1;
  engine.pump();
  await engine.dispose();
  return new Int16Array(new Uint8Array(Buffer.concat(chunks)).buffer);
}

describe("native backend", () => {
  test("plays exactly the samples a stdin player would get", async () => {
    const clock = { ms: 1_000 };
    const fake = fakeSink(clock);
    const engine = nativeEngine(clock, fake.library);
    expect(engine.playLeadMs).toBe(15);
    const chunks: Uint8Array[] = [];
    let exit: (code: number) => void = () => undefined;
    const exited = new Promise<number>((resolve) => (exit = resolve));
    const reference = new AudioEngine({
      info: { backend: "command", streaming: true, command: ["x"], detail: "" },
      sampleRate: RATE,
      lockPath: lockPath(),
      leadMs: 100,
      timer: false,
      worker: false,
      now: () => clock.ms,
      spawn: () => ({
        pid: 1,
        stdin: {
          write: (chunk: Uint8Array) => void chunks.push(chunk.slice()),
        },
        exited,
        kill: () => exit(0),
      }),
    });
    await engine.play(score(), 0);
    await reference.play(score(), 0);
    for (let step = 0; step < 100; step += 1) {
      clock.ms += 5;
      fake.advance(RATE / 200);
      engine.pump();
      reference.pump();
    }
    await engine.stopAsync();
    await reference.stopAsync();
    const sent = new Int16Array(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).buffer.slice(0),
    );
    const heard = [...fake.played, ...fake.ring].map((v) => v * 32768);
    const n = Math.min(sent.length, heard.length);
    expect(n).toBeGreaterThan(RATE);
    expect(heard.slice(0, n)).toEqual(Array.from(sent.subarray(0, n)));
    expect(fake.state.xruns).toBe(0);
    await engine.dispose();
    await reference.dispose();
  });

  test("keeps the ring at the lead and schedules notes by the device clock", async () => {
    const clock = { ms: 1_000 };
    const fake = fakeSink(clock);
    const engine = nativeEngine(clock, fake.library);
    engine.setLeadMs(engine.playLeadMs);
    await engine.monitor(true);
    for (let step = 0; step < 20; step += 1) {
      clock.ms += 5;
      fake.advance(RATE / 200);
      engine.pump();
    }
    // Topped up to 15 ms each pump, never more.
    expect(fake.ring.length / 2).toBe(Math.round(RATE * 0.015));
    const pcm = new Int16Array(400).fill(1000);
    const at = engine.noteOn(1, { pcm, frames: 200 });
    // Heard after the 15 ms queued, the 5 ms buffer the device is playing
    // and its 3 ms output latency.
    expect(at - clock.ms).toBeCloseTo(23, 6);
    const timing = engine.timing!;
    expect(timing.outputLatencyMs).toBe(3);
    expect(timing.deviceRate).toBe(48_000);
    expect(timing.bufferFrames).toBe(64);
    await engine.dispose();
  });

  test("an underrun skips the loop forward to stay on the beat", async () => {
    const clock = { ms: 1_000 };
    const fake = fakeSink(clock);
    const engine = nativeEngine(clock, fake.library);
    await engine.play(score(), 0);
    clock.ms += 5;
    fake.advance(40);
    engine.pump();
    const queued = fake.ring.length / 2;
    // A stall: the device plays 50 ms past everything queued.
    clock.ms += 50 + (queued * 1000) / RATE;
    fake.advance(queued + 400);
    expect(fake.state.xruns).toBeGreaterThan(0);
    const before = fake.played.length / 2;
    engine.pump();
    clock.ms += 5;
    fake.advance(8);
    // The audio after the stall is loop frame `before` (on the transport's
    // beat), not the frame that was due when the ring ran dry.
    const reference = await referenceStream(before + 8);
    const after = fake.played.slice(before * 2).map((v) => v * 32768);
    expect(after).toEqual(
      Array.from(reference.subarray(before * 2, (before + 8) * 2)),
    );
    expect(after.some((v) => v !== 0)).toBe(true);
    expect(engine.timing!.underruns).toBeGreaterThan(0);
    await engine.dispose();
  });

  test("a lost device ends the player and respawns on a fresh open", async () => {
    const clock = { ms: 1_000 };
    const fake = fakeSink(clock);
    const statuses: string[] = [];
    const engine = new AudioEngine({
      info: {
        backend: "native",
        streaming: true,
        native: fake.library,
        detail: "",
      },
      sampleRate: RATE,
      timer: false,
      worker: false,
      lockPath: lockPath(),
      respawnMs: 1,
      now: () => clock.ms,
      onStatus: (status) => statuses.push(status.state),
    });
    await engine.play(score(), 0);
    expect(fake.state.open).toBe(1);
    fake.state.failed = true;
    engine.pump();
    await Bun.sleep(30);
    expect(statuses).toContain("restarting");
    expect(fake.state.open).toBe(2);
    await engine.dispose();
  });
});

describe("native capture", () => {
  test("drains the input ring and stores a sha256-named take", async () => {
    const fake = fakeSink({ ms: 0 });
    const capture = NativeCapture.open(fake.library, {
      rate: RATE,
      channels: 2,
    });
    fake.capture.push(
      ...Array.from({ length: 800 }, (_, i) => (i % 2 ? 0.5 : -0.5)),
    );
    expect(capture.drain()).toBe(800);
    fake.capture.push(0.25, 0.25);
    const samples = capture.close();
    expect(samples.length).toBe(802);
    const root = await mkdtemp(join(tmpdir(), "dawg-take-"));
    try {
      const take = await writeTake(root, "vox", samples, RATE, 2);
      expect(take.src).toBe(`tracks/vox/takes/${take.sha256}.wav`);
      const bytes = await readFile(join(root, take.src));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        take.sha256,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
