import { cache } from "react";

export type ReleaseState =
  | Readonly<{ published: true; version: string; url: string }>
  | Readonly<{ published: false }>;

const GITHUB_LATEST =
  "https://api.github.com/repos/hraness/dawg/releases/latest";
const NPM_LATEST = "https://registry.npmjs.org/@hraness%2fdawg/latest";

/** How often pages that show install commands re-check for a release, in seconds. */
export const RELEASE_REVALIDATE = 3600;

/** What one source says: a release, nothing published, or it could not tell. */
type SourceResult =
  | Readonly<{ kind: "release"; version: string; url: string }>
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "error"; reason: string }>;

const VERSION = /^\d+\.\d+\.\d+$/u;

function field(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)[key]
    : undefined;
}

export function releasePageUrl(version: string): string {
  return `https://github.com/hraness/dawg/releases/tag/v${version}`;
}

async function getJson(
  url: string,
  accept: string,
): Promise<Readonly<{ status: number; body?: unknown }>> {
  const response = await fetch(url, {
    headers: { accept, "user-agent": "dawg.sh" },
    next: { revalidate: RELEASE_REVALIDATE },
  });
  if (!response.ok) return { status: response.status };
  return { status: response.status, body: await response.json() };
}

/** GitHub's REST API. Unauthenticated, so a shared egress IP can hit 403/429. */
async function fromGitHub(): Promise<SourceResult> {
  try {
    const { status, body } = await getJson(
      GITHUB_LATEST,
      "application/vnd.github+json",
    );
    if (status === 404) return { kind: "none" };
    if (body === undefined) return { kind: "error", reason: `GitHub ${status}` };
    const tag = field(body, "tag_name");
    if (typeof tag !== "string" || !/^v\d+\.\d+\.\d+$/u.test(tag))
      return { kind: "error", reason: "GitHub: unexpected body" };
    const version = tag.slice(1);
    const url = field(body, "html_url");
    return {
      kind: "release",
      version,
      url: typeof url === "string" ? url : releasePageUrl(version),
    };
  } catch (error) {
    return { kind: "error", reason: `GitHub: ${String(error)}` };
  }
}

/** The npm registry, which mirrors each GitHub Release byte for byte. */
async function fromNpm(): Promise<SourceResult> {
  try {
    const { status, body } = await getJson(NPM_LATEST, "application/json");
    if (status === 404) return { kind: "none" };
    if (body === undefined) return { kind: "error", reason: `npm ${status}` };
    const version = field(body, "version");
    if (typeof version !== "string" || !VERSION.test(version))
      return { kind: "error", reason: "npm: unexpected body" };
    return { kind: "release", version, url: releasePageUrl(version) };
  } catch (error) {
    return { kind: "error", reason: `npm: ${String(error)}` };
  }
}

/**
 * Combines both sources. The newest release either reports wins, so a failed
 * or lagging source never hides a release the other one knows about. With no
 * release, GitHub's 404 means nothing is published; otherwise both sources
 * failed and this throws.
 */
export function resolveRelease(
  github: SourceResult,
  npm: SourceResult,
): ReleaseState {
  const releases = [github, npm].filter(
    (result): result is Extract<SourceResult, { kind: "release" }> =>
      result.kind === "release",
  );
  const newest = releases.reduce<
    Extract<SourceResult, { kind: "release" }> | undefined
  >(
    (best, next) =>
      best === undefined || !atLeast(best.version, next.version) ? next : best,
    undefined,
  );
  if (newest !== undefined)
    return { published: true, version: newest.version, url: newest.url };
  if (github.kind === "none") return { published: false };
  const reasons = [github, npm]
    .map((result) => (result.kind === "error" ? result.reason : "none"))
    .join("; ");
  throw new Error(`Release lookup failed: ${reasons}`);
}

/**
 * The latest published release of hraness/dawg, from GitHub Releases and its
 * npm mirror. Pages that show the release tarball regenerate hourly, so a new
 * release appears without a site deploy. If one source is rate limited or
 * down, the other decides. If both fail, regeneration keeps the previously
 * generated page, and the build falls back to "not published", which only
 * hides a link.
 */
export const latestRelease = cache(async (): Promise<ReleaseState> => {
  const [github, npm] = await Promise.all([fromGitHub(), fromNpm()]);
  try {
    return resolveRelease(github, npm);
  } catch (error) {
    if (process.env.NEXT_PHASE === "phase-production-build")
      return { published: false };
    throw error;
  }
});

export function releaseTarballUrl(version: string): string {
  return `https://github.com/hraness/dawg/releases/download/v${version}/hraness-dawg-${version}.tgz`;
}

/** Whether release `version` is at or after `min`; both are x.y.z. */
export function atLeast(version: string, min: string): boolean {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}
