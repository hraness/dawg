/**
 * Original CC0 studio-v1 assets. Run `bun scripts/generate-studio-samples.ts`.
 * The sung hooks (stay-tonight, lights-out, all-i-need) come from
 * scripts/vox/phrases.py instead; their manifest entries are kept as they are.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createScore } from "../core/score.ts";
import { renderSingTrack } from "../src/audio/sing/engine.ts";
import { encodeWav } from "../src/audio/wav.ts";

const sampleRate = 24_000;
const destination = new URL("../assets/samples/studio/", import.meta.url);
await mkdir(destination, { recursive: true });
const digest: Record<
  string,
  { sha256: string; seconds: number; bytes: number }
> = {};

function vocal(
  words: readonly string[],
  seconds: number,
  voice: "alto" | "tenor",
) {
  const score = createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      {
        id: "voice",
        name: "Voice",
        instrument: "sing",
        sing: {
          preset: "robot",
          voice,
          bright: 0.7,
          breath: 0.025,
          attack: 0.008,
          release: 0.035,
          jitter: 0,
          shimmer: 0,
          vibmod: 0,
        },
      },
    ],
    notes: words.map((lyric, i) => ({
      id: `s${i}`,
      trackId: "voice",
      pitch: 60,
      velocity: 0.82,
      startTick: ((i * seconds) / words.length) * 960,
      durationTicks: Math.round((seconds / words.length - 0.045) * 960),
      lyric,
    })),
  });
  const samples = Math.round(seconds * sampleRate);
  const dry = new Float64Array(samples);
  renderSingTrack(dry, undefined, score.notes, score.tracks[0]!, {
    score,
    sampleRate,
    samples,
    samplesPerTick: sampleRate / 960,
    tempoBpm: 120,
    ticksPerBeat: 480,
  });
  return dry;
}

function sound(seconds: number, fn: (t: number, noise: number) => number) {
  let state = 0x6d2b79f5;
  return Float64Array.from(
    { length: Math.round(seconds * sampleRate) },
    (_, i) => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return fn(i / sampleRate, (state >>> 0) / 0x80000000 - 1);
    },
  );
}

async function save(id: string, pcm: Float64Array) {
  let peak = 0;
  for (const x of pcm) peak = Math.max(peak, Math.abs(x));
  if (peak < 0.001) throw new Error(`${id} is silent`);
  // -6 dB peak gives pitches and layered chops headroom. Every file fades
  // to zero at both ends; syllables have their own sing envelope.
  const quantized = Int16Array.from(pcm, (x, i) =>
    Math.round(
      (x / peak) *
        0.5 *
        Math.min(1, i / 96, (pcm.length - 1 - i) / 240) *
        32767,
    ),
  );
  const bytes = encodeWav(quantized, sampleRate, 1);
  await writeFile(new URL(`${id}.wav`, destination), bytes);
  digest[id] = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    seconds: pcm.length / sampleRate,
    bytes: bytes.length,
  };
}

await save("hold-on", vocal(["hold", "on", "hold", "on"], 2, "alto"));
await save("stay-up", vocal(["stay", "up", "stay", "up"], 2, "tenor"));
await save("vowel-ah", vocal(["ah"], 1, "alto"));
await save("vowel-oh", vocal(["oh"], 1, "tenor"));
await save(
  "glass-hit",
  sound(
    0.8,
    (t, n) =>
      (Math.sin(2 * Math.PI * 1046.502 * t) * Math.exp(-t * 7) +
        0.32 * Math.sin(2 * Math.PI * 1046.502 * 2.76 * t) * Math.exp(-t * 15) +
        0.09 * n * Math.exp(-t * 170)) *
      (1 - Math.exp(-t * 1800)),
  ),
);
await save(
  "metal-hit",
  sound(
    0.8,
    (t, n) =>
      (Math.sin(2 * Math.PI * 523.251 * t) * Math.exp(-t * 11) +
        0.5 * Math.sin(2 * Math.PI * 523.251 * 1.414 * t) * Math.exp(-t * 19) +
        0.33 * Math.sin(2 * Math.PI * 523.251 * 3.141 * t) * Math.exp(-t * 24) +
        n * 0.18 * Math.exp(-t * 65)) *
      (1 - Math.exp(-t * 2500)),
  ),
);
await save(
  "tape-hit",
  sound(
    0.45,
    (t, n) =>
      Math.tanh(
        (Math.sin(2 * Math.PI * (80 * t + 2 * (1 - Math.exp(-t * 40)))) +
          n * 0.4) *
          2,
      ) * Math.exp(-t * 18),
  ),
);
await save(
  "riser",
  sound(
    2,
    (t, n) =>
      (n * 0.72 + Math.sin(2 * Math.PI * (180 * t + 260 * t * t)) * 0.28) *
      (t / 2) ** 2,
  ),
);
const previous = JSON.parse(
  await readFile(new URL("manifest.json", destination), "utf8").catch(
    () => "{}",
  ),
) as { samples?: typeof digest };
await writeFile(
  new URL("manifest.json", destination),
  `${JSON.stringify({ version: 1, license: "CC0-1.0", sampleRate, channels: 1, samples: { ...previous.samples, ...digest } }, null, 2)}\n`,
);
console.log(JSON.stringify(digest, null, 2));
