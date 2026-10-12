import type { Metadata } from "next";
import Link from "next/link";

import { CodeBlock } from "../code-block";
import { installCommand, repoUrl, sourceInstallCommands } from "../messaging";
import { DawgPlatformInstall } from "../platform-install";
import { latestRelease } from "../release";
import { DocsShell, INSTALL_ID } from "./docs-shell";
import { docsHref, docsPage, docsTree } from "./pages";

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

/** Where to go next, by what you want to do; each id is a guide in guides/. */
const tasks = [
  { task: "Start a song and learn the screen", id: "getting-started" },
  { task: "Play the keyboard, record a take", id: "play" },
  { task: "Pick a sound and turn its knobs", id: "sound" },
  { task: "Load a groove starter or a style", id: "styles" },
  { task: "Open a complete demo song and read its notes", id: "demos" },
  { task: "Browse the sounds that ship with dawg", id: "sample-library" },
  { task: "Add effects and mix the tracks", id: "mix" },
  { task: "Arrange bars, sections and the loop", id: "arrange" },
  { task: "Open the song in a second terminal", id: "panes" },
  { task: "Save the song as TypeScript files", id: "files" },
  { task: "Ask the agent and watch it type", id: "agent" },
  { task: "Export audio or pick an audio device", id: "audio" },
] as const;

export default async function DocsInstall() {
  const release = await latestRelease();
  const first = docsTree()[0]?.page;
  return (
    <DocsShell id={INSTALL_ID} title="Install dawg" description={description}>
      <h2 id="requirements">What it needs</h2>
      <ul>
        <li>
          A terminal on macOS or Linux, arm64 or x64. Windows is not supported.
        </li>
        <li>
          <a href="https://bun.sh">Bun</a> 1.3.14 or newer. The install script
          adds it when it is missing.
        </li>
        <li>
          Sound: dawg&rsquo;s native audio sink ships prebuilt for macOS and
          Linux. Where it cannot load, dawg falls back to <code>ffplay</code>{" "}
          (from FFmpeg), SoX <code>play</code> or, on a Mac, <code>afplay</code>
          ; <code>dawg doctor</code> says which one it uses. Playing live keys
          through a fallback player adds latency.
        </li>
        <li>
          The agent needs a model from a provider you already have; commands,
          playing, recording and rendering work offline without one.
        </li>
      </ul>
      <h2 id="install">Install</h2>
      <DawgPlatformInstall installCommand={installCommand} />
      <h2 id="start">Start a session</h2>
      <p>
        Run <code>dawg</code> in any folder. The first launch creates{" "}
        <code>.dawg/</code> there, and later launches pick the same session up
        again.
      </p>
      <CodeBlock code="$ dawg" />
      <p>
        To ask the agent, give it a model once: a Vercel AI Gateway or
        OpenRouter key, or a Claude or ChatGPT/Codex subscription through xcb.
        Agent turns are billed by that account.
      </p>
      <CodeBlock code="$ dawg model key" />
      <h2 id="guides">Find a guide by task</h2>
      <p>
        The guides here are the ones dawg shows in the terminal under{" "}
        <code>/guide</code>. Each one answers in the same four ways: ask, type,
        menu, keys.
      </p>
      <ul>
        {tasks.map(({ task, id }) => {
          const page = docsPage(id);
          if (page === undefined) throw new Error(`no guide ${id} for a task`);
          return (
            <li key={id}>
              <Link href={docsHref(id)}>{task}</Link>{" "}
              <span className="dawg-small">({page.title})</span>
            </li>
          );
        })}
      </ul>
      {first === undefined ? null : (
        <p>
          New here? Read <Link href={docsHref(first.id)}>{first.title}</Link>{" "}
          first; the pager at the bottom of each page walks the whole tree.
        </p>
      )}
      {release.published ? (
        <>
          <h2 id="release">Check a release first</h2>
          <p>
            Each <a href={release.url}>release</a> is immutable and ships the
            tarball, a <code>SHA256SUMS</code> file and a GitHub build
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
