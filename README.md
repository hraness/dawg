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

Press Space on an empty prompt to toggle playback. Enter submits a request. Ctrl+Q switches to queue mode so prompts run in order; a normal submit steers ahead of queued work. Shift+Enter or Alt+Enter inserts a newline. Bracketed paste preserves multiline input. Ctrl+C exits.

Set `TRACK_AI=1` to send unrecognized requests to the Vercel AI Gateway. Keep the key local in `AI_GATEWAY_API_KEY`. Choose the friendly model label with `TRACK_MODEL=opus-5.5` or `TRACK_MODEL=sol-6.1`, or switch it with `/model`. Map those labels to the model IDs available in your gateway account with `TRACK_OPUS_MODEL` and `TRACK_SOL_MODEL`.

Playback renders a short mono PCM WAV with deterministic sine, piano, pluck, bass, saw, square, and triangle voices plus a synthesized drum kit (pitch-swept sine kick, seeded-noise snare and hats), applies per-track volume, pan, low-pass filter, and delay, honors mute and solo, and uses `afplay` on macOS or `ffplay` elsewhere. Pan values run from -1 (left) to 1 (right); the current mono export uses centre compensation so automation remains audible and deterministic. Set `TRACK_AUDIO=0` for a headless session. `track --export file.track.json` and `track --import file.track.json` exchange the bounded `track.loop/v1` document. `TRACK_DEMO=1 bun run src/main.ts` prints a deterministic renderer frame for development.

## Architecture

- `core/` defines the bounded immutable `track.loop/v1` score and operations.
- `src/session/` provides an append-only local event log, atomic snapshots, and cross-window writer conflict handling.
- `src/agent/` validates operation plans and speaks the Vercel AI Gateway protocol.
- `src/audio/` owns the transport clock, deterministic instrument-bank WAV rendering, and per-session playback lock.
- `tui/` owns terminal capability detection, semantic colors, animation phases, piano-roll rendering, and the multiline prompt editor.

The runtime is intentionally adapter-shaped. The local synthesizer is deterministic and works without a sound device; native or sample-backed players can replace it behind the same score boundary.

See [TRACK.md](./TRACK.md) for the detailed command and interaction contract.

## Development

```sh
bun install --frozen-lockfile
bun run check
```

Track is MIT licensed. Contributions should preserve bounded inputs, deterministic score operations, local session safety, and a working terminal fallback when color or animation is unavailable.
