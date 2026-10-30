# dawg

dawg is a free, MIT-licensed song studio with an agent, a terminal player and chat. Describe a song, watch its tracks take shape and listen while the agent works. The default tracks overview gives way to a horizontal piano roll for the track being written; Ctrl-P pins inspection. This file records the positioning the dawg.sh site carries, following the repository's approved PRODUCT.md and README.

## Platform

- Repository: [hraness/dawg](https://github.com/hraness/dawg), MIT.
- CLI: `dawg`. Package: `@hraness/dawg`, distributed as a GitHub Release tarball with `SHA256SUMS` and a build provenance attestation, and published to npm (`npm i -g @hraness/dawg`, `bun add -g @hraness/dawg`).
- Runtime: Bun 1.3.14 or newer. Saved-song playback stays local; new stock singing and reference analysis need their configured optional tools and models.
- Site: [dawg.sh](https://dawg.sh), this `site/` directory, deployed by Vercel project `dawg` with root directory `site/`.

## Users

- Developers who live in a terminal and want to sketch music without leaving it.
- People who already pay for a Claude or ChatGPT/Codex subscription, or have an OpenRouter or AI Gateway key, and want to point it at something fun.
- Agent tinkerers who want to see a tool-calling agent edit a structured document they can hear.

## Positioning

dawg starts with song generation, listening and steering. A ready musical draft starts automatically; a person's later pause or seek stays in control. Bundled workflows cover house hyperpop originals, reference study and source recreation with stock British bf_emma vocals. Songs, vocal takes and resumable progress stay in the project. Keyboard recording, knobs, patches and command receipts are optional advanced tools.

The hook, used in the site title, hero and share card:

- “Make music in your terminal, dawg.”

The short line, used under the hook and in package descriptions:

- “Generate songs with an agent, then listen and steer from a terminal player and chat.”

The existing advanced-control captures remain optional:

1. **Play it with your keyboard.** `/play` opens keyboard recording; Ctrl-P pins track inspection in the normal player.
2. **Shape it with four knobs.** Optional sound controls retain the four colored knobs; ↑↓ picks one, ←→ turns it.
3. **Patch your own sounds.** `/patch` joins oscillators, filters and envelopes with cables; eight built-in patches, whose first four macros are the knobs.
4. **Inspect agent commands.** `/showme on` reveals command receipts; normal chat focuses on musical progress and undoable changes.

Then a "goes deep" list, one line each: styles, presets, TAPE, history and comments, stems and samples, your coding agent on the TypeScript files, panes, WAV and MIDI. Items merged after the latest release carry a `since` version in `app/page.tsx` and stay hidden until a GitHub Release reaches it.

Copy is warm and plain. No jargon on the first screen: "DAW", "SDK" and "revision" wait until the docs.

Category label: “Song studio for your terminal.”

## Capabilities the site may claim

Only what `README.md`, `DAWG.md` and `CHANGELOG.md` on `main` describe:

- Instruments sine, piano, pluck, bass, saw, square, triangle and a synthesized drum kit (kick, snare, clap, rim, tom, hat, openhat).
- Six editable original hyperpop demos. Saved scores/assets render repeatably; fresh voice inference is not promised to produce identical bytes.
- Per-track volume, pan, mute, solo, low-pass filter, ping-pong stereo delay, Freeverb-style reverb, and automation lanes for volume, pan, filter cutoff, resonance, delay feedback and delay mix.
- Gapless playback through a native audio sink (prebuilt for macOS and Linux, arm64 and x64), with `ffplay`, SoX `play` or `afplay` as fallbacks.
- Undo and redo from the shared session log.
- `dawgd`: one daemon per session, shared transport, crash recovery, file-lock fallback.
- Auto-claim of the next instrument per window; draft track beyond the last.
- Named sessions, `/rename`, numbered `/fork`, `/sessions`, `/resume`, auto-naming from a local fingerprint.
- `dawg model key` (AI Gateway, OpenRouter, or a Claude or ChatGPT/Codex subscription through xcb), `dawg model`, `dawg auth status`, `dawg logout`. Default model `opus-5.5`.
- More than 150 presets (`/presets`), `/comment` and `/history`, and `chop`, once a release includes them (0.10.0).
- Patches (`/patch`): modular instruments and effects built from nodes and cables, with four macro knobs and eight built-ins.
- Ctrl-T opens the tracks overview. Optional `/tape`, `/play`, patch editing and show-me command receipts preserve advanced controls.
- Strudel-format sample packs (`/pack add`), read from the documented manifest format without Strudel code.
- Themes default, high-contrast and mono; reduced motion; `NO_COLOR`.
- `dawg render out.wav`, byte-identical across runs.

## Constraints

- Install lines, in order: the dawg.sh script, then `npm i -g @hraness/dawg` / `bun add -g @hraness/dawg`, then the release tarball.
- Until a GitHub Release exists, the install script exits with “the first release of dawg is coming soon” and the site shows the source install instead of a tarball link.
- No live MIDI, plugin or DAW-project-export claims; dawg writes WAV and MIDI files only.
- Comparisons live on their own pages (`/vs/strudel`), cite the other tool's own docs, say where it is better, and never disparage.

## Brand commitments

- Every screen on the site is real: `test/screens/capture.ts` drives the real `dawg` in a PTY on seeded projects and commits cell grids to `docs/screens/*.json`, rendered as selectable text. Regenerate with `bun run screens`; `bun run check` fails when a screen is stale.
- Analytics are cookieless PostHog in the shared Hraness project (543691) with `site_id: "dawg"`. Copy events never send copied text.
