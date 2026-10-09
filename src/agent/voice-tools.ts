/**
 * 0.7 Voice agent tools, one array per lane. The contract spreads
 * `VOICE_TOOLS` once into `AGENT_TOOLS` and `VOICE_PREVIEWABLE_TOOLS` once
 * into `preview_sound`'s list; each lane fills only its own array and flags
 * tools that change how a track sounds with `previewable: true`.
 */
import { FX_PRESETS } from "../../core/fx.ts";
import {
  applyFxCommand,
  effectPatch,
  effectValues,
  FORMANT_VOWEL_HINT,
  type FxCommand,
} from "../commands/fx.ts";
import { SCORE_LIMITS } from "../../core/score.ts";
import { ToolArgumentError } from "./tool-error.ts";
// Types only: tools.ts spreads VOICE_TOOLS, so a value import would cycle.
import type { AgentTool, ToolContext } from "./tools.ts";

const trackIdSchema = {
  type: "string",
  description: "Target track id. Defaults to the focused track.",
  maxLength: SCORE_LIMITS.maxIdLength,
};

/** The tool's track: `trackId` or the focused one (as tools.ts). */
function targetTrack(
  args: Record<string, unknown>,
  context: ToolContext,
): string {
  const trackId = args.trackId ?? context.focusedTrackId;
  if (typeof trackId !== "string" || trackId.length > SCORE_LIMITS.maxIdLength)
    throw new ToolArgumentError("trackId must be a short string");
  if (!context.score.tracks.some((track) => track.id === trackId))
    throw new ToolArgumentError(
      `unknown track ${trackId}; create it with create_track first`,
    );
  return trackId;
}

/** An agent tool, optionally usable as a `preview_sound` candidate. */
export type VoiceTool = AgentTool & Readonly<{ previewable?: boolean }>;

/** clips: place_clip, edit_clip, set_lyrics. */
export const CLIPS_TOOLS: readonly VoiceTool[] = [];
/** pitch: analyze_pitch, pitch_to_notes. */
export const PITCH_TOOLS: readonly VoiceTool[] = [];
const FORMANT_PRESETS = Object.keys(FX_PRESETS.formant ?? {});

/**
 * formant: set_formant. The fx `formant` stage (core/fx.ts): shift moves the
 * spectral envelope in semitones while the pitch stays, mix blends it.
 */
export const FORMANT_TOOLS: readonly VoiceTool[] = [
  {
    name: "set_formant",
    previewable: true,
    description: `Shift a track's formants at constant pitch (the throat or gender knob; works on any source, voices most of all): shift -12..12 semitones (negative deeper or bigger, positive smaller or younger; 2-4 is natural, 7+ is a cartoon), mix 0..1 (default 1); preset ${FORMANT_PRESETS.join(" ")}; off removes it. Automatable as lanes formant-shift and formant-mix. The vowel filter is set_fx vowel (vowel, to, morph 0..1 morphs between two vowels; lane vowel-morph).`,
    parameters: {
      type: "object",
      properties: {
        trackId: trackIdSchema,
        shift: { type: "number", minimum: -12, maximum: 12 },
        mix: { type: "number", minimum: 0, maximum: 1 },
        preset: { type: "string", enum: FORMANT_PRESETS },
        off: { type: "boolean" },
      },
      additionalProperties: false,
    },
    plan(args, context) {
      const trackId = targetTrack(args, context);
      if ("vowel" in args) throw new ToolArgumentError(FORMANT_VOWEL_HINT);
      const commands: FxCommand[] = [];
      if (args.off === true)
        commands.push({ type: "fx-off", effect: "formant" });
      else {
        if (args.preset !== undefined) {
          if (
            typeof args.preset !== "string" ||
            !FORMANT_PRESETS.includes(args.preset)
          )
            throw new ToolArgumentError(
              `preset must be one of ${FORMANT_PRESETS.join(", ")}`,
            );
          commands.push({
            type: "fx-preset",
            effect: "formant",
            preset: args.preset,
          });
        }
        const values: Record<string, number> = {};
        for (const key of ["shift", "mix"] as const) {
          const value = args[key];
          if (value === undefined) continue;
          if (typeof value !== "number" || !Number.isFinite(value))
            throw new ToolArgumentError(`${key} must be a number`);
          values[key] = value;
        }
        if (Object.keys(values).length > 0)
          commands.push({ type: "fx-set", effect: "formant", values });
        // An empty call turns it on (shift 0, mix 1): a neutral start.
        if (commands.length === 0)
          commands.push({ type: "fx-on", effect: "formant" });
      }
      let score = context.score;
      let message = "";
      for (const command of commands) {
        const result = applyFxCommand(score, trackId, command);
        if (!result.ok) throw new ToolArgumentError(result.message);
        if (result.next) score = result.next;
        message = result.message;
      }
      const track = context.score.tracks.find((t) => t.id === trackId)!;
      const values = effectValues(
        score.tracks.find((t) => t.id === trackId),
        "formant",
      );
      return {
        kind: "score",
        operations: [
          {
            type: "updateTrack",
            trackId,
            patch: effectPatch(track, "formant", values ?? null),
          },
        ],
        trackId,
        summary: `${trackId} ${message}`,
      };
    },
  },
];
/** sing: set_sing, set_vowels. */
export const SING_TOOLS: readonly VoiceTool[] = [];
/** vocoder: set_vocoder, vocode. */
export const VOCODER_TOOLS: readonly VoiceTool[] = [];
/** autotune: autotune_vocal. */
export const AUTOTUNE_TOOLS: readonly VoiceTool[] = [];

/** Every voice tool, in lane order. */
export const VOICE_TOOLS: readonly VoiceTool[] = [
  ...CLIPS_TOOLS,
  ...PITCH_TOOLS,
  ...FORMANT_TOOLS,
  ...SING_TOOLS,
  ...VOCODER_TOOLS,
  ...AUTOTUNE_TOOLS,
];

/** Voice tools a `preview_sound` candidate may use. */
export const VOICE_PREVIEWABLE_TOOLS: readonly string[] = VOICE_TOOLS.filter(
  (tool) => tool.previewable === true,
).map((tool) => tool.name);
