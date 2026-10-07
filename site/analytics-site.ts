import type { PostHogSiteDefinition } from "@hraness/posthog";

/** dawg.sh in the shared Hraness PostHog project (543691), told apart by site_id "dawg". */
export const analyticsSite = {
  id: "dawg",
  canonicalDomain: "dawg.sh",
  allowedHosts: ["dawg.sh", "www.dawg.sh"],
  schemaVersion: 2,
  routes: [
    { match: "exact", path: "/", pageKind: "home" },
    { match: "prefix", path: "/docs", pageKind: "docs" },
    { match: "prefix", path: "/changelog", pageKind: "docs" },
  ],
  customEvents: [
    "cta clicked",
    "outbound link opened",
    "install command copied",
  ],
} as const satisfies PostHogSiteDefinition;

export function analyticsCtaForUrl(url: URL): string {
  if (url.hostname.replace(/^www\./, "") === "github.com") return "github";
  if (url.hash === "#install") return "install";
  if (url.pathname === "/docs" || url.pathname.startsWith("/docs/"))
    return "docs";
  if (url.pathname === "/changelog") return "changelog";
  return "get_started";
}
