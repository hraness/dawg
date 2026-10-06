import type { TrackScore } from "../../core/score.ts";

export type WavOptions = Readonly<{ sampleRate?: number; maxSeconds?: number }>;

/** Render the bounded score to a mono 16-bit PCM WAV for local playback. */
export function renderScoreWav(
  score: TrackScore,
  options: WavOptions = {},
): Uint8Array {
  const sampleRate = Math.max(
    8_000,
    Math.min(48_000, Math.floor(options.sampleRate ?? 22_050)),
  );
  const maxSeconds = Math.max(1, Math.min(60, options.maxSeconds ?? 30));
  const loopSeconds = Math.min(
    maxSeconds,
    (score.bars * score.beatsPerBar * 60) / score.tempoBpm + 0.35,
  );
  const samples = Math.max(1, Math.ceil(loopSeconds * sampleRate));
  const pcm = new Int16Array(samples);
  for (const note of score.notes) {
    const start = Math.max(
      0,
      Math.floor(
        (((note.startTick / score.ticksPerBeat) * 60) / score.tempoBpm) *
          sampleRate,
      ),
    );
    const length = Math.max(
      1,
      Math.floor(
        (((note.durationTicks / score.ticksPerBeat) * 60) / score.tempoBpm) *
          sampleRate,
      ),
    );
    const end = Math.min(samples, start + length);
    const frequency = 440 * 2 ** ((note.pitch - 69) / 12);
    for (let index = start; index < end; index += 1) {
      const elapsed = index - start;
      const remaining = end - index;
      const attack = Math.min(1, elapsed / Math.max(1, sampleRate * 0.012));
      const release = Math.min(1, remaining / Math.max(1, sampleRate * 0.09));
      const envelope =
        Math.min(attack, release) *
        Math.max(0, Math.min(1, note.velocity)) *
        0.28;
      const sample =
        Math.sin((2 * Math.PI * frequency * elapsed) / sampleRate) * envelope;
      pcm[index] = clamp16(pcm[index]! + sample * 32767);
    }
  }
  return encodeWav(pcm, sampleRate);
}

function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = pcm.byteLength;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(bytes, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataBytes, true);
  bytes.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44);
  return bytes;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1)
    target[offset + index] = value.charCodeAt(index);
}

function clamp16(value: number): number {
  return Math.max(-32_768, Math.min(32_767, Math.round(value)));
}
