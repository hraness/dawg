/** Longest directory name a track slug may take. */
export const MAX_TRACK_SLUG_LENGTH = 64;

/**
 * The directory name for a track under `tracks/`: lowercase ASCII letters,
 * digits and single dashes (`keys 2` → `keys-2`). Anything that leaves no
 * usable characters becomes `track`.
 */
export function trackSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TRACK_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "track";
}
