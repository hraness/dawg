# Track

Track is a local-first terminal music workstation with a Pi-like agent loop. Each terminal window can focus on one track while a shared local session keeps the score, transport, and agent operations in sync. It is designed for `track` to feel like a coding agent session where the artifact is a loop you can hear and edit.

The first steel thread includes a typed `track.loop/v1` score, an append-only local session with a cross-window writer lock, a terminal piano-roll projection, a multiline prompt, a bounded streaming tool-calling agent on the Vercel AI Gateway, and a local PCM synthesizer. Provider and audio adapters remain behind explicit ports so the TUI can still be exercised without credentials or a sound device.

## Run

```sh
bun install
bun run track
```

Run `track` from any directory. It creates `.track/session` on first use and reuses that session in later terminal windows. Use `track --new` for a separate composition, `track --session <id>` to attach explicitly, and `track --track bass` to focus a named track. Every window connects to `trackd`, a per-session daemon the first window starts in the background. It is the single writer: windows send operations with a base revision and an idempotency key, duplicate keys are no-ops, stale bases receive a typed rebase diagnostic, and accepted commits are persisted through the same atomic snapshot store before being broadcast to every window. The daemon also owns the only transport and audio player, broadcasting play, pause, seek, and tempo with a timestamp so every window draws the same hit line. It keeps a presence table (`clientId`, `pid`, focused track) and can atomically claim the first unfocused track for a new window. The daemon exits 30 seconds after its last window closes, removes its socket on SIGTERM, and a crashed daemon's socket and lock are reclaimed by the next window. If `trackd` cannot be started (or `TRACK_DAEMON=0`), windows fall back to polling the snapshot under the file lock, with presence kept in per-window heartbeat files. `track sessions` lists sessions in the current workspace.

The `trackd` protocol is newline-delimited JSON over a Unix socket in the session directory, or a hashed path under `$TMPDIR` when that path would exceed the platform socket-path limit. Every frame carries `v: 1`, frames are size-bounded, and every inbound frame is parsed from `unknown`. Clients send `hello`, `apply`, `transport`, `sync`, `focus`, `claim`, and `ping`; the daemon replies with `welcome`, `result`, `snapshot`, `claimed`, `pong`, and typed `error` frames, and pushes `commit`, `transport`, and `presence`.

The header (track · session · ▶/⏸ BPM · model · rev · sync) sits above the highway. The highway sits above the activity strip and the prompt. Notes stream toward the hit line, and velocity sets glyph density (`░▒▓█`) and saturation. Beat and bar rules get stronger at each level. Sustains draw as beams with a decaying tail and a short ghost after release. Each hit runs approach glow → flash/burst at the line → fade. The hit line pulses on the beat, and a sweep marks the loop wrap. Drum tracks use one lane per voice with a legend; lane projection is pluggable (`LaneProjection` in `tui/highway.ts`). Animation is derived from transport time, so frame rate never changes timing. Frames render into a retained cell buffer, only changed rows are written, and output is capped at about 30 fps.

Keys: `Space` (empty prompt) toggles playback. `Enter` submits, or queues in QUEUE mode. `Shift+Enter`/`Ctrl+J` inserts a newline, `Alt+Enter` queues and `Ctrl+Q` toggles STEER/QUEUE. `Ctrl+Z`/`Ctrl+Y` undo and redo, and `Ctrl+O` or `/log` opens the transcript. `Esc` cancels an agent turn, closes the overlay or clears the draft. `Ctrl+L` redraws and `Ctrl+C` exits. Bracketed paste keeps multiline text intact.

Themes: `/theme default|high-contrast|mono`, `--theme`, `TRACK_THEME`. Color falls back through truecolor, 256-color, 16-color and monochrome. `NO_COLOR` and `TERM=dumb` are supported. `/motion off`, `--reduce-motion` and `TRACK_REDUCE_MOTION=1` switch to static states in the same positions.

Other code reports into the activity strip through `ActivityFeed` (`tui/activity.ts`): `pushCard(text, {tone, baseRevision, resultRevision, hint})`, `pushError(text)`, `setSpinner(label | undefined)`, `setQueueDepth(n)` and `applyAgentEvent(event)`, which accepts the agent's streaming `AgentEvent`s unchanged.

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
automate pan at 0 -1
automate pan at 4 1
clear pan automation
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
/tracks
/export loop.track.json
/import loop.track.json
/model opus-5.5
```

Drum tracks use the `kit` instrument (a track named `drums` gets it automatically). Notes on a kit track keep the score's MIDI pitch field, using General MIDI percussion numbers (kick 36, rim 37, snare 38, clap 39, closed hat 42, tom 45, open hat 46), so drum hits round-trip through `track.loop/v1` unchanged and the highway draws them in one lane per voice. Grammar, one command per prompt, beats in score beats:

```text
hit <voice> [at] <beat> [vel <0..1>]
pattern <voice> <beat> [<beat> ...] [vel <0..1>]        up to 64 beats
pattern <voice> every <step> [from <beat>] [vel <0..1>]  step >= 0.125, fills the loop, at most 256 hits
clear <voice>
filter <cutoff 20..20000> [<resonance 0..1>] | filter off
delay <beats 0.0625..4> [<feedback 0..0.9> [<mix 0..1>]] | delay off
automate filter at <beat> <cutoff> | clear filter automation
solo | unsolo
undo | redo
```

Effects live on the track as optional `filter {cutoff, resonance}`, `delay {beats, feedback, mix}`, `filterAutomation`, and `solo` fields. Documents written before these fields existed still parse; out-of-range or non-finite values are rejected. Undo and redo append ordinary session events, so history is shared by every window and a new edit clears the redo stack.

Set `TRACK_AI=1` to send unrecognized prompts to the Vercel AI Gateway. The key stays local in `AI_GATEWAY_API_KEY`; `TRACK_MODEL=opus-5.5` or `TRACK_MODEL=sol-6.1` selects the initial friendly model label, and `/model opus-5.5` or `/model sol-6.1` switches it during a session. `TRACK_OPUS_MODEL` / `TRACK_SOL_MODEL` can map those labels to the provider IDs available in the account. By default the labels map to `anthropic/claude-opus-5.5` and `openai/gpt-6.1-sol`. Both IDs were checked against `GET https://ai-gateway.vercel.sh/v1/models` and are tagged `tool-use`. Labels outside the allowlist are rejected before any request is sent.

### Agent turns

A turn calls `POST /v1/chat/completions` with `stream: true` and one JSON-schema tool for each operation family. The OpenAI-compatible SSE stream is parsed locally with `fetch`, so the agent adds no runtime dependency. Each request sends a compact, deterministic **composition brief** instead of raw logs. It contains revision, tempo, meter, bars, key, tracks with instrument, mix, note count and pitch range, the focused track's notes, recent accepted operations and the instrument list. It is capped at 12 KiB and never includes environment values.

When a tool call finishes streaming, it passes three checks: the tool's own argument checks, the planner's bounded operation validator, and a dry run of the score reducer. Only then is it committed through the session as a separate revision pinned to the revision it was planned against. If the call fails a check, or another window committed first (stale revision), Track rejects it without changing the score. The model receives the diagnostic as the tool result and can correct itself. A turn is bounded to 8 steps, 32 tool calls, 256 KiB of streamed response and a 90 s timeout.

`runAgentTurn` (`src/agent/agent.ts`) emits structured progress events for the TUI: `step`, `text-delta`, `tool-start`, `tool-applied` (with `summary`, `baseRevision`, `resultRevision` and `trackId`), `tool-rejected` (with `diagnostic`), and a final `done` or `error` (`aborted`, `timeout`, `budget`, `provider`). To add an operation family, append a tool to `AGENT_TOOLS` in `src/agent/tools.ts`. The schema, dispatch and validation all come from that one entry.

Playback renders the score to a short mono PCM WAV with deterministic sine, piano, pluck, bass, saw, square, and triangle voices and a synthesized kit whose noise comes from a PRNG seeded by each note, so every render is byte-identical. Track volume and pan automation, the low-pass filter (with its cutoff lane), and the delay send are applied before mixing; mute always silences a track and any solo silences unsoloed tracks. Pan lanes use -1 to 1 and are rendered with deterministic mono centre compensation. With `trackd` running only the daemon plays audio; on the file-lock fallback a per-session audio lock keeps multiple TUI windows from starting duplicate voices. The renderer is deterministic and independently testable; a native or sample-backed instrument backend can replace it behind the same player port.
Set `TRACK_AUDIO=0` for headless sessions.

Use `TRACK_DEMO=1 bun run src/main.ts` for a deterministic non-interactive frame stream while developing the renderer.
