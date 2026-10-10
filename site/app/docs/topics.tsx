import Link from "next/link";
import type { ReactNode } from "react";

import { CodeBlock } from "../code-block";
import { repoUrl } from "../messaging";

export interface DocsTopic {
  slug: string;
  title: string;
  description: string;
  body: () => ReactNode;
}

const commandGroups: readonly {
  title: string;
  rows: readonly (readonly [string, string])[];
}[] = [
  {
    title: "Transport and song",
    rows: [
      [
        "play · pause",
        "Start or stop the shared transport. Space on an empty prompt does the same.",
      ],
      ["tempo <bpm>", "Set the tempo; playback keeps the musical beat."],
      ["bars <count> · extend <count> bars", "Set or grow the loop length."],
      [
        "track <name>",
        "Focus a track, creating it if needed. A track named drums gets the kit.",
      ],
      [
        "undo · redo",
        "Step through the shared session log. Works from any window.",
      ],
    ],
  },
  {
    title: "Notes and instruments",
    rows: [
      ["add C4 at 0 for 1", "Add a note: pitch, start beat, length in beats."],
      [
        "move note <id> to 2.5 · duration note <id> 0.25",
        "Move or resize a note.",
      ],
      [
        "instrument <name>",
        "sine, piano, pluck, bass, saw, square, triangle, or kit for drums.",
      ],
      ["volume <0..1> · pan <-1..1>", "Track level and equal-power pan."],
      [
        "mute · solo · unsolo",
        "Solo isolates the focused track in every window.",
      ],
      ["clear", "Remove the focused track's notes."],
    ],
  },
  {
    title: "Drums",
    rows: [
      [
        "hit <voice> at <beat> [vel <0..1>]",
        "One hit. Voices: kick, snare, clap, rim, tom, hat, openhat.",
      ],
      [
        "pattern <voice> <beats...>",
        "Up to 64 beats, such as pattern kick 0 1 2 3.",
      ],
      [
        "pattern <voice> every <step> [from <beat>]",
        "Fill the loop on a grid, step 0.125 or more.",
      ],
      ["clear <voice>", "Remove one voice only."],
    ],
  },
  {
    title: "Effects and automation",
    rows: [
      [
        "filter <hz> [res] · filter off",
        "Low-pass filter, 20 to 20000 Hz, resonance 0 to 1.",
      ],
      [
        "delay <beats> [fb] [mix] · delay off",
        "Tempo-synced stereo ping-pong delay, 0.0625 to 4 beats.",
      ],
      [
        "reverb <mix> [size] · reverb off",
        "Stereo reverb send; size defaults to 0.5.",
      ],
      [
        "automate <lane> at <beat> <value>",
        "Lanes: volume, pan, filter, resonance, delay-feedback, delay-mix.",
      ],
      [
        "clear <lane> automation · clear automation",
        "Remove one lane or all of them.",
      ],
    ],
  },
  {
    title: "Slash commands",
    rows: [
      [
        "/tracks · /status",
        "List tracks; show session name, revision, digest and daemon or file mode.",
      ],
      ["/sessions · /resume [n|name|id]", "List sessions or switch to one."],
      [
        "/rename <name> · /rename --auto",
        "Name the session yourself, or hand naming back.",
      ],
      ["/fork [name]", "Branch the song into a new numbered session."],
      [
        "/export <file> · /import <file>",
        "Write or read a track.loop/v1 JSON document.",
      ],
      ["/model opus-5.5|sol-6.1", "Switch the agent's model."],
      [
        "/view focus|all",
        "Show only the focused track, or overlay every track.",
      ],
      ["/theme default|high-contrast|mono · /motion on|off", "Appearance."],
      ["/log", "Open the transcript."],
      [
        "/login [--xcb] · /logout · /auth [--check]",
        "Provider setup from inside the TUI.",
      ],
    ],
  },
];

const keys: readonly (readonly [string, string])[] = [
  ["Space (empty prompt)", "Play or pause"],
  [
    "Enter",
    "Submit; while the agent works, steer the turn in progress. In QUEUE mode, queue it.",
  ],
  ["Shift+Enter, Ctrl+J", "Newline"],
  ["Alt+Enter", "Queue this prompt"],
  ["Ctrl+Q", "Toggle the STEER / QUEUE mode"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
  [
    "Ctrl+O or /log",
    "Transcript: ↑/↓, PgUp/PgDn, Home/End scroll; / cycles all, requests, ops, errors",
  ],
  [
    "Esc",
    "Cancel the agent turn (keeping what was accepted), close the overlay, or clear the draft",
  ],
  ["Ctrl+L", "Full redraw"],
  ["Ctrl+C", "Exit"],
];

function Table({
  head,
  rows,
  code = true,
}: Readonly<{
  head: readonly [string, string];
  rows: readonly (readonly [string, string])[];
  code?: boolean;
}>) {
  return (
    <div className="dawg-table-wrap" tabIndex={0}>
      <table className="dawg-table">
        <thead>
          <tr>
            <th scope="col">{head[0]}</th>
            <th scope="col">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([left, right]) => (
            <tr key={left}>
              <th scope="row">{code ? <code>{left}</code> : left}</th>
              <td>{right}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const docsTopics: readonly DocsTopic[] = [
  {
    slug: "quickstart",
    title: "Quickstart",
    description: "Open a session, make a loop, ask the agent and render a WAV.",
    body: () => (
      <>
        <p>
          <Link href="/docs">Install dawg</Link> first. You need Bun 1.3.14 or
          newer; sound plays through dawg&rsquo;s native sink, or{" "}
          <code>ffplay</code> or SoX where it cannot load.
        </p>
        <h2 id="first-loop">Make a loop</h2>
        <p>Open a terminal in any project folder and run:</p>
        <CodeBlock code="$ dawg" />
        <p>
          dawg creates <code>.dawg/session</code> there and reuses it every time
          you come back. Type commands at the prompt; each one is an edit you
          can undo with Ctrl-Z.
        </p>
        <CodeBlock
          label="dawg prompt"
          copy={false}
          code={[
            "tempo 96",
            "/track drums",
            "pattern kick 0 2.5 4 6.5",
            "pattern snare 1 3 5 7",
            "pattern hat every 0.5",
            "/track bass",
            "instrument bass",
            "add A2 at 0 for 0.75",
            "reverb 0.2",
          ].join("\n")}
        />
        <p>
          Press Space on an empty prompt to play. The highway scrolls the notes
          toward the hit line; the header shows the track, session, tempo,
          revision and sync state.
        </p>
        <h2 id="agent">Ask the agent</h2>
        <p>
          Anything that isn&rsquo;t a command goes to the agent once a provider
          is set up. Run <code>dawg login</code> once (see{" "}
          <Link href="/docs/login">Login and providers</Link>), then just say
          what you want:
        </p>
        <CodeBlock
          label="dawg prompt"
          copy={false}
          code="dusty minor groove at 96, drums and a bass line"
        />
        <p>
          Each accepted tool call shows up as a card in the activity strip with
          its revision, and Ctrl-Z undoes exactly that change. Esc stops the
          turn and keeps what was already accepted.
        </p>
        <h2 id="windows">Open more windows</h2>
        <p>
          Run <code>dawg</code> again in another terminal in the same folder.
          The new window joins the same session and takes the next track nobody
          else has, so each window can play a different instrument while one
          transport keeps them in time. See{" "}
          <Link href="/docs/sessions">Sessions</Link>.
        </p>
        <h2 id="render">Render a WAV</h2>
        <CodeBlock code="$ dawg render out.wav" />
        <p>
          This writes the current session without starting audio. The same score
          always produces the same bytes; the command prints the size and
          sha256.
        </p>
      </>
    ),
  },
  {
    slug: "commands",
    title: "Commands",
    description: "Every prompt command and shell command dawg understands.",
    body: () => (
      <>
        <p>
          Type one command per prompt. Beats are score beats. Anything that
          doesn&rsquo;t parse as a command goes to the agent when a provider is
          configured (<code>DAWG_AI=0</code> turns that off).
        </p>
        {commandGroups.map((group) => (
          <section key={group.title}>
            <h2 id={group.title.toLowerCase().replace(/[^a-z]+/gu, "-")}>
              {group.title}
            </h2>
            <Table head={["Command", "What it does"]} rows={group.rows} />
          </section>
        ))}
        <h2 id="shell">From the shell</h2>
        <CodeBlock
          copy={false}
          code={[
            "dawg [--new] [--session <name|id>] [--track <name>]",
            "dawg --import <file> --export <file>",
            "dawg sessions",
            "dawg render <out.wav> [--session <name|id>] [--import <file>]",
            "dawg login [--gateway|--key|--xcb] [--budget <dollars>]",
            "dawg logout",
            "dawg auth status [--check]",
          ].join("\n")}
        />
        <p>
          Flags: <code>--reduce-motion</code> for static hit and sustain states,{" "}
          <code>--theme default|high-contrast|mono</code>. <code>NO_COLOR</code>{" "}
          forces mono.
        </p>
      </>
    ),
  },
  {
    slug: "keys",
    title: "Keys",
    description:
      "Prompt, transport and transcript keys, plus themes and motion.",
    body: () => (
      <>
        <Table head={["Key", "Action"]} rows={keys} code={false} />
        <p>
          Bracketed paste keeps multiline text intact. A STEER submit runs ahead
          of queued work.
        </p>
        <h2 id="appearance">Themes and motion</h2>
        <p>
          <code>/theme default|high-contrast|mono</code>, <code>--theme</code>{" "}
          or <code>DAWG_THEME</code> pick a theme. Color falls back from
          truecolor to 256, 16 and no color; <code>NO_COLOR</code> and{" "}
          <code>TERM=dumb</code> force monochrome. <code>/motion off</code>,{" "}
          <code>--reduce-motion</code> or <code>DAWG_REDUCE_MOTION=1</code> swap
          animations for static states in the same positions. Every color has a
          non-color cue too: glyph density, <code>✓</code>/<code>✗</code>/
          <code>!</code> prefixes, the mode pill text and <code>▶</code>/
          <code>⏸</code>.
        </p>
      </>
    ),
  },
  {
    slug: "sessions",
    title: "Sessions",
    description: "Windows, the dawgd daemon, names, forks and resuming.",
    body: () => (
      <>
        <h2 id="windows">Many windows, one song</h2>
        <p>
          The first <code>dawg</code> window in a folder starts{" "}
          <code>dawgd</code>, a per-session daemon, in the background. It is the
          only writer: every window sends its edits there, and every accepted
          commit is saved atomically and broadcast to all windows. The daemon
          also owns the transport and the audio player, so play in one window
          plays everywhere and every window draws the same hit line.
        </p>
        <p>
          Each new window without <code>--track</code> claims the first track no
          other window has focused, in score order. Open three terminals on a
          three-track song and each one gets a different instrument. A fourth
          gets a draft track that joins the score on its first edit.{" "}
          <code>--track</code> always wins.
        </p>
        <p>
          A crashed daemon&rsquo;s socket and lock are reclaimed by the next
          window. If <code>dawgd</code> can&rsquo;t start (or{" "}
          <code>DAWG_DAEMON=0</code>), windows fall back to the snapshot under a
          file lock. <code>/status</code> shows which mode a window is in.
        </p>
        <h2 id="names">Names</h2>
        <p>
          A new session starts as <code>untitled</code> and names itself from
          what you play, like <code>dusty basement funk</code>. dawg keeps a
          local musical fingerprint and only asks a model for a name when the
          music actually changed, in the background, and falls back to a local
          name such as <code>96 bpm drums</code> offline.{" "}
          <code>/rename &lt;name&gt;</code> sets your own name and stops
          auto-naming; <code>/rename --auto</code> hands it back.
        </p>
        <h2 id="forks">Forks and resuming</h2>
        <p>
          <code>/fork [name]</code> snapshots the song into a new session with a
          numbered name (<code>night drive</code> → <code>night drive 2</code>)
          and switches this window to it. Undo in a fork steps back past the
          fork point into the parent&rsquo;s history. <code>/sessions</code>{" "}
          lists recent sessions, <code>/resume</code> opens a picker and{" "}
          <code>/resume &lt;n|name|id&gt;</code> switches directly. From the
          shell, <code>dawg sessions</code> prints the list and{" "}
          <code>dawg --session &lt;name|id&gt;</code> attaches to one;{" "}
          <code>dawg --new</code> starts another.
        </p>
        <h2 id="storage">Where it lives</h2>
        <p>
          Session state lives in <code>.dawg/</code> in the folder you ran{" "}
          <code>dawg</code> in. Config lives in <code>~/.config/dawg</code>.
        </p>
      </>
    ),
  },
  {
    slug: "login",
    title: "Login and providers",
    description:
      "Give the agent a model with Vercel AI Gateway or your own subscriptions through xcb.",
    body: () => (
      <>
        <p>
          Typed commands, playback and rendering need no login. The agent needs
          one provider.
        </p>
        <h2 id="gateway">Vercel AI Gateway</h2>
        <CodeBlock code="$ dawg login" />
        <p>
          With the Vercel CLI installed, this signs you in if needed and creates
          an AI Gateway key named <code>dawg-&lt;hostname&gt;</code>;{" "}
          <code>--budget &lt;dollars&gt;</code> sets its spend limit. Without
          the CLI, <code>dawg login --key</code> takes a pasted key with hidden
          input. dawg checks the key and keeps it in the macOS Keychain or a
          0600 file under <code>~/.config/dawg</code>, never in{" "}
          <code>.dawg/</code>. <code>AI_GATEWAY_API_KEY</code> also works.
        </p>
        <p>
          The agent uses <code>opus-5.5</code> or <code>sol-6.1</code>; switch
          with <code>/model</code> or set <code>DAWG_MODEL</code>.
        </p>
        <h2 id="xcb">Your subscriptions through xcb</h2>
        <CodeBlock code="$ dawg login --xcb" />
        <p>
          This uses a Claude, Codex or Devin subscription through{" "}
          <a href="https://xcb.sh">xcb</a>. dawg lists the accounts xcb reports
          as available and saves your pick; in the TUI,{" "}
          <code>/login --xcb</code> opens the same choice as a picker. Replies
          from xcb are parsed as untrusted and every edit goes through the same
          validation as gateway turns.
        </p>
        <h2 id="status">Status and logout</h2>
        <p>
          <code>dawg auth status</code> (or <code>/auth</code>;{" "}
          <code>--check</code> verifies online) shows the provider, a masked key
          and its source, and the audio backend. <code>dawg logout</code>{" "}
          removes the stored key and provider choice.{" "}
          <code>DAWG_PROVIDER=gateway|xcb|auto</code> overrides the saved
          choice.
        </p>
        <p>
          More detail is in the repository&rsquo;s{" "}
          <a href={`${repoUrl}/blob/main/DAWG.md`}>DAWG.md</a>.
        </p>
      </>
    ),
  },
];

export function docsTopic(slug: string): DocsTopic | undefined {
  return docsTopics.find((topic) => topic.slug === slug);
}
