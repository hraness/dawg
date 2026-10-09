/**
 * Arranged rendering: what playback and export hear when the song has
 * section mutes or variations, a form, or a looped section. A song with
 * none of those takes exactly today's render call, so 0.4 projects render
 * byte-identically.
 *
 * Long arrangements render in bar-aligned windows, each with a pre-roll
 * that carries held notes and tails across the seam, so memory stays
 * bounded however long the form plays (up to MAX_SONG_SECONDS).
 */
import { withClipLengths } from "./clips.ts";
import {
  SCORE_LIMITS,
  ScoreValidationError,
  TrackScore,
  type Note,
  withNoteCap,
} from "../../core/score.ts";
import {
  MAX_SONG_SECONDS,
  applySectionChanges,
  arrangedBars,
  arrangedNotes,
  arrangedSlice,
  BAKED_NOTE_CAP,
  bakeTrackTime,
  barBeats,
  barTicks,
  barsToSeconds,
  findSection,
  flattenForm,
  formPositionAt,
  formSegments,
  sectionScore,
  sliceSongTime,
} from "../../core/sections.ts";
import {
  barStartTick,
  bpmAtTick,
  loopSecondsOf,
  loopTicksOf,
  secondsAtTick,
  type TimeScore,
} from "../../core/tempo.ts";
import {
  RENDER_CHANNELS,
  StemRenderer,
  clampSampleRate,
  encodeWav,
  masterSummedPcm,
  type RenderOptions,
  type RenderedAudio,
  type WavCue,
} from "./wav.ts";
import { engineFor } from "./instruments.ts";

/** What one default render pass holds before the renderer cuts it. */
const DEFAULT_PASS_SECONDS = 30;
/** Arrangements up to this long render in a single pass. */
const SINGLE_PASS_SECONDS = 45;
/** Bars per window aim for this many seconds. */
const WINDOW_SECONDS = 20;
/** Tail (release, delay, reverb, ducking) a window's pre-roll covers. */
const OVERHANG_SECONDS = 8;
/** Crossfade where a window restarts a note held from beyond its reach. */
const SEAM_FADE_SECONDS = 0.05;
/** Most seconds a window renders, pre-roll included (the renderer caps 60). */
const WINDOW_BUDGET_SECONDS = 50;

/** The score as export hears it: the form baked in, section changes applied. */
export function exportScore(score: TrackScore): TrackScore {
  // A form past the score's bar limit throws here; renderArranged renders
  // such forms window by window instead, so it never needs this.
  return withNoteCap(BAKED_NOTE_CAP, () => flattenForm(bakeTrackTime(score)));
}

/**
 * Section starts as WAV cues, in playback order (the form's passes when it
 * has one). Empty without sections, or when the form is too long to flatten.
 */
export function sectionCues(
  score: TrackScore,
  sampleRate: number,
): readonly WavCue[] {
  if (score.sections.length === 0) return [];
  let flat: TrackScore;
  try {
    flat = exportScore(score);
  } catch {
    return [];
  }
  const end = loopTicksOf(flat);
  return flat.sections
    .map((section) => ({
      tick: barStartTick(flat, section.startBar),
      label: section.name,
    }))
    .filter((cue) => cue.tick < end)
    .map((cue) => ({
      frame: Math.round(secondsAtTick(flat, cue.tick) * sampleRate),
      label: cue.label,
    }));
}

/** The section playback loops, when `loopSection` names one. */
export function loopedSection(score: TrackScore) {
  return score.loopSection === undefined
    ? undefined
    : findSection(score, score.loopSection);
}

/** The score as playback loops it: the looped section, else the export. */
export function playbackScore(score: TrackScore): TrackScore {
  const section = loopedSection(score);
  return section
    ? withNoteCap(BAKED_NOTE_CAP, () =>
        sectionScore(bakeTrackTime(score), section),
      )
    : exportScore(score);
}

/**
 * The timeline the transport runs on: the looped section, the whole form
 * (which may be longer than a score allows), else the song. Its tempo map
 * drives the transport clock, so beats and seconds agree with what plays.
 */
export function playbackTime(score: TrackScore): TimeScore {
  const section = loopedSection(score);
  if (section) return sectionScore(score, section);
  const segments = formSegments(score);
  if (segments.length === 0) return score;
  const ticks = barTicks(score);
  const timed = sliceSongTime(
    score,
    segments.map((segment) => ({
      from: segment.section.startBar * ticks,
      to: (segment.section.startBar + segment.bars) * ticks,
      offset: segment.startBar * ticks,
    })),
  );
  return {
    tempoBpm: timed.tempoBpm,
    beatsPerBar: score.beatsPerBar,
    bars: arrangedBars(score),
    ticksPerBeat: score.ticksPerBeat,
    ...(timed.time ? { time: timed.time } : {}),
  };
}

/**
 * The score beat the highway shows for transport `beat`: inside the looped
 * section, or the matching beat of the form pass that is playing. Songs
 * without a form or section loop get `beat` back unchanged.
 */
export function scoreBeatAt(score: TrackScore, beat: number): number {
  const section = loopedSection(score);
  const perBar = barBeats(score);
  if (section) {
    const length = section.bars * perBar;
    const phase = Number.isFinite(beat)
      ? ((beat % length) + length) % length
      : 0;
    return section.startBar * perBar + phase;
  }
  if (score.form.length === 0) return beat;
  return formPositionAt(score, beat).scoreBeat;
}

/**
 * Render `score` as it is arranged. `loop` renders what playback loops (the
 * looped section, else the form); one-shot renders what export writes (the
 * form; the section loop is ignored).
 */
export function renderArranged(
  renderer: StemRenderer,
  score: TrackScore,
  options: RenderOptions = {},
): RenderedAudio {
  // Clips cut at sections, forms and windows need their files' real ends.
  score = withClipLengths(score, options.samples);
  if (
    !(options.loop && loopedSection(score)) &&
    formSegments(score).length === 0 &&
    applySectionChanges(score) === score &&
    fitsOnePass(renderer, score, options)
  )
    return renderer.render(score, options);
  // Baked timed tracks (cycle, rate) may hold more notes than a stored score.
  return withNoteCap(BAKED_NOTE_CAP, () =>
    renderArrangedBaked(renderer, score, options),
  );
}

function renderArrangedBaked(
  renderer: StemRenderer,
  score: TrackScore,
  options: RenderOptions,
): RenderedAudio {
  score = bakeTrackTime(score);
  const section = options.loop ? loopedSection(score) : undefined;
  if (!section && formSegments(score).length > 0)
    return renderForm(renderer, score, options);
  let played = section
    ? sectionScore(score, section)
    : applySectionChanges(score);
  if (played === score && fitsOnePass(renderer, score, options))
    return renderer.render(score, options);
  const ticks = barTicks(played);
  const seconds = secondsAtTick(played, played.bars * ticks);
  if (seconds > MAX_SONG_SECONDS)
    throw new ScoreValidationError(
      `the song plays ${Math.round(seconds)} s; the limit is ${MAX_SONG_SECONDS} s`,
      "score-limit",
    );
  if (seconds <= SINGLE_PASS_SECONDS)
    return renderer.render(played, { ...options, maxSeconds: 60 });
  // Windows pick notes by start tick, so timed tracks (cycle, rate) must be
  // placed into song ticks first, sections or not.
  played = bakeTrackTime(played, { always: true });
  return renderWindows(
    renderer,
    played,
    played,
    played.bars,
    (from, to) =>
      played.notes.filter(
        (note) => note.startTick >= from * ticks && note.startTick < to * ticks,
      ),
    (from, bars) =>
      sectionScore(played, { name: "window", startBar: from, bars }),
    options,
  );
}

/**
 * Whether a single default pass (capped at 30 s) holds all of `score`: the
 * loop for playback, the song plus its tail for export. A caller's own
 * `maxSeconds` is a deliberate cap and always takes the single pass. Longer
 * songs render in windows instead of being cut at 30 s.
 */
function fitsOnePass(
  renderer: StemRenderer,
  score: TrackScore,
  options: RenderOptions,
): boolean {
  if (options.maxSeconds !== undefined) return true;
  return options.loop
    ? loopSecondsOf(score) <= DEFAULT_PASS_SECONDS
    : renderer.oneShotSeconds(score, options) <= DEFAULT_PASS_SECONDS;
}

/**
 * A form renders window by window straight from its sections, never as one
 * baked score, so a form may run past the score's bar and note limits (up to
 * MAX_SONG_SECONDS).
 */
function renderForm(
  renderer: StemRenderer,
  score: TrackScore,
  options: RenderOptions,
): RenderedAudio {
  const total = arrangedBars(score);
  const timeline = playbackTime(score);
  const seconds = secondsAtTick(timeline, total * barTicks(score));
  if (seconds > MAX_SONG_SECONDS)
    throw new ScoreValidationError(
      `the form plays ${Math.round(seconds)} s; the limit is ${MAX_SONG_SECONDS} s`,
      "score-limit",
    );
  return renderWindows(
    renderer,
    score,
    timeline,
    total,
    (from, to) => arrangedNotes(score, from, to),
    (from, bars) => arrangedSlice(score, from, bars, 0),
    options,
  );
}

/** `renderScorePcm` for arranged songs. */
export function renderArrangedPcm(
  score: TrackScore,
  options: RenderOptions = {},
): RenderedAudio {
  return renderArranged(new StemRenderer({ maxCacheBytes: 0 }), score, options);
}

/** `renderScoreWav` for arranged songs: what `dawg render` writes. */
export function renderArrangedWav(
  score: TrackScore,
  options: Omit<RenderOptions, "loop"> = {},
): Uint8Array {
  const audio = renderArrangedPcm(score, { ...options, loop: false });
  return encodeWav(audio.pcm, audio.sampleRate, RENDER_CHANNELS);
}

/**
 * Render a long arrangement as consecutive windows that each own a run of
 * output frames. A window starts rendering early enough (its pre-roll) to
 * include every note still sounding or ringing where its frames begin, so
 * held notes, release and effect tails, sidechain ducking and seeded noise
 * continue across the seams as in one pass; the pre-roll's own frames are
 * dropped. A note held longer than a window can reach back (about
 * WINDOW_BUDGET_SECONDS) restarts at the window's pre-roll instead of going
 * silent.
 *
 * `notesIn(from, to)` lists the notes starting in bars `from..to` at
 * absolute ticks, in render order; `frame(from, bars)` is the window's
 * score (tracks, automation, tempo) without notes. `timeline` places bars
 * in seconds. The song master runs once over the joined mix, as in one pass.
 */
function renderWindows(
  renderer: StemRenderer,
  score: TrackScore,
  timeline: TimeScore,
  totalBars: number,
  notesIn: (from: number, to: number) => Note[],
  frame: (from: number, bars: number) => TrackScore,
  options: RenderOptions,
): RenderedAudio {
  const sampleRate = clampSampleRate(options.sampleRate);
  const ticks = barTicks(score);
  // A tempo map changes how long bars are: ring and reach plan with the
  // fastest bars, window lengths with the slowest (renders stay <= 60 s).
  // Without one both are the song tempo, as before.
  const bpms = [
    score.tempoBpm,
    ...(timeline.time?.tempo ?? []).map((e) => e.bpm),
  ];
  const fermataStretch = timeline.time?.fermatas ? 2 : 1;
  const beatsPerBar = score.beatsPerBar;
  const fastBar = (beatsPerBar * 60) / Math.max(...bpms);
  const slowBar = ((beatsPerBar * 60) / Math.min(...bpms)) * fermataStretch;
  const frameAt = (bar: number) =>
    Math.round(secondsAtTick(timeline, bar * ticks) * sampleRate);
  const ring = Math.max(1, Math.ceil(OVERHANG_SECONDS / fastBar));
  const ringTicks = Math.ceil((OVERHANG_SECONDS / fastBar) * ticks);
  const budget = Math.max(1, Math.floor(WINDOW_BUDGET_SECONDS / slowBar));
  const reach = budget - 1;
  const most = Math.max(1, Math.floor(WINDOW_SECONDS / slowBar));
  const master = score.master;
  const look = SCORE_LIMITS.maxBars;
  const parts: {
    offset: number;
    pcm: Int16Array;
    frames: number;
    /** Frames at the start that fade in over the previous window's end. */
    fadeIn: number;
    /** Frames at the end that fade out under the next window. */
    fadeOut: number;
  }[] = [];
  for (let start = 0; start < totalBars;) {
    const startTick = start * ticks;
    // Every note up to the next window, in render order: tracks sum in the
    // order of their first note, as in a single pass.
    const all = notesIn(Math.max(0, start - look), start + most + 1);
    let pre = Math.max(0, start - Math.min(ring, reach));
    // A note the pre-roll can reach pulls it back to its start; one held
    // from further back restarts in the pre-roll instead (below), so long
    // drones keep full-size windows and render time stays linear.
    for (const note of all)
      if (
        note.startTick < startTick &&
        note.startTick + note.durationTicks + ringTicks > startTick &&
        Math.floor(note.startTick / ticks) >= start - reach
      )
        pre = Math.min(pre, Math.floor(note.startTick / ticks));
    pre = Math.max(pre, start - reach);
    const end = Math.min(
      totalBars,
      start + most,
      Math.max(start + 1, pre + budget),
    );
    const last = end >= totalBars;
    // One bar of the next window's notes, for anything that sounds early.
    const noteTo = last ? end : Math.min(totalBars, end + 1);
    const preTick = pre * ticks;
    const notes: Note[] = [];
    let restarted = false;
    for (const note of all) {
      if (note.startTick >= noteTo * ticks) continue;
      const stop = note.startTick + note.durationTicks;
      if (note.startTick >= preTick)
        notes.push({ ...note, startTick: note.startTick - preTick });
      // Held from before the pre-roll could reach: restart it there.
      else if (stop > preTick && stop + ringTicks > startTick) {
        notes.push({ ...note, startTick: 0, durationTicks: stop - preTick });
        restarted = true;
      }
    }
    // Export ends like a one-shot render; a loop rings out to fold back.
    const bars =
      (last ? end : noteTo) - pre + (last && options.loop ? ring : 0);
    const window = new TrackScore({
      ...frame(pre, bars).toJSON(),
      notes,
      master: null,
    });
    // State an engine cannot rebuild in the pre-roll (organ rotors along a
    // lane) is integrated over the song before the window.
    const seedState: Record<string, string> = {};
    if (
      pre > 0 &&
      window.tracks.some((track) => engineFor(track)?.windowSeed)
    ) {
      const history = frame(0, pre);
      for (const track of history.tracks) {
        const seed = engineFor(track)?.windowSeed?.(
          history,
          track,
          frameAt(pre),
          sampleRate,
        );
        if (seed !== undefined) seedState[track.id] = seed;
      }
    }
    const audio = renderer.render(window, {
      ...options,
      sampleRate,
      loop: false,
      seedTick: preTick,
      ...(pre > 0 ? { seedSeconds: secondsAtTick(timeline, pre * ticks) } : {}),
      ...(Object.keys(seedState).length > 0 ? { seedState } : {}),
      // Past `end` too, so voices that fade where the buffer stops (the
      // legacy tone voice) fade in frames this window drops.
      maxSeconds: last
        ? 60
        : Math.min(
            60,
            secondsAtTick(timeline, noteTo * ticks) -
              secondsAtTick(timeline, pre * ticks),
          ),
    });
    // A restarted note's phase differs from the previous window's, so the
    // seam crossfades over the previous window's last frames instead of
    // stepping; seams without a restart join sample for sample.
    const fade =
      restarted && parts.length > 0
        ? Math.max(
            0,
            Math.min(
              Math.round(SEAM_FADE_SECONDS * sampleRate),
              frameAt(start) - frameAt(pre),
              parts.at(-1)!.frames,
            ),
          )
        : 0;
    const from = frameAt(start) - frameAt(pre) - fade;
    const to = last
      ? audio.frames
      : Math.min(audio.frames, frameAt(end) - frameAt(pre));
    if (fade > 0) parts.at(-1)!.fadeOut = fade;
    parts.push({
      offset: frameAt(start) - fade,
      pcm: audio.pcm.subarray(from * RENDER_CHANNELS, to * RENDER_CHANNELS),
      frames: Math.max(0, to - from),
      fadeIn: fade,
      fadeOut: 0,
    });
    start = end;
  }
  const loopLength = Math.max(1, frameAt(totalBars));
  let length = Math.max(...parts.map((part) => part.offset + part.frames));
  const mix = new Int32Array(length * RENDER_CHANNELS);
  for (const { offset, pcm, frames, fadeIn, fadeOut } of parts) {
    const base = offset * RENDER_CHANNELS;
    for (let frame = 0; frame < frames; frame += 1) {
      // Linear fades: everything both windows share sums back to itself;
      // only the restarted note's phase step blends over the fade.
      const gain =
        frame < fadeIn
          ? (frame + 0.5) / fadeIn
          : frame >= frames - fadeOut
            ? 1 - (frame - (frames - fadeOut) + 0.5) / fadeOut
            : 1;
      for (let channel = 0; channel < RENDER_CHANNELS; channel += 1) {
        const index = frame * RENDER_CHANNELS + channel;
        mix[base + index]! +=
          gain === 1 ? pcm[index]! : Math.round(pcm[index]! * gain);
      }
    }
  }
  if (options.loop) {
    // Fold the tail past the loop end back onto its start.
    for (
      let index = loopLength * RENDER_CHANNELS;
      index < mix.length;
      index += 1
    )
      mix[index % (loopLength * RENDER_CHANNELS)]! += mix[index]!;
    length = loopLength;
  }
  const pcm = new Int16Array(length * RENDER_CHANNELS);
  for (let index = 0; index < pcm.length; index += 1)
    pcm[index] = Math.max(-32_768, Math.min(32_767, mix[index]!));
  const mastered = masterSummedPcm(
    pcm,
    length,
    sampleRate,
    master,
    options.loop === true,
  );
  if (mastered)
    return {
      sampleRate,
      channels: RENDER_CHANNELS,
      frames: length,
      pcm: mastered.pcm,
      master: mastered.report,
    };
  return { sampleRate, channels: RENDER_CHANNELS, frames: length, pcm };
}
