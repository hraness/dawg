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
import {
  EFFECT_NAMES,
  FX_CHAIN,
  FX_PRESETS,
  effectSpec,
} from "../../core/fx.ts";
import { seededRandom } from "./random.ts";
import {
  engineFor,
  engineTailSeconds,
  RING_OUT_FADE_SECONDS,
  type InstrumentEngine,
} from "./instruments.ts";
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
  needsEffectNotes,
  type EffectNote,
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
import { clipsDigest, hasClips, renderClips } from "./clips.ts";
import { isGuideInstrument } from "../../core/clips.ts";
import { applyMaster, type MasterReport } from "./master.ts";
import type { SongMaster } from "../../core/master.ts";
import { resolveTrackRef } from "../../core/routing.ts";
import { resolveVocoder, VOCODER_INSTRUMENT } from "../../core/vocoder.ts";
import { applyVocoder, autoGateDb } from "./vocoder/index.ts";

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
     * 0.7 clips: a `vocal` track's guide notes sound as a soft sine. The
     * live loop (audition, play mode) sets it; exports never do, so a
     * rendered file holds only the clips.
     */
    guide?: boolean;
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
    /**
     * Song seconds at an arranged window's first frame (with a tempo map,
     * more than `seedTick` at the base tempo); engines whose state runs on
     * the song clock (organ wheels and rotors) start there.
     */
    seedSeconds?: number;
    /** Per-track engine state at the window origin (`windowSeed`). */
    seedState?: Readonly<Record<string, string>>;
    /**
     * The song whose chords a granular `quant chord` reads, at `tick` for
     * this render's tick 0 (a live note renders alone). Absent: the score.
     */
    quantChord?: Readonly<{ score: TrackScore; tick: number }>;
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
  "modal",
  // 0.7 clips: a track of audio clips whose notes are guides.
  "vocal",
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
/** A 0.6 engine's one-shot ring-out is capped here, not at the loop fold. */
const MAX_ENGINE_TAIL_SECONDS = 30;

/**
 * The longest 0.6 engine ring-out in `score`, capped at 30 s. One-shot
 * renders (exports, previews) let engine tails reach their own cap; the
 * 8 s cap applies only to loop folding. Zero without an engine, so legacy
 * renders are unchanged. `ringing` counts only ring-out tracks (0.6.1).
 */
function oneShotEngineTail(score: TrackScore, ringing = false): number {
  let tail = 0;
  for (const track of score.tracks) {
    const engine = engineFor(track);
    if (!engine || (ringing && engine.ringOut?.(track) !== true)) continue;
    let lowest: number | undefined;
    for (const note of score.notes)
      if (
        note.trackId === track.id &&
        (lowest === undefined || note.pitch < lowest)
      )
        lowest = note.pitch;
    tail = Math.max(tail, engineTailSeconds(track, lowest));
  }
  return Math.min(MAX_ENGINE_TAIL_SECONDS, tail);
}

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
  seedSeconds?: number;
  seedState?: Readonly<Record<string, string>>;
  quantChord?: Readonly<{ score: TrackScore; tick: number }>;
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
/** A guide note's level against a plain sine note (about -12 dB). */
const GUIDE_LEVEL = 0.25;

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
  /** Vocoder modulator taps by source key (0.7), kept one render. */
  private readonly modSources = new Map<
    string,
    { tap: Float64Array; used: number }
  >();
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
        ...score.tracks.map((track) => engineTailSeconds(track)),
      ),
    );
    return oneShotSeconds(
      loopSecondsOf(score),
      Math.max(samplerTail, oneShotEngineTail(score)),
      reverbTail,
    );
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
        ...score.tracks.map((track) => engineTailSeconds(track)),
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
        oneShotSeconds(
          loopSeconds,
          Math.max(samplerTail, oneShotEngineTail(score)),
          reverbTail,
        ),
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
      ...(options.seedSeconds ? { seedSeconds: options.seedSeconds } : {}),
      ...(options.seedState ? { seedState: options.seedState } : {}),
      ...(options.quantChord ? { quantChord: options.quantChord } : {}),
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
    // Tracks with audio clips (0.7) render even without notes, after the
    // tracks with notes, so songs without clips keep their sum order.
    for (const track of score.tracks)
      if (hasClips(track) && !groups.has(track.id)) groups.set(track.id, []);
    // A built-in vocoder carrier following chords or a drone needs no notes.
    for (const track of score.tracks)
      if (!groups.has(track.id) && vocoderPlaysWithoutNotes(track))
        groups.set(track.id, []);
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
      const clipDigest = track
        ? clipsDigest(track, bank, options.guide === true)
        : undefined;
      const baseDigests =
        engine && track
          ? [
              ...(engine.assetDigests?.(track, bank, score) ?? []),
              `key:${score.key ?? ""}`,
              ...(clipDigest === undefined ? [] : [`clips:${clipDigest}`]),
            ]
          : clipDigest === undefined
            ? undefined
            : [`clips:${clipDigest}`];
      // A vocoder carrier (0.7) also keys on its modulator's tap.
      const vocoderSource = track?.vocoder
        ? vocoderSourceOf(track, groups, performed, context, bank)
        : undefined;
      const engineDigests = vocoderSource
        ? [...(baseDigests ?? []), vocoderSource.key]
        : baseDigests;
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
        const stereo = renderVoiceInto(
          dry,
          dryR,
          played,
          track,
          context,
          score,
          bank,
          engine,
          sampler,
          wavetable,
          tuning,
          options.guide === true,
        );
        // The vocoder stage (0.7): after the voice, before the chain.
        if (track && vocoderSource)
          applyVocoder(
            dry,
            stereo ? dryR : undefined,
            this.vocoderTap(vocoderSource, context, bank),
            track,
            context,
            vocoderSource.gateDb,
          );
        // Note-aware stages (bloom, swell) see the notes; others never do.
        const chain =
          track && needsEffectNotes(track)
            ? { ...context, notes: effectNotes(played, context, tuning) }
            : context;
        if (track) applyMonoChain(dry, track, chain);
        if (stereo && track) applyMonoChain(dryR, track, chain);
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
            chain,
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
            chain,
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
    // A ring-out longer than the fold (a gong past 8 s) would be cut there:
    // fade its last RING_OUT_FADE_SECONDS so the fold never clicks. Only
    // ringing 0.6 engine tracks qualify, so legacy loops are untouched.
    if (
      options.loop &&
      samples > frames &&
      oneShotEngineTail(score, true) > (samples - frames) / sampleRate
    )
      fadeEnd(
        mixL,
        mixR,
        samples,
        Math.round(RING_OUT_FADE_SECONDS * sampleRate),
      );
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

  /**
   * A vocoder modulator's mono tap over this render: the source's voice,
   * through its mono chain for `tap: chain`, stereo summed (L+R)/2. Kept
   * across renders under the stem cache budget, keyed by the source key.
   */
  private vocoderTap(
    source: VocoderSource,
    context: RenderContext,
    bank: SampleBank,
  ): Float64Array {
    const known = this.modSources.get(source.key);
    if (known && known.tap.length === context.samples) {
      known.used = this.renders;
      return known.tap;
    }
    const tap = renderVocoderTap(source, context, bank);
    for (const [key, entry] of this.modSources)
      if (entry.used < this.renders - 1) this.modSources.delete(key);
    if (this.maxCacheBytes > 0)
      this.modSources.set(source.key, { tap, used: this.renders });
    return tap;
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
/** Fade the last `fade` of `samples` mix frames linearly to zero. */
function fadeEnd(
  mixL: Float64Array,
  mixR: Float64Array,
  samples: number,
  fade: number,
): void {
  const n = Math.min(fade, samples);
  for (let i = 0; i < n; i += 1) {
    const gain = (n - 1 - i) / n;
    mixL[samples - n + i]! *= gain;
    mixR[samples - n + i]! *= gain;
  }
}

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
    ...(context.seedSeconds ? [`at:${context.seedSeconds}`] : []),
    ...(track && context.seedState?.[track.id]
      ? [`state:${context.seedState[track.id]}`]
      : []),
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

/** A vocoder carrier's modulator: its track, notes, key and gate. */
/** FX_CHAIN index of pan: a `tap: chain` modulator runs the stages before. */
const TAP_END = FX_CHAIN.indexOf("pan");

type VocoderSource = Readonly<{
  track: Track;
  played: readonly PerformedNote[];
  tap: "chain" | "dry";
  key: string;
  gateDb: number;
}>;

/** True for a built-in carrier that sounds without notes (chords, drone). */
function vocoderPlaysWithoutNotes(track: Track): boolean {
  if (!track.vocoder || track.instrument !== VOCODER_INSTRUMENT) return false;
  const follow = resolveVocoder(track.vocoder).follow;
  return follow === "chords" || follow === "drone";
}

const assetGates = new WeakMap<DecodedSample, number>();

/**
 * The auto gate from a source's assets (its sampler files): the quietest
 * file's 10th-percentile 10 ms frame level + 6 dB, never the render span.
 * A source without assets (a synth) has no noise floor: the gate is off.
 */
function sourceGateDb(source: Track, bank: SampleBank): number {
  let gate: number | undefined;
  for (const voice of Object.keys(source.sampler?.voices ?? {}).sort()) {
    const sample = bank.voices.get(sampleKey(source.id, voice));
    if (!sample) continue;
    let level = assetGates.get(sample);
    if (level === undefined) {
      level = autoGateDb(Float64Array.from(sample.mono), sample.sampleRate);
      assetGates.set(sample, level);
    }
    if (level > -120) gate = gate === undefined ? level : Math.min(gate, level);
  }
  return gate ?? -120;
}

/** Resolves a carrier's modulator, or undefined (the stage is bypassed). */
function vocoderSourceOf(
  track: Track,
  groups: ReadonlyMap<string, readonly Note[]>,
  performed: ReadonlyMap<string, readonly PerformedNote[]>,
  context: RenderContext,
  bank: SampleBank,
): VocoderSource | undefined {
  const ref = track.vocoder?.src;
  if (ref === undefined) return undefined;
  const source = resolveTrackRef(context.score, ref);
  if (!source || source.id === track.id) return undefined;
  const settings = resolveVocoder(track.vocoder);
  const notes = groups.get(source.id) ?? [];
  const engine = engineFor(source);
  // Post-tap fields never change the tap (mute, solo and volume included).
  const {
    vocoder: _vocoder,
    pan: _pan,
    volume: _volume,
    volumeAutomation: _volumeAutomation,
    panAutomation: _panAutomation,
    delay: _delay,
    delayFeedbackAutomation: _delayFeedback,
    delayMixAutomation: _delayMix,
    reverb: _reverb,
    ...kept
  } = source;
  // Only the stages the tap runs (before pan, and none for `tap: dry`):
  // a source's reverb, delay, double or other post-pan fx never re-render
  // its carriers. fxAutomation stays (rarely post-pan; a cheap re-render).
  const tapped = settings.tap === "chain" ? FX_CHAIN.slice(0, TAP_END) : [];
  const fx = kept.fx
    ? Object.fromEntries(
        Object.entries(kept.fx).filter(
          ([stage]) =>
            tapped.includes(stage as never) ||
            !FX_CHAIN.includes(stage as never),
        ),
      )
    : undefined;
  const stripped = {
    ...kept,
    fx: fx && Object.keys(fx).length > 0 ? fx : undefined,
  } as unknown as Track;
  const gateDb =
    settings.gate === "auto" ? sourceGateDb(source, bank) : settings.gate;
  // The modulator's clips (0.7) are heard; guide tones never are.
  const clipDigest = clipsDigest(source, bank, false);
  const clipKeys = clipDigest === undefined ? [] : [`clips:${clipDigest}`];
  const key = stemKey(
    stripped,
    notes,
    context,
    isSamplerInstrument(source.instrument) ? bank : undefined,
    wavetableHook(source, bank, context)?.id,
    undefined,
    engine
      ? [
          ...(engine.assetDigests?.(source, bank, context.score) ?? []),
          `key:${context.score.key ?? ""}`,
          ...clipKeys,
        ]
      : clipKeys.length > 0
        ? clipKeys
        : undefined,
  );
  return {
    track: source,
    played: performed.get(source.id) ?? [],
    tap: settings.tap,
    key: `vocsrc:${settings.tap}:${gateDb}:${key}`,
    gateDb,
  };
}

/** Renders a modulator's mono tap (see `StemRenderer.vocoderTap`). */
function renderVocoderTap(
  source: VocoderSource,
  context: RenderContext,
  bank: SampleBank,
): Float64Array {
  const { played } = source;
  // The tap is rendered at unity gain: the voice bakes track volume in
  // (trackGainAt), and volume is a post-tap field the cache key leaves out.
  const track: Track = {
    ...source.track,
    volume: 1,
    volumeAutomation: [],
  };
  const { score } = context;
  const dry = new Float64Array(context.samples);
  const dryR = new Float64Array(context.samples);
  const tuning = resolveTuning(score.tuning, track.tuning, score.key);
  const stereo = renderVoiceInto(
    dry,
    dryR,
    played,
    track,
    context,
    score,
    bank,
    engineFor(track),
    isSamplerInstrument(track.instrument),
    wavetableHook(track, bank, context),
    tuning,
    false,
  );
  if (source.tap === "chain") {
    const chain = needsEffectNotes(track)
      ? { ...context, notes: effectNotes(played, context, tuning) }
      : context;
    applyMonoChain(dry, track, chain);
    if (stereo) applyMonoChain(dryR, track, chain);
  }
  if (stereo)
    for (let i = 0; i < dry.length; i += 1) dry[i] = (dry[i]! + dryR[i]!) / 2;
  return dry;
}

/**
 * Renders a track's voice (engine, sampler, synth or tone/drum notes) into
 * `dry` (and `dryR` when stereo) before any effect; returns whether it
 * wrote a right channel. Shared by the stem pass and the vocoder tap.
 */
function renderVoiceInto(
  dry: Float64Array,
  dryR: Float64Array,
  played: readonly PerformedNote[],
  track: Track | undefined,
  context: RenderContext,
  score: TrackScore,
  bank: SampleBank,
  engine: InstrumentEngine | undefined,
  sampler: boolean,
  wavetable: ReturnType<typeof wavetableHook> | undefined,
  tuning: TuningTable | undefined,
  guide: boolean,
): boolean {
  const synthVoice = !engine && !sampler && usesSynthVoice(track);
  let stereo = engine
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
    // A resampled stereo file plays as stereo (0.6.1).
    if (track)
      stereo = renderSamplerNotes(dry, played, track, context, bank, dryR);
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
  } else if (track?.clips && isGuideInstrument(track.instrument)) {
    // A `vocal` track's notes guide its clips: silent in a render,
    // a soft sine in the live loop with `guide` on. (Without clips,
    // an older project's `vocal` keeps its tone.)
    if (guide)
      for (const note of played)
        renderToneNote(
          dry,
          { ...note, velocity: note.velocity * GUIDE_LEVEL },
          { ...track, instrument: "sine" },
          context,
          tuning,
        );
  } else {
    const drums = isDrumInstrument(track?.instrument);
    for (const note of played) {
      if (drums) renderDrumNote(dry, note, track, context);
      else renderToneNote(dry, note, track, context, tuning);
    }
  }
  // Audio clips (0.7) sum into the dry buffer before the chain.
  if (track?.clips) {
    const gainAt = (tick: number) => trackGainAt(track, tick);
    renderClips(dry, track, context, bank, gainAt);
    if (stereo) renderClips(dryR, track, context, bank, gainAt);
  }
  return stereo;
}

/**
 * Sample voices of a sampler track into its mono dry buffer. When a voice
 * plays a resampled stereo file (0.6.1), `target` takes the left channel,
 * `targetRight` the right, and the result is true (the track is stereo).
 */
function renderSamplerNotes(
  target: Float64Array,
  notes: readonly Note[],
  track: Track,
  context: RenderContext,
  bank: SampleBank,
  targetRight: Float64Array,
): boolean {
  const timing = {
    score: context.score,
    sampleRate: context.sampleRate,
    ...(context.warp ? { warp: context.warp } : {}),
  };
  const voices = planSamplerVoices(track, notes, bank, timing);
  const gainAt = (tick: number) => trackGainAt(track, tick);
  if (!voices.some((voice) => voice.stereo)) {
    renderSamplerVoices(target, voices, timing, gainAt);
    return false;
  }
  targetRight.fill(0);
  renderSamplerVoices(target, voices, timing, gainAt, "left");
  renderSamplerVoices(targetRight, voices, timing, gainAt, "right");
  return true;
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

/** The notes as note-aware effects see them (EffectContext.notes). */
function effectNotes(
  notes: readonly Note[],
  context: RenderContext,
  tuning: TuningTable | undefined,
): EffectNote[] {
  return notes.map((note) => {
    const { start, length } = noteSpan(note, context);
    return {
      id: note.id,
      start,
      length,
      hz: noteHz(note.pitch, note.cents, tuning),
      velocity: note.velocity,
    };
  });
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
