import {
  SCORE_LIMITS,
  isSamplerInstrument,
  isTrackAudible,
  type AutomationPoint,
  type Note,
  type Track,
  type TrackScore,
} from "../../core/score.ts";
import { drumVoiceForPitch, isDrumInstrument } from "../../core/drums.ts";

export type WavOptions = Readonly<{ sampleRate?: number; maxSeconds?: number }>;

export type RenderOptions = WavOptions &
  Readonly<{
    /**
     * Render exactly one loop and fold every tail (release, delay, reverb)
     * back onto the loop start, so the buffer repeats seamlessly. This is
     * what the streaming engine plays; exports keep the default one-shot.
     */
    loop?: boolean;
  }>;

/** Interleaved stereo 16-bit PCM plus its frame count. */
export type RenderedAudio = Readonly<{
  sampleRate: number;
  channels: 2;
  frames: number;
  pcm: Int16Array;
}>;

/** Output channel count for every render and export. */
export const RENDER_CHANNELS = 2 as const;
export const DEFAULT_SAMPLE_RATE = 22_050;

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
  "pan (equal-power stereo: -1 left .. 1 right, automatable)",
  "filter (low-pass: cutoff 20..20000 Hz and resonance 0..1, both automatable)",
  "delay (stereo send: beats 0.0625..4, feedback 0..0.9 and mix 0..1 automatable)",
  "reverb (stereo send: mix 0..1, size 0..1)",
] as const);

/** Longest drum one-shot, in seconds; hits ring past their note length. */
const MAX_DRUM_SECONDS = 0.6;
/** Effect parameters are refreshed at this sample interval when automated. */
const CONTROL_SAMPLES = 32;
/** One-shot renders keep this much ring-out after the last bar. */
const ONE_SHOT_TAIL_SECONDS = 0.35;
/** Loop renders fold at most this much tail back onto the loop start. */
const MAX_LOOP_TAIL_SECONDS = 8;

type RenderContext = Readonly<{
  score: TrackScore;
  sampleRate: number;
  samples: number;
  samplesPerTick: number;
}>;

/** Exact (fractional) loop length in frames at a sample rate. */
export function loopFrames(score: TrackScore, sampleRate: number): number {
  return (score.bars * score.beatsPerBar * 60 * sampleRate) / score.tempoBpm;
}

export function clampSampleRate(sampleRate?: number): number {
  return Math.max(
    8_000,
    Math.min(48_000, Math.floor(sampleRate ?? DEFAULT_SAMPLE_RATE)),
  );
}

/** Render the bounded score to a stereo 16-bit PCM WAV. */
export function renderScoreWav(
  score: TrackScore,
  options: WavOptions = {},
): Uint8Array {
  const audio = renderScorePcm(score, options);
  return encodeWav(audio.pcm, audio.sampleRate, RENDER_CHANNELS);
}

/**
 * Render the score to interleaved stereo PCM. Every step is plain float64
 * arithmetic in a fixed order with seeded noise, so identical scores render
 * byte-identical buffers on every run.
 */
export function renderScorePcm(
  score: TrackScore,
  options: RenderOptions = {},
): RenderedAudio {
  return new StemRenderer({ maxCacheBytes: 0 }).render(score, options);
}

/** Default byte budget for cached per-track stems. */
export const DEFAULT_STEM_CACHE_BYTES = 256 * 1024 * 1024;

type Stem = {
  key: string;
  left: Float64Array;
  right: Float64Array;
  bytes: number;
  used: number;
};

/**
 * The renderer behind `renderScorePcm`, with a per-track stem cache. Each
 * track's stereo stem (after its own effects) is keyed by everything that
 * shapes it: the track settings, its notes, tempo, tick resolution, sample
 * rate and buffer length. Edits re-render only the tracks whose key changed
 * and sum the cached rest in the original order, so the result is
 * byte-identical to a cold render; mute and solo only pick which stems are
 * summed. Scratch buffers are reused across renders.
 */
export class StemRenderer {
  private readonly maxCacheBytes: number;
  private readonly stems = new Map<string, Stem>();
  private cacheBytes = 0;
  private renders = 0;
  private scratch: {
    dry: Float64Array;
    left: Float64Array;
    right: Float64Array;
    mixL: Float64Array;
    mixR: Float64Array;
  } = {
    dry: new Float64Array(0),
    left: new Float64Array(0),
    right: new Float64Array(0),
    mixL: new Float64Array(0),
    mixR: new Float64Array(0),
  };

  public constructor(options: Readonly<{ maxCacheBytes?: number }> = {}) {
    this.maxCacheBytes = Math.max(
      0,
      options.maxCacheBytes ?? DEFAULT_STEM_CACHE_BYTES,
    );
  }

  /** Cached stems and their total size, for tests and diagnostics. */
  public get cache(): Readonly<{ stems: number; bytes: number }> {
    return { stems: this.stems.size, bytes: this.cacheBytes };
  }

  public render(score: TrackScore, options: RenderOptions = {}): RenderedAudio {
    const sampleRate = clampSampleRate(options.sampleRate);
    const maxSeconds = Math.max(1, Math.min(60, options.maxSeconds ?? 30));
    const loopSeconds = (score.bars * score.beatsPerBar * 60) / score.tempoBpm;
    const reverbTail = Math.max(
      0,
      ...score.tracks.map((track) =>
        track.reverb && track.reverb.mix > 0 ? 1 + 3 * track.reverb.size : 0,
      ),
    );
    let frames: number;
    let samples: number;
    if (options.loop) {
      frames = Math.max(
        1,
        Math.min(
          Math.round(loopFrames(score, sampleRate)),
          Math.ceil(maxSeconds * sampleRate),
        ),
      );
      const tailSeconds = Math.min(
        MAX_LOOP_TAIL_SECONDS,
        MAX_DRUM_SECONDS + 0.1 + reverbTail + delayTailSeconds(score),
      );
      samples = frames + Math.ceil(tailSeconds * sampleRate);
    } else {
      const seconds = Math.min(
        maxSeconds,
        loopSeconds + ONE_SHOT_TAIL_SECONDS + reverbTail,
      );
      frames = Math.max(1, Math.ceil(seconds * sampleRate));
      samples = frames;
    }
    const context: RenderContext = {
      score,
      sampleRate,
      samples,
      samplesPerTick: (sampleRate * 60) / (score.tempoBpm * score.ticksPerBeat),
    };
    this.renders += 1;
    const { dry, left, right, mixL, mixR } = this.scratchFor(samples);
    mixL.fill(0);
    mixR.fill(0);
    const tracks = new Map(score.tracks.map((track) => [track.id, track]));
    const groups = new Map<string, Note[]>();
    for (const note of score.notes) {
      const group = groups.get(note.trackId);
      if (group) group.push(note);
      else groups.set(note.trackId, [note]);
    }
    // Tracks render one at a time; the sum order (first note per track) is
    // part of the output, so cached and cold renders keep it.
    for (const [trackId, notes] of groups) {
      if (!isTrackAudible(score, trackId)) continue;
      const track = tracks.get(trackId);
      // Sampler tracks (score v2) are silent until the sample renderer lands.
      if (isSamplerInstrument(track?.instrument)) continue;
      const key = stemKey(track, notes, context);
      let stem = this.stems.get(trackId);
      if (stem?.key === key) stem.used = this.renders;
      else {
        const caching = this.maxCacheBytes > 0;
        const target = caching
          ? {
              left: new Float64Array(samples),
              right: new Float64Array(samples),
            }
          : { left, right };
        dry.fill(0);
        const drums = isDrumInstrument(track?.instrument);
        for (const note of notes) {
          if (drums) renderDrumNote(dry, note, track, context);
          else renderToneNote(dry, note, track, context);
        }
        if (track) applyLowPass(dry, track, context);
        applyPan(dry, target.left, target.right, track, context);
        if (track) {
          applyDelay(target.left, target.right, track, context);
          applyReverb(target.left, target.right, track, context);
        }
        stem = {
          key,
          left: target.left,
          right: target.right,
          bytes: target.left.byteLength + target.right.byteLength,
          used: this.renders,
        };
        if (caching) this.store(trackId, stem);
      }
      for (let index = 0; index < samples; index += 1) {
        mixL[index]! += stem.left[index]!;
        mixR[index]! += stem.right[index]!;
      }
    }
    // Stems of tracks that left the score are not worth keeping; muted and
    // unsoloed tracks keep theirs so toggling them back is free.
    for (const trackId of [...this.stems.keys()])
      if (!groups.has(trackId)) this.evict(trackId);
    if (samples > frames) {
      // Linear effects superpose, so folding the tail onto the start yields
      // the steady state of the loop playing forever.
      for (let index = frames; index < samples; index += 1) {
        mixL[index % frames]! += mixL[index]!;
        mixR[index % frames]! += mixR[index]!;
      }
    }
    const pcm = new Int16Array(frames * RENDER_CHANNELS);
    for (let index = 0; index < frames; index += 1) {
      pcm[index * 2] = clamp16(mixL[index]! * 32767);
      pcm[index * 2 + 1] = clamp16(mixR[index]! * 32767);
    }
    return Object.freeze({
      sampleRate,
      channels: RENDER_CHANNELS,
      frames,
      pcm,
    });
  }

  private scratchFor(samples: number) {
    if (this.scratch.dry.length < samples) {
      this.scratch = {
        dry: new Float64Array(samples),
        left: new Float64Array(samples),
        right: new Float64Array(samples),
        mixL: new Float64Array(samples),
        mixR: new Float64Array(samples),
      };
    }
    const view = (buffer: Float64Array) => buffer.subarray(0, samples);
    return {
      dry: view(this.scratch.dry),
      left: view(this.scratch.left),
      right: view(this.scratch.right),
      mixL: view(this.scratch.mixL),
      mixR: view(this.scratch.mixR),
    };
  }

  private store(trackId: string, stem: Stem): void {
    this.evict(trackId);
    // Make room by dropping the least recently used stems from other
    // renders; a score whose stems exceed the budget is simply not cached.
    while (
      this.cacheBytes + stem.bytes > this.maxCacheBytes &&
      this.stems.size > 0
    ) {
      let oldest: string | undefined;
      for (const [id, candidate] of this.stems)
        if (
          candidate.used !== this.renders &&
          (oldest === undefined ||
            candidate.used < this.stems.get(oldest)!.used)
        )
          oldest = id;
      if (oldest === undefined) break;
      this.evict(oldest);
    }
    if (this.cacheBytes + stem.bytes > this.maxCacheBytes) return;
    this.stems.set(trackId, stem);
    this.cacheBytes += stem.bytes;
  }

  private evict(trackId: string): void {
    const stem = this.stems.get(trackId);
    if (!stem) return;
    this.stems.delete(trackId);
    this.cacheBytes -= stem.bytes;
  }
}

/** Everything a track's stem depends on, except mute and solo. */
function stemKey(
  track: Track | undefined,
  notes: readonly Note[],
  context: RenderContext,
): string {
  let settings: Record<string, unknown> | null = null;
  if (track) {
    const { muted: _muted, solo: _solo, ...rest } = track;
    settings = rest;
  }
  return JSON.stringify([
    settings,
    notes,
    context.score.tempoBpm,
    context.score.ticksPerBeat,
    context.sampleRate,
    context.samples,
  ]);
}

/** Seconds until the slowest delay decays below -60 dB, bounded. */
function delayTailSeconds(score: TrackScore): number {
  let longest = 0;
  for (const track of score.tracks) {
    if (!track.delay) continue;
    const feedback = Math.max(
      track.delay.feedback,
      ...(track.delayFeedbackAutomation ?? []).map((point) => point.value),
    );
    const repeats =
      feedback <= 0.001
        ? 1
        : Math.min(64, Math.log(0.001) / Math.log(feedback));
    longest = Math.max(
      longest,
      ((track.delay.beats * 60) / score.tempoBpm) * (repeats + 1),
    );
  }
  return longest;
}

/** Track volume and volume automation at a score tick (pan is applied in stereo). */
function trackGainAt(track: Track | undefined, tick: number): number {
  const trackGain = Math.max(0, Math.min(1, track?.volume ?? 1));
  const automatedGain = interpolateAutomation(
    track?.volumeAutomation ?? [],
    tick,
    1,
  );
  return trackGain * automatedGain;
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
 * RBJ biquad low-pass with static or automated cutoff and resonance.
 * Resonance 0..1 maps to Q 0.707..8 and the cutoff is kept under 45% of the
 * sample rate, so the filter is stable for every value the score accepts.
 */
function applyLowPass(
  buffer: Float64Array,
  track: Track,
  context: RenderContext,
): void {
  const automation = track.filterAutomation ?? [];
  const resonanceLane = track.resonanceAutomation ?? [];
  if (!track.filter && automation.length === 0 && resonanceLane.length === 0)
    return;
  const { sampleRate, samplesPerTick } = context;
  const staticCutoff = track.filter?.cutoff ?? SCORE_LIMITS.maxFilterCutoff;
  const staticResonance = track.filter?.resonance ?? 0;
  const automated = automation.length > 0 || resonanceLane.length > 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let a1 = 0;
  let a2 = 0;
  let z1 = 0;
  let z2 = 0;
  const update = (cutoff: number, resonance: number) => {
    const q = 0.707 + Math.max(0, Math.min(1, resonance)) * 7.293;
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
  update(staticCutoff, staticResonance);
  for (let index = 0; index < buffer.length; index += 1) {
    if (automated && index % CONTROL_SAMPLES === 0) {
      const tick = index / samplesPerTick;
      update(
        interpolateAutomation(automation, tick, staticCutoff),
        interpolateAutomation(resonanceLane, tick, staticResonance),
      );
    }
    const input = buffer[index]!;
    const output = b0 * input + z1;
    z1 = b1 * input - a1 * output + z2;
    z2 = b2 * input - a2 * output;
    buffer[index] = output;
  }
}

/**
 * Equal-power pan of the mono track into the stereo pair: left = cos(θ),
 * right = sin(θ) with θ = (pan + 1)·π/4, so the summed power is constant
 * and a centred track sits 3 dB down in each channel.
 */
function applyPan(
  dry: Float64Array,
  left: Float64Array,
  right: Float64Array,
  track: Track | undefined,
  context: RenderContext,
): void {
  const lane = track?.panAutomation ?? [];
  const staticPan = track?.pan ?? 0;
  const gains = (pan: number): [number, number] => {
    const theta = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
    return [Math.cos(theta), Math.sin(theta)];
  };
  let [gainL, gainR] = gains(staticPan);
  for (let index = 0; index < dry.length; index += 1) {
    if (lane.length > 0 && index % CONTROL_SAMPLES === 0)
      [gainL, gainR] = gains(
        interpolateAutomation(lane, index / context.samplesPerTick, staticPan),
      );
    const sample = dry[index]!;
    left[index] = sample * gainL;
    right[index] = sample * gainR;
  }
}

/**
 * Tempo-synced stereo feedback delay. Each side echoes its own input and
 * feeds back into the opposite side, so repeats ping-pong across the field.
 * Feedback and mix follow their automation lanes when present.
 */
function applyDelay(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  context: RenderContext,
): void {
  const delay = track.delay;
  if (!delay) return;
  const feedbackLane = track.delayFeedbackAutomation ?? [];
  const mixLane = track.delayMixAutomation ?? [];
  if (delay.mix <= 0 && mixLane.length === 0) return;
  const { score, sampleRate, samplesPerTick } = context;
  const length = Math.max(
    1,
    Math.round(((delay.beats * 60) / score.tempoBpm) * sampleRate),
  );
  const lineL = new Float64Array(length);
  const lineR = new Float64Array(length);
  let feedback = delay.feedback;
  let mix = delay.mix;
  const automated = feedbackLane.length > 0 || mixLane.length > 0;
  for (let index = 0; index < left.length; index += 1) {
    if (automated && index % CONTROL_SAMPLES === 0) {
      const tick = index / samplesPerTick;
      feedback = interpolateAutomation(feedbackLane, tick, delay.feedback);
      mix = interpolateAutomation(mixLane, tick, delay.mix);
    }
    const slot = index % length;
    const wetL = lineL[slot]!;
    const wetR = lineR[slot]!;
    const dryL = left[index]!;
    const dryR = right[index]!;
    lineL[slot] = dryL + wetR * feedback;
    lineR[slot] = dryR + wetL * feedback;
    left[index] = dryL + wetL * mix;
    right[index] = dryR + wetR * mix;
  }
}

/** Freeverb comb and allpass tunings at 44.1 kHz; the right side is spread. */
const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617] as const;
const ALLPASS_TUNING = [556, 441, 341, 225] as const;
const STEREO_SPREAD = 23;
const REVERB_INPUT_GAIN = 0.015;
const REVERB_WET_SCALE = 3;

/**
 * Schroeder/Freeverb-style stereo reverb send: eight damped feedback combs
 * in parallel, then four series allpasses, per channel. Size sets the comb
 * feedback (0.7..0.98) and darkens the tail; the wet signal is added to the
 * dry stereo pair at `mix`.
 */
function applyReverb(
  left: Float64Array,
  right: Float64Array,
  track: Track,
  context: RenderContext,
): void {
  const reverb = track.reverb;
  if (!reverb || reverb.mix <= 0) return;
  const scale = context.sampleRate / 44_100;
  const feedback = 0.7 + 0.28 * reverb.size;
  const damp = 0.2 + 0.3 * reverb.size;
  const wet = reverb.mix * REVERB_WET_SCALE;
  const channel = (spread: number) => ({
    combs: COMB_TUNING.map((tuning) => ({
      buffer: new Float64Array(
        Math.max(1, Math.round((tuning + spread) * scale)),
      ),
      index: 0,
      store: 0,
    })),
    allpasses: ALLPASS_TUNING.map((tuning) => ({
      buffer: new Float64Array(
        Math.max(1, Math.round((tuning + spread) * scale)),
      ),
      index: 0,
    })),
  });
  const sides = [channel(0), channel(STEREO_SPREAD)] as const;
  const process = (side: (typeof sides)[number], input: number): number => {
    let output = 0;
    for (const comb of side.combs) {
      const delayed = comb.buffer[comb.index]!;
      comb.store = delayed * (1 - damp) + comb.store * damp;
      comb.buffer[comb.index] = input + comb.store * feedback;
      comb.index = comb.index + 1 === comb.buffer.length ? 0 : comb.index + 1;
      output += delayed;
    }
    for (const allpass of side.allpasses) {
      const delayed = allpass.buffer[allpass.index]!;
      allpass.buffer[allpass.index] = output + delayed * 0.5;
      output = delayed - output;
      allpass.index =
        allpass.index + 1 === allpass.buffer.length ? 0 : allpass.index + 1;
    }
    return output;
  };
  for (let index = 0; index < left.length; index += 1) {
    const input = (left[index]! + right[index]!) * REVERB_INPUT_GAIN;
    left[index]! += process(sides[0], input) * wet;
    right[index]! += process(sides[1], input) * wet;
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

export function encodeWav(
  pcm: Int16Array,
  sampleRate: number,
  channels = 1,
): Uint8Array {
  const dataBytes = pcm.byteLength;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(bytes, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2 * channels, true);
  view.setUint16(32, 2 * channels, true);
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
