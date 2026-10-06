import {
  SCORE_LIMITS,
  type TrackScore,
  type ScoreOperation,
} from "../../core/score.ts";
import {
  createGatewayClient,
  type GatewayClient,
  type GatewayModel,
} from "./gateway.ts";
import { AVAILABLE_INSTRUMENTS } from "../audio/wav.ts";

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

export async function planComposition(options: {
  prompt: string;
  score: TrackScore;
  trackId: string;
  model?: GatewayModel;
  gateway?: GatewayClient;
  signal?: AbortSignal;
}): Promise<CompositionPlan> {
  const gateway = options.gateway ?? createGatewayClient();
  const model = options.model ?? "sol-6.1";
  const response = await gateway.complete(
    {
      model,
      messages: [
        {
          role: "system",
          content: `You edit a local loop. Return JSON only. Operations may be addNote, removeNote, updateNote, setTempo, updateTrack, setAutomation, or clearTrack. Example: {"operations":[{"type":"addNote","note":{"id":"short unique id","trackId":"track","start":0,"duration":1,"pitch":60,"velocity":0.8}}],"explanation":"brief"}. Use beats for note start/duration. For volume automation, use setAutomation with parameter "volume" and integer tick points like {"tick":0,"value":0.2}. Available instruments: ${AVAILABLE_INSTRUMENTS.join(", ")}. Keep changes inside the requested track unless the user asks otherwise. Never return prose outside JSON.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            request: options.prompt,
            trackId: options.trackId,
            score: options.score.toJSON(),
          }),
        },
      ],
    },
    options.signal,
  );
  return parseCompositionPlan(response);
}

function parseOperation(value: unknown): ScoreOperation {
  if (!isRecord(value) || typeof value.type !== "string")
    throw new Error("agent operation is malformed");
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
    return { type: "updateTrack", trackId: value.trackId, patch: safe };
  }
  if (
    value.type === "setAutomation" &&
    typeof value.trackId === "string" &&
    value.trackId.length <= SCORE_LIMITS.maxIdLength &&
    value.parameter === "volume" &&
    Array.isArray(value.points) &&
    value.points.length <= SCORE_LIMITS.maxAutomationPoints
  ) {
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
        candidate.value < 0 ||
        candidate.value > SCORE_LIMITS.maxVolume
      ) {
        throw new Error("agent automation point is invalid");
      }
      return { tick: candidate.tick, value: candidate.value };
    });
    return {
      type: "setAutomation",
      trackId: value.trackId,
      parameter: "volume",
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
    const start = typeof note.start === "number" ? note.start : note.startTick;
    const duration =
      typeof note.duration === "number" ? note.duration : note.durationTicks;
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
        start,
        duration,
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
