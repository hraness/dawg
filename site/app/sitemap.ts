import type { MetadataRoute } from "next";

import { docsHref, docsPages } from "./docs/pages";
import { productUrl } from "./messaging";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${productUrl}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${productUrl}/docs`, changeFrequency: "monthly", priority: 0.9 },
    ...docsPages.map((page) => ({
      url: `${productUrl}${docsHref(page.id)}`,
      changeFrequency: "monthly" as const,
      priority: page.parent === null ? 0.7 : 0.6,
    })),
    {
      url: `${productUrl}/vs/strudel`,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${productUrl}/changelog`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
  ];
}
