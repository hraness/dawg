# dawg

dawg is a free, MIT-licensed, local-first music workstation for the terminal, built on Bun. You type at a prompt; direct commands edit the score and anything else goes to an agent that edits through typed, validated tools. The loop scrolls on a piano-roll highway above the prompt. This file records the positioning the dawg.sh site carries.

## Platform

- Repository: [hraness/dawg](https://github.com/hraness/dawg), MIT.
- CLI: `dawg`. Package: `@hraness/dawg`, distributed as a GitHub Release tarball with `SHA256SUMS` and a build provenance attestation, and published to npm (`npm i -g @hraness/dawg`, `bun add -g @hraness/dawg`).
- Runtime: Bun 1.3.14 or newer. The CLI has no runtime dependencies.
- Site: [dawg.sh](https://dawg.sh), this `site/` directory, deployed by Vercel project `dawg` with root directory `site/`.

## Users

- Developers who live in a terminal and want to sketch music without leaving it.
- People who already pay for a Claude, Codex or Devin subscription and want to point it at something fun.
- Agent tinkerers who want to see a tool-calling agent edit a structured document they can hear.

## Positioning

The hook, used in the site title, hero and share card:

- “A DAW in your terminal, dawg.”

The short line, used under the hook and in package descriptions:

- “Chat with an agent to build loops on a piano roll that scrolls above your prompt.”

The four pillars, in order:

1. **Ask for a groove.** Chat-to-compose. A streaming agent edits the score only through typed tools; each call is checked three times and committed as its own revision you can undo.
2. **Watch it on the highway.** The piano roll scrolls toward a hit line above a live prompt, with a lane per drum voice and sustains stretched across beats.
3. **Open a window, get a player.** Every window on a session shares one song and one transport through `dawgd`; each new window claims the next instrument, so N windows bring back the whole band.
4. **Local first, your own models.** The session is a folder in your project. Commands, playback and rendering need no account. The agent runs on a Vercel AI Gateway key or on your own subscription through xcb.

Category label: “Terminal music workstation.”

## Capabilities the site may claim

Only what `README.md`, `DAWG.md` and `CHANGELOG.md` on `main` describe:

- Instruments sine, piano, pluck, bass, saw, square, triangle and a synthesized drum kit (kick, snare, clap, rim, tom, hat, openhat).
- Per-track volume, pan, mute, solo, low-pass filter, ping-pong stereo delay, Freeverb-style reverb, and automation lanes for volume, pan, filter cutoff, resonance, delay feedback and delay mix.
- Gapless playback through a native audio sink (prebuilt for macOS and Linux, arm64 and x64), with `ffplay`, SoX `play` or `afplay` as fallbacks.
- Undo and redo from the shared session log.
- `dawgd`: one daemon per session, shared transport, crash recovery, file-lock fallback.
- Auto-claim of the next instrument per window; draft track beyond the last.
- Named sessions, `/rename`, numbered `/fork`, `/sessions`, `/resume`, auto-naming from a local fingerprint.
- `dawg login` (gateway key through the Vercel CLI or pasted), `dawg login --xcb`, `dawg auth status`, `dawg logout`. Models `opus-5.5` and `sol-6.1`.
- Themes default, high-contrast and mono; reduced motion; `NO_COLOR`.
- `dawg render out.wav`, byte-identical across runs.

## Constraints

- Install lines, in order: the dawg.sh script, then `npm i -g @hraness/dawg` / `bun add -g @hraness/dawg`, then the release tarball.
- Until a GitHub Release exists, the install script exits with “the first release of dawg is coming soon” and the site shows the source install instead of a tarball link.
- No MIDI, plugin, DAW-export or sample claims; dawg has none of them.
- No comparison table against other music tools until it can be sourced; dawg's terminal-and-agent combination has no like-for-like peer worth a table.

## Brand commitments

- The hero demo is real: frames from dawg's own renderer and score operations, recorded with a fake clock by `scripts/record-demo.ts`. Regenerate it when the TUI changes (`bun run demo`); `bun run check` fails when the recording is stale.
- Analytics are cookieless PostHog in the shared Hraness project (543691) with `site_id: "dawg"`. Copy events never send copied text.
