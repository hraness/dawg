/**
 * Ctrl-k rows for the vocoder (0.7, vocoder.md §8): Effects › Voice ›
 * Vocoder (Source picker, Preset, one row per VOCODER_PARAMS key in table
 * order) and Voice › voice presets › Vocoder. Every row runs a
 * `vocoder …` command, so it stages for the audition loop like any other.
 */
import type { NumberParam } from "../../core/params.ts";
import type { Track } from "../../core/score.ts";
import {
  DEFAULT_VOCODER_PRESET,
  VOCODER_INSTRUMENT,
  VOCODER_PARAMS,
  VOCODER_PRESETS,
  VOCODER_PRESET_NAMES,
  resolveVocoder,
  vocoderPresetOf,
  type TrackVocoder,
} from "../../core/vocoder.ts";
import {
  vocoderEntryLines,
  trackHasAudio,
  vocoderCandidates,
} from "../commands/vocoder.ts";
import { num, specStep, type MenuContext, type MenuNode } from "./menu.ts";

const NONE = "none";

function trackOf(context: MenuContext): Track | undefined {
  return context.score.tracks.find((track) => track.id === context.trackId);
}

/** One row per VOCODER_PARAMS key; x and `preset` return it to the preset. */
function paramRow(vocoder: TrackVocoder, name: string): MenuNode {
  const spec = VOCODER_PARAMS[name]!;
  const own = (vocoder as Record<string, unknown>)[name];
  const preset = vocoderPresetOf(vocoder);
  const fallback = (VOCODER_PRESETS[preset].values as Record<string, unknown>)[
    name
  ];
  const resolved = (resolveVocoder(vocoder) as Record<string, unknown>)[name];
  if (spec.kind === "enum")
    return {
      kind: "choice",
      label: name,
      value: own === undefined ? "preset" : String(own),
      options: ["preset", ...spec.values],
      command: (option) =>
        option === "preset"
          ? `vocoder ${name} reset`
          : `vocoder ${name} ${option}`,
      help: `${spec.doc} · preset ${String(resolved)}`,
    };
  if (spec.kind === "boolean")
    return {
      kind: "choice",
      label: name,
      value: own === undefined ? "preset" : own ? "on" : "off",
      options: ["preset", "on", "off"],
      command: (option) =>
        option === "preset"
          ? `vocoder ${name} reset`
          : `vocoder ${name} ${option}`,
      help: `${spec.doc} · preset ${fallback ? "on" : "off"}`,
    };
  const number = spec as NumberParam;
  // gate's preset value is "auto" (from the source's assets): show it as off.
  const value = typeof resolved === "number" ? resolved : undefined;
  return {
    kind: "number",
    label: name,
    value,
    min: number.min,
    max: number.max,
    step: specStep(number),
    format: (v) => (number.unit ? `${num(v)} ${number.unit}` : num(v)),
    command: (v) => `vocoder ${name} ${num(v)}`,
    reset: `vocoder ${name} reset`,
    ...(value === undefined ? { off: "auto", start: number.min } : {}),
    help: `${number.doc} · preset ${typeof fallback === "number" ? num(fallback) : String(resolved ?? "auto")} · x resets`,
  };
}

/** A source as the picker shows it: its name, or its id when names clash. */
function sourceLabel(track: Track, all: readonly Track[]): string {
  const clash = all.some((t) => t.id !== track.id && t.name === track.name);
  return clash || !track.name.trim() ? track.id : track.name;
}

/** `vocoder src <name>`, quoted when the name has spaces. */
function srcCommand(label: string): string {
  return /\s/.test(label) ? `vocoder src "${label}"` : `vocoder src ${label}`;
}

function entryRows(): MenuNode[] {
  return vocoderEntryLines().map((line, index) => ({
    kind: "info",
    label: index === 0 ? "no voice yet" : "",
    value: line.trim(),
  }));
}

/** The rows inside Effects › Voice › Vocoder for the focused track. */
export function vocoderRows(context: MenuContext): MenuNode[] {
  const track = trackOf(context);
  if (!track || track.instrument === "kit") return [];
  const vocoder = track.vocoder;
  const candidates = vocoderCandidates(context.score, track.id);
  const all = context.score.tracks;
  if (!vocoder) {
    if (trackHasAudio(track))
      return [
        {
          kind: "action",
          label: "vocode this voice",
          command: "vocoder",
          help: "adds a vocoder track driven by this voice (follows the song's chords, or drones on the key's root); mutes it",
        },
      ];
    if (candidates.length === 0) return entryRows();
    return [
      {
        kind: "choice",
        label: "source",
        value: NONE,
        options: [NONE, ...candidates.map((t) => sourceLabel(t, all))],
        command: (option) =>
          option === NONE ? "vocoder off" : srcCommand(option),
        help: "the voice that shapes this track's sound",
      },
    ];
  }
  const others = context.score.tracks.filter(
    (t) => t.id !== track.id && t.instrument !== "kit",
  );
  const options = [
    ...candidates.map((t) => sourceLabel(t, all)),
    ...others
      .filter((t) => !candidates.some((c) => c.id === t.id))
      .map((t) => sourceLabel(t, all)),
  ];
  const current = all.find((t) => t.id === vocoder.src);
  const nodes: MenuNode[] = [
    {
      kind: "choice",
      label: "source",
      value: current ? sourceLabel(current, all) : (vocoder.src ?? NONE),
      options: vocoder.src === undefined ? [NONE, ...options] : options,
      command: (option) => (option === NONE ? "vocoder" : srcCommand(option)),
      help: "the modulator; it is heard through the vocoder even when muted",
    },
    {
      kind: "choice",
      label: "preset",
      value: vocoder.preset ?? DEFAULT_VOCODER_PRESET,
      options: VOCODER_PRESET_NAMES,
      command: (option) => `vocoder preset ${option}`,
      help: "classic robot talkbox choir glass whisper smear lofi · keeps your overrides",
    },
    ...Object.keys(VOCODER_PARAMS).map((name) => paramRow(vocoder, name)),
  ];
  if (Object.keys(vocoder).some((key) => key !== "preset" && key !== "src"))
    nodes.push({
      kind: "action",
      label: "reset to preset",
      command: "vocoder reset",
      help: "clear overrides, keep the source and preset",
    });
  nodes.push({
    kind: "action",
    label: "remove the vocoder",
    command: "vocoder off",
    help: "the track plays its own sound again",
  });
  return nodes;
}

/** Effects › Voice › Vocoder. */
export function vocoderEffectNode(context: MenuContext): MenuNode[] {
  const track = trackOf(context);
  if (!track || track.instrument === "kit") return [];
  const vocoder = track.vocoder;
  return [
    {
      kind: "menu",
      id: "voice:vocoder",
      label: "vocoder",
      detail: vocoder
        ? `${vocoder.preset ?? DEFAULT_VOCODER_PRESET}${vocoder.src ? ` · from ${vocoder.src}` : " · no source"}`
        : trackHasAudio(track)
          ? "vocode this voice"
          : "off",
      help: "a voice shapes this track's sound: robot, talkbox, choir",
      build: vocoderRows,
    },
  ];
}

/** Voice › voice presets › Vocoder: the built-in carrier. */
export function vocoderBrowseNode(context: MenuContext): MenuNode[] {
  const track = trackOf(context);
  return [
    {
      kind: "menu",
      id: "voices:vocoder",
      label: "vocoder",
      detail: `${VOCODER_PRESET_NAMES.length} presets · robot, talkbox, choir …`,
      help: "a built-in synth carrier spoken through a voice track",
      build: (inner) => {
        const here = trackOf(inner) ?? track;
        if (here && trackHasAudio(here))
          return [
            {
              kind: "action",
              label: "vocode this voice",
              command: "vocoder",
              help: "adds a vocoder track driven by this voice",
            },
          ];
        if (here?.instrument !== VOCODER_INSTRUMENT)
          return [
            {
              kind: "action",
              label: "make this a vocoder",
              command: `instrument ${VOCODER_INSTRUMENT}`,
              help: "a supersaw carrier; then pick its presets and source here",
            },
            ...(vocoderCandidates(inner.score, inner.trackId).length === 0
              ? entryRows()
              : []),
          ];
        return VOCODER_PRESET_NAMES.map((name): MenuNode => ({
          kind: "action",
          label: `${name.padEnd(8)} ${VOCODER_PRESETS[name].doc}`,
          command: `vocoder ${name}`,
          help: VOCODER_PRESETS[name].doc,
        })).concat(
          vocoderCandidates(inner.score, inner.trackId).length === 0
            ? entryRows()
            : vocoderRows(inner).filter((row) => row.label === "source"),
        );
      },
    },
  ];
}
