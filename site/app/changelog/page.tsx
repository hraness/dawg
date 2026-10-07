import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";

import { Markdown } from "../markdown";
import { repoUrl } from "../messaging";
import { SiteHeader } from "../site-header";

/** CHANGELOG.md from the repository root, without its own title line. */
const changelog = readFileSync(
  join(process.cwd(), "..", "CHANGELOG.md"),
  "utf8",
).replace(/^# .*\n/u, "");

const description = "Every dawg release, from the repository's CHANGELOG.md.";

export const metadata: Metadata = {
  title: "Changelog",
  description,
  alternates: { canonical: "/changelog" },
  openGraph: { title: "dawg changelog", description, url: "/changelog" },
};

export default function ChangelogPage() {
  return (
    <>
      <SiteHeader active="changelog" />
      <main id="main" className="dawg-page dawg-prose">
        <p className="dawg-eyebrow">Changelog</p>
        <h1>What changed</h1>
        <p className="dawg-small">
          Generated from{" "}
          <a href={`${repoUrl}/blob/main/CHANGELOG.md`}>CHANGELOG.md</a>.
          Releases are on <a href={`${repoUrl}/releases`}>GitHub</a>.
        </p>
        <Markdown source={changelog} />
      </main>
    </>
  );
}
