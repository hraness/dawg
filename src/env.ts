/**
 * Environment settings are named `DAWG_*`. For one release after the rename
 * from Track, the legacy `TRACK_*` name is read when the `DAWG_*` one is unset.
 */
export type Env = Readonly<Record<string, string | undefined>>;

export const ENV_PREFIX = "DAWG_";
export const LEGACY_ENV_PREFIX = "TRACK_";

/** `envValue("AUDIO")` reads `DAWG_AUDIO`, else the legacy `TRACK_AUDIO`. */
export function envValue(
  name: string,
  env: Env = process.env,
): string | undefined {
  const current = env[`${ENV_PREFIX}${name}`];
  if (current !== undefined) return current;
  return env[`${LEGACY_ENV_PREFIX}${name}`];
}
