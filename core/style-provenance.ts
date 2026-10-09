/**
 * Which style and seed made a song (quality-08). Stored as the optional
 * `style` field of the score so `/style`, the agent and `song.ts` agree on
 * where a song came from. Shape checks only: the id need not be a style this
 * build knows, so a newer project still loads.
 */

export type SongStyle = Readonly<{
  /** Style id from the taxonomy (`deep-house`, `bebop`). */
  id: string;
  /** Generator seed, an integer 0..2^31-1. */
  seed: number;
  /** Bars generated. */
  bars: number;
  /** Second style and its weight 0..1 when the song is a blend. */
  blend?: Readonly<{ id: string; weight: number }>;
}>;

const STYLE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_STYLE_SEED = 2 ** 31 - 1;

/** Thrown for a malformed `style`; the score turns it into a validation error. */
export class SongStyleError extends Error {
  override name = "SongStyleError";
}

function fail(message: string): never {
  throw new SongStyleError(`style ${message}`);
}

function styleId(value: unknown, label: string): string {
  if (typeof value !== "string" || !STYLE_ID.test(value))
    fail(`${label} must be a style id like "deep-house"`);
  return value;
}

/** A frozen, checked style provenance; `null`/`undefined` is none. */
export function normalizeSongStyle(value: unknown): SongStyle | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value))
    fail("must be an object { id, seed, bars }");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (!["id", "seed", "bars", "blend"].includes(key))
      fail(`has no "${key}"; use id, seed, bars, blend`);
  const id = styleId(record.id, "id");
  const seed = record.seed;
  if (
    typeof seed !== "number" ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > MAX_STYLE_SEED
  )
    fail(`seed must be an integer 0..${MAX_STYLE_SEED}`);
  const bars = record.bars;
  if (
    typeof bars !== "number" ||
    !Number.isInteger(bars) ||
    bars < 1 ||
    bars > 256
  )
    fail("bars must be an integer 1..256");
  let blend: SongStyle["blend"];
  if (record.blend !== undefined && record.blend !== null) {
    const raw = record.blend;
    if (typeof raw !== "object" || Array.isArray(raw))
      fail("blend must be { id, weight }");
    const part = raw as Record<string, unknown>;
    const weight = part.weight;
    if (
      typeof weight !== "number" ||
      !Number.isFinite(weight) ||
      weight < 0 ||
      weight > 1
    )
      fail("blend weight must be 0..1");
    blend = Object.freeze({ id: styleId(part.id, "blend id"), weight });
  }
  return Object.freeze({ id, seed, bars, ...(blend ? { blend } : {}) });
}
