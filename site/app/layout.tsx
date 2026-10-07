import type { Metadata, Viewport } from "next";
import { getDesignPaletteTheme } from "@hraness/design-kit";
import {
  DesignPaletteProvider,
  ThemeColorSync,
} from "@hraness/design-kit/react";
import { HranessSiteFooter } from "@hraness/site-footer/react";

import { siteDefaultPalette } from "../palette";
import { productMessaging, productName, productUrl } from "./messaging";
import { SiteAnalytics } from "./site-analytics";
import "./globals.css";

/**
 * Rosé Pine is dawg's palette; the initial class supplies its compiled values
 * and the blocking bootstrap adds a concrete `data-theme` before paint. With
 * JavaScript off no `data-theme` is rendered, so light-dark() colors follow
 * the operating system.
 */
const initialPalette = getDesignPaletteTheme("rose-pine", "light");

const title = `${productName} · ${productMessaging.tagline.replace(/\.$/u, "")}`;

export const metadata: Metadata = {
  metadataBase: new URL(productUrl),
  title: { default: title, template: `%s · ${productName}` },
  description: productMessaging.meta,
  alternates: { canonical: "/" },
  icons: { icon: [{ type: "image/svg+xml", url: "/favicon.svg" }] },
  openGraph: {
    title,
    description: productMessaging.meta,
    siteName: productName,
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: productMessaging.meta,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { color: "#faf4ed", media: "(prefers-color-scheme: light)" },
    { color: "#191724", media: "(prefers-color-scheme: dark)" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-palette="rose-pine"
      className={initialPalette.className}
      suppressHydrationWarning
    >
      <head>
        {/* The blocking external bootstrap applies a saved palette before first paint. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-bootstrap.js" />
      </head>
      <body>
        <SiteAnalytics />
        <DesignPaletteProvider defaultPreference={siteDefaultPalette}>
          <ThemeColorSync />
          {children}
          <div className="dawg-network-footer">
            <HranessSiteFooter mailingList={{ kind: "none" }} />
          </div>
        </DesignPaletteProvider>
      </body>
    </html>
  );
}
