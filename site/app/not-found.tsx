import type { Metadata } from "next";
import { RouteNotFoundPage } from "@hraness/design-kit/react";

import { docsTopics } from "./docs/topics";
import { SiteNotFoundAnalytics } from "./site-analytics";
import { SiteHeader } from "./site-header";

export const metadata: Metadata = { title: "Page not found" };

const routes = [
  { href: "/", label: "dawg" },
  ...docsTopics.map((topic) => ({
    href: topic.slug === "quickstart" ? "/docs" : `/docs/${topic.slug}`,
    label: topic.title,
  })),
  { href: "/changelog", label: "Changelog" },
];

export default function NotFound() {
  return (
    <>
      <SiteNotFoundAnalytics />
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        <RouteNotFoundPage
          siteName="dawg"
          primaryAction={{ href: "/docs", label: "Quickstart" }}
          next={[
            {
              href: "/docs/commands",
              label: "Commands",
              description: "Every prompt command, from tempo to reverb.",
            },
            {
              href: "/docs/sessions",
              label: "Sessions",
              description: "Windows, dawgd, names, forks and resuming.",
            },
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
