import type { Metadata } from "next";
import Link from "next/link";

import { repoUrl } from "../../messaging";
import { Screen } from "../../screens/screen";
import { SiteHeader } from "../../site-header";

const description =
  "Strudel live-codes patterns in the browser; dawg plays, types and edits songs in the terminal. What each is for, side by side.";

export const metadata: Metadata = {
  title: "dawg vs Strudel",
  description,
  alternates: { canonical: "/vs/strudel" },
  openGraph: { title: "dawg vs Strudel", description, url: "/vs/strudel" },
};

const STRUDEL = "https://strudel.cc";

/** Each row: the question, Strudel's answer, dawg's answer. */
const rows = [
  ["What it is", "A live-coding pattern language and REPL", "A DAW you drive by keys, commands or an agent"],
  ["Where it runs", "In the browser; installable as a PWA", "In a terminal on macOS or Linux"],
  ["Install", "None: open strudel.cc", "One script, on Bun"],
  ["How you write music", "Code: mini-notation and pattern functions", "Play keys, type short commands, or ask the agent"],
  ["Time", "Cycles; patterns repeat and transform", "Bars and beats on a timeline, with a song form"],
  ["Saved as", "Code you share as a link", "Typed TypeScript files in your folder"],
  ["Sound", "Web Audio synths and samples; MIDI and OSC out", "Native synths, sampler and kit; WAV and MIDI files out"],
  ["Samples", "samples(), github: packs, bank()", "Reads the same manifests and bank names"],
  ["AI agent", "No", "Optional; your key or subscription"],
  ["Offline", "After the first visit; samples once used", "Always; packs once used"],
  ["Licence", "AGPL-3.0", "MIT"],
] as const;

export default function StrudelPage() {
  return (
    <>
      <SiteHeader active="strudel" />
      <main id="main" className="dawg-page dawg-prose">
        <p className="dawg-eyebrow">Compare</p>
        <h1>dawg vs Strudel</h1>
        <p className="dawg-lede">
          <a href={STRUDEL}>Strudel</a> is for live-coding patterns in a
          browser. dawg is for making songs in a terminal with your hands, short
          commands or an agent. They share a sample format, and plenty of
          people will want both.
        </p>

        <div className="dawg-table-wrap">
          <table className="dawg-table dawg-compare">
            <caption className="dawg-visually-hidden">
              Strudel and dawg compared
            </caption>
            <thead>
              <tr>
                <th scope="col"> </th>
                <th scope="col">Strudel</th>
                <th scope="col">dawg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([topic, strudel, dawg]) => (
                <tr key={topic}>
                  <th scope="row">{topic}</th>
                  <td>{strudel}</td>
                  <td>{dawg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>What Strudel is</h2>
        <p>
          Strudel is{" "}
          <a href={`${STRUDEL}/workshop/getting-started/`}>
            &ldquo;an official port of the Tidal Cycles pattern language to
            JavaScript&rdquo;
          </a>
          . You write patterns in a REPL at strudel.cc and change them while
          they play. Its{" "}
          <a href={`${STRUDEL}/learn/mini-notation/`}>mini-notation</a> packs
          a rhythm into a short string such as <code>&quot;bd(3,8) sd&quot;</code>,
          and everything happens in cycles: add a step and the others get
          shorter, the cycle stays the same length.
        </p>

        <h2>Where Strudel is the better pick</h2>
        <ul>
          <li>
            <strong>Live coding on stage.</strong> It was built for performing:
            you edit a pattern and hear it change on the next cycle.
          </li>
          <li>
            <strong>Zero install.</strong> Open a URL on any device, phone
            included. It{" "}
            <a href={`${STRUDEL}/learn/pwa/`}>works offline</a> after the
            first visit and can install as an app.
          </li>
          <li>
            <strong>Pattern depth.</strong> Polymeter, Euclidean rhythms,
            chance, nesting and transforming functions go far beyond dawg&rsquo;s{" "}
            <code>euclid()</code> and <code>grid()</code>.
          </li>
          <li>
            <strong>Sharing.</strong> The share button turns a pattern into a
            link anyone can open and play, and can post it to the community{" "}
            <a href={`${STRUDEL}/bakery/`}>bakery</a>.
          </li>
          <li>
            <strong>Other gear.</strong> It can{" "}
            <a href={`${STRUDEL}/learn/input-output/`}>send MIDI and OSC</a>,
            so it can sequence hardware and other software. dawg writes MIDI
            files but does not send live MIDI.
          </li>
          <li>
            <strong>Community.</strong> Years of the Tidal and TOPLAP scenes,
            a workshop, and a large set of shared patterns.
          </li>
        </ul>

        <h2>Where dawg is the better pick</h2>
        <ul>
          <li>
            <strong>Your terminal.</strong> It runs next to your editor and
            shell, in as many terminals as you like, with no browser tab.
          </li>
          <li>
            <strong>Playing and recording.</strong> Ctrl-P turns the keyboard
            into a piano; <code>r</code> records over the loop with a click and
            count-in, quantized to the grid.
          </li>
          <li>
            <strong>Songs, not loops.</strong> A timeline in bars with
            sections, a song form, TAPE for copying and moving bars, a mixer
            and automation.
          </li>
          <li>
            <strong>An agent that shows its work.</strong> Ask in plain words;
            it types dawg commands into your prompt as it works, and each
            change is one undo step.
          </li>
          <li>
            <strong>Typed project files.</strong> A song is{" "}
            <code>song.ts</code> plus a <code>track.ts</code> per track,
            checked by TypeScript. Edit them in any editor and the open song
            updates.
          </li>
          <li>
            <strong>Native audio.</strong> A native sink plays live keys about
            17 ms after the press on macOS. Renders are byte-identical WAVs.
          </li>
          <li>
            <strong>Panes.</strong> One song open in several terminals, one
            transport, each pane with its own letter and undo.
          </li>
        </ul>

        <Screen id="hero" caption="dawg in a terminal: a song playing in a loop while the agent types a command." />

        <h2>How they fit together</h2>
        <p>
          dawg&rsquo;s sampler follows Strudel&rsquo;s{" "}
          <a href={`${STRUDEL}/learn/samples/`}>sample semantics</a>:{" "}
          <code>begin</code> and <code>end</code> pick a window,{" "}
          <code>speed</code> changes the rate and pitch (negative reverses),{" "}
          <code>loop</code> repeats it, and Strudel&rsquo;s <code>cut</code>{" "}
          groups are dawg&rsquo;s <code>choke</code>. The menu lists each
          parameter under its Strudel name.
        </p>
        <p>
          It reads Strudel&rsquo;s <code>strudel.json</code> pack manifests,
          including the <code>github:user/repo</code> shorthand, and its
          drum-machine bank names, so <code>/pack add</code> takes the packs
          Strudel users already know. dawg&rsquo;s loader is written from the
          documented format only; it uses no Strudel code.
        </p>
        <p>
          A good split: sketch and perform patterns in Strudel, then build the
          song, record parts and render it in dawg.
        </p>

        <h2>Try them</h2>
        <ul>
          <li>
            Strudel: open <a href={STRUDEL}>strudel.cc</a> and start the{" "}
            <a href={`${STRUDEL}/workshop/getting-started/`}>workshop</a>.
          </li>
          <li>
            dawg: <Link href="/#install">install it</Link>, run{" "}
            <code>dawg</code> in a folder, and read the{" "}
            <Link href="/docs">docs</Link>. Source is on{" "}
            <a href={repoUrl}>GitHub</a>.
          </li>
        </ul>
        <p className="dawg-small">
          Strudel facts are from strudel.cc and its{" "}
          <a href="https://codeberg.org/uzu/strudel">repository</a>, checked
          October 2026. Corrections welcome on{" "}
          <a href={`${repoUrl}/issues`}>GitHub</a>.
        </p>
      </main>
    </>
  );
}
