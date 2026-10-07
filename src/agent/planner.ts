import {
  SCORE_LIMITS,
  AUTOMATION_LANES,
  isAutomationParameter,
  normalizeDelay,
  normalizeFilter,
  normalizeReverb,
  normalizeSampler,
  normalizeRhythm,
  scoreFromJSON,
  type ScoreOperation,
} from "../../core/score.ts";
import { DRUM_VOICES } from "../../core/drums.ts";

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_OPERATIONS = 32;

export type CompositionPlan = Readonly<{
  operations: readonly ScoreOperation[];
  explanation?: string;
}>;

/** Parse the only model output shape that the local reducer is allowed to apply. */
export function parseCompositionPlan(text: string): CompositionPlan {
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES)
    throw new Error("agent response is too large");
  const candidate = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  let value: unknown;
  try {
    value = JSON.parse(candidate.trim());
  } catch {
    throw new Error("agent response was not valid JSON");
  }
  if (
    !isRecord(value) ||
    !Array.isArray(value.operations) ||
    value.operations.length > MAX_OPERATIONS
  ) {
    throw new Error("agent response must contain a bounded operations array");
  }
  const operations = value.operations.map(parseOperation);
  const explanation =
    typeof value.explanation === "string"
      ? value.explanation.slice(0, 2_000)
      : undefined;
  return explanation === undefined
    ? { operations }
    : { operations, explanation };
}

/**
 * Validate one foreign operation against the bounded planner contract. Every
 * tool call and legacy JSON plan passes through here before the reducer sees it.
 */
export function validateAgentOperation(value: unknown): ScoreOperation {
  return parseOperation(value);
}

function parseOperation(value: unknown): ScoreOperation {
  if (!isRecord(value) || typeof value.type !== "string")
    throw new Error("agent operation is malformed");
  if (value.type === "addTrack") {
    const track = scoreFromJSON({ tracks: [value.track] }).tracks[0]!;
    return { type: "addTrack", track };
  }
  if (
    value.type === "setBars" &&
    typeof value.bars === "number" &&
    Number.isInteger(value.bars) &&
    value.bars >= 1 &&
    value.bars <= SCORE_LIMITS.maxBars
  ) {
    return { type: "setBars", bars: value.bars };
  }
  if (
    value.type === "removeNote" &&
    typeof value.noteId === "string" &&
    value.noteId.length <= 64
  ) {
    return { type: "removeNote", noteId: value.noteId };
  }
  if (
    value.type === "setTempo" &&
    typeof value.tempoBpm === "number" &&
    Number.isFinite(value.tempoBpm)
  ) {
    return { type: "setTempo", tempoBpm: value.tempoBpm };
  }
  if (
    value.type === "clearTrack" &&
    typeof value.trackId === "string" &&
    value.trackId.length <= 64
  ) {
    return { type: "clearTrack", trackId: value.trackId };
  }
  if (
    value.type === "removeTrack" &&
    typeof value.trackId === "string" &&
    value.trackId.length <= 64
  ) {
    return { type: "removeTrack", trackId: value.trackId };
  }
  if (
    value.type === "moveTrack" &&
    typeof value.trackId === "string" &&
    value.trackId.length <= 64 &&
    typeof value.index === "number" &&
    Number.isInteger(value.index) &&
    value.index >= 0 &&
    value.index < SCORE_LIMITS.maxTracks
  ) {
    return { type: "moveTrack", trackId: value.trackId, index: value.index };
  }
  if (
    value.type === "setKey" &&
    (value.key === null ||
      (typeof value.key === "string" &&
        value.key.length <= SCORE_LIMITS.maxNameLength))
  ) {
    return { type: "setKey", key: value.key };
  }
  if (
    value.type === "setMeter" &&
    typeof value.beatsPerBar === "number" &&
    Number.isInteger(value.beatsPerBar) &&
    value.beatsPerBar >= 1 &&
    value.beatsPerBar <= SCORE_LIMITS.maxBeatsPerBar
  ) {
    return { type: "setMeter", beatsPerBar: value.beatsPerBar };
  }
  if (
    value.type === "updateTrack" &&
    typeof value.trackId === "string" &&
    value.trackId.length <= 64 &&
    isRecord(value.patch)
  ) {
    const patch = value.patch;
    const safe: Record<string, unknown> = {};
    if (typeof patch.name === "string") safe.name = patch.name.slice(0, 96);
    if (typeof patch.instrument === "string")
      safe.instrument = patch.instrument.slice(0, 64);
    if (typeof patch.muted === "boolean") safe.muted = patch.muted;
    if (typeof patch.volume === "number" && Number.isFinite(patch.volume))
      safe.volume = patch.volume;
    if (typeof patch.pan === "number" && Number.isFinite(patch.pan))
      safe.pan = patch.pan;
    if (typeof patch.solo === "boolean") safe.solo = patch.solo;
    // Effects reuse the score's bounded validators; null removes an effect.
    if (patch.filter !== undefined)
      safe.filter = normalizeFilter(patch.filter) ?? null;
    if (patch.delay !== undefined)
      safe.delay = normalizeDelay(patch.delay) ?? null;
    if (patch.reverb !== undefined)
      safe.reverb = normalizeReverb(patch.reverb) ?? null;
    if (patch.sampler !== undefined)
      safe.sampler = normalizeSampler(patch.sampler) ?? null;
    if (patch.rhythm !== undefined)
      safe.rhythm = normalizeRhythm(patch.rhythm, value.trackId) ?? null;
    return { type: "updateTrack", trackId: value.trackId, patch: safe };
  }
  if (
    value.type === "setAutomation" &&
    typeof value.trackId === "string" &&
    value.trackId.length <= SCORE_LIMITS.maxIdLength &&
    isAutomationParameter(value.parameter) &&
    Array.isArray(value.points) &&
    value.points.length <= SCORE_LIMITS.maxAutomationPoints
  ) {
    const { min: minValue, max: maxValue } = AUTOMATION_LANES[value.parameter];
    const points = value.points.map((candidate) => {
      if (!isRecord(candidate))
        throw new Error("agent automation point is malformed");
      if (
        typeof candidate.tick !== "number" ||
        !Number.isInteger(candidate.tick) ||
        candidate.tick < 0 ||
        candidate.tick > SCORE_LIMITS.maxTick ||
        typeof candidate.value !== "number" ||
        !Number.isFinite(candidate.value) ||
        candidate.value < minValue ||
        candidate.value > maxValue
      ) {
        throw new Error("agent automation point is invalid");
      }
      return { tick: candidate.tick, value: candidate.value };
    });
    return {
      type: "setAutomation",
      trackId: value.trackId,
      parameter: value.parameter,
      points,
    };
  }
  if (
    value.type === "updateNote" &&
    typeof value.noteId === "string" &&
    value.noteId.length <= 64 &&
    isRecord(value.patch)
  ) {
    const patch = value.patch;
    const safe: Record<string, number> = {};
    for (const key of [
      "startTick",
      "durationTicks",
      "pitch",
      "velocity",
    ] as const) {
      if (typeof patch[key] === "number" && Number.isFinite(patch[key]))
        safe[key] = patch[key];
    }
    return { type: "updateNote", noteId: value.noteId, patch: safe };
  }
  if (value.type === "addNote" && isRecord(value.note)) {
    const note = value.note;
    if (
      typeof note.id !== "string" ||
      typeof note.trackId !== "string" ||
      typeof note.pitch !== "number" ||
      typeof note.velocity !== "number"
    ) {
      throw new Error("agent note is malformed");
    }
    const ticks =
      typeof note.startTick === "number" &&
      typeof note.durationTicks === "number";
    const start = ticks ? note.startTick : note.start;
    const duration = ticks ? note.durationTicks : note.duration;
    if (typeof start !== "number" || typeof duration !== "number")
      throw new Error("agent note timing is malformed");
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !Number.isFinite(note.pitch) ||
      !Number.isFinite(note.velocity)
    ) {
      throw new Error("agent note timing is invalid");
    }
    return {
      type: "addNote",
      note: {
        id: note.id.slice(0, 64),
        trackId: note.trackId.slice(0, 64),
        ...(ticks
          ? { startTick: start, durationTicks: duration }
          : { start, duration }),
        pitch: note.pitch,
        velocity: note.velocity,
      },
    };
  }
  throw new Error("unsupported agent operation");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** "kick=36, snare=38, ..." for the model's drum vocabulary. */
export function drumVoiceGuide(): string {
  return DRUM_VOICES.map((info) => `${info.voice}=${info.pitch}`).join(", ");
}
