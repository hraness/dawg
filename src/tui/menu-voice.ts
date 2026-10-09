/**
 * 0.7 Voice menu rows. The contract mounts three groups once (Sound > Voice,
 * Effects > Voice and Sound > browse sounds > Voices) and hides each while
 * every lane's rows are empty. Each lane fills only its own function below.
 */
import { effectSpec } from "../../core/fx.ts";
import { effectValues } from "../commands/fx.ts";
import {
  hzName,
  pitchSummary,
  pitchTargets,
  pitchTraceFor,
} from "../commands/vocal-pitch.ts";
import { effectParamNodes, type MenuContext, type MenuNode } from "./menu.ts";
import { singBrowseRows } from "./sing-menu.ts";
import { clipMenuRows, vocalBrowseRows } from "./menu-clips.ts";
import { vocoderBrowseNode, vocoderEffectNode } from "./vocoder-menu.ts";

/** Sound > Voice: Clips and Lyrics (clips lane). */
export function clipsSoundRows(context: MenuContext): MenuNode[] {
  return clipMenuRows(context);
}

/** Sound > Voice: Pitch with trace, detected key and Make notes (pitch lane). */
export function pitchSoundRows(context: MenuContext): MenuNode[] {
  const track = context.score.tracks.find((t) => t.id === context.trackId);
  if (!track || pitchTargets(track).length === 0) return [];
  const summary = pitchSummary(track.id);
  return [
    {
      kind: "menu",
      id: "voice-pitch",
      label: "Pitch",
      detail: summary
        ? `${summary.key ?? "key unclear"} · ${hzName(summary.median)}`
        : "detect key and melody",
      help: "what the audio sings: key, median pitch, a trace on the highway, guide notes",
      build: pitchMenuRows,
    },
  ];
}

/** Sound > Voice > Pitch. */
export function pitchMenuRows(context: MenuContext): MenuNode[] {
  const summary = pitchSummary(context.trackId);
  return [
    {
      kind: "action",
      label: "Analyze",
      command: "/vocal pitch",
      help: "track the pitch of the focused clip or sample (cached in .dawg/analysis)",
    },
    {
      kind: "info",
      label: "detected key",
      value: summary ? (summary.key ?? "unclear") : "-",
      help: summary
        ? `from ${summary.label}`
        : "Analyze first; the key comes from the notes the audio sings",
    },
    {
      kind: "info",
      label: "median pitch",
      value: summary ? hzName(summary.median) : "-",
    },
    {
      kind: "toggle",
      label: "trace",
      value: pitchTraceFor(context.trackId) !== undefined,
      command: (on) => `/vocal pitch trace ${on ? "on" : "off"}`,
      help: "a dotted line of the sung pitch on the highway; warning colour past 15 cents off",
    },
    {
      kind: "action",
      label: "Make notes",
      command: "/vocal notes",
      help: "a new guide-notes track with one note per sung note",
    },
  ];
}

/** Sound > Voice: Autotune (autotune lane). */
export function autotuneSoundRows(_context: MenuContext): MenuNode[] {
  return [];
}

/**
 * Effects > Voice: Formant (formant lane). The fx rows (on, preset, shift,
 * mix, advanced, reset) are the shared effect rows, so left/right, x and
 * the space audition behave as every other effect's.
 */
export function formantEffectRows(context: MenuContext): MenuNode[] {
  const track = context.score.tracks.find(
    (candidate) => candidate.id === context.trackId,
  );
  if (!track) return [];
  const values = effectValues(track, "formant");
  return [
    {
      kind: "menu",
      id: "formant",
      label: "Formant",
      detail: values
        ? `shift ${values.shift} st · mix ${values.mix}`
        : "off · shift the throat, keep the pitch",
      help: effectSpec("formant").doc,
      build: (inner) => effectParamNodes(inner, "formant", false),
    },
  ];
}

/** Effects > Voice: Vocoder with a Source picker (vocoder lane). */
export function vocoderEffectRows(context: MenuContext): MenuNode[] {
  return vocoderEffectNode(context);
}

/**
 * Sound > browse sounds > Voices: Vocal (clips), Choir, Solo and Throat
 * (sing), Vocoder (vocoder).
 */
export function voicesBrowseGroup(context: MenuContext): MenuNode[] {
  return [
    ...vocalBrowseRows(context),
    ...singBrowseRows(),
    ...vocoderBrowseNode(context),
  ];
}

/** Every Sound > Voice row, in lane order. */
export function voiceSoundRows(context: MenuContext): MenuNode[] {
  return [
    ...clipsSoundRows(context),
    ...pitchSoundRows(context),
    ...autotuneSoundRows(context),
  ];
}

/** Every Effects > Voice row, in lane order. */
export function voiceEffectRows(context: MenuContext): MenuNode[] {
  return [...formantEffectRows(context), ...vocoderEffectRows(context)];
}

/**
 * A sub-menu that exists only while it has rows: `[]` when `rows` is empty,
 * so a group no lane has filled never shows.
 */
export function voiceGroup(
  id: string,
  label: string,
  help: string,
  rows: (context: MenuContext) => MenuNode[],
  context: MenuContext,
): MenuNode[] {
  const now = rows(context);
  if (now.length === 0) return [];
  return [
    {
      kind: "menu",
      id,
      label,
      detail: now.map((row) => row.label).join(" · "),
      help,
      build: rows,
    },
  ];
}
