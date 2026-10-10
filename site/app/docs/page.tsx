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
  "Install dawg with one command, give the agent a model, and start your first song.";

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
        dawg runs in a terminal on macOS and Linux on{" "}
        <a href="https://bun.sh">Bun</a> 1.3.14 or newer; the install script
        adds Bun if it is missing. Sound plays through dawg&rsquo;s native audio
        sink, prebuilt for arm64 and x64. Where it cannot load, dawg falls back
        to <code>ffplay</code>, SoX or, on a Mac, <code>afplay</code>;{" "}
        <code>dawg doctor</code> says which it uses.
      </p>
      <DawgPlatformInstall installCommand={installCommand} />
      <h2 id="start">Start a session</h2>
      <p>
        Run <code>dawg</code> in any folder. The first launch creates{" "}
        <code>.dawg/</code> there, and later launches pick the same session up
        again.
      </p>
      <CodeBlock code="$ dawg" />
      <p>
        Commands, playing and rendering work offline with no account. To ask
        the agent, give it a model once: an AI Gateway key, OpenRouter, or a
        Claude or ChatGPT/Codex subscription.
      </p>
      <CodeBlock code="$ dawg model key" />
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
