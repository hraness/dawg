import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { PlayKeyboard, playLayoutFor } from "../tui/play-mode.ts";
import { clickLevel, clicksIn, parseClickArgument } from "./click.ts";
import { AudioEngine, type AudioBackendInfo } from "./engine.ts";
import { LiveSynth } from "./live.ts";
import { sampleKey, type DecodedSample, type SampleBank } from "./samples.ts";
import { renderScorePcm, renderScoreWav } from "./wav.ts";

const RATE = 8_000;
const INFO: AudioBackendInfo = {
  backend: "command",
  streaming: true,
  command: ["fake"],
  detail: "test",
};

function synthScore(): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      { id: "lead", name: "lead", instrument: "piano", pan: 0.25, muted: true },
    ],
    notes: [
      {
        id: "a",
        trackId: "lead",
        pitch: 60,
        startTick: 0,
        durationTicks: 480,
        velocity: 0.8,
      },
    ],
  });
}

function fakeSpawn() {
  const chunks: Uint8Array[] = [];
  let starts = 0;
  let exit: (code: number) => void = () => undefined;
  const spawn = () => {
    starts += 1;
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
  return { spawn, bytes, starts: () => starts };
}

function engineAt(clock: { ms: number }, fake: ReturnType<typeof fakeSpawn>) {
  return new AudioEngine({
    info: INFO,
    sampleRate: RATE,
    leadMs: 200,
    timer: false,
    worker: false,
    now: () => clock.ms,
    spawn: fake.spawn,
  });
}

function decoded(frames: number, level: number, sha: string): DecodedSample {
  return {
    sha256: sha.repeat(64).slice(0, 64),
    sampleRate: RATE,
    channels: 1,
    frames,
    mono: new Float32Array(frames).fill(level),
  };
}

describe("live synth", () => {
  test("a live note is the offline render of the same note, audible when muted", () => {
    const score = synthScore();
    const live = new LiveSynth(RATE);
    const note = live.render({
      score,
      trackId: "lead",
      pitch: 64,
      velocity: 0.5,
      seconds: 0.25,
    })!;
    const reference = renderScorePcm(
      createScore({
        tempoBpm: 120,
        bars: 1,
        tracks: [{ id: "lead", name: "lead", instrument: "piano", pan: 0.25 }],
        notes: [
          {
            id: "live",
            trackId: "lead",
            pitch: 64,
            startTick: 0,
            durationTicks: 240,
            velocity: 0.5,
          },
        ],
      }),
      { sampleRate: RATE, maxSeconds: 12 },
    );
    expect(note.frames).toBeGreaterThan(0);
    expect(note.pcm).toEqual(reference.pcm.subarray(0, note.frames * 2));
    // Silence after the trimmed note.
    expect(
      reference.pcm.subarray(note.frames * 2).every((value) => value === 0),
    ).toBe(true);
    // Cached: the same request returns the same buffer.
    expect(
      live.render({
        score,
        trackId: "lead",
        pitch: 64,
        velocity: 0.5,
        seconds: 0.25,
      }),
    ).toBe(note);
    expect(
      live.render({
        score,
        trackId: "nope",
        pitch: 64,
        velocity: 1,
        seconds: 1,
      }),
    ).toBeUndefined();
  });

  test("a key on a one-shot sampler track triggers the voice in that slot", () => {
    // Slots from 36 in voice-name order: hat 36 (A), kick 37 (W), snare 38 (S).
    const score = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [
        {
          id: "kit",
          name: "kit",
          instrument: "sampler",
          sampler: {
            mode: "oneshot",
            voices: {
              snare: { src: "tracks/kit/samples/snare.wav" },
              kick: { src: "tracks/kit/samples/kick.wav" },
              hat: { src: "tracks/kit/samples/hat.wav" },
            },
          },
        },
      ],
    });
    const bank: SampleBank = {
      voices: new Map([
        [sampleKey("kit", "hat"), decoded(200, 0.5, "a")],
        [sampleKey("kit", "kick"), decoded(1_200, 0.5, "b")],
        [sampleKey("kit", "snare"), decoded(600, 0.5, "c")],
      ]),
      problems: [],
    };
    const layout = playLayoutFor(score.tracks[0]);
    expect(layout.base).toBe(36);
    expect(layout.labels.get(36)).toBe("hat");
    expect(layout.labels.get(37)).toBe("kick");
    expect(layout.labels.get(38)).toBe("snare");
    const keyboard = new PlayKeyboard({ base: layout.base });
    const live = new LiveSynth(RATE);
    const framesFor = (key: string) => {
      const pitch = keyboard.pitchFor(key)!;
      return live.render({
        score,
        trackId: "kit",
        pitch,
        velocity: 1,
        seconds: 0.1,
        samples: bank,
      })!.frames;
    };
    // One-shots play their whole sample regardless of the gate.
    expect(Math.abs(framesFor("a") - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(framesFor("w") - 1_200)).toBeLessThanOrEqual(2);
    expect(Math.abs(framesFor("s") - 600)).toBeLessThanOrEqual(2);
    // A key past the last slot is silent.
    expect(framesFor("d")).toBe(0);
  });

  test("keyed samplers start the keyboard at the C below the lowest root", () => {
    const layout = playLayoutFor(
      createScore({
        tracks: [
          {
            id: "keys",
            name: "keys",
            instrument: "sampler",
            sampler: {
              mode: "keyed",
              voices: { c4: { src: "tracks/keys/samples/c4.wav", root: 62 } },
            },
          },
        ],
      }).tracks[0],
    );
    expect(layout.base).toBe(60);
    expect(layout.labels.size).toBe(0);
  });
});

describe("click track", () => {
  test("accents the downbeat, then beats, then subdivisions", () => {
    expect(clickLevel(0, 4, 2)).toBe("accent");
    expect(clickLevel(1, 4, 2)).toBe("sub");
    expect(clickLevel(2, 4, 2)).toBe("beat");
    expect(clickLevel(8, 4, 2)).toBe("accent");
    // Count-in steps are negative and still bar-aligned.
    expect(clickLevel(-8, 4, 2)).toBe("accent");
    expect(clickLevel(-2, 4, 2)).toBe("beat");
    expect(clickLevel(3, 3, 1)).toBe("accent");
  });

  test("contiguous blocks fire each click exactly once", () => {
    const settings = { beatsPerBar: 4, subdivision: 1 };
    const steps: number[] = [];
    for (let block = 0; block < 40; block += 1) {
      const from = block * 0.1;
      const to = (block + 1) * 0.1;
      for (const event of clicksIn(from, to, 100, settings))
        steps.push(event.step);
    }
    expect(steps).toEqual([0, 1, 2, 3]);
    const events = clicksIn(0.95, 1.05, 100, settings);
    expect(events).toEqual([{ offset: 50, step: 1, level: "beat" }]);
    expect(clicksIn(1, 1, 100, settings)).toEqual([]);
  });

  test("/click parses on, off and volumes", () => {
    const current = { on: false, volume: 0.6 };
    expect(parseClickArgument("on", current)).toEqual({
      on: true,
      volume: 0.6,
    });
    expect(parseClickArgument("off", current)).toEqual({
      on: false,
      volume: 0.6,
    });
    expect(parseClickArgument("", current)).toEqual({ on: true, volume: 0.6 });
    expect(parseClickArgument("0.3", current)).toEqual({
      on: true,
      volume: 0.3,
    });
    expect(parseClickArgument("40%", current)).toEqual({
      on: true,
      volume: 0.4,
    });
    expect(parseClickArgument("80", current)).toEqual({
      on: true,
      volume: 0.8,
    });
    expect(parseClickArgument("0", current)).toEqual({ on: false, volume: 0 });
    expect(parseClickArgument("loud", current)).toHaveProperty("error");
    expect(parseClickArgument("150%", current)).toHaveProperty("error");
  });
});

describe("engine live path", () => {
  test("monitoring streams silence while stopped and mixes a live note at the write head", async () => {
    const clock = { ms: 0 };
    const fake = fakeSpawn();
    const engine = engineAt(clock, fake);
    engine.setLeadMs(60);
    expect(engine.leadMs).toBe(60);
    await engine.monitor(true);
    expect(engine.streaming).toBe(true);
    // 60 ms at 8 kHz = 480 frames of silence queued.
    expect(fake.bytes().length).toBe(480 * 2);
    expect(fake.bytes().every((value) => value === 0)).toBe(true);
    clock.ms = 100;
    const live = new LiveSynth(RATE);
    const note = live.render({
      score: synthScore(),
      trackId: "lead",
      pitch: 60,
      velocity: 1,
      seconds: 0.1,
    })!;
    const startMs = engine.noteOn(1, note);
    // The voice begins at the first frame not yet written: 60 ms after the
    // previous write head, which is 60 ms after the key at 100 ms → 160 ms.
    expect(startMs).toBe(60);
    // ...and that frame sounds lead-ms after now, the key-to-sound delay.
    for (let ms = 120; ms <= 1_000; ms += 20) {
      clock.ms = ms;
      engine.pump();
    }
    const stream = fake.bytes();
    const at = 480 * 2;
    expect(stream.subarray(at, at + note.pcm.length)).toEqual(note.pcm);
    expect(engine.liveVoices).toBe(0);
    await engine.monitor(false);
    expect(engine.streaming).toBe(false);
    expect(fake.starts()).toBe(1);
  });

  test("stopping the transport in play mode keeps the live player running", async () => {
    const clock = { ms: 0 };
    const fake = fakeSpawn();
    const engine = engineAt(clock, fake);
    await engine.monitor(true);
    await engine.play(synthScore(), 0);
    await engine.stopAsync();
    expect(engine.streaming).toBe(true);
    clock.ms = 500;
    engine.pump();
    await engine.monitor(false);
    expect(engine.streaming).toBe(false);
    expect(fake.starts()).toBe(1);
  });

  test("released voices fade out instead of clicking off", async () => {
    const clock = { ms: 0 };
    const fake = fakeSpawn();
    const engine = engineAt(clock, fake);
    await engine.monitor(true);
    const pcm = new Int16Array(RATE * 2 * 2).fill(10_000);
    engine.noteOn(7, { pcm, frames: RATE * 2 });
    clock.ms = 100;
    engine.pump();
    engine.noteOff(7);
    clock.ms = 200;
    engine.pump();
    expect(engine.liveVoices).toBe(0);
    const stream = fake.bytes();
    const tail = stream.subarray(stream.length - 200);
    expect(tail.every((value) => value === 0)).toBe(true);
    await engine.monitor(false);
  });

  test("the click bus sounds in the stream and never in a render or export", async () => {
    const score = synthScore();
    const before = renderScoreWav(score, { sampleRate: RATE });
    const loopBefore = renderScorePcm(score, { sampleRate: RATE, loop: true });
    const clock = { ms: 0 };
    const fake = fakeSpawn();
    const engine = engineAt(clock, fake);
    // Silence plus clicks: transport at beat 0 when the stream starts.
    engine.setClick({
      volume: 1,
      beatsPerBar: 4,
      subdivision: 1,
      beatAt: (ms) => ms / 500,
    });
    await engine.monitor(true);
    for (let ms = 0; ms <= 2_000; ms += 20) {
      clock.ms = ms;
      engine.pump();
    }
    const stream = fake.bytes();
    // A click at every beat (each 500 ms = 4000 frames), accent loudest.
    const peak = (from: number) => {
      let max = 0;
      for (let i = from * 2; i < (from + 300) * 2; i += 1)
        max = Math.max(max, Math.abs(stream[i]!));
      return max;
    };
    expect(peak(0)).toBeGreaterThan(peak(4_000));
    expect(peak(4_000)).toBeGreaterThan(1_000);
    expect(peak(8_000)).toBeGreaterThan(1_000);
    expect(peak(2_000)).toBe(0);
    // Renders and exports are untouched by an engine's click.
    expect(renderScoreWav(score, { sampleRate: RATE })).toEqual(before);
    expect(renderScorePcm(score, { sampleRate: RATE, loop: true }).pcm).toEqual(
      loopBefore.pcm,
    );
    engine.setClick(undefined);
    await engine.monitor(false);
  });

  test("without monitoring the stream is the loop, byte for byte", async () => {
    const score = synthScore().withBars(1);
    const clock = { ms: 0 };
    const fake = fakeSpawn();
    const engine = engineAt(clock, fake);
    // A click with a stopped transport (undefined beat) adds nothing.
    engine.setClick({
      volume: 1,
      beatsPerBar: 4,
      subdivision: 1,
      beatAt: () => undefined,
    });
    const unmuted = createScore({
      ...score.toJSON(),
      tracks: score.tracks.map((track) => ({ ...track, muted: false })),
    });
    const loop = renderScorePcm(unmuted, { sampleRate: RATE, loop: true });
    await engine.play(unmuted, 0);
    for (let ms = 0; ms <= 1_000; ms += 20) {
      clock.ms = ms;
      engine.pump();
    }
    const stream = fake.bytes();
    expect(stream.subarray(0, stream.length)).toEqual(
      loop.pcm.subarray(0, stream.length),
    );
    await engine.stopAsync();
  });
});

describe("live keys ignore the recorded piano pedals (0.6.1)", () => {
  test("una corda and sostenuto lanes do not colour a live key", () => {
    const grand = (extra: Record<string, unknown>) =>
      createScore({
        tempoBpm: 120,
        bars: 2,
        tracks: [
          {
            id: "p",
            name: "p",
            instrument: "grand",
            keys: {},
            ...extra,
          },
        ],
        notes: [],
      } as Parameters<typeof createScore>[0]);
    const play = (score: TrackScore) =>
      new LiveSynth(RATE).render({
        score,
        trackId: "p",
        pitch: 64,
        velocity: 0.7,
        seconds: 0.25,
      })!;
    const plain = play(grand({}));
    const pedalled = play(
      grand({
        softPedal: [{ tick: 0, state: "down" }],
        sostenuto: [
          { tick: 0, state: "down" },
          { tick: 3000, state: "up" },
        ],
      }),
    );
    expect(plain.frames).toBeGreaterThan(0);
    expect(pedalled.pcm).toEqual(plain.pcm);
  });
});
