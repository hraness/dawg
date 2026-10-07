import { describe, expect, test } from "bun:test";
import {
  estimateTempo,
  keyFromHistogram,
  monoSignal,
  onsetEnvelope,
  pitchClassHistogram,
  waveformPeaks,
} from "./dsp.ts";
import { clickTrack, syntheticWav } from "./media-fixtures.ts";
import { parseWav } from "./vendor/wav.ts";

describe("tempo", () => {
  test("finds the click-track tempo within a beat per minute", () => {
    for (const bpm of [96, 120, 140]) {
      const wav = parseWav(clickTrack(bpm, 12));
      const mono = monoSignal(wav);
      const { envelope, hopSeconds } = onsetEnvelope(mono, wav.sampleRate);
      const tempo = estimateTempo(envelope, hopSeconds);
      expect(tempo).toBeDefined();
      expect(Math.abs(tempo!.bpm - bpm)).toBeLessThanOrEqual(1);
      expect(tempo!.confidence).toBeGreaterThan(0.3);
      expect(tempo!.offsetSeconds).toBeGreaterThanOrEqual(0);
      expect(tempo!.offsetSeconds).toBeLessThan(60 / bpm);
    }
  });

  test("silence yields no tempo", () => {
    const wav = parseWav(syntheticWav(4, () => 0));
    const { envelope, hopSeconds } = onsetEnvelope(
      monoSignal(wav),
      wav.sampleRate,
    );
    const tempo = estimateTempo(envelope, hopSeconds);
    expect(tempo === undefined || tempo.confidence < 0.2).toBe(true);
  });
});

describe("key", () => {
  test("an A minor arpeggio reads as a minor", () => {
    const freqs = [220, 261.63, 329.63, 440]; // A C E A
    const wav = parseWav(
      syntheticWav(6, (t) => {
        const f = freqs[Math.floor(t * 2) % freqs.length]!;
        return 0.6 * Math.sin(2 * Math.PI * f * t);
      }),
    );
    const histogram = pitchClassHistogram(monoSignal(wav), wav.sampleRate);
    expect(histogram).toHaveLength(12);
    expect(histogram[9]).toBeGreaterThan(histogram[1]!);
    expect(keyFromHistogram(histogram)).toBe("a minor");
  });
});

describe("waveform peaks", () => {
  test("returns the requested bucket count in 0..1", () => {
    const wav = parseWav(
      syntheticWav(3, (t) => (t < 1.5 ? 0.9 : 0.1) * Math.sin(2000 * t)),
    );
    const peaks = waveformPeaks(wav, 240);
    expect(peaks).toHaveLength(240);
    expect(Math.max(...peaks)).toBeLessThanOrEqual(1);
    expect(peaks[10]).toBeGreaterThan(peaks[230]!);
  });
});
