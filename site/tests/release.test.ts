/**
 * The release lookup behind the home page's version-gated copy. GitHub's
 * unauthenticated API is rate limited per IP, so npm (which mirrors each
 * release) must carry the lookup when GitHub refuses, and a double failure
 * must throw so ISR keeps the previous page instead of hiding released copy.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { latestRelease, releasePageUrl } from "../app/release";

const realFetch = globalThis.fetch;
const realPhase = process.env.NEXT_PHASE;

type Reply = number | Readonly<{ status?: number; body: unknown }> | Error;

function stubFetch(github: Reply, npm: Reply): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const reply = url.startsWith("https://api.github.com/")
      ? github
      : url.startsWith("https://registry.npmjs.org/")
        ? npm
        : 500;
    if (reply instanceof Error) throw reply;
    if (typeof reply === "number") return new Response("{}", { status: reply });
    return Response.json(reply.body, { status: reply.status ?? 200 });
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realPhase === undefined) delete process.env.NEXT_PHASE;
  else process.env.NEXT_PHASE = realPhase;
});

const githubRelease = (version: string) => ({
  body: {
    tag_name: `v${version}`,
    html_url: `https://github.com/hraness/dawg/releases/tag/v${version}`,
  },
});
const npmRelease = (version: string) => ({ body: { version } });

describe("latestRelease", () => {
  test("GitHub rate limited (403): npm supplies the release", async () => {
    const calls = stubFetch(403, npmRelease("0.10.0"));
    expect(await latestRelease()).toEqual({
      published: true,
      version: "0.10.0",
      url: releasePageUrl("0.10.0"),
    });
    expect(calls).toContain(
      "https://registry.npmjs.org/@hraness%2fdawg/latest",
    );
  });

  test("GitHub 429 or network error: npm supplies the release", async () => {
    stubFetch(429, npmRelease("0.10.0"));
    expect(await latestRelease()).toMatchObject({ version: "0.10.0" });
    stubFetch(new TypeError("fetch failed"), npmRelease("0.10.0"));
    expect(await latestRelease()).toMatchObject({ version: "0.10.0" });
  });

  test("npm down: GitHub supplies the release", async () => {
    stubFetch(githubRelease("0.10.0"), 503);
    expect(await latestRelease()).toEqual({
      published: true,
      version: "0.10.0",
      url: "https://github.com/hraness/dawg/releases/tag/v0.10.0",
    });
  });

  test("both answer: the newer version wins", async () => {
    stubFetch(githubRelease("0.10.0"), npmRelease("0.9.0"));
    expect(await latestRelease()).toMatchObject({ version: "0.10.0" });
    stubFetch(githubRelease("0.9.0"), npmRelease("0.10.0"));
    expect(await latestRelease()).toMatchObject({ version: "0.10.0" });
  });

  test("malformed body from one source falls back to the other", async () => {
    stubFetch({ body: { tag_name: "latest" } }, npmRelease("0.10.0"));
    expect(await latestRelease()).toMatchObject({ version: "0.10.0" });
    stubFetch(githubRelease("0.10.0"), { body: { version: "next" } });
    expect(await latestRelease()).toMatchObject({ version: "0.10.0" });
  });

  test("nothing published: GitHub 404 with npm 404", async () => {
    stubFetch(404, 404);
    expect(await latestRelease()).toEqual({ published: false });
  });

  test("both fail at runtime: throws so ISR keeps the previous page", async () => {
    delete process.env.NEXT_PHASE;
    stubFetch(403, 503);
    await expect(latestRelease()).rejects.toThrow(/GitHub 403; npm 503/u);
    stubFetch(new TypeError("fetch failed"), new TypeError("fetch failed"));
    await expect(latestRelease()).rejects.toThrow(/Release lookup failed/u);
  });

  test("both fail during the build: not published", async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    stubFetch(429, 500);
    expect(await latestRelease()).toEqual({ published: false });
  });
});

describe("function bundle", () => {
  test("every route traces the files the share-card module reads", () => {
    // app/social.ts reads public/marks/dawg.svg at module load and every
    // page's metadata imports it. Vercel leaves public/ out of functions, so
    // a missing include makes each hourly regeneration throw ENOENT.
    const site = resolve(import.meta.dir, "..");
    const config = readFileSync(join(site, "next.config.ts"), "utf8");
    expect(config).toMatch(
      /"\/\*\*": \[[^\]]*"\.\/public\/marks\/dawg\.svg"[^\]]*\]/u,
    );
    expect(readFileSync(join(site, "app", "social.ts"), "utf8")).toContain(
      '"public", "marks", "dawg.svg"',
    );
  });
});
