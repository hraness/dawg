/**
 * Typed parameter specs shared by the effects chain (core/fx.ts) and the
 * synth voice (core/synth.ts): one table per unit drives validation,
 * printing, the menu, prompt commands and agent tools.
 */

export type NumberParam = Readonly<{
  kind: "number";
  min: number;
  max: number;
  default: number;
  /** Menu nudge step; `"log"` nudges by a sixth of an octave. */
  step: number | "log";
  unit?: string;
  /** Round stored values to an integer. */
  integer?: boolean;
  /** Not filled with the default when absent (absent keeps legacy behaviour). */
  optional?: boolean;
  /** A lane `<effect>-<param>` exists for this parameter. */
  automate?: boolean;
  doc: string;
  /** Strudel names (and aliases) that mean this parameter. */
  strudel?: readonly string[];
}>;

export type EnumParam = Readonly<{
  kind: "enum";
  values: readonly string[];
  default: string;
  optional?: boolean;
  doc: string;
  strudel?: readonly string[];
}>;

export type BooleanParam = Readonly<{
  kind: "boolean";
  default: boolean;
  optional?: boolean;
  doc: string;
  strudel?: readonly string[];
}>;

export type ParamSpec = NumberParam | EnumParam | BooleanParam;

/** A validated parameter record. */
export type FxValues = Readonly<Record<string, number | string | boolean>>;

export class FxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxValidationError";
  }
}

/** Validates one parameter value against its spec. */
export function normalizeParam(
  spec: ParamSpec,
  value: unknown,
  label: string,
): number | string | boolean {
  if (spec.kind === "enum") {
    if (typeof value !== "string" || !spec.values.includes(value))
      throw new FxValidationError(
        `${label} must be one of ${spec.values.join(", ")}`,
      );
    return value;
  }
  if (spec.kind === "boolean") {
    if (typeof value !== "boolean")
      throw new FxValidationError(`${label} must be true or false`);
    return value;
  }
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new FxValidationError(`${label} must be a finite number`);
  if (value < spec.min || value > spec.max)
    throw new FxValidationError(
      `${label} must be between ${spec.min} and ${spec.max}`,
    );
  return spec.integer ? Math.round(value) : value;
}

/**
 * Validates a parameter record against `params`, filling defaults for
 * absent keys. Unknown keys are rejected so typos never pass silently.
 */
export function normalizeParams(
  params: Readonly<Record<string, ParamSpec>>,
  input: unknown,
  label: string,
  fill = true,
): FxValues {
  if (!isRecord(input))
    throw new FxValidationError(`${label} must be an object`);
  for (const key of Object.keys(input))
    if (!Object.prototype.hasOwnProperty.call(params, key))
      throw new FxValidationError(`${label} has no parameter "${key}"`);
  const out: Record<string, number | string | boolean> = {};
  for (const [key, spec] of Object.entries(params)) {
    const value = input[key];
    if (value === undefined) {
      if (fill && !spec.optional) out[key] = spec.default;
      continue;
    }
    out[key] = normalizeParam(spec, value, `${label} ${key}`);
  }
  return Object.freeze(out);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
