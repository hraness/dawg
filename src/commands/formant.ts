/**
 * `/formant` and `/vowel` (0.7): short forms of `fx formant` and `fx vowel`
 * on the focused track. Both build the same `FxCommand` as `fx`, so the
 * edit, validation and undo step are the fx command's.
 *
 *   formant                       show the shift and mix
 *   formant <-12..12> [mix]       shift the formants (pitch stays): -4 deeper
 *   formant <preset>              deep giant bright tiny
 *   formant shift <st> mix <0..1> spelled out
 *   formant on | off | reset      turn it on | remove it | back to 0 st, mix 1
 *
 *   vowel                         show the vowel filter
 *   vowel <v> [<to> [<morph>]]    a, or a morphing toward o (morph 0.5);
 *                                 keeps the mix you set
 *   vowel <preset>                ee (also a, o)
 *   vowel to <v> | morph <0..1>   change one part of the morph
 *   vowel to off                  drop the morph target (keeps vowel and mix)
 *   vowel mix <0..1> | off
 *
 * `/vocal formant …` runs the same `/formant` grammar.
 */
import { FX_PRESETS, VOWEL_VALUES } from "../../core/fx.ts";
import type { TrackScore } from "../../core/score.ts";
import {
  applyFxCommand,
  effectValues,
  FORMANT_VOWEL_HINT,
  parseFxCommand,
  type FxCommand,
  type FxResult,
} from "./fx.ts";

export const FORMANT_USAGE =
  "formant <-12..12> [mix] | <deep|giant|bright|tiny> | on | off";
export const VOWEL_USAGE =
  "vowel <a|e|i|o|u…> [<to> [<morph 0..1>]] | ee | to off | off";

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
  // `on` is also a nasal vowel word; as the only word it is the toggle.
  if (rest.length === 0 && ["on", "true", "yes"].includes(first))
    return { type: "fx", command: { type: "fx-on", effect: "formant" } };
  if (rest.length === 0 && FX_PRESETS.formant?.[first])
    return {
      type: "fx",
      command: { type: "fx-preset", effect: "formant", preset: first },
    };
  const shift = numberWord(first);
  // `-4`, `-4 0.5` or `-4 mix 0.5`.
  const mixWords = rest[0] === "mix" ? rest.slice(1) : rest;
  if (shift !== undefined && mixWords.length <= 1 && rest.length <= 2) {
    const mix = mixWords[0] === undefined ? undefined : numberWord(mixWords[0]);
    if (rest.length > 0 && mix === undefined)
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
      message: `${FORMANT_VOWEL_HINT} · /vowel ${isVowel(first) ? first : "a"}`,
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
  if (words.length === 2 && first === "to" && second === "off")
    return {
      type: "fx",
      command: { type: "fx-replace", effect: "vowel", values: {} },
    };
  if (
    words.length === 1 &&
    !isVowel(first!) &&
    FX_PRESETS.vowel?.[first!] !== undefined
  )
    return {
      type: "fx",
      command: { type: "fx-preset", effect: "vowel", preset: first! },
    };
  if (isVowel(first!) && words.length <= 3) {
    // `mix` is filled from the stored vowel when the command is applied.
    if (second === undefined)
      return {
        type: "fx",
        command: {
          type: "fx-replace",
          effect: "vowel",
          values: { vowel: first! },
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
        values: { vowel: first!, to: second, morph },
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
    // `/vowel <v> [...]` replaces the vowel and its morph but keeps the
    // stored mix; `/vowel to off` keeps vowel and mix and drops the morph.
    const track = score.tracks.find((candidate) => candidate.id === trackId);
    const fx = command.command;
    if (fx.type === "fx-replace" && fx.effect === "vowel") {
      const current = effectValues(track, "vowel");
      const { vowel: vowelWord, ...morphPart } = fx.values;
      if (vowelWord === undefined && !current)
        return { ok: true, message: "vowel · off" };
      return applyFxCommand(score, trackId, {
        ...fx,
        values: {
          vowel: vowelWord ?? current?.vowel ?? "a",
          mix: current?.mix ?? 1,
          ...morphPart,
        },
      });
    }
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
