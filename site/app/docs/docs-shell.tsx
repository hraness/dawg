import Link from "next/link";
import type { ReactNode } from "react";

import { SiteHeader } from "../site-header";
import { docsTopics } from "./topics";

export function DocsShell({
  slug,
  title,
  description,
  children,
}: Readonly<{
  slug: string;
  title: string;
  description: string;
  children: ReactNode;
}>) {
  return (
    <>
      <SiteHeader active="docs" />
      <div className="dawg-docs">
        <nav className="dawg-docs__nav" aria-label="Docs">
          <ul>
            {docsTopics.map((topic) => {
              const href =
                topic.slug === "quickstart" ? "/docs" : `/docs/${topic.slug}`;
              return (
                <li key={topic.slug}>
                  <Link
                    href={href}
                    aria-current={topic.slug === slug ? "page" : undefined}
                  >
                    {topic.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main id="main" className="dawg-docs__main dawg-prose">
          <p className="dawg-eyebrow">Docs</p>
          <h1>{title}</h1>
          <p className="dawg-lede">{description}</p>
          {children}
        </main>
      </div>
    </>
  );
}
