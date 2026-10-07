import { cache } from "react";

export type ReleaseState =
  | Readonly<{ published: true; version: string; url: string }>
  | Readonly<{ published: false }>;

const LATEST = "https://api.github.com/repos/hraness/dawg/releases/latest";

/** How often pages that show install commands re-check for a release, in seconds. */
export const RELEASE_REVALIDATE = 3600;

/**
 * The latest published GitHub Release of hraness/dawg. Pages that show the
 * release tarball regenerate hourly, so the first release appears without a
 * site deploy. A 404 means nothing is published yet. Any other failure keeps
 * the previously generated page during revalidation, and during the build it
 * falls back to "not published", which only hides a link.
 */
export const latestRelease = cache(async (): Promise<ReleaseState> => {
  try {
    const response = await fetch(LATEST, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "dawg.sh",
      },
      next: { revalidate: RELEASE_REVALIDATE },
    });
    if (response.status === 404) return { published: false };
    if (!response.ok) throw new Error(`GitHub releases: ${response.status}`);
    const body: unknown = await response.json();
    const tag =
      typeof body === "object" && body !== null
        ? (body as { tag_name?: unknown }).tag_name
        : undefined;
    const url =
      typeof body === "object" && body !== null
        ? (body as { html_url?: unknown }).html_url
        : undefined;
    if (
      typeof tag !== "string" ||
      !/^v\d+\.\d+\.\d+$/u.test(tag) ||
      typeof url !== "string"
    )
      throw new Error("GitHub releases: unexpected body");
    return { published: true, version: tag.slice(1), url };
  } catch (error) {
    if (process.env.NEXT_PHASE === "phase-production-build")
      return { published: false };
    throw error;
  }
});

export function releaseTarballUrl(version: string): string {
  return `https://github.com/hraness/dawg/releases/download/v${version}/hraness-dawg-${version}.tgz`;
}
