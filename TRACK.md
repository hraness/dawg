# Track

Track is a local-first terminal music workstation with a Pi-like agent loop. Each terminal window can focus on one track while a shared local session keeps the score, transport, and agent operations in sync. It is designed for `track` to feel like a coding agent session where the artifact is a loop you can hear and edit.

The first steel thread includes a typed `track.loop/v1` score, an append-only local session with a cross-window writer lock, a terminal piano-roll projection, a multiline prompt, a bounded Vercel AI Gateway planner, and a local PCM synthesizer. Provider and audio adapters remain behind explicit ports so the TUI can still be exercised without credentials or a sound device.

## Run

```sh
bun install
bun run track
```

Run `track` from any directory. It creates `.track/session` on first use and reuses that session in later terminal windows. Use `track --new` for a separate composition, `track --session <id>` to attach explicitly, and `track --track bass` to focus a named track. Every window reads the same snapshot; score writes are locked and stale writers retry against the latest revision.

The highway sits above the prompt. Notes stream toward the hit line, sustain bars show duration, hit flashes follow transport time, and the prompt grows for wrapped multiline input. `Space` toggles playback, `Enter` submits, `Ctrl+Q` switches to queue mode, modified Enter sequences (`Shift+Enter` or `Alt+Enter`, depending on the terminal) insert a newline, bracketed paste keeps multiline text intact, and `Ctrl+C` exits. Color falls back through truecolor, 256-color, 16-color, and monochrome; `NO_COLOR` and `TERM=dumb` are supported.

The local command path understands requests such as:

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
clear automation
mute
clear
undo
move note <id> to 2.5
duration note <id> 0.25
/tracks
/export loop.track.json
/import loop.track.json
/model opus-5.5
```

Set `TRACK_AI=1` to send unrecognized prompts to the Vercel AI Gateway. The key stays local in `AI_GATEWAY_API_KEY`; `TRACK_MODEL=opus-5.5` or `TRACK_MODEL=sol-6.1` selects the initial friendly model label, and `/model opus-5.5` or `/model sol-6.1` switches it during a session. `TRACK_OPUS_MODEL` / `TRACK_SOL_MODEL` can map those labels to the provider IDs available in the account. The model must return a bounded JSON operation plan, which is validated before it can touch the score.

Playback renders the score to a short mono PCM WAV with deterministic sine, piano, pluck, bass, saw, square, and triangle voices. Track volume and pan are applied before mixing. A per-session audio lock keeps multiple TUI windows from starting duplicate voices. The renderer is deterministic and independently testable; a native or sample-backed instrument backend can replace it behind the same player port.
Set `TRACK_AUDIO=0` for headless sessions.

Use `TRACK_DEMO=1 bun run src/main.ts` for a deterministic non-interactive frame stream while developing the renderer.
