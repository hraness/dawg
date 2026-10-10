/**
 * The audio menu's one output and one input, saved per machine in
 * `<config>/audio.json` (never in the project: a song moves between
 * machines, its speakers do not). `DAWG_AUDIO_DEVICE` still overrides the
 * output. Choosing a device needs the native sink, which lists and opens
 * devices by name; sox can play on a named output (AUDIODEV) but cannot
 * list them; ffplay and afplay always use the system default.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "../auth/credentials.ts";
import type { AudioBackendInfo } from "./engine.ts";
import { NativeCapture, type SinkDevice, type SinkLibrary } from "./native.ts";

export type AudioChoice = Readonly<{
  /** Output device name; absent is the system default. */
  output?: string;
  /** Input device name; absent is the system default. */
  input?: string;
}>;

const MAX_NAME = 200;

export function audioChoicePath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return join(configDir(env), "audio.json");
}

function cleanName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name && name.length <= MAX_NAME && name.toLowerCase() !== "default"
    ? name
    : undefined;
}

/** The saved choice; a missing or malformed file is the defaults. */
export function readAudioChoice(path = audioChoicePath()): AudioChoice {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    const output = cleanName(record.output);
    const input = cleanName(record.input);
    return { ...(output ? { output } : {}), ...(input ? { input } : {}) };
  } catch {
    return {};
  }
}

/** Save one side of the choice (undefined is the system default). */
export function writeAudioChoice(
  side: "output" | "input",
  name: string | undefined,
  path = audioChoicePath(),
): AudioChoice {
  const current = readAudioChoice(path);
  const next: Record<string, string> = { ...current };
  const clean = cleanName(name);
  if (clean) next[side] = clean;
  else delete next[side];
  mkdirSync(join(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ version: 1, ...next }, null, 2)}\n`);
  renameSync(temp, path);
  return next;
}

/** The output the engine opens: DAWG_AUDIO_DEVICE, then the saved choice. */
export function resolveOutputDevice(
  env: Readonly<Record<string, string | undefined>> = process.env,
  choice: AudioChoice = readAudioChoice(audioChoicePath(env)),
): string | undefined {
  return cleanName(env.DAWG_AUDIO_DEVICE) ?? choice.output;
}

/** What the backend can do with a device choice. */
export type DeviceSupport =
  | Readonly<{ kind: "native"; library: SinkLibrary }>
  | Readonly<{ kind: "sox" }>
  | Readonly<{ kind: "none"; reason: string }>;

export function deviceSupport(info: AudioBackendInfo): DeviceSupport {
  if (info.backend === "native" && info.native)
    return { kind: "native", library: info.native };
  if (info.backend === "sox") return { kind: "sox" };
  const why = info.nativeUnavailable ?? info.detail;
  const player =
    info.backend === "none"
      ? "audio is off"
      : `${info.backend} plays on the system default`;
  return {
    kind: "none",
    reason: `device choice needs the native sink, which lists and opens devices by name · ${player} · native sink: ${why}`,
  };
}

/** Device names on the native sink; empty when enumeration fails. */
export function listDevices(
  library: SinkLibrary,
  input: boolean,
): SinkDevice[] {
  try {
    return library.devices(input);
  } catch {
    return [];
  }
}

export type AudioCommand =
  | Readonly<{ kind: "show" }>
  | Readonly<{
      kind: "set";
      side: "output" | "input";
      name: string | undefined;
    }>
  | Readonly<{ kind: "test" }>;

/**
 * `audio`, `audio out <name|default>`, `audio in <name|default>`,
 * `audio test`. Undefined when the words do not parse.
 */
export function parseAudioCommand(text: string): AudioCommand | undefined {
  const words = text.trim();
  if (!words) return { kind: "show" };
  if (/^test$/i.test(words)) return { kind: "test" };
  const set = words.match(/^(out|output|in|input)\s+(.+)$/i);
  if (!set) return undefined;
  const name = set[2]!.trim();
  if (name.length > MAX_NAME) return undefined;
  return {
    kind: "set",
    side: set[1]!.toLowerCase().startsWith("o") ? "output" : "input",
    name: name.toLowerCase() === "default" ? undefined : name,
  };
}

/** Match a typed name to a listed device: exact, then case-insensitive, then prefix. */
export function matchDevice(
  devices: readonly SinkDevice[],
  name: string,
): SinkDevice | undefined {
  const lower = name.toLowerCase();
  return (
    devices.find((device) => device.name === name) ??
    devices.find((device) => device.name.toLowerCase() === lower) ??
    (() => {
      const prefixed = devices.filter((device) =>
        device.name.toLowerCase().startsWith(lower),
      );
      return prefixed.length === 1 ? prefixed[0] : undefined;
    })()
  );
}

/** `Speakers` or `default (Speakers)`. */
export function deviceLabel(
  name: string | undefined,
  devices: readonly SinkDevice[],
): string {
  if (name) return name;
  const system = devices.find((device) => device.default);
  return system ? `default (${system.name})` : "default";
}

const BLIP_SECONDS = 0.12;

/** A short, soft sine blip (or a test tone): interleaved stereo. */
export function blipSamples(
  rate: number,
  seconds = BLIP_SECONDS,
  hz = 880,
  gain = 0.12,
): Float32Array {
  const frames = Math.round(rate * seconds);
  const out = new Float32Array(frames * 2);
  const ramp = Math.max(1, Math.round(rate * 0.01));
  for (let frame = 0; frame < frames; frame += 1) {
    const envelope = Math.min(1, frame / ramp, (frames - 1 - frame) / ramp);
    const value = Math.sin((2 * Math.PI * hz * frame) / rate) * gain * envelope;
    out[frame * 2] = value;
    out[frame * 2 + 1] = value;
  }
  return out;
}

/**
 * Play `samples` once on `device` through its own short-lived stream, so
 * the song's player is untouched. Resolves after the sound has played.
 */
export async function playOnce(
  library: SinkLibrary,
  device: string | undefined,
  samples: Float32Array,
  rate = 48_000,
  wait: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
): Promise<boolean> {
  const endpoint = library.openOutput({
    ...(device ? { device } : {}),
    rate,
    channels: 2,
    bufferFrames: 0,
    ringFrames: samples.length / 2 + rate,
  });
  if (!endpoint) return false;
  try {
    endpoint.write(samples);
    await wait(Math.ceil((samples.length / 2 / rate) * 1000) + 80);
    return true;
  } finally {
    endpoint.close();
  }
}

/** Peak and RMS of interleaved samples, in dBFS (-Infinity for silence). */
export function inputLevel(samples: Float32Array): {
  peakDb: number;
  rmsDb: number;
} {
  let peak = 0;
  let sum = 0;
  for (const sample of samples) {
    const value = Math.abs(sample);
    if (value > peak) peak = value;
    sum += sample * sample;
  }
  const rms = samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
  const db = (value: number) =>
    value > 0 ? 20 * Math.log10(value) : Number.NEGATIVE_INFINITY;
  return { peakDb: db(peak), rmsDb: db(rms) };
}

/** `▇▇▇▇▅▁▁▁▁▁ -18 dBFS`: -60…0 dBFS across ten cells. */
export function levelMeter(db: number, cells = 10): string {
  if (!Number.isFinite(db)) return `${"▁".repeat(cells)} silent`;
  const fill = Math.max(0, Math.min(1, (db + 60) / 60)) * cells;
  let bar = "";
  for (let cell = 0; cell < cells; cell += 1)
    bar += fill >= cell + 1 ? "▇" : fill > cell + 0.5 ? "▅" : "▁";
  return `${bar} ${Math.round(db)} dBFS`;
}

/** Capture `seconds` from the input and measure it. */
export async function measureInput(
  library: SinkLibrary,
  device: string | undefined,
  seconds = 1,
  rate = 48_000,
  wait: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
): Promise<{ peakDb: number; rmsDb: number }> {
  const capture = NativeCapture.open(library, {
    rate,
    channels: 1,
    ...(device ? { device } : {}),
  });
  let samples: Float32Array;
  try {
    await wait(seconds * 1000);
  } finally {
    samples = capture.close();
  }
  return inputLevel(samples);
}
