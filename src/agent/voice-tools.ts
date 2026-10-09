/**
 * 0.7 Voice agent tools, one array per lane. The contract spreads
 * `VOICE_TOOLS` once into `AGENT_TOOLS` and `VOICE_PREVIEWABLE_TOOLS` once
 * into `preview_sound`'s list; each lane fills only its own array and flags
 * tools that change how a track sounds with `previewable: true`.
 */
import type { AgentTool } from "./tools.ts";

/** An agent tool, optionally usable as a `preview_sound` candidate. */
export type VoiceTool = AgentTool & Readonly<{ previewable?: boolean }>;

/** clips: place_clip, edit_clip, set_lyrics. */
export const CLIPS_TOOLS: readonly VoiceTool[] = [];
/** pitch: analyze_pitch, pitch_to_notes. */
export const PITCH_TOOLS: readonly VoiceTool[] = [];
/** formant: set_formant. */
export const FORMANT_TOOLS: readonly VoiceTool[] = [];
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
