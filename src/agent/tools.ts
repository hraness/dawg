import { instrumentForWord } from "../../core/instruments.ts";
import {
  AUTOMATION_PARAMETERS,
  automationPoints,
  automationRange,
  SCORE_LIMITS,
  type AutomationParameter,
  type ScoreOperation,
  type TrackScore,
} from "../../core/score.ts";
import { loopTicksOf } from "../../core/tempo.ts";
import { AVAILABLE_INSTRUMENTS } from "../audio/wav.ts";
import {
  SYNTH_PRESETS,
  SYNTH_SIMPLE,
  isSynthPreset,
  synthParamName,
} from "../../core/synth.ts";
import { applySynthCommand, type SynthCommand } from "../commands/synth.ts";
import {
  setSampleControls,
  type SampleControlValue,
} from "../commands/sample.ts";
import {
  EFFECT_NAMES,
  FX_PRESETS,
  effectSpec,
  type EffectName,
} from "../../core/fx.ts";
import {
  applyFxCommand,
  effectPatch,
  effectValues,
  parseEffectName,
  parseParamName,
  type FxCommand,
} from "../commands/fx.ts";
import type { ChatTool } from "./gateway.ts";
import { MEDIA_TOOLS } from "../media/tools.ts";
import { PACK_TOOLS, PackToolError } from "./pack-tools.ts";
import {
  PreviewToolError,
  previewSoundTool,
  type PreviewHost,
} from "./preview-tool.ts";
import { PackError, type PackStore } from "../audio/packs.ts";
import { RHYTHM_TOOLS } from "./rhythm-tools.ts";
import { CHORD_TOOLS } from "./chord-tools.ts";
import { EXPRESSION_TOOLS } from "./expression-tools.ts";
import { TUNING_TOOLS } from "./tuning-tools.ts";
import { MASTER_TOOLS } from "./master-tools.ts";
import { DRUM_TOOLS } from "./drum-tools.ts";
import { TIME_TOOLS } from "./time-tools.ts";
import { SECTION_TOOLS } from "./section-tools.ts";
import type { MediaResult, MediaRunContext } from "../media/types.ts";
import { pitchToMidi } from "./ops.ts";
import { TUNING_LIMITS } from "../../core/tuning.ts";
import {
  DRUM_VOICES,
  drumVoicePitch,
  isDrumInstrument,
  parseDrumVoice,
  type DrumVoice,
} from "../../core/drums.ts";
import { trackSlug } from "../../core/slug.ts";
import {
  editFile,
  listFiles,
  readFile,
  WORKSPACE_LIMITS,
  WorkspaceError,
  writeFile,
  type WorkspaceScope,
} from "./workspace.ts";
import {
  fetchUrl,
  FETCH_LIMITS,
  formatFetchedPage,
  type Lookup,
} from "../web/fetch.ts";
import { WebError, type FetchLike } from "../web/http.ts";
import {
  describeSearchProvider,
  formatSearchResults,
  SEARCH_LIMITS,
  webSearch,
  type SearchSpend,
} from "../web/search.ts";

/** What a validated tool call asks the host to do. */
export type ScorePlan = Readonly<{
  kind: "score";
  operations: readonly ScoreOperation[];
  summary: string;
  trackId?: string;
}>;

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
  | Readonly<{ kind: "explain"; text: string; summary: string }>
  | Readonly<{
      kind: "action";
      summary: string;
      /** Side effects outside the score (files, network); bounded and async. */
      run: (context: ActionContext) => Promise<ActionResult>;
    }>
  /**
   * Score edits that need async work first (fetching a pack sound); `run`
   * returns the score plan, committed like any other.
   */
  | Readonly<{
      kind: "prepare";
      summary: string;
      run: (context: ActionContext) => Promise<ScorePlan>;
    }>
  /** A long-running local media job (download, stems, analysis, …). */
  | Readonly<{
      kind: "media";
      summary: string;
      run: (context: MediaRunContext) => Promise<MediaResult>;
    }>;

/** The project directory the workspace tools operate in. */
export type WorkspaceHost = Readonly<{ root: string }>;

/** Injection points for the web tools; defaults are the real network. */
export type WebHost = Readonly<{
  fetch?: FetchLike;
  lookup?: Lookup;
  /** Brave Web Search API key; defaults to `BRAVE_SEARCH_API_KEY` and overrides the chain. */
  braveApiKey?: string;
  /** AI Gateway key of the active provider; enables gateway search tools. */
  gatewayApiKey?: string;
  gatewayBaseUrl?: string;
  /** Gateway search tool; defaults to `DAWG_WEB_SEARCH`, then `exa`. */
  searchTool?: string;
  /** OpenRouter key; defaults to `OPENROUTER_API_KEY`. */
  openRouterApiKey?: string;
  openRouterBaseUrl?: string;
  /**
   * Billed searches (gateway tools, OpenRouter web plugin) are reported here
   * so the host can add them to its spend ledger (`webHostFor` in
   * `src/agent/usage.ts`).
   */
  onSpend?: (spend: SearchSpend) => void;
}>;

/** What an `action` plan receives from the host when it runs. */
export type ActionContext = Readonly<{
  workspace?: WorkspaceHost;
  /**
   * Called after a successful `write_file`/`edit_file` with the
   * project-relative path. Returned text (for example typecheck
   * diagnostics) is appended to the tool result.
   */
  onWorkspaceWrite?: (path: string) => Promise<string | void> | string | void;
  web?: WebHost;
  signal?: AbortSignal;
  /** Sample packs for list_packs/search_sounds/use_sound; default the user cache. */
  packs?: PackStore;
  /** Render and play hooks for preview_sound; absent renders in-thread, silent. */
  preview?: PreviewHost;
}>;

export type ActionResult = Readonly<{
  /** What the model reads; already bounded by the tool. */
  content: string;
  /** One line for the activity card. */
  summary: string;
  /** True when something outside the score changed (a file write). */
  mutated?: boolean;
}>;

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
              cents: {
                type: "number",
                minimum: -TUNING_LIMITS.maxNoteCents,
                maximum: TUNING_LIMITS.maxNoteCents,
                description: "Detune from the tuned pitch (microtones)",
              },
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
        const cents = optionalNumber(note, "cents", {
          min: -TUNING_LIMITS.maxNoteCents,
          max: TUNING_LIMITS.maxNoteCents,
        });
        return {
          type: "addNote",
          note: {
            id: context.newNoteId(trackId, index),
            trackId,
            startTick: Math.round(start * tpb),
            durationTicks: Math.max(1, Math.round(duration * tpb)),
            pitch: pitch(note.pitch, `notes[${index}].pitch`),
            velocity: velocity ?? 0.8,
            ...(cents ? { cents } : {}),
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
      "Move, resize, transpose, re-velocity or detune existing notes by id. Times are in beats.",
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
              cents: {
                type: "number",
                minimum: -TUNING_LIMITS.maxNoteCents,
                maximum: TUNING_LIMITS.maxNoteCents,
                description: "Detune from the tuned pitch; 0 clears it",
              },
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
          const cents = optionalNumber(update, "cents", {
            min: -TUNING_LIMITS.maxNoteCents,
            max: TUNING_LIMITS.maxNoteCents,
          });
          if (cents !== undefined) patch.cents = cents;
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
    description: `Write an automation lane: volume 0..1, pan -1..1, filter (cutoff Hz), resonance 0..${SCORE_LIMITS.maxFilterResonance}, delay-feedback 0..${SCORE_LIMITS.maxDelayFeedback}, delay-mix, wt (wavetable position 0..1), or <effect>-<param> (the param's range). The effect must be on to be heard. mode=replace (default) rewrites the lane; merge keeps other beats. An empty replace clears it.`,
    parameters: {
      type: "object",
      properties: {
        trackId: trackIdSchema,
        parameter: {
          type: "string",
          description:
            "volume, pan, filter, resonance, delay-feedback, delay-mix, or <effect>-<param>",
        },
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
                description: "in the lane's range",
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
        AUTOMATION_PARAMETERS,
        "parameter",
      );
      const mode =
        args.mode === undefined
          ? "replace"
          : oneOf(args.mode, ["replace", "merge"], "mode");
      const { min, max } = automationRange(parameter);
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
      const existing = automationPoints(track, parameter);
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
    name: "set_fx",
    description:
      "Turn an effect on/off, load a preset, or set params by dawg or Strudel name (lpq, delayfeedback…). on:true uses good defaults; effects and presets are in the brief.",
    parameters: {
      type: "object",
      properties: {
        trackId: trackIdSchema,
        effect: { type: "string", description: "see the brief's effects" },
        on: { type: "boolean" },
        preset: { type: "string" },
        params: {
          type: "object",
          additionalProperties: { type: ["number", "string", "boolean"] },
        },
      },
      required: ["effect"],
      additionalProperties: false,
    },
    plan(args, context) {
      const trackId = targetTrack(args, context);
      const effect =
        typeof args.effect === "string"
          ? parseEffectName(args.effect)
          : undefined;
      if (!effect)
        throw new ToolArgumentError(
          `effect must be one of ${EFFECT_NAMES.join(", ")}`,
        );
      const command = fxToolCommand(effect, args);
      const result = applyFxCommand(context.score, trackId, command);
      if (!result.ok || !result.next)
        throw new ToolArgumentError(result.message);
      const track = context.score.tracks.find((t) => t.id === trackId)!;
      const values = effectValues(
        result.next.tracks.find((t) => t.id === trackId),
        effect,
      );
      return {
        kind: "score",
        operations: [
          {
            type: "updateTrack",
            trackId,
            patch: effectPatch(track, effect, values ?? null),
          },
        ],
        trackId,
        summary: `${trackId} ${result.message}`,
      };
    },
  },
  {
    name: "set_synth",
    description:
      "Shape a synth track's voice with Strudel synth params (attack decay sustain release, lpf lpq lpenv, fm fmh, unison detune spread, vib vibmod, penv, noise, pw…); null unsets one. preset loads a voice (instrument + params); reset clears all; zzfx takes a raw ZzFX array (empty slots null) and sets a z_* sound.",
    parameters: {
      type: "object",
      properties: {
        trackId: trackIdSchema,
        preset: { type: "string", enum: Object.keys(SYNTH_PRESETS) },
        reset: { type: "boolean" },
        zzfx: {
          type: "array",
          maxItems: 21,
          items: { type: ["number", "null"] },
        },
        params: {
          type: "object",
          additionalProperties: {
            type: ["number", "string", "boolean", "array", "null"],
          },
        },
      },
      additionalProperties: false,
    },
    plan(args, context) {
      const trackId = targetTrack(args, context);
      const command = synthToolCommand(args);
      const result = applySynthCommand(context.score, trackId, command);
      if (!result.ok || !result.next)
        throw new ToolArgumentError(result.message);
      const next = result.next.tracks.find((t) => t.id === trackId)!;
      return {
        kind: "score",
        operations: [
          {
            type: "updateTrack",
            trackId,
            patch: { instrument: next.instrument, synth: next.synth ?? null },
          },
        ],
        trackId,
        summary: `${trackId} ${result.message}`,
      };
    },
  },
  {
    name: "set_sample",
    description:
      "Set a sampler voice's Strudel sample controls: begin end gain speed unit(r|c|s) loop loopBegin loopEnd clip(legato) fit loopAt accelerate squiz cut; null unsets one.",
    parameters: {
      type: "object",
      properties: {
        trackId: trackIdSchema,
        voice: { type: "string" },
        params: {
          type: "object",
          additionalProperties: {
            type: ["number", "string", "boolean", "null"],
          },
        },
      },
      required: ["voice", "params"],
      additionalProperties: false,
    },
    plan(args, context) {
      const trackId = targetTrack(args, context);
      const params = args.params;
      if (
        typeof args.voice !== "string" ||
        typeof params !== "object" ||
        params === null ||
        Array.isArray(params)
      )
        throw new ToolArgumentError("set_sample needs voice and params");
      const result = setSampleControls(
        context.score,
        trackId,
        args.voice,
        params as Record<string, SampleControlValue>,
      );
      if (!result.ok) throw new ToolArgumentError(result.message);
      const next = result.next.tracks.find((t) => t.id === trackId)!;
      return {
        kind: "score",
        operations: [
          { type: "updateTrack", trackId, patch: { sampler: next.sampler } },
        ],
        trackId,
        summary: `${trackId} ${result.message}`,
      };
    },
  },
  {
    name: "fit_sample",
    description:
      "Fit a sampler voice to the song's tempo map (ramps included): bpm is the sample's own tempo (20..400), len its length in beats; fitmode repitch (tape: pitch moves with speed, default) | beats (drums, speech: onset slices placed on time, unstretched) | tones (pads, vocals: phase-vocoder stretch, pitch kept). fit on > bpm > len. null unsets one. Song tempo is set_tempo, not this.",
    parameters: {
      type: "object",
      properties: {
        trackId: trackIdSchema,
        voice: { type: "string" },
        bpm: { type: ["number", "null"], minimum: 20, maximum: 400 },
        fitmode: {
          anyOf: [
            { type: "string", enum: ["repitch", "beats", "tones"] },
            { type: "null" },
          ],
        },
        len: { type: ["number", "null"], exclusiveMinimum: 0, maximum: 1024 },
      },
      required: ["voice"],
      additionalProperties: false,
    },
    plan(args, context) {
      const trackId = targetTrack(args, context);
      if (typeof args.voice !== "string")
        throw new ToolArgumentError("fit_sample needs voice");
      const values: Record<string, SampleControlValue> = {};
      for (const key of ["bpm", "len", "fitmode"] as const)
        if (args[key] !== undefined)
          values[key] = args[key] as SampleControlValue;
      if (Object.keys(values).length === 0)
        throw new ToolArgumentError("fit_sample needs bpm, len or fitmode");
      const result = setSampleControls(
        context.score,
        trackId,
        args.voice,
        values,
      );
      if (!result.ok) throw new ToolArgumentError(result.message);
      const next = result.next.tracks.find((t) => t.id === trackId)!;
      return {
        kind: "score",
        operations: [
          { type: "updateTrack", trackId, patch: { sampler: next.sampler } },
        ],
        trackId,
        summary: `${trackId} ${result.message.replace(/^sample/, "fit")}`,
      };
    },
  },
  {
    name: "set_effects",
    description: `Shorthand: low-pass filter, delay (beats) and reverb (mix 0.15..0.35 is a room); null removes one. Prefer set_fx.`,
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
        reverb: {
          anyOf: [
            {
              type: "object",
              properties: {
                mix: {
                  type: "number",
                  minimum: 0,
                  maximum: SCORE_LIMITS.maxReverbMix,
                },
                size: {
                  type: "number",
                  minimum: SCORE_LIMITS.minReverbSize,
                  maximum: SCORE_LIMITS.maxReverbSize,
                },
              },
              required: ["mix"],
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
        reverb?: { mix: number; size: number } | null;
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
      if (args.reverb === null) {
        patch.reverb = null;
        parts.push("reverb off");
      } else if (args.reverb !== undefined) {
        const reverb = record(args.reverb, "reverb");
        patch.reverb = {
          mix: number(reverb, "mix", {
            min: 0,
            max: SCORE_LIMITS.maxReverbMix,
          }),
          size:
            optionalNumber(reverb, "size", {
              min: SCORE_LIMITS.minReverbSize,
              max: SCORE_LIMITS.maxReverbSize,
            }) ?? 0.5,
        };
        parts.push(`reverb ${patch.reverb.mix}`);
      }
      if (parts.length === 0)
        throw new ToolArgumentError(
          "set_effects needs filter, delay, or reverb",
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
    name: "add_drums",
    description: `Add one-off drum hits to a kit track (create one with create_track instrument "kit"); prefer set_rhythm for repeating beats. Voices: ${DRUM_VOICES.map((info) => info.voice).join(", ")}. Give explicit hits, and/or patterns that repeat a voice every N beats across the loop.`,
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
      const loopBeats = loopTicksOf(context.score) / tpb;
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
  {
    name: "list_files",
    description:
      "List a project directory (default: the project root): directories first, then files with size and mtime. At most 500 entries; .dawg/ is hidden.",
    parameters: {
      type: "object",
      properties: { path: pathSchema("Project-relative directory") },
      additionalProperties: false,
    },
    plan(args, context) {
      const path = optionalPath(args);
      return {
        kind: "action",
        summary: `list ${path || "."}`,
        run: async (action) => {
          const scope = workspaceScope(action, context);
          const result = await listFiles(scope, path);
          return { content: result.text, summary: result.summary };
        },
      };
    },
  },
  {
    name: "read_file",
    description: `Read a UTF-8 text file from the project by line range (offset is 1-based, limit is a line count). Output is capped at ${WORKSPACE_LIMITS.maxReadBytes / 1024} KiB; binary files report size and type.`,
    parameters: {
      type: "object",
      properties: {
        path: pathSchema("Project-relative file"),
        offset: {
          type: "integer",
          minimum: 1,
          description: "First line (1-based)",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: WORKSPACE_LIMITS.maxReadLines,
          description: "Number of lines",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    plan(args, context) {
      const path = requiredPath(args);
      const offset = optionalNumber(args, "offset", { min: 1, integer: true });
      const limit = optionalNumber(args, "limit", {
        min: 1,
        max: WORKSPACE_LIMITS.maxReadLines,
        integer: true,
      });
      return {
        kind: "action",
        summary: `read ${path}`,
        run: async (action) => {
          const scope = workspaceScope(action, context);
          const result = await readFile(scope, path, {
            ...(offset !== undefined ? { offset } : {}),
            ...(limit !== undefined ? { limit } : {}),
          });
          return { content: result.text, summary: result.summary };
        },
      };
    },
  },
  {
    name: "write_file",
    description: `Create or replace a file atomically with the full content (at most ${WORKSPACE_LIMITS.maxWriteBytes / 1024 / 1024} MiB). Writable: song.ts and the focused track's tracks/<slug>/ directory, where notes.md is your scratchpad. Parent directories are created.`,
    parameters: {
      type: "object",
      properties: {
        path: pathSchema("Project-relative file"),
        content: { type: "string", description: "Entire new file content" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    plan(args, context) {
      const path = requiredPath(args);
      if (typeof args.content !== "string")
        throw new ToolArgumentError("content must be a string");
      const content = args.content;
      return {
        kind: "action",
        summary: `write ${path}`,
        run: async (action) => {
          const scope = workspaceScope(action, context);
          const result = await writeFile(scope, path, content);
          return {
            content: await afterWrite(action, result.rel, result.text),
            summary: result.summary,
            mutated: true,
          };
        },
      };
    },
  },
  {
    name: "edit_file",
    description:
      "Replace one exact occurrence of old with new in a writable file (same scope as write_file). old must match exactly once; otherwise the result tells you the count. Prefer this over many note tools for large edits or restructuring of tracks/<slug>/track.ts.",
    parameters: {
      type: "object",
      properties: {
        path: pathSchema("Project-relative file"),
        old: {
          type: "string",
          minLength: 1,
          description: "Exact text to replace",
        },
        new: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old", "new"],
      additionalProperties: false,
    },
    plan(args, context) {
      const path = requiredPath(args);
      if (typeof args.old !== "string" || args.old.length === 0)
        throw new ToolArgumentError("old must be a non-empty string");
      if (typeof args.new !== "string")
        throw new ToolArgumentError("new must be a string");
      const { old: oldText, new: newText } = args;
      return {
        kind: "action",
        summary: `edit ${path}`,
        run: async (action) => {
          const scope = workspaceScope(action, context);
          const result = await editFile(scope, path, oldText, newText);
          return {
            content: await afterWrite(action, result.rel, result.text),
            summary: result.summary,
            mutated: true,
          };
        },
      };
    },
  },
  {
    name: "web_search",
    description: `Search the web; returns up to ${SEARCH_LIMITS.defaultCount} results as title, url and snippet. Follow up with fetch_url to read a page.`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: SEARCH_LIMITS.maxQueryChars },
        count: { type: "integer", minimum: 1, maximum: SEARCH_LIMITS.maxCount },
      },
      required: ["query"],
      additionalProperties: false,
    },
    plan(args) {
      if (typeof args.query !== "string" || args.query.trim().length === 0)
        throw new ToolArgumentError("query must be a non-empty string");
      if (args.query.length > SEARCH_LIMITS.maxQueryChars)
        throw new ToolArgumentError(
          `query must be at most ${SEARCH_LIMITS.maxQueryChars} characters`,
        );
      const query = args.query.trim();
      const count = optionalNumber(args, "count", {
        min: 1,
        max: SEARCH_LIMITS.maxCount,
        integer: true,
      });
      return {
        kind: "action",
        summary: `search ${query.slice(0, 60)}`,
        run: async (action) => {
          const web = action.web ?? {};
          const outcome = await webSearch(query, {
            ...(count !== undefined ? { count } : {}),
            braveApiKey: web.braveApiKey ?? process.env.BRAVE_SEARCH_API_KEY,
            ...(web.gatewayApiKey ? { gatewayApiKey: web.gatewayApiKey } : {}),
            ...(web.gatewayBaseUrl
              ? { gatewayBaseUrl: web.gatewayBaseUrl }
              : {}),
            searchTool: web.searchTool ?? process.env.DAWG_WEB_SEARCH,
            openRouterApiKey:
              web.openRouterApiKey ?? process.env.OPENROUTER_API_KEY,
            ...(web.openRouterBaseUrl
              ? { openRouterBaseUrl: web.openRouterBaseUrl }
              : {}),
            ...(web.fetch ? { fetch: web.fetch } : {}),
            ...(web.onSpend ? { onSpend: web.onSpend } : {}),
            ...(action.signal ? { signal: action.signal } : {}),
          });
          const via = describeSearchProvider(outcome);
          return {
            content: formatSearchResults(outcome, query),
            summary: `searched via ${via}${outcome.fallbackFrom ? " (fallback)" : ""} · ${outcome.results.length} result${outcome.results.length === 1 ? "" : "s"}`,
          };
        },
      };
    },
  },
  {
    name: "fetch_url",
    description: `Fetch a public http(s) page and return its readable text (HTML reduced to headings, text and links; at most ${FETCH_LIMITS.maxOutputChars / 1024} KiB). Private and local addresses are refused.`,
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", maxLength: FETCH_LIMITS.maxUrlChars },
      },
      required: ["url"],
      additionalProperties: false,
    },
    plan(args) {
      if (typeof args.url !== "string" || args.url.trim().length === 0)
        throw new ToolArgumentError("url must be a non-empty string");
      if (args.url.length > FETCH_LIMITS.maxUrlChars)
        throw new ToolArgumentError(
          `url must be at most ${FETCH_LIMITS.maxUrlChars} characters`,
        );
      const url = args.url.trim();
      let host = url;
      try {
        host = new URL(url).hostname;
      } catch {
        // admitUrl reports the diagnostic when the action runs.
      }
      return {
        kind: "action",
        summary: `fetch ${host.slice(0, 60)}`,
        run: async (action) => {
          const page = await fetchUrl(url, {
            ...(action.web?.fetch ? { fetch: action.web.fetch } : {}),
            ...(action.web?.lookup ? { lookup: action.web.lookup } : {}),
            ...(action.signal ? { signal: action.signal } : {}),
          });
          return {
            content: formatFetchedPage(page),
            summary: `fetched ${new URL(page.url).hostname} (${page.bytes} bytes${page.truncated ? ", truncated" : ""})`,
          };
        },
      };
    },
  },
  ...RHYTHM_TOOLS,
  ...CHORD_TOOLS,
  ...EXPRESSION_TOOLS,
  ...TUNING_TOOLS,
  ...DRUM_TOOLS,
  ...TIME_TOOLS,
  ...SECTION_TOOLS,
  ...MEDIA_TOOLS,
  ...PACK_TOOLS,
  ...MASTER_TOOLS,
  // Looks tools up at call time, so it can plan any of the above.
  previewSoundTool((name) => findAgentTool(name)),
] satisfies AgentTool[]);

/** Errors an `action` plan may raise that are safe to show to the model. */
export function isActionDiagnostic(error: unknown): boolean {
  return (
    error instanceof WorkspaceError ||
    error instanceof WebError ||
    error instanceof ToolArgumentError ||
    error instanceof PackToolError ||
    error instanceof PreviewToolError ||
    error instanceof PackError
  );
}

const MAX_HOOK_CHARS = 4_000;

async function afterWrite(
  action: ActionContext,
  rel: string,
  text: string,
): Promise<string> {
  if (!action.onWorkspaceWrite) return text;
  try {
    const note = await action.onWorkspaceWrite(rel);
    return typeof note === "string" && note.trim()
      ? `${text}\n${note.trim().slice(0, MAX_HOOK_CHARS)}`
      : text;
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, MAX_HOOK_CHARS);
    return `${text}\nafter write: ${message}`;
  }
}

/** The slug of the focused track: its name, or its id for a draft track. */
export function focusedTrackSlug(
  context: Pick<ToolContext, "score" | "focusedTrackId">,
): string {
  const track = context.score.tracks.find(
    (candidate) => candidate.id === context.focusedTrackId,
  );
  return trackSlug(track?.name ?? context.focusedTrackId);
}

function workspaceScope(
  action: ActionContext,
  context: ToolContext,
): WorkspaceScope {
  if (!action.workspace)
    throw new WorkspaceError("file tools are unavailable in this session");
  return { root: action.workspace.root, trackSlug: focusedTrackSlug(context) };
}

function pathSchema(description: string) {
  return {
    type: "string",
    maxLength: WORKSPACE_LIMITS.maxPathChars,
    description,
  };
}

function requiredPath(args: Record<string, unknown>): string {
  const path = optionalPath(args);
  if (path === undefined || path.length === 0)
    throw new ToolArgumentError("path is required");
  return path;
}

function optionalPath(args: Record<string, unknown>): string | undefined {
  if (args.path === undefined) return undefined;
  if (typeof args.path !== "string")
    throw new ToolArgumentError("path must be a string");
  if (args.path.length > WORKSPACE_LIMITS.maxPathChars)
    throw new ToolArgumentError(
      `path must be at most ${WORKSPACE_LIMITS.maxPathChars} characters`,
    );
  return args.path;
}

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

function fxToolCommand(
  effect: EffectName,
  args: Record<string, unknown>,
): FxCommand {
  if (args.on === false) return { type: "fx-off", effect };
  if (args.preset !== undefined) {
    if (
      typeof args.preset !== "string" ||
      !Object.prototype.hasOwnProperty.call(
        FX_PRESETS[effect] ?? {},
        args.preset,
      )
    )
      throw new ToolArgumentError(
        `${effect} presets: ${Object.keys(FX_PRESETS[effect] ?? {}).join(", ") || "none"}`,
      );
    return { type: "fx-preset", effect, preset: args.preset };
  }
  if (args.params === undefined) {
    if (args.on === true) return { type: "fx-on", effect };
    throw new ToolArgumentError("set_fx needs on, preset, or params");
  }
  const params = record(args.params, "params");
  const values: Record<string, number | string | boolean> = {};
  for (const [name, value] of Object.entries(params)) {
    const param = parseParamName(effect, name);
    if (!param)
      throw new ToolArgumentError(
        `${effect} has no parameter ${name}; it takes ${Object.keys(effectSpec(effect).params).join(", ")}`,
      );
    if (
      typeof value !== "number" &&
      typeof value !== "string" &&
      typeof value !== "boolean"
    )
      throw new ToolArgumentError(`${effect} ${name} must be a value`);
    values[param] = value;
  }
  return { type: "fx-set", effect, values };
}

function synthToolCommand(args: Record<string, unknown>): SynthCommand {
  if (args.reset === true) return { type: "synth-reset" };
  if (args.zzfx !== undefined) {
    if (
      !Array.isArray(args.zzfx) ||
      args.zzfx.length > 21 ||
      !args.zzfx.every((n) => n === null || typeof n === "number")
    )
      throw new ToolArgumentError("zzfx must be up to 21 numbers or nulls");
    return { type: "synth-zzfx", values: args.zzfx as (number | null)[] };
  }
  if (args.preset !== undefined) {
    if (typeof args.preset !== "string" || !isSynthPreset(args.preset))
      throw new ToolArgumentError(
        `synth presets: ${Object.keys(SYNTH_PRESETS).join(", ")}`,
      );
    return { type: "synth-preset", preset: args.preset };
  }
  if (args.params === undefined)
    throw new ToolArgumentError("set_synth needs preset, reset, or params");
  const params = record(args.params, "params");
  const values: Record<
    string,
    number | string | boolean | readonly number[] | null
  > = {};
  for (const [name, value] of Object.entries(params)) {
    const param = synthParamName(name);
    if (!param)
      throw new ToolArgumentError(
        `synth has no parameter ${name}; basics: ${SYNTH_SIMPLE.join(", ")} (DAWG.md lists all)`,
      );
    if (
      value !== null &&
      typeof value !== "number" &&
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      !(Array.isArray(value) && value.every((n) => typeof n === "number"))
    )
      throw new ToolArgumentError(`synth ${name} must be a value`);
    values[param] = value as number;
  }
  return { type: "synth-set", values };
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
  // 0.6 instrument words resolve first; legacy words resolve to themselves.
  const resolved =
    typeof value === "string" ? instrumentForWord(value) : undefined;
  if (
    resolved === undefined ||
    !(AVAILABLE_INSTRUMENTS as readonly string[]).includes(resolved)
  )
    throw new ToolArgumentError(
      `instrument must be one of ${AVAILABLE_INSTRUMENTS.join(", ")}`,
    );
  return resolved;
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
