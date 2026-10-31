import Link from "next/link";
import type { ReactNode } from "react";

import { CodeBlock } from "./code-block";
import { Flow } from "./flow";
import { Highway, highwayFacts } from "./highway/highway";
import { installCommand, productMessaging } from "./messaging";
import { atLeast, latestRelease } from "./release";
import { Screen } from "./screens/screen";
import { SiteHeader } from "./site-header";

// Re-check for a new release hourly (RELEASE_REVALIDATE); Next needs a literal.
export const revalidate = 3600;

/**
 * Optional command controls, illustrated by existing real app captures.
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
        Open the optional <code>/play</code> keyboard piano; <kbd>R</kbd>
        records over the loop, counted in and snapped to the beat.
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
        The optional sound controls keep four colored knobs: ↑↓ picks one and ←→
        turns it to shape a synth, a track or the mix.
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
        Open <code>/patch</code> for optional sound design with oscillators,
        filters and envelopes; eight built-in patches expose four controls.
      </>
    ),
  },
  {
    id: "ask",
    clip: 4,
    label: "Ask",
    heading: "Inspect the agent's commands",
    screen: "showme",
    body: (
      <>
        Optional <code>/showme on</code> reveals command receipts. Normal chat
        focuses on the music being written, and accepted changes stay undoable.
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
    title: "Bundled song workflows",
    body: (
      <>
        Write house hyperpop, study references and re-sing supplied or
        transcribed words with stock British bf_emma.
      </>
    ),
  },
  {
    title: "More than 150 presets",
    body: (
      <>
        <code>/presets</code> browses them, four named knobs each.
      </>
    ),
    since: "0.10.0",
  },
  {
    title: "Demo songs",
    body: (
      <>
        <code>demo</code> opens nine complete, editable hyperpop songs with
        original vocals.
      </>
    ),
    since: "0.12.0",
  },
  {
    title: "Sample library",
    body: (
      <>
        Original sounds, vocal books and sung hooks; <code>sample chop</code>
        slices one.
      </>
    ),
    since: "0.12.0",
  },
  {
    title: "TAPE",
    body: (
      <>
        <kbd>Ctrl-T</kbd> shows the tracks overview; <code>/tape</code> opens
        optional copy, cut and paste controls.
      </>
    ),
  },
  {
    title: "History and comments",
    body: (
      <>
        <code>/comment</code> pins a note; <code>/history</code> jumps back.
      </>
    ),
    since: "0.10.0",
  },
  {
    title: "Stems and samples",
    body: (
      <>
        Split a reference into stems and notes; <code>dawg media doctor</code>.
      </>
    ),
  },
  {
    title: "Your coding agent",
    body: (
      <>
        <code>dawg init</code> saves the song as TypeScript files.
      </>
    ),
  },
  {
    title: "Many windows, one song",
    body: <>A letter and its own undo per pane, one transport.</>,
  },
  {
    title: "WAV and MIDI out",
    body: (
      <>
        <code>dawg render song.wav</code> renders the saved score and assets.
      </>
    ),
  },
];

const flow = [
  {
    title: "Describe a song",
    body: (
      <>
        Run <code>dawg</code> in a folder and tell the agent what you want to
        hear.
      </>
    ),
    code: "$ dawg",
  },
  {
    title: "Hear a ready draft",
    body: (
      <>
        Playback starts when a musical draft is ready; your later pause stays in
        control.
      </>
    ),
    code: "Space · play / pause",
  },
  {
    title: "Follow and steer",
    body: (
      <>
        Follow the written track, pin it to inspect, and ask for the next
        change.
      </>
    ),
    code: "Ctrl-P · pin / unpin",
  },
  {
    title: "Sound out",
    body: (
      <>
        Keep songs and vocal takes in your project; render the saved score to
        WAV.
      </>
    ),
    code: "$ dawg render song.wav",
  },
] as const;

const questions: readonly { q: string; a: ReactNode }[] = [
  {
    q: "Is it free, and do I need an account?",
    a: "dawg is free and MIT licensed. Saved songs play and render locally without an account, Python or network access. New generation uses your configured agent provider; stock singing and reference analysis need their optional local tools and cached models.",
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
    a: "Edits are checked before they commit and stay undoable. Escape cancels work while keeping completed changes and vocal takes. Your pause and seek choices stay in control while the agent works.",
  },
  {
    q: "Can I get the song out?",
    a: "dawg render song.wav writes a WAV from the saved score and assets; dawg render song.mid writes MIDI. Saved renders are repeatable, and generated vocal takes stay in your project. Fresh voice inference can produce different bytes.",
  },
  {
    q: "Coming from live coding or a DAW?",
    a: (
      <>
        dawg keeps bars, beats, tracks and a song form on a timeline, and reads
        the same sample packs the live-coding world shares.{" "}
        <Link href="/vs/strudel">dawg vs Strudel</Link> puts the two side by
        side.
      </>
    ),
  },
];

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

/** A section's mono label, heading and one sentence, in the left column. */
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
              caption="The default studio: the agent writes chords while playback continues."
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
            label="Follow the song"
            heading="Watch tracks become music."
          >
            <p>
              The tracks overview opens first. The horizontal piano roll follows
              the track being written; <kbd>Ctrl-P</kbd> pins it. This optional
              highway shows a score vertically.
            </p>
          </SectionHead>
          <div className="dawg-section__body">
            <Highway />
            <p className="dawg-section__note">
              <code>
                style {highwayFacts.style} {highwayFacts.bars}{" "}
                {highwayFacts.seed}
              </code>{" "}
              · {highwayFacts.tracks.join(", ")} · {highwayFacts.notes} notes at{" "}
              {highwayFacts.tempoBpm} BPM in {highwayFacts.key}
            </p>
          </div>
        </section>

        <section
          className="dawg-section dawg-section--gallery"
          id="ways"
          aria-labelledby="ways-title"
        >
          <SectionHead
            id="ways-title"
            index="02"
            label="Optional controls"
            heading="Open the advanced tools when you need them."
          >
            <p>
              These captures show command controls for recording, sound design
              and inspecting agent edits.
            </p>
          </SectionHead>
          <div className="dawg-gallery">
            {pillars.map((pillar, i) => (
              <article
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
                  <h3 id={`${pillar.id}-title`} className="dawg-pillar__title">
                    {pillar.heading}
                  </h3>
                  <p>{pillar.body}</p>
                </div>
                <div className="dawg-pillar__screen">
                  <Screen id={pillar.screen} animate caption={false} />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="dawg-section" aria-labelledby="how-title">
          <SectionHead
            id="how-title"
            index="03"
            label="How it works"
            heading="Describe, listen and revise."
          >
            <p>
              The player shows musical progress and separates pending changes
              from ready audio. Pause and seek remain available during
              generation.
            </p>
          </SectionHead>
          <div className="dawg-section__body">
            <Flow steps={flow} />
          </div>
        </section>

        <section className="dawg-section" aria-labelledby="code-title">
          <SectionHead
            id="code-title"
            index="04"
            label="Songs as code"
            heading="Save it as TypeScript."
          >
            <p>
              <code>dawg init</code> writes the song as files. Edit one in any
              editor, or with your coding agent, and every open window applies
              the change.
            </p>
          </SectionHead>
          <div className="dawg-section__body">
            <CodeBlock
              code={projectCode}
              label="tracks/drums/track.ts"
              copy={false}
            />
          </div>
        </section>

        <section className="dawg-section" aria-labelledby="deep-title">
          <SectionHead
            id="deep-title"
            index="05"
            label="Goes deep"
            heading="Simple on day one. Deep when you want it."
          >
            <p>
              Open each part when you need it; nothing here is required to
              start.
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
            index="06"
            label="Get started"
            heading="Install dawg"
          >
            <p>
              One script on macOS or Linux: it installs Bun if it is missing,
              downloads the latest release, checks it against the
              release&rsquo;s SHA256SUMS and installs it.
            </p>
          </SectionHead>
          <div className="dawg-section__body">
            <CodeBlock code={`$ ${installCommand}`} />
            <p className="dawg-small">
              <a href="/install">Read the script</a> before you pipe it. npm,
              the release tarball, source and the agent setup are on the{" "}
              <Link href="/docs">install page</Link>.
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
