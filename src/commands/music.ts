/**
 * Direct music commands for drums, effects, and solo.
 *
 * Grammar (case-insensitive, one command per prompt; beats are score beats):
 *
 *   hit <voice> [at] <beat> [vel <0..1>]
 *   pattern <voice> <beat> [<beat> ...] [vel <0..1>]      up to 64 beats
 *   pattern <voice> every <step> [from <beat>] [vel <0..1>]   fills the loop
 *   clear <voice>                                          drum hits only
 *   filter <cutoff hz> [<resonance 0..1>] | filter off
 *   delay <beats> [<feedback 0..0.9> [<mix 0..1>]] | delay off
 *   reverb <mix 0..1> [<size 0..1>] | reverb off
 *   automate <lane> at <beat> <value> | clear <lane> automation
 *     lanes: filter (cutoff hz), resonance (0..1), delay-feedback (0..0.9),
 *     delay-mix (0..1); volume and pan lanes live in the core prompt parser
 *   solo | unsolo
 *
 * Voices: kick (bd), snare (sd), clap (cp), rim (perc), tom, hat (hh),
 * openhat (oh). Drum commands require a kit track (`instrument kit`).
 *
 * Parsing is pure and bounded; applying returns the next immutable score
 * plus the session event kind/payload, leaving persistence to the caller.
 */
import {
  SCORE_LIMITS,
  createScore,
  updateTrack,
  setTrackAutomation,
  AUTOMATION_LANES,
  type AutomationParameter,
  type NoteInput,
  type TrackScore,
} from "../../core/score.ts";
import {
  drumVoiceForPitch,
  drumVoicePitch,
  isDrumInstrument,
  parseDrumVoice,
  type DrumVoice,
} from "../../core/drums.ts";

export const MAX_PATTERN_BEATS = 64;
export const MAX_PATTERN_HITS = 256;
export const MIN_PATTERN_STEP = 0.125;
const DEFAULT_HIT_VELOCITY = 0.9;

export type MusicCommand =
  | {
      type: "drum-hits";
      voice: DrumVoice;
      beats: readonly number[];
      velocity: number;
    }
  | {
      type: "drum-every";
      voice: DrumVoice;
      step: number;
      from: number;
      velocity: number;
    }
  | { type: "drum-clear"; voice: DrumVoice }
  | { type: "filter"; cutoff: number; resonance: number }
  | { type: "filter-off" }
  | { type: "delay"; beats: number; feedback: number; mix: number }
  | { type: "delay-off" }
  | { type: "reverb"; mix: number; size: number }
  | { type: "reverb-off" }
  | {
      type: "effect-automation";
      parameter: EffectAutomationParameter;
      beat: number;
      value: number;
    }
  | { type: "effect-automation-clear"; parameter: EffectAutomationParameter }
  | { type: "solo"; solo: boolean };

/** Automation lanes owned by the effect grammar (volume/pan are core). */
export type EffectAutomationParameter = Exclude<
  AutomationParameter,
  "volume" | "pan"
>;

const LANE_ALIASES: Readonly<Record<string, EffectAutomationParameter>> =
  Object.freeze({
    filter: "filter",
    cutoff: "filter",
    resonance: "resonance",
    res: "resonance",
    "filter-resonance": "resonance",
    "delay-feedback": "delay-feedback",
    "delay-fb": "delay-feedback",
    feedback: "delay-feedback",
    "delay-mix": "delay-mix",
  });

export function parseEffectLane(
  name: string,
): EffectAutomationParameter | undefined {
  return Object.prototype.hasOwnProperty.call(LANE_ALIASES, name)
    ? LANE_ALIASES[name]
    : undefined;
}

export type MusicResult = Readonly<{
  /** `true` when the command applied; `false` carries a failure message. */
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

const NUMBER = "(\\d+(?:\\.\\d+)?)";
const VELOCITY = `(?:\\s+(?:vel|velocity)\\s+${NUMBER})?`;

export function parseMusicCommand(prompt: string): MusicCommand | undefined {
  const text = prompt.trim().toLowerCase().replace(/\s+/g, " ");
  if (text.length > 1_024) return undefined;
  if (text === "solo") return { type: "solo", solo: true };
  if (text === "unsolo") return { type: "solo", solo: false };

  const hit = text.match(
    new RegExp(`^hit ([a-z-]+) (?:at )?${NUMBER}${VELOCITY}$`),
  );
  if (hit) {
    const voice = parseDrumVoice(hit[1]!);
    const beat = Number(hit[2]);
    const velocity = parseVelocity(hit[3]);
    if (!voice || !validBeat(beat) || velocity === undefined) return undefined;
    return { type: "drum-hits", voice, beats: [beat], velocity };
  }

  const every = text.match(
    new RegExp(
      `^pattern ([a-z-]+) every ${NUMBER}(?: from ${NUMBER})?${VELOCITY}$`,
    ),
  );
  if (every) {
    const voice = parseDrumVoice(every[1]!);
    const step = Number(every[2]);
    const from = every[3] === undefined ? 0 : Number(every[3]);
    const velocity = parseVelocity(every[4]);
    if (
      !voice ||
      !Number.isFinite(step) ||
      step < MIN_PATTERN_STEP ||
      step > SCORE_LIMITS.maxBars * SCORE_LIMITS.maxBeatsPerBar ||
      !validBeat(from) ||
      velocity === undefined
    )
      return undefined;
    return { type: "drum-every", voice, step, from, velocity };
  }

  const pattern = text.match(
    new RegExp(`^pattern ([a-z-]+)((?: ${NUMBER})+)${VELOCITY}$`),
  );
  if (pattern) {
    const voice = parseDrumVoice(pattern[1]!);
    const beats = pattern[2]!.trim().split(" ").map(Number);
    const velocity = parseVelocity(pattern[4]);
    if (
      !voice ||
      beats.length > MAX_PATTERN_BEATS ||
      !beats.every(validBeat) ||
      velocity === undefined
    )
      return undefined;
    return {
      type: "drum-hits",
      voice,
      beats: [...new Set(beats)].sort((a, b) => a - b),
      velocity,
    };
  }

  const clear = text.match(/^clear ([a-z-]+)$/);
  if (clear) {
    const voice = parseDrumVoice(clear[1]!);
    if (voice) return { type: "drum-clear", voice };
    return undefined;
  }

  if (/^(?:filter|lowpass) off$/.test(text)) return { type: "filter-off" };
  const filter = text.match(
    new RegExp(`^(?:filter|lowpass) ${NUMBER}(?: ${NUMBER})?$`),
  );
  if (filter) {
    const cutoff = Number(filter[1]);
    const resonance = filter[2] === undefined ? 0 : Number(filter[2]);
    if (
      !validCutoff(cutoff) ||
      !Number.isFinite(resonance) ||
      resonance > SCORE_LIMITS.maxFilterResonance
    )
      return undefined;
    return { type: "filter", cutoff, resonance };
  }

  if (text === "delay off") return { type: "delay-off" };
  const delay = text.match(
    new RegExp(`^delay ${NUMBER}(?: ${NUMBER}(?: ${NUMBER})?)?$`),
  );
  if (delay) {
    const beats = Number(delay[1]);
    const feedback = delay[2] === undefined ? 0.3 : Number(delay[2]);
    const mix = delay[3] === undefined ? 0.35 : Number(delay[3]);
    if (
      !Number.isFinite(beats) ||
      beats < SCORE_LIMITS.minDelayBeats ||
      beats > SCORE_LIMITS.maxDelayBeats ||
      !Number.isFinite(feedback) ||
      feedback > SCORE_LIMITS.maxDelayFeedback ||
      !Number.isFinite(mix) ||
      mix > SCORE_LIMITS.maxDelayMix
    )
      return undefined;
    return { type: "delay", beats, feedback, mix };
  }

  if (/^reverb off$/.test(text)) return { type: "reverb-off" };
  const reverb = text.match(new RegExp(`^reverb ${NUMBER}(?: ${NUMBER})?$`));
  if (reverb) {
    const mix = Number(reverb[1]);
    const size = reverb[2] === undefined ? 0.5 : Number(reverb[2]);
    if (
      !Number.isFinite(mix) ||
      mix > SCORE_LIMITS.maxReverbMix ||
      !Number.isFinite(size) ||
      size > SCORE_LIMITS.maxReverbSize
    )
      return undefined;
    return { type: "reverb", mix, size };
  }

  const clearLane = text.match(/^(?:clear|reset) ([a-z-]+) automation$/);
  if (clearLane) {
    const parameter = parseEffectLane(clearLane[1]!);
    return parameter
      ? { type: "effect-automation-clear", parameter }
      : undefined;
  }
  const automate = text.match(
    new RegExp(`^(?:automate|automation) ([a-z-]+) at ${NUMBER} ${NUMBER}$`),
  );
  if (automate) {
    const parameter = parseEffectLane(automate[1]!);
    const beat = Number(automate[2]);
    const value = Number(automate[3]);
    if (!parameter || !validBeat(beat)) return undefined;
    const { min, max } = AUTOMATION_LANES[parameter];
    if (!Number.isFinite(value) || value < min || value > max) return undefined;
    return { type: "effect-automation", parameter, beat, value };
  }
  return undefined;
}

/**
 * Apply a parsed command to `trackId`. `newId(index)` must return a unique
 * note id for each drum hit created by this command.
 */
export function applyMusicCommand(
  score: TrackScore,
  trackId: string,
  command: MusicCommand,
  newId: (index: number) => string,
): MusicResult {
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };

  if (command.type === "solo") {
    const next = updateTrack(score, trackId, { solo: command.solo });
    return {
      ok: true,
      message: `${command.solo ? "solo" : "unsolo"} · ${trackId}`,
      next,
      kind: "score.track",
      payload: { trackId, patch: { solo: command.solo } },
    };
  }
  if (command.type === "filter" || command.type === "filter-off") {
    const filter =
      command.type === "filter"
        ? { cutoff: command.cutoff, resonance: command.resonance }
        : null;
    return {
      ok: true,
      message: filter
        ? `filter · ${filter.cutoff} Hz res ${filter.resonance}`
        : "filter · off",
      next: updateTrack(score, trackId, { filter }),
      kind: "score.effect",
      payload: { trackId, effect: "filter", value: filter },
    };
  }
  if (command.type === "delay" || command.type === "delay-off") {
    const delay =
      command.type === "delay"
        ? { beats: command.beats, feedback: command.feedback, mix: command.mix }
        : null;
    return {
      ok: true,
      message: delay
        ? `delay · ${delay.beats} beats fb ${delay.feedback} mix ${delay.mix}`
        : "delay · off",
      next: updateTrack(score, trackId, { delay }),
      kind: "score.effect",
      payload: { trackId, effect: "delay", value: delay },
    };
  }
  if (command.type === "reverb" || command.type === "reverb-off") {
    const reverb =
      command.type === "reverb"
        ? { mix: command.mix, size: command.size }
        : null;
    return {
      ok: true,
      message: reverb
        ? `reverb · mix ${reverb.mix} size ${reverb.size}`
        : "reverb · off",
      next: updateTrack(score, trackId, { reverb }),
      kind: "score.effect",
      payload: { trackId, effect: "reverb", value: reverb },
    };
  }
  if (
    command.type === "effect-automation" ||
    command.type === "effect-automation-clear"
  ) {
    const { parameter } = command;
    let points: { tick: number; value: number }[] = [];
    if (command.type === "effect-automation") {
      const tick = Math.round(command.beat * score.ticksPerBeat);
      const merged = new Map(
        (track[AUTOMATION_LANES[parameter].field] ?? []).map((point) => [
          point.tick,
          point,
        ]),
      );
      merged.set(tick, { tick, value: command.value });
      points = [...merged.values()].sort((a, b) => a.tick - b.tick);
      if (points.length > SCORE_LIMITS.maxAutomationPoints)
        return { ok: false, message: `${parameter} automation is full` };
    }
    return {
      ok: true,
      message: `automation · ${parameter} ${points.length} point${points.length === 1 ? "" : "s"}`,
      next: setTrackAutomation(score, trackId, parameter, points),
      kind: "score.automation",
      payload: { trackId, parameter, points },
    };
  }

  if (!isDrumInstrument(track.instrument))
    return {
      ok: false,
      message: `${trackId} is not a drum track · try instrument kit`,
    };

  if (command.type === "drum-clear") {
    const removed = score.notes.filter(
      (note) =>
        note.trackId === trackId &&
        drumVoiceForPitch(note.pitch) === command.voice,
    );
    if (removed.length === 0)
      return { ok: false, message: `no ${command.voice} hits` };
    const next = createScore({
      ...score.toJSON(),
      notes: score.notes.filter((note) => !removed.includes(note)),
    });
    return {
      ok: true,
      message: `cleared ${removed.length} ${command.voice} hit${removed.length === 1 ? "" : "s"}`,
      next,
      kind: "score.drums",
      payload: { trackId, voice: command.voice, removed: removed.length },
    };
  }

  const beats =
    command.type === "drum-hits"
      ? command.beats
      : everyBeats(command.from, command.step, score.bars * score.beatsPerBar);
  if (beats.length > MAX_PATTERN_HITS)
    return { ok: false, message: `pattern exceeds ${MAX_PATTERN_HITS} hits` };
  const pitch = drumVoicePitch(command.voice);
  const existing = new Set(
    score.notes
      .filter((note) => note.trackId === trackId && note.pitch === pitch)
      .map((note) => note.startTick),
  );
  const durationTicks = Math.max(1, Math.round(score.ticksPerBeat / 4));
  const hits: NoteInput[] = [];
  for (const beat of beats) {
    const startTick = Math.round(beat * score.ticksPerBeat);
    if (startTick > SCORE_LIMITS.maxTick || existing.has(startTick)) continue;
    existing.add(startTick);
    hits.push({
      id: newId(hits.length),
      trackId,
      startTick,
      durationTicks,
      pitch,
      velocity: command.velocity,
    });
  }
  if (hits.length === 0)
    return { ok: false, message: `${command.voice} already there` };
  if (score.notes.length + hits.length > SCORE_LIMITS.maxNotes)
    return {
      ok: false,
      message: `score is full (${SCORE_LIMITS.maxNotes} notes)`,
    };
  const next = createScore({
    ...score.toJSON(),
    notes: [...score.notes, ...hits],
  });
  return {
    ok: true,
    message: `+${hits.length} ${command.voice} hit${hits.length === 1 ? "" : "s"}`,
    next,
    kind: "score.drums",
    payload: {
      trackId,
      voice: command.voice,
      ticks: hits.map((hit) => hit.startTick),
    },
  };
}

function everyBeats(from: number, step: number, loopBeats: number): number[] {
  const beats: number[] = [];
  // Index-based stepping avoids accumulating floating-point drift.
  for (let index = 0; beats.length <= MAX_PATTERN_HITS; index += 1) {
    const beat = from + index * step;
    if (beat >= loopBeats) break;
    beats.push(beat);
  }
  return beats;
}

function parseVelocity(value: string | undefined): number | undefined {
  if (value === undefined) return DEFAULT_HIT_VELOCITY;
  const velocity = Number(value);
  return Number.isFinite(velocity) && velocity <= 1 ? velocity : undefined;
}

function validBeat(beat: number): boolean {
  return (
    Number.isFinite(beat) && beat >= 0 && beat * 4_096 <= SCORE_LIMITS.maxTick
  );
}

function validCutoff(cutoff: number): boolean {
  return (
    Number.isFinite(cutoff) &&
    cutoff >= SCORE_LIMITS.minFilterCutoff &&
    cutoff <= SCORE_LIMITS.maxFilterCutoff
  );
}
