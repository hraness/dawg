import Link from "next/link";
import type { ReactNode } from "react";

import { CodeBlock } from "./code-block";
import { Flow } from "./flow";
import { Highway, highwayFacts } from "./highway/highway";
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
          Four colored knobs sit under every sound: ↑↓ picks one, ←→ turns it.
          Type <code>knobs</code> to open them.
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
          Type &ldquo;make the hats swing&rdquo; and the agent does it, typing
          each command into your prompt so you learn them as you go.
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
    title: "Start from a groove",
    body: (
      <>
        <code>style warehouse 4 3</code> loads four bars of one of sixteen
        groove starters; the full catalog of about 850 styles sits under{" "}
        <em>All styles</em>.
      </>
    ),
  },
  {
    title: "More than 150 presets",
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
        The agent splits a reference into stems, finds its tempo and key, and
        turns audio into notes with tools you install;{" "}
        <code>dawg media doctor</code> shows which.
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
    body: (
      <>
        Open the same song in several terminals: each pane gets a letter and its
        own undo, and they share one transport.
      </>
    ),
  },
  {
    title: "WAV and MIDI out",
    body: (
      <>
        <code>dawg render song.wav</code> writes the same bytes every time;{" "}
        <code>song.mid</code> writes MIDI.
      </>
    ),
  },
];

const flow = [
  {
    title: "One local session",
    body: (
      <>
        Run <code>dawg</code> in a folder. The song lives in <code>.dawg/</code>{" "}
        there, and one local daemon keeps the score and the transport.
      </>
    ),
    code: "$ dawg",
  },
  {
    title: "Several windows",
    body: (
      <>
        Open more terminals on the same folder. Each window takes the next
        unclaimed track and its own undo; all of them hear one clock.
      </>
    ),
    code: "$ dawg --track bass",
  },
  {
    title: "Prompt and agent",
    body: (
      <>
        Type a command and it lands as one revision. Type a sentence and the
        agent runs its commands through the same prompt.
      </>
    ),
    code: "› make the hats swing",
  },
  {
    title: "Sound out",
    body: (
      <>
        Playback runs through dawg&rsquo;s native audio sink and stays gapless
        through edits. <code>dawg render</code> writes the same audio to a WAV.
      </>
    ),
    code: "$ dawg render song.wav",
  },
] as const;

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
    a: "dawg's own synthesizers, sampler and kit. It plays through a native audio sink and falls back to ffplay, SoX or afplay; dawg doctor shows which one it uses.",
  },
  {
    q: "Can the agent wreck my song?",
    a: "Every tool call is validated before it commits, and each accepted call is its own revision, so undo removes exactly that change. Esc stops a turn and keeps what landed.",
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

const startCode = `track drums
pattern house
track bass
add C2 at 0 for 1
tempo 120`;

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
  const status = [
    "Free",
    "MIT",
    "macOS and Linux",
    ...(release.published ? [`v${release.version}`] : []),
  ].join(" · ");
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
            <p className="dawg-lede">{productMessaging.hero.summary}</p>
            <div className="dawg-hero__actions">
              <a
                className="dawg-button"
                href="#install"
                data-analytics-cta="install"
              >
                {productMessaging.hero.primaryAction}
              </a>
              <a
                className="dawg-button dawg-button--quiet"
                href="#highway"
                data-analytics-cta="watch"
              >
                {productMessaging.hero.secondaryAction}
              </a>
            </div>
            <p className="dawg-hero__status">{status}</p>
          </div>
          <div className="dawg-hero__demo">
            <Screen
              id="hero"
              animate
              caption="The real app: four tracks looping while the agent types its next command."
            />
          </div>
        </section>

        <section
          className="dawg-section dawg-section--highway"
          id="highway"
          aria-labelledby="highway-title"
        >
          <SectionHead
            id="highway-title"
            index="01"
            label="The highway"
            heading="Notes stream down toward the hit line."
          >
            <p>
              Every track plays on one piano roll. A note is a bar in its
              track&rsquo;s color; it slides down, crosses the line, and you
              hear it. The focused track is bright and the others sit behind it.
            </p>
            <p>
              This is the score every screen on this page plays:{" "}
              <code>
                style {highwayFacts.style} {highwayFacts.bars}{" "}
                {highwayFacts.seed}
              </code>
              , {highwayFacts.tracks.join(", ")}, {highwayFacts.notes} notes at{" "}
              {highwayFacts.tempoBpm} BPM in {highwayFacts.key}. The terminal
              draws the same notes as glyphs.
            </p>
          </SectionHead>
          <div className="dawg-section__body">
            <Highway />
          </div>
        </section>

        <section className="dawg-section" aria-labelledby="who-title">
          <SectionHead
            id="who-title"
            index="02"
            label="Who it is for"
            heading="People who already live in a terminal."
          />
          <div className="dawg-section__body dawg-columns">
            <div>
              <h3>You play</h3>
              <p>
                You want a loop going in the time it takes to open a tab. The
                keyboard is a piano, four knobs shape the sound, and a groove
                starter gives you drums, bass and a pad to play over.
              </p>
            </div>
            <div>
              <h3>You type</h3>
              <p>
                You already think in commands. <code>tempo 120</code>,{" "}
                <code>reverb 0.4</code>, <code>loop 5-6</code>: short words that
                edit the score directly, each one an undo step.
              </p>
            </div>
            <div>
              <h3>You work with an agent</h3>
              <p>
                You run coding agents all day and want the same loop for music:
                describe the groove, hear it, refine it. The song is TypeScript
                files your coding agent can edit too.
              </p>
            </div>
          </div>
        </section>

        <section className="dawg-section" aria-labelledby="idea-title">
          <SectionHead
            id="idea-title"
            index="03"
            label="The idea"
            heading="The coding-agent loop, for music."
          />
          <div className="dawg-section__body dawg-prose-block">
            <p>
              A terminal is already a studio for people who build software: one
              session, many windows, a prompt, an agent that works beside you.
              dawg gives music the same shape. Notes stream down a piano roll as
              they play, every window you open shares one local session, and a
              prompt at the bottom lets you add notes, extend loops, move the
              transport, or ask an agent to write the next change.
            </p>
            <p>
              Every guide in dawg shows the same four ways to do a thing: ask
              the agent, type the command, pick it from the menu, or press the
              key. When the agent edits the song it types each command into your
              prompt, so the chat teaches the manual way.
            </p>
            <p>
              Sessions stay on your machine, the score is a file you can read,
              and playback needs no account.
            </p>
          </div>
        </section>

        <section
          className="dawg-section dawg-section--lead"
          aria-labelledby="does-title"
        >
          <SectionHead
            id="does-title"
            index="04"
            label="What it does"
            heading="Four ways in. Each one is the real screen."
          >
            <p>
              Play, shape, patch, ask. Every picture below is a capture of the
              app, replaying the frames it drew.
            </p>
          </SectionHead>
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

        <section className="dawg-section" aria-labelledby="how-title">
          <SectionHead
            id="how-title"
            index="05"
            label="How it works"
            heading="One session. Many windows. One sound."
          >
            <p>
              The first window starts a small local daemon for the folder. Every
              other window connects to it, and all of them hear the same clock.
            </p>
          </SectionHead>
          <div className="dawg-section__body">
            <Flow steps={flow} />
            <div className="dawg-example">
              <div>
                <h3>Start a song</h3>
                <p>
                  Run <code>dawg</code> in an empty folder and type these at the
                  prompt. Space plays and pauses; <kbd>Ctrl-Z</kbd> undoes any
                  step.
                </p>
                <CodeBlock code={startCode} label="dawg" />
              </div>
              <div>
                <h3>Or save it as code</h3>
                <p>
                  <code>dawg init</code> writes the song as TypeScript. Edit a
                  file and every open window applies the change as one revision.
                </p>
                <CodeBlock
                  code={projectCode}
                  label="tracks/drums/track.ts"
                  copy={false}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="dawg-section" aria-labelledby="deep-title">
          <SectionHead
            id="deep-title"
            index="06"
            label="Goes deep"
            heading="Simple on day one. Deep when you want it."
          >
            <p>
              Under the keyboard and the knobs there is a full studio. Open each
              part when you need it; nothing here is required to start.
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
          </div>
        </section>

        <section
          className="dawg-section dawg-install"
          id="install"
          aria-labelledby="install-title"
        >
          <SectionHead
            id="install-title"
            index="07"
            label="Get started"
            heading="Install dawg"
          >
            <p>
              One script on macOS or Linux. It installs Bun if it is missing,
              downloads the latest release from GitHub, checks it against the
              release&rsquo;s SHA256SUMS and installs it with{" "}
              <code>bun add -g</code>.
            </p>
            <p>
              <Link href="/docs">
                Requirements, audio backends and the agent setup
              </Link>{" "}
              are on the install page.
            </p>
          </SectionHead>
          <div className="dawg-section__body">
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
                    Each <a href={release.url}>release</a> ships the tarball and
                    its SHA256SUMS.
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
              Then run <code>dawg</code> in any folder. To ask the agent, give
              it a model once with <code>dawg model key</code>; everything else
              works without one.
            </p>
          </div>
        </section>

        <section className="dawg-section" aria-labelledby="compare-title">
          <SectionHead
            id="compare-title"
            index="08"
            label="Compare"
            heading="Coming from live coding or a DAW?"
          />
          <div className="dawg-section__body dawg-prose-block">
            <p>
              dawg keeps bars, beats, tracks and a song form on a timeline, and
              reads the same sample packs the live-coding world shares. The
              comparison page puts it beside a browser pattern language, row by
              row.
            </p>
            <p>
              <Link className="dawg-more" href="/vs/strudel">
                dawg vs Strudel
              </Link>
            </p>
          </div>
        </section>

        <section className="dawg-section" aria-labelledby="faq-title">
          <SectionHead
            id="faq-title"
            index="09"
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
