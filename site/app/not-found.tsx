import type { Metadata } from "next";
import { RouteNotFoundPage } from "@hraness/design-kit/react";

import { docsHref, docsPages, docsTree } from "./docs/pages";
import { SiteNotFoundAnalytics } from "./site-analytics";
import { SiteHeader } from "./site-header";

export const metadata: Metadata = { title: "Page not found" };

const routes = [
  { href: "/", label: "dawg" },
  { href: "/docs", label: "Install" },
  ...docsPages.map((page) => ({ href: docsHref(page.id), label: page.title })),
  { href: "/changelog", label: "Changelog" },
];

/** The design kit's "next" cards take at most 90 characters. */
function shortDescription(text: string): string {
  return text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text;
}

export default function NotFound() {
  return (
    <>
      <SiteNotFoundAnalytics />
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        <RouteNotFoundPage
          siteName="dawg"
          primaryAction={{ href: "/docs", label: "Install dawg" }}
          next={[
            ...docsTree()
              .slice(0, 2)
              .map(({ page }) => ({
                href: docsHref(page.id),
                label: page.title,
                description: shortDescription(page.description),
              })),
            {
              href: "/changelog",
              label: "Changelog",
              description: "What changed in each release.",
            },
          ]}
          routes={routes}
          agentIndexHref="/llms.txt"
          canvasAs="div"
        />
      </main>
    </>
  );
}
