/**
 * `/fitmode <mode>`, `/bpm <n>` and `/len <beats>` (0.6): fit a sampler
 * voice to the song's time. They act on the focused sampler track's voice
 * (named, or its only voice) through `setSampleControls`, so validation and
 * printing stay the sampler's. `/fitmode` with no mode suggests one from
 * the sample's content (`suggestFitMode`); song tempo stays `/tempo`.
 */
import {
  SAMPLE_FIT_MODES,
  isSamplerInstrument,
  samplerVoiceSlots,
  type SampleFitMode,
  type TrackScore,
} from "../../core/score.ts";
import { setSampleControls, type SetSampleResult } from "./sample.ts";

export type FitCommand = Readonly<{
  control: "fitmode" | "bpm" | "len";
  /** Undefined: `/fitmode` alone (suggest) or `off`-style unset is null. */
  value: SampleFitMode | number | null | undefined;
  voice?: string;
}>;

const VOICE = "([a-z][a-z0-9_]{0,31})";

/**
 * Parse `/fitmode [mode|auto|off [voice]]`, `/bpm <n|off> [voice]`,
 * `/len <beats|off> [voice]`. `fitmode` and `len` also work without the
 * slash; a bare `bpm 120` stays the song's tempo word, so `/bpm` needs it.
 */
export function parseFitCommand(command: string): FitCommand | undefined {
  const text = command.trim();
  const mode = text.match(
    new RegExp(
      `^/?fitmode(?:\\s+(repitch|beats|tones|auto|off|none)(?:\\s+${VOICE})?)?$`,
      "i",
    ),
  );
  if (mode) {
    const raw = mode[1]?.toLowerCase();
    return {
      control: "fitmode",
      value:
        raw === undefined || raw === "auto"
          ? undefined
          : raw === "off" || raw === "none"
            ? null
            : (raw as SampleFitMode),
      ...(mode[2] ? { voice: mode[2].toLowerCase() } : {}),
    };
  }
  const number = text.match(
    new RegExp(
      `^(/bpm|/?len)\\s+(\\d+(?:\\.\\d+)?|off|none)(?:\\s+${VOICE})?$`,
      "i",
    ),
  );
  if (!number) return undefined;
  const raw = number[2]!.toLowerCase();
  return {
    control: number[1]!.toLowerCase().replace("/", "") as "bpm" | "len",
    value: raw === "off" || raw === "none" ? null : Number(raw),
    ...(number[3] ? { voice: number[3].toLowerCase() } : {}),
  };
}

/**
 * The voice a fit command acts on: the named one, else the track's only
 * voice (lowest slot first when it has several and none is named).
 */
export function fitVoice(
  score: TrackScore,
  trackId: string,
  voice: string | undefined,
): { voice: string } | { error: string } {
  const track = score.tracks.find((item) => item.id === trackId);
  const sampler = track?.sampler;
  if (!track || !sampler || !isSamplerInstrument(track.instrument))
    return {
      error: `fit · ${trackId} is not a sampler track · /sample <path> first · song tempo is /tempo <bpm>`,
    };
  if (voice) return { voice };
  const names = Object.keys(sampler.voices);
  if (names.length === 1) return { voice: names[0]! };
  const slots = samplerVoiceSlots(sampler);
  const sorted = names.sort(
    (a, b) => (slots.get(a) ?? 0) - (slots.get(b) ?? 0) || (a < b ? -1 : 1),
  );
  return {
    error: `fit · ${trackId} has ${names.length} voices · name one: ${sorted.join(" ")}`,
  };
}

/** Apply a parsed fit command with a known value (a suggested mode resolved). */
export function applyFitCommand(
  score: TrackScore,
  trackId: string,
  command: FitCommand,
  mode?: SampleFitMode,
): SetSampleResult {
  const target = fitVoice(score, trackId, command.voice);
  if ("error" in target) return { ok: false, message: target.error };
  const value = command.value === undefined ? (mode ?? null) : command.value;
  if (command.control === "fitmode" && value !== null) {
    const ref = score.tracks.find((t) => t.id === trackId)?.sampler?.voices[
      target.voice
    ];
    if (
      ref &&
      value !== "repitch" &&
      ref.bpm === undefined &&
      ref.len === undefined &&
      ref.fit !== true
    )
      return {
        ok: false,
        message: `fit · fitmode ${String(value)} needs the sample's tempo first · /bpm <n> or /len <beats>`,
      };
  }
  const values: Record<string, number | string | null> = {
    [command.control]: value,
  };
  // Unsetting bpm or len leaves a fitmode with nothing to fit: unset both.
  if (value === null && command.control !== "fitmode") {
    const ref = score.tracks.find((t) => t.id === trackId)?.sampler?.voices[
      target.voice
    ];
    const other = command.control === "bpm" ? ref?.len : ref?.bpm;
    if (ref?.fitmode && other === undefined && ref.fit !== true)
      values.fitmode = null;
  }
  return setSampleControls(score, trackId, target.voice, values);
}

export const FIT_MODES = SAMPLE_FIT_MODES;
