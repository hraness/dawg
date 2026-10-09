/**
 * `shift <semitones> [formant keep|follow|<n>] [<voice>]` and
 * `fade [in|out] <seconds> [<voice>]` (0.6.1): pitch a sampler voice
 * without changing its length, and set its fade in and out. They act on
 * the focused sampler track's voice (named, or its only one) through
 * `setSampleControls`, so validation and printing stay the sampler's.
 */
import type { TrackScore } from "../../core/score.ts";
import { fitVoice } from "./fit.ts";
import {
  setSampleControls,
  type SampleControlValue,
  type SetSampleResult,
} from "./sample.ts";

export type ShiftCommand =
  | Readonly<{
      kind: "shift";
      /** Semitones; null clears shift and formant. */
      semitones: number | null;
      /** 0 keeps the formants, null follows the pitch, undefined leaves it. */
      formant?: number | null;
      voice?: string;
    }>
  | Readonly<{
      kind: "fade";
      /** `in` is fadeInTime, `out` fadeTime, `both` sets each. */
      edge: "in" | "out" | "both";
      seconds: number | null;
      voice?: string;
    }>;

const VOICE = "([a-z][a-z0-9_]{0,31})";
const NUMBER = "([+-]?\\d+(?:\\.\\d+)?|off|none)";

/** Parse `shift ...` and `fade ...` (with or without the slash). */
export function parseShiftCommand(command: string): ShiftCommand | undefined {
  const text = command.trim();
  const shift = text.match(
    new RegExp(
      `^/?shift\\s+${NUMBER}(?:\\s+formant\\s+(keep|follow|[+-]?\\d+(?:\\.\\d+)?))?(?:\\s+(?:voice\\s+)?${VOICE})?$`,
      "i",
    ),
  );
  if (shift) {
    const raw = shift[1]!.toLowerCase();
    const formant = shift[2]?.toLowerCase();
    return {
      kind: "shift",
      semitones: raw === "off" || raw === "none" ? null : Number(raw),
      ...(formant === undefined
        ? {}
        : {
            formant:
              formant === "keep"
                ? 0
                : formant === "follow"
                  ? null
                  : Number(formant),
          }),
      ...(shift[3] ? { voice: shift[3].toLowerCase() } : {}),
    };
  }
  const fade = text.match(
    new RegExp(
      `^/?fade(?:\\s+(in|out))?\\s+${NUMBER}(?:\\s+(?:voice\\s+)?${VOICE})?$`,
      "i",
    ),
  );
  if (!fade) return undefined;
  const raw = fade[2]!.toLowerCase();
  return {
    kind: "fade",
    edge: (fade[1]?.toLowerCase() as "in" | "out" | undefined) ?? "both",
    seconds: raw === "off" || raw === "none" ? null : Number(raw),
    ...(fade[3] ? { voice: fade[3].toLowerCase() } : {}),
  };
}

/** Apply a parsed `shift` or `fade` to the focused track's voice. */
export function applyShiftCommand(
  score: TrackScore,
  trackId: string,
  command: ShiftCommand,
): SetSampleResult {
  const target = fitVoice(score, trackId, command.voice);
  if ("error" in target)
    return {
      ok: false,
      message: target.error.replace(/^fit · /, `${command.kind} · `),
    };
  const values: Record<string, SampleControlValue> = {};
  if (command.kind === "shift") {
    // `shift off` clears the shift and its formant setting. `shift 0`
    // clears the shift and a kept formant (0, a no-op without a shift) but
    // keeps a formant move, so `shift 0 formant 3` is a formant-only move
    // and stepping the shift through 0 keeps a stored formant.
    if (command.semitones === null) {
      values.shift = null;
      values.formant = null;
    } else {
      values.shift = command.semitones === 0 ? null : command.semitones;
      const formant =
        command.formant !== undefined
          ? command.formant
          : score.tracks.find((track) => track.id === trackId)?.sampler?.voices[
              target.voice
            ]?.formant;
      if (command.semitones === 0 && (formant === 0 || formant === null))
        values.formant = null;
      else if (command.formant !== undefined) values.formant = command.formant;
    }
  } else {
    const seconds = command.seconds === 0 ? null : command.seconds;
    if (command.edge !== "out") values.fadeInTime = seconds;
    if (command.edge !== "in") values.fadeTime = seconds;
  }
  return setSampleControls(score, trackId, target.voice, values);
}
