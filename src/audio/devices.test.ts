import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore, type TrackScore } from "../../core/score.ts";
import { fakeSink } from "../../test/fake-sink.ts";
import { audioMenuState, runAudioCommand } from "./audio-command.ts";
import {
  audioChoicePath,
  deviceSupport,
  inputLevel,
  levelMeter,
  matchDevice,
  parseAudioCommand,
  readAudioChoice,
  resolveOutputDevice,
  writeAudioChoice,
} from "./devices.ts";
import {
  AudioEngine,
  type AudioBackendInfo,
  type AudioStatus,
} from "./engine.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "dawg-audio-dev-"));
  dirs.push(dir);
  return dir;
}

const native = (sink = fakeSink()): AudioBackendInfo => ({
  backend: "native",
  streaming: true,
  native: sink,
  detail: "fake",
});
const noWait = () => Promise.resolve();

describe("the saved choice", () => {
  test("lives in the config dir, per machine, and round-trips", () => {
    const dir = scratch();
    const path = audioChoicePath({ DAWG_CONFIG_DIR: dir });
    expect(path).toBe(join(dir, "audio.json"));
    expect(readAudioChoice(path)).toEqual({});
    writeAudioChoice("output", "USB Audio Interface", path);
    writeAudioChoice("input", "Built-in Microphone", path);
    expect(readAudioChoice(path)).toEqual({
      output: "USB Audio Interface",
      input: "Built-in Microphone",
    });
    writeAudioChoice("output", undefined, path);
    expect(readAudioChoice(path)).toEqual({ input: "Built-in Microphone" });
  });

  test("a malformed file is the defaults", () => {
    const path = join(scratch(), "audio.json");
    writeFileSync(path, "{nope");
    expect(readAudioChoice(path)).toEqual({});
    writeFileSync(path, JSON.stringify({ output: 3, input: "default" }));
    expect(readAudioChoice(path)).toEqual({});
  });

  test("DAWG_AUDIO_DEVICE overrides the saved output", () => {
    expect(resolveOutputDevice({}, { output: "USB" })).toBe("USB");
    expect(
      resolveOutputDevice(
        { DAWG_AUDIO_DEVICE: "Headphones" },
        { output: "USB" },
      ),
    ).toBe("Headphones");
    expect(resolveOutputDevice({ DAWG_AUDIO_DEVICE: " " }, {})).toBeUndefined();
  });
});

describe("parsing and matching", () => {
  test("the four forms parse; others do not", () => {
    expect(parseAudioCommand("")).toEqual({ kind: "show" });
    expect(parseAudioCommand("test")).toEqual({ kind: "test" });
    expect(parseAudioCommand("out default")).toEqual({
      kind: "set",
      side: "output",
      name: undefined,
    });
    expect(parseAudioCommand("in USB Audio Interface")).toEqual({
      kind: "set",
      side: "input",
      name: "USB Audio Interface",
    });
    expect(parseAudioCommand("out")).toBeUndefined();
    expect(parseAudioCommand("sideways")).toBeUndefined();
  });

  test("names match exactly, then by case, then by a unique prefix", () => {
    const devices = fakeSink().devices(false);
    expect(matchDevice(devices, "usb audio interface")?.name).toBe(
      "USB Audio Interface",
    );
    expect(matchDevice(devices, "built")?.name).toBe("Built-in Output");
    expect(matchDevice(devices, "nothing")).toBeUndefined();
  });

  test("the meter reads peak dBFS", () => {
    const level = inputLevel(new Float32Array([0.5, -0.25, 0]));
    expect(Math.round(level.peakDb)).toBe(-6);
    expect(levelMeter(-6)).toContain("-6 dBFS");
    expect(levelMeter(Number.NEGATIVE_INFINITY)).toContain("silent");
  });
});

describe("audio command", () => {
  test("lists, picks an output with a blip, and saves it", async () => {
    const sink = fakeSink();
    const path = join(scratch(), "audio.json");
    const moved: (string | undefined)[] = [];
    const context = {
      info: native(sink),
      env: {},
      path,
      wait: noWait,
      setOutput: (name: string | undefined) => void moved.push(name),
    };
    const shown = await runAudioCommand("", context);
    expect(shown.message).toBe(
      "audio · out default (Built-in Output) · in default (Built-in Microphone)",
    );
    expect(shown.lines?.join("\n")).toContain("USB Audio Interface");

    const picked = await runAudioCommand("out usb", context);
    expect(picked).toEqual({
      ok: true,
      message: "audio out USB Audio Interface",
    });
    expect(readAudioChoice(path).output).toBe("USB Audio Interface");
    expect(moved).toEqual(["USB Audio Interface"]);
    // The blip went to the new output and its stream closed.
    expect(sink.opened).toEqual(["USB Audio Interface"]);
    expect(sink.written.get("USB Audio Interface")).toBeGreaterThan(0);
    expect(sink.live()).toBe(0);

    const back = await runAudioCommand("out default", context);
    expect(back.message).toBe("audio out default (Built-in Output)");
    expect(readAudioChoice(path).output).toBeUndefined();
  });

  test("an unknown name lists what there is", async () => {
    const result = await runAudioCommand("in Theremin", {
      info: native(),
      env: {},
      path: join(scratch(), "audio.json"),
    });
    expect(result).toEqual({
      ok: false,
      message:
        'no input named "Theremin" · Built-in Microphone · USB Audio Interface',
    });
  });

  test("audio test plays a tone and meters the chosen input", async () => {
    const sink = fakeSink({ level: 0.5 });
    const path = join(scratch(), "audio.json");
    writeAudioChoice("input", "USB Audio Interface", path);
    const result = await runAudioCommand("test", {
      info: native(sink),
      env: {},
      path,
      wait: noWait,
    });
    expect(result.ok).toBe(true);
    expect(result.lines?.[0]).toContain("tone played");
    expect(result.lines?.[1]).toContain("USB Audio Interface");
    expect(result.lines?.[1]).toContain("-6 dBFS");
    expect(sink.live()).toBe(0);
  });

  test("without the native sink it says why", async () => {
    const ffplay: AudioBackendInfo = {
      backend: "ffplay",
      streaming: true,
      command: ["ffplay"],
      detail: "ffplay",
    };
    const result = await runAudioCommand("out USB", {
      info: ffplay,
      env: {},
      path: join(scratch(), "audio.json"),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/native sink/);
    expect(deviceSupport(ffplay).kind).toBe("none");
    expect(audioMenuState(ffplay, {}, {}).unavailable).toMatch(/native sink/);
    // `audio` still answers.
    const shown = await runAudioCommand("", {
      info: ffplay,
      env: {},
      path: join(scratch(), "audio.json"),
    });
    expect(shown.ok).toBe(true);
  });

  test("sox can take a named output but not list or choose an input", async () => {
    const sox: AudioBackendInfo = {
      backend: "sox",
      streaming: true,
      command: ["play"],
      detail: "sox",
    };
    const path = join(scratch(), "audio.json");
    const out = await runAudioCommand("out hw:1", { info: sox, env: {}, path });
    expect(out.ok).toBe(true);
    expect(out.message).toContain("AUDIODEV");
    expect(readAudioChoice(path).output).toBe("hw:1");
    const input = await runAudioCommand("in hw:1", {
      info: sox,
      env: {},
      path,
    });
    expect(input.ok).toBe(false);
    expect(input.message).toMatch(/native sink/);
  });
});

function score(): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [{ id: "main", name: "main", instrument: "sine" }],
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

let locks = 0;
const lockPath = () =>
  join(tmpdir(), `dawg-devices-test-${process.pid}-${(locks += 1)}.lock`);

async function until(check: () => boolean, label: string): Promise<void> {
  for (let tries = 0; tries < 200; tries += 1) {
    if (check()) return;
    await Bun.sleep(5);
  }
  throw new Error(`timed out: ${label}`);
}

describe("engine device choice", () => {
  test("opens the chosen output and switches mid-song", async () => {
    const sink = fakeSink();
    const engine = new AudioEngine({
      info: native(sink),
      lockPath: lockPath(),
      device: "USB Audio Interface",
      timer: false,
      worker: false,
    });
    await engine.play(score(), 0);
    expect(sink.opened).toEqual(["USB Audio Interface"]);
    engine.setDevice("Built-in Output");
    await until(() => sink.opened.length === 2, "reopen");
    expect(sink.opened[1]).toBe("Built-in Output");
    expect(sink.live()).toBe(1);
    await engine.dispose();
    expect(sink.live()).toBe(0);
  });

  test("a missing output at start plays on the default, said once", async () => {
    const sink = fakeSink();
    const notices: AudioStatus[] = [];
    const engine = new AudioEngine({
      info: native(sink),
      lockPath: lockPath(),
      device: "Gone Speakers",
      timer: false,
      worker: false,
      onStatus: (status) => void notices.push(status),
    });
    await engine.play(score(), 0);
    expect(sink.opened).toEqual(["Built-in Output"]);
    expect(notices).toEqual([
      {
        state: "device",
        message:
          'audio output "Gone Speakers" is unavailable · playing on the system default',
      },
    ]);
    await engine.dispose();
  });

  test("unplugged mid-song: falls back to the default without crashing", async () => {
    const sink = fakeSink();
    const notices: AudioStatus[] = [];
    const engine = new AudioEngine({
      info: native(sink),
      lockPath: lockPath(),
      device: "USB Audio Interface",
      timer: false,
      worker: false,
      respawnMs: 1,
      onStatus: (status) => void notices.push(status),
    });
    await engine.play(score(), 0);
    sink.unplug("USB Audio Interface");
    for (let tries = 0; tries < 200 && sink.opened.length < 2; tries += 1) {
      engine.pump();
      await Bun.sleep(5);
    }
    expect(sink.opened).toEqual(["USB Audio Interface", "Built-in Output"]);
    expect(notices.filter((status) => status.state === "device")).toHaveLength(
      1,
    );
    expect(notices.some((status) => status.state === "stopped")).toBe(false);
    // Pumping on carries on without new notices.
    for (let tries = 0; tries < 5; tries += 1) {
      engine.pump();
      await Bun.sleep(2);
    }
    expect(notices.filter((status) => status.state === "device")).toHaveLength(
      1,
    );
    await engine.dispose();
  });

  test("follows the saved choice file", async () => {
    const sink = fakeSink();
    const path = join(scratch(), "audio.json");
    let ms = 0;
    const engine = new AudioEngine({
      info: native(sink),
      lockPath: lockPath(),
      choicePath: path,
      timer: false,
      worker: false,
      now: () => ms,
    });
    await engine.play(score(), 0);
    expect(sink.opened).toEqual(["Built-in Output"]);
    await Bun.sleep(5);
    writeAudioChoice("output", "USB Audio Interface", path);
    ms += 2000;
    engine.pump();
    await until(() => sink.opened.length === 2, "follow");
    expect(sink.opened[1]).toBe("USB Audio Interface");
    await engine.dispose();
  });
});
