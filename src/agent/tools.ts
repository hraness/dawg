import {
  SCORE_LIMITS,
  type ScoreOperation,
  type TrackScore,
} from "../../core/score.ts";
import { AVAILABLE_INSTRUMENTS } from "../audio/wav.ts";
import type { ChatTool } from "./gateway.ts";
import { pitchToMidi } from "./ops.ts";
import {
  DRUM_VOICES,
  drumVoicePitch,
  isDrumInstrument,
  parseDrumVoice,
  type DrumVoice,
} from "../../core/drums.ts";

/** What a validated tool call asks the host to do. */
export type ToolPlan =
  | Readonly<{
      kind: "score";
      operations: readonly ScoreOperation[];
      summary: string;
      trackId?: string;
    }>
  | Readonly<{
      kind: "transport";
      action: "play" | "pause" | "toggle";
      summary: string;
    }>
  | Readonly<{ kind: "explain"; text: string; summary: string }>;

export type ToolContext = Readonly<{
  score: TrackScore;
  focusedTrackId: string;
  revision: number;
  /** Deterministic per-call note ID factory. */
  newNoteId: (trackId: string, index: number) => string;
}>;

export type AgentTool = Readonly<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  plan: (args: Record<string, unknown>, context: ToolContext) => ToolPlan;
}>;

/** A model-supplied argument that the tool refused; never mutates the score. */
export class ToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolArgumentError";
  }
}

const MAX_NOTES_PER_CALL = 128;
const MAX_EXPLAIN_CHARS = 2_000;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

const trackIdSchema = {
  type: "string",
  description: "Target track id. Defaults to the focused track.",
  maxLength: SCORE_LIMITS.maxIdLength,
};
const beatSchema = (description: string) => ({
  type: "number",
  minimum: 0,
  description,
});

/**
 * One tool per score operation family. Add a new family by appending an entry
 * here; the agent loop, schemas, and validation pick it up automatically.
 */
export const AGENT_TOOLS: readonly AgentTool[] = Object.freeze([
  {
    name: "add_notes",
    description:
      "Add notes to one track. Times are in beats from the loop start; pitch is MIDI 0..127 or a name like C4/F#2.",
    parameters: {
      type: "object",
      properties: {
        trackId: trackIdSchema,
        notes: {
          type: "array",
          minItems: 1,
          maxItems: MAX_NOTES_PER_CALL,
          items: {
            type: "object",
            properties: {
              pitch: {
                anyOf: [
                  { type: "integer", minimum: 0, maximum: 127 },
                  { type: "string", maxLength: 4 },
                ],
              },
              start: beatSchema("Start in beats"),
              duration: {
                type: "number",
                exclusiveMinimum: 0,
                description: "Length in beats",
              },
              velocity: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["pitch", "start", "duration"],
            additionalProperties: false,
          },
        },
      },
      required: ["notes"],
      additionalProperties: false,
    },
    plan(args, context) {
      const trackId = targetTrack(args, context);
      const notes = list(args, "notes", 1, MAX_NOTES_PER_CALL);
      const tpb = context.score.ticksPerBeat;
      const operations = notes.map((value, index): ScoreOperation => {
        const note = record(value, `notes[${index}]`);
        const start = number(note, "start", { min: 0 });
        const duration = number(note, "duration", { min: 0, exclusive: true });
        const velocity = optionalNumber(note, "velocity", { min: 0, max: 1 });
        return {
          type: "addNote",
          note: {
            id: context.newNoteId(trackId, index),
            trackId,
            startTick: Math.round(start * tpb),
            durationTicks: Math.max(1, Math.round(duration * tpb)),
            pitch: pitch(note.pitch, `notes[${index}].pitch`),
            velocity: velocity ?? 0.8,
          },
        };
      });
      return {
        kind: "score",
        operations,
        trackId,
        summary: `+${operations.length} ${trackId} note${operations.length === 1 ? "" : "s"}`,
      };
    },
  },
  {
    name: "remove_notes",
    description:
      "Remove notes by id, or every note on a track with all=true. Note ids come from the composition brief.",
    parameters: {
      type: "object",
      properties: {
        trackId: trackIdSchema,
        noteIds: {
          type: "array",
          maxItems: MAX_NOTES_PER_CALL,
          items: { type: "string", maxLength: SCORE_LIMITS.maxIdLength },
        },
        all: { type: "boolean" },
      },
      additionalProperties: false,
    },
    plan(args, context) {
      if (args.all === true) {
        const trackId = targetTrack(args, context);
        return {
          kind: "score",
          operations: [{ type: "clearTrack", trackId }],
          trackId,
          summary: `cleared ${trackId}`,
        };
      }
      const ids = list(args, "noteIds", 1, MAX_NOTES_PER_CALL).map((id, i) =>
        knownNoteId(id, context, `noteIds[${i}]`),
      );
      return {
        kind: "score",
        operations: ids.map((noteId) => ({ type: "removeNote", noteId })),
        summary: `−${ids.length} note${ids.length === 1 ? "" : "s"}`,
      };
    },
  },
  {
    name: "update_notes",
    description:
      "Move, resize, transpose, or re-velocity existing notes by id. Times are in beats.",
    parameters: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          minItems: 1,
          maxItems: MAX_NOTES_PER_CALL,
          items: {
            type: "object",
            properties: {
              noteId: { type: "string", maxLength: SCORE_LIMITS.maxIdLength },
              start: beatSchema("New start in beats"),
              duration: { type: "number", exclusiveMinimum: 0 },
              pitch: {
                anyOf: [
                  { type: "integer", minimum: 0, maximum: 127 },
                  { type: "string", maxLength: 4 },
                ],
              },
              velocity: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["noteId"],
            additionalProperties: false,
          },
        },
      },
      required: ["updates"],
      additionalProperties: false,
    },
    plan(args, context) {
      const tpb = context.score.ticksPerBeat;
      const operations = list(args, "updates", 1, MAX_NOTES_PER_CALL).map(
        (value, index): ScoreOperation => {
          const update = record(value, `updates[${index}]`);
          const noteId = knownNoteId(
            update.noteId,
            context,
            `updates[${index}].noteId`,
          );
          const patch: Record<string, number> = {};
          const start = optionalNumber(update, "start", { min: 0 });
          if (start !== undefined) patch.startTick = Math.round(start * tpb);
          const duration = optionalNumber(update, "duration", {
            min: 0,
            exclusive: true,
          });
          if (duration !== undefined)
            patch.durationTicks = Math.max(1, Math.round(duration * tpb));
          if (update.pitch !== undefined)
            patch.pitch = pitch(update.pitch, `updates[${index}].pitch`);
          const velocity = optionalNumber(update, "velocity", {
            min: 0,
            max: 1,
          });
          if (velocity !== undefined) patch.velocity = velocity;
          if (Object.keys(patch).length === 0)
            throw new ToolArgumentError(`updates[${index}] changes nothing`);
          return { type: "updateNote", noteId, patch };
        },
      );
      return {
        kind: "score",
        operations,
        summary: `~${operations.length} note${operations.length === 1 ? "" : "s"}`,
      };
    },
  },
  {
    name: "set_instrument",
    description: "Change a track's instrument voice.",
    parameters: {
      type: "object",
      properties: {
        trackId: trackIdSchema,
        instrument: { type: "string", enum: [...AVAILABLE_INSTRUMENTS] },
      },
      required: ["instrument"],
      additionalProperties: false,
    },
    plan(args, context) {
      const trackId = targetTrack(args, context);
      const instrument = instrumentName(args.instrument);
      return {
        kind: "score",
        operations: [{ type: "updateTrack", trackId, patch: { instrument } }],
        trackId,
        summary: `${trackId} → ${instrument}`,
      };
    },
  },
  {
    name: "set_mix",
    description:
      "Set a track's static volume (0..1), pan (-1 left .. 1 right), mute, or solo. While any track is soloed only soloed tracks play.",
    parameters: {
      type: "object",
      properties: {
        trackId: trackIdSchema,
        volume: { type: "number", minimum: 0, maximum: 1 },
        pan: { type: "number", minimum: -1, maximum: 1 },
        muted: { type: "boolean" },
        solo: { type: "boolean" },
      },
      additionalProperties: false,
    },
    plan(args, context) {
      const trackId = targetTrack(args, context);
      const patch: {
        volume?: number;
        pan?: number;
        muted?: boolean;
        solo?: boolean;
      } = {};
      const volume = optionalNumber(args, "volume", { min: 0, max: 1 });
      if (volume !== undefined) patch.volume = volume;
      const pan = optionalNumber(args, "pan", { min: -1, max: 1 });
      if (pan !== undefined) patch.pan = pan;
      if (args.muted !== undefined) {
        if (typeof args.muted !== "boolean")
          throw new ToolArgumentError("muted must be a boolean");
        patch.muted = args.muted;
      }
      if (args.solo !== undefined) {
        if (typeof args.solo !== "boolean")
          throw new ToolArgumentError("solo must be a boolean");
        patch.solo = args.solo;
      }
      const parts = Object.entries(patch).map(([key, value]) =>
        key === "muted"
          ? value
            ? "muted"
            : "unmuted"
          : key === "solo"
            ? value
              ? "solo"
              : "unsolo"
            : `${key} ${value}`,
      );
      if (parts.length === 0)
        throw new ToolArgumentError(
          "set_mix needs volume, pan, muted, or solo",
        );
      return {
        kind: "score",
        operations: [{ type: "updateTrack", trackId, patch }],
        trackId,
        summary: `${trackId} ${parts.join(", ")}`,
      };
    },
  },
  {
    name: "set_automation",
    description: `Write a volume (0..1), pan (-1..1), or filter cutoff (${SCORE_LIMITS.minFilterCutoff}..${SCORE_LIMITS.maxFilterCutoff} Hz low-pass) automation lane. mode=replace (default) rewrites the lane; merge keeps existing points at other beats. An empty replace clears it.`,
    parameters: {
      type: "object",
      properties: {
        trackId: trackIdSchema,
        parameter: { type: "string", enum: ["volume", "pan", "filter"] },
        mode: { type: "string", enum: ["replace", "merge"] },
        points: {
          type: "array",
          maxItems: SCORE_LIMITS.maxAutomationPoints,
          items: {
            type: "object",
            properties: {
              beat: beatSchema("Beat position"),
              value: {
                type: "number",
                description: "volume 0..1, pan -1..1, filter cutoff in Hz",
              },
            },
            required: ["beat", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["parameter", "points"],
      additionalProperties: false,
    },
    plan(args, context) {
      const trackId = targetTrack(args, context);
      const parameter = oneOf(
        args.parameter,
        ["volume", "pan", "filter"],
        "parameter",
      );
      const mode =
        args.mode === undefined
          ? "replace"
          : oneOf(args.mode, ["replace", "merge"], "mode");
      const [min, max] =
        parameter === "filter"
          ? [SCORE_LIMITS.minFilterCutoff, SCORE_LIMITS.maxFilterCutoff]
          : [parameter === "pan" ? -1 : 0, 1];
      const tpb = context.score.ticksPerBeat;
      const points = list(
        args,
        "points",
        0,
        SCORE_LIMITS.maxAutomationPoints,
      ).map((value, index) => {
        const point = record(value, `points[${index}]`);
        return {
          tick: Math.round(number(point, "beat", { min: 0 }) * tpb),
          value: number(point, "value", { min, max }),
        };
      });
      const track = context.score.tracks.find((t) => t.id === trackId)!;
      const existing =
        parameter === "pan"
          ? track.panAutomation
          : parameter === "filter"
            ? (track.filterAutomation ?? [])
            : track.volumeAutomation;
      const merged = Array.from(
        new Map(
          [...(mode === "merge" ? existing : []), ...points].map((point) => [
            point.tick,
            point,
          ]),
        ).values(),
      ).sort((left, right) => left.tick - right.tick);
      return {
        kind: "score",
        operations: [
          { type: "setAutomation", trackId, parameter, points: merged },
        ],
        trackId,
        summary:
          merged.length === 0
            ? `${trackId} ${parameter} automation cleared`
            : `${trackId} ${parameter} automation · ${merged.length} point${merged.length === 1 ? "" : "s"}`,
      };
    },
  },
  {
    name: "set_effects",
    description: `Set or remove a track's low-pass filter and tempo-synced delay. Pass null to remove an effect. filter: cutoff ${SCORE_LIMITS.minFilterCutoff}..${SCORE_LIMITS.maxFilterCutoff} Hz, resonance 0..${SCORE_LIMITS.maxFilterResonance}. delay: beats ${SCORE_LIMITS.minDelayBeats}..${SCORE_LIMITS.maxDelayBeats}, feedback 0..${SCORE_LIMITS.maxDelayFeedback}, mix 0..${SCORE_LIMITS.maxDelayMix}.`,
    parameters: {
      type: "object",
      properties: {
        trackId: trackIdSchema,
        filter: {
          anyOf: [
            {
              type: "object",
              properties: {
                cutoff: {
                  type: "number",
                  minimum: SCORE_LIMITS.minFilterCutoff,
                  maximum: SCORE_LIMITS.maxFilterCutoff,
                },
                resonance: {
                  type: "number",
                  minimum: 0,
                  maximum: SCORE_LIMITS.maxFilterResonance,
                },
              },
              required: ["cutoff"],
              additionalProperties: false,
            },
            { type: "null" },
          ],
        },
        delay: {
          anyOf: [
            {
              type: "object",
              properties: {
                beats: {
                  type: "number",
                  minimum: SCORE_LIMITS.minDelayBeats,
                  maximum: SCORE_LIMITS.maxDelayBeats,
                },
                feedback: {
                  type: "number",
                  minimum: 0,
                  maximum: SCORE_LIMITS.maxDelayFeedback,
                },
                mix: {
                  type: "number",
                  minimum: 0,
                  maximum: SCORE_LIMITS.maxDelayMix,
                },
              },
              required: ["beats"],
              additionalProperties: false,
            },
            { type: "null" },
          ],
        },
      },
      additionalProperties: false,
    },
    plan(args, context) {
      const trackId = targetTrack(args, context);
      const patch: {
        filter?: { cutoff: number; resonance: number } | null;
        delay?: { beats: number; feedback: number; mix: number } | null;
      } = {};
      const parts: string[] = [];
      if (args.filter === null) {
        patch.filter = null;
        parts.push("filter off");
      } else if (args.filter !== undefined) {
        const filter = record(args.filter, "filter");
        patch.filter = {
          cutoff: number(filter, "cutoff", {
            min: SCORE_LIMITS.minFilterCutoff,
            max: SCORE_LIMITS.maxFilterCutoff,
          }),
          resonance:
            optionalNumber(filter, "resonance", {
              min: 0,
              max: SCORE_LIMITS.maxFilterResonance,
            }) ?? 0,
        };
        parts.push(`filter ${Math.round(patch.filter.cutoff)} Hz`);
      }
      if (args.delay === null) {
        patch.delay = null;
        parts.push("delay off");
      } else if (args.delay !== undefined) {
        const delay = record(args.delay, "delay");
        patch.delay = {
          beats: number(delay, "beats", {
            min: SCORE_LIMITS.minDelayBeats,
            max: SCORE_LIMITS.maxDelayBeats,
          }),
          feedback:
            optionalNumber(delay, "feedback", {
              min: 0,
              max: SCORE_LIMITS.maxDelayFeedback,
            }) ?? 0.35,
          mix:
            optionalNumber(delay, "mix", {
              min: 0,
              max: SCORE_LIMITS.maxDelayMix,
            }) ?? 0.3,
        };
        parts.push(`delay ${patch.delay.beats} beats`);
      }
      if (parts.length === 0)
        throw new ToolArgumentError("set_effects needs filter or delay");
      return {
        kind: "score",
        operations: [{ type: "updateTrack", trackId, patch }],
        trackId,
        summary: `${trackId} ${parts.join(", ")}`,
      };
    },
  },
  {
    name: "add_drums",
    description: `Add drum hits to a kit track (create one with create_track instrument "kit"). Voices: ${DRUM_VOICES.map((info) => info.voice).join(", ")}. Give explicit hits, and/or patterns that repeat a voice every N beats across the loop.`,
    parameters: {
      type: "object",
      properties: {
        trackId: trackIdSchema,
        hits: {
          type: "array",
          maxItems: MAX_NOTES_PER_CALL,
          items: {
            type: "object",
            properties: {
              voice: {
                type: "string",
                enum: DRUM_VOICES.map((info) => info.voice),
              },
              beat: beatSchema("Hit position in beats"),
              velocity: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["voice", "beat"],
            additionalProperties: false,
          },
        },
        patterns: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              voice: {
                type: "string",
                enum: DRUM_VOICES.map((info) => info.voice),
              },
              every: {
                type: "number",
                minimum: 0.125,
                description: "Step in beats",
              },
              from: beatSchema("First hit in beats (default 0)"),
              velocity: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["voice", "every"],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    plan(args, context) {
      const trackId = targetTrack(args, context);
      const track = context.score.tracks.find((t) => t.id === trackId)!;
      if (!isDrumInstrument(track.instrument))
        throw new ToolArgumentError(
          `track ${trackId} is ${track.instrument}, not a drum kit; set_instrument kit or create a kit track`,
        );
      const tpb = context.score.ticksPerBeat;
      const loopBeats = context.score.bars * context.score.beatsPerBar;
      const voiceOf = (value: unknown, label: string) => {
        const voice =
          typeof value === "string" ? parseDrumVoice(value) : undefined;
        if (!voice) throw new ToolArgumentError(`${label}: unknown drum voice`);
        return voice;
      };
      const hits: { voice: DrumVoice; beat: number; velocity: number }[] = [];
      for (const [index, value] of (args.hits === undefined
        ? []
        : list(args, "hits", 0, MAX_NOTES_PER_CALL)
      ).entries()) {
        const hit = record(value, `hits[${index}]`);
        hits.push({
          voice: voiceOf(hit.voice, `hits[${index}].voice`),
          beat: number(hit, "beat", { min: 0 }),
          velocity: optionalNumber(hit, "velocity", { min: 0, max: 1 }) ?? 0.9,
        });
      }
      for (const [index, value] of (args.patterns === undefined
        ? []
        : list(args, "patterns", 0, 8)
      ).entries()) {
        const pattern = record(value, `patterns[${index}]`);
        const voice = voiceOf(pattern.voice, `patterns[${index}].voice`);
        const every = number(pattern, "every", { min: 0.125 });
        const from = optionalNumber(pattern, "from", { min: 0 }) ?? 0;
        const velocity =
          optionalNumber(pattern, "velocity", { min: 0, max: 1 }) ?? 0.85;
        for (let beat = from; beat < loopBeats - 1e-9; beat += every) {
          hits.push({ voice, beat, velocity });
          if (hits.length > MAX_NOTES_PER_CALL)
            throw new ToolArgumentError(
              `add_drums is limited to ${MAX_NOTES_PER_CALL} hits per call`,
            );
        }
      }
      if (hits.length === 0)
        throw new ToolArgumentError("add_drums needs hits or patterns");
      const operations = hits.map((hit, index): ScoreOperation => ({
        type: "addNote",
        note: {
          id: context.newNoteId(trackId, index),
          trackId,
          startTick: Math.round(hit.beat * tpb),
          durationTicks: Math.max(1, Math.round(tpb / 4)),
          pitch: drumVoicePitch(hit.voice),
          velocity: hit.velocity,
        },
      }));
      return {
        kind: "score",
        operations,
        trackId,
        summary: `+${operations.length} ${trackId} hit${operations.length === 1 ? "" : "s"}`,
      };
    },
  },
  {
    name: "extend_loop",
    description:
      "Resize the loop: bars sets the total, addBars appends. Notes and automation are preserved.",
    parameters: {
      type: "object",
      properties: {
        bars: { type: "integer", minimum: 1, maximum: SCORE_LIMITS.maxBars },
        addBars: {
          type: "integer",
          minimum: 1,
          maximum: SCORE_LIMITS.maxBars,
        },
      },
      additionalProperties: false,
    },
    plan(args, context) {
      const current = context.score.bars;
      const add = optionalNumber(args, "addBars", {
        min: 1,
        max: SCORE_LIMITS.maxBars,
        integer: true,
      });
      const total = optionalNumber(args, "bars", {
        min: 1,
        max: SCORE_LIMITS.maxBars,
        integer: true,
      });
      if ((add === undefined) === (total === undefined))
        throw new ToolArgumentError(
          "extend_loop needs exactly one of bars or addBars",
        );
      const bars = total ?? current + add!;
      if (bars > SCORE_LIMITS.maxBars)
        throw new ToolArgumentError(
          `loop cannot exceed ${SCORE_LIMITS.maxBars} bars`,
        );
      return {
        kind: "score",
        operations: [{ type: "setBars", bars }],
        summary: `loop ${current} → ${bars} bars`,
      };
    },
  },
  {
    name: "set_tempo",
    description: "Set the session tempo in BPM.",
    parameters: {
      type: "object",
      properties: {
        bpm: {
          type: "number",
          minimum: SCORE_LIMITS.minTempoBpm,
          maximum: SCORE_LIMITS.maxTempoBpm,
        },
      },
      required: ["bpm"],
      additionalProperties: false,
    },
    plan(args, context) {
      const bpm = number(args, "bpm", {
        min: SCORE_LIMITS.minTempoBpm,
        max: SCORE_LIMITS.maxTempoBpm,
      });
      return {
        kind: "score",
        operations: [{ type: "setTempo", tempoBpm: bpm }],
        summary: `tempo ${context.score.tempoBpm} → ${bpm} BPM`,
      };
    },
  },
  {
    name: "create_track",
    description:
      "Create a new track, then add notes to it with add_notes using the same id.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", pattern: ID_PATTERN.source, maxLength: 64 },
        name: { type: "string", maxLength: SCORE_LIMITS.maxNameLength },
        instrument: { type: "string", enum: [...AVAILABLE_INSTRUMENTS] },
      },
      required: ["id", "instrument"],
      additionalProperties: false,
    },
    plan(args, context) {
      if (typeof args.id !== "string" || !ID_PATTERN.test(args.id))
        throw new ToolArgumentError(
          "id must be 1-64 letters, digits, dot, dash, or underscore",
        );
      const id = args.id;
      if (context.score.tracks.some((track) => track.id === id))
        throw new ToolArgumentError(`track ${id} already exists`);
      const instrument = instrumentName(args.instrument);
      const name =
        typeof args.name === "string" && args.name.trim().length > 0
          ? args.name.trim().slice(0, SCORE_LIMITS.maxNameLength)
          : id;
      return {
        kind: "score",
        operations: [{ type: "addTrack", track: { id, name, instrument } }],
        trackId: id,
        summary: `+track ${id} (${instrument})`,
      };
    },
  },
  {
    name: "transport",
    description: "Start, stop, or toggle shared playback.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["play", "pause", "toggle"] },
      },
      required: ["action"],
      additionalProperties: false,
    },
    plan(args) {
      const action = oneOf(args.action, ["play", "pause", "toggle"], "action");
      return { kind: "transport", action, summary: action };
    },
  },
  {
    name: "explain",
    description:
      "Tell the user briefly what you changed or why, without editing the score.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", maxLength: MAX_EXPLAIN_CHARS } },
      required: ["text"],
      additionalProperties: false,
    },
    plan(args) {
      if (typeof args.text !== "string" || args.text.trim().length === 0)
        throw new ToolArgumentError("text must be a non-empty string");
      const text = args.text.trim().slice(0, MAX_EXPLAIN_CHARS);
      return { kind: "explain", text, summary: text.slice(0, 80) };
    },
  },
] satisfies AgentTool[]);

const TOOLS_BY_NAME = new Map(AGENT_TOOLS.map((tool) => [tool.name, tool]));

export function findAgentTool(
  name: string,
  tools: readonly AgentTool[] = AGENT_TOOLS,
): AgentTool | undefined {
  return tools === AGENT_TOOLS
    ? TOOLS_BY_NAME.get(name)
    : tools.find((tool) => tool.name === name);
}

export function chatTools(
  tools: readonly AgentTool[] = AGENT_TOOLS,
): ChatTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function targetTrack(args: Record<string, unknown>, context: ToolContext) {
  const trackId = args.trackId ?? context.focusedTrackId;
  if (typeof trackId !== "string" || trackId.length > SCORE_LIMITS.maxIdLength)
    throw new ToolArgumentError("trackId must be a short string");
  if (!context.score.tracks.some((track) => track.id === trackId))
    throw new ToolArgumentError(
      `unknown track ${trackId}; create it with create_track first`,
    );
  return trackId;
}

function knownNoteId(value: unknown, context: ToolContext, label: string) {
  if (typeof value !== "string" || value.length > SCORE_LIMITS.maxIdLength)
    throw new ToolArgumentError(`${label} must be a short string`);
  if (!context.score.notes.some((note) => note.id === value))
    throw new ToolArgumentError(`${label}: unknown note ${value}`);
  return value;
}

function instrumentName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !(AVAILABLE_INSTRUMENTS as readonly string[]).includes(value)
  )
    throw new ToolArgumentError(
      `instrument must be one of ${AVAILABLE_INSTRUMENTS.join(", ")}`,
    );
  return value;
}

function pitch(value: unknown, label: string): number {
  const midi =
    typeof value === "string" ? pitchToMidi(value.trim().toLowerCase()) : value;
  if (
    typeof midi !== "number" ||
    !Number.isInteger(midi) ||
    midi < 0 ||
    midi > 127
  )
    throw new ToolArgumentError(
      `${label} must be MIDI 0..127 or a note name like C4`,
    );
  return midi;
}

function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  label: string,
): T {
  if (
    typeof value !== "string" ||
    !(options as readonly string[]).includes(value)
  )
    throw new ToolArgumentError(
      `${label} must be one of ${options.join(", ")}`,
    );
  return value as T;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ToolArgumentError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function list(
  args: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): unknown[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new ToolArgumentError(
      `${key} must be an array of ${min}..${max} items`,
    );
  return value;
}

type NumberBounds = {
  min?: number;
  max?: number;
  exclusive?: boolean;
  integer?: boolean;
};

function number(
  args: Record<string, unknown>,
  key: string,
  bounds: NumberBounds,
): number {
  const value = optionalNumber(args, key, bounds);
  if (value === undefined) throw new ToolArgumentError(`${key} is required`);
  return value;
}

function optionalNumber(
  args: Record<string, unknown>,
  key: string,
  bounds: NumberBounds,
): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new ToolArgumentError(`${key} must be a finite number`);
  if (bounds.integer && !Number.isInteger(value))
    throw new ToolArgumentError(`${key} must be an integer`);
  if (
    bounds.min !== undefined &&
    (bounds.exclusive ? value <= bounds.min : value < bounds.min)
  )
    throw new ToolArgumentError(
      `${key} must be ${bounds.exclusive ? ">" : ">="} ${bounds.min}`,
    );
  if (bounds.max !== undefined && value > bounds.max)
    throw new ToolArgumentError(`${key} must be <= ${bounds.max}`);
  if (Math.abs(value) > SCORE_LIMITS.maxTick)
    throw new ToolArgumentError(`${key} is out of range`);
  return value;
}
