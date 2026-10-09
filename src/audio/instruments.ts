/**
 * The 0.6 instrument engine registry. A lane registers one engine
 * (`registerEngine`) for its instrument id and its own optional Track field;
 * `engineFor` dispatches to it only when the track names that instrument AND
 * carries that field as an object, so a bare legacy word (a stored "piano",
 * "marimba", "sitar") keeps today's voice. With nothing registered every
 * render takes exactly today's code path.
 */
import type { PerformedNote } from "../../core/expression.ts";
import type { Track, TrackScore } from "../../core/score.ts";
import type { TuningTable } from "../../core/tuning.ts";
import { WIND_ENGINE } from "./winds/engine.ts";
import { MODAL_ENGINE } from "./resonators.ts";
import type { SampleBank } from "./samples.ts";
import type { RenderContext } from "./wav.ts";
import { STRING_ENGINE } from "./strings/engine.ts";
import { GRANULAR_ENGINE } from "./granular.ts";
import { KEYS_ENGINES } from "./keys/engine.ts";

/** What an engine renders with: the track's render context plus its tuning. */
export type EngineContext = RenderContext &
  Readonly<{
    ticksPerBeat: number;
    /** The merged song and track tuning; absent keeps 12-TET. */
    tuning?: TuningTable;
  }>;

/** Fade at a ring-out cap (live note length, voice cap, loop fold), in seconds. */
export const RING_OUT_FADE_SECONDS = 0.25;

export type InstrumentEngine = Readonly<{
  /** The `Track.instrument` value this engine plays. */
  id: string;
  /** The optional Track field that holds its settings. */
  field: keyof Track;
  /**
   * Adds the track's performed notes into `dry` (and `dryR` when `stereo`
   * is true), before the track's effects, pan and the song master.
   */
  render(
    dry: Float64Array,
    dryR: Float64Array | undefined,
    notes: readonly PerformedNote[],
    track: Track,
    context: EngineContext,
    bank: SampleBank,
  ): void;
  /**
   * Ring-out after the last note ends, in seconds (the live length cap).
   * `lowestPitch`, when given, is the track's lowest note, for engines
   * whose ring depends on pitch.
   */
  tailSeconds(track: Track, lowestPitch?: number): number;
  /**
   * The live note-off fade for one key at its sounding `hz`, in seconds
   * (a piano's damper); absent uses `tailSeconds`.
   */
  releaseSeconds?(track: Track, pitch: number, hz: number): number;
  /**
   * True when a released live key keeps ringing to the end of its rendered
   * tail (an undamped bar or gong) instead of fading at note-off.
   */
  ringOut?(track: Track): boolean;
  /** True when the engine writes a separate right channel. */
  stereo(track: Track): boolean;
  /**
   * State the engine carries into an arranged window that its pre-roll
   * cannot rebuild (an organ's rotors along a lane), as a string: `history`
   * is the song before the window and `frames` its length in samples.
   * Arranged renders hand it back as `context.seedState[track.id]`.
   */
  windowSeed?(
    history: TrackScore,
    track: Track,
    frames: number,
    sampleRate: number,
  ): string | undefined;
  /**
   * Digests of any assets the engine reads, joined to the stem cache key.
   * `score` is the song, for engines that read other tracks' notes.
   */
  assetDigests?(
    track: Track,
    bank: SampleBank,
    score?: TrackScore,
  ): readonly string[];
}>;

const engines = new Map<string, InstrumentEngine>();

/** Registers an engine; one per instrument id. */
export function registerEngine(engine: InstrumentEngine): void {
  if (engines.has(engine.id))
    throw new Error(`instrument engine "${engine.id}" is already registered`);
  engines.set(engine.id, engine);
}

/** Removes an engine (tests only). */
export function unregisterEngine(id: string): void {
  engines.delete(id);
}

/** The ids with a registered engine. */
export function registeredEngines(): readonly string[] {
  return [...engines.keys()];
}

/**
 * The engine for a track: only when the track's instrument names a
 * registered engine and the engine's Track field is present as an object.
 */
export function engineFor(
  track: Track | undefined,
): InstrumentEngine | undefined {
  if (!track || engines.size === 0) return undefined;
  const engine = engines.get(track.instrument);
  if (!engine) return undefined;
  const settings: unknown = track[engine.field];
  return typeof settings === "object" &&
    settings !== null &&
    !Array.isArray(settings)
    ? engine
    : undefined;
}

/** A track's engine ring-out in seconds; 0 without an engine. */
export function engineTailSeconds(
  track: Track | undefined,
  lowestPitch?: number,
): number {
  const engine = engineFor(track);
  return engine ? Math.max(0, engine.tailSeconds(track!, lowestPitch)) : 0;
}

// 0.6 lanes register their engines below, one line each.
registerEngine(STRING_ENGINE);
registerEngine(GRANULAR_ENGINE);
for (const engine of KEYS_ENGINES) registerEngine(engine);
registerEngine(MODAL_ENGINE);
registerEngine(WIND_ENGINE);
