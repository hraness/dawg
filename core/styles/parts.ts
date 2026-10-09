/**
 * Card-writing helpers (quality-08): short notations family files use so a
 * card reads like the theory it encodes.
 *
 * `grid("x..x..x.")` writes an onset grid: `x` is a sure hit, `.` none,
 * `1`..`9` a probability of 0.1..0.9 (`5` = half the bars). One character
 * per grid step; spaces and `|` are ignored so beats can be marked.
 */

import type { RoleTexture, RoleVoice } from "./schema.ts";

export function grid(pattern: string): readonly number[] {
  const out: number[] = [];
  for (const char of pattern) {
    if (char === " " || char === "|") continue;
    if (char === "x" || char === "X") out.push(1);
    else if (char === ".") out.push(0);
    else if (char >= "1" && char <= "9") out.push(Number(char) / 10);
    else throw new Error(`grid: bad step "${char}" in "${pattern}"`);
  }
  return Object.freeze(out);
}

/**
 * A role's voices: `voices("piano", "keys:0.5", "electric@crunch:0.5")`
 * (word, optional `@rig` amp preset, optional `:weight`).
 */
export function voices(...words: string[]): readonly RoleVoice[] {
  return Object.freeze(
    words.map((text) => {
      const [head, weight] = text.split(":");
      const [instrument, rig] = head!.split("@");
      const value = weight === undefined ? 1 : Number(weight);
      if (!instrument || !(value >= 0))
        throw new Error(`voices: bad voice "${text}"`);
      return Object.freeze({
        instrument,
        ...(rig ? { rig } : {}),
        weight: value,
      });
    }),
  );
}

/** A kit voice for the drum roles. */
export function kit(name: string, weight = 1): RoleVoice {
  return Object.freeze({ instrument: "drums", kit: name, weight });
}

/** A required role played by these voices. */
export function role(...words: string[]): RoleTexture {
  return Object.freeze({ required: true, voices: voices(...words) });
}

/** An optional role (joins about three times in four). */
export function maybe(...words: string[]): RoleTexture {
  return Object.freeze({ required: false, voices: voices(...words) });
}

/** The kit roles all on one kit. */
export function kitRoles(
  name: string,
  roles: readonly string[] = ["kick", "snare", "hat"],
  optional: readonly string[] = [],
): Record<string, RoleTexture> {
  const voice = Object.freeze([kit(name)]);
  const out: Record<string, RoleTexture> = {};
  for (const r of roles)
    out[r] = Object.freeze({ required: true, voices: voice });
  for (const r of optional)
    out[r] = Object.freeze({ required: false, voices: voice });
  return out;
}

/**
 * Interval weights for -12..12 semitones from a step/leap profile:
 * `steps` weight on seconds, `thirds` on thirds, `leaps` on fourths and
 * up, `repeat` on unisons; `up` above 1 favours rising motion.
 */
export function intervals(
  steps: number,
  thirds: number,
  leaps: number,
  repeat: number,
  up = 1,
): readonly number[] {
  const out: number[] = [];
  for (let i = -12; i <= 12; i += 1) {
    const size = Math.abs(i);
    let w =
      size === 0
        ? repeat
        : size <= 2
          ? steps
          : size <= 4
            ? thirds
            : size === 12
              ? leaps * 0.6
              : size <= 7
                ? leaps * (size === 5 || size === 7 ? 1 : 0.5)
                : leaps * 0.25;
    if (i > 0) w *= up;
    out.push(Math.round(w * 100) / 100);
  }
  return Object.freeze(out);
}
