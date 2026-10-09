import {
  SCORE_LIMITS,
  isSamplerInstrument,
  isTrackAudible,
  isWavetableInstrument,
  wavetableOf,
  type AutomationPoint,
  type Note,
  type Track,
  type TrackScore,
} from "../../core/score.ts";
import { drumVoiceForPitch, isDrumInstrument } from "../../core/drums.ts";
import {
  performanceTimingFor,
  tunedTiming,
  performNotes,
  type PerformedNote,
} from "../../core/expression.ts";
import {
  planSamplerVoices,
  renderSamplerVoices,
  samplerTailSeconds,
} from "./sampler.ts";
import { EFFECT_NAMES, FX_PRESETS, effectSpec } from "../../core/fx.ts";
import { seededRandom } from "./random.ts";
import { engineFor, engineTailSeconds } from "./instruments.ts";
import {
  isStereoVoice,
  renderSynthNote,
  synthTailSeconds,
  usesSynthVoice,
  type VoiceContext,
} from "./synth/voice.ts";
import { legacyWave } from "./synth/oscillators.ts";
import {
  EMPTY_SAMPLE_BANK,
  sampleKey,
  type DecodedSample,
  type SampleBank,
} from "./samples.ts";
import { synthKit } from "../../core/kits.ts";
import { kitDrumSample, kitTailSeconds, newKitVoiceState } from "./kits.ts";
import {
  addReverbWet,
  applyMonoChain,
  applyStereoChain,
  delayTailFor,
  interpolateAutomation,
  reverbActive,
  reverbImpulse,
  reverbTailFor,
  reverbWet,
  type ReverbWet,
} from "./effects/chain.ts";
import {
  createOrbitBus,
  renderOrbitBus,
  sendToBus,
  sharedOrbitOf,
  type OrbitBus,
} from "./effects/bus.ts";
import { tableFor, wavetableOscillator } from "./wavetable.ts";
import { noteHz, resolveTuning, type TuningTable } from "../../core/tuning.ts";
import {
  duckGains,
  duckSettings,
  orbitOf,
  type Ducker,
} from "./effects/duck.ts";
import {
  loopSecondsOf,
  performedNotes,
  slowestBpmOf,
} from "../../core/tempo.ts";
import { sampleWarpFor, warpedSpan, type SampleWarp } from "./warp.ts";
import { applyMaster, type MasterReport } from "./master.ts";
import type { SongMaster } from "../../core/master.ts";

export type WavOptions = Readonly<{ sampleRate?: number; maxSeconds?: number }>;

export type RenderOptions = WavOptions &
  Readonly<{
    /**
     * Render exactly one loop and fold every tail (release, delay, reverb)
     * back onto the loop start, so the buffer repeats seamlessly. This is
     * what the streaming engine plays; exports keep the default one-shot.
     */
    loop?: boolean;
    /**
     * Decoded sampler voices (`SampleLibrary.load`). Without it sampler
     * tracks render silent; scores without samplers are unaffected.
     */
    samples?: SampleBank;
    /**
     * Ticks added to each note's start when seeding its noise. An arranged
     * render window passes its origin so seeded voices sound as they do in
     * a single pass of the whole song. Zero (the default) changes nothing.
     */
    seedTick?: number;
  }>;

/** Interleaved stereo 16-bit PCM plus its frame count. */
export type RenderedAudio = Readonly<{
  sampleRate: number;
  channels: 2;
  frames: number;
  pcm: Int16Array;
  /** Loudness the song master reached; absent without a master. */
  master?: MasterReport;
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
  "wavetable",
  "kit",
  // Synth-voice sounds (core/synth.ts), Strudel names; `synth` shapes them.
  "sawtooth",
  "supersaw",
  "pulse",
  "user",
  "white",
  "pink",
  "brown",
  "crackle",
  // ZzFX sounds (src/audio/synth/zzfx.ts).
  "z_sine",
  "z_triangle",
  "z_sawtooth",
  "z_square",
  "z_tan",
  "z_noise",
  // 0.6 instruments (src/audio/instruments.ts), one line per lane.
  "granular",
] as const);

/** Per-track effects understood by the renderer and the agent, in chain
 * order, with each effect's simple parameters (`fx` takes the rest). */
export const AVAILABLE_EFFECTS: readonly string[] = Object.freeze([
  "pan(-1..1 equal-power)",
  ...EFFECT_NAMES.map((name) => {
    const spec = effectSpec(name);
    return `${name}(${spec.simple.join(" ")})`;
  }),
]);

/** `fx <effect> preset <name>` names, for the agent brief. */
export const AVAILABLE_FX_PRESETS: Readonly<Record<string, string>> =
  Object.freeze(
    Object.fromEntries(
      EFFECT_NAMES.filter((name) => FX_PRESETS[name]).map((name) => [
        name,
        Object.keys(FX_PRESETS[name]!).join(" "),
      ]),
    ),
  );

/** Longest drum one-shot, in seconds; hits ring past their note length. */
const MAX_DRUM_SECONDS = 0.6;
/** Effect parameters are refreshed at this sample interval when automated. */
const CONTROL_SAMPLES = 32;
/** One-shot renders keep this much ring-out after the last bar. */
const ONE_SHOT_TAIL_SECONDS = 0.35;

function oneShotSeconds(
  loopSeconds: number,
  samplerTail: number,
  reverbTail: number,
): number {
  return (
    loopSeconds + Math.max(ONE_SHOT_TAIL_SECONDS, samplerTail) + reverbTail
  );
}
/** Loop renders fold at most this much tail back onto the loop start. */
const MAX_LOOP_TAIL_SECONDS = 8;

export type RenderContext = Readonly<{
  score: TrackScore;
  sampleRate: number;
  samples: number;
  samplesPerTick: number;
  tempoBpm: number;
  irs?: ReadonlyMap<string, DecodedSample>;
  /** Tempo map in samples (core/tempo.ts); absent: constant tempo. */
  warp?: SampleWarp;
  seedTick?: number;
}>;

/** Exact (fractional) loop length in frames at a sample rate. */
export function loopFrames(score: TrackScore, sampleRate: number): number {
  if (score.time) return loopSecondsOf(score) * sampleRate;
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
  options: WavOptions & Pick<RenderOptions, "samples"> = {},
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
  /** Stem, pre-reverb pair and tail (counted in the cache budget). */
  bytes: number;
  used: number;
  /** For a track with a reverb: its stem before the reverb, and the tail. */
  room?: Readonly<{
    /** `stemKey` of the track with its reverb mix and mix lane left out. */
    key: string;
    pre: Readonly<{ left: Float64Array; right: Float64Array }>;
    wet: ReverbWet;
  }>;
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
  /** Shared orbit bus outputs by orbit, keyed by their members' stems. */
  private readonly buses = new Map<
    number,
    { key: string; left: Float64Array; right: Float64Array }
  >();
  private cacheBytes = 0;
  private renders = 0;
  private scratch: {
    dry: Float64Array;
    dryR: Float64Array;
    left: Float64Array;
    right: Float64Array;
    mixL: Float64Array;
    mixR: Float64Array;
  } = {
    dry: new Float64Array(0),
    dryR: new Float64Array(0),
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

  /**
   * Seconds a one-shot render of `score` needs (song plus tail) before the
   * renderer's cap, so callers can tell when a single pass would cut it.
   */
  public oneShotSeconds(
    score: TrackScore,
    options: RenderOptions = {},
  ): number {
    const sampleRate = clampSampleRate(options.sampleRate);
    const bank = options.samples ?? EMPTY_SAMPLE_BANK;
    const reverbTail = Math.max(
      0,
      ...score.tracks.map((track) =>
        reverbTailFor(track, sampleRate, bank.irs),
      ),
    );
    const samplerTail = Math.min(
      MAX_LOOP_TAIL_SECONDS,
      Math.max(
        samplerTailSeconds(score, bank, sampleRate),
        ...score.tracks.map(synthTailSeconds),
        // Zero without a registered 0.6 instrument engine.
        ...score.tracks.map(engineTailSeconds),
      ),
    );
    return oneShotSeconds(loopSecondsOf(score), samplerTail, reverbTail);
  }

  public render(score: TrackScore, options: RenderOptions = {}): RenderedAudio {
    const sampleRate = clampSampleRate(options.sampleRate);
    const maxSeconds = Math.max(1, Math.min(60, options.maxSeconds ?? 30));
    const loopSeconds = loopSecondsOf(score);
    const bank = options.samples ?? EMPTY_SAMPLE_BANK;
    const warp = sampleWarpFor(score, sampleRate);
    const reverbTail = Math.max(
      0,
      ...score.tracks.map((track) =>
        reverbTailFor(track, sampleRate, bank.irs),
      ),
    );
    // Zero without sampler voices, so synth-only renders are unchanged.
    // Zero without synth-voice tracks, so legacy renders are unchanged.
    const samplerTail = Math.min(
      MAX_LOOP_TAIL_SECONDS,
      Math.max(
        samplerTailSeconds(score, bank, sampleRate),
        ...score.tracks.map(synthTailSeconds),
        // Zero without a registered 0.6 instrument engine.
        ...score.tracks.map(engineTailSeconds),
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
        Math.max(MAX_DRUM_SECONDS, samplerTail, kitTailSeconds(score)) +
          0.1 +
          reverbTail +
          Math.max(
            0,
            // The slowest tempo in the map gives the longest echoes.
            ...score.tracks.map((track) =>
              delayTailFor(track, slowestBpmOf(score)),
            ),
          ),
      );
      samples = frames + Math.ceil(tailSeconds * sampleRate);
    } else {
      const seconds = Math.min(
        maxSeconds,
        oneShotSeconds(loopSeconds, samplerTail, reverbTail),
      );
      frames = Math.max(1, Math.ceil(seconds * sampleRate));
      samples = frames;
    }
    const context: RenderContext = {
      score,
      sampleRate,
      samples,
      samplesPerTick: (sampleRate * 60) / (score.tempoBpm * score.ticksPerBeat),
      tempoBpm: score.tempoBpm,
      ...(bank.irs ? { irs: bank.irs } : {}),
      ...(warp ? { warp } : {}),
      ...(options.seedTick ? { seedTick: options.seedTick } : {}),
    };
    this.renders += 1;
    const { dry, dryR, left, right, mixL, mixR } = this.scratchFor(samples);
    mixL.fill(0);
    mixR.fill(0);
    const tracks = new Map(score.tracks.map((track) => [track.id, track]));
    const groups = new Map<string, Note[]>();
    // Track time (rate, phase, cycle) places notes on the song timeline.
    for (const note of performedNotes(score)) {
      const group = groups.get(note.trackId);
      if (group) group.push(note);
      else groups.set(note.trackId, [note]);
    }
    // Note expression and track performance (core/expression.ts): the
    // notes as played. A track with neither gets its notes back unchanged.
    const timing = performanceTimingFor(score);
    const performed = new Map<string, readonly PerformedNote[]>();
    for (const [trackId, notes] of groups) {
      const track = tracks.get(trackId);
      performed.set(
        trackId,
        performNotes(track, notes, tunedTiming(timing, score, track)),
      );
    }
    // Orbit ducking is a gain on finished stems (src/audio/effects/duck.ts).
    const duckers: Ducker[] = [];
    for (const [trackId] of groups) {
      const settings = duckSettings(tracks.get(trackId));
      if (settings && isTrackAudible(score, trackId))
        duckers.push({
          trackId,
          ...settings,
          onsets: performed
            .get(trackId)!
            .map((note) => noteSpan(note, context).start),
        });
    }
    const ducked = duckGains(
      [...groups.keys()].map((id) => ({ id, orbit: orbitOf(tracks.get(id)) })),
      duckers,
      samples,
      sampleRate,
      options.loop ? frames : undefined,
    );
    // Shared orbit buses (src/audio/effects/bus.ts), created on first send.
    const buses = new Map<number, OrbitBus>();
    // Tracks render one at a time; the sum order (first note per track) is
    // part of the output, so cached and cold renders keep it.
    for (const [trackId, notes] of groups) {
      if (!isTrackAudible(score, trackId)) continue;
      const track = tracks.get(trackId);
      // Stems key on the written notes (with the track's performance
      // settings); the voices render the performed ones.
      const played = performed.get(trackId)!;
      const busOrbit = sharedOrbitOf(track);
      const sampler = isSamplerInstrument(track?.instrument);
      // A 0.6 instrument engine (src/audio/instruments.ts), if registered
      // and the track carries its field; undefined keeps today's voices.
      const engine = engineFor(track);
      // The song key always joins an engine's stem key: engines may tune to
      // it (sympathetic strings) without a song tuning.
      const engineDigests =
        engine && track
          ? [
              ...(engine.assetDigests?.(track, bank) ?? []),
              `key:${score.key ?? ""}`,
            ]
          : undefined;
      // Wavetable hook: the oscillator factory for a wavetable track (its
      // table id joins the stem key), undefined for every other instrument.
      const wavetable = track ? wavetableHook(track, bank, context) : undefined;
      // The merged song and track tuning; undefined keeps 12-TET untouched.
      const tuning = resolveTuning(score.tuning, track?.tuning, score.key);
      const key = stemKey(
        track,
        notes,
        context,
        sampler ? bank : undefined,
        wavetable?.id,
        track ? reverbImpulse(track, sampleRate, bank.irs)?.id : undefined,
        engineDigests,
      );
      let stem = this.stems.get(trackId);
      const caching = this.maxCacheBytes > 0;
      // A cached track with a reverb also keeps its pre-reverb pair and the
      // tail before its mix gain, keyed without the mix: a mix-only edit
      // re-adds the tail instead of re-running the voices and the room.
      const room =
        caching && track && busOrbit === undefined && reverbActive(track)
          ? stemKey(
              roomTrack(track),
              notes,
              context,
              sampler ? bank : undefined,
              wavetable?.id,
              reverbImpulse(track, sampleRate, bank.irs)?.id,
              engineDigests,
            )
          : undefined;
      if (stem?.key === key) stem.used = this.renders;
      else if (track && room !== undefined && stem?.room?.key === room) {
        const { pre, wet } = stem.room;
        const target = {
          left: Float64Array.from(pre.left),
          right: Float64Array.from(pre.right),
        };
        addReverbWet(target.left, target.right, wet, track, context);
        stem = {
          ...stem,
          key,
          left: target.left,
          right: target.right,
          used: this.renders,
        };
        this.store(trackId, stem);
      } else {
        const target = caching
          ? {
              left: new Float64Array(samples),
              right: new Float64Array(samples),
            }
          : { left, right };
        dry.fill(0);
        const synthVoice = !engine && !sampler && usesSynthVoice(track);
        const stereo = engine
          ? engine.stereo(track!)
          : synthVoice && isStereoVoice(track);
        if (stereo) dryR.fill(0);
        if (engine && track) {
          engine.render(
            dry,
            stereo ? dryR : undefined,
            played,
            track,
            {
              ...context,
              ticksPerBeat: score.ticksPerBeat,
              ...(tuning ? { tuning } : {}),
            },
            bank,
          );
        } else if (sampler) {
          if (track) renderSamplerNotes(dry, played, track, context, bank);
        } else if (synthVoice && track) {
          const gainAt = (tick: number) => trackGainAt(track, tick);
          const voice = {
            ...context,
            ticksPerBeat: score.ticksPerBeat,
            ...(wavetable ? { oscillatorFor: wavetable.oscillatorFor } : {}),
            ...(tuning ? { tuning } : {}),
          };
          const warp = context.warp;
          for (const note of played) {
            const { start, length } = noteSpan(note, context);
            // The voice asks for `startTick + elapsed / samplesPerTick`;
            // through a tempo map that sample's tick comes from the map.
            const noteGainAt = warp
              ? (tick: number) =>
                  gainAt(
                    warp.tick(
                      start + (tick - note.startTick) * context.samplesPerTick,
                    ),
                  )
              : gainAt;
            renderSynthNote(
              dry,
              stereo ? dryR : undefined,
              note,
              track,
              start,
              length,
              voice,
              noteGainAt,
            );
          }
        } else {
          const drums = isDrumInstrument(track?.instrument);
          for (const note of played) {
            if (drums) renderDrumNote(dry, note, track, context);
            else renderToneNote(dry, note, track, context, tuning);
          }
        }
        if (track) applyMonoChain(dry, track, context);
        if (stereo && track) applyMonoChain(dryR, track, context);
        applyPan(
          dry,
          target.left,
          target.right,
          track,
          context,
          stereo ? dryR : undefined,
        );
        let saved: Stem["room"];
        if (track && room !== undefined) {
          // Same chain, the reverb split in two (see `applyReverb`).
          applyStereoChain(
            target.left,
            target.right,
            track,
            context,
            true,
            false,
          );
          const pre = {
            left: Float64Array.from(target.left),
            right: Float64Array.from(target.right),
          };
          const wet = reverbWet(target.left, target.right, track, context);
          if (wet) {
            addReverbWet(target.left, target.right, wet, track, context);
            saved = { key: room, pre, wet };
          }
        } else if (track)
          applyStereoChain(
            target.left,
            target.right,
            track,
            context,
            busOrbit === undefined,
          );
        stem = {
          key,
          left: target.left,
          right: target.right,
          bytes: target.left.byteLength * (saved ? 6 : 2),
          used: this.renders,
          ...(saved ? { room: saved } : {}),
        };
        if (caching) this.store(trackId, stem);
      }
      if (track && busOrbit !== undefined) {
        let bus = buses.get(busOrbit);
        if (!bus)
          buses.set(busOrbit, (bus = createOrbitBus(busOrbit, samples)));
        sendToBus(bus, track, stem.left, stem.right, context, key);
      }
      addStem(mixL, mixR, stem.left, stem.right, samples, ducked.get(trackId));
    }
    // Bus returns join after every stem, in orbit order; the orbit's ducking
    // applies to them as to its tracks.
    const busGains = duckGains(
      [...buses.keys()].map((orbit) => ({ id: `bus:${orbit}`, orbit })),
      duckers,
      samples,
      sampleRate,
      options.loop ? frames : undefined,
    );
    for (const orbit of [...buses.keys()].sort((a, b) => a - b)) {
      const bus = buses.get(orbit)!;
      const key = JSON.stringify(bus.keys);
      let wet = this.buses.get(orbit);
      if (wet?.key !== key) {
        wet = { key, ...renderOrbitBus(bus, context) };
        if (this.maxCacheBytes > 0) this.buses.set(orbit, wet);
      }
      // (x * 1 === x, so an unducked bus adds its plain samples.)
      addStem(
        mixL,
        mixR,
        wet.left,
        wet.right,
        samples,
        busGains.get(`bus:${orbit}`),
      );
    }
    for (const orbit of [...this.buses.keys()])
      if (!buses.has(orbit)) this.buses.delete(orbit);
    // Stems of tracks that left the score are not worth keeping; muted and
    // unsoloed tracks keep theirs so toggling them back is free.
    for (const trackId of [...this.stems.keys()])
      if (!groups.has(trackId)) this.evict(trackId);
    // Linear effects superpose, so folding the tail onto the start yields
    // the steady state of the loop playing forever.
    if (samples > frames) foldTail(mixL, mixR, frames, samples);
    // The song master (src/audio/master.ts); none leaves the mix untouched.
    const mastered = applyMaster(
      mixL,
      mixR,
      frames,
      sampleRate,
      score.master,
      options.loop === true,
    );
    // A master's output is a finished level, so its reduction to 16 bits is
    // TPDF-dithered (seeded: renders stay byte-identical run to run).
    const pcm = mastered
      ? toPcm(mastered.left, mastered.right, frames, true)
      : toPcm(mixL, mixR, frames);
    return Object.freeze({
      sampleRate,
      channels: RENDER_CHANNELS,
      frames,
      pcm,
      ...(mastered ? { master: mastered.report } : {}),
    });
  }

  private scratchFor(samples: number) {
    if (this.scratch.dry.length < samples) {
      this.scratch = {
        dry: new Float64Array(samples),
        dryR: new Float64Array(samples),
        left: new Float64Array(samples),
        right: new Float64Array(samples),
        mixL: new Float64Array(samples),
        mixR: new Float64Array(samples),
      };
    }
    const view = (buffer: Float64Array) => buffer.subarray(0, samples);
    return {
      dry: view(this.scratch.dry),
      dryR: view(this.scratch.dryR),
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

/*
 * The mix loops live in small functions of their own: inside `render` (a
 * large function the JIT optimizes late) they ran several times slower.
 * Same operations in the same order, so the output is unchanged.
 */

/** Add a stem (times its ducking gain, if any) into the mix. */
function addStem(
  mixL: Float64Array,
  mixR: Float64Array,
  left: Float64Array,
  right: Float64Array,
  samples: number,
  gain: Float64Array | undefined,
): void {
  if (gain)
    for (let index = 0; index < samples; index += 1) {
      mixL[index]! += left[index]! * gain[index]!;
      mixR[index]! += right[index]! * gain[index]!;
    }
  else
    for (let index = 0; index < samples; index += 1) {
      mixL[index]! += left[index]!;
      mixR[index]! += right[index]!;
    }
}

/** Fold everything past `frames` back onto the loop start. */
function foldTail(
  mixL: Float64Array,
  mixR: Float64Array,
  frames: number,
  samples: number,
): void {
  for (let index = frames; index < samples; index += 1) {
    mixL[index % frames]! += mixL[index]!;
    mixR[index % frames]! += mixR[index]!;
  }
}

/** Interleaved 16-bit PCM of the first `frames` mix samples. */
/**
 * The song master over an already summed 16-bit mix (an arrangement
 * rendered in windows), so the whole song is limited and normalized as one
 * pass is. Undefined when the master is absent or bypassed.
 */
export function masterSummedPcm(
  pcm: Int16Array,
  frames: number,
  sampleRate: number,
  master: SongMaster | undefined,
  loop: boolean,
): { pcm: Int16Array; report: MasterReport } | undefined {
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  for (let index = 0; index < frames; index += 1) {
    left[index] = pcm[index * 2]! / 32767;
    right[index] = pcm[index * 2 + 1]! / 32767;
  }
  const mastered = applyMaster(left, right, frames, sampleRate, master, loop);
  if (!mastered) return undefined;
  return {
    pcm: toPcm(mastered.left, mastered.right, frames, true),
    report: mastered.report,
  };
}

function toPcm(
  mixL: Float64Array,
  mixR: Float64Array,
  frames: number,
  dither = false,
): Int16Array {
  const pcm = new Int16Array(frames * RENDER_CHANNELS);
  if (dither) {
    // Triangular dither of +-1 LSB: the sum of two uniform values, from a
    // fixed-seed xorshift so every render of a score dithers the same way.
    let state = 0x9e3779b9;
    const uniform = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4_294_967_296;
    };
    for (let index = 0; index < frames; index += 1) {
      pcm[index * 2] = clamp16(
        Math.round(mixL[index]! * 32767 + uniform() - uniform()),
      );
      pcm[index * 2 + 1] = clamp16(
        Math.round(mixR[index]! * 32767 + uniform() - uniform()),
      );
    }
    return pcm;
  }
  for (let index = 0; index < frames; index += 1) {
    pcm[index * 2] = clamp16(mixL[index]! * 32767);
    pcm[index * 2 + 1] = clamp16(mixR[index]! * 32767);
  }
  return pcm;
}

/** Everything a track's stem depends on, except mute and solo. */
/**
 * The track as its reverb tail sees it: everything but the reverb's mix
 * and mix lane, which only scale the tail.
 */
function roomTrack(track: Track): Track {
  const lanes = { ...track.fxAutomation };
  delete lanes["reverb-mix"];
  return {
    ...track,
    reverb: { ...track.reverb!, mix: 1 },
    fxAutomation: lanes,
  } as Track;
}

function stemKey(
  track: Track | undefined,
  notes: readonly Note[],
  context: RenderContext,
  bank?: SampleBank,
  wavetableId?: string,
  impulseId?: string,
  engineDigests?: readonly string[],
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
    // Bar length: sampler `unit: "c"` stretches a window to whole bars.
    context.score.beatsPerBar,
    context.sampleRate,
    context.samples,
    // Tempo map, meter changes and fermatas move every note.
    ...(context.score.time ? [context.score.time] : []),
    // Sampler stems also depend on the decoded files: a replaced or missing
    // sample changes the key even when the score did not change.
    ...(bank && track?.sampler ? [samplerVoiceDigest(track, bank)] : []),
    ...(wavetableId ? [wavetableId] : []),
    // A convolution reverb's impulse (its sha256 for a sample).
    ...(impulseId ? [impulseId] : []),
    // Assets a 0.6 instrument engine reads (absent without an engine).
    ...(engineDigests ? [engineDigests] : []),
    // The song tuning, and the key whose tonic is the default root.
    ...(context.score.tuning || track?.tuning
      ? [context.score.tuning ?? null, context.score.key]
      : []),
    // Seeded noise follows the window origin of an arranged render.
    ...(context.seedTick ? [`seed:${context.seedTick}`] : []),
  ]);
}

function samplerVoiceDigest(track: Track, bank: SampleBank): string[] {
  return Object.keys(track.sampler?.voices ?? {})
    .sort()
    .map((voice) => {
      const sample = bank.voices.get(sampleKey(track.id, voice));
      return sample
        ? `${voice}:${sample.sha256}:${sample.sampleRate}:${sample.frames}`
        : `${voice}:-`;
    });
}

/** Sample voices of a sampler track into its mono dry buffer. */
function renderSamplerNotes(
  target: Float64Array,
  notes: readonly Note[],
  track: Track,
  context: RenderContext,
  bank: SampleBank,
): void {
  const timing = {
    score: context.score,
    sampleRate: context.sampleRate,
    ...(context.warp ? { warp: context.warp } : {}),
  };
  renderSamplerVoices(
    target,
    planSamplerVoices(track, notes, bank, timing),
    timing,
    (tick) => trackGainAt(track, tick),
  );
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
  const { score, sampleRate, warp } = context;
  if (warp) return warpedSpan(warp, note.startTick, note.durationTicks);
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
  tuning?: TuningTable,
): void {
  const { sampleRate, samples, samplesPerTick } = context;
  const instrument = track?.instrument ?? "sine";
  const { start, length } = noteSpan(note, context);
  const end = Math.min(samples, start + length);
  const frequency = noteHz(note.pitch, note.cents, tuning);
  if (!(frequency > 0)) return;
  const velocity = Math.max(0, Math.min(1, note.velocity));
  const performance = (note as PerformedNote).performance;
  const cents = performance?.cents;
  let bent = 0;
  for (let index = start; index < end; index += 1) {
    const elapsed = index - start;
    const remaining = end - index;
    const attack = Math.min(1, elapsed / Math.max(1, sampleRate * 0.012));
    const release = Math.min(1, remaining / Math.max(1, sampleRate * 0.09));
    const envelope =
      Math.min(attack, release) *
      velocity *
      0.28 *
      trackGainAt(
        track,
        context.warp
          ? context.warp.tick(index)
          : note.startTick + elapsed / samplesPerTick,
      );
    // Plain notes keep the closed-form phase (byte-identical output).
    let phase = (frequency * elapsed) / sampleRate;
    if (cents) {
      phase = bent;
      bent +=
        (frequency * 2 ** (cents(elapsed / sampleRate) / 1200)) / sampleRate;
    }
    const damp = performance?.damp;
    const t = elapsed / sampleRate;
    const held =
      damp && t > damp.from ? Math.exp(-(t - damp.from) / damp.tau) : 1;
    target[index]! += legacyWave(instrument, phase) * envelope * held;
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
  // A track `kit` swaps in a synthesized kit (src/audio/kits.ts); without
  // one the voices below render exactly as they always have.
  const kit = synthKit(track?.kit);
  const kitState = kit ? newKitVoiceState() : undefined;
  const end = Math.min(
    samples,
    start + Math.ceil((kit?.seconds ?? MAX_DRUM_SECONDS) * sampleRate),
  );
  const voice = drumVoiceForPitch(note.pitch);
  const random = seededRandom(
    `${note.id}:${note.startTick + (context.seedTick ?? 0)}`,
  );
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
    if (kit && kitState)
      sample = kitDrumSample(
        kit,
        voice,
        t,
        noise,
        bright,
        kitState,
        sampleRate,
      );
    else if (voice === "kick") {
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
      trackGainAt(
        track,
        context.warp
          ? context.warp.tick(index)
          : note.startTick + (index - start) / samplesPerTick,
      );
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
  dryRight?: Float64Array,
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
        interpolateAutomation(
          lane,
          context.warp
            ? context.warp.tick(index)
            : index / context.samplesPerTick,
          staticPan,
        ),
      );
    const sample = dry[index]!;
    left[index] = sample * gainL;
    // A stereo voice pans its own right channel the same way.
    right[index] = (dryRight ? dryRight[index]! : sample) * gainR;
  }
}

type WavetableHook = Readonly<{
  /** Joins the stem key: a different or missing table re-renders. */
  id: string;
  oscillatorFor: NonNullable<VoiceContext["oscillatorFor"]>;
}>;

/**
 * Wavetable hook: for a wavetable track, each note's oscillator reads the
 * track's table (`src/audio/wavetable.ts`); the synth voice does the rest.
 */
function wavetableHook(
  track: Track,
  bank: SampleBank,
  context: RenderContext,
): WavetableHook | undefined {
  if (!isWavetableInstrument(track.instrument)) return undefined;
  const settings = wavetableOf(track);
  const table = tableFor(track, settings, bank.wavetables);
  // A pack table that failed to load renders silent (the problem is reported).
  if (!table)
    return {
      id: `missing:${settings.table.src}`,
      oscillatorFor: () => () => () => 0,
    };
  const lane = track.wtAutomation ?? [];
  const positionAt =
    lane.length > 0
      ? (tick: number) => interpolateAutomation(lane, tick, settings.wt ?? 0)
      : undefined;
  const warp = context.warp;
  return {
    id: table.id,
    oscillatorFor: (note) => {
      const span = noteSpan(note, context);
      return wavetableOscillator(table, settings, note, {
        sampleRate: context.sampleRate,
        samplesPerTick: context.samplesPerTick,
        secondsPerTick: context.samplesPerTick / context.sampleRate,
        gate: span.length / context.sampleRate,
        // Through a tempo map the lane is read at the sample's song tick.
        positionAt:
          warp && positionAt
            ? (tick: number) =>
                positionAt(
                  warp.tick(
                    span.start +
                      (tick - note.startTick) * context.samplesPerTick,
                  ),
                )
            : positionAt,
      });
    },
  };
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

/** A named point in a WAV export: a sample frame and its label. */
export type WavCue = Readonly<{ frame: number; label: string }>;

/**
 * Append a `cue ` chunk and a `LIST adtl` chunk of `labl` labels, so DAWs
 * and DJ tools show the cues (dawg writes section starts). No cues returns
 * the bytes unchanged.
 */
export function withWavCues(
  bytes: Uint8Array,
  cues: readonly WavCue[],
): Uint8Array {
  if (cues.length === 0 || bytes.byteLength < 12) return bytes;
  const encoder = new TextEncoder();
  const labels = cues.map((cue) =>
    encoder.encode(`${cue.label.slice(0, 200)}\0`),
  );
  const cueSize = 4 + 24 * cues.length;
  const lablSizes = labels.map((text) => 4 + text.byteLength);
  const adtlSize =
    4 + lablSizes.reduce((sum, size) => sum + 8 + size + (size % 2), 0);
  const base = bytes.byteLength + (bytes.byteLength % 2);
  const out = new Uint8Array(base + 8 + cueSize + 8 + adtlSize);
  out.set(bytes);
  const view = new DataView(out.buffer);
  let at = base;
  writeAscii(out, at, "cue ");
  view.setUint32(at + 4, cueSize, true);
  view.setUint32(at + 8, cues.length, true);
  at += 12;
  cues.forEach((cue, index) => {
    const frame = Math.max(0, Math.round(cue.frame));
    view.setUint32(at, index + 1, true);
    view.setUint32(at + 4, frame, true);
    writeAscii(out, at + 8, "data");
    view.setUint32(at + 12, 0, true);
    view.setUint32(at + 16, 0, true);
    view.setUint32(at + 20, frame, true);
    at += 24;
  });
  writeAscii(out, at, "LIST");
  view.setUint32(at + 4, adtlSize, true);
  writeAscii(out, at + 8, "adtl");
  at += 12;
  labels.forEach((text, index) => {
    writeAscii(out, at, "labl");
    view.setUint32(at + 4, lablSizes[index]!, true);
    view.setUint32(at + 8, index + 1, true);
    out.set(text, at + 12);
    at += 8 + lablSizes[index]! + (lablSizes[index]! % 2);
  });
  view.setUint32(4, out.byteLength - 8, true);
  return out;
}
