/**
 * 0.7 Voice menu rows. The Voice root (Ctrl-K › Voice) gathers every lane:
 * sing, clips and lyrics, pitch, autotune, formant and vocoder, then the
 * voice presets. It is always shown; on a track that is not a voice yet it
 * opens on "turn this track into a voice". Effects keeps a "voice effects"
 * row for formant and vocoder. Each lane fills only its own function below.
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
import {
  singBrowseRows,
  singParameterNodes,
  singVowelNodes,
} from "./sing-menu.ts";
import { parseKey } from "../../core/chords.ts";
import type { Track } from "../../core/score.ts";
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

/** Voice: Clips and Lyrics (clips lane). */
export function clipsSoundRows(context: MenuContext): MenuNode[] {
  return clipMenuRows(context);
}

/** Voice: Pitch with trace, detected key and Make notes (pitch lane). */
export function pitchSoundRows(context: MenuContext): MenuNode[] {
  const track = context.score.tracks.find((t) => t.id === context.trackId);
  if (!track || pitchTargets(track).length === 0) return [];
  const summary = pitchSummary(track.id);
  return [
    {
      kind: "menu",
      id: "voice-pitch",
      label: "pitch",
      detail: summary
        ? `${summary.key ?? "key unclear"} · ${hzName(summary.median)}`
        : "detect key and melody",
      help: "what the audio sings: key, median pitch, a trace on the highway, guide notes",
      build: pitchMenuRows,
    },
  ];
}

/** Voice › Pitch. */
export function pitchMenuRows(context: MenuContext): MenuNode[] {
  const summary = pitchSummary(context.trackId);
  return [
    {
      kind: "action",
      label: "analyze",
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
      label: "make notes",
      command: "/vocal notes",
      help: "a new guide-notes track with one note per sung note",
    },
  ];
}

/**
 * Voice: Autotune (autotune lane). One sub-menu on a track with
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
      label: "autotune",
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
      label: "preset",
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
      label: "to",
      value: own.to === undefined ? "preset" : String(own.to),
      options: ["preset", ...AUTOTUNE_TARGETS],
      command: (option) =>
        option === "preset" ? "autotune to off" : `autotune to ${option}`,
      help: `scale (song or track key and tuning), chromatic, chord timeline or another track's notes · preset ${base.to}`,
    },
    {
      kind: "choice",
      label: "from",
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
      label: "key",
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
      label: spec.label.toLowerCase(),
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
    label: "voice",
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
      label: "formant",
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
 * Voice › voice presets: Vocal (clips), Choir, Solo and Throat
 * (sing), Vocoder (vocoder).
 */
export function voicesBrowseGroup(context: MenuContext): MenuNode[] {
  return [
    ...vocalBrowseRows(context),
    ...singBrowseRows(),
    ...vocoderBrowseNode(context),
  ];
}

/** Every Voice row, in lane order. */
export function voiceSoundRows(context: MenuContext): MenuNode[] {
  return [
    ...clipsSoundRows(context),
    ...pitchSoundRows(context),
    ...autotuneSoundRows(context),
  ];
}

/** Voice effects (formant, vocoder), in lane order; Effects links here. */
export function voiceEffectRows(context: MenuContext): MenuNode[] {
  return [...formantEffectRows(context), ...vocoderEffectRows(context)];
}

/** True when the focused track already sings, speaks or carries vocals. */
export function isVoiceTrack(track: Track | undefined): boolean {
  if (!track) return false;
  return (
    track.instrument === "vocal" ||
    track.instrument === "sing" ||
    (track.clips?.length ?? 0) > 0 ||
    track.autotune !== undefined ||
    track.vocoder !== undefined
  );
}

/** The Voice root's detail: what the focused track's voice is now. */
export function voiceRootDetail(context: MenuContext): string {
  const track = context.score.tracks.find((t) => t.id === context.trackId);
  if (!isVoiceTrack(track)) return "turn this track into a voice";
  const parts: string[] = [];
  if (track!.instrument === "sing")
    parts.push(`sing${track!.sing?.preset ? ` ${track!.sing.preset}` : ""}`);
  const clips = track!.clips?.length ?? 0;
  if (clips) parts.push(`${clips} clip${clips === 1 ? "" : "s"}`);
  if (track!.autotune) parts.push("autotune");
  if (track!.vocoder) parts.push("vocoder");
  if (parts.length === 0) parts.push(track!.instrument);
  return parts.join(" · ");
}

/** Ctrl-K › Voice › voice presets: vocal, choirs, solos, throat, vocoders. */
function voicePresetsNode(detail: string): MenuNode {
  return {
    kind: "menu",
    id: "voice:presets",
    label: "voice presets",
    detail,
    help: "vocal clips, sung choirs and solos, throat singing, vocoders",
    build: voicesBrowseGroup,
  };
}

/**
 * Ctrl-K › Voice. Always shown: a track that is not a voice yet opens on
 * the voice presets ("turn this track into a voice"), then clips and lyrics
 * so a take can be imported straight away.
 */
export function voiceRootNodes(context: MenuContext): MenuNode[] {
  const track = context.score.tracks.find((t) => t.id === context.trackId);
  if (!track) return [];
  const voice = isVoiceTrack(track);
  const sing: MenuNode[] =
    track.instrument === "sing" && track.sing
      ? [
          {
            kind: "menu",
            id: "voice:sing",
            label: "sing",
            detail: track.sing.preset ?? "custom",
            help: "the built-in singing voice: preset, vowel, voices, breath, formant, throat",
            build: (inner) => {
              const now = inner.score.tracks.find(
                (t) => t.id === inner.trackId,
              );
              return now
                ? [
                    ...singParameterNodes(
                      now,
                      parseKey(inner.score.key ?? undefined)?.tonic,
                    ),
                    ...singVowelNodes(inner),
                  ]
                : [];
            },
          },
        ]
      : [];
  return [
    ...(voice ? [] : [voicePresetsNode("turn this track into a voice")]),
    ...sing,
    ...voiceSoundRows(context),
    ...voiceEffectRows(context),
    ...(voice ? [voicePresetsNode("vocal, choir, solo, throat, vocoder")] : []),
  ];
}
