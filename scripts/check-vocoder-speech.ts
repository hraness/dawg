/**
 * Speech check for the vocoder (0.7, not a test): speaks one phrase with
 * an installed `say` (macOS) or `espeak-ng`, vocodes it onto a 110 Hz saw
 * with the classic, talkbox and robot presets, and prints the third-octave
 * band correlation and the consonants' level above 4 kHz with unvoiced 0
 * and with the preset's own setting. Engines are only detected (`which`), never
 * installed; with none it prints "no TTS engine found; skipped". Files go
 * to the OS temp dir only. `bun scripts/check-vocoder-speech.ts [file.wav]`
 * measures a WAV you give it (a sung phrase) instead of speaking one.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TrackVocoder } from "../core/vocoder.ts";
import {
  bandCorrelation,
  vocodeDirect,
} from "../src/audio/fixtures/vocoder-measure.ts";
import { decodeWav } from "../src/audio/samples.ts";
import { renderCarrierSpan } from "../src/audio/vocoder/carrier.ts";

const PHRASE = "She sells sixty silver whistles, so pass the fresh chips.";
const PRESETS = ["classic", "talkbox", "robot"] as const;

function which(command: string): boolean {
  return spawnSync("which", [command], { encoding: "utf8" }).status === 0;
}

/** Speaks PHRASE into a mono WAV in a temp dir; undefined with no engine. */
function speak(dir: string): { path: string; engine: string } | undefined {
  const path = join(dir, "phrase.wav");
  if (which("say")) {
    const run = spawnSync("say", [
      "-o",
      path,
      "--file-format=WAVE",
      "--data-format=LEI16@22050",
      PHRASE,
    ]);
    if (run.status === 0) return { path, engine: "say" };
  }
  if (which("espeak-ng")) {
    const run = spawnSync("espeak-ng", ["-w", path, PHRASE]);
    if (run.status === 0) return { path, engine: "espeak-ng" };
  }
  return undefined;
}

function mono(path: string): { x: Float64Array; sr: number } {
  const pcm = decodeWav(new Uint8Array(readFileSync(path)));
  const x = new Float64Array(pcm.frames);
  for (let i = 0; i < pcm.frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < pcm.channels; c += 1)
      sum += pcm.data[i * pcm.channels + c]!;
    x[i] = sum / pcm.channels;
  }
  return { x, sr: pcm.sampleRate };
}

/** `y` above 4 kHz (two 6 kHz RBJ band-passes, Q 2). */
function high(y: Float64Array, sr: number): Float64Array {
  let v = y;
  for (let pass = 0; pass < 2; pass += 1) {
    const out = new Float64Array(v.length);
    const w = (2 * Math.PI * Math.min(6000, sr * 0.4)) / sr;
    const al = Math.sin(w) / 4;
    const a0 = 1 + al;
    const [b0, b2, a1, a2] = [
      al / a0,
      -al / a0,
      (-2 * Math.cos(w)) / a0,
      (1 - al) / a0,
    ];
    let [x1, x2, y1, y2] = [0, 0, 0, 0];
    for (let i = 0; i < v.length; i += 1) {
      const s = v[i]!;
      const o = b0 * s + b2 * x2 - a1 * y1 - a2 * y2;
      [x2, x1, y2, y1] = [x1, s, y1, o];
      out[i] = o;
    }
    v = out;
  }
  return v;
}

/**
 * Consonant frames: 10 ms frames where the speech is above -45 dB of its
 * peak frame and a quarter of its energy sits above 4 kHz.
 */
function consonantFrames(x: Float64Array, sr: number): boolean[] {
  const hop = Math.round(sr / 100);
  const h = high(x, sr);
  const frames: { all: number; hi: number }[] = [];
  for (let at = 0; at + hop <= x.length; at += hop) {
    let all = 0;
    let hi = 0;
    for (let i = at; i < at + hop; i += 1) {
      all += x[i]! ** 2;
      hi += h[i]! ** 2;
    }
    frames.push({ all, hi });
  }
  const peak = Math.max(...frames.map((f) => f.all));
  return frames.map((f) => f.all > peak * 10 ** -4.5 && f.hi > 0.25 * f.all);
}

/** Level in dB above 4 kHz over the consonant frames. */
function consonantDb(y: Float64Array, sr: number, mask: boolean[]): number {
  const hop = Math.round(sr / 100);
  const h = high(y, sr);
  let e = 0;
  let n = 0;
  mask.forEach((on, frame) => {
    if (!on) return;
    for (let i = frame * hop; i < (frame + 1) * hop; i += 1) {
      e += h[i]! ** 2;
      n += 1;
    }
  });
  return 10 * Math.log10(e / Math.max(1, n) + 1e-30);
}

const dir = mkdtempSync(join(tmpdir(), "dawg-vocoder-speech-"));
try {
  const given = process.argv[2];
  const source = given
    ? { path: given, engine: "file" }
    : (speak(dir) ?? undefined);
  if (!source) {
    console.log("no TTS engine found; skipped");
    console.log("(macOS has `say`; on Linux install espeak-ng yourself)");
  } else {
    const { x, sr } = mono(source.path);
    const saw = new Float64Array(x.length);
    renderCarrierSpan(
      saw,
      undefined,
      { start: 0, length: x.length, pitches: [45], velocity: 1, seed: 3 },
      { carrier: "saw", spread: 0 },
      { sampleRate: sr, origin: 0, seed: 3 },
    );
    console.log(
      `${source.engine}: ${(x.length / sr).toFixed(2)} s at ${sr} Hz` +
        (given ? "" : ` "${PHRASE}"`),
    );
    const mask = consonantFrames(x, sr);
    console.log(
      `${mask.filter(Boolean).length} consonant frames of 10 ms; ` +
        `raw carrier correlation ${bandCorrelation(x, saw, sr).toFixed(3)}`,
    );
    for (const preset of PRESETS) {
      const run = (extra: TrackVocoder) =>
        vocodeDirect(x, [saw], sr, { preset, ...extra })[0]!;
      const out = run({});
      const off = run({ unvoiced: 0 });
      const plain = run({ enhance: false });
      const plainOff = run({ enhance: false, unvoiced: 0 });
      console.log(
        [
          preset.padEnd(8),
          `correlation ${bandCorrelation(x, out, sr).toFixed(3)}`,
          `consonants >4 kHz ${consonantDb(out, sr, mask).toFixed(1)} dB`,
          `(unvoiced 0: ${consonantDb(off, sr, mask).toFixed(1)} dB;`,
          `enhance off ${consonantDb(plain, sr, mask).toFixed(1)}`,
          `vs ${consonantDb(plainOff, sr, mask).toFixed(1)} dB)`,
        ].join("  "),
      );
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
