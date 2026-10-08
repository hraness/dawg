import type { ReactNode } from "react";

import { Markdown } from "../markdown";
import { guideSummary, listGuides, orderTree } from "./guides";
import { docsTopics } from "./topics";

/** One page in the docs tree, from a TUI guide or a fallback topic. */
export interface DocsPage {
  readonly id: string;
  readonly title: string;
  readonly parent: string | null;
  readonly order: number;
  readonly description: string;
  readonly render: () => ReactNode;
}

export interface DocsTreeNode {
  readonly page: DocsPage;
  readonly children: readonly DocsTreeNode[];
}

/** Where the docs come from, for the page footer and tests. */
export type DocsSource = "guides" | "topics";

function load(): { source: DocsSource; pages: readonly DocsPage[] } {
  const guides = listGuides();
  if (guides.length > 0) {
    return {
      source: "guides",
      pages: guides.map((guide) => ({
        id: guide.id,
        title: guide.title,
        parent: guide.parent,
        order: guide.order,
        description: guideSummary(guide.body),
        render: () => <Markdown source={guide.body} headingOffset={1} />,
      })),
    };
  }
  return {
    source: "topics",
    pages: orderTree(
      docsTopics.map((topic, index) => ({
        id: topic.slug,
        title: topic.title,
        parent: null,
        order: index,
        description: topic.description,
        render: topic.body,
      })),
    ),
  };
}

const loaded = load();

export const docsSource: DocsSource = loaded.source;

/** Every docs page in tree order. The install page at /docs is separate. */
export const docsPages: readonly DocsPage[] = loaded.pages;

export function docsPage(id: string): DocsPage | undefined {
  return docsPages.find((page) => page.id === id);
}

export function docsHref(id: string): string {
  return `/docs/${id}`;
}

export function docsTree(parent: string | null = null): DocsTreeNode[] {
  return docsPages
    .filter((page) => page.parent === parent)
    .map((page) => ({ page, children: docsTree(page.id) }));
}

/** The chain from the top of the tree down to `id`, inclusive. */
export function docsTrail(id: string): DocsPage[] {
  const trail: DocsPage[] = [];
  for (
    let page = docsPage(id);
    page !== undefined;
    page = page.parent === null ? undefined : docsPage(page.parent)
  )
    trail.unshift(page);
  return trail;
}

/** The page before and after `id` in reading order. */
export function docsNeighbors(id: string): {
  previous: DocsPage | undefined;
  next: DocsPage | undefined;
} {
  const index = docsPages.findIndex((page) => page.id === id);
  return {
    previous: index > 0 ? docsPages[index - 1] : undefined,
    next: index >= 0 ? docsPages[index + 1] : undefined,
  };
}
