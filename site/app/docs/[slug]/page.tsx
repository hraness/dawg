import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { DocsShell } from "../docs-shell";
import { docsTopic, docsTopics } from "../topics";

export const dynamicParams = false;

export function generateStaticParams() {
  return docsTopics
    .filter((topic) => topic.slug !== "quickstart")
    .map((topic) => ({ slug: topic.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const topic = docsTopic((await params).slug);
  if (topic === undefined) return {};
  return {
    title: topic.title,
    description: topic.description,
    alternates: { canonical: `/docs/${topic.slug}` },
    openGraph: {
      title: `${topic.title} · dawg docs`,
      description: topic.description,
      url: `/docs/${topic.slug}`,
    },
  };
}

export default async function DocsTopicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (slug === "quickstart") permanentRedirect("/docs");
  const topic = docsTopic(slug);
  if (topic === undefined) notFound();
  return (
    <DocsShell
      slug={topic.slug}
      title={topic.title}
      description={topic.description}
    >
      {topic.body()}
    </DocsShell>
  );
}
