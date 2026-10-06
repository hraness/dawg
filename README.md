# Track

Track is a local-first terminal music workstation with an agent-driven piano roll. Run `track` in a project directory, open it in more than one terminal window, and each window can focus on a different track in the same composition.

The highway sits above a multiline prompt. Notes stream toward a hit line, sustains stretch across beats, and transport controls stay live while you ask the agent to add or reshape music. The session is stored locally in `.track`, so there is no account, login, hosted session, or required service for the core workflow.

## Install

Track requires [Bun](https://bun.sh) 1.3.14 or newer.

```sh
git clone https://github.com/hraness/track.git
cd track
bun install --frozen-lockfile
bun run track
```

Running `track` creates `.track/session` when needed and attaches to that session on later launches. Use `track --new` for a new composition, `track --session <id>` to attach explicitly, or `track --track bass` to focus a named track.

## Use

The first steel thread understands direct requests:

```text
add C4 at 0 for 1
play
pause
tempo 128
instrument piano
volume 0.7
pan -0.4
automate volume at 0 0.2
automate volume at 4 1
automate pan at 0 -1
automate pan at 4 1
track drums
instrument kit
hit kick at 0
hit snare at 1 vel 0.7
pattern kick 0 1 2 3
pattern hat every 0.5 from 0.25
clear hat
filter 1200
filter 800 0.6
filter off
delay 0.375 0.3
delay 0.75 0.4 0.5
delay off
automate filter at 0 400
automate filter at 4 6000
clear filter automation
bars 8
extend 4 bars
clear automation
mute
solo
unsolo
clear
undo
redo
move note <id> to 2.5
duration note <id> 0.25
/export loop.track.json
/import loop.track.json
/model opus-5.5
```

A track named `drums` (or `kit`) starts with the `kit` instrument; `instrument kit` turns any track into a drum track. Drum voices are `kick` (`bd`), `snare` (`sd`), `clap` (`cp`), `rim` (`perc`), `tom`, `hat` (`hh`), and `openhat` (`oh`); the highway shows one lane per voice. `pattern <voice> <beats...>` takes up to 64 beats, `pattern <voice> every <step>` (step ≥ 0.125) fills the loop, `vel <0..1>` sets velocity, and `clear <voice>` removes only that voice. `filter <hz> [resonance]` is a per-track low-pass (20–20000 Hz, resonance 0–1), `delay <beats> [feedback] [mix]` is a tempo-synced echo send (0.0625–4 beats, feedback ≤ 0.9, mix 0–1), and `automate filter at <beat> <hz>` writes the cutoff lane. `solo` isolates the focused track in playback across every window; `redo` re-applies the last undone edit.

The screen has four parts. A one-line header shows track · session · ▶/⏸ BPM · key · model · revision · sync state. The highway streams notes toward the hit line, with a stable accent per track. Below it, an activity strip shows operation cards (`✓ +8 bass notes · rev 41→42 · ^z undo`), queue depth, a braille spinner while the agent works, and errors in red with an `✗` prefix. The prompt panel is filled with a background color. It wraps by grapheme, grows from 1 to 8 rows (capped at 30% of the screen, then scrolls internally) and keeps the draft when the terminal is resized. Narrow terminals collapse the header and hints, and below 24×8 the screen shows a resize hint.

| Key                  | Action                                                       |
| -------------------- | ------------------------------------------------------------ |
| Space (empty prompt) | play / pause                                                 |
| Enter                | submit (STEER) or queue (QUEUE mode)                         |
| Shift+Enter, Ctrl+J  | newline                                                      |
| Alt+Enter            | queue this prompt                                            |
| Ctrl+Q               | toggle the STEER / QUEUE mode pill                           |
| Ctrl+Z / Ctrl+Y      | undo / redo                                                  |
| Ctrl+O or `/log`     | transcript overlay (requests, ops, revisions, errors)        |
| Esc                  | cancel the agent turn, close the overlay, or clear the draft |
| Ctrl+L               | full redraw                                                  |
| Ctrl+C               | exit                                                         |

A STEER submit runs ahead of queued work. Bracketed paste preserves multiline input.

`/theme default|high-contrast|mono` and `--theme <name>` (or `TRACK_THEME`) pick a theme. Semantic color tokens map to truecolor, 256, 16 or no color. `NO_COLOR` and `TERM=dumb` force monochrome. `/motion off`, `--reduce-motion` or `TRACK_REDUCE_MOTION=1` replace animations with static states in the same positions. Every color has a non-color cue as well: glyph density, `✓`/`✗`/`!` prefixes, the mode pill text and `▶`/`⏸`.

## Auth

Run `track login` once to give the agent a model. With the Vercel CLI it signs you in (if needed) and creates an AI Gateway key named `track-<hostname>`; `--budget <dollars>` sets its spend limit. Without the CLI it prints `bun add -g vercel` and lets you paste a key instead (`track login --key`, hidden input, Enter opens the key page).

- `track login --xcb` uses a Claude, Codex or Devin subscription through [xcb](https://github.com/hraness/xcb) (`curl -fsSL https://xcb.sh/install.sh | sh`). It lists the accounts that `xcb --json generate --capabilities` reports as available and saves your pick. An account only appears after xcb's [application qualification](https://github.com/hraness/xcb/blob/main/docs/application-api.md); if none qualify, the command prints the read-only `xcb --json qualify-application --inspect` line for each connected account.
- `track auth status` (or `/auth` in the TUI; `--check` verifies the key online) shows the provider, a masked key such as `vck_…abcd` and its source. `track logout` removes the stored key and the provider choice. `/login` works in the TUI too; flows that need hidden input or a browser tell you to use a shell.
- Keys go to the macOS Keychain (service `track`, account `ai-gateway`, passed to `security -i` on stdin so the key never appears in a process list) or to `~/.config/track/credentials.json` (0600, directory 0700). They are never written to `.track/`. `AI_GATEWAY_API_KEY` in the environment always wins. `TRACK_CREDENTIAL_STORE=file` skips the Keychain and `TRACK_CONFIG_DIR` moves the config directory.
- `TRACK_PROVIDER=gateway|xcb|auto` overrides the saved choice. `auto` (the default) uses the gateway when a key exists, then an available xcb account, otherwise direct commands only with a hint to run `track login`. `TRACK_AI=0` turns the agent off. The header shows the active provider, for example `opus-5.5 · gateway` or `devin/swe-2-high · xcb`.

On the gateway, unrecognized requests go to a streaming, tool-calling agent. Choose `TRACK_MODEL=opus-5.5` or `TRACK_MODEL=sol-6.1`, or switch with `/model`. By default these labels map to `anthropic/claude-opus-5.5` and `openai/gpt-6.1-sol` from the gateway catalog. Override them with `TRACK_OPUS_MODEL` and `TRACK_SOL_MODEL`. Other labels are rejected. xcb has no tool calling, so Track asks for one JSON object of ops per call and runs each op through the same checks; it retries with diagnostics up to 3 calls per turn.

The agent edits the score only through typed tools: `add_notes`, `add_drums`, `remove_notes`, `update_notes`, `set_instrument`, `set_mix` (with solo), `set_effects` (filter and delay), `set_automation` (volume, pan and filter), `extend_loop`, `set_tempo`, `create_track`, `transport` and `explain`. Each call is validated, then committed as its own revision, and the status line shows its result (for example `✓ +8 bass notes`). While the agent is working, Esc cancels and keeps every change accepted so far. Enter sends a steering message that the agent reads at its next step. A queued submit (Ctrl+Q queue mode) waits until the turn ends.

Playback renders a short mono PCM WAV with deterministic sine, piano, pluck, bass, saw, square, and triangle voices plus a synthesized drum kit (pitch-swept sine kick, seeded-noise snare and hats), applies per-track volume, pan, low-pass filter, and delay, honors mute and solo, and uses `afplay` on macOS or `ffplay` elsewhere. Pan values run from -1 (left) to 1 (right); the current mono export uses centre compensation so automation remains audible and deterministic. Set `TRACK_AUDIO=0` for a headless session. `track --export file.track.json` and `track --import file.track.json` exchange the bounded `track.loop/v1` document. `TRACK_DEMO=1 bun run src/main.ts` prints a deterministic renderer frame for development.

## Architecture

- `core/` defines the bounded immutable `track.loop/v1` score and operations.
- `src/session/` provides an append-only local event log, atomic snapshots, and `trackd`: one local daemon per session (`src/daemon.ts`), started automatically by the first window. Windows connect over a Unix socket, send idempotent intents, and receive accepted changes, presence, and one shared transport clock. If the daemon cannot start, windows fall back to the file-lock path and say so in the status line. `track sessions` lists the workspace's sessions with revision, update time, and live daemon.
- `src/agent/` runs the bounded streaming tool-calling agent: the SSE gateway client, the tool registry, the composition brief, and operation validation.
- `src/audio/` owns the transport clock, deterministic instrument-bank WAV rendering, and per-session playback lock. When `trackd` is running it is the only process that plays audio.
- `tui/` owns terminal capability detection, semantic colors, animation phases, piano-roll rendering, and the multiline prompt editor.

The runtime is intentionally adapter-shaped. The local synthesizer is deterministic and works without a sound device; native or sample-backed players can replace it behind the same score boundary.

See [TRACK.md](./TRACK.md) for the detailed command and interaction contract.

## Development

```sh
bun install --frozen-lockfile
bun run check
```

Track is MIT licensed. Contributions should preserve bounded inputs, deterministic score operations, local session safety, and a working terminal fallback when color or animation is unavailable.
