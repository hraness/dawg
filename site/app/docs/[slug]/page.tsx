import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { DocsShell, INSTALL_ID } from "../docs-shell";
import { docsHref, docsPage, docsPages } from "../pages";

export const dynamicParams = false;

export function generateStaticParams() {
  return [
    ...docsPages.map((page) => ({ slug: page.id })),
    // The old address of the install page.
    ...(docsPage(INSTALL_ID) === undefined ? [{ slug: INSTALL_ID }] : []),
  ];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const page = docsPage((await params).slug);
  if (page === undefined) return {};
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: docsHref(page.id) },
    openGraph: {
      title: `${page.title} · dawg docs`,
      description: page.description,
      url: docsHref(page.id),
    },
  };
}

export default async function DocsGuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = docsPage(slug);
  if (page === undefined) {
    if (slug === INSTALL_ID) permanentRedirect("/docs");
    notFound();
  }
  return (
    <DocsShell
      id={page.id}
      title={page.title}
      // A guide's first paragraph is its description, so it is not repeated.
      description=""
    >
      {page.render()}
    </DocsShell>
  );
}
