"use client";

import { useEffect } from "react";
import {
  PostHogAnalytics,
  PostHogExceptionReporter,
  PostHogPageNotFound,
} from "@hraness/posthog/react";
import {
  capturePostHogCtaClicked,
  capturePostHogInstallCommandCopied,
  capturePostHogOutboundLinkOpened,
} from "@hraness/posthog/client";
import { analyticsCtaForUrl, analyticsSite } from "../analytics-site";

// The shared Hraness project's public ingestion key (project 543691).
const apiKey =
  process.env.NEXT_PUBLIC_POSTHOG_KEY ??
  "phc_xqEpQgmKxZDYda3DvForfnKDuVL6urqD2YTtqDPmUL4u";

export function SiteAnalytics() {
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const url = new URL(anchor.href);
      if (url.protocol !== "https:" && url.protocol !== "http:") return;
      const placement = anchor.closest("header")
        ? "nav"
        : anchor.closest("footer")
          ? "footer"
          : "inline";
      if (
        anchor.matches("[data-analytics-cta]") ||
        anchor.closest(".hraness-marketing-header__actions")
      ) {
        capturePostHogCtaClicked(analyticsSite, {
          cta: analyticsCtaForUrl(url),
          placement,
          targetHost: url.hostname,
        });
      }
      if (url.hostname.replace(/^www\./, "") !== analyticsSite.canonicalDomain)
        capturePostHogOutboundLinkOpened(analyticsSite, {
          targetHost: url.hostname,
          placement,
        });
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, []);
  return <PostHogAnalytics site={analyticsSite} apiKey={apiKey} />;
}

export function SiteNotFoundAnalytics() {
  return <PostHogPageNotFound site={analyticsSite} apiKey={apiKey} />;
}

export function SiteExceptionAnalytics({ error }: { error: unknown }) {
  return (
    <PostHogExceptionReporter
      site={analyticsSite}
      apiKey={apiKey}
      error={error}
    />
  );
}

/** Call only after a copy control reports success. Never send copied text. */
export function captureInstallCopied(installMethod: "curl" | "bun" | "other") {
  capturePostHogInstallCommandCopied(analyticsSite, {
    installMethod,
    placement: "inline",
  });
}
