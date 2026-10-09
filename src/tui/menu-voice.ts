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
import {
  effectParamNodes,
  num,
  type MenuContext,
  type MenuNode,
} from "./menu.ts";
import { singBrowseRows } from "./sing-menu.ts";
import { clipMenuRows, vocalBrowseRows } from "./menu-clips.ts";
import { vocoderBrowseNode, vocoderEffectNode } from "./vocoder-menu.ts";
import {
  AUTOTUNE_PARAMS,
  AUTOTUNE_PRESET_HELP,
  AUTOTUNE_PRESETS,
  AUTOTUNE_TARGETS,
  AUTOTUNE_VOICES,
  describeAutotune,
  resolveAutotune,
} from "../../core/autotune.ts";
import { autotuneEngineNote } from "../audio/autotune.ts";

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
      help: "a dotted line of the sung pitch on the highway; warning color past 15 cents off",
    },
    {
      kind: "action",
      label: "Make notes",
      command: "/vocal notes",
      help: "a new guide-notes track with one note per sung note",
    },
  ];
}

/**
 * Sound > Voice: Autotune (autotune lane). One sub-menu on a track with
 * audio to tune (clips, a sampler, the `vocal` word, or autotune set): Preset (off or one of nine), To, From, Key, the AUTOTUNE_PARAMS
 * numbers and Voice. Each row runs an `autotune …` command, so space
 * auditions it with staged A/B and x puts a field back to the preset's.
 */
export function autotuneSoundRows(context: MenuContext): MenuNode[] {
  const track = context.score.tracks.find(
    (candidate) => candidate.id === context.trackId,
  );
  // It tunes audio: clips and sampler voices (and a track already set).
  if (
    !track ||
    !(
      track.autotune ||
      track.sampler ||
      (track.clips?.length ?? 0) > 0 ||
      track.instrument === "vocal"
    )
  )
    return [];
  const current = track.autotune;
  return [
    {
      kind: "menu",
      id: "voice:autotune",
      label: "Autotune",
      detail: current
        ? `${describeAutotune(current)}${autotuneEngineNote()}`
        : "off",
      help: "pitch correction on the track's clips and sampler voices, gentle to hard",
      build: autotuneRows,
    },
  ];
}

function autotuneRows(context: MenuContext): MenuNode[] {
  const track = context.score.tracks.find(
    (candidate) => candidate.id === context.trackId,
  );
  if (!track) return [];
  const current = track.autotune;
  const resolved = current ? resolveAutotune(current) : undefined;
  const base = resolveAutotune({ preset: current?.preset ?? "pop" });
  const own = (current ?? {}) as Readonly<Record<string, unknown>>;
  const nodes: MenuNode[] = [
    {
      kind: "choice",
      label: "Preset",
      value: current ? (current.preset ?? "pop") : "off",
      options: ["off", ...AUTOTUNE_PRESETS],
      command: (option) =>
        option === "off" ? "autotune off" : `autotune ${option}`,
      help: current
        ? AUTOTUNE_PRESET_HELP[current.preset ?? "pop"]
        : "hard robot warble trap pop natural gentle guided locked",
    },
    {
      kind: "choice",
      label: "To",
      value: own.to === undefined ? "preset" : String(own.to),
      options: ["preset", ...AUTOTUNE_TARGETS],
      command: (option) =>
        option === "preset" ? "autotune to off" : `autotune to ${option}`,
      help: `scale (song or track key and tuning), chromatic, chord timeline or another track's notes · preset ${base.to}`,
    },
    {
      kind: "choice",
      label: "From",
      value: current?.from ?? "own notes",
      options: [
        "own notes",
        ...context.score.tracks
          .filter(
            (other) => other.id !== track.id && other.instrument !== "kit",
          )
          .map((other) => other.id),
      ],
      command: (option) =>
        option === "own notes"
          ? "autotune from off"
          : `autotune to notes ${option}`,
      help: "the track whose notes guide the notes target; own notes uses this track's notes",
    },
    {
      kind: "entry",
      label: "Key",
      value: current?.key ?? (context.score.key ? "song" : "none (chromatic)"),
      placeholder: "a key: A minor, D bayati, C# major",
      command: (text) =>
        text.trim() === "" || /^(song|off)$/i.test(text.trim())
          ? "autotune key off"
          : `autotune key ${text.trim()}`,
      example: "/autotune key D bayati",
      help: "the scale target's key; empty follows the song key",
    },
  ];
  for (const spec of AUTOTUNE_PARAMS) {
    const value = (resolved as Readonly<Record<string, unknown>> | undefined)?.[
      spec.name
    ] as number | undefined;
    const fallback =
      ((base as Readonly<Record<string, unknown>>)[spec.name] as
        number | undefined) ?? spec.def;
    nodes.push({
      kind: "number",
      label: spec.label,
      value: current ? (value ?? fallback) : undefined,
      min: spec.min,
      max: spec.max,
      step: (v, direction) =>
        Math.min(
          spec.max,
          Math.max(
            spec.min,
            Math.round((v + spec.step * direction) / spec.step) * spec.step,
          ),
        ),
      // glide is stored in seconds and reads in ms, like /glide.
      format: (v) =>
        spec.name === "glide"
          ? `${Math.round(v * 1000)} ms`
          : `${num(v)}${spec.unit ? ` ${spec.unit}` : ""}`,
      command: (v) =>
        spec.name === "glide"
          ? `autotune glide ${Math.round(v * 1000)}ms`
          : `autotune ${spec.name} ${num(v)}`,
      off: "off",
      start: fallback,
      reset: `autotune ${spec.name} off`,
      help: `${spec.help} · preset ${num(fallback)} · x resets`,
    });
  }
  nodes.push({
    kind: "choice",
    label: "Voice",
    value: current?.voice ?? "auto",
    options: AUTOTUNE_VOICES,
    command: (option) => `autotune voice ${option}`,
    help: "the tracking range: auto, or bass tenor alto soprano to stop octave slips",
  });
  if (current && Object.keys(current).some((key) => key !== "preset"))
    nodes.push({
      kind: "action",
      label: "reset to preset",
      command: "autotune reset",
      help: "keep the preset, drop every override",
    });
  return nodes;
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
