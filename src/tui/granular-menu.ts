/**
 * Ctrl-K rows for the granular instrument (core/granular.ts): the
 * Sound > Granular subsection and the Granular group of Sound > browse
 * sounds. Every row is a `grain …` command, so the menu teaches the command
 * and an edit is one revision, one receipt and one undo step.
 */
import { isDrumInstrument } from "../../core/drums.ts";
import {
  DEFAULT_GRANULAR_SOURCE,
  GRANULAR_PARAMS,
  GRANULAR_PRESET_NAMES,
  GRANULAR_PRESETS,
  granularSourceLabel,
  isGranularInstrument,
  parseSynthSource,
  resolveGranular,
  type GranularSettings,
} from "../../core/granular.ts";
import type { NumberParam } from "../../core/params.ts";
import type { Track } from "../../core/score.ts";

/** The subset of the menu's node shape these rows use. */
export type GranularMenuNode =
  | Readonly<{
      kind: "number";
      label: string;
      help: string;
      value: number | undefined;
      start: number;
      off: string;
      min: number;
      max: number;
      step: (value: number, direction: 1 | -1) => number;
      format: (value: number) => string;
      command: (value: number) => string;
      reset: string;
    }>
  | Readonly<{
      kind: "toggle";
      label: string;
      help: string;
      value: boolean;
      command: (value: boolean) => string;
    }>
  | Readonly<{
      kind: "choice";
      label: string;
      help: string;
      value: string;
      options: readonly string[];
      command: (option: string) => string;
    }>
  | Readonly<{
      kind: "entry";
      label: string;
      help: string;
      value: string;
      placeholder: string;
      command: (text: string) => string | undefined;
      example: string;
    }>
  | Readonly<{ kind: "action"; label: string; help: string; command: string }>
  | Readonly<{ kind: "info"; label: string; value: string; help?: string }>;

/** Menu labels for the stored keys, in the review's row order. */
export const GRANULAR_MENU_ROWS: readonly (readonly [string, string])[] =
  Object.freeze([
    ["begin", "begin"],
    ["end", "end"],
    ["root", "root note"],
    ["pos", "position"],
    ["scan", "scan"],
    ["grain", "grain"],
    ["overlap", "overlap"],
    ["jitter", "jitter"],
    ["spray", "spray"],
    ["pitch", "pitch"],
    ["detune", "detune"],
    ["shimmer", "shimmer"],
    ["shimint", "shimmer interval"],
    ["repeat", "repeat"],
    ["hold", "hold"],
    ["drift", "drift"],
    ["drate", "drift rate"],
    ["spread", "spread"],
    ["window", "window"],
    ["reverse", "reverse"],
    ["freeze", "freeze"],
    ["attack", "attack"],
    ["release", "release"],
    ["veltone", "velocity tone"],
    ["gain", "gain"],
    ["seed", "seed"],
  ]);

/** Presets that need a resampled phrase to sound as named. */
const PHRASE_PRESETS: ReadonlySet<string> = new Set([
  "microloop",
  "sparkle",
  "backwards",
]);

function text(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function stepper(
  spec: NumberParam,
): (value: number, direction: 1 | -1) => number {
  if (spec.step === "log")
    return (value, direction) =>
      Math.min(
        spec.max,
        Math.max(
          spec.min,
          Number((Math.max(value, 1e-3) * 2 ** (direction / 6)).toFixed(4)),
        ),
      );
  const size = spec.step;
  return (value, direction) =>
    Math.min(
      spec.max,
      Math.max(
        spec.min,
        Number(
          (Math.round((value + size * direction) / size) * size).toFixed(6),
        ),
      ),
    );
}

/** Whether a track shows the granular subsection, and how it is labelled. */
export function granularMenuLabel(
  track: Track | undefined,
): string | undefined {
  if (!track || track.kit || isDrumInstrument(track.instrument))
    return undefined;
  return isGranularInstrument(track.instrument) ? "granular" : "granular";
}

/** One-line state for the subsection's detail column. */
export function granularMenuDetail(track: Track): string {
  if (!isGranularInstrument(track.instrument))
    return track.sampler
      ? "grain this sampler's voice"
      : "grain this track's synth";
  return `${track.granular?.preset ?? "default"} · ${granularSourceLabel(track.granular?.src)}`;
}

/**
 * Sound > Granular: on a granular track the preset, source and every
 * parameter; elsewhere the presets that convert the track (its own sound
 * becomes the source) plus a plain `grain on`.
 */
export function granularMenuNodes(
  track: Track | undefined,
): GranularMenuNode[] {
  if (!track || !granularMenuLabel(track)) return [];
  if (!isGranularInstrument(track.instrument))
    return [
      {
        kind: "action",
        label: "grain this sound",
        help: track.sampler
          ? "turn this sampler's first voice into a grain cloud (grain off goes back)"
          : "turn this track's synth into a grain cloud (grain off goes back)",
        command: "grain on",
      },
      ...GRANULAR_PRESET_NAMES.map((name): GranularMenuNode => ({
        kind: "action",
        label: `${name.padEnd(10)} ${GRANULAR_PRESETS[name].doc}`,
        help: `grain ${name}: this track's sound through the ${name} preset`,
        command: `grain ${name}`,
      })),
    ];
  const settings = resolveGranular(track.granular);
  const own = track.granular ?? {};
  const preset = track.granular?.preset;
  const builtIn =
    typeof settings.src === "string" &&
    parseSynthSource(settings.src) !== undefined;
  const nodes: GranularMenuNode[] = [
    {
      kind: "choice",
      label: "preset",
      help:
        preset && PHRASE_PRESETS.has(preset) && builtIn
          ? `${GRANULAR_PRESETS[preset].doc} (on a resample; a texture on a synth source)`
          : preset
            ? GRANULAR_PRESETS[preset].doc
            : "left/right cycles presets; space previews",
      value: preset ?? "",
      options: GRANULAR_PRESET_NAMES,
      command: (name) => `grain ${name}`,
    },
    {
      kind: "entry",
      label: "source",
      help: "synth:<preset>[@note] or voice <V> of this track's sampler",
      value: granularSourceLabel(track.granular?.src),
      placeholder: DEFAULT_GRANULAR_SOURCE,
      command: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        return /^voice\s+\S+$/.test(trimmed)
          ? `grain src ${trimmed}`
          : `grain src ${trimmed.startsWith("synth:") ? trimmed : `synth:${trimmed}`}`;
      },
      example: "grain src synth:bell",
    },
  ];
  for (const [key, label] of GRANULAR_MENU_ROWS) {
    const spec = GRANULAR_PARAMS[key]!;
    const stored = (own as Record<string, unknown>)[key];
    const current = settings[key as keyof GranularSettings];
    if (spec.kind === "number") {
      const base = typeof current === "number" ? current : spec.default;
      nodes.push({
        kind: "number",
        label: spec.unit ? `${label} (${spec.unit})` : label,
        help: spec.doc,
        value: typeof stored === "number" ? stored : undefined,
        start: base,
        off: text(base),
        min: spec.min,
        max: spec.max,
        step: stepper(spec),
        format: text,
        command: (value) => `grain ${key} ${text(value)}`,
        reset: `grain ${key} off`,
      });
    } else if (spec.kind === "enum")
      nodes.push({
        kind: "choice",
        label,
        help: spec.doc,
        value: String(current),
        options: spec.values,
        command: (option) => `grain ${key} ${option}`,
      });
    else if (spec.kind === "boolean")
      nodes.push({
        kind: "toggle",
        label,
        help: spec.doc,
        value: current === true,
        command: (on) => `grain ${key} ${on ? "on" : "off"}`,
      });
  }
  if (Object.keys(own).some((key) => key !== "preset" && key !== "src"))
    nodes.push({
      kind: "action",
      label: "reset to preset",
      help: "drop this track's grain overrides, keep the preset and source",
      command: "grain reset",
    });
  nodes.push({
    kind: "action",
    label: "grain off",
    help: "back to this track's previous voice (settings are kept)",
    command: "grain off",
  });
  return nodes;
}

/** Sound > browse sounds > Granular: one row per preset. */
export function granularBrowseNodes(): GranularMenuNode[] {
  return GRANULAR_PRESET_NAMES.map((name) => ({
    kind: "action",
    label: `${name.padEnd(10)} ${GRANULAR_PRESETS[name].doc}`,
    help: PHRASE_PRESETS.has(name)
      ? `grain ${name} (comes into its own on a resampled phrase)`
      : `grain ${name}: the built-in or this track's sound as a grain cloud`,
    command: `grain ${name}`,
  }));
}
