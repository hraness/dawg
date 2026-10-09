/**
 * 0.7 autotune render hooks (pitch.md section 7): the sampler calls
 * `autotuneVoice` after the 0.6.1 shift step, and the clips renderer calls
 * `autotuneClip` per clip. Both track the played buffer with the pitch
 * engine, build targets (scale through the 0.5 tuning, the chord timeline,
 * or guide notes through the tempo map), run `autotuneBuffer` from
 * core/autotune.ts and keep the result in a tuned-span cache with its own
 * 128 MB budget. A track without `autotune` never reaches this module.
 *
 * The pitch tracker and PSOLA belong to the pitch lane
 * (src/audio/dsp/pitch.ts, src/audio/dsp/psola.ts, src/audio/analysis.ts).
 * They reach this module as `builtinPitchEngine` (./autotune-engine.ts);
 * tests swap it with `setPitchEngine`, and without an engine every hook
 * returns the buffer untuned.
 */
import {
  autotuneDigest,
  autotuneJob,
  centsOfHz,
  classGrid,
  chromaticGrid,
  resolveAutotune,
  scaleGrid,
  type AutotuneCurve,
  type AutotuneTargets,
  type GuideNote,
  type PsolaJob,
  type PsolaShift,
  type ResolvedAutotune,
} from "../../core/autotune.ts";
import { parseKey } from "../../core/chords.ts";
import type { Track, TrackScore } from "../../core/score.ts";
import { secondsAtTick, tickAtSeconds } from "../../core/tempo.ts";
import {
  noteHz,
  resolveTuning,
  tuningPreset,
  type TuningTable,
} from "../../core/tuning.ts";
import { deferLiveJob, liveFitActive } from "./fit.ts";
import { builtinPitchEngine } from "./autotune-engine.ts";
import { chordAt, chordDigest, chordTimeline } from "./granular.ts";

/** Tuned buffers stay under this many bytes (separate from the fit cache). */
export const AUTOTUNE_CACHE_BYTES = 128 * 1024 * 1024;

/** Live tunes buffers up to this long at once; longer ones run between blocks. */
export const LIVE_SYNC_AUTOTUNE_SECONDS = 0.25;

/** Source seconds kept either side of a timed span (PSOLA grains, glides). */
export const AUTOTUNE_SPAN_MARGIN_SECONDS = 0.05;

/**
 * A buffer the engine tracks. `id` names the audio itself when it is not
 * the decoded file (a shifted or fitted copy keeps the file's `sha256` but
 * not its audio); the engine keys curves by `id ?? sha256`. Without either
 * the buffer keys by identity.
 */
export type TunableBuffer = Readonly<{
  id?: string;
  sha256?: string;
  sampleRate: number;
  mono: Float32Array;
  /** Stereo channels, tuned with the mono curve when present. */
  left?: Float32Array;
  right?: Float32Array;
}>;

/** Tuned audio: `from` is the buffer frame its first frame came from. */
export type TunedAudio = Readonly<{
  mono: Float32Array;
  left?: Float32Array;
  right?: Float32Array;
  from: number;
}>;

/**
 * What the pitch lane provides: a curve for a buffer and the PSOLA pass.
 * With `defer` (the live path) the engine must not analyse synchronously:
 * it returns undefined and analyses in the background until the curve is
 * ready. `psolaJob`, when given, is the resumable form of `psola` (same
 * output) the live scheduler runs in slices. `version` joins every cache
 * and stem key.
 */
export type PitchEngine = Readonly<{
  version: string;
  curve(
    buffer: TunableBuffer,
    voice: ResolvedAutotune["voice"],
    options?: Readonly<{ defer?: boolean }>,
  ): AutotuneCurve | undefined;
  psola: PsolaShift;
  psolaJob?: PsolaJob;
}>;

let engine: PitchEngine | undefined = builtinPitchEngine;

/**
 * Installs a pitch engine (tests); `undefined` leaves autotune inert and
 * `builtinPitchEngine` restores the default.
 */
export function setPitchEngine(next: PitchEngine | undefined): void {
  engine = next;
  clearAutotuneCache();
}

/** The installed engine, if any. */
export function pitchEngine(): PitchEngine | undefined {
  return engine;
}

/**
 * Receipt suffix for the command, menu and agent tool: says so when the
 * build has no pitch engine and the settings cannot change the audio yet.
 */
export function autotuneEngineNote(): string {
  return engine
    ? ""
    : " · no pitch tracker in this build: settings saved, audio plays untuned";
}

const cache = new Map<string, TunedAudio>();
let cachedBytes = 0;
const counters = { hits: 0, misses: 0, tuned: 0 };

/** Empties the tuned-span cache. */
export function clearAutotuneCache(): void {
  cache.clear();
  cachedBytes = 0;
  counters.hits = 0;
  counters.misses = 0;
  counters.tuned = 0;
}

/** Bytes held and hit counts, for /pack cache and tests. */
export function autotuneCacheStatus(): Readonly<{
  bytes: number;
  entries: number;
  hits: number;
  misses: number;
  tuned: number;
}> {
  return { bytes: cachedBytes, entries: cache.size, ...counters };
}

function bytesOf(audio: TunedAudio): number {
  return (
    audio.mono.byteLength +
    (audio.left?.byteLength ?? 0) +
    (audio.right?.byteLength ?? 0)
  );
}

function remember(key: string, out: TunedAudio): void {
  const size = bytesOf(out);
  if (size > AUTOTUNE_CACHE_BYTES) return;
  const old = cache.get(key);
  if (old) {
    cache.delete(key);
    cachedBytes -= bytesOf(old);
  }
  cache.set(key, out);
  cachedBytes += size;
  for (const [stale, audio] of cache) {
    if (cachedBytes <= AUTOTUNE_CACHE_BYTES) break;
    cache.delete(stale);
    cachedBytes -= bytesOf(audio);
  }
}

/** Buffers without an id or content hash key by identity. */
const bufferIds = new WeakMap<Float32Array, string>();
let bufferSerial = 0;

function bufferId(buffer: TunableBuffer): string {
  if (buffer.id) return `id:${buffer.id}`;
  if (buffer.sha256) return `${buffer.sha256}:${buffer.mono.length}`;
  let id = bufferIds.get(buffer.mono);
  if (id === undefined)
    bufferIds.set(buffer.mono, (id = `buf#${(bufferSerial += 1)}`));
  return id;
}

/** FNV-1a of a string, for digests that would otherwise grow with a song. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1)
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/**
 * Where a buffer plays in the song: buffer second `b` sounds at song
 * second `start + (b - offset) / rate`, at `rate` times its pitch.
 */
export type Placement = Readonly<{
  /** Song seconds the buffer's `offset` sounds at. */
  start: number;
  /** Buffer seconds that play first (region begin, clip offset). */
  offset: number;
  /** Playback rate: 2 is an octave up and twice as fast (tape). */
  rate: number;
}>;

/** The targets source a track uses, before placement. */
type TargetPlan =
  | Readonly<{ kind: "static"; digest: string; targets: AutotuneTargets }>
  | Readonly<{
      kind: "timed";
      digest: string;
      build(p: Placement): AutotuneTargets;
    }>;

/** The track the guide notes come from: `from`, else the track itself. */
function guideTrack(
  score: TrackScore,
  track: Track,
  r: ResolvedAutotune,
): Track | undefined {
  if (r.from === undefined) return track;
  return score.tracks.find((other) => other.id === r.from);
}

/** Guide notes in song seconds, cents re A440 through the guide's tuning. */
export function guideNotes(
  score: TrackScore,
  guide: Track,
): readonly GuideNote[] {
  const table = resolveTuning(score.tuning, guide.tuning, score.key);
  const out: GuideNote[] = [];
  for (const note of score.notes) {
    if (note.trackId !== guide.id || note.durationTicks <= 0) continue;
    const start = secondsAtTick(score, note.startTick);
    const end = secondsAtTick(score, note.startTick + note.durationTicks);
    out.push({
      start,
      end,
      cents: centsOfHz(noteHz(note.pitch, note.cents, table)),
      ...(note.drift !== undefined ? { drift: note.drift } : {}),
      ...(note.articulation === "ghost" ? { ghost: true } : {}),
      ...(note.glide !== undefined ? { glide: note.glide } : {}),
      ...(note.vibrato
        ? {
            vib: note.vibrato.rate,
            vibmod: note.vibrato.depth / 100,
            ...(note.vibrato.delay ? { vibDelay: note.vibrato.delay } : {}),
          }
        : {}),
    });
  }
  return out.sort((a, b) => a.start - b.start || a.cents - b.cents);
}

/** Whether the track has notes of its own to guide `to: notes`. */
export function hasGuideNotes(score: TrackScore, trackId: string): boolean {
  return score.notes.some(
    (note) => note.trackId === trackId && note.durationTicks > 0,
  );
}

function guideDigest(notes: readonly GuideNote[]): string {
  return `guide:${notes.length}:${fnv(
    notes
      .map(
        (n) =>
          `${n.start.toFixed(6)}-${n.end.toFixed(6)}@${n.cents.toFixed(3)}${n.drift !== undefined ? `d${n.drift}` : ""}${n.ghost ? "g" : ""}${n.glide !== undefined ? `l${n.glide}` : ""}${n.vib !== undefined ? `v${n.vib}/${n.vibmod}/${n.vibDelay ?? 0}` : ""}`,
      )
      .join(","),
  )}`;
}

function tableDigest(table: TuningTable | undefined): string {
  if (!table) return "12tet";
  return `tun:${fnv(Array.from(table.hz, (hz) => hz.toFixed(6)).join(","))}`;
}

/**
 * The scale preset a key override brings when neither the song nor the
 * track sets a tuning (`key D bayati` targets bayati's quarter tones,
 * `key C yaman` its shruti intonation). Undefined otherwise.
 */
export function autotuneKeyTuning(
  score: TrackScore,
  track: Track,
): string | undefined {
  const keyText = track.autotune?.key;
  if (!keyText || score.tuning || track.tuning) return undefined;
  const scale = parseKey(keyText)?.scale;
  return scale && tuningPreset(scale) ? scale : undefined;
}

function tableFor(
  score: TrackScore,
  track: Track,
  r: ResolvedAutotune,
): TuningTable | undefined {
  const preset = autotuneKeyTuning(score, track);
  if (preset) return resolveTuning({ name: preset }, undefined, r.key);
  return resolveTuning(score.tuning, track.tuning, score.key);
}

/**
 * The score the chord target reads: without the tuned track, the track
 * it follows and every vocal track, so sung and guide pitches never count
 * as chord tones.
 */
function chordSource(
  score: TrackScore,
  track: Track,
  r: ResolvedAutotune,
): Readonly<{ score: TrackScore; excluded: readonly string[] }> {
  const excluded = new Set<string>([track.id]);
  if (r.from !== undefined) excluded.add(r.from);
  for (const other of score.tracks)
    if (other.instrument === "vocal" || other.autotune) excluded.add(other.id);
  // chordTimeline skips muted tracks: mute the excluded ones in a copy.
  const source = score.withTracks(
    score.tracks.map((other) =>
      excluded.has(other.id) ? { ...other, muted: true } : other,
    ),
  );
  return { score: source, excluded: [...excluded].sort() };
}

/** Plans per score, by track and settings (a note-on reuses its plan). */
const plans = new WeakMap<TrackScore, Map<string, TargetPlan>>();

function plan(
  score: TrackScore,
  track: Track,
  r: ResolvedAutotune,
): TargetPlan {
  let known = plans.get(score);
  if (!known) plans.set(score, (known = new Map()));
  const memo = `${track.id}|${autotuneDigest(r)}|${JSON.stringify(track.tuning ?? null)}`;
  const hit = known.get(memo);
  if (hit) return hit;
  const made = buildPlan(score, track, r);
  known.set(memo, made);
  return made;
}

function buildPlan(
  score: TrackScore,
  track: Track,
  r: ResolvedAutotune,
): TargetPlan {
  const table = tableFor(score, track, r);
  if (r.to === "chromatic")
    return {
      kind: "static",
      digest: `chromatic:${tableDigest(table)}`,
      targets: { kind: "grid", grid: chromaticGrid(table) },
    };
  if (r.to === "scale") {
    const keyText = r.key ?? score.key;
    return {
      kind: "static",
      digest: `scale:${keyText ?? ""}:${tableDigest(table)}`,
      targets: { kind: "grid", grid: scaleGrid(keyText, table) },
    };
  }
  if (r.to === "chord") {
    const source = chordSource(score, track, r);
    const timeline = chordTimeline(source.score);
    const fallback = scaleGrid(r.key ?? score.key, table);
    const grids = new Map<string, ReturnType<typeof classGrid>>();
    return {
      kind: "timed",
      digest: `chord:${fnv(`${source.excluded.join(",")}|${chordDigest(timeline)}`)}:${r.key ?? score.key ?? ""}:${tableDigest(table)}`,
      build: (p) => ({
        kind: "grid",
        grid: (seconds: number) => {
          const song = p.start + (seconds - p.offset) / p.rate;
          const classes = chordAt(timeline, tickAtSeconds(score, song));
          if (classes.length === 0) return fallback;
          const id = classes.join(".");
          let grid = grids.get(id);
          if (!grid) grids.set(id, (grid = classGrid(classes, table)));
          return grid;
        },
      }),
    };
  }
  const guide = guideTrack(score, track, r);
  const notes = guide ? guideNotes(score, guide) : [];
  return {
    kind: "timed",
    digest: guideDigest(notes),
    build: (p) => {
      // Only the notes that reach the buffer's span (song seconds).
      const out: GuideNote[] = [];
      for (const n of notes)
        out.push({
          ...n,
          start: p.offset + (n.start - p.start) * p.rate,
          end: p.offset + (n.end - p.start) * p.rate,
        });
      return { kind: "notes", notes: out };
    },
  };
}

/**
 * Stem-key digests for a track with autotune: the engine version and the
 * targets it reads (guide notes, chord timeline, key and tuning). Track
 * settings already join the key with the track; clip offsets, latency and
 * nudge join through the clips' own digests (`autotuneClipDigest`).
 */
export function autotuneStemDigests(
  track: Track,
  score: TrackScore,
): readonly string[] {
  if (!track.autotune) return [];
  const r = resolveAutotune(track.autotune);
  return [
    `autotune:${engine?.version ?? "none"}`,
    plan(score, track, r).digest,
  ];
}

/** A curve with every voiced f0 times `rate` (the pitch it sounds at). */
function atRate(curve: AutotuneCurve, rate: number): AutotuneCurve {
  if (rate === 1) return curve;
  const f0 = new Float32Array(curve.f0.length);
  for (let f = 0; f < f0.length; f += 1) {
    const hz = curve.f0[f]!;
    f0[f] = hz > 0 ? hz * rate : 0;
  }
  return { ...curve, f0 };
}

/** The frames of `curve` covering buffer seconds [from, to), re-based to `from`. */
export function sliceCurve(
  curve: AutotuneCurve,
  from: number,
  to: number,
): AutotuneCurve {
  const n = curve.f0.length;
  const a = Math.max(0, Math.floor((from - curve.t0) / curve.hop) - 1);
  const b = Math.min(n, Math.ceil((to - curve.t0) / curve.hop) + 2);
  if (a === 0 && b === n && from === 0) return curve;
  const take = (x: ArrayLike<number>) =>
    Array.prototype.slice.call(x, a, Math.max(a, b)) as number[];
  return {
    t0: curve.t0 + a * curve.hop - from,
    hop: curve.hop,
    f0: Float32Array.from(take(curve.f0)),
    prob: Uint8Array.from(take(curve.prob)),
    aperiodic: Uint8Array.from(take(curve.aperiodic)),
  };
}

/** Buffer frames [from, to) a voice reads (timed targets tune only these). */
export type Span = Readonly<{ from: number; to: number }>;

function untuned(buffer: TunableBuffer): TunedAudio {
  return {
    mono: buffer.mono,
    ...(buffer.left ? { left: buffer.left } : {}),
    ...(buffer.right ? { right: buffer.right } : {}),
    from: 0,
  };
}

/**
 * The tuned copy of `buffer` (or of its `span` for timed targets), or the
 * buffer itself when nothing moves, there is no engine, the curve is not
 * ready, or a live job is still running.
 */
export function autotuneSpan(
  score: TrackScore,
  track: Track,
  buffer: TunableBuffer,
  placement: Placement,
  extraKey = "",
  span?: Span,
): TunedAudio {
  const settings = track.autotune;
  const pitch = engine;
  if (!settings || !pitch) return untuned(buffer);
  const r = resolveAutotune(settings);
  const targetPlan = plan(score, track, r);
  const timed = targetPlan.kind === "timed";
  const sr = buffer.sampleRate;
  const length = buffer.mono.length;
  // Timed targets differ per placement, so each voice tunes only what it
  // reads (plus a margin); static targets share one whole-buffer result.
  const margin = Math.round(AUTOTUNE_SPAN_MARGIN_SECONDS * sr);
  const from = timed && span ? Math.max(0, Math.floor(span.from) - margin) : 0;
  const to =
    timed && span ? Math.min(length, Math.ceil(span.to) + margin) : length;
  if (to <= from) return untuned(buffer);
  const key = [
    "at",
    bufferId(buffer),
    sr,
    buffer.left && buffer.right ? "st" : "mo",
    placement.rate.toFixed(9),
    timed
      ? `${placement.start.toFixed(6)}:${placement.offset.toFixed(6)}:${from}-${to}`
      : "",
    pitch.version,
    autotuneDigest(r),
    targetPlan.digest,
    extraKey,
  ].join("|");
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    counters.hits += 1;
    return hit;
  }
  counters.misses += 1;
  const live = liveFitActive();
  // Live, the engine analyses in the background: untuned until ready.
  const whole = pitch.curve(buffer, r.voice, live ? { defer: true } : {});
  if (!whole) return untuned(buffer);
  const curve = atRate(sliceCurve(whole, from / sr, to / sr), placement.rate);
  const local: Placement = {
    ...placement,
    offset: placement.offset - from / sr,
  };
  const targets = timed ? targetPlan.build(local) : targetPlan.targets;
  const cut = (x: Float32Array) =>
    from === 0 && to === length ? x : x.subarray(from, to);
  const job = function* (): Generator<void, TunedAudio> {
    counters.tuned += 1;
    const run = (x: Float32Array) =>
      autotuneJob(
        cut(x),
        sr,
        curve,
        targets,
        r,
        pitch.psola,
        12,
        pitch.psolaJob,
      );
    const source = cut(buffer.mono);
    const mono = yield* autotuneJob(
      source,
      sr,
      curve,
      targets,
      r,
      pitch.psola,
      12,
      pitch.psolaJob,
    );
    if (mono === source) {
      // nothing moves: the whole buffer plays as it is
      return untuned(buffer);
    }
    const left = buffer.left ? yield* run(buffer.left) : undefined;
    const right = buffer.right ? yield* run(buffer.right) : undefined;
    return {
      mono,
      ...(left && right ? { left, right } : {}),
      from,
    };
  };
  if (live && to - from > LIVE_SYNC_AUTOTUNE_SECONDS * sr) {
    // Until it lands the voice plays untuned, like a long 0.6.1 shift.
    deferLiveJob(key, job, (out) => remember(key, out));
    return untuned(buffer);
  }
  const steps = job();
  for (;;) {
    const step = steps.next();
    if (step.done) {
      remember(key, step.value);
      return step.value;
    }
  }
}

/**
 * Sampler hook: the voice's played buffer (after fit and shift) tuned at
 * the pitch and place it sounds. `rate` is the voice's source frames per
 * output second over the source rate; `regionStart` in source frames;
 * `span` the source frames the voice can read.
 */
export function autotuneVoice(
  score: TrackScore,
  track: Track,
  buffer: TunableBuffer,
  startSeconds: number,
  regionStart: number,
  rate: number,
  span?: Span,
): TunedAudio {
  return autotuneSpan(
    score,
    track,
    buffer,
    {
      start: startSeconds,
      offset: regionStart / buffer.sampleRate,
      rate,
    },
    "",
    span,
  );
}

/** The key part of a clip's placement (offset, latency and nudge). */
export function autotuneClipDigest(
  offsetSeconds: number,
  latencySeconds = 0,
  nudgeSeconds = 0,
): string {
  return `o${offsetSeconds.toFixed(6)}l${latencySeconds.toFixed(6)}n${nudgeSeconds.toFixed(6)}`;
}

/**
 * Clip hook (for src/audio/clips.ts `renderClips`, per clip): `buffer` is
 * the clip's audio and `startSeconds` the song second its clip offset
 * sounds at, after latency and nudge (`startTick` seconds + latency +
 * nudge). Offset, latency and nudge join the key.
 */
export function autotuneClip(
  score: TrackScore,
  track: Track,
  buffer: TunableBuffer,
  startSeconds: number,
  offsetSeconds: number,
  clipKey = "",
  latencySeconds = 0,
  nudgeSeconds = 0,
): TunedAudio {
  return autotuneSpan(
    score,
    track,
    buffer,
    { start: startSeconds, offset: offsetSeconds, rate: 1 },
    `clip:${clipKey}:${autotuneClipDigest(offsetSeconds, latencySeconds, nudgeSeconds)}`,
  );
}
