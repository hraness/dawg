/**
 * Test-only builders for tiny synthetic sample files (WAV in every encoding
 * the decoder takes, and AIFF), so tests carry no binary blobs.
 */
export type FixtureEncoding = "pcm16" | "pcm24" | "pcm32" | "float32";

/** Interleaved samples in -1..1 → a WAV file. */
export function wavBytes(
  data: readonly number[] | Float32Array,
  options: Readonly<{
    sampleRate?: number;
    channels?: number;
    encoding?: FixtureEncoding;
  }> = {},
): Uint8Array {
  const sampleRate = options.sampleRate ?? 48_000;
  const channels = options.channels ?? 1;
  const encoding = options.encoding ?? "pcm16";
  const width = encoding === "pcm16" ? 2 : encoding === "pcm24" ? 3 : 4;
  const float = encoding === "float32";
  const bytes = new Uint8Array(44 + data.length * width);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1)
      bytes[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, float ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * width, true);
  view.setUint16(32, channels * width, true);
  view.setUint16(34, width * 8, true);
  text(36, "data");
  view.setUint32(40, data.length * width, true);
  for (let i = 0; i < data.length; i += 1) {
    const value = Math.max(-1, Math.min(1, data[i]!));
    const at = 44 + i * width;
    if (float) view.setFloat32(at, value, true);
    else if (width === 2) view.setInt16(at, Math.round(value * 32_767), true);
    else if (width === 3) {
      const raw = Math.round(value * 8_388_607) & 0xffffff;
      bytes[at] = raw & 0xff;
      bytes[at + 1] = (raw >> 8) & 0xff;
      bytes[at + 2] = (raw >> 16) & 0xff;
    } else view.setInt32(at, Math.round(value * 2_147_483_647), true);
  }
  return bytes;
}

/** Mono 16-bit big-endian AIFF. */
export function aiffBytes(
  data: readonly number[],
  sampleRate = 44_100,
): Uint8Array {
  const ssnd = 8 + data.length * 2;
  const bytes = new Uint8Array(12 + 26 + 8 + ssnd);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1)
      bytes[at + i] = value.charCodeAt(i);
  };
  text(0, "FORM");
  view.setUint32(4, bytes.length - 8);
  text(8, "AIFF");
  text(12, "COMM");
  view.setUint32(16, 18);
  view.setUint16(20, 1);
  view.setUint32(22, data.length);
  view.setUint16(26, 16);
  // 80-bit extended sample rate.
  const exponent = Math.floor(Math.log2(sampleRate));
  view.setUint16(28, 16_383 + exponent);
  const mantissa = sampleRate / 2 ** exponent;
  const hi = Math.floor(mantissa * 2 ** 31);
  view.setUint32(30, hi);
  view.setUint32(34, 0);
  text(38, "SSND");
  view.setUint32(42, ssnd);
  view.setUint32(46, 0);
  view.setUint32(50, 0);
  for (let i = 0; i < data.length; i += 1)
    view.setInt16(54 + i * 2, Math.round(data[i]! * 32_767));
  return bytes;
}

/** A constant-level "click": `frames` samples at `level`. */
export function dc(frames: number, level = 0.5): number[] {
  return Array.from({ length: frames }, () => level);
}

/** A ramp from 0 to 1 over `frames`, handy for checking read direction. */
export function ramp(frames: number): number[] {
  return Array.from({ length: frames }, (_, i) => i / Math.max(1, frames - 1));
}
