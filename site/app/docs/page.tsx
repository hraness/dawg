import type { Metadata } from "next";

import { DocsShell } from "./docs-shell";
import { docsTopic } from "./topics";

const topic = docsTopic("quickstart")!;

export const metadata: Metadata = {
  title: "Docs",
  description: topic.description,
  alternates: { canonical: "/docs" },
  openGraph: {
    title: "dawg docs",
    description: topic.description,
    url: "/docs",
  },
};

export default function DocsIndex() {
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
