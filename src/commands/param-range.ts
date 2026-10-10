/**
 * `✗ synth lpf 99999 · lpf takes 20…20000 Hz · synth lpf 1200`: the range
 * card for a synth or effect parameter, built from the same specs that
 * validate it (core/params), so the card and the check never disagree.
 */
import type { ParamSpec } from "../../core/params.ts";
import { SYNTH_PARAMS, synthParamName } from "../../core/synth.ts";
import { effectSpec } from "../../core/fx.ts";
import { parseEffectName, parseParamName } from "./fx.ts";
import { usageError } from "./grammar.ts";

/** The range card for the first out-of-range number in the line, if any. */
export function paramRangeError(line: string): string | undefined {
  const words = line.trim().replace(/^\//, "").split(/\s+/);
  const verb = words[0]?.toLowerCase();
  if (verb === "synth")
    return firstOutOfRange(line, words.slice(1), "synth", (word) => {
      const name = synthParamName(word);
      return name ? [name, SYNTH_PARAMS[name]] : undefined;
    });
  if (verb === "fx" && words[1]) {
    const effect = parseEffectName(words[1]);
    if (!effect) return undefined;
    const params = effectSpec(effect).params;
    return firstOutOfRange(line, words.slice(2), `fx ${effect}`, (word) => {
      const name = parseParamName(effect, word);
      return name ? [name, params[name]] : undefined;
    });
  }
  return undefined;
}

function firstOutOfRange(
  line: string,
  rest: readonly string[],
  prefix: string,
  lookup: (word: string) => [string, ParamSpec | undefined] | undefined,
): string | undefined {
  for (let index = 0; index + 1 < rest.length; index += 2) {
    const found = lookup(rest[index]!);
    if (!found) continue;
    const [name, spec] = found;
    if (spec?.kind !== "number") continue;
    const value = Number(rest[index + 1]);
    if (!Number.isFinite(value)) continue;
    if (value >= spec.min && value <= spec.max) continue;
    return usageError(line.trim(), {
      command: name,
      min: spec.min,
      max: spec.max,
      unit: spec.unit ?? "",
      example: `${prefix} ${name} ${spec.default}`,
    });
  }
  return undefined;
}
