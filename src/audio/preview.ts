/**
 * Sound preview: the short score an audition loop (or `preview_sound`)
 * renders for one track, and a few numbers that describe a render.
 *
 * Like `live.ts` and `audition.ts` this only builds a smaller score; the
 * renderer, stem cache and every effect (filters, buses, impulse
 * responses) are the ordinary ones, so a preview sounds exactly like the
 * same bars of the song.
 *
 * The loop source is the track's own notes over a region of at most
 * `MAX_PREVIEW_BARS` bars: the whole loop when it is that short, otherwise
 * two bars from the bar under the playhead (moved to the track's first
 * bar with notes when those two bars are empty). A track with no notes
 * plays a short phrase chosen by its role: a chord for pads and keys, a
 * riff for bass and leads, a groove for kits, and one held note for
 * wavetables so position changes are audible.
 */
import { isDrumInstrument } from "../../core/drums.ts";
import { slicePedals } from "../../core/expression.ts";
import type { SongMaster } from "../../core/master.ts";
import { MODES, parseKey } from "../../core/chords.ts";
import { rhythmVoicePitch } from "../../core/rhythm.ts";
import {
  AUTOMATION_LANES,
  TrackScore,
  isSamplerInstrument,
  isWavetableInstrument,
  samplerVoiceSlots,
  type AutomationPoint,
  type NoteInput,
  type Track,
} from "../../core/score.ts";
import { barAt, barStartTick, songTimeSlice } from "../../core/tempo.ts";
import { interpolateAutomation } from "./effects/common.ts";
import { loopedSection, scoreBeatAt } from "./arrange.ts";
import { RENDER_CHANNELS } from "./wav.ts";

/** Longest preview loop, in bars. */
export const MAX_PREVIEW_BARS = 4;
/** Region length when the song is longer than `MAX_PREVIEW_BARS`. */
export const PREVIEW_REGION_BARS = 2;

export type PreviewRegion = Readonly<{ startBar: number; bars: number }>;

/** What the loop plays: the track's notes, or a default phrase. */
export type PreviewSource = "notes" | "phrase";

export type PhraseRole = "chord" | "riff" | "lead" | "groove" | "drone";

export type PreviewOptions = Readonly<{
  /** Full mix with the track (true) or the track alone (default). */
  context?: boolean;
  /** Playhead or cursor beat, to pick the region in a long song. */
  beat?: number;
  /** Overrides the region choice (tests, the agent tool). */
  region?: PreviewRegion;
  /**
   * Replaces the focused track's notes with this phrase (from tick 0 of the
   * region). The chord settings screen plays a progression performed with
   * the staged settings this way, so a voicing or arp change is audible.
   */
  phrase?: (score: TrackScore, track: Track, bars: number) => NoteInput[];
  /**
   * The limiter drive the song's master solved for its loudness target on
   * the full mix, dB. A preview plays the master at this fixed drive instead
   * of re-solving the target on its few bars, so a volume edit stays
   * audible. Without it a solo plays the master with no target (the
   * limiter at its own gain), and a context preview solves on its bars.
   */
  masterGainDb?: number;
}>;

export type Preview = Readonly<{
  score: TrackScore;
  region: PreviewRegion;
  source: PreviewSource;
  /** Set when `source` is `phrase`. */
  role?: PhraseRole;
}>;

/** The bars an audition loops for `trackId` (see the module comment). */
export function previewRegion(
  score: TrackScore,
  trackId: string,
  beat = 0,
): PreviewRegion {
  // A looped section bounds the audition, and the playhead (an arranged
  // beat when the song has a form) maps back to the bars it is playing.
  const section = loopedSection(score);
  const bounded = section !== undefined && section.startBar < score.bars;
  const lo = bounded ? section.startBar : 0;
  const hi = bounded
    ? Math.min(score.bars, section.startBar + section.bars)
    : score.bars;
  if (hi - lo <= MAX_PREVIEW_BARS) return { startBar: lo, bars: hi - lo };
  const bars = PREVIEW_REGION_BARS;
  const last = hi - bars;
  const clampBar = (bar: number) =>
    Math.max(lo, Math.min(last, Number.isFinite(bar) ? Math.floor(bar) : lo));
  // Bars through the meter changes; 0.4 scores keep `beat / beatsPerBar`.
  const barOfTick = (tick: number) => barAt(score, tick).bar;
  const scoreBeat = scoreBeatAt(score, beat);
  let startBar = clampBar(
    Number.isFinite(scoreBeat) ? barOfTick(scoreBeat * score.ticksPerBeat) : lo,
  );
  const notes = score.notes.filter((note) => note.trackId === trackId);
  const inRegion = (from: number) =>
    notes.some(
      (note) =>
        note.startTick >= barStartTick(score, from) &&
        note.startTick < barStartTick(score, from + bars),
    );
  const loTick = barStartTick(score, lo);
  const hiTick = barStartTick(score, hi);
  const pool = bounded
    ? notes.filter(
        (note) => note.startTick >= loTick && note.startTick < hiTick,
      )
    : notes;
  if (pool.length > 0 && !inRegion(startBar)) {
    const first = Math.min(...pool.map((note) => note.startTick));
    startBar = clampBar(barOfTick(first));
  }
  return { startBar, bars };
}

/** The role a default phrase plays for `track` (see the module comment). */
export function phraseRole(track: Track): PhraseRole {
  if (isDrumInstrument(track.instrument)) return "groove";
  if (isSamplerInstrument(track.instrument))
    return track.sampler?.mode === "keyed" ? "chord" : "groove";
  if (isWavetableInstrument(track.instrument)) return "drone";
  // Grain clouds are textures: held notes let them evolve.
  if (track.instrument === "granular") return "drone";
  const words = `${track.instrument} ${track.name} ${track.id}`.toLowerCase();
  if (/\b(bass|sub|808)/.test(words)) return "riff";
  if (/\b(lead|arp|pluck|saw|square|pulse|z_|mono|melody|hook)/.test(words))
    return "lead";
  return "chord";
}

/**
 * A short phrase for an empty track, in the song's key (C major without
 * one), filling `bars` bars from tick 0.
 */
export function defaultPhrase(
  score: TrackScore,
  track: Track,
  bars: number,
  role: PhraseRole = phraseRole(track),
): NoteInput[] {
  const tpb = score.ticksPerBeat;
  const barTicks = score.beatsPerBar * tpb;
  const total = Math.max(1, bars) * barTicks;
  const key = parseKey(score.key) ?? { tonic: 0, mode: "major" as const };
  const scale = MODES[key.mode];
  // Scale degree (0-based, may exceed 6) to MIDI pitch above `base`.
  const degree = (base: number, step: number) =>
    base + key.tonic + scale[((step % 7) + 7) % 7]! + 12 * Math.floor(step / 7);
  const notes: NoteInput[] = [];
  const add = (
    startTick: number,
    durationTicks: number,
    pitch: number,
    velocity = 0.8,
  ) => {
    if (startTick >= total) return;
    notes.push({
      id: `preview-${notes.length + 1}`,
      trackId: track.id,
      startTick,
      durationTicks: Math.max(1, Math.min(durationTicks, total - startTick)),
      pitch: Math.max(0, Math.min(127, pitch)),
      velocity,
    });
  };
  switch (role) {
    case "drone":
      add(0, total, degree(48, 0));
      break;
    case "chord":
      // I then IV, one bar each, voiced around middle C.
      for (let bar = 0; bar < bars; bar += 1) {
        const root = bar % 2 === 0 ? 0 : 3;
        for (const step of [root, root + 2, root + 4])
          add(bar * barTicks, barTicks - tpb / 8, degree(48, step), 0.7);
      }
      break;
    case "riff":
    case "lead": {
      const base = role === "riff" ? 36 : 60;
      const steps =
        role === "riff" ? [0, 0, 4, 0, 7, 0, 4, 2] : [0, 2, 4, 2, 7, 4, 5, 4];
      const eighth = tpb / 2;
      for (let at = 0, index = 0; at < total; at += eighth, index += 1)
        add(
          at,
          eighth * 0.9,
          degree(base, steps[index % steps.length]!),
          index % 2 === 0 ? 0.85 : 0.7,
        );
      break;
    }
    case "groove": {
      const voices = grooveVoices(track);
      const eighth = tpb / 2;
      for (let at = 0, index = 0; at < total; at += eighth, index += 1) {
        const beat = index / 2;
        const inBar = beat % score.beatsPerBar;
        if (voices.hat !== undefined) add(at, eighth / 2, voices.hat, 0.55);
        if (Number.isInteger(beat) && inBar % 2 === 0)
          add(at, eighth, voices.kick, 0.95);
        if (
          voices.snare !== undefined &&
          Number.isInteger(beat) &&
          inBar % 2 === 1
        )
          add(at, eighth, voices.snare, 0.85);
      }
      break;
    }
  }
  return notes;
}

function grooveVoices(track: Track): {
  kick: number;
  snare?: number;
  hat?: number;
} {
  if (isSamplerInstrument(track.instrument) && track.sampler) {
    const slots = [...samplerVoiceSlots(track.sampler).values()];
    const named = (name: string) => rhythmVoicePitch(track, name);
    const kick = named("bd") ?? named("kick") ?? slots[0] ?? 36;
    const snare = named("sd") ?? named("snare") ?? slots[1];
    const hat = named("hh") ?? named("hat") ?? slots[2];
    return {
      kick,
      ...(snare !== undefined ? { snare } : {}),
      ...(hat !== undefined ? { hat } : {}),
    };
  }
  return {
    kick: rhythmVoicePitch(track, "kick") ?? 36,
    snare: rhythmVoicePitch(track, "snare") ?? 38,
    hat: rhythmVoicePitch(track, "hat") ?? 42,
  };
}

const TRACK_LANES = Object.values(AUTOMATION_LANES).map((lane) => lane.field);

/**
 * Points of a lane over [start, end) moved to start at tick 0. A lane with
 * a point at or before `start` gets one at 0 holding the value there, so the
 * slice starts where the song is, and the first point past `end` is kept so
 * a ramp across the region still ramps; later lanes keep their fallback.
 */
export function sliceLane(
  points: readonly AutomationPoint[],
  start: number,
  end: number,
): AutomationPoint[] {
  if (points.length === 0) return [];
  const out: AutomationPoint[] = [];
  if (start > 0 && points[0]!.tick <= start)
    out.push({ tick: 0, value: interpolateAutomation(points, start, 0) });
  for (const point of points) {
    if (start > 0 ? point.tick <= start : point.tick < 0) continue;
    out.push({ tick: point.tick - start, value: point.value });
    // One point past the end keeps a ramp through the region ramping.
    if (point.tick >= end) break;
  }
  return out;
}

function sliceTrack(track: Track, start: number, end: number): Track {
  const { rhythm: _rhythm, ...rest } = track;
  if (start <= 0 && end === Infinity) return rest;
  const sliced: Record<string, unknown> = { ...rest };
  for (const field of TRACK_LANES) {
    const lane = track[field];
    if (lane && lane.length > 0) sliced[field] = sliceLane(lane, start, end);
  }
  if (track.fxAutomation) {
    const lanes: Record<string, AutomationPoint[]> = {};
    for (const [name, points] of Object.entries(track.fxAutomation))
      if (points && points.length > 0)
        lanes[name] = sliceLane(points, start, end);
    sliced.fxAutomation = lanes;
  }
  return slicePedals(sliced as Track, [{ from: start, to: end, offset: 0 }]);
}

/**
 * The score an audition plays for `trackId`: the region's notes and
 * automation from tick 0, the track soloed (or the full mix with it in
 * `context`), and a default phrase when the track has no notes at all.
 * Undefined when the track does not exist.
 */
export function previewScore(
  score: TrackScore,
  trackId: string,
  options: PreviewOptions = {},
): Preview | undefined {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return undefined;
  const region = options.region ?? previewRegion(score, trackId, options.beat);
  const bars = Math.max(
    1,
    Math.min(region.bars, score.bars - Math.max(0, region.startBar)),
  );
  const startBar = Math.max(0, Math.min(region.startBar, score.bars - 1));
  const start = barStartTick(score, startBar);
  const end = barStartTick(score, startBar + bars);
  const context = options.context === true;
  const anySolo = score.tracks.some((candidate) => candidate.solo === true);
  const tracks = score.tracks
    .filter((candidate) => context || candidate.id === trackId)
    .map((candidate) => {
      const sliced = sliceTrack(candidate, start, end);
      if (candidate.id !== trackId) return sliced;
      // The focused track always sounds, even when muted or not soloed.
      return {
        ...sliced,
        muted: false,
        ...(context && anySolo ? { solo: true } : {}),
      };
    });
  const replaced = options.phrase !== undefined;
  const own = !replaced && score.notes.some((note) => note.trackId === trackId);
  const notes: NoteInput[] = score.notes
    .filter(
      (note) =>
        (context || note.trackId === trackId) &&
        !(replaced && note.trackId === trackId) &&
        note.startTick >= start &&
        note.startTick < end,
    )
    .map((note) => ({ ...note, startTick: note.startTick - start }));
  let role: PhraseRole | undefined;
  if (options.phrase) {
    role = "chord";
    notes.push(...options.phrase(score, track, bars));
  } else if (!own) {
    role = phraseRole(track);
    notes.push(...defaultPhrase(score, track, bars, role));
  }
  // The song's tempo map and meter, rebased to the region's first bar.
  const timing = songTimeSlice(score, startBar, bars);
  const preview = new TrackScore({
    tempoBpm: timing.tempoBpm,
    ...(timing.time ? { time: timing.time } : {}),
    beatsPerBar: score.beatsPerBar,
    bars,
    ticksPerBeat: score.ticksPerBeat,
    key: score.key,
    tracks,
    notes,
    // The master is the song's output stage, so a soloed preview passes
    // through it too, the way a DAW solo still reaches the master bus: at
    // the song's fixed drive, not a target re-solved on what is soloed.
    ...(score.master
      ? { master: previewMaster(score.master, context, options.masterGainDb) }
      : {}),
  });
  return {
    score: preview,
    region: { startBar, bars },
    source: own ? "notes" : "phrase",
    ...(role ? { role } : {}),
  };
}

/**
 * The master a preview plays: the song's, with its loudness target swapped
 * for a fixed limiter drive (see PreviewOptions.masterGainDb).
 */
export function previewMaster(
  master: SongMaster,
  context: boolean,
  masterGainDb: number | undefined,
): SongMaster {
  if (master.target === undefined) return master;
  if (masterGainDb === undefined && context) return master;
  const { target: _target, ...rest } = master;
  if (!rest.limiter || masterGainDb === undefined) return rest;
  return {
    ...rest,
    limiter: {
      ...rest.limiter,
      gain: Math.max(0, Math.min(24, masterGainDb)),
    },
  };
}

// ── analysis ──────────────────────────────────────────────────────────

export type SoundStats = Readonly<{
  /** RMS level of both channels, dBFS (-inf for silence, floored at -120). */
  rmsDb: number;
  /** Highest absolute sample, dBFS. */
  peakDb: number;
  /** Spectral centroid of the mono sum, Hz (0 for silence). */
  centroidHz: number;
  /** Samples at full scale (a clip). */
  clipped: number;
  seconds: number;
}>;

const FLOOR_DB = -120;

function toDb(linear: number): number {
  return linear > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(linear)) : FLOOR_DB;
}

/**
 * Loudness, peak and brightness of interleaved stereo 16-bit PCM. The
 * centroid averages power spectra of up to 64 Hann-windowed 1024-point
 * frames spread over the clip (a direct DFT on a decimated grid of bins,
 * so it stays cheap and dependency-free).
 */
export function analyzePcm(pcm: Int16Array, sampleRate: number): SoundStats {
  const frames = Math.floor(pcm.length / RENDER_CHANNELS);
  return {
    ...levelOf(pcm),
    centroidHz: spectralCentroid(pcm, frames, sampleRate),
    seconds: frames / sampleRate,
  };
}

/** RMS and peak dBFS and the clipped sample count (no spectrum; cheap). */
export type SoundLevel = Pick<SoundStats, "rmsDb" | "peakDb" | "clipped">;

export function levelOf(pcm: Int16Array): SoundLevel {
  const samples = Math.floor(pcm.length / RENDER_CHANNELS) * RENDER_CHANNELS;
  let sum = 0;
  let peak = 0;
  let clipped = 0;
  for (let index = 0; index < samples; index += 1) {
    const sample = pcm[index]!;
    const value = sample / 32768;
    sum += value * value;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
    if (sample >= 32767 || sample <= -32768) clipped += 1;
  }
  const rms = samples > 0 ? Math.sqrt(sum / samples) : 0;
  return { rmsDb: toDb(rms), peakDb: toDb(peak), clipped };
}

const FFT_SIZE = 1024;
const MAX_FRAMES = 64;
const BIN_STEP = 2;

function spectralCentroid(
  pcm: Int16Array,
  frames: number,
  sampleRate: number,
): number {
  if (frames < FFT_SIZE) return 0;
  const count = Math.min(MAX_FRAMES, Math.floor(frames / FFT_SIZE));
  const hop = Math.floor((frames - FFT_SIZE) / Math.max(1, count - 1));
  const bins = FFT_SIZE / 2;
  const power = new Float64Array(bins);
  const window = new Float64Array(FFT_SIZE);
  for (let index = 0; index < FFT_SIZE; index += 1)
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / FFT_SIZE);
  const block = new Float64Array(FFT_SIZE);
  const cos = new Float64Array(FFT_SIZE);
  const sin = new Float64Array(FFT_SIZE);
  for (let index = 0; index < FFT_SIZE; index += 1) {
    cos[index] = Math.cos((2 * Math.PI * index) / FFT_SIZE);
    sin[index] = Math.sin((2 * Math.PI * index) / FFT_SIZE);
  }
  for (let frame = 0; frame < count; frame += 1) {
    const offset = frame * hop;
    let energy = 0;
    for (let index = 0; index < FFT_SIZE; index += 1) {
      const at = (offset + index) * RENDER_CHANNELS;
      const mono = (pcm[at]! + pcm[at + 1]!) / 65536;
      block[index] = mono * window[index]!;
      energy += mono * mono;
    }
    if (energy === 0) continue;
    for (let bin = 1; bin < bins; bin += BIN_STEP) {
      let re = 0;
      let im = 0;
      for (let index = 0; index < FFT_SIZE; index += 1) {
        const phase = (bin * index) % FFT_SIZE;
        re += block[index]! * cos[phase]!;
        im -= block[index]! * sin[phase]!;
      }
      power[bin] = power[bin]! + re * re + im * im;
    }
  }
  let weighted = 0;
  let total = 0;
  for (let bin = 1; bin < bins; bin += BIN_STEP) {
    weighted += power[bin]! * ((bin * sampleRate) / FFT_SIZE);
    total += power[bin]!;
  }
  return total > 0 ? weighted / total : 0;
}

/** One line for the agent and the activity card: level, peak, brightness. */
export function describeSound(stats: SoundStats): string {
  if (stats.rmsDb <= FLOOR_DB + 1) return "silent";
  const loud =
    stats.rmsDb > -10
      ? "very loud"
      : stats.rmsDb > -18
        ? "loud"
        : stats.rmsDb > -30
          ? "moderate"
          : stats.rmsDb > -45
            ? "quiet"
            : "very quiet";
  const tone =
    stats.centroidHz < 400
      ? "dark"
      : stats.centroidHz < 1200
        ? "warm"
        : stats.centroidHz < 2800
          ? "balanced"
          : stats.centroidHz < 5000
            ? "bright"
            : "very bright";
  const clip =
    stats.clipped > 0 ? ` · clipping (${stats.clipped} samples)` : "";
  return `${loud}, ${tone} · RMS ${stats.rmsDb.toFixed(1)} dBFS · peak ${stats.peakDb.toFixed(1)} dBFS · centroid ${Math.round(stats.centroidHz)} Hz${clip}`;
}

/**
 * A level meter `width` cells wide for a dBFS value over -48..0, with `!`
 * in the last cell when the peak clips.
 */
export function meterBar(db: number, width: number, clipped = false): string {
  const cells = Math.max(1, width);
  const fill = Math.round(
    Math.max(0, Math.min(1, (db + 48) / 48)) * (clipped ? cells - 1 : cells),
  );
  const bar = "█".repeat(fill) + "·".repeat(Math.max(0, cells - fill));
  return clipped ? `${bar.slice(0, cells - 1)}!` : bar;
}
