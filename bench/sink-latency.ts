/**
 * Keypress-to-audible latency, measured on a loopback.
 *
 *   bun bench/sink-latency.ts [backend=native|ffplay|sox] [trials=40] [device]
 *
 * The engine plays live clicks into a loopback output (default
 * "BlackHole 2ch") while the native sink captures that device's input. For
 * each trial the bench stamps `performance.now()` right before
 * `engine.noteOn` (the moment a keypress hands the engine its rendered
 * note), then finds the click's onset in the capture and maps that capture
 * frame back to host time with the sink's per-buffer timestamps. The
 * difference is what the user waits for: lead, pump, player and pipe
 * buffering, device buffer and output latency. Synth render time (0.4 to
 * 2.4 ms warm, see the assessment) is excluded.
 *
 * ffplay is pointed at the loopback with SDL_AUDIO_DEVICE_NAME, sox with
 * AUDIODEV. Trials whose click never shows up are counted as misses (the
 * player went to another device). Needs the native library
 * (DAWG_SINK_LIB or a prebuilt) for the capture side. Not part of
 * `bun run check`.
 */
import { AudioEngine, detectAudioBackend } from "../src/audio/engine.ts";
import {
  NativeCapture,
  clockOffsetMs,
  probeNativeSink,
} from "../src/audio/native.ts";

const backend = (process.argv[2] ?? "native") as "native" | "ffplay" | "sox";
const TRIALS = Number(process.argv[3] ?? 40);
const DEVICE = process.argv[4] ?? "BlackHole 2ch";
const RATE = 48_000;
/** The engine's render rate (dawg plays at 22.05 kHz by default). */
const ENGINE_RATE = Number(process.env.ENGINE_RATE ?? 22_050);
const THRESHOLD = Number(process.env.THRESHOLD ?? 0.25);
const GAP_MS = Number(process.env.GAP_MS ?? 600);

const probe = probeNativeSink();
if (!probe.ok) {
  console.error(`capture needs the native sink: ${probe.reason}`);
  process.exit(1);
}
const library = probe.library;
const offsetMs = clockOffsetMs(library);

const env: Record<string, string | undefined> = {
  ...process.env,
  DAWG_AUDIO_BACKEND: backend,
};
if (backend !== "native") {
  // Route the stdin players to the loopback: SDL (ffplay) and sox's
  // coreaudio driver both take a device name from the environment.
  process.env.SDL_AUDIO_DEVICE_NAME = DEVICE;
  process.env.AUDIODEV = DEVICE;
}
const info = detectAudioBackend({ env, sampleRate: ENGINE_RATE });
if (info.backend !== backend) {
  console.error(`backend ${backend} unavailable (${info.detail})`);
  process.exit(1);
}

const capture = NativeCapture.open(library, {
  rate: RATE,
  channels: 2,
  device: DEVICE,
  bufferFrames: 64,
});
const engine = new AudioEngine({
  info,
  sampleRate: ENGINE_RATE,
  worker: false,
  ...(backend === "native" ? { device: DEVICE } : {}),
});
await engine.monitor(true);
engine.setLeadMs(engine.playLeadMs);
await Bun.sleep(500);

// A 10 ms near-full-scale burst: an unmistakable onset.
const CLICK_S = Number(process.env.CLICK_MS ?? 10) / 1000;
const clickFrames = Math.round(ENGINE_RATE * CLICK_S);
const click = new Int16Array(clickFrames * 2).fill(30_000);

const pull = () => {
  capture.drain();
};
const pump = setInterval(pull, 2);

const presses: number[] = [];
for (let i = 0; i < TRIALS; i += 1) {
  const at = performance.now();
  engine.noteOn(1, { pcm: click, frames: clickFrames, releaseSeconds: 0.001 });
  presses.push(at);
  await Bun.sleep(GAP_MS);
  engine.noteOff(1);
  await Bun.sleep(20);
}
await Bun.sleep(200);
clearInterval(pump);
const stats = capture.stats();
const captured = capture.close();
await engine.dispose();

// Capture frame -> engine ms, anchored at the latest callback's edge.
const edgeMs = stats.edgeNs / 1e6 + offsetMs;
const frameMs = (frame: number) =>
  edgeMs + ((frame - stats.framesAtEdge) * 1000) / RATE;
const frames = captured.length / 2;
const results: number[] = [];
let misses = 0;
let search = 0;
for (const at of presses) {
  // First frame after the press whose level crosses half scale.
  let onset = -1;
  for (let f = search; f < frames; f += 1) {
    if (frameMs(f) < at) continue;
    if (frameMs(f) > at + GAP_MS) break;
    if (Math.abs(captured[f * 2]!) > THRESHOLD) {
      onset = f;
      break;
    }
  }
  if (onset < 0) {
    misses += 1;
    if (process.env.TRACE) console.error("miss");
    continue;
  }
  search = onset + Math.round(RATE * CLICK_S);
  results.push(frameMs(onset) - at);
  if (process.env.TRACE) console.error((frameMs(onset) - at).toFixed(1));
}
// Bursts anywhere in the capture: a press that is not heard at all (a
// dropped note) versus heard outside the window.
let bursts = 0;
for (let f = 0, quiet = 0; f < frames; f += 1) {
  if (Math.abs(captured[f * 2]!) > THRESHOLD) {
    if (quiet > RATE * 0.05) bursts += 1;
    quiet = 0;
  } else quiet += 1;
}
results.sort((a, b) => a - b);
const q = (p: number) =>
  results[Math.min(results.length - 1, Math.floor(p * results.length))] ?? NaN;
console.log(
  JSON.stringify({
    backend,
    device: DEVICE,
    engineRate: ENGINE_RATE,
    trials: TRIALS,
    heard: results.length,
    misses,
    bursts,
    p50: +q(0.5).toFixed(1),
    p90: +q(0.9).toFixed(1),
    min: +(results[0] ?? NaN).toFixed(1),
    max: +(results.at(-1) ?? NaN).toFixed(1),
    playLeadMs: engine.playLeadMs,
    inputLatencyMs: +(stats.latencyNs / 1e6).toFixed(2),
    captureXruns: stats.xruns,
  }),
);
