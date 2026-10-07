import type { MetadataRoute } from "next";

import { docsTopics } from "./docs/topics";
import { productUrl } from "./messaging";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${productUrl}/`, changeFrequency: "weekly", priority: 1 },
    ...docsTopics.map((topic) => ({
      url: `${productUrl}/docs${topic.slug === "quickstart" ? "" : `/${topic.slug}`}`,
      changeFrequency: "monthly" as const,
      priority: topic.slug === "quickstart" ? 0.9 : 0.7,
    })),
    {
      url: `${productUrl}/changelog`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
  ];
}
