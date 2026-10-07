import Link from "next/link";

import { CodeBlock } from "./code-block";
import { HighwayDemo } from "./highway/highway-demo";
import {
  installCommand,
  productMessaging,
  repoUrl,
  sourceInstallCommands,
} from "./messaging";
import { latestRelease, releaseTarballUrl } from "./release";
import { SiteHeader } from "./site-header";

// Re-check for a new release hourly (RELEASE_REVALIDATE); Next needs a literal.
export const revalidate = 3600;

const pillars = [
  {
    title: "Ask for a groove",
    body: "Type what you want to hear. A streaming agent writes it with typed tools; each call is checked, dry-run against the score and committed as its own revision. Esc stops a turn and keeps what landed. Ctrl-Z takes any of it back.",
  },
  {
    title: "Watch it on the highway",
    body: "Notes stream down a piano roll toward the hit line, sustains stretch across beats, and drums get a lane per voice. The prompt stays live underneath, so you can steer while the loop plays.",
  },
  {
    title: "Open a window, get a player",
    body: "Every terminal window on a session shares one song and one transport. Each new window takes the next instrument, so three windows on a three-track song bring back drums, bass and keys.",
  },
  {
    title: "Local first, your own models",
    body: "The session is a folder in your project. Direct commands, playback and rendering work offline with no account. Bring an AI Gateway key, or use the Claude, Codex or Devin subscription you already pay for through xcb.",
  },
] as const;

const features = [
  {
    title: "Drum kit",
    body: "Kick, rim, snare, clap, hats and tom, written hit by hit or as patterns. A track named drums gets the kit.",
  },
  {
    title: "Filter, delay, reverb",
    body: "Per-track low-pass filter, tempo-synced ping-pong delay and a Freeverb-style reverb send, with automation lanes.",
  },
  {
    title: "Gapless playback",
    body: "One long-lived ffplay or SoX player. Edits, tempo changes and seeks swap the loop in place without a restart.",
  },
  {
    title: "Undo and redo",
    body: "Every edit, typed or agent-made, is a revision in the shared session log. Undo from any window.",
  },
  {
    title: "Named sessions",
    body: "Songs name themselves from what you play. /rename, /fork into night drive 2, /resume later.",
  },
  {
    title: "Crash recovery",
    body: "dawgd, one small local daemon per session, owns the score and transport. A crashed daemon is reclaimed by the next window.",
  },
  {
    title: "Deterministic renders",
    body: "dawg render out.wav writes the session without starting audio. The same score gives the same bytes, and prints the sha256.",
  },
  {
    title: "Themes and motion",
    body: "Default, high-contrast and mono themes, a static reduced-motion mode, and NO_COLOR respected.",
  },
] as const;

const questions = [
  {
    q: "Do I need an account?",
    a: "No. The session lives in .dawg/ in your project, and typed commands such as tempo 96, hit kick at 0 or reverb 0.3 work offline. You only need a provider for the agent.",
  },
  {
    q: "Which models does the agent use?",
    a: "opus-5.5 or sol-6.1 through Vercel AI Gateway, switched with /model. dawg login creates a gateway key with the Vercel CLI, or dawg login --xcb routes turns through a Claude, Codex or Devin subscription with xcb.",
  },
  {
    q: "Where does the sound come from?",
    a: "A built-in deterministic synthesizer. Playback streams into ffplay or SoX play, or afplay on macOS. dawg auth status shows which one it found. DAWG_AUDIO=0 runs silent.",
  },
  {
    q: "Can the agent wreck my song?",
    a: "Every tool call is validated and dry-run before it commits, and a call planned against an old revision is rejected or replayed only when nothing it touches has changed. Each accepted call is one revision, so undo removes exactly that change.",
  },
  {
    q: "Is it on npm?",
    a: "Yes: npm i -g @hraness/dawg or bun add -g @hraness/dawg. The install script and the GitHub Release tarball work too.",
  },
  {
    q: "What does it cost?",
    a: "dawg is free and MIT licensed. Agent turns are billed by your gateway account or count against your own subscription.",
  },
] as const;

export default async function Home() {
  const release = await latestRelease();
  const bunCommand = release.published
    ? `bun add -g ${releaseTarballUrl(release.version)}`
    : null;
  return (
    <>
      <SiteHeader active="home" />
      <main id="main" className="dawg-main">
        <section className="dawg-hero" aria-labelledby="hero-title">
          <div className="dawg-hero__copy">
            <p className="dawg-eyebrow">{productMessaging.category}</p>
            <h1 id="hero-title">
              A DAW in your terminal,{" "}
              <span className="dawg-hero__dawg">dawg</span>.
            </h1>
            <p className="dawg-lede">
              Chat with an agent to build loops. Watch every note land on a
              piano roll that scrolls above your prompt. Open another window and
              pick up another instrument.
            </p>
            <div className="dawg-hero__install">
              <CodeBlock code={`$ ${installCommand}`} />
              <p className="dawg-hero__links">
                <Link href="/docs" data-analytics-cta>
                  Quickstart
                </Link>
                <a href={repoUrl}>Source on GitHub</a>
                <span>MIT · Bun 1.3.14+</span>
              </p>
            </div>
          </div>
          <div className="dawg-hero__demo">
            <HighwayDemo />
          </div>
        </section>

        <section className="dawg-section" aria-labelledby="pillars-title">
          <h2 id="pillars-title" className="dawg-section__title">
            Make a loop the way you&rsquo;d describe it
          </h2>
          <ol className="dawg-pillars">
            {pillars.map((pillar, i) => (
              <li key={pillar.title} className="dawg-pillar">
                <span className="dawg-pillar__index" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3>{pillar.title}</h3>
                <p>{pillar.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="dawg-section dawg-band"
          aria-labelledby="band-title"
        >
          <div className="dawg-band__copy">
            <h2 id="band-title" className="dawg-section__title">
              Three windows, one band
            </h2>
            <p>
              Run <code>dawg</code> in a project and the first window starts{" "}
              <code>dawgd</code>, a local daemon that is the only writer for
              that session. Every window after it joins the same song: play in
              one and they all play, edit in one and they all redraw. Each plain{" "}
              <code>dawg</code> takes the first track no other window has, and a
              window beyond the last track gets a fresh draft track.
            </p>
            <p>
              Kill a window, or the daemon, and nothing is lost. The next window
              reclaims the session from the atomic snapshot on disk. If the
              daemon can&rsquo;t start, windows fall back to a file lock.
            </p>
          </div>
          <div className="dawg-band__windows" aria-hidden="true">
            {[
              { name: "drums", note: "kick · snare · hat" },
              { name: "bass", note: "A2 C3 E3 · G2 D3 E3" },
              { name: "keys", note: "Am7 · G · reverb 0.3" },
            ].map((w) => (
              <div key={w.name} className="dawg-mini">
                <div className="dawg-mini__bar">
                  <span>$ dawg</span>
                  <span>{w.name}</span>
                </div>
                <div className="dawg-mini__body">
                  <span className="dawg-mini__track">{w.name}</span> · ▶ 96 BPM
                  · rev 7 · ● synced
                  <br />
                  <span className="dawg-mini__note">{w.note}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="dawg-section" aria-labelledby="turn-title">
          <h2 id="turn-title" className="dawg-section__title">
            What happens when you hit Enter
          </h2>
          <ol className="dawg-flow">
            <li>
              <h3>Plain commands run locally</h3>
              <p>
                <code>tempo 96</code>, <code>pattern hat every 0.5</code>,{" "}
                <code>reverb 0.3 0.7</code> and the rest of the command language
                never leave your machine.
              </p>
            </li>
            <li>
              <h3>Everything else goes to the agent</h3>
              <p>
                It gets a compact brief of the song, capped at 12 KiB, and edits
                only through typed tools: tracks, notes, drums, effects,
                automation.
              </p>
            </li>
            <li>
              <h3>Each tool call is checked three times</h3>
              <p>
                The tool&rsquo;s own argument checks, the planner&rsquo;s
                bounded validator and a dry run of the score reducer. A call
                that fails goes back to the model as a diagnostic.
              </p>
            </li>
            <li>
              <h3>Accepted calls become revisions</h3>
              <p>
                Each one is committed separately and broadcast to every window,
                with a card in the activity strip and an undo that drops exactly
                that change.
              </p>
            </li>
          </ol>
        </section>

        <section className="dawg-section" aria-labelledby="features-title">
          <h2 id="features-title" className="dawg-section__title">
            In the box
          </h2>
          <ul className="dawg-features">
            {features.map((feature) => (
              <li key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="dawg-section dawg-install"
          id="install"
          aria-labelledby="install-title"
        >
          <h2 id="install-title" className="dawg-section__title">
            Install
          </h2>
          <p>
            dawg runs on <a href="https://bun.sh">Bun</a> 1.3.14 or newer. The
            script installs Bun if it&rsquo;s missing, downloads the latest
            release tarball from GitHub, checks it against the release&rsquo;s
            SHA256SUMS and installs it with <code>bun add -g</code>.
          </p>
          {release.published ? null : (
            <p className="dawg-notice" role="status">
              The first release of dawg is coming soon. Until it&rsquo;s out the
              script stops with a note instead of installing; run it from source
              in the meantime.
            </p>
          )}
          <div className="dawg-install__grid">
            <div>
              <h3>Install script</h3>
              <CodeBlock code={`$ ${installCommand}`} />
              <p className="dawg-small">
                <a href="/install">Read the script</a> before you pipe it.
              </p>
            </div>
            {bunCommand === null ? null : (
              <div>
                <h3>Release tarball with Bun</h3>
                <CodeBlock code={`$ ${bunCommand}`} />
                <p className="dawg-small">
                  Each{" "}
                  <a
                    href={
                      release.published ? release.url : `${repoUrl}/releases`
                    }
                  >
                    release
                  </a>{" "}
                  ships the tarball, SHA256SUMS and a build provenance
                  attestation.
                </p>
              </div>
            )}
            <div>
              <h3>From source</h3>
              <CodeBlock
                code={sourceInstallCommands
                  .map((line) => `$ ${line}`)
                  .join("\n")}
              />
            </div>
          </div>
          <p>
            For sound, install <code>ffplay</code> (from FFmpeg) or SoX; on
            macOS dawg falls back to <code>afplay</code>. Then run{" "}
            <code>dawg</code> in any folder and see the{" "}
            <Link href="/docs">quickstart</Link>.
          </p>
        </section>

        <section className="dawg-section" aria-labelledby="faq-title">
          <h2 id="faq-title" className="dawg-section__title">
            Questions
          </h2>
          <dl className="dawg-faq">
            {questions.map((item) => (
              <div key={item.q}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </>
  );
}
