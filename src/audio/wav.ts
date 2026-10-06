import {
  SCORE_LIMITS,
  isTrackAudible,
  type AutomationPoint,
  type Note,
  type Track,
  type TrackScore,
} from "../../core/score.ts";
import { drumVoiceForPitch, isDrumInstrument } from "../../core/drums.ts";

export type WavOptions = Readonly<{ sampleRate?: number; maxSeconds?: number }>;

/** Names understood by the deterministic local voice bank and the agent. */
export const AVAILABLE_INSTRUMENTS = Object.freeze([
  "sine",
  "piano",
  "pluck",
  "bass",
  "saw",
  "square",
  "triangle",
  "kit",
] as const);

/** Per-track effects understood by the renderer and the agent. */
export const AVAILABLE_EFFECTS = Object.freeze([
  "filter (low-pass: cutoff 20..20000 Hz, resonance 0..1, automatable)",
  "delay (send: beats 0.0625..4, feedback 0..0.9, mix 0..1)",
] as const);

/** Longest drum one-shot, in seconds; hits ring past their note length. */
const MAX_DRUM_SECONDS = 0.6;
/** Filter coefficients are refreshed at this sample interval when automated. */
const FILTER_CONTROL_SAMPLES = 32;

type RenderContext = Readonly<{
  score: TrackScore;
  sampleRate: number;
  samples: number;
  samplesPerTick: number;
}>;

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
  const context: RenderContext = {
    score,
    sampleRate,
    samples,
    samplesPerTick: (sampleRate * 60) / (score.tempoBpm * score.ticksPerBeat),
  };
  // Tracks render one at a time into a reused scratch buffer so per-track
  // effects stay bounded in memory regardless of the track count.
  const mix = new Float64Array(samples);
  const scratch = new Float64Array(samples);
  const tracks = new Map(score.tracks.map((track) => [track.id, track]));
  const groups = new Map<string, Note[]>();
  for (const note of score.notes) {
    const group = groups.get(note.trackId);
    if (group) group.push(note);
    else groups.set(note.trackId, [note]);
  }
  for (const [trackId, notes] of groups) {
    if (!isTrackAudible(score, trackId)) continue;
    const track = tracks.get(trackId);
    scratch.fill(0);
    const drums = isDrumInstrument(track?.instrument);
    for (const note of notes) {
      if (drums) renderDrumNote(scratch, note, track, context);
      else renderToneNote(scratch, note, track, context);
    }
    if (track) {
      applyLowPass(scratch, track, context);
      applyDelay(scratch, track, context);
    }
    for (let index = 0; index < samples; index += 1)
      mix[index]! += scratch[index]!;
  }
  const pcm = new Int16Array(samples);
  for (let index = 0; index < samples; index += 1)
    pcm[index] = clamp16(mix[index]! * 32767);
  return encodeWav(pcm, sampleRate);
}

/** Track volume, volume automation, and pan compensation at a score tick. */
function trackGainAt(track: Track | undefined, tick: number): number {
  const trackGain = Math.max(0, Math.min(1, track?.volume ?? 1));
  const automatedGain = interpolateAutomation(
    track?.volumeAutomation ?? [],
    tick,
    1,
  );
  const automatedPan = interpolateAutomation(
    track?.panAutomation ?? [],
    tick,
    track?.pan ?? 0,
  );
  // The current WAV contract is mono. Preserve the perceived level while
  // making pan automation audible through a deterministic centre-compensation
  // curve, ready for a future stereo writer without changing exports.
  const panGain = 1 - Math.abs(Math.max(-1, Math.min(1, automatedPan))) * 0.12;
  return trackGain * automatedGain * panGain;
}

function noteSpan(
  note: Note,
  context: RenderContext,
): { start: number; length: number } {
  const { score, sampleRate } = context;
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
  return { start, length };
}

function renderToneNote(
  target: Float64Array,
  note: Note,
  track: Track | undefined,
  context: RenderContext,
): void {
  const { sampleRate, samples, samplesPerTick } = context;
  const instrument = track?.instrument ?? "sine";
  const { start, length } = noteSpan(note, context);
  const end = Math.min(samples, start + length);
  const frequency = 440 * 2 ** ((note.pitch - 69) / 12);
  const velocity = Math.max(0, Math.min(1, note.velocity));
  for (let index = start; index < end; index += 1) {
    const elapsed = index - start;
    const remaining = end - index;
    const attack = Math.min(1, elapsed / Math.max(1, sampleRate * 0.012));
    const release = Math.min(1, remaining / Math.max(1, sampleRate * 0.09));
    const envelope =
      Math.min(attack, release) *
      velocity *
      0.28 *
      trackGainAt(track, note.startTick + elapsed / samplesPerTick);
    const phase = (frequency * elapsed) / sampleRate;
    target[index]! +=
      synthSample(instrument, phase, frequency, sampleRate) * envelope;
  }
}

/**
 * Synthesize a drum one-shot. Noise comes from a PRNG seeded by the note's
 * id and start tick, so a hit sounds identical on every render and in every
 * window regardless of note order.
 */
function renderDrumNote(
  target: Float64Array,
  note: Note,
  track: Track | undefined,
  context: RenderContext,
): void {
  const { sampleRate, samples, samplesPerTick } = context;
  const { start } = noteSpan(note, context);
  const end = Math.min(
    samples,
    start + Math.ceil(MAX_DRUM_SECONDS * sampleRate),
  );
  const voice = drumVoiceForPitch(note.pitch);
  const random = seededRandom(`${note.id}:${note.startTick}`);
  const velocity = Math.max(0, Math.min(1, note.velocity));
  let phase = 0;
  let previousNoise = 0;
  let band = 0;
  for (let index = start; index < end; index += 1) {
    const t = (index - start) / sampleRate;
    const noise = random() * 2 - 1;
    // A first difference is a cheap, stable high-pass for metallic hats.
    const bright = noise - previousNoise;
    previousNoise = noise;
    let sample = 0;
    if (voice === "kick") {
      const frequency = 45 + 105 * Math.exp(-t * 28);
      phase += frequency / sampleRate;
      sample =
        Math.sin(2 * Math.PI * phase) * Math.exp(-t * 7.5) +
        noise * 0.12 * Math.exp(-t * 300);
    } else if (voice === "tom") {
      const frequency = 105 + 95 * Math.exp(-t * 18);
      phase += frequency / sampleRate;
      sample = Math.sin(2 * Math.PI * phase) * Math.exp(-t * 9);
    } else if (voice === "snare") {
      phase += 185 / sampleRate;
      sample =
        Math.sin(2 * Math.PI * phase) * 0.45 * Math.exp(-t * 22) +
        noise * 0.7 * Math.exp(-t * 16);
    } else if (voice === "clap") {
      // Three quick bursts followed by a short diffuse tail.
      band += 0.35 * (bright - band);
      const burst = t < 0.03 ? (Math.floor(t / 0.01) % 2 === 0 ? 1 : 0.35) : 0;
      sample = band * (burst + 0.8 * Math.exp(-(t - 0.03) * 18) * +(t >= 0.03));
    } else if (voice === "hat") {
      sample = bright * 0.42 * Math.exp(-t * 60);
    } else if (voice === "openhat") {
      sample = bright * 0.36 * Math.exp(-t * 9);
    } else {
      sample =
        (Math.sin(2 * Math.PI * 1_700 * t) * 0.6 +
          Math.sin(2 * Math.PI * 820 * t) * 0.4) *
        Math.exp(-t * 90);
    }
    const attack = Math.min(
      1,
      (index - start) / Math.max(1, sampleRate * 0.001),
    );
    const release = Math.min(
      1,
      (end - index) / Math.max(1, sampleRate * 0.005),
    );
    target[index]! +=
      sample *
      attack *
      release *
      velocity *
      0.5 *
      trackGainAt(track, note.startTick + (index - start) / samplesPerTick);
  }
}

/**
 * RBJ biquad low-pass with a static or automated cutoff. Resonance 0..1 maps
 * to Q 0.707..8 and the cutoff is kept under 45% of the sample rate, so the
 * filter is stable for every value the score accepts.
 */
function applyLowPass(
  buffer: Float64Array,
  track: Track,
  context: RenderContext,
): void {
  const automation = track.filterAutomation ?? [];
  if (!track.filter && automation.length === 0) return;
  const { sampleRate, samplesPerTick } = context;
  const staticCutoff = track.filter?.cutoff ?? SCORE_LIMITS.maxFilterCutoff;
  const q = 0.707 + (track.filter?.resonance ?? 0) * 7.293;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let a1 = 0;
  let a2 = 0;
  let z1 = 0;
  let z2 = 0;
  const update = (cutoff: number) => {
    const frequency = Math.max(
      SCORE_LIMITS.minFilterCutoff,
      Math.min(cutoff, sampleRate * 0.45),
    );
    const omega = (2 * Math.PI * frequency) / sampleRate;
    const alpha = Math.sin(omega) / (2 * q);
    const cos = Math.cos(omega);
    const a0 = 1 + alpha;
    b0 = (1 - cos) / 2 / a0;
    b1 = (1 - cos) / a0;
    b2 = b0;
    a1 = (-2 * cos) / a0;
    a2 = (1 - alpha) / a0;
  };
  update(staticCutoff);
  for (let index = 0; index < buffer.length; index += 1) {
    if (automation.length > 0 && index % FILTER_CONTROL_SAMPLES === 0)
      update(
        interpolateAutomation(automation, index / samplesPerTick, staticCutoff),
      );
    const input = buffer[index]!;
    const output = b0 * input + z1;
    z1 = b1 * input - a1 * output + z2;
    z2 = b2 * input - a2 * output;
    buffer[index] = output;
  }
}

/** Tempo-synced feedback delay; echoes past the render window are dropped. */
function applyDelay(
  buffer: Float64Array,
  track: Track,
  context: RenderContext,
): void {
  const delay = track.delay;
  if (!delay || delay.mix <= 0) return;
  const { score, sampleRate } = context;
  const length = Math.max(
    1,
    Math.round(((delay.beats * 60) / score.tempoBpm) * sampleRate),
  );
  const line = new Float64Array(length);
  for (let index = 0; index < buffer.length; index += 1) {
    const slot = index % length;
    const wet = line[slot]!;
    const dry = buffer[index]!;
    line[slot] = dry + wet * delay.feedback;
    buffer[index] = dry + wet * delay.mix;
  }
}

/** FNV-1a seeded mulberry32: integer-only, so identical on every platform. */
function seededRandom(seed: string): () => number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let state = hash;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Resolve a piecewise-linear automation lane, holding the static value before its first point. */
function interpolateAutomation(
  points: readonly AutomationPoint[],
  tick: number,
  fallback: number,
): number {
  if (points.length === 0 || !Number.isFinite(tick)) return fallback;
  const first = points[0]!;
  if (tick < first.tick) return fallback;
  const last = points[points.length - 1]!;
  if (tick >= last.tick) return last.value;
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index]!;
    if (tick > right.tick) continue;
    const left = points[index - 1]!;
    const span = right.tick - left.tick;
    const ratio = span <= 0 ? 1 : (tick - left.tick) / span;
    return left.value + (right.value - left.value) * ratio;
  }
  return last.value;
}

/** A tiny deterministic instrument bank. Names come from the score's track metadata. */
function synthSample(
  instrument: string,
  phase: number,
  frequency: number,
  sampleRate: number,
): number {
  const name = instrument.trim().toLowerCase();
  const cycle = phase - Math.floor(phase);
  const sine = Math.sin(2 * Math.PI * phase);
  if (name.includes("square")) return cycle < 0.5 ? 1 : -1;
  if (name.includes("saw")) return 2 * cycle - 1;
  if (name.includes("triangle")) return 1 - 4 * Math.abs(cycle - 0.5);
  if (name.includes("bass")) {
    // A rounded fundamental plus a quiet octave gives bass tracks useful weight.
    return Math.tanh(
      0.9 * Math.sin(2 * Math.PI * phase) +
        0.25 * Math.sin(4 * Math.PI * phase),
    );
  }
  if (name.includes("piano") || name.includes("pluck")) {
    // Add stable harmonics; the envelope above supplies the note decay.
    const harmonic =
      Math.sin(4 * Math.PI * phase) * 0.28 +
      Math.sin(6 * Math.PI * phase) * 0.12;
    return Math.tanh(sine + harmonic);
  }
  // Unknown instruments deliberately fall back to the original sine voice.
  return sine;
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
