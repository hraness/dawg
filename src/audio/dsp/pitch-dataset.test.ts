/**
 * pitch.md test 6: an optional real-voice report. When DAWG_PITCH_DATASET
 * points at a local PTDB-TUG or MIR-1K copy, prints raw pitch accuracy (RPA,
 * within 50 c), raw chroma accuracy (RCA), voicing recall and voicing false
 * alarm. It asserts nothing about the figures: the synthetic set in
 * pitch.test.ts stays the CI gate. Never runs in CI and nothing is committed.
 *
 * Layouts read:
 * - MIR-1K: `Wavfile/<name>.wav` (right channel is the voice) with
 *   `PitchLabel/<name>.pv` (MIDI per 20 ms frame, 0 unvoiced, first at 20 ms).
 * - PTDB-TUG: `.../MIC/.../mic_<id>.wav` with `.../REF/.../ref_<id>.f0`
 *   (Hz in the first column per 10 ms frame, first centred at 16 ms).
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { decodeWav } from "../samples.ts";
import { curveAt, trackPitch } from "./pitch.ts";

const ROOT = process.env.DAWG_PITCH_DATASET;
const LIMIT = Number(process.env.DAWG_PITCH_DATASET_LIMIT ?? 200);

type Reference = { hop: number; t0: number; hz: Float64Array };
type Item = { wav: string; ref: Reference; channel: "mono" | "right" };

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else out.push(path);
  }
  return out;
}

async function items(root: string): Promise<Item[]> {
  const files = await walk(root);
  const byName = new Map(files.map((f) => [basename(f), f]));
  const out: Item[] = [];
  for (const file of files.sort()) {
    if (out.length >= LIMIT) break;
    const name = basename(file);
    if (name.endsWith(".pv")) {
      const wav = byName.get(name.replace(/\.pv$/, ".wav"));
      if (!wav) continue;
      const midi = (await readFile(file, "utf8"))
        .split(/\s+/)
        .filter(Boolean)
        .map(Number);
      const hz = Float64Array.from(midi, (m) =>
        m > 0 ? 440 * 2 ** ((m - 69) / 12) : 0,
      );
      out.push({ wav, ref: { hop: 0.02, t0: 0.02, hz }, channel: "right" });
    } else if (/^ref_.*\.f0$/.test(name)) {
      const wav = byName.get(
        name.replace(/^ref_/, "mic_").replace(/\.f0$/, ".wav"),
      );
      if (!wav) continue;
      const hz = Float64Array.from(
        (await readFile(file, "utf8"))
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => Number(line.trim().split(/\s+/)[0])),
      );
      out.push({ wav, ref: { hop: 0.01, t0: 0.016, hz }, channel: "mono" });
    }
  }
  return out;
}

test.skipIf(!ROOT)(
  "real-voice report (DAWG_PITCH_DATASET)",
  async () => {
    const list = await items(ROOT!);
    expect(list.length).toBeGreaterThan(0);
    let voicedRef = 0;
    let unvoicedRef = 0;
    let hits = 0;
    let falseAlarms = 0;
    let pitchOk = 0;
    let chromaOk = 0;
    for (const item of list) {
      const pcm = decodeWav(new Uint8Array(await readFile(item.wav)));
      const x = new Float64Array(pcm.frames);
      for (let i = 0; i < pcm.frames; i++)
        x[i] =
          item.channel === "right" && pcm.channels > 1
            ? pcm.data[i * pcm.channels + 1]!
            : pcm.data[i * pcm.channels]!;
      const curve = trackPitch(x, pcm.sampleRate);
      const { ref } = item;
      for (let f = 0; f < ref.hz.length; f++) {
        const truth = ref.hz[f]!;
        const est = curveAt(curve, ref.t0 + f * ref.hop);
        if (truth > 0) {
          voicedRef += 1;
          if (est > 0) {
            hits += 1;
            const cents = 1200 * Math.log2(est / truth);
            if (Math.abs(cents) <= 50) pitchOk += 1;
            const chroma = (((cents % 1200) + 1800) % 1200) - 600;
            if (Math.abs(chroma) <= 50) chromaOk += 1;
          }
        } else {
          unvoicedRef += 1;
          if (est > 0) falseAlarms += 1;
        }
      }
    }
    const pct = (n: number, d: number) =>
      `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
    console.log(
      [
        `pitch dataset report · ${list.length} files · ${voicedRef} voiced frames`,
        `RPA ${pct(pitchOk, voicedRef)} · RCA ${pct(chromaOk, voicedRef)}`,
        `voicing recall ${pct(hits, voicedRef)} · false alarm ${pct(falseAlarms, unvoicedRef)}`,
        "compare with the published pYIN figures (Mauch and Dixon, 2014)",
      ].join("\n"),
    );
  },
  600_000,
);
