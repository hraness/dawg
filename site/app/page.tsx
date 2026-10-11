import Link from "next/link";
import type { ReactNode } from "react";

import { CodeBlock } from "./code-block";
import {
  installCommand,
  productMessaging,
  sourceInstallCommands,
} from "./messaging";
import { atLeast, latestRelease, releaseTarballUrl } from "./release";
import { Screen } from "./screens/screen";
import { SiteHeader } from "./site-header";

// Re-check for a new release hourly (RELEASE_REVALIDATE); Next needs a literal.
export const revalidate = 3600;

/**
 * The four things a new player does first, in order. Each shows a real
 * screen that replays the frames dawg drew while it was captured.
 */
const pillars = [
  {
    id: "play",
    clip: 1,
    label: "Play",
    heading: "Play it with your keyboard",
    screen: "play-mode",
    body: (
      <>
        <p>
          Press <kbd>Ctrl-P</kbd> and your keyboard turns into a piano:{" "}
          <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> are the white
          keys, <kbd>W</kbd> <kbd>E</kbd> <kbd>T</kbd> the black ones.
        </p>
        <p>
          Press <kbd>R</kbd>, then <kbd>Space</kbd>: dawg counts you in, records
          over the loop and snaps what you play to the beat.
        </p>
      </>
    ),
  },
  {
    id: "knobs",
    clip: 2,
    label: "Shape",
    heading: "Shape it with four knobs",
    screen: "knobs",
    body: (
      <>
        <p>
          Four colored knobs, inspired by the OP-1, sit under every sound: ↑↓
          picks one, ←→ turns it. Type <code>knobs</code> to open them.
        </p>
        <p>
          The same four knobs turn a synth&rsquo;s filter, a track&rsquo;s
          volume, the whole mix or the tempo.
        </p>
      </>
    ),
  },
  {
    id: "patch",
    clip: 3,
    label: "Patch",
    heading: "Patch your own sounds",
    screen: "patch",
    body: (
      <>
        <p>
          When you want more, open <code>/patch</code>: oscillators, filters and
          envelopes joined by cables, like a modular synth.
        </p>
        <p>
          Start from one of eight built-in patches, such as{" "}
          <code>patch load acid-bass</code>. Its first four controls land on the
          four knobs.
        </p>
      </>
    ),
  },
  {
    id: "ask",
    clip: 4,
    label: "Ask",
    heading: "Ask for what you want",
    screen: "showme",
    body: (
      <>
        <p>
          Type &ldquo;make it slower and wetter&rdquo; and the agent does it,
          typing each command into your prompt so you learn them as you go.
        </p>
        <p>
          Every change it makes undoes on its own. The agent is optional:
          playing, recording and everything you type works offline.
        </p>
      </>
    ),
  },
] as const;

/**
 * The deeper end, one line each. Every item is in README, DAWG.md or
 * CHANGELOG on main; an item with `since` is merged but unreleased, and
 * appears once the latest GitHub Release reaches that version.
 */
const depths: readonly {
  title: string;
  body: ReactNode;
  since?: string;
}[] = [
  {
    title: "Start from a style",
    body: (
      <>
        <code>style deep-house 16</code> writes drums, bass, chords and a melody
        in one of about 850 styles.
      </>
    ),
  },
  {
    title: "151 presets",
    body: (
      <>
        Seventeen categories, each preset with four named knobs.{" "}
        <code>/presets</code> browses them.
      </>
    ),
    since: "0.10.0",
  },
  {
    title: "TAPE",
    body: (
      <>
        <kbd>Ctrl-T</kbd> shows every track across the bars. Copy, cut and loop
        sections with one key.
      </>
    ),
  },
  {
    title: "History and comments",
    body: (
      <>
        <code>/comment</code> pins a note to the moment; <code>/history</code>{" "}
        jumps back to it.
      </>
    ),
    since: "0.10.0",
  },
  {
    title: "Stems and samples",
    body: (
      <>
        <code>dawg media</code> splits a song into stems, finds its tempo and
        key, and turns audio into notes, with tools you install.
      </>
    ),
  },
  {
    title: "Your coding agent",
    body: (
      <>
        <code>dawg init</code> saves the song as TypeScript files. Edit them in
        any editor, or with your coding agent, and the song updates.
      </>
    ),
  },
  {
    title: "Many windows, one song",
    body: <>Open the same song in several terminals, each with its own undo.</>,
  },
  {
    title: "WAV and MIDI out",
    body: (
      <>
        <code>dawg render song.wav</code> writes the same audio every time;{" "}
        <code>song.mid</code> writes MIDI.
      </>
    ),
  },
];

const questions = [
  {
    q: "Do I need an account?",
    a: "No. The session lives in .dawg/ in your folder, and commands, playback, recording and rendering work offline. You only need a provider for the agent.",
  },
  {
    q: "Which models does the agent use?",
    a: "Run dawg model key. It finds what you already have: a Vercel AI Gateway or OpenRouter key, or a ChatGPT/Codex or Claude subscription through xcb. /model picks a model and shows the estimated cost per prompt; the default is opus-5.5.",
  },
  {
    q: "Where does the sound come from?",
    a: "dawg's own synthesizers, sampler and drum kit. It plays through a native audio sink, prebuilt for macOS and Linux on arm64 and x64, and falls back to ffplay, SoX or afplay. dawg doctor shows which one it uses.",
  },
  {
    q: "Can the agent wreck my song?",
    a: "Every tool call is validated and dry-run before it commits, and each accepted call is its own revision, so undo removes exactly that change. Esc stops a turn and keeps what landed.",
  },
  {
    q: "Can I get the song out?",
    a: "dawg render song.wav writes a WAV through the same renderer that plays, byte-identical across runs; dawg render song.mid writes MIDI. The project files are plain TypeScript in your folder.",
  },
  {
    q: "What does it cost?",
    a: "dawg is free and MIT licensed. Agent turns are billed by your gateway or OpenRouter account, or count against your subscription.",
  },
] as const;

const projectCode = `// tracks/drums/track.ts
import { track, euclid, grid } from "dawg";

export default track({
  name: "drums",
  instrument: "kit",
  rhythm: [
    euclid("kick", 4, 16),
    euclid("hat", 7, 16, 2, { velocity: 0.5 }),
    grid("snare", "....X.......x..."),
  ],
});`;

/** A section's mono label and heading, in the left column of the studio grid. */
function SectionHead({
  id,
  index,
  label,
  heading,
  children,
}: Readonly<{
  id: string;
  index: string;
  label: string;
  heading: string;
  children?: ReactNode;
}>) {
  return (
    <header className="dawg-section__head">
      <p className="dawg-eyebrow">
        <span aria-hidden="true">{index}</span> {label}
      </p>
      <h2 id={id} className="dawg-section__title">
        {heading}
      </h2>
      {children}
    </header>
  );
}

export default async function Home() {
  const release = await latestRelease();
  const shipped = depths.filter(
    (item) =>
      item.since === undefined ||
      (release.published && atLeast(release.version, item.since)),
  );
  return (
    <>
      <SiteHeader active="home" />
      <main id="main" tabIndex={-1} className="dawg-main">
        <section className="dawg-hero" aria-labelledby="hero-title">
          <div className="dawg-hero__copy">
            <p className="dawg-eyebrow dawg-hero__eyebrow">
              {productMessaging.category}
            </p>
            <h1 id="hero-title" className="dawg-hero__title">
              Make music in your terminal,{" "}
              <span className="dawg-hero__dawg">dawg</span>.
            </h1>
            <p className="dawg-lede">{productMessaging.short}</p>
            <div className="dawg-hero__install">
              <CodeBlock code={`$ ${installCommand}`} />
              <p className="dawg-hero__links">
                <a href="#play" data-analytics-cta>
                  See how it works
                </a>
                <span>Free · macOS and Linux · no account</span>
              </p>
            </div>
          </div>
          <div className="dawg-hero__demo">
            <Screen
              id="hero"
              animate
              caption="The real app: four tracks looping while the agent types its next command."
            />
          </div>
        </section>

        {pillars.map((pillar, i) => (
          <section
            key={pillar.id}
            id={pillar.id}
            className="dawg-pillar"
            data-clip={pillar.clip}
            aria-labelledby={`${pillar.id}-title`}
          >
            <div className="dawg-pillar__copy">
              <p className="dawg-eyebrow">
                <span className="dawg-pillar__chip" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>{" "}
                {pillar.label}
              </p>
              <h2 id={`${pillar.id}-title`} className="dawg-section__title">
                {pillar.heading}
              </h2>
              {pillar.body}
            </div>
            <div className="dawg-pillar__screen">
              <Screen id={pillar.screen} animate caption={false} />
            </div>
          </section>
        ))}

        <section className="dawg-section" aria-labelledby="deep-title">
          <SectionHead
            id="deep-title"
            index="05"
            label="Goes deep"
            heading="Simple on day one. Deep when you want it."
          >
            <p>
              Under the keyboard and the knobs there&rsquo;s a full studio. Open
              each part when you need it; nothing here is required to start.
            </p>
          </SectionHead>
          <div className="dawg-section__body">
            <ul className="dawg-deep">
              {shipped.map((item) => (
                <li key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </li>
              ))}
            </ul>
            <div className="dawg-deep__code">
              <CodeBlock
                code={projectCode}
                label="tracks/drums/track.ts"
                copy={false}
              />
            </div>
          </div>
        </section>

        <section
          className="dawg-section dawg-install"
          id="install"
          aria-labelledby="install-title"
        >
          <SectionHead
            id="install-title"
            index="06"
            label="Get started"
            heading="Install"
          >
            <p>
              dawg runs on <a href="https://bun.sh">Bun</a> 1.3.14 or newer. The
              script installs Bun if it&rsquo;s missing, downloads the latest
              release tarball from GitHub, checks it against the release&rsquo;s
              SHA256SUMS and installs it with <code>bun add -g</code>.
            </p>
          </SectionHead>
          <div className="dawg-section__body">
            {release.published ? null : (
              <p className="dawg-notice" role="status">
                The first release of dawg is coming soon. Until it&rsquo;s out
                the script stops with a note instead of installing; run it from
                source in the meantime.
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
              {release.published ? (
                <div>
                  <h3>Release tarball with Bun</h3>
                  <CodeBlock
                    code={`$ bun add -g ${releaseTarballUrl(release.version)}`}
                  />
                  <p className="dawg-small">
                    Each <a href={release.url}>release</a> ships the tarball,
                    SHA256SUMS and a build provenance attestation.
                  </p>
                </div>
              ) : null}
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
              Sound plays through dawg&rsquo;s native audio sink on macOS and
              Linux; where it cannot load, install <code>ffplay</code> (from
              FFmpeg) or SoX. Then run <code>dawg</code> in any folder and
              follow the <Link href="/docs">docs</Link>.
            </p>
          </div>
        </section>

        <section className="dawg-section" aria-labelledby="faq-title">
          <SectionHead
            id="faq-title"
            index="07"
            label="FAQ"
            heading="Questions"
          />
          <div className="dawg-section__body dawg-faq">
            {questions.map((item) => (
              <details key={item.q}>
                <summary>
                  {item.q}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
