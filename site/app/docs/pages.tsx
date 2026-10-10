import type { ReactNode } from "react";

import { Markdown } from "../markdown";
import { Screen } from "../screens/screen";
import { guideScreens, splitIntro } from "./guide-screens";
import { guideSummary, guidesDirectory, listGuides } from "./guides";

/** A guide as the TUI has it, with its real screens after the opening paragraph. */
function GuideBody({ id, body }: Readonly<{ id: string; body: string }>) {
  const screens = guideScreens[id];
  if (screens === undefined)
    return <Markdown source={body} headingOffset={1} marks />;
  const { intro, rest } = splitIntro(body);
  return (
    <>
      <Markdown source={intro} headingOffset={1} marks />
      <div className="dawg-docs__screens">
        {screens.map((screen) => (
          <Screen key={screen} id={screen} />
        ))}
      </div>
      {rest === "" ? null : <Markdown source={rest} headingOffset={1} marks />}
    </>
  );
}

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

function load(): readonly DocsPage[] {
  const guides = listGuides();
  // The docs are the TUI's guides; there is no hand-written fallback to drift.
  if (guides.length === 0)
    throw new Error(`no guides in ${guidesDirectory}; the docs need them`);
  return guides.map((guide) => ({
    id: guide.id,
    title: guide.title,
    parent: guide.parent,
    order: guide.order,
    description: guideSummary(guide.body),
    render: () => <GuideBody id={guide.id} body={guide.body} />,
  }));
}

/** Every docs page in tree order. The install page at /docs is separate. */
export const docsPages: readonly DocsPage[] = load();

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
