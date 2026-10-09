/**
 * Audio clips and lyrics (0.7 clips lane): the pure, render-free half.
 * Placement on the tempo map, the section cuts (`mapClips`, `sliceClips`)
 * that sections, forms and render windows apply beside `slicePedals`,
 * clip repeats, dB gain helpers and the lyric grammar that `/lyrics`, the
 * SDK's `lyrics()` and `set_lyrics` share. The renderer is
 * src/audio/clips.ts.
 */
import type { AudioClip, Note, SampleRef, Track } from "./score.ts";
import { SCORE_LIMITS, TrackScore } from "./score.ts";
import {
  secondsAtTick,
  tickAtSeconds,
  type TimeScore,
  type TrackTime,
} from "./tempo.ts";

/** Sample-bank voice name prefix a clip's audio loads under. */
export const CLIP_VOICE_PREFIX = "clip:";

/** The sample reference a clip's audio loads through. */
export function clipSampleRef(clip: AudioClip): SampleRef {
  return { src: clip.src, sha256: clip.sha256 };
}

/** The instrument whose notes are guides: silent in a render (0.7). */
export const GUIDE_INSTRUMENT = "vocal";

/** True for an instrument whose notes only guide its clips. */
export function isGuideInstrument(instrument: string | undefined): boolean {
  return instrument === GUIDE_INSTRUMENT;
}

/**
 * The `vocal` default chain (sources.md section 4): a 90 Hz high-pass for
 * rumble and plosives, a 3:1 compressor, a short plate. Fills only the
 * fields a track does not set, so choosing `vocal` never undoes a mix.
 */
export function vocalChainPatch(
  track: Readonly<Pick<Track, "filter" | "fx" | "reverb">> | undefined,
): Partial<Pick<Track, "filter" | "fx" | "reverb">> {
  const patch: Partial<Pick<Track, "filter" | "fx" | "reverb">> = {};
  if (!track?.filter)
    Object.assign(patch, {
      filter: { cutoff: 90, resonance: 0, type: "hpf" },
    });
  if (!track?.fx?.compressor)
    Object.assign(patch, {
      fx: {
        ...(track?.fx ?? {}),
        compressor: {
          threshold: -18,
          ratio: 3,
          attack: 0.01,
          release: 0.15,
          makeup: 3,
        },
      },
    });
  if (!track?.reverb)
    Object.assign(patch, {
      reverb: { mix: 0.14, size: 0.4, ir: { src: "builtin:plate" } },
    });
  return patch;
}

/** A clip's fade when it sets none: 5 ms, so a cut never clicks. */
export const DEFAULT_CLIP_FADE = 0.005;
/** The fade a section, form or window edge puts on a clip it cuts. */
export const CLIP_EDGE_FADE = 0.005;
/** Peak an imported clip's gain targets, in dBFS. */
export const IMPORT_PEAK_DBFS = -6;
/** The clip gain range every surface accepts, in dB (/clip, menu, tools). */
export const CLIP_GAIN_MIN_DB = -60;
export const CLIP_GAIN_MAX_DB = 12;

// ---------------------------------------------------------------------------
// Gain in dB (commands and tools speak dB; the score stores linear)

/** Linear clip gain for `db` dB, clamped to the clip gain range. */
export function dbToClipGain(db: number): number {
  return Math.max(0, Math.min(SCORE_LIMITS.maxClipGain, 10 ** (db / 20)));
}

/** dB for a linear clip gain (`-inf` for 0), rounded to 0.1 dB. */
export function clipGainDb(gain: number): number {
  if (gain <= 0) return -Infinity;
  return Math.round(20 * Math.log10(gain) * 10) / 10;
}

/** Clip gain that brings a file peaking at `peak` (linear) to -6 dBFS. */
export function importGain(peak: number): number | undefined {
  if (!(peak > 0)) return undefined;
  const gain = 10 ** (IMPORT_PEAK_DBFS / 20) / peak;
  const rounded = Math.round(gain * 1000) / 1000;
  if (Math.abs(rounded - 1) < 0.001) return undefined;
  return Math.max(0.001, Math.min(SCORE_LIMITS.maxClipGain, rounded));
}

// ---------------------------------------------------------------------------
// Placement

/**
 * A clip's start in song ticks: its `startTick`, moved by the track's
 * tempo ratio and phase the way the first pass of a note is
 * (`phase + start / rate`). Clips do not repeat with a track `cycle`;
 * `repeatAudio` and `/clip repeat` write repeats out.
 */
export function clipSongTick(clip: AudioClip, time?: TrackTime): number {
  if (!time) return clip.startTick;
  const rate = time.rate ?? 1;
  return Math.max(0, (time.phase ?? 0) + clip.startTick / rate);
}

/** Seconds a clip plays: `dur`, else the file from `offset` to its end. */
export function clipLength(
  clip: AudioClip,
  fileSeconds: number = SCORE_LIMITS.maxClipSeconds,
): number {
  const rest = Math.max(0, fileSeconds - (clip.offset ?? 0));
  return clip.dur === undefined ? rest : Math.min(clip.dur, rest);
}

/**
 * `score` with every clip that has no `dur` given its real length,
 * `seconds(trackId, clip) - offset`, where the file's length is known
 * (its audio loaded). Section, form and window cuts need the real end of
 * a clip: a reversed clip's cut moves its offset from the far end.
 * Clips whose audio is missing are left as they are (they render silent).
 */
export function resolveClipLengths(
  score: TrackScore,
  seconds: (trackId: string, clip: AudioClip) => number | undefined,
): TrackScore {
  let changed = false;
  const tracks = score.tracks.map((track) => {
    if (!track.clips?.some((clip) => clip.dur === undefined)) return track;
    const clips = track.clips.map((clip) => {
      if (clip.dur !== undefined) return clip;
      const file = seconds(track.id, clip);
      if (file === undefined || !(file > 0)) return clip;
      const dur =
        Math.round(Math.max(0, file - (clip.offset ?? 0)) * 1e6) / 1e6;
      if (!(dur > 0)) return clip;
      changed = true;
      return { ...clip, dur };
    });
    return { ...track, clips };
  });
  return changed ? new TrackScore({ ...score.toJSON(), tracks }) : score;
}

/** Song seconds where a clip starts and stops on `score`'s tempo map. */
export function clipSpan(
  score: TimeScore,
  clip: AudioClip,
  fileSeconds?: number,
  time?: TrackTime,
): { start: number; end: number } {
  const start = secondsAtTick(score, clipSongTick(clip, time));
  return { start, end: start + clipLength(clip, fileSeconds) };
}

/** The song tick where a clip stops (its end on the tempo map). */
export function clipEndTick(
  score: TimeScore,
  clip: AudioClip,
  fileSeconds?: number,
): number {
  return tickAtSeconds(score, clipSpan(score, clip, fileSeconds).end);
}

/** Track time baked into clip starts (for `bakeTrackTime`). */
export function bakeClipTime(track: Track): Track {
  if (!track.clips || !track.time) return track;
  const time = track.time;
  return {
    ...track,
    clips: track.clips.map((clip) => ({
      ...clip,
      startTick: Math.round(clipSongTick(clip, time)),
    })),
  };
}

// ---------------------------------------------------------------------------
// Section cuts

/** `fn` over a track's clips; `undefined` drops a clip. */
export function mapClips(
  track: Track,
  fn: (clip: AudioClip) => AudioClip | undefined,
): Track {
  if (!track.clips) return track;
  let changed = false;
  const out: AudioClip[] = [];
  for (const clip of track.clips) {
    const next = fn(clip);
    if (next !== clip) changed = true;
    if (next) out.push(next);
  }
  if (!changed) return track;
  const { clips: _clips, ...rest } = track;
  return out.length > 0 ? { ...rest, clips: out } : rest;
}

/** One stretch of source ticks `[from, to)` played at output tick `offset`. */
export type ClipPiece = Readonly<{
  from: number;
  to: number;
  offset: number;
  /** The piece's section mutes this track. */
  mute?: boolean;
  /** The piece's section variation gain. */
  gain?: number;
  /**
   * The piece's start is a render window's seam, not a section edge: a
   * clip sounding across it plays on without a fade.
   */
  seam?: boolean;
}>;

/**
 * Cut `clips` to `pieces`, as `slicePedals` cuts pedals: a clip starting in
 * a piece moves with it; a clip still sounding where a piece starts plays
 * on from the matching point of the file; a piece's end cuts it. Pieces
 * that run on in both source and output (a form playing a section into the
 * next one as written) join first, so straight-through music is never cut.
 * Each cut gets a 5 ms equal-power fade. Durations follow `time`, the
 * source score's tempo map (audio plays at natural speed).
 */
export function sliceClips(
  clips: readonly AudioClip[] | undefined,
  pieces: readonly ClipPiece[],
  time: TimeScore,
): AudioClip[] | undefined {
  if (!clips || clips.length === 0) return undefined;
  const joined: ClipPiece[] = [];
  for (const piece of pieces) {
    const last = joined.at(-1);
    if (
      last &&
      last.to === piece.from &&
      last.offset + (last.to - last.from) === piece.offset &&
      (last.mute ?? false) === (piece.mute ?? false) &&
      (last.gain ?? 1) === (piece.gain ?? 1)
    )
      joined[joined.length - 1] = { ...last, to: piece.to };
    else joined.push(piece);
  }
  const out: AudioClip[] = [];
  const ids = new Map<string, number>();
  for (const piece of joined) {
    if (piece.mute || piece.to <= piece.from) continue;
    const pieceStart = secondsAtTick(time, piece.from);
    const pieceEnd = secondsAtTick(time, piece.to);
    for (const clip of clips) {
      const { start, end } = clipSpan(time, clip);
      if (start >= pieceEnd || end <= pieceStart) continue;
      if (clip.startTick >= piece.to) continue;
      const cut = cutClip(
        clip,
        start,
        end,
        pieceStart,
        pieceEnd,
        piece.seam === true,
      );
      if (!cut) continue;
      const pass = (ids.get(clip.id) ?? 0) + 1;
      ids.set(clip.id, pass);
      const gain =
        piece.gain === undefined
          ? cut.gain
          : Math.min(SCORE_LIMITS.maxClipGain, (cut.gain ?? 1) * piece.gain);
      out.push({
        ...cut,
        id: pass === 1 ? clip.id : clipPassId(clip.id, pass),
        startTick:
          clip.startTick >= piece.from
            ? piece.offset + (clip.startTick - piece.from)
            : piece.offset,
        ...(gain === undefined || gain === 1 ? {} : { gain }),
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function clipPassId(id: string, pass: number): string {
  const suffix = `~${pass}`;
  return `${id.slice(0, SCORE_LIMITS.maxIdLength - suffix.length)}${suffix}`;
}

/**
 * `clip` (sounding `start..end` song seconds) cut to `from..to`, with edge
 * fades where it is cut. Undefined when nothing is left.
 */
export function cutClip(
  clip: AudioClip,
  start: number,
  end: number,
  from: number,
  to: number,
  seam = false,
): AudioClip | undefined {
  const head = Math.max(0, from - start);
  const tail = Math.max(0, end - to);
  if (head < 1e-9 && tail < 1e-9) return clip;
  const length = end - start - head - tail;
  if (length < 0.001) return undefined;
  const offset = clip.offset ?? 0;
  // A reversed clip plays offset+dur back to offset: cutting its head
  // shortens it from the far end of the window, cutting its tail moves
  // the window's start.
  // A reversed clip with no `dur` has an unknown end (its audio did not
  // load, so it renders silent): its offset is left alone rather than
  // measured from a made-up end. Loaded clips are resolved to a real
  // `dur` first (`resolveClipLengths`).
  const nextOffset = clip.rev
    ? clip.dur === undefined
      ? offset
      : offset + tail
    : offset + head;
  const rounded = (value: number) => Math.round(value * 1e6) / 1e6;
  const fit = (fade: number | undefined, cut: boolean) => {
    const value = cut ? CLIP_EDGE_FADE : (fade ?? DEFAULT_CLIP_FADE);
    return Math.min(value, length / 2);
  };
  // A seam continues the clip mid-play: what is left of its fade-in, as
  // a fade it can no longer express, is dropped (fades are 5 ms).
  const fadeInTime =
    seam && head > 1e-9 ? 0 : fit(clip.fadeInTime, head > 1e-9);
  const fadeTime = fit(clip.fadeTime, tail > 1e-9);
  return {
    ...clip,
    ...(nextOffset > 0 ? { offset: rounded(nextOffset) } : {}),
    dur: rounded(length),
    ...(head > 1e-9 || clip.fadeInTime !== undefined ? { fadeInTime } : {}),
    ...(tail > 1e-9 || clip.fadeTime !== undefined ? { fadeTime } : {}),
  };
}

// ---------------------------------------------------------------------------
// Repeats and ids

/** An unused clip id on `track`: `base`, `base2`, `base3`, ... */
/**
 * `clip` on `track` cut in two at song tick `tick` (5 ms equal-power fades
 * at the cut), the tail under a fresh id. `fileSeconds` is the file's
 * length when known, so a reversed clip without `dur` is cut against its
 * real end. A string says why it cannot split there.
 */
export function splitClip(
  score: TimeScore,
  track: Track,
  clip: AudioClip,
  tick: number,
  fileSeconds?: number,
): { head: AudioClip; tail: AudioClip } | string {
  const whole =
    clip.rev && clip.dur === undefined && fileSeconds !== undefined
      ? { ...clip, dur: Math.max(0.001, fileSeconds - (clip.offset ?? 0)) }
      : clip;
  const { start, end } = clipSpan(score, whole, fileSeconds, track.time);
  const at = secondsAtTick(score, tick);
  if (at <= start + 0.001 || at >= end - 0.001)
    return `clip ${clip.id} is not sounding there`;
  const head = cutClip(whole, start, end, start, at);
  const tail = cutClip(whole, start, end, at, end);
  if (!head || !tail) return `clip ${clip.id}: too short to split there`;
  return {
    head,
    tail: {
      ...tail,
      id: nextClipId(track, clip.id),
      startTick: Math.round(tickAtSeconds(score, at)),
    },
  };
}

export function nextClipId(track: Track, base = "clip"): string {
  const taken = new Set((track.clips ?? []).map((clip) => clip.id));
  const stem = base.slice(0, SCORE_LIMITS.maxIdLength - 4) || "clip";
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n += 1) if (!taken.has(`${stem}${n}`)) return `${stem}${n}`;
}

/**
 * Copies of `clip` every `every` ticks after it while they start before
 * `until` (a tick), with ids `<id>-r2`, `<id>-r3`, ... The clip itself is
 * not included.
 */
export function repeatClip(
  clip: AudioClip,
  every: number,
  until: number,
  taken: ReadonlySet<string> = new Set(),
): AudioClip[] {
  if (!(every > 0)) return [];
  const out: AudioClip[] = [];
  const used = new Set(taken);
  let pass = 2;
  for (
    let tick = clip.startTick + every;
    tick < until && out.length < SCORE_LIMITS.maxClipsPerTrack;
    tick += every
  ) {
    let id = `${clip.id.slice(0, SCORE_LIMITS.maxIdLength - 5)}-r${pass}`;
    for (let extra = 2; used.has(id); extra += 1)
      id = `${clip.id.slice(0, SCORE_LIMITS.maxIdLength - 8)}-r${pass}.${extra}`;
    used.add(id);
    out.push({ ...clip, id, startTick: Math.round(tick) });
    pass += 1;
  }
  return out;
}

export {
  parseLyric,
  autoSyllabify,
  assignLyrics,
  type LyricToken,
  type LyricAssignment,
} from "./lyrics.ts";

/** The lyric text the notes carry, in time order (`_` holds kept). */
export function lyricText(
  notes: readonly Pick<Note, "startTick" | "pitch" | "lyric">[],
): string {
  return [...notes]
    .filter((note) => note.lyric !== undefined)
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)
    .map((note) => note.lyric)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Bar edits (insertBars, deleteBars, copyBars move clips as they move notes)

/** Clips starting at or after `at` move `shift` ticks later. */
export function insertClipBars(track: Track, at: number, shift: number): Track {
  return mapClips(track, (clip) =>
    clip.startTick >= at
      ? { ...clip, startTick: clip.startTick + shift }
      : clip,
  );
}

/**
 * Bars `[at, end)` go: a clip starting there goes with them, a later clip
 * moves back. A clip starting earlier keeps its place and plays on.
 */
export function deleteClipBars(track: Track, at: number, end: number): Track {
  return mapClips(track, (clip) =>
    clip.startTick >= end
      ? { ...clip, startTick: clip.startTick - (end - at) }
      : clip.startTick >= at
        ? undefined
        : clip,
  );
}

/**
 * Clips starting in `[from, from + length)` are copied to `to` with fresh
 * ids; clips that started in the destination are replaced.
 */
export function copyClipBars(
  track: Track,
  from: number,
  length: number,
  to: number,
): Track {
  if (!track.clips) return track;
  const sources = track.clips.filter(
    (clip) => clip.startTick >= from && clip.startTick < from + length,
  );
  if (sources.length === 0) return track;
  const kept = track.clips.filter(
    (clip) => clip.startTick < to || clip.startTick >= to + length,
  );
  const used = new Set(kept.map((clip) => clip.id));
  const fresh = (id: string): string => {
    const stem = id.replace(/-c\d+$/u, "").slice(0, 24);
    for (let n = 2; ; n += 1) {
      const next = `${stem}-c${n}`;
      if (!used.has(next) && !sources.some((clip) => clip.id === next)) {
        used.add(next);
        return next;
      }
    }
  };
  const copies = sources.map((clip) => ({
    ...clip,
    id: fresh(clip.id),
    startTick: clip.startTick - from + to,
  }));
  return { ...track, clips: [...kept, ...copies] };
}
