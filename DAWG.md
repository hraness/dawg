# dawg

dawg is a local-first terminal music workstation with a Pi-like agent loop. Each terminal window can focus on one track while a shared local session keeps the score, transport, and agent operations in sync. It is designed for `dawg` to feel like a coding agent session where the artifact is a loop you can hear and edit.

The first steel thread includes a typed `track.loop/v1` score, an append-only local session with a cross-window writer lock, a terminal piano-roll projection, a multiline prompt, a bounded streaming tool-calling agent on the Vercel AI Gateway, and a local PCM synthesizer. Provider and audio adapters remain behind explicit ports so the TUI can still be exercised without credentials or a sound device.

## Run

```sh
bun install
bun run dawg
```

Run `dawg` from any directory. It creates `.dawg/session` on first use and reuses that session in later terminal windows. Use `dawg --new` for a separate composition, `dawg --session <name|id>` to attach explicitly (an unknown value is `no session named "…" · dawg sessions`, never a new session), and `dawg --track bass` to focus a named track. `dawg --version` prints the version; unknown subcommands and options are rejected with usage before `.dawg/` exists, and the launch that creates `.dawg/` says `created .dawg/ · add it to .gitignore` in the strip. Every window connects to `dawgd`, a per-session daemon the first window starts in the background. It is the single writer: windows send operations with a base revision and an idempotency key, duplicate keys are no-ops, a stale full composition receives a typed rebase diagnostic, and a stale `operations` intent (what the agent sends) is replayed on the current score when nothing it touches changed since its base (the notes it updates or removes, the tracks it rewrites or clears, tempo and length, and ids it creates; at most 64 revisions back, with the base recovered from the event log's `before`); anything else still gets the rebase diagnostic. Rebased events record `rebasedFrom` and the score they replayed on as `before`, so undo drops only that change, and on the file fallback the agent commits the full composition with the strict base check. Accepted commits are persisted through the same atomic snapshot store before being broadcast to every window. The daemon also owns the only transport and audio player, broadcasting play, pause, seek, and tempo with a timestamp so every window draws the same hit line. It keeps a presence table (`clientId`, `pid`, focused track) and can atomically claim the first unfocused track for a new window. The daemon exits 30 seconds after its last window closes, removes its socket on SIGTERM, and a crashed daemon's socket and lock are reclaimed by the next window. If `dawgd` cannot be started (or `DAWG_DAEMON=0`), windows fall back to the snapshot under the file lock, watching the session directory with `fs.watch` (so renames and edits from other windows arrive immediately) with a 1 s backstop poll, or a 200 ms poll where watching is unavailable, with presence kept in per-window heartbeat files. `dawg sessions` lists sessions in the current workspace. `dawg render <out.wav> [--session <name|id>] [--import <file>]` reads the session record from disk (no daemon, no audio) and writes a stereo 16-bit WAV through the playback renderer; the same score always yields the same bytes, and the command prints the size and sha256. `/status` reports `status · <name> · rev <n> · <digest> · shared via dawgd` (or `saved locally · no daemon`), where the digest is the 16-hex composition digest dawgd broadcasts. In demo mode a drum track is seeded with a one-bar kick, snare and hat groove instead of melodic notes.

### Sessions, names and forks

Each session record carries bounded metadata alongside the score: `name` (1–40 printable characters), `nameSource` (`auto` or `user`), an optional `forkOf {sessionId, revision}`, the fingerprint the current auto-name was computed from, and a `version` counter. Records written before metadata existed load with an id-based auto name. Metadata writes are conditional (`expect {name?, nameSource?}`) and never touch the score revision or event log. Through `dawgd` they are a `meta` frame that the daemon applies, persists atomically and broadcasts; on the file fallback they run under the session lock, and polling windows pick up the newer `meta.version`. `/rename <name>` is unconditional and sets `nameSource=user`, so it wins over any auto-name computed against the old name, which arrives `stale` and is dropped. `/rename --auto` sets `nameSource=auto` and clears the stored fingerprint.

`/fork [name]` writes a new session with a snapshot of the composition at the current revision (not the event log), `forkOf` lineage and a numbered name: strip a trailing ` N` (N ≥ 2) from the parent, then take one more than the highest ` N` among sessions with that base. An explicit name that collides is suffixed the same way. The workspace pointer moves to the fork, so plain `dawg` resumes it. Undo does not stop at the fork point: the fork's history is its own events preceded by each ancestor's events up to the revision it was forked at, following `forkOf` at most 8 levels (stopping at cycles, missing parents or revisions beyond the parent's log) and keeping at most the store's event cap.

On launch, and after `/fork` or `/resume`, a window without `--track` sends an atomic `claim {draft: true}`. dawgd serializes claims on its event loop; the file fallback serializes them under the presence lock. The reply is the first track in score order that no live window has focused, or, when every track is taken, a fresh `track-N` id that is neither in the score nor focused by another window. A draft is only appended to the score (`track.attach`) on the window's first edit. `--session <name|id>` resolves an exact id, then an exact case-insensitive name, then a unique id prefix of at least four characters; ambiguous names list the candidates and exit.

The header shows the session name and, when more than one window is open, the window count. Renames, forks, claims and the all-tracks-open hint appear as activity cards. The session port exposes a structured sync status (`synced`, `syncing`, `conflict`, `offline`, `local`) that drives the header directly.

Auto-naming (`src/session/naming.ts`) is gated on a local musical fingerprint: tempo, a scale-fit key estimate from the pitch-class histogram (tonic and fifth weighted), sorted instrument families, register and density buckets, and effects, hashed into an order- and id-independent digest. After an accepted turn the namer waits for a quiet period, and skips the model when the fingerprint equals the one the current name came from or when fewer than three turns have passed since the last name (a structure change, such as a new instrument family, bypasses the turn gate). The prompt is one fingerprint line, the last two prompts truncated to 60 characters each, and the current name, with `max_tokens: 12`. The reply is untrusted: it is stripped to 2–4 lowercase words of at most 32 characters, and a reply equal to the current name keeps it (hysteresis). The write is conditional on the name and `nameSource` the request started from, and a newer request supersedes an older one, so a slow provider (xcb takes about 7 s) can never overwrite a user rename. Forks keep their ` N` suffix through auto-renames, and a name already used by another session is suffixed. The generator is an injectable `NameGenerator`; the default calls `generateText` from `src/agent/provider.ts` and falls back to the deterministic local name.

The `dawgd` protocol is newline-delimited JSON over a Unix socket in the session directory, or a hashed path under `$TMPDIR` when that path would exceed the platform socket-path limit. Every frame carries `v: 1`, frames are size-bounded, and every inbound frame is parsed from `unknown`. Clients send `hello`, `apply`, `transport`, `sync`, `focus`, `claim`, `meta`, and `ping`; the daemon replies with `welcome`, `result`, `snapshot`, `claimed`, `pong`, and typed `error` frames, and pushes `commit`, `transport`, `presence`, and `meta`.

The header (`dawg` · track · ▶/⏸ BPM · key · session · N windows, then model · rev · sync on the right; `test/tui.test.ts` freezes the order) sits above the highway. The highway sits above the activity strip and the prompt. Notes stream toward the hit line, and velocity sets glyph density (`░▒▓█`) and saturation. Beat and bar rules get stronger at each level. Sustains draw as beams with a decaying tail and a short ghost after release. Each hit runs approach glow → flash/burst at the line → fade. The hit line pulses on the beat, and a sweep marks the loop wrap. A track with no hits draws `<track> · empty · add C4 at 0 to start` (or `hit kick at 0` on a kit) in place of bar numbers and lane labels; the hit line stays. Drum tracks use one lane per voice with a legend; lane projection is pluggable (`LaneProjection` in `tui/highway.ts`). By default every unmuted track is overlaid through its own projection and accent, the focused track drawn on top at full strength and the others dimmed; `/view focus` restores the single-track view. Animation is derived from transport time, so frame rate never changes timing. Frames render into a retained cell buffer, only changed rows are written, and output is capped at about 30 fps.

Keys: `Space` (empty prompt) toggles playback. `Enter` submits, or queues in QUEUE mode. `Shift+Enter`/`Ctrl+J` inserts a newline, `Alt+Enter` queues and `Ctrl+Q` toggles STEER/QUEUE. `Ctrl+Z`/`Ctrl+Y` undo and redo, and `Ctrl+O` or `/transcript` opens the transcript, which scrolls with ↑/↓, PgUp/PgDn and Home/End, and `/` cycles its filter (all, requests, ops, errors). `Esc` cancels an agent turn, closes the overlay or clears the draft. `Ctrl+L` redraws and `Ctrl+C` exits. Bracketed paste keeps multiline text intact.

Themes: `/theme default|high-contrast|mono`, `--theme`, `DAWG_THEME`. Color falls back through truecolor, 256-color, 16-color and monochrome. `NO_COLOR` and `TERM=dumb` are supported. `/motion off`, `--reduce-motion` and `DAWG_REDUCE_MOTION=1` switch to static states in the same positions.

Other code reports into the activity strip through `ActivityFeed` (`tui/activity.ts`): `pushCard(text, {tone, baseRevision, resultRevision, hint})`, `pushError(text)`, `setSpinner(label | undefined)`, `setQueueDepth(n)` and `applyAgentEvent(event)`, which accepts the agent's streaming `AgentEvent`s unchanged. Command handlers return a `Receipt` (`{ok: true | false | "warn", text}`), so a failure such as `main is not a drum track` is red because it says so, not because of its wording; `receiptTone` only classifies the legacy strings that remain. The `^z undo` hint rides only on receipts that changed the score, and only the first three in a session. `/help`, `/sessions` and `/tracks` open a scrollable text overlay (`TuiApp.openText`) and leave one summary card in the strip; `/help` is generated from `src/commands/help.ts`, which also feeds `dawg --help` and the usage hints that answer an unknown `/word` or a near-miss such as `pan 3` without a model call.

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
/track drums
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
reverb 0.3
reverb 0.4 0.8
reverb off
automate filter at 0 400
automate filter at 4 6000
automate resonance at 0 0.2
automate delay-feedback at 0 0.6
automate delay-mix at 4 0
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
/status
/export loop.track.json
/import loop.track.json
/model opus-5.5
/help
```

`/track <name>` focuses a track in this window and creates it when it is new; when another live window has it focused the reply is `<name> is open in another window` and focus stays put. Music words are bare and app commands take a slash; `tracks`, `export`, `import` and `track` still work bare as aliases but are listed once.

Drum tracks use the `kit` instrument (a track named `drums` gets it automatically). Notes on a kit track keep the score's MIDI pitch field, using General MIDI percussion numbers (kick 36, rim 37, snare 38, clap 39, closed hat 42, tom 45, open hat 46), so drum hits round-trip through `track.loop/v1` unchanged and the highway draws them in one lane per voice. Grammar, one command per prompt, beats in score beats:

```text
hit <voice> [at] <beat> [vel <0..1>]
pattern <voice> <beat> [<beat> ...] [vel <0..1>]        up to 64 beats
pattern <voice> every <step> [from <beat>] [vel <0..1>]  step >= 0.125, fills the loop, at most 256 hits
clear <voice>
filter <cutoff 20..20000> [<resonance 0..1>] | filter off
delay <beats 0.0625..4> [<feedback 0..0.9> [<mix 0..1>]] | delay off
reverb <mix 0..1> [<size 0..1>] | reverb off     size defaults to 0.5
automate filter at <beat> <cutoff> | clear filter automation
automate resonance at <beat> <0..1> | clear resonance automation
automate delay-feedback at <beat> <0..0.9> | clear delay-feedback automation
automate delay-mix at <beat> <0..1> | clear delay-mix automation
solo | unsolo
undo | redo
```

Effects live on the track as optional `filter {cutoff, resonance}`, `delay {beats, feedback, mix}`, `reverb {mix, size}`, `filterAutomation`, `resonanceAutomation`, `delayFeedbackAutomation`, `delayMixAutomation`, and `solo` fields. Effect lanes modulate an existing effect: a resonance lane needs a filter and the delay lanes need a delay. Documents written before these fields existed still parse; out-of-range or non-finite values are rejected. Undo and redo append ordinary session events, so history is shared by every window and a new edit clears the redo stack.

Unrecognized prompts go to the agent whenever a provider is configured (`DAWG_AI=0` disables it). `dawg login` creates and stores an AI Gateway key; see **Providers and auth** below. `DAWG_MODEL=opus-5.5` or `DAWG_MODEL=sol-6.1` selects the initial friendly model label, and `/model opus-5.5` or `/model sol-6.1` switches it during a session. `DAWG_OPUS_MODEL` / `DAWG_SOL_MODEL` can map those labels to the provider IDs available in the account. By default the labels map to `anthropic/claude-opus-5.5` and `openai/gpt-6.1-sol`. Both IDs were checked against `GET https://ai-gateway.vercel.sh/v1/models` and are tagged `tool-use`. Labels outside the allowlist are rejected before any request is sent.

### Agent turns

A turn calls `POST /v1/chat/completions` with `stream: true` and one JSON-schema tool for each operation family. The OpenAI-compatible SSE stream is parsed locally with `fetch`, so the agent adds no runtime dependency. Each request sends a compact, deterministic **composition brief** instead of raw logs. It contains revision, tempo, meter, bars, key, tracks with instrument, mix, note count and pitch range, the focused track's notes, recent accepted operations and the instrument list. It is capped at 12 KiB and never includes environment values.

When a tool call finishes streaming, it passes three checks: the tool's own argument checks, the planner's bounded operation validator, and a dry run of the score reducer. Only then is it committed through the session as a separate revision pinned to the revision it was planned against. If the call fails a check, or another window committed first (stale revision), dawg rejects it without changing the score. The model receives the diagnostic as the tool result and can correct itself. A turn is bounded to 8 steps, 32 tool calls, 256 KiB of streamed response and a 90 s timeout.

`runAgentTurn` (`src/agent/agent.ts`) emits structured progress events for the TUI: `step`, `text-delta`, `tool-start`, `tool-applied` (with `summary`, `baseRevision`, `resultRevision` and `trackId`), `tool-rejected` (with `diagnostic`), and a final `done` or `error` (`aborted`, `timeout`, `budget`, `provider`). To add an operation family, append a tool to `AGENT_TOOLS` in `src/agent/tools.ts`. The schema, dispatch and validation all come from that one entry.

### Workspace and web tools

The project directory (the directory `dawg` runs in) is the agent's workspace. Six more entries in `AGENT_TOOLS` give the model bounded file and web access on both the gateway and xcb paths; `src/agent/workspace.ts` holds the path policy and `src/web/` the network side.

- `list_files`, `read_file`: anywhere in the project except `.dawg/`, which dawg owns. Listings stop at 500 entries, reads at 256 KiB per call (1-based `offset` and `limit` page through larger files), and binary files (WAV, AIFF, FLAC, MP3, MIDI, images, archives) report type and size instead of bytes.
- `write_file`, `edit_file`: only `song.ts` and the focused track's `tracks/<slug>/` directory (`core/slug.ts` derives the slug from the track name). Writes are atomic (temp file and rename), capped at 1 MiB, and create parent directories. `edit_file` replaces exactly one occurrence of `old`; zero or several matches return a count and nothing changes. `tracks/<slug>/notes.md` is the model's scratchpad and is never parsed. After a write, the optional host hook `onWorkspaceWrite(path)` can append text to the tool result (the project lane uses it to report how `track.ts` applied).
- Every path is resolved lexically and then through `realpath`; `..`, absolute paths outside the root, symlinks that leave the project and anything under `.dawg/` are rejected with a diagnostic naming the writable roots. The brief gains a `project` entry with a tree of at most 30 lines and the first 1 KiB of the focused `notes.md`; both are shed before track summaries when the 12 KiB budget is tight.
- `web_search` returns up to 8 `{title, url, snippet}` results. Providers, first match wins: `BRAVE_SEARCH_API_KEY` (explicit override); an AI Gateway key, which makes one non-streaming `anthropic/claude-haiku-4.5` call with the gateway's server-side search tool (`DAWG_WEB_SEARCH=exa|perplexity|parallel|browserbase`, default `exa`; the gateway bills the search, about $0.007 for Exa); an OpenRouter key (`OPENROUTER_API_KEY`), which uses the `web` plugin and its `url_citation` annotations; else DuckDuckGo's HTML endpoint. A failing paid provider falls through to DuckDuckGo and the result says so. The activity card names the answering provider (`searched via gateway · exa`), and `WebHost.onSpend` reports each billed search for the spend ledger.
- `fetch_url` fetches one public http(s) URL locally: hostnames are resolved first and loopback, private, link-local, CGNAT and multicast addresses (IPv4, IPv6 and mapped) are refused, redirects (at most 3) are re-checked per hop, bodies stop at 2 MiB and the text handed to the model at 32 KiB. HTML is reduced to headings, lists, links and paragraphs; scripts, styles and navigation are dropped. Fetched text is untrusted and the system prompt says so.

All limits live in `WORKSPACE_LIMITS`, `SEARCH_LIMITS` and `FETCH_LIMITS`. Search and fetch take an injectable `fetch` (and `lookup`), so tests run on fixtures in `src/web/fixtures/` without network. The gateway search fixture is derived from the documented response shape; capture a live response once to confirm it.

### Providers and auth

`src/agent/provider.ts` picks a backend per turn: `DAWG_PROVIDER`, then the choice saved by `dawg login` in `~/.config/dawg/config.json` (no secrets), then `auto` (a gateway key, else an available xcb account, else offline with a `dawg login` hint). Gateway keys resolve from `AI_GATEWAY_API_KEY`, then the macOS Keychain (`security find-generic-password -s dawg -a ai-gateway -w`), then `~/.config/dawg/credentials.json` (0600 under a 0700 directory, written atomically through a temp file and rename). Storing uses `security -i` with the command on stdin, so the key never appears on an argv. Keys must match `[A-Za-z0-9._-]{16,256}` and are shown only masked (`vck_…abcd`).

`dawg login` (`src/auth/login.ts`) runs `vercel whoami --format json`. If you are not logged in, it hands the terminal to `vercel login`, then runs `vercel ai-gateway api-keys create --name dawg-<host> --non-interactive [--limit <dollars>]`. That command prints only the key on stdout. dawg validates the key with `GET /v1/credits` and reports valid, rejected or unverified (offline). Every subprocess goes through the injectable `CommandRunner` in `src/auth/runner.ts`, which bounds output, writes stdin and on abort sends SIGTERM (SIGKILL after 15 s) and waits for exit. Tests script `vercel`, `security` and `xcb` through it.

The xcb provider (`src/agent/xcb.ts`, `src/agent/xcb-agent.ts`) calls `xcb --json generate` with one `{version:1, account, model, prompt, timeoutMs, maxOutputBytes}` request on stdin. xcb exposes zero tools and does not stream, so the prompt carries the system rules, the composition brief and the tool catalog as JSON schemas, and asks for exactly one `{ops:[{tool,args}], say?, done}` object. The reply is untrusted. dawg takes the first balanced JSON object in at most 64 KiB, allows at most 16 ops and caps `say` at 400 characters. Each op then goes through `executeCall`, the same argument checks, operation validator, reducer dry run and per-op revision commit used by the gateway loop, and emits the same `tool-applied`/`tool-rejected`/`text-delta` events. If a reply cannot be parsed, an op is rejected or `done` is false, dawg makes another call with the per-op results, up to 3 calls and within the normal turn budgets. Esc aborts the turn, which terminates the xcb child and keeps every accepted revision. Accounts come from `xcb --json generate --capabilities`, parsed field by field from `unknown`. An account is usable only when xcb reports it `available` with at least one model, which requires xcb's application qualification. An account whose `admission` is `pending` (xcb admits it on first use) is also usable; `denied` never is, and the field may be absent. dawg never runs qualification or the xcb installer.

`generateText(prompt, {maxTokens, signal?, timeoutMs?, selection?})` from `src/agent/provider.ts` is a tool-free one-shot completion for helpers like session naming. On the gateway it uses `anthropic/claude-haiku-4.5` with `max_tokens`. On xcb it uses the selected account with `maxOutputBytes ≈ 8 × maxTokens`. It returns at most 512 trimmed characters of untrusted text and throws when offline, so callers should fall back to a local default.

Playback renders the score to interleaved stereo 16-bit PCM with deterministic sine, piano, pluck, bass, saw, square, and triangle voices and a synthesized kit whose noise comes from a PRNG seeded by each note, so every render is byte-identical. Track volume and pan automation, the low-pass filter (with cutoff and resonance lanes), the delay send (with feedback and mix lanes), and the reverb send are applied per track; mute always silences a track and any solo silences unsoloed tracks. Pan uses an equal-power law (-1 left, 1 right). The delay is a stereo ping-pong (first repeat on the panned side, later repeats alternate) and the reverb is a Freeverb-style network of eight parallel damped combs and four series allpasses per channel, with the right channel's delay lines offset for width; both use only integer delay lengths and fixed coefficients, so renders stay deterministic.

Audio engine. With `dawgd` running only the daemon plays audio; on the file-lock fallback a per-session audio lock keeps multiple TUI windows from starting duplicate voices. The engine renders one loop with every tail (release, delay, reverb) folded back onto the loop start, so the buffer repeats seamlessly, and streams it as raw s16le stereo into one long-lived player process, paced by the wall clock with about 200 ms queued. An edit renders the new loop and swaps it in at the current loop position without restarting the player; a tempo change keeps the musical beat; a seek or a drift above 30 ms re-anchors the write position to the shared transport clock, offset by the queued audio, so the transport matches what you hear. Backends, in order: `ffplay -f s16le -i -`, then SoX `play -t raw -`, then (macOS) `afplay` re-rendering a loop-folded WAV rotated to the current beat on each edit, the only backend that restarts. `DAWG_AUDIO_BACKEND=ffplay|sox|afplay|none` forces one, `DAWG_AUDIO_PLAYER="cmd {rate} {channels}"` streams into any stdin player, and `DAWG_AUDIO=0` disables sound. `dawg auth status` and `/auth` print the detected backend. The renderer is deterministic and independently testable; a native or sample-backed instrument backend can replace it behind the same player port.
Set `DAWG_AUDIO=0` for headless sessions.

Use `DAWG_DEMO=1 bun run src/main.ts` for a deterministic non-interactive frame stream while developing the renderer.

## Release

Bump `version` in `package.json` and add its section to `CHANGELOG.md` in a pull request, then merge it. When Check passes on `main`, the annotated `v<version>` tag, the immutable GitHub Release (tarball, `SHA256SUMS` and a provenance attestation) and the npm publish of `@hraness/dawg` follow automatically. See [docs/publishing.md](./docs/publishing.md).
