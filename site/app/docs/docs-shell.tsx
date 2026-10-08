import Link from "next/link";
import type { ReactNode } from "react";

import { SiteHeader } from "../site-header";
import {
  docsHref,
  docsNeighbors,
  docsTrail,
  docsTree,
  type DocsTreeNode,
} from "./pages";

/** The install page at /docs, ahead of the guides in the nav. */
export const INSTALL_ID = "install";

function TreeList({
  nodes,
  current,
  open,
}: Readonly<{
  nodes: readonly DocsTreeNode[];
  current: string;
  open: ReadonlySet<string>;
}>) {
  return (
    <ul>
      {nodes.map(({ page, children }) => (
        <li key={page.id}>
          <Link
            href={docsHref(page.id)}
            aria-current={page.id === current ? "page" : undefined}
          >
            {page.title}
          </Link>
          {children.length > 0 && open.has(page.id) ? (
            <TreeList nodes={children} current={current} open={open} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Nav({ current }: Readonly<{ current: string }>) {
  // A branch opens when it holds the current page, as the TUI's guide tree does.
  const open = new Set(docsTrail(current).map((page) => page.id));
  return (
    <>
      <ul>
        <li>
          <Link
            href="/docs"
            aria-current={current === INSTALL_ID ? "page" : undefined}
          >
            Install
          </Link>
        </li>
      </ul>
      <p className="dawg-docs__nav-label">Guides</p>
      <TreeList nodes={docsTree()} current={current} open={open} />
    </>
  );
}

export function DocsShell({
  id,
  title,
  description,
  children,
}: Readonly<{
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}>) {
  const trail = docsTrail(id).slice(0, -1);
  const { previous, next } =
    id === INSTALL_ID
      ? { previous: undefined, next: docsTree()[0]?.page }
      : docsNeighbors(id);
  return (
    <>
      <SiteHeader active="docs" />
      <div className="dawg-docs">
        <nav className="dawg-docs__nav" aria-label="Docs">
          <details className="dawg-docs__menu">
            <summary>Guides</summary>
            <Nav current={id} />
          </details>
          <div className="dawg-docs__tree">
            <Nav current={id} />
          </div>
        </nav>
        <main id="main" tabIndex={-1} className="dawg-docs__main dawg-prose">
          <p className="dawg-eyebrow">
            <Link href="/docs">Docs</Link>
            {trail.map((page) => (
              <span key={page.id}>
                {" / "}
                <Link href={docsHref(page.id)}>{page.title}</Link>
              </span>
            ))}
          </p>
          <h1>{title}</h1>
          {description === "" ? null : (
            <p className="dawg-lede">{description}</p>
          )}
          {children}
          {previous === undefined && next === undefined ? null : (
            <nav className="dawg-docs__pager" aria-label="Previous and next">
              {previous === undefined ? (
                <span />
              ) : (
                <Link href={docsHref(previous.id)} rel="prev">
                  <small>Previous</small>
                  {previous.title}
                </Link>
              )}
              {next === undefined ? null : (
                <Link href={docsHref(next.id)} rel="next">
                  <small>Next</small>
                  {next.title}
                </Link>
              )}
            </nav>
          )}
        </main>
      </div>
    </>
  );
}
