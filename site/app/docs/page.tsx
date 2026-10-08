import type { Metadata } from "next";
import Link from "next/link";

import { CodeBlock } from "../code-block";
import { installCommand, repoUrl, sourceInstallCommands } from "../messaging";
import { DawgPlatformInstall } from "../platform-install";
import { latestRelease } from "../release";
import { DocsShell, INSTALL_ID } from "./docs-shell";
import { docsHref, docsTree } from "./pages";

// Re-check for a new release hourly (RELEASE_REVALIDATE); Next needs a literal.
export const revalidate = 3600;

const description =
  "Install dawg with one command, check a release, and start your first session.";

export const metadata: Metadata = {
  title: "Install",
  description,
  alternates: { canonical: "/docs" },
  openGraph: { title: "Install dawg", description, url: "/docs" },
};

export default async function DocsInstall() {
  const release = await latestRelease();
  const first = docsTree()[0]?.page;
  return (
    <DocsShell id={INSTALL_ID} title="Install dawg" description={description}>
      <p>
        dawg runs in a terminal on macOS and Linux. It needs{" "}
        <a href="https://bun.sh">Bun</a> 1.3.14 or newer, and{" "}
        <code>ffplay</code> or SoX to play sound. On a Mac without either,
        dawg falls back to <code>afplay</code>.
      </p>
      <DawgPlatformInstall installCommand={installCommand} />
      <h2 id="start">Start a session</h2>
      <p>
        Run <code>dawg</code> in any folder. The first launch creates{" "}
        <code>.dawg/</code> there, and later launches pick the same session up
        again.
      </p>
      <CodeBlock code="$ dawg" />
      {first === undefined ? null : (
        <p>
          Then read <Link href={docsHref(first.id)}>{first.title}</Link>. The
          guides here are the ones dawg shows in the terminal.
        </p>
      )}
      {release.published ? (
        <>
          <h2 id="release">Check a release first</h2>
          <p>
            Each <a href={release.url}>release</a> is immutable and ships the
            tarball, a <code>SHA256SUMS</code> file and a build provenance
            attestation.
          </p>
          <CodeBlock
            code={[
              `$ gh release download v${release.version} --repo hraness/dawg`,
              "$ shasum -a 256 -c SHA256SUMS",
              `$ gh attestation verify hraness-dawg-${release.version}.tgz --repo hraness/dawg`,
              `$ bun add -g "$PWD/hraness-dawg-${release.version}.tgz"`,
            ].join("\n")}
          />
        </>
      ) : null}
      <h2 id="source">Run from source</h2>
      <CodeBlock
        code={sourceInstallCommands.map((line) => `$ ${line}`).join("\n")}
      />
      <p>
        The source is on <a href={repoUrl}>GitHub</a> under the MIT license.
      </p>
    </DocsShell>
  );
}
