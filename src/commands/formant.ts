/**
 * `/formant` and `/vowel` (0.7): short forms of `fx formant` and `fx vowel`
 * on the focused track. Both build the same `FxCommand` as `fx`, so the
 * edit, validation and undo step are the fx command's.
 *
 *   formant                       show the shift and mix
 *   formant <-12..12> [mix]       shift the formants (pitch stays): -4 deeper
 *   formant <preset>              deep giant bright tiny
 *   formant shift <st> mix <0..1> spelled out
 *   formant off | reset           remove it | back to 0 st, mix 1
 *
 *   vowel                         show the vowel filter
 *   vowel <v> [<to> [<morph>]]    a, or a morphing towards o (morph 0.5)
 *   vowel to <v> | morph <0..1>   change one part of the morph
 *   vowel mix <0..1> | off
 *
 * `/vocal formant …` runs the same `/formant` grammar.
 */
import { FX_PRESETS, VOWEL_VALUES } from "../../core/fx.ts";
import type { TrackScore } from "../../core/score.ts";
import {
  applyFxCommand,
  effectValues,
  parseFxCommand,
  type FxCommand,
  type FxResult,
} from "./fx.ts";

export const FORMANT_USAGE =
  "formant <-12..12> [mix] | <deep|giant|bright|tiny> | off";
export const VOWEL_USAGE = "vowel <a|e|i|o|u…> [<to> [<morph 0..1>]] | off";

export type FormantCommand =
  | Readonly<{ type: "show"; effect: "formant" | "vowel" }>
  | Readonly<{ type: "fx"; command: FxCommand }>
  | Readonly<{ type: "error"; message: string }>;

const isVowel = (word: string): boolean =>
  (VOWEL_VALUES as readonly string[]).includes(word);

/** A number word such as `-3`, `+2.5` or `-4st`. */
function numberWord(word: string): number | undefined {
  const match = word.match(/^([+-]?\d+(?:\.\d+)?|[+-]?\.\d+)(?:st)?$/i);
  return match ? Number(match[1]) : undefined;
}

/** Parse `/formant …` (the slash is optional only with arguments). */
export function parseFormantCommand(
  command: string,
): FormantCommand | undefined {
  const match = command.trim().match(/^\/formant(?:\s+(.*))?$/i);
  if (!match) return undefined;
  return formantArgs(match[1] ?? "");
}

/** The words after `/formant` (shared with `/vocal formant`). */
export function formantArgs(args: string): FormantCommand {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { type: "show", effect: "formant" };
  const [first, ...rest] = words as [string, ...string[]];
  if (rest.length === 0 && (first === "off" || first === "reset"))
    return {
      type: "fx",
      command: {
        type: first === "off" ? "fx-off" : "fx-reset",
        effect: "formant",
      },
    };
  if (rest.length === 0 && FX_PRESETS.formant?.[first])
    return {
      type: "fx",
      command: { type: "fx-preset", effect: "formant", preset: first },
    };
  const shift = numberWord(first);
  if (shift !== undefined && rest.length <= 1) {
    const mix = rest[0] === undefined ? undefined : numberWord(rest[0]);
    if (rest.length === 1 && mix === undefined)
      return { type: "error", message: `usage: /${FORMANT_USAGE}` };
    return {
      type: "fx",
      command: {
        type: "fx-set",
        effect: "formant",
        values: { shift, ...(mix === undefined ? {} : { mix }) },
      },
    };
  }
  if (isVowel(first) || words.includes("vowel"))
    return {
      type: "error",
      message:
        "formant now shifts formants at constant pitch; the vowel filter is `vowel` · /vowel " +
        (isVowel(first) ? first : "a"),
    };
  const generic = parseFxCommand(`fx formant ${words.join(" ")}`);
  if (generic) return { type: "fx", command: generic };
  return { type: "error", message: `usage: /${FORMANT_USAGE}` };
}

/** Parse `/vowel …`. */
export function parseVowelCommand(command: string): FormantCommand | undefined {
  const match = command.trim().match(/^\/vowel(?:\s+(.*))?$/i);
  if (!match) return undefined;
  const words = (match[1] ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return { type: "show", effect: "vowel" };
  const [first, second, third] = words;
  if (words.length === 1 && (first === "off" || first === "reset"))
    return {
      type: "fx",
      command: {
        type: first === "off" ? "fx-off" : "fx-reset",
        effect: "vowel",
      },
    };
  if (isVowel(first!) && words.length <= 3) {
    if (second === undefined)
      return {
        type: "fx",
        command: {
          type: "fx-replace",
          effect: "vowel",
          values: { vowel: first!, mix: 1 },
        },
      };
    const morph = third === undefined ? 0.5 : numberWord(third);
    if (!isVowel(second) || morph === undefined)
      return { type: "error", message: `usage: /${VOWEL_USAGE}` };
    return {
      type: "fx",
      command: {
        type: "fx-replace",
        effect: "vowel",
        values: { vowel: first!, mix: 1, to: second, morph },
      },
    };
  }
  const generic = parseFxCommand(`fx vowel ${words.join(" ")}`);
  if (generic && generic.type === "fx-set")
    return {
      type: "fx",
      // `/vowel to o` alone starts halfway so the morph is audible.
      command:
        generic.values.to !== undefined && generic.values.morph === undefined
          ? { ...generic, values: { morph: 0.5, ...generic.values } }
          : generic,
    };
  return { type: "error", message: `usage: /${VOWEL_USAGE}` };
}

/** Run a parsed `/formant` or `/vowel` on the focused track. */
export function applyFormantCommand(
  score: TrackScore,
  trackId: string,
  command: FormantCommand,
): FxResult {
  if (command.type === "error") return { ok: false, message: command.message };
  if (command.type === "fx") {
    // Keep a stored `to` when `/vowel to` edits only the morph, but never
    // invent a morph without a target.
    const track = score.tracks.find((candidate) => candidate.id === trackId);
    const fx = command.command;
    if (
      fx.type === "fx-set" &&
      fx.effect === "vowel" &&
      fx.values.morph !== undefined &&
      fx.values.to === undefined &&
      effectValues(track, "vowel")?.to === undefined
    )
      return {
        ok: false,
        message: "vowel · set a target first: /vowel a o 0.5 or /vowel to o",
      };
    return applyFxCommand(score, trackId, fx);
  }
  const track = score.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: `no track · ${trackId}` };
  const values = effectValues(track, command.effect);
  if (command.effect === "formant")
    return {
      ok: true,
      message: values
        ? `formant · shift ${values.shift} st · mix ${values.mix}`
        : `formant · off · /${FORMANT_USAGE}`,
    };
  return {
    ok: true,
    message: values
      ? `vowel · ${values.vowel}${values.to !== undefined ? ` → ${values.to} · morph ${values.morph ?? 0}` : ""} · mix ${values.mix}`
      : `vowel · off · /${VOWEL_USAGE}`,
  };
}
