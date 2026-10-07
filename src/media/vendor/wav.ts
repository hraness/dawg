// Vendored from soundfish `lib/audio-media/wav.ts` (same owner): RIFF/WAVE parser for PCM 16/24/32 and float32.

export type WavFailureCode = "unsupported_media" | "decode_failed" | "too_long";

export class WavFormatError extends Error {
  readonly code: WavFailureCode;

  constructor(code: WavFailureCode, message: string) {
    super(message);
    this.name = "WavFormatError";
    this.code = code;
  }
}

export type WavEncoding = "pcm16" | "pcm24" | "pcm32" | "float32";

export type ParsedWav = Readonly<{
  sampleRate: number;
  channels: number;
  /** Frame count: one frame carries one sample per channel. */
  sampleCount: number;
  encoding: WavEncoding;
  sample: (frame: number, channel: number) => number;
}>;

export type ParseWavOptions = Readonly<{
  /** Whole-buffer ceiling; larger inputs fail as `too_long`. Default 256 MiB. */
  maximumBytes?: number;
  /** Duration ceiling from the header; default two hours. */
  maximumDurationSeconds?: number;
  maximumChannels?: number;
}>;

export const WAV_DEFAULT_MAXIMUM_BYTES = 256 * 1024 * 1024;
export const WAV_DEFAULT_MAXIMUM_DURATION_SECONDS = 7_200;
export const WAV_DEFAULT_MAXIMUM_CHANNELS = 8;
const WAV_MINIMUM_SAMPLE_RATE = 8_000;
const WAV_MAXIMUM_SAMPLE_RATE = 192_000;

const FORMAT_PCM = 0x0001;
const FORMAT_IEEE_FLOAT = 0x0003;
const FORMAT_EXTENSIBLE = 0xfffe;
const MINIMUM_FMT_BYTES = 16;
const EXTENSIBLE_FMT_BYTES = 40;
const DATA_SIZE_UNKNOWN = 0xffffffff;
/** Trailing 14 bytes of KSDATAFORMAT_SUBTYPE_PCM / _IEEE_FLOAT after the 16-bit tag. */
const SUBFORMAT_GUID_SUFFIX = [
  0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b,
  0x71,
];

function ascii(bytes: Uint8Array, offset: number, count: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + count));
}

function clampUnit(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

type FormatChunk = Readonly<{
  audioFormat: number;
  channels: number;
  sampleRate: number;
  blockAlign: number;
  bits: number;
}>;

function readFormatChunk(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  size: number,
): FormatChunk {
  if (size < MINIMUM_FMT_BYTES)
    throw new WavFormatError("decode_failed", "WAV has a short format chunk.");
  let audioFormat = view.getUint16(start, true);
  if (audioFormat === FORMAT_EXTENSIBLE) {
    if (size < EXTENSIBLE_FMT_BYTES || view.getUint16(start + 16, true) < 22) {
      throw new WavFormatError(
        "unsupported_media",
        "WAV extensible format chunk is incomplete.",
      );
    }
    const subFormat = start + 24;
    const suffixMatches = SUBFORMAT_GUID_SUFFIX.every(
      (byte, index) => bytes[subFormat + 2 + index] === byte,
    );
    if (!suffixMatches)
      throw new WavFormatError(
        "unsupported_media",
        "WAV SubFormat is not PCM or IEEE float.",
      );
    audioFormat = view.getUint16(subFormat, true);
  }
  return {
    audioFormat,
    channels: view.getUint16(start + 2, true),
    sampleRate: view.getUint32(start + 4, true),
    blockAlign: view.getUint16(start + 12, true),
    bits: view.getUint16(start + 14, true),
  };
}

function encodingFor(format: FormatChunk): WavEncoding | undefined {
  if (format.audioFormat === FORMAT_PCM) {
    if (format.bits === 16) return "pcm16";
    if (format.bits === 24) return "pcm24";
    if (format.bits === 32) return "pcm32";
    return undefined;
  }
  if (format.audioFormat === FORMAT_IEEE_FLOAT && format.bits === 32)
    return "float32";
  return undefined;
}

export function parseWav(
  bytes: Uint8Array,
  options: ParseWavOptions = {},
): ParsedWav {
  const maximumBytes = options.maximumBytes ?? WAV_DEFAULT_MAXIMUM_BYTES;
  const maximumDurationSeconds =
    options.maximumDurationSeconds ?? WAV_DEFAULT_MAXIMUM_DURATION_SECONDS;
  const maximumChannels =
    options.maximumChannels ?? WAV_DEFAULT_MAXIMUM_CHANNELS;
  if (bytes.byteLength < 44 || bytes.byteLength > maximumBytes) {
    const megabytes = Math.floor(maximumBytes / (1024 * 1024));
    throw new WavFormatError(
      bytes.byteLength < 44 ? "decode_failed" : "too_long",
      `WAV is missing or exceeds the ${megabytes} MiB analysis limit.`,
    );
  }
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    throw new WavFormatError(
      "unsupported_media",
      "File is not a RIFF/WAVE file.",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let format: FormatChunk | undefined;
  let dataOffset = -1;
  let dataBytes = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "data" && size === DATA_SIZE_UNKNOWN) {
      throw new WavFormatError(
        "unsupported_media",
        "WAV data chunk has an unknown length.",
      );
    }
    const end = start + size;
    if (end > bytes.byteLength)
      throw new WavFormatError(
        "decode_failed",
        "WAV contains a truncated chunk.",
      );
    if (id === "fmt ") {
      format = readFormatChunk(bytes, view, start, size);
    } else if (id === "data" && dataOffset < 0) {
      dataOffset = start;
      dataBytes = size;
    }
    offset = end + (size & 1);
  }
  if (!format || dataOffset < 0)
    throw new WavFormatError(
      "decode_failed",
      "WAV is missing format or audio data.",
    );
  if (
    format.channels < 1 ||
    format.channels > maximumChannels ||
    format.sampleRate < WAV_MINIMUM_SAMPLE_RATE ||
    format.sampleRate > WAV_MAXIMUM_SAMPLE_RATE
  ) {
    throw new WavFormatError(
      "unsupported_media",
      "WAV channel count or sample rate is unsupported.",
    );
  }
  const encoding = encodingFor(format);
  if (!encoding)
    throw new WavFormatError(
      "unsupported_media",
      "WAV must be PCM16/24/32 or IEEE float32.",
    );
  const bytesPerSample = format.bits / 8;
  const blockAlign = format.blockAlign;
  if (
    blockAlign !== bytesPerSample * format.channels ||
    dataBytes % blockAlign !== 0
  ) {
    throw new WavFormatError(
      "decode_failed",
      "WAV has an inconsistent block alignment.",
    );
  }
  const sampleCount = dataBytes / blockAlign;
  if (sampleCount / format.sampleRate > maximumDurationSeconds) {
    throw new WavFormatError(
      "too_long",
      `WAV exceeds the ${maximumDurationSeconds} second analysis limit.`,
    );
  }
  const sample = (frame: number, channel: number): number => {
    const position = dataOffset + frame * blockAlign + channel * bytesPerSample;
    switch (encoding) {
      case "float32":
        return clampUnit(view.getFloat32(position, true));
      case "pcm16":
        return view.getInt16(position, true) / 32_768;
      case "pcm24": {
        let value =
          view.getUint8(position) |
          (view.getUint8(position + 1) << 8) |
          (view.getUint8(position + 2) << 16);
        if (value & 0x800000) value |= 0xff000000;
        return value / 8_388_608;
      }
      case "pcm32":
        return view.getInt32(position, true) / 2_147_483_648;
    }
  };
  return {
    sampleRate: format.sampleRate,
    channels: format.channels,
    sampleCount,
    encoding,
    sample,
  };
}
